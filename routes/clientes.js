const express = require("express");
const db = require("../db");
const auth = require("../middleware/auth");
const router = express.Router();

/**
 * Crear cliente
 */
router.post("/", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { nombre, documento, telefono, correo } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: "El nombre es obligatorio." });
  }

  try {
    // 1️⃣ Verificar si ya existe un cliente con ese documento en la empresa
    if (documento) {
      const { rows: existentes } = await db.query(
        `SELECT * FROM clientes 
         WHERE empresa_id = $1 AND documento = $2 
         LIMIT 1`,
        [empresa_id, documento]
      );

      if (existentes.length > 0) {
        return res.status(400).json({
          error: "Ya existe un cliente con ese documento en esta empresa.",
          cliente_existente: existentes[0],
        });
      }
    }

    // 2️⃣ Insertar cliente nuevo
    const result = await db.query(
      `INSERT INTO clientes (empresa_id, nombre, documento, telefono, correo)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [empresa_id, nombre, documento, telefono, correo]
    );

    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err);

    // Por si falla por la restricción UNIQUE
    if (err.code === "23505") {
      return res.status(400).json({
        error: "Cliente duplicado (documento ya existe para esta empresa).",
      });
    }

    res.status(500).json({ error: "Error creando cliente." });
  }
});

/**
 * Listar clientes
 */
router.get("/", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;

  try {
    const { rows } = await db.query(
      "SELECT * FROM clientes WHERE empresa_id = $1 ORDER BY id DESC",
      [empresa_id]
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error obteniendo clientes." });
  }
});

module.exports = router;
