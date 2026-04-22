'use strict';

const db = require('../db');

const VALID_SUBSCRIPTION_STATES = new Set([
  'TRIAL',
  'ACTIVA',
  'VENCIDA',
  'SUSPENDIDA',
  'CANCELADA',
]);

const PLAN_CODE_BY_LEGACY_LICENSE = {
  demo: 'starter',
  basica: 'starter',
  basic: 'starter',
  starter: 'starter',
  pro: 'pro',
  premium: 'enterprise',
  enterprise: 'enterprise',
};

const LEGACY_LICENSE_PREFERENCE_BY_PLAN = {
  starter: ['basica', 'demo'],
  pro: ['pro'],
  enterprise: ['premium'],
};

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function normalizeSubscriptionState(value, fallback = 'ACTIVA') {
  const state = String(value || '').trim().toUpperCase();
  return VALID_SUBSCRIPTION_STATES.has(state) ? state : fallback;
}

function resolvePlanCodeFromLegacyLicenseName(licenciaNombre) {
  const normalized = normalizeText(licenciaNombre);

  if (normalized.includes('premium')) return 'enterprise';
  if (normalized.includes('enterprise')) return 'enterprise';
  if (normalized.includes('pro')) return 'pro';

  return PLAN_CODE_BY_LEGACY_LICENSE[normalized] || 'starter';
}

function buildTrialUntil({ estado, fechaInicio, fechaFin, trialDias }) {
  if (estado !== 'TRIAL') return null;
  if (fechaFin) return fechaFin;

  const days = Number(trialDias || 0);
  if (!Number.isFinite(days) || days <= 0) return null;

  const baseDate = fechaInicio ? new Date(fechaInicio) : new Date();
  baseDate.setDate(baseDate.getDate() + days);
  return baseDate;
}

async function loadLicenciasCatalog(queryable = db) {
  const { rows } = await queryable.query(
    'SELECT id, nombre, precio FROM licencias ORDER BY id ASC'
  );
  return rows;
}

async function resolvePlanRow(queryable, planCode) {
  const { rows } = await queryable.query(
    `SELECT *
     FROM planes
     WHERE codigo = $1
     ORDER BY activo DESC, id ASC
     LIMIT 1`,
    [planCode]
  );

  if (rows.length > 0) return rows[0];

  const fallback = await queryable.query(
    `SELECT *
     FROM planes
     WHERE codigo = 'starter'
     ORDER BY activo DESC, id ASC
     LIMIT 1`
  );

  if (fallback.rows.length === 0) {
    const error = new Error('No existe un plan SaaS base para sincronizar compatibilidad.');
    error.code = 'SAAS_PLAN_NOT_FOUND';
    error.status = 500;
    throw error;
  }

  return fallback.rows[0];
}

async function resolveLegacyLicenseRow(queryable, planCode) {
  const catalog = await loadLicenciasCatalog(queryable);
  if (catalog.length === 0) {
    const error = new Error('No existe catalogo legacy de licencias para sincronizar compatibilidad.');
    error.code = 'LEGACY_LICENSE_NOT_FOUND';
    error.status = 500;
    throw error;
  }

  const preferredNames = LEGACY_LICENSE_PREFERENCE_BY_PLAN[planCode] || [];
  for (const preferredName of preferredNames) {
    const found = catalog.find((licencia) => normalizeText(licencia.nombre) === preferredName);
    if (found) return found;
  }

  return catalog[0];
}

async function resolvePlanFromLegacyLicense(queryable, { licenciaId = null, licenciaNombre = null } = {}) {
  let resolvedLicenseName = licenciaNombre;

  if (!resolvedLicenseName && licenciaId) {
    const { rows } = await queryable.query(
      `SELECT id, nombre, precio
       FROM licencias
       WHERE id = $1
       LIMIT 1`,
      [licenciaId]
    );

    if (rows.length === 0) {
      const error = new Error('La licencia legacy no existe.');
      error.code = 'LEGACY_LICENSE_NOT_FOUND';
      error.status = 404;
      throw error;
    }

    resolvedLicenseName = rows[0].nombre;
  }

  const planCode = resolvePlanCodeFromLegacyLicenseName(resolvedLicenseName);
  const plan = await resolvePlanRow(queryable, planCode);

  return { plan, planCode, licenciaNombre: resolvedLicenseName || null };
}

