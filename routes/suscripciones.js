const express = require("express");
const db = require("../db");
const authMiddleware = require("../middleware/auth");
const {
  ensureSuscripcionesSchema,
  getFacturasSaasEmpresa,
  getSuscripcionEmpresa,
  normalizeGateway,
  normalizeInvoiceStatus,
  normalizeSubscriptionStatus,
  registrarFacturaSaas,
  resolveSubscriptionStatus,
  toNumber,
  upsertSuscripcionEmpresa,
} = require("../utils/suscripciones-schema");

const router = express.Router();

function normalizeRole(role) {
  return String(role || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function superAdminOnly(req, res, next) {
  if (normalizeRole(req.user?.rol) !== "superadmin") {
    return res.status(403).json({ error: "Acceso denegado. Solo SuperAdmin." });
  }
  next();
}

async function listSuscripciones() {
  await ensureSuscripcionesSchema();

  const { rows } = await db.query(
    `SELECT
       s.*,
       e.nombre AS empresa_nombre,
       e.email_contacto,
       e.ciudad,
       e.activa AS empresa_activa,
       l.nombre AS licencia_nombre,
       l.descripcion AS licencia_descripcion,
       l.precio AS licencia_precio
     FROM suscripciones_empresa s
     JOIN empresas e ON e.id = s.empresa_id
     LEFT JOIN licencias l ON l.id = s.licencia_id
     ORDER BY e.nombre ASC`
  );

  return rows.map((row) => ({
    ...row,
    precio_plan: toNumber(row.precio_plan),
    licencia_precio: row.licencia_precio === null ? null : toNumber(row.licencia_precio),
    estado_real: resolveSubscriptionStatus(row),
  }));
}

router.get("/resumen", authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const suscripciones = await listSuscripciones();
    const resumen = {
      total: suscripciones.length,
      trial: 0,
      activas: 0,
      vencidas: 0,
      suspendidas: 0,
      canceladas: 0,
      mrr: 0,
      arr: 0,
    };

    for (const suscripcion of suscripciones) {
      const estado = suscripcion.estado_real;
      if (estado === "TRIAL") resumen.trial += 1;
      if (estado === "ACTIVA") resumen.activas += 1;
      if (estado === "VENCIDA") resumen.vencidas += 1;
      if (estado === "SUSPENDIDA") resumen.suspendidas += 1;
      if (estado === "CANCELADA") resumen.canceladas += 1;
      if (["TRIAL", "ACTIVA"].includes(estado)) {
        resumen.mrr += toNumber(suscripcion.precio_plan);
      }
    }

    resumen.arr = resumen.mrr * 12;
    res.json(resumen);
  } catch (error) {
    console.error("Error obteniendo resumen SaaS:", error);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

router.get("/", authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const estadoFiltro = normalizeSubscriptionStatus(req.query.estado, "");
    const empresaId = Number(req.query.empresa_id || 0);
    let suscripciones = await listSuscripciones();

    if (empresaId) {
      suscripciones = suscripciones.filter((item) => Number(item.empresa_id) === empresaId);
    }

    if (estadoFiltro) {
      suscripciones = suscripciones.filter((item) => item.estado_real === estadoFiltro);
    }

    res.json(suscripciones);
  } catch (error) {
    console.error("Error listando suscripciones SaaS:", error);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

router.get("/:empresaId/facturas", authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const empresaId = Number(req.params.empresaId || 0);
    if (!empresaId) {
      return res.status(400).json({ error: "Empresa invalida." });
    }

    const facturas = await getFacturasSaasEmpresa(db, empresaId, Number(req.query.limit || 20));
    res.json(facturas);
  } catch (error) {
    console.error("Error obteniendo facturas SaaS:", error);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

router.post("/:empresaId/facturas", authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const empresaId = Number(req.params.empresaId || 0);
    if (!empresaId) {
      return res.status(400).json({ error: "Empresa invalida." });
    }

    const suscripcion = await getSuscripcionEmpresa(db, empresaId);
    const factura = await registrarFacturaSaas({
      empresaId,
      licenciaId: req.body.licencia_id || suscripcion?.licencia_id || null,
      suscripcionId: suscripcion?.id || null,
      numeroFactura: req.body.numero_factura || null,
      concepto: req.body.concepto || "Cobro de suscripcion SaaS",
      periodoInicio: req.body.periodo_inicio || null,
      periodoFin: req.body.periodo_fin || null,
      subtotal: req.body.subtotal || req.body.total || 0,
      impuestos: req.body.impuestos || 0,
      total: req.body.total || null,
      moneda: req.body.moneda || "COP",
      estado: normalizeInvoiceStatus(req.body.estado, "PENDIENTE"),
      fechaEmision: req.body.fecha_emision || null,
      fechaVencimiento: req.body.fecha_vencimiento || null,
      fechaPago: req.body.fecha_pago || null,
      metodoPago: req.body.metodo_pago || null,
      referenciaPago: req.body.referencia_pago || null,
      pasarela: normalizeGateway(req.body.pasarela, suscripcion?.pasarela || "MANUAL"),
      metadata: req.body.metadata || null,
    });

    res.status(201).json({
      mensaje: "Factura SaaS registrada correctamente.",
      factura,
    });
  } catch (error) {
    console.error("Error registrando factura SaaS:", error);
    res.status(error.status || 500).json({ error: error.message || "Error interno del servidor." });
  }
});

router.get("/:empresaId", authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const empresaId = Number(req.params.empresaId || 0);
    if (!empresaId) {
      return res.status(400).json({ error: "Empresa invalida." });
    }

    const suscripcion = await getSuscripcionEmpresa(db, empresaId);
    if (!suscripcion) {
      return res.status(404).json({ error: "No hay suscripcion registrada para esta empresa." });
    }

    const facturas = await getFacturasSaasEmpresa(db, empresaId, 10);
    res.json({
      ...suscripcion,
      facturas,
    });
  } catch (error) {
    console.error("Error obteniendo suscripcion SaaS:", error);
    res.status(500).json({ error: "Error interno del servidor." });
  }
});

router.post("/upsert", authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const empresaId = Number(req.body.empresa_id || 0);
    const licenciaId = Number(req.body.licencia_id || 0);
    if (!empresaId || !licenciaId) {
      return res.status(400).json({ error: "empresa_id y licencia_id son requeridos." });
    }

    const suscripcion = await upsertSuscripcionEmpresa({
      empresaId,
      licenciaId,
      estado: req.body.estado || "ACTIVA",
      fechaInicio: req.body.fecha_inicio || null,
      fechaFin: req.body.fecha_fin || null,
      renovacionAutomatica: req.body.renovacion_automatica === true,
      pasarela: req.body.pasarela || "MANUAL",
      referenciaExterna: req.body.referencia_externa || null,
      observaciones: req.body.observaciones || null,
      moneda: req.body.moneda || "COP",
      precioPlan: req.body.precio_plan,
      metadata: req.body.metadata || null,
    });

    res.json({
      mensaje: "Suscripcion actualizada correctamente.",
      suscripcion,
    });
  } catch (error) {
    console.error("Error guardando suscripcion SaaS:", error);
    res.status(error.status || 500).json({ error: error.message || "Error interno del servidor." });
  }
});

