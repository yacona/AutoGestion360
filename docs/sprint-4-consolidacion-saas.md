# Sprint 4 — Consolidación SaaS

Última actualización: 2026-04-21

---

## 1. Diagnóstico del estado antes de este sprint

### Problema 1 — Admin fuera del patrón modular

Las rutas del panel SuperAdmin vivían en `routes/admin/planes-admin.js` y
`routes/admin/empresa-modulos.js`, fuera de `src/modules/`. Toda la lógica de
negocio SaaS estaba acoplada directamente en las rutas o en `services/adminService.js`
sin capa de controller.

### Problema 2 — Endpoints del catálogo incompletos

El catálogo de planes no exponía:
- `GET /api/admin/planes/:id` (detalle con módulos)
- `GET /api/admin/modulos` (catálogo global de módulos)
- `GET /api/admin/planes/:id/modulos` / `PUT /api/admin/planes/:id/modulos`
- `GET /api/admin/limites/:empresaId` (límites efectivos consolidados)

El frontend admin no podía operar sin esos endpoints.

### Problema 3 — Lifecycle de suscripciones incompleto

Existía `asignarPlan` y `cambiarEstadoSuscripcion`, pero no había:
- `upgradePlan` / `downgradePlan` (semántica diferenciada)
- `reactivarSuscripcion` (suspendida → activa o vencida → activa)
- Rutas dedicadas: `/upgrade`, `/downgrade`, `/reactivar`

### Problema 4 — Rol de tablas legacy sin definir

Las tablas `suscripciones_empresa` y `facturas_saas` coexistían con el sistema
nuevo (`suscripciones`, `planes`) sin que quedara claro cuál era la fuente operativa.

### Problema 5 — Resumen SaaS duplicado

`getResumenSaas` existía en `services/adminService.js` (usa `suscripciones` nuevo)
y también en `src/modules/suscripciones/suscripciones.service.js` (usa
`suscripciones_empresa` legacy). Los números podían divergir.

---

## 2. Decisiones tomadas

### 2.1 Migración de admin a `src/modules/admin/`

Se creó el módulo `src/modules/admin/` con el patrón estándar:

```
src/modules/admin/
  admin.controller.js   ← handlers finos con wrap()
  admin.routes.js       ← definición de rutas + validación
```

`services/adminService.js` se mantiene como la capa de servicio; no se movió
porque ya estaba bien estructurado y moverlo implicaba actualizar ~12 imports
sin ganancia real.

Los archivos `routes/admin/planes-admin.js` y `routes/admin/empresa-modulos.js`
se convirtieron en shims que re-exportan el nuevo módulo para preservar
compatibilidad con cualquier `require()` externo.

`src/app.js` ahora monta solo:
```js
app.use('/api/admin', authMiddleware, adminRoutes);
```

### 2.2 Endpoints nuevos añadidos

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/admin/modulos` | Catálogo global de módulos |
| GET | `/api/admin/planes/:id` | Detalle de plan con módulos |
| GET | `/api/admin/planes/:id/modulos` | Solo los módulos del plan |
| PUT | `/api/admin/planes/:id/modulos` | Reemplazar módulos del plan |
| GET | `/api/admin/limites/:empresaId` | Límites efectivos consolidados |
| POST | `/api/admin/suscripcion/:empresaId/upgrade` | Upgrade de plan |
| POST | `/api/admin/suscripcion/:empresaId/downgrade` | Downgrade de plan |
| POST | `/api/admin/suscripcion/:empresaId/reactivar` | Reactivar suspendida/vencida |

### 2.3 Lifecycle de suscripciones

Ver sección 4 para el detalle completo.

### 2.4 Fuente de verdad operativa

**El sistema nuevo es la única fuente operativa:**

```
planes  →  plan_modulos  →  suscripciones  →  empresa_modulos
```

Toda consulta de estado de suscripción de una empresa debe hacerse contra
`suscripciones` (no contra `suscripciones_empresa`).

---

## 3. Arquitectura final del catálogo SaaS

```
modulos (catálogo global)
  id, nombre, descripcion, icono_clave, orden, activo

planes
  id, codigo, nombre, descripcion
  precio_mensual, precio_anual, moneda
  trial_dias
  max_usuarios, max_vehiculos, max_empleados
  es_publico, activo, orden, metadata

plan_modulos  (módulos que incluye cada plan)
  plan_id, modulo_id
  limite_registros    ← NULL = sin límite
  activo
  metadata

suscripciones  (una por empresa; la activa/trial es la vigente)
  empresa_id, plan_id
  estado: TRIAL | ACTIVA | SUSPENDIDA | VENCIDA | CANCELADA
  fecha_inicio, fecha_fin, trial_hasta
  ciclo: MENSUAL | ANUAL
  precio_pactado, moneda
  pasarela, observaciones

empresa_modulos  (overrides por empresa)
  empresa_id, modulo_id
  activo             ← true = forzar ON, false = forzar OFF
  limite_override    ← NULL = heredar del plan
  notas
