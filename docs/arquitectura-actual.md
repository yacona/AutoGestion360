# Arquitectura actual — AutoGestión360

> Estado al: 2026-04-16  
> Revisado por: análisis estático del código fuente

---

## 1. Visión general

AutoGestión360 es un backend SaaS multi-empresa que expone una API REST consumida por un SPA (carpeta `frontend/`). Cada empresa tiene un tenant lógico identificado por `empresa_id`; no hay aislamiento físico de datos entre tenants.

```
[SPA / frontend]  ←→  [Express 4 — puerto 4000]  ←→  [PostgreSQL 14]
```

---

## 2. Capas del sistema

### 2.1 Servidor (`server.js`)

- Carga variables de entorno con `dotenv`.
- Registra 18 routers bajo el prefijo `/api/`.
- Aplica `authMiddleware` (JWT) en todas las rutas privadas.
- Aplica `licenseMiddleware(modulo)` por ruta según el módulo que habilita.
- Sirve el frontend como archivos estáticos de `frontend/`.
- Sirve `uploads/` como estáticos bajo `/uploads`.

### 2.2 Autenticación (`middleware/auth.js`)

- Valida token JWT en el header `Authorization: Bearer <token>`.
- Inyecta `req.user` con `{ id, empresa_id, rol, ... }`.

### 2.3 Licenciamiento (`middleware/licencia.js`)

Verifica en este orden si la empresa tiene acceso al módulo solicitado:

1. Tabla `empresa_licencia` (sistema nuevo, relacional).
2. Columna `empresas.licencia_id` (atajos del sistema nuevo).
3. Columna `empresas.licencia_tipo` (sistema legado — string hardcodeado).

Ver sección de inconsistencias para el riesgo de esta lógica triple.

### 2.4 Base de datos (`db.js`)

Pool de conexión `pg` configurado con variables de entorno `DB_*`. No hay ORM.

---

## 3. Módulos de negocio

| Módulo | Router | Tablas principales |
|--------|--------|--------------------|
| Parqueadero | `routes/parqueadero.js` | `parqueadero`, `mensualidades_parqueadero`* |
| Lavadero | `routes/lavadero.js` | `lavadero`, `tipos_lavado` |
| Taller | `routes/taller.js` | `taller_ordenes`, `taller_items` |
| Clientes | `routes/clientes.js` | `clientes` |
| Vehículos | `routes/vehiculos.js` | `vehiculos` |
| Empleados | `routes/empleados.js` | `empleados` |
| Tarifas | `routes/tarifas.js` | `tarifas` |
| Pagos | `routes/pagos.js` | `pagos_servicios` |
| Reportes | `routes/reportes.js` | (agrega múltiples tablas) |
| Reportes parqueadero | `routes/reportes-parqueadero.js` | `parqueadero`, `arqueos_caja` |
| Alertas | `routes/alertas.js` | `alertas`* |
| Auditoría | `routes/auditoria.js` | `auditoria`* |
| Configuración | `routes/configuracion.js` | `configuracion_parqueadero`*, `reglas_parqueadero`* |
| Licencias | `routes/licencias.js` | `licencias`, `modulos`, `licencia_modulo`, `empresa_licencia` |
| Suscripciones | `routes/suscripciones.js` | `suscripciones_empresa`, `facturas_saas` |
| Empresas | `routes/empresas.js` | `empresas` |
| Usuarios | `routes/usuarios.js` | `usuarios` |

`*` Tabla creada dinámicamente en código mediante `CREATE TABLE IF NOT EXISTS` al iniciar el módulo.

---

## 4. Esquema de base de datos

### 4.1 Tablas base (`estructura.sql` → `database/001_base_schema.sql`)

```
empresas ──┬── usuarios
           ├── clientes ── vehiculos
           ├── empleados
           ├── parqueadero
           ├── lavadero ──── tipos_lavado
           ├── taller_ordenes ── taller_items
           └── tarifas
```

