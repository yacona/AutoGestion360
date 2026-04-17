-- ============================================================
-- AutoGestión360 — Migración 002: Núcleo SaaS (Planes y Suscripciones)
-- Versión: 002
-- Fecha: 2026-04-17
--
-- Diseño:
--   planes          → catálogo de productos (Starter / Pro / Enterprise)
--   plan_modulos    → qué módulos incluye cada plan y sus límites
--   suscripciones   → contrato activo empresa↔plan (reemplaza suscripciones_empresa)
--   empresa_modulos → sobreescrituras por empresa (add-ons o restricciones)
--
-- Compatibilidad:
--   • No elimina licencias, licencia_modulo, empresa_licencia ni suscripciones_empresa.
--   • No elimina columnas legacy de empresas (licencia_tipo, licencia_fin, licencia_id).
--   • Extiende modulos con columnas activo/orden/icono_clave.
--   • El licenseService resuelve la cadena: planes → licencias → legacy.
--
-- Idempotente: seguro ejecutar múltiples veces.
-- ============================================================

SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;


-- ────────────────────────────────────────────
-- PASO 1: Extender tabla modulos existente
-- ────────────────────────────────────────────

ALTER TABLE modulos
    ADD COLUMN IF NOT EXISTS activo      BOOLEAN  NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS orden       SMALLINT          DEFAULT 0,
    ADD COLUMN IF NOT EXISTS icono_clave VARCHAR(50);      -- nombre de ícono (e.g. 'car', 'wrench')


