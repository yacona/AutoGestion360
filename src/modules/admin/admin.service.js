'use strict';

/**
 * admin.service.js
 *
 * Fachada del módulo admin SaaS.
 * Expone una API estable para routes/controller y delega la lógica base del
 * catálogo y lifecycle a services/adminService.js.
 */

const db = require('../../../db');
const adminCatalogService = require('../../../services/adminService');
const { getLicenseStatus } = require('../../../services/licenseService');

async function getSuscripcionActual(empresaId, queryable = db) {
  const { rows } = await queryable.query(
    `
    SELECT
      s.id,
      s.empresa_id,
      s.plan_id,
      p.codigo AS plan_codigo,
      p.nombre AS plan_nombre,
      p.precio_mensual,
      p.precio_anual,
      p.max_usuarios,
      p.max_vehiculos,
      p.max_empleados,
      s.estado,
      s.fecha_inicio,
      s.fecha_fin,
      s.trial_hasta,
      s.ciclo,
      s.precio_pactado,
      s.moneda,
      s.pasarela,
      s.observaciones,
      s.creado_en,
      s.actualizado_en
    FROM suscripciones s
    JOIN planes p ON p.id = s.plan_id
    WHERE s.empresa_id = $1 AND s.estado IN ('TRIAL', 'ACTIVA')
    ORDER BY
      CASE WHEN s.estado = 'TRIAL' THEN 0 ELSE 1 END,
      COALESCE(s.trial_hasta, s.fecha_fin, s.actualizado_en, s.creado_en) DESC NULLS LAST,
      s.id DESC
    LIMIT 1
    `,
    [empresaId]
  );

  if (rows.length === 0) {
    return { suscripcion: null, mensaje: 'Sin suscripción activa.' };
  }

  return rows[0];
}

async function getHistorialSuscripciones(empresaId, queryable = db) {
  const { rows } = await queryable.query(
    `
    SELECT
      s.id,
      s.empresa_id,
      s.plan_id,
      p.codigo AS plan_codigo,
      p.nombre AS plan_nombre,
      s.estado,
      s.fecha_inicio,
      s.fecha_fin,
      s.trial_hasta,
      s.ciclo,
      s.precio_pactado,
      s.moneda,
      s.pasarela,
      s.observaciones,
      s.creado_en,
      s.actualizado_en
    FROM suscripciones s
    JOIN planes p ON p.id = s.plan_id
    WHERE s.empresa_id = $1
    ORDER BY COALESCE(s.actualizado_en, s.creado_en) DESC, s.id DESC
    `,
    [empresaId]
  );

  return rows;
}

function buildSaasAccessResolution(status) {
  if (!status) {
    return {
      fuente: null,
      oficial: false,
      estado: 'SIN_LICENCIA',
      vigente: false,
      legacy_fallback_used: false,
      modulos: [],
      modulos_detalle: [],
      limites: { usuarios: null, vehiculos: null, empleados: null, sedes: null },
      plan: null,
      suscripcion: null,
    };
  }

  return {
    fuente: status.fuente,
    oficial: status.oficial === true,
    estado: status.estado,
    vigente: status.vigente === true,
    legacy_fallback_used: status.metadata?.legacy_fallback_used === true,
    modulos: status.modulos || [],
    modulos_detalle: status.modulos_detalle || [],
    limites: status.limites || { usuarios: null, vehiculos: null, empleados: null, sedes: null },
    plan: status.plan || null,
    suscripcion: status.suscripcion || null,
  };
}

async function getEmpresaSaaSDetail(empresaId, queryable = db) {
  const [
    empresa,
    modulos,
    limites,
    suscripcionActual,
    historialSuscripciones,
    accesoSaas,
  ] = await Promise.all([
    adminCatalogService.getEmpresaCompleta(empresaId, queryable),
    adminCatalogService.getModulosParaEmpresa(empresaId, queryable),
    adminCatalogService.getLimitesEfectivos(empresaId, queryable),
    getSuscripcionActual(empresaId, queryable),
    getHistorialSuscripciones(empresaId, queryable),
    getLicenseStatus(empresaId, {
      sources: ['saas'],
      allowLegacyFallback: false,
    }, queryable),
  ]);

  return {
    ...empresa,
    modulos,
    limites,
    suscripcion_actual: suscripcionActual?.suscripcion === null ? null : suscripcionActual,
    historial_suscripciones: historialSuscripciones,
    saas_status: buildSaasAccessResolution(accesoSaas),
  };
}

async function getEstadoSaaSConsolidado(empresaId, queryable = db) {
  return getEmpresaSaaSDetail(empresaId, queryable);
}

module.exports = {
  ...adminCatalogService,
  getEmpresaSaaSDetail,
  getEstadoSaaSConsolidado,
  getHistorialSuscripciones,
  getSuscripcionActual,
};
