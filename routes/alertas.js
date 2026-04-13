// routes/alertas.js
const express = require("express");
const db = require("../db");
const auth = require("../middleware/auth");

const router = express.Router();

// GET alertas no leídas
router.get("/no-leidas", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;

  try {
    const { rows } = await db.query(
      `SELECT * FROM alertas WHERE empresa_id = $1 AND leida = FALSE ORDER BY creado_en DESC LIMIT 20`,
      [empresa_id]
    );
    res.json(rows);
  } catch (err) {
    console.error("Error obteniendo alertas:", err);
    res.status(500).json({ error: "Error obteniendo alertas." });
  }
});

// GET todas las alertas
router.get("/", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { tipo, limit = 50 } = req.query;

  let query = `SELECT * FROM alertas WHERE empresa_id = $1`;
  const params = [empresa_id];

  if (tipo) {
    query += ` AND tipo = $2`;
    params.push(tipo);
  }

  query += ` ORDER BY creado_en DESC LIMIT ${parseInt(limit)}`;

  try {
    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("Error obteniendo alertas:", err);
    res.status(500).json({ error: "Error obteniendo alertas." });
  }
});

// PATCH marcar como leída
router.patch("/:id/leer", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const id = req.params.id;

  try {
    const { rows } = await db.query(
      `UPDATE alertas SET leida = TRUE WHERE id = $1 AND empresa_id = $2 RETURNING *`,
      [id, empresa_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Alerta no encontrada." });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Error actualizando alerta:", err);
    res.status(500).json({ error: "Error actualizando alerta." });
  }
});

// POST crear alerta
router.post("/", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const {
    tipo,
    parqueadero_id,
    cliente_id,
    titulo,
    descripcion,
  } = req.body;

  if (!tipo || !titulo) {
    return res
      .status(400)
      .json({ error: "Tipo y título son obligatorios." });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO alertas 
       (empresa_id, tipo, parqueadero_id, cliente_id, titulo, descripcion)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [empresa_id, tipo, parqueadero_id || null, cliente_id || null, titulo, descripcion || null]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Error creando alerta:", err);
    res.status(500).json({ error: "Error creando alerta." });
  }
});

module.exports = router;
