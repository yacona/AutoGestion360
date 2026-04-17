const db = require("../db");
const { ensurePagosServiciosSchema } = require("./pagos-servicios-schema");

function toNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

const METODOS_PAGO_VALIDOS = ["EFECTIVO", "TARJETA", "TRANSFERENCIA", "MIXTO", "OTRO", "MENSUALIDAD"];
const SERVICE_MODULES = new Set(["parqueadero", "lavadero", "taller"]);

function normalizarModulo(value) {
  const modulo = String(value || "").trim().toLowerCase();
  return SERVICE_MODULES.has(modulo) ? modulo : "";
}

function buildPagosServiciosJoin(modulo, referenceExpr, alias) {
  return `
    LEFT JOIN (
      SELECT
        referencia_id,
        COALESCE(SUM(monto), 0) AS total_pagado,
        COUNT(*)::int AS cantidad_pagos,
        COUNT(
          DISTINCT UPPER(COALESCE(NULLIF(TRIM(metodo_pago), ''), 'SIN_METODO'))
        )::int AS metodos_distintos,
        MAX(metodo_pago) FILTER (
          WHERE NULLIF(TRIM(COALESCE(metodo_pago, '')), '') IS NOT NULL
        ) AS ultimo_metodo_pago,
        MAX(fecha_pago) AS ultimo_pago
      FROM pagos_servicios
      WHERE empresa_id = $1
        AND modulo = '${modulo}'
        AND estado = 'APLICADO'
      GROUP BY referencia_id
    ) ${alias} ON ${alias}.referencia_id = ${referenceExpr}
  `;
}

function resolverMetodoPagoMovimiento(movimiento, legacyPaid, estadoCartera) {
  if (estadoCartera === "MENSUALIDAD") return "MENSUALIDAD";

  const baseMethod = String(movimiento.metodo_pago_base || "").trim() || null;
  const ultimoMetodo = String(movimiento.ultimo_metodo_pago || "").trim() || null;
  const metodosDistintos = Number(movimiento.metodos_distintos || 0);
  const montoPagado = toNumber(movimiento.monto_pagado);

  if (legacyPaid && baseMethod) return baseMethod;
  if (montoPagado <= 0) return baseMethod;
  if (metodosDistintos > 1) return "MIXTO";
  return baseMethod || ultimoMetodo || null;
}

function enriquecerMovimientoPago(movimiento = {}) {
  const modulo = normalizarModulo(movimiento.modulo);
  const monto = toNumber(movimiento.monto);
  const totalPagadoRegistrado = toNumber(movimiento.total_pagado_registrado);
  const servicioCerrado = Boolean(movimiento.servicio_cerrado);
  const legacyPaid = Boolean(movimiento.legacy_paid);
  const tipoServicio = String(movimiento.tipo_servicio || "").toUpperCase();
  const mensualidad = modulo === "parqueadero"
    && (tipoServicio === "MENSUALIDAD" || String(movimiento.estado_original || "").toUpperCase() === "MENSUALIDAD");

  let estadoCartera = "PENDIENTE";
  let montoPagado = Math.min(monto, totalPagadoRegistrado);

  if (mensualidad) {
    estadoCartera = "MENSUALIDAD";
    montoPagado = monto;
  } else if (!servicioCerrado) {
    estadoCartera = "EN_CURSO";
  } else if (legacyPaid) {
    estadoCartera = "PAGADO";
    montoPagado = monto;
  } else if (montoPagado >= monto) {
    estadoCartera = "PAGADO";
    montoPagado = monto;
  } else if (montoPagado > 0) {
    estadoCartera = "ABONADO";
  }

  const saldoPendiente = ["PAGADO", "MENSUALIDAD"].includes(estadoCartera)
    ? 0
    : Math.max(monto - montoPagado, 0);

  const metodoPago = resolverMetodoPagoMovimiento(
    { ...movimiento, monto_pagado: montoPagado },
    legacyPaid,
    estadoCartera
  );

  return {
    ...movimiento,
    modulo,
    monto,
    monto_pagado: montoPagado,
    saldo_pendiente: saldoPendiente,
    pagos_count: Number(movimiento.cantidad_pagos || 0),
    metodo_pago: metodoPago,
    estado_cartera: estadoCartera,
  };
}

