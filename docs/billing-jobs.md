# Jobs de Billing SaaS

## Objetivo

Automatizar las tareas operativas mínimas para que el SaaS funcione mes a mes sin depender solo de acciones manuales.

## Jobs incluidos

- `MARK_OVERDUE_INVOICES`: marca facturas abiertas como `OVERDUE` cuando superan `vencimiento_en`.
- `GENERATE_RENEWAL_INVOICES`: crea facturas de renovación para suscripciones que vencen pronto.
- `EXPIRE_SUBSCRIPTIONS`: marca suscripciones `TRIAL` o `ACTIVA` como `VENCIDA` después del periodo de gracia.

## Seguridad operativa

Los jobs soportan `dry_run` y por defecto el script CLI corre en modo simulación.

Esto permite ver candidatos antes de modificar datos.

## Endpoints

Requieren usuario `platform` con permiso `platform:billing:gestionar`.

### Preview

```http
GET /api/billing/jobs/preview?days_ahead=7&grace_days=3&limit=100
```

No modifica datos. Devuelve candidatos por job.

### Ejecución

```http
POST /api/billing/jobs/run
Content-Type: application/json

{
  "dry_run": false,
  "days_ahead": 7,
  "grace_days": 3,
  "invoice_due_days": 7,
  "limit": 100
}
```

Si `dry_run` no se envía, se asume `true`.

## CLI

Preview:

```bash
npm run billing:jobs
```

Ejecución real:

```bash
BILLING_JOBS_DRY_RUN=false npm run billing:jobs
```

Variables opcionales:

- `BILLING_JOBS_DAYS_AHEAD`
- `BILLING_JOBS_GRACE_DAYS`
- `BILLING_JOBS_INVOICE_DUE_DAYS`
- `BILLING_JOBS_LIMIT`
- `BILLING_JOBS_LOCK_FILE`
- `BILLING_JOBS_LOG_FILE`

Ejecución real corta:

```bash
npm run billing:jobs:run
```

## Lock y logs

El script usa lock por archivo para evitar ejecuciones simultáneas.

Valor por defecto:

```text
tmp/billing-jobs.lock
```

Si el lock ya existe, el script devuelve `SKIPPED` y no modifica datos.

Si `BILLING_JOBS_LOG_FILE` está configurado, el script escribe una línea JSON por ejecución. Recomendado:

```text
logs/billing-jobs.jsonl
```

## Flujo recomendado en producción

1. Ejecutar `billing:jobs` en `dry_run` y revisar salida.
2. Ejecutar `BILLING_JOBS_DRY_RUN=false npm run billing:jobs`.
3. Programarlo con cron/PM2 cuando el smoke sea estable.

Cadencia sugerida inicial:

- diario a las 02:00 para vencimientos y renovaciones
- mantener `limit` conservador al inicio

## PM2

Archivo listo:

```text
deploy/pm2/ecosystem.billing.config.cjs
```

Instalación en servidor:

```bash
pm2 start deploy/pm2/ecosystem.billing.config.cjs
pm2 save
```

El job queda programado todos los días a las 02:00.

## Cron

Archivo base:

```text
deploy/cron/autogestion360-billing-jobs.cron
```

Antes de instalarlo, ajusta `AUTO360_DIR` al path real del servidor.

Instalación sugerida:

```bash
crontab deploy/cron/autogestion360-billing-jobs.cron
```

## Reglas de idempotencia

Las renovaciones usan llave:

```text
billing:renewal:<suscripcion_id>:<periodo_inicio>
```

Además el job evita crear otra renovación si ya existe una factura activa/pagada para el mismo periodo.

## Notas importantes

- `EXPIRE_SUBSCRIPTIONS` sincroniza el espejo legacy para que los middlewares actuales bloqueen correctamente.
- El job no cobra automáticamente con Wompi; primero genera/actualiza estados. El cobro automático recurrente debe dispararse en una fase posterior usando `payment_sources`.
- La reactivación/extensión de suscripción ocurre cuando una factura de renovación/reactivación queda `PAID`.
