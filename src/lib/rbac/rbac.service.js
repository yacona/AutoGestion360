'use strict';

/**
 * rbac.service.js — Resolución DB-backed de permisos RBAC
 *
 * Prioridad de resolución:
 *   1. Caché en memoria (TTL 5 min) para evitar N+1 por request
 *   2. Tablas roles / permisos / rol_permisos / usuario_roles
 *
 * Los superadmin retornan ['*'] sin consultar permisos individuales.
 * Las tablas deben existir (migración 009_rbac.sql); si no existen,
 * getPermisosFromDB lanza un error que el middleware captura y usa
 * el mapa hardcoded como fallback.
 */

const db = require('../../../db');
const AppError = require('../AppError');
const {
  getFallbackPermissionsForRoles,
  getFallbackRoleCodesForUser,
  getLegacyRoleLabel,
  normalizeText,
  resolveRoleCode,
} = require('./rbac.fallback');

// ── Cache en proceso ───────────────────────────────────────────────────────────

const _cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function _cacheKey(userId, empresaId) {
  return `${userId}:${empresaId ?? 'platform'}`;
}

function _cacheGet(userId, empresaId) {
  const entry = _cache.get(_cacheKey(userId, empresaId));
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _cache.delete(_cacheKey(userId, empresaId));
    return null;
  }
  return entry.permisos;
}

