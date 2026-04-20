const bcrypt = require('bcryptjs');
const db = require('../../../db');
const AppError = require('../../lib/AppError');
const { normalizeRole, isSuperAdmin, cleanText } = require('../../lib/helpers');

function canManageUsers(user) {
  return ['superadmin', 'admin', 'administrador'].includes(normalizeRole(user?.rol));
}

function canAssignRole(user, role) {
  if (normalizeRole(role) === 'superadmin') return isSuperAdmin(user);
  return true;
}

function getTargetEmpresaId(user, providedEmpresaId) {
  if (isSuperAdmin(user)) {
    return Number(providedEmpresaId || user.empresa_id);
  }
  return Number(user.empresa_id);
}

async function assertUserScope(requestingUser, userId) {
  const { rows } = await db.query(
    `SELECT id, empresa_id, rol FROM usuarios WHERE id=$1`,
    [userId]
  );
  if (!rows.length) throw new AppError('Usuario no encontrado.', 404);

  const target = rows[0];
  if (!isSuperAdmin(requestingUser) && Number(target.empresa_id) !== Number(requestingUser.empresa_id)) {
    throw new AppError('No puedes administrar usuarios de otra empresa.', 403);
  }
  return target;
}

async function listar(requestingUser, query) {
  const params = [];
  const where  = [];

  if (isSuperAdmin(requestingUser)) {
    if (query.empresa_id && query.empresa_id !== 'all') {
      params.push(Number(query.empresa_id));
      where.push(`u.empresa_id=$${params.length}`);
    }
  } else {
    params.push(Number(requestingUser.empresa_id));
    where.push(`u.empresa_id=$${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await db.query(
    `SELECT u.id, u.empresa_id, e.nombre AS empresa_nombre, u.nombre, u.email, u.rol, u.activo, u.creado_en
     FROM usuarios u JOIN empresas e ON e.id=u.empresa_id
     ${whereSql} ORDER BY e.nombre, u.nombre`,
    params
  );
  return rows;
}

async function crear(requestingUser, body) {
  if (!canManageUsers(requestingUser)) {
    throw new AppError('No tienes permisos para gestionar usuarios.', 403);
  }

  const nombre    = cleanText(body.nombre);
  const email     = cleanText(body.email);
  const password  = String(body.password || '').trim();
  const rol       = cleanText(body.rol) || 'Operador';
  const empresaId = getTargetEmpresaId(requestingUser, body.empresa_id);
  const activo    = body.activo !== false;

  if (!nombre || !email || !password) {
    throw new AppError('Nombre, correo y contraseña son obligatorios.', 400);
  }
  if (password.length < 6) throw new AppError('La contraseña debe tener al menos 6 caracteres.', 400);
  if (!canAssignRole(requestingUser, rol)) {
    throw new AppError('Solo un SuperAdmin puede crear usuarios SuperAdmin.', 403);
  }

  const { rows: emailCheck } = await db.query(
    'SELECT id FROM usuarios WHERE LOWER(email)=LOWER($1) LIMIT 1',
    [email]
  );
  if (emailCheck.length) {
    throw new AppError('Ese correo ya está registrado. Usa un correo único para iniciar sesión.', 409);
  }

  const { rows: empresa } = await db.query('SELECT id FROM empresas WHERE id=$1', [empresaId]);
  if (!empresa.length) throw new AppError('Empresa no encontrada.', 404);

  const hash = await bcrypt.hash(password, 10);
  const { rows } = await db.query(
    `INSERT INTO usuarios (empresa_id,nombre,email,password_hash,rol,activo)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, empresa_id, nombre, email, rol, activo, creado_en`,
    [empresaId, nombre, email, hash, rol, activo]
  );
  return rows[0];
}

async function actualizar(requestingUser, userId, body) {
  if (!canManageUsers(requestingUser)) {
    throw new AppError('No tienes permisos para gestionar usuarios.', 403);
  }

  const nombre = cleanText(body.nombre);
  const email  = cleanText(body.email);
  const rol    = cleanText(body.rol) || 'Operador';
  const activo = body.activo !== false;

  if (!nombre || !email) throw new AppError('Nombre y correo son obligatorios.', 400);
  if (!canAssignRole(requestingUser, rol)) {
    throw new AppError('Solo un SuperAdmin puede asignar el rol SuperAdmin.', 403);
  }

  const current = await assertUserScope(requestingUser, userId);

  if (Number(current.id) === Number(requestingUser.id) && !activo) {
    throw new AppError('No puedes desactivar tu propio usuario.', 400);
  }
  if (!isSuperAdmin(requestingUser) && normalizeRole(current.rol) === 'superadmin') {
    throw new AppError('No puedes editar un SuperAdmin.', 403);
  }

  const { rows: emailCheck } = await db.query(
    `SELECT id FROM usuarios WHERE LOWER(email)=LOWER($1) AND id<>$2 LIMIT 1`,
    [email, userId]
  );
  if (emailCheck.length) throw new AppError('Ese correo ya está registrado en otro usuario.', 409);

  const { rows } = await db.query(
    `UPDATE usuarios SET nombre=$1,email=$2,rol=$3,activo=$4
     WHERE id=$5
     RETURNING id, empresa_id, nombre, email, rol, activo, creado_en`,
    [nombre, email, rol, activo, userId]
  );
  return rows[0];
}

async function cambiarEstado(requestingUser, userId, activo) {
  if (!canManageUsers(requestingUser)) {
    throw new AppError('No tienes permisos para gestionar usuarios.', 403);
  }

  const current = await assertUserScope(requestingUser, userId);

  if (Number(current.id) === Number(requestingUser.id) && !activo) {
    throw new AppError('No puedes desactivar tu propio usuario.', 400);
  }
  if (!isSuperAdmin(requestingUser) && normalizeRole(current.rol) === 'superadmin') {
    throw new AppError('No puedes cambiar el estado de un SuperAdmin.', 403);
  }

  const { rows } = await db.query(
    `UPDATE usuarios SET activo=$1 WHERE id=$2
     RETURNING id, empresa_id, nombre, email, rol, activo`,
    [activo, userId]
  );
  return rows[0];
}

async function cambiarPassword(requestingUser, userId, password) {
  if (!canManageUsers(requestingUser)) {
    throw new AppError('No tienes permisos para gestionar usuarios.', 403);
  }
  if (!password || password.length < 6) {
    throw new AppError('La contraseña debe tener al menos 6 caracteres.', 400);
  }

  const current = await assertUserScope(requestingUser, userId);

  if (!isSuperAdmin(requestingUser) && normalizeRole(current.rol) === 'superadmin') {
    throw new AppError('No puedes cambiar la contraseña de un SuperAdmin.', 403);
  }

  const hash = await bcrypt.hash(password, 10);
  await db.query(`UPDATE usuarios SET password_hash=$1 WHERE id=$2`, [hash, userId]);
}

module.exports = { listar, crear, actualizar, cambiarEstado, cambiarPassword };
