# Sprint 4.5 — Separación de Usuarios Plataforma / Tenant

**Fecha:** 2026-04-21  
**Estado:** Completado  
**Objetivo:** Garantizar que los usuarios de plataforma (SuperAdmin, Soporte, Comercial) no dependan de ninguna empresa cliente para autenticarse ni operar.

---

## Problema

Antes de este sprint, todos los usuarios del sistema tenían `empresa_id NOT NULL`. Esto causaba:

1. El superadmin de plataforma estaba "atado" a una empresa cliente específica.
2. Si esa empresa quedaba inactiva o vencía su licencia, el superadmin también perdía acceso.
3. No había distinción técnica entre "usuario que administra la plataforma" y "usuario que administra su propio negocio".

---

## Solución Implementada

### 1. Migración de Base de Datos (`database/005_platform_users.sql`)

```sql
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS scope VARCHAR(10) NOT NULL DEFAULT 'tenant';
ALTER TABLE usuarios ALTER COLUMN empresa_id DROP NOT NULL;
```

**Restricciones añadidas:**
- `usuarios_scope_check`: scope ∈ {'platform', 'tenant'}
- `usuarios_scope_empresa_check`: si `scope='tenant'` → `empresa_id` no puede ser NULL
- `usuarios_platform_email_uniq`: email único entre usuarios de plataforma
- `usuarios_scope_idx`: índice sobre scope para consultas eficientes

### 2. Autenticación (`src/modules/auth/`)

**`auth.repository.js`**
- `findUserWithEmpresa`: cambiado de `INNER JOIN` a `LEFT JOIN` sobre `empresas`, para soportar `empresa_id = NULL`.
- Agrega `u.scope` al `SELECT`.
- Ordena priorizando usuarios de plataforma en caso de conflicto de email.
- Nueva función `createPlatformUser({ nombre, email, password_hash, rol })`.

**`auth.service.js`**
- `buildToken()`: incluye `scope` en el payload del JWT.
- `login()`: para usuarios con `scope='platform'`, omite la validación de empresa activa. No devuelve datos de empresa (`response.empresa = null`).

**`middleware/auth.js`**
- Extrae `scope` del token decodificado y lo expone como `req.user.scope`.
- Default `'tenant'` para tokens legacy sin `scope`.

### 3. Middleware de Licencia (`middleware/licencia.js`)

Los usuarios de plataforma (`scope='platform'`) saltean completamente la verificación de licencia de tenant. No tienen empresa cliente asociada, por lo que la verificación no aplica.

```js
function esPlatformUser(req) { return req.user?.scope === 'platform'; }

if (esSuperAdmin(req) || esPlatformUser(req)) return next();
```

### 4. Guards en Rutas de Empresa (`src/modules/auth/auth.controller.js`)

`requireTenantScope()` bloquea con HTTP 403 a usuarios de plataforma en rutas que operan sobre datos de una empresa cliente:

- `GET /auth/empresa`
- `PUT /auth/empresa`
- `POST /auth/empresa/logo`
- `GET /auth/empresa/licencia`
- `GET /auth/empresa/licencia/permisos`

### 5. Admin Panel (`src/modules/admin/admin.controller.js`)

`requireSuperAdmin()` continúa verificando el rol. En Sprint 4.5 se añade un `console.warn` cuando el scope no es `'platform'` para detectar superadmins de tenant durante la transición.

> **Sprint 5 enforcement:** `requireSuperAdmin` rechazará explícitamente usuarios con `scope !== 'platform'`.

### 6. Scripts de Administración

**`scripts/create-platform-admin.js`** (nuevo)  
Bootstrap para crear el primer usuario de plataforma. Verifica que no exista, hashea la contraseña, inserta con `scope='platform'` y `empresa_id=NULL`.

```bash
PLATFORM_ADMIN_EMAIL=ops@auto360.com PLATFORM_ADMIN_PASSWORD=secreto node scripts/create-platform-admin.js
```

**`scripts/promote-superadmin.js`** (actualizado)  
Ahora también establece `scope='platform'` y `empresa_id=NULL` al promover a SuperAdmin.

```bash
node scripts/promote-superadmin.js usuario@empresa.com
```

---

## Modelo de Datos Resultante

```
usuarios
├── scope = 'platform'  → empresa_id = NULL  (admins de plataforma)
└── scope = 'tenant'    → empresa_id = NOT NULL  (usuarios de empresas cliente)
```

---

## Flujo de Login Post-Sprint 4.5

```
POST /api/auth/login
  ├── Buscar usuario por email (LEFT JOIN empresas)
  ├── Si scope='platform':
  │     - Saltar validación empresa_activa
  │     - response.empresa = null
  │     - Token incluye scope='platform', empresa_id=null
  └── Si scope='tenant':
        - Validar empresa_activa = true
        - response.empresa = { datos de empresa }
        - Token incluye scope='tenant', empresa_id = empresa del usuario
```

---

## Impacto en Funcionalidades Existentes

| Área | Impacto |
|------|---------|
| Login tenant | Sin cambios visibles |
| Login platform | Ahora funciona sin empresa |
| Middleware licencia | Platform users bypass automático |
| Panel admin | Funciona igual; warning en consola para tenant-superadmins |
| Rutas `/auth/empresa/*` | Bloquean a platform users con 403 |
| Scripts de seed/demo | Sin cambios (crean usuarios tenant) |

---

## Deuda Técnica / Próximos Pasos (Sprint 5)

1. **Enforcement estricto en admin panel**: rechazar `scope !== 'platform'` en `requireSuperAdmin`.
2. **Roles de plataforma diferenciados**: `superadmin`, `soporte`, `comercial` con permisos distintos.
3. **Migración de superadmins existentes**: ejecutar `promote-superadmin.js` para todos los superadmins de tenant que deberían ser de plataforma.
4. **Auditoría**: tabla de audit log para acciones de usuarios de plataforma sobre tenants.
