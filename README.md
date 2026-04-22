# AutoGestion360

AutoGestion360 es un backend SaaS multi-empresa para operar parqueadero, lavadero, taller, clientes, empleados, usuarios y control administrativo desde una sola base PostgreSQL.

Sprint 1 deja una base técnica más estable sin cambiar todavía el modelo funcional: se documenta la arquitectura real, se consolida el esquema inicial y se define un camino de arranque limpio desde cero.

## Estado actual del repositorio

- Runtime principal: `server.js` -> `src/app.js`
- Backend: Node.js + Express + PostgreSQL + JWT
- Frontend: SPA servida como estáticos desde `frontend/`
- Multiempresa: aislamiento lógico por `empresa_id`
- Fuente de verdad para instalaciones nuevas: `database/001_base_schema.sql`
- Archivos legacy que se conservan como referencia: `estructura.sql`, `migrations/`, `database/002_saas_planes.sql`

## Requisitos

- Node.js 18 o superior
- npm 9 o superior
- PostgreSQL 14 o superior

## Instalación desde cero

### 1. Clonar e instalar dependencias

```bash
git clone <repo>
cd auto360
npm install
```

### 2. Crear la base de datos

```bash
psql -U postgres -c "CREATE DATABASE autogestion360;"
```

Si vas a usar un usuario dedicado:

```bash
psql -U postgres -c "CREATE USER autogestion360 WITH PASSWORD 'cambia_esta_clave';"
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE autogestion360 TO autogestion360;"
```

### 3. Configurar variables de entorno

```bash
cp .env.example .env
```

Editar `.env` con tus credenciales reales.

### 4. Inicializar el esquema

Para instalaciones nuevas ejecutar solo:

```bash
psql -U autogestion360 -d autogestion360 -f database/001_base_schema.sql
```

Notas:

- `database/001_base_schema.sql` ya incluye tablas core, licencias, suscripciones legacy, núcleo SaaS (`planes`, `plan_modulos`, `suscripciones`, `empresa_modulos`), tablas creadas antes en runtime, vistas de compatibilidad y seeds mínimos.
- `database/002_saas_planes.sql` se conserva como migración histórica para instalaciones viejas. No es necesario en un bootstrap nuevo.
- `estructura.sql` y `migrations/` son referencia histórica, no la ruta recomendada de inicialización.

### 5. Crear o promover el primer SuperAdmin

```bash
npm run promote:superadmin
```

### 6. Iniciar el servidor

```bash
npm run dev
```

o en modo normal:

```bash
npm start
```

Servidor disponible en:

```text
http://localhost:4000
```

## Scripts disponibles

```bash
npm run dev
npm start
npm run promote:superadmin
```

## Arquitectura activa

La aplicación usa una arquitectura híbrida:

- `src/modules/*`: módulos refactorizados con patrón `routes -> controller -> service`
- `routes/reportes.js`: módulo legacy aún montado
- `routes/admin/*`: panel SaaS legacy aún montado, apoyado por `services/adminService.js`

Rutas principales montadas hoy en `src/app.js`:

- `/api` -> autenticación
- `/api/parqueadero`
- `/api/tarifas`
- `/api/reportes/parqueadero`
- `/api/clientes`
- `/api/vehiculos`
- `/api/empleados`
- `/api/lavadero`
- `/api/taller`
- `/api/reportes`
- `/api/pagos`
- `/api/alertas`
- `/api/auditoria`
- `/api/configuracion`
- `/api/empresas`
- `/api/usuarios`
- `/api/licencias`
- `/api/suscripciones`
- `/api/admin`
- `/api/admin/empresa-modulos`

## Estructura del proyecto

```text
auto360/
├── database/
│   ├── 001_base_schema.sql
│   └── 002_saas_planes.sql
├── docs/
│   ├── arquitectura-actual.md
│   └── roadmap-saas.md
├── frontend/
├── middleware/
├── migrations/
├── routes/
├── scripts/
├── services/
├── src/
│   ├── app.js
│   ├── lib/
│   ├── middlewares/
│   └── modules/
├── utils/
├── db.js
├── estructura.sql
├── package.json
└── server.js
```

## Dependencias SQL reales del backend

Tablas usadas hoy por el backend montado:

- `alertas`
- `arqueos_caja`
- `auditoria`
- `clientes`
- `configuracion_parqueadero`
- `empleados`
- `empresa_licencia`
- `empresa_modulos`
- `empresas`
- `facturas_saas`
- `lavadero`
- `licencia_modulo`
- `licencias`
- `mensualidades_parqueadero`
- `modulos`
- `pagos_servicios`
- `parqueadero`
- `plan_modulos`
- `planes`
- `reglas_parqueadero`
- `suscripciones`
- `suscripciones_empresa`
- `taller_items`
- `taller_ordenes`
- `tarifas`
- `tipos_lavado`
- `usuarios`
- `vehiculos`

Vista de compatibilidad todavía usada indirectamente:

- `ordenes_taller`

## Decisiones de Sprint 1

- `database/001_base_schema.sql` pasa a ser el esquema inicial consolidado.
- La documentación separa con claridad lo activo de lo legacy.
- No se elimina lógica de negocio ni módulos funcionales.
- No se migra todavía a otro framework ni a una herramienta formal de migrations.

## Riesgos conocidos

- `suscripciones` es la fuente oficial SaaS; `suscripciones_empresa` y `empresa_licencia` quedan como compatibilidad temporal.
- Aún hay DDL en runtime en algunos helpers y rutas legacy.
- `.env` aparece rastreado por git en el estado actual del repositorio y debe retirarse del índice antes de publicar o compartir el proyecto.

## Documentación complementaria

- `docs/arquitectura-actual.md`
- `docs/roadmap-saas.md`
- `docs/normalizacion-nucleo-saas.md`
- `docs/auth-sesiones-refresh.md`

## Licencia

Uso propietario.
