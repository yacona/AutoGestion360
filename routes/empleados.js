// routes/empleados.js
const express = require("express");
const db = require("../db");
const auth = require("../middleware/auth");

const router = express.Router();

/**
 * Rol válido (puedes ajustar esta lista más adelante)
 */
const ROLES_VALIDOS = [
  "Administrador",
  "Cajero",
  "Lavador",
  "Mecánico",
  "Auxiliar",
  "Otro",
];

/**
 * POST /api/empleados
 * Crear empleado
 * Body: { nombre, rol, telefono, email, activo }
 */
router.post("/", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  let { nombre, rol, telefono, email, activo } = req.body;

  if (!nombre || !rol) {
    return res
      .status(400)
      .json({ error: "Nombre y rol son obligatorios para el empleado." });
  }

  // Normalizar datos
  rol = rol.trim();
  if (!ROLES_VALIDOS.includes(rol)) {
    // Permitimos igualmente, pero marcamos advertencia
    console.warn("Rol no listado en ROLES_VALIDOS:", rol);
  }

  try {
    // Verificar duplicado por email (si viene email)
    if (email) {
      const { rows: existentes } = await db.query(
        `SELECT id, nombre, rol, email
         FROM empleados
         WHERE empresa_id = $1 AND email = $2
         LIMIT 1`,
        [empresa_id, email]
      );

      if (existentes.length > 0) {
        return res.status(400).json({
          error: "Ya existe un empleado con ese email en esta empresa.",
          empleado_existente: existentes[0],
        });
      }
    }

    const { rows } = await db.query(
      `INSERT INTO empleados 
       (empresa_id, nombre, rol, telefono, email, activo)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [empresa_id, nombre, rol, telefono, email || null, activo ?? true]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error("Error creando empleado:", err);

    if (err.code === "23505") {
      return res.status(400).json({
        error: "Empleado duplicado (email ya existe para esta empresa).",
      });
    }

    res.status(500).json({ error: "Error creando empleado." });
  }
});

/**
 * GET /api/empleados
 * Lista empleados de la empresa
 * Query opcionales:
 *  - rol=Lavador
 *  - activos=true / false
 */
router.get("/", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { rol, activos } = req.query;

  let condiciones = ["empresa_id = $1"];
  const valores = [empresa_id];
  let idx = 2;

  if (rol) {
    condiciones.push(`rol = $${idx++}`);
    valores.push(rol);
  }

  if (typeof activos !== "undefined") {
    // activos=true / activos=false
    const valorBool = activos === "true";
    condiciones.push(`activo = $${idx++}`);
    valores.push(valorBool);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

  try {
    const { rows } = await db.query(
      `SELECT *
       FROM empleados
       ${where}
       ORDER BY nombre ASC`,
      valores
    );

    res.json(rows);
  } catch (err) {
    console.error("Error listando empleados:", err);
    res.status(500).json({ error: "Error obteniendo empleados." });
  }
});

/**
 * GET /api/empleados/:id
 * Obtener detalle de un empleado
 */
router.get("/:id", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { id } = req.params;

  try {
    const { rows } = await db.query(
      `SELECT *
       FROM empleados
       WHERE empresa_id = $1 AND id = $2
       LIMIT 1`,
      [empresa_id, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Empleado no encontrado." });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Error obteniendo empleado:", err);
    res.status(500).json({ error: "Error obteniendo empleado." });
  }
});

/**
 * PUT /api/empleados/:id
 * Actualizar empleado completo
 * Body: { nombre, rol, telefono, email, activo }
 */
router.put("/:id", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { id } = req.params;
  let { nombre, rol, telefono, email, activo } = req.body;

  if (!nombre || !rol) {
    return res
      .status(400)
      .json({ error: "Nombre y rol son obligatorios para actualizar." });
  }

  rol = rol.trim();

  try {
    // Validar que el empleado exista y pertenezca a la empresa
    const { rows: existe } = await db.query(
      `SELECT * 
       FROM empleados
       WHERE empresa_id = $1 AND id = $2
       LIMIT 1`,
      [empresa_id, id]
    );

    if (existe.length === 0) {
      return res.status(404).json({ error: "Empleado no encontrado." });
    }

    // Si cambia el email, validar duplicado
    if (email) {
      const { rows: dup } = await db.query(
        `SELECT id 
         FROM empleados
         WHERE empresa_id = $1 AND email = $2 AND id <> $3
         LIMIT 1`,
        [empresa_id, email, id]
      );

      if (dup.length > 0) {
        return res.status(400).json({
          error: "Ya existe otro empleado con ese email en esta empresa.",
        });
      }
    }

    const { rows } = await db.query(
      `UPDATE empleados
       SET nombre = $1,
           rol = $2,
           telefono = $3,
           email = $4,
           activo = $5
       WHERE empresa_id = $6 AND id = $7
       RETURNING *`,
      [
        nombre,
        rol,
        telefono,
        email || null,
        typeof activo === "boolean" ? activo : true,
        empresa_id,
        id,
      ]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error("Error actualizando empleado:", err);
    res.status(500).json({ error: "Error actualizando empleado." });
  }
});

/**
 * PATCH /api/empleados/:id/estado
 * Cambiar solo el campo activo
 * Body: { activo: true/false }
 */
router.patch("/:id/estado", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { id } = req.params;
  const { activo } = req.body;

  if (typeof activo === "undefined") {
    return res
      .status(400)
      .json({ error: "Debe enviar el campo 'activo' en el cuerpo." });
  }

  try {
    const { rows } = await db.query(
      `UPDATE empleados
       SET activo = $1
       WHERE empresa_id = $2 AND id = $3
       RETURNING *`,
      [activo, empresa_id, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Empleado no encontrado." });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Error cambiando estado de empleado:", err);
    res.status(500).json({ error: "Error cambiando estado del empleado." });
  }
});

module.exports = router;
