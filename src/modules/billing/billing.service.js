'use strict';

const crypto = require('crypto');

const db = require('../../../db');
const AppError = require('../../lib/AppError');
const withTransaction = require('../../lib/withTransaction');
const { syncLegacyMirrorFromSaas } = require('../../../services/saasCompatibilityService');
const { recordSecurityEventSafe } = require('../../lib/security/audit');

const INVOICE_STATUSES = new Set(['DRAFT', 'OPEN', 'OVERDUE', 'PARTIALLY_PAID', 'PAID', 'VOID', 'UNCOLLECTIBLE', 'CREDITED', 'REFUNDED']);
const INVOICE_REASONS = new Set(['SUBSCRIPTION_RENEWAL', 'SUBSCRIPTION_REACTIVATION', 'PLAN_CHANGE', 'MANUAL_ADJUSTMENT', 'ADDON', 'LEGACY_IMPORT']);
const COLLECTION_METHODS = new Set(['MANUAL', 'AUTOMATIC']);
const ATTEMPT_STATUSES = new Set(['CREATED', 'PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED', 'IGNORED']);
const CREDIT_STATUSES = new Set(['DRAFT', 'ISSUED', 'APPLIED', 'VOID']);
const WEBHOOK_STATUSES = new Set(['RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED']);

function toNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toUpper(value, fallback = '') {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized || fallback;
}

function normalizeEnum(value, allowedSet, fallback) {
  const normalized = toUpper(value, fallback);
  return allowedSet.has(normalized) ? normalized : fallback;
}

function normalizeProvider(value, fallback = 'MANUAL') {
  return toUpper(value, fallback) || fallback;
}

function toJson(value) {
  return value ? JSON.stringify(value) : null;
}