### 4.2 Tablas de licenciamiento (`migrations/licencias_migration.sql`)

```
licencias ── licencia_modulo ── modulos
     │
empresa_licencia ── empresas (también licencia_id columna directa)
```

### 4.3 Tablas operativas adicionales (migraciones)

- `arqueos_caja` — cierres de caja por empresa/usuario/fecha.
- `pagos_servicios` — registro centralizado de pagos de todos los módulos.

### 4.4 Tablas SaaS (`migrations/suscripciones_saas_migration.sql`)

```
suscripciones_empresa ── facturas_saas
```

### 4.5 Tablas creadas en runtime (sin migration SQL)

| Tabla | Dónde se crea | Propósito |
|-------|--------------|-----------|
| `mensualidades_parqueadero` | `routes/parqueadero.js` | Suscripciones mensuales de vehículos |
| `configuracion_parqueadero` | `utils/parqueadero-config.js` | Config de capacidad y horarios |
| `reglas_parqueadero` | `utils/parqueadero-config.js` | Tarifas por día de la semana |
| `alertas` | `routes/alertas.js` | Sistema de notificaciones internas |
| `auditoria` | `routes/auditoria.js` | Log de acciones de usuarios |

---

## 5. Inconsistencias detectadas

### INC-001 — Tabla fantasma `pagos_parqueadero` ⚠️ CRÍTICA

**Descripción:** `routes/pagos.js` referencia la tabla `pagos_parqueadero` en múltiples queries (líneas ~638, ~656, ~729) pero esta tabla **no está definida en ningún archivo SQL ni se crea en código**.

**Impacto:** El endpoint `GET /api/pagos/parqueadero/:parqueadero_id` y el `PATCH /api/pagos/:id` lanzan errores `relation "pagos_parqueadero" does not exist` en producción si `pagos_servicios` no contiene el registro buscado.

**Acción recomendada:** Eliminar las ramas de fallback que leen de `pagos_parqueadero` y unificar todo en `pagos_servicios`.

---

### INC-002 — Triple sistema de licencias ⚠️ ALTA

**Descripción:** Coexisten tres mecanismos para determinar si una empresa tiene acceso a un módulo:

1. **Legado** — `empresas.licencia_tipo` (string: `'demo'`, `'basica'`, `'pro'`, `'premium'`).
2. **Relacional** — tablas `licencias`, `modulos`, `licencia_modulo`, `empresa_licencia`.
3. **SaaS** — `suscripciones_empresa` + `facturas_saas`.

El middleware `licencia.js` consulta los tres en cascada. Una empresa puede tener datos en los tres sistemas simultáneamente con resultados distintos.

**Acción recomendada:** Consolidar en el sistema relacional (punto 2) como fuente de verdad; deprecar `licencia_tipo` y dejar `suscripciones_empresa` solo para facturación SaaS.

---

### INC-003 — Columnas duplicadas en `empresas` ⚠️ ALTA

**Descripción:** `licencias_migration.sql` agrega con `ALTER TABLE empresas ADD COLUMN IF NOT EXISTS`:
- `licencia_id` — nueva referencia FK a `licencias`.
- `licencia_inicio` — **ya existe** en `estructura.sql`.
- `licencia_fin` — **ya existe** en `estructura.sql`.

`IF NOT EXISTS` evita el error, pero la semántica de los campos es ambigua: el campo de `estructura.sql` es para el licenciamiento legado; el de la migración lo intenta usar para el nuevo sistema.

**Acción recomendada:** Documentar que `licencia_inicio`/`licencia_fin` en `empresas` refieren al sistema legado y usar `empresa_licencia.fecha_inicio`/`fecha_fin` para el nuevo sistema.

---

### INC-004 — Doble definición de `arqueos_caja` ⚠️ ALTA

**Descripción:** La tabla se define en `migrations/arqueos_caja_migration.sql` (con `CREATE TABLE IF NOT EXISTS`) y también se intenta crear en `routes/reportes.js`. Aunque `IF NOT EXISTS` previene el error, la definición en el router es un duplicado riesgoso.

