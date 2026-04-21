# Sprint 3 — Hardening Backend

Última actualización: 2026-04-21

## Contexto

Después del Sprint 2, AutoGestion360 ya tenía una resolución central de licencias y fallback legacy controlado por configuración. El siguiente paso era endurecer el backend para operar con menos riesgo en un escenario SaaS multiempresa.

## Riesgos detectados

1. `src/app.js` tenía `cors()` abierto y `express.json()` sin límites explícitos.
2. No existía `helmet` ni una política HTTP más estricta a nivel global.
3. No había rate limiting en login ni en mutaciones sensibles del panel admin.
4. Varias rutas críticas recibían JSON sin validación estructurada consistente.
5. Había puntos donde IDs relacionados podían cruzar empresas:
   - creación de vehículos con `cliente_id` externo
   - creación de órdenes de lavadero con `cliente_id`, `vehiculo_id`, `lavador_id` o `tipo_lavado_id` de otra empresa
   - creación de órdenes de taller con `cliente_id`, `vehiculo_id` o `mecanico_id` de otra empresa
6. `.env` estaba rastreado por git en este repositorio. Eso implicaba riesgo operativo y requería limpieza controlada.
7. La ruta legacy activa `routes/reportes.js` seguía creando la tabla `arqueos_caja` en runtime.
8. `setup-demo` usaba una contraseña fija hardcodeada en código.

## Decisiones tomadas

1. Mantener el hardening incremental, sin rediseñar rutas ni romper contratos actuales.
2. Introducir una capa reusable de validación con Zod:
   - `src/middlewares/validate.js`
   - `src/lib/validation/*`
3. Introducir configuración de seguridad HTTP reusable:
   - `src/lib/security/http.js`
   - `src/lib/security/rate-limit.js`
4. Aplicar validación y límites primero en endpoints de mayor impacto:
   - auth
   - admin SaaS
   - suscripciones
   - usuarios
   - empresas
5. Corregir referencias cruzables por `empresa_id` en servicios operativos críticos sin tocar el núcleo SaaS.
6. Endurecer la última ruta legacy montada desde `routes/` y mover su DDL a migración SQL.
7. Mantener `setup-demo` compatible, pero permitir parametrizar su credencial por entorno.

## Medidas implementadas

### 1. Seguridad HTTP

Se endureció `src/app.js` con:

- `helmet`
- `app.disable('x-powered-by')`
- `trust proxy` configurable por entorno
- CORS explícito desde `CORS_ORIGINS`
- límite de payload por `REQUEST_BODY_LIMIT`
- `express.urlencoded()` con el mismo límite

Notas:

- `contentSecurityPolicy` quedó desactivado por ahora para no romper el frontend actual, que todavía no está listo para CSP estricta.
- `crossOriginEmbedderPolicy` y `crossOriginResourcePolicy` quedaron relajadas por compatibilidad con assets y uploads.

### 2. Rate limiting

Se añadió `express-rate-limit` con configuración por variables de entorno.

Endpoints protegidos:

- `GET /api/setup-demo`
- `POST /api/login`
- `POST /api/admin/onboarding`
- `POST /api/admin/usuarios/:empresaId`
- `POST /api/admin/planes`
- `PUT /api/admin/planes/:id`
- `POST /api/admin/suscripcion/:empresaId`
- `POST /api/admin/suscripcion/:empresaId/estado`
- `PUT /api/admin/empresa-modulos/:empresaId/:moduloId`
- `DELETE /api/admin/empresa-modulos/:empresaId/:moduloId`
- `PUT /api/admin/empresa-modulos/:empresaId/bulk`
- `POST /api/suscripciones/upsert`
- `POST /api/suscripciones/:empresaId/renovar`
- `POST /api/suscripciones/:empresaId/estado`
- `POST /api/suscripciones/:empresaId/facturas`
- `POST /api/usuarios`
- `PATCH /api/usuarios/:id/password`
- `POST /api/empresas`
- `POST /api/reportes/caja/arqueos`

No existe hoy un endpoint activo de recuperación de contraseña en el módulo refactorizado, así que no se aplicó limiter ahí. Queda pendiente cuando ese flujo exista formalmente.

### 3. Validación con Zod

Se creó una capa mantenible de validación:

- `src/middlewares/validate.js`
- `src/lib/validation/common.js`
- `src/lib/validation/auth.schemas.js`
- `src/lib/validation/admin.schemas.js`
- `src/lib/validation/suscripciones.schemas.js`
- `src/lib/validation/usuarios.schemas.js`
- `src/lib/validation/empresas.schemas.js`

Payloads cubiertos:

- login
- actualización de empresa del usuario autenticado
- onboarding admin
- creación y edición de planes
- asignación/cambio de plan por empresa
- cambio de estado de suscripción
- creación de admin de tenant
- overrides de módulos por empresa
- bulk de overrides
- upsert/renovación/cambio de estado de suscripciones legacy
- creación de facturas SaaS
- creación, edición, cambio de estado y cambio de password de usuarios
- creación, edición y cambio de estado de empresas
- consultas legacy de reportes con rango de fechas validado
- creación de arqueos de caja legacy

Los errores de validación ahora devuelven `400` con `details` estructurado cuando aplica.

### 4. Autorización y scoping multiempresa

Se creó `src/lib/tenant-scope.js` para validaciones explícitas de pertenencia.

Correcciones aplicadas:

