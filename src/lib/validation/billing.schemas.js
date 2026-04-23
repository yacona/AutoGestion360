'use strict';

const {
  z,
  nullableDateString,
  nullableTrimmedString,
  optionalNullableNumberFromUnknown,
  optionalBooleanFromUnknown,
  optionalPositiveIntFromUnknown,
  optionalTrimmedString,
  positiveIntFromUnknown,
} = require('./common');

const invoiceStatusSchema = z.enum([
  'DRAFT',
  'OPEN',
  'OVERDUE',
  'PARTIALLY_PAID',
  'PAID',
  'VOID',
  'UNCOLLECTIBLE',
  'CREDITED',
  'REFUNDED',
]);

const invoiceReasonSchema = z.enum([
  'SUBSCRIPTION_RENEWAL',
  'SUBSCRIPTION_REACTIVATION',
  'PLAN_CHANGE',
  'MANUAL_ADJUSTMENT',
  'ADDON',
  'LEGACY_IMPORT',
]);

const collectionMethodSchema = z.enum(['MANUAL', 'AUTOMATIC']);

const paymentAttemptStatusSchema = z.enum([
  'CREATED',
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'CANCELED',
  'EXPIRED',
  'IGNORED',
]);

const paymentMethodSchema = z.enum([
  'EFECTIVO',
  'TRANSFERENCIA',
  'TARJETA',
  'PSE',
  'ACH',
  'NEQUI',
  'DAVIPLATA',
  'WOMPI',
  'STRIPE',
  'PAYU',
  'OTRO',
]);

const creditNoteStatusSchema = z.enum(['DRAFT', 'ISSUED', 'APPLIED', 'VOID']);

const webhookStatusSchema = z.enum(['RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED']);

const invoiceIdParamSchema = z.object({
  invoiceId: positiveIntFromUnknown,
});

const webhookIdParamSchema = z.object({
  webhookId: positiveIntFromUnknown,
});

const providerParamSchema = z.object({
  provider: z.string().trim().min(2).max(30),
});

const subscriptionEmpresaParamSchema = z.object({
  empresaId: positiveIntFromUnknown,
});

const paymentSourceIdParamSchema = z.object({
  paymentSourceId: positiveIntFromUnknown,
});

const listInvoicesQuerySchema = z.object({
  empresa_id: optionalPositiveIntFromUnknown,
  suscripcion_id: optionalPositiveIntFromUnknown,
  estado: invoiceStatusSchema.optional(),
  pasarela: optionalTrimmedString,
  limit: optionalPositiveIntFromUnknown,
});

const createInvoiceBodySchema = z.object({
  empresa_id: positiveIntFromUnknown,
  suscripcion_id: optionalPositiveIntFromUnknown,
  numero_factura: nullableTrimmedString.optional(),
  motivo: invoiceReasonSchema.optional(),
  collection_method: collectionMethodSchema.optional(),
  moneda: optionalTrimmedString,
  subtotal: optionalNullableNumberFromUnknown,
  monto_impuestos: optionalNullableNumberFromUnknown,
  monto_descuento: optionalNullableNumberFromUnknown,
  total: optionalNullableNumberFromUnknown,
  periodo_inicio: nullableDateString.optional(),
  periodo_fin: nullableDateString.optional(),
  emitida_en: nullableDateString.optional(),
  vencimiento_en: nullableDateString.optional(),
  pasarela: optionalTrimmedString,
  external_customer_id: nullableTrimmedString.optional(),
  external_invoice_id: nullableTrimmedString.optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  idempotency_key: nullableTrimmedString.optional(),
});

const createRenewalInvoiceBodySchema = z.object({
  dias: optionalPositiveIntFromUnknown,
  numero_factura: nullableTrimmedString.optional(),
  motivo: invoiceReasonSchema.optional(),
  collection_method: collectionMethodSchema.optional(),
  subtotal: optionalNullableNumberFromUnknown,
  monto_impuestos: optionalNullableNumberFromUnknown,
  monto_descuento: optionalNullableNumberFromUnknown,
  total: optionalNullableNumberFromUnknown,
  periodo_inicio: nullableDateString.optional(),
  periodo_fin: nullableDateString.optional(),
  emitida_en: nullableDateString.optional(),
  vencimiento_en: nullableDateString.optional(),
  pasarela: optionalTrimmedString,
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  idempotency_key: nullableTrimmedString.optional(),
});

const createPaymentAttemptBodySchema = z.object({
  provider: optionalTrimmedString,
  mode: z.enum(['MANUAL', 'AUTOMATIC', 'WEBHOOK']).optional(),
  estado: paymentAttemptStatusSchema.optional(),
  amount: optionalNullableNumberFromUnknown,
  currency: optionalTrimmedString,
  external_attempt_id: nullableTrimmedString.optional(),
  external_payment_id: nullableTrimmedString.optional(),
  provider_event_id: nullableTrimmedString.optional(),
  failure_code: nullableTrimmedString.optional(),
  failure_message: nullableTrimmedString.optional(),
  next_retry_at: nullableDateString.optional(),
  request_payload: z.record(z.string(), z.unknown()).nullable().optional(),
  response_payload: z.record(z.string(), z.unknown()).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  idempotency_key: nullableTrimmedString.optional(),
});

