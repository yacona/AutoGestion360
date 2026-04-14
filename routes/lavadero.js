// routes/lavadero.js
const express = require("express");
const db = require("../db");
const auth = require("../middleware/auth");

const router = express.Router();

const METODOS_PAGO_VALIDOS = ["EFECTIVO", "TARJETA", "TRANSFERENCIA", "MIXTO", "OTRO"];

/* =========================================================
 * TIPOS DE LAVADO
 * =======================================================*/

/**
 * POST /api/lavadero/tipos
 * Crea un tipo de lavado
 */
router.post("/tipos", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { nombre, precio, descripcion } = req.body;

  if (!nombre || !precio) {
    return res
      .status(400)
      .json({ error: "Nombre y precio son obligatorios." });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO tipos_lavado (empresa_id, nombre, precio_base, descripcion)
       VALUES ($1,$2,$3,$4)
       RETURNING *, precio_base AS precio`,
      [empresa_id, nombre, precio, descripcion || null]
    );
    return res.json(rows[0]);
  } catch (err) {
    console.error("🔥 Error creando tipo de lavado:", err);
    if (err.code === "23505") {
      return res
        .status(400)
        .json({ error: "Ya existe un tipo de lavado con ese nombre." });
    }
    return res.status(500).json({ error: "Error creando tipo de lavado." });
  }
});

/**
 * GET /api/lavadero/tipos
 * Lista tipos de lavado de la empresa
 */
router.get("/tipos", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;

  try {
    const { rows } = await db.query(
      `SELECT *, precio_base AS precio
       FROM tipos_lavado
       WHERE empresa_id = $1
       ORDER BY nombre ASC`,
      [empresa_id]
    );
    return res.json(rows);
  } catch (err) {
    console.error("🔥 Error listando tipos de lavado:", err);
    return res.status(500).json({ error: "Error listando tipos de lavado." });
  }
});

/**
 * PUT /api/lavadero/tipos/:id
 * Actualiza un tipo de lavado
 */
router.put("/tipos/:id", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { id } = req.params;
  const { nombre, precio, descripcion, activo } = req.body;

  if (!nombre || !precio) {
    return res
      .status(400)
      .json({ error: "Nombre y precio son obligatorios." });
  }

  try {
    const { rows } = await db.query(
      `UPDATE tipos_lavado
       SET nombre = $1,
           precio_base = $2,
           descripcion = $3,
           activo = $4
       WHERE empresa_id = $5 AND id = $6
       RETURNING *, precio_base AS precio`,
      [nombre, precio, descripcion || null, !!activo, empresa_id, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Tipo de lavado no encontrado." });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error("🔥 Error actualizando tipo de lavado:", err);
    return res
      .status(500)
      .json({ error: "Error actualizando tipo de lavado." });
  }
});

/* =========================================================
 * ÓRDENES DE LAVADO
 * =======================================================*/

/**
 * POST /api/lavadero
 * Crear orden de lavado
 */
router.post("/", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;

  const {
    placa,
    tipo_lavado_id,
    tipo_lavado,
    precio,
    cliente_id,
    vehiculo_id,
    lavador_id,
    empleado_id,
    observaciones,
    notas,
  } = req.body;

  if (!placa || (!tipo_lavado_id && !tipo_lavado)) {
    return res.status(400).json({
      error: "Placa y tipo de lavado son obligatorios.",
    });
  }

  try {
    let tipoLavadoId = tipo_lavado_id || null;
    let precioFinal = precio || null;

    if (!tipoLavadoId && tipo_lavado) {
      const nombreTipo = String(tipo_lavado).trim().toUpperCase();
      const preciosPorTipo = {
        "BÁSICO": 25000,
        BASICO: 25000,
        COMPLETO: 45000,
        PREMIUM: 65000,
      };

      const { rows: tipos } = await db.query(
        `SELECT id, precio_base
         FROM tipos_lavado
         WHERE empresa_id = $1 AND UPPER(nombre) = $2
         LIMIT 1`,
        [empresa_id, nombreTipo]
      );

      if (tipos.length > 0) {
        tipoLavadoId = tipos[0].id;
        precioFinal = precioFinal || tipos[0].precio_base;
      } else {
        const { rows: creado } = await db.query(
          `INSERT INTO tipos_lavado (empresa_id, nombre, precio_base)
           VALUES ($1, $2, $3)
           RETURNING id, precio_base`,
          [empresa_id, nombreTipo, preciosPorTipo[nombreTipo] || 0]
        );
        tipoLavadoId = creado[0].id;
        precioFinal = precioFinal || creado[0].precio_base;
      }
    }

    if (!precioFinal || Number(precioFinal) <= 0) {
      return res.status(400).json({
        error: "El tipo de lavado no tiene precio configurado.",
      });
    }

    const { rows } = await db.query(
      `INSERT INTO lavadero
       (empresa_id, placa, tipo_lavado_id, precio,
        cliente_id, vehiculo_id, lavador_id, observaciones)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        empresa_id,
        placa,
        tipoLavadoId,
        precioFinal,
        cliente_id || null,
        vehiculo_id || null,
        lavador_id || empleado_id || null,
        observaciones || notas || null,
      ]
    );

    return res.json(rows[0]);
  } catch (err) {
    console.error("🔥 Error creando orden de lavado:", err);
    return res.status(500).json({ error: "Error creando orden de lavado." });
  }
});

