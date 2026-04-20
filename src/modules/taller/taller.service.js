/**
 * BUG CORREGIDO: el legacy usaba `ordenes_taller` en GET/PATCH
 * pero la tabla real (según schema SQL) es `taller_ordenes`.
 * Todos los queries aquí usan `taller_ordenes` consistentemente.
 */
const db = require('../../../db');
const AppError = require('../../lib/AppError');
const withTransaction = require('../../lib/withTransaction');
const {
  METODOS_PAGO_VALIDOS,
  registrarPagoServicio,
  toNumber,
} = require('../../../utils/pagos-servicios');

const ESTADOS_OT = ['Diagnóstico', 'Diagnostico', 'En_Reparacion', 'Listo', 'Entregado'];

const OT_FIELDS = /* sql */`
  ot.*, ot.descripcion_falla AS descripcion, ot.total_orden AS total_general,
  c.nombre AS cliente_nombre, e.nombre AS mecanico_nombre, e.nombre AS empleado_nombre
`;

async function recalcularTotales(ordenId) {
  const { rows } = await db.query(
    `SELECT total_linea, tipo_item FROM taller_items WHERE orden_id=$1`,
    [ordenId]
  );
  let total_mano_obra = 0, total_repuestos = 0;
  for (const item of rows) {
    if (item.tipo_item === 'Servicio') total_mano_obra += Number(item.total_linea) || 0;
    else if (item.tipo_item === 'Repuesto') total_repuestos += Number(item.total_linea) || 0;
  }
  await db.query(
    `UPDATE taller_ordenes SET total_orden=$1 WHERE id=$2`,
    [total_mano_obra + total_repuestos, ordenId]
  );
}

async function crear(empresaId, body) {
  const { placa, descripcion_falla, descripcion, cliente_id, vehiculo_id,
          mecanico_id, empleado_id, total_orden, total_general } = body;

  const descripcionFinal = descripcion_falla || descripcion;
  const mecanicoFinal    = mecanico_id || empleado_id || null;
  const totalFinal       = total_orden ?? total_general ?? 0;

  if (!placa || !descripcionFinal) {
    throw new AppError('Placa y descripción de la falla son obligatorias.', 400);
  }

  const { rows: maxRow } = await db.query(
    `SELECT COALESCE(MAX(numero_orden::bigint),0)+1 AS siguiente
     FROM taller_ordenes WHERE empresa_id=$1`,
    [empresaId]
  );

  const { rows } = await db.query(
    `INSERT INTO taller_ordenes
     (empresa_id,numero_orden,placa,descripcion_falla,cliente_id,vehiculo_id,mecanico_id,total_orden)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *, descripcion_falla AS descripcion, total_orden AS total_general`,
    [empresaId, maxRow[0].siguiente, placa.toUpperCase().trim(), descripcionFinal,
     cliente_id || null, vehiculo_id || null, mecanicoFinal, totalFinal]
  );
  return rows[0];
}

async function listar(empresaId, { estado, placa } = {}) {
  const condiciones = ['ot.empresa_id=$1'];
  const params = [empresaId];
  let idx = 2;
  if (estado) { condiciones.push(`ot.estado=$${idx++}`); params.push(estado); }
  if (placa)  { condiciones.push(`ot.placa=$${idx++}`);  params.push(placa.toUpperCase().trim()); }

  const { rows } = await db.query(
    `SELECT ${OT_FIELDS}
     FROM taller_ordenes ot
     LEFT JOIN clientes c ON c.id=ot.cliente_id
     LEFT JOIN empleados e ON e.id=ot.mecanico_id
     WHERE ${condiciones.join(' AND ')}
     ORDER BY ot.fecha_creacion DESC`,
    params
  );
  return rows;
}

