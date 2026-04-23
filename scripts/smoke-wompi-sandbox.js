/**
 * Smoke real de Wompi sandbox para Billing SaaS.
 *
 * Crea una factura temporal, tokeniza una tarjeta sandbox aprobada,
 * crea la transaccion en Wompi, simula el webhook firmado y valida
 * que AutoGestion360 aterrice pago/factura/suscripcion.
 *
 * Uso:
 *   WOMPI_PUBLIC_KEY=pub_test_... \
 *   WOMPI_PRIVATE_KEY=prv_test_... \
 *   WOMPI_INTEGRITY_SECRET=test_integrity_... \
 *   WOMPI_EVENTS_SECRET=test_events_... \
 *   npm run smoke:wompi
 */
'use strict';

require('dotenv').config();

const db = require('../db');
const billingService = require('../src/modules/billing/billing.service');
const wompiService = require('../src/modules/billing/providers/wompi.service');

const REQUIRED_ENV = [
  'WOMPI_PUBLIC_KEY',
  'WOMPI_PRIVATE_KEY',
  'WOMPI_INTEGRITY_SECRET',
  'WOMPI_EVENTS_SECRET',
];

function todayPlusDays(days) {
  const date = new Date(Date.now() + Number(days || 0) * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function makeWebhookPayload(transaction) {
  const payload = {
    event: 'transaction.updated',
    data: {
      transaction,
    },
    environment: 'test',
    signature: {
      properties: [
        'transaction.id',
        'transaction.status',
        'transaction.amount_in_cents',
      ],
      checksum: '',
    },
    timestamp: Math.floor(Date.now() / 1000),
    sent_at: new Date().toISOString(),
  };

  payload.signature.checksum = wompiService.buildWompiEventChecksum(payload);
  return payload;
}

async function resolveSmokeCompanyId() {
  if (process.env.WOMPI_SMOKE_EMPRESA_ID) {
    return Number(process.env.WOMPI_SMOKE_EMPRESA_ID);
  }

  const { rows } = await db.query(
    `SELECT e.id
     FROM empresas e
     JOIN suscripciones s ON s.empresa_id = e.id
     WHERE s.estado IN ('TRIAL', 'ACTIVA', 'VENCIDA', 'SUSPENDIDA')
     ORDER BY e.id
     LIMIT 1`
  );
  return Number(rows[0]?.id || 0);
}

async function main() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    console.log(JSON.stringify({
      status: 'SKIPPED',
      reason: 'Faltan credenciales Wompi sandbox.',
      missing,
      next_step: 'Configura las variables WOMPI_* en .env y vuelve a ejecutar npm run smoke:wompi.',
    }, null, 2));
    process.exit(0);
  }

  process.env.WOMPI_ENV = process.env.WOMPI_ENV || 'sandbox';
  const config = wompiService.getWompiConfig();
  if (config.environment !== 'sandbox') {
    throw new Error('Este smoke solo debe ejecutarse con WOMPI_ENV=sandbox.');
  }

  const empresaId = await resolveSmokeCompanyId();
  if (!empresaId) {
    throw new Error('No hay empresas con suscripcion oficial para ejecutar el smoke.');
  }

  const amount = Number(process.env.WOMPI_SMOKE_AMOUNT || 10000);
  const email = process.env.WOMPI_SMOKE_EMAIL || 'sandbox@autogestion360.test';
  const stamp = Date.now();
  const invoice = await billingService.createInvoice({
    empresa_id: empresaId,
    numero_factura: `SMOKE-WOMPI-${stamp}`,
    motivo: 'MANUAL_ADJUSTMENT',
    collection_method: 'AUTOMATIC',
    subtotal: amount,
    monto_impuestos: 0,
    monto_descuento: 0,
    total: amount,
    vencimiento_en: todayPlusDays(7),
    pasarela: 'WOMPI',
    metadata: {
      smoke: true,
      provider: 'WOMPI',
      created_by_script: 'scripts/smoke-wompi-sandbox.js',
    },
  }, null, {
    idempotencyKey: `smoke:wompi:${stamp}`,
  });

  const transactionResult = await wompiService.createSandboxCardTransactionForInvoice(invoice.id, {
    customer_email: email,
    card_number: process.env.WOMPI_SMOKE_CARD_NUMBER || '4242424242424242',
    exp_month: process.env.WOMPI_SMOKE_CARD_EXP_MONTH || '06',
    exp_year: process.env.WOMPI_SMOKE_CARD_EXP_YEAR || '29',
    cvc: process.env.WOMPI_SMOKE_CARD_CVC || '123',
    card_holder: process.env.WOMPI_SMOKE_CARD_HOLDER || 'AutoGestion360 Sandbox',
    installments: Number(process.env.WOMPI_SMOKE_INSTALLMENTS || 1),
  });

  const webhookPayload = makeWebhookPayload(transactionResult.transaction);
  const webhookRecord = await billingService.recordWebhook('wompi', webhookPayload, {
    'x-event-checksum': webhookPayload.signature.checksum,
    'content-type': 'application/json',
    'user-agent': 'autogestion360-smoke-wompi',
  });
  const processedWebhook = await wompiService.processWebhookRecord(webhookRecord.id);
  const finalInvoice = await billingService.getInvoice(invoice.id);

  console.log(JSON.stringify({
    status: 'OK',
    environment: config.environment,
    empresa_id: empresaId,
    invoice: {
      id: finalInvoice.id,
      numero_factura: finalInvoice.numero_factura,
      estado: finalInvoice.estado,
      total: finalInvoice.total,
      saldo_pendiente: finalInvoice.saldo_pendiente,
    },
    transaction: {
      id: transactionResult.transaction.id,
      reference: transactionResult.transaction.reference,
      status: transactionResult.transaction.status,
      payment_method_type: transactionResult.transaction.payment_method_type,
    },
    payment: transactionResult.payment ? {
      id: transactionResult.payment.id,
      amount: transactionResult.payment.amount,
      estado: transactionResult.payment.estado,
    } : null,
    webhook: {
      id: processedWebhook.id,
      estado: processedWebhook.estado,
      signature_valid: processedWebhook.signature_valid,
    },
  }, null, 2));
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(JSON.stringify({
    status: 'FAILED',
    message: error.message,
    details: error.details || null,
  }, null, 2));
  process.exit(1);
});