/**
 * GET /api/lavadero
 * Lista órdenes de lavado (opcional: ?estado=Pendiente/En_Proceso/Completado)
 */
router.get("/", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { estado } = req.query;

  const params = [empresa_id];
  let where = "l.empresa_id = $1";

  if (estado) {
    params.push(estado);
    where += ` AND l.estado = $${params.length}`;
  }

  try {
    const { rows } = await db.query(
      `SELECT 
         l.*,
         tl.nombre AS tipo_lavado_nombre,
         tl.nombre AS tipo_lavado,
         e.nombre AS lavador_nombre,
         e.nombre AS empleado_nombre
       FROM lavadero l
       LEFT JOIN tipos_lavado tl ON tl.id = l.tipo_lavado_id
       LEFT JOIN empleados e ON e.id = l.lavador_id
       WHERE ${where}
       ORDER BY l.id DESC`,
      params
    );

    return res.json(rows);
  } catch (err) {
    console.error("🔥 Error listando lavados:", err);
    return res.status(500).json({ error: "Error listando lavados." });
  }
});

/**
 * PATCH /api/lavadero/:id
 * Alias simple para el frontend: permite cambiar estado con { estado }.
 */
router.patch("/:id", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { id } = req.params;
  const { estado, metodo_pago, detalle_pago } = req.body || {};

  const estadosValidos = ["Pendiente", "En_Proceso", "Completado"];

  if (!estado || !estadosValidos.includes(estado)) {
    return res.status(400).json({
      error:
        "Estado inválido. Valores permitidos: Pendiente, En_Proceso, Completado",
    });
  }

  if (estado === "Completado" && !metodo_pago) {
    return res.status(400).json({
      error: "Debe registrar el método de pago para completar el lavado.",
    });
  }

  if (metodo_pago && !METODOS_PAGO_VALIDOS.includes(metodo_pago)) {
    return res.status(400).json({
      error: `Método de pago inválido. Opciones válidas: ${METODOS_PAGO_VALIDOS.join(", ")}`,
    });
  }

  try {
    const detalleStr =
      detalle_pago !== undefined && detalle_pago !== null
        ? JSON.stringify(detalle_pago)
        : null;

    const { rows } = await db.query(
      `UPDATE lavadero
       SET estado = $1::varchar,
           hora_fin = CASE
             WHEN $1::text = 'Completado' THEN COALESCE(hora_fin, NOW())
             ELSE hora_fin
           END,
           metodo_pago = COALESCE($2::varchar, metodo_pago),
           detalle_pago = COALESCE($3::jsonb, detalle_pago)
       WHERE empresa_id = $4 AND id = $5
       RETURNING *`,
      [estado, metodo_pago || null, detalleStr, empresa_id, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Lavado no encontrado." });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error("🔥 Error actualizando lavado:", err);
    return res.status(500).json({ error: "Error actualizando lavado." });
  }
});

/**
 * PATCH /api/lavadero/:id/estado
 * Cambiar estado de un lavado
 */
router.patch("/:id/estado", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { id } = req.params;
  const { estado } = req.body;

  const estadosValidos = ["Pendiente", "En_Proceso", "Completado"];

  if (!estado || !estadosValidos.includes(estado)) {
    return res.status(400).json({
      error:
        "Estado inválido. Valores permitidos: Pendiente, En_Proceso, Completado",
    });
  }

  try {
    // Verificar existencia
    const { rows: existe } = await db.query(
      `SELECT * FROM lavadero
       WHERE empresa_id = $1 AND id = $2
       LIMIT 1`,
      [empresa_id, id]
    );

    if (existe.length === 0) {
      return res.status(404).json({ error: "Lavado no encontrado." });
    }

    // Armar UPDATE según estado
    let queryText;
    let params;

    if (estado === "Completado") {
      queryText = `
        UPDATE lavadero
        SET estado = $1,
            hora_fin = NOW()
        WHERE empresa_id = $2 AND id = $3
        RETURNING *`;
      params = [estado, empresa_id, id];
    } else {
      queryText = `
        UPDATE lavadero
        SET estado = $1
        WHERE empresa_id = $2 AND id = $3
        RETURNING *`;
      params = [estado, empresa_id, id];
    }

    const { rows } = await db.query(queryText, params);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Lavado no encontrado al actualizar." });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error("🔥 Error actualizando estado de lavado:", err);
    return res.status(500).json({
      error: "Error actualizando estado.",
      detalle: err.message,
    });
  }
});

