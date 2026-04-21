CREATE TABLE IF NOT EXISTS arqueos_caja (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
  fecha_caja DATE NOT NULL,
  desde TIMESTAMPTZ NOT NULL,
  hasta TIMESTAMPTZ NOT NULL,
  total_facturado NUMERIC(14,2) DEFAULT 0,
  total_recaudado NUMERIC(14,2) DEFAULT 0,
  total_pendiente NUMERIC(14,2) DEFAULT 0,
  efectivo_sistema NUMERIC(14,2) DEFAULT 0,
  efectivo_contado NUMERIC(14,2) DEFAULT 0,
  diferencia NUMERIC(14,2) DEFAULT 0,
  servicios_total INTEGER DEFAULT 0,
  servicios_pagados INTEGER DEFAULT 0,
  servicios_pendientes INTEGER DEFAULT 0,
  metodos_pago JSONB DEFAULT '[]'::jsonb,
  modulos JSONB DEFAULT '[]'::jsonb,
  responsables JSONB DEFAULT '[]'::jsonb,
  observaciones TEXT,
  estado VARCHAR(30) DEFAULT 'CERRADO',
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS arqueos_caja_empresa_fecha_idx
ON arqueos_caja (empresa_id, fecha_caja DESC, creado_en DESC);
