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
