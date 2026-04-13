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
  let desde = query.desde ? new Date(query.desde) : new Date(hoy);
  let hasta = query.hasta ? new Date(query.hasta) : new Date(hoy);

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
 *   parqueadero: { total: number },
 *   lavadero: { total: number },
 *   taller: { total: number },
 *   total_general: number
 * }
 */
router.get("/resumen", async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { desdeISO, hastaISO } = obtenerRangoFechas(req.query);

  try {
    // Total parqueadero (usando la vista parqueadero_historial)
    const { rows: parqueaderoRows } = await db.query(
      `
      SELECT COALESCE(SUM(valor_total), 0) AS total
      FROM parqueadero_historial
      WHERE empresa_id = $1
        AND hora_salida BETWEEN $2 AND $3
      `,
      [empresa_id, desdeISO, hastaISO]
    );
    const totalParqueadero = Number(parqueaderoRows[0].total || 0);

    // Total lavadero (usando la vista lavados)
    const { rows: lavaderoRows } = await db.query(
      `
      SELECT COALESCE(SUM(precio), 0) AS total
      FROM lavados
      WHERE empresa_id = $1
        AND hora_fin IS NOT NULL
        AND hora_fin BETWEEN $2 AND $3
      `,
      [empresa_id, desdeISO, hastaISO]
    );
    const totalLavadero = Number(lavaderoRows[0].total || 0);

    // Total taller (usando la vista ordenes_taller)
    const { rows: tallerRows } = await db.query(
      `
      SELECT COALESCE(SUM(total_orden), 0) AS total
      FROM ordenes_taller
      WHERE empresa_id = $1
        AND fecha_entrega IS NOT NULL
        AND fecha_entrega BETWEEN $2 AND $3
      `,
      [empresa_id, desdeISO, hastaISO]
    );
    const totalTaller = Number(tallerRows[0].total || 0);

    const totalGeneral = totalParqueadero + totalLavadero + totalTaller;

    res.json({
      desde: desdeISO,
      hasta: hastaISO,
      parqueadero: { total: totalParqueadero },
      lavadero: { total: totalLavadero },
      taller: { total: totalTaller },
      total_general: totalGeneral,
    });
  } catch (err) {
    console.error("🔥 Error en reporte resumen:", err);
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
 *     parqueadero: number,
 *     lavadero: number,
 *     taller: number,
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
        COALESCE(SUM(valor_total), 0) AS total
      FROM parqueadero_historial
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
        COALESCE(SUM(precio), 0) AS total
      FROM lavados
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
        COALESCE(SUM(total_orden), 0) AS total
      FROM ordenes_taller
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

    const acumular = (rows, campo, propiedad) => {
      for (const r of rows) {
        const fecha = r.fecha.toISOString().slice(0, 10); // YYYY-MM-DD
        const total = Number(r.total || 0);
        if (!mapa.has(fecha)) {
          mapa.set(fecha, {
            fecha,
            parqueadero: 0,
            lavadero: 0,
            taller: 0,
          });
        }
        const obj = mapa.get(fecha);
        obj[propiedad] = total;
      }
    };

    acumular(parqueaderoRows, "fecha", "parqueadero");
    acumular(lavaderoRows, "fecha", "lavadero");
    acumular(tallerRows, "fecha", "taller");

    // Convertir a arreglo y calcular total_general
    const lista = Array.from(mapa.values()).sort((a, b) =>
      a.fecha.localeCompare(b.fecha)
    );

    for (const dia of lista) {
      dia.total_general = dia.parqueadero + dia.lavadero + dia.taller;
    }

    res.json({
      desde: desdeISO,
      hasta: hastaISO,
      dias: lista,
    });
  } catch (err) {
    console.error("🔥 Error en reporte diario:", err);
    res.status(500).json({ error: "Error generando reporte diario." });
  }
});

module.exports = router;