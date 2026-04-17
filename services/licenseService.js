'use strict';

/**
 * licenseService — Núcleo SaaS de AutoGestión360
 *
 * Cadena de resolución (mayor a menor prioridad):
 *   1. suscripciones + planes + plan_modulos + empresa_modulos  (SaaS nuevo)
 *   2. empresa_licencia + licencias + licencia_modulo           (licencias clásicas)
 *   3. empresas.licencia_tipo / licencia_fin                    (legacy original)
 *
 * Exporta:
 *   getLicenseStatus(empresaId, queryable?)  → LicenseStatus
 *   hasModulo(empresaId, modulo, queryable?) → boolean
 *   getLimite(empresaId, modulo, queryable?) → number | null
 *   resolveEstadoReal(row)                  → string
 */

const db = require('../db');

// ─────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────

const MODULOS_LEGACY = {
  demo:     ['dashboard', 'parqueadero', 'clientes'],
  basica:   ['dashboard', 'parqueadero', 'clientes', 'reportes', 'configuracion'],
  pro:      ['dashboard', 'parqueadero', 'clientes', 'reportes', 'lavadero', 'taller', 'empleados', 'usuarios', 'configuracion'],
  premium:  ['dashboard', 'parqueadero', 'clientes', 'reportes', 'lavadero', 'taller', 'empleados', 'usuarios', 'configuracion', 'empresas'],
};

// Query principal: suscripción activa + plan + módulos con overrides por empresa
const SQL_SUSCRIPCION_PLANES = `
  SELECT
    s.id              AS suscripcion_id,
    s.empresa_id,
    s.estado,
    s.fecha_inicio,
    s.fecha_fin,
    s.trial_hasta,
    s.ciclo,
    s.precio_pactado,
    s.moneda,
    p.id              AS plan_id,
    p.codigo          AS plan_codigo,
    p.nombre          AS plan_nombre,
    p.descripcion     AS plan_descripcion,
    p.max_usuarios,
    p.max_vehiculos,
    p.max_empleados,
    COALESCE(
      (
        SELECT json_agg(
          json_build_object(
            'nombre',      m.nombre,
            'descripcion', m.descripcion,
            'icono_clave', m.icono_clave,
            'limite',      COALESCE(em.limite_override, pm.limite_registros),
            'es_addon',    (em.id IS NOT NULL AND pm.id IS NULL)
          )
          ORDER BY m.orden NULLS LAST, m.nombre
        )
        FROM modulos m
        LEFT JOIN plan_modulos pm
          ON pm.plan_id = p.id AND pm.modulo_id = m.id AND pm.activo = TRUE
        LEFT JOIN empresa_modulos em
          ON em.empresa_id = s.empresa_id AND em.modulo_id = m.id
        WHERE m.activo = TRUE
          AND (
            -- Incluido en el plan y no desactivado por override
            (pm.id IS NOT NULL AND COALESCE(em.activo, TRUE) = TRUE)
            -- Add-on: override activo pero no está en el plan base
            OR (em.id IS NOT NULL AND em.activo = TRUE AND pm.id IS NULL)
          )
      ),
      '[]'::json
    ) AS modulos_json
  FROM suscripciones s
  JOIN planes p      ON p.id = s.plan_id
  JOIN empresas e    ON e.id = s.empresa_id
  WHERE s.empresa_id = $1
    AND s.estado IN ('TRIAL', 'ACTIVA')
  LIMIT 1
`;

// ─────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────

/**
 * Calcula el estado real considerando fechas de vencimiento.
 * La BD puede tener TRIAL/ACTIVA aunque ya hayan vencido.
 */
function resolveEstadoReal({ estado, fecha_fin, trial_hasta }) {
  if (['CANCELADA', 'SUSPENDIDA'].includes(estado)) return estado;
  const now = new Date();
  if (estado === 'TRIAL'  && trial_hasta && now > new Date(trial_hasta)) return 'VENCIDA';
  if (estado === 'ACTIVA' && fecha_fin   && now > new Date(fecha_fin))   return 'VENCIDA';
  return estado;
}

function buildEmptyStatus() {
  return {
    fuente:          null,
    vigente:         false,
    estado:          'SIN_LICENCIA',
    plan:            null,
    suscripcion:     null,
    modulos:         [],
    modulos_detalle: [],
    limites:         { usuarios: null, vehiculos: null, empleados: null },
  };
}

function modulosFromLegacy(tipo) {
  const t = String(tipo || 'demo').toLowerCase();
  const lista = MODULOS_LEGACY[t] || MODULOS_LEGACY.demo;
  return {
    modulos: lista,
    modulos_detalle: lista.map(n => ({ nombre: n, descripcion: null, icono_clave: null, limite: null, es_addon: false })),
  };
}

// ─────────────────────────────────────────────
// getLicenseStatus
// ─────────────────────────────────────────────

/**
 * Resuelve el estado de licencia completo de una empresa.
 *
 * @param {number|string} empresaId
 * @param {object}        [queryable=db]  pool o client de pg
 * @returns {Promise<LicenseStatus>}
 *
 * LicenseStatus = {
 *   fuente:          'planes' | 'licencias' | 'legacy' | null,
 *   vigente:         boolean,
 *   estado:          'TRIAL'|'ACTIVA'|'VENCIDA'|'SUSPENDIDA'|'CANCELADA'|'SIN_LICENCIA',
 *   plan:            { id, codigo, nombre, descripcion, max_usuarios, max_vehiculos, max_empleados } | null,
 *   suscripcion:     { id, fecha_inicio, fecha_fin, trial_hasta, ciclo, precio_pactado, moneda } | null,
 *   modulos:         string[],
 *   modulos_detalle: Array<{ nombre, descripcion, icono_clave, limite, es_addon }>,
 *   limites:         { usuarios, vehiculos, empleados },   // null = sin límite
 * }
 */
