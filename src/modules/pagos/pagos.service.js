const db = require('../../../db');
const AppError = require('../../lib/AppError');
const withTransaction = require('../../lib/withTransaction');
const { normalizarPlaca, toNumber } = require('../../lib/helpers');
const { ensurePagosServiciosSchema } = require('../../../utils/pagos-servicios-schema');
const {
  buildPagosServiciosJoin,
  enriquecerMovimientoPago,
  normalizarModulo,
  obtenerServicioRecibo,
  registrarPagoServicio,
} = require('../../../utils/pagos-servicios');

function resumirCartera(movimientos, mensualidades) {
  const resumen = {
    total_facturado: 0, total_pagado: 0, total_pendiente: 0,
    total_en_curso: 0, total_abonado: 0, total_recurrente_mensual: 0,
    servicios_total: movimientos.length, servicios_pagados: 0,
    servicios_pendientes: 0, servicios_en_curso: 0, servicios_abonados: 0,
    mensualidades_activas: 0, mensualidades_vencidas: 0, metodos_pago: [],
  };
  const metodos = new Map();

  for (const m of movimientos) {
    const monto  = toNumber(m.monto);
    const pagado = toNumber(m.monto_pagado);
    const saldo  = toNumber(m.saldo_pendiente);
    const estado = m.estado_cartera;

    if (estado !== 'EN_CURSO') resumen.total_facturado += monto;
    if (['PAGADO', 'MENSUALIDAD', 'ABONADO'].includes(estado)) {
      resumen.total_pagado += estado === 'MENSUALIDAD' ? monto : pagado;
    }
    if (['PAGADO', 'MENSUALIDAD'].includes(estado)) {
      resumen.servicios_pagados += 1;
      const key = m.metodo_pago || (estado === 'MENSUALIDAD' ? 'MENSUALIDAD' : 'SIN_METODO');
      const cur = metodos.get(key) || { metodo_pago: key, total: 0, cantidad: 0 };
      cur.total += estado === 'MENSUALIDAD' ? monto : pagado;
      cur.cantidad += 1;
      metodos.set(key, cur);
    } else if (estado === 'ABONADO') {
      resumen.total_abonado += pagado;
      resumen.total_pendiente += saldo;
      resumen.servicios_abonados += 1;
      resumen.servicios_pendientes += 1;
    } else if (estado === 'PENDIENTE') {
      resumen.total_pendiente += saldo || monto;
      resumen.servicios_pendientes += 1;
    } else {
      resumen.total_en_curso += monto;
      resumen.servicios_en_curso += 1;
    }
  }

  const hoy = new Date();
  for (const m of mensualidades) {
    const activa  = m.estado === 'ACTIVA';
    const inicio  = m.fecha_inicio ? new Date(m.fecha_inicio) : null;
    const fin     = m.fecha_fin    ? new Date(m.fecha_fin)    : null;
    const vigente = (!inicio || inicio <= hoy) && (!fin || fin >= hoy);
    if (activa && vigente) {
      resumen.mensualidades_activas += 1;
      resumen.total_recurrente_mensual += toNumber(m.valor_mensual);
    } else if (fin && fin < hoy) {
      resumen.mensualidades_vencidas += 1;
    }
  }

  resumen.metodos_pago = [...metodos.values()].sort((a, b) => b.total - a.total);
  return resumen;
}

