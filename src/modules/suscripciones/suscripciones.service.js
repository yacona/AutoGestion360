const db = require('../../../db');
const withTransaction = require('../../lib/withTransaction');
const AppError = require('../../lib/AppError');
const {
  ensureSuscripcionesSchema,
  getFacturasSaasEmpresa,
  getSuscripcionEmpresa,
  normalizeGateway,
  normalizeInvoiceStatus,
  normalizeSubscriptionStatus,
  registrarFacturaSaas,
  resolveSubscriptionStatus,
  toNumber,
  upsertSuscripcionEmpresa,
} = require('../../../utils/suscripciones-schema');

async function _getAllSuscripciones() {
  await ensureSuscripcionesSchema();
  const { rows } = await db.query(
    `SELECT
       s.*,
       e.nombre AS empresa_nombre,
       e.email_contacto,
       e.ciudad,
       e.activa AS empresa_activa,
       l.nombre AS licencia_nombre,
       l.descripcion AS licencia_descripcion,
       l.precio AS licencia_precio
     FROM suscripciones_empresa s
     JOIN empresas e ON e.id = s.empresa_id
     LEFT JOIN licencias l ON l.id = s.licencia_id
     ORDER BY e.nombre ASC`
  );
  return rows.map((row) => ({
    ...row,
    precio_plan: toNumber(row.precio_plan),
    licencia_precio: row.licencia_precio === null ? null : toNumber(row.licencia_precio),
    estado_real: resolveSubscriptionStatus(row),
  }));
}

async function resumen() {
  const suscripciones = await _getAllSuscripciones();
  const result = { total: suscripciones.length, trial: 0, activas: 0, vencidas: 0, suspendidas: 0, canceladas: 0, mrr: 0, arr: 0 };
  for (const s of suscripciones) {
    const estado = s.estado_real;
    if (estado === 'TRIAL')     result.trial      += 1;
    if (estado === 'ACTIVA')    result.activas     += 1;
    if (estado === 'VENCIDA')   result.vencidas    += 1;
    if (estado === 'SUSPENDIDA') result.suspendidas += 1;
    if (estado === 'CANCELADA') result.canceladas  += 1;
    if (['TRIAL', 'ACTIVA'].includes(estado)) result.mrr += toNumber(s.precio_plan);
  }
  result.arr = result.mrr * 12;
  return result;
}

async function listar({ estado, empresa_id }) {
  let rows = await _getAllSuscripciones();
  const estadoFiltro = normalizeSubscriptionStatus(estado, '');
  const empId = Number(empresa_id || 0);
  if (empId)       rows = rows.filter((s) => Number(s.empresa_id) === empId);
  if (estadoFiltro) rows = rows.filter((s) => s.estado_real === estadoFiltro);
  return rows;
}

async function obtenerSuscripcion(empresaId) {
  const s = await getSuscripcionEmpresa(db, empresaId);
  if (!s) throw new AppError('No hay suscripcion registrada para esta empresa.', 404);
  const facturas = await getFacturasSaasEmpresa(db, empresaId, 10);
  return { ...s, facturas };
}

async function listarFacturas(empresaId, limit) {
  return getFacturasSaasEmpresa(db, empresaId, Number(limit || 20));
}

async function crearFactura(empresaId, body) {
  const suscripcion = await getSuscripcionEmpresa(db, empresaId);
  return registrarFacturaSaas({
    empresaId,
    licenciaId:       body.licencia_id || suscripcion?.licencia_id || null,
    suscripcionId:    suscripcion?.id || null,
    numeroFactura:    body.numero_factura || null,
    concepto:         body.concepto || 'Cobro de suscripcion SaaS',
    periodoInicio:    body.periodo_inicio || null,
    periodoFin:       body.periodo_fin || null,
    subtotal:         body.subtotal || body.total || 0,
    impuestos:        body.impuestos || 0,
    total:            body.total || null,
    moneda:           body.moneda || 'COP',
    estado:           normalizeInvoiceStatus(body.estado, 'PENDIENTE'),
    fechaEmision:     body.fecha_emision || null,
    fechaVencimiento: body.fecha_vencimiento || null,
    fechaPago:        body.fecha_pago || null,
    metodoPago:       body.metodo_pago || null,
    referenciaPago:   body.referencia_pago || null,
    pasarela:         normalizeGateway(body.pasarela, suscripcion?.pasarela || 'MANUAL'),
    metadata:         body.metadata || null,
  });
}