- `src/modules/vehiculos/vehiculos.service.js`
  - valida que `cliente_id` pertenezca a la empresa antes de crear

- `src/modules/lavadero/lavadero.service.js`
  - valida `cliente_id`
  - valida `vehiculo_id`
  - valida `lavador_id` / `empleado_id`
  - valida `tipo_lavado_id`
  - valida `lavador_id` también en asignación posterior

- `src/modules/taller/taller.service.js`
  - valida `cliente_id`
  - valida `vehiculo_id`
  - valida `mecanico_id` / `empleado_id`

- `services/adminService.js`
  - valida existencia de empresa antes de operar
  - valida existencia de módulo antes de override
  - valida existencia de empresa antes de crear admin tenant
  - valida existencia de empresa antes de asignar o cambiar suscripción

## Observaciones sobre autorización multiempresa

### Riesgos corregidos

- asociación cruzada de FKs entre tenants en vehículos, lavadero y taller
- operaciones admin sobre empresa inexistente con errores poco claros
- overrides de módulos sobre empresas/módulos inexistentes
- `reportes` legacy ya no depende de DDL en runtime para `arqueos_caja`

### Riesgos aún pendientes

- todavía existen archivos legacy fuera de `src/modules/`, pero la única ruta legacy montada en `src/app.js` al cierre de este sprint es `routes/reportes.js`
- no se hizo un barrido exhaustivo de cada query en rutas legacy no montadas
- no se introdujo una capa global de autorización por recurso; el sistema sigue apoyándose en filtros por `empresa_id` dentro de servicios/rutas

## Variables de entorno nuevas o relevantes

- `NODE_ENV`
- `TRUST_PROXY`
- `REQUEST_BODY_LIMIT`
- `CORS_ORIGINS`
- `CORS_ALLOW_NO_ORIGIN`
- `CORS_ALLOW_CREDENTIALS`
- `RATE_LIMIT_LOGIN_WINDOW_MS`
- `RATE_LIMIT_LOGIN_MAX`
- `RATE_LIMIT_SETUP_DEMO_WINDOW_MS`
- `RATE_LIMIT_SETUP_DEMO_MAX`
- `RATE_LIMIT_REGISTRATION_WINDOW_MS`
- `RATE_LIMIT_REGISTRATION_MAX`
- `RATE_LIMIT_ADMIN_WINDOW_MS`
- `RATE_LIMIT_ADMIN_MAX`
- `ALLOW_LEGACY_LICENSE_FALLBACK`
- `SETUP_DEMO_PASSWORD`

## Secretos y configuración

Hallazgos:

- `.env` estaba rastreado por git
- `.gitignore` ya lo ignoraba, pero eso no elimina el tracking histórico por sí solo
- `setup-demo` tenía una password fija embebida en código

Decisión tomada en este sprint:

- se actualizó `.env.example`
- `.env` se removió del índice git sin borrar el archivo local
- `setup-demo` ahora permite `SETUP_DEMO_PASSWORD`, con fallback conservador para no romper compatibilidad

Pendiente recomendado:

1. rotar secretos reales si ese `.env` contiene valores válidos
2. confirmar que ningún secreto siga presente en historial o dumps compartidos
3. definir una política para deshabilitar `setup-demo` fuera de entornos de desarrollo

## Checklist de validación manual

### Login y rate limit

- [ ] `POST /api/login` con credenciales correctas responde 200
- [ ] varios intentos fallidos consecutivos en `/api/login` terminan en 429
- [ ] tras un login exitoso, el limiter de login no bloquea inmediatamente nuevos accesos válidos

### Validación Zod

- [ ] enviar `email` inválido en login responde 400 con `details`
- [ ] crear usuario sin password válida responde 400
- [ ] crear empresa con `admin_email` pero sin `admin_password` responde 400
- [ ] enviar `plan_id` inválido en `/api/admin/suscripcion/:empresaId` responde 400
- [ ] enviar payload inválido en bulk de `empresa-modulos` responde 400

### Autorización y módulos

- [ ] un usuario normal sigue accediendo solo a módulos permitidos
- [ ] el middleware de licencia sigue funcionando en rutas operativas
- [ ] superadmin conserva acceso total al menú y endpoints admin

### Admin

- [ ] `GET /api/admin/planes` sigue funcionando
- [ ] `POST /api/admin/planes` crea un plan válido
- [ ] `PUT /api/admin/planes/:id` actualiza un plan válido
- [ ] `POST /api/admin/onboarding` sigue creando tenant correctamente
- [ ] `PUT /api/admin/empresa-modulos/:empresaId/:moduloId` guarda override correctamente
- [ ] `POST /api/reportes/caja/arqueos` sigue guardando un arqueo válido tras aplicar `database/004_arqueos_caja.sql`

### Scoping multiempresa

- [ ] crear vehículo con `cliente_id` de otra empresa responde 404/400
- [ ] crear orden de lavadero con `vehiculo_id` o `lavador_id` de otra empresa responde 404/400
- [ ] crear orden de taller con `mecanico_id` o `cliente_id` de otra empresa responde 404/400
- [ ] usuarios no admin no pueden administrar usuarios de otra empresa

## Pendientes

- migrar o retirar definitivamente `routes/reportes.js` hacia `src/modules/reportes`
- introducir recuperación de contraseña formal con validación y rate limit propio
- considerar CSP real cuando el frontend deje de depender de configuraciones permisivas
- completar rotación de secretos y limpieza histórica si `.env` tuvo valores reales
