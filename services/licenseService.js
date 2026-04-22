'use strict';

/**
 * licenseService — resolución centralizada de licencias y módulos.
 *
 * Fuente oficial:
 *   suscripciones + planes + plan_modulos + empresa_modulos
 *
 * Compatibilidad transicional solo por opt-in:
 *   empresa_licencia + licencias + licencia_modulo
 *   empresas.licencia_tipo / licencia_fin / activa
 *
 * El fallback legacy queda controlado por:
 *   ALLOW_LEGACY_LICENSE_FALLBACK=true|false
 * Si no se define, permanece deshabilitado para que el acceso SaaS dependa
 * exclusivamente de suscripciones.
 */

const db = require('../db');

const SOURCE_KEYS = {
  SAAS: 'saas',
  CLASSIC: 'classic_license',
  LEGACY: 'legacy_empresa',
};

const MODULOS_LEGACY = {
  demo: ['dashboard', 'parqueadero', 'clientes'],
  basica: ['dashboard', 'parqueadero', 'clientes', 'reportes', 'configuracion'],
  pro: ['dashboard', 'parqueadero', 'clientes', 'reportes', 'lavadero', 'taller', 'empleados', 'usuarios', 'configuracion'],
  premium: ['dashboard', 'parqueadero', 'clientes', 'reportes', 'lavadero', 'taller', 'empleados', 'usuarios', 'configuracion', 'empresas'],
};

const SQL_SAAS_STATUS = `
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
    s.renovacion_automatica,
    s.pasarela,
    s.observaciones,
    p.id              AS plan_id,
    p.codigo          AS plan_codigo,
    p.nombre          AS plan_nombre,
    p.descripcion     AS plan_descripcion,
    p.max_usuarios,
    p.max_vehiculos,
    p.max_empleados,
    p.max_sedes,
    COALESCE(
      (
        SELECT json_agg(
          json_build_object(
            'nombre',      m.nombre,
            'descripcion', m.descripcion,
            'icono_clave', m.icono_clave,
            'limite',      CASE
                             WHEN COALESCE(em.limite_override, pm.limite_registros) = 0 THEN NULL
                             ELSE COALESCE(em.limite_override, pm.limite_registros)
                           END,
            'es_addon',    (em.id IS NOT NULL AND pm.id IS NULL)
          )
          ORDER BY m.orden NULLS LAST, m.nombre
        )
        FROM modulos m
        LEFT JOIN plan_modulos pm
          ON pm.plan_id = p.id
         AND pm.modulo_id = m.id
         AND pm.activo = TRUE
        LEFT JOIN empresa_modulos em
          ON em.empresa_id = s.empresa_id
         AND em.modulo_id = m.id
        WHERE m.activo = TRUE
          AND (
            (pm.id IS NOT NULL AND COALESCE(em.activo, TRUE) = TRUE)
            OR (em.id IS NOT NULL AND em.activo = TRUE AND pm.id IS NULL)
          )
      ),
      '[]'::json
    ) AS modulos_json
  FROM suscripciones s
  JOIN planes p ON p.id = s.plan_id
  WHERE s.empresa_id = $1
  ORDER BY
    CASE WHEN s.estado IN ('TRIAL', 'ACTIVA') THEN 0 ELSE 1 END,
    COALESCE(
      CASE WHEN s.estado = 'TRIAL' THEN s.trial_hasta ELSE NULL END,
      s.fecha_fin,
      s.actualizado_en,
      s.creado_en
    ) DESC NULLS LAST,
    s.id DESC
  LIMIT 1
`;

const SQL_CLASSIC_STATUS = `
  SELECT
    el.licencia_id,
    el.fecha_inicio,
    el.fecha_fin,
    el.activa,
    l.nombre        AS licencia_nombre,
    l.descripcion   AS licencia_descripcion,
    l.precio        AS licencia_precio,
    ARRAY_REMOVE(ARRAY_AGG(m.nombre ORDER BY m.nombre), NULL) AS modulos
  FROM empresa_licencia el
  JOIN licencias l ON l.id = el.licencia_id
  LEFT JOIN licencia_modulo lm ON lm.licencia_id = l.id
  LEFT JOIN modulos m ON m.id = lm.modulo_id
  WHERE el.empresa_id = $1
    AND el.activa = TRUE
  GROUP BY
    el.licencia_id,
    el.fecha_inicio,
    el.fecha_fin,
    el.activa,
    l.nombre,
    l.descripcion,
    l.precio,
    el.creado_en
  ORDER BY el.creado_en DESC
  LIMIT 1
`;

