'use strict';

const db = require('../../db');
const AppError = require('./AppError');
const { getLicenseStatus } = require('../../services/licenseService');

const RESOURCE_CONFIG = {
  usuarios: {
    label: 'usuario',
    table: 'usuarios',
    countColumn: 'activo',
  },
  sedes: {
    label: 'sede',
    table: 'sedes',
    countColumn: 'activa',
  },
};

function getQueryable(queryable = db) {
  return queryable;
}

function getResourceConfig(resource) {
  const config = RESOURCE_CONFIG[resource];
  if (!config) {
    throw new Error(`Recurso de límite no soportado: ${resource}`);
  }
  return config;
}

function getLimitValue(status, resource) {
  return status?.limites?.[resource] ?? null;
}

async function getCompanyLimits(empresaId, queryable = db) {
  return getLicenseStatus(empresaId, {
    sources: ['saas'],
    allowLegacyFallback: false,
  }, getQueryable(queryable));
}

async function countActiveResources(resource, empresaId, queryable = db) {
  const config = getResourceConfig(resource);
  const { rows } = await getQueryable(queryable).query(
    `SELECT COUNT(*)::int AS total
     FROM ${config.table}
     WHERE empresa_id = $1
       AND ${config.countColumn} = TRUE`,
    [empresaId]
  );

  return Number(rows[0]?.total || 0);
}

async function assertCanConsumeResource(resource, empresaId, queryable = db) {
  const config = getResourceConfig(resource);
  const [status, activeCount] = await Promise.all([
    getCompanyLimits(empresaId, queryable),
    countActiveResources(resource, empresaId, queryable),
  ]);

  const limitValue = getLimitValue(status, resource);
  if (limitValue === null || limitValue === undefined) {
    return {
      allowed: true,
      limit: null,
      current: activeCount,
      next: activeCount + 1,
      status,
    };
  }

  const nextCount = activeCount + 1;
  if (nextCount > limitValue) {
    throw new AppError(
      `Tu plan permite máximo ${limitValue} ${config.label}${limitValue === 1 ? '' : 's'} activa${limitValue === 1 ? '' : 's'}. Actualiza tu plan para agregar más.`,
      403
    );
  }

  return {
    allowed: true,
    limit: limitValue,
    current: activeCount,
    next: nextCount,
    status,
  };
}

async function assertCanCreateUsuario(empresaId, queryable = db) {
  return assertCanConsumeResource('usuarios', empresaId, queryable);
}

async function assertCanCreateSede(empresaId, queryable = db) {
  return assertCanConsumeResource('sedes', empresaId, queryable);
}

module.exports = {
  getCompanyLimits,
  countActiveResources,
  assertCanConsumeResource,
  assertCanCreateUsuario,
  assertCanCreateSede,
};