function _cacheSet(userId, empresaId, permisos) {
  _cache.set(_cacheKey(userId, empresaId), {
    permisos,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

// ── SQL ────────────────────────────────────────────────────────────────────────

const SQL_ROLES = `
  SELECT r.codigo
  FROM usuario_roles ur
  JOIN roles r ON r.id = ur.rol_id
  WHERE ur.usuario_id = $1
    AND (
      ($2::BIGINT IS NULL AND ur.empresa_id IS NULL)
      OR ur.empresa_id = $2
    )
    AND r.activo = TRUE
`;

const SQL_PERMISOS = `
  SELECT DISTINCT p.codigo
  FROM usuario_roles ur
  JOIN rol_permisos rp ON rp.rol_id = ur.rol_id
  JOIN permisos p      ON p.id = rp.permiso_id
  WHERE ur.usuario_id = $1
    AND (
      ($2::BIGINT IS NULL AND ur.empresa_id IS NULL)
      OR ur.empresa_id = $2
    )
    AND p.activo = TRUE
`;

// ── API pública ────────────────────────────────────────────────────────────────

/**
 * Devuelve la lista de permisos del usuario en el contexto del tenant.
 * Retorna ['*'] si el usuario es superadmin.
 * Lanza error si las tablas RBAC no existen aún.
 */
async function getPermisosFromDB(userId, empresaId) {
  const cached = _cacheGet(userId, empresaId);
  if (cached) return cached;

  const [{ rows: roleRows }, { rows: permisoRows }] = await Promise.all([
    db.query(SQL_ROLES, [userId, empresaId ?? null]),
    db.query(SQL_PERMISOS, [userId, empresaId ?? null]),
  ]);

  const isSuperAdmin = roleRows.some((r) => r.codigo === 'superadmin');
  const permisos = isSuperAdmin ? ['*'] : permisoRows.map((r) => r.codigo);

  _cacheSet(userId, empresaId, permisos);
  return permisos;
}

function isSchemaMissingError(error) {
  return error?.code === '42P01' || error?.code === '42703';
}

/**
 * Devuelve los roles asignados al usuario en el contexto del tenant.
 */
async function getRolesForUser(userId, empresaId) {
  const { rows } = await db.query(
    `SELECT r.id, r.codigo, r.nombre, r.scope
     FROM usuario_roles ur
     JOIN roles r ON r.id = ur.rol_id
     WHERE ur.usuario_id = $1
       AND (
         ($2::BIGINT IS NULL AND ur.empresa_id IS NULL)
         OR ur.empresa_id = $2
       )
       AND r.activo = TRUE`,
    [userId, empresaId ?? null]
  );
  return rows;
}

async function getRoleCodesForUser(userId, empresaId) {
  const roles = await getRolesForUser(userId, empresaId);
  return roles.map((role) => role.codigo);
}

async function getAccessContext(user = {}, empresaId = user?.empresa_id ?? null) {
  if (!user?.id) {
    return { roles: [], permisos: [] };
  }

  try {
    const [roles, permisos] = await Promise.all([
      getRoleCodesForUser(user.id, empresaId),
      getPermisosFromDB(user.id, empresaId),
    ]);

    return { roles, permisos };
  } catch (error) {
    if (!isSchemaMissingError(error)) throw error;

    const roles = getFallbackRoleCodesForUser(user);
    const permisos = getFallbackPermissionsForRoles(roles, user.scope || 'tenant');
    return { roles, permisos };
  }
}

function hasPermissionFromUserContext(user = {}, permiso) {
  const permissions = Array.isArray(user.permisos) ? user.permisos : [];
  return permissions.includes('*') || permissions.includes(permiso);
}

async function ensurePermission(user = {}, permiso, empresaId = user?.empresa_id ?? null) {
  if (!user?.id) {
    throw new AppError('Usuario no autenticado.', 401);
  }

  if (hasPermissionFromUserContext(user, permiso)) {
    return user.permisos;
  }

  const access = await getAccessContext(user, empresaId);
  user.roles = access.roles;
  user.permisos = access.permisos;

  if (hasPermissionFromUserContext(user, permiso)) {
    return access.permisos;
  }

  throw new AppError('No tienes permisos para esta acción.', 403);
}

/**
 * Asigna un rol a un usuario en el contexto de empresa.
 * `client` puede ser un cliente de transacción de pg.
 */
async function asignarRol(userId, rolCodigo, empresaId, asignadoPorId = null, client = db) {
  const { rows } = await client.query(
    `SELECT id, scope
     FROM roles
     WHERE codigo = $1
       AND activo = TRUE`,
    [resolveRoleCode(rolCodigo, empresaId === null ? 'platform' : 'tenant')]
  );
  if (!rows.length) throw new Error(`Rol '${rolCodigo}' no existe.`);

  const role = rows[0];
  const targetScope = empresaId === null ? 'platform' : 'tenant';
  if (role.scope !== 'both' && role.scope !== targetScope) {
    throw new Error(`El rol '${rolCodigo}' no aplica al scope '${targetScope}'.`);
  }

  await client.query(
    `INSERT INTO usuario_roles (usuario_id, rol_id, empresa_id, asignado_por)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [userId, role.id, empresaId ?? null, asignadoPorId]
  );

  invalidateCache(userId, empresaId);
}

/**
 * Revoca un rol de un usuario en el contexto de empresa.
 */
async function revocarRol(userId, rolCodigo, empresaId) {
  const { rows } = await db.query(
    `SELECT id FROM roles WHERE codigo = $1`,
    [resolveRoleCode(rolCodigo, empresaId === null ? 'platform' : 'tenant')]
  );
  if (!rows.length) return;

  await db.query(
    `DELETE FROM usuario_roles
     WHERE usuario_id = $1
       AND rol_id = $2
       AND (
         ($3::BIGINT IS NULL AND empresa_id IS NULL)
         OR empresa_id = $3
       )`,
    [userId, rows[0].id, empresaId ?? null]
  );

  invalidateCache(userId, empresaId);
}

async function syncUserRoles({
  userId,
  roleCodes = [],
  empresaId = null,
  assignedById = null,
  scope = empresaId === null ? 'platform' : 'tenant',
  client = db,
}) {
  const normalizedRoleCodes = Array.from(new Set(
    (Array.isArray(roleCodes) ? roleCodes : [roleCodes])
      .map((roleCode) => resolveRoleCode(roleCode, scope))
      .filter(Boolean)
  ));

  if (normalizedRoleCodes.length === 0) {
    throw new AppError('Debes asignar al menos un rol.', 400);
  }

  const { rows } = await client.query(
    `SELECT id, codigo, scope
     FROM roles
     WHERE codigo = ANY($1::text[])
       AND activo = TRUE`,
    [normalizedRoleCodes]
  );

  if (rows.length !== normalizedRoleCodes.length) {
    const foundCodes = new Set(rows.map((row) => row.codigo));
    const missingCodes = normalizedRoleCodes.filter((roleCode) => !foundCodes.has(roleCode));
    throw new AppError(`Rol no válido: ${missingCodes.join(', ')}.`, 400);
  }

  const incompatible = rows.find((row) => row.scope !== 'both' && row.scope !== scope);
  if (incompatible) {
    throw new AppError(`El rol '${incompatible.codigo}' no aplica al scope '${scope}'.`, 400);
  }

  await client.query(
    `DELETE FROM usuario_roles
     WHERE usuario_id = $1
       AND (
         ($2::BIGINT IS NULL AND empresa_id IS NULL)
         OR empresa_id = $2
       )`,
    [userId, empresaId ?? null]
  );

  for (const role of rows) {
    await client.query(
      `INSERT INTO usuario_roles (usuario_id, rol_id, empresa_id, asignado_por)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [userId, role.id, empresaId ?? null, assignedById]
    );
  }

  invalidateCache(userId, empresaId);

  return rows.map((row) => row.codigo);
}

function resolveLegacyRoleValueFromCodes(roleCodes = [], scope = 'tenant') {
  const firstRole = Array.isArray(roleCodes) && roleCodes.length > 0
    ? normalizeText(roleCodes[0])
    : resolveRoleCode(null, scope);

  return getLegacyRoleLabel(firstRole);
}

/**
 * Invalida la caché de permisos para un usuario+empresa.
 * Llamar tras crear/editar/borrar usuario_roles.
 */
function invalidateCache(userId, empresaId) {
  _cache.delete(_cacheKey(userId, empresaId));
}

module.exports = {
  getPermisosFromDB,
  getRolesForUser,
  getRoleCodesForUser,
  getAccessContext,
  hasPermissionFromUserContext,
  ensurePermission,
  asignarRol,
  revocarRol,
  syncUserRoles,
  resolveLegacyRoleValueFromCodes,
  isSchemaMissingError,
  invalidateCache,
};
