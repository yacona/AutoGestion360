-- ============================================================
-- AutoGestion360 -- Migracion 006: normalizacion del nucleo SaaS
--
-- Objetivos:
--   1. Alinear usuarios platform/tenant con el codigo actual.
--   2. Consolidar `suscripciones` como fuente oficial de acceso SaaS.
--   3. Mantener tablas legacy como espejo de compatibilidad temporal.
--
-- Ejecucion:
--   psql -U <usuario> -d autogestion360 -f database/006_saas_core_normalization.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Usuarios platform / tenant
-- ------------------------------------------------------------

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS scope VARCHAR(10) NOT NULL DEFAULT 'tenant';

ALTER TABLE usuarios
  ALTER COLUMN empresa_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'usuarios_scope_check'
      AND conrelid = 'usuarios'::regclass
  ) THEN
    ALTER TABLE usuarios
      ADD CONSTRAINT usuarios_scope_check
      CHECK (scope IN ('platform', 'tenant'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'usuarios_scope_empresa_check'
      AND conrelid = 'usuarios'::regclass
  ) THEN
    ALTER TABLE usuarios
      ADD CONSTRAINT usuarios_scope_empresa_check
      CHECK (scope = 'platform' OR empresa_id IS NOT NULL);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS usuarios_platform_email_uniq
  ON usuarios (LOWER(email))
  WHERE scope = 'platform';

CREATE INDEX IF NOT EXISTS usuarios_scope_idx
  ON usuarios (scope);

-- ------------------------------------------------------------
-- 2. Indices y seeds del sistema oficial SaaS
-- ------------------------------------------------------------

DROP INDEX IF EXISTS suscripciones_empresa_activa_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS suscripciones_activa_uniq
  ON suscripciones (empresa_id)
  WHERE estado IN ('TRIAL', 'ACTIVA');

CREATE INDEX IF NOT EXISTS suscripciones_estado_fin_idx
  ON suscripciones (estado, fecha_fin);

CREATE INDEX IF NOT EXISTS suscripciones_empresa_hist_idx
  ON suscripciones (empresa_id, creado_en DESC);

INSERT INTO planes (
  codigo, nombre, descripcion, precio_mensual, precio_anual, moneda,
  trial_dias, max_usuarios, max_vehiculos, max_empleados,
  es_publico, activo, orden, metadata
)
VALUES
  ('starter', 'Starter', 'Ideal para parqueaderos pequeños. Incluye parqueadero, clientes y reportes básicos.', 49900, 479000, 'COP', 14, 3, 500, 5, TRUE, TRUE, 1, NULL),
  ('pro', 'Pro', 'Para negocios en crecimiento. Parqueadero, lavadero, taller y equipo completo.', 99900, 959000, 'COP', 14, 10, NULL, NULL, TRUE, TRUE, 2, NULL),
  ('enterprise', 'Enterprise', 'Plataforma completa con administración multiempresa y módulos ilimitados.', 199900, 1919000, 'COP', 30, NULL, NULL, NULL, TRUE, TRUE, 3, NULL)
ON CONFLICT (codigo) DO UPDATE
SET nombre = EXCLUDED.nombre,
    descripcion = EXCLUDED.descripcion,
    precio_mensual = EXCLUDED.precio_mensual,
    precio_anual = EXCLUDED.precio_anual,
    moneda = EXCLUDED.moneda,
    trial_dias = EXCLUDED.trial_dias,
    max_usuarios = EXCLUDED.max_usuarios,
    max_vehiculos = EXCLUDED.max_vehiculos,
    max_empleados = EXCLUDED.max_empleados,
    es_publico = EXCLUDED.es_publico,
    activo = EXCLUDED.activo,
    orden = EXCLUDED.orden;

INSERT INTO plan_modulos (plan_id, modulo_id, limite_registros, activo)
SELECT p.id, m.id, NULL, TRUE
FROM planes p
JOIN modulos m ON m.nombre IN ('dashboard', 'parqueadero', 'clientes', 'configuracion', 'reportes')
WHERE p.codigo = 'starter'
ON CONFLICT (plan_id, modulo_id) DO UPDATE
SET limite_registros = EXCLUDED.limite_registros,
    activo = EXCLUDED.activo;

INSERT INTO plan_modulos (plan_id, modulo_id, limite_registros, activo)
SELECT p.id, m.id, NULL, TRUE
FROM planes p
JOIN modulos m ON m.nombre IN (
  'dashboard', 'parqueadero', 'lavadero', 'taller',
  'clientes', 'empleados', 'reportes', 'configuracion', 'usuarios'
)
WHERE p.codigo = 'pro'
ON CONFLICT (plan_id, modulo_id) DO UPDATE
SET limite_registros = EXCLUDED.limite_registros,
    activo = EXCLUDED.activo;

INSERT INTO plan_modulos (plan_id, modulo_id, limite_registros, activo)
SELECT p.id, m.id, NULL, TRUE
FROM planes p
JOIN modulos m ON m.nombre IN (
  'dashboard', 'parqueadero', 'lavadero', 'taller',
  'clientes', 'empleados', 'reportes', 'configuracion',
  'usuarios', 'empresas'
)
WHERE p.codigo = 'enterprise'
ON CONFLICT (plan_id, modulo_id) DO UPDATE
SET limite_registros = EXCLUDED.limite_registros,
    activo = EXCLUDED.activo;

-- ------------------------------------------------------------
-- 3. Backfill hacia la fuente oficial: suscripciones
-- ------------------------------------------------------------

WITH legacy_candidates AS (
  SELECT
    se.empresa_id,
    se.licencia_id,
    l.nombre AS licencia_nombre,
    UPPER(COALESCE(se.estado, 'ACTIVA')) AS estado,
    se.fecha_inicio,
    se.fecha_fin,
    se.renovacion_automatica,
    COALESCE(se.pasarela, 'MANUAL') AS pasarela,
    COALESCE(se.precio_plan, l.precio, 0) AS precio_plan,
    COALESCE(se.moneda, 'COP') AS moneda,
    COALESCE(se.observaciones, 'Migrada desde suscripciones_empresa') AS observaciones,
    1 AS prioridad
  FROM suscripciones_empresa se
  LEFT JOIN licencias l ON l.id = se.licencia_id

  UNION ALL

  SELECT
    el.empresa_id,
    el.licencia_id,
    l.nombre AS licencia_nombre,
    CASE
      WHEN COALESCE(el.activa, TRUE) = FALSE THEN 'SUSPENDIDA'
      WHEN el.fecha_fin IS NOT NULL AND el.fecha_fin < NOW() THEN 'VENCIDA'
      ELSE 'ACTIVA'
    END AS estado,
    el.fecha_inicio,
    el.fecha_fin,
    FALSE AS renovacion_automatica,
    'MANUAL' AS pasarela,
    COALESCE(l.precio, 0) AS precio_plan,
    'COP' AS moneda,
    'Migrada desde empresa_licencia' AS observaciones,
    2 AS prioridad
  FROM empresa_licencia el
  LEFT JOIN licencias l ON l.id = el.licencia_id

  UNION ALL

  SELECT
    e.id AS empresa_id,
    e.licencia_id,
    l.nombre AS licencia_nombre,
    CASE
      WHEN COALESCE(e.activa, TRUE) = FALSE THEN 'SUSPENDIDA'
      WHEN e.licencia_fin IS NOT NULL AND e.licencia_fin < NOW() THEN 'VENCIDA'
      WHEN LOWER(COALESCE(e.licencia_tipo, 'demo')) = 'demo' THEN 'TRIAL'
      ELSE 'ACTIVA'
    END AS estado,
    e.licencia_inicio AS fecha_inicio,
    e.licencia_fin AS fecha_fin,
    FALSE AS renovacion_automatica,
    'MANUAL' AS pasarela,
    COALESCE(l.precio, 0) AS precio_plan,
    'COP' AS moneda,
    'Migrada desde empresas.licencia_*' AS observaciones,
    3 AS prioridad
  FROM empresas e
  LEFT JOIN licencias l ON l.id = e.licencia_id
  WHERE e.licencia_id IS NOT NULL OR e.licencia_tipo IS NOT NULL
),
legacy_ranked AS (
  SELECT DISTINCT ON (lc.empresa_id)
    lc.*
  FROM legacy_candidates lc
  ORDER BY lc.empresa_id, lc.prioridad ASC, lc.fecha_inicio DESC NULLS LAST
)
INSERT INTO suscripciones (
  empresa_id,
  plan_id,
  estado,
  fecha_inicio,
  fecha_fin,
  trial_hasta,
  ciclo,
  renovacion_automatica,
  pasarela,
  precio_pactado,
  moneda,
  observaciones,
  metadata,
  creado_en,
  actualizado_en
)
SELECT
  lr.empresa_id,
  p.id AS plan_id,
  CASE
    WHEN lr.estado IN ('TRIAL', 'ACTIVA', 'VENCIDA', 'SUSPENDIDA', 'CANCELADA') THEN lr.estado
    ELSE 'ACTIVA'
  END AS estado,
  COALESCE(lr.fecha_inicio, NOW()) AS fecha_inicio,
  CASE WHEN lr.estado = 'TRIAL' THEN NULL ELSE lr.fecha_fin END AS fecha_fin,
  CASE
    WHEN lr.estado = 'TRIAL' THEN COALESCE(
      lr.fecha_fin,
      COALESCE(lr.fecha_inicio, NOW()) + make_interval(days => COALESCE(p.trial_dias, 14))
    )
    ELSE NULL
  END AS trial_hasta,
  'MENSUAL' AS ciclo,
  COALESCE(lr.renovacion_automatica, FALSE),
  COALESCE(lr.pasarela, 'MANUAL'),
  COALESCE(lr.precio_plan, p.precio_mensual, 0),
  COALESCE(lr.moneda, 'COP'),
  lr.observaciones,
  jsonb_build_object('migrated_from', 'legacy', 'migration', '006_saas_core_normalization'),
  NOW(),
  NOW()
FROM legacy_ranked lr
JOIN LATERAL (
  SELECT p.*
  FROM planes p
  WHERE p.codigo = CASE
    WHEN LOWER(translate(COALESCE(lr.licencia_nombre, ''), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) LIKE '%premium%' THEN 'enterprise'
    WHEN LOWER(translate(COALESCE(lr.licencia_nombre, ''), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) LIKE '%pro%' THEN 'pro'
    ELSE 'starter'
  END
  ORDER BY p.id ASC
  LIMIT 1
) p ON TRUE
WHERE NOT EXISTS (
  SELECT 1
  FROM suscripciones s
  WHERE s.empresa_id = lr.empresa_id
    AND s.estado IN ('TRIAL', 'ACTIVA')
);

-- ------------------------------------------------------------
-- 4. Refresco de espejos legacy desde la fuente oficial
-- ------------------------------------------------------------

WITH current_saas AS (
  SELECT DISTINCT ON (s.empresa_id)
    s.id,
    s.empresa_id,
    s.plan_id,
    s.estado,
    s.fecha_inicio,
    s.fecha_fin,
    s.trial_hasta,
    s.renovacion_automatica,
    s.pasarela,
    s.referencia_externa,
    s.precio_pactado,
    s.moneda,
    s.observaciones,
    p.codigo AS plan_codigo
  FROM suscripciones s
  JOIN planes p ON p.id = s.plan_id
  ORDER BY
    s.empresa_id,
    CASE WHEN s.estado IN ('TRIAL', 'ACTIVA') THEN 0 ELSE 1 END,
    COALESCE(
      CASE WHEN s.estado = 'TRIAL' THEN s.trial_hasta ELSE NULL END,
      s.fecha_fin,
      s.actualizado_en,
      s.creado_en
    ) DESC NULLS LAST,
    s.id DESC
),
mapped_legacy AS (
  SELECT
    cs.*,
    ll.id AS licencia_id,
    ll.nombre AS licencia_nombre,
    ll.precio AS licencia_precio
  FROM current_saas cs
  JOIN LATERAL (
    SELECT l.id, l.nombre, l.precio
    FROM licencias l
    ORDER BY
      CASE
        WHEN cs.plan_codigo = 'enterprise' AND LOWER(translate(l.nombre, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) = 'premium' THEN 0
        WHEN cs.plan_codigo = 'pro' AND LOWER(translate(l.nombre, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) = 'pro' THEN 0
        WHEN cs.plan_codigo = 'starter' AND LOWER(translate(l.nombre, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) = 'basica' THEN 0
        WHEN cs.plan_codigo = 'starter' AND LOWER(translate(l.nombre, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) = 'demo' THEN 1
        ELSE 9
      END,
      l.id ASC
    LIMIT 1
  ) ll ON TRUE
)
INSERT INTO suscripciones_empresa (
  empresa_id,
  licencia_id,
  estado,
  fecha_inicio,
  fecha_fin,
  renovacion_automatica,
  pasarela,
  referencia_externa,
  observaciones,
  moneda,
  precio_plan,
  metadata,
  creado_en,
  actualizado_en
)
SELECT
  ml.empresa_id,
  ml.licencia_id,
  ml.estado,
  COALESCE(ml.fecha_inicio, NOW()),
  COALESCE(ml.fecha_fin, ml.trial_hasta),
  COALESCE(ml.renovacion_automatica, FALSE),
  COALESCE(ml.pasarela, 'MANUAL'),
  ml.referencia_externa,
  COALESCE(ml.observaciones, 'Sincronizada desde suscripciones'),
  COALESCE(ml.moneda, 'COP'),
  COALESCE(ml.precio_pactado, ml.licencia_precio, 0),
  jsonb_build_object('mirrored_from', 'suscripciones', 'migration', '006_saas_core_normalization'),
  NOW(),
  NOW()
FROM mapped_legacy ml
ON CONFLICT (empresa_id) DO UPDATE
SET licencia_id = EXCLUDED.licencia_id,
    estado = EXCLUDED.estado,
    fecha_inicio = EXCLUDED.fecha_inicio,
    fecha_fin = EXCLUDED.fecha_fin,
    renovacion_automatica = EXCLUDED.renovacion_automatica,
    pasarela = EXCLUDED.pasarela,
    referencia_externa = EXCLUDED.referencia_externa,
    observaciones = EXCLUDED.observaciones,
    moneda = EXCLUDED.moneda,
    precio_plan = EXCLUDED.precio_plan,
    metadata = EXCLUDED.metadata,
    actualizado_en = NOW();

WITH current_saas AS (
  SELECT DISTINCT ON (s.empresa_id)
    s.empresa_id,
    s.estado,
    s.fecha_inicio,
    COALESCE(s.fecha_fin, s.trial_hasta) AS fecha_fin,
    p.codigo AS plan_codigo
  FROM suscripciones s
  JOIN planes p ON p.id = s.plan_id
  ORDER BY
    s.empresa_id,
    CASE WHEN s.estado IN ('TRIAL', 'ACTIVA') THEN 0 ELSE 1 END,
    COALESCE(
      CASE WHEN s.estado = 'TRIAL' THEN s.trial_hasta ELSE NULL END,
      s.fecha_fin,
      s.actualizado_en,
      s.creado_en
    ) DESC NULLS LAST,
    s.id DESC
),
mapped_legacy AS (
  SELECT
    cs.*,
    ll.id AS licencia_id,
    ll.nombre AS licencia_nombre
  FROM current_saas cs
  JOIN LATERAL (
    SELECT l.id, l.nombre
    FROM licencias l
    ORDER BY
      CASE
        WHEN cs.plan_codigo = 'enterprise' AND LOWER(translate(l.nombre, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) = 'premium' THEN 0
        WHEN cs.plan_codigo = 'pro' AND LOWER(translate(l.nombre, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) = 'pro' THEN 0
        WHEN cs.plan_codigo = 'starter' AND LOWER(translate(l.nombre, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) = 'basica' THEN 0
        WHEN cs.plan_codigo = 'starter' AND LOWER(translate(l.nombre, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) = 'demo' THEN 1
        ELSE 9
      END,
      l.id ASC
    LIMIT 1
  ) ll ON TRUE
)
INSERT INTO empresa_licencia (
  empresa_id,
  licencia_id,
  fecha_inicio,
  fecha_fin,
  activa,
  creado_en
)
SELECT
  ml.empresa_id,
  ml.licencia_id,
  COALESCE(ml.fecha_inicio, NOW()),
  ml.fecha_fin,
  CASE WHEN ml.estado IN ('TRIAL', 'ACTIVA') THEN TRUE ELSE FALSE END,
  NOW()
FROM mapped_legacy ml
ON CONFLICT (empresa_id) DO UPDATE
SET licencia_id = EXCLUDED.licencia_id,
    fecha_inicio = EXCLUDED.fecha_inicio,
    fecha_fin = EXCLUDED.fecha_fin,
    activa = EXCLUDED.activa,
    creado_en = NOW();

WITH current_saas AS (
  SELECT DISTINCT ON (s.empresa_id)
    s.empresa_id,
    s.fecha_inicio,
    COALESCE(s.fecha_fin, s.trial_hasta) AS fecha_fin,
    p.codigo AS plan_codigo
  FROM suscripciones s
  JOIN planes p ON p.id = s.plan_id
  ORDER BY
    s.empresa_id,
    CASE WHEN s.estado IN ('TRIAL', 'ACTIVA') THEN 0 ELSE 1 END,
    COALESCE(
      CASE WHEN s.estado = 'TRIAL' THEN s.trial_hasta ELSE NULL END,
      s.fecha_fin,
      s.actualizado_en,
      s.creado_en
    ) DESC NULLS LAST,
    s.id DESC
),
mapped_legacy AS (
  SELECT
    cs.empresa_id,
    cs.fecha_inicio,
    cs.fecha_fin,
    ll.id AS licencia_id,
    ll.nombre AS licencia_nombre
  FROM current_saas cs
  JOIN LATERAL (
    SELECT l.id, l.nombre
    FROM licencias l
    ORDER BY
      CASE
        WHEN cs.plan_codigo = 'enterprise' AND LOWER(translate(l.nombre, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) = 'premium' THEN 0
        WHEN cs.plan_codigo = 'pro' AND LOWER(translate(l.nombre, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) = 'pro' THEN 0
        WHEN cs.plan_codigo = 'starter' AND LOWER(translate(l.nombre, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) = 'basica' THEN 0
        WHEN cs.plan_codigo = 'starter' AND LOWER(translate(l.nombre, 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU')) = 'demo' THEN 1
        ELSE 9
      END,
      l.id ASC
    LIMIT 1
  ) ll ON TRUE
)
UPDATE empresas e
SET licencia_id = ml.licencia_id,
    licencia_tipo = ml.licencia_nombre,
    licencia_inicio = COALESCE(ml.fecha_inicio, e.licencia_inicio, NOW()),
    licencia_fin = ml.fecha_fin
FROM mapped_legacy ml
WHERE ml.empresa_id = e.id;

COMMIT;
