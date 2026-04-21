const db = require('../../../db');
const AppError = require('../../lib/AppError');
const withTransaction = require('../../lib/withTransaction');
const { assertEmpresaOwnedRecord } = require('../../lib/tenant-scope');
const {
  METODOS_PAGO_VALIDOS,
  registrarPagoServicio,
  toNumber,
} = require('../../../utils/pagos-servicios');

const ESTADOS_VALIDOS = ['Pendiente', 'En_Proceso', 'Completado'];

// ─── Tipos de lavado ──────────────────────────────────────────────────────────

async function crearTipo(empresaId, { nombre, precio, descripcion }) {
  if (!nombre || !precio) throw new AppError('Nombre y precio son obligatorios.', 400);
  try {
    const { rows } = await db.query(
      `INSERT INTO tipos_lavado (empresa_id,nombre,precio_base,descripcion)
       VALUES ($1,$2,$3,$4)
       RETURNING *, precio_base AS precio`,
      [empresaId, nombre, precio, descripcion || null]
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw new AppError('Ya existe un tipo de lavado con ese nombre.', 409);
    throw err;
  }
}

async function listarTipos(empresaId) {
  const { rows } = await db.query(
    `SELECT *, precio_base AS precio FROM tipos_lavado
     WHERE empresa_id=$1 ORDER BY nombre ASC`,
    [empresaId]
  );
  return rows;
}

async function actualizarTipo(empresaId, id, { nombre, precio, descripcion, activo }) {
  if (!nombre || !precio) throw new AppError('Nombre y precio son obligatorios.', 400);
  const { rows } = await db.query(
    `UPDATE tipos_lavado
     SET nombre=$1, precio_base=$2, descripcion=$3, activo=$4
     WHERE empresa_id=$5 AND id=$6
     RETURNING *, precio_base AS precio`,
    [nombre, precio, descripcion || null, !!activo, empresaId, id]
  );
  if (!rows.length) throw new AppError('Tipo de lavado no encontrado.', 404);
  return rows[0];
}

// ─── Órdenes de lavado ────────────────────────────────────────────────────────

async function crear(empresaId, body) {
  const { placa, tipo_lavado_id, tipo_lavado, precio, cliente_id, vehiculo_id,
          lavador_id, empleado_id, observaciones, notas } = body;

  if (!placa || (!tipo_lavado_id && !tipo_lavado)) {
    throw new AppError('Placa y tipo de lavado son obligatorios.', 400);
  }

  if (cliente_id) {
    await assertEmpresaOwnedRecord(db, 'clientes', empresaId, cliente_id, 'El cliente indicado no pertenece a esta empresa.');
  }
  if (vehiculo_id) {
    await assertEmpresaOwnedRecord(db, 'vehiculos', empresaId, vehiculo_id, 'El vehículo indicado no pertenece a esta empresa.');
  }
  if (lavador_id || empleado_id) {
    await assertEmpresaOwnedRecord(db, 'empleados', empresaId, lavador_id || empleado_id, 'El empleado asignado no pertenece a esta empresa.');
  }
  if (tipo_lavado_id) {
    await assertEmpresaOwnedRecord(db, 'tipos_lavado', empresaId, tipo_lavado_id, 'El tipo de lavado no pertenece a esta empresa.');
  }

  let tipoLavadoId = tipo_lavado_id || null;
  let precioFinal  = precio || null;

  if (!tipoLavadoId && tipo_lavado) {
    const nombreTipo = String(tipo_lavado).trim().toUpperCase();
    const preciosPorTipo = { 'BÁSICO': 25000, BASICO: 25000, COMPLETO: 45000, PREMIUM: 65000 };

    const { rows: tipos } = await db.query(
      `SELECT id, precio_base FROM tipos_lavado
       WHERE empresa_id=$1 AND UPPER(nombre)=$2 LIMIT 1`,
      [empresaId, nombreTipo]
    );

    if (tipos.length) {
      tipoLavadoId = tipos[0].id;
      precioFinal  = precioFinal || tipos[0].precio_base;
    } else {
      const { rows: creado } = await db.query(
        `INSERT INTO tipos_lavado (empresa_id,nombre,precio_base) VALUES ($1,$2,$3) RETURNING id,precio_base`,
        [empresaId, nombreTipo, preciosPorTipo[nombreTipo] || 0]
      );
      tipoLavadoId = creado[0].id;
      precioFinal  = precioFinal || creado[0].precio_base;
    }
  }

  if (!precioFinal || Number(precioFinal) <= 0) {
    throw new AppError('El tipo de lavado no tiene precio configurado.', 400);
  }

  const { rows } = await db.query(
    `INSERT INTO lavadero
     (empresa_id,placa,tipo_lavado_id,precio,cliente_id,vehiculo_id,lavador_id,observaciones)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [empresaId, placa, tipoLavadoId, precioFinal,
     cliente_id || null, vehiculo_id || null,
     lavador_id || empleado_id || null, observaciones || notas || null]
  );
  return rows[0];
}

async function listar(empresaId, { estado } = {}) {
  const params = [empresaId];
  let where = 'l.empresa_id=$1';
  if (estado) { params.push(estado); where += ` AND l.estado=$${params.length}`; }

  const { rows } = await db.query(
    `SELECT l.*, tl.nombre AS tipo_lavado_nombre, tl.nombre AS tipo_lavado,
            e.nombre AS lavador_nombre, e.nombre AS empleado_nombre
     FROM lavadero l
     LEFT JOIN tipos_lavado tl ON tl.id=l.tipo_lavado_id AND tl.empresa_id=l.empresa_id
     LEFT JOIN empleados e ON e.id=l.lavador_id AND e.empresa_id=l.empresa_id
     WHERE ${where} ORDER BY l.id DESC`,
    params
  );
  return rows;
}

async function obtener(empresaId, id) {
  const { rows } = await db.query(
    `SELECT l.*, tl.nombre AS tipo_lavado_nombre, tl.descripcion AS tipo_lavado_descripcion,
            e.nombre AS lavador_nombre, v.placa AS vehiculo_placa,
            v.marca, v.modelo, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono
     FROM lavadero l
     LEFT JOIN tipos_lavado tl ON tl.id=l.tipo_lavado_id AND tl.empresa_id=l.empresa_id
     LEFT JOIN empleados e ON e.id=l.lavador_id AND e.empresa_id=l.empresa_id
     LEFT JOIN vehiculos v ON v.id=l.vehiculo_id AND v.empresa_id=l.empresa_id
     LEFT JOIN clientes c ON c.id=v.cliente_id AND c.empresa_id=l.empresa_id
     WHERE l.empresa_id=$1 AND l.id=$2`,
    [empresaId, id]
  );
  if (!rows.length) throw new AppError('Orden de lavado no encontrada.', 404);
  return rows[0];
}

async function historial(empresaId, { desde, hasta, lavador_id } = {}) {
  const condiciones = ['l.empresa_id=$1'];
  const params = [empresaId];
  let idx = 2;
  if (desde) { condiciones.push(`l.hora_inicio>=$${idx++}`); params.push(desde); }
  if (hasta) { condiciones.push(`l.hora_inicio<=$${idx++}`); params.push(hasta); }
  if (lavador_id) { condiciones.push(`l.lavador_id=$${idx++}`); params.push(lavador_id); }

  const { rows } = await db.query(
    `SELECT l.*, tl.nombre AS tipo_lavado_nombre, e.nombre AS lavador_nombre
     FROM lavadero l
     LEFT JOIN tipos_lavado tl ON tl.id=l.tipo_lavado_id AND tl.empresa_id=l.empresa_id
     LEFT JOIN empleados e ON e.id=l.lavador_id AND e.empresa_id=l.empresa_id
     WHERE ${condiciones.join(' AND ')} ORDER BY l.id DESC`,
    params
  );
  return rows;
}

async function actualizarEstado(empresaId, id, { estado }) {
  if (!estado || !ESTADOS_VALIDOS.includes(estado)) {
    throw new AppError(`Estado inválido. Valores permitidos: ${ESTADOS_VALIDOS.join(', ')}`, 400);
  }

  const { rows } = await db.query(
    `UPDATE lavadero
     SET estado=$1::varchar,
         hora_fin=CASE WHEN $1::text='Completado' THEN COALESCE(hora_fin,NOW()) ELSE hora_fin END
     WHERE empresa_id=$2 AND id=$3
     RETURNING *`,
    [estado, empresaId, id]
  );
  if (!rows.length) throw new AppError('Lavado no encontrado.', 404);
  return rows[0];
}

async function actualizar(empresaId, usuarioId, id, body) {
  const { estado, metodo_pago, detalle_pago, monto_pago, referencia_transaccion } = body || {};

  if (!estado || !ESTADOS_VALIDOS.includes(estado)) {
    throw new AppError(`Estado inválido. Valores permitidos: ${ESTADOS_VALIDOS.join(', ')}`, 400);
  }
  if (metodo_pago && !METODOS_PAGO_VALIDOS.includes(metodo_pago)) {
    throw new AppError(`Método de pago inválido. Opciones válidas: ${METODOS_PAGO_VALIDOS.join(', ')}`, 400);
  }

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE lavadero
       SET estado=$1::varchar,
           hora_fin=CASE WHEN $1::text='Completado' THEN COALESCE(hora_fin,NOW()) ELSE hora_fin END
       WHERE empresa_id=$2 AND id=$3
       RETURNING *`,
      [estado, empresaId, id]
    );
    if (!rows.length) throw new AppError('Lavado no encontrado.', 404);

    let lavado = rows[0];
    let pagoResumen = null;
    const totalServicio = toNumber(lavado.precio);
    const detalleStr = detalle_pago != null ? JSON.stringify(detalle_pago) : null;

    if (estado === 'Completado' && totalServicio > 0 && !metodo_pago) {
      throw new AppError('Debe registrar el método de pago para completar el lavado.', 400);
    }

    if (estado === 'Completado' && metodo_pago && totalServicio > 0) {
      const resultado = await registrarPagoServicio({
        queryable: client, empresaId, usuarioId,
        modulo: 'lavadero', referenciaId: id,
        monto: monto_pago, metodoPago: metodo_pago,
        referenciaTransaccion: referencia_transaccion, detallePago: detalle_pago,
      });
      pagoResumen = resultado.servicio;
      const { rows: updated } = await client.query(
        `SELECT * FROM lavadero WHERE empresa_id=$1 AND id=$2 LIMIT 1`,
        [empresaId, id]
      );
      lavado = updated[0] || lavado;
    } else if (metodo_pago || detalleStr) {
      const { rows: updated } = await client.query(
        `UPDATE lavadero
         SET metodo_pago=COALESCE($1::varchar,metodo_pago),
             detalle_pago=COALESCE($2::jsonb,detalle_pago)
         WHERE empresa_id=$3 AND id=$4
         RETURNING *`,
        [metodo_pago || null, detalleStr, empresaId, id]
      );
      lavado = updated[0] || lavado;
    }

    const mensaje = estado === 'Completado'
      ? pagoResumen
        ? pagoResumen.estado_cartera === 'PAGADO'
          ? 'Lavado completado y pago registrado correctamente.'
          : 'Lavado completado. Se registró un abono y quedó saldo pendiente.'
        : 'Lavado completado correctamente.'
      : 'Lavado actualizado correctamente.';

    return { ...lavado, pago_resumen: pagoResumen, mensaje };
  });
}

