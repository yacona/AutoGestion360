// middleware/licencia.js
const db = require('../db');
const { ensureLicenciasSchema } = require('../utils/licencias-schema');
const { getSuscripcionEmpresa } = require('../utils/suscripciones-schema');

const MODULOS_POR_LICENCIA_LEGACY = {
  demo: ['dashboard', 'parqueadero', 'clientes'],
  basica: ['dashboard', 'parqueadero', 'clientes', 'reportes', 'configuracion'],
  pro: ['dashboard', 'parqueadero', 'clientes', 'reportes', 'lavadero', 'taller', 'empleados', 'usuarios', 'configuracion'],
  premium: ['dashboard', 'parqueadero', 'clientes', 'reportes', 'lavadero', 'taller', 'empleados', 'usuarios', 'configuracion', 'empresas'],
};

const ALIAS_MODULO_RUTA = {
  tarifas: 'configuracion',
  vehiculos: 'parqueadero',
};

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function esSuperAdmin(req) {
  return normalizarTexto(req.user?.rol) === 'superadmin';
}

function esErrorTablaInexistente(error) {
  return error?.code === '42P01';
}

function moduloDeRuta(req) {
  const modulo = normalizarTexto(req.baseUrl.split('/').pop());
  return ALIAS_MODULO_RUTA[modulo] || modulo;
}

function normalizarModuloExplicito(modulo) {
  const normalizado = normalizarTexto(modulo);
  return ALIAS_MODULO_RUTA[normalizado] || normalizado;
}

function validarVigencia(licencia, res) {
  const ahora = new Date();

  if (licencia.fecha_fin && ahora > new Date(licencia.fecha_fin)) {
    res.status(403).json({ error: 'La licencia ha expirado' });
    return false;
  }

  if (licencia.activa === false) {
    res.status(403).json({ error: 'La licencia no está activa' });
    return false;
  }

  return true;
}

async function validarSuscripcion(empresaId, res) {
  const suscripcion = await getSuscripcionEmpresa(db, empresaId);
  if (!suscripcion) return true;

  const estado = suscripcion.estado_real;

  if (estado === 'VENCIDA') {
    res.status(403).json({
      error: 'La suscripcion SaaS de la empresa ha vencido. Renueva el plan para continuar.',
    });
    return false;
  }

  if (estado === 'SUSPENDIDA') {
    res.status(403).json({
      error: 'La suscripcion SaaS de la empresa esta suspendida.',
    });
    return false;
  }

  if (estado === 'CANCELADA') {
    res.status(403).json({
      error: 'La suscripcion SaaS de la empresa esta cancelada.',
    });
    return false;
  }

  return true;
}

async function verificarLicenciaNueva(empresaId, modulo, res) {
  const licenciaQuery = `
    SELECT el.licencia_id, el.fecha_fin, el.activa, l.nombre AS licencia_nombre
    FROM empresa_licencia el
    JOIN licencias l ON el.licencia_id = l.id
    WHERE el.empresa_id = $1 AND el.activa = true
    ORDER BY el.creado_en DESC
    LIMIT 1
  `;
  const { rows: licencias } = await db.query(licenciaQuery, [empresaId]);

  if (licencias.length === 0) {
    return null;
  }

  const licencia = licencias[0];

  if (!validarVigencia(licencia, res)) {
    return false;
  }

  const moduloQuery = `
    SELECT m.nombre
    FROM licencia_modulo lm
    JOIN modulos m ON lm.modulo_id = m.id
    WHERE lm.licencia_id = $1
  `;
  const { rows: modulosPermitidos } = await db.query(moduloQuery, [licencia.licencia_id]);
  const modulosNombres = modulosPermitidos.map(m => normalizarTexto(m.nombre));

  if (!modulosNombres.includes(modulo)) {
    res.status(403).json({
      error: `El módulo '${modulo}' no está incluido en su licencia ${licencia.licencia_nombre}`
    });
    return false;
  }

  return true;
}

async function verificarLicenciaDirectaEmpresa(empresaId, modulo, res) {
  const licenciaQuery = `
    SELECT e.licencia_id, e.licencia_inicio AS fecha_inicio, e.licencia_fin AS fecha_fin,
           e.activa, l.nombre AS licencia_nombre
    FROM empresas e
    JOIN licencias l ON l.id = e.licencia_id
    WHERE e.id = $1 AND e.licencia_id IS NOT NULL
    LIMIT 1
  `;
  const { rows } = await db.query(licenciaQuery, [empresaId]);

  if (rows.length === 0) {
    return null;
  }

  const licencia = rows[0];

  if (!validarVigencia(licencia, res)) {
    return false;
  }

  const moduloQuery = `
    SELECT m.nombre
    FROM licencia_modulo lm
    JOIN modulos m ON lm.modulo_id = m.id
    WHERE lm.licencia_id = $1
  `;
  const { rows: modulosPermitidos } = await db.query(moduloQuery, [licencia.licencia_id]);
  const modulosNombres = modulosPermitidos.map(m => normalizarTexto(m.nombre));

  if (!modulosNombres.includes(modulo)) {
    res.status(403).json({
      error: `El módulo '${modulo}' no está incluido en su licencia ${licencia.licencia_nombre}`
    });
    return false;
  }

  return true;
}

async function verificarLicenciaLegacy(empresaId, modulo, res) {
  const { rows } = await db.query(
    `SELECT licencia_tipo, licencia_fin, activa
     FROM empresas
     WHERE id = $1
     LIMIT 1`,
    [empresaId]
  );

  if (rows.length === 0) {
    res.status(403).json({ error: 'No se encontró la empresa asociada al usuario' });
    return false;
  }

  const empresa = rows[0];

  if (!validarVigencia({ fecha_fin: empresa.licencia_fin, activa: empresa.activa }, res)) {
    return false;
  }

  const tipoLicencia = normalizarTexto(empresa.licencia_tipo || 'demo');
  const modulosPermitidos = MODULOS_POR_LICENCIA_LEGACY[tipoLicencia] || [];

  if (!modulosPermitidos.includes(modulo)) {
    res.status(403).json({
      error: `El módulo '${modulo}' no está incluido en su licencia ${empresa.licencia_tipo || 'demo'}`
    });
    return false;
  }

  return true;
}

function crearVerificadorLicencia(moduloExplicito = null) {
  return async function verificarLicencia(req, res, next) {
    const empresaId = req.user.empresa_id;
    const modulo = moduloExplicito ? normalizarModuloExplicito(moduloExplicito) : moduloDeRuta(req);

    try {
      if (esSuperAdmin(req)) {
        return next();
      }

      await ensureLicenciasSchema();
      const suscripcionValida = await validarSuscripcion(empresaId, res);
      if (!suscripcionValida) {
        return;
      }

      const resultadoNuevo = await verificarLicenciaNueva(empresaId, modulo, res);

      if (resultadoNuevo === true) {
        return next();
      }

      if (resultadoNuevo === false) {
        return;
      }

      const resultadoDirecto = await verificarLicenciaDirectaEmpresa(empresaId, modulo, res);
      if (resultadoDirecto === true) {
        return next();
      }

      if (resultadoDirecto === false) {
        return;
      }

      const resultadoLegacy = await verificarLicenciaLegacy(empresaId, modulo, res);
      if (resultadoLegacy) {
        return next();
      }
    } catch (error) {
      if (esErrorTablaInexistente(error)) {
        const resultadoLegacy = await verificarLicenciaLegacy(empresaId, modulo, res);
        if (resultadoLegacy) return next();
      } else {
        console.error('Error en middleware de licencia:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
      }
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
