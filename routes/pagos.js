// routes/pagos.js
const express = require("express");
const db = require("../db");
const auth = require("../middleware/auth");
const { ensurePagosServiciosSchema } = require("../utils/pagos-servicios-schema");
const {
  METODOS_PAGO_VALIDOS,
  buildPagosServiciosJoin,
  enriquecerMovimientoPago,
  normalizarModulo,
  obtenerPagosServicioResumen,
  obtenerServicioRecibo,
  registrarPagoServicio,
  toNumber,
} = require("../utils/pagos-servicios");

const router = express.Router();

function normalizarPlaca(value) {
  return String(value || "").toUpperCase().replace(/\s+/g, "").trim();
}

function resumirCartera(movimientos, mensualidades) {
  const resumen = {
    total_facturado: 0,
    total_pagado: 0,
    total_pendiente: 0,
    total_en_curso: 0,
    total_abonado: 0,
    total_recurrente_mensual: 0,
    servicios_total: movimientos.length,
    servicios_pagados: 0,
    servicios_pendientes: 0,
    servicios_en_curso: 0,
    servicios_abonados: 0,
    mensualidades_activas: 0,
    mensualidades_vencidas: 0,
    metodos_pago: [],
  };

  const metodos = new Map();

  for (const movimiento of movimientos) {
    const monto = toNumber(movimiento.monto);
    const montoPagado = toNumber(movimiento.monto_pagado);
    const saldoPendiente = toNumber(movimiento.saldo_pendiente);
    const estado = movimiento.estado_cartera;

    if (estado !== "EN_CURSO") {
      resumen.total_facturado += monto;
    }

    if (estado === "PAGADO" || estado === "MENSUALIDAD" || estado === "ABONADO") {
      resumen.total_pagado += estado === "MENSUALIDAD" ? monto : montoPagado;
    }

    if (estado === "PAGADO" || estado === "MENSUALIDAD") {
      resumen.servicios_pagados += 1;
      const metodo = movimiento.metodo_pago || (estado === "MENSUALIDAD" ? "MENSUALIDAD" : "SIN_METODO");
      const actual = metodos.get(metodo) || { metodo_pago: metodo, total: 0, cantidad: 0 };
      actual.total += estado === "MENSUALIDAD" ? monto : montoPagado;
      actual.cantidad += 1;
      metodos.set(metodo, actual);
    } else if (estado === "ABONADO") {
      resumen.total_abonado += montoPagado;
      resumen.total_pendiente += saldoPendiente;
      resumen.servicios_abonados += 1;
      resumen.servicios_pendientes += 1;
    } else if (estado === "PENDIENTE") {
      resumen.total_pendiente += saldoPendiente || monto;
      resumen.servicios_pendientes += 1;
    } else {
      resumen.total_en_curso += monto;
      resumen.servicios_en_curso += 1;
    }
  }

  const hoy = new Date();
  for (const mensualidad of mensualidades) {
    const activa = mensualidad.estado === "ACTIVA";
    const inicio = mensualidad.fecha_inicio ? new Date(mensualidad.fecha_inicio) : null;
    const fin = mensualidad.fecha_fin ? new Date(mensualidad.fecha_fin) : null;
    const vigente = (!inicio || inicio <= hoy) && (!fin || fin >= hoy);

    if (activa && vigente) {
      resumen.mensualidades_activas += 1;
      resumen.total_recurrente_mensual += toNumber(mensualidad.valor_mensual);
    } else if (fin && fin < hoy) {
      resumen.mensualidades_vencidas += 1;
    }
  }

  resumen.metodos_pago = [...metodos.values()].sort((a, b) => b.total - a.total);
  return resumen;
}

