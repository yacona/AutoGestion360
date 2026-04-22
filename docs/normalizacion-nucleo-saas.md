# Normalizacion del nucleo SaaS

Fecha: 2026-04-22

## Objetivo

Dejar a `suscripciones` como fuente oficial del acceso SaaS sin romper modulos y pantallas legacy que todavia consumen:

- `suscripciones_empresa`
- `empresa_licencia`
- `empresas.licencia_*`

## Decision tecnica

La autorizacion por modulos y vencimiento queda centrada en:

```text
planes -> plan_modulos -> suscripciones -> empresa_modulos
```

Las tablas legacy no se eliminan en esta fase. Se mantienen como espejo de compatibilidad temporal.

## Cambios aplicados

### 1. Schema base alineado con el codigo

Archivo: `database/001_base_schema.sql`

- `usuarios.scope` queda integrado en el schema base.
- `usuarios.empresa_id` pasa a nullable para usuarios `platform`.
- se agregan constraints `usuarios_scope_check` y `usuarios_scope_empresa_check`
- se agrega `usuarios_platform_email_uniq`
- el indice unico de suscripcion oficial queda nombrado como `suscripciones_activa_uniq`

### 2. Migracion incremental nueva

Archivo: `database/006_saas_core_normalization.sql`

Hace tres cosas:

1. aplica la parte faltante de usuarios `platform/tenant`
2. garantiza seeds minimos del nucleo SaaS
3. rellena y alinea datos entre legacy y oficial

Direccion del backfill:

- legacy -> `suscripciones` cuando todavia no existe fuente oficial activa
- `suscripciones` -> legacy para que reporting y endpoints transicionales sigan funcionando

### 3. Compatibilidad de escritura

Archivo: `services/saasCompatibilityService.js`

Se centralizo la sincronizacion entre ambos mundos:

- `syncSaasSubscriptionFromLegacy()`
- `syncLegacyMirrorFromSaas()`

Con esto:

- si un flujo legacy escribe `suscripciones_empresa`, tambien se actualiza `suscripciones`
- si un flujo SaaS oficial escribe `suscripciones`, tambien se refresca el espejo legacy

### 4. Fuente oficial por defecto

Archivo: `services/licenseService.js`

- `ALLOW_LEGACY_LICENSE_FALLBACK` deja de estar habilitado por defecto
- ahora el fallback legacy es opt-in y no la ruta normal

### 5. Servicios ajustados

- `services/adminService.js`
  sincroniza espejo legacy despues de onboarding, asignacion, cambio de estado y reactivacion
- `utils/suscripciones-schema.js`
  sincroniza la suscripcion oficial cuando un flujo transicional usa `suscripciones_empresa`
- `src/modules/alertas/alertas.service.js`
  prioriza `suscripciones + planes` para alertas de licencia/plan
- `src/modules/empresas/empresas.service.js`
  expone datos oficiales de plan y sincroniza si se actualiza la licencia legacy de una empresa

## Notas de compatibilidad

1. `suscripciones` es la fuente oficial para acceso SaaS.
2. `suscripciones_empresa` y `empresa_licencia` quedan solo como compatibilidad temporal.
3. El mapeo legacy -> plan oficial queda asi:

```text
Demo / Basica -> starter
Pro            -> pro
Premium        -> enterprise
```

4. El mapeo plan oficial -> licencia legacy queda asi:

```text
starter    -> Basica (o Demo si no existe Basica)
pro        -> Pro
enterprise -> Premium
```

5. Esto es suficiente para compatibilidad, pero no convierte al catalogo legacy en fuente comercial de verdad.

## Orden de despliegue recomendado

1. respaldar base de datos
2. aplicar `database/006_saas_core_normalization.sql`
3. desplegar backend nuevo
4. confirmar `.env` con `ALLOW_LEGACY_LICENSE_FALLBACK=false`
5. ejecutar smoke test

## Checklist de smoke test

- [ ] login tenant sigue funcionando
- [ ] login de usuario `platform` funciona con `empresa_id = null`
- [ ] `/api/licencia/permisos` responde usando `suscripciones`
- [ ] una empresa con plan `starter` solo ve modulos permitidos por `plan_modulos`
- [ ] cambiar plan desde `/api/admin` actualiza acceso efectivo
- [ ] el espejo legacy (`suscripciones_empresa`, `empresa_licencia`) refleja el cambio anterior
- [ ] crear o renovar desde endpoints legacy sigue dejando acceso operativo
- [ ] alertas de vencimiento toman como referencia la suscripcion oficial
- [ ] `ALLOW_LEGACY_LICENSE_FALLBACK=true` sigue permitiendo rescate temporal si hiciera falta

## Riesgos abiertos

1. Sigue existiendo deuda mientras sobrevivan endpoints legacy de licencias y suscripciones.
2. El sistema aun no tiene RBAC formal ni refresh tokens; esta migracion no cubre eso.
3. El mapeo `starter -> Basica/Demo` es una estrategia de compatibilidad, no una equivalencia comercial perfecta.
