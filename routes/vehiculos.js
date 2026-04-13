const express = require("express");
const db = require("../db");
const auth = require("../middleware/auth");
const router = express.Router();

/**
 * Crear vehículo
 */
router.post("/", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { cliente_id, placa, tipo, marca, modelo, color, es_propietario } =
    req.body;

  if (!placa || !tipo) {
    return res.status(400).json({ error: "Placa y tipo son obligatorios." });
  }

  const placaNormalizada = placa.toUpperCase().trim();

  try {
    // 1️⃣ Verificar si ya existe un vehículo con esa placa para esa empresa
    const { rows: existentes } = await db.query(
      `SELECT v.*, c.nombre AS cliente_nombre
       FROM vehiculos v
       LEFT JOIN clientes c ON c.id = v.cliente_id
       WHERE v.empresa_id = $1 AND v.placa = $2
       LIMIT 1`,
      [empresa_id, placaNormalizada]
    );

    if (existentes.length > 0) {
      return res.status(400).json({
        error: "Ya existe un vehículo con esa placa en esta empresa.",
        vehiculo_existente: existentes[0],
      });
    }

    // 2️⃣ Insertar vehículo nuevo
    const result = await db.query(
      `INSERT INTO vehiculos 
       (empresa_id, cliente_id, placa, tipo, marca, modelo, color, es_propietario)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        empresa_id,
        cliente_id,
        placaNormalizada,
        tipo,
        marca,
        modelo,
        color,
        es_propietario ?? true,
      ]
    );

    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err);

    // Por si la BD lanza error UNIQUE
    if (err.code === "23505") {
      return res
        .status(400)
        .json({ error: "Esa placa ya está registrada en esta empresa." });
    }

    res.status(500).json({ error: "Error creando vehículo." });
  }
});

/**
 * Buscar vehículo por placa
 */
router.get("/:placa", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const placa = req.params.placa.toUpperCase().trim();

  try {
    const { rows } = await db.query(
      `SELECT v.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono
       FROM vehiculos v
       LEFT JOIN clientes c ON c.id = v.cliente_id
       WHERE v.empresa_id = $1 AND v.placa = $2
       LIMIT 1`,
      [empresa_id, placa]
    );

    if (rows.length === 0) {
      return res.json({ existe: false });
    }

    res.json({
      existe: true,
      vehiculo: rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error consultando vehículo." });
  }
});

module.exports = router;