async function obtenerCartera({ empresaId, clienteId, placa }) {
  await ensurePagosServiciosSchema();

  const params = [empresaId, clienteId || placa];
  const filtros = clienteId
    ? {
        parqueadero: "COALESCE(p.cliente_id, v.cliente_id) = $2",
        lavadero: "COALESCE(l.cliente_id, v.cliente_id) = $2",
        taller: "COALESCE(t.cliente_id, v.cliente_id) = $2",
        mensualidad: "mp.cliente_id = $2",
      }
    : {
        parqueadero: "p.placa = $2",
        lavadero: "l.placa = $2",
        taller: "t.placa = $2",
        mensualidad: "mp.placa = $2",
      };

  const { rows: movimientosRaw } = await db.query(
    `SELECT *
     FROM (
       SELECT
         p.id::text AS referencia_id,
         'parqueadero' AS modulo,
         'Parqueadero' AS tipo,
         p.placa,
         COALESCE(p.hora_salida, p.hora_entrada, p.creado_en) AS fecha,
         COALESCE(p.valor_total, 0) AS monto,
         p.metodo_pago AS metodo_pago_base,
         COALESCE(p.estado_pago, CASE WHEN p.hora_salida IS NULL THEN 'EN_CURSO' ELSE 'CERRADO' END) AS estado_original,
         p.tipo_servicio AS detalle,
         p.tipo_servicio,
         CASE WHEN p.hora_salida IS NOT NULL THEN TRUE ELSE FALSE END AS servicio_cerrado,
         CASE
           WHEN UPPER(COALESCE(p.estado_pago, '')) IN ('PAGADO', 'MENSUALIDAD')
             OR NULLIF(TRIM(COALESCE(p.metodo_pago, '')), '') IS NOT NULL
             OR COALESCE(p.valor_total, 0) = 0
           THEN TRUE
           ELSE FALSE
         END AS legacy_paid,
         COALESCE(psp.total_pagado, 0) AS total_pagado_registrado,
         COALESCE(psp.cantidad_pagos, 0) AS cantidad_pagos,
         COALESCE(psp.metodos_distintos, 0) AS metodos_distintos,
         psp.ultimo_metodo_pago,
         psp.ultimo_pago
       FROM parqueadero p
       LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
       ${buildPagosServiciosJoin("parqueadero", "p.id", "psp")}
       WHERE p.empresa_id = $1 AND ${filtros.parqueadero}

       UNION ALL

       SELECT
         l.id::text AS referencia_id,
         'lavadero' AS modulo,
         'Lavadero' AS tipo,
         l.placa,
         COALESCE(l.hora_fin, l.hora_inicio, l.creado_en) AS fecha,
         COALESCE(l.precio, 0) AS monto,
         l.metodo_pago AS metodo_pago_base,
         l.estado AS estado_original,
         'Servicio de lavado' AS detalle,
         NULL::varchar AS tipo_servicio,
         CASE WHEN l.estado = 'Completado' THEN TRUE ELSE FALSE END AS servicio_cerrado,
         CASE
           WHEN NULLIF(TRIM(COALESCE(l.metodo_pago, '')), '') IS NOT NULL
             OR COALESCE(l.precio, 0) = 0
           THEN TRUE
           ELSE FALSE
         END AS legacy_paid,
         COALESCE(psl.total_pagado, 0) AS total_pagado_registrado,
         COALESCE(psl.cantidad_pagos, 0) AS cantidad_pagos,
         COALESCE(psl.metodos_distintos, 0) AS metodos_distintos,
         psl.ultimo_metodo_pago,
         psl.ultimo_pago
       FROM lavadero l
       LEFT JOIN vehiculos v ON v.id = l.vehiculo_id
       ${buildPagosServiciosJoin("lavadero", "l.id", "psl")}
       WHERE l.empresa_id = $1 AND ${filtros.lavadero}

       UNION ALL

       SELECT
         t.id::text AS referencia_id,
         'taller' AS modulo,
         'Taller' AS tipo,
         t.placa,
         COALESCE(t.fecha_entrega, t.fecha_creacion) AS fecha,
         COALESCE(t.total_orden, 0) AS monto,
         t.metodo_pago AS metodo_pago_base,
         t.estado AS estado_original,
         COALESCE(t.descripcion_falla, 'Orden de taller') AS detalle,
         NULL::varchar AS tipo_servicio,
         CASE WHEN t.estado = 'Entregado' THEN TRUE ELSE FALSE END AS servicio_cerrado,
         CASE
           WHEN NULLIF(TRIM(COALESCE(t.metodo_pago, '')), '') IS NOT NULL
             OR COALESCE(t.total_orden, 0) = 0
           THEN TRUE
           ELSE FALSE
         END AS legacy_paid,
         COALESCE(pst.total_pagado, 0) AS total_pagado_registrado,
         COALESCE(pst.cantidad_pagos, 0) AS cantidad_pagos,
         COALESCE(pst.metodos_distintos, 0) AS metodos_distintos,
         pst.ultimo_metodo_pago,
         pst.ultimo_pago
       FROM taller_ordenes t
       LEFT JOIN vehiculos v ON v.id = t.vehiculo_id
       ${buildPagosServiciosJoin("taller", "t.id", "pst")}
       WHERE t.empresa_id = $1 AND ${filtros.taller}
     ) cartera
     ORDER BY fecha DESC NULLS LAST
     LIMIT 80`,
    params
  );

  const { rows: mensualidadesRaw } = await db.query(
    `SELECT
       mp.*,
       CASE
         WHEN mp.estado = 'ACTIVA' AND CURRENT_DATE BETWEEN mp.fecha_inicio AND mp.fecha_fin
         THEN GREATEST(0, (mp.fecha_fin - CURRENT_DATE))::int
         ELSE NULL
       END AS dias_restantes
     FROM mensualidades_parqueadero mp
     WHERE mp.empresa_id = $1 AND ${filtros.mensualidad}
     ORDER BY
       CASE WHEN mp.estado = 'ACTIVA' AND CURRENT_DATE BETWEEN mp.fecha_inicio AND mp.fecha_fin THEN 0 ELSE 1 END,
       mp.fecha_fin DESC,
       mp.creado_en DESC`,
    params
  );

  const movimientos = movimientosRaw.map((movimiento) => enriquecerMovimientoPago(movimiento));
  const mensualidades = mensualidadesRaw.map((mensualidad) => ({
    ...mensualidad,
    valor_mensual: toNumber(mensualidad.valor_mensual),
  }));
  const resumen = resumirCartera(movimientos, mensualidades);

  return {
    resumen,
    movimientos,
    pendientes: movimientos.filter((movimiento) => ["PENDIENTE", "ABONADO"].includes(movimiento.estado_cartera)),
    en_curso: movimientos.filter((movimiento) => movimiento.estado_cartera === "EN_CURSO"),
    pagos: movimientos.filter((movimiento) => ["PAGADO", "MENSUALIDAD"].includes(movimiento.estado_cartera)),
    mensualidades,
  };
}