const SQL_LEGACY_STATUS = `
  SELECT licencia_tipo, licencia_inicio, licencia_fin, activa
  FROM empresas
  WHERE id = $1
  LIMIT 1
`;

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function normalizeModulo(modulo) {
  return String(modulo || '').trim().toLowerCase();
}

function normalizeLimit(value) {
  if (value === undefined || value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return null;
  return parsed;
}

function resolveEstadoReal({ estado, fecha_fin, trial_hasta }) {
  if (['CANCELADA', 'SUSPENDIDA'].includes(estado)) return estado;

  const now = new Date();
  if (estado === 'TRIAL' && trial_hasta && now > new Date(trial_hasta)) return 'VENCIDA';
  if (estado === 'ACTIVA' && fecha_fin && now > new Date(fecha_fin)) return 'VENCIDA';
  return estado;
}

function isSchemaMissingError(error) {
  return error?.code === '42P01' || error?.code === '42703';
}

function isLegacyFallbackEnabled(options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'allowLegacyFallback')) {
    return Boolean(options.allowLegacyFallback);
  }
  return toBoolean(process.env.ALLOW_LEGACY_LICENSE_FALLBACK, false);
}

function normalizeSourceList(options = {}) {
  const allowLegacyFallback = isLegacyFallbackEnabled(options);
  const requested = Array.isArray(options.sources) && options.sources.length
    ? options.sources
    : [
        SOURCE_KEYS.SAAS,
        ...(allowLegacyFallback ? [SOURCE_KEYS.CLASSIC, SOURCE_KEYS.LEGACY] : []),
      ];

  const cleaned = requested
    .map((source) => String(source || '').trim().toLowerCase())
    .filter((source, index, list) => source && list.indexOf(source) === index)
    .filter((source) => {
      if (source === SOURCE_KEYS.SAAS) return true;
      if (!allowLegacyFallback && [SOURCE_KEYS.CLASSIC, SOURCE_KEYS.LEGACY].includes(source)) return false;
      return [SOURCE_KEYS.SAAS, SOURCE_KEYS.CLASSIC, SOURCE_KEYS.LEGACY].includes(source);
    });

  return cleaned.length > 0 ? cleaned : [SOURCE_KEYS.SAAS];
}

function normalizeResolverInput(arg2, arg3) {
  if (arg2 && typeof arg2.query === 'function') {
    return {
      options: arg3 || {},
      queryable: arg2,
    };
  }

  return {
    options: arg2 || {},
    queryable: arg3 && typeof arg3.query === 'function' ? arg3 : db,
  };
}

function buildBaseStatus(meta = {}) {
  return {
    fuente: null,
    oficial: false,
    transicional: false,
    vigente: false,
    estado: 'SIN_LICENCIA',
    plan: null,
    suscripcion: null,
    licencia: null,
    modulos: [],
    modulos_detalle: [],
    limites: { usuarios: null, vehiculos: null, empleados: null, sedes: null },
    metadata: {
      legacy_fallback_enabled: Boolean(meta.legacy_fallback_enabled),
      legacy_fallback_used: false,
      source_order: meta.source_order || [SOURCE_KEYS.SAAS],
      schema_warnings: meta.schema_warnings || [],
      source_selected: null,
      source_attempted: [],
    },
  };
}

function buildModuloDetail(nombre, extra = {}) {
  return {
    nombre,
    descripcion: extra.descripcion ?? null,
    icono_clave: extra.icono_clave ?? null,
    limite: normalizeLimit(extra.limite),
    es_addon: Boolean(extra.es_addon),
  };
}

