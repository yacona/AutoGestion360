const db = require("../db");
const { ensureLicenciasSchema } = require("./licencias-schema");
const { syncSaasSubscriptionFromLegacy } = require("../services/saasCompatibilityService");

// Compatibilidad transicional: este helper ya no crea tablas en runtime.
// Si la estructura legacy de suscripciones no existe, debe aplicarse
// database/003_runtime_cleanup.sql.

const ESTADOS_SUSCRIPCION = ["TRIAL", "ACTIVA", "VENCIDA", "SUSPENDIDA", "CANCELADA"];
const ESTADOS_FACTURA_SAAS = ["PENDIENTE", "PAGADA", "VENCIDA", "ANULADA"];
const PASARELAS_SAAS = ["MANUAL", "STRIPE", "WOMPI", "MERCADOPAGO", "PAYU", "OTRO"];

let schemaReady = false;

const REQUIRED_TABLES = [
  "suscripciones_empresa",
  "facturas_saas",
];

async function findMissingTables(queryable, tables) {
  const { rows } = await queryable.query(
    `SELECT item AS nombre
     FROM unnest($1::text[]) AS item
     WHERE to_regclass(item) IS NULL`,
    [tables]
  );
  return rows.map((row) => row.nombre);
}

function toNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeSubscriptionStatus(value, fallback = "TRIAL") {
  const status = normalizeUpper(value);
  return ESTADOS_SUSCRIPCION.includes(status) ? status : fallback;
}

function normalizeInvoiceStatus(value, fallback = "PENDIENTE") {
  const status = normalizeUpper(value);
  return ESTADOS_FACTURA_SAAS.includes(status) ? status : fallback;
}

function normalizeGateway(value, fallback = "MANUAL") {
  const gateway = normalizeUpper(value);
  return PASARELAS_SAAS.includes(gateway) ? gateway : fallback;
}

function resolveSubscriptionStatus(subscription = {}) {
  const currentStatus = normalizeSubscriptionStatus(subscription.estado, "TRIAL");
  const now = new Date();
  const endDate = subscription.fecha_fin ? new Date(subscription.fecha_fin) : null;

  if (currentStatus === "CANCELADA") return "CANCELADA";
  if (currentStatus === "SUSPENDIDA") return "SUSPENDIDA";
  if (!subscription.empresa_activa) return "SUSPENDIDA";
  if (endDate && now > endDate) return "VENCIDA";
  return currentStatus;
}

async function ensureSuscripcionesSchema(queryable = db) {
  if (schemaReady && queryable === db) {
    return { ok: true, missingTables: [] };
  }

  await ensureLicenciasSchema(queryable);

  const missingTables = await findMissingTables(queryable, REQUIRED_TABLES);
  if (missingTables.length > 0) {
    const error = new Error(
      `Esquema de suscripciones legacy no disponible (tablas faltantes: ${missingTables.join(", ")}). Ejecuta database/003_runtime_cleanup.sql antes de usar compatibilidad transicional.`
    );
    error.code = "SCHEMA_NOT_READY";
    error.status = 500;
    error.migration = "database/003_runtime_cleanup.sql";
    throw error;
  }

  if (queryable === db) {
    schemaReady = true;
  }

  return { ok: true, missingTables: [] };
}

async function getSuscripcionEmpresa(queryable, empresaId) {
  await ensureSuscripcionesSchema(queryable);

  const { rows } = await queryable.query(
    `SELECT
       s.*,
       e.nombre AS empresa_nombre,
       e.activa AS empresa_activa,
       l.nombre AS licencia_nombre,
       l.descripcion AS licencia_descripcion,
       l.precio AS licencia_precio
     FROM suscripciones_empresa s
     JOIN empresas e ON e.id = s.empresa_id
     LEFT JOIN licencias l ON l.id = s.licencia_id
     WHERE s.empresa_id = $1
     LIMIT 1`,
    [empresaId]
  );

  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    ...row,
    precio_plan: toNumber(row.precio_plan),
    licencia_precio: row.licencia_precio === null ? null : toNumber(row.licencia_precio),
    estado_real: resolveSubscriptionStatus(row),
  };
}