async function obtenerEmpresaRecibo(empresaId) {
  const { rows } = await db.query(
    `SELECT id, nombre, nit, ciudad, direccion, telefono, email_contacto, logo_url
     FROM empresas
     WHERE id = $1
     LIMIT 1`,
    [empresaId]
  );
  return rows[0] || { id: empresaId, nombre: "AutoGestion360" };
}

function buildReceiptNumber(prefix, value) {
  return `AG360-${prefix}-${String(value || Date.now()).toUpperCase()}`;
}

function buildReceiptPayload({ tipo, numero, empresa, sujeto, resumen, movimientos, servicio = null }) {
  return {
    tipo,
    numero,
    generado_en: new Date().toISOString(),
    empresa,
    sujeto,
    resumen,
    movimientos,
    servicio,
  };
}

async function obtenerHistorialPagosServicio(queryable, empresaId, modulo, referenciaId) {
  await ensurePagosServiciosSchema(queryable);

  const { rows } = await queryable.query(
    `SELECT
       id,
       modulo,
       referencia_id,
       monto,
       metodo_pago,
       referencia_transaccion,
       detalle_pago,
       estado,
       fecha_pago
     FROM pagos_servicios
     WHERE empresa_id = $1
       AND modulo = $2
       AND referencia_id = $3
       AND estado = 'APLICADO'
     ORDER BY fecha_pago DESC, id DESC`,
    [empresaId, modulo, referenciaId]
  );

  return rows.map((row) => ({
    ...row,
    monto: toNumber(row.monto),
  }));
}

