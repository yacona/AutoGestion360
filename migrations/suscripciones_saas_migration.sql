-- Sistema base de suscripciones SaaS y facturacion por empresa.

CREATE TABLE IF NOT EXISTS suscripciones_empresa (
  id BIGSERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL UNIQUE REFERENCES empresas(id) ON DELETE CASCADE,
  licencia_id INTEGER REFERENCES licencias(id) ON DELETE SET NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'TRIAL',
  fecha_inicio TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fecha_fin TIMESTAMPTZ,
  renovacion_automatica BOOLEAN NOT NULL DEFAULT FALSE,
  pasarela VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
  referencia_externa VARCHAR(150),
  observaciones TEXT,
  moneda VARCHAR(10) NOT NULL DEFAULT 'COP',
  precio_plan NUMERIC(12,2) NOT NULL DEFAULT 0,
  metadata JSONB,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS suscripciones_empresa_estado_idx
ON suscripciones_empresa (estado, fecha_fin);

CREATE INDEX IF NOT EXISTS suscripciones_empresa_licencia_idx
ON suscripciones_empresa (licencia_id);

CREATE TABLE IF NOT EXISTS facturas_saas (
  id BIGSERIAL PRIMARY KEY,
  suscripcion_id BIGINT REFERENCES suscripciones_empresa(id) ON DELETE SET NULL,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  licencia_id INTEGER REFERENCES licencias(id) ON DELETE SET NULL,
  numero_factura VARCHAR(60) NOT NULL UNIQUE,
  concepto VARCHAR(160) NOT NULL,
  periodo_inicio DATE,
  periodo_fin DATE,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  impuestos NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  moneda VARCHAR(10) NOT NULL DEFAULT 'COP',
  estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
  fecha_emision DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento DATE,
  fecha_pago TIMESTAMPTZ,
  metodo_pago VARCHAR(40),
  referencia_pago VARCHAR(150),
  pasarela VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
  metadata JSONB,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS facturas_saas_empresa_idx
ON facturas_saas (empresa_id, fecha_emision DESC);

CREATE INDEX IF NOT EXISTS facturas_saas_estado_idx
ON facturas_saas (estado, fecha_vencimiento);
