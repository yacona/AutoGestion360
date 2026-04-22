# Roadmap SaaS — AutoGestion360

Última actualización: 2026-04-22

## Norte del producto

Convertir AutoGestion360 en un SaaS multiempresa operable, con:

- control centralizado de planes, módulos y suscripciones
- panel SuperAdmin estable y usable por frontend
- seguridad backend suficiente para clientes reales
- ciclo comercial trazable
- despliegue y operación más predecibles

## Estado resumido

| Sprint | Estado | Resultado real |
|---|---|---|
| Sprint 1 | Completado | Línea base del repo, esquema consolidado y documentación inicial |
| Sprint 2 | Completado | Resolución central de licencias y fallback legacy controlado |
| Sprint 3 | Completado | Hardening backend, rate limiting, validación Zod y revisión tenant |
| Sprint 4 | Completado | Panel admin SaaS consolidado, contrato frontend/backend y lifecycle formalizado |
| Sprint 4.5 | Completado | Separación usuarios plataforma/tenant, scope en JWT, guards por scope |
| Sprint 4.6 | Completado | Normalización núcleo SaaS, `suscripciones` oficial y espejo legacy sincronizado |
| Sprint 4.7 | Completado | Sesiones persistentes, refresh rotation, logout global y auditoría de autenticación |
| Sprint 5 | Pendiente | Cobro, facturación nueva, expiración automática y operación comercial |
| Sprint 6 | Pendiente | Observabilidad, CI/CD y despliegue |

---

## Sprint 1 — Estabilización técnica

### Estado
Completado.

### Resultado

- inventario real del backend y frontend
- `.env.example` alineado
- `database/001_base_schema.sql`
- base documental para levantar el proyecto desde cero

---

## Sprint 2 — Unificación de licenciamiento

### Estado
Completado.

### Resultado

- `services/licenseService.js` como capa central
- `middleware/licencia.js` usando SaaS como fuente principal
- `ALLOW_LEGACY_LICENSE_FALLBACK` para compatibilidad transicional
- `database/003_runtime_cleanup.sql` para sacar DDL del runtime principal
- documentación operativa en `docs/sprint-2-unificacion-saas.md`

### Fuente de verdad resultante

La autorización por módulos quedó centrada en:

```text
suscripciones
planes
plan_modulos
empresa_modulos
```

El legacy permanece solo como fallback controlado.

---

## Sprint 3 — Hardening de backend

### Estado
Completado.

### Resultado

- `helmet`
- CORS explícito por entorno
- límites de payload
- rate limiting para login y mutaciones sensibles
- validación Zod centralizada
- revisión de scoping multiempresa
- `.env` removido del índice git y `.env.example` actualizado
- documentación en `docs/sprint-3-hardening-backend.md`

---

## Sprint 4 — Consolidación SaaS

### Estado
Completado.

### Resultado funcional

- panel admin SaaS consolidado en `src/modules/admin/`
- rutas legacy `routes/admin/*` reducidas a adapters/shims
- catálogo SaaS centralizado en una sola capa de servicio
- endpoints de detalle de plan, módulos por plan, overrides por empresa y límites efectivos
- lifecycle documentado e implementado para:
  - trial
  - activación
  - upgrade
  - downgrade
  - suspensión
  - cancelación
  - vencimiento documental
  - reactivación
- endpoint de historial de suscripciones
- endpoint de estado SaaS consolidado por empresa
- contrato backend/frontend creado en `docs/frontend-admin-saas-contract.md`
- documentación técnica creada en `docs/sprint-4-consolidacion-saas.md`

### Arquitectura vigente tras Sprint 4

```text
src/modules/admin/
  admin.routes.js
  admin.controller.js
  admin.service.js

services/adminService.js
  -> núcleo de catálogo SaaS y lifecycle reutilizable
```

### Fuente de verdad operativa

```text
planes -> plan_modulos -> suscripciones -> empresa_modulos
```

### Legacy definido

- `suscripciones_empresa`: transicional, orientada a compatibilidad y reporting
- `facturas_saas`: transicional, histórica, todavía asociada al flujo legacy