function buildSaasStatus(row, meta) {
  const estadoReal = resolveEstadoReal(row);
  const modulosDetalleRaw = Array.isArray(row.modulos_json) ? row.modulos_json : [];
  const modulosDetalle = modulosDetalleRaw.map((modulo) => buildModuloDetail(modulo.nombre, modulo));

  return {
    ...buildBaseStatus(meta),
    fuente: 'planes',
    oficial: true,
    transicional: false,
    vigente: ['TRIAL', 'ACTIVA'].includes(estadoReal),
    estado: estadoReal,
    plan: {
      id: row.plan_id,
      codigo: row.plan_codigo,
      nombre: row.plan_nombre,
      descripcion: row.plan_descripcion,
      max_usuarios: row.max_usuarios ?? null,
      max_vehiculos: row.max_vehiculos ?? null,
      max_empleados: row.max_empleados ?? null,
      max_sedes:     row.max_sedes ?? null,
    },
    suscripcion: {
      id: row.suscripcion_id,
      fecha_inicio: row.fecha_inicio,
      fecha_fin: row.fecha_fin,
      trial_hasta: row.trial_hasta,
      ciclo: row.ciclo,
      precio_pactado: Number(row.precio_pactado || 0),
      moneda: row.moneda,
      renovacion_automatica: Boolean(row.renovacion_automatica),
      pasarela: row.pasarela,
      observaciones: row.observaciones,
    },
    licencia: {
      id: row.plan_id,
      codigo: row.plan_codigo,
      nombre: row.plan_nombre,
      descripcion: row.plan_descripcion,
      precio: Number(row.precio_pactado || 0),
      fecha_inicio: row.fecha_inicio,
      fecha_fin: row.fecha_fin || row.trial_hasta || null,
      activa: ['TRIAL', 'ACTIVA'].includes(estadoReal),
      tipo: 'PLAN_SAAS',
    },
    modulos: modulosDetalle.map((modulo) => modulo.nombre),
    modulos_detalle: modulosDetalle,
    limites: {
      usuarios: normalizeLimit(row.max_usuarios),
      vehiculos: normalizeLimit(row.max_vehiculos),
      empleados: normalizeLimit(row.max_empleados),
      sedes:     normalizeLimit(row.max_sedes),
    },
    metadata: {
      ...buildBaseStatus(meta).metadata,
      source_selected: SOURCE_KEYS.SAAS,
    },
  };
}

function buildClassicStatus(row, meta) {
  const vencida = Boolean(row.fecha_fin && new Date(row.fecha_fin) < new Date());
  const modulos = Array.isArray(row.modulos) ? row.modulos.map(normalizeModulo).filter(Boolean) : [];
  const modulosDetalle = modulos.map((modulo) => buildModuloDetail(modulo));

  return {
    ...buildBaseStatus(meta),
    fuente: 'licencias',
    oficial: false,
    transicional: true,
    vigente: !vencida && row.activa === true,
    estado: vencida ? 'VENCIDA' : (row.activa ? 'ACTIVA' : 'SUSPENDIDA'),
    licencia: {
      id: row.licencia_id,
      nombre: row.licencia_nombre,
      descripcion: row.licencia_descripcion,
      precio: row.licencia_precio === null ? null : Number(row.licencia_precio || 0),
      fecha_inicio: row.fecha_inicio,
      fecha_fin: row.fecha_fin,
      activa: !vencida && row.activa === true,
      tipo: 'LICENCIA_CLASICA',
    },
    modulos,
    modulos_detalle: modulosDetalle,
    metadata: {
      ...buildBaseStatus(meta).metadata,
      legacy_fallback_used: true,
      source_selected: SOURCE_KEYS.CLASSIC,
    },
  };
}

function modulosFromLegacy(tipoLicencia) {
  const key = normalizeModulo(tipoLicencia || 'demo');
  const modulos = MODULOS_LEGACY[key] || MODULOS_LEGACY.demo;
  return {
    modulos,
    modulos_detalle: modulos.map((modulo) => buildModuloDetail(modulo)),
  };
}

