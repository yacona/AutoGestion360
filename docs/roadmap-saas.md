# Roadmap SaaS — AutoGestion360

> Documento operativo posterior al Sprint 1
> Última actualización: 2026-04-20

## Norte del proyecto

Convertir AutoGestion360 en un SaaS multiempresa operable, instalable desde cero, con control claro de planes, licencias, cobro, seguridad y despliegue.

## Sprint 1 — Estabilización técnica del repositorio

### Objetivo

Dejar una línea base coherente sin cambiar todavía el comportamiento funcional.

### Entregables

- inventario real de módulos y dependencias SQL
- comparación backend vs `estructura.sql`
- documentación de arquitectura actual
- `.env.example` alineado con variables realmente usadas
- `database/001_base_schema.sql` como esquema inicial consolidado
- README con instalación y arranque desde cero

### Resultado esperado

- un desarrollador nuevo puede levantar el sistema sin depender de DDL en runtime ni de adivinar qué SQL ejecutar
- el equipo entiende qué partes son activas y cuáles son legacy

## Sprint 2 — Unificación de esquema y contratos

### Objetivo

Reducir la ambigüedad entre modelo legacy y modelo SaaS nuevo.

### Prioridades

1. declarar una sola fuente de verdad para suscripciones activas
2. separar claramente tablas activas, tablas legacy y compatibilidades
3. sacar del runtime el DDL restante
4. documentar un flujo incremental de actualización para bases existentes

### Entregables sugeridos

- `database/002_runtime_cleanup.sql` o migraciones equivalentes
- desactivación controlada de creadores dinámicos de tablas
- matriz de compatibilidad entre `suscripciones_empresa` y `suscripciones`

### Estado actual

- `services/licenseService.js` resuelve la autorización desde una sola capa central
- `middleware/licencia.js` usa el sistema nuevo como fuente principal
- el fallback legacy quedó detrás de `ALLOW_LEGACY_LICENSE_FALLBACK`
- el DDL runtime de licencias/suscripciones se movió a `database/003_runtime_cleanup.sql`
- detalle operativo documentado en `docs/sprint-2-unificacion-saas.md`

## Sprint 3 — Hardening de backend

### Objetivo

Preparar la aplicación para operar con clientes reales.

### Tareas

- rate limiting en login y registro
- headers de seguridad con `helmet`
- validación de payloads con `zod`
- política CORS explícita
- revisión completa de autorización por `empresa_id`
- estrategia para retiro de `.env` del índice y rotación de secretos

## Sprint 4 — Consolidación SaaS

### Objetivo

Cerrar la brecha entre el modelo funcional actual y un SaaS administrable.

### Tareas

- unificar control de acceso sobre `suscripciones + planes + plan_modulos + empresa_modulos`
- redefinir el rol de `suscripciones_empresa` y `facturas_saas`
- terminar migración del panel admin a `src/modules`
- centralizar catálogo de módulos y límites por plan
- definir flujo formal de upgrade/downgrade de plan

## Sprint 5 — Cobro y operación comercial

### Objetivo

Habilitar el ciclo comercial completo del producto.

### Tareas

- integrar pasarela de pago
- webhook de confirmación de pagos
- suspensión automática por vencimiento
- renovación y facturación
- panel de métricas SaaS

## Sprint 6 — Observabilidad y despliegue

### Objetivo

Tener una base más apta para producción.

### Tareas

- logging estructurado
- health checks reales con estado de DB
- backups y restore documentados
- CI mínima
- estrategia de deploy y rollback

## Decisiones aún abiertas

- si `suscripciones` reemplaza formalmente a `suscripciones_empresa`
- si se adopta una herramienta de migrations
- si el modelo multiempresa seguirá siendo solo por `empresa_id`
- cuál pasarela será la principal
- cómo versionar seeds y catálogos SaaS
