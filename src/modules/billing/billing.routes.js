'use strict';

const express = require('express');

const ctrl = require('./billing.controller');
const validate = require('../../middlewares/validate');
const { adminMutationLimiter } = require('../../lib/security/rate-limit');
const {
  createCreditNoteBodySchema,
  createInvoiceBodySchema,
  createPaymentAttemptBodySchema,
  createRenewalInvoiceBodySchema,
  createWompiCheckoutSessionBodySchema,
  createWompiPaymentSourceBodySchema,
  createWompiSandboxCardTransactionBodySchema,
  createWompiTransactionBodySchema,
  getWompiMerchantQuerySchema,
  invoiceIdParamSchema,
  listInvoicesQuerySchema,
  listWebhooksQuerySchema,
  paymentSourceIdParamSchema,
  registerManualPaymentBodySchema,
  setDefaultWompiSourceBodySchema,
  syncWompiTransactionBodySchema,
  subscriptionEmpresaParamSchema,
  voidInvoiceBodySchema,
  webhookIdParamSchema,
} = require('../../lib/validation/billing.schemas');

const router = express.Router();

router.use(ctrl.requirePlatformBillingAdmin);

router.get('/providers/wompi/merchant', validate({ query: getWompiMerchantQuerySchema }), ctrl.getWompiMerchant);
router.get('/invoices', validate({ query: listInvoicesQuerySchema }), ctrl.listarFacturas);
router.get('/invoices/:invoiceId', validate({ params: invoiceIdParamSchema }), ctrl.obtenerFactura);
router.post('/invoices', adminMutationLimiter, validate({ body: createInvoiceBodySchema }), ctrl.crearFactura);
router.post(
  '/invoices/:invoiceId/providers/wompi/checkout-session',
  adminMutationLimiter,
  validate({ params: invoiceIdParamSchema, body: createWompiCheckoutSessionBodySchema }),
  ctrl.crearWompiCheckoutSession
);
router.post(
  '/invoices/:invoiceId/providers/wompi/transactions',
  adminMutationLimiter,
  validate({ params: invoiceIdParamSchema, body: createWompiTransactionBodySchema }),
  ctrl.crearWompiTransaction
);
router.post(
  '/invoices/:invoiceId/providers/wompi/sandbox/card-transaction',
  adminMutationLimiter,
  validate({ params: invoiceIdParamSchema, body: createWompiSandboxCardTransactionBodySchema }),
  ctrl.crearWompiSandboxCardTransaction
);
router.post(
  '/invoices/:invoiceId/providers/wompi/sync',
  adminMutationLimiter,
  validate({ params: invoiceIdParamSchema, body: syncWompiTransactionBodySchema }),
  ctrl.syncWompiTransaction
);
router.post(
  '/subscriptions/:empresaId/invoices/renewal',
  adminMutationLimiter,
  validate({ params: subscriptionEmpresaParamSchema, body: createRenewalInvoiceBodySchema }),
  ctrl.crearFacturaRenovacion
);
router.post(
  '/invoices/:invoiceId/attempts',
  adminMutationLimiter,
  validate({ params: invoiceIdParamSchema, body: createPaymentAttemptBodySchema }),
  ctrl.crearIntentoPago
);
router.post(
  '/invoices/:invoiceId/payments/manual',
  adminMutationLimiter,
  validate({ params: invoiceIdParamSchema, body: registerManualPaymentBodySchema }),
  ctrl.registrarPagoManual
);
router.post(
  '/invoices/:invoiceId/void',
  adminMutationLimiter,
  validate({ params: invoiceIdParamSchema, body: voidInvoiceBodySchema }),
  ctrl.anularFactura
);
router.post(
  '/invoices/:invoiceId/credit-notes',
  adminMutationLimiter,
  validate({ params: invoiceIdParamSchema, body: createCreditNoteBodySchema }),
  ctrl.crearNotaCredito
);
router.get(
  '/subscriptions/:empresaId/ledger',
  validate({ params: subscriptionEmpresaParamSchema }),
  ctrl.getLedgerSuscripcion
);
router.get(
  '/subscriptions/:empresaId/providers/wompi/payment-sources',
  validate({ params: subscriptionEmpresaParamSchema }),
  ctrl.listarWompiPaymentSources
);
router.post(
  '/subscriptions/:empresaId/providers/wompi/payment-sources',
  adminMutationLimiter,
  validate({ params: subscriptionEmpresaParamSchema, body: createWompiPaymentSourceBodySchema }),
  ctrl.crearWompiPaymentSource
);
router.patch(
  '/subscriptions/:empresaId/providers/wompi/payment-sources/:paymentSourceId/default',
  adminMutationLimiter,
  validate({ params: subscriptionEmpresaParamSchema.merge(paymentSourceIdParamSchema), body: setDefaultWompiSourceBodySchema }),
  ctrl.setDefaultWompiPaymentSource
);
router.get('/webhooks', validate({ query: listWebhooksQuerySchema }), ctrl.listarWebhooks);
router.get('/webhooks/:webhookId', validate({ params: webhookIdParamSchema }), ctrl.getWebhook);

module.exports = router;
