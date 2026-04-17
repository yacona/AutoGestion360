require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const authMiddleware = require('../middleware/auth');
const licenseMiddleware = require('../middleware/licencia');
const errorHandler = require('./middlewares/errorHandler');

// ── Módulos refactorizados (routes → controllers → services → repositories) ──
const authRoutes = require('./modules/auth/auth.routes');
const parqueaderoRoutes = require('./modules/parqueadero/parqueadero.routes');
const tarifasRoutes = require('./modules/tarifas/tarifas.routes');
const reportesParqueaderoRoutes = require('./modules/reportes-parqueadero/reportes-parqueadero.routes');

// ── Módulos legacy (aún no migrados) ─────────────────────────────────────────
const clientesRoutes = require('../routes/clientes');
const vehiculosRoutes = require('../routes/vehiculos');
const empleadosRoutes = require('../routes/empleados');
const lavaderoRoutes = require('../routes/lavadero');
const tallerRoutes = require('../routes/taller');
const reportesRoutes = require('../routes/reportes');
const pagosRoutes = require('../routes/pagos');
const alertasRoutes = require('../routes/alertas');
const auditoriaRoutes = require('../routes/auditoria');
const configuracionRoutes = require('../routes/configuracion');
const empresasRoutes = require('../routes/empresas');
const usuariosRoutes = require('../routes/usuarios');
const licenciasRoutes = require('../routes/licencias');
const suscripcionesRoutes = require('../routes/suscripciones');

// ── Panel SuperAdmin (sistema nuevo planes/suscripciones) ────────────────────
const adminPlanesRoutes      = require('../routes/admin/planes-admin');
const adminEmpresaModRoutes  = require('../routes/admin/empresa-modulos');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('frontend'));
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
app.use('/api/licencias', authMiddleware, licenciasRoutes);
app.use('/api/suscripciones', authMiddleware, suscripcionesRoutes);

// ── Panel SuperAdmin — nuevas rutas (sistema planes/suscripciones 002) ───────
// authMiddleware ya verifica el JWT; el guard SuperAdmin está dentro de cada router.
app.use('/api/admin',                  authMiddleware, adminPlanesRoutes);
app.use('/api/admin/empresa-modulos',  authMiddleware, adminEmpresaModRoutes);

// Ruta de perfil (debug)
app.get('/api/perfil', authMiddleware, (req, res) => res.json({ mensaje: 'Acceso autorizado', usuario_actual: req.user }));

// ── Manejador central de errores (debe ser el último middleware) ───────────────
app.use(errorHandler);

module.exports = app;
