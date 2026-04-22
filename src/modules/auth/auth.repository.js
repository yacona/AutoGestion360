const db = require('../../../db');

function getQueryable(queryable = db) {
  return queryable;
}

/**
 * Busca un usuario por email.
 * Usa LEFT JOIN para soportar usuarios de plataforma (empresa_id = NULL).
 * Para usuarios tenant devuelve también los datos de empresa.
 */
async function findUserWithEmpresa(email, queryable = db) {
  const { rows } = await getQueryable(queryable).query(
    `SELECT u.id, u.empresa_id, u.nombre, u.email,
            u.password_hash, u.rol, u.activo,
            u.scope,
            e.nombre AS empresa_nombre, e.logo_url, e.zona_horaria,
            e.licencia_tipo, e.licencia_id, e.licencia_fin,
            e.activa AS empresa_activa
     FROM usuarios u
     LEFT JOIN empresas e ON e.id = u.empresa_id
     WHERE LOWER(u.email) = LOWER($1)
     ORDER BY
       CASE WHEN LOWER(u.rol) IN ('superadmin','super_admin','super admin') THEN 0 ELSE 1 END,
       CASE WHEN u.scope = 'platform' THEN 0 ELSE 1 END,
       u.id
     LIMIT 1`,
    [email]
  );
  return rows[0] || null;
}

async function findUserByIdWithEmpresa(userId, queryable = db) {
  const { rows } = await getQueryable(queryable).query(
    `SELECT u.id, u.empresa_id, u.nombre, u.email,
            u.password_hash, u.rol, u.activo,
            u.scope,
            e.nombre AS empresa_nombre, e.logo_url, e.zona_horaria,
            e.licencia_tipo, e.licencia_id, e.licencia_fin,
            e.activa AS empresa_activa
     FROM usuarios u
     LEFT JOIN empresas e ON e.id = u.empresa_id
     WHERE u.id = $1
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function findSessionByUid(sessionUid, queryable = db) {
  const { rows } = await getQueryable(queryable).query(
    `SELECT *
     FROM user_sessions
     WHERE session_uid = $1
     LIMIT 1`,
    [sessionUid]
  );
  return rows[0] || null;
}

async function findSessionAuthContext(sessionUid, queryable = db) {
  const { rows } = await getQueryable(queryable).query(
    `SELECT
       s.*,
       u.activo AS usuario_activo,
       u.rol AS usuario_rol,
       u.scope AS usuario_scope,
       u.empresa_id AS usuario_empresa_id,
       e.activa AS empresa_activa
     FROM user_sessions s
     JOIN usuarios u ON u.id = s.user_id
     LEFT JOIN empresas e ON e.id = u.empresa_id
     WHERE s.session_uid = $1
     LIMIT 1`,
    [sessionUid]
  );
  return rows[0] || null;
}

async function createSession({
  queryable = db,
  sessionUid,
  userId,
  empresaId = null,
  scope = 'tenant',
  refreshTokenHash,
  userAgent = null,
  ipCreacion = null,
  ipUltimoUso = null,
  refreshExpiresAt,
  metadata = null,
}) {
  const { rows } = await getQueryable(queryable).query(
    `INSERT INTO user_sessions (
       session_uid,
       user_id,
       empresa_id,
       scope,
       refresh_token_hash,
       user_agent,
       ip_creacion,
       ip_ultimo_uso,
       refresh_expires_at,
       metadata,
       ultima_actividad_en,
       ultimo_login_en,
       actualizado_en
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,NOW(),NOW(),NOW())
     RETURNING *`,
    [
      sessionUid,
      userId,
      empresaId,
      scope,
      refreshTokenHash,
      userAgent,
      ipCreacion,
      ipUltimoUso,
      refreshExpiresAt,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );
  return rows[0];
}

async function rotateSessionRefreshToken({
  queryable = db,
  sessionId,
  previousRefreshTokenHash = null,
  refreshTokenHash,
  refreshExpiresAt,
  ipUltimoUso = null,
  userAgent = null,
  metadata = null,
}) {
  const { rows } = await getQueryable(queryable).query(
    `UPDATE user_sessions
     SET previous_refresh_token_hash = $2,
         refresh_token_hash = $3,
         refresh_expires_at = $4,
         ip_ultimo_uso = COALESCE($5, ip_ultimo_uso),
         user_agent = COALESCE($6, user_agent),
         metadata = COALESCE($7::jsonb, metadata),
         ultimo_refresh_en = NOW(),
         ultima_actividad_en = NOW(),
         actualizado_en = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      sessionId,
      previousRefreshTokenHash,
      refreshTokenHash,
      refreshExpiresAt,
      ipUltimoUso,
      userAgent,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );
  return rows[0] || null;
}

