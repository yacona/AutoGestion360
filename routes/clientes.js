const express = require("express");
const db = require("../db");
const auth = require("../middleware/auth");
const router = express.Router();

async function tableExists(tableName) {
  const { rows } = await db.query("SELECT to_regclass($1) AS table_name", [`public.${tableName}`]);
  return Boolean(rows[0]?.table_name);
}

function toNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

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
        COALESCE(p.ingresos_parqueadero, 0) + COALESCE(l.ingresos_lavadero, 0) + COALESCE(t.ingresos_taller, 0) AS total_gastado,
        GREATEST(
          COALESCE(p.ultima_parqueadero, c.creado_en),
          COALESCE(l.ultima_lavadero, c.creado_en),
          COALESCE(t.ultima_taller, c.creado_en)
        ) AS ultima_actividad
      FROM clientes c
      LEFT JOIN (
        SELECT COALESCE(p.cliente_id, v.cliente_id) AS cliente_id,
               COUNT(*)::int AS total_parqueadero,
               COALESCE(SUM(p.valor_total), 0) AS ingresos_parqueadero,
               MAX(COALESCE(p.hora_salida, p.hora_entrada, p.creado_en)) AS ultima_parqueadero
        FROM parqueadero p
        LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
        WHERE p.empresa_id = $1
        GROUP BY COALESCE(p.cliente_id, v.cliente_id)
      ) p ON p.cliente_id = c.id
      LEFT JOIN (
        SELECT COALESCE(l.cliente_id, v.cliente_id) AS cliente_id,
               COUNT(*)::int AS total_lavadero,
               COALESCE(SUM(l.precio), 0) AS ingresos_lavadero,
               MAX(COALESCE(l.hora_fin, l.hora_inicio, l.creado_en)) AS ultima_lavadero
        FROM lavadero l
        LEFT JOIN vehiculos v ON v.id = l.vehiculo_id
        WHERE l.empresa_id = $1
        GROUP BY COALESCE(l.cliente_id, v.cliente_id)
      ) l ON l.cliente_id = c.id
      LEFT JOIN (
        SELECT COALESCE(t.cliente_id, v.cliente_id) AS cliente_id,
               COUNT(*)::int AS total_taller,
               COALESCE(SUM(t.total_orden), 0) AS ingresos_taller,
               MAX(COALESCE(t.fecha_entrega, t.fecha_creacion)) AS ultima_taller
        FROM taller_ordenes t
        LEFT JOIN vehiculos v ON v.id = t.vehiculo_id
        WHERE t.empresa_id = $1
        GROUP BY COALESCE(t.cliente_id, v.cliente_id)
      ) t ON t.cliente_id = c.id
      WHERE c.empresa_id = $1
    `;

    if (search) {
      query += ` AND (UPPER(c.nombre) LIKE UPPER($2) OR c.documento LIKE $2)`;
      params.push(`%${search}%`);
    }

    query += ` ORDER BY ultima_actividad DESC NULLS LAST, c.nombre ASC`;

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
         COALESCE(t.ingresos_taller, 0) AS ingresos_taller,
         GREATEST(
           COALESCE(p.ultima_parqueadero, c.creado_en),
           COALESCE(l.ultima_lavadero, c.creado_en),
           COALESCE(t.ultima_taller, c.creado_en)
         ) AS ultima_actividad
       FROM clientes c
       LEFT JOIN (
         SELECT COALESCE(p.cliente_id, v.cliente_id) AS cliente_id,
                COUNT(*)::int AS total_parqueadero,
                COALESCE(SUM(p.valor_total), 0) AS ingresos_parqueadero,
                MAX(COALESCE(p.hora_salida, p.hora_entrada, p.creado_en)) AS ultima_parqueadero
         FROM parqueadero p
         LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
         WHERE p.empresa_id = $1
         GROUP BY COALESCE(p.cliente_id, v.cliente_id)
       ) p ON p.cliente_id = c.id
       LEFT JOIN (
         SELECT COALESCE(l.cliente_id, v.cliente_id) AS cliente_id,
                COUNT(*)::int AS total_lavadero,
                COALESCE(SUM(l.precio), 0) AS ingresos_lavadero,
                MAX(COALESCE(l.hora_fin, l.hora_inicio, l.creado_en)) AS ultima_lavadero
         FROM lavadero l
         LEFT JOIN vehiculos v ON v.id = l.vehiculo_id
         WHERE l.empresa_id = $1
         GROUP BY COALESCE(l.cliente_id, v.cliente_id)
       ) l ON l.cliente_id = c.id
       LEFT JOIN (
         SELECT COALESCE(t.cliente_id, v.cliente_id) AS cliente_id,
                COUNT(*)::int AS total_taller,
                COALESCE(SUM(t.total_orden), 0) AS ingresos_taller,
                MAX(COALESCE(t.fecha_entrega, t.fecha_creacion)) AS ultima_taller
         FROM taller_ordenes t
         LEFT JOIN vehiculos v ON v.id = t.vehiculo_id
         WHERE t.empresa_id = $1
         GROUP BY COALESCE(t.cliente_id, v.cliente_id)
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
      `SELECT
         v.id,
         v.placa,
         v.tipo_vehiculo,
         v.marca,
         v.modelo,
         v.color,
         v.creado_en AS fecha_registro,
         COALESCE(p.total_parqueadero, 0) AS total_parqueadero,
         COALESCE(l.total_lavadero, 0) AS total_lavadero,
         COALESCE(t.total_taller, 0) AS total_taller,
         COALESCE(p.total_parqueadero, 0) + COALESCE(l.total_lavadero, 0) + COALESCE(t.total_taller, 0) AS total_servicios,
         COALESCE(p.ingresos_parqueadero, 0) + COALESCE(l.ingresos_lavadero, 0) + COALESCE(t.ingresos_taller, 0) AS total_gastado,
         GREATEST(
           COALESCE(p.ultima_parqueadero, v.creado_en),
           COALESCE(l.ultima_lavadero, v.creado_en),
           COALESCE(t.ultima_taller, v.creado_en)
         ) AS ultima_actividad
       FROM vehiculos v
       LEFT JOIN (
         SELECT vehiculo_id,
                COUNT(*)::int AS total_parqueadero,
                COALESCE(SUM(valor_total), 0) AS ingresos_parqueadero,
                MAX(COALESCE(hora_salida, hora_entrada, creado_en)) AS ultima_parqueadero
         FROM parqueadero
         WHERE empresa_id = $2
         GROUP BY vehiculo_id
       ) p ON p.vehiculo_id = v.id
       LEFT JOIN (
         SELECT vehiculo_id,
                COUNT(*)::int AS total_lavadero,
                COALESCE(SUM(precio), 0) AS ingresos_lavadero,
                MAX(COALESCE(hora_fin, hora_inicio, creado_en)) AS ultima_lavadero
         FROM lavadero
         WHERE empresa_id = $2
         GROUP BY vehiculo_id
       ) l ON l.vehiculo_id = v.id
       LEFT JOIN (
         SELECT vehiculo_id,
                COUNT(*)::int AS total_taller,
                COALESCE(SUM(total_orden), 0) AS ingresos_taller,
                MAX(COALESCE(fecha_entrega, fecha_creacion)) AS ultima_taller
         FROM taller_ordenes
         WHERE empresa_id = $2
         GROUP BY vehiculo_id
       ) t ON t.vehiculo_id = v.id
       WHERE v.cliente_id = $1 AND v.empresa_id = $2
       ORDER BY ultima_actividad DESC NULLS LAST, v.creado_en DESC`,
      [cliente_id, empresa_id]
    );

    const { rows: historial } = await db.query(
      `SELECT
         referencia_id,
         tipo,
         fecha,
         monto,
         placa,
         estado,
         metodo_pago,
         detalle
       FROM (
         SELECT p.id AS referencia_id,
                'Parqueadero' AS tipo,
                p.hora_salida AS fecha,
                p.valor_total AS monto,
                p.placa,
                COALESCE(p.estado_pago, 'CERRADO') AS estado,
                p.metodo_pago,
                p.tipo_servicio AS detalle
         FROM parqueadero p
         LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
         WHERE COALESCE(p.cliente_id, v.cliente_id) = $1
           AND p.empresa_id = $2
           AND p.hora_salida IS NOT NULL
         UNION ALL
         SELECT l.id AS referencia_id,
                'Lavadero' AS tipo,
                COALESCE(l.hora_fin, l.hora_inicio) AS fecha,
                l.precio AS monto,
                l.placa,
                l.estado,
                l.metodo_pago,
                'Servicio de lavado' AS detalle
         FROM lavadero l
         LEFT JOIN vehiculos v ON v.id = l.vehiculo_id
         WHERE COALESCE(l.cliente_id, v.cliente_id) = $1
           AND l.empresa_id = $2
         UNION ALL
         SELECT t.id AS referencia_id,
                'Taller' AS tipo,
                COALESCE(t.fecha_entrega, t.fecha_creacion) AS fecha,
                t.total_orden AS monto,
                t.placa,
                t.estado,
                t.metodo_pago,
                COALESCE(t.descripcion_falla, 'Orden de taller') AS detalle
         FROM taller_ordenes t
         LEFT JOIN vehiculos v ON v.id = t.vehiculo_id
         WHERE COALESCE(t.cliente_id, v.cliente_id) = $1
           AND t.empresa_id = $2
       ) AS historial
       ORDER BY fecha DESC NULLS LAST
       LIMIT 25`,
      [cliente_id, empresa_id]
    );

    let mensualidades = [];
    if (await tableExists("mensualidades_parqueadero")) {
      const { rows: mensualidadesRows } = await db.query(
        `SELECT
           mp.*,
           COUNT(p.id)::int AS ingresos_registrados,
           MAX(p.hora_entrada) AS ultimo_ingreso
         FROM mensualidades_parqueadero mp
         LEFT JOIN parqueadero p
           ON p.mensualidad_id = mp.id
          AND p.empresa_id = mp.empresa_id
         WHERE mp.empresa_id = $2
           AND (
             mp.cliente_id = $1
             OR ($3::text IS NOT NULL AND mp.documento = $3::text)
           )
         GROUP BY mp.id
         ORDER BY
           CASE WHEN mp.estado = 'ACTIVA' THEN 0 ELSE 1 END,
           mp.fecha_fin DESC,
           mp.creado_en DESC`,
        [cliente_id, empresa_id, cliente.documento || null]
      );
      mensualidades = mensualidadesRows;
    }

    const totalParqueadero = toNumber(cliente.total_parqueadero);
    const totalLavadero = toNumber(cliente.total_lavadero);
    const totalTaller = toNumber(cliente.total_taller);
    const ingresosParqueadero = toNumber(cliente.ingresos_parqueadero);
    const ingresosLavadero = toNumber(cliente.ingresos_lavadero);
    const ingresosTaller = toNumber(cliente.ingresos_taller);
    const mensualidadesActivas = mensualidades.filter((mensualidad) => {
      const activa = mensualidad.estado === "ACTIVA";
      const vigente = !mensualidad.fecha_fin || new Date(mensualidad.fecha_fin) >= new Date();
      return activa && vigente;
    }).length;

    res.json({
      cliente,
      vehiculos,
      historial,
      mensualidades,
      estadisticas: {
        total_servicios: totalParqueadero + totalLavadero + totalTaller,
        total_gastado: ingresosParqueadero + ingresosLavadero + ingresosTaller,
        vehiculos_total: vehiculos.length,
        mensualidades_total: mensualidades.length,
        mensualidades_activas: mensualidadesActivas,
        ultima_visita: cliente.ultima_actividad || historial[0]?.fecha || null,
        modulos: {
          parqueadero: {
            servicios: totalParqueadero,
            ingresos: ingresosParqueadero,
          },
          lavadero: {
            servicios: totalLavadero,
            ingresos: ingresosLavadero,
          },
          taller: {
            servicios: totalTaller,
            ingresos: ingresosTaller,
          },
        },
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
