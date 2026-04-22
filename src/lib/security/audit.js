'use strict';

const db = require('../../../db');

let auditSchemaMode = null;

function resolveRequestIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || null;
}

function resolveUserAgent(req) {
  return req.get?.('user-agent') || req.headers['user-agent'] || null;
}

async function recordSecurityEvent({
  empresaId = null,
  usuarioId = null,
  accion,
  entidad = 'auth_session',
  entidadId = null,
  detalle = {},
  ip = null,
}) {
  if (!auditSchemaMode) {
    const { rows } = await db.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_name = 'auditoria'`
    );
    const columns = new Set(rows.map((row) => row.column_name));
    auditSchemaMode = columns.has('entidad') ? 'normalized' : 'legacy';
  }

  if (auditSchemaMode === 'normalized') {
    await db.query(
      `INSERT INTO auditoria
       (empresa_id, usuario_id, accion, entidad, entidad_id, detalle, ip)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        empresaId,
        usuarioId,
        accion,
        entidad,
        entidadId,
        JSON.stringify(detalle || {}),
        ip,
      ]
    );
    return;
  }

  await db.query(
    `INSERT INTO auditoria
     (empresa_id, usuario_id, modulo, accion, tabla_afectada, registro_id, datos_antes, datos_despues, razon, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      empresaId,
      usuarioId,
      detalle?.modulo || 'auth',
      accion,
      entidad,
      entidadId,
      detalle?.datos_antes ? JSON.stringify(detalle.datos_antes) : null,
      detalle?.datos_despues ? JSON.stringify(detalle.datos_despues) : JSON.stringify(detalle || {}),
      detalle?.razon || null,
      ip,
    ]
  );
}

async function recordSecurityEventSafe(payload) {
  try {
    await recordSecurityEvent(payload);
  } catch (error) {
    console.warn('[audit] No se pudo registrar evento de seguridad:', error.message);
  }
}

module.exports = {
  recordSecurityEvent,
  recordSecurityEventSafe,
  resolveRequestIp,
  resolveUserAgent,
};