function buildLegacyStatus(row, meta) {
  const vencida = Boolean(row.licencia_fin && new Date(row.licencia_fin) < new Date());
  const { modulos, modulos_detalle } = modulosFromLegacy(row.licencia_tipo);

  return {
    ...buildBaseStatus(meta),
    fuente: 'legacy',
    oficial: false,
    transicional: true,
    vigente: !vencida && row.activa === true,
    estado: vencida ? 'VENCIDA' : (row.activa ? 'ACTIVA' : 'SUSPENDIDA'),
    licencia: {
      id: null,
      nombre: row.licencia_tipo || 'Demo',
      descripcion: 'Licenciamiento legacy en empresas.* (compatibilidad temporal)',
      precio: null,
      fecha_inicio: row.licencia_inicio,
      fecha_fin: row.licencia_fin,
      activa: !vencida && row.activa === true,
      tipo: 'LEGACY_EMPRESA',
    },
    modulos,
    modulos_detalle,
    metadata: {
      ...buildBaseStatus(meta).metadata,
      legacy_fallback_used: true,
      source_selected: SOURCE_KEYS.LEGACY,
    },
  };
}

async function resolveSaasStatus(empresaId, queryable, meta) {
  try {
    const { rows } = await queryable.query(SQL_SAAS_STATUS, [empresaId]);
    if (!rows.length) return null;
    return buildSaasStatus(rows[0], meta);
  } catch (error) {
    if (!isSchemaMissingError(error)) throw error;
    meta.schema_warnings.push({
      source: SOURCE_KEYS.SAAS,
      code: error.code,
      message: error.message,
    });
    return null;
  }
}

async function resolveClassicLicenseStatus(empresaId, queryable, meta) {
  try {
    const { rows } = await queryable.query(SQL_CLASSIC_STATUS, [empresaId]);
    if (!rows.length) return null;
    return buildClassicStatus(rows[0], meta);
  } catch (error) {
    if (!isSchemaMissingError(error)) throw error;
    meta.schema_warnings.push({
      source: SOURCE_KEYS.CLASSIC,
      code: error.code,
      message: error.message,
    });
    return null;
  }
}

async function resolveLegacyEmpresaStatus(empresaId, queryable, meta) {
  try {
    const { rows } = await queryable.query(SQL_LEGACY_STATUS, [empresaId]);
    if (!rows.length) return null;
    return buildLegacyStatus(rows[0], meta);
  } catch (error) {
    if (!isSchemaMissingError(error)) throw error;
    meta.schema_warnings.push({
      source: SOURCE_KEYS.LEGACY,
      code: error.code,
      message: error.message,
    });
    return null;
  }
}

async function getLicenseStatus(empresaId, arg2, arg3) {
  const { options, queryable } = normalizeResolverInput(arg2, arg3);
  const sourceOrder = normalizeSourceList(options);
  const meta = {
    legacy_fallback_enabled: isLegacyFallbackEnabled(options),
    source_order: sourceOrder,
    schema_warnings: [],
    source_attempted: [],
  };

  for (const source of sourceOrder) {
    meta.source_attempted.push(source);

    let status = null;
    if (source === SOURCE_KEYS.SAAS) {
      status = await resolveSaasStatus(empresaId, queryable, meta);
    } else if (source === SOURCE_KEYS.CLASSIC) {
      status = await resolveClassicLicenseStatus(empresaId, queryable, meta);
    } else if (source === SOURCE_KEYS.LEGACY) {
      status = await resolveLegacyEmpresaStatus(empresaId, queryable, meta);
    }

    if (status) {
      status.metadata.source_attempted = [...meta.source_attempted];
      status.metadata.schema_warnings = [...meta.schema_warnings];
      return status;
    }
  }

  const empty = buildBaseStatus(meta);
  empty.metadata.source_attempted = [...meta.source_attempted];
  empty.metadata.schema_warnings = [...meta.schema_warnings];
  return empty;
}

async function hasModulo(empresaId, moduloNombre, arg3, arg4) {
  const { options, queryable } = normalizeResolverInput(arg3, arg4);
  const status = await getLicenseStatus(empresaId, options, queryable);
  return status.vigente && status.modulos.includes(normalizeModulo(moduloNombre));
}

async function getLimite(empresaId, moduloNombre, arg3, arg4) {
  const { options, queryable } = normalizeResolverInput(arg3, arg4);
  const status = await getLicenseStatus(empresaId, options, queryable);
  const detalle = status.modulos_detalle.find((modulo) => modulo.nombre === normalizeModulo(moduloNombre));
  return normalizeLimit(detalle?.limite);
}

module.exports = {
  SOURCE_KEYS,
  getLicenseStatus,
  getLimite,
  hasModulo,
  isLegacyFallbackEnabled,
  resolveEstadoReal,
};
