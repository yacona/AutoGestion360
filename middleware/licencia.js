const {
  getLicenseStatus,
  isLegacyFallbackEnabled,
} = require('../services/licenseService');
const { isSuperAdmin } = require('../src/lib/helpers');

const ALIAS_MODULO_RUTA = {
  tarifas: 'configuracion',
  vehiculos: 'parqueadero',
};

const MENSAJES_ESTADO = {
  VENCIDA: 'Tu suscripción ha vencido. Renueva el plan para continuar.',
  SUSPENDIDA: 'Tu acceso está suspendido. Contacta al administrador.',
  CANCELADA: 'Tu suscripción fue cancelada.',
  SIN_LICENCIA: 'No hay una suscripción SaaS activa configurada para esta empresa.',
};

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// Los usuarios de plataforma nunca pertenecen a una empresa cliente,
// por lo que no aplica la verificación de licencia de tenant.
function esPlatformUser(req) {
  return req.user?.scope === 'platform';
}

function moduloDeRuta(req) {
  const modulo = normalizarTexto(req.baseUrl.split('/').pop());
  return ALIAS_MODULO_RUTA[modulo] || modulo;
}

function normalizarModuloExplicito(modulo) {
  const normalizado = normalizarTexto(modulo);
  return ALIAS_MODULO_RUTA[normalizado] || normalizado;
}

function mensajeEstado(status) {
  if (status.fuente === 'planes') {
    return MENSAJES_ESTADO[status.estado] || 'Suscripción inactiva.';
  }

  if (status.fuente === 'licencias' || status.fuente === 'legacy') {
    return MENSAJES_ESTADO[status.estado]
      || 'La licencia transicional de la empresa no permite acceso.';
  }

  return MENSAJES_ESTADO.SIN_LICENCIA;
}

function nombrePaquete(status) {
  return status.plan?.nombre
    || status.licencia?.nombre
    || status.fuente
    || 'actual';
}

function buildOptions() {
  return {
    allowLegacyFallback: isLegacyFallbackEnabled(),
  };
}

function crearVerificadorLicencia(moduloExplicito = null) {
  return async function verificarLicencia(req, res, next) {
    const empresaId = req.user?.empresa_id;
    const modulo = moduloExplicito ? normalizarModuloExplicito(moduloExplicito) : moduloDeRuta(req);

    try {
      // Usuarios de plataforma y superadmins no dependen de licencia de tenant
      if (isSuperAdmin(req.user) || esPlatformUser(req)) {
        return next();
      }

      const status = await getLicenseStatus(empresaId, buildOptions());
      req.licencia = status;

      if (!status.vigente) {
        return res.status(403).json({
          error: mensajeEstado(status),
          estado: status.estado,
          fuente: status.fuente,
          legacy_fallback_enabled: status.metadata?.legacy_fallback_enabled === true,
          legacy_fallback_used: status.metadata?.legacy_fallback_used === true,
        });
      }

      if (!status.modulos.includes(modulo)) {
        return res.status(403).json({
          error: `El módulo '${modulo}' no está incluido en ${nombrePaquete(status)}.`,
          modulo,
          plan: status.plan?.codigo ?? null,
          fuente: status.fuente,
          legacy_fallback_used: status.metadata?.legacy_fallback_used === true,
        });
      }

      next();
    } catch (error) {
      console.error('Error en middleware de licencia:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  };
}

function licenseMiddleware(arg, res, next) {
  if (typeof arg === 'string') {
    return crearVerificadorLicencia(arg);
  }

  return crearVerificadorLicencia()(arg, res, next);
}

module.exports = licenseMiddleware;
module.exports.forModule = crearVerificadorLicencia;
