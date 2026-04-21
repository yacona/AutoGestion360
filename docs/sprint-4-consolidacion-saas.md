# Sprint 4 — Consolidación SaaS

Última actualización: 2026-04-21

## 1. Diagnóstico del problema actual

Antes de este sprint, el backend SaaS tenía una base funcional pero todavía no
estaba consolidado como producto administrable:

1. El panel admin estaba partido entre `routes/admin/planes-admin.js` y
   `routes/admin/empresa-modulos.js`, fuera del patrón modular de `src/modules/`.
2. El catálogo SaaS no tenía una sola superficie coherente para frontend:
   faltaban rutas para detalle de plan, módulos del plan, límites efectivos,
   historial de suscripciones y estado consolidado por empresa.
3. El lifecycle de suscripciones existía en piezas, pero no estaba formalizado
   ni en contrato ni en documentación operativa.
4. `suscripciones_empresa` y `facturas_saas` seguían coexistiendo con el sistema
   nuevo sin quedar explícitamente etiquetadas como legacy/transicionales.
5. El frontend admin no tenía un contrato backend/frontend estable con DTOs,
   pantallas y ejemplos realistas.

## 2. Decisiones tomadas

### 2.1 Panel admin consolidado en módulo propio

Se dejó el panel admin integrado así:

```text
src/modules/admin/
  admin.routes.js
  admin.controller.js
  admin.service.js
```

`routes/admin/planes-admin.js` y `routes/admin/empresa-modulos.js` quedan como
shims de compatibilidad, sin lógica propia.

### 2.2 Núcleo de negocio conservado y encapsulado

`services/adminService.js` se mantiene como núcleo del catálogo SaaS y del
lifecycle de suscripciones. El módulo `src/modules/admin/admin.service.js`
funciona como fachada del panel HTTP y evita duplicar lógica en controller.

### 2.3 Fuente de verdad operativa

La fuente oficial del panel admin y del acceso SaaS queda definida como:

```text
planes -> plan_modulos -> suscripciones -> empresa_modulos
```

### 2.4 Legacy documentado, no oculto

Se documenta explícitamente que:

- `suscripciones_empresa` es transicional
- `facturas_saas` es transicional
- ninguna de las dos es la fuente de verdad operativa del panel admin

## 3. Arquitectura final del panel SaaS

### Integración en app principal

`src/app.js` monta el panel admin consolidado así:

```js
app.use('/api/admin', authMiddleware, adminRoutes);
```

### Capas resultantes

```text
src/modules/admin/admin.routes.js
  -> define rutas, validación y rate limit

src/modules/admin/admin.controller.js
  -> handlers finos

src/modules/admin/admin.service.js
  -> fachada del módulo admin
  -> compone detalle SaaS de empresa, historial y estado consolidado

services/adminService.js
  -> núcleo de catálogo, planes, overrides, lifecycle y onboarding
```

### Adapters legacy

```text
routes/admin/planes-admin.js
routes/admin/empresa-modulos.js
```

Ambos reexportan el módulo nuevo para no romper `require()` externos.

## 4. Catálogo SaaS centralizado

El catálogo queda centralizado en la capa de servicio, sin lógica duplicada en
rutas ni controllers.

### Responsabilidades cubiertas

- listar planes
- crear plan
- actualizar plan
- obtener detalle de plan
- listar módulos por plan
- reemplazar módulos por plan
- listar módulos globales
- obtener overrides por empresa
- actualizar overrides por empresa
- eliminar overrides
- obtener límites efectivos por empresa
- obtener estado SaaS consolidado por empresa
- obtener suscripción actual e historial por empresa

### Endpoints resultantes

```text
GET    /api/admin/modulos
GET    /api/admin/planes
POST   /api/admin/planes
GET    /api/admin/planes/:id
PUT    /api/admin/planes/:id
GET    /api/admin/planes/:id/modulos
PUT    /api/admin/planes/:id/modulos

GET    /api/admin/empresas
GET    /api/admin/empresas/:id
GET    /api/admin/estado/:empresaId
GET    /api/admin/limites/:empresaId

GET    /api/admin/empresa-modulos/:empresaId
PUT    /api/admin/empresa-modulos/:empresaId/:moduloId
DELETE /api/admin/empresa-modulos/:empresaId/:moduloId
PUT    /api/admin/empresa-modulos/:empresaId/bulk
```

## 5. Lifecycle de suscripciones

### Estados válidos

```text
TRIAL
ACTIVA
SUSPENDIDA
VENCIDA
CANCELADA
```

### Flujo formal

```text
onboarding -> TRIAL
TRIAL -> ACTIVA
TRIAL -> CANCELADA
ACTIVA -> SUSPENDIDA
ACTIVA -> VENCIDA
ACTIVA -> CANCELADA
SUSPENDIDA -> ACTIVA   (reactivar)
VENCIDA -> ACTIVA      (reactivar)
ACTIVA/TRIAL -> nuevo plan (upgrade/downgrade/asignación genérica)
```

### Reglas implementadas