async function obtener(empresaId, id) {
  const { rows: otRows } = await db.query(
    `SELECT ${OT_FIELDS}
     FROM taller_ordenes ot
     LEFT JOIN clientes c ON c.id=ot.cliente_id
     LEFT JOIN empleados e ON e.id=ot.mecanico_id
     WHERE ot.empresa_id=$1 AND ot.id=$2
     LIMIT 1`,
    [empresaId, id]
  );
  if (!otRows.length) throw new AppError('Orden de taller no encontrada.', 404);

  const { rows: items } = await db.query(
    `SELECT * FROM taller_items WHERE orden_id=$1 ORDER BY id ASC`,
    [id]
  );
  return { orden: otRows[0], items };
}

async function historial(empresaId, { desde, hasta, estado, mecanico_id } = {}) {
  const condiciones = ['ot.empresa_id=$1'];
  const params = [empresaId];
  let idx = 2;
  if (desde)      { condiciones.push(`ot.fecha_creacion>=$${idx++}`); params.push(desde); }
  if (hasta)      { condiciones.push(`ot.fecha_creacion<=$${idx++}`); params.push(hasta); }
  if (estado)     { condiciones.push(`ot.estado=$${idx++}`);          params.push(estado); }
  if (mecanico_id){ condiciones.push(`ot.mecanico_id=$${idx++}`);     params.push(mecanico_id); }

  const { rows } = await db.query(
    `SELECT ${OT_FIELDS}
     FROM taller_ordenes ot
     LEFT JOIN clientes c ON c.id=ot.cliente_id
     LEFT JOIN empleados e ON e.id=ot.mecanico_id
     WHERE ${condiciones.join(' AND ')}
     ORDER BY ot.fecha_creacion DESC`,
    params
  );
  return rows;
}

async function cambiarEstado(empresaId, id, { estado }) {
  if (!estado || !ESTADOS_OT.includes(estado)) {
    throw new AppError(`Estado inválido. Valores permitidos: ${ESTADOS_OT.join(', ')}`, 400);
  }

  const { rows } = await db.query(
    `UPDATE taller_ordenes
     SET estado=$1,
         fecha_entrega=CASE WHEN $1='Entregado' THEN COALESCE(fecha_entrega,NOW()) ELSE fecha_entrega END
     WHERE empresa_id=$2 AND id=$3
     RETURNING *, descripcion_falla AS descripcion, total_orden AS total_general`,
    [estado, empresaId, id]
  );
  if (!rows.length) throw new AppError('Orden de taller no encontrada.', 404);
  return rows[0];
}