function buildFinalPaymentDetail({ detallePago, totalPagado, saldoPendiente, pagosCount }) {
  const base = detallePago && typeof detallePago === "object" ? { ...detallePago } : {};
  return {
    ...base,
    total_pagado: totalPagado,
    saldo_pendiente: saldoPendiente,
    pagos_registrados: pagosCount,
  };
}

async function obtenerPagosServicioResumen(queryable, empresaId, modulo, referenciaId) {
  await ensurePagosServiciosSchema(queryable);

  const { rows } = await queryable.query(
    `SELECT
       COALESCE(SUM(monto), 0) AS total_pagado,
       COUNT(*)::int AS cantidad_pagos,
       COUNT(
         DISTINCT UPPER(COALESCE(NULLIF(TRIM(metodo_pago), ''), 'SIN_METODO'))
       )::int AS metodos_distintos,
       MAX(metodo_pago) FILTER (
         WHERE NULLIF(TRIM(COALESCE(metodo_pago, '')), '') IS NOT NULL
       ) AS ultimo_metodo_pago,
       MAX(fecha_pago) AS ultimo_pago
     FROM pagos_servicios
     WHERE empresa_id = $1
       AND modulo = $2
       AND referencia_id = $3
       AND estado = 'APLICADO'`,
    [empresaId, modulo, referenciaId]
  );

  return rows[0] || {
    total_pagado: 0,
    cantidad_pagos: 0,
    metodos_distintos: 0,
    ultimo_metodo_pago: null,
    ultimo_pago: null,
  };
}