1. Solo debe existir una suscripción `TRIAL` o `ACTIVA` vigente por empresa.
2. `upgrade`, `downgrade` y asignación genérica cancelan la suscripción activa
   anterior antes de insertar la nueva.
3. `reactivar` actúa sobre la suscripción más reciente en estado
   `SUSPENDIDA` o `VENCIDA`.
4. `CANCELADA` se considera terminal desde el punto de vista operativo del
   panel admin.
5. El vencimiento automático queda documentado pero no automatizado aún; eso
   pasa al Sprint 5.

### Endpoints del lifecycle

```text
POST /api/admin/onboarding
GET  /api/admin/suscripcion/:empresaId
GET  /api/admin/suscripcion/:empresaId/historial
POST /api/admin/suscripcion/:empresaId
POST /api/admin/suscripcion/:empresaId/upgrade
POST /api/admin/suscripcion/:empresaId/downgrade
POST /api/admin/suscripcion/:empresaId/reactivar
POST /api/admin/suscripcion/:empresaId/estado
```

## 6. Rol de tablas legacy

### `suscripciones_empresa`

- estado: transicional
- rol actual: compatibilidad y reporting del flujo legacy
- fuente operativa oficial: no
- endpoints que todavía la usan:
  - `GET /api/suscripciones`
  - `GET /api/suscripciones/:empresaId`
  - `POST /api/suscripciones/upsert`
  - `POST /api/suscripciones/:empresaId/renovar`
  - `POST /api/suscripciones/:empresaId/estado`
  - `GET /api/suscripciones/:empresaId/facturas`
  - `POST /api/suscripciones/:empresaId/facturas`

### `facturas_saas`

- estado: transicional
- rol actual: histórico/manual del sistema legacy
- fuente operativa oficial: no
- dependencia principal: sigue ligada a `suscripciones_empresa`
- decisión vigente: mantenerla documentada y encapsulada hasta crear
  facturación del sistema nuevo en Sprint 5

## 7. Fuente de verdad operativa

La resolución oficial para panel admin y estado SaaS es:

```text
planes
plan_modulos
suscripciones
empresa_modulos
```

El endpoint consolidado por empresa expuesto en Sprint 4 usa únicamente la
resolución SaaS del sistema nuevo.

## 8. Endpoints admin relevantes al cierre del sprint

### Catálogo y planes

```text
GET    /api/admin/modulos
GET    /api/admin/planes
POST   /api/admin/planes
GET    /api/admin/planes/:id
PUT    /api/admin/planes/:id
GET    /api/admin/planes/:id/modulos
PUT    /api/admin/planes/:id/modulos
```

### Empresas y estado SaaS

```text
GET /api/admin/empresas
GET /api/admin/empresas/:id
GET /api/admin/estado/:empresaId
GET /api/admin/limites/:empresaId
GET /api/admin/empresa-modulos/:empresaId
```

### Suscripciones y lifecycle

```text
GET  /api/admin/suscripcion/:empresaId
GET  /api/admin/suscripcion/:empresaId/historial
POST /api/admin/suscripcion/:empresaId
POST /api/admin/suscripcion/:empresaId/upgrade
POST /api/admin/suscripcion/:empresaId/downgrade
POST /api/admin/suscripcion/:empresaId/reactivar
POST /api/admin/suscripcion/:empresaId/estado
```

### Operación de tenant

```text
POST /api/admin/onboarding
POST /api/admin/usuarios/:empresaId
PUT  /api/admin/empresa-modulos/:empresaId/:moduloId
PUT  /api/admin/empresa-modulos/:empresaId/bulk
DELETE /api/admin/empresa-modulos/:empresaId/:moduloId
GET  /api/admin/proximas-vencer
GET  /api/admin/resumen
```

## 9. Archivos creados o ajustados

- `src/modules/admin/admin.routes.js`
- `src/modules/admin/admin.controller.js`
- `src/modules/admin/admin.service.js`
- `services/adminService.js`
- `src/app.js`
- `routes/admin/planes-admin.js`
- `routes/admin/empresa-modulos.js`
- `docs/frontend-admin-saas-contract.md`
- `docs/sprint-4-consolidacion-saas.md`
- `docs/roadmap-saas.md`

## 10. Riesgos pendientes

1. No existe job automático de expiración para marcar `VENCIDA`.
2. `suscripciones_empresa` sigue coexistiendo mientras el flujo legacy no se retire.
3. `facturas_saas` no cubre todavía el sistema nuevo.
4. El resumen legacy de `/api/suscripciones/resumen` puede divergir del panel admin.
5. No hay aún automatización de cobro ni webhook de pasarela.

## 11. Preparación para Sprint 5

El sistema queda preparado para que Sprint 5 tome esta base y construya:

- facturación del sistema nuevo
- webhook de pagos
- expiración automática
- reactivación ligada a cobro
- reporting comercial más confiable

La consolidación de Sprint 4 deja lista la superficie admin y el contrato
backend/frontend necesario para avanzar sin seguir mezclando catálogo nuevo con legacy.
