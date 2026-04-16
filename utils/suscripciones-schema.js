const db = require("../db");
const { ensureLicenciasSchema } = require("./licencias-schema");

const ESTADOS_SUSCRIPCION = ["TRIAL", "ACTIVA", "VENCIDA", "SUSPENDIDA", "CANCELADA"];
const ESTADOS_FACTURA_SAAS = ["PENDIENTE", "PAGADA", "VENCIDA", "ANULADA"];
const PASARELAS_SAAS = ["MANUAL", "STRIPE", "WOMPI", "MERCADOPAGO", "PAYU", "OTRO"];

let schemaReady = false;

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
  if (schemaReady && queryable === db) return;

  await ensureLicenciasSchema(queryable);

  await queryable.query(`
    CREATE TABLE IF NOT EXISTS suscripciones_empresa (
      id BIGSERIAL PRIMARY KEY,
      empresa_id BIGINT NOT NULL UNIQUE REFERENCES empresas(id) ON DELETE CASCADE,
      licencia_id INTEGER REFERENCES licencias(id) ON DELETE SET NULL,
      estado VARCHAR(20) NOT NULL DEFAULT 'TRIAL',
      fecha_inicio TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      fecha_fin TIMESTAMPTZ,
      renovacion_automatica BOOLEAN NOT NULL DEFAULT FALSE,
      pasarela VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
      referencia_externa VARCHAR(150),
      observaciones TEXT,
      moneda VARCHAR(10) NOT NULL DEFAULT 'COP',
      precio_plan NUMERIC(12,2) NOT NULL DEFAULT 0,
      metadata JSONB,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await queryable.query(`
    CREATE INDEX IF NOT EXISTS suscripciones_empresa_estado_idx
    ON suscripciones_empresa (estado, fecha_fin)
  `);

  await queryable.query(`
    CREATE INDEX IF NOT EXISTS suscripciones_empresa_licencia_idx
    ON suscripciones_empresa (licencia_id)
  `);

  await queryable.query(`
    CREATE TABLE IF NOT EXISTS facturas_saas (
      id BIGSERIAL PRIMARY KEY,
      suscripcion_id BIGINT REFERENCES suscripciones_empresa(id) ON DELETE SET NULL,
      empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      licencia_id INTEGER REFERENCES licencias(id) ON DELETE SET NULL,
      numero_factura VARCHAR(60) NOT NULL UNIQUE,
      concepto VARCHAR(160) NOT NULL,
      periodo_inicio DATE,
      periodo_fin DATE,
      subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
      impuestos NUMERIC(12,2) NOT NULL DEFAULT 0,
      total NUMERIC(12,2) NOT NULL DEFAULT 0,
      moneda VARCHAR(10) NOT NULL DEFAULT 'COP',
      estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
      fecha_emision DATE NOT NULL DEFAULT CURRENT_DATE,
      fecha_vencimiento DATE,
      fecha_pago TIMESTAMPTZ,
      metodo_pago VARCHAR(40),
      referencia_pago VARCHAR(150),
      pasarela VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
      metadata JSONB,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await queryable.query(`
    CREATE INDEX IF NOT EXISTS facturas_saas_empresa_idx
    ON facturas_saas (empresa_id, fecha_emision DESC)
  `);

  await queryable.query(`
    CREATE INDEX IF NOT EXISTS facturas_saas_estado_idx
    ON facturas_saas (estado, fecha_vencimiento)
  `);

  await queryable.query(`
    INSERT INTO suscripciones_empresa (
      empresa_id, licencia_id, estado, fecha_inicio, fecha_fin,
      renovacion_automatica, pasarela, moneda, precio_plan, observaciones
    )
    SELECT
      e.id,
      COALESCE(el.licencia_id, e.licencia_id),
      CASE
        WHEN e.activa = FALSE THEN 'SUSPENDIDA'
        WHEN COALESCE(el.fecha_fin, e.licencia_fin) IS NOT NULL
          AND COALESCE(el.fecha_fin, e.licencia_fin) < NOW() THEN 'VENCIDA'
        WHEN LOWER(COALESCE(l.nombre, e.licencia_tipo, 'Demo')) = 'demo' THEN 'TRIAL'
        ELSE 'ACTIVA'
      END,
      COALESCE(el.fecha_inicio, e.licencia_inicio, NOW()),
      COALESCE(el.fecha_fin, e.licencia_fin),
      FALSE,
      'MANUAL',
      'COP',
      COALESCE(l.precio, 0),
      'Migrada desde la configuracion de licencias existente'
    FROM empresas e
    LEFT JOIN empresa_licencia el
      ON el.empresa_id = e.id
     AND el.activa = TRUE
    LEFT JOIN licencias l
      ON l.id = COALESCE(el.licencia_id, e.licencia_id)
    ON CONFLICT (empresa_id) DO NOTHING
  `);

  if (queryable === db) schemaReady = true;
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