// GET cartera 360 de cliente
router.get("/cartera/cliente/:cliente_id", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const cliente_id = Number(req.params.cliente_id);

  if (!cliente_id) {
    return res.status(400).json({ error: "Cliente inválido." });
  }

  try {
    const { rows: clienteRows } = await db.query(
      `SELECT id, nombre, documento, telefono, correo
       FROM clientes
       WHERE id = $1 AND empresa_id = $2
       LIMIT 1`,
      [cliente_id, empresa_id]
    );

    if (clienteRows.length === 0) {
      return res.status(404).json({ error: "Cliente no encontrado." });
    }

    const cartera = await obtenerCartera({ empresaId: empresa_id, clienteId: cliente_id });
    res.json({
      cliente: clienteRows[0],
      ...cartera,
    });
  } catch (err) {
    console.error("Error obteniendo cartera de cliente:", err);
    res.status(500).json({ error: "Error obteniendo cartera del cliente." });
  }
});

// GET cartera 360 de vehículo
router.get("/cartera/vehiculo/:placa", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const placa = normalizarPlaca(req.params.placa);

  if (!placa) {
    return res.status(400).json({ error: "Debe enviar una placa." });
  }

  try {
    const cartera = await obtenerCartera({ empresaId: empresa_id, placa });
    res.json({
      placa,
      ...cartera,
    });
  } catch (err) {
    console.error("Error obteniendo cartera de vehículo:", err);
    res.status(500).json({ error: "Error obteniendo cartera del vehículo." });
  }
});

// GET comprobante/recibo de un servicio
router.get("/recibo/servicio/:modulo/:id", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const modulo = String(req.params.modulo || "").toLowerCase();
  const id = req.params.id;

  if (!["parqueadero", "lavadero", "taller"].includes(modulo)) {
    return res.status(400).json({ error: "Módulo inválido para comprobante." });
  }

  try {
    const [empresa, servicioRaw] = await Promise.all([
      obtenerEmpresaRecibo(empresa_id),
      obtenerServicioRecibo(empresa_id, modulo, id),
    ]);

    if (!servicioRaw) {
      return res.status(404).json({ error: "Servicio no encontrado." });
    }

    const servicio = {
      ...servicioRaw,
      monto: toNumber(servicioRaw.monto),
    };
    const resumen = resumirCartera([servicio], []);
    const sujeto = {
      tipo: "servicio",
      titulo: `${servicio.tipo} ${servicio.referencia_id}`,
      nombre: servicio.cliente_nombre || "Cliente no registrado",
      documento: servicio.cliente_documento || null,
      telefono: servicio.cliente_telefono || null,
      correo: servicio.cliente_correo || null,
      placa: servicio.placa,
    };

    res.json(buildReceiptPayload({
      tipo: "servicio",
      numero: buildReceiptNumber(modulo, servicio.referencia_id),
      empresa,
      sujeto,
      resumen,
      movimientos: [servicio],
      servicio,
    }));
  } catch (err) {
    console.error("Error generando recibo de servicio:", err);
    res.status(500).json({ error: "Error generando recibo del servicio." });
  }
});

// GET estado de cuenta imprimible de cliente
router.get("/recibo/cliente/:cliente_id", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const cliente_id = Number(req.params.cliente_id);

  if (!cliente_id) {
    return res.status(400).json({ error: "Cliente inválido." });
  }

  try {
    const { rows: clienteRows } = await db.query(
      `SELECT id, nombre, documento, telefono, correo
       FROM clientes
       WHERE id = $1 AND empresa_id = $2
       LIMIT 1`,
      [cliente_id, empresa_id]
    );

    if (clienteRows.length === 0) {
      return res.status(404).json({ error: "Cliente no encontrado." });
    }

    const [empresa, cartera] = await Promise.all([
      obtenerEmpresaRecibo(empresa_id),
      obtenerCartera({ empresaId: empresa_id, clienteId: cliente_id }),
    ]);
    const cliente = clienteRows[0];

    res.json(buildReceiptPayload({
      tipo: "cliente",
      numero: buildReceiptNumber("CLIENTE", cliente.id),
      empresa,
      sujeto: {
        tipo: "cliente",
        titulo: "Estado de cuenta de cliente",
        nombre: cliente.nombre,
        documento: cliente.documento,
        telefono: cliente.telefono,
        correo: cliente.correo,
      },
      resumen: cartera.resumen,
      movimientos: cartera.movimientos,
    }));
  } catch (err) {
    console.error("Error generando estado de cuenta de cliente:", err);
    res.status(500).json({ error: "Error generando estado de cuenta del cliente." });
  }
});

