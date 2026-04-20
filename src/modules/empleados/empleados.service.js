const db = require('../../../db');
const AppError = require('../../lib/AppError');

const SELECT_FIELDS = `*, NULL::text AS email, creado_en AS fecha_registro`;

async function listar(empresaId, { rol, activos } = {}) {
  const condiciones = ['empresa_id = $1'];
  const valores = [empresaId];
  let idx = 2;

  if (rol) { condiciones.push(`rol = $${idx++}`); valores.push(rol); }
  if (typeof activos !== 'undefined') {
    condiciones.push(`activo = $${idx++}`);
    valores.push(activos === 'true');
  }

  const { rows } = await db.query(
    `SELECT ${SELECT_FIELDS}
     FROM empleados
     WHERE ${condiciones.join(' AND ')}
     ORDER BY nombre ASC`,
    valores
  );
  return rows;
}

async function obtener(empresaId, id) {
  const { rows } = await db.query(
    `SELECT ${SELECT_FIELDS}
     FROM empleados
     WHERE empresa_id = $1 AND id = $2
     LIMIT 1`,
    [empresaId, id]
  );
  if (!rows.length) throw new AppError('Empleado no encontrado.', 404);
  return rows[0];
}

async function crear(empresaId, { nombre, rol, telefono, activo }) {
  if (!nombre || !rol) throw new AppError('Nombre y rol son obligatorios para el empleado.', 400);

  try {
    const { rows } = await db.query(
      `INSERT INTO empleados (empresa_id, nombre, rol, telefono, activo)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING ${SELECT_FIELDS}`,
      [empresaId, nombre, rol.trim(), telefono || null, activo ?? true]
    );
    return rows[0];
  } catch (err) {
    if (err.code === '23505') throw new AppError('Empleado duplicado para esta empresa.', 409);
    throw err;
  }
}

async function actualizar(empresaId, id, { nombre, rol, telefono, activo }) {
  if (!nombre || !rol) throw new AppError('Nombre y rol son obligatorios para actualizar.', 400);

  const { rows } = await db.query(
    `UPDATE empleados
     SET nombre = $1, rol = $2, telefono = $3, activo = $4
     WHERE empresa_id = $5 AND id = $6
     RETURNING ${SELECT_FIELDS}`,
    [nombre, rol.trim(), telefono || null, typeof activo === 'boolean' ? activo : true, empresaId, id]
  );
  if (!rows.length) throw new AppError('Empleado no encontrado.', 404);
  return rows[0];
}

async function cambiarEstado(empresaId, id, activo) {
  if (typeof activo === 'undefined') {
    throw new AppError("Debe enviar el campo 'activo' en el cuerpo.", 400);
  }
  const { rows } = await db.query(
    `UPDATE empleados
     SET activo = $1
     WHERE empresa_id = $2 AND id = $3
     RETURNING ${SELECT_FIELDS}`,
    [activo, empresaId, id]
  );
  if (!rows.length) throw new AppError('Empleado no encontrado.', 404);
  return rows[0];
}

async function desactivar(empresaId, id) {
  const { rows } = await db.query(
    `UPDATE empleados
     SET activo = false
     WHERE empresa_id = $1 AND id = $2
     RETURNING ${SELECT_FIELDS}`,
    [empresaId, id]
  );
  if (!rows.length) throw new AppError('Empleado no encontrado.', 404);
  return rows[0];
}

module.exports = { listar, obtener, crear, actualizar, cambiarEstado, desactivar };