async function getLicenseStatus(empresaId, queryable = db) {
  // ── 1. Sistema nuevo: suscripciones + planes ───────────────
  try {
    const { rows } = await queryable.query(SQL_SUSCRIPCION_PLANES, [empresaId]);

    if (rows.length > 0) {
      const row = rows[0];
      const estadoReal    = resolveEstadoReal(row);
      const modulosDetalle = Array.isArray(row.modulos_json)
        ? row.modulos_json
        : (row.modulos_json ?? []);

      return {
        fuente:  'planes',
        vigente: ['TRIAL', 'ACTIVA'].includes(estadoReal),
        estado:  estadoReal,
        plan: {
          id:           row.plan_id,
          codigo:       row.plan_codigo,
          nombre:       row.plan_nombre,
          descripcion:  row.plan_descripcion,
          max_usuarios: row.max_usuarios,
          max_vehiculos: row.max_vehiculos,
          max_empleados: row.max_empleados,
        },
        suscripcion: {
          id:             row.suscripcion_id,
          fecha_inicio:   row.fecha_inicio,
          fecha_fin:      row.fecha_fin,
          trial_hasta:    row.trial_hasta,
          ciclo:          row.ciclo,
          precio_pactado: Number(row.precio_pactado),
          moneda:         row.moneda,
        },
        modulos:         modulosDetalle.map(m => m.nombre),
        modulos_detalle: modulosDetalle,
        limites: {
          usuarios:  row.max_usuarios  ?? null,
          vehiculos: row.max_vehiculos ?? null,
          empleados: row.max_empleados ?? null,
        },
      };
    }
  } catch (err) {
    // Tabla aún no creada → continuar con fallback
    if (err.code !== '42P01') throw err;
  }

  // ── 2. Licencias clásicas: empresa_licencia + licencias ────
  try {
    const { rows } = await queryable.query(`
      SELECT
        el.licencia_id,
        el.fecha_fin,
        el.activa,
        l.nombre AS licencia_nombre,
        ARRAY_REMOVE(ARRAY_AGG(m.nombre), NULL) AS modulos
      FROM empresa_licencia el
      JOIN licencias l     ON l.id = el.licencia_id
      LEFT JOIN licencia_modulo lm ON lm.licencia_id = l.id
      LEFT JOIN modulos m  ON m.id = lm.modulo_id
      WHERE el.empresa_id = $1 AND el.activa = TRUE
      GROUP BY el.licencia_id, el.fecha_fin, el.activa, l.nombre
      ORDER BY el.creado_en DESC
      LIMIT 1
    `, [empresaId]);

    if (rows.length > 0) {
      const row   = rows[0];
      const now   = new Date();
      const vencida = row.fecha_fin && now > new Date(row.fecha_fin);
      const modulos = row.modulos || [];
      return {
        fuente:  'licencias',
        vigente: !vencida && row.activa,
        estado:  vencida ? 'VENCIDA' : (row.activa ? 'ACTIVA' : 'SUSPENDIDA'),
        plan:    null,
        suscripcion: null,
        modulos,
        modulos_detalle: modulos.map(n => ({ nombre: n, descripcion: null, icono_clave: null, limite: null, es_addon: false })),
        limites: { usuarios: null, vehiculos: null, empleados: null },
      };
    }
  } catch (err) {
    if (err.code !== '42P01') throw err;
  }

  // ── 3. Legacy: empresas.licencia_tipo ─────────────────────
  const { rows: empRows } = await queryable.query(
    `SELECT licencia_tipo, licencia_fin, activa FROM empresas WHERE id = $1 LIMIT 1`,
    [empresaId]
  );

  if (empRows.length === 0) return buildEmptyStatus();

  const emp    = empRows[0];
  const now    = new Date();
  const vencida = emp.licencia_fin && now > new Date(emp.licencia_fin);
  const { modulos, modulos_detalle } = modulosFromLegacy(emp.licencia_tipo);

  return {
    fuente:  'legacy',
    vigente: !vencida && emp.activa,
    estado:  vencida ? 'VENCIDA' : (emp.activa ? 'ACTIVA' : 'SUSPENDIDA'),
    plan:    null,
    suscripcion: null,
    modulos,
    modulos_detalle,
    limites: { usuarios: null, vehiculos: null, empleados: null },
  };
}

// ─────────────────────────────────────────────
// Helpers de conveniencia
// ─────────────────────────────────────────────

/**
 * ¿Tiene la empresa acceso a un módulo específico ahora mismo?
 */
async function hasModulo(empresaId, moduloNombre, queryable = db) {
  const status = await getLicenseStatus(empresaId, queryable);
  return status.vigente && status.modulos.includes(moduloNombre);
}

/**
 * Límite de registros para un módulo (null = ilimitado).
 */
async function getLimite(empresaId, moduloNombre, queryable = db) {
  const status = await getLicenseStatus(empresaId, queryable);
  const detalle = status.modulos_detalle.find(m => m.nombre === moduloNombre);
  return detalle?.limite ?? null;
}

module.exports = { getLicenseStatus, hasModulo, getLimite, resolveEstadoReal };
