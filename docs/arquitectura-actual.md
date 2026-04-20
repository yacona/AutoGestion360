# Arquitectura actual — AutoGestión360

> Estado al: 2026-04-18
> Revisado por: análisis estático completo del código fuente

---

## 1. Visión general

AutoGestión360 es una API REST SaaS multi-empresa consumida por un SPA (`frontend/`). Cada empresa tiene un **tenant lógico** identificado por `empresa_id`; no hay aislamiento físico (schemas PG separados, RLS) entre tenants.

```
[SPA / frontend]  ←→  [Express 4 — src/app.js — puerto 4000]  ←→  [PostgreSQL 14]
```

El punto de entrada es `server.js`, que delega toda la configuración a `src/app.js`.

---

## 2. Capas del sistema

### 2.1 Routing (`src/app.js`)

Todos los módulos están migrados al patrón `routes → controller → service`:

```
src/modules/<dominio>/
  <dominio>.routes.js      # define los endpoints Express
  <dominio>.controller.js  # delega a service, wrap() para async errors
  <dominio>.service.js     # SQL + lógica de negocio
```

Excepción activa: `routes/reportes.js` y `routes/admin/` siguen siendo legacy (sin migrar).

### 2.2 Infraestructura compartida (`src/lib/`)

| Archivo | Propósito |
|---------|-----------|
| `AppError.js` | Error operacional con `statusCode` + `isOperational` |
| `withTransaction.js` | Wrapper `BEGIN/COMMIT/ROLLBACK` que libera el cliente siempre |
| `helpers.js` | `normalizeRole`, `isSuperAdmin`, `canManageUsers`, `normalizarPlaca`, `toNumber`, `cleanText`, `tableExists`, `handleDbError` |

**Advertencia:** existe duplicación con `src/utils/`:
- `src/utils/errors.js` — AppError con subclases (`NotFoundError`, `ValidationError`, etc.) no usadas por los módulos
- `src/utils/transaction.js` — misma lógica que `src/lib/withTransaction.js`, exporta `{ withTransaction }` en lugar de la función directa
- `src/utils/normalizers.js` — solapa parcialmente con `src/lib/helpers.js`

Acción recomendada: consolidar en `src/lib/`, eliminar `src/utils/errors.js`, `src/utils/transaction.js`, `src/utils/normalizers.js`.

### 2.3 Autenticación (`middleware/auth.js`)

Valida JWT en `Authorization: Bearer <token>`, inyecta `req.user = { id, empresa_id, rol }`.

### 2.4 Licenciamiento (`middleware/licencia.js` + `services/licenseService.js`)

`licenseService.getLicenseStatus(empresaId)` resuelve en tres niveles (fallback en cascada):

```
1. suscripciones + planes + plan_modulos + empresa_modulos  → fuente: 'planes'
2. empresa_licencia + licencias + licencia_modulo           → fuente: 'licencias'
3. empresas.licencia_tipo (string hardcodeado)              → fuente: 'legacy'
```

`licenseMiddleware(modulo)` llama a `getLicenseStatus` y corta la cadena en el primer nivel que tiene datos. Los SuperAdmin bypasan toda verificación.

### 2.5 Base de datos (`db.js`)

Pool `pg` configurado con `DB_*` vars. No hay ORM. Queries SQL directas en los services.

---

## 3. Módulos de negocio

| Módulo | Ubicación | Tablas principales |
|--------|-----------|-------------------|
| auth | `src/modules/auth/` | `usuarios`, `empresas` |
| parqueadero | `src/modules/parqueadero/` | `parqueadero`, `mensualidades_parqueadero` |
| tarifas | `src/modules/tarifas/` | `tarifas` |
| reportes-parqueadero | `src/modules/reportes-parqueadero/` | `parqueadero`, `arqueos_caja` |
| clientes | `src/modules/clientes/` | `clientes` |
| vehiculos | `src/modules/vehiculos/` | `vehiculos` |
| empleados | `src/modules/empleados/` | `empleados` |
| lavadero | `src/modules/lavadero/` | `lavadero`, `tipos_lavado` |
| taller | `src/modules/taller/` | `taller_ordenes`, `taller_items` |
| pagos | `src/modules/pagos/` | `pagos_servicios` |
| alertas | `src/modules/alertas/` | `alertas` |
| auditoria | `src/modules/auditoria/` | `auditoria` |
| configuracion | `src/modules/configuracion/` | `configuracion_parqueadero`, `reglas_parqueadero` |
| empresas | `src/modules/empresas/` | `empresas` |
| usuarios | `src/modules/usuarios/` | `usuarios` |
| licencias | `src/modules/licencias/` | `licencias`, `modulos`, `licencia_modulo`, `empresa_licencia` |
| suscripciones | `src/modules/suscripciones/` | `suscripciones_empresa`, `facturas_saas` |
| reportes (legacy) | `routes/reportes.js` | múltiples tablas |
| admin/planes (legacy) | `routes/admin/planes-admin.js` | `planes`, `suscripciones`, `empresa_modulos` |
| admin/empresa-modulos (legacy) | `routes/admin/empresa-modulos.js` | `empresa_modulos` |

