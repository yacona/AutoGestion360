'use strict';

const crypto = require('crypto');

const db = require('../../../../db');
const AppError = require('../../../lib/AppError');
const withTransaction = require('../../../lib/withTransaction');
const billingService = require('../billing.service');
const { recordSecurityEventSafe } = require('../../../lib/security/audit');

const WOMPI_PROVIDER = 'WOMPI';
const WOMPI_INVOICE_REFERENCE_REGEX = /^AG360-INV-(\d+)-/i;
const ACTIVE_SOURCE_STATUSES = new Set(['ACTIVE', 'AVAILABLE']);
const FINAL_WOMPI_STATUSES = new Set(['APPROVED', 'DECLINED', 'VOIDED', 'ERROR']);

function getWompiConfig() {
  const env = String(process.env.WOMPI_ENV || 'sandbox').trim().toLowerCase();
  const isProduction = env === 'production' || env === 'prod';

  return {
    environment: isProduction ? 'production' : 'sandbox',
    publicKey: process.env.WOMPI_PUBLIC_KEY || null,
    privateKey: process.env.WOMPI_PRIVATE_KEY || null,
    integritySecret: process.env.WOMPI_INTEGRITY_SECRET || null,
    eventsSecret: process.env.WOMPI_EVENTS_SECRET || null,
    redirectUrl: process.env.WOMPI_REDIRECT_URL || null,
    apiBaseUrl: process.env.WOMPI_API_BASE_URL
      || (isProduction ? 'https://production.wompi.co/v1' : 'https://sandbox.wompi.co/v1'),
    checkoutUrl: process.env.WOMPI_CHECKOUT_URL || 'https://checkout.wompi.co/p/',
  };
}

function assertWompiConfig(requiredKeys = []) {
  const config = getWompiConfig();
  const missing = requiredKeys.filter((key) => !config[key]);
  if (missing.length) {
    throw new AppError(`Falta configurar Wompi: ${missing.join(', ')}.`, 500);
  }
  return config;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function amountToCents(amount) {
  return Math.round(toNumber(amount, 0) * 100);
}

function centsToAmount(amountInCents) {
  return Math.round(toNumber(amountInCents, 0)) / 100;
}

function sha256Hex(value, uppercase = false) {
  const digest = crypto.createHash('sha256').update(String(value)).digest('hex');
  return uppercase ? digest.toUpperCase() : digest.toLowerCase();
}

function buildWompiReference(invoiceId, mode = 'CHK') {
  return `AG360-INV-${Number(invoiceId)}-${mode}-${Date.now()}`;
}

function parseInvoiceIdFromReference(reference) {
  const match = String(reference || '').trim().match(WOMPI_INVOICE_REFERENCE_REGEX);
  if (!match) return null;
  return Number(match[1] || 0) || null;
}

function buildIntegritySignature({ reference, amountInCents, currency = 'COP', expirationTime = null, integritySecret }) {
  const payload = expirationTime
    ? `${reference}${amountInCents}${currency}${expirationTime}${integritySecret}`
    : `${reference}${amountInCents}${currency}${integritySecret}`;
  return sha256Hex(payload, false);
}

function normalizeStatus(value, fallback = 'PENDING') {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized || fallback;
}

function mapWompiStatusToAttempt(status) {
  switch (normalizeStatus(status)) {
    case 'APPROVED':
      return 'SUCCEEDED';
    case 'DECLINED':
    case 'ERROR':
      return 'FAILED';
    case 'VOIDED':
      return 'CANCELED';
    default:
      return 'PENDING';
  }
}

function mapWompiPaymentMethod(paymentMethodType) {
  switch (normalizeStatus(paymentMethodType, 'OTRO')) {
    case 'NEQUI':
      return 'NEQUI';
    case 'DAVIPLATA':
      return 'DAVIPLATA';
    case 'PSE':
      return 'PSE';
    case 'BANCOLOMBIA_TRANSFER':
      return 'TRANSFERENCIA';
    case 'CARD':
      return 'TARJETA';
    default:
      return 'WOMPI';
  }
}

function buildAttemptMetadata(existingMetadata = null, extra = {}) {
  return {
    ...(existingMetadata && typeof existingMetadata === 'object' ? existingMetadata : {}),
    ...extra,
  };
}

function getValueFromPath(root, path) {
  return String(path || '')
    .split('.')
    .reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : null), root);
}

function validateWompiEventSignature(payload, headers = {}) {
  const config = getWompiConfig();
  if (!config.eventsSecret) {
    return { valid: null, checksum: payload?.signature?.checksum || null };
  }

  const expected = buildWompiEventChecksum(payload, config.eventsSecret);
  const checksum = String(
    headers['x-event-checksum']
      || payload?.signature?.checksum
      || ''
  ).trim().toUpperCase();

  return {
    valid: Boolean(checksum) && checksum === expected,
    checksum,
    expectedChecksum: expected,
  };
}