async function upsert(body) {
  const empresaId  = Number(body.empresa_id || 0);
  const licenciaId = Number(body.licencia_id || 0);
  if (!empresaId || !licenciaId) throw new AppError('empresa_id y licencia_id son requeridos.', 400);
  return upsertSuscripcionEmpresa({
    empresaId,
    licenciaId,
    estado:              body.estado || 'ACTIVA',
    fechaInicio:         body.fecha_inicio || null,
    fechaFin:            body.fecha_fin || null,
    renovacionAutomatica: body.renovacion_automatica === true,
    pasarela:            body.pasarela || 'MANUAL',
    referenciaExterna:   body.referencia_externa || null,
    observaciones:       body.observaciones || null,
    moneda:              body.moneda || 'COP',
    precioPlan:          body.precio_plan,
    metadata:            body.metadata || null,
  });
}

async function renovar(empresaId, body) {
  const actual = await getSuscripcionEmpresa(db, empresaId);
  if (!actual) throw new AppError('No hay suscripcion para renovar.', 404);

  const dias = Math.max(1, Number(body.dias || 30));
  const baseDate = actual.fecha_fin && new Date(actual.fecha_fin) > new Date()
    ? new Date(actual.fecha_fin)
    : new Date();
  const nuevaFechaFin = new Date(baseDate);
  nuevaFechaFin.setDate(nuevaFechaFin.getDate() + dias);

  return withTransaction(async (client) => {
    const suscripcion = await upsertSuscripcionEmpresa({
      queryable:           client,
      empresaId,
      licenciaId:          body.licencia_id || actual.licencia_id,
      estado:              'ACTIVA',
      fechaInicio:         actual.fecha_inicio || new Date(),
      fechaFin:            nuevaFechaFin,
      renovacionAutomatica: body.renovacion_automatica === true
        ? true
        : Boolean(actual.renovacion_automatica),
      pasarela:            body.pasarela || actual.pasarela || 'MANUAL',
      referenciaExterna:   body.referencia_externa || actual.referencia_externa || null,
      observaciones:       body.observaciones || actual.observaciones || null,
      moneda:              body.moneda || actual.moneda || 'COP',
      precioPlan:          body.precio_plan ?? actual.precio_plan,
    });

    let factura = null;
    if (body.generar_factura !== false) {
      factura = await registrarFacturaSaas({
        queryable:        client,
        empresaId,
        licenciaId:       suscripcion.licencia_id,
        suscripcionId:    suscripcion.id,
        concepto:         body.concepto || `Renovacion ${suscripcion.licencia_nombre || 'plan SaaS'} (${dias} dias)`,
        periodoInicio:    actual.fecha_fin || new Date(),
        periodoFin:       nuevaFechaFin,
        subtotal:         body.total || suscripcion.precio_plan || 0,
        impuestos:        body.impuestos || 0,
        total:            body.total || suscripcion.precio_plan || 0,
        moneda:           suscripcion.moneda || 'COP',
        estado:           body.estado_factura || 'PAGADA',
        fechaVencimiento: body.fecha_vencimiento || null,
        fechaPago:        normalizeInvoiceStatus(body.estado_factura || 'PAGADA', 'PAGADA') === 'PAGADA'
          ? (body.fecha_pago || new Date())
          : null,
        metodoPago:       body.metodo_pago || null,
        referenciaPago:   body.referencia_pago || null,
        pasarela:         body.pasarela || suscripcion.pasarela || 'MANUAL',
      });
    }

    return { suscripcion, factura };
  });
}

async function cambiarEstado(empresaId, body) {
  const actual = await getSuscripcionEmpresa(db, empresaId);
  if (!actual) throw new AppError('No hay suscripcion para actualizar.', 404);

  const estado = normalizeSubscriptionStatus(body.estado, '');
  if (!estado) throw new AppError('Debe enviar un estado valido.', 400);

  return upsertSuscripcionEmpresa({
    empresaId,
    licenciaId:          actual.licencia_id,
    estado,
    fechaInicio:         actual.fecha_inicio,
    fechaFin:            body.fecha_fin || actual.fecha_fin,
    renovacionAutomatica: actual.renovacion_automatica,
    pasarela:            actual.pasarela,
    referenciaExterna:   actual.referencia_externa,
    observaciones:       body.observaciones || actual.observaciones,
    moneda:              actual.moneda || 'COP',
    precioPlan:          actual.precio_plan,
  });
}

module.exports = { resumen, listar, obtenerSuscripcion, listarFacturas, crearFactura, upsert, renovar, cambiarEstado };
