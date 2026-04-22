require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const authMiddleware = require('../middleware/auth');
const licenseMiddleware = require('../middleware/licencia');
const errorHandler = require('./middlewares/errorHandler');
const {
  buildCorsOptions,
  getRequestBodyLimit,
  getTrustProxy,
} = require('./lib/security/http');

// ── Módulos refactorizados ────────────────────────────────────────────────────
const authRoutes               = require('./modules/auth/auth.routes');
const parqueaderoRoutes        = require('./modules/parqueadero/parqueadero.routes');
const tarifasRoutes            = require('./modules/tarifas/tarifas.routes');
const reportesParqueaderoRoutes = require('./modules/reportes-parqueadero/reportes-parqueadero.routes');
const clientesRoutes           = require('./modules/clientes/clientes.routes');
const vehiculosRoutes          = require('./modules/vehiculos/vehiculos.routes');
const empleadosRoutes          = require('./modules/empleados/empleados.routes');
const lavaderoRoutes           = require('./modules/lavadero/lavadero.routes');
const tallerRoutes             = require('./modules/taller/taller.routes');
const pagosRoutes              = require('./modules/pagos/pagos.routes');
const alertasRoutes            = require('./modules/alertas/alertas.routes');
const auditoriaRoutes          = require('./modules/auditoria/auditoria.routes');
const configuracionRoutes      = require('./modules/configuracion/configuracion.routes');
const empresasRoutes           = require('./modules/empresas/empresas.routes');
const usuariosRoutes           = require('./modules/usuarios/usuarios.routes');
const licenciasRoutes          = require('./modules/licencias/licencias.routes');
const suscripcionesRoutes      = require('./modules/suscripciones/suscripciones.routes');
const sedesRoutes              = require('./modules/sedes/sedes.routes');

// ── Módulo legacy sin migrar ──────────────────────────────────────────────────
const reportesRoutes = require('../routes/reportes');

// ── Panel SuperAdmin — módulo consolidado (Sprint 4) ─────────────────────────
const adminRoutes = require('./modules/admin/admin.routes');

const app = express();
const corsOptions = buildCorsOptions();
const requestBodyLimit = getRequestBodyLimit();

app.disable('x-powered-by');
app.set('trust proxy', getTrustProxy());

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
}));
app.use(cors(corsOptions));
app.use(express.json({ limit: requestBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: requestBodyLimit }));
app.use(express.static('frontend', {
  dotfiles: 'ignore',
}));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Health check
app.get('/api/ping', (req, res) => res.json({ mensaje: 'AutoGestión360 backend OK 🚀' }));

// ── Rutas refactorizadas ──────────────────────────────────────────────────────
app.use('/api', authRoutes);

// Registrar /parqueadero ANTES de cualquier subruta ambigua
app.use('/api/parqueadero', authMiddleware, licenseMiddleware('parqueadero'), parqueaderoRoutes);
app.use('/api/tarifas', authMiddleware, licenseMiddleware('configuracion'), tarifasRoutes);

// NOTA: /api/reportes/parqueadero debe registrarse ANTES de /api/reportes
// para que Express lo alcance sin que reportesRoutes lo absorba
app.use('/api/reportes/parqueadero', authMiddleware, licenseMiddleware('reportes'), reportesParqueaderoRoutes);

// ── Rutas legacy ──────────────────────────────────────────────────────────────
app.use('/api/clientes', authMiddleware, licenseMiddleware('clientes'), clientesRoutes);
app.use('/api/vehiculos', authMiddleware, licenseMiddleware('parqueadero'), vehiculosRoutes);
app.use('/api/empleados', authMiddleware, licenseMiddleware('empleados'), empleadosRoutes);
app.use('/api/lavadero', authMiddleware, licenseMiddleware('lavadero'), lavaderoRoutes);
app.use('/api/taller', authMiddleware, licenseMiddleware('taller'), tallerRoutes);
app.use('/api/reportes', authMiddleware, licenseMiddleware('reportes'), reportesRoutes);
// /api/pagos no usa licenseMiddleware: los pagos son transversales a todos los módulos
// y el acceso ya está controlado por authMiddleware + la licencia del módulo origen.
app.use('/api/pagos', authMiddleware, pagosRoutes);
app.use('/api/alertas', authMiddleware, alertasRoutes);
app.use('/api/auditoria', authMiddleware, auditoriaRoutes);
app.use('/api/configuracion', authMiddleware, licenseMiddleware('configuracion'), configuracionRoutes);
app.use('/api/empresas', authMiddleware, empresasRoutes);
app.use('/api/usuarios', authMiddleware, licenseMiddleware('usuarios'), usuariosRoutes);
app.use('/api/sedes', authMiddleware, licenseMiddleware('configuracion'), sedesRoutes);
app.use('/api/licencias', authMiddleware, licenciasRoutes);
app.use('/api/suscripciones', authMiddleware, suscripcionesRoutes);

// ── Panel SuperAdmin — módulo consolidado Sprint 4 ────────────────────────────
// authMiddleware verifica el JWT; el guard SuperAdmin vive en admin.controller.js
app.use('/api/admin', authMiddleware, adminRoutes);

// Ruta de perfil (debug)
app.get('/api/perfil', authMiddleware, (req, res) => res.json({ mensaje: 'Acceso autorizado', usuario_actual: req.user }));

// ── Manejador central de errores (debe ser el último middleware) ───────────────
app.use(errorHandler);

module.exports = app;