// GET estado de cuenta imprimible de vehículo
router.get("/recibo/vehiculo/:placa", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const placa = normalizarPlaca(req.params.placa);

  if (!placa) {
    return res.status(400).json({ error: "Debe enviar una placa." });
  }

  try {
    const { rows: vehiculoRows } = await db.query(
      `SELECT
         v.id,
         v.placa,
         v.tipo_vehiculo,
         v.marca,
         v.modelo,
         v.color,
         c.nombre AS cliente_nombre,
         c.documento AS cliente_documento,
         c.telefono AS cliente_telefono,
         c.correo AS cliente_correo
       FROM vehiculos v
       LEFT JOIN clientes c ON c.id = v.cliente_id
       WHERE v.empresa_id = $1 AND v.placa = $2
       LIMIT 1`,
      [empresa_id, placa]
    );

    const [empresa, cartera] = await Promise.all([
      obtenerEmpresaRecibo(empresa_id),
      obtenerCartera({ empresaId: empresa_id, placa }),
    ]);
    const vehiculo = vehiculoRows[0] || { placa };

    res.json(buildReceiptPayload({
      tipo: "vehiculo",
      numero: buildReceiptNumber("VEHICULO", placa),
      empresa,
      sujeto: {
        tipo: "vehiculo",
        titulo: "Estado de cuenta de vehículo",
        nombre: vehiculo.cliente_nombre || "Cliente no registrado",
        documento: vehiculo.cliente_documento || null,
        telefono: vehiculo.cliente_telefono || null,
        correo: vehiculo.cliente_correo || null,
        placa,
        vehiculo: [vehiculo.tipo_vehiculo, vehiculo.marca, vehiculo.modelo, vehiculo.color]
          .filter(Boolean)
          .join(" · "),
      },
      resumen: cartera.resumen,
      movimientos: cartera.movimientos,
    }));
  } catch (err) {
    console.error("Error generando estado de cuenta de vehículo:", err);
    res.status(500).json({ error: "Error generando estado de cuenta del vehículo." });
  }
});

// GET detalle de un servicio con saldo e historial de pagos
router.get("/servicio/:modulo/:id", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const modulo = normalizarModulo(req.params.modulo);
  const referenciaId = Number(req.params.id);

  if (!modulo) {
    return res.status(400).json({ error: "Módulo inválido." });
  }

  if (!referenciaId) {
    return res.status(400).json({ error: "Referencia inválida." });
  }

  try {
    const servicio = await obtenerServicioRecibo(empresa_id, modulo, referenciaId);
    if (!servicio) {
      return res.status(404).json({ error: "Servicio no encontrado." });
    }

    const pagos = await obtenerHistorialPagosServicio(db, empresa_id, modulo, referenciaId);
    res.json({
      ...servicio,
      pagos,
    });
  } catch (err) {
    console.error("Error obteniendo detalle de servicio:", err);
    res.status(500).json({ error: "Error obteniendo detalle del servicio." });
  }
});