async function registrarPago(empresaId, id, { metodo_pago, detalle_pago }) {
  if (!metodo_pago) throw new AppError('Debe enviar el campo metodo_pago.', 400);
  if (!METODOS_PAGO_VALIDOS.includes(metodo_pago)) {
    throw new AppError(`Método de pago inválido. Opciones válidas: ${METODOS_PAGO_VALIDOS.join(', ')}`, 400);
  }

  const detalleStr = detalle_pago != null ? JSON.stringify(detalle_pago) : null;
  const { rows } = await db.query(
    `UPDATE lavadero SET metodo_pago=$1, detalle_pago=$2::jsonb
     WHERE empresa_id=$3 AND id=$4 RETURNING *`,
    [metodo_pago, detalleStr, empresaId, id]
  );
  if (!rows.length) throw new AppError('Lavado no encontrado.', 404);
  return rows[0];
}

async function asignarLavador(empresaId, id, lavador_id) {
  if (lavador_id) {
    await assertEmpresaOwnedRecord(db, 'empleados', empresaId, lavador_id, 'El empleado asignado no pertenece a esta empresa.');
  }
  const { rows } = await db.query(
    `UPDATE lavadero SET lavador_id=$1 WHERE empresa_id=$2 AND id=$3 RETURNING *`,
    [lavador_id, empresaId, id]
  );
  if (!rows.length) throw new AppError('Orden de lavado no encontrada.', 404);
  return rows[0];
}

module.exports = {
  crearTipo, listarTipos, actualizarTipo,
  crear, listar, obtener, historial,
  actualizar, actualizarEstado, registrarPago, asignarLavador,
};
