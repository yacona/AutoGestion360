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

## Flujo recomendado en producción

1. Ejecutar `billing:jobs` en `dry_run` y revisar salida.
2. Ejecutar `BILLING_JOBS_DRY_RUN=false npm run billing:jobs`.
3. Programarlo con cron/PM2 cuando el smoke sea estable.

Cadencia sugerida inicial:

- diario a las 02:00 para vencimientos y renovaciones
- mantener `limit` conservador al inicio

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
