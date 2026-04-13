// routes/pagos.js
const express = require("express");
const db = require("../db");
const auth = require("../middleware/auth");

const router = express.Router();

// GET pagos de un parqueadero
router.get("/parqueadero/:parqueadero_id", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const parqueadero_id = req.params.parqueadero_id;

  try {
    const { rows } = await db.query(
      `SELECT * FROM pagos_parqueadero WHERE parqueadero_id = $1 AND empresa_id = $2 ORDER BY creado_en DESC`,
      [parqueadero_id, empresa_id]
    );

    res.json(rows);
  } catch (err) {
    console.error("Error obteniendo pagos:", err);
    res.status(500).json({ error: "Error obteniendo pagos." });
  }
});

// GET pagos pendientes
router.get("/pendientes/listado", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;

  try {
    const { rows } = await db.query(
      `SELECT pp.*, p.placa, c.nombre 
       FROM pagos_parqueadero pp
       JOIN parqueadero p ON p.id = pp.parqueadero_id
       LEFT JOIN clientes c ON c.id = p.cliente_id
       WHERE pp.empresa_id = $1 AND pp.estado = 'PENDIENTE'
       ORDER BY pp.creado_en DESC`,
      [empresa_id]
    );

    res.json(rows);
  } catch (err) {
    console.error("Error obteniendo pagos pendientes:", err);
    res.status(500).json({ error: "Error obteniendo pagos pendientes." });
  }
});

// POST registrar pago
router.post("/", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const usuario_id = req.user.id;
  const {
    parqueadero_id,
    monto,
    metodo_pago,
    referencia_transaccion,
    estado,
  } = req.body;

  if (!parqueadero_id || !monto) {
    return res
      .status(400)
      .json({ error: "Parqueadero e monto son obligatorios." });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO pagos_parqueadero 
       (empresa_id, parqueadero_id, monto, metodo_pago, referencia_transaccion, estado, usuario_registro_id, fecha_pago)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING *`,
      [
        empresa_id,
        parqueadero_id,
        monto,
        metodo_pago || null,
        referencia_transaccion || null,
        estado || "PAGADO",
        usuario_id,
      ]
    );

    // Actualizar estado de pago en parqueadero
    await db.query(
      `UPDATE parqueadero SET estado_pago = 'PAGADO' WHERE id = $1 AND empresa_id = $2`,
      [parqueadero_id, empresa_id]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Error registrando pago:", err);
    res.status(500).json({ error: "Error registrando pago." });
  }
});

// PATCH actualizar estado de pago
router.patch("/:id", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const id = req.params.id;
  const { estado } = req.body;

  try {
    const { rows } = await db.query(
      `UPDATE pagos_parqueadero SET estado = $1 WHERE id = $2 AND empresa_id = $3 RETURNING *`,
      [estado, id, empresa_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Pago no encontrado." });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Error actualizando pago:", err);
    res.status(500).json({ error: "Error actualizando pago." });
  }
});

module.exports = router;