async function revokeSessionByUid(sessionUid, reason, queryable = db) {
  const { rows } = await getQueryable(queryable).query(
    `UPDATE user_sessions
     SET revocada_en = COALESCE(revocada_en, NOW()),
         motivo_revocacion = COALESCE($2, motivo_revocacion),
         actualizado_en = NOW()
     WHERE session_uid = $1
     RETURNING *`,
    [sessionUid, reason || null]
  );
  return rows[0] || null;
}

async function revokeSessionById(sessionId, reason, queryable = db) {
  const { rows } = await getQueryable(queryable).query(
    `UPDATE user_sessions
     SET revocada_en = COALESCE(revocada_en, NOW()),
         motivo_revocacion = COALESCE($2, motivo_revocacion),
         actualizado_en = NOW()
     WHERE id = $1
     RETURNING *`,
    [sessionId, reason || null]
  );
  return rows[0] || null;
}

async function revokeAllSessionsForUser(userId, reason, queryable = db, excludeSessionUid = null) {
  const params = [userId, reason || null];
  let sql = `
    UPDATE user_sessions
    SET revocada_en = COALESCE(revocada_en, NOW()),
        motivo_revocacion = COALESCE($2, motivo_revocacion),
        actualizado_en = NOW()
    WHERE user_id = $1
      AND revocada_en IS NULL
  `;

  if (excludeSessionUid) {
    params.push(excludeSessionUid);
    sql += ` AND session_uid <> $3`;
  }

  sql += ' RETURNING *';

  const { rows } = await getQueryable(queryable).query(sql, params);
  return rows;
}

async function listSessionsByUserId(userId, queryable = db) {
  const { rows } = await getQueryable(queryable).query(
    `SELECT
       id,
       session_uid,
       user_id,
       empresa_id,
       scope,
       user_agent,
       ip_creacion,
       ip_ultimo_uso,
       ultimo_login_en,
       ultimo_refresh_en,
       ultima_actividad_en,
       refresh_expires_at,
       revocada_en,
       motivo_revocacion,
       creado_en,
       actualizado_en
     FROM user_sessions
     WHERE user_id = $1
     ORDER BY creado_en DESC, id DESC`,
    [userId]
  );
  return rows;
}

async function touchSessionActivity(sessionUid, ip, queryable = db) {
  await getQueryable(queryable).query(
    `UPDATE user_sessions
     SET ultima_actividad_en = NOW(),
         ip_ultimo_uso = COALESCE($2, ip_ultimo_uso),
         actualizado_en = NOW()
     WHERE session_uid = $1
       AND revocada_en IS NULL`,
    [sessionUid, ip || null]
  );
}

async function findEmpresaLicenciaActiva(empresaId, queryable = db) {
  const { rows } = await getQueryable(queryable).query(
    `SELECT el.licencia_id, el.fecha_inicio, el.fecha_fin, el.activa,
            l.nombre AS licencia_nombre, l.descripcion, l.precio
     FROM empresa_licencia el
     JOIN licencias l ON el.licencia_id = l.id
     WHERE el.empresa_id = $1 AND el.activa = true
     ORDER BY el.creado_en DESC
     LIMIT 1`,
    [empresaId]
  );
  return rows[0] || null;
}

async function findEmpresaLicenciaDirecta(empresaId, queryable = db) {
  const { rows } = await getQueryable(queryable).query(
    `SELECT e.licencia_id, e.licencia_inicio AS fecha_inicio, e.licencia_fin AS fecha_fin,
            e.activa, l.nombre AS licencia_nombre, l.descripcion, l.precio
     FROM empresas e
     JOIN licencias l ON l.id = e.licencia_id
     WHERE e.id = $1 AND e.licencia_id IS NOT NULL
     LIMIT 1`,
    [empresaId]
  );
  return rows[0] || null;
}

