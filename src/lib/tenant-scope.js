'use strict';

const AppError = require('./AppError');

const EMPRESA_SCOPED_TABLES = {
  clientes: 'clientes',
  empleados: 'empleados',
  empresas: 'empresas',
  tipos_lavado: 'tipos_lavado',
  usuarios: 'usuarios',
  vehiculos: 'vehiculos',
};

const GLOBAL_TABLES = {
  modulos: 'modulos',
  planes: 'planes',
};

async function assertEmpresaOwnedRecord(queryable, tableKey, empresaId, recordId, message) {
  if (recordId === undefined || recordId === null || recordId === '') return null;

  const tableName = EMPRESA_SCOPED_TABLES[tableKey];
  if (!tableName) throw new Error(`Tabla no permitida para scoping por empresa: ${tableKey}`);

  const query = tableKey === 'empresas'
    ? `SELECT id FROM ${tableName} WHERE id = $1 LIMIT 1`
    : `SELECT id FROM ${tableName} WHERE empresa_id = $1 AND id = $2 LIMIT 1`;

  const params = tableKey === 'empresas'
    ? [recordId]
    : [empresaId, recordId];

  const { rows } = await queryable.query(query, params);

  if (!rows.length) {
    throw new AppError(message || `Registro no encontrado en ${tableName} para esta empresa.`, 404);
  }

  return rows[0];
}

async function assertGlobalRecord(queryable, tableKey, recordId, message) {
  if (recordId === undefined || recordId === null || recordId === '') return null;

  const tableName = GLOBAL_TABLES[tableKey];
  if (!tableName) throw new Error(`Tabla global no permitida: ${tableKey}`);

  const { rows } = await queryable.query(
    `SELECT id FROM ${tableName} WHERE id = $1 LIMIT 1`,
    [recordId]
  );

  if (!rows.length) {
    throw new AppError(message || `Registro no encontrado en ${tableName}.`, 404);
  }

  return rows[0];
}

module.exports = {
  assertEmpresaOwnedRecord,
  assertGlobalRecord,
};
