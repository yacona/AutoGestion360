'use strict';

const bcrypt = require('bcryptjs');
const db = require('../../../db');
const AppError = require('../../lib/AppError');
const withTransaction = require('../../lib/withTransaction');
const { isSuperAdmin, cleanText } = require('../../lib/helpers');
const { assertCanCreateUsuario } = require('../../lib/plan-limits.service');
const rbac = require('../../lib/rbac/rbac.service');
const {
  getFallbackRoleCodesForUser,
  resolveRoleCode,
} = require('../../lib/rbac/rbac.fallback');

function isPlatformSuperAdmin(user) {
  return user?.scope === 'platform' && isSuperAdmin(user);
}

function normalizeScope(scope) {
  return String(scope || 'tenant').trim().toLowerCase() === 'platform'
    ? 'platform'
    : 'tenant';
}

function resolveRequestedRoleCodes(body = {}, scope = 'tenant') {
  const explicitRoles = Array.isArray(body.roles) ? body.roles : [];
  const candidates = explicitRoles.length > 0
    ? explicitRoles
    : [body.rol_codigo || body.rol || (scope === 'platform' ? 'superadmin' : 'empleado')];

  const roleCodes = Array.from(new Set(
    candidates
      .map((role) => resolveRoleCode(role, scope))
      .filter(Boolean)
  ));

  return roleCodes.length > 0 ? roleCodes : [resolveRoleCode(null, scope)];
}

function getTargetScope(requestingUser, body = {}) {
  if (!isPlatformSuperAdmin(requestingUser)) {
    return 'tenant';
  }

  return normalizeScope(body.scope || 'tenant');
}

function getTargetEmpresaId(requestingUser, body = {}, targetScope = 'tenant') {
  if (targetScope === 'platform') {
    return null;
  }

  if (isPlatformSuperAdmin(requestingUser)) {
    const providedEmpresaId = Number(body.empresa_id || 0);
    if (!providedEmpresaId) {
      throw new AppError('empresa_id es obligatorio para usuarios tenant creados desde plataforma.', 400);
    }
    return providedEmpresaId;
  }

  return Number(requestingUser.empresa_id);
}

function assertRoleAssignmentAllowed(requestingUser, targetScope, roleCodes) {
  if (targetScope === 'platform' && !isPlatformSuperAdmin(requestingUser)) {
    throw new AppError('Solo un SuperAdmin puede gestionar usuarios de plataforma.', 403);
  }

  if (roleCodes.includes('superadmin') && !isPlatformSuperAdmin(requestingUser)) {
    throw new AppError('Solo un SuperAdmin puede asignar el rol SuperAdmin.', 403);
  }
}

async function loadUserRoleCodes(userRow) {
  try {
    return await rbac.getRoleCodesForUser(
      userRow.id,
      userRow.scope === 'platform' ? null : userRow.empresa_id
    );
  } catch (error) {
    if (!rbac.isSchemaMissingError(error)) throw error;
    return getFallbackRoleCodesForUser(userRow);
  }
}

async function assertTargetUserVisible(requestingUser, userId) {
  const { rows } = await db.query(
    `SELECT id, empresa_id, rol, scope, activo
     FROM usuarios
     WHERE id = $1`,
    [userId]
  );

  if (!rows.length) {
    throw new AppError('Usuario no encontrado.', 404);
  }

  const target = rows[0];

  if (!isPlatformSuperAdmin(requestingUser)) {
    if (target.scope === 'platform') {
      throw new AppError('No puedes administrar usuarios de plataforma.', 403);
    }

    if (Number(target.empresa_id) !== Number(requestingUser.empresa_id)) {
      throw new AppError('No puedes administrar usuarios de otra empresa.', 403);
    }
  }

  target.role_codes = await loadUserRoleCodes(target);
  return target;
}

async function enrichUsersWithRoles(rows = []) {
  return Promise.all(rows.map(async (row) => ({
    ...row,
    roles: await loadUserRoleCodes(row),
  })));
}

