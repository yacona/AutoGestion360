const db = require('../../../db');
const AppError = require('../../lib/AppError');

async function registrar({
  empresa_id,
  usuario_id,
  modulo,
  accion,
  tabla,
  registro_id = null,
  datos_antes = null,
  datos_despues = null,
  razon = null,
  ip = null,
}) {
  const detalle = {
    modulo,
    ...(datos_antes != null ? { datos_antes } : {}),
    ...(datos_despues != null ? { datos_despues } : {}),
    ...(razon != null ? { razon } : {}),
  };

  await db.query(
    `INSERT INTO auditoria
     (empresa_id, usuario_id, accion, entidad, entidad_id, detalle, ip)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [empresa_id, usuario_id, accion, tabla, registro_id || null, JSON.stringify(detalle), ip]
  );
}

async function listar(empresaId, { modulo, tabla, accion, usuario_id, limit = 100, offset = 0 }) {
  let query = `SELECT * FROM auditoria WHERE empresa_id = $1`;
  const params = [empresaId];
  let idx = 2;

  if (modulo) { query += ` AND detalle->>'modulo' = $${idx++}`; params.push(modulo); }
  if (tabla)  { query += ` AND entidad = $${idx++}`;            params.push(tabla); }
  if (accion) { query += ` AND accion = $${idx++}`;             params.push(accion); }
  if (usuario_id) { query += ` AND usuario_id = $${idx++}`;     params.push(usuario_id); }

  const safeLimit  = Math.min(parseInt(limit) || 100, 500);
  const safeOffset = parseInt(offset) || 0;
  query += ` ORDER BY creado_en DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`;

  const { rows } = await db.query(query, params);
  return rows;
}

async function listarPorRegistro(empresaId, tabla, id) {
  const { rows } = await db.query(
    `SELECT * FROM auditoria
     WHERE empresa_id = $1 AND entidad = $2 AND entidad_id = $3
     ORDER BY creado_en DESC`,
    [empresaId, tabla, id]
  );
  return rows;
}

module.exports = { registrar, listar, listarPorRegistro };
