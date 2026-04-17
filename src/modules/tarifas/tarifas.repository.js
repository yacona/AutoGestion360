const db = require('../../../db');

async function findAllByEmpresa(empresaId) {
  const { rows } = await db.query(
    `SELECT * FROM tarifas WHERE empresa_id=$1 AND activo=TRUE ORDER BY tipo_vehiculo`,
    [empresaId]
  );
  return rows;
}

async function findByTipoVehiculo(empresaId, tipoVehiculo) {
  const { rows } = await db.query(
    `SELECT * FROM tarifas WHERE empresa_id=$1 AND tipo_vehiculo=$2 AND activo=TRUE`,
    [empresaId, tipoVehiculo]
  );
  return rows[0] || null;
}

async function create(empresaId, data) {
  const { rows } = await db.query(
    `INSERT INTO tarifas
     (empresa_id, tipo_vehiculo, tarifa_por_hora, tarifa_minima,
      descuento_prolongada_horas, descuento_prolongada_porcentaje)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [
      empresaId,
      data.tipo_vehiculo,
      data.tarifa_por_hora,
      data.tarifa_minima ?? null,
      data.descuento_prolongada_horas ?? null,
      data.descuento_prolongada_porcentaje ?? null,
    ]
  );
  return rows[0];
}

async function update(id, empresaId, data) {
  const { rows } = await db.query(
    `UPDATE tarifas
     SET tarifa_por_hora              = COALESCE($1, tarifa_por_hora),
         tarifa_minima                = COALESCE($2, tarifa_minima),
         descuento_prolongada_horas   = COALESCE($3, descuento_prolongada_horas),
         descuento_prolongada_porcentaje = COALESCE($4, descuento_prolongada_porcentaje),
         activo                       = COALESCE($5, activo),
         actualizado_en               = NOW()
     WHERE id=$6 AND empresa_id=$7 RETURNING *`,
    [
      data.tarifa_por_hora,
      data.tarifa_minima,
      data.descuento_prolongada_horas,
      data.descuento_prolongada_porcentaje,
      data.activo,
      id,
      empresaId,
    ]
  );
  return rows[0] || null;
}

module.exports = { findAllByEmpresa, findByTipoVehiculo, create, update };