async function obtenerCartera({ empresaId, clienteId, placa }) {
  await ensurePagosServiciosSchema();

  const params = [empresaId, clienteId || placa];
  const filtros = clienteId
    ? {
        parqueadero: 'COALESCE(p.cliente_id,v.cliente_id)=$2',
        lavadero:    'COALESCE(l.cliente_id,v.cliente_id)=$2',
        taller:      'COALESCE(t.cliente_id,v.cliente_id)=$2',
        mensualidad: 'mp.cliente_id=$2',
      }
    : {
        parqueadero: 'p.placa=$2',
        lavadero:    'l.placa=$2',
        taller:      't.placa=$2',
        mensualidad: 'mp.placa=$2',
      };

  const [{ rows: movimientosRaw }, { rows: mensualidadesRaw }] = await Promise.all([
    db.query(
      `SELECT * FROM (
         SELECT p.id::text AS referencia_id,'parqueadero' AS modulo,'Parqueadero' AS tipo,
                p.placa, COALESCE(p.hora_salida,p.hora_entrada,p.creado_en) AS fecha,
                COALESCE(p.valor_total,0) AS monto, p.metodo_pago AS metodo_pago_base,
                COALESCE(p.estado_pago,CASE WHEN p.hora_salida IS NULL THEN 'EN_CURSO' ELSE 'CERRADO' END) AS estado_original,
                p.tipo_servicio AS detalle, p.tipo_servicio,
                CASE WHEN p.hora_salida IS NOT NULL THEN TRUE ELSE FALSE END AS servicio_cerrado,
                CASE WHEN UPPER(COALESCE(p.estado_pago,'')) IN ('PAGADO','MENSUALIDAD')
                       OR NULLIF(TRIM(COALESCE(p.metodo_pago,'')),''::text) IS NOT NULL
                       OR COALESCE(p.valor_total,0)=0 THEN TRUE ELSE FALSE END AS legacy_paid,
                COALESCE(psp.total_pagado,0) AS total_pagado_registrado,
                COALESCE(psp.cantidad_pagos,0) AS cantidad_pagos,
                COALESCE(psp.metodos_distintos,0) AS metodos_distintos,
                psp.ultimo_metodo_pago, psp.ultimo_pago
         FROM parqueadero p LEFT JOIN vehiculos v ON v.id=p.vehiculo_id
         ${buildPagosServiciosJoin('parqueadero','p.id','psp')}
         WHERE p.empresa_id=$1 AND ${filtros.parqueadero}
         UNION ALL
         SELECT l.id::text,'lavadero','Lavadero', l.placa,
                COALESCE(l.hora_fin,l.hora_inicio,l.creado_en), COALESCE(l.precio,0),
                l.metodo_pago, l.estado, 'Servicio de lavado', NULL::varchar,
                CASE WHEN l.estado='Completado' THEN TRUE ELSE FALSE END,
                CASE WHEN NULLIF(TRIM(COALESCE(l.metodo_pago,'')),''::text) IS NOT NULL
                       OR COALESCE(l.precio,0)=0 THEN TRUE ELSE FALSE END,
                COALESCE(psl.total_pagado,0), COALESCE(psl.cantidad_pagos,0),
                COALESCE(psl.metodos_distintos,0), psl.ultimo_metodo_pago, psl.ultimo_pago
         FROM lavadero l LEFT JOIN vehiculos v ON v.id=l.vehiculo_id
         ${buildPagosServiciosJoin('lavadero','l.id','psl')}
         WHERE l.empresa_id=$1 AND ${filtros.lavadero}
         UNION ALL
         SELECT t.id::text,'taller','Taller', t.placa,
                COALESCE(t.fecha_entrega,t.fecha_creacion), COALESCE(t.total_orden,0),
                t.metodo_pago, t.estado, COALESCE(t.descripcion_falla,'Orden de taller'), NULL::varchar,
                CASE WHEN t.estado='Entregado' THEN TRUE ELSE FALSE END,
                CASE WHEN NULLIF(TRIM(COALESCE(t.metodo_pago,'')),''::text) IS NOT NULL
                       OR COALESCE(t.total_orden,0)=0 THEN TRUE ELSE FALSE END,
                COALESCE(pst.total_pagado,0), COALESCE(pst.cantidad_pagos,0),
                COALESCE(pst.metodos_distintos,0), pst.ultimo_metodo_pago, pst.ultimo_pago
         FROM taller_ordenes t LEFT JOIN vehiculos v ON v.id=t.vehiculo_id
         ${buildPagosServiciosJoin('taller','t.id','pst')}
         WHERE t.empresa_id=$1 AND ${filtros.taller}
       ) cartera ORDER BY fecha DESC NULLS LAST LIMIT 80`,
      params
    ),
    db.query(
      `SELECT mp.*,
              CASE WHEN mp.estado='ACTIVA' AND CURRENT_DATE BETWEEN mp.fecha_inicio AND mp.fecha_fin
                   THEN GREATEST(0,(mp.fecha_fin-CURRENT_DATE))::int ELSE NULL END AS dias_restantes
       FROM mensualidades_parqueadero mp
       WHERE mp.empresa_id=$1 AND ${filtros.mensualidad}
       ORDER BY CASE WHEN mp.estado='ACTIVA' AND CURRENT_DATE BETWEEN mp.fecha_inicio AND mp.fecha_fin THEN 0 ELSE 1 END,
                mp.fecha_fin DESC, mp.creado_en DESC`,
      params
    ),
  ]);

  const movimientos   = movimientosRaw.map(enriquecerMovimientoPago);
  const mensualidades = mensualidadesRaw.map((m) => ({ ...m, valor_mensual: toNumber(m.valor_mensual) }));
  const resumen       = resumirCartera(movimientos, mensualidades);

  return {
    resumen,
    movimientos,
    pendientes: movimientos.filter((m) => ['PENDIENTE','ABONADO'].includes(m.estado_cartera)),
    en_curso:   movimientos.filter((m) => m.estado_cartera === 'EN_CURSO'),
    pagos:      movimientos.filter((m) => ['PAGADO','MENSUALIDAD'].includes(m.estado_cartera)),
    mensualidades,
  };
}