async function loadSaasSubscriptionSnapshot(queryable, { empresaId = null, suscripcionId = null } = {}) {
  const filters = [];
  const params = [];

  if (suscripcionId) {
    params.push(Number(suscripcionId));
    filters.push(`s.id = $${params.length}`);
  }

  if (empresaId) {
    params.push(Number(empresaId));
    filters.push(`s.empresa_id = $${params.length}`);
  }

  if (filters.length === 0) {
    throw new Error('Se requiere empresaId o suscripcionId para cargar la suscripcion SaaS.');
  }

  const { rows } = await queryable.query(
    `
    SELECT
      s.*,
      p.codigo AS plan_codigo,
      p.nombre AS plan_nombre,
      p.trial_dias,
      p.precio_mensual,
      p.precio_anual
    FROM suscripciones s
    JOIN planes p ON p.id = s.plan_id
    WHERE ${filters.join(' AND ')}
    ORDER BY
      CASE WHEN s.estado IN ('TRIAL', 'ACTIVA') THEN 0 ELSE 1 END,
      COALESCE(
        CASE WHEN s.estado = 'TRIAL' THEN s.trial_hasta ELSE NULL END,
        s.fecha_fin,
        s.actualizado_en,
        s.creado_en
      ) DESC NULLS LAST,
      s.id DESC
    LIMIT 1
    `,
    params
  );

  return rows[0] || null;
}