/**
 * POST /api/lavadero/:id/pago
 * Registra el método de pago de un lavado
 */
router.post("/:id/pago", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { id } = req.params;
  const { metodo_pago, detalle_pago } = req.body;

  if (!metodo_pago) {
    return res
      .status(400)
      .json({ error: "Debe enviar el campo metodo_pago." });
  }

  if (!METODOS_PAGO_VALIDOS.includes(metodo_pago)) {
    return res.status(400).json({
      error: `Método de pago inválido. Opciones válidas: ${METODOS_PAGO_VALIDOS.join(", ")}`,
    });
  }

  try {
    const detalleStr =
      detalle_pago !== undefined && detalle_pago !== null
        ? JSON.stringify(detalle_pago)
        : null;

    const { rows } = await db.query(
      `UPDATE lavadero
       SET metodo_pago = $1,
           detalle_pago = $2::jsonb
       WHERE empresa_id = $3 AND id = $4
       RETURNING *`,
      [metodo_pago, detalleStr, empresa_id, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Lavado no encontrado." });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error("🔥 Error registrando pago de lavado:", err);
    return res.status(500).json({ error: "Error registrando pago de lavado." });
  }
});

/**
 * GET /api/lavadero/historial
 * Filtros opcionales: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&lavador_id=#
 */
router.get("/historial", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { desde, hasta, lavador_id } = req.query;

  const condiciones = ["l.empresa_id = $1"];
  const params = [empresa_id];
  let idx = 2;

  if (desde) {
    condiciones.push(`l.hora_inicio >= $${idx}`);
    params.push(desde);
    idx++;
  }

  if (hasta) {
    condiciones.push(`l.hora_inicio <= $${idx}`);
    params.push(hasta);
    idx++;
  }

  if (lavador_id) {
    condiciones.push(`l.lavador_id = $${idx}`);
    params.push(lavador_id);
    idx++;
  }

  try {
    const { rows } = await db.query(
      `SELECT 
         l.*,
         tl.nombre AS tipo_lavado_nombre,
         e.nombre AS lavador_nombre
       FROM lavadero l
       LEFT JOIN tipos_lavado tl ON tl.id = l.tipo_lavado_id
       LEFT JOIN empleados e ON e.id = l.lavador_id
       WHERE ${condiciones.join(" AND ")}
       ORDER BY l.id DESC`,
      params
    );

    return res.json(rows);
  } catch (err) {
    console.error("🔥 Error obteniendo historial de lavados:", err);
    return res
      .status(500)
      .json({ error: "Error obteniendo historial de lavados." });
  }
});

/**
 * GET /api/lavadero/:id
 * Obtiene detalles completos de una orden de lavado específica
 */
router.get("/:id", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { id } = req.params;

  try {
    const { rows } = await db.query(
      `SELECT
         l.*,
         tl.nombre AS tipo_lavado_nombre,
         tl.descripcion AS tipo_lavado_descripcion,
         e.nombre AS lavador_nombre,
         v.placa AS vehiculo_placa,
         v.marca,
         v.modelo,
         c.nombre AS cliente_nombre,
         c.telefono AS cliente_telefono
       FROM lavadero l
       LEFT JOIN tipos_lavado tl ON tl.id = l.tipo_lavado_id
       LEFT JOIN empleados e ON e.id = l.lavador_id
       LEFT JOIN vehiculos v ON v.id = l.vehiculo_id
       LEFT JOIN clientes c ON c.id = v.cliente_id
       WHERE l.empresa_id = $1 AND l.id = $2`,
      [empresa_id, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Orden de lavado no encontrada." });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error("🔥 Error obteniendo orden de lavado:", err);
    return res.status(500).json({ error: "Error obteniendo orden de lavado." });
  }
});

/**
 * PATCH /api/lavadero/:id/lavador
 * Asigna o cambia el lavador de una orden
 */
router.patch("/:id/lavador", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { id } = req.params;
  const { lavador_id } = req.body;

  try {
    const { rows } = await db.query(
      `UPDATE lavadero
       SET lavador_id = $1
       WHERE empresa_id = $2 AND id = $3
       RETURNING *`,
      [lavador_id, empresa_id, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Orden de lavado no encontrada." });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error("🔥 Error asignando lavador:", err);
    return res.status(500).json({ error: "Error asignando lavador." });
  }
});

module.exports = router;
