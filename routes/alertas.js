// routes/alertas.js
const express = require("express");
const db = require("../db");
const auth = require("../middleware/auth");
const { ensurePagosServiciosSchema } = require("../utils/pagos-servicios-schema");

const router = express.Router();

const ALERT_THRESHOLDS = {
  licenciaDias: 30,
  mensualidadDias: 7,
  parqueaderoHoras: 8,
  lavaderoHoras: 4,
  tallerHoras: 48,
  ocupacionPorcentaje: 85,
};

const SEVERITY_ORDER = {
  CRITICA: 0,
  ADVERTENCIA: 1,
  INFO: 2,
};

function toNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeLimit(value, fallback = 50, max = 200) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function normalizarSeveridad(value) {
  const normalized = String(value || "INFO").toUpperCase();
  if (["CRITICA", "ADVERTENCIA", "INFO"].includes(normalized)) return normalized;
  return "INFO";
}

function daysUntil(value) {
  if (!value) return null;
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return null;
  target.setHours(23, 59, 59, 999);
  return Math.ceil((target.getTime() - Date.now()) / 86400000);
}

function buildAlert({
  tipo,
  severidad = "INFO",
  titulo,
  descripcion,
  modulo = "dashboard",
  referencia_tipo = null,
  referencia_id = null,
  placa = null,
  cliente_nombre = null,
  monto = null,
  fecha = null,
  dias = null,
  horas = null,
  accion = null,
}) {
  const safeSeverity = normalizarSeveridad(severidad);
  const keyParts = [tipo, modulo, referencia_tipo, referencia_id, placa, fecha]
    .filter(Boolean)
    .map((value) => (value instanceof Date ? value.toISOString() : String(value)))
    .join("-");

  return {
    id: keyParts || `${tipo}-${Date.now()}`,
    tipo,
    severidad: safeSeverity,
    titulo,
    descripcion,
    modulo,
    referencia_tipo,
    referencia_id,
    placa,
    cliente_nombre,
    monto: monto === null || monto === undefined ? null : toNumber(monto),
    fecha,
    dias,
    horas,
    accion: accion || "Revisar",
    leida: false,
    calculada: true,
  };
}

async function tableExists(tableName) {
  const { rows } = await db.query(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [tableName]
  );
  return Boolean(rows[0]?.exists);
}

async function ensureAlertasSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS alertas (
      id BIGSERIAL PRIMARY KEY,
      empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      tipo VARCHAR(60) NOT NULL,
      parqueadero_id BIGINT,
      cliente_id BIGINT,
      titulo VARCHAR(160) NOT NULL,
      descripcion TEXT,
      leida BOOLEAN DEFAULT FALSE,
      creado_en TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`
    ALTER TABLE alertas
      ADD COLUMN IF NOT EXISTS severidad VARCHAR(20) DEFAULT 'INFO',
      ADD COLUMN IF NOT EXISTS modulo VARCHAR(60),
      ADD COLUMN IF NOT EXISTS referencia_tipo VARCHAR(60),
      ADD COLUMN IF NOT EXISTS referencia_id BIGINT,
      ADD COLUMN IF NOT EXISTS placa VARCHAR(20),
      ADD COLUMN IF NOT EXISTS monto NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS accion VARCHAR(120)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS alertas_empresa_leida_idx
    ON alertas (empresa_id, leida, creado_en DESC)
  `);
}