function buildSequenceCode(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function makeInvoiceNumber(value) {
  return String(value || buildSequenceCode('INV-SAAS')).trim().toUpperCase();
}

function makeCreditNoteNumber(value) {
  return String(value || buildSequenceCode('NC-SAAS')).trim().toUpperCase();
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getWebhookSecret(provider) {
  const providerKey = String(provider || '').trim().toUpperCase();
  return process.env[`BILLING_WEBHOOK_SECRET_${providerKey}`] || process.env.BILLING_WEBHOOK_SECRET || null;
}

function inferWebhookIdentifiers(provider, payload = {}, headers = {}) {
  const object = payload?.data?.object || payload?.data || payload;
  const metadata = object?.metadata || payload?.metadata || {};
  const externalEventId = payload?.id
    || headers['x-event-id']
    || headers['x-request-id']
    || `${provider}-${crypto.createHash('sha256').update(JSON.stringify(payload || {})).digest('hex').slice(0, 32)}`;

  return {
    externalEventId,
    eventType: payload?.type || payload?.event || payload?.event_type || null,
    relatedInvoiceId: metadata?.billing_invoice_id ? Number(metadata.billing_invoice_id) : null,
    relatedAttemptId: metadata?.billing_payment_attempt_id ? Number(metadata.billing_payment_attempt_id) : null,
  };
}

function normalizeHeaders(rawHeaders = {}) {
  return Object.entries(rawHeaders).reduce((acc, [key, value]) => {
    if (Array.isArray(value)) {
      acc[key] = value.join(', ');
      return acc;
    }
    acc[key] = value;
    return acc;
  }, {});
}

function buildAuditPayload(action, entity, entityId, actor, extra = {}) {
  return {
    empresaId: extra.empresaId ?? actor?.empresa_id ?? null,
    usuarioId: actor?.id ?? null,
    accion: action,
    entidad: entity,
    entidadId: entityId,
    detalle: {
      modulo: 'billing',
      scope: actor?.scope || null,
      ...extra,
    },
  };
}

async function getSubscriptionSnapshotByEmpresa(empresaId, queryable = db) {
  const { rows } = await queryable.query(
    `SELECT
       s.id,
       s.empresa_id,
       s.plan_id,
       s.estado,
       s.fecha_inicio,
       s.fecha_fin,
       s.trial_hasta,
       s.ciclo,
       s.renovacion_automatica,
       s.pasarela,
       s.referencia_externa,
       s.precio_pactado,
       s.moneda,
       p.codigo AS plan_codigo,
       p.nombre AS plan_nombre,
       p.precio_mensual,
       p.precio_anual
     FROM suscripciones s
     JOIN planes p ON p.id = s.plan_id
     WHERE s.empresa_id = $1
     ORDER BY
       CASE WHEN s.estado IN ('TRIAL', 'ACTIVA') THEN 0 ELSE 1 END,
       COALESCE(s.actualizado_en, s.creado_en) DESC NULLS LAST,
       s.id DESC
     LIMIT 1`,
    [empresaId]
  );

  return rows[0] || null;
}

async function getInvoiceRow(invoiceId, queryable = db) {
  const { rows } = await queryable.query(
    `SELECT
       bi.*,
       e.nombre AS empresa_nombre,
       s.estado AS suscripcion_estado,
       s.fecha_inicio AS suscripcion_fecha_inicio,
       s.fecha_fin AS suscripcion_fecha_fin,
       s.trial_hasta AS suscripcion_trial_hasta,
       s.ciclo AS suscripcion_ciclo,
       p.codigo AS plan_codigo,
       p.nombre AS plan_nombre
     FROM billing_invoices bi
     JOIN empresas e ON e.id = bi.empresa_id
     LEFT JOIN suscripciones s ON s.id = bi.suscripcion_id
     LEFT JOIN planes p ON p.id = bi.plan_id
     WHERE bi.id = $1
     LIMIT 1`,
    [invoiceId]
  );

  if (!rows.length) {
    throw new AppError('Factura de billing no encontrada.', 404);
  }

  return rows[0];
}

function mapInvoice(row) {
  return {
    ...row,
    subtotal: toNumber(row.subtotal),
    monto_impuestos: toNumber(row.monto_impuestos),
    monto_descuento: toNumber(row.monto_descuento),
    total: toNumber(row.total),
    saldo_pendiente: toNumber(row.saldo_pendiente),
    total_pagado: toNumber(row.total_pagado),
    total_acreditado: toNumber(row.total_acreditado),
  };
}

function mapPayment(row) {
  return {
    ...row,
    amount: toNumber(row.amount),
  };
}

function mapCreditNote(row) {
  return {
    ...row,
    subtotal: toNumber(row.subtotal),
    tax_amount: toNumber(row.tax_amount),
    total_amount: toNumber(row.total_amount),
    remaining_amount: toNumber(row.remaining_amount),
  };
}

async function loadInvoiceDetail(invoiceId, queryable = db) {
  const invoice = mapInvoice(await getInvoiceRow(invoiceId, queryable));

  const [{ rows: attempts }, { rows: payments }, { rows: creditNotes }] = await Promise.all([
    queryable.query(
      `SELECT *
       FROM billing_payment_attempts
       WHERE invoice_id = $1
       ORDER BY created_at DESC, id DESC`,
      [invoiceId]
    ),
    queryable.query(
      `SELECT *
       FROM billing_payments
       WHERE invoice_id = $1
       ORDER BY paid_at DESC, id DESC`,
      [invoiceId]
    ),
    queryable.query(
      `SELECT *
       FROM billing_credit_notes
       WHERE invoice_id = $1
       ORDER BY created_at DESC, id DESC`,
      [invoiceId]
    ),
  ]);

  return {
    ...invoice,
    payment_attempts: attempts.map(mapPayment),
    payments: payments.map(mapPayment),
    credit_notes: creditNotes.map(mapCreditNote),
  };
}

async function resolveInvoiceByIdempotency(queryable, idempotencyKey) {
  if (!idempotencyKey) return null;
  const { rows } = await queryable.query(
    `SELECT id
     FROM billing_invoices
     WHERE idempotency_key = $1
     LIMIT 1`,
    [idempotencyKey]
  );
  return rows[0] || null;
}

async function resolveAttemptByIdempotency(queryable, idempotencyKey) {
  if (!idempotencyKey) return null;
  const { rows } = await queryable.query(
    `SELECT *
     FROM billing_payment_attempts
     WHERE idempotency_key = $1
     LIMIT 1`,
    [idempotencyKey]
  );
  return rows[0] || null;
}

async function resolvePaymentByIdempotency(queryable, idempotencyKey) {
  if (!idempotencyKey) return null;
  const { rows } = await queryable.query(
    `SELECT *
     FROM billing_payments
     WHERE idempotency_key = $1
     LIMIT 1`,
    [idempotencyKey]
  );
  return rows[0] || null;
}

async function resolveCreditByIdempotency(queryable, idempotencyKey) {
  if (!idempotencyKey) return null;
  const { rows } = await queryable.query(
    `SELECT *
     FROM billing_credit_notes
     WHERE idempotency_key = $1
     LIMIT 1`,
    [idempotencyKey]
  );
  return rows[0] || null;
}

async function recalculateInvoiceState(queryable, invoiceId) {
  const invoice = await getInvoiceRow(invoiceId, queryable);

  if (['VOID', 'REFUNDED', 'UNCOLLECTIBLE'].includes(invoice.estado)) {
    return mapInvoice(invoice);
  }

  const [{ rows: paymentRows }, { rows: creditRows }] = await Promise.all([
    queryable.query(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM billing_payments
       WHERE invoice_id = $1
         AND estado = 'CONFIRMED'`,
      [invoiceId]
    ),
    queryable.query(
      `SELECT COALESCE(SUM(total_amount), 0) AS total
       FROM billing_credit_notes
       WHERE invoice_id = $1
         AND estado = 'APPLIED'`,
      [invoiceId]
    ),
  ]);

  const totalPaid = toNumber(paymentRows[0]?.total);
  const totalCredited = toNumber(creditRows[0]?.total);
  const balance = Math.max(0, toNumber(invoice.total) - totalPaid - totalCredited);
  const dueAt = normalizeDate(invoice.vencimiento_en);
  const now = new Date();

  let nextStatus = 'OPEN';
  if (balance === 0 && totalPaid > 0) {
    nextStatus = 'PAID';
  } else if (balance === 0 && totalCredited > 0) {
    nextStatus = 'CREDITED';
  } else if (totalPaid > 0 || totalCredited > 0) {
    nextStatus = 'PARTIALLY_PAID';
  } else if (dueAt && now > dueAt) {
    nextStatus = 'OVERDUE';
  }

  const { rows } = await queryable.query(
    `UPDATE billing_invoices
     SET total_pagado = $2,
         total_acreditado = $3,
         saldo_pendiente = $4,
         estado = $5::varchar,
         pagada_en = CASE WHEN $5::varchar = 'PAID' THEN COALESCE(pagada_en, NOW()) ELSE pagada_en END,
         cerrada_en = CASE WHEN $5::varchar IN ('PAID', 'CREDITED') THEN COALESCE(cerrada_en, NOW()) ELSE cerrada_en END,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [invoiceId, totalPaid, totalCredited, balance, nextStatus]
  );

  return mapInvoice(rows[0]);
}

async function syncSubscriptionAfterInvoiceSettlement(queryable, invoice) {
  if (!invoice?.suscripcion_id) return null;
  if (!['SUBSCRIPTION_RENEWAL', 'SUBSCRIPTION_REACTIVATION', 'PLAN_CHANGE'].includes(invoice.motivo)) {
    return null;
  }

  const periodEnd = invoice.periodo_fin ? `${invoice.periodo_fin}T23:59:59.999Z` : null;
  const { rows } = await queryable.query(
    `UPDATE suscripciones
     SET estado = 'ACTIVA',
         fecha_fin = CASE
           WHEN $2::timestamptz IS NULL THEN fecha_fin
           WHEN fecha_fin IS NULL THEN $2::timestamptz
           WHEN $2::timestamptz > fecha_fin THEN $2::timestamptz
           ELSE fecha_fin
         END,
         actualizado_en = NOW()
     WHERE id = $1
     RETURNING *`,
    [invoice.suscripcion_id, periodEnd]
  );

  if (!rows.length) return null;

  await syncLegacyMirrorFromSaas({
    queryable,
    empresaId: invoice.empresa_id,
    suscripcionId: invoice.suscripcion_id,
    observaciones: 'Espejo legacy sincronizado desde pago billing',
    metadata: { source: 'billing.syncSubscriptionAfterInvoiceSettlement' },
  });

  return rows[0];
}

function computeInvoiceAmounts(body = {}, fallbackTotal = 0) {
  const subtotal = toNumber(body.subtotal ?? body.total ?? fallbackTotal);
  const taxes = toNumber(body.monto_impuestos ?? body.tax_amount ?? 0);
  const discount = toNumber(body.monto_descuento ?? body.discount_amount ?? 0);
  const total = body.total === null || body.total === undefined
    ? Math.max(0, subtotal + taxes - discount)
    : toNumber(body.total);

  if (total < 0) {
    throw new AppError('El total de la factura no puede ser negativo.', 400);
  }

  return {
    subtotal,
    taxes,
    discount,
    total,
  };
}

async function listInvoices(filters = {}, queryable = db) {
  const params = [];
  const where = [];

  if (filters.empresa_id) {
    params.push(Number(filters.empresa_id));
    where.push(`bi.empresa_id = $${params.length}`);
  }

  if (filters.suscripcion_id) {
    params.push(Number(filters.suscripcion_id));
    where.push(`bi.suscripcion_id = $${params.length}`);
  }

  if (filters.estado) {
    params.push(normalizeEnum(filters.estado, INVOICE_STATUSES, 'OPEN'));
    where.push(`bi.estado = $${params.length}`);
  }

  if (filters.pasarela) {
    params.push(normalizeProvider(filters.pasarela));
    where.push(`bi.pasarela = $${params.length}`);
  }

  params.push(Math.min(Number(filters.limit || 50), 200));
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows } = await queryable.query(
    `SELECT
       bi.*,
       e.nombre AS empresa_nombre,
       s.estado AS suscripcion_estado,
       p.codigo AS plan_codigo,
       p.nombre AS plan_nombre
     FROM billing_invoices bi
     JOIN empresas e ON e.id = bi.empresa_id
     LEFT JOIN suscripciones s ON s.id = bi.suscripcion_id
     LEFT JOIN planes p ON p.id = bi.plan_id
     ${whereSql}
     ORDER BY bi.emitida_en DESC, bi.id DESC
     LIMIT $${params.length}`,
    params
  );

  return rows.map(mapInvoice);
}

async function getInvoice(invoiceId, queryable = db) {
  return loadInvoiceDetail(Number(invoiceId), queryable);
}

async function createInvoice(body = {}, actor = null, context = {}, queryable = db) {
  const companyId = Number(body.empresa_id || 0);
  if (!companyId) {
    throw new AppError('empresa_id es obligatorio para crear una factura.', 400);
  }

  const idempotencyKey = body.idempotency_key || context.idempotencyKey || null;
  const existing = await resolveInvoiceByIdempotency(queryable, idempotencyKey);
  if (existing) {
    return getInvoice(existing.id, queryable);
  }

  const subscription = body.suscripcion_id
    ? await getSubscriptionSnapshotByEmpresa(companyId, queryable)
    : await getSubscriptionSnapshotByEmpresa(companyId, queryable);

  const motivo = normalizeEnum(body.motivo, INVOICE_REASONS, 'MANUAL_ADJUSTMENT');
  const collectionMethod = normalizeEnum(body.collection_method, COLLECTION_METHODS, 'MANUAL');
  const fallbackTotal = subscription ? toNumber(subscription.precio_pactado || subscription.precio_mensual) : 0;
  const amounts = computeInvoiceAmounts(body, fallbackTotal);
  const number = makeInvoiceNumber(body.numero_factura);

  const { rows } = await queryable.query(
    `INSERT INTO billing_invoices (
       empresa_id, suscripcion_id, plan_id, numero_factura, tipo_documento,
       motivo, estado, collection_method, moneda,
       subtotal, monto_impuestos, monto_descuento, total, saldo_pendiente,
       periodo_inicio, periodo_fin, emitida_en, vencimiento_en,
       pasarela, external_customer_id, external_invoice_id, idempotency_key,
       metadata, created_by, updated_by
     )
     VALUES (
       $1, $2, $3, $4, 'INVOICE',
       $5, 'OPEN', $6, $7,
       $8, $9, $10, $11, $11,
       $12, $13, COALESCE($14::timestamptz, NOW()), $15::timestamptz,
       $16, $17, $18, $19,
       $20::jsonb, $21, $21
     )
     RETURNING id`,
    [
      companyId,
      subscription?.id || body.suscripcion_id || null,
      subscription?.plan_id || null,
      number,
      motivo,
      collectionMethod,
      body.moneda || subscription?.moneda || 'COP',
      amounts.subtotal,
      amounts.taxes,
      amounts.discount,
      amounts.total,
      body.periodo_inicio || null,
      body.periodo_fin || null,
      body.emitida_en || null,
      body.vencimiento_en || null,
      normalizeProvider(body.pasarela, subscription?.pasarela || 'MANUAL'),
      body.external_customer_id || null,
      body.external_invoice_id || null,
      idempotencyKey,
      body.metadata || null,
      actor?.id || null,
    ]
  );

  await recordSecurityEventSafe(buildAuditPayload(
    'BILLING_INVOICE_CREATED',
    'billing_invoice',
    rows[0].id,
    actor,
    { empresaId: companyId, motivo, numero_factura: number }
  ));

  return getInvoice(rows[0].id, queryable);
}

async function createRenewalInvoice(empresaId, body = {}, actor = null, context = {}, queryable = db) {
  const subscription = await getSubscriptionSnapshotByEmpresa(Number(empresaId), queryable);
  if (!subscription) {
    throw new AppError('No existe suscripción oficial para esta empresa.', 404);
  }

  const cycleDays = Math.max(
    Number(body.dias || 0),
    subscription.ciclo === 'ANUAL' ? 365 : 30
  );

  const startDate = normalizeDate(body.periodo_inicio)
    || normalizeDate(subscription.fecha_fin)
    || new Date();
  const endDate = normalizeDate(body.periodo_fin) || new Date(startDate.getTime());
  if (!body.periodo_fin) {
    endDate.setDate(endDate.getDate() + cycleDays);
  }

  const invoiceBody = {
    ...body,
    empresa_id: Number(empresaId),
    suscripcion_id: subscription.id,
    motivo: body.motivo || (['SUSPENDIDA', 'VENCIDA', 'CANCELADA'].includes(subscription.estado) ? 'SUBSCRIPTION_REACTIVATION' : 'SUBSCRIPTION_RENEWAL'),
    subtotal: body.subtotal ?? body.total ?? subscription.precio_pactado ?? (subscription.ciclo === 'ANUAL' ? subscription.precio_anual : subscription.precio_mensual) ?? 0,
    periodo_inicio: startDate.toISOString(),
    periodo_fin: endDate.toISOString(),
    pasarela: body.pasarela || subscription.pasarela || 'MANUAL',
  };

  return createInvoice(invoiceBody, actor, context, queryable);
}

async function createPaymentAttempt(invoiceId, body = {}, actor = null, context = {}, queryable = db) {
  const idempotencyKey = body.idempotency_key || context.idempotencyKey || null;
  const existing = await resolveAttemptByIdempotency(queryable, idempotencyKey);
  if (existing) return existing;

  const invoice = await getInvoiceRow(Number(invoiceId), queryable);
  const { rows: attemptCountRows } = await queryable.query(
    `SELECT COALESCE(MAX(attempt_number), 0) AS max_attempt
     FROM billing_payment_attempts
     WHERE invoice_id = $1`,
    [invoice.id]
  );

  const { rows } = await queryable.query(
    `INSERT INTO billing_payment_attempts (
       invoice_id, empresa_id, suscripcion_id, provider, mode, estado, amount, currency,
       attempt_number, idempotency_key, external_attempt_id, external_payment_id,
       provider_event_id, failure_code, failure_message, next_retry_at,
       request_payload, response_payload, metadata, created_by
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9, $10, $11, $12,
       $13, $14, $15, $16::timestamptz,
       $17::jsonb, $18::jsonb, $19::jsonb, $20
     )
     RETURNING *`,
    [
      invoice.id,
      invoice.empresa_id,
      invoice.suscripcion_id,
      normalizeProvider(body.provider, invoice.pasarela || 'MANUAL'),
      normalizeEnum(body.mode, new Set(['MANUAL', 'AUTOMATIC', 'WEBHOOK']), 'MANUAL'),
      normalizeEnum(body.estado, ATTEMPT_STATUSES, 'CREATED'),
      toNumber(body.amount ?? invoice.saldo_pendiente),
      body.currency || invoice.moneda || 'COP',
      Number(attemptCountRows[0]?.max_attempt || 0) + 1,
      idempotencyKey,
      body.external_attempt_id || null,
      body.external_payment_id || null,
      body.provider_event_id || null,
      body.failure_code || null,
      body.failure_message || null,
      body.next_retry_at || null,
      body.request_payload || null,
      body.response_payload || null,
      body.metadata || null,
      actor?.id || null,
    ]
  );

  await recordSecurityEventSafe(buildAuditPayload(
    'BILLING_PAYMENT_ATTEMPT_CREATED',
    'billing_payment_attempt',
    rows[0].id,
    actor,
    { empresaId: invoice.empresa_id, invoice_id: invoice.id }
  ));

  return rows[0];
}

async function registerManualPayment(invoiceId, body = {}, actor = null, context = {}) {
  return withTransaction(async (client) => {
    const idempotencyKey = body.idempotency_key || context.idempotencyKey || null;
    const existing = await resolvePaymentByIdempotency(client, idempotencyKey);
    if (existing) {
      return {
        payment: mapPayment(existing),
        invoice: await getInvoice(existing.invoice_id, client),
      };
    }

    const invoice = await getInvoiceRow(Number(invoiceId), client);
    if (invoice.estado === 'VOID') {
      throw new AppError('No puedes registrar pagos sobre una factura anulada.', 409);
    }

    const paymentAmount = toNumber(body.amount ?? invoice.saldo_pendiente);
    if (paymentAmount <= 0) {
      throw new AppError('El monto del pago debe ser mayor a cero.', 400);
    }

    const attempt = await createPaymentAttempt(invoiceId, {
      provider: body.provider || invoice.pasarela || 'MANUAL',
      mode: 'MANUAL',
      estado: 'SUCCEEDED',
      amount: paymentAmount,
      currency: invoice.moneda,
      external_payment_id: body.external_payment_id || body.referencia_externa || null,
      response_payload: body.metadata ? { manual_payment_metadata: body.metadata } : null,
      idempotency_key: idempotencyKey ? `${idempotencyKey}:attempt` : null,
    }, actor, {}, client);

    const { rows } = await client.query(
      `INSERT INTO billing_payments (
         invoice_id, payment_attempt_id, empresa_id, suscripcion_id, provider, payment_method,
         estado, amount, currency, idempotency_key, external_payment_id,
         referencia_externa, paid_at, metadata, created_by
       )
       VALUES (
         $1, $2, $3, $4, $5, $6,
         'CONFIRMED', $7, $8, $9, $10,
         $11, COALESCE($12::timestamptz, NOW()), $13::jsonb, $14
       )
       RETURNING *`,
      [
        invoice.id,
        attempt.id,
        invoice.empresa_id,
        invoice.suscripcion_id,
        normalizeProvider(body.provider, invoice.pasarela || 'MANUAL'),
        toUpper(body.payment_method, 'OTRO'),
        paymentAmount,
        invoice.moneda || 'COP',
        idempotencyKey,
        body.external_payment_id || null,
        body.referencia_externa || null,
        body.paid_at || null,
        body.metadata ? { ...body.metadata, source: 'manual_payment' } : { source: 'manual_payment' },
        actor?.id || null,
      ]
    );

    const updatedInvoice = await recalculateInvoiceState(client, invoice.id);

    if (updatedInvoice.estado === 'PAID' && body.reactivar_suscripcion !== false) {
      await syncSubscriptionAfterInvoiceSettlement(client, updatedInvoice);
    }

    await recordSecurityEventSafe(buildAuditPayload(
      'BILLING_PAYMENT_CONFIRMED',
      'billing_payment',
      rows[0].id,
      actor,
      { empresaId: invoice.empresa_id, invoice_id: invoice.id, amount: paymentAmount }
    ));

    return {
      payment: mapPayment(rows[0]),
      invoice: await getInvoice(invoice.id, client),
    };
  });
}

async function voidInvoice(invoiceId, body = {}, actor = null, queryable = db) {
  return withTransaction(async (client) => {
    const invoice = await getInvoiceRow(Number(invoiceId), client);

    if (['PAID', 'CREDITED', 'REFUNDED'].includes(invoice.estado) || toNumber(invoice.total_pagado) > 0 || toNumber(invoice.total_acreditado) > 0) {
      throw new AppError('No puedes anular una factura con pagos o créditos aplicados.', 409);
    }

    await client.query(
      `UPDATE billing_invoices
       SET estado = 'VOID',
           cerrada_en = COALESCE(cerrada_en, NOW()),
           metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
           updated_by = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [
        invoice.id,
        JSON.stringify({ void_reason: body.reason || null }),
        actor?.id || null,
      ]
    );

    await recordSecurityEventSafe(buildAuditPayload(
      'BILLING_INVOICE_VOIDED',
      'billing_invoice',
      invoice.id,
      actor,
      { empresaId: invoice.empresa_id, reason: body.reason || null }
    ));

    return getInvoice(invoice.id, client);
  });
}

async function createCreditNote(invoiceId, body = {}, actor = null, context = {}) {
  return withTransaction(async (client) => {
    const idempotencyKey = body.idempotency_key || context.idempotencyKey || null;
    const existing = await resolveCreditByIdempotency(client, idempotencyKey);
    if (existing) {
      return {
        credit_note: mapCreditNote(existing),
        invoice: await getInvoice(existing.invoice_id, client),
      };
    }

    const invoice = await getInvoiceRow(Number(invoiceId), client);
    if (invoice.estado === 'VOID') {
      throw new AppError('No puedes crear notas crédito sobre una factura anulada.', 409);
    }

    const subtotal = toNumber(body.subtotal ?? body.total_amount ?? invoice.saldo_pendiente);
    const taxAmount = toNumber(body.tax_amount || 0);
    const totalAmount = toNumber(body.total_amount ?? (subtotal + taxAmount));
    const applyImmediately = body.apply_immediately !== false;

    if (totalAmount <= 0) {
      throw new AppError('La nota crédito debe tener un total mayor a cero.', 400);
    }

    if (applyImmediately && totalAmount > toNumber(invoice.saldo_pendiente)) {
      throw new AppError('La nota crédito aplicada no puede exceder el saldo pendiente de la factura.', 409);
    }

    const status = applyImmediately
      ? 'APPLIED'
      : normalizeEnum(body.status, CREDIT_STATUSES, 'ISSUED');

    const { rows } = await client.query(
      `INSERT INTO billing_credit_notes (
         credit_note_number, invoice_id, empresa_id, suscripcion_id, estado,
         reason_code, reason_text, currency, subtotal, tax_amount,
         total_amount, remaining_amount, issued_at, applied_at,
         idempotency_key, metadata, created_by, updated_by
       )
       VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9, $10,
         $11, $12, COALESCE($13::timestamptz, NOW()),
         CASE WHEN $5 = 'APPLIED' THEN COALESCE($13::timestamptz, NOW()) ELSE NULL END,
         $14, $15::jsonb, $16, $16
       )
       RETURNING *`,
      [
        makeCreditNoteNumber(body.credit_note_number),
        invoice.id,
        invoice.empresa_id,
        invoice.suscripcion_id,
        status,
        body.reason_code || 'ADJUSTMENT',
        body.reason_text || null,
        invoice.moneda || 'COP',
        subtotal,
        taxAmount,
        totalAmount,
        status === 'APPLIED' ? 0 : totalAmount,
        body.issued_at || null,
        idempotencyKey,
        body.metadata || null,
        actor?.id || null,
      ]
    );

    if (status === 'APPLIED') {
      await recalculateInvoiceState(client, invoice.id);
    }

    await recordSecurityEventSafe(buildAuditPayload(
      'BILLING_CREDIT_NOTE_CREATED',
      'billing_credit_note',
      rows[0].id,
      actor,
      { empresaId: invoice.empresa_id, invoice_id: invoice.id, total_amount: totalAmount }
    ));

    return {
      credit_note: mapCreditNote(rows[0]),
      invoice: await getInvoice(invoice.id, client),
    };
  });
}

async function listSubscriptionLedger(empresaId, queryable = db) {
  const companyId = Number(empresaId || 0);
  if (!companyId) {
    throw new AppError('empresaId inválido.', 400);
  }

  const [subscription, invoices] = await Promise.all([
    getSubscriptionSnapshotByEmpresa(companyId, queryable),
    listInvoices({ empresa_id: companyId, limit: 200 }, queryable),
  ]);

  return {
    empresa_id: companyId,
    suscripcion: subscription,
    invoices,
  };
}

async function recordWebhook(provider, payload = {}, headers = {}) {
  const normalizedProvider = normalizeProvider(provider, 'OTRO');
  const normalizedHeaders = normalizeHeaders(headers);
  const identifiers = inferWebhookIdentifiers(normalizedProvider, payload, normalizedHeaders);
  const signatureHeader = normalizedHeaders['x-signature']
    || normalizedHeaders['stripe-signature']
    || normalizedHeaders['x-signature-256']
    || null;
  const secret = getWebhookSecret(normalizedProvider);
  const signatureValid = normalizedProvider === 'WOMPI'
    ? null
    : (secret ? signatureHeader === secret : null);
  const nextStatus = signatureValid === false ? 'FAILED' : 'RECEIVED';

  const { rows } = await db.query(
    `INSERT INTO billing_webhook_events (
       provider, external_event_id, event_type, signature_header, signature_valid,
       estado, related_invoice_id, related_attempt_id, process_attempts, headers, payload
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9::jsonb, $10::jsonb)
     ON CONFLICT (provider, external_event_id) DO UPDATE
     SET updated_at = NOW(),
         process_attempts = billing_webhook_events.process_attempts + 1,
         last_processed_at = NOW()
     RETURNING *`,
    [
      normalizedProvider,
      identifiers.externalEventId,
      identifiers.eventType,
      signatureHeader,
      signatureValid,
      nextStatus,
      identifiers.relatedInvoiceId,
      identifiers.relatedAttemptId,
      toJson(normalizedHeaders),
      toJson(payload),
    ]
  );

  await recordSecurityEventSafe({
    empresaId: null,
    usuarioId: null,
    accion: 'BILLING_WEBHOOK_RECEIVED',
    entidad: 'billing_webhook_event',
    entidadId: rows[0].id,
    detalle: {
      modulo: 'billing',
      provider: normalizedProvider,
      event_type: identifiers.eventType,
      external_event_id: identifiers.externalEventId,
      signature_valid: signatureValid,
    },
  });

  return rows[0];
}

async function listWebhookEvents(filters = {}, queryable = db) {
  const params = [];
  const where = [];

  if (filters.provider) {
    params.push(normalizeProvider(filters.provider));
    where.push(`provider = $${params.length}`);
  }

  if (filters.estado) {
    params.push(normalizeEnum(filters.estado, WEBHOOK_STATUSES, 'RECEIVED'));
    where.push(`estado = $${params.length}`);
  }

  params.push(Math.min(Number(filters.limit || 50), 200));
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows } = await queryable.query(
    `SELECT *
     FROM billing_webhook_events
     ${whereSql}
     ORDER BY received_at DESC, id DESC
     LIMIT $${params.length}`,
    params
  );

  return rows;
}

async function getWebhookEvent(webhookId, queryable = db) {
  const { rows } = await queryable.query(
    `SELECT *
     FROM billing_webhook_events
     WHERE id = $1
     LIMIT 1`,
    [Number(webhookId)]
  );

  if (!rows.length) {
    throw new AppError('Webhook de billing no encontrado.', 404);
  }

  return rows[0];
}

module.exports = {
  createCreditNote,
  createInvoice,
  createPaymentAttempt,
  createRenewalInvoice,
  getInvoice,
  getWebhookEvent,
  listInvoices,
  listSubscriptionLedger,
  listWebhookEvents,
  recalculateInvoiceState,
  recordWebhook,
  registerManualPayment,
  syncSubscriptionAfterInvoiceSettlement,
  voidInvoice,
};
