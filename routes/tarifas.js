// routes/tarifas.js
const express = require("express");
const db = require("../db");
const auth = require("../middleware/auth");

const router = express.Router();

// GET tarifas vigentes de una empresa
router.get("/", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;

  try {
    const { rows } = await db.query(
      `SELECT * FROM tarifas WHERE empresa_id = $1 AND activo = TRUE ORDER BY tipo_vehiculo`,
      [empresa_id]
    );
    res.json(rows);
  } catch (err) {
    console.error("Error obteniendo tarifas:", err);
    res.status(500).json({ error: "Error obteniendo tarifas." });
  }
});

// GET tarifa específica por tipo de vehículo
router.get("/tipo/:tipo_vehiculo", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const tipo_vehiculo = req.params.tipo_vehiculo.toUpperCase();

  try {
    const { rows } = await db.query(
      `SELECT * FROM tarifas WHERE empresa_id = $1 AND tipo_vehiculo = $2 AND activo = TRUE`,
      [empresa_id, tipo_vehiculo]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Tarifa no encontrada." });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Error obteniendo tarifa:", err);
    res.status(500).json({ error: "Error obteniendo tarifa." });
  }
});

// POST crear tarifa
router.post("/", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const {
    tipo_vehiculo,
    tarifa_por_hora,
    tarifa_minima,
    descuento_prolongada_horas,
    descuento_prolongada_porcentaje,
  } = req.body;

  if (!tipo_vehiculo || !tarifa_por_hora) {
    return res
      .status(400)
      .json({ error: "Tipo de vehículo y tarifa son obligatorios." });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO tarifas 
       (empresa_id, tipo_vehiculo, tarifa_por_hora, tarifa_minima, descuento_prolongada_horas, descuento_prolongada_porcentaje)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        empresa_id,
        tipo_vehiculo.toUpperCase(),
        tarifa_por_hora,
        tarifa_minima || null,
        descuento_prolongada_horas || null,
        descuento_prolongada_porcentaje || null,
      ]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res
        .status(400)
        .json({ error: "Ya existe tarifa para ese tipo de vehículo." });
    }
    console.error("Error creando tarifa:", err);
    res.status(500).json({ error: "Error creando tarifa." });
  }
});

// PATCH actualizar tarifa
router.patch("/:id", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const id = req.params.id;
  const {
    tarifa_por_hora,
    tarifa_minima,
    descuento_prolongada_horas,
    descuento_prolongada_porcentaje,
    activo,
  } = req.body;

  try {
    const { rows } = await db.query(
      `UPDATE tarifas 
       SET tarifa_por_hora = COALESCE($1, tarifa_por_hora),
           tarifa_minima = COALESCE($2, tarifa_minima),
           descuento_prolongada_horas = COALESCE($3, descuento_prolongada_horas),
           descuento_prolongada_porcentaje = COALESCE($4, descuento_prolongada_porcentaje),
           activo = COALESCE($5, activo),
           actualizado_en = NOW()
       WHERE id = $6 AND empresa_id = $7
       RETURNING *`,
      [
        tarifa_por_hora,
        tarifa_minima,
        descuento_prolongada_horas,
        descuento_prolongada_porcentaje,
        activo,
        id,
        empresa_id,
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Tarifa no encontrada." });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Error actualizando tarifa:", err);
    res.status(500).json({ error: "Error actualizando tarifa." });
  }
});

module.exports = router;
