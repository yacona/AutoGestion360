const db = require('../../../db');

async function getResumenDia(empresaId, fecha) {
  const [totalEntradas, activos, byType] = await Promise.all([
    db.query(
      `SELECT COUNT(*) AS total, SUM(valor_total) AS ingresos
       FROM parqueadero
       WHERE empresa_id=$1 AND DATE(hora_entrada)=$2 AND hora_salida IS NOT NULL`,
      [empresaId, fecha]
    ),
    db.query(
      `SELECT COUNT(*) AS total FROM parqueadero
       WHERE empresa_id=$1 AND DATE(hora_entrada)=$2 AND hora_salida IS NULL`,
      [empresaId, fecha]
    ),
    db.query(
      `SELECT tipo_vehiculo, COUNT(*) AS total, SUM(valor_total) AS ingresos
       FROM parqueadero
       WHERE empresa_id=$1 AND DATE(hora_entrada)=$2 AND hora_salida IS NOT NULL
       GROUP BY tipo_vehiculo`,
      [empresaId, fecha]
    ),
  ]);

  return {
    totalEntradas: totalEntradas.rows[0],
    activos: activos.rows[0],
    byType: byType.rows,
  };
}

async function getResumenPeriodo(empresaId, fechaInicio, fechaFin) {
  const [totales, byDay] = await Promise.all([
    db.query(
      `SELECT COUNT(*) AS total, SUM(valor_total) AS ingresos, AVG(minutos_total) AS tiempo_promedio
       FROM parqueadero
       WHERE empresa_id=$1 AND DATE(hora_entrada)>=$2 AND DATE(hora_entrada)<=$3 AND hora_salida IS NOT NULL`,
      [empresaId, fechaInicio, fechaFin]
    ),
    db.query(
      `SELECT DATE(hora_entrada) AS dia, COUNT(*) AS total, SUM(valor_total) AS ingresos
       FROM parqueadero
       WHERE empresa_id=$1 AND DATE(hora_entrada)>=$2 AND DATE(hora_entrada)<=$3 AND hora_salida IS NOT NULL
       GROUP BY DATE(hora_entrada)
       ORDER BY DATE(hora_entrada)`,
      [empresaId, fechaInicio, fechaFin]
    ),
  ]);

  return { totales: totales.rows[0], byDay: byDay.rows };
}

async function getClientesFrecuentes(empresaId, limit) {
  const { rows } = await db.query(
    `SELECT c.id, c.nombre, c.documento, COUNT(p.id) AS visitas, SUM(p.valor_total) AS ingresos_total
     FROM parqueadero p
     LEFT JOIN clientes c ON c.id=p.cliente_id
     WHERE p.empresa_id=$1
     GROUP BY c.id, c.nombre, c.documento
     ORDER BY visitas DESC
     LIMIT $2`,
    [empresaId, parseInt(limit, 10)]
  );
  return rows;
}

async function getEstadoPago(empresaId) {
  const { rows } = await db.query(
    `SELECT estado_pago, COUNT(*) AS total, SUM(valor_total) AS monto_total
     FROM parqueadero WHERE empresa_id=$1
     GROUP BY estado_pago`,
    [empresaId]
  );
  return rows;
}

async function getOcupancia(empresaId) {
  const [config, ocupados] = await Promise.all([
    db.query(`SELECT capacidad_total FROM configuracion_parqueadero WHERE empresa_id=$1`, [empresaId]),
    db.query(`SELECT COUNT(*) AS ocupados FROM parqueadero WHERE empresa_id=$1 AND hora_salida IS NULL`, [empresaId]),
  ]);
  return {
    capacidad: config.rows[0]?.capacidad_total || 0,
    ocupados: parseInt(ocupados.rows[0]?.ocupados || 0, 10),
  };
}

module.exports = { getResumenDia, getResumenPeriodo, getClientesFrecuentes, getEstadoPago, getOcupancia };