-- ────────────────────────────────────────────
-- PASO 2: Tabla planes
-- ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS planes (
    id              SERIAL PRIMARY KEY,
    codigo          VARCHAR(30)   NOT NULL UNIQUE,   -- 'starter' | 'pro' | 'enterprise'
    nombre          VARCHAR(100)  NOT NULL,
    descripcion     TEXT,
    precio_mensual  NUMERIC(12,2) NOT NULL DEFAULT 0,
    precio_anual    NUMERIC(12,2),                   -- NULL = no aplica opción anual
    moneda          VARCHAR(10)   NOT NULL DEFAULT 'COP',
    trial_dias      INTEGER       NOT NULL DEFAULT 14,
    -- Límites globales (NULL = ilimitado)
    max_usuarios    INTEGER,
    max_vehiculos   INTEGER,
    max_empleados   INTEGER,
    -- Control
    es_publico      BOOLEAN NOT NULL DEFAULT TRUE,   -- visible en página de precios
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    orden           SMALLINT      NOT NULL DEFAULT 0,
    metadata        JSONB,
    creado_en       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    actualizado_en  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  planes IS 'Catálogo de planes SaaS. Cada plan define precio, límites globales y módulos incluidos vía plan_modulos.';
COMMENT ON COLUMN planes.codigo IS 'Identificador programático inmutable: starter, pro, enterprise.';
COMMENT ON COLUMN planes.max_usuarios IS 'Máximo de usuarios activos. NULL = sin límite.';


-- ────────────────────────────────────────────
-- PASO 3: Tabla plan_modulos
-- ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS plan_modulos (
    id                  SERIAL PRIMARY KEY,
    plan_id             INTEGER NOT NULL REFERENCES planes(id)  ON DELETE CASCADE,
    modulo_id           INTEGER NOT NULL REFERENCES modulos(id) ON DELETE CASCADE,
    -- Límite de registros específico del módulo en este plan (NULL = ilimitado)
    limite_registros    INTEGER,
    activo              BOOLEAN NOT NULL DEFAULT TRUE,
    metadata            JSONB,
    UNIQUE (plan_id, modulo_id)
);

COMMENT ON TABLE  plan_modulos IS 'Módulos incluidos en cada plan con sus límites opcionales.';
COMMENT ON COLUMN plan_modulos.limite_registros IS 'Límite de registros para este módulo en el plan. NULL = ilimitado.';

CREATE INDEX IF NOT EXISTS plan_modulos_plan_idx
    ON plan_modulos (plan_id)
    WHERE activo = TRUE;


-- ────────────────────────────────────────────
-- PASO 4: Tabla suscripciones (nueva, limpia)
-- ────────────────────────────────────────────
-- Diferencia con suscripciones_empresa:
--   • Referencia planes en lugar de licencias.
--   • Soporta historial (múltiples filas por empresa).
--   • La restricción de unicidad activa/trial es un índice parcial.
--   • Incluye ciclo (MENSUAL/ANUAL) y trial_hasta explícito.

CREATE TABLE IF NOT EXISTS suscripciones (
    id                      BIGSERIAL PRIMARY KEY,
    empresa_id              BIGINT      NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    plan_id                 INTEGER     NOT NULL REFERENCES planes(id)   ON DELETE RESTRICT,
    estado                  VARCHAR(20) NOT NULL DEFAULT 'TRIAL',
    -- CHECK soft (validado en applicación): TRIAL, ACTIVA, VENCIDA, SUSPENDIDA, CANCELADA
    fecha_inicio            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fecha_fin               TIMESTAMPTZ,              -- NULL = sin vencimiento (Enterprise custom)
    trial_hasta             TIMESTAMPTZ,              -- calculado: fecha_inicio + plan.trial_dias días
    ciclo                   VARCHAR(10) NOT NULL DEFAULT 'MENSUAL', -- MENSUAL | ANUAL
    renovacion_automatica   BOOLEAN     NOT NULL DEFAULT FALSE,
    pasarela                VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
    referencia_externa      VARCHAR(150),             -- ID en pasarela de pago
    precio_pactado          NUMERIC(12,2) NOT NULL DEFAULT 0,
    moneda                  VARCHAR(10) NOT NULL DEFAULT 'COP',
    observaciones           TEXT,
    metadata                JSONB,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  suscripciones IS 'Contrato vigente empresa↔plan. Soporta historial. Solo una fila TRIAL o ACTIVA por empresa (índice parcial).';
COMMENT ON COLUMN suscripciones.trial_hasta IS 'Calculado al crear: fecha_inicio + planes.trial_dias. NULL si no es trial.';
COMMENT ON COLUMN suscripciones.fecha_fin   IS 'NULL en planes Enterprise con precio negociado sin vencimiento.';

-- Restricción: máximo 1 suscripción TRIAL o ACTIVA por empresa en simultáneo
CREATE UNIQUE INDEX IF NOT EXISTS suscripciones_empresa_activa_uniq
    ON suscripciones (empresa_id)
    WHERE estado IN ('TRIAL', 'ACTIVA');

CREATE INDEX IF NOT EXISTS suscripciones_estado_fin_idx
    ON suscripciones (estado, fecha_fin);

CREATE INDEX IF NOT EXISTS suscripciones_empresa_hist_idx
    ON suscripciones (empresa_id, creado_en DESC);


-- ────────────────────────────────────────────
-- PASO 5: Tabla empresa_modulos (sobreescrituras)
-- ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS empresa_modulos (
    id              BIGSERIAL PRIMARY KEY,
    empresa_id      BIGINT  NOT NULL REFERENCES empresas(id)  ON DELETE CASCADE,
    modulo_id       INTEGER NOT NULL REFERENCES modulos(id)   ON DELETE CASCADE,
    -- activo=FALSE desactiva el módulo aunque el plan lo incluya
    -- activo=TRUE  añade el módulo aunque el plan no lo incluya (add-on)
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    -- NULL → usar límite del plan; 0 → ilimitado (override explícito)
    limite_override INTEGER,
    notas           TEXT,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (empresa_id, modulo_id)
);

COMMENT ON TABLE  empresa_modulos IS 'Sobreescrituras por empresa: deshabilitar módulos del plan, o añadir módulos fuera del plan (add-ons).';
COMMENT ON COLUMN empresa_modulos.limite_override IS '0 = ilimitado para esta empresa; NULL = heredar límite del plan.';

CREATE INDEX IF NOT EXISTS empresa_modulos_empresa_idx
    ON empresa_modulos (empresa_id);


-- ────────────────────────────────────────────
-- PASO 6: Seeds — Módulos (actualiza los existentes)
-- ────────────────────────────────────────────

INSERT INTO modulos (nombre, descripcion, activo, orden, icono_clave) VALUES
    ('dashboard',    'Panel general de operación',            TRUE, 0,  'layout-dashboard'),
    ('parqueadero',  'Gestión de parqueadero',                TRUE, 1,  'car'),
    ('lavadero',     'Gestión de lavadero',                   TRUE, 2,  'droplets'),
    ('taller',       'Gestión de taller mecánico',            TRUE, 3,  'wrench'),
    ('clientes',     'Gestión de clientes y vehículos',       TRUE, 4,  'users'),
    ('empleados',    'Gestión de empleados y equipo',         TRUE, 5,  'user-check'),
    ('reportes',     'Reportes e indicadores de gestión',     TRUE, 6,  'bar-chart-2'),
    ('configuracion','Configuración de empresa y tarifas',    TRUE, 7,  'settings'),
    ('usuarios',     'Usuarios y roles de acceso',            TRUE, 8,  'shield'),
    ('empresas',     'Administración multi-empresa (SaaS)',   TRUE, 9,  'building-2')
ON CONFLICT (nombre) DO UPDATE
    SET descripcion  = EXCLUDED.descripcion,
        activo       = EXCLUDED.activo,
        orden        = EXCLUDED.orden,
        icono_clave  = EXCLUDED.icono_clave;


-- ────────────────────────────────────────────
-- PASO 7: Seeds — Planes
-- ────────────────────────────────────────────

INSERT INTO planes (codigo, nombre, descripcion, precio_mensual, precio_anual, moneda, trial_dias,
                    max_usuarios, max_vehiculos, max_empleados, es_publico, activo, orden)
VALUES
    -- Starter: negocio pequeño, solo parqueadero
    ('starter',
     'Starter',
     'Ideal para parqueaderos pequeños. Incluye parqueadero, clientes y reportes básicos.',
     49900, 479000, 'COP', 14,
     3, 500, 5,
     TRUE, TRUE, 1),

    -- Pro: negocio mediano, todos los módulos operativos
    ('pro',
     'Pro',
     'Para negocios en crecimiento. Parqueadero + Lavadero + Taller + equipo completo.',
     99900, 959000, 'COP', 14,
     10, NULL, NULL,
     TRUE, TRUE, 2),

    -- Enterprise: SaaS completo, multi-empresa, sin límites
    ('enterprise',
     'Enterprise',
     'Plataforma completa. Multi-empresa, administración SaaS, módulos ilimitados.',
     199900, 1919000, 'COP', 30,
     NULL, NULL, NULL,
     TRUE, TRUE, 3)

ON CONFLICT (codigo) DO UPDATE
    SET nombre          = EXCLUDED.nombre,
        descripcion     = EXCLUDED.descripcion,
        precio_mensual  = EXCLUDED.precio_mensual,
        precio_anual    = EXCLUDED.precio_anual,
        trial_dias      = EXCLUDED.trial_dias,
        max_usuarios    = EXCLUDED.max_usuarios,
        max_vehiculos   = EXCLUDED.max_vehiculos,
        max_empleados   = EXCLUDED.max_empleados,
        activo          = EXCLUDED.activo,
        actualizado_en  = NOW();


-- ────────────────────────────────────────────
-- PASO 8: Seeds — plan_modulos
-- (qué módulos incluye cada plan y sus límites)
-- ────────────────────────────────────────────

-- STARTER: dashboard, parqueadero, clientes, configuracion, reportes (limitado)
INSERT INTO plan_modulos (plan_id, modulo_id, limite_registros, activo)
SELECT p.id, m.id,
    CASE m.nombre
        WHEN 'reportes'   THEN 90   -- días de historial exportable
        ELSE NULL                   -- resto: ilimitado
    END,
    TRUE
FROM planes p, modulos m
WHERE p.codigo = 'starter'
  AND m.nombre IN ('dashboard', 'parqueadero', 'clientes', 'configuracion', 'reportes')
ON CONFLICT (plan_id, modulo_id) DO UPDATE
    SET limite_registros = EXCLUDED.limite_registros,
        activo           = EXCLUDED.activo;

-- PRO: starter + lavadero, taller, empleados, usuarios
INSERT INTO plan_modulos (plan_id, modulo_id, limite_registros, activo)
SELECT p.id, m.id, NULL, TRUE
FROM planes p, modulos m
WHERE p.codigo = 'pro'
  AND m.nombre IN (
      'dashboard', 'parqueadero', 'lavadero', 'taller',
      'clientes', 'empleados', 'reportes', 'configuracion', 'usuarios'
  )
ON CONFLICT (plan_id, modulo_id) DO UPDATE
    SET limite_registros = EXCLUDED.limite_registros,
        activo           = EXCLUDED.activo;

-- ENTERPRISE: todos los módulos, sin límites
INSERT INTO plan_modulos (plan_id, modulo_id, limite_registros, activo)
SELECT p.id, m.id, NULL, TRUE
FROM planes p, modulos m
WHERE p.codigo = 'enterprise'
ON CONFLICT (plan_id, modulo_id) DO UPDATE
    SET limite_registros = EXCLUDED.limite_registros,
        activo           = EXCLUDED.activo;


-- ────────────────────────────────────────────
-- PASO 9: Migrar suscripciones_empresa → suscripciones
-- Solo empresas que aún no tengan registro en la nueva tabla.
-- Mapeo de licencias → planes:
--   Demo / Básica → starter
--   Pro           → pro
--   Premium       → enterprise
-- ────────────────────────────────────────────

INSERT INTO suscripciones (
    empresa_id, plan_id, estado, fecha_inicio, fecha_fin,
    trial_hasta, ciclo, renovacion_automatica, pasarela,
    precio_pactado, moneda, observaciones, creado_en, actualizado_en
)
SELECT
    se.empresa_id,
    COALESCE(
        (SELECT p.id
         FROM planes p
         WHERE p.codigo = CASE
             WHEN LOWER(COALESCE(l.nombre, 'demo')) LIKE '%premium%'  THEN 'enterprise'
             WHEN LOWER(COALESCE(l.nombre, 'demo')) LIKE '%pro%'      THEN 'pro'
             ELSE 'starter'
         END
         LIMIT 1),
        (SELECT id FROM planes WHERE codigo = 'starter' LIMIT 1)
    )                                                AS plan_id,
    se.estado,
    se.fecha_inicio,
    se.fecha_fin,
    -- trial_hasta: si está en TRIAL y no hay fecha_fin, calcular 14 días desde inicio
    CASE
        WHEN se.estado = 'TRIAL' AND se.fecha_fin IS NULL
        THEN se.fecha_inicio + INTERVAL '14 days'
        ELSE NULL
    END                                              AS trial_hasta,
    'MENSUAL'                                        AS ciclo,
    se.renovacion_automatica,
    se.pasarela,
    se.precio_plan,
    se.moneda,
    'Migrada automáticamente desde suscripciones_empresa'  AS observaciones,
    se.creado_en,
    se.actualizado_en
FROM suscripciones_empresa se
LEFT JOIN licencias l ON l.id = se.licencia_id
WHERE NOT EXISTS (
    SELECT 1 FROM suscripciones s2
    WHERE s2.empresa_id = se.empresa_id
      AND s2.estado IN ('TRIAL', 'ACTIVA')
)
ON CONFLICT DO NOTHING;

-- ============================================================
-- FIN DE MIGRACIÓN 002
-- ============================================================
