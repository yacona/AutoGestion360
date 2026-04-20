# AutoGestión360

Backend SaaS multi-empresa para gestión de parqueaderos, lavaderos y talleres automotrices.

**Stack:** Node.js 18 · Express 4 · PostgreSQL 14 · JWT · bcryptjs

---

## Requisitos

- Node.js >= 18
- PostgreSQL >= 14
- npm >= 9

---

## Instalación desde cero

### 1. Clonar y configurar entorno

```bash
git clone <repo>
cd auto360
npm install
cp .env.example .env
# Editar .env con tus credenciales reales
```

### 2. Crear la base de datos

```bash
psql -U postgres -c "CREATE DATABASE autogestion360;"
psql -U postgres -c "CREATE USER tu_usuario WITH PASSWORD 'tu_password';"
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE autogestion360 TO tu_usuario;"
```

### 3. Inicializar el esquema

El esquema completo está consolidado en dos archivos. Ejecutar en orden:

```bash
# Esquema base completo (tablas, índices, seeds de licencias y módulos)
psql -U tu_usuario -d autogestion360 -f database/001_base_schema.sql

# Sistema SaaS: planes, suscripciones, empresa_modulos (ejecutar solo si usas el núcleo SaaS nuevo)
psql -U tu_usuario -d autogestion360 -f database/002_saas_planes.sql
```

> Los archivos en `migrations/` y `estructura.sql` son referencia histórica. No correrlos en instalaciones nuevas.

### 4. Crear el primer SuperAdmin

```bash
node scripts/promote-superadmin.js
```

### 5. Iniciar el servidor

```bash
npm run dev   # desarrollo (nodemon)
npm start     # producción
```

Disponible en `http://localhost:4000` (o el `PORT` definido en `.env`).

---

## Endpoints principales

Todas las rutas privadas requieren `Authorization: Bearer <token>`.

### Operaciones

| Método | Ruta | Módulo | Notas |
|--------|------|--------|-------|
| POST | `/api/login` | auth | Retorna JWT |
| POST | `/api/register` | auth | Crea empresa + admin |
| GET | `/api/ping` | — | Health check |
| `*` | `/api/parqueadero` | parqueadero | Entradas/salidas, mensualidades |
| `*` | `/api/tarifas` | configuracion | Tarifas por tipo de vehículo |
| `*` | `/api/lavadero` | lavadero | Órdenes y tipos de lavado |
| `*` | `/api/taller` | taller | Órdenes e ítems de taller |
| `*` | `/api/clientes` | clientes | CRUD + historial 360 |
| `*` | `/api/vehiculos` | parqueadero | CRUD + perfil 360 |
| `*` | `/api/empleados` | empleados | CRUD con soft-delete |
| `*` | `/api/pagos` | — | Cartera, recibos, registro de pagos |
| `*` | `/api/reportes` | reportes | Reportes generales |
| `*` | `/api/reportes/parqueadero` | reportes | Arqueos de caja |
| `*` | `/api/alertas` | — | Alertas inteligentes + gestión |
| `*` | `/api/auditoria` | — | Log de acciones |
| `*` | `/api/configuracion` | configuracion | Config de parqueadero y reglas |
| `*` | `/api/empresas` | empresas | CRUD empresas (SuperAdmin) |
| `*` | `/api/usuarios` | usuarios | CRUD usuarios + roles |
| `*` | `/api/licencias` | — | Catálogo licencias (SuperAdmin) |
| `*` | `/api/suscripciones` | — | Suscripciones SaaS (SuperAdmin) |
| `*` | `/api/admin` | — | Panel SaaS: planes, onboarding (SuperAdmin) |
| `*` | `/api/admin/empresa-modulos` | — | Overrides de módulos por empresa (SuperAdmin) |

---

## Estructura del proyecto

```
auto360/
├── src/
│   ├── app.js                  # Configuración Express, registro de rutas
│   ├── lib/
│   │   ├── AppError.js         # Error operacional base
│   │   ├── helpers.js          # normalizeRole, normalizarPlaca, toNumber…
│   │   └── withTransaction.js  # Helper BEGIN/COMMIT/ROLLBACK
│   ├── middlewares/
│   │   └── errorHandler.js     # Manejador central de errores
│   └── modules/                # Un directorio por dominio de negocio
│       ├── auth/               # routes · controller · service
│       ├── parqueadero/
│       ├── tarifas/
│       ├── reportes-parqueadero/
│       ├── clientes/
│       ├── vehiculos/
│       ├── empleados/
│       ├── lavadero/
│       ├── taller/
│       ├── pagos/
│       ├── alertas/
│       ├── auditoria/
│       ├── configuracion/
│       ├── empresas/
│       ├── usuarios/
│       ├── licencias/
│       └── suscripciones/
├── routes/                     # Legacy — solo routes/reportes.js activo
│   └── admin/                  # Panel SaaS admin (pendiente de migrar)
├── services/
│   ├── adminService.js         # Lógica del panel SaaS (planes + onboarding)
│   └── licenseService.js       # Cadena de resolución de licencias (3 niveles)
├── middleware/
│   ├── auth.js                 # Verificación JWT → req.user
│   └── licencia.js             # Verificación de acceso a módulo
├── utils/                      # Helpers transversales y schemas dinámicos
│   ├── parqueadero-config.js
│   ├── pagos-servicios.js
│   ├── suscripciones-schema.js
│   └── licencias-schema.js
├── database/
│   ├── 001_base_schema.sql     # Esquema completo consolidado (idempotente)
│   └── 002_saas_planes.sql     # Núcleo SaaS: planes, suscripciones, empresa_modulos
├── migrations/                 # Histórico — no usar en instalaciones nuevas
├── scripts/
│   └── promote-superadmin.js
├── frontend/                   # SPA servida como estáticos
├── uploads/                    # Archivos subidos (multer)
├── docs/
│   ├── arquitectura-actual.md
│   └── roadmap-saas.md
├── db.js                       # Pool pg
└── server.js                   # Punto de entrada
```

---

## Sistema de licencias

El sistema resuelve el acceso a módulos en tres niveles (de mayor a menor prioridad):

1. **Planes SaaS** (`suscripciones` + `planes` + `plan_modulos` + `empresa_modulos`) — sistema nuevo
2. **Licencias clásicas** (`empresa_licencia` + `licencias` + `licencia_modulo`) — sistema relacional
3. **Legacy** (`empresas.licencia_tipo`) — string hardcodeado, sin fecha de expiración real

Ver `services/licenseService.js` y `middleware/licencia.js`.

---

## Notas de seguridad

- `JWT_SECRET` debe ser una cadena aleatoria de mínimo 64 caracteres en producción.
- `.env` **nunca debe commitearse**. Verificar `.gitignore`.
- Los endpoints de `licencias` y `suscripciones` aplican `authMiddleware` + guard `superadmin`.
- `/api/pagos` no usa `licenseMiddleware` por diseño: los pagos son transversales a todos los módulos. El acceso ya está controlado por `authMiddleware` y la licencia del módulo de origen.

---

## Roles

| Rol | Alcance |
|-----|---------|
| `operador` | Módulos habilitados de su empresa |
| `admin` | Empresa completa |
| `superadmin` | Todas las empresas, licencias y suscripciones |

---

## Licencia

Propietario — Victor Alfonso Mena Córdoba
