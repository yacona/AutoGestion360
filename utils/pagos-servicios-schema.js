const db = require("../db");

let schemaReady = false;

async function ensurePagosServiciosSchema(queryable = db) {
  if (schemaReady && queryable === db) return;

  await queryable.query(`
    CREATE TABLE IF NOT EXISTS pagos_servicios (
      id BIGSERIAL PRIMARY KEY,
      empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      modulo VARCHAR(30) NOT NULL,
      referencia_id BIGINT NOT NULL,
      monto NUMERIC(14,2) NOT NULL DEFAULT 0,
      metodo_pago VARCHAR(30) NOT NULL,
      referencia_transaccion VARCHAR(120),
      detalle_pago JSONB,
      estado VARCHAR(30) NOT NULL DEFAULT 'APLICADO',
      usuario_registro_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
      fecha_pago TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await queryable.query(`
    CREATE INDEX IF NOT EXISTS pagos_servicios_lookup_idx
    ON pagos_servicios (empresa_id, modulo, referencia_id, fecha_pago DESC)
  `);

  await queryable.query(`
    CREATE INDEX IF NOT EXISTS pagos_servicios_fecha_idx
    ON pagos_servicios (empresa_id, fecha_pago DESC)
  `);

  if (queryable === db) schemaReady = true;
}

module.exports = {
  ensurePagosServiciosSchema,
};