Ambas quedan documentadas; no son la fuente de verdad oficial del panel admin.

---

---

## Sprint 4.5 — Separación de usuarios plataforma / tenant

### Estado
Completado.

### Objetivo

Garantizar que los usuarios operativos de la plataforma (SuperAdmin, Soporte, Comercial) no dependan de ninguna empresa cliente para autenticarse ni operar.

### Entregables

- `scope` (`'platform'` | `'tenant'`) añadido a la tabla `usuarios` (`database/005_platform_users.sql`)
- `empresa_id` ahora nullable para usuarios de plataforma
- `auth.repository.js`: LEFT JOIN, expone `scope`, nuevo `createPlatformUser`
- `auth.service.js`: `scope` en JWT, login platform omite validación empresa activa
- `middleware/auth.js`: `scope` en `req.user`
- `middleware/licencia.js`: usuarios de plataforma bypass automático de licencia
- `auth.controller.js`: `requireTenantScope()` bloquea platform users en rutas de empresa
- `admin.controller.js`: `requireSuperAdmin()` loguea (warning) superadmins de scope tenant
- `scripts/create-platform-admin.js`: bootstrap para primer usuario de plataforma
- `scripts/promote-superadmin.js`: ahora también fija `scope='platform'` y `empresa_id=NULL`
- Documentado en `docs/sprint-4-5-separacion-usuarios-plataforma-tenant.md`

### Deuda pendiente para Sprint 5

- Enforcement estricto: rechazar `scope !== 'platform'` en el panel admin
- Roles diferenciados de plataforma (`superadmin`, `soporte`, `comercial`)
- Migración de superadmins existentes

---

## Sprint 4.6 -- Normalizacion del nucleo SaaS

### Estado
Completado.

### Resultado

- `suscripciones` queda como fuente oficial por defecto
- fallback legacy pasa a ser opt-in
- `database/001_base_schema.sql` integra soporte `platform/tenant`
- `database/006_saas_core_normalization.sql` migra y alinea oficial + legacy
- sincronizacion bidireccional oficial/legacy centralizada
- alertas y listados administrativos priorizan el estado oficial

### Nota operativa

Las tablas legacy no se eliminan aun. Permanecen como compatibilidad temporal para endpoints y reportes que todavia no migran.

---

## Sprint 4.7 -- Identidad y seguridad de sesiones

### Estado
Completado.

### Resultado

- `user_sessions` como tabla base de sesiones
- refresh token opaco con rotacion por uso
- revocacion por sesion y logout global
- access token JWT corto con `sid`
- auditoria de login, refresh, logout y accesos denegados
- compatibilidad mantenida para `POST /api/login`

### Documentacion

- `docs/auth-sesiones-refresh.md`

---

## Sprint 5 — Cobro y operación comercial

### Estado
Pendiente.

### Objetivo

Habilitar el ciclo comercial completo del SaaS.

### Alcance esperado

- tabla de facturas del sistema nuevo referenciada a `suscripciones`
- integración con pasarela de pago
- webhook de confirmación
- expiración automática de trial y suscripciones activas
- renovación y reactivación asistidas por pagos
- notificaciones operativas del lifecycle

---

## Sprint 6 — Observabilidad y despliegue

### Estado
Pendiente.

### Objetivo

Dejar la operación más apta para producción.

### Alcance esperado

- logging estructurado
- health checks reales con DB
- estrategia de backups y restore
- CI mínima
- deploy y rollback documentados

---

## Riesgos abiertos al cierre de Sprint 4

1. `suscripciones_empresa` y `facturas_saas` siguen activas para compatibilidad.
2. No existe todavía job automático para marcar `VENCIDA`.
3. No existe todavía facturación nativa del sistema nuevo.
4. El módulo legacy de licencias sigue coexistiendo mientras se completa la migración.

## Criterio de entrada para Sprint 5

Antes de arrancar Sprint 5, el equipo ya cuenta con:

- panel admin SaaS integrado en `src/app.js`
- contrato frontend/backend usable
- lifecycle formalizado
- catálogo centralizado
- definición explícita del rol de tablas legacy
