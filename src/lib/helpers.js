const db = require('../../db');

function normalizeRole(role) {
  return String(role || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function isSuperAdmin(user) {
  return normalizeRole(user?.rol) === 'superadmin';
}

function canManageUsers(user) {
  return ['superadmin', 'admin', 'administrador'].includes(normalizeRole(user?.rol));
}

function cleanText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function toNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizarPlaca(value) {
  return String(value || '').toUpperCase().replace(/\s+/g, '').trim();
}

async function tableExists(tableName) {
  const { rows } = await db.query(
    'SELECT to_regclass($1) AS table_name',
    [`public.${tableName}`]
  );
  return Boolean(rows[0]?.table_name);
}

function handleDbError(res, error, fallbackMessage) {
  if (error.code === '23505') {
    return res.status(409).json({ error: 'Ya existe un registro con esos datos.' });
  }
  if (error.isOperational) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  console.error(fallbackMessage, error);
  return res.status(500).json({ error: fallbackMessage });
}

module.exports = {
  normalizeRole,
  isSuperAdmin,
  canManageUsers,
  cleanText,
  toNumber,
  normalizarPlaca,
  tableExists,
  handleDbError,
};
