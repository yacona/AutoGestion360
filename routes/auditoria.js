// routes/auditoria.js
const express = require("express");
const db = require("../db");
const auth = require("../middleware/auth");

const router = express.Router();

// Función auxiliar para registrar auditoría
async function registrarAuditoria(empresa_id, usuario_id, modulo, accion, tabla, registro_id, datos_antes, datos_despues, razon = null, ip = null) {
  try {
    await db.query(
      `INSERT INTO auditoria 
       (empresa_id, usuario_id, modulo, accion, tabla_afectada, registro_id, datos_antes, datos_despues, razon, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        empresa_id,
        usuario_id,
        modulo,
        accion,
        tabla,
        registro_id,
        datos_antes ? JSON.stringify(datos_antes) : null,
        datos_despues ? JSON.stringify(datos_despues) : null,
        razon,
        ip,
      ]
    );
  } catch (err) {
    console.error("Error registrando auditoría:", err);
  }
}

// GET bitácora de auditoría
router.get("/", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const {
    modulo,
    tabla,
    accion,
    usuario_id,
    limit = 100,
    offset = 0,
  } = req.query;

  let query = `SELECT * FROM auditoria WHERE empresa_id = $1`;
  const params = [empresa_id];
  let paramCount = 2;

  if (modulo) {
    query += ` AND modulo = $${paramCount}`;
    params.push(modulo);
    paramCount++;
  }

  if (tabla) {
    query += ` AND tabla_afectada = $${paramCount}`;
    params.push(tabla);
    paramCount++;
  }

  if (accion) {
    query += ` AND accion = $${paramCount}`;
    params.push(accion);
    paramCount++;
  }

  if (usuario_id) {
    query += ` AND usuario_id = $${paramCount}`;
    params.push(usuario_id);
    paramCount++;
  }

  query += ` ORDER BY creado_en DESC LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`;

  try {
    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("Error obteniendo auditoría:", err);
    res.status(500).json({ error: "Error obteniendo auditoría." });
  }
});

// GET cambios de un registro específico
router.get("/registro/:tabla/:id", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { tabla, id } = req.params;

  try {
    const { rows } = await db.query(
      `SELECT * FROM auditoria 
       WHERE empresa_id = $1 AND tabla_afectada = $2 AND registro_id = $3 
       ORDER BY creado_en DESC`,
      [empresa_id, tabla, id]
    );

    res.json(rows);
  } catch (err) {
    console.error("Error obteniendo cambios:", err);
    res.status(500).json({ error: "Error obteniendo cambios." });
  }
});

module.exports = router;
module.exports.registrarAuditoria = registrarAuditoria;
