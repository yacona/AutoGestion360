# Arquitectura actual — AutoGestion360

> Estado al: 2026-04-20
> Alcance: análisis estático del backend actualmente montado en `src/app.js`

## 1. Resumen

AutoGestion360 es una aplicación SaaS multiempresa con:

- backend Express 4
- PostgreSQL como única base de datos
- frontend SPA servido desde `frontend/`
- aislamiento lógico por `empresa_id`

Punto de entrada:

```text
server.js -> src/app.js
```

## 2. Estructura real del backend

### 2.1 Capas activas

- `server.js`: arranque HTTP
- `src/app.js`: composición de middlewares y rutas
- `db.js`: pool de PostgreSQL
- `middleware/auth.js`: JWT -> `req.user`
- `middleware/licencia.js`: control de acceso por módulo
- `services/licenseService.js`: resolución SaaS/licencias/legacy
- `src/modules/*`: módulos refactorizados
- `routes/reportes.js`: módulo legacy activo
- `routes/admin/*`: panel SaaS legacy activo

### 2.2 Módulos activos montados

| Ruta | Ubicación | Estado |
|---|---|---|
| `/api` | `src/modules/auth` | refactorizado |
| `/api/parqueadero` | `src/modules/parqueadero` | refactorizado |
| `/api/tarifas` | `src/modules/tarifas` | refactorizado |
| `/api/reportes/parqueadero` | `src/modules/reportes-parqueadero` | refactorizado |
| `/api/clientes` | `src/modules/clientes` | refactorizado |
| `/api/vehiculos` | `src/modules/vehiculos` | refactorizado |
| `/api/empleados` | `src/modules/empleados` | refactorizado |
| `/api/lavadero` | `src/modules/lavadero` | refactorizado |
| `/api/taller` | `src/modules/taller` | refactorizado |
| `/api/pagos` | `src/modules/pagos` | refactorizado |
| `/api/alertas` | `src/modules/alertas` | refactorizado |
| `/api/auditoria` | `src/modules/auditoria` | refactorizado |
| `/api/configuracion` | `src/modules/configuracion` | refactorizado |
| `/api/empresas` | `src/modules/empresas` | refactorizado |
| `/api/usuarios` | `src/modules/usuarios` | refactorizado |
| `/api/licencias` | `src/modules/licencias` | refactorizado |
| `/api/suscripciones` | `src/modules/suscripciones` | refactorizado |
| `/api/reportes` | `routes/reportes.js` | legacy activo |
| `/api/admin` | `routes/admin/planes-admin.js` | legacy activo |
| `/api/admin/empresa-modulos` | `routes/admin/empresa-modulos.js` | legacy activo |

### 2.3 Estructura híbrida

Patrón nuevo:

```text
src/modules/<dominio>/
  <dominio>.routes.js
  <dominio>.controller.js
  <dominio>.service.js
```

Patrón legacy aún presente:

- `routes/reportes.js`
- `routes/admin/planes-admin.js`
- `routes/admin/empresa-modulos.js`

## 3. Inventario SQL real del backend

### 3.1 Tablas usadas por código activo

| Tabla | Consumo principal |
|---|---|
| `alertas` | módulo alertas |
| `arqueos_caja` | reportes y arqueos |
| `auditoria` | módulo auditoría |
| `clientes` | auth, clientes, parqueadero, lavadero, taller |
| `configuracion_parqueadero` | configuración |
| `empleados` | empleados, lavadero, taller |
| `empresa_licencia` | middleware/licencias legacy relacional |
| `empresa_modulos` | admin SaaS, `licenseService` |
| `empresas` | auth, empresas, licencias, suscripciones |
| `facturas_saas` | suscripciones legacy |
| `lavadero` | módulo lavadero, pagos, reportes |
| `licencia_modulo` | licencias |
| `licencias` | licencias, suscripciones legacy |
| `mensualidades_parqueadero` | parqueadero, pagos |
| `modulos` | licencias, admin SaaS, `licenseService` |
| `pagos_servicios` | pagos |
| `parqueadero` | parqueadero, pagos, reportes |
| `plan_modulos` | admin SaaS, `licenseService` |
| `planes` | admin SaaS, `licenseService` |
| `reglas_parqueadero` | configuración |
| `suscripciones` | admin SaaS, `licenseService` |
| `suscripciones_empresa` | módulo suscripciones actual |
| `taller_items` | taller |
| `taller_ordenes` | taller, pagos, reportes |
| `tarifas` | tarifas, configuración |
| `tipos_lavado` | lavadero |
| `usuarios` | auth, usuarios, auditoría |
| `vehiculos` | clientes, parqueadero, lavadero, taller |

### 3.2 Vistas usadas o requeridas por compatibilidad