async function upsertSuscripcionEmpresa({
  queryable = db,
  empresaId,
  licenciaId,
  estado = "ACTIVA",
  fechaInicio = null,
  fechaFin = null,
  renovacionAutomatica = false,
  pasarela = "MANUAL",
  referenciaExterna = null,
  observaciones = null,
  moneda = "COP",
  precioPlan = null,
  metadata = null,
  skipOfficialSync = false,
}) {
  await ensureSuscripcionesSchema(queryable);

  const empresaIdNum = Number(empresaId || 0);
  const licenciaIdNum = Number(licenciaId || 0);
  const estadoNormalizado = normalizeSubscriptionStatus(estado, "ACTIVA");
  const pasarelaNormalizada = normalizeGateway(pasarela, "MANUAL");

  if (!empresaIdNum || !licenciaIdNum) {
    const error = new Error("Debe indicar empresa y licencia para la suscripcion.");
    error.status = 400;
    throw error;
  }

  const { rows: licencias } = await queryable.query(
    `SELECT id, nombre, precio
     FROM licencias
     WHERE id = $1
     LIMIT 1`,
    [licenciaIdNum]
  );

  if (licencias.length === 0) {
    const error = new Error("La licencia seleccionada no existe.");
    error.status = 404;
    throw error;
  }

  const licencia = licencias[0];
  const precioFinal = precioPlan === null || precioPlan === undefined
    ? toNumber(licencia.precio)
    : toNumber(precioPlan);

  await queryable.query(
    `INSERT INTO suscripciones_empresa (
       empresa_id, licencia_id, estado, fecha_inicio, fecha_fin, renovacion_automatica,
       pasarela, referencia_externa, observaciones, moneda, precio_plan, metadata, actualizado_en
     )
     VALUES ($1, $2, $3, COALESCE($4, NOW()), $5, $6, $7, $8, $9, $10, $11, $12::jsonb, NOW())
     ON CONFLICT (empresa_id) DO UPDATE
     SET licencia_id = EXCLUDED.licencia_id,
         estado = EXCLUDED.estado,
         fecha_inicio = EXCLUDED.fecha_inicio,
         fecha_fin = EXCLUDED.fecha_fin,
         renovacion_automatica = EXCLUDED.renovacion_automatica,
         pasarela = EXCLUDED.pasarela,
         referencia_externa = EXCLUDED.referencia_externa,
         observaciones = EXCLUDED.observaciones,
         moneda = EXCLUDED.moneda,
         precio_plan = EXCLUDED.precio_plan,
         metadata = EXCLUDED.metadata,
         actualizado_en = NOW()`,
    [
      empresaIdNum,
      licenciaIdNum,
      estadoNormalizado,
      fechaInicio || null,
      fechaFin || null,
      Boolean(renovacionAutomatica),
      pasarelaNormalizada,
      referenciaExterna || null,
      observaciones || null,
      moneda || "COP",
      precioFinal,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );

  await queryable.query(
    `INSERT INTO empresa_licencia (empresa_id, licencia_id, fecha_inicio, fecha_fin, activa)
     VALUES ($1, $2, COALESCE($3, NOW()), $4, TRUE)
     ON CONFLICT (empresa_id) DO UPDATE
     SET licencia_id = EXCLUDED.licencia_id,
         fecha_inicio = EXCLUDED.fecha_inicio,
         fecha_fin = EXCLUDED.fecha_fin,
         activa = TRUE,
         creado_en = NOW()`,
    [empresaIdNum, licenciaIdNum, fechaInicio || null, fechaFin || null]
  );

  await queryable.query(
    `UPDATE empresas
     SET licencia_id = $1,
         licencia_tipo = $2,
         licencia_inicio = COALESCE($3, NOW()),
         licencia_fin = $4
     WHERE id = $5`,
    [licenciaIdNum, licencia.nombre, fechaInicio || null, fechaFin || null, empresaIdNum]
  );

  if (!skipOfficialSync) {
    await syncSaasSubscriptionFromLegacy({
      queryable,
      empresaId: empresaIdNum,
      licenciaId: licenciaIdNum,
      licenciaNombre: licencia.nombre,
      estado: estadoNormalizado,
      fechaInicio: fechaInicio || null,
      fechaFin: fechaFin || null,
      renovacionAutomatica: Boolean(renovacionAutomatica),
      pasarela: pasarelaNormalizada,
      precioPactado: precioFinal,
      moneda: moneda || "COP",
      observaciones: "Sincronizada desde suscripciones_empresa",
      metadata,
    });
  }

  return getSuscripcionEmpresa(queryable, empresaIdNum);
}

function buildInvoiceNumber() {
  return `SAAS-${Date.now()}`;
}

async function registrarFacturaSaas({
  queryable = db,
  empresaId,
  licenciaId = null,
  suscripcionId = null,
  numeroFactura = null,
  concepto,
  periodoInicio = null,
  periodoFin = null,
  subtotal = 0,
  impuestos = 0,
  total = null,
  moneda = "COP",
  estado = "PENDIENTE",
  fechaEmision = null,
  fechaVencimiento = null,
  fechaPago = null,
  metodoPago = null,
  referenciaPago = null,
  pasarela = "MANUAL",
  metadata = null,
}) {
  await ensureSuscripcionesSchema(queryable);

  const empresaIdNum = Number(empresaId || 0);
  if (!empresaIdNum || !concepto) {
    const error = new Error("Debe indicar empresa y concepto para la factura.");
    error.status = 400;
    throw error;
  }

  const subtotalNum = toNumber(subtotal);
  const impuestosNum = toNumber(impuestos);
  const totalNum = total === null || total === undefined ? subtotalNum + impuestosNum : toNumber(total);

  const { rows } = await queryable.query(
    `INSERT INTO facturas_saas (
       suscripcion_id, empresa_id, licencia_id, numero_factura, concepto,
       periodo_inicio, periodo_fin, subtotal, impuestos, total, moneda,
       estado, fecha_emision, fecha_vencimiento, fecha_pago, metodo_pago,
       referencia_pago, pasarela, metadata, actualizado_en
     )
     VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9, $10, $11,
       $12, COALESCE($13, CURRENT_DATE), $14, $15, $16,
       $17, $18, $19::jsonb, NOW()
     )
     RETURNING *`,
    [
      suscripcionId || null,
      empresaIdNum,
      licenciaId || null,
      numeroFactura || buildInvoiceNumber(),
      concepto,
      periodoInicio || null,
      periodoFin || null,
      subtotalNum,
      impuestosNum,
      totalNum,
      moneda || "COP",
      normalizeInvoiceStatus(estado, "PENDIENTE"),
      fechaEmision || null,
      fechaVencimiento || null,
      fechaPago || null,
      metodoPago || null,
      referenciaPago || null,
      normalizeGateway(pasarela, "MANUAL"),
      metadata ? JSON.stringify(metadata) : null,
    ]
  );

  return {
    ...rows[0],
    subtotal: toNumber(rows[0].subtotal),
    impuestos: toNumber(rows[0].impuestos),
    total: toNumber(rows[0].total),
  };
}

async function getFacturasSaasEmpresa(queryable, empresaId, limit = 20) {
  await ensureSuscripcionesSchema(queryable);

  const { rows } = await queryable.query(
    `SELECT
       f.*,
       l.nombre AS licencia_nombre
     FROM facturas_saas f
     LEFT JOIN licencias l ON l.id = f.licencia_id
     WHERE f.empresa_id = $1
     ORDER BY f.fecha_emision DESC, f.id DESC
     LIMIT $2`,
    [empresaId, limit]
  );

  return rows.map((row) => ({
    ...row,
    subtotal: toNumber(row.subtotal),
    impuestos: toNumber(row.impuestos),
    total: toNumber(row.total),
  }));
}

module.exports = {
  ESTADOS_FACTURA_SAAS,
  ESTADOS_SUSCRIPCION,
  PASARELAS_SAAS,
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
};