router.post("/:empresaId/renovar", authMiddleware, superAdminOnly, async (req, res) => {
  const empresaId = Number(req.params.empresaId || 0);
  if (!empresaId) {
    return res.status(400).json({ error: "Empresa invalida." });
  }

  let client;
  try {
    const actual = await getSuscripcionEmpresa(db, empresaId);
    if (!actual) {
      return res.status(404).json({ error: "No hay suscripcion para renovar." });
    }

    const dias = Math.max(1, Number(req.body.dias || 30));
    const baseDate = actual.fecha_fin && new Date(actual.fecha_fin) > new Date()
      ? new Date(actual.fecha_fin)
      : new Date();
    const nuevaFechaFin = new Date(baseDate);
    nuevaFechaFin.setDate(nuevaFechaFin.getDate() + dias);

    client = await db.connect();
    await client.query("BEGIN");

    const suscripcion = await upsertSuscripcionEmpresa({
      queryable: client,
      empresaId,
      licenciaId: req.body.licencia_id || actual.licencia_id,
      estado: "ACTIVA",
      fechaInicio: actual.fecha_inicio || new Date(),
      fechaFin: nuevaFechaFin,
      renovacionAutomatica: req.body.renovacion_automatica === true
        ? true
        : Boolean(actual.renovacion_automatica),
      pasarela: req.body.pasarela || actual.pasarela || "MANUAL",
      referenciaExterna: req.body.referencia_externa || actual.referencia_externa || null,
      observaciones: req.body.observaciones || actual.observaciones || null,
      moneda: req.body.moneda || actual.moneda || "COP",
      precioPlan: req.body.precio_plan ?? actual.precio_plan,
    });

    let factura = null;
    if (req.body.generar_factura !== false) {
      factura = await registrarFacturaSaas({
        queryable: client,
        empresaId,
        licenciaId: suscripcion.licencia_id,
        suscripcionId: suscripcion.id,
        concepto: req.body.concepto || `Renovacion ${suscripcion.licencia_nombre || "plan SaaS"} (${dias} dias)`,
        periodoInicio: actual.fecha_fin || new Date(),
        periodoFin: nuevaFechaFin,
        subtotal: req.body.total || suscripcion.precio_plan || 0,
        impuestos: req.body.impuestos || 0,
        total: req.body.total || suscripcion.precio_plan || 0,
        moneda: suscripcion.moneda || "COP",
        estado: req.body.estado_factura || "PAGADA",
        fechaVencimiento: req.body.fecha_vencimiento || null,
        fechaPago: normalizeInvoiceStatus(req.body.estado_factura || "PAGADA", "PAGADA") === "PAGADA"
          ? (req.body.fecha_pago || new Date())
          : null,
        metodoPago: req.body.metodo_pago || null,
        referenciaPago: req.body.referencia_pago || null,
        pasarela: req.body.pasarela || suscripcion.pasarela || "MANUAL",
      });
    }

    await client.query("COMMIT");
    client.release();
    client = null;

    res.json({
      mensaje: "Suscripcion renovada correctamente.",
      suscripcion,
      factura,
    });
  } catch (error) {
    try {
      if (client) await client.query("ROLLBACK");
    } catch (_) {}
    if (client) client.release();
    console.error("Error renovando suscripcion SaaS:", error);
    res.status(error.status || 500).json({ error: error.message || "Error interno del servidor." });
  }
});