// POST registrar abono o pago a cualquier servicio cerrado
router.post("/servicio", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const usuario_id = req.user.id;
  const {
    modulo,
    referencia_id,
    monto,
    metodo_pago,
    referencia_transaccion,
    detalle_pago,
  } = req.body || {};

  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    await ensurePagosServiciosSchema(client);

    const resultado = await registrarPagoServicio({
      queryable: client,
      empresaId: empresa_id,
      usuarioId: usuario_id,
      modulo,
      referenciaId: referencia_id,
      monto,
      metodoPago: metodo_pago,
      referenciaTransaccion: referencia_transaccion,
      detallePago: detalle_pago,
    });

    await client.query("COMMIT");
    client.release();
    client = null;

    res.status(201).json({
      mensaje: resultado.servicio.estado_cartera === "PAGADO"
        ? "Pago registrado correctamente."
        : "Abono registrado correctamente.",
      ...resultado,
    });
  } catch (err) {
    try {
      if (client) await client.query("ROLLBACK");
    } catch (_) {}
    if (client) client.release();

    console.error("Error registrando pago de servicio:", err);
    res.status(err.status || 500).json({
      error: err.message || "Error registrando pago del servicio.",
    });
  }
});

// GET pagos de un parqueadero
router.get("/parqueadero/:parqueadero_id", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const parqueadero_id = req.params.parqueadero_id;

  try {
    await ensurePagosServiciosSchema();

    const { rows } = await db.query(
      `SELECT
         id,
         empresa_id,
         referencia_id AS parqueadero_id,
         monto,
         metodo_pago,
         referencia_transaccion,
         estado,
         usuario_registro_id,
         fecha_pago,
         creado_en
       FROM pagos_servicios
       WHERE empresa_id = $1
         AND modulo = 'parqueadero'
         AND referencia_id = $2
         AND estado = 'APLICADO'
       ORDER BY fecha_pago DESC, id DESC`,
      [empresa_id, parqueadero_id]
    );

    res.json(rows.map((row) => ({ ...row, monto: toNumber(row.monto) })));
  } catch (err) {
    console.error("Error obteniendo pagos:", err);
    res.status(500).json({ error: "Error obteniendo pagos." });
  }
});

// GET servicios de parqueadero cerrados sin pago registrado
router.get("/pendientes/listado", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;

  try {
    await ensurePagosServiciosSchema();

    const { rows } = await db.query(
      `SELECT
         p.id,
         p.placa,
         p.tipo_vehiculo,
         p.hora_entrada,
         p.hora_salida,
         COALESCE(p.valor_total, 0) AS monto,
         p.estado_pago,
         c.nombre AS nombre_cliente
       FROM parqueadero p
       LEFT JOIN clientes c ON c.id = p.cliente_id
       LEFT JOIN pagos_servicios ps ON ps.empresa_id = p.empresa_id
         AND ps.modulo = 'parqueadero'
         AND ps.referencia_id = p.id
         AND ps.estado = 'APLICADO'
       WHERE p.empresa_id = $1
         AND p.hora_salida IS NOT NULL
         AND ps.id IS NULL
         AND COALESCE(p.valor_total, 0) > 0
         AND COALESCE(p.estado_pago, '') NOT IN ('PAGADO', 'MENSUALIDAD')
       ORDER BY p.hora_salida DESC
       LIMIT 100`,
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
    detalle_pago,
  } = req.body || {};

  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");
    await ensurePagosServiciosSchema(client);

    const resultado = await registrarPagoServicio({
      queryable: client,
      empresaId: empresa_id,
      usuarioId: usuario_id,
      modulo: "parqueadero",
      referenciaId: parqueadero_id,
      monto,
      metodoPago: metodo_pago,
      referenciaTransaccion: referencia_transaccion,
      detallePago: detalle_pago,
    });

    await client.query("COMMIT");
    client.release();
    client = null;

    res.status(201).json({
      mensaje: resultado.servicio.estado_cartera === "PAGADO"
        ? "Pago registrado correctamente."
        : "Abono registrado correctamente.",
      ...resultado,
    });
  } catch (err) {
    try {
      if (client) await client.query("ROLLBACK");
    } catch (_) {}
    if (client) client.release();
    console.error("Error registrando pago:", err);
    res.status(err.status || 500).json({ error: err.message || "Error registrando pago." });
  }
});

// PATCH — endpoint legacy eliminado; usar POST /api/pagos/servicio para registrar pagos
router.patch("/:id", auth, (req, res) => {
  res.status(410).json({
    error: "Endpoint eliminado. Use POST /api/pagos/servicio para registrar pagos.",
  });
});

module.exports = router;