**Acción recomendada:** Eliminar el `CREATE TABLE` embebido en `routes/reportes.js` y dejar solo la migración como fuente de verdad.

---

### INC-005 — Doble definición de `tarifas` MEDIA

**Descripción:** `estructura.sql` crea `tarifas`; `utils/parqueadero-config.js` incluye un segundo `CREATE TABLE IF NOT EXISTS tarifas` con definición similar pero no idéntica.

**Acción recomendada:** Eliminar el `CREATE TABLE` de `utils/parqueadero-config.js`.

---

### INC-006 — `/api/pagos` sin verificación de licencia MEDIA

**Descripción:** En `server.js` línea 60:
```js
app.use("/api/pagos", authMiddleware, pagosRoutes);
// falta: licenseMiddleware("pagos") o similar
```
Todos los demás módulos con datos sensibles aplican `licenseMiddleware`.

**Acción recomendada:** Agregar `licenseMiddleware("pagos")` o decidir explícitamente que pagos es un módulo siempre activo y documentarlo.

---

### INC-007 — `/api/licencias` y `/api/suscripciones` sin `authMiddleware` MEDIA

**Descripción:** En `server.js` líneas 69-70:
```js
app.use("/api/licencias", licenciasRoutes);
app.use("/api/suscripciones", suscripcionesRoutes);
```
No se aplica `authMiddleware`. La protección depende completamente del código interno de cada router.

**Acción recomendada:** Aplicar `authMiddleware` a nivel de `server.js` y verificar rol `superadmin` en el middleware, no dentro de cada handler.

---

### INC-008 — Tablas dinámicas sin migración SQL MEDIA

**Descripción:** Cinco tablas se crean via `CREATE TABLE IF NOT EXISTS` dentro de código JS en tiempo de ejecución: `mensualidades_parqueadero`, `configuracion_parqueadero`, `reglas_parqueadero`, `alertas`, `auditoria`. No están en ningún archivo de migración.

**Impacto:** No hay versioning del esquema, no se pueden aplicar `ALTER TABLE` controlados, dificulta los backups y la replicación.

**Acción recomendada:** Mover sus definiciones a `database/` como migraciones numeradas (002, 003…).

---

### INC-009 — Vista `parqueadero_historial` filtra más que otras vistas BAJA

`parqueadero_historial` solo devuelve registros con `hora_salida IS NOT NULL`, mientras que `lavados` y `ordenes_taller` devuelven todo. Inconsistencia conceptual. El código no usa estas vistas (consulta las tablas directamente).

---

### INC-010 — `parqueadero.cantidad_fotos` sin uso BAJA

Columna declarada en `estructura.sql` (`INTEGER`), no se popula en ninguna ruta ni hay lógica de conteo de fotos en el sistema. Deuda técnica.

---

## 6. Flujo de autenticación

```
POST /api/login
  → valida email/password contra usuarios
  → genera JWT { id, empresa_id, rol }
  → retorna token

Solicitudes posteriores:
  → Header: Authorization: Bearer <token>
  → authMiddleware verifica firma JWT
  → licenseMiddleware consulta módulos disponibles
  → handler de negocio
```

---

## 7. Roles de usuario

| Rol | Acceso |
|-----|--------|
| `admin` | Empresa completa |
| `operador` | Módulos asignados |
| `superadmin` | Gestión de todas las empresas y licencias |

---

## 8. Archivos de configuración clave

| Archivo | Propósito |
|---------|-----------|
| `.env` | Variables de entorno (no commitear) |
| `.env.example` | Plantilla pública de variables |
| `db.js` | Pool pg — usa `DB_*` vars |
| `server.js` | Registro de rutas y middlewares |
| `database/001_base_schema.sql` | Esquema base consolidado |
| `migrations/` | Migraciones incrementales numeradas |