async function listar(requestingUser, query = {}) {
  await rbac.ensurePermission(requestingUser, 'usuarios:ver');

  const params = [];
  const where = [];

  if (isPlatformSuperAdmin(requestingUser)) {
    if (query.scope) {
      params.push(normalizeScope(query.scope));
      where.push(`u.scope = $${params.length}`);
    }

    if (query.empresa_id && query.empresa_id !== 'all') {
      params.push(Number(query.empresa_id));
      where.push(`u.empresa_id = $${params.length}`);
    }
  } else {
    params.push(Number(requestingUser.empresa_id));
    where.push(`u.empresa_id = $${params.length}`);
    where.push(`u.scope = 'tenant'`);
  }

  if (query.rol) {
    params.push(`%${String(query.rol).trim()}%`);
    where.push(`u.rol ILIKE $${params.length}`);
  }

  if (query.activos !== undefined) {
    params.push(query.activos !== 'false' && query.activos !== false);
    where.push(`u.activo = $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await db.query(
    `SELECT
       u.id,
       u.empresa_id,
       e.nombre AS empresa_nombre,
       u.scope,
       u.nombre,
       u.email,
       u.rol,
       u.activo,
       u.creado_en
     FROM usuarios u
     LEFT JOIN empresas e ON e.id = u.empresa_id
     ${whereSql}
     ORDER BY COALESCE(e.nombre, 'PLATAFORMA'), u.nombre`,
    params
  );

  return enrichUsersWithRoles(rows);
}

async function crear(requestingUser, body = {}) {
  await rbac.ensurePermission(requestingUser, 'usuarios:crear');

  const nombre = cleanText(body.nombre);
  const email = cleanText(body.email);
  const password = String(body.password || '').trim();
  const targetScope = getTargetScope(requestingUser, body);
  const empresaId = getTargetEmpresaId(requestingUser, body, targetScope);
  const activo = body.activo !== false;
  const roleCodes = resolveRequestedRoleCodes(body, targetScope);

  if (!nombre || !email || !password) {
    throw new AppError('Nombre, correo y contraseña son obligatorios.', 400);
  }
  if (password.length < 6) {
    throw new AppError('La contraseña debe tener al menos 6 caracteres.', 400);
  }

  assertRoleAssignmentAllowed(requestingUser, targetScope, roleCodes);

  const { rows: emailCheck } = await db.query(
    'SELECT id FROM usuarios WHERE LOWER(email) = LOWER($1) LIMIT 1',
    [email]
  );
  if (emailCheck.length) {
    throw new AppError('Ese correo ya está registrado. Usa un correo único para iniciar sesión.', 409);
  }

  if (targetScope === 'tenant') {
    const { rows: empresa } = await db.query('SELECT id FROM empresas WHERE id = $1', [empresaId]);
    if (!empresa.length) throw new AppError('Empresa no encontrada.', 404);

    if (activo) {
      await assertCanCreateUsuario(empresaId);
    }
  }

  return withTransaction(async (client) => {
    const hash = await bcrypt.hash(password, 10);
    const legacyRoleValue = rbac.resolveLegacyRoleValueFromCodes(roleCodes, targetScope);

    const { rows } = await client.query(
      `INSERT INTO usuarios (empresa_id, nombre, email, password_hash, rol, scope, activo)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, empresa_id, nombre, email, rol, scope, activo, creado_en`,
      [empresaId, nombre, email, hash, legacyRoleValue, targetScope, activo]
    );

    const usuario = rows[0];
    await rbac.syncUserRoles({
      userId: usuario.id,
      roleCodes,
      empresaId: targetScope === 'platform' ? null : empresaId,
      assignedById: requestingUser.id,
      scope: targetScope,
      client,
    });

    return {
      ...usuario,
      roles: roleCodes,
    };
  });
}

async function actualizar(requestingUser, userId, body = {}) {
  await rbac.ensurePermission(requestingUser, 'usuarios:editar');

  const current = await assertTargetUserVisible(requestingUser, userId);
  const targetScope = current.scope === 'platform' ? 'platform' : getTargetScope(requestingUser, {
    ...body,
    scope: current.scope,
  });

  if (targetScope !== current.scope && !isSuperAdmin(requestingUser)) {
    throw new AppError('No puedes cambiar el scope del usuario.', 403);
  }

  const nombre = cleanText(body.nombre);
  const email = cleanText(body.email);
  const activo = body.activo !== false;
  const roleCodes = resolveRequestedRoleCodes({
    ...body,
    rol: body.rol || current.rol,
  }, targetScope);

  if (!nombre || !email) {
    throw new AppError('Nombre y correo son obligatorios.', 400);
  }

  assertRoleAssignmentAllowed(requestingUser, targetScope, roleCodes);

  if (Number(current.id) === Number(requestingUser.id) && !activo) {
    throw new AppError('No puedes desactivar tu propio usuario.', 400);
  }

  if (!isSuperAdmin(requestingUser) && current.role_codes.includes('superadmin')) {
    throw new AppError('No puedes editar un SuperAdmin.', 403);
  }

  const { rows: emailCheck } = await db.query(
    `SELECT id
     FROM usuarios
     WHERE LOWER(email) = LOWER($1)
       AND id <> $2
     LIMIT 1`,
    [email, userId]
  );
  if (emailCheck.length) {
    throw new AppError('Ese correo ya está registrado en otro usuario.', 409);
  }

  const reactivatingTenantUser = current.scope === 'tenant' && current.activo === false && activo === true;
  if (reactivatingTenantUser) {
    await assertCanCreateUsuario(current.empresa_id);
  }

  return withTransaction(async (client) => {
    const legacyRoleValue = rbac.resolveLegacyRoleValueFromCodes(roleCodes, targetScope);
    const empresaId = targetScope === 'platform' ? null : current.empresa_id;

    const { rows } = await client.query(
      `UPDATE usuarios
       SET nombre = $1,
           email = $2,
           rol = $3,
           scope = $4,
           empresa_id = $5,
           activo = $6
       WHERE id = $7
       RETURNING id, empresa_id, nombre, email, rol, scope, activo, creado_en`,
      [nombre, email, legacyRoleValue, targetScope, empresaId, activo, userId]
    );

    await rbac.syncUserRoles({
      userId,
      roleCodes,
      empresaId,
      assignedById: requestingUser.id,
      scope: targetScope,
      client,
    });

    return {
      ...rows[0],
      roles: roleCodes,
    };
  });
}

async function cambiarEstado(requestingUser, userId, activo) {
  await rbac.ensurePermission(requestingUser, 'usuarios:editar');

  const current = await assertTargetUserVisible(requestingUser, userId);

  if (Number(current.id) === Number(requestingUser.id) && !activo) {
    throw new AppError('No puedes desactivar tu propio usuario.', 400);
  }

  if (!isSuperAdmin(requestingUser) && current.role_codes.includes('superadmin')) {
    throw new AppError('No puedes cambiar el estado de un SuperAdmin.', 403);
  }

  if (current.scope === 'tenant' && current.activo === false && activo === true) {
    await assertCanCreateUsuario(current.empresa_id);
  }

  const { rows } = await db.query(
    `UPDATE usuarios
     SET activo = $1
     WHERE id = $2
     RETURNING id, empresa_id, nombre, email, rol, scope, activo`,
    [activo, userId]
  );

  return {
    ...rows[0],
    roles: current.role_codes,
  };
}

async function cambiarPassword(requestingUser, userId, password) {
  await rbac.ensurePermission(requestingUser, 'usuarios:editar');

  if (!password || password.length < 6) {
    throw new AppError('La contraseña debe tener al menos 6 caracteres.', 400);
  }

  const current = await assertTargetUserVisible(requestingUser, userId);

  if (!isSuperAdmin(requestingUser) && current.role_codes.includes('superadmin')) {
    throw new AppError('No puedes cambiar la contraseña de un SuperAdmin.', 403);
  }

  const hash = await bcrypt.hash(password, 10);
  await db.query('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [hash, userId]);
}

module.exports = {
  listar,
  crear,
  actualizar,
  cambiarEstado,
  cambiarPassword,
};