async function syncLegacyMirrorFromSaas({
  queryable = db,
  empresaId,
  suscripcionId = null,
  observaciones = null,
  metadata = null,
} = {}) {
  const snapshot = await loadSaasSubscriptionSnapshot(queryable, { empresaId, suscripcionId });
  if (!snapshot) {
    return {
      suscripcion: null,
      licencia: null,
      suscripcion_empresa: null,
      empresa_licencia: null,
    };
  }

  const legacyLicense = await resolveLegacyLicenseRow(queryable, snapshot.plan_codigo);
  const status = normalizeSubscriptionState(snapshot.estado, 'ACTIVA');
  const effectiveEnd = snapshot.fecha_fin || snapshot.trial_hasta || null;
  const legacyIsActive = ['TRIAL', 'ACTIVA'].includes(status);
  const legacyPrice = Number(snapshot.precio_pactado ?? legacyLicense.precio ?? 0);
  const compatibilityNote = observaciones
    || `Sincronizada automaticamente desde suscripciones (${snapshot.plan_codigo}).`;

  const { rows: legacySubscriptionRows } = await queryable.query(
    `
    INSERT INTO suscripciones_empresa (
      empresa_id,
      licencia_id,
      estado,
      fecha_inicio,
      fecha_fin,
      renovacion_automatica,
      pasarela,
      referencia_externa,
      observaciones,
      moneda,
      precio_plan,
      metadata,
      actualizado_en
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
        actualizado_en = NOW()
    RETURNING *
    `,
    [
      snapshot.empresa_id,
      legacyLicense.id,
      status,
      snapshot.fecha_inicio || null,
      effectiveEnd,
      Boolean(snapshot.renovacion_automatica),
      snapshot.pasarela || 'MANUAL',
      snapshot.referencia_externa || null,
      compatibilityNote,
      snapshot.moneda || 'COP',
      legacyPrice,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );

  const { rows: legacyAssignmentRows } = await queryable.query(
    `
    INSERT INTO empresa_licencia (
      empresa_id,
      licencia_id,
      fecha_inicio,
      fecha_fin,
      activa,
      creado_en
    )
    VALUES ($1, $2, COALESCE($3, NOW()), $4, $5, NOW())
    ON CONFLICT (empresa_id) DO UPDATE
    SET licencia_id = EXCLUDED.licencia_id,
        fecha_inicio = EXCLUDED.fecha_inicio,
        fecha_fin = EXCLUDED.fecha_fin,
        activa = EXCLUDED.activa,
        creado_en = NOW()
    RETURNING *
    `,
    [
      snapshot.empresa_id,
      legacyLicense.id,
      snapshot.fecha_inicio || null,
      effectiveEnd,
      legacyIsActive,
    ]
  );

  await queryable.query(
    `
    UPDATE empresas
    SET licencia_id = $1,
        licencia_tipo = $2,
        licencia_inicio = COALESCE($3, NOW()),
        licencia_fin = $4
    WHERE id = $5
    `,
    [
      legacyLicense.id,
      legacyLicense.nombre,
      snapshot.fecha_inicio || null,
      effectiveEnd,
      snapshot.empresa_id,
    ]
  );

  return {
    suscripcion: snapshot,
    licencia: legacyLicense,
    suscripcion_empresa: legacySubscriptionRows[0] || null,
    empresa_licencia: legacyAssignmentRows[0] || null,
  };
}

async function syncSaasSubscriptionFromLegacy({
  queryable = db,
  empresaId,
  licenciaId = null,
  licenciaNombre = null,
  estado = 'ACTIVA',
  fechaInicio = null,
  fechaFin = null,
  renovacionAutomatica = false,
  pasarela = 'MANUAL',
  precioPactado = null,
  moneda = 'COP',
  observaciones = null,
  metadata = null,
} = {}) {
  const resolved = await resolvePlanFromLegacyLicense(queryable, { licenciaId, licenciaNombre });
  const plan = resolved.plan;
  const normalizedState = normalizeSubscriptionState(estado, 'ACTIVA');
  const trialHasta = buildTrialUntil({
    estado: normalizedState,
    fechaInicio,
    fechaFin,
    trialDias: plan.trial_dias,
  });
  const officialEnd = normalizedState === 'TRIAL' ? null : (fechaFin || null);
  const compatibilityNote = observaciones
    || `Sincronizada automaticamente desde licencia legacy (${resolved.licenciaNombre || plan.codigo}).`;

  const { rows: currentRows } = await queryable.query(
    `
    SELECT id
    FROM suscripciones
    WHERE empresa_id = $1
      AND estado IN ('TRIAL', 'ACTIVA')
    ORDER BY id DESC
    LIMIT 1
    `,
    [empresaId]
  );

  let suscripcionId = null;

  if (currentRows.length > 0) {
    const { rows } = await queryable.query(
      `
      UPDATE suscripciones
      SET plan_id = $2,
          estado = $3,
          fecha_inicio = COALESCE($4, fecha_inicio, NOW()),
          fecha_fin = $5,
          trial_hasta = $6,
          renovacion_automatica = $7,
          pasarela = $8,
          precio_pactado = $9,
          moneda = $10,
          observaciones = $11,
          metadata = COALESCE($12::jsonb, metadata),
          actualizado_en = NOW()
      WHERE id = $1
      RETURNING id
      `,
      [
        currentRows[0].id,
        plan.id,
        normalizedState,
        fechaInicio || null,
        officialEnd,
        trialHasta,
        Boolean(renovacionAutomatica),
        pasarela || 'MANUAL',
        Number(precioPactado ?? plan.precio_mensual ?? 0),
        moneda || 'COP',
        compatibilityNote,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );

    suscripcionId = rows[0]?.id || null;
  } else {
    const { rows } = await queryable.query(
      `
      INSERT INTO suscripciones (
        empresa_id,
        plan_id,
        estado,
        fecha_inicio,
        fecha_fin,
        trial_hasta,
        ciclo,
        renovacion_automatica,
        pasarela,
        precio_pactado,
        moneda,
        observaciones,
        metadata
      )
      VALUES ($1, $2, $3, COALESCE($4, NOW()), $5, $6, 'MENSUAL', $7, $8, $9, $10, $11, $12::jsonb)
      RETURNING id
      `,
      [
        empresaId,
        plan.id,
        normalizedState,
        fechaInicio || null,
        officialEnd,
        trialHasta,
        Boolean(renovacionAutomatica),
        pasarela || 'MANUAL',
        Number(precioPactado ?? plan.precio_mensual ?? 0),
        moneda || 'COP',
        compatibilityNote,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );

    suscripcionId = rows[0]?.id || null;
  }

  return loadSaasSubscriptionSnapshot(queryable, { suscripcionId, empresaId });
}

module.exports = {
  normalizeSubscriptionState,
  resolvePlanFromLegacyLicense,
  syncLegacyMirrorFromSaas,
  syncSaasSubscriptionFromLegacy,
};
