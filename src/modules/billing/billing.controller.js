'use strict';

const service = require('./billing.service');
const billingJobs = require('./billing.jobs');
const wompiService = require('./providers/wompi.service');
const {
  recordSecurityEventSafe,
  resolveRequestIp,
  resolveUserAgent,
} = require('../../lib/security/audit');

const wrap = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (error) {
    next(error);
  }
};

function resolveIdempotencyKey(req) {
  const headerValue = req.get('Idempotency-Key') || req.get('X-Idempotency-Key') || null;
  if (!headerValue) return null;
  const normalized = String(headerValue).trim();
  return normalized || null;
}

function hasBillingPermission(user, permission) {
  const permisos = Array.isArray(user?.permisos) ? user.permisos : [];
  return permisos.includes('*') || permisos.includes(permission);
}

async function requirePlatformBillingAdmin(req, res, next) {
  if (req.user?.scope === 'platform' && hasBillingPermission(req.user, 'platform:billing:gestionar')) {
    return next();
  }

  await recordSecurityEventSafe({
    empresaId: req.user?.empresa_id ?? null,
    usuarioId: req.user?.id ?? null,
    accion: 'AUTH_ACCESS_DENIED',
    entidad: 'auth_guard',
    detalle: {
      modulo: 'billing',
      razon: req.user?.scope !== 'platform' ? 'PLATFORM_SCOPE_REQUIRED' : 'PLATFORM_BILLING_PERMISSION_REQUIRED',
      path: req.path,
      method: req.method,
      user_agent: resolveUserAgent(req),
    },
    ip: resolveRequestIp(req),
  });

  return res.status(403).json({ error: 'Acceso denegado. Solo administración de billing plataforma.' });
}

const listarFacturas = wrap(async (req, res) => {
  const invoices = await service.listInvoices(req.query);
  res.json(invoices);
});

const obtenerFactura = wrap(async (req, res) => {
  const invoice = await service.getInvoice(req.params.invoiceId);
  res.json(invoice);
});

const crearFactura = wrap(async (req, res) => {
  const invoice = await service.createInvoice(req.body, req.user, {
    idempotencyKey: resolveIdempotencyKey(req),
  });
  res.status(201).json({ mensaje: 'Factura SaaS creada.', invoice });
});

const crearFacturaRenovacion = wrap(async (req, res) => {
  const invoice = await service.createRenewalInvoice(req.params.empresaId, req.body, req.user, {
    idempotencyKey: resolveIdempotencyKey(req),
  });
  res.status(201).json({ mensaje: 'Factura de renovación creada.', invoice });
});

const crearIntentoPago = wrap(async (req, res) => {
  const paymentAttempt = await service.createPaymentAttempt(req.params.invoiceId, req.body, req.user, {
    idempotencyKey: resolveIdempotencyKey(req),
  });
  res.status(201).json({ mensaje: 'Intento de pago registrado.', payment_attempt: paymentAttempt });
});

const registrarPagoManual = wrap(async (req, res) => {
  const result = await service.registerManualPayment(req.params.invoiceId, req.body, req.user, {
    idempotencyKey: resolveIdempotencyKey(req),
  });
  res.status(201).json({ mensaje: 'Pago manual registrado.', ...result });
});

const anularFactura = wrap(async (req, res) => {
  const invoice = await service.voidInvoice(req.params.invoiceId, req.body, req.user);
  res.json({ mensaje: 'Factura anulada.', invoice });
});

const crearNotaCredito = wrap(async (req, res) => {
  const result = await service.createCreditNote(req.params.invoiceId, req.body, req.user, {
    idempotencyKey: resolveIdempotencyKey(req),
  });
  res.status(201).json({ mensaje: 'Nota crédito registrada.', ...result });
});

const getLedgerSuscripcion = wrap(async (req, res) => {
  const ledger = await service.listSubscriptionLedger(req.params.empresaId);
  res.json(ledger);
});

const listarWebhooks = wrap(async (req, res) => {
  const events = await service.listWebhookEvents(req.query);
  res.json(events);
});

