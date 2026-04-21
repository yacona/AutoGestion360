const db = require('../db');

// Compatibilidad transicional: este helper ya no crea ni altera esquema.
// La estructura se provisiona por migración SQL y aquí solo se valida.

const REQUIRED_TABLES = [
  'licencias',
  'modulos',
  'licencia_modulo',
  'empresa_licencia',
];

const REQUIRED_EMPRESAS_COLUMNS = [
  'licencia_id',
  'licencia_inicio',
  'licencia_fin',
];

let schemaValidated = false;

async function findMissingTables(queryable, tables) {
  const { rows } = await queryable.query(
    `SELECT item AS nombre
     FROM unnest($1::text[]) AS item
     WHERE to_regclass(item) IS NULL`,
    [tables]
  );
  return rows.map((row) => row.nombre);
}

async function findMissingColumns(queryable, tableName, columns) {
  const { rows } = await queryable.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
       AND column_name = ANY($2::text[])`,
    [tableName, columns]
  );

  const existentes = new Set(rows.map((row) => row.column_name));
  return columns.filter((column) => !existentes.has(column));
}

function buildSchemaError(missingTables, missingColumns) {
  const details = [];

  if (missingTables.length > 0) {
    details.push(`tablas faltantes: ${missingTables.join(', ')}`);
  }

  if (missingColumns.length > 0) {
    details.push(`columnas faltantes en empresas: ${missingColumns.join(', ')}`);
  }

  const error = new Error(
    `Esquema de licencias clásico no disponible (${details.join(' | ')}). Ejecuta database/003_runtime_cleanup.sql antes de usar compatibilidad legacy.`
  );
  error.code = 'SCHEMA_NOT_READY';
  error.status = 500;
  error.migration = 'database/003_runtime_cleanup.sql';
  return error;
}

/**
 * Compatibilidad transicional:
 * antes creaba/alteraba tablas en runtime; ahora solo valida que la
 * estructura exista y falle de forma explícita si la migración no se ha aplicado.
 */
async function ensureLicenciasSchema(queryable = db) {
  if (schemaValidated && queryable === db) {
    return { ok: true, missingTables: [], missingColumns: [] };
  }

  const [missingTables, missingColumns] = await Promise.all([
    findMissingTables(queryable, REQUIRED_TABLES),
    findMissingColumns(queryable, 'empresas', REQUIRED_EMPRESAS_COLUMNS),
  ]);

  if (missingTables.length > 0 || missingColumns.length > 0) {
    throw buildSchemaError(missingTables, missingColumns);
  }

  if (queryable === db) {
    schemaValidated = true;
  }

  return { ok: true, missingTables: [], missingColumns: [] };
}

module.exports = {
  ensureLicenciasSchema,
};
