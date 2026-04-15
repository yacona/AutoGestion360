// routes/pagos.js
const express = require("express");
const db = require("../db");
const auth = require("../middleware/auth");

const router = express.Router();

function toNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizarPlaca(value) {
  return String(value || "").toUpperCase().replace(/\s+/g, "").trim();
}

const METODOS_PAGO_VALIDOS = ["EFECTIVO", "TARJETA", "TRANSFERENCIA", "MIXTO", "OTRO", "MENSUALIDAD"];
const ESTADOS_PAGO_VALIDOS = ["PAGADO", "PENDIENTE", "MENSUALIDAD"];

function resumirCartera(movimientos, mensualidades) {
  const resumen = {
    total_facturado: 0,
    total_pagado: 0,
    total_pendiente: 0,
    total_en_curso: 0,
    total_recurrente_mensual: 0,
    servicios_total: movimientos.length,
    servicios_pagados: 0,
    servicios_pendientes: 0,
    servicios_en_curso: 0,
    mensualidades_activas: 0,
    mensualidades_vencidas: 0,
    metodos_pago: [],
  };

  const metodos = new Map();

  for (const movimiento of movimientos) {
    const monto = toNumber(movimiento.monto);
    const estado = movimiento.estado_cartera;

    if (estado !== "EN_CURSO") {
      resumen.total_facturado += monto;
    }

    if (estado === "PAGADO" || estado === "MENSUALIDAD") {
      resumen.total_pagado += monto;
      resumen.servicios_pagados += 1;
      const metodo = movimiento.metodo_pago || (estado === "MENSUALIDAD" ? "MENSUALIDAD" : "SIN_METODO");
      const actual = metodos.get(metodo) || { metodo_pago: metodo, total: 0, cantidad: 0 };
      actual.total += monto;
      actual.cantidad += 1;
      metodos.set(metodo, actual);
    } else if (estado === "PENDIENTE") {
      resumen.total_pendiente += monto;
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
         p.metodo_pago,
         COALESCE(p.estado_pago, CASE WHEN p.hora_salida IS NULL THEN 'EN_CURSO' ELSE 'CERRADO' END) AS estado_original,
         p.tipo_servicio AS detalle,
         CASE
           WHEN p.hora_salida IS NULL THEN 'EN_CURSO'
           WHEN UPPER(COALESCE(p.estado_pago, '')) = 'MENSUALIDAD' THEN 'MENSUALIDAD'
           WHEN UPPER(COALESCE(p.estado_pago, '')) = 'PAGADO'
             OR p.metodo_pago IS NOT NULL
             OR COALESCE(p.valor_total, 0) = 0 THEN 'PAGADO'
           ELSE 'PENDIENTE'
         END AS estado_cartera
       FROM parqueadero p
       LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
       WHERE p.empresa_id = $1 AND ${filtros.parqueadero}

       UNION ALL

       SELECT
         l.id::text AS referencia_id,
         'lavadero' AS modulo,
         'Lavadero' AS tipo,
         l.placa,
         COALESCE(l.hora_fin, l.hora_inicio, l.creado_en) AS fecha,
         COALESCE(l.precio, 0) AS monto,
         l.metodo_pago,
         l.estado AS estado_original,
         'Servicio de lavado' AS detalle,
         CASE
           WHEN l.metodo_pago IS NOT NULL THEN 'PAGADO'
           WHEN l.estado = 'Completado' THEN 'PENDIENTE'
           ELSE 'EN_CURSO'
         END AS estado_cartera
       FROM lavadero l
       LEFT JOIN vehiculos v ON v.id = l.vehiculo_id
       WHERE l.empresa_id = $1 AND ${filtros.lavadero}

       UNION ALL

       SELECT
         t.id::text AS referencia_id,
         'taller' AS modulo,
         'Taller' AS tipo,
         t.placa,
         COALESCE(t.fecha_entrega, t.fecha_creacion) AS fecha,
         COALESCE(t.total_orden, 0) AS monto,
         t.metodo_pago,
         t.estado AS estado_original,
         COALESCE(t.descripcion_falla, 'Orden de taller') AS detalle,
         CASE
           WHEN t.metodo_pago IS NOT NULL THEN 'PAGADO'
           WHEN t.estado = 'Entregado' THEN 'PENDIENTE'
           ELSE 'EN_CURSO'
         END AS estado_cartera
       FROM taller_ordenes t
       LEFT JOIN vehiculos v ON v.id = t.vehiculo_id
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

  const movimientos = movimientosRaw.map((movimiento) => ({
    ...movimiento,
    monto: toNumber(movimiento.monto),
  }));
  const mensualidades = mensualidadesRaw.map((mensualidad) => ({
    ...mensualidad,
    valor_mensual: toNumber(mensualidad.valor_mensual),
  }));
  const resumen = resumirCartera(movimientos, mensualidades);

  return {
    resumen,
    movimientos,
    pendientes: movimientos.filter((movimiento) => movimiento.estado_cartera === "PENDIENTE"),
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

async function obtenerServicioRecibo(empresaId, modulo, id) {
  if (modulo === "parqueadero") {
    const { rows } = await db.query(
      `SELECT
         p.id::text AS referencia_id,
         'parqueadero' AS modulo,
         'Parqueadero' AS tipo,
         p.placa,
         COALESCE(p.hora_salida, p.hora_entrada, p.creado_en) AS fecha,
         p.hora_entrada AS inicio,
         p.hora_salida AS fin,
         p.minutos_total,
         COALESCE(p.valor_total, 0) AS monto,
         p.metodo_pago,
         COALESCE(p.estado_pago, CASE WHEN p.hora_salida IS NULL THEN 'EN_CURSO' ELSE 'CERRADO' END) AS estado_original,
         p.tipo_servicio AS detalle,
         CASE
           WHEN p.hora_salida IS NULL THEN 'EN_CURSO'
           WHEN UPPER(COALESCE(p.estado_pago, '')) = 'MENSUALIDAD' THEN 'MENSUALIDAD'
           WHEN UPPER(COALESCE(p.estado_pago, '')) = 'PAGADO'
             OR p.metodo_pago IS NOT NULL
             OR COALESCE(p.valor_total, 0) = 0 THEN 'PAGADO'
           ELSE 'PENDIENTE'
         END AS estado_cartera,
         c.id AS cliente_id,
         c.nombre AS cliente_nombre,
         c.documento AS cliente_documento,
         c.telefono AS cliente_telefono,
         c.correo AS cliente_correo
       FROM parqueadero p
       LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
       LEFT JOIN clientes c ON c.id = COALESCE(p.cliente_id, v.cliente_id)
       WHERE p.empresa_id = $1 AND p.id = $2
       LIMIT 1`,
      [empresaId, id]
    );
    return rows[0] || null;
  }

  if (modulo === "lavadero") {
    const { rows } = await db.query(
      `SELECT
         l.id::text AS referencia_id,
         'lavadero' AS modulo,
         'Lavadero' AS tipo,
         l.placa,
         COALESCE(l.hora_fin, l.hora_inicio, l.creado_en) AS fecha,
         l.hora_inicio AS inicio,
         l.hora_fin AS fin,
         NULL::int AS minutos_total,
         COALESCE(l.precio, 0) AS monto,
         l.metodo_pago,
         l.estado AS estado_original,
         COALESCE(tl.nombre, 'Servicio de lavado') AS detalle,
         CASE
           WHEN l.metodo_pago IS NOT NULL THEN 'PAGADO'
           WHEN l.estado = 'Completado' THEN 'PENDIENTE'
           ELSE 'EN_CURSO'
         END AS estado_cartera,
         c.id AS cliente_id,
         c.nombre AS cliente_nombre,
         c.documento AS cliente_documento,
         c.telefono AS cliente_telefono,
         c.correo AS cliente_correo
       FROM lavadero l
       LEFT JOIN tipos_lavado tl ON tl.id = l.tipo_lavado_id
       LEFT JOIN vehiculos v ON v.id = l.vehiculo_id
       LEFT JOIN clientes c ON c.id = COALESCE(l.cliente_id, v.cliente_id)
       WHERE l.empresa_id = $1 AND l.id = $2
       LIMIT 1`,
      [empresaId, id]
    );
    return rows[0] || null;
  }

  if (modulo === "taller") {
    const { rows } = await db.query(
      `SELECT
         t.id::text AS referencia_id,
         'taller' AS modulo,
         'Taller' AS tipo,
         t.placa,
         COALESCE(t.fecha_entrega, t.fecha_creacion) AS fecha,
         t.fecha_creacion AS inicio,
         t.fecha_entrega AS fin,
         NULL::int AS minutos_total,
         COALESCE(t.total_orden, 0) AS monto,
         t.metodo_pago,
         t.estado AS estado_original,
         COALESCE(t.descripcion_falla, 'Orden de taller') AS detalle,
         CASE
           WHEN t.metodo_pago IS NOT NULL THEN 'PAGADO'
           WHEN t.estado = 'Entregado' THEN 'PENDIENTE'
           ELSE 'EN_CURSO'
         END AS estado_cartera,
         c.id AS cliente_id,
         c.nombre AS cliente_nombre,
         c.documento AS cliente_documento,
         c.telefono AS cliente_telefono,
         c.correo AS cliente_correo
       FROM taller_ordenes t
       LEFT JOIN vehiculos v ON v.id = t.vehiculo_id
       LEFT JOIN clientes c ON c.id = COALESCE(t.cliente_id, v.cliente_id)
       WHERE t.empresa_id = $1 AND t.id = $2
       LIMIT 1`,
      [empresaId, id]
    );
    return rows[0] || null;
  }

  return null;
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
  let {
    parqueadero_id,
    monto,
    metodo_pago,
    referencia_transaccion,
    detalle_pago,
    estado,
  } = req.body || {};

  parqueadero_id = Number(parqueadero_id);
  metodo_pago = String(metodo_pago || "").trim().toUpperCase();
  referencia_transaccion = String(referencia_transaccion || "").trim() || null;
  estado = String(estado || "PAGADO").trim().toUpperCase();

  if (!parqueadero_id) {
    return res.status(400).json({ error: "Parqueadero es obligatorio." });
  }

  if (!metodo_pago) {
    return res.status(400).json({ error: "Debe seleccionar un método de pago." });
  }

  if (!METODOS_PAGO_VALIDOS.includes(metodo_pago)) {
    return res.status(400).json({
      error: `Método de pago inválido. Opciones válidas: ${METODOS_PAGO_VALIDOS.join(", ")}`,
    });
  }

  if (!ESTADOS_PAGO_VALIDOS.includes(estado)) {
    estado = "PAGADO";
  }

  let client;
  try {
    client = await db.connect();
    await client.query("BEGIN");

    const { rows: parqueaderoRows } = await client.query(
      `SELECT id, valor_total, metodo_pago, estado_pago
       FROM parqueadero
       WHERE id = $1 AND empresa_id = $2
       LIMIT 1`,
      [parqueadero_id, empresa_id]
    );

    if (parqueaderoRows.length === 0) {
      await client.query("ROLLBACK");
      client.release();
      client = null;
      return res.status(404).json({ error: "Servicio de parqueadero no encontrado." });
    }

    const registro = parqueaderoRows[0];
    const yaPagado = Boolean(String(registro.metodo_pago || "").trim())
      || ["PAGADO", "MENSUALIDAD"].includes(String(registro.estado_pago || "").toUpperCase());

    if (yaPagado) {
      await client.query("ROLLBACK");
      client.release();
      client = null;
      return res.status(409).json({ error: "Este servicio ya tiene un pago registrado." });
    }

    const montoFinal = Number.isFinite(Number(monto)) && Number(monto) > 0
      ? Number(monto)
      : toNumber(registro.valor_total);

    if (!Number.isFinite(montoFinal) || montoFinal < 0) {
      await client.query("ROLLBACK");
      client.release();
      client = null;
      return res.status(400).json({ error: "Monto inválido para registrar el pago." });
    }

    const detallePagoTexto = detalle_pago === undefined || detalle_pago === null
      ? null
      : typeof detalle_pago === "string"
        ? String(detalle_pago).trim() || null
        : JSON.stringify(detalle_pago);

    const { rows } = await client.query(
      `INSERT INTO pagos_parqueadero 
       (empresa_id, parqueadero_id, monto, metodo_pago, referencia_transaccion, estado, usuario_registro_id, fecha_pago)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING *`,
      [
        empresa_id,
        parqueadero_id,
        montoFinal,
        metodo_pago,
        referencia_transaccion,
        estado,
        usuario_id,
      ]
    );

    await client.query(
      `UPDATE parqueadero
       SET estado_pago = $3,
           metodo_pago = $4,
           detalle_pago = COALESCE($5, detalle_pago)
       WHERE id = $1 AND empresa_id = $2`,
      [parqueadero_id, empresa_id, estado, metodo_pago, detallePagoTexto]
    );

    await client.query("COMMIT");
    client.release();
    client = null;

    res.status(201).json(rows[0]);
  } catch (err) {
    try {
      if (client) await client.query("ROLLBACK");
    } catch (_) {}
    if (client) client.release();
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