---

## 4. Esquema de base de datos

### 4.1 Schema base — `database/001_base_schema.sql`

```
empresas ──┬── usuarios
           ├── clientes ── vehiculos
           ├── empleados
           ├── parqueadero ── mensualidades_parqueadero
           ├── lavadero ── tipos_lavado
           ├── taller_ordenes ── taller_items
           ├── tarifas
           ├── pagos_servicios
           ├── arqueos_caja
           ├── alertas
           ├── auditoria
           ├── configuracion_parqueadero
           ├── reglas_parqueadero
           ├── licencias ── licencia_modulo ── modulos
           ├── empresa_licencia
           ├── suscripciones_empresa ── facturas_saas
           └── licencia_id (FK → licencias, columna directa)
```

Este archivo es **idempotente** (`IF NOT EXISTS` en todo). Es la fuente de verdad para instalaciones nuevas.

### 4.2 Schema SaaS — `database/002_saas_planes.sql`

Extiende el schema con el núcleo SaaS completo:

```
planes ── plan_modulos ── modulos (extendida con activo/orden/icono_clave)
planes ── suscripciones (1 activa/trial por empresa, restricción por índice parcial)
empresas ── empresa_modulos ── modulos (overrides y add-ons por empresa)
```

También migra datos existentes de `suscripciones_empresa` → `suscripciones`.

### 4.3 Archivos obsoletos (no ejecutar en instalaciones nuevas)

| Archivo | Estado |
|---------|--------|
| `estructura.sql` | Absorbido por `001_base_schema.sql` |
| `licencias_setup.sql` | Seeds incluidos en `001_base_schema.sql` (Bloque 8) |
| `migrations/licencias_migration.sql` | Incluido en `001_base_schema.sql` (Bloque 3) |
| `migrations/arqueos_caja_migration.sql` | Incluido en `001_base_schema.sql` (Bloque 4) |
| `migrations/pagos_servicios_migration.sql` | Incluido en `001_base_schema.sql` (Bloque 4) |
| `migrations/suscripciones_saas_migration.sql` | Incluido en `001_base_schema.sql` (Bloque 5) |

---

## 5. Inconsistencias activas

### INC-001 — Dos sistemas de suscripciones paralelos (CRÍTICA)

**Descripción:** Coexisten dos tablas con propósitos solapados:

| Tabla | Quién la gestiona | Quién la lee |
|-------|-------------------|--------------|
| `suscripciones_empresa` | `src/modules/suscripciones/` via `utils/suscripciones-schema.js` | `middleware/licencia.js` (cadena legacy) |
| `suscripciones` | `routes/admin/planes-admin.js` via `services/adminService.js` | `services/licenseService.js` (cadena nueva) |

Una empresa puede tener datos válidos solo en una de las dos tablas. `licenseService` prioriza `suscripciones` (nueva). El módulo `/api/suscripciones` gestiona `suscripciones_empresa` (vieja). Son **sistemas separados que no se sincronizan**.

**Acción recomendada:** Migrar `/api/suscripciones` para operar sobre `suscripciones` + `planes`. Deprecar `suscripciones_empresa` como tabla de control de acceso (puede mantenerse para facturación histórica).

---

### INC-002 — `pagos_parqueadero` tabla fantasma (CRÍTICA)

**Descripción:** `routes/pagos.js` (legacy, aún activo) referencia `pagos_parqueadero` en múltiples queries. La tabla no existe en ningún archivo SQL ni se crea en código.

**Impacto:** `GET /api/pagos/parqueadero/:id` y `PATCH /api/pagos/:id` lanzan `relation "pagos_parqueadero" does not exist` en producción cuando buscan fuera de `pagos_servicios`.

**Acción recomendada:** Eliminar ramas de fallback que leen de `pagos_parqueadero` en `src/modules/pagos/pagos.service.js`. Unificar en `pagos_servicios`.

---

### INC-003 — Duplicación en `src/utils/` vs `src/lib/` (ALTA)

**Descripción:** Tres archivos en `src/utils/` duplican lógica ya centralizada en `src/lib/`:

- `src/utils/errors.js` → duplica `src/lib/AppError.js` (tiene subclases que `src/lib/` no tiene)
- `src/utils/transaction.js` → duplica `src/lib/withTransaction.js` (diferente estilo de export)
- `src/utils/normalizers.js` → solapa con `src/lib/helpers.js`

Los módulos refactorizados usan `src/lib/`; nada usa `src/utils/errors.js` ni `src/utils/transaction.js`.