async function agregarAlertasLicencia(empresaId, alertas, resumen) {
  const { rows: empresas } = await db.query(
    `SELECT id, nombre, activa, licencia_tipo, licencia_inicio, licencia_fin
     FROM empresas
     WHERE id = $1
     LIMIT 1`,
    [empresaId]
  );
  const empresa = empresas[0];
  if (!empresa) return;

  let licencia = {
    nombre: empresa.licencia_tipo || "Sin plan",
    fecha_inicio: empresa.licencia_inicio,
    fecha_fin: empresa.licencia_fin,
    activa: empresa.activa,
  };

  if (await tableExists("empresa_licencia")) {
    const hasLicencias = await tableExists("licencias");
    const query = hasLicencias
      ? `SELECT el.fecha_inicio, el.fecha_fin, el.activa,
                COALESCE(l.nombre, e.licencia_tipo, 'Sin plan') AS nombre
         FROM empresa_licencia el
         JOIN empresas e ON e.id = el.empresa_id
         LEFT JOIN licencias l ON l.id = el.licencia_id
         WHERE el.empresa_id = $1 AND el.activa = TRUE
         ORDER BY el.fecha_fin NULLS LAST
         LIMIT 1`
      : `SELECT el.fecha_inicio, el.fecha_fin, el.activa,
                COALESCE(e.licencia_tipo, 'Sin plan') AS nombre
         FROM empresa_licencia el
         JOIN empresas e ON e.id = el.empresa_id
         WHERE el.empresa_id = $1 AND el.activa = TRUE
         ORDER BY el.fecha_fin NULLS LAST
         LIMIT 1`;

    const { rows } = await db.query(query, [empresaId]);
    if (rows[0]) licencia = rows[0];
  }

  const diasRestantes = daysUntil(licencia.fecha_fin);
  resumen.licencia = {
    nombre: licencia.nombre,
    activa: Boolean(licencia.activa && empresa.activa),
    fecha_inicio: licencia.fecha_inicio,
    fecha_fin: licencia.fecha_fin,
    dias_restantes: diasRestantes,
  };

  if (!empresa.activa) {
    alertas.push(buildAlert({
      tipo: "LICENCIA_INACTIVA",
      severidad: "CRITICA",
      titulo: "Empresa inactiva",
      descripcion: "La empresa está desactivada. Revisa el estado operativo antes de procesar servicios.",
      modulo: "config",
      referencia_tipo: "empresa",
      referencia_id: empresa.id,
      accion: "Revisar empresa",
    }));
    return;
  }

  if (diasRestantes === null) return;

  if (diasRestantes < 0) {
    alertas.push(buildAlert({
      tipo: "LICENCIA_VENCIDA",
      severidad: "CRITICA",
      titulo: "Licencia vencida",
      descripcion: `La licencia ${licencia.nombre} venció hace ${Math.abs(diasRestantes)} día(s).`,
      modulo: "config",
      referencia_tipo: "licencia",
      referencia_id: empresa.id,
      fecha: licencia.fecha_fin,
      dias: diasRestantes,
      accion: "Renovar licencia",
    }));
    return;
  }

  if (diasRestantes <= ALERT_THRESHOLDS.licenciaDias) {
    alertas.push(buildAlert({
      tipo: "LICENCIA_POR_VENCER",
      severidad: diasRestantes <= 7 ? "CRITICA" : "ADVERTENCIA",
      titulo: "Licencia próxima a vencer",
      descripcion: `La licencia ${licencia.nombre} vence en ${diasRestantes} día(s).`,
      modulo: "config",
      referencia_tipo: "licencia",
      referencia_id: empresa.id,
      fecha: licencia.fecha_fin,
      dias: diasRestantes,
      accion: "Gestionar plan",
    }));
  }
}

