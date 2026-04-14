// routes/taller.js
const express = require("express");
const db = require("../db");
const auth = require("../middleware/auth");

const router = express.Router();

const ESTADOS_OT = ["Diagnóstico", "Diagnostico", "En_Reparacion", "Listo", "Entregado"];
const METODOS_PAGO_VALIDOS = ["EFECTIVO", "TARJETA", "TRANSFERENCIA", "MIXTO", "OTRO"];

/**
 * Helper: calcular totales de una orden con base en sus ítems
 */
async function recalcularTotalesOrden(orden_id) {
  const { rows } = await db.query(
    `SELECT total_linea, tipo_item
     FROM taller_items
     WHERE orden_id = $1`,
    [orden_id]
  );

  let total_mano_obra = 0;
  let total_repuestos = 0;

  for (const item of rows) {
    if (item.tipo_item === "Servicio") {
      total_mano_obra += Number(item.total_linea) || 0;
    } else if (item.tipo_item === "Repuesto") {
      total_repuestos += Number(item.total_linea) || 0;
    }
  }

  const total_general = total_mano_obra + total_repuestos;

  await db.query(
    `UPDATE taller_ordenes
     SET total_orden = $1
     WHERE id = $2`,
    [total_general, orden_id]
  );
}

/**
 * POST /api/taller
 * Crear una nueva Orden de Taller (OT)
 * Body: { placa, descripcion_falla, cliente_id, vehiculo_id, mecanico_id, observaciones }
 */
router.post("/", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const {
    placa,
    descripcion_falla,
    descripcion,
    cliente_id,
    vehiculo_id,
    mecanico_id,
    empleado_id,
    total_orden,
    total_general,
    observaciones,
    notas,
  } = req.body;

  const descripcionFinal = descripcion_falla || descripcion;
  const mecanicoFinal = mecanico_id || empleado_id || null;
  const totalFinal = total_orden ?? total_general ?? 0;
  if (!placa || !descripcionFinal) {
    return res.status(400).json({
      error: "Placa y descripción de la falla son obligatorias.",
    });
  }

  try {
    // 1️⃣ Generar numero_orden consecutivo por empresa
    const { rows: maxRow } = await db.query(
      `SELECT COALESCE(MAX(numero_orden::bigint), 0) + 1 AS siguiente
       FROM taller_ordenes
       WHERE empresa_id = $1`,
      [empresa_id]
    );
    const numero_orden = maxRow[0].siguiente;

    // 2️⃣ Insertar OT
    const { rows } = await db.query(
      `INSERT INTO taller_ordenes
       (empresa_id, numero_orden, placa, descripcion_falla,
        cliente_id, vehiculo_id, mecanico_id, total_orden)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *, descripcion_falla AS descripcion, total_orden AS total_general`,
      [
        empresa_id,
        numero_orden,
        placa.toUpperCase().trim(),
        descripcionFinal,
        cliente_id || null,
        vehiculo_id || null,
        mecanicoFinal,
        totalFinal,
      ]
    );

    return res.json(rows[0]);
  } catch (err) {
    console.error("🔥 Error creando orden de taller:", err);
    return res
      .status(500)
      .json({ error: "Error creando orden de taller." });
  }
});

/**
 * GET /api/taller
 * Listar órdenes de taller
 * Query opcionales:
 *  - estado=Diagnostico|En_Reparacion|Listo|Entregado
 *  - placa=ABC123
 */
router.get("/", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { estado, placa } = req.query;

  const condiciones = ["ot.empresa_id = $1"];
  const params = [empresa_id];
  let idx = 2;

  if (estado) {
    condiciones.push(`ot.estado = $${idx}`);
    params.push(estado);
    idx++;
  }

  if (placa) {
    condiciones.push(`ot.placa = $${idx}`);
    params.push(placa.toUpperCase().trim());
    idx++;
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

  try {
    const { rows } = await db.query(
      `SELECT 
         ot.*,
         ot.descripcion_falla AS descripcion,
         ot.total_orden AS total_general,
         c.nombre AS cliente_nombre,
         e.nombre AS mecanico_nombre,
         e.nombre AS empleado_nombre
       FROM ordenes_taller ot
       LEFT JOIN clientes c ON c.id = ot.cliente_id
       LEFT JOIN empleados e ON e.id = ot.mecanico_id
       ${where}
       ORDER BY ot.fecha_creacion DESC`,
      params
    );

    return res.json(rows);
  } catch (err) {
    console.error("🔥 Error listando órdenes de taller:", err);
    return res
      .status(500)
      .json({ error: "Error listando órdenes de taller." });
  }
});

/**
 * GET /api/taller/historial/filter
 * Filtros opcionales: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&estado=&mecanico_id=
 */