async function obtenerEmpresaRecibo(empresaId) {
  const { rows } = await db.query(
    `SELECT id,nombre,nit,ciudad,direccion,telefono,email_contacto,logo_url
     FROM empresas WHERE id=$1 LIMIT 1`,
    [empresaId]
  );
  return rows[0] || { id: empresaId, nombre: 'AutoGestion360' };
}

function buildReceiptNumber(prefix, value) {
  return `AG360-${prefix}-${String(value || Date.now()).toUpperCase()}`;
}

function buildReceiptPayload({ tipo, numero, empresa, sujeto, resumen, movimientos, servicio = null }) {
  return { tipo, numero, generado_en: new Date().toISOString(), empresa, sujeto, resumen, movimientos, servicio };
}

async function cartaCliente(empresaId, clienteId) {
  const { rows } = await db.query(
    `SELECT id,nombre,documento,telefono,correo FROM clientes WHERE id=$1 AND empresa_id=$2 LIMIT 1`,
    [clienteId, empresaId]
  );
  if (!rows.length) throw new AppError('Cliente no encontrado.', 404);
  return { cliente: rows[0], ...(await obtenerCartera({ empresaId, clienteId })) };
}

async function cartaVehiculo(empresaId, placa) {
  const p = normalizarPlaca(placa);
  if (!p) throw new AppError('Debe enviar una placa.', 400);
  return { placa: p, ...(await obtenerCartera({ empresaId, placa: p })) };
}

async function reciboServicio(empresaId, modulo, id) {
  if (!['parqueadero','lavadero','taller'].includes(modulo)) {
    throw new AppError('Módulo inválido para comprobante.', 400);
  }
  const [empresa, servicioRaw] = await Promise.all([
    obtenerEmpresaRecibo(empresaId),
    obtenerServicioRecibo(empresaId, modulo, id),
  ]);
  if (!servicioRaw) throw new AppError('Servicio no encontrado.', 404);

  const servicio = { ...servicioRaw, monto: toNumber(servicioRaw.monto) };
  const resumen  = resumirCartera([servicio], []);
  const sujeto   = {
    tipo: 'servicio', titulo: `${servicio.tipo} ${servicio.referencia_id}`,
    nombre: servicio.cliente_nombre || 'Cliente no registrado',
    documento: servicio.cliente_documento || null, telefono: servicio.cliente_telefono || null,
    correo: servicio.cliente_correo || null, placa: servicio.placa,
  };
  return buildReceiptPayload({ tipo: 'servicio', numero: buildReceiptNumber(modulo, servicio.referencia_id),
    empresa, sujeto, resumen, movimientos: [servicio], servicio });
}

async function reciboCliente(empresaId, clienteId) {
  const { rows } = await db.query(
    `SELECT id,nombre,documento,telefono,correo FROM clientes WHERE id=$1 AND empresa_id=$2 LIMIT 1`,
    [clienteId, empresaId]
  );
  if (!rows.length) throw new AppError('Cliente no encontrado.', 404);
  const [empresa, cartera] = await Promise.all([
    obtenerEmpresaRecibo(empresaId),
    obtenerCartera({ empresaId, clienteId }),
  ]);
  const cliente = rows[0];
  return buildReceiptPayload({
    tipo: 'cliente', numero: buildReceiptNumber('CLIENTE', cliente.id), empresa,
    sujeto: { tipo: 'cliente', titulo: 'Estado de cuenta de cliente',
              nombre: cliente.nombre, documento: cliente.documento,
              telefono: cliente.telefono, correo: cliente.correo },
    resumen: cartera.resumen, movimientos: cartera.movimientos,
  });
}

async function reciboVehiculo(empresaId, placa) {
  const p = normalizarPlaca(placa);
  if (!p) throw new AppError('Debe enviar una placa.', 400);
  const [{ rows: vehiculoRows }, empresa, cartera] = await Promise.all([
    db.query(
      `SELECT v.id,v.placa,v.tipo_vehiculo,v.marca,v.modelo,v.color,
              c.nombre AS cliente_nombre, c.documento AS cliente_documento,
              c.telefono AS cliente_telefono, c.correo AS cliente_correo
       FROM vehiculos v LEFT JOIN clientes c ON c.id=v.cliente_id
       WHERE v.empresa_id=$1 AND v.placa=$2 LIMIT 1`,
      [empresaId, p]
    ),
    obtenerEmpresaRecibo(empresaId),
    obtenerCartera({ empresaId, placa: p }),
  ]);
  const vehiculo = vehiculoRows[0] || { placa: p };
  return buildReceiptPayload({
    tipo: 'vehiculo', numero: buildReceiptNumber('VEHICULO', p), empresa,
    sujeto: {
      tipo: 'vehiculo', titulo: 'Estado de cuenta de vehículo',
      nombre: vehiculo.cliente_nombre || 'Cliente no registrado',
      documento: vehiculo.cliente_documento || null, telefono: vehiculo.cliente_telefono || null,
      correo: vehiculo.cliente_correo || null, placa: p,
      vehiculo: [vehiculo.tipo_vehiculo, vehiculo.marca, vehiculo.modelo, vehiculo.color].filter(Boolean).join(' · '),
    },
    resumen: cartera.resumen, movimientos: cartera.movimientos,
  });
}