async function agregarAlertasMensualidades(empresaId, alertas, resumen) {
  if (!(await tableExists("mensualidades_parqueadero"))) return;

  const { rows: resumenRows } = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE estado = 'ACTIVA')::int AS activas,
       COUNT(*) FILTER (WHERE estado = 'ACTIVA' AND fecha_fin < CURRENT_DATE)::int AS vencidas,
       COUNT(*) FILTER (
         WHERE estado = 'ACTIVA'
           AND fecha_fin >= CURRENT_DATE
           AND fecha_fin <= CURRENT_DATE + $2::int
       )::int AS proximas,
       COALESCE(SUM(valor_mensual) FILTER (
         WHERE estado = 'ACTIVA' AND fecha_fin < CURRENT_DATE
       ), 0) AS valor_vencido
     FROM mensualidades_parqueadero
     WHERE empresa_id = $1`,
    [empresaId, ALERT_THRESHOLDS.mensualidadDias]
  );

  resumen.mensualidades = {
    activas: Number(resumenRows[0]?.activas || 0),
    vencidas: Number(resumenRows[0]?.vencidas || 0),
    proximas: Number(resumenRows[0]?.proximas || 0),
    valor_vencido: toNumber(resumenRows[0]?.valor_vencido),
  };

  const { rows } = await db.query(
    `SELECT mp.id, mp.placa, mp.nombre_cliente, mp.cliente_id,
            mp.fecha_fin, mp.valor_mensual,
            (mp.fecha_fin - CURRENT_DATE)::int AS dias_restantes
     FROM mensualidades_parqueadero mp
     WHERE mp.empresa_id = $1
       AND mp.estado = 'ACTIVA'
       AND mp.fecha_fin <= CURRENT_DATE + $2::int
     ORDER BY mp.fecha_fin ASC
     LIMIT 12`,
    [empresaId, ALERT_THRESHOLDS.mensualidadDias]
  );

  for (const row of rows) {
    const dias = Number(row.dias_restantes);
    const vencida = dias < 0;
    alertas.push(buildAlert({
      tipo: vencida ? "MENSUALIDAD_VENCIDA" : "MENSUALIDAD_POR_VENCER",
      severidad: vencida || dias <= 2 ? "CRITICA" : "ADVERTENCIA",
      titulo: vencida ? "Mensualidad vencida" : "Mensualidad por vencer",
      descripcion: vencida
        ? `${row.nombre_cliente || row.placa} tiene una mensualidad vencida hace ${Math.abs(dias)} día(s).`
        : `${row.nombre_cliente || row.placa} vence en ${dias} día(s).`,
      modulo: "parqueadero",
      referencia_tipo: "mensualidad",
      referencia_id: row.id,
      placa: row.placa,
      cliente_nombre: row.nombre_cliente,
      monto: row.valor_mensual,
      fecha: row.fecha_fin,
      dias,
      accion: "Ver mensualidades",
    }));
  }
}

function carteraPendienteSql() {
  return `
    SELECT 'parqueadero' AS modulo,
           p.id AS referencia_id,
           p.placa,
           COALESCE(c.nombre, p.nombre_cliente) AS cliente_nombre,
           GREATEST(COALESCE(p.valor_total, 0) - COALESCE(psp.total_pagado, 0), 0) AS monto,
           p.hora_salida AS fecha
    FROM parqueadero p
    LEFT JOIN clientes c ON c.id = p.cliente_id
    LEFT JOIN (
      SELECT referencia_id, COALESCE(SUM(monto), 0) AS total_pagado
      FROM pagos_servicios
      WHERE empresa_id = $1 AND modulo = 'parqueadero' AND estado = 'APLICADO'
      GROUP BY referencia_id
    ) psp ON psp.referencia_id = p.id
    WHERE p.empresa_id = $1
      AND p.hora_salida IS NOT NULL
      AND COALESCE(p.valor_total, 0) > 0
      AND UPPER(COALESCE(p.estado_pago, '')) NOT IN ('PAGADO', 'MENSUALIDAD')
      AND (
        NULLIF(TRIM(COALESCE(p.metodo_pago, '')), '') IS NULL
        OR COALESCE(psp.total_pagado, 0) < COALESCE(p.valor_total, 0)
      )
      AND GREATEST(COALESCE(p.valor_total, 0) - COALESCE(psp.total_pagado, 0), 0) > 0

    UNION ALL

    SELECT 'lavadero' AS modulo,
           l.id AS referencia_id,
           l.placa,
           c.nombre AS cliente_nombre,
           GREATEST(COALESCE(l.precio, 0) - COALESCE(psl.total_pagado, 0), 0) AS monto,
           l.hora_fin AS fecha
    FROM lavadero l
    LEFT JOIN clientes c ON c.id = l.cliente_id
    LEFT JOIN (
      SELECT referencia_id, COALESCE(SUM(monto), 0) AS total_pagado
      FROM pagos_servicios
      WHERE empresa_id = $1 AND modulo = 'lavadero' AND estado = 'APLICADO'
      GROUP BY referencia_id
    ) psl ON psl.referencia_id = l.id
    WHERE l.empresa_id = $1
      AND l.estado = 'Completado'
      AND COALESCE(l.precio, 0) > 0
      AND (
        NULLIF(TRIM(COALESCE(l.metodo_pago, '')), '') IS NULL
        OR COALESCE(psl.total_pagado, 0) < COALESCE(l.precio, 0)
      )
      AND GREATEST(COALESCE(l.precio, 0) - COALESCE(psl.total_pagado, 0), 0) > 0

    UNION ALL

    SELECT 'taller' AS modulo,
           t.id AS referencia_id,
           t.placa,
           c.nombre AS cliente_nombre,
           GREATEST(COALESCE(t.total_orden, 0) - COALESCE(pst.total_pagado, 0), 0) AS monto,
           t.fecha_entrega AS fecha
    FROM taller_ordenes t
    LEFT JOIN clientes c ON c.id = t.cliente_id
    LEFT JOIN (
      SELECT referencia_id, COALESCE(SUM(monto), 0) AS total_pagado
      FROM pagos_servicios
      WHERE empresa_id = $1 AND modulo = 'taller' AND estado = 'APLICADO'
      GROUP BY referencia_id
    ) pst ON pst.referencia_id = t.id
    WHERE t.empresa_id = $1
      AND t.estado = 'Entregado'
      AND COALESCE(t.total_orden, 0) > 0
      AND (
        NULLIF(TRIM(COALESCE(t.metodo_pago, '')), '') IS NULL
        OR COALESCE(pst.total_pagado, 0) < COALESCE(t.total_orden, 0)
      )
      AND GREATEST(COALESCE(t.total_orden, 0) - COALESCE(pst.total_pagado, 0), 0) > 0
  `;
}

async function agregarAlertasCartera(empresaId, alertas, resumen) {
  await ensurePagosServiciosSchema();
  const baseSql = carteraPendienteSql();

  const { rows: resumenRows } = await db.query(
    `SELECT COUNT(*)::int AS servicios_pendientes,
            COALESCE(SUM(monto), 0) AS monto_pendiente
     FROM (${baseSql}) cartera`,
    [empresaId]
  );

  const totalPendientes = Number(resumenRows[0]?.servicios_pendientes || 0);
  const montoPendiente = toNumber(resumenRows[0]?.monto_pendiente);
  resumen.cartera = {
    servicios_pendientes: totalPendientes,
    monto_pendiente: montoPendiente,
  };

  if (totalPendientes === 0) return;

  alertas.push(buildAlert({
    tipo: "CARTERA_PENDIENTE",
    severidad: totalPendientes >= 5 || montoPendiente >= 500000 ? "CRITICA" : "ADVERTENCIA",
    titulo: "Cartera pendiente",
    descripcion: `${totalPendientes} servicio(s) cerrado(s) tienen pago pendiente por registrar.`,
    modulo: "clientes",
    referencia_tipo: "cartera",
    monto: montoPendiente,
    accion: "Revisar cartera",
  }));

  const { rows } = await db.query(
    `SELECT *
     FROM (${baseSql}) cartera
     ORDER BY fecha ASC NULLS LAST
     LIMIT 8`,
    [empresaId]
  );

  for (const row of rows) {
    alertas.push(buildAlert({
      tipo: "SERVICIO_SIN_PAGO",
      severidad: "ADVERTENCIA",
      titulo: "Servicio sin pago registrado",
      descripcion: `${row.modulo} ${row.placa || ""} tiene un saldo pendiente.`,
      modulo: row.modulo === "taller" ? "taller" : row.modulo,
      referencia_tipo: row.modulo,
      referencia_id: row.referencia_id,
      placa: row.placa,
      cliente_nombre: row.cliente_nombre,
      monto: row.monto,
      fecha: row.fecha,
      accion: "Registrar pago",
    }));
  }
}

async function agregarAlertasOperaciones(empresaId, alertas, resumen) {
  const operaciones = {
    parqueadero_abiertos: 0,
    lavadero_abiertos: 0,
    taller_abiertos: 0,
    demoradas: 0,
  };

  const { rows: parqueoResumen } = await db.query(
    `SELECT COUNT(*)::int AS total
     FROM parqueadero
     WHERE empresa_id = $1 AND hora_salida IS NULL`,
    [empresaId]
  );
  operaciones.parqueadero_abiertos = Number(parqueoResumen[0]?.total || 0);

  const { rows: lavaderoResumen } = await db.query(
    `SELECT COUNT(*)::int AS total
     FROM lavadero
     WHERE empresa_id = $1 AND estado <> 'Completado'`,
    [empresaId]
  );
  operaciones.lavadero_abiertos = Number(lavaderoResumen[0]?.total || 0);

  const { rows: tallerResumen } = await db.query(
    `SELECT COUNT(*)::int AS total
     FROM taller_ordenes
     WHERE empresa_id = $1 AND estado <> 'Entregado'`,
    [empresaId]
  );
  operaciones.taller_abiertos = Number(tallerResumen[0]?.total || 0);

  const { rows: parqueaderoRows } = await db.query(
    `SELECT id, placa, nombre_cliente, hora_entrada,
            ROUND((EXTRACT(EPOCH FROM (NOW() - hora_entrada)) / 3600)::numeric, 1) AS horas_abierto
     FROM parqueadero
     WHERE empresa_id = $1
       AND hora_salida IS NULL
       AND EXTRACT(EPOCH FROM (NOW() - hora_entrada)) / 3600 >= $2
     ORDER BY hora_entrada ASC
     LIMIT 8`,
    [empresaId, ALERT_THRESHOLDS.parqueaderoHoras]
  );

  for (const row of parqueaderoRows) {
    const horas = toNumber(row.horas_abierto);
    operaciones.demoradas += 1;
    alertas.push(buildAlert({
      tipo: "PARQUEADERO_DEMORADO",
      severidad: horas >= 24 ? "CRITICA" : "ADVERTENCIA",
      titulo: "Vehículo con permanencia alta",
      descripcion: `${row.placa} lleva ${horas} hora(s) sin salida registrada.`,
      modulo: "parqueadero",
      referencia_tipo: "parqueadero",
      referencia_id: row.id,
      placa: row.placa,
      cliente_nombre: row.nombre_cliente,
      fecha: row.hora_entrada,
      horas,
      accion: "Registrar salida",
    }));
  }

  const { rows: lavaderoRows } = await db.query(
    `SELECT l.id, l.placa, l.estado, l.hora_inicio, c.nombre AS cliente_nombre,
            ROUND((EXTRACT(EPOCH FROM (NOW() - l.hora_inicio)) / 3600)::numeric, 1) AS horas_abierto
     FROM lavadero l
     LEFT JOIN clientes c ON c.id = l.cliente_id
     WHERE l.empresa_id = $1
       AND l.estado <> 'Completado'
       AND EXTRACT(EPOCH FROM (NOW() - l.hora_inicio)) / 3600 >= $2
     ORDER BY l.hora_inicio ASC
     LIMIT 8`,
    [empresaId, ALERT_THRESHOLDS.lavaderoHoras]
  );

  for (const row of lavaderoRows) {
    const horas = toNumber(row.horas_abierto);
    operaciones.demoradas += 1;
    alertas.push(buildAlert({
      tipo: "LAVADO_DEMORADO",
      severidad: horas >= 12 ? "CRITICA" : "ADVERTENCIA",
      titulo: "Lavado pendiente por cerrar",
      descripcion: `${row.placa} está en ${row.estado} hace ${horas} hora(s).`,
      modulo: "lavadero",
      referencia_tipo: "lavadero",
      referencia_id: row.id,
      placa: row.placa,
      cliente_nombre: row.cliente_nombre,
      fecha: row.hora_inicio,
      horas,
      accion: "Completar lavado",
    }));
  }

  const { rows: tallerRows } = await db.query(
    `SELECT t.id, t.placa, t.estado, t.fecha_creacion, c.nombre AS cliente_nombre,
            ROUND((EXTRACT(EPOCH FROM (NOW() - t.fecha_creacion)) / 3600)::numeric, 1) AS horas_abierto
     FROM taller_ordenes t
     LEFT JOIN clientes c ON c.id = t.cliente_id
     WHERE t.empresa_id = $1
       AND t.estado <> 'Entregado'
       AND EXTRACT(EPOCH FROM (NOW() - t.fecha_creacion)) / 3600 >= $2
     ORDER BY t.fecha_creacion ASC
     LIMIT 8`,
    [empresaId, ALERT_THRESHOLDS.tallerHoras]
  );

  for (const row of tallerRows) {
    const horas = toNumber(row.horas_abierto);
    operaciones.demoradas += 1;
    alertas.push(buildAlert({
      tipo: "TALLER_DEMORADO",
      severidad: horas >= 168 ? "CRITICA" : "ADVERTENCIA",
      titulo: "Orden de taller con seguimiento pendiente",
      descripcion: `${row.placa} lleva ${horas} hora(s) en estado ${row.estado}.`,
      modulo: "taller",
      referencia_tipo: "taller",
      referencia_id: row.id,
      placa: row.placa,
      cliente_nombre: row.cliente_nombre,
      fecha: row.fecha_creacion,
      horas,
      accion: "Revisar orden",
    }));
  }

  resumen.operaciones = operaciones;
}

async function agregarAlertasOcupacion(empresaId, alertas, resumen) {
  if (!(await tableExists("configuracion_parqueadero"))) return;

  const { rows: configRows } = await db.query(
    `SELECT capacidad_total
     FROM configuracion_parqueadero
     WHERE empresa_id = $1
     LIMIT 1`,
    [empresaId]
  );

  const capacidad = Number(configRows[0]?.capacidad_total || 0);
  if (capacidad <= 0) {
    resumen.ocupacion = {
      capacidad_total: 0,
      ocupados: 0,
      porcentaje: 0,
    };
    return;
  }

  const { rows: ocupadosRows } = await db.query(
    `SELECT COUNT(*)::int AS ocupados
     FROM parqueadero
     WHERE empresa_id = $1 AND hora_salida IS NULL`,
    [empresaId]
  );

  const ocupados = Number(ocupadosRows[0]?.ocupados || 0);
  const porcentaje = Math.round((ocupados / capacidad) * 100);
  resumen.ocupacion = {
    capacidad_total: capacidad,
    ocupados,
    porcentaje,
  };

  if (porcentaje >= ALERT_THRESHOLDS.ocupacionPorcentaje) {
    alertas.push(buildAlert({
      tipo: "OCUPACION_ALTA",
      severidad: porcentaje >= 100 ? "CRITICA" : "ADVERTENCIA",
      titulo: porcentaje >= 100 ? "Parqueadero lleno" : "Ocupación alta",
      descripcion: `La ocupación está en ${porcentaje}% (${ocupados} de ${capacidad} espacios).`,
      modulo: "parqueadero",
      referencia_tipo: "ocupacion",
      accion: "Ver parqueadero",
    }));
  }
}

async function generarAlertasInteligentes(empresaId) {
  const alertas = [];
  const resumen = {
    total: 0,
    criticas: 0,
    advertencias: 0,
    informativas: 0,
    licencia: null,
    mensualidades: {
      activas: 0,
      vencidas: 0,
      proximas: 0,
      valor_vencido: 0,
    },
    cartera: {
      servicios_pendientes: 0,
      monto_pendiente: 0,
    },
    operaciones: {
      parqueadero_abiertos: 0,
      lavadero_abiertos: 0,
      taller_abiertos: 0,
      demoradas: 0,
    },
    ocupacion: {
      capacidad_total: 0,
      ocupados: 0,
      porcentaje: 0,
    },
  };

  await agregarAlertasLicencia(empresaId, alertas, resumen);
  await agregarAlertasMensualidades(empresaId, alertas, resumen);
  await agregarAlertasCartera(empresaId, alertas, resumen);
  await agregarAlertasOperaciones(empresaId, alertas, resumen);
  await agregarAlertasOcupacion(empresaId, alertas, resumen);

  const ordenadas = alertas.sort((a, b) => {
    const severity = SEVERITY_ORDER[a.severidad] - SEVERITY_ORDER[b.severidad];
    if (severity !== 0) return severity;
    const dateA = a.fecha ? new Date(a.fecha).getTime() : 0;
    const dateB = b.fecha ? new Date(b.fecha).getTime() : 0;
    return dateA - dateB;
  });

  resumen.total = ordenadas.length;
  resumen.criticas = ordenadas.filter((alerta) => alerta.severidad === "CRITICA").length;
  resumen.advertencias = ordenadas.filter((alerta) => alerta.severidad === "ADVERTENCIA").length;
  resumen.informativas = ordenadas.filter((alerta) => alerta.severidad === "INFO").length;

  return {
    generado_en: new Date().toISOString(),
    resumen,
    alertas: ordenadas,
  };
}

// GET alertas inteligentes calculadas en tiempo real
router.get("/inteligentes", auth, async (req, res) => {
  const empresaId = req.user.empresa_id;

  try {
    const data = await generarAlertasInteligentes(empresaId);
    res.json(data);
  } catch (err) {
    console.error("Error generando alertas inteligentes:", err);
    res.status(500).json({ error: "Error generando alertas inteligentes." });
  }
});

// GET resumen rápido de alertas inteligentes
router.get("/resumen", auth, async (req, res) => {
  const empresaId = req.user.empresa_id;

  try {
    const data = await generarAlertasInteligentes(empresaId);
    res.json({
      generado_en: data.generado_en,
      resumen: data.resumen,
      alertas_destacadas: data.alertas.slice(0, 5),
    });
  } catch (err) {
    console.error("Error generando resumen de alertas:", err);
    res.status(500).json({ error: "Error generando resumen de alertas." });
  }
});

// GET alertas no leidas
router.get("/no-leidas", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;

  try {
    await ensureAlertasSchema();
    const { rows } = await db.query(
      `SELECT *
       FROM alertas
       WHERE empresa_id = $1 AND leida = FALSE
       ORDER BY creado_en DESC
       LIMIT 20`,
      [empresa_id]
    );
    res.json(rows);
  } catch (err) {
    console.error("Error obteniendo alertas:", err);
    res.status(500).json({ error: "Error obteniendo alertas." });
  }
});

// GET todas las alertas guardadas
router.get("/", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const { tipo } = req.query;
  const limit = safeLimit(req.query.limit);

  const params = [empresa_id];
  let query = `SELECT * FROM alertas WHERE empresa_id = $1`;

  if (tipo) {
    params.push(tipo);
    query += ` AND tipo = $${params.length}`;
  }

  params.push(limit);
  query += ` ORDER BY creado_en DESC LIMIT $${params.length}`;

  try {
    await ensureAlertasSchema();
    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("Error obteniendo alertas:", err);
    res.status(500).json({ error: "Error obteniendo alertas." });
  }
});

// PATCH marcar como leida
router.patch("/:id/leer", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const id = req.params.id;

  try {
    await ensureAlertasSchema();
    const { rows } = await db.query(
      `UPDATE alertas
       SET leida = TRUE
       WHERE id = $1 AND empresa_id = $2
       RETURNING *`,
      [id, empresa_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Alerta no encontrada." });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Error actualizando alerta:", err);
    res.status(500).json({ error: "Error actualizando alerta." });
  }
});

// POST crear alerta manual
router.post("/", auth, async (req, res) => {
  const empresa_id = req.user.empresa_id;
  const {
    tipo,
    parqueadero_id,
    cliente_id,
    titulo,
    descripcion,
    modulo,
    referencia_tipo,
    referencia_id,
    placa,
    monto,
    accion,
  } = req.body;
  const severidad = normalizarSeveridad(req.body.severidad);

  if (!tipo || !titulo) {
    return res
      .status(400)
      .json({ error: "Tipo y titulo son obligatorios." });
  }

  try {
    await ensureAlertasSchema();
    const { rows } = await db.query(
      `INSERT INTO alertas
       (empresa_id, tipo, parqueadero_id, cliente_id, titulo, descripcion,
        severidad, modulo, referencia_tipo, referencia_id, placa, monto, accion)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        empresa_id,
        tipo,
        parqueadero_id || null,
        cliente_id || null,
        titulo,
        descripcion || null,
        severidad,
        modulo || null,
        referencia_tipo || null,
        referencia_id || null,
        placa || null,
        monto || null,
        accion || null,
      ]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Error creando alerta:", err);
    res.status(500).json({ error: "Error creando alerta." });
  }
});

module.exports = router;