```

### Resolución de estado efectivo de un módulo por empresa

```
override.activo = TRUE  AND módulo no está en plan → 'addon'
override.activo = FALSE                            → 'desactivado'
módulo en plan AND (sin override OR override.activo = TRUE) → 'incluido'
ninguna de las anteriores                          → 'no_incluido'
```

### Límites efectivos por módulo

```
limite_efectivo = limite_override ?? limite_plan ?? null (sin límite)
```

---

## 4. Lifecycle de suscripciones

### Estados válidos

```
TRIAL → ACTIVA → SUSPENDIDA → ACTIVA (reactivar)
                            ↘ CANCELADA
      → ACTIVA → VENCIDA   → ACTIVA (reactivar)
                            ↘ CANCELADA
      → CANCELADA (terminal)
```

### Transiciones y sus endpoints

| Transición | Endpoint | Notas |
|-----------|----------|-------|
| Nueva empresa → TRIAL | `POST /api/admin/onboarding` | Usa `trial_dias` del plan |
| TRIAL → ACTIVA | `POST /suscripcion/:id/estado` `{ estado: "ACTIVA" }` | Activación manual |
| Cambio de plan (upgrade) | `POST /suscripcion/:id/upgrade` | Cancela la actual, crea nueva |
| Cambio de plan (downgrade) | `POST /suscripcion/:id/downgrade` | Cancela la actual, crea nueva |
| Cambio de plan (genérico) | `POST /suscripcion/:id` | Sin distinción semántica |
| ACTIVA → SUSPENDIDA | `POST /suscripcion/:id/estado` `{ estado: "SUSPENDIDA" }` | Acceso bloqueado |
| SUSPENDIDA / VENCIDA → ACTIVA | `POST /suscripcion/:id/reactivar` | Restaura acceso |
| Cualquier → CANCELADA | `POST /suscripcion/:id/estado` `{ estado: "CANCELADA" }` | Terminal |
| Automático → VENCIDA | Job externo (Sprint 5) | Cuando `fecha_fin < NOW()` |

### Reglas de negocio

1. Solo puede haber una suscripción `TRIAL` o `ACTIVA` por empresa en cualquier
   momento. `asignarPlan` / `upgradePlan` / `downgradePlan` cancelan la anterior
   antes de insertar la nueva.
2. `CANCELADA` es estado terminal; no puede reactivarse. Se debe asignar un
   nuevo plan.
3. `reactivarSuscripcion` opera sobre la suscripción más reciente en estado
   `SUSPENDIDA` o `VENCIDA`. No cambia el plan.
4. El campo `trial_hasta` de la tabla `suscripciones` indica cuándo vence el
   trial aunque el estado siga siendo `TRIAL`. Un job de Sprint 5 deberá
   marcarla `VENCIDA` cuando `trial_hasta < NOW()` y `estado = 'TRIAL'`.
5. `precio_pactado` prevalece sobre el precio del plan; permite acuerdos
   comerciales individuales.

---

## 5. Rol de tablas legacy

### `suscripciones_empresa`

| Atributo | Valor |
|---------|-------|
| Origen | Sprint 1 (sistema de licencias antiguo) |
| Tablas relacionadas | `licencias`, `empresa_licencia`, `licencia_modulo` |
| Estado actual | **Transicional — solo lectura recomendada** |
| Fuente operativa | **NO.** La fuente operativa es `suscripciones` (sistema nuevo) |
| Quién la escribe todavía | `utils/suscripciones-schema.js → upsertSuscripcionEmpresa` (llamado desde `src/modules/licencias/licencias.service.js` al asignar licencia) |
| Endpoints que aún dependen de ella | `GET /api/suscripciones` · `GET /api/suscripciones/:id` · `POST /api/suscripciones/upsert` · `POST /api/suscripciones/:id/renovar` · `POST /api/suscripciones/:id/estado` · `POST /api/suscripciones/:id/facturas` |
| Uso recomendado en Sprint 5 | Solo reporting histórico y auditoría |
| Desuso planeado | Sprint 5 o 6, cuando `/api/suscripciones` sea migrado o deprecado |

### `facturas_saas`

| Atributo | Valor |
|---------|-------|
| Origen | Sprint 1 (facturación manual) |
| Relación | Referencia `suscripciones_empresa(id)` (no la nueva `suscripciones`) |
| Estado actual | **Transicional — registro histórico de cobros manuales** |
| Fuente operativa | **NO.** Las nuevas facturas de Sprint 5 necesitarán una tabla separada o una migración de FK a `suscripciones` |
| Endpoints activos | `GET /api/suscripciones/:id/facturas` · `POST /api/suscripciones/:id/facturas` |
| Uso recomendado | Auditoría de pagos pre-Sprint 5; no emitir nuevas facturas aquí para clientes en el sistema nuevo |
| Decisión Sprint 5 | Crear tabla `facturas` referenciando `suscripciones(id)` y migrar `facturas_saas` como tabla de historial |

### Resumen de dualidad de resumen SaaS

El módulo `src/modules/suscripciones/` tiene su propio `resumen()` que lee de
`suscripciones_empresa`. El panel admin usa `getResumenSaas()` de
`services/adminService.js` que lee de `suscripciones` (nuevo).

**Decisión:** Los KPIs del panel admin (`GET /api/admin/resumen`) son
autoritativos. `GET /api/suscripciones/resumen` es considerado legacy.
Mientras coexistan, pueden divergir; documentarlo en el panel admin.

---

## 6. Endpoints admin relevantes post-Sprint 4

Todos requieren JWT + rol `SuperAdmin`.

### Catálogo

```
GET  /api/admin/modulos
GET  /api/admin/planes
POST /api/admin/planes
GET  /api/admin/planes/:id
PUT  /api/admin/planes/:id
GET  /api/admin/planes/:id/modulos
PUT  /api/admin/planes/:id/modulos
```

### Empresas y KPIs

```
GET  /api/admin/empresas
GET  /api/admin/empresas/:id
GET  /api/admin/resumen
GET  /api/admin/proximas-vencer?dias=30
```

### Onboarding

```
POST /api/admin/onboarding
POST /api/admin/usuarios/:empresaId
```

### Suscripciones (lifecycle completo)

```
GET  /api/admin/suscripcion/:empresaId
POST /api/admin/suscripcion/:empresaId              ← asignar plan (genérico)
POST /api/admin/suscripcion/:empresaId/upgrade
POST /api/admin/suscripcion/:empresaId/downgrade
POST /api/admin/suscripcion/:empresaId/reactivar
POST /api/admin/suscripcion/:empresaId/estado
```

### Límites y módulos por empresa

```
GET    /api/admin/limites/:empresaId
GET    /api/admin/empresa-modulos/:empresaId
PUT    /api/admin/empresa-modulos/:empresaId/bulk
PUT    /api/admin/empresa-modulos/:empresaId/:moduloId
DELETE /api/admin/empresa-modulos/:empresaId/:moduloId
```

---

## 7. Archivos modificados / creados

| Archivo | Cambio |
|---------|--------|
| `src/modules/admin/admin.controller.js` | **NUEVO** — handlers del panel admin |
| `src/modules/admin/admin.routes.js` | **NUEVO** — rutas + validación consolidadas |
| `services/adminService.js` | **AMPLIADO** — 7 funciones nuevas exportadas |
| `src/lib/validation/admin.schemas.js` | **AMPLIADO** — 2 schemas nuevos |
| `src/app.js` | **ACTUALIZADO** — monta `adminRoutes` desde módulo nuevo |
| `routes/admin/planes-admin.js` | **CONVERTIDO** a shim de compatibilidad |
| `routes/admin/empresa-modulos.js` | **CONVERTIDO** a shim de compatibilidad |

---

## 8. Riesgos pendientes

1. **Job de expiración automática ausente.** `trial_hasta` y `fecha_fin` se
   calculan pero nadie cambia el estado a `VENCIDA` automáticamente. Requiere
   un cron job (Sprint 5).

2. **`suscripciones_empresa` sigue escribiéndose.** Al asignar licencias desde
   `/api/licencias`, `upsertSuscripcionEmpresa` escribe en la tabla legacy y
   también en `empresa_licencia` y en la columna `licencia_id` de `empresas`.
   Esto no rompe nada pero genera ruido. Sprint 5 debe deprecar el flujo de
   licencias antiguo.

3. **`facturas_saas` no tiene contrapartida en el sistema nuevo.** Sprint 5
   necesitará crear `facturas` (o migrar la FK) para cobro real.

4. **Resumen SaaS dual.** `GET /api/suscripciones/resumen` y
   `GET /api/admin/resumen` pueden divergir mientras coexistan los dos sistemas.

5. **Módulo `src/modules/licencias/` sigue activo.** Usa `ensureLicenciasSchema`
   que crea tablas en runtime. Sprint 5 debería migrar o deprecar.

6. **Sin tests de integración.** Ningún test verifica las nuevas rutas. Se
   recomienda añadir tests básicos antes de Sprint 5.

---

## 9. Próximos pasos — Sprint 5

1. **Job de expiración:** cron que marca `VENCIDA` cuando `trial_hasta < NOW()`
   o `fecha_fin < NOW()` y el estado sigue siendo `TRIAL`/`ACTIVA`.
2. **Tabla `facturas`** referenciando `suscripciones(id)`, con soporte para
   pasarela (Wompi / Stripe).
3. **Webhook de pasarela:** endpoint para recibir confirmaciones de pago y
   actualizar estado de suscripción automáticamente.
4. **Deprecación de `/api/licencias` y `/api/suscripciones` legacy** con un
   período de migración documentado.
5. **Emails transaccionales:** notificación de trial por vencer, vencimiento,
   reactivación, upgrade/downgrade.
6. **Dashboard de métricas expandido:** churn, LTV, distribución por plan.
