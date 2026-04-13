const express = require("express");
const db = require("../db");
const auth = require("../middleware/auth");
const router = express.Router();

/**
 * GET /api/clientes
 * Lista todos los clientes de la empresa con estadísticas básicas.
 */
router.get("/", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { search } = req.query;

  try {
    const params = [empresa_id];
    let query = `
      SELECT
        c.id,
        c.nombre,
        c.documento,
        c.telefono,
        c.correo,
        c.creado_en AS fecha_registro,
        COALESCE(p.total_parqueadero, 0) AS total_parqueadero,
        COALESCE(l.total_lavadero, 0) AS total_lavadero,
        COALESCE(t.total_taller, 0) AS total_taller,
        COALESCE(p.total_parqueadero, 0) + COALESCE(l.total_lavadero, 0) + COALESCE(t.total_taller, 0) AS total_servicios,
        COALESCE(p.ingresos_parqueadero, 0) + COALESCE(l.ingresos_lavadero, 0) + COALESCE(t.ingresos_taller, 0) AS total_gastado
      FROM clientes c
      LEFT JOIN (
        SELECT v.cliente_id,
               COUNT(*) AS total_parqueadero,
               COALESCE(SUM(p.valor_total), 0) AS ingresos_parqueadero
        FROM parqueadero p
        JOIN vehiculos v ON v.id = p.vehiculo_id
        WHERE p.empresa_id = $1
        GROUP BY v.cliente_id
      ) p ON p.cliente_id = c.id
      LEFT JOIN (
        SELECT v.cliente_id,
               COUNT(*) AS total_lavadero,
               COALESCE(SUM(l.precio), 0) AS ingresos_lavadero
        FROM lavadero l
        JOIN vehiculos v ON v.id = l.vehiculo_id
        WHERE l.empresa_id = $1
        GROUP BY v.cliente_id
      ) l ON l.cliente_id = c.id
      LEFT JOIN (
        SELECT v.cliente_id,
               COUNT(*) AS total_taller,
               COALESCE(SUM(t.total_orden), 0) AS ingresos_taller
        FROM taller_ordenes t
        JOIN vehiculos v ON v.id = t.vehiculo_id
        WHERE t.empresa_id = $1
        GROUP BY v.cliente_id
      ) t ON t.cliente_id = c.id
      WHERE c.empresa_id = $1
    `;

    if (search) {
      query += ` AND (UPPER(c.nombre) LIKE UPPER($2) OR c.documento LIKE $2)`;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY c.nombre ASC`;

    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("Error obteniendo clientes:", err);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

/**
 * POST /api/clientes
 * Crear nuevo cliente
 */
router.post("/", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { nombre, documento, telefono, correo } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: "El nombre es obligatorio." });
  }

  try {
    if (documento) {
      const { rows: existing } = await db.query(
        `SELECT id FROM clientes WHERE empresa_id = $1 AND documento = $2`,
        [empresa_id, documento]
      );

      if (existing.length > 0) {
        return res.status(400).json({
          error: "Ya existe un cliente con este documento."
        });
      }
    }

    const { rows } = await db.query(
      `INSERT INTO clientes
       (empresa_id, nombre, documento, telefono, correo)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nombre, documento, telefono, correo, creado_en AS fecha_registro`,
      [empresa_id, nombre, documento || null, telefono || null, correo || null]
    );

    res.status(201).json({
      mensaje: "Cliente creado exitosamente.",
      cliente: rows[0]
    });
  } catch (err) {
    console.error("Error creando cliente:", err);
    res.status(500).json({ error: "Error creando cliente." });
  }
});

/**
 * GET /api/clientes/:id
 * Obtener detalles de un cliente específico
 */
router.get("/:id", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const cliente_id = req.params.id;

  try {
    const { rows } = await db.query(
      `SELECT
         c.id,
         c.nombre,
         c.documento,
         c.telefono,
         c.correo,
         c.creado_en AS fecha_registro,
         COALESCE(p.total_parqueadero, 0) AS total_parqueadero,
         COALESCE(l.total_lavadero, 0) AS total_lavadero,
         COALESCE(t.total_taller, 0) AS total_taller,
         COALESCE(p.ingresos_parqueadero, 0) AS ingresos_parqueadero,
         COALESCE(l.ingresos_lavadero, 0) AS ingresos_lavadero,
         COALESCE(t.ingresos_taller, 0) AS ingresos_taller
       FROM clientes c
       LEFT JOIN (
         SELECT v.cliente_id,
                COUNT(*) AS total_parqueadero,
                COALESCE(SUM(p.valor_total), 0) AS ingresos_parqueadero
         FROM parqueadero p
         JOIN vehiculos v ON v.id = p.vehiculo_id
         WHERE p.empresa_id = $1
         GROUP BY v.cliente_id
       ) p ON p.cliente_id = c.id
       LEFT JOIN (
         SELECT v.cliente_id,
                COUNT(*) AS total_lavadero,
                COALESCE(SUM(l.precio), 0) AS ingresos_lavadero
         FROM lavadero l
         JOIN vehiculos v ON v.id = l.vehiculo_id
         WHERE l.empresa_id = $1
         GROUP BY v.cliente_id
       ) l ON l.cliente_id = c.id
       LEFT JOIN (
         SELECT v.cliente_id,
                COUNT(*) AS total_taller,
                COALESCE(SUM(t.total_orden), 0) AS ingresos_taller
         FROM taller_ordenes t
         JOIN vehiculos v ON v.id = t.vehiculo_id
         WHERE t.empresa_id = $1
         GROUP BY v.cliente_id
       ) t ON t.cliente_id = c.id
       WHERE c.id = $2 AND c.empresa_id = $1
       LIMIT 1`,
      [empresa_id, cliente_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Cliente no encontrado." });
    }

    const cliente = rows[0];

    const { rows: vehiculos } = await db.query(
      `SELECT id, placa, tipo_vehiculo, marca, modelo, color, creado_en AS fecha_registro
       FROM vehiculos
       WHERE cliente_id = $1 AND empresa_id = $2
       ORDER BY creado_en DESC`,
      [cliente_id, empresa_id]
    );

    const { rows: historial } = await db.query(
      `SELECT
         tipo,
         fecha,
         monto,
         placa
       FROM (
         SELECT 'Parqueadero' AS tipo,
                p.hora_salida AS fecha,
                p.valor_total AS monto,
                p.placa
         FROM parqueadero p
         JOIN vehiculos v ON v.id = p.vehiculo_id
         WHERE v.cliente_id = $1 AND p.empresa_id = $2 AND p.hora_salida IS NOT NULL
         UNION ALL
         SELECT 'Lavadero' AS tipo,
                l.hora_fin AS fecha,
                l.precio AS monto,
                l.placa
         FROM lavadero l
         JOIN vehiculos v ON v.id = l.vehiculo_id
         WHERE v.cliente_id = $1 AND l.empresa_id = $2
         UNION ALL
         SELECT 'Taller' AS tipo,
                t.fecha_entrega AS fecha,
                t.total_orden AS monto,
                t.placa
         FROM taller_ordenes t
         JOIN vehiculos v ON v.id = t.vehiculo_id
         WHERE v.cliente_id = $1 AND t.empresa_id = $2
       ) AS historial
       ORDER BY fecha DESC
       LIMIT 10`,
      [cliente_id, empresa_id]
    );

    res.json({
      cliente,
      vehiculos,
      historial,
      estadisticas: {
        total_servicios:
          Number(cliente.total_parqueadero || 0) +
          Number(cliente.total_lavadero || 0) +
          Number(cliente.total_taller || 0),
        total_gastado:
          Number(cliente.ingresos_parqueadero || 0) +
          Number(cliente.ingresos_lavadero || 0) +
          Number(cliente.ingresos_taller || 0),
      },
    });
  } catch (err) {
    console.error("Error obteniendo cliente:", err);
    res.status(500).json({ error: "Error obteniendo cliente." });
  }
});

/**
 * PATCH /api/clientes/:id
 * Actualizar datos de un cliente
 */
router.patch("/:id", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const cliente_id = req.params.id;
  const { nombre, documento, telefono, correo } = req.body;

  try {
    let updateFields = [];
    let params = [cliente_id, empresa_id];
    let paramIndex = 3;

    if (nombre !== undefined) {
      updateFields.push(`nombre = $${paramIndex++}`);
      params.push(nombre);
    }

    if (documento !== undefined) {
      updateFields.push(`documento = $${paramIndex++}`);
      params.push(documento);
    }

    if (telefono !== undefined) {
      updateFields.push(`telefono = $${paramIndex++}`);
      params.push(telefono);
    }

    if (correo !== undefined) {
      updateFields.push(`correo = $${paramIndex++}`);
      params.push(correo);
    }

    if (updateFields.length === 0) {
      return res.json({ mensaje: "No hay cambios para aplicar." });
    }

    const query = `
      UPDATE clientes
      SET ${updateFields.join(", ")}
      WHERE id = $1 AND empresa_id = $2
      RETURNING id, nombre, documento, telefono, correo, creado_en AS fecha_registro
    `;

    const { rows } = await db.query(query, params);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Cliente no encontrado." });
    }

    res.json({
      mensaje: "Cliente actualizado exitosamente.",
      cliente: rows[0],
    });
  } catch (err) {
    console.error("Error actualizando cliente:", err);
    res.status(500).json({ error: "Error actualizando cliente." });
  }
});

/**
 * DELETE /api/clientes/:id
 * Elimina un cliente de la base de datos.
 */
router.delete("/:id", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const cliente_id = req.params.id;

  try {
    const { rows } = await db.query(
      `DELETE FROM clientes
       WHERE id = $1 AND empresa_id = $2
       RETURNING id`,
      [cliente_id, empresa_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Cliente no encontrado." });
    }

    res.json({ mensaje: "Cliente eliminado exitosamente." });
  } catch (err) {
    console.error("Error eliminando cliente:", err);
    res.status(500).json({ error: "Error eliminando cliente." });
  }
});

module.exports = router;
