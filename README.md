# AutoGestión360

Backend SaaS multi-empresa para gestión de parqueaderos, lavaderos y talleres automotrices.

**Stack:** Node.js · Express 4 · PostgreSQL 14 · JWT

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
# Editar .env con tus credenciales de base de datos y JWT_SECRET
```

### 2. Crear la base de datos

```bash
psql -U postgres -c "CREATE DATABASE autogestion360;"
psql -U postgres -c "CREATE USER victor WITH PASSWORD 'tu_password';"
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE autogestion360 TO victor;"
```

> Ajusta usuario y contraseña según tu `.env`.

### 3. Inicializar el esquema

Ejecutar en orden:

```bash
# 1. Tablas base (empresas, usuarios, clientes, vehículos, módulos operativos)
psql -U victor -d autogestion360 -f database/001_base_schema.sql

# 2. Sistema de licencias (licencias, modulos, empresa_licencia)
psql -U victor -d autogestion360 -f migrations/licencias_migration.sql

# 3. Datos iniciales de licencias
psql -U victor -d autogestion360 -f licencias_setup.sql

# 4. Arqueos de caja
psql -U victor -d autogestion360 -f migrations/arqueos_caja_migration.sql

# 5. Pagos centralizados
psql -U victor -d autogestion360 -f migrations/pagos_servicios_migration.sql

# 6. Suscripciones y facturación SaaS
psql -U victor -d autogestion360 -f migrations/suscripciones_saas_migration.sql
```

### 4. Crear superadmin

```bash
node scripts/promote-superadmin.js
```

### 5. Iniciar el servidor

```bash
# Desarrollo
npm run dev

# Producción
npm start
```

El servidor queda disponible en `http://localhost:4000`.

---

## Endpoints principales

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/login` | Autenticación |
| POST | `/api/register` | Registro de empresa |
| GET | `/api/ping` | Health check |
| * | `/api/clientes` | CRUD clientes |
| * | `/api/vehiculos` | CRUD vehículos |
| * | `/api/parqueadero` | Gestión parqueadero |
| * | `/api/lavadero` | Gestión lavadero |
| * | `/api/taller` | Gestión taller |
| * | `/api/reportes` | Reportes generales |
| * | `/api/pagos` | Pagos de servicios |
| * | `/api/tarifas` | Configuración tarifas |
| * | `/api/empleados` | CRUD empleados |
| * | `/api/alertas` | Alertas del sistema |
| * | `/api/configuracion` | Configuración de empresa |
| * | `/api/licencias` | Admin licencias (SuperAdmin) |
| * | `/api/suscripciones` | Admin suscripciones (SuperAdmin) |

---

## Estructura del proyecto

```
auto360/
├── routes/          # 18 routers de Express
├── middleware/      # auth.js (JWT), licencia.js (verificación de módulo)
├── utils/           # Helpers: email, parqueadero-config, schemas
├── migrations/      # Scripts SQL incrementales
├── scripts/         # Utilidades de administración
├── frontend/        # SPA servida como estáticos
├── uploads/         # Archivos subidos con multer
├── database/        # Esquema base consolidado (001_base_schema.sql)
├── docs/            # Documentación técnica
├── db.js            # Pool de conexión pg
├── server.js        # Punto de entrada Express
└── estructura.sql   # Dump original del esquema base (referencia)
```

---

## Notas de seguridad

- `JWT_SECRET` debe ser una cadena aleatoria de al menos 64 caracteres en producción.
- El endpoint `/api/pagos` **no verifica licencia de módulo** (ver [docs/arquitectura-actual.md](docs/arquitectura-actual.md#inconsistencias)).
- Los endpoints `/api/licencias` y `/api/suscripciones` no aplican `authMiddleware` — deben protegerse antes de exponer en producción.

---

## Licencia

Propietario — Victor Alfonso Mena Córdoba
