# Sprint 2 — Unificación SaaS

Última actualización: 2026-04-21

## Contexto

AutoGestion360 venía resolviendo licencias por varios caminos en paralelo:

1. sistema SaaS nuevo: `suscripciones`, `planes`, `plan_modulos`, `empresa_modulos`
2. licencias clásicas: `empresa_licencia`, `licencias`, `licencia_modulo`
3. legacy en `empresas`: `licencia_tipo`, `licencia_fin`, `activa`
4. compatibilidad adicional en `suscripciones_empresa` y `facturas_saas`

Eso producía dos problemas:

- la autorización efectiva dependía de varios sitios a la vez
- parte del esquema se creaba o alteraba en runtime desde Node.js

## Problema actual

Antes de este sprint:

- `middleware/licencia.js` mezclaba consultas directas al sistema nuevo, licencias clásicas, `suscripciones_empresa` y legacy
- `services/licenseService.js` resolvía fuentes en cascada, pero sin control explícito del fallback
- el sistema nuevo no era realmente la fuente de verdad si existía un registro viejo que todavía autorizaba acceso
- `utils/licencias-schema.js` y `utils/suscripciones-schema.js` ejecutaban DDL y seeds durante la ejecución normal

## Decisiones tomadas

1. `services/licenseService.js` pasa a ser la capa central de resolución.
2. La autorización oficial usa primero `suscripciones + planes + plan_modulos + empresa_modulos`.
3. El fallback legacy solo existe como compatibilidad transicional y debe activarse con:

```env
ALLOW_LEGACY_LICENSE_FALLBACK=true
```

4. Para mantener la transición segura, si la variable no existe el sistema conserva el fallback legacy habilitado por defecto.
5. Si `ALLOW_LEGACY_LICENSE_FALLBACK=false`, el backend no consulta fuentes legacy para autorizar módulos.
6. El DDL runtime se elimina del flujo normal; ahora los helpers `ensure*` solo validan que el esquema exista.
7. La migración `database/003_runtime_cleanup.sql` contiene el DDL y backfill que antes se ejecutaban desde Node.js.

## Fuente de verdad oficial

La fuente de verdad para autorización y módulos es:

- `suscripciones`
- `planes`
- `plan_modulos`
- `empresa_modulos`

Regla operativa:

- si existe un registro en `suscripciones`, ese resultado manda, incluso si está vencido, suspendido o cancelado
- el sistema no debe “rescatar” acceso desde tablas legacy cuando la fuente oficial ya tiene un estado explícito

## Comportamiento del fallback legacy

`ALLOW_LEGACY_LICENSE_FALLBACK=false`

- solo se consulta la fuente oficial SaaS
- si no hay suscripción nueva válida o el esquema nuevo no está listo, el acceso se niega
- no se consulta `empresa_licencia`, `licencias`, `licencia_modulo` ni `empresas.licencia_*`

`ALLOW_LEGACY_LICENSE_FALLBACK=true`

- se consulta primero la fuente oficial SaaS
- solo si no existe un resultado en la fuente oficial, se permite buscar compatibilidad en:
  - `empresa_licencia` + `licencias` + `licencia_modulo`
  - `empresas.licencia_tipo` / `licencia_fin` / `activa`

Si la variable no está definida:

- el comportamiento por defecto es equivalente a `true`
- esto evita cortar acceso en bases antiguas mientras se aplica la migración SaaS completa

## Tablas activas

Estas son las tablas activas para autorización SaaS:

- `planes`
- `plan_modulos`
- `suscripciones`
- `empresa_modulos`
- `modulos`

## Tablas legacy / transicionales

Estas estructuras siguen existiendo por compatibilidad temporal:

- `empresa_licencia`
- `licencias`
- `licencia_modulo`
- `suscripciones_empresa`
- `facturas_saas`
- columnas en `empresas`:
  - `licencia_tipo`
  - `licencia_id`
  - `licencia_inicio`
  - `licencia_fin`
  - `activa`

Estado esperado:

- pueden seguir siendo usadas por endpoints legacy/admin
- no deben ser la base principal de autorización mientras exista `suscripciones`

## Plan de migración para bases existentes

1. aplicar `database/002_saas_planes.sql` si la base aún no tiene el modelo SaaS nuevo
2. aplicar `database/003_runtime_cleanup.sql`
3. verificar que existan:
   - `suscripciones`
   - `planes`
   - `plan_modulos`
   - `empresa_modulos`
   - tablas transicionales necesarias para compatibilidad legacy
4. revisar empresas sin fila en `suscripciones`
5. crear o migrar la suscripción oficial para cada tenant
6. validar que el frontend obtenga permisos coherentes desde `/api/empresa/licencia/permisos`
7. arrancar con `ALLOW_LEGACY_LICENSE_FALLBACK=true` solo si la migración aún no está cerrada
8. cuando todas las empresas tengan fuente oficial correcta, cambiar a `ALLOW_LEGACY_LICENSE_FALLBACK=false`

## Checklist antes de desactivar fallback legacy

- [ ] todas las empresas activas tienen una fila válida en `suscripciones`
- [ ] cada `suscripciones.plan_id` apunta a un plan existente
- [ ] los módulos requeridos están definidos en `plan_modulos` o `empresa_modulos`
- [ ] `/api/empresa/licencia/permisos` refleja el mismo acceso que el middleware real
- [ ] no quedan rutas operativas dependiendo de `suscripciones_empresa` para autorizar acceso
- [ ] se aplicó `database/003_runtime_cleanup.sql` en todos los ambientes
- [ ] se probó login + acceso por módulo con `ALLOW_LEGACY_LICENSE_FALLBACK=false`
- [ ] se documentó qué endpoints siguen usando tablas transicionales