function buildWompiEventChecksum(payload, eventsSecret = null) {
  const secret = eventsSecret || getWompiConfig().eventsSecret;
  if (!secret) {
    throw new AppError('WOMPI_EVENTS_SECRET no está configurada.', 500);
  }

  const properties = Array.isArray(payload?.signature?.properties) ? payload.signature.properties : [];
  const concatenated = properties
    .map((propertyPath) => {
      const value = getValueFromPath(payload?.data || {}, propertyPath);
      return value === undefined || value === null ? '' : String(value);
    })
    .join('');
  const source = `${concatenated}${payload?.timestamp || ''}${secret}`;
  return sha256Hex(source, true);
}

async function parseWompiResponse(response) {
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const message = data?.error?.reason
      || data?.error?.messages?.[0]?.message
      || data?.error?.messages?.[0]
      || data?.error?.message
      || data?.message
      || `Wompi respondió con HTTP ${response.status}.`;
    const error = new AppError(message, response.status >= 500 ? 502 : response.status);
    error.details = data?.error?.messages || data?.error || data || null;
    throw error;
  }

  return data;
}

async function wompiRequest(method, path, { auth = 'none', body = null, headers = {} } = {}) {
  const config = getWompiConfig();
  const finalHeaders = {
    Accept: 'application/json',
    ...headers,
  };

  if (body !== null) {
    finalHeaders['Content-Type'] = 'application/json';
  }

  if (auth === 'public') {
    if (!config.publicKey) throw new AppError('WOMPI_PUBLIC_KEY no está configurada.', 500);
    finalHeaders.Authorization = `Bearer ${config.publicKey}`;
  } else if (auth === 'private') {
    if (!config.privateKey) throw new AppError('WOMPI_PRIVATE_KEY no está configurada.', 500);
    finalHeaders.Authorization = `Bearer ${config.privateKey}`;
  }

  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method,
    headers: finalHeaders,
    body: body !== null ? JSON.stringify(body) : undefined,
  });

  return parseWompiResponse(response);
}

async function getInvoiceContext(invoiceId, queryable = db) {
  const invoice = await billingService.getInvoice(Number(invoiceId), queryable);
  if (!invoice) {
    throw new AppError('Factura no encontrada.', 404);
  }
  if (!['OPEN', 'OVERDUE', 'PARTIALLY_PAID'].includes(invoice.estado)) {
    throw new AppError(`La factura ${invoice.id} no está disponible para cobro online en su estado actual (${invoice.estado}).`, 409);
  }
  return invoice;
}

async function getSubscriptionSnapshot(empresaId, queryable = db) {
  const { rows } = await queryable.query(
    `SELECT id, empresa_id, plan_id, estado, ciclo, fecha_inicio, fecha_fin, pasarela, moneda
     FROM suscripciones
     WHERE empresa_id = $1
     ORDER BY
       CASE WHEN estado IN ('TRIAL', 'ACTIVA') THEN 0 ELSE 1 END,
       COALESCE(actualizado_en, creado_en) DESC NULLS LAST,
       id DESC
     LIMIT 1`,
    [Number(empresaId)]
  );
  return rows[0] || null;
}

async function getStoredPaymentSourceById(paymentSourceId, empresaId = null, queryable = db) {
  const params = [Number(paymentSourceId)];
  let where = 'WHERE id = $1';
  if (empresaId) {
    params.push(Number(empresaId));
    where += ` AND empresa_id = $${params.length}`;
  }

  const { rows } = await queryable.query(
    `SELECT *
     FROM billing_customer_payment_sources
     ${where}
     LIMIT 1`,
    params
  );
  return rows[0] || null;
}

async function getDefaultPaymentSourceForEmpresa(empresaId, queryable = db) {
  const { rows } = await queryable.query(
    `SELECT *
     FROM billing_customer_payment_sources
     WHERE empresa_id = $1
       AND provider = 'WOMPI'
       AND status = 'ACTIVE'
     ORDER BY is_default DESC, created_at DESC, id DESC
     LIMIT 1`,
    [Number(empresaId)]
  );
  return rows[0] || null;
}

async function listStoredPaymentSources(empresaId, queryable = db) {
  const { rows } = await queryable.query(
    `SELECT *
     FROM billing_customer_payment_sources
     WHERE empresa_id = $1
       AND provider = 'WOMPI'
     ORDER BY is_default DESC, created_at DESC, id DESC`,
    [Number(empresaId)]
  );
  return rows;
}