router.get("/historial/filter", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { desde, hasta, estado, mecanico_id } = req.query;

  const condiciones = ["ot.empresa_id = $1"];
  const params = [empresa_id];
  let idx = 2;

  if (desde) {
    condiciones.push(`ot.fecha_creacion >= $${idx}`);
    params.push(desde);
    idx++;
  }

  if (hasta) {
    condiciones.push(`ot.fecha_creacion <= $${idx}`);
    params.push(hasta);
    idx++;
  }

  if (estado) {
    condiciones.push(`ot.estado = $${idx}`);
    params.push(estado);
    idx++;
  }

  if (mecanico_id) {
    condiciones.push(`ot.mecanico_id = $${idx}`);
    params.push(mecanico_id);
    idx++;
  }

  try {
    const { rows } = await db.query(
      `SELECT
         ot.*,
         ot.descripcion_falla AS descripcion,
         ot.total_orden AS total_general,
         c.nombre AS cliente_nombre,
         e.nombre AS mecanico_nombre,
         e.nombre AS empleado_nombre
       FROM ordenes_taller ot
       LEFT JOIN clientes c ON c.id = ot.cliente_id
       LEFT JOIN empleados e ON e.id = ot.mecanico_id
       WHERE ${condiciones.join(" AND ")}
       ORDER BY ot.fecha_creacion DESC`,
      params
    );

    return res.json(rows);
  } catch (err) {
    console.error("🔥 Error obteniendo historial OT:", err);
    return res
      .status(500)
      .json({ error: "Error obteniendo historial de órdenes de taller." });
  }
});

/**
 * GET /api/taller/:id
 * Obtener detalle de una OT, incluyendo ítems
 */
router.get("/:id", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { id } = req.params;

  try {
    const { rows: otRows } = await db.query(
      `SELECT 
         ot.*,
         ot.descripcion_falla AS descripcion,
         ot.total_orden AS total_general,
         c.nombre AS cliente_nombre,
         e.nombre AS mecanico_nombre,
         e.nombre AS empleado_nombre
       FROM ordenes_taller ot
       LEFT JOIN clientes c ON c.id = ot.cliente_id
       LEFT JOIN empleados e ON e.id = ot.mecanico_id
       WHERE ot.empresa_id = $1 AND ot.id = $2
       LIMIT 1`,
      [empresa_id, id]
    );

    if (otRows.length === 0) {
      return res.status(404).json({ error: "Orden de taller no encontrada." });
    }

    const { rows: items } = await db.query(
      `SELECT *
       FROM taller_items
       WHERE orden_id = $1
       ORDER BY id ASC`,
      [id]
    );

    return res.json({
      orden: otRows[0],
      items,
    });
  } catch (err) {
    console.error("🔥 Error obteniendo orden de taller:", err);
    return res
      .status(500)
      .json({ error: "Error obteniendo orden de taller." });
  }
});

/**
 * PATCH /api/taller/:id/estado
 * Cambiar estado: Diagnostico, En_Reparacion, Listo, Entregado
 */
router.patch("/:id/estado", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { id } = req.params;
  const { estado } = req.body;

  if (!estado || !ESTADOS_OT.includes(estado)) {
    return res.status(400).json({
      error:
        "Estado inválido. Valores permitidos: Diagnostico, En_Reparacion, Listo, Entregado",
    });
  }

  try {
    let queryText = `
      UPDATE ordenes_taller
      SET estado = $1
      WHERE empresa_id = $2 AND id = $3
      RETURNING *, descripcion_falla AS descripcion, total_orden AS total_general`;
    const params = [estado, empresa_id, id];

    if (estado === "Entregado") {
      queryText = `
        UPDATE ordenes_taller
        SET estado = $1,
            fecha_entrega = NOW()
        WHERE empresa_id = $2 AND id = $3
        RETURNING *, descripcion_falla AS descripcion, total_orden AS total_general`;
    }

    const { rows } = await db.query(queryText, params);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Orden de taller no encontrada." });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error("🔥 Error cambiando estado de OT:", err);
    return res.status(500).json({ error: "Error cambiando estado de OT." });
  }
});

/**
 * PATCH /api/taller/:id
 * Alias simple para el frontend: permite cambiar estado con { estado }.
 */