**Acción recomendada:** Enriquecer `src/lib/AppError.js` con las subclases de `src/utils/errors.js`. Eliminar `src/utils/errors.js`, `src/utils/transaction.js`, `src/utils/normalizers.js`.

---

### INC-004 — Triple sistema de licencias (ALTA)

**Descripción:** Aún coexisten tres mecanismos para determinar acceso a módulos (ver sección 2.4). `licenseService` los maneja correctamente en cascada, pero el sistema es complejo de mantener y genera datos inconsistentes entre empresas.

**Estado actual:** el middleware es correcto pero la deuda persiste mientras no se migre todo al sistema de planes.

---

### INC-005 — `routes/admin/` sin migrar a `src/modules/` (MEDIA)

**Descripción:** `routes/admin/planes-admin.js` y `routes/admin/empresa-modulos.js` siguen en el patrón legacy (handler todo-en-uno). Toda la lógica de onboarding, creación de tenants y asignación de planes está en `services/adminService.js` sin capa intermedia de controller.

**Acción recomendada:** Migrar a `src/modules/admin/`.

---

### INC-006 — `routes/reportes.js` sin migrar (MEDIA)

**Descripción:** Es el único módulo operativo que sigue en el patrón legacy. Tiene el `CREATE TABLE IF NOT EXISTS arqueos_caja` embebido (duplicado con `001_base_schema.sql`).

**Acción recomendada:** Migrar a `src/modules/reportes/`. Eliminar el `CREATE TABLE` embebido.

---

### INC-007 — `estructura.sql` y `migrations/` en raíz (BAJA)

**Descripción:** Archivos históricos que confunden a nuevos desarrolladores sobre cuál es el camino correcto de inicialización.

**Acción recomendada:** Mover a `database/legacy/` o eliminar del repositorio (conservar solo en git history).

---

### INC-008 — `.env` en el repositorio (CRÍTICA — preexistente)

**Descripción:** El archivo `.env` con credenciales reales fue commiteado en algún momento. Aunque `.gitignore` lo excluya ahora, las credenciales pueden estar en el historial de git.

**Acción recomendada:** Rotar todas las credenciales (DB_PASSWORD, JWT_SECRET, SMTP_PASS). Ejecutar `git filter-repo` o `BFG Repo-Cleaner` para limpiar el historial si el repo es público o semipúblico.

---

## 6. Orden correcto de trabajo para la próxima fase

### Prioridad 1 — Eliminar errores en producción (esta semana)

1. **INC-002:** Limpiar referencias a `pagos_parqueadero` en `src/modules/pagos/pagos.service.js`
2. **INC-008:** Rotar credenciales expuestas

### Prioridad 2 — Consolidar infraestructura (próxima semana)

3. **INC-003:** Enriquecer `src/lib/AppError.js` con subclases. Borrar `src/utils/errors.js`, `src/utils/transaction.js`, `src/utils/normalizers.js`
4. **INC-006:** Migrar `routes/reportes.js` a `src/modules/reportes/`
5. Mover archivos obsoletos a `database/legacy/`

### Prioridad 3 — Definir fuente de verdad SaaS (siguiente sprint)

6. **INC-001:** Migrar `/api/suscripciones` para operar sobre tabla `suscripciones` + `planes`
7. **INC-005:** Migrar `routes/admin/` a `src/modules/admin/`
8. Deprecar `suscripciones_empresa` como tabla de control de acceso

### Prioridad 4 — Hardening antes de clientes reales

9. Rate limiting en `/api/login` y `/api/register` (`express-rate-limit`)
10. Headers de seguridad (`helmet`)
11. Validación de inputs con `zod` (ya en `package.json`, no se usa)
12. CORS restrictivo por whitelist en `NODE_ENV=production`
13. Audit de autorización: verificar `empresa_id === req.user.empresa_id` en todos los handlers

---

## 7. Flujo de autenticación

```
POST /api/login
  → valida email/password contra usuarios WHERE empresa_id = empresa_activa
  → genera JWT { id, empresa_id, rol, nombre }
  → retorna { token, usuario }

Solicitudes posteriores:
  → Authorization: Bearer <token>
  → authMiddleware: verifica firma, inyecta req.user
  → licenseMiddleware: getLicenseStatus → verifica módulo
  → controller/service
```

---

## 8. Decisiones técnicas pendientes

| Decisión | Opciones | Impacto |
|----------|----------|---------|
| Sistema de licencias definitivo | Consolidar en `suscripciones+planes` vs mantener tres niveles | Alto |
| Herramienta de migrations | `node-pg-migrate`, Flyway, manual | Medio |
| Aislamiento de tenants | Row-level security PG vs application-level actual | Alto |
| Pasarela de pago | Wompi (Colombia) vs Stripe (internacional) | Alto |
| Logging estructurado | `pino` vs `winston` vs `console` actual | Bajo |
| Workers asincrónos | Bull/BullMQ para emails y reportes pesados | Medio |
