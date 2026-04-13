// routes/reportes-parqueadero.js
const express = require("express");
const db = require("../db");
const auth = require("../middleware/auth");

const router = express.Router();

// GET resumen del día
router.get("/resumen-dia", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { fecha } = req.query;
  const fecha_consulta = fecha || new Date().toISOString().split("T")[0];

  try {
    const { rows: totalEntradas } = await db.query(
      `SELECT COUNT(*) as total, SUM(valor_total) as ingresos 
       FROM parqueadero 
       WHERE empresa_id = $1 AND DATE(hora_entrada) = $2 AND hora_salida IS NOT NULL`,
      [empresa_id, fecha_consulta]
    );

    const { rows: activos } = await db.query(
      `SELECT COUNT(*) as total FROM parqueadero 
       WHERE empresa_id = $1 AND DATE(hora_entrada) = $2 AND hora_salida IS NULL`,
      [empresa_id, fecha_consulta]
    );

    const { rows: byType } = await db.query(
      `SELECT tipo_vehiculo, COUNT(*) as total, SUM(valor_total) as ingresos 
       FROM parqueadero 
       WHERE empresa_id = $1 AND DATE(hora_entrada) = $2 AND hora_salida IS NOT NULL
       GROUP BY tipo_vehiculo`,
      [empresa_id, fecha_consulta]
    );

    res.json({
      fecha: fecha_consulta,
      entradas_completadas: parseInt(totalEntradas[0]?.total || 0),
      ingresos_totales: parseFloat(totalEntradas[0]?.ingresos || 0),
      vehiculos_activos: parseInt(activos[0]?.total || 0),
      por_tipo_vehiculo: byType,
    });
  } catch (err) {
    console.error("Error obteniendo resumen:", err);
    res.status(500).json({ error: "Error obteniendo resumen." });
  }
});

// GET resumen por período
router.get("/resumen-periodo", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { fecha_inicio, fecha_fin } = req.query;

  if (!fecha_inicio || !fecha_fin) {
    return res
      .status(400)
      .json({ error: "fecha_inicio y fecha_fin son obligatorios." });
  }

  try {
    const { rows: totalEntradas } = await db.query(
      `SELECT COUNT(*) as total, SUM(valor_total) as ingresos, AVG(minutos_total) as tiempo_promedio
       FROM parqueadero 
       WHERE empresa_id = $1 AND DATE(hora_entrada) >= $2 AND DATE(hora_entrada) <= $3 AND hora_salida IS NOT NULL`,
      [empresa_id, fecha_inicio, fecha_fin]
    );

    const { rows: byDay } = await db.query(
      `SELECT DATE(hora_entrada) as dia, COUNT(*) as total, SUM(valor_total) as ingresos
       FROM parqueadero 
       WHERE empresa_id = $1 AND DATE(hora_entrada) >= $2 AND DATE(hora_entrada) <= $3 AND hora_salida IS NOT NULL
       GROUP BY DATE(hora_entrada)
       ORDER BY DATE(hora_entrada)`,
      [empresa_id, fecha_inicio, fecha_fin]
    );

    res.json({
      periodo: { desde: fecha_inicio, hasta: fecha_fin },
      resumen: totalEntradas[0],
      por_dia: byDay,
    });
  } catch (err) {
    console.error("Error obteniendo resumen período:", err);
    res.status(500).json({ error: "Error obteniendo resumen período." });
  }
});

// GET clientes más frecuentes
router.get("/clientes-frecuentes", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { limit = 10 } = req.query;

  try {
    const { rows } = await db.query(
      `SELECT c.id, c.nombre, c.documento, COUNT(p.id) as visitas, SUM(p.valor_total) as ingresos_total
       FROM parqueadero p
       LEFT JOIN clientes c ON c.id = p.cliente_id
       WHERE p.empresa_id = $1
       GROUP BY c.id, c.nombre, c.documento
       ORDER BY visitas DESC
       LIMIT ${parseInt(limit)}`,
      [empresa_id]
    );

    res.json(rows);
  } catch (err) {
    console.error("Error obteniendo clientes frecuentes:", err);
    res.status(500).json({ error: "Error obteniendo clientes frecuentes." });
  }
});

// GET estado de pago
router.get("/estado-pago", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;

  try {
    const { rows } = await db.query(
      `SELECT estado_pago, COUNT(*) as total, SUM(valor_total) as monto_total
       FROM parqueadero 
       WHERE empresa_id = $1
       GROUP BY estado_pago`,
      [empresa_id]
    );

    res.json(rows);
  } catch (err) {
    console.error("Error obteniendo estado de pago:", err);
    res.status(500).json({ error: "Error obteniendo estado de pago." });
  }
});

// GET ocupancia del día
router.get("/ocupancia", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;

  try {
    const { rows: config } = await db.query(
      `SELECT capacidad_total FROM configuracion_parqueadero WHERE empresa_id = $1`,
      [empresa_id]
    );

    const { rows: ocupados } = await db.query(
      `SELECT COUNT(*) as ocupados FROM parqueadero 
       WHERE empresa_id = $1 AND hora_salida IS NULL`,
      [empresa_id]
    );

    const capacidad = config[0]?.capacidad_total || 0;
    const ocupacion = parseInt(ocupados[0]?.ocupados || 0);

    res.json({
      capacidad_total: capacidad,
      espacios_ocupados: ocupacion,
      espacios_disponibles: Math.max(0, capacidad - ocupacion),
      porcentaje_ocupacion: capacidad > 0 ? ((ocupacion / capacidad) * 100).toFixed(2) : 0,
    });
  } catch (err) {
    console.error("Error obteniendo ocupancia:", err);
    res.status(500).json({ error: "Error obteniendo ocupancia." });
  }
});

module.exports = router;