async function obtenerServicioBase(queryable, empresaId, modulo, id) {
  if (modulo === "parqueadero") {
    const { rows } = await queryable.query(
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
         COALESCE(u.nombre, 'Caja parqueadero') AS responsable_nombre,
         c.id AS cliente_id,
         c.nombre AS cliente_nombre,
         c.documento AS cliente_documento,
         c.telefono AS cliente_telefono,
         c.correo AS cliente_correo
       FROM parqueadero p
       LEFT JOIN vehiculos v ON v.id = p.vehiculo_id
       LEFT JOIN clientes c ON c.id = COALESCE(p.cliente_id, v.cliente_id)
       LEFT JOIN usuarios u ON u.id = p.usuario_registro_id
       WHERE p.empresa_id = $1 AND p.id = $2
       LIMIT 1`,
      [empresaId, id]
    );
    return rows[0] || null;
  }

  if (modulo === "lavadero") {
    const { rows } = await queryable.query(
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
         l.metodo_pago AS metodo_pago_base,
         l.estado AS estado_original,
         COALESCE(tl.nombre, 'Servicio de lavado') AS detalle,
         NULL::varchar AS tipo_servicio,
         CASE WHEN l.estado = 'Completado' THEN TRUE ELSE FALSE END AS servicio_cerrado,
         CASE
           WHEN NULLIF(TRIM(COALESCE(l.metodo_pago, '')), '') IS NOT NULL
             OR COALESCE(l.precio, 0) = 0
           THEN TRUE
           ELSE FALSE
         END AS legacy_paid,
         COALESCE(e.nombre, 'Lavador sin asignar') AS responsable_nombre,
         c.id AS cliente_id,
         c.nombre AS cliente_nombre,
         c.documento AS cliente_documento,
         c.telefono AS cliente_telefono,
         c.correo AS cliente_correo
       FROM lavadero l
       LEFT JOIN tipos_lavado tl ON tl.id = l.tipo_lavado_id
       LEFT JOIN vehiculos v ON v.id = l.vehiculo_id
       LEFT JOIN clientes c ON c.id = COALESCE(l.cliente_id, v.cliente_id)
       LEFT JOIN empleados e ON e.id = l.lavador_id
       WHERE l.empresa_id = $1 AND l.id = $2
       LIMIT 1`,
      [empresaId, id]
    );
    return rows[0] || null;
  }

  if (modulo === "taller") {
    const { rows } = await queryable.query(
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
         COALESCE(e.nombre, 'Mecanico sin asignar') AS responsable_nombre,
         c.id AS cliente_id,
         c.nombre AS cliente_nombre,
         c.documento AS cliente_documento,
         c.telefono AS cliente_telefono,
         c.correo AS cliente_correo
       FROM taller_ordenes t
       LEFT JOIN vehiculos v ON v.id = t.vehiculo_id
       LEFT JOIN clientes c ON c.id = COALESCE(t.cliente_id, v.cliente_id)
       LEFT JOIN empleados e ON e.id = t.mecanico_id
       WHERE t.empresa_id = $1 AND t.id = $2
       LIMIT 1`,
      [empresaId, id]
    );
    return rows[0] || null;
  }

  return null;
}

async function obtenerServicioRecibo(empresaId, modulo, id, queryable = db) {
  const servicio = await obtenerServicioBase(queryable, empresaId, modulo, id);
  if (!servicio) return null;

  const resumenPagos = await obtenerPagosServicioResumen(
    queryable,
    empresaId,
    modulo,
    Number(servicio.referencia_id)
  );

  return enriquecerMovimientoPago({
    ...servicio,
    total_pagado_registrado: resumenPagos.total_pagado,
    cantidad_pagos: resumenPagos.cantidad_pagos,
    metodos_distintos: resumenPagos.metodos_distintos,
    ultimo_metodo_pago: resumenPagos.ultimo_metodo_pago,
    ultimo_pago: resumenPagos.ultimo_pago,
  });
}

async function actualizarEstadoPagoServicio(queryable, {
  empresaId,
  modulo,
  referenciaId,
  pagoCompleto,
  metodoPago,
  detalleFinal,
}) {
  const detalleJson = detalleFinal ? JSON.stringify(detalleFinal) : null;

  if (modulo === "parqueadero") {
    await queryable.query(
      `UPDATE parqueadero
       SET estado_pago = $3,
           metodo_pago = $4,
           detalle_pago = COALESCE($5, detalle_pago)
       WHERE id = $1 AND empresa_id = $2`,
      [
        referenciaId,
        empresaId,
        pagoCompleto ? "PAGADO" : "PENDIENTE",
        pagoCompleto ? metodoPago : null,
        detalleJson,
      ]
    );
    return;
  }

  if (modulo === "lavadero") {
    await queryable.query(
      `UPDATE lavadero
       SET metodo_pago = $1,
           detalle_pago = COALESCE($2::jsonb, detalle_pago)
       WHERE id = $3 AND empresa_id = $4`,
      [pagoCompleto ? metodoPago : null, detalleJson, referenciaId, empresaId]
    );
    return;
  }

  if (modulo === "taller") {
    await queryable.query(
      `UPDATE ordenes_taller
       SET metodo_pago = $1,
           detalle_pago = COALESCE($2::jsonb, detalle_pago)
       WHERE id = $3 AND empresa_id = $4`,
      [pagoCompleto ? metodoPago : null, detalleJson, referenciaId, empresaId]
    );
  }
}

async function registrarPagoServicio({
  queryable = db,
  empresaId,
  usuarioId,
  modulo,
  referenciaId,
  monto,
  metodoPago,
  referenciaTransaccion = null,
  detallePago = null,
}) {
  const moduloNormalizado = normalizarModulo(modulo);
  const referenciaNormalizada = Number(referenciaId);
  const metodoNormalizado = String(metodoPago || "").trim().toUpperCase();
  const referenciaLimpia = String(referenciaTransaccion || "").trim() || null;

  if (!moduloNormalizado) {
    const error = new Error("Debe enviar un modulo valido.");
    error.status = 400;
    throw error;
  }

  if (!referenciaNormalizada) {
    const error = new Error("Debe enviar una referencia valida.");
    error.status = 400;
    throw error;
  }

  if (!METODOS_PAGO_VALIDOS.includes(metodoNormalizado)) {
    const error = new Error(`Metodo de pago invalido. Opciones validas: ${METODOS_PAGO_VALIDOS.join(", ")}`);
    error.status = 400;
    throw error;
  }

  await ensurePagosServiciosSchema(queryable);

  const servicioActual = await obtenerServicioRecibo(
    empresaId,
    moduloNormalizado,
    referenciaNormalizada,
    queryable
  );

  if (!servicioActual) {
    const error = new Error("Servicio no encontrado.");
    error.status = 404;
    throw error;
  }

  if (servicioActual.estado_cartera === "EN_CURSO") {
    const error = new Error("El servicio debe cerrarse antes de registrar abonos o pagos.");
    error.status = 409;
    throw error;
  }

  if (servicioActual.estado_cartera === "MENSUALIDAD") {
    const error = new Error("Este servicio esta cubierto por mensualidad y no requiere cobro adicional.");
    error.status = 409;
    throw error;
  }

  if (toNumber(servicioActual.saldo_pendiente) <= 0) {
    const error = new Error("Este servicio ya esta totalmente pagado.");
    error.status = 409;
    throw error;
  }

  const montoPropuesto = Number.isFinite(Number(monto)) ? Number(monto) : 0;
  const montoFinal = montoPropuesto > 0 ? montoPropuesto : toNumber(servicioActual.saldo_pendiente);

  if (!Number.isFinite(montoFinal) || montoFinal <= 0) {
    const error = new Error("El monto del pago debe ser mayor que cero.");
    error.status = 400;
    throw error;
  }

  if (montoFinal - toNumber(servicioActual.saldo_pendiente) > 0.01) {
    const error = new Error("El abono no puede ser mayor al saldo pendiente.");
    error.status = 400;
    throw error;
  }

  const detalleJson = detallePago === undefined || detallePago === null
    ? null
    : typeof detallePago === "string"
      ? { detalle: String(detallePago).trim() }
      : detallePago;

  const { rows } = await queryable.query(
    `INSERT INTO pagos_servicios
     (empresa_id, modulo, referencia_id, monto, metodo_pago, referencia_transaccion, detalle_pago, estado, usuario_registro_id, fecha_pago)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'APLICADO', $8, NOW())
     RETURNING *`,
    [
      empresaId,
      moduloNormalizado,
      referenciaNormalizada,
      montoFinal,
      metodoNormalizado,
      referenciaLimpia,
      detalleJson ? JSON.stringify(detalleJson) : null,
      usuarioId,
    ]
  );

  const pago = rows[0];
  const totalPagado = Math.min(
    toNumber(servicioActual.monto),
    toNumber(servicioActual.monto_pagado) + montoFinal
  );
  const saldoPendiente = Math.max(toNumber(servicioActual.monto) - totalPagado, 0);
  const pagoCompleto = saldoPendiente <= 0.01;
  const metodoAnterior = String(servicioActual.metodo_pago || "").trim() || null;
  const metodosDistintosPrevios = Number(servicioActual.metodos_distintos || 0);
  const metodosDistintos = metodosDistintosPrevios > 1
    ? metodosDistintosPrevios
    : metodoAnterior && !["MIXTO", "MENSUALIDAD"].includes(metodoAnterior) && metodoAnterior !== metodoNormalizado
      ? 2
      : Math.max(metodosDistintosPrevios, metodoAnterior || metodoNormalizado ? 1 : 0);
  const metodoResumen = metodosDistintos > 1 ? "MIXTO" : (metodoAnterior || metodoNormalizado);

  const detalleFinal = buildFinalPaymentDetail({
    detallePago: detalleJson,
    totalPagado,
    saldoPendiente,
    pagosCount: Number(servicioActual.pagos_count || 0) + 1,
  });

  await actualizarEstadoPagoServicio(queryable, {
    empresaId,
    modulo: moduloNormalizado,
    referenciaId: referenciaNormalizada,
    pagoCompleto,
    metodoPago: metodoResumen,
    detalleFinal,
  });

  return {
    pago: {
      ...pago,
      monto: toNumber(pago.monto),
    },
    servicio: {
      ...servicioActual,
      monto_pagado: totalPagado,
      saldo_pendiente: saldoPendiente,
      pagos_count: Number(servicioActual.pagos_count || 0) + 1,
      metodos_distintos: metodosDistintos,
      metodo_pago: totalPagado > 0 ? metodoResumen : null,
      estado_cartera: pagoCompleto ? "PAGADO" : "ABONADO",
    },
  };
}

module.exports = {
  METODOS_PAGO_VALIDOS,
  actualizarEstadoPagoServicio,
  buildPagosServiciosJoin,
  enriquecerMovimientoPago,
  normalizarModulo,
  obtenerPagosServicioResumen,
  obtenerServicioBase,
  obtenerServicioRecibo,
  registrarPagoServicio,
  toNumber,
};
