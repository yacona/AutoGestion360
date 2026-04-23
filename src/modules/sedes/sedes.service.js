'use strict';

const db = require('../../../db');
const AppError = require('../../lib/AppError');
const { isSuperAdmin, cleanText } = require('../../lib/helpers');
const { assertCanCreateSede } = require('../../lib/plan-limits.service');

function getEmpresaId(requestingUser, bodyEmpresaId) {
  if (isSuperAdmin(requestingUser)) {
    return Number(bodyEmpresaId || requestingUser.empresa_id);
  }
  return Number(requestingUser.empresa_id);
}

async function listar(requestingUser, query = {}) {
  const params = [];
  const where = [];

  if (isSuperAdmin(requestingUser)) {
    if (query.empresa_id) {
      params.push(Number(query.empresa_id));
      where.push(`s.empresa_id=$${params.length}`);
    }
  } else {
    params.push(Number(requestingUser.empresa_id));
    where.push(`s.empresa_id=$${params.length}`);
  }

  if (query.activa !== undefined) {
    params.push(query.activa !== 'false' && query.activa !== false);
    where.push(`s.activa=$${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows } = await db.query(
    `SELECT s.id, s.empresa_id, e.nombre AS empresa_nombre,
            s.nombre, s.direccion, s.ciudad, s.telefono, s.activa, s.creado_en
     FROM sedes s
     JOIN empresas e ON e.id = s.empresa_id
     ${whereSql}
     ORDER BY e.nombre, s.nombre`,
    params
  );
  return rows;
}

async function obtener(requestingUser, sedeId) {
  const { rows } = await db.query(
    `SELECT s.id, s.empresa_id, e.nombre AS empresa_nombre,
            s.nombre, s.direccion, s.ciudad, s.telefono, s.activa, s.creado_en
     FROM sedes s
     JOIN empresas e ON e.id = s.empresa_id
     WHERE s.id = $1`,
    [sedeId]
  );
  if (!rows.length) throw new AppError('Sede no encontrada.', 404);

  const sede = rows[0];
  if (!isSuperAdmin(requestingUser) && Number(sede.empresa_id) !== Number(requestingUser.empresa_id)) {
    throw new AppError('No tienes acceso a esta sede.', 403);
  }
  return sede;
}

async function crear(requestingUser, body) {
  const empresaId = getEmpresaId(requestingUser, body.empresa_id);
  const nombre    = cleanText(body.nombre);
  const direccion = cleanText(body.direccion);
  const ciudad    = cleanText(body.ciudad);
  const telefono  = cleanText(body.telefono);

  if (!nombre) throw new AppError('El nombre de la sede es obligatorio.', 400);

  const { rows: empresa } = await db.query('SELECT id FROM empresas WHERE id=$1', [empresaId]);
  if (!empresa.length) throw new AppError('Empresa no encontrada.', 404);

  // Verificar límite de sedes del plan
  await assertCanCreateSede(empresaId);

  const { rows } = await db.query(
    `INSERT INTO sedes (empresa_id, nombre, direccion, ciudad, telefono)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, empresa_id, nombre, direccion, ciudad, telefono, activa, creado_en`,
    [empresaId, nombre, direccion, ciudad, telefono]
  );
  return rows[0];
}

async function actualizar(requestingUser, sedeId, body) {
  const sede = await obtener(requestingUser, sedeId);

  const nombre    = cleanText(body.nombre) || sede.nombre;
  const direccion = cleanText(body.direccion);
  const ciudad    = cleanText(body.ciudad);
  const telefono  = cleanText(body.telefono);

  if (!nombre) throw new AppError('El nombre de la sede es obligatorio.', 400);

  const { rows } = await db.query(
    `UPDATE sedes
     SET nombre=$1, direccion=$2, ciudad=$3, telefono=$4
     WHERE id=$5
     RETURNING id, empresa_id, nombre, direccion, ciudad, telefono, activa, creado_en`,
    [nombre, direccion, ciudad, telefono, sedeId]
  );
  return rows[0];
}

async function cambiarEstado(requestingUser, sedeId, activa) {
  const sede = await obtener(requestingUser, sedeId);

  // Verificar límite de sedes al reactivar
  if (activa) {
    await assertCanCreateSede(sede.empresa_id);
  }

  const { rows } = await db.query(
    `UPDATE sedes SET activa=$1 WHERE id=$2
     RETURNING id, empresa_id, nombre, activa`,
    [activa, sedeId]
  );
  return rows[0];
}

module.exports = { listar, obtener, crear, actualizar, cambiarEstado };