router.patch("/:id", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { id } = req.params;
  const { estado, metodo_pago, detalle_pago } = req.body || {};

  if (!estado || !ESTADOS_OT.includes(estado)) {
    return res.status(400).json({
      error:
        "Estado inválido. Valores permitidos: Diagnostico, En_Reparacion, Listo, Entregado",
    });
  }

  if (estado === "Entregado" && !metodo_pago) {
    return res.status(400).json({
      error: "Debe registrar el método de pago para entregar la orden.",
    });
  }

  if (metodo_pago && !METODOS_PAGO_VALIDOS.includes(metodo_pago)) {
    return res.status(400).json({
      error: `Método de pago inválido. Opciones válidas: ${METODOS_PAGO_VALIDOS.join(", ")}`,
    });
  }

  try {
    const entregar = estado === "Entregado";
    const detalleStr =
      detalle_pago !== undefined && detalle_pago !== null
        ? JSON.stringify(detalle_pago)
        : null;

    const { rows } = await db.query(
      `UPDATE ordenes_taller
       SET estado = $1,
           fecha_entrega = CASE WHEN $2 THEN COALESCE(fecha_entrega, NOW()) ELSE fecha_entrega END,
           metodo_pago = COALESCE($3, metodo_pago),
           detalle_pago = COALESCE($4::jsonb, detalle_pago)
       WHERE empresa_id = $5 AND id = $6
       RETURNING *, descripcion_falla AS descripcion, total_orden AS total_general`,
      [estado, entregar, metodo_pago || null, detalleStr, empresa_id, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Orden de taller no encontrada." });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error("🔥 Error actualizando OT:", err);
    return res.status(500).json({ error: "Error actualizando orden de taller." });
  }
});

/* =========================================================
 * ÍTEMS DE LA ORDEN (servicios/repuestos)
 * =======================================================*/

/**
 * POST /api/taller/:id/items
 * Agregar ítem a una OT
 * Body: { tipo_item, descripcion, cantidad, precio_unitario }
 */
router.post("/:id/items", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { id } = req.params;
  let { tipo_item, descripcion, cantidad, precio_unitario } = req.body;

  if (!tipo_item || !descripcion || !precio_unitario) {
    return res.status(400).json({
      error:
        "tipo_item, descripcion y precio_unitario son obligatorios para el ítem.",
    });
  }

  tipo_item = tipo_item === "Repuesto" ? "Repuesto" : "Servicio";
  cantidad = cantidad ? Number(cantidad) : 1;
  const precio = Number(precio_unitario);
  const total_linea = Math.round(cantidad * precio);

  try {
    // Verificar que la OT exista y pertenezca a la empresa
    const { rows: otRows } = await db.query(
      `SELECT * FROM ordenes_taller
       WHERE empresa_id = $1 AND id = $2
       LIMIT 1`,
      [empresa_id, id]
    );

    if (otRows.length === 0) {
      return res.status(404).json({ error: "Orden de taller no encontrada." });
    }

    const { rows } = await db.query(
      `INSERT INTO taller_items
       (orden_id, tipo_item, descripcion, cantidad, precio_unitario, total_linea)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [id, tipo_item, descripcion, cantidad, precio, total_linea]
    );

    // Recalcular totales
    await recalcularTotalesOrden(id);

    return res.json(rows[0]);
  } catch (err) {
    console.error("🔥 Error agregando ítem a OT:", err);
    return res
      .status(500)
      .json({ error: "Error agregando ítem a la orden de taller." });
  }
});

/**
 * DELETE /api/taller/items/:itemId
 * Eliminar un ítem de OT
 */
router.delete("/items/:itemId", auth, async (req, res) => {
  const { itemId } = req.params;

  try {
    // Primero obtenemos la orden a la que pertenece
    const { rows: itemRows } = await db.query(
      `SELECT orden_id
       FROM taller_items
       WHERE id = $1
       LIMIT 1`,
      [itemId]
    );

    if (itemRows.length === 0) {
      return res.status(404).json({ error: "Ítem no encontrado." });
    }

    const orden_id = itemRows[0].orden_id;

    await db.query(
      `DELETE FROM taller_items
       WHERE id = $1`,
      [itemId]
    );

    await recalcularTotalesOrden(orden_id);

    return res.json({ mensaje: "Ítem eliminado correctamente." });
  } catch (err) {
    console.error("🔥 Error eliminando ítem de OT:", err);
    return res
      .status(500)
      .json({ error: "Error eliminando ítem de la orden de taller." });
  }
});

/**
 * POST /api/taller/:id/pago
 * Registrar pago de la OT
 * Body: { metodo_pago, detalle_pago }
 */
router.post("/:id/pago", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { id } = req.params;
  const { metodo_pago, detalle_pago } = req.body || {};

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
      `UPDATE ordenes_taller
       SET metodo_pago = $1,
           detalle_pago = $2::jsonb
       WHERE empresa_id = $3 AND id = $4
       RETURNING *, descripcion_falla AS descripcion, total_orden AS total_general`,
      [metodo_pago, detalleStr, empresa_id, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Orden de taller no encontrada." });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error("🔥 Error registrando pago en OT:", err);
    return res
      .status(500)
      .json({ error: "Error registrando pago de orden de taller." });
  }
});

module.exports = router;
