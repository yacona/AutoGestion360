# Billing Wompi

## Objetivo

Agregar una integración real con Wompi sobre el billing SaaS oficial, cubriendo:

- checkout online para facturas
- fuentes de pago reutilizables por empresa
- cobro automático contra `payment_source`
- procesamiento de webhook `transaction.updated`
- sincronización manual por polling

## Variables de entorno

- `WOMPI_ENV=sandbox|production`
- `WOMPI_PUBLIC_KEY`
- `WOMPI_PRIVATE_KEY`
- `WOMPI_INTEGRITY_SECRET`
- `WOMPI_EVENTS_SECRET`
- `WOMPI_REDIRECT_URL`
- `WOMPI_API_BASE_URL` opcional
- `WOMPI_CHECKOUT_URL` opcional

## Endpoints implementados

### Configuración / merchant

- `GET /api/billing/providers/wompi/merchant`

Devuelve:

- llave pública
- ambiente
- URLs de términos
- `acceptance_token`
- `accept_personal_auth`

Este endpoint sirve para frontend de tokenización o para mostrar contratos antes de guardar una fuente de pago.

### Checkout online

- `POST /api/billing/invoices/:invoiceId/providers/wompi/checkout-session`

Genera:

- `reference`
- `amount_in_cents`
- `signature.integrity`
- `public_key`
- `checkout_url`
- `redirect_url`
- `attempt_id`

Uso esperado:

1. Tu frontend pide este endpoint.
2. Renderiza Wompi Widget o Web Checkout con esos datos.
3. El webhook `transaction.updated` confirma el resultado final.

### Fuentes de pago reutilizables

- `GET /api/billing/subscriptions/:empresaId/providers/wompi/payment-sources`
- `POST /api/billing/subscriptions/:empresaId/providers/wompi/payment-sources`
- `PATCH /api/billing/subscriptions/:empresaId/providers/wompi/payment-sources/:paymentSourceId/default`

Persistencia local:

- tabla `billing_customer_payment_sources`

Esto deja lista la base para cobro recurrente backend-to-backend.

### Cobro automático

- `POST /api/billing/invoices/:invoiceId/providers/wompi/transactions`

Comportamiento:

- toma la fuente predeterminada o una `stored_source_id`
- crea intento local
- llama `POST /v1/transactions` de Wompi
- guarda ids externos
- si la respuesta llega `APPROVED`, confirma el pago en el ledger local

Este flujo obtiene `acceptance_token` desde el merchant de Wompi cuando el body no lo trae, porque Wompi lo exige para crear transacciones por API.

### Smoke sandbox con tarjeta de prueba

- `POST /api/billing/invoices/:invoiceId/providers/wompi/sandbox/card-transaction`

Este endpoint existe solo para `WOMPI_ENV=sandbox` y fuera de `NODE_ENV=production`.

Comportamiento:

- tokeniza una tarjeta sandbox aprobada (`4242 4242 4242 4242` por defecto)
- crea una transacción real contra Wompi sandbox
- aterriza la respuesta en `billing_payment_attempts`
- si Wompi responde `APPROVED`, registra el pago local

Uso desde terminal:

```bash
npm run smoke:wompi
```

Variables opcionales del smoke:

- `WOMPI_SMOKE_EMPRESA_ID`
- `WOMPI_SMOKE_EMAIL`
- `WOMPI_SMOKE_AMOUNT`
- `WOMPI_SMOKE_CARD_NUMBER`
- `WOMPI_SMOKE_CARD_EXP_MONTH`
- `WOMPI_SMOKE_CARD_EXP_YEAR`
- `WOMPI_SMOKE_CARD_CVC`
- `WOMPI_SMOKE_CARD_HOLDER`

Si faltan credenciales `WOMPI_*`, el smoke termina como `SKIPPED` y muestra qué variables faltan.

### Polling / sincronización

- `POST /api/billing/invoices/:invoiceId/providers/wompi/sync`

Body:

- `transaction_id` o `attempt_id`

Consulta `GET /v1/transactions/{transaction_id}` y aterriza el estado en billing.

## Webhook

Ruta pública ya existente:

- `POST /api/billing/webhooks/wompi`

Comportamiento actual:

- registra el evento en `billing_webhook_events`
- valida checksum usando `WOMPI_EVENTS_SECRET`
- procesa `transaction.updated`
- actualiza intento
- confirma pago si llega `APPROVED`
- revierte el pago confirmado si llega `VOIDED`
- responde `HTTP 200` para evitar reintentos innecesarios

## Estados aterrizados en AutoGestion360

Wompi -> intento local:

- `PENDING` -> `PENDING`
- `APPROVED` -> `SUCCEEDED`
- `DECLINED` -> `FAILED`
- `ERROR` -> `FAILED`
- `VOIDED` -> `CANCELED`

Wompi `APPROVED` -> `billing_payments.estado='CONFIRMED'`

Wompi `VOIDED` -> `billing_payments.estado='VOIDED'`

## Modelo adicional

La migración `011_billing_wompi_payment_sources.sql` crea:

- `billing_customer_payment_sources`

Campos clave:

- `empresa_id`
- `suscripcion_id`
- `provider_payment_source_id`
- `customer_email`
- `type`
- `status`
- `is_default`
- `public_data`
- `metadata`

## Flujo recomendado de frontend

### Pago online simple

1. Crear o listar factura.
2. Pedir `checkout-session`.
3. Abrir Widget o Web Checkout de Wompi.
4. Esperar webhook.
5. Consultar invoice o ledger.

### Recurrente con tarjeta / Nequi

1. Pedir `merchant`.
2. Mostrar términos y obtener aceptación explícita del usuario.
3. Tokenizar en frontend con Wompi.
4. Registrar `payment-source` en backend.
5. Marcar fuente por defecto.
6. Cuando exista una factura nueva, disparar `POST /transactions`.

## Notas importantes

- El checkout online no usa tu llave privada en frontend.
- La validación final del pago debe hacerse por webhook o polling, no por redirección.
- El monto local está en pesos; para Wompi se transforma a centavos.
- Sin credenciales Wompi reales, el repo puede validarse localmente en sintaxis/rutas, pero no ejecutar cobros reales.
