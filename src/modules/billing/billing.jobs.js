'use strict';

const db = require('../../../db');
const billingService = require('./billing.service');
const { syncLegacyMirrorFromSaas } = require('../../../services/saasCompatibilityService');
const { recordSecurityEventSafe } = require('../../lib/security/audit');

const DEFAULT_JOBS = [
  'MARK_OVERDUE_INVOICES',
  'GENERATE_RENEWAL_INVOICES',
  'EXPIRE_SUBSCRIPTIONS',
];

function toInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function toBool(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeDate(value, fallback = new Date()) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function dateOnly(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function serializeRows(rows = [], limit = 10) {
  return rows.slice(0, limit).map((row) => ({
    ...row,
    total: row.total !== undefined ? Number(row.total) : row.total,
    saldo_pendiente: row.saldo_pendiente !== undefined ? Number(row.saldo_pendiente) : row.saldo_pendiente,
    precio_pactado: row.precio_pactado !== undefined ? Number(row.precio_pactado) : row.precio_pactado,
  }));
}

function buildOptions(options = {}) {
  return {
    asOf: normalizeDate(options.as_of || options.asOf),
    daysAhead: Math.max(0, toInt(options.days_ahead ?? options.daysAhead, 7)),
    graceDays: Math.max(0, toInt(options.grace_days ?? options.graceDays, 3)),
    invoiceDueDays: Math.max(1, toInt(options.invoice_due_days ?? options.invoiceDueDays, 7)),
    limit: Math.min(Math.max(1, toInt(options.limit, 100)), 500),
    dryRun: toBool(options.dry_run ?? options.dryRun, true),
    jobs: Array.isArray(options.jobs) && options.jobs.length
      ? options.jobs.map((job) => String(job || '').trim().toUpperCase())
      : DEFAULT_JOBS,
  };
}

async function markOverdueInvoices(options) {
  const params = [options.asOf.toISOString(), options.limit];
  const { rows: candidates } = await db.query(
    `SELECT id, empresa_id, suscripcion_id, numero_factura, estado, total, saldo_pendiente, vencimiento_en
     FROM billing_invoices
     WHERE estado IN ('OPEN', 'PARTIALLY_PAID')
       AND saldo_pendiente > 0
       AND vencimiento_en IS NOT NULL
       AND vencimiento_en < $1::timestamptz
     ORDER BY vencimiento_en ASC, id ASC
     LIMIT $2`,
    params
  );

  if (options.dryRun || candidates.length === 0) {
    return {
      job: 'MARK_OVERDUE_INVOICES',
      dry_run: options.dryRun,
      affected: 0,
      candidates: serializeRows(candidates),
    };
  }

  const ids = candidates.map((row) => Number(row.id));
  const { rows: updated } = await db.query(
    `UPDATE billing_invoices
     SET estado = 'OVERDUE',
         metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
         updated_at = NOW()
     WHERE id = ANY($1::bigint[])
     RETURNING id, empresa_id, suscripcion_id, numero_factura, estado, total, saldo_pendiente, vencimiento_en`,
    [
      ids,
      JSON.stringify({
        billing_job: 'MARK_OVERDUE_INVOICES',
        marked_overdue_at: new Date().toISOString(),
      }),
    ]
  );

  return {
    job: 'MARK_OVERDUE_INVOICES',
    dry_run: false,
    affected: updated.length,
    rows: serializeRows(updated),
  };
}

async function listRenewalCandidates(options) {
  const { rows } = await db.query(
    `SELECT
       s.id AS suscripcion_id,
       s.empresa_id,
       s.plan_id,
       s.estado,
       s.fecha_fin,
       s.ciclo,
       s.renovacion_automatica,
       s.pasarela,
       s.precio_pactado,
       s.moneda,
       p.codigo AS plan_codigo,
       p.nombre AS plan_nombre,
       p.precio_mensual,
       p.precio_anual,
       e.nombre AS empresa_nombre
     FROM suscripciones s
     JOIN planes p ON p.id = s.plan_id
     JOIN empresas e ON e.id = s.empresa_id
     WHERE s.estado IN ('TRIAL', 'ACTIVA')
       AND s.fecha_fin IS NOT NULL
       AND s.fecha_fin <= ($1::timestamptz + ($2::int * INTERVAL '1 day'))
       AND NOT EXISTS (
         SELECT 1
         FROM billing_invoices bi
         WHERE bi.suscripcion_id = s.id
           AND bi.motivo IN ('SUBSCRIPTION_RENEWAL', 'SUBSCRIPTION_REACTIVATION')
           AND bi.estado IN ('DRAFT', 'OPEN', 'OVERDUE', 'PARTIALLY_PAID', 'PAID')
           AND bi.periodo_inicio >= s.fecha_fin::date
       )
     ORDER BY s.fecha_fin ASC, s.id ASC
     LIMIT $3`,
    [options.asOf.toISOString(), options.daysAhead, options.limit]
  );
  return rows;
}

async function generateRenewalInvoices(options, actor = null) {
  const candidates = await listRenewalCandidates(options);

  if (options.dryRun || candidates.length === 0) {
    return {
      job: 'GENERATE_RENEWAL_INVOICES',
      dry_run: options.dryRun,
      affected: 0,
      candidates: serializeRows(candidates),
    };
  }

  const created = [];
  const errors = [];

  for (const candidate of candidates) {
    const periodStart = dateOnly(candidate.fecha_fin) || dateOnly(options.asOf);
    const idempotencyKey = `billing:renewal:${candidate.suscripcion_id}:${periodStart}`;
    const dueDate = new Date(options.asOf.getTime());
    dueDate.setDate(dueDate.getDate() + options.invoiceDueDays);

    try {
      const invoice = await billingService.createRenewalInvoice(candidate.empresa_id, {
        collection_method: candidate.renovacion_automatica ? 'AUTOMATIC' : 'MANUAL',
        vencimiento_en: dueDate.toISOString(),
        pasarela: candidate.pasarela || 'MANUAL',
        metadata: {
          billing_job: 'GENERATE_RENEWAL_INVOICES',
          generated_at: new Date().toISOString(),
          renewal_candidate_fecha_fin: candidate.fecha_fin,
        },
      }, actor, { idempotencyKey });
      created.push({
        id: invoice.id,
        empresa_id: invoice.empresa_id,
        suscripcion_id: invoice.suscripcion_id,
        numero_factura: invoice.numero_factura,
        estado: invoice.estado,
        total: invoice.total,
        vencimiento_en: invoice.vencimiento_en,
      });
    } catch (error) {
      errors.push({
        empresa_id: candidate.empresa_id,
        suscripcion_id: candidate.suscripcion_id,
        message: error.message,
      });
    }
  }

  return {
    job: 'GENERATE_RENEWAL_INVOICES',
    dry_run: false,
    affected: created.length,
    rows: created,
    errors,
  };
}

async function expireSubscriptions(options, actor = null) {
  const { rows: candidates } = await db.query(
    `SELECT id, empresa_id, plan_id, estado, fecha_fin, ciclo, pasarela
     FROM suscripciones
     WHERE estado IN ('TRIAL', 'ACTIVA')
       AND fecha_fin IS NOT NULL
       AND fecha_fin < ($1::timestamptz - ($2::int * INTERVAL '1 day'))
     ORDER BY fecha_fin ASC, id ASC
     LIMIT $3`,
    [options.asOf.toISOString(), options.graceDays, options.limit]
  );

  if (options.dryRun || candidates.length === 0) {
    return {
      job: 'EXPIRE_SUBSCRIPTIONS',
      dry_run: options.dryRun,
      affected: 0,
      candidates: serializeRows(candidates),
    };
  }

  const updated = [];
  const errors = [];

  for (const candidate of candidates) {
    try {
      const { rows } = await db.query(
        `UPDATE suscripciones
         SET estado = 'VENCIDA',
             observaciones = COALESCE(observaciones, '') || $2,
             metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
             actualizado_en = NOW()
         WHERE id = $1
           AND estado IN ('TRIAL', 'ACTIVA')
         RETURNING id, empresa_id, plan_id, estado, fecha_fin, ciclo, pasarela`,
        [
          Number(candidate.id),
          '\nMarcada vencida automaticamente por job de billing.',
          JSON.stringify({
            billing_job: 'EXPIRE_SUBSCRIPTIONS',
            expired_at: new Date().toISOString(),
            grace_days: options.graceDays,
            actor_id: actor?.id || null,
          }),
        ]
      );

      if (rows.length) {
        await syncLegacyMirrorFromSaas({
          queryable: db,
          empresaId: rows[0].empresa_id,
          suscripcionId: rows[0].id,
          observaciones: 'Espejo legacy sincronizado desde job de vencimiento billing',
          metadata: { source: 'billing.jobs.expireSubscriptions' },
        });
        updated.push(rows[0]);
      }
    } catch (error) {
      errors.push({
        empresa_id: candidate.empresa_id,
        suscripcion_id: candidate.id,
        message: error.message,
      });
    }
  }

  return {
    job: 'EXPIRE_SUBSCRIPTIONS',
    dry_run: false,
    affected: updated.length,
    rows: serializeRows(updated),
    errors,
  };
}

async function runBillingJobs(rawOptions = {}, actor = null) {
  const options = buildOptions(rawOptions);
  const results = [];

  if (options.jobs.includes('MARK_OVERDUE_INVOICES')) {
    results.push(await markOverdueInvoices(options));
  }

  if (options.jobs.includes('GENERATE_RENEWAL_INVOICES')) {
    results.push(await generateRenewalInvoices(options, actor));
  }

  if (options.jobs.includes('EXPIRE_SUBSCRIPTIONS')) {
    results.push(await expireSubscriptions(options, actor));
  }

  const summary = {
    dry_run: options.dryRun,
    as_of: options.asOf.toISOString(),
    days_ahead: options.daysAhead,
    grace_days: options.graceDays,
    invoice_due_days: options.invoiceDueDays,
    limit: options.limit,
    jobs: options.jobs,
    total_affected: results.reduce((acc, result) => acc + Number(result.affected || 0), 0),
    results,
  };

  if (!options.dryRun) {
    await recordSecurityEventSafe({
      empresaId: null,
      usuarioId: actor?.id ?? null,
      accion: 'BILLING_JOBS_RUN',
      entidad: 'billing_job',
      detalle: {
        modulo: 'billing',
        ...summary,
        results: undefined,
      },
    });
  }

  return summary;
}

module.exports = {
  DEFAULT_JOBS,
  buildOptions,
  runBillingJobs,
};