| Vista | Motivo |
|---|---|
| `ordenes_taller` | `utils/pagos-servicios.js` aún la referencia |
| `lavados` | compatibilidad con dump legacy |
| `parqueadero_historial` | compatibilidad con dump legacy |

## 4. Variables de entorno realmente consumidas

El código actualmente lee:

- `PORT`
- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `JWT_SECRET`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`

## 5. Comparación contra `estructura.sql`

### 5.1 Objetos presentes en `estructura.sql`

`estructura.sql` sí contiene:

- `clientes`
- `empleados`
- `empresas`
- `lavadero`
- `lavados`
- `ordenes_taller`
- `parqueadero`
- `parqueadero_historial`
- `taller_items`
- `taller_ordenes`
- `tarifas`
- `tipos_lavado`
- `usuarios`
- `vehiculos`

### 5.2 Objetos que usa el backend y no existen en `estructura.sql`

- `alertas`
- `arqueos_caja`
- `auditoria`
- `configuracion_parqueadero`
- `empresa_licencia`
- `empresa_modulos`
- `facturas_saas`
- `licencia_modulo`
- `licencias`
- `mensualidades_parqueadero`
- `modulos`
- `pagos_servicios`
- `plan_modulos`
- `planes`
- `reglas_parqueadero`
- `suscripciones`
- `suscripciones_empresa`

### 5.3 Columnas usadas hoy pero ausentes en `estructura.sql`

Inconsistencias relevantes detectadas:

- `empresas.licencia_id`
- `parqueadero.tipo_servicio`
- `parqueadero.mensualidad_id`
- `tarifas.valor_dia`
- `tarifas.fraccion_dia_minutos`
- `tarifas.valor_primera_fraccion`
- `tarifas.tiempo_primera_fraccion`
- `tarifas.valor_segunda_fraccion`
- `tarifas.tiempo_segunda_fraccion`
- `modulos.activo`
- `modulos.orden`
- `modulos.icono_clave`

### 5.4 Conclusión de la comparación

`estructura.sql` ya no representa el backend actual. Sirve como histórico del modelo operativo inicial, pero no como fuente de verdad para levantar el sistema hoy.

La fuente consolidada recomendada para instalaciones nuevas debe ser:

```text
database/001_base_schema.sql
```

## 6. Inconsistencias técnicas detectadas

### INC-01 — `estructura.sql` quedó obsoleto respecto al backend

El código activo depende de tablas y columnas que no están en el dump histórico. Un entorno creado solo con `estructura.sql` no soporta el backend actual.

### INC-02 — Dos sistemas de suscripción siguen activos

Coexisten dos modelos:

- `suscripciones_empresa` + `facturas_saas`
- `suscripciones` + `planes` + `plan_modulos` + `empresa_modulos`

El módulo `/api/suscripciones` opera sobre el primer modelo. El panel `/api/admin` y `services/licenseService.js` operan sobre el segundo.

### INC-03 — Persisten DDL en runtime

Todavía hay código que crea o altera tablas al arrancar o al usar módulos:

- `src/modules/alertas/alertas.service.js`
- `src/modules/parqueadero/parqueadero.repository.js`
- `utils/parqueadero-config.js`
- `utils/licencias-schema.js`
- `utils/pagos-servicios-schema.js`
- `utils/suscripciones-schema.js`
- `routes/reportes.js`

Eso complica reproducibilidad y hace difuso el contrato real de base de datos.

### INC-04 — Hay mezcla de módulos refactorizados y rutas legacy

El runtime ya usa mayoritariamente `src/modules`, pero reportes y el panel admin siguen fuera de ese patrón.

### INC-05 — `.env` está rastreado por git

El archivo `.env` aparece en `git ls-files`, así que el riesgo no es teórico. Aunque se ignore después, ya quedó dentro del índice del repositorio.

## 7. Esquema inicial consolidado propuesto

`database/001_base_schema.sql` debe concentrar:

1. tablas core operativas
2. tablas de licencias legacy relacionales
3. tablas de pagos y arqueos
4. suscripciones legacy
5. núcleo SaaS nuevo (`planes`, `plan_modulos`, `suscripciones`, `empresa_modulos`)
6. tablas antes creadas dinámicamente
7. vistas de compatibilidad
8. seeds mínimos para licencias, módulos y planes

## 8. Camino recomendado de inicialización

Para un entorno limpio:

1. crear la base PostgreSQL
2. copiar `.env.example` a `.env`
3. ejecutar `database/001_base_schema.sql`
4. promover un superadmin
5. arrancar con `npm run dev`

## 9. Qué no cambia en Sprint 1

- no se elimina ningún módulo funcional
- no se migra a ORM
- no se cambia Express
- no se cambia el modelo de negocio
- no se reemplazan aún las rutas legacy por completo
