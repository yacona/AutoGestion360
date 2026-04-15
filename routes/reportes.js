// routes/reportes.js
const express = require("express");
const router = express.Router();
const db = require("../db");
const auth = require("../middleware/auth");

// Todas las rutas de reportes requieren autenticación
router.use(auth);

/**
 * Función auxiliar:
 * Toma ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD del query
 * y genera un rango [desde 00:00:00, hasta 23:59:59].
 * Si no se envía, por defecto hoy.
 */
function obtenerRangoFechas(query) {
  const hoy = new Date();

  const parseFechaLocal = value => {
    if (!value) return new Date(hoy);
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return new Date(value);

    const [, year, month, day] = match;
    return new Date(Number(year), Number(month) - 1, Number(day));
  };

  let desde = parseFechaLocal(query.desde);
  let hasta = parseFechaLocal(query.hasta);

  // Normalizar a inicio / fin de día
  desde.setHours(0, 0, 0, 0);
  hasta.setHours(23, 59, 59, 999);

  return {
    desdeISO: desde.toISOString(),
    hastaISO: hasta.toISOString(),
  };
}

function toNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeMetodoPago(value) {
  const metodo = String(value || "SIN_METODO").trim().toUpperCase();
  return metodo || "SIN_METODO";
}

function buildCajaResumen(movimientos) {
  const resumen = {
    total_facturado: 0,
    total_recaudado: 0,
    total_pendiente: 0,
    servicios_total: movimientos.length,
    servicios_pagados: 0,
    servicios_pendientes: 0,
  };

  const metodos = new Map();
  const modulos = new Map();
  const responsables = new Map();

  for (const movimiento of movimientos) {
    const monto = toNumber(movimiento.monto);
    const modulo = movimiento.modulo || "sin_modulo";
    const metodo = normalizeMetodoPago(movimiento.metodo_pago);
    const responsable = movimiento.responsable_nombre || "Sin responsable";
    const pagado = movimiento.estado_caja === "PAGADO";

    resumen.total_facturado += monto;

    if (pagado) {
      resumen.servicios_pagados += 1;
      resumen.total_recaudado += monto;
    } else {
      resumen.servicios_pendientes += 1;
      resumen.total_pendiente += monto;
    }

    const moduloActual = modulos.get(modulo) || {
      modulo,
      cantidad: 0,
      pagados: 0,
      pendientes: 0,
      facturado: 0,
      recaudado: 0,
      pendiente: 0,
    };
    moduloActual.cantidad += 1;
    moduloActual.facturado += monto;
    if (pagado) {
      moduloActual.pagados += 1;
      moduloActual.recaudado += monto;
    } else {
      moduloActual.pendientes += 1;
      moduloActual.pendiente += monto;
    }
    modulos.set(modulo, moduloActual);

    if (pagado) {
      const metodoActual = metodos.get(metodo) || {
        metodo_pago: metodo,
        cantidad: 0,
        total: 0,
      };
      metodoActual.cantidad += 1;
      metodoActual.total += monto;
      metodos.set(metodo, metodoActual);
    }

    const responsableActual = responsables.get(responsable) || {
      responsable_nombre: responsable,
      cantidad: 0,
      recaudado: 0,
      pendiente: 0,
    };
    responsableActual.cantidad += 1;
    if (pagado) {
      responsableActual.recaudado += monto;
    } else {
      responsableActual.pendiente += monto;
    }
    responsables.set(responsable, responsableActual);
  }

  return {
    resumen,
    metodos_pago: Array.from(metodos.values()).sort((a, b) => b.total - a.total),
    modulos: Array.from(modulos.values()).sort((a, b) => b.facturado - a.facturado),
    responsables: Array.from(responsables.values()).sort((a, b) => b.recaudado - a.recaudado),
  };
}

function safeLimit(value, fallback = 20, max = 100) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

