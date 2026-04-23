'use strict';

/**
 * middleware/access.js — Control de acceso SaaS
 *
 * Exporta tres middlewares ortogonales:
 *
 *   requireLicense              → empresa activa + suscripción vigente
 *   requireModule('parqueadero')→ lo anterior + módulo habilitado en el plan
 *   requirePermission('accion') → rol del usuario tiene el permiso (DB-backed)
 *
 * Patrón de caché:
 *   - getLicenseStatus() deja el resultado en req.licencia para reusar en la misma petición.
 *   - requirePermission() carga permisos del usuario desde DB (con TTL 5 min en memoria).
 *     Si las tablas RBAC no existen aún, usa el mapa hardcoded como fallback.
 */

const { getLicenseStatus } = require('../services/licenseService');
const rbac = require('../src/lib/rbac/rbac.service');
const {
  FALLBACK_PERMISSIONS_BY_ROLE,
  getFallbackPermissionsForRole,
} = require('../src/lib/rbac/rbac.fallback');
const { isSuperAdmin } = require('../src/lib/helpers');

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function esSuperAdmin(req) {
  return isSuperAdmin(req.user);
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
const PERMISOS_POR_ROL = FALLBACK_PERMISSIONS_BY_ROLE;

/**
 * Devuelve la lista de permisos para un rol dado.
 */
function getPermisosParaRol(rol) {
  return getFallbackPermissionsForRole(rol);
}

/**
 * Valida si el usuario autenticado tiene un permiso específico.
 * Consulta la tabla usuario_roles/rol_permisos en BD (con caché de 5 min).
 * Si las tablas RBAC aún no existen, usa el mapa hardcoded como fallback.
 *
 * Uso:
 *   router.delete('/:id', requirePermission('clientes:eliminar'), handler);
 *   router.post('/exportar', requirePermission('reportes:exportar'), handler);
 */
function requirePermission(permiso) {
  return async function (req, res, next) {
    if (esSuperAdmin(req)) return next();

    try {
      // Caché a nivel de request: evita múltiples consultas en un mismo ciclo
      if (!req._rbac_permisos) {
        req._rbac_permisos = Array.isArray(req.user?.permisos) && req.user.permisos.length > 0
          ? req.user.permisos
          : await rbac.getPermisosFromDB(req.user.id, req.user.empresa_id ?? null);
      }

      const lista = req._rbac_permisos;
      if (lista.includes('*') || lista.includes(permiso)) {
        return next();
      }

      return res.status(403).json({
        error:  'No tienes permiso para esta acción.',
        permiso,
        codigo: 'PERMISO_DENEGADO',
      });
    } catch (err) {
      // Fallback al mapa hardcoded si la migración RBAC aún no se ejecutó
      if (err?.code === '42P01' || err?.code === '42703') {
        const lista = req.user?.permisos ?? getPermisosParaRol(req.user?.rol);
        if (lista.includes('*') || lista.includes(permiso)) return next();
        return res.status(403).json({
          error:  'No tienes permiso para esta acción.',
          permiso,
          codigo: 'PERMISO_DENEGADO',
        });
      }
      console.error('[requirePermission]', err);
      return res.status(500).json({ error: 'Error interno al verificar permisos.' });
    }
  };
}

module.exports = {
  requireLicense,
  requireModule,
  requirePermission,
  getPermisosParaRol,
  PERMISOS_POR_ROL,
};