async function actualizar(empresaId, usuarioId, id, body) {
  const { estado, metodo_pago, detalle_pago, monto_pago, referencia_transaccion } = body || {};

  if (!estado || !ESTADOS_OT.includes(estado)) {
    throw new AppError(`Estado inválido. Valores permitidos: ${ESTADOS_OT.join(', ')}`, 400);
  }
  if (metodo_pago && !METODOS_PAGO_VALIDOS.includes(metodo_pago)) {
    throw new AppError(`Método de pago inválido. Opciones válidas: ${METODOS_PAGO_VALIDOS.join(', ')}`, 400);
  }

  const entregar = estado === 'Entregado';

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE taller_ordenes
       SET estado=$1,
           fecha_entrega=CASE WHEN $2 THEN COALESCE(fecha_entrega,NOW()) ELSE fecha_entrega END
       WHERE empresa_id=$3 AND id=$4
       RETURNING *, descripcion_falla AS descripcion, total_orden AS total_general`,
      [estado, entregar, empresaId, id]
    );
    if (!rows.length) throw new AppError('Orden de taller no encontrada.', 404);

    let orden = rows[0];
    let pagoResumen = null;
    const totalServicio = toNumber(orden.total_general || orden.total_orden);
    const detalleStr = detalle_pago != null ? JSON.stringify(detalle_pago) : null;

    if (entregar && totalServicio > 0 && !metodo_pago) {
      throw new AppError('Debe registrar el método de pago para entregar la orden.', 400);
    }

    if (entregar && metodo_pago && totalServicio > 0) {
      const resultado = await registrarPagoServicio({
        queryable: client, empresaId, usuarioId,
        modulo: 'taller', referenciaId: id,
        monto: monto_pago, metodoPago: metodo_pago,
        referenciaTransaccion: referencia_transaccion, detallePago: detalle_pago,
      });
      pagoResumen = resultado.servicio;
      const { rows: updated } = await client.query(
        `SELECT *, descripcion_falla AS descripcion, total_orden AS total_general
         FROM taller_ordenes WHERE empresa_id=$1 AND id=$2 LIMIT 1`,
        [empresaId, id]
      );
      orden = updated[0] || orden;
    } else if (metodo_pago || detalleStr) {
      const { rows: updated } = await client.query(
        `UPDATE taller_ordenes
         SET metodo_pago=COALESCE($1,metodo_pago), detalle_pago=COALESCE($2::jsonb,detalle_pago)
         WHERE empresa_id=$3 AND id=$4
         RETURNING *, descripcion_falla AS descripcion, total_orden AS total_general`,
        [metodo_pago || null, detalleStr, empresaId, id]
      );
      orden = updated[0] || orden;
    }

    const mensaje = entregar
      ? pagoResumen
        ? pagoResumen.estado_cartera === 'PAGADO'
          ? 'Orden entregada y pago registrado correctamente.'
          : 'Orden entregada. Se registró un abono y quedó saldo pendiente.'
        : 'Orden entregada correctamente.'
      : 'Orden actualizada correctamente.';

    return { ...orden, pago_resumen: pagoResumen, mensaje };
  });
}

async function agregarItem(empresaId, ordenId, body) {
  let { tipo_item, descripcion, cantidad, precio_unitario } = body;

  if (!tipo_item || !descripcion || !precio_unitario) {
    throw new AppError('tipo_item, descripcion y precio_unitario son obligatorios.', 400);
  }

  tipo_item   = tipo_item === 'Repuesto' ? 'Repuesto' : 'Servicio';
  cantidad    = cantidad ? Number(cantidad) : 1;
  const precio     = Number(precio_unitario);
  const total_linea = Math.round(cantidad * precio);

  const { rows: otRows } = await db.query(
    `SELECT id FROM taller_ordenes WHERE empresa_id=$1 AND id=$2 LIMIT 1`,
    [empresaId, ordenId]
  );
  if (!otRows.length) throw new AppError('Orden de taller no encontrada.', 404);

  const { rows } = await db.query(
    `INSERT INTO taller_items (orden_id,tipo_item,descripcion,cantidad,precio_unitario,total_linea)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [ordenId, tipo_item, descripcion, cantidad, precio, total_linea]
  );
  await recalcularTotales(ordenId);
  return rows[0];
}

async function eliminarItem(itemId) {
  const { rows } = await db.query(
    `SELECT orden_id FROM taller_items WHERE id=$1 LIMIT 1`,
    [itemId]
  );
  if (!rows.length) throw new AppError('Ítem no encontrado.', 404);

  const orden_id = rows[0].orden_id;
  await db.query(`DELETE FROM taller_items WHERE id=$1`, [itemId]);
  await recalcularTotales(orden_id);
}

async function registrarPago(empresaId, id, { metodo_pago, detalle_pago }) {
  if (!metodo_pago) throw new AppError('Debe enviar el campo metodo_pago.', 400);
  if (!METODOS_PAGO_VALIDOS.includes(metodo_pago)) {
    throw new AppError(`Método de pago inválido. Opciones válidas: ${METODOS_PAGO_VALIDOS.join(', ')}`, 400);
  }

  const detalleStr = detalle_pago != null ? JSON.stringify(detalle_pago) : null;
  const { rows } = await db.query(
    `UPDATE taller_ordenes
     SET metodo_pago=$1, detalle_pago=$2::jsonb
     WHERE empresa_id=$3 AND id=$4
     RETURNING *, descripcion_falla AS descripcion, total_orden AS total_general`,
    [metodo_pago, detalleStr, empresaId, id]
  );
  if (!rows.length) throw new AppError('Orden de taller no encontrada.', 404);
  return rows[0];
}

module.exports = {
  crear, listar, obtener, historial,
  cambiarEstado, actualizar,
  agregarItem, eliminarItem, registrarPago,
};