async function detalleServicio(empresaId, modulo, referenciaId) {
  const mod = normalizarModulo(modulo);
  if (!mod) throw new AppError('Módulo inválido.', 400);
  if (!referenciaId) throw new AppError('Referencia inválida.', 400);

  await ensurePagosServiciosSchema();
  const servicio = await obtenerServicioRecibo(empresaId, mod, referenciaId);
  if (!servicio) throw new AppError('Servicio no encontrado.', 404);

  const { rows: pagos } = await db.query(
    `SELECT id,modulo,referencia_id,monto,metodo_pago,referencia_transaccion,
            detalle_pago,estado,fecha_pago
     FROM pagos_servicios
     WHERE empresa_id=$1 AND modulo=$2 AND referencia_id=$3 AND estado='APLICADO'
     ORDER BY fecha_pago DESC, id DESC`,
    [empresaId, mod, referenciaId]
  );
  return { ...servicio, pagos: pagos.map((r) => ({ ...r, monto: toNumber(r.monto) })) };
}

async function registrarPagoGenerico(empresaId, usuarioId, body) {
  const { modulo, referencia_id, monto, metodo_pago, referencia_transaccion, detalle_pago } = body || {};

  return withTransaction(async (client) => {
    await ensurePagosServiciosSchema(client);
    const resultado = await registrarPagoServicio({
      queryable: client, empresaId, usuarioId, modulo,
      referenciaId: referencia_id, monto, metodoPago: metodo_pago,
      referenciaTransaccion: referencia_transaccion, detallePago: detalle_pago,
    });
    return resultado;
  });
}

async function registrarPagoParqueadero(empresaId, usuarioId, body) {
  const { parqueadero_id, monto, metodo_pago, referencia_transaccion, detalle_pago } = body || {};

  return withTransaction(async (client) => {
    await ensurePagosServiciosSchema(client);
    return registrarPagoServicio({
      queryable: client, empresaId, usuarioId,
      modulo: 'parqueadero', referenciaId: parqueadero_id,
      monto, metodoPago: metodo_pago,
      referenciaTransaccion: referencia_transaccion, detallePago: detalle_pago,
    });
  });
}

async function pagosPorParqueadero(empresaId, parqueaderoId) {
  await ensurePagosServiciosSchema();
  const { rows } = await db.query(
    `SELECT id,empresa_id,referencia_id AS parqueadero_id,monto,metodo_pago,
            referencia_transaccion,estado,usuario_registro_id,fecha_pago,creado_en
     FROM pagos_servicios
     WHERE empresa_id=$1 AND modulo='parqueadero' AND referencia_id=$2 AND estado='APLICADO'
     ORDER BY fecha_pago DESC, id DESC`,
    [empresaId, parqueaderoId]
  );
  return rows.map((r) => ({ ...r, monto: toNumber(r.monto) }));
}

async function pendientesListado(empresaId) {
  await ensurePagosServiciosSchema();
  const { rows } = await db.query(
    `SELECT p.id,p.placa,p.tipo_vehiculo,p.hora_entrada,p.hora_salida,
            COALESCE(p.valor_total,0) AS monto,p.estado_pago,c.nombre AS nombre_cliente
     FROM parqueadero p
     LEFT JOIN clientes c ON c.id=p.cliente_id
     LEFT JOIN pagos_servicios ps ON ps.empresa_id=p.empresa_id
       AND ps.modulo='parqueadero' AND ps.referencia_id=p.id AND ps.estado='APLICADO'
     WHERE p.empresa_id=$1
       AND p.hora_salida IS NOT NULL
       AND ps.id IS NULL
       AND COALESCE(p.valor_total,0)>0
       AND COALESCE(p.estado_pago,'') NOT IN ('PAGADO','MENSUALIDAD')
     ORDER BY p.hora_salida DESC LIMIT 100`,
    [empresaId]
  );
  return rows;
}

module.exports = {
  cartaCliente, cartaVehiculo,
  reciboServicio, reciboCliente, reciboVehiculo,
  detalleServicio,
  registrarPagoGenerico, registrarPagoParqueadero,
  pagosPorParqueadero, pendientesListado,
};