async function ensureArqueosCajaSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS arqueos_caja (
      id BIGSERIAL PRIMARY KEY,
      empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
      fecha_caja DATE NOT NULL,
      desde TIMESTAMPTZ NOT NULL,
      hasta TIMESTAMPTZ NOT NULL,
      total_facturado NUMERIC(14,2) DEFAULT 0,
      total_recaudado NUMERIC(14,2) DEFAULT 0,
      total_pendiente NUMERIC(14,2) DEFAULT 0,
      efectivo_sistema NUMERIC(14,2) DEFAULT 0,
      efectivo_contado NUMERIC(14,2) DEFAULT 0,
      diferencia NUMERIC(14,2) DEFAULT 0,
      servicios_total INTEGER DEFAULT 0,
      servicios_pagados INTEGER DEFAULT 0,
      servicios_pendientes INTEGER DEFAULT 0,
      metodos_pago JSONB DEFAULT '[]'::jsonb,
      modulos JSONB DEFAULT '[]'::jsonb,
      responsables JSONB DEFAULT '[]'::jsonb,
      observaciones TEXT,
      estado VARCHAR(30) DEFAULT 'CERRADO',
      creado_en TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS arqueos_caja_empresa_fecha_idx
    ON arqueos_caja (empresa_id, fecha_caja DESC, creado_en DESC)
  `);
}

async function obtenerCajaParaArqueo(empresa_id, desdeISO, hastaISO) {
  const { rows } = await db.query(
    `
    SELECT *
    FROM (
      SELECT
        'parqueadero' AS modulo,
        COALESCE(u.nombre, 'Caja parqueadero') AS responsable_nombre,
        CASE
          WHEN UPPER(COALESCE(p.estado_pago, '')) = 'MENSUALIDAD'
            OR COALESCE(p.valor_total, 0) = 0 THEN 'MENSUALIDAD'
          ELSE COALESCE(NULLIF(TRIM(p.metodo_pago), ''), 'SIN_METODO')
        END AS metodo_pago,
        COALESCE(p.valor_total, 0) AS monto,
        CASE
          WHEN COALESCE(p.valor_total, 0) = 0
            OR NULLIF(TRIM(COALESCE(p.metodo_pago, '')), '') IS NOT NULL
            OR UPPER(COALESCE(p.estado_pago, '')) IN ('PAGADO', 'MENSUALIDAD')
          THEN 'PAGADO'
          ELSE 'PENDIENTE'
        END AS estado_caja
      FROM parqueadero p
      LEFT JOIN usuarios u ON u.id = p.usuario_registro_id
      WHERE p.empresa_id = $1
        AND p.hora_salida IS NOT NULL
        AND p.hora_salida BETWEEN $2 AND $3

      UNION ALL

      SELECT
        'lavadero' AS modulo,
        COALESCE(e.nombre, 'Lavador sin asignar') AS responsable_nombre,
        COALESCE(NULLIF(TRIM(l.metodo_pago), ''), 'SIN_METODO') AS metodo_pago,
        COALESCE(l.precio, 0) AS monto,
        CASE
          WHEN COALESCE(l.precio, 0) = 0
            OR NULLIF(TRIM(COALESCE(l.metodo_pago, '')), '') IS NOT NULL
          THEN 'PAGADO'
          ELSE 'PENDIENTE'
        END AS estado_caja
      FROM lavadero l
      LEFT JOIN empleados e ON e.id = l.lavador_id
      WHERE l.empresa_id = $1
        AND l.estado = 'Completado'
        AND l.hora_fin IS NOT NULL
        AND l.hora_fin BETWEEN $2 AND $3

      UNION ALL

      SELECT
        'taller' AS modulo,
        COALESCE(e.nombre, 'Mecánico sin asignar') AS responsable_nombre,
        COALESCE(NULLIF(TRIM(t.metodo_pago), ''), 'SIN_METODO') AS metodo_pago,
        COALESCE(t.total_orden, 0) AS monto,
        CASE
          WHEN COALESCE(t.total_orden, 0) = 0
            OR NULLIF(TRIM(COALESCE(t.metodo_pago, '')), '') IS NOT NULL
          THEN 'PAGADO'
          ELSE 'PENDIENTE'
        END AS estado_caja
      FROM taller_ordenes t
      LEFT JOIN empleados e ON e.id = t.mecanico_id
      WHERE t.empresa_id = $1
        AND t.estado = 'Entregado'
        AND t.fecha_entrega IS NOT NULL
        AND t.fecha_entrega BETWEEN $2 AND $3
    ) movimientos
    `,
    [empresa_id, desdeISO, hastaISO]
  );

  const movimientos = rows.map((movimiento) => ({
    ...movimiento,
    monto: toNumber(movimiento.monto),
    metodo_pago: normalizeMetodoPago(movimiento.metodo_pago),
  }));

  return buildCajaResumen(movimientos);
}

/**
 * GET /api/reportes/resumen
 * Query: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD (opcional)
 *
 * Devuelve:
 * {
 *   desde, hasta,
 *   parqueadero: { total: number, cantidad: number },
 *   lavadero: { total: number, cantidad: number },
 *   taller: { total: number, cantidad: number },
 *   total_general: number
 * }
 */
router.get("/resumen", async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { desdeISO, hastaISO } = obtenerRangoFechas(req.query);

  try {
    // Total parqueadero
    const { rows: parqueaderoRows } = await db.query(
      `
      SELECT
        COALESCE(SUM(valor_total), 0) AS total,
        COUNT(*) AS cantidad
      FROM parqueadero
      WHERE empresa_id = $1
        AND hora_salida IS NOT NULL
        AND hora_salida BETWEEN $2 AND $3
      `,
      [empresa_id, desdeISO, hastaISO]
    );
    const totalParqueadero = Number(parqueaderoRows[0].total || 0);
    const cantidadParqueadero = Number(parqueaderoRows[0].cantidad || 0);

    // Total lavadero
    const { rows: lavaderoRows } = await db.query(
      `
      SELECT
        COALESCE(SUM(precio), 0) AS total,
        COUNT(*) AS cantidad
      FROM lavadero
      WHERE empresa_id = $1
        AND hora_fin IS NOT NULL
        AND hora_fin BETWEEN $2 AND $3
      `,
      [empresa_id, desdeISO, hastaISO]
    );
    const totalLavadero = Number(lavaderoRows[0].total || 0);
    const cantidadLavadero = Number(lavaderoRows[0].cantidad || 0);

    // Total taller
    const { rows: tallerRows } = await db.query(
      `
      SELECT
        COALESCE(SUM(total_orden), 0) AS total,
        COUNT(*) AS cantidad
      FROM taller_ordenes
      WHERE empresa_id = $1
        AND fecha_entrega IS NOT NULL
        AND fecha_entrega BETWEEN $2 AND $3
      `,
      [empresa_id, desdeISO, hastaISO]
    );
    const totalTaller = Number(tallerRows[0].total || 0);
    const cantidadTaller = Number(tallerRows[0].cantidad || 0);

    const totalGeneral = totalParqueadero + totalLavadero + totalTaller;
    const cantidadTotal = cantidadParqueadero + cantidadLavadero + cantidadTaller;

    res.json({
      desde: desdeISO,
      hasta: hastaISO,
      parqueadero: { total: totalParqueadero, cantidad: cantidadParqueadero },
      lavadero: { total: totalLavadero, cantidad: cantidadLavadero },
      taller: { total: totalTaller, cantidad: cantidadTaller },
      total_general: totalGeneral,
      cantidad_total: cantidadTotal,
    });
  } catch (err) {
    console.error("Error en reporte resumen:", err);
    res.status(500).json({ error: "Error generando reporte resumen." });
  }
});

/**
 * GET /api/reportes/diario
 * Query: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD (opcional)
 *
 * Devuelve una lista por día:
 * [
 *   {
 *     fecha: '2025-12-10',
 *     parqueadero: { total: number, cantidad: number },
 *     lavadero: { total: number, cantidad: number },
 *     taller: { total: number, cantidad: number },
 *     total_general: number
 *   },
 *   ...
 * ]
 */
router.get("/diario", async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { desdeISO, hastaISO } = obtenerRangoFechas(req.query);

  try {
    // PARQUEADERO agrupado por día
    const { rows: parqueaderoRows } = await db.query(
      `
      SELECT
        DATE(hora_salida) AS fecha,
        COALESCE(SUM(valor_total), 0) AS total,
        COUNT(*) AS cantidad
      FROM parqueadero
      WHERE empresa_id = $1
        AND hora_salida IS NOT NULL
        AND hora_salida BETWEEN $2 AND $3
      GROUP BY DATE(hora_salida)
      ORDER BY DATE(hora_salida)
      `,
      [empresa_id, desdeISO, hastaISO]
    );

    // LAVADERO agrupado por día
    const { rows: lavaderoRows } = await db.query(
      `
      SELECT
        DATE(hora_fin) AS fecha,
        COALESCE(SUM(precio), 0) AS total,
        COUNT(*) AS cantidad
      FROM lavadero
      WHERE empresa_id = $1
        AND hora_fin IS NOT NULL
        AND hora_fin BETWEEN $2 AND $3
      GROUP BY DATE(hora_fin)
      ORDER BY DATE(hora_fin)
      `,
      [empresa_id, desdeISO, hastaISO]
    );

    // TALLER agrupado por día
    const { rows: tallerRows } = await db.query(
      `
      SELECT
        DATE(fecha_entrega) AS fecha,
        COALESCE(SUM(total_orden), 0) AS total,
        COUNT(*) AS cantidad
      FROM taller_ordenes
      WHERE empresa_id = $1
        AND fecha_entrega IS NOT NULL
        AND fecha_entrega BETWEEN $2 AND $3
      GROUP BY DATE(fecha_entrega)
      ORDER BY DATE(fecha_entrega)
      `,
      [empresa_id, desdeISO, hastaISO]
    );

    // Combinar resultados por fecha en JS
    const mapa = new Map();

    const acumular = (rows, propiedad) => {
      for (const r of rows) {
        const fecha = r.fecha.toISOString().slice(0, 10); // YYYY-MM-DD
        const total = Number(r.total || 0);
        const cantidad = Number(r.cantidad || 0);
        if (!mapa.has(fecha)) {
          mapa.set(fecha, {
            fecha,
            parqueadero: { total: 0, cantidad: 0 },
            lavadero: { total: 0, cantidad: 0 },
            taller: { total: 0, cantidad: 0 },
            total_general: 0,
            cantidad_total: 0,
          });
        }
        const obj = mapa.get(fecha);
        obj[propiedad].total = total;
        obj[propiedad].cantidad = cantidad;
      }
    };

    acumular(parqueaderoRows, "parqueadero");
    acumular(lavaderoRows, "lavadero");
    acumular(tallerRows, "taller");

    // Convertir a arreglo y calcular totales
    const lista = Array.from(mapa.values()).sort((a, b) =>
      a.fecha.localeCompare(b.fecha)
    );

    for (const dia of lista) {
      dia.total_general = dia.parqueadero.total + dia.lavadero.total + dia.taller.total;
      dia.cantidad_total = dia.parqueadero.cantidad + dia.lavadero.cantidad + dia.taller.cantidad;
    }

    res.json({
      desde: desdeISO,
      hasta: hastaISO,
      dias: lista,
    });
  } catch (err) {
    console.error("Error en reporte diario:", err);
    res.status(500).json({ error: "Error generando reporte diario." });
  }
});

/**
 * GET /api/reportes/caja
 * Query: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 *
 * Consolida movimientos cerrados de parqueadero, lavadero y taller para
 * revisar recaudo, cartera pendiente, métodos de pago y responsables.
 */
router.get("/caja", async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { desdeISO, hastaISO } = obtenerRangoFechas(req.query);

  try {
    const { rows } = await db.query(
      `
      SELECT *
      FROM (
        SELECT
          'parqueadero' AS modulo,
          p.id AS referencia_id,
          p.hora_salida AS fecha,
          p.placa,
          COALESCE(c.nombre, p.nombre_cliente) AS cliente_nombre,
          COALESCE(u.nombre, 'Caja parqueadero') AS responsable_nombre,
          CASE
            WHEN UPPER(COALESCE(p.estado_pago, '')) = 'MENSUALIDAD'
              OR COALESCE(p.valor_total, 0) = 0 THEN 'MENSUALIDAD'
            ELSE COALESCE(NULLIF(TRIM(p.metodo_pago), ''), 'SIN_METODO')
          END AS metodo_pago,
          COALESCE(p.valor_total, 0) AS monto,
          CASE
            WHEN COALESCE(p.valor_total, 0) = 0
              OR NULLIF(TRIM(COALESCE(p.metodo_pago, '')), '') IS NOT NULL
              OR UPPER(COALESCE(p.estado_pago, '')) IN ('PAGADO', 'MENSUALIDAD')
            THEN 'PAGADO'
            ELSE 'PENDIENTE'
          END AS estado_caja,
          p.tipo_servicio AS concepto
        FROM parqueadero p
        LEFT JOIN clientes c ON c.id = p.cliente_id
        LEFT JOIN usuarios u ON u.id = p.usuario_registro_id
        WHERE p.empresa_id = $1
          AND p.hora_salida IS NOT NULL
          AND p.hora_salida BETWEEN $2 AND $3

        UNION ALL

        SELECT
          'lavadero' AS modulo,
          l.id AS referencia_id,
          l.hora_fin AS fecha,
          l.placa,
          c.nombre AS cliente_nombre,
          COALESCE(e.nombre, 'Lavador sin asignar') AS responsable_nombre,
          COALESCE(NULLIF(TRIM(l.metodo_pago), ''), 'SIN_METODO') AS metodo_pago,
          COALESCE(l.precio, 0) AS monto,
          CASE
            WHEN COALESCE(l.precio, 0) = 0
              OR NULLIF(TRIM(COALESCE(l.metodo_pago, '')), '') IS NOT NULL
            THEN 'PAGADO'
            ELSE 'PENDIENTE'
          END AS estado_caja,
          COALESCE(tl.nombre, 'Lavado') AS concepto
        FROM lavadero l
        LEFT JOIN clientes c ON c.id = l.cliente_id
        LEFT JOIN empleados e ON e.id = l.lavador_id
        LEFT JOIN tipos_lavado tl ON tl.id = l.tipo_lavado_id
        WHERE l.empresa_id = $1
          AND l.estado = 'Completado'
          AND l.hora_fin IS NOT NULL
          AND l.hora_fin BETWEEN $2 AND $3

        UNION ALL

        SELECT
          'taller' AS modulo,
          t.id AS referencia_id,
          t.fecha_entrega AS fecha,
          t.placa,
          c.nombre AS cliente_nombre,
          COALESCE(e.nombre, 'Mecánico sin asignar') AS responsable_nombre,
          COALESCE(NULLIF(TRIM(t.metodo_pago), ''), 'SIN_METODO') AS metodo_pago,
          COALESCE(t.total_orden, 0) AS monto,
          CASE
            WHEN COALESCE(t.total_orden, 0) = 0
              OR NULLIF(TRIM(COALESCE(t.metodo_pago, '')), '') IS NOT NULL
            THEN 'PAGADO'
            ELSE 'PENDIENTE'
          END AS estado_caja,
          COALESCE(t.descripcion_falla, 'Orden de taller') AS concepto
        FROM taller_ordenes t
        LEFT JOIN clientes c ON c.id = t.cliente_id
        LEFT JOIN empleados e ON e.id = t.mecanico_id
        WHERE t.empresa_id = $1
          AND t.estado = 'Entregado'
          AND t.fecha_entrega IS NOT NULL
          AND t.fecha_entrega BETWEEN $2 AND $3
      ) movimientos
      ORDER BY fecha DESC NULLS LAST
      `,
      [empresa_id, desdeISO, hastaISO]
    );

    const movimientos = rows.map((movimiento) => ({
      ...movimiento,
      monto: toNumber(movimiento.monto),
      metodo_pago: normalizeMetodoPago(movimiento.metodo_pago),
    }));

    const caja = buildCajaResumen(movimientos);

    res.json({
      desde: desdeISO,
      hasta: hastaISO,
      generado_en: new Date().toISOString(),
      ...caja,
      pendientes: movimientos.filter((movimiento) => movimiento.estado_caja === "PENDIENTE"),
      movimientos: movimientos.slice(0, 120),
    });
  } catch (err) {
    console.error("Error en reporte de caja:", err);
    res.status(500).json({ error: "Error generando reporte de caja." });
  }
});

// GET /api/reportes/caja/arqueos
router.get("/caja/arqueos", async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const limit = safeLimit(req.query.limit);

  try {
    await ensureArqueosCajaSchema();
    const { rows } = await db.query(
      `SELECT ac.*,
              u.nombre AS usuario_nombre,
              u.email AS usuario_email
       FROM arqueos_caja ac
       LEFT JOIN usuarios u ON u.id = ac.usuario_id
       WHERE ac.empresa_id = $1
       ORDER BY ac.fecha_caja DESC, ac.creado_en DESC
       LIMIT $2`,
      [empresa_id, limit]
    );

    res.json(rows);
  } catch (err) {
    console.error("Error listando arqueos de caja:", err);
    res.status(500).json({ error: "Error listando arqueos de caja." });
  }
});

// GET /api/reportes/caja/arqueos/:id
router.get("/caja/arqueos/:id", async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { id } = req.params;

  try {
    await ensureArqueosCajaSchema();
    const { rows } = await db.query(
      `SELECT ac.*,
              u.nombre AS usuario_nombre,
              u.email AS usuario_email
       FROM arqueos_caja ac
       LEFT JOIN usuarios u ON u.id = ac.usuario_id
       WHERE ac.empresa_id = $1 AND ac.id = $2
       LIMIT 1`,
      [empresa_id, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Arqueo no encontrado." });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Error obteniendo arqueo de caja:", err);
    res.status(500).json({ error: "Error obteniendo arqueo de caja." });
  }
});

// GET /api/reportes/caja/arqueos/:id/comprobante
router.get("/caja/arqueos/:id/comprobante", async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { id } = req.params;

  try {
    await ensureArqueosCajaSchema();
    const { rows } = await db.query(
      `SELECT ac.*,
              u.nombre AS usuario_nombre,
              u.email AS usuario_email,
              e.nombre AS empresa_nombre,
              e.nit,
              e.direccion,
              e.ciudad,
              e.telefono,
              e.email_contacto
       FROM arqueos_caja ac
       JOIN empresas e ON e.id = ac.empresa_id
       LEFT JOIN usuarios u ON u.id = ac.usuario_id
       WHERE ac.empresa_id = $1 AND ac.id = $2
       LIMIT 1`,
      [empresa_id, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Arqueo no encontrado." });
    }

    const arqueo = rows[0];
    const metodos_pago = Array.isArray(arqueo.metodos_pago) ? arqueo.metodos_pago : [];
    const modulos = Array.isArray(arqueo.modulos) ? arqueo.modulos : [];
    const responsables = Array.isArray(arqueo.responsables) ? arqueo.responsables : [];

    res.json({
      tipo: "arqueo",
      numero: `AG360-ARQUEO-${String(arqueo.id).padStart(6, "0")}`,
      generado_en: arqueo.creado_en,
      empresa: {
        nombre: arqueo.empresa_nombre,
        nit: arqueo.nit,
        direccion: arqueo.direccion,
        ciudad: arqueo.ciudad,
        telefono: arqueo.telefono,
        email_contacto: arqueo.email_contacto,
      },
      sujeto: {
        titulo: "Cierre de caja",
        nombre: arqueo.usuario_nombre || "Usuario no registrado",
        correo: arqueo.usuario_email || null,
      },
      resumen: {
        total_facturado: toNumber(arqueo.total_facturado),
        total_pagado: toNumber(arqueo.total_recaudado),
        total_pendiente: toNumber(arqueo.total_pendiente),
        servicios_total: Number(arqueo.servicios_total || 0),
        servicios_pagados: Number(arqueo.servicios_pagados || 0),
        servicios_pendientes: Number(arqueo.servicios_pendientes || 0),
        efectivo_sistema: toNumber(arqueo.efectivo_sistema),
        efectivo_contado: toNumber(arqueo.efectivo_contado),
        diferencia: toNumber(arqueo.diferencia),
      },
      arqueo: {
        id: arqueo.id,
        fecha_caja: arqueo.fecha_caja,
        desde: arqueo.desde,
        hasta: arqueo.hasta,
        estado: arqueo.estado,
        observaciones: arqueo.observaciones || "",
        metodos_pago,
        modulos,
        responsables,
      },
      movimientos: metodos_pago.map((metodo) => ({
        fecha: arqueo.fecha_caja,
        tipo: "Método de pago",
        modulo: "Caja",
        placa: "",
        detalle: metodo.metodo_pago,
        monto: toNumber(metodo.total),
        metodo_pago: `${Number(metodo.cantidad || 0)} servicio(s)`,
        estado_cartera: "Recaudado",
      })),
    });
  } catch (err) {
    console.error("Error generando comprobante de arqueo:", err);
    res.status(500).json({ error: "Error generando comprobante de arqueo." });
  }
});

// POST /api/reportes/caja/arqueos
router.post("/caja/arqueos", async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const usuario_id = req.user.id;
  const { desde, hasta, fecha_caja, efectivo_contado, observaciones } = req.body || {};

  if (!desde || !hasta) {
    return res.status(400).json({ error: "desde y hasta son obligatorios." });
  }

  const efectivoContado = toNumber(efectivo_contado);
  const { desdeISO, hastaISO } = obtenerRangoFechas({ desde, hasta });
  const fechaCaja = fecha_caja || hasta;

  try {
    await ensureArqueosCajaSchema();
    const caja = await obtenerCajaParaArqueo(empresa_id, desdeISO, hastaISO);
    const resumen = caja.resumen;
    const efectivoSistema = toNumber(
      caja.metodos_pago.find((metodo) => normalizeMetodoPago(metodo.metodo_pago) === "EFECTIVO")?.total
    );
    const diferencia = efectivoContado - efectivoSistema;

    const { rows } = await db.query(
      `INSERT INTO arqueos_caja
       (empresa_id, usuario_id, fecha_caja, desde, hasta,
        total_facturado, total_recaudado, total_pendiente,
        efectivo_sistema, efectivo_contado, diferencia,
        servicios_total, servicios_pagados, servicios_pendientes,
        metodos_pago, modulos, responsables, observaciones, estado)
       VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,$18,$19)
       RETURNING *`,
      [
        empresa_id,
        usuario_id,
        fechaCaja,
        desdeISO,
        hastaISO,
        resumen.total_facturado,
        resumen.total_recaudado,
        resumen.total_pendiente,
        efectivoSistema,
        efectivoContado,
        diferencia,
        resumen.servicios_total,
        resumen.servicios_pagados,
        resumen.servicios_pendientes,
        JSON.stringify(caja.metodos_pago),
        JSON.stringify(caja.modulos),
        JSON.stringify(caja.responsables),
        observaciones || null,
        "CERRADO",
      ]
    );

    res.status(201).json({
      mensaje: "Arqueo de caja guardado.",
      arqueo: rows[0],
    });
  } catch (err) {
    console.error("Error guardando arqueo de caja:", err);
    res.status(500).json({ error: "Error guardando arqueo de caja." });
  }
});

/**
 * GET /api/reportes/clientes
 * Query: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD (opcional)
 * Reporte de clientes más activos
 */
router.get("/clientes", async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { desdeISO, hastaISO } = obtenerRangoFechas(req.query);

  try {
    const { rows } = await db.query(
      `
      SELECT
        c.id,
        c.nombre,
        c.documento,
        c.telefono,
        COUNT(DISTINCT p.id) as servicios_parqueadero,
        COUNT(DISTINCT l.id) as servicios_lavadero,
        COUNT(DISTINCT t.id) as servicios_taller,
        COALESCE(SUM(p.valor_total), 0) as total_parqueadero,
        COALESCE(SUM(l.precio), 0) as total_lavadero,
        COALESCE(SUM(t.total_orden), 0) as total_taller,
        (COUNT(DISTINCT p.id) + COUNT(DISTINCT l.id) + COUNT(DISTINCT t.id)) as total_servicios,
        (COALESCE(SUM(p.valor_total), 0) + COALESCE(SUM(l.precio), 0) + COALESCE(SUM(t.total_orden), 0)) as total_gastado
      FROM clientes c
      LEFT JOIN vehiculos v ON v.cliente_id = c.id
      LEFT JOIN parqueadero p ON p.vehiculo_id = v.id AND p.hora_salida BETWEEN $2 AND $3
      LEFT JOIN lavadero l ON l.vehiculo_id = v.id AND l.hora_fin BETWEEN $2 AND $3
      LEFT JOIN taller_ordenes t ON t.vehiculo_id = v.id AND t.fecha_entrega BETWEEN $2 AND $3
      WHERE c.empresa_id = $1
      GROUP BY c.id, c.nombre, c.documento, c.telefono
      HAVING (COUNT(DISTINCT p.id) + COUNT(DISTINCT l.id) + COUNT(DISTINCT t.id)) > 0
      ORDER BY total_gastado DESC
      LIMIT 20
      `,
      [empresa_id, desdeISO, hastaISO]
    );

    res.json({
      desde: desdeISO,
      hasta: hastaISO,
      clientes: rows,
    });
  } catch (err) {
    console.error("Error en reporte clientes:", err);
    res.status(500).json({ error: "Error generando reporte de clientes." });
  }
});

/**
 * GET /api/reportes/empleados
 * Query: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD (opcional)
 * Reporte de rendimiento de empleados
 */
router.get("/empleados", async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { desdeISO, hastaISO } = obtenerRangoFechas(req.query);

  try {
    const { rows } = await db.query(
      `
      SELECT
        e.id,
        e.nombre,
        e.rol,
        COUNT(DISTINCT l.id) as lavados_realizados,
        COUNT(DISTINCT t.id) as ordenes_taller,
        COALESCE(SUM(l.precio), 0) as total_lavadero,
        COALESCE(SUM(t.total_orden), 0) as total_taller,
        (COALESCE(SUM(l.precio), 0) + COALESCE(SUM(t.total_orden), 0)) as total_general
      FROM empleados e
      LEFT JOIN lavadero l ON l.lavador_id = e.id AND l.hora_fin BETWEEN $2 AND $3
      LEFT JOIN taller_ordenes t ON t.mecanico_id = e.id AND t.fecha_entrega BETWEEN $2 AND $3
      WHERE e.empresa_id = $1 AND e.activo = true
      GROUP BY e.id, e.nombre, e.rol
      ORDER BY total_general DESC
      `,
      [empresa_id, desdeISO, hastaISO]
    );

    res.json({
      desde: desdeISO,
      hasta: hastaISO,
      empleados: rows,
    });
  } catch (err) {
    console.error("Error en reporte empleados:", err);
    res.status(500).json({ error: "Error generando reporte de empleados." });
  }
});

/**
 * GET /api/reportes/vehiculos
 * Query: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD (opcional)
 * Reporte de vehículos más atendidos
 */
router.get("/vehiculos", async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { desdeISO, hastaISO } = obtenerRangoFechas(req.query);

  try {
    const { rows } = await db.query(
      `
      SELECT
        v.id,
        v.placa,
        v.tipo_vehiculo,
        v.marca,
        v.modelo,
        c.nombre as cliente_nombre,
        COUNT(DISTINCT p.id) as servicios_parqueadero,
        COUNT(DISTINCT l.id) as servicios_lavadero,
        COUNT(DISTINCT t.id) as servicios_taller,
        COALESCE(SUM(p.valor_total), 0) as total_parqueadero,
        COALESCE(SUM(l.precio), 0) as total_lavadero,
        COALESCE(SUM(t.total_orden), 0) as total_taller,
        (COUNT(DISTINCT p.id) + COUNT(DISTINCT l.id) + COUNT(DISTINCT t.id)) as total_servicios,
        (COALESCE(SUM(p.valor_total), 0) + COALESCE(SUM(l.precio), 0) + COALESCE(SUM(t.total_orden), 0)) as total_gastado
      FROM vehiculos v
      INNER JOIN clientes c ON c.id = v.cliente_id
      LEFT JOIN parqueadero p ON p.vehiculo_id = v.id AND p.hora_salida BETWEEN $2 AND $3
      LEFT JOIN lavadero l ON l.vehiculo_id = v.id AND l.hora_fin BETWEEN $2 AND $3
      LEFT JOIN taller_ordenes t ON t.vehiculo_id = v.id AND t.fecha_entrega BETWEEN $2 AND $3
      WHERE v.empresa_id = $1
      GROUP BY v.id, v.placa, v.tipo_vehiculo, v.marca, v.modelo, c.nombre
      HAVING (COUNT(DISTINCT p.id) + COUNT(DISTINCT l.id) + COUNT(DISTINCT t.id)) > 0
      ORDER BY total_gastado DESC
      LIMIT 20
      `,
      [empresa_id, desdeISO, hastaISO]
    );

    res.json({
      desde: desdeISO,
      hasta: hastaISO,
      vehiculos: rows,
    });
  } catch (err) {
    console.error("Error en reporte vehiculos:", err);
    res.status(500).json({ error: "Error generando reporte de vehículos." });
  }
});

module.exports = router;
