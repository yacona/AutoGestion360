'use strict';

/**
 * middleware/access.js — Control de acceso SaaS
 *
 * Exporta tres middlewares ortogonales:
 *
 *   requireLicense              → empresa activa + suscripción vigente
 *   requireModule('parqueadero')→ lo anterior + módulo habilitado en el plan
 *   requirePermission('accion') → rol del usuario tiene el permiso
 *
 * Patrón de caché: el primero que ejecute getLicenseStatus() deja el resultado
 * en req.licencia para que los siguientes no repitan la consulta en la misma
 * petición.
 */

const { getLicenseStatus } = require('../services/licenseService');

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function normalizeRol(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function esSuperAdmin(req) {
  return normalizeRol(req.user?.rol) === 'superadmin';
}

// Mensajes de error por estado de suscripción
const MENSAJES_ESTADO = {
  VENCIDA:     'Tu suscripción ha vencido. Renueva el plan para continuar.',
  SUSPENDIDA:  'Tu cuenta está suspendida. Contacta al administrador.',
  CANCELADA:   'Tu suscripción fue cancelada.',
  SIN_LICENCIA:'No hay una licencia activa para esta empresa.',
};

function errorLicencia(res, estado) {
  const mensaje = MENSAJES_ESTADO[estado] || 'Acceso denegado.';
  return res.status(403).json({ error: mensaje, estado, codigo: 'LICENCIA_INACTIVA' });
}

// ─────────────────────────────────────────────────────────────
// requireLicense
// ─────────────────────────────────────────────────────────────

/**
 * Valida que la empresa tenga una licencia/suscripción vigente.
 * No valida módulos específicos.
 *
 * Uso:
 *   app.use('/api/pagos', authMiddleware, requireLicense, pagosRoutes);
 */
async function requireLicense(req, res, next) {
  if (esSuperAdmin(req)) return next();

  try {
    const status = await getLicenseStatus(req.user.empresa_id);
    req.licencia = status; // caché para middlewares siguientes

    if (!status.vigente) {
      return errorLicencia(res, status.estado);
    }

    next();
  } catch (err) {
    console.error('[requireLicense]', err);
    res.status(500).json({ error: 'Error interno al verificar licencia.' });
  }
}

// ─────────────────────────────────────────────────────────────
// requireModule
// ─────────────────────────────────────────────────────────────

/**
 * Valida licencia vigente + módulo habilitado en el plan.
 * Reutiliza req.licencia si requireLicense ya corrió antes.
 *
 * Uso:
 *   app.use('/api/parqueadero', authMiddleware, requireModule('parqueadero'), rutas);
 *   router.get('/', requireModule('reportes'), handler);
 */
function requireModule(codigoModulo) {
  return async function (req, res, next) {
    if (esSuperAdmin(req)) return next();

    try {
      // Reutilizar caché si ya existe en esta petición
      const status = req.licencia || await getLicenseStatus(req.user.empresa_id);
      req.licencia = status;

      if (!status.vigente) {
        return errorLicencia(res, status.estado);
      }

      if (!status.modulos.includes(codigoModulo)) {
        const planNombre = status.plan?.nombre ?? status.fuente ?? 'actual';
        return res.status(403).json({
          error:  `El módulo '${codigoModulo}' no está incluido en tu plan ${planNombre}.`,
          modulo: codigoModulo,
          plan:   status.plan?.codigo ?? null,
          codigo: 'MODULO_NO_HABILITADO',
        });
      }

      next();
    } catch (err) {
      console.error('[requireModule]', err);
      res.status(500).json({ error: 'Error interno al verificar módulo.' });
    }
  };
}

// ─────────────────────────────────────────────────────────────
// RBAC — Permisos por rol (v1, sin tabla DB)
// ─────────────────────────────────────────────────────────────
//
// Convención: 'recurso:accion'  (e.g. 'empleados:eliminar')
// '*' significa acceso total.
//
// Para añadir permisos granulares por usuario en el futuro:
//   1. Crear tabla usuario_permisos (usuario_id, permiso VARCHAR)
//   2. Cargar en login y adjuntar a req.user.permisos
//   3. Este middleware revisa req.user.permisos primero.
//
const PERMISOS_POR_ROL = {
  superadmin: ['*'],

  admin: [
    'clientes:crear',    'clientes:editar',    'clientes:eliminar',
    'vehiculos:crear',   'vehiculos:editar',
    'empleados:crear',   'empleados:editar',   'empleados:eliminar',
    'ordenes:crear',     'ordenes:editar',     'ordenes:cancelar',
    'parqueadero:crear', 'parqueadero:editar',
    'lavadero:crear',    'lavadero:editar',
    'taller:crear',      'taller:editar',
    'reportes:ver',      'reportes:exportar',
    'usuarios:crear',    'usuarios:editar',
    'configuracion:editar',
  ],

  // Admin y Administrador son equivalentes
  administrador: null, // se resuelve como 'admin' en getPermisos()

  operador: [
    'clientes:crear',    'clientes:editar',
    'vehiculos:crear',
    'ordenes:crear',     'ordenes:editar',
    'parqueadero:crear',
    'lavadero:crear',
    'taller:crear',
    'reportes:ver',
  ],

  empleado: [
    'parqueadero:crear',
    'lavadero:crear',
    'taller:crear',
    'reportes:ver',
  ],
};

/**
 * Devuelve la lista de permisos para un rol dado.
 */
function getPermisosParaRol(rol) {
  const key = normalizeRol(rol);
  // administrador es alias de admin
  const resolved = key === 'administrador' ? 'admin' : key;
  return PERMISOS_POR_ROL[resolved] ?? PERMISOS_POR_ROL.empleado;
}

/**
 * Valida si el usuario autenticado tiene un permiso específico.
 *
 * Uso:
 *   router.delete('/:id', requirePermission('clientes:eliminar'), handler);
 *   router.post('/exportar', requirePermission('reportes:exportar'), handler);
 */
function requirePermission(permiso) {
  return function (req, res, next) {
    if (esSuperAdmin(req)) return next();

    // Permisos pueden venir en req.user si el login los incluyó (ver auth.js)
    const lista = req.user?.permisos ?? getPermisosParaRol(req.user?.rol);

    if (lista.includes('*') || lista.includes(permiso)) {
      return next();
    }

    return res.status(403).json({
      error:  'No tienes permiso para esta acción.',
      permiso,
      codigo: 'PERMISO_DENEGADO',
    });
  };
}

module.exports = {
  requireLicense,
  requireModule,
  requirePermission,
  getPermisosParaRol,
  PERMISOS_POR_ROL,
};
