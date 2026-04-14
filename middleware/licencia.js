// middleware/licencia.js
const db = require('../db');

const MODULOS_POR_LICENCIA_LEGACY = {
  demo: ['parqueadero', 'lavadero', 'taller', 'matricula', 'evaluacion'],
  basica: ['parqueadero', 'lavadero', 'matricula'],
  premium: ['parqueadero', 'lavadero', 'taller', 'matricula', 'evaluacion'],
};

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function esErrorTablaInexistente(error) {
  return error?.code === '42P01';
}

function moduloDeRuta(req) {
  return req.baseUrl.split('/').pop();
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
  const modulosNombres = modulosPermitidos.map(m => m.nombre);

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

async function verificarLicencia(req, res, next) {
  const empresaId = req.user.empresa_id;
  const modulo = moduloDeRuta(req);

  try {
    try {
      const resultadoNuevo = await verificarLicenciaNueva(empresaId, modulo, res);

      if (resultadoNuevo === true) {
        return next();
      }

      if (resultadoNuevo === false) {
        return;
      }
    } catch (error) {
      if (!esErrorTablaInexistente(error)) {
        throw error;
      }
    }

    const resultadoLegacy = await verificarLicenciaLegacy(empresaId, modulo, res);
    if (resultadoLegacy) {
      return next();
    }
  } catch (error) {
    console.error('Error en middleware de licencia:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

module.exports = verificarLicencia;