const registerManualPaymentBodySchema = z.object({
  amount: optionalNullableNumberFromUnknown,
  payment_method: paymentMethodSchema.optional(),
  provider: optionalTrimmedString,
  referencia_externa: nullableTrimmedString.optional(),
  external_payment_id: nullableTrimmedString.optional(),
  paid_at: nullableDateString.optional(),
  reactivar_suscripcion: z.boolean().optional().default(true),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  idempotency_key: nullableTrimmedString.optional(),
});

const voidInvoiceBodySchema = z.object({
  reason: nullableTrimmedString.optional(),
});

const createCreditNoteBodySchema = z.object({
  status: creditNoteStatusSchema.optional(),
  reason_code: optionalTrimmedString,
  reason_text: nullableTrimmedString.optional(),
  subtotal: optionalNullableNumberFromUnknown,
  tax_amount: optionalNullableNumberFromUnknown,
  total_amount: optionalNullableNumberFromUnknown,
  issued_at: nullableDateString.optional(),
  apply_immediately: z.boolean().optional().default(true),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  idempotency_key: nullableTrimmedString.optional(),
});

const listWebhooksQuerySchema = z.object({
  provider: optionalTrimmedString,
  estado: webhookStatusSchema.optional(),
  limit: optionalPositiveIntFromUnknown,
});

const getWompiMerchantQuerySchema = z.object({
  force_refresh: optionalBooleanFromUnknown,
});

const createWompiCheckoutSessionBodySchema = z.object({
  customer_email: z.string().trim().email('Debe enviar un email válido.'),
  redirect_url: nullableTrimmedString.optional(),
  expiration_time: nullableDateString.optional(),
  customer_data: z.record(z.string(), z.unknown()).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

const createWompiPaymentSourceBodySchema = z.object({
  token: z.string().trim().min(4, 'El token de Wompi es obligatorio.'),
  type: z.enum(['CARD', 'NEQUI', 'DAVIPLATA']),
  customer_email: z.string().trim().email('Debe enviar un email válido.'),
  acceptance_token: z.string().trim().min(10, 'acceptance_token inválido.'),
  accept_personal_auth: z.string().trim().min(10, 'accept_personal_auth inválido.'),
  make_default: optionalBooleanFromUnknown,
  public_data: z.record(z.string(), z.unknown()).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

const createWompiTransactionBodySchema = z.object({
  stored_source_id: optionalPositiveIntFromUnknown,
  customer_email: nullableTrimmedString.optional(),
  acceptance_token: nullableTrimmedString.optional(),
  installments: optionalPositiveIntFromUnknown,
  redirect_url: nullableTrimmedString.optional(),
  recurrent: optionalBooleanFromUnknown,
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

const createWompiSandboxCardTransactionBodySchema = z.object({
  customer_email: z.string().trim().email('Debe enviar un email válido.'),
  acceptance_token: nullableTrimmedString.optional(),
  card_number: nullableTrimmedString.optional(),
  exp_month: nullableTrimmedString.optional(),
  exp_year: nullableTrimmedString.optional(),
  cvc: nullableTrimmedString.optional(),
  card_holder: nullableTrimmedString.optional(),
  installments: optionalPositiveIntFromUnknown,
  redirect_url: nullableTrimmedString.optional(),
  customer_data: z.record(z.string(), z.unknown()).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

const syncWompiTransactionBodySchema = z.object({
  transaction_id: nullableTrimmedString.optional(),
  attempt_id: optionalPositiveIntFromUnknown,
}).refine(
  (value) => Boolean(value.transaction_id) || Boolean(value.attempt_id),
  {
    message: 'Debes enviar transaction_id o attempt_id.',
    path: ['transaction_id'],
  }
);

const setDefaultWompiSourceBodySchema = z.object({
  is_default: z.boolean().optional().default(true),
});

module.exports = {
  createCreditNoteBodySchema,
  createInvoiceBodySchema,
  createPaymentAttemptBodySchema,
  createRenewalInvoiceBodySchema,
  createWompiCheckoutSessionBodySchema,
  createWompiPaymentSourceBodySchema,
  createWompiSandboxCardTransactionBodySchema,
  createWompiTransactionBodySchema,
  invoiceIdParamSchema,
  getWompiMerchantQuerySchema,
  listInvoicesQuerySchema,
  listWebhooksQuerySchema,
  paymentSourceIdParamSchema,
  providerParamSchema,
  registerManualPaymentBodySchema,
  setDefaultWompiSourceBodySchema,
  syncWompiTransactionBodySchema,
  subscriptionEmpresaParamSchema,
  voidInvoiceBodySchema,
  webhookIdParamSchema,
};