router.post("/:empresaId/estado", authMiddleware, superAdminOnly, async (req, res) => {
  try {
    const empresaId = Number(req.params.empresaId || 0);
    if (!empresaId) {
      return res.status(400).json({ error: "Empresa invalida." });
    }

    const actual = await getSuscripcionEmpresa(db, empresaId);
    if (!actual) {
      return res.status(404).json({ error: "No hay suscripcion para actualizar." });
    }

    const estado = normalizeSubscriptionStatus(req.body.estado, "");
    if (!estado) {
      return res.status(400).json({ error: "Debe enviar un estado valido." });
    }

    const suscripcion = await upsertSuscripcionEmpresa({
      empresaId,
      licenciaId: actual.licencia_id,
      estado,
      fechaInicio: actual.fecha_inicio,
      fechaFin: req.body.fecha_fin || actual.fecha_fin,
      renovacionAutomatica: actual.renovacion_automatica,
      pasarela: actual.pasarela,
      referenciaExterna: actual.referencia_externa,
      observaciones: req.body.observaciones || actual.observaciones,
      moneda: actual.moneda || "COP",
      precioPlan: actual.precio_plan,
    });

    res.json({
      mensaje: "Estado de suscripcion actualizado correctamente.",
      suscripcion,
    });
  } catch (error) {
    console.error("Error actualizando estado SaaS:", error);
    res.status(error.status || 500).json({ error: error.message || "Error interno del servidor." });
  }
});

module.exports = router;