const previewJobs = wrap(async (req, res) => {
  const result = await billingJobs.runBillingJobs({
    ...req.query,
    dry_run: true,
  }, req.user);
  res.json(result);
});

const runJobs = wrap(async (req, res) => {
  const result = await billingJobs.runBillingJobs(req.body, req.user);
  res.json({
    mensaje: result.dry_run
      ? 'Preview de jobs de billing ejecutado.'
      : 'Jobs de billing ejecutados.',
    ...result,
  });
});

const getWompiMerchant = wrap(async (req, res) => {
  const merchant = await wompiService.getMerchantInfo({
    forceRefresh: req.query.force_refresh === true,
  });
  res.json(merchant);
});

const crearWompiCheckoutSession = wrap(async (req, res) => {
  const checkout = await wompiService.createCheckoutSession(req.params.invoiceId, req.body, req.user, {
    idempotencyKey: resolveIdempotencyKey(req),
  });
  res.status(201).json({ mensaje: 'Checkout Wompi preparado.', checkout });
});

const crearWompiPaymentSource = wrap(async (req, res) => {
  const result = await wompiService.createPaymentSource(req.params.empresaId, req.body, req.user);
  res.status(201).json({ mensaje: 'Fuente de pago Wompi registrada.', ...result });
});

const listarWompiPaymentSources = wrap(async (req, res) => {
  const sources = await wompiService.listPaymentSources(req.params.empresaId);
  res.json(sources);
});

const setDefaultWompiPaymentSource = wrap(async (req, res) => {
  const source = await wompiService.setDefaultStoredPaymentSource(req.params.empresaId, req.params.paymentSourceId, req.user);
  res.json({ mensaje: 'Fuente predeterminada Wompi actualizada.', stored_source: source });
});

const crearWompiTransaction = wrap(async (req, res) => {
  const result = await wompiService.createTransactionForInvoice(req.params.invoiceId, req.body, req.user, {
    idempotencyKey: resolveIdempotencyKey(req),
  });
  res.status(201).json({ mensaje: 'Transacción Wompi creada.', ...result });
});

const crearWompiSandboxCardTransaction = wrap(async (req, res) => {
  const result = await wompiService.createSandboxCardTransactionForInvoice(req.params.invoiceId, req.body, req.user, {
    idempotencyKey: resolveIdempotencyKey(req),
  });
  res.status(201).json({ mensaje: 'Transacción sandbox Wompi creada.', ...result });
});

const syncWompiTransaction = wrap(async (req, res) => {
  const result = await wompiService.syncTransactionStatus(req.params.invoiceId, req.body, req.user);
  res.json({ mensaje: 'Estado Wompi sincronizado.', ...result });
});

const getWebhook = wrap(async (req, res) => {
  const event = await service.getWebhookEvent(req.params.webhookId);
  res.json(event);
});

const recibirWebhook = wrap(async (req, res) => {
  const event = await service.recordWebhook(req.params.provider, req.body, req.headers);
  const provider = String(req.params.provider || '').trim().toUpperCase();
  const processedEvent = provider === 'WOMPI'
    ? await wompiService.processWebhookRecord(event.id)
    : event;

  res.status(200).json({
    mensaje: 'Webhook recibido.',
    webhook: {
      id: processedEvent.id,
      provider: processedEvent.provider,
      external_event_id: processedEvent.external_event_id,
      estado: processedEvent.estado,
    },
  });
});

module.exports = {
  anularFactura,
  crearFactura,
  crearFacturaRenovacion,
  crearIntentoPago,
  crearNotaCredito,
  crearWompiCheckoutSession,
  crearWompiPaymentSource,
  crearWompiSandboxCardTransaction,
  crearWompiTransaction,
  getLedgerSuscripcion,
  getWebhook,
  getWompiMerchant,
  listarFacturas,
  listarWebhooks,
  listarWompiPaymentSources,
  obtenerFactura,
  previewJobs,
  recibirWebhook,
  registrarPagoManual,
  requirePlatformBillingAdmin,
  runJobs,
  setDefaultWompiPaymentSource,
  syncWompiTransaction,
};