async function upsertStoredPaymentSource({
  companyId,
  subscriptionId = null,
  wompiPaymentSource,
  customerEmail,
  type,
  makeDefault = false,
  publicData = null,
  metadata = null,
  actor = null,
}, queryable = db) {
  const normalizedProviderStatus = normalizeStatus(wompiPaymentSource?.status, 'AVAILABLE');
  const status = ACTIVE_SOURCE_STATUSES.has(normalizedProviderStatus)
    ? 'ACTIVE'
    : 'INACTIVE';

  if (makeDefault) {
    await queryable.query(
      `UPDATE billing_customer_payment_sources
       SET is_default = FALSE, updated_by = $2, updated_at = NOW()
       WHERE empresa_id = $1
         AND provider = 'WOMPI'`,
      [Number(companyId), actor?.id || null]
    );
  }

  const { rows } = await queryable.query(
    `INSERT INTO billing_customer_payment_sources (
       empresa_id, suscripcion_id, provider, provider_payment_source_id, customer_email,
       type, status, is_default, public_data, metadata, created_by, updated_by
     )
     VALUES (
       $1, $2, 'WOMPI', $3, $4,
       $5, $6, $7, $8::jsonb, $9::jsonb, $10, $10
     )
     ON CONFLICT (provider, provider_payment_source_id) DO UPDATE
     SET customer_email = EXCLUDED.customer_email,
         type = EXCLUDED.type,
         status = EXCLUDED.status,
         is_default = EXCLUDED.is_default,
         public_data = EXCLUDED.public_data,
         metadata = EXCLUDED.metadata,
         suscripcion_id = EXCLUDED.suscripcion_id,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
     RETURNING *`,
    [
      Number(companyId),
      subscriptionId ? Number(subscriptionId) : null,
      Number(wompiPaymentSource.id),
      customerEmail,
      type,
      status,
      makeDefault === true,
      publicData ? JSON.stringify(publicData) : (wompiPaymentSource.public_data ? JSON.stringify(wompiPaymentSource.public_data) : null),
      metadata ? JSON.stringify(metadata) : null,
      actor?.id || null,
    ]
  );

  return rows[0];
}

