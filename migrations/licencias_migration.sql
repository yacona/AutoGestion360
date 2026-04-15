-- Sistema de licenciamiento por empresa y modulos.
-- Mantiene compatibilidad con el esquema actual de empresa_licencia y agrega
-- la referencia directa empresas.licencia_id sugerida para un modelo tipo SaaS.

CREATE TABLE IF NOT EXISTS licencias (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL UNIQUE,
  descripcion TEXT,
  precio NUMERIC(10, 2),
  creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS modulos (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL UNIQUE,
  descripcion TEXT,
  creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS licencia_modulo (
  id SERIAL PRIMARY KEY,
  licencia_id INTEGER NOT NULL REFERENCES licencias(id) ON DELETE CASCADE,
  modulo_id INTEGER NOT NULL REFERENCES modulos(id) ON DELETE CASCADE,
  UNIQUE (licencia_id, modulo_id)
);

CREATE TABLE IF NOT EXISTS empresa_licencia (
  id SERIAL PRIMARY KEY,
  empresa_id BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  licencia_id INTEGER NOT NULL REFERENCES licencias(id) ON DELETE CASCADE,
  fecha_inicio TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  fecha_fin TIMESTAMP WITH TIME ZONE,
  activa BOOLEAN DEFAULT TRUE,
  creado_en TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS empresa_licencia_empresa_id_key
ON empresa_licencia (empresa_id);

ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS licencia_id INTEGER REFERENCES licencias(id);

ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS licencia_inicio TIMESTAMP WITH TIME ZONE;

ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS licencia_fin TIMESTAMP WITH TIME ZONE;

UPDATE empresas e
SET licencia_id = COALESCE(e.licencia_id, el.licencia_id),
    licencia_inicio = COALESCE(e.licencia_inicio, el.fecha_inicio),
    licencia_fin = COALESCE(e.licencia_fin, el.fecha_fin)
FROM empresa_licencia el
WHERE el.empresa_id = e.id
  AND el.activa = true
  AND e.licencia_id IS NULL;

UPDATE empresas e
SET licencia_id = l.id,
    licencia_inicio = COALESCE(e.licencia_inicio, NOW())
FROM licencias l
WHERE e.licencia_id IS NULL
  AND LOWER(translate(l.nombre, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) =
      LOWER(translate(COALESCE(e.licencia_tipo, 'Demo'), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'));
