# Billing SaaS Core

## Objetivo

Dejar una base oficial de facturación SaaS ligada a `suscripciones`, operable manualmente hoy y lista para automatización futura con pasarela y webhooks.

La fuente oficial del nuevo billing es:

- `suscripciones`
- `billing_invoices`
- `billing_payment_attempts`
- `billing_payments`
- `billing_credit_notes`
- `billing_webhook_events`

`facturas_saas` y flujos legacy de suscripciones se mantienen solo como compatibilidad temporal.

## Modelo de datos

### `billing_invoices`

Documento oficial de cobro del SaaS. Se relaciona con:

- `empresa_id`
- `suscripcion_id`
- `plan_id`

Estados soportados:

- `DRAFT`
- `OPEN`
- `OVERDUE`
- `PARTIALLY_PAID`
- `PAID`
- `VOID`
- `UNCOLLECTIBLE`
- `CREDITED`
- `REFUNDED`

Motivos soportados:

- `SUBSCRIPTION_RENEWAL`
- `SUBSCRIPTION_REACTIVATION`
- `PLAN_CHANGE`
- `MANUAL_ADJUSTMENT`
- `ADDON`
- `LEGACY_IMPORT`

### `billing_payment_attempts`

Intentos de cobro. Sirven tanto para operación manual como para automatización futura.

Usos:

- registrar intentos manuales
- guardar respuestas de una pasarela
- dejar retries pendientes
- enlazar eventos webhook con un intento

### `billing_payments`

Pagos confirmados aplicados a una factura. Esta tabla es el ledger monetario efectivo.

Estados actuales:

- `CONFIRMED`
- `REFUNDED`
- `VOIDED`
- `CHARGEBACK`

### `billing_credit_notes`

Notas crédito para ajustes, descuentos posteriores o compensaciones.

Estados:

- `DRAFT`
- `ISSUED`
- `APPLIED`
- `VOID`

### `billing_webhook_events`

Bitácora idempotente de webhooks externos.

Claves:

- unicidad por `(provider, external_event_id)`
- payload y headers persistidos
- `signature_valid`
- `process_attempts`

## Flujo funcional actual

### Flujo manual operativo

1. Plataforma crea factura oficial para una empresa o para la renovación de su suscripción.
2. Opcionalmente registra un intento de pago manual o preliminar.
3. Plataforma confirma el pago manual.
4. El sistema recalcula saldo, estado y cierre de la factura.
5. Si la factura quedó `PAID` y el motivo es renovación/reactivación/cambio de plan, la `suscripcion` se reactiva o extiende y luego se sincroniza el espejo legacy.

### Flujo automático futuro

1. Se crea factura con `collection_method='AUTOMATIC'`.
2. Se crea `billing_payment_attempts` con proveedor y payload saliente.
3. La pasarela responde sincrónicamente o por webhook.
4. El webhook entra por `/api/billing/webhooks/:provider`.
5. Un worker procesa el webhook y decide:
   - confirmar pago
   - marcar intento fallido
   - programar retry
   - emitir nota crédito o refund si aplica

## Endpoints

### Privados plataforma

- `GET /api/billing/invoices`
- `GET /api/billing/invoices/:invoiceId`
- `POST /api/billing/invoices`
- `POST /api/billing/subscriptions/:empresaId/invoices/renewal`
- `POST /api/billing/invoices/:invoiceId/attempts`
- `POST /api/billing/invoices/:invoiceId/payments/manual`
- `POST /api/billing/invoices/:invoiceId/void`
- `POST /api/billing/invoices/:invoiceId/credit-notes`
- `GET /api/billing/subscriptions/:empresaId/ledger`
- `GET /api/billing/webhooks`
- `GET /api/billing/webhooks/:webhookId`

Requieren:

- `scope=platform`
- permiso `platform:billing:gestionar` o `*`

### Públicos

- `POST /api/billing/webhooks/:provider`

Protecciones:

- `billingWebhookLimiter`
- validación de `provider`
- auditoría del evento recibido

## Estrategia de idempotencia

### Facturas

`billing_invoices.idempotency_key`

Evita facturas duplicadas cuando un panel o job reintenta la misma operación.

### Intentos de pago

`billing_payment_attempts.idempotency_key`

Permite reintentar llamadas hacia pasarela sin crear intentos repetidos cuando el cliente repite la solicitud.

### Pagos

`billing_payments.idempotency_key`

Evita doble aplicación de un mismo pago manual o de una confirmación automática repetida.

### Notas crédito

`billing_credit_notes.idempotency_key`

Evita duplicados en compensaciones.

### Webhooks

`billing_webhook_events(provider, external_event_id)`

Evita reprocesar el mismo evento externo como si fuera nuevo.

## Manejo de errores y reglas de negocio

- no se puede pagar una factura `VOID`
- no se puede anular una factura con pagos o créditos aplicados
- una nota crédito aplicada no puede exceder el saldo pendiente
- una factura pagada recalcula `saldo_pendiente`, `total_pagado`, `total_acreditado`
- si el pago liquida una factura de renovación/reactivación/cambio de plan, la suscripción oficial se reactiva

Los errores operativos se devuelven como `400`, `404` o `409` mediante `AppError`. Los errores inesperados siguen por `errorHandler`.

## Auditoría

Eventos auditados actualmente:

- `BILLING_INVOICE_CREATED`
- `BILLING_PAYMENT_ATTEMPT_CREATED`
- `BILLING_PAYMENT_CONFIRMED`
- `BILLING_INVOICE_VOIDED`
- `BILLING_CREDIT_NOTE_CREATED`
- `BILLING_WEBHOOK_RECEIVED`
- `AUTH_ACCESS_DENIED` para accesos no autorizados al módulo

## Eventos y jobs futuros recomendados

- Job de vencimientos para mover `OPEN` a `OVERDUE`
- Job de generación automática de facturas de renovación
- Worker de retry para `billing_payment_attempts` fallidos o pendientes
- Procesador de webhooks por proveedor
- Dunning y notificaciones de cobro
- Conciliación contra extracto de pasarela
- Motor de refunds y chargebacks

## Compatibilidad temporal

- `facturas_saas` no es la fuente oficial del nuevo billing
- la migración `010_billing_core.sql` importa facturas legacy a `billing_invoices`
- cuando una factura oficial paga una renovación/reactivación, también se resincroniza el espejo legacy de la suscripción

## Smoke test sugerido

1. Login con usuario `platform`.
2. Crear factura manual con `POST /api/billing/invoices`.
3. Crear intento con `POST /api/billing/invoices/:invoiceId/attempts`.
4. Confirmar pago con `POST /api/billing/invoices/:invoiceId/payments/manual`.
5. Consultar ledger con `GET /api/billing/subscriptions/:empresaId/ledger`.
6. Enviar un webhook de prueba a `POST /api/billing/webhooks/wompi`.
7. Verificar auditoría y saldo de la factura.