async function setDefaultStoredPaymentSource(empresaId, paymentSourceId, actor = null) {
  return withTransaction(async (client) => {
    const source = await getStoredPaymentSourceById(paymentSourceId, empresaId, client);
    if (!source) {
      throw new AppError('Fuente de pago Wompi no encontrada para esta empresa.', 404);
    }
    if (source.provider !== WOMPI_PROVIDER) {
      throw new AppError('La fuente de pago no corresponde a Wompi.', 400);
    }

    await client.query(
      `UPDATE billing_customer_payment_sources
       SET is_default = FALSE, updated_by = $2, updated_at = NOW()
       WHERE empresa_id = $1
         AND provider = 'WOMPI'`,
      [Number(empresaId), actor?.id || null]
    );

    const { rows } = await client.query(
      `UPDATE billing_customer_payment_sources
       SET is_default = TRUE, updated_by = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [Number(paymentSourceId), actor?.id || null]
    );

    return rows[0];
  });
}

async function updateAttemptFromTransaction({
  attemptId,
  transaction,
  status = null,
  queryable = db,
}) {
  const nextStatus = status || mapWompiStatusToAttempt(transaction?.status);
  const { rows } = await queryable.query(
    `UPDATE billing_payment_attempts
     SET external_attempt_id = COALESCE($2, external_attempt_id),
         external_payment_id = COALESCE($3, external_payment_id),
         estado = $4,
         failure_message = CASE WHEN $4 = 'FAILED' THEN COALESCE($5, failure_message) ELSE failure_message END,
         response_payload = COALESCE($6::jsonb, response_payload),
         metadata = COALESCE(metadata, '{}'::jsonb) || $7::jsonb
     WHERE id = $1
     RETURNING *`,
    [
      Number(attemptId),
      transaction?.id || null,
      transaction?.id || null,
      nextStatus,
      transaction?.status_message || null,
      transaction ? JSON.stringify(transaction) : null,
      JSON.stringify({
        wompi_reference: transaction?.reference || null,
        wompi_status: transaction?.status || null,
        wompi_payment_method_type: transaction?.payment_method_type || null,
      }),
    ]
  );
  return rows[0] || null;
}

async function findAttemptByWompiTransaction({ transactionId = null, reference = null }, queryable = db) {
  if (transactionId) {
    const { rows } = await queryable.query(
      `SELECT *
       FROM billing_payment_attempts
       WHERE provider = 'WOMPI'
         AND (external_attempt_id = $1 OR external_payment_id = $1)
       ORDER BY id DESC
       LIMIT 1`,
      [String(transactionId)]
    );
    if (rows.length) return rows[0];
  }

  if (reference) {
    const { rows } = await queryable.query(
      `SELECT *
       FROM billing_payment_attempts
       WHERE provider = 'WOMPI'
         AND metadata->>'wompi_reference' = $1
       ORDER BY id DESC
       LIMIT 1`,
      [String(reference)]
    );
    if (rows.length) return rows[0];
  }

  return null;
}

async function ensureAttemptForTransaction(transaction, actor = null, invoiceId = null, queryable = db) {
  const existing = await findAttemptByWompiTransaction({
    transactionId: transaction?.id || null,
    reference: transaction?.reference || null,
  }, queryable);
  if (existing) {
    return updateAttemptFromTransaction({
      attemptId: existing.id,
      transaction,
      queryable,
    });
  }

  const parsedInvoiceId = invoiceId || parseInvoiceIdFromReference(transaction?.reference || '');
  if (!parsedInvoiceId) {
    return null;
  }

  const created = await billingService.createPaymentAttempt(parsedInvoiceId, {
    provider: WOMPI_PROVIDER,
    mode: 'WEBHOOK',
    estado: mapWompiStatusToAttempt(transaction?.status),
    amount: centsToAmount(transaction?.amount_in_cents),
    currency: transaction?.currency || 'COP',
    external_attempt_id: transaction?.id || null,
    external_payment_id: transaction?.id || null,
    failure_message: transaction?.status_message || null,
    response_payload: transaction,
    metadata: {
      wompi_reference: transaction?.reference || null,
      wompi_status: transaction?.status || null,
      wompi_payment_method_type: transaction?.payment_method_type || null,
      wompi_created_from: 'webhook',
    },
  }, actor, {}, queryable);

  return created;
}

async function insertOrReuseConfirmedPayment({
  invoiceId,
  attemptId,
  transaction,
  actor = null,
}, queryable = db) {
  const idempotencyKey = `wompi:transaction:${transaction.id}`;
  const existing = await queryable.query(
    `SELECT *
     FROM billing_payments
     WHERE idempotency_key = $1
        OR external_payment_id = $2
     ORDER BY id DESC
     LIMIT 1`,
    [idempotencyKey, transaction.id]
  );

  if (existing.rows.length) {
    return existing.rows[0];
  }

  const invoice = await billingService.getInvoice(Number(invoiceId), queryable);
  const amount = centsToAmount(transaction.amount_in_cents);
  const { rows } = await queryable.query(
    `INSERT INTO billing_payments (
       invoice_id, payment_attempt_id, empresa_id, suscripcion_id, provider, payment_method,
       estado, amount, currency, idempotency_key, external_payment_id,
       referencia_externa, paid_at, metadata, created_by
     )
     VALUES (
       $1, $2, $3, $4, 'WOMPI', $5,
       'CONFIRMED', $6, $7, $8, $9,
       $10, COALESCE($11::timestamptz, NOW()), $12::jsonb, $13
     )
     RETURNING *`,
    [
      Number(invoice.id),
      attemptId ? Number(attemptId) : null,
      Number(invoice.empresa_id),
      invoice.suscripcion_id ? Number(invoice.suscripcion_id) : null,
      mapWompiPaymentMethod(transaction.payment_method_type),
      amount,
      transaction.currency || 'COP',
      idempotencyKey,
      transaction.id,
      transaction.reference || null,
      transaction.finalized_at || transaction.created_at || null,
      JSON.stringify({
        wompi_transaction: transaction,
      }),
      actor?.id || null,
    ]
  );

  const updatedInvoice = await billingService.recalculateInvoiceState(queryable, invoice.id);
  if (updatedInvoice.estado === 'PAID') {
    await billingService.syncSubscriptionAfterInvoiceSettlement(queryable, updatedInvoice);
  }

  return rows[0];
}

async function voidPaymentForTransaction(transactionId, queryable = db) {
  const { rows } = await queryable.query(
    `UPDATE billing_payments
     SET estado = 'VOIDED',
         metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
     WHERE external_payment_id = $1
       AND estado = 'CONFIRMED'
     RETURNING *`,
    [
      String(transactionId),
      JSON.stringify({ wompi_status: 'VOIDED' }),
    ]
  );
  if (!rows.length) return null;
  await billingService.recalculateInvoiceState(queryable, rows[0].invoice_id);
  return rows[0];
}

async function applyWompiTransactionToBilling(transaction, actor = null, invoiceId = null) {
  const normalizedTransaction = transaction?.data ? transaction.data : transaction;
  if (!normalizedTransaction?.id) {
    throw new AppError('La transacción de Wompi no contiene un id válido.', 400);
  }

  return withTransaction(async (client) => {
    const attempt = await ensureAttemptForTransaction(normalizedTransaction, actor, invoiceId, client);
    let payment = null;

    if (normalizeStatus(normalizedTransaction.status) === 'APPROVED') {
      const targetInvoiceId = attempt?.invoice_id || invoiceId || parseInvoiceIdFromReference(normalizedTransaction.reference);
      if (!targetInvoiceId) {
        throw new AppError('No fue posible asociar la transacción aprobada a una factura AutoGestion360.', 409);
      }
      payment = await insertOrReuseConfirmedPayment({
        invoiceId: targetInvoiceId,
        attemptId: attempt?.id || null,
        transaction: normalizedTransaction,
        actor,
      }, client);
    } else if (normalizeStatus(normalizedTransaction.status) === 'VOIDED') {
      await voidPaymentForTransaction(normalizedTransaction.id, client);
    }

    const targetInvoiceId = attempt?.invoice_id || invoiceId || parseInvoiceIdFromReference(normalizedTransaction.reference);
    const invoice = targetInvoiceId ? await billingService.getInvoice(targetInvoiceId, client) : null;

    return {
      attempt,
      payment,
      invoice,
      transaction: normalizedTransaction,
    };
  });
}

async function getMerchantInfo({ forceRefresh = false } = {}) {
  const config = assertWompiConfig(['publicKey']);
  const response = await wompiRequest('GET', `/merchants/${config.publicKey}`, { auth: 'none' });
  const merchant = response?.data || {};

  return {
    provider: WOMPI_PROVIDER,
    environment: config.environment,
    public_key: config.publicKey,
    checkout_url: config.checkoutUrl,
    redirect_url: config.redirectUrl,
    force_refresh: forceRefresh === true,
    merchant: {
      id: merchant.id || null,
      name: merchant.name || merchant.legal_name || null,
      email: merchant.email || null,
    },
    acceptance: {
      acceptance_token: merchant.presigned_acceptance?.acceptance_token || null,
      acceptance_permalink: merchant.presigned_acceptance?.permalink || null,
      personal_auth_token: merchant.presigned_personal_data_auth?.acceptance_token || null,
      personal_auth_permalink: merchant.presigned_personal_data_auth?.permalink || null,
    },
  };
}

async function createCheckoutSession(invoiceId, body = {}, actor = null, context = {}) {
  const config = assertWompiConfig(['publicKey', 'integritySecret']);
  const invoice = await getInvoiceContext(invoiceId);
  const reference = buildWompiReference(invoice.id, 'CHK');
  const amountInCents = amountToCents(invoice.saldo_pendiente);
  const expirationTime = body.expiration_time || null;
  const signature = buildIntegritySignature({
    reference,
    amountInCents,
    currency: 'COP',
    expirationTime,
    integritySecret: config.integritySecret,
  });

  const paymentAttempt = await billingService.createPaymentAttempt(invoice.id, {
    provider: WOMPI_PROVIDER,
    mode: 'WEBHOOK',
    estado: 'PENDING',
    amount: invoice.saldo_pendiente,
    currency: 'COP',
    metadata: {
      wompi_reference: reference,
      wompi_checkout_url: config.checkoutUrl,
      wompi_redirect_url: body.redirect_url || config.redirectUrl || null,
      wompi_checkout_customer_email: body.customer_email,
      wompi_checkout_customer_data: body.customer_data || null,
      ...(body.metadata || {}),
    },
  }, actor, {
    idempotencyKey: context.idempotencyKey || `wompi:checkout:${invoice.id}:${reference}`,
  });

  await recordSecurityEventSafe({
    empresaId: invoice.empresa_id,
    usuarioId: actor?.id ?? null,
    accion: 'BILLING_WOMPI_CHECKOUT_CREATED',
    entidad: 'billing_payment_attempt',
    entidadId: paymentAttempt.id,
    detalle: {
      modulo: 'billing',
      provider: WOMPI_PROVIDER,
      invoice_id: invoice.id,
      wompi_reference: reference,
    },
  });

  return {
    provider: WOMPI_PROVIDER,
    environment: config.environment,
    checkout_url: config.checkoutUrl,
    attempt_id: paymentAttempt.id,
    invoice_id: invoice.id,
    public_key: config.publicKey,
    currency: 'COP',
    amount_in_cents: amountInCents,
    reference,
    signature: {
      integrity: signature,
    },
    redirect_url: body.redirect_url || config.redirectUrl || null,
    expiration_time: expirationTime,
    customer_data: {
      email: body.customer_email,
      ...(body.customer_data || {}),
    },
  };
}

async function createPaymentSource(empresaId, body = {}, actor = null) {
  const config = assertWompiConfig(['privateKey']);
  const subscription = await getSubscriptionSnapshot(empresaId);
  if (!subscription) {
    throw new AppError('No existe una suscripción oficial para la empresa indicada.', 404);
  }

  const response = await wompiRequest('POST', '/payment_sources', {
    auth: 'private',
    body: {
      type: body.type,
      token: body.token,
      customer_email: body.customer_email,
      acceptance_token: body.acceptance_token,
      accept_personal_auth: body.accept_personal_auth,
    },
  });

  const wompiPaymentSource = response?.data || response;
  const storedSource = await withTransaction(async (client) => upsertStoredPaymentSource({
    companyId: empresaId,
    subscriptionId: subscription.id,
    wompiPaymentSource,
    customerEmail: body.customer_email,
    type: body.type,
    makeDefault: body.make_default !== false,
    publicData: body.public_data || wompiPaymentSource.public_data || null,
    metadata: body.metadata || null,
    actor,
  }, client));

  await recordSecurityEventSafe({
    empresaId: Number(empresaId),
    usuarioId: actor?.id ?? null,
    accion: 'BILLING_WOMPI_PAYMENT_SOURCE_CREATED',
    entidad: 'billing_customer_payment_source',
    entidadId: storedSource.id,
    detalle: {
      modulo: 'billing',
      provider: WOMPI_PROVIDER,
      provider_payment_source_id: storedSource.provider_payment_source_id,
      type: storedSource.type,
    },
  });

  return {
    environment: config.environment,
    stored_source: storedSource,
    provider_source: wompiPaymentSource,
  };
}

async function listPaymentSources(empresaId) {
  return listStoredPaymentSources(empresaId);
}

async function createTransactionForInvoice(invoiceId, body = {}, actor = null, context = {}) {
  const config = assertWompiConfig(['privateKey', 'integritySecret']);
  const invoice = await getInvoiceContext(invoiceId);
  const storedSource = body.stored_source_id
    ? await getStoredPaymentSourceById(body.stored_source_id, invoice.empresa_id)
    : await getDefaultPaymentSourceForEmpresa(invoice.empresa_id);

  if (!storedSource) {
    throw new AppError('No existe una fuente de pago Wompi activa para esta empresa.', 404);
  }

  if (storedSource.status !== 'ACTIVE') {
    throw new AppError('La fuente de pago Wompi seleccionada no está activa.', 409);
  }

  const reference = buildWompiReference(invoice.id, 'AUT');
  const amountInCents = amountToCents(invoice.saldo_pendiente);
  const merchant = await getMerchantInfo();
  const acceptanceToken = body.acceptance_token || merchant.acceptance?.acceptance_token;
  if (!acceptanceToken) {
    throw new AppError('No fue posible obtener acceptance_token de Wompi para crear la transacción.', 502);
  }
  const signature = buildIntegritySignature({
    reference,
    amountInCents,
    currency: 'COP',
    integritySecret: config.integritySecret,
  });

  const paymentAttempt = await billingService.createPaymentAttempt(invoice.id, {
    provider: WOMPI_PROVIDER,
    mode: 'AUTOMATIC',
    estado: 'PROCESSING',
    amount: invoice.saldo_pendiente,
    currency: 'COP',
    metadata: {
      wompi_reference: reference,
      wompi_stored_source_id: storedSource.id,
      wompi_provider_payment_source_id: storedSource.provider_payment_source_id,
      ...(body.metadata || {}),
    },
  }, actor, {
    idempotencyKey: context.idempotencyKey || `wompi:transaction:${invoice.id}:${reference}`,
  });

  const requestBody = {
    amount_in_cents: amountInCents,
    currency: 'COP',
    customer_email: body.customer_email || storedSource.customer_email,
    payment_source_id: storedSource.provider_payment_source_id,
    reference,
    signature,
    acceptance_token: acceptanceToken,
  };

  if (body.installments) {
    requestBody.payment_method = {
      installments: Number(body.installments),
    };
  }

  if (body.recurrent === true) {
    requestBody.recurrent = true;
  }

  if (body.redirect_url || config.redirectUrl) {
    requestBody.redirect_url = body.redirect_url || config.redirectUrl;
  }

  const transactionResponse = await wompiRequest('POST', '/transactions', {
    auth: 'private',
    body: requestBody,
  });

  const result = await applyWompiTransactionToBilling(transactionResponse, actor, invoice.id);
  await updateAttemptFromTransaction({
    attemptId: paymentAttempt.id,
    transaction: result.transaction,
    queryable: db,
  });

  await recordSecurityEventSafe({
    empresaId: invoice.empresa_id,
    usuarioId: actor?.id ?? null,
    accion: 'BILLING_WOMPI_TRANSACTION_CREATED',
    entidad: 'billing_payment_attempt',
    entidadId: paymentAttempt.id,
    detalle: {
      modulo: 'billing',
      provider: WOMPI_PROVIDER,
      invoice_id: invoice.id,
      transaction_id: result.transaction.id,
      reference,
      status: result.transaction.status,
    },
  });

  return {
    attempt: await findAttemptByWompiTransaction({ transactionId: result.transaction.id }, db),
    invoice: result.invoice || await billingService.getInvoice(invoice.id),
    payment: result.payment || null,
    transaction: result.transaction,
    stored_source: storedSource,
  };
}

async function createSandboxCardTransactionForInvoice(invoiceId, body = {}, actor = null, context = {}) {
  const config = assertWompiConfig(['publicKey', 'privateKey', 'integritySecret']);
  if (config.environment !== 'sandbox' || process.env.NODE_ENV === 'production') {
    throw new AppError('La transacción sandbox con tarjeta de prueba solo está disponible en WOMPI_ENV=sandbox y fuera de producción.', 403);
  }

  const invoice = await getInvoiceContext(invoiceId);
  const merchant = await getMerchantInfo();
  const acceptanceToken = body.acceptance_token || merchant.acceptance?.acceptance_token;
  if (!acceptanceToken) {
    throw new AppError('No fue posible obtener acceptance_token de Wompi para la transacción sandbox.', 502);
  }

  const tokenResponse = await wompiRequest('POST', '/tokens/cards', {
    auth: 'public',
    body: {
      number: body.card_number || '4242424242424242',
      exp_month: body.exp_month || '06',
      exp_year: body.exp_year || '29',
      cvc: body.cvc || '123',
      card_holder: body.card_holder || 'AutoGestion360 Sandbox',
    },
  });
  const cardToken = tokenResponse?.data || tokenResponse;
  if (!cardToken?.id) {
    throw new AppError('Wompi no devolvió token de tarjeta sandbox.', 502);
  }

  const reference = buildWompiReference(invoice.id, 'SBX');
  const amountInCents = amountToCents(invoice.saldo_pendiente);
  const signature = buildIntegritySignature({
    reference,
    amountInCents,
    currency: 'COP',
    integritySecret: config.integritySecret,
  });

  const paymentAttempt = await billingService.createPaymentAttempt(invoice.id, {
    provider: WOMPI_PROVIDER,
    mode: 'AUTOMATIC',
    estado: 'PROCESSING',
    amount: invoice.saldo_pendiente,
    currency: 'COP',
    metadata: {
      wompi_reference: reference,
      wompi_sandbox_card: true,
      wompi_card_brand: cardToken.brand || null,
      wompi_card_last_four: cardToken.last_four || null,
      wompi_card_token_id: cardToken.id,
      ...(body.metadata || {}),
    },
  }, actor, {
    idempotencyKey: context.idempotencyKey || `wompi:sandbox-card:${invoice.id}:${reference}`,
  });

  const transactionResponse = await wompiRequest('POST', '/transactions', {
    auth: 'private',
    body: {
      amount_in_cents: amountInCents,
      currency: 'COP',
      customer_email: body.customer_email,
      payment_method: {
        type: 'CARD',
        token: cardToken.id,
        installments: Number(body.installments || 1),
      },
      payment_method_type: 'CARD',
      reference,
      signature,
      acceptance_token: acceptanceToken,
      ...(body.redirect_url || config.redirectUrl ? { redirect_url: body.redirect_url || config.redirectUrl } : {}),
      ...(body.customer_data ? { customer_data: body.customer_data } : {}),
    },
  });

  const result = await applyWompiTransactionToBilling(transactionResponse, actor, invoice.id);
  await updateAttemptFromTransaction({
    attemptId: paymentAttempt.id,
    transaction: result.transaction,
    queryable: db,
  });

  await recordSecurityEventSafe({
    empresaId: invoice.empresa_id,
    usuarioId: actor?.id ?? null,
    accion: 'BILLING_WOMPI_SANDBOX_CARD_TRANSACTION_CREATED',
    entidad: 'billing_payment_attempt',
    entidadId: paymentAttempt.id,
    detalle: {
      modulo: 'billing',
      provider: WOMPI_PROVIDER,
      invoice_id: invoice.id,
      transaction_id: result.transaction.id,
      reference,
      status: result.transaction.status,
    },
  });

  return {
    attempt: await findAttemptByWompiTransaction({ transactionId: result.transaction.id }, db),
    invoice: result.invoice || await billingService.getInvoice(invoice.id),
    payment: result.payment || null,
    transaction: result.transaction,
    card: {
      brand: cardToken.brand || null,
      last_four: cardToken.last_four || null,
      name: cardToken.name || null,
    },
  };
}

async function syncTransactionStatus(invoiceId, body = {}, actor = null) {
  assertWompiConfig(['publicKey']);
  const invoice = await getInvoiceContext(invoiceId);

  let transactionId = body.transaction_id || null;
  if (!transactionId && body.attempt_id) {
    const attempt = await db.query(
      `SELECT * FROM billing_payment_attempts WHERE id = $1 AND invoice_id = $2 LIMIT 1`,
      [Number(body.attempt_id), Number(invoice.id)]
    );
    if (!attempt.rows.length) {
      throw new AppError('Intento de pago no encontrado para la factura indicada.', 404);
    }
    transactionId = attempt.rows[0].external_attempt_id || attempt.rows[0].external_payment_id || null;
  }

  if (!transactionId) {
    throw new AppError('Debes enviar transaction_id o attempt_id con una transacción Wompi asociada.', 400);
  }

  const response = await wompiRequest('GET', `/transactions/${encodeURIComponent(transactionId)}`, {
    auth: 'public',
  });
  const result = await applyWompiTransactionToBilling(response, actor, invoice.id);

  await recordSecurityEventSafe({
    empresaId: invoice.empresa_id,
    usuarioId: actor?.id ?? null,
    accion: 'BILLING_WOMPI_TRANSACTION_SYNCED',
    entidad: 'billing_invoice',
    entidadId: invoice.id,
    detalle: {
      modulo: 'billing',
      provider: WOMPI_PROVIDER,
      transaction_id: result.transaction.id,
      status: result.transaction.status,
    },
  });

  return result;
}

async function processWebhookRecord(webhookRecordId) {
  const { rows } = await db.query(
    `SELECT *
     FROM billing_webhook_events
     WHERE id = $1
     LIMIT 1`,
    [Number(webhookRecordId)]
  );
  if (!rows.length) {
    throw new AppError('Webhook Wompi no encontrado.', 404);
  }

  const record = rows[0];
  const payload = record.payload || {};
  const headers = record.headers || {};
  const validation = validateWompiEventSignature(payload, headers);

  if (validation.valid === false) {
    const { rows: updatedRows } = await db.query(
      `UPDATE billing_webhook_events
       SET estado = 'FAILED',
           signature_valid = FALSE,
           error_message = $2,
           last_processed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        Number(record.id),
        `Checksum inválido. Esperado ${validation.expectedChecksum}, recibido ${validation.checksum || 'N/D'}.`,
      ]
    );
    return updatedRows[0];
  }

  if (record.event_type !== 'transaction.updated') {
    const { rows: updatedRows } = await db.query(
      `UPDATE billing_webhook_events
       SET estado = 'IGNORED',
           signature_valid = COALESCE($2, signature_valid),
           last_processed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [Number(record.id), validation.valid]
    );
    return updatedRows[0];
  }

  const transaction = payload?.data?.transaction || null;
  if (!transaction?.id) {
    const { rows: updatedRows } = await db.query(
      `UPDATE billing_webhook_events
       SET estado = 'FAILED',
           signature_valid = COALESCE($2, signature_valid),
           error_message = 'El payload no contiene data.transaction.id.',
           last_processed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [Number(record.id), validation.valid]
    );
    return updatedRows[0];
  }

  let applied = null;
  try {
    applied = await applyWompiTransactionToBilling(transaction, null, null);
  } catch (error) {
    const { rows: updatedRows } = await db.query(
      `UPDATE billing_webhook_events
       SET estado = 'FAILED',
           signature_valid = COALESCE($2, signature_valid),
           error_message = $3,
           last_processed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        Number(record.id),
        validation.valid,
        error.message || 'No fue posible aterrizar la transacción Wompi en billing.',
      ]
    );
    return updatedRows[0];
  }
  const finalStatus = FINAL_WOMPI_STATUSES.has(normalizeStatus(transaction.status)) ? 'PROCESSED' : 'RECEIVED';

  const { rows: updatedRows } = await db.query(
    `UPDATE billing_webhook_events
     SET estado = $2,
         signature_valid = COALESCE($3, signature_valid),
         related_invoice_id = COALESCE($4, related_invoice_id),
         related_attempt_id = COALESCE($5, related_attempt_id),
         error_message = NULL,
         last_processed_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      Number(record.id),
      finalStatus,
      validation.valid,
      applied.invoice?.id || null,
      applied.attempt?.id || null,
    ]
  );

  await recordSecurityEventSafe({
    empresaId: applied.invoice?.empresa_id ?? null,
    usuarioId: null,
    accion: 'BILLING_WOMPI_WEBHOOK_PROCESSED',
    entidad: 'billing_webhook_event',
    entidadId: record.id,
    detalle: {
      modulo: 'billing',
      provider: WOMPI_PROVIDER,
      transaction_id: transaction.id,
      transaction_status: transaction.status,
      invoice_id: applied.invoice?.id || null,
      attempt_id: applied.attempt?.id || null,
      payment_id: applied.payment?.id || null,
    },
  });

  return updatedRows[0];
}

module.exports = {
  buildWompiEventChecksum,
  createCheckoutSession,
  createPaymentSource,
  createSandboxCardTransactionForInvoice,
  createTransactionForInvoice,
  getWompiConfig,
  getMerchantInfo,
  listPaymentSources,
  processWebhookRecord,
  setDefaultStoredPaymentSource,
  syncTransactionStatus,
  validateWompiEventSignature,
};