async function findEmpresaLegacy(empresaId, queryable = db) {
  const { rows } = await getQueryable(queryable).query(
    `SELECT licencia_tipo, licencia_inicio, licencia_fin, activa
     FROM empresas WHERE id = $1 LIMIT 1`,
    [empresaId]
  );
  return rows[0] || null;
}

async function findModulosByLicenciaId(licenciaId, queryable = db) {
  const { rows } = await getQueryable(queryable).query(
    `SELECT m.nombre, m.descripcion
     FROM licencia_modulo lm
     JOIN modulos m ON lm.modulo_id = m.id
     WHERE lm.licencia_id = $1
     ORDER BY m.nombre`,
    [licenciaId]
  );
  return rows;
}

async function findEmpresaById(empresaId, queryable = db) {
  const { rows } = await getQueryable(queryable).query(
    `SELECT id, nombre, nit, ciudad, direccion, telefono, email_contacto, logo_url, zona_horaria
     FROM empresas WHERE id = $1`,
    [empresaId]
  );
  return rows[0] || null;
}

async function updateEmpresa(empresaId, { nombre, nit, ciudad, direccion, telefono, email_contacto, zona_horaria }, queryable = db) {
  const { rows } = await getQueryable(queryable).query(
    `UPDATE empresas
     SET nombre=$1, nit=$2, ciudad=$3, direccion=$4, telefono=$5, email_contacto=$6, zona_horaria=$7
     WHERE id=$8 RETURNING *`,
    [nombre, nit, ciudad, direccion, telefono, email_contacto, zona_horaria, empresaId]
  );
  return rows[0] || null;
}

async function updateEmpresaLogo(empresaId, logoUrl, queryable = db) {
  const { rows } = await getQueryable(queryable).query(
    `UPDATE empresas SET logo_url=$1 WHERE id=$2 RETURNING logo_url`,
    [logoUrl, empresaId]
  );
  return rows[0] || null;
}

async function countEmpresas(queryable = db) {
  const { rows } = await getQueryable(queryable).query('SELECT COUNT(*) AS total FROM empresas');
  return parseInt(rows[0].total, 10);
}

async function createEmpresaDemo(data, queryable = db) {
  const { rows } = await getQueryable(queryable).query(
    `INSERT INTO empresas (nombre, nit, ciudad, direccion, telefono, email_contacto, licencia_tipo)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [data.nombre, data.nit, data.ciudad, data.direccion, data.telefono, data.email_contacto, data.licencia_tipo]
  );
  return rows[0];
}

async function createUsuario(empresaId, { nombre, email, password_hash, rol }, queryable = db) {
  const { rows } = await getQueryable(queryable).query(
    `INSERT INTO usuarios (empresa_id, nombre, email, password_hash, rol, scope)
     VALUES ($1,$2,$3,$4,$5,'tenant') RETURNING id, empresa_id, nombre, email, rol, scope`,
    [empresaId, nombre, email, password_hash, rol]
  );
  return rows[0];
}

/**
 * Crea un usuario de plataforma (scope='platform', empresa_id=NULL).
 * Solo para uso en scripts de bootstrapping o admin de plataforma.
 */
async function createPlatformUser({ nombre, email, password_hash, rol = 'SuperAdmin' }, queryable = db) {
  const { rows } = await getQueryable(queryable).query(
    `INSERT INTO usuarios (empresa_id, nombre, email, password_hash, rol, scope)
     VALUES (NULL,$1,$2,$3,$4,'platform')
     RETURNING id, empresa_id, nombre, email, rol, scope`,
    [nombre, email, password_hash, rol]
  );
  return rows[0];
}

module.exports = {
  findUserWithEmpresa,
  findUserByIdWithEmpresa,
  findSessionByUid,
  findSessionAuthContext,
  createSession,
  rotateSessionRefreshToken,
  revokeSessionByUid,
  revokeSessionById,
  revokeAllSessionsForUser,
  listSessionsByUserId,
  touchSessionActivity,
  findEmpresaLicenciaActiva,
  findEmpresaLicenciaDirecta,
  findEmpresaLegacy,
  findModulosByLicenciaId,
  findEmpresaById,
  updateEmpresa,
  updateEmpresaLogo,
  countEmpresas,
  createEmpresaDemo,
  createUsuario,
  createPlatformUser,
};
