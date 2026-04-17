# Roadmap SaaS — AutoGestión360

> Documento vivo. Actualizar al cerrar cada fase.  
> Última revisión: 2026-04-16

---

## Estado actual (Fase 0 — Estabilización)

El sistema tiene funcionalidad completa para los módulos operativos core, pero acumula deuda técnica en el esquema de base de datos y en la capa de licenciamiento. El objetivo inmediato es estabilizar sin reescribir lógica de negocio.

**Funcional hoy:**
- Multi-empresa con aislamiento lógico por `empresa_id`.
- Módulos: Parqueadero, Lavadero, Taller, Clientes, Vehículos, Empleados.
- Arqueos de caja y reportes.
- Sistema de licencias (tres generaciones coexistiendo).
- Facturación SaaS básica (tablas creadas, flujo parcialmente implementado).

---

## Fase 1 — Consolidación técnica (Prioridad: ALTA)

**Objetivo:** Eliminar inconsistencias que generan errores en producción.

| Tarea | Archivo afectado | Tipo |
|-------|-----------------|------|
| Eliminar referencias a `pagos_parqueadero` | `routes/pagos.js` | Bugfix |
| Mover CREATE TABLE dinámicos a migrations SQL | `routes/alertas.js`, `routes/auditoria.js`, `routes/parqueadero.js`, `utils/parqueadero-config.js` | Refactor |
| Eliminar CREATE TABLE duplicado de `arqueos_caja` | `routes/reportes.js` | Refactor |
| Eliminar CREATE TABLE duplicado de `tarifas` | `utils/parqueadero-config.js` | Refactor |
| Agregar `authMiddleware` a `/api/licencias` y `/api/suscripciones` | `server.js` | Seguridad |
| Documentar decisión sobre `licenseMiddleware` en `/api/pagos` | `server.js` | Seguridad |
| Consolidar sistema de licencias: declarar fuente de verdad | `middleware/licencia.js` | Refactor |

---

## Fase 2 — Migración de esquema ordenada (Prioridad: ALTA)

**Objetivo:** Un solo camino para inicializar la base de datos desde cero.

| Tarea | Entregable |
|-------|-----------|
| Consolidar `estructura.sql` en `database/001_base_schema.sql` | `database/001_base_schema.sql` |
| Extraer tablas dinámicas a `database/002_tablas_runtime.sql` | `database/002_tablas_runtime.sql` |
| Script de inicialización en orden correcto | `scripts/init-db.sh` |
| Agregar `database/README.md` con orden de ejecución | `database/README.md` |
| Evaluar migrar a herramienta de migrations (node-pg-migrate o similar) | Decisión técnica |

---

## Fase 3 — Hardening de seguridad (Prioridad: ALTA)

**Objetivo:** Que el sistema sea seguro antes de recibir clientes reales.

| Tarea | Descripción |
|-------|-------------|
| Rate limiting | `express-rate-limit` en `/api/login` y `/api/register` |
| Helmet | Headers de seguridad HTTP |
| Validación de inputs | `joi` o `zod` en todos los endpoints de mutación |
| CORS restrictivo | Lista blanca de dominios en producción |
| Variables de entorno en producción | Audit de `.env` — separar dev/prod |
| Audit de autorización | Verificar que todos los handlers validan `empresa_id === req.user.empresa_id` |

---

## Fase 4 — Observabilidad (Prioridad: MEDIA)

| Tarea | Descripción |
|-------|-------------|
| Logging estructurado | Reemplazar `console.log` con `pino` o `winston` |
| Health check avanzado | `/api/health` con estado de DB |
| Tabla `auditoria` como migración formal | Mover de runtime a migration SQL |
| Alertas automáticas | Completar módulo `alertas` con triggers de negocio |

---

## Fase 5 — SaaS multi-tenant producción (Prioridad: MEDIA)

**Objetivo:** Habilitar self-service de empresas y cobro recurrente.

| Tarea | Descripción |
|-------|-------------|
| Unificar sistema de licencias | Una sola fuente de verdad: `suscripciones_empresa` |
| Integración de pasarela de pago | Wompi / Stripe según mercado objetivo |
| Webhook de pago confirmado | Actualizar `suscripciones_empresa.estado` automáticamente |
| Portal de auto-registro | Flujo completo: registro → trial → pago → activación |
| Emails transaccionales | Bienvenida, vencimiento, renovación |
| Dashboard de métricas SaaS | MRR, churn, conversión trial→pago |

---

## Fase 6 — Escalabilidad (Prioridad: BAJA — futuro)

| Tarea | Descripción |
|-------|-------------|
| Connection pooling externo | PgBouncer en producción |
| Caché de respuestas frecuentes | Redis para reportes y tarifas |
| Workers asíncronos | Bull/BullMQ para emails y reportes pesados |
| Multi-instancia | PM2 cluster o contenedores Docker |
| CI/CD | GitHub Actions: lint + tests + deploy |

---

## Decisiones pendientes

| Decisión | Opciones | Impacto |
|----------|----------|---------|
| ¿Usar herramienta de migrations? | node-pg-migrate, db-migrate, Flyway | Medio |
| ¿Sistema de licencias definitivo? | Mantener relacional vs unificar con suscripciones | Alto |
| ¿Aislar tenants en schemas PG distintos? | Schema por empresa vs row-level security | Alto |
| ¿Pasarela de pago principal? | Wompi (Colombia) vs Stripe (internacional) | Alto |
| ¿Framework de validación? | Joi vs Zod vs express-validator | Bajo |
