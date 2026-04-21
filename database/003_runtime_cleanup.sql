-- ============================================================
-- AutoGestión360 — Migración 003: Runtime Cleanup / Compatibilidad
-- Fecha: 2026-04-21
--
-- Objetivo:
--   sacar del runtime la creación de tablas legacy/compatibilidad que antes
--   vivía en utils/licencias-schema.js y utils/suscripciones-schema.js.
--
-- Importante:
--   la fuente oficial de autorización ya es:
--     suscripciones + planes + plan_modulos + empresa_modulos
--
--   Las estructuras creadas aquí permanecen solo como compatibilidad temporal
--   para endpoints/admin legacy y migración de bases existentes.
-- ============================================================

SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;

-- ────────────────────────────────────────────
-- 1. Compatibilidad de licencias clásicas
-- ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS licencias (
    id          SERIAL PRIMARY KEY,
    nombre      VARCHAR(100) NOT NULL UNIQUE,
    descripcion TEXT,
    precio      NUMERIC(10,2),
    creado_en   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE empresas
    ADD COLUMN IF NOT EXISTS licencia_id INTEGER REFERENCES licencias(id),
    ADD COLUMN IF NOT EXISTS licencia_inicio TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS licencia_fin TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS modulos (
    id          SERIAL PRIMARY KEY,
    nombre      VARCHAR(100) NOT NULL UNIQUE,
    descripcion TEXT,
    activo      BOOLEAN NOT NULL DEFAULT TRUE,
    orden       SMALLINT DEFAULT 0,
    icono_clave VARCHAR(50),
    creado_en   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS licencia_modulo (
    id          SERIAL PRIMARY KEY,
    licencia_id INTEGER NOT NULL REFERENCES licencias(id) ON DELETE CASCADE,
    modulo_id   INTEGER NOT NULL REFERENCES modulos(id) ON DELETE CASCADE,
    UNIQUE (licencia_id, modulo_id)
);

CREATE TABLE IF NOT EXISTS empresa_licencia (
    id           SERIAL PRIMARY KEY,
    empresa_id   BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    licencia_id  INTEGER NOT NULL REFERENCES licencias(id) ON DELETE CASCADE,
    fecha_inicio TIMESTAMPTZ DEFAULT NOW(),
    fecha_fin    TIMESTAMPTZ,
    activa       BOOLEAN DEFAULT TRUE,
    creado_en    TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS empresa_licencia_empresa_id_key
    ON empresa_licencia (empresa_id);

INSERT INTO modulos (nombre, descripcion, activo, orden, icono_clave) VALUES
    ('dashboard',    'Panel general de operación', TRUE, 0, 'layout-dashboard'),
    ('parqueadero',  'Gestión de parqueadero', TRUE, 1, 'car'),
    ('clientes',     'Gestión de clientes', TRUE, 2, 'users'),
    ('reportes',     'Reportes e indicadores', TRUE, 3, 'bar-chart-2'),
    ('lavadero',     'Gestión de lavadero', TRUE, 4, 'droplets'),
    ('taller',       'Gestión de taller', TRUE, 5, 'wrench'),
    ('empleados',    'Gestión de empleados y equipo', TRUE, 6, 'user-check'),
    ('usuarios',     'Usuarios y roles', TRUE, 7, 'shield'),
    ('configuracion','Configuración de empresa', TRUE, 8, 'settings'),
    ('empresas',     'Administración multiempresa', TRUE, 9, 'building-2')
ON CONFLICT (nombre) DO UPDATE
    SET descripcion = EXCLUDED.descripcion,
        activo = EXCLUDED.activo,
        orden = EXCLUDED.orden,
        icono_clave = EXCLUDED.icono_clave;

INSERT INTO licencias (nombre, descripcion, precio) VALUES
    ('Demo',    'Licencia de demostración para validar operación básica.', 0),
    ('Básica',  'Plan esencial para operación de parqueadero y reportes.', 50000),
    ('Pro',     'Plan operativo con parqueadero, lavadero, taller y usuarios.', 120000),
    ('Premium', 'Plan completo con administración SaaS multi-empresa.', 220000)
ON CONFLICT (nombre) DO UPDATE
    SET descripcion = EXCLUDED.descripcion,
        precio = EXCLUDED.precio;

INSERT INTO licencia_modulo (licencia_id, modulo_id)
SELECT l.id, m.id
FROM licencias l
JOIN modulos m ON (
    (l.nombre = 'Demo'    AND m.nombre IN ('dashboard', 'parqueadero', 'clientes'))
 OR (l.nombre = 'Básica'  AND m.nombre IN ('dashboard', 'parqueadero', 'clientes', 'reportes', 'configuracion'))
 OR (l.nombre = 'Pro'     AND m.nombre IN ('dashboard', 'parqueadero', 'clientes', 'reportes', 'lavadero', 'taller', 'empleados', 'usuarios', 'configuracion'))
 OR (l.nombre = 'Premium' AND m.nombre IN ('dashboard', 'parqueadero', 'clientes', 'reportes', 'lavadero', 'taller', 'empleados', 'usuarios', 'configuracion', 'empresas'))
)
ON CONFLICT (licencia_id, modulo_id) DO NOTHING;

UPDATE empresas e
SET licencia_id = COALESCE(e.licencia_id, el.licencia_id),
    licencia_inicio = COALESCE(e.licencia_inicio, el.fecha_inicio),
    licencia_fin = COALESCE(e.licencia_fin, el.fecha_fin)
FROM empresa_licencia el
WHERE el.empresa_id = e.id
  AND el.activa = TRUE
  AND e.licencia_id IS NULL;

UPDATE empresas e
SET licencia_id = l.id,
    licencia_inicio = COALESCE(e.licencia_inicio, NOW())
FROM licencias l
WHERE e.licencia_id IS NULL
  AND LOWER(translate(l.nombre, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) =
      LOWER(translate(COALESCE(e.licencia_tipo, 'Demo'), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'));

-- ────────────────────────────────────────────
-- 2. Compatibilidad de suscripciones legacy
-- ────────────────────────────────────────────

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

INSERT INTO suscripciones_empresa (
    empresa_id, licencia_id, estado, fecha_inicio, fecha_fin,
    renovacion_automatica, pasarela, moneda, precio_plan, observaciones
)
SELECT
    e.id,
    COALESCE(el.licencia_id, e.licencia_id),
    CASE
        WHEN e.activa = FALSE THEN 'SUSPENDIDA'
        WHEN COALESCE(el.fecha_fin, e.licencia_fin) IS NOT NULL
             AND COALESCE(el.fecha_fin, e.licencia_fin) < NOW() THEN 'VENCIDA'
        WHEN LOWER(COALESCE(l.nombre, e.licencia_tipo, 'Demo')) = 'demo' THEN 'TRIAL'
        ELSE 'ACTIVA'
    END,
    COALESCE(el.fecha_inicio, e.licencia_inicio, NOW()),
    COALESCE(el.fecha_fin, e.licencia_fin),
    FALSE,
    'MANUAL',
    'COP',
    COALESCE(l.precio, 0),
    'Compatibilidad legacy creada por database/003_runtime_cleanup.sql'
FROM empresas e
LEFT JOIN empresa_licencia el
    ON el.empresa_id = e.id
   AND el.activa = TRUE
LEFT JOIN licencias l
    ON l.id = COALESCE(el.licencia_id, e.licencia_id)
ON CONFLICT (empresa_id) DO NOTHING;

-- ────────────────────────────────────────────
-- 3. Nota operativa
-- ────────────────────────────────────────────
-- Después de aplicar esta migración:
--   1. el backend ya no crea estas tablas dinámicamente
--   2. la autorización principal se resuelve desde `suscripciones`
--   3. la compatibilidad legacy solo opera si
--      ALLOW_LEGACY_LICENSE_FALLBACK=true
-- ============================================================
