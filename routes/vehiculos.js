const express = require("express");
const db = require("../db");
const auth = require("../middleware/auth");
const router = express.Router();

function normalizarPlaca(value) {
  return String(value || "").toUpperCase().replace(/\s+/g, "").trim();
}

function toNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Crear vehículo
 */
router.post("/", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { cliente_id, placa, tipo, tipo_vehiculo, marca, modelo, color } = req.body;
  const tipoFinal = tipo_vehiculo || tipo;

  if (!placa || !tipoFinal) {
    return res.status(400).json({ error: "Placa y tipo son obligatorios." });
  }

  const placaNormalizada = normalizarPlaca(placa);

  try {
    // 1️⃣ Verificar si ya existe un vehículo con esa placa para esa empresa
    const { rows: existentes } = await db.query(
      `SELECT v.*, c.nombre AS cliente_nombre
       FROM vehiculos v
       LEFT JOIN clientes c ON c.id = v.cliente_id
       WHERE v.empresa_id = $1 AND v.placa = $2
       LIMIT 1`,
      [empresa_id, placaNormalizada]
    );

    if (existentes.length > 0) {
      return res.status(400).json({
        error: "Ya existe un vehículo con esa placa en esta empresa.",
        vehiculo_existente: existentes[0],
      });
    }

    // 2️⃣ Insertar vehículo nuevo
    const result = await db.query(
      `INSERT INTO vehiculos 
       (empresa_id, cliente_id, placa, tipo_vehiculo, marca, modelo, color)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        empresa_id,
        cliente_id || null,
        placaNormalizada,
        String(tipoFinal).toUpperCase().trim(),
        marca || null,
        modelo || null,
        color || null,
      ]
    );

    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err);

    // Por si la BD lanza error UNIQUE
    if (err.code === "23505") {
      return res
        .status(400)
        .json({ error: "Esa placa ya está registrada en esta empresa." });
    }

    res.status(500).json({ error: "Error creando vehículo." });
  }
});

/**
 * Perfil 360 de un vehículo por placa.
 */
router.get("/perfil/:placa", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const placa = normalizarPlaca(req.params.placa);

  if (!placa) {
    return res.status(400).json({ error: "Debe enviar una placa." });
  }

  try {
    const { rows: vehiculos } = await db.query(
      `SELECT
         v.id,
         v.placa,
         v.tipo_vehiculo,
         v.marca,
         v.modelo,
         v.color,
         v.creado_en AS fecha_registro,
         c.id AS cliente_id,
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

    const vehiculoDb = vehiculos[0] || null;

    const { rows: mensualidades } = await db.query(
      `SELECT
         mp.*,
         COUNT(p.id)::int AS ingresos_registrados,
         MAX(p.hora_entrada) AS ultimo_ingreso,
         CASE
           WHEN mp.estado = 'ACTIVA' AND CURRENT_DATE BETWEEN mp.fecha_inicio AND mp.fecha_fin
           THEN GREATEST(0, (mp.fecha_fin - CURRENT_DATE))::int
           ELSE NULL
         END AS dias_restantes
       FROM mensualidades_parqueadero mp
       LEFT JOIN parqueadero p
         ON p.mensualidad_id = mp.id
        AND p.empresa_id = mp.empresa_id
       WHERE mp.empresa_id = $1 AND mp.placa = $2
       GROUP BY mp.id
       ORDER BY
         CASE WHEN mp.estado = 'ACTIVA' AND CURRENT_DATE BETWEEN mp.fecha_inicio AND mp.fecha_fin THEN 0 ELSE 1 END,
         mp.fecha_fin DESC,
         mp.creado_en DESC`,
      [empresa_id, placa]
    );

    const mensualidadActiva = mensualidades.find((mensualidad) => {
      const activa = mensualidad.estado === "ACTIVA";
      const inicio = mensualidad.fecha_inicio ? new Date(mensualidad.fecha_inicio) : null;
      const fin = mensualidad.fecha_fin ? new Date(mensualidad.fecha_fin) : null;
      const hoy = new Date();
      return activa && (!inicio || inicio <= hoy) && (!fin || fin >= hoy);
    }) || null;

    const { rows: activoRows } = await db.query(
      `SELECT id, hora_entrada, tipo_servicio, nombre_cliente, telefono, observaciones
       FROM parqueadero
       WHERE empresa_id = $1 AND placa = $2 AND hora_salida IS NULL
       ORDER BY hora_entrada DESC
       LIMIT 1`,
      [empresa_id, placa]
    );

    const activoParqueadero = activoRows[0] || null;

    const { rows: resumenRows } = await db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM parqueadero WHERE empresa_id = $1 AND placa = $2) AS total_parqueadero,
         (SELECT COALESCE(SUM(valor_total), 0) FROM parqueadero WHERE empresa_id = $1 AND placa = $2) AS ingresos_parqueadero,
         (SELECT MAX(COALESCE(hora_salida, hora_entrada, creado_en)) FROM parqueadero WHERE empresa_id = $1 AND placa = $2) AS ultima_parqueadero,
         (SELECT COUNT(*)::int FROM lavadero WHERE empresa_id = $1 AND placa = $2) AS total_lavadero,
         (SELECT COALESCE(SUM(precio), 0) FROM lavadero WHERE empresa_id = $1 AND placa = $2) AS ingresos_lavadero,
         (SELECT MAX(COALESCE(hora_fin, hora_inicio, creado_en)) FROM lavadero WHERE empresa_id = $1 AND placa = $2) AS ultima_lavadero,
         (SELECT COUNT(*)::int FROM taller_ordenes WHERE empresa_id = $1 AND placa = $2) AS total_taller,
         (SELECT COALESCE(SUM(total_orden), 0) FROM taller_ordenes WHERE empresa_id = $1 AND placa = $2) AS ingresos_taller,
         (SELECT MAX(COALESCE(fecha_entrega, fecha_creacion)) FROM taller_ordenes WHERE empresa_id = $1 AND placa = $2) AS ultima_taller`,
      [empresa_id, placa]
    );

    const resumen = resumenRows[0] || {};

    const { rows: historial } = await db.query(
      `SELECT
         referencia_id,
         tipo,
         fecha,
         monto,
         estado,
         metodo_pago,
         detalle
       FROM (
         SELECT
           p.id AS referencia_id,
           'Parqueadero' AS tipo,
           COALESCE(p.hora_salida, p.hora_entrada, p.creado_en) AS fecha,
           p.valor_total AS monto,
           CASE WHEN p.hora_salida IS NULL THEN 'EN_PARQUEADERO' ELSE COALESCE(p.estado_pago, 'CERRADO') END AS estado,
           p.metodo_pago,
           p.tipo_servicio AS detalle
         FROM parqueadero p
         WHERE p.empresa_id = $1 AND p.placa = $2
         UNION ALL
         SELECT
           l.id AS referencia_id,
           'Lavadero' AS tipo,
           COALESCE(l.hora_fin, l.hora_inicio, l.creado_en) AS fecha,
           l.precio AS monto,
           l.estado,
           l.metodo_pago,
           'Servicio de lavado' AS detalle
         FROM lavadero l
         WHERE l.empresa_id = $1 AND l.placa = $2
         UNION ALL
         SELECT
           t.id AS referencia_id,
           'Taller' AS tipo,
           COALESCE(t.fecha_entrega, t.fecha_creacion) AS fecha,
           t.total_orden AS monto,
           t.estado,
           t.metodo_pago,
           COALESCE(t.descripcion_falla, 'Orden de taller') AS detalle
         FROM taller_ordenes t
         WHERE t.empresa_id = $1 AND t.placa = $2
       ) movimientos
       ORDER BY fecha DESC NULLS LAST
       LIMIT 30`,
      [empresa_id, placa]
    );

    const totalParqueadero = toNumber(resumen.total_parqueadero);
    const totalLavadero = toNumber(resumen.total_lavadero);
    const totalTaller = toNumber(resumen.total_taller);
    const ingresosParqueadero = toNumber(resumen.ingresos_parqueadero);
    const ingresosLavadero = toNumber(resumen.ingresos_lavadero);
    const ingresosTaller = toNumber(resumen.ingresos_taller);
    const ultimaActividad = [
      resumen.ultima_parqueadero,
      resumen.ultima_lavadero,
      resumen.ultima_taller,
      vehiculoDb?.fecha_registro,
      mensualidadActiva?.ultimo_ingreso,
    ].filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null;

    const vehiculo = vehiculoDb
      ? {
          id: vehiculoDb.id,
          placa: vehiculoDb.placa,
          tipo_vehiculo: vehiculoDb.tipo_vehiculo,
          marca: vehiculoDb.marca,
          modelo: vehiculoDb.modelo,
          color: vehiculoDb.color,
          fecha_registro: vehiculoDb.fecha_registro,
        }
      : mensualidadActiva
        ? {
            id: mensualidadActiva.vehiculo_id,
            placa: mensualidadActiva.placa,
            tipo_vehiculo: mensualidadActiva.tipo_vehiculo,
            marca: null,
            modelo: null,
            color: null,
            fecha_registro: mensualidadActiva.creado_en,
          }
        : null;

    const propietario = vehiculoDb?.cliente_id
      ? {
          id: vehiculoDb.cliente_id,
          nombre: vehiculoDb.cliente_nombre,
          documento: vehiculoDb.cliente_documento,
          telefono: vehiculoDb.cliente_telefono,
          correo: vehiculoDb.cliente_correo,
        }
      : mensualidadActiva
        ? {
            id: mensualidadActiva.cliente_id,
            nombre: mensualidadActiva.nombre_cliente,
            documento: mensualidadActiva.documento,
            telefono: mensualidadActiva.telefono,
            correo: mensualidadActiva.correo,
          }
        : null;

    res.json({
      placa,
      existe: Boolean(vehiculo || historial.length || mensualidades.length),
      estado: activoParqueadero
        ? "EN_PARQUEADERO"
        : mensualidadActiva
          ? "MENSUALIDAD_ACTIVA"
          : vehiculo
            ? "REGISTRADO"
            : "SIN_REGISTRO",
      vehiculo,
      propietario,
      activo_parqueadero: activoParqueadero,
      mensualidad: mensualidadActiva,
      mensualidades,
      historial,
      estadisticas: {
        total_servicios: totalParqueadero + totalLavadero + totalTaller,
        total_gastado: ingresosParqueadero + ingresosLavadero + ingresosTaller,
        ultima_actividad: ultimaActividad,
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
    console.error("Error obteniendo perfil 360 de vehículo:", err);
    res.status(500).json({ error: "Error obteniendo perfil 360 del vehículo." });
  }
});

/**
 * Buscar vehículo por placa
 */
router.get("/:placa", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const placa = normalizarPlaca(req.params.placa);

  try {
    const { rows } = await db.query(
      `SELECT v.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono
       FROM vehiculos v
       LEFT JOIN clientes c ON c.id = v.cliente_id
       WHERE v.empresa_id = $1 AND v.placa = $2
       LIMIT 1`,
      [empresa_id, placa]
    );

    if (rows.length === 0) {
      return res.json({ existe: false });
    }

    res.json({
      existe: true,
      vehiculo: rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error consultando vehículo." });
  }
});

module.exports = router;
