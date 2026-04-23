# RBAC real y límites por plan

Fecha: 2026-04-22

## Objetivo

Normalizar control de acceso y límites SaaS para que AutoGestion360 deje de depender del `rol` textual como autoridad principal.

## Fuente de verdad

- Roles y permisos: `roles -> rol_permisos -> permisos`
- Asignación a usuarios: `usuario_roles`
- Límite de usuarios y sedes: `suscripciones -> planes.max_usuarios / planes.max_sedes`

## SQL aplicado

Aplicar en ambientes existentes:

```bash
psql -U <usuario> -d autogestion360 -f database/009_rbac.sql
```

Para instalaciones nuevas, el schema base ya quedó alineado en:

```text
database/001_base_schema.sql
```

## Tablas nuevas

- `roles`
- `permisos`
- `rol_permisos`
- `usuario_roles`
- `sedes`

Además:

- `planes.max_sedes`

## Seeds iniciales

Roles de sistema:

- `superadmin`
- `admin`
- `operador`
- `empleado`

Permisos tenant:

- `clientes:*`
- `vehiculos:*`
- `empleados:*`
- `parqueadero:*`
- `lavadero:*`
- `taller:*`
- `ordenes:*`
- `reportes:*`
- `usuarios:*`
- `configuracion:*`
- `sedes:*`

Permisos platform:

- `platform:empresas:ver`
- `platform:empresas:crear`
- `platform:empresas:editar`
- `platform:suscripciones:gestionar`
- `platform:planes:gestionar`
- `platform:usuarios:gestionar`

## Compatibilidad y migración

La columna `usuarios.rol` se mantiene temporalmente.

Se usa así:

- compatibilidad con frontend y código legacy
- etiqueta primaria visible del usuario
- fallback si la migración RBAC aún no existe

La autoridad real ahora vive en `usuario_roles`.

Mapeo legacy aplicado:

- `SuperAdmin` o `scope=platform` -> `superadmin`
- `Admin` / `Administrador` -> `admin`
- `Operador` -> `operador`
- cualquier otro -> `empleado`

## Runtime

### Auth

`middleware/auth.js` ahora adjunta en `req.user`:

- `roles`
- `permisos`

Y `POST /api/login` / `POST /api/refresh` devuelven también:

- `usuario.roles`
- `usuario.permisos`

### Middleware

Middleware activo:

- `middleware/access.js`

Expuesto:

- `requireLicense`
- `requireModule(codigoModulo)`
- `requirePermission(codigoPermiso)`

## Módulos adaptados

### Usuarios

`/api/usuarios` ya usa `requirePermission()` por ruta y sincroniza `usuario_roles`.

Compatibilidad de payload:

- legacy: `rol`
- nuevo: `rol_codigo`
- nuevo multirol: `roles`

También soporta `scope`, aunque usuarios tenant no pueden crear usuarios platform.

### Sedes

`/api/sedes` ya usa permisos RBAC y el límite de plan ahora se valida desde el servicio compartido de límites.

## Límites por plan

Servicio compartido:

```text
src/lib/plan-limits.service.js
```

Uso actual:

- creación y reactivación de usuarios
- creación y reactivación de sedes

## Smoke test recomendado

1. Login con un usuario tenant admin/superadmin.
2. Verificar que `usuario.roles` y `usuario.permisos` vienen en login.
3. Consultar `GET /api/usuarios` y confirmar que cada registro trae `roles`.
4. Crear un usuario con `rol_codigo=operador` y validar inserción en `usuario_roles`.
5. Reactivar un usuario inactivo y validar enforcement de `max_usuarios`.
6. Crear/activar sedes hasta el límite del plan y confirmar bloqueo.
7. Login con `platform@auto360.com` y validar acceso con permisos de plataforma.

## Notas importantes

- `superadmin` solo puede asignarse desde usuarios con `scope=platform`.
- Un `SuperAdmin` legacy con `scope=tenant` ya no recibe privilegios cross-tenant en el módulo de usuarios.
- El fallback por `rol` textual sigue existiendo para transición, pero ya no es la ruta principal.
