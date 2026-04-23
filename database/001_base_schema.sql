-- ============================================================
-- AutoGestión360 — Schema base consolidado
-- Versión: 001
-- Generado: 2026-04-20
--
-- Consolida: estructura.sql + migrations/*.sql + database/002_saas_planes.sql
-- Incluye también las tablas creadas dinámicamente en código.
--
-- INSTRUCCIONES DE USO:
--   psql -U <usuario> -d autogestion360 -f database/001_base_schema.sql
--
-- REQUISITOS: la base de datos debe existir previamente.
-- Este script sirve como base inicial consolidada para instalaciones nuevas.
-- También es idempotente para re-ejecuciones, pero no reemplaza una estrategia
-- formal de migración incremental desde dumps legacy ya existentes.
-- ============================================================

SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;

-- ────────────────────────────────────────────
-- BLOQUE 1: TABLAS CORE
-- ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS empresas (
    id              BIGSERIAL PRIMARY KEY,
    nombre          VARCHAR(150) NOT NULL,
    nit             VARCHAR(30),
    ciudad          VARCHAR(80),
    direccion       VARCHAR(150),
    telefono        VARCHAR(30),
    email_contacto  VARCHAR(120),
    logo_url        TEXT,
    zona_horaria    VARCHAR(50) DEFAULT 'America/Bogota',
    -- Sistema legado de licencias (deprecado, mantener por compatibilidad)
    licencia_tipo   VARCHAR(30) DEFAULT 'demo',
    licencia_inicio TIMESTAMPTZ DEFAULT NOW(),
    licencia_fin    TIMESTAMPTZ,
    activa          BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS empresas_nit_uniq
    ON empresas (nit);


CREATE TABLE IF NOT EXISTS usuarios (
    id              BIGSERIAL PRIMARY KEY,
    empresa_id      BIGINT REFERENCES empresas(id) ON DELETE CASCADE,
    nombre          VARCHAR(120) NOT NULL,
    email           VARCHAR(120) NOT NULL,
    password_hash   VARCHAR(200) NOT NULL,
    rol             VARCHAR(30) NOT NULL,
    scope           VARCHAR(10) NOT NULL DEFAULT 'tenant',
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS usuarios_empresa_email_uniq
    ON usuarios (empresa_id, email);

CREATE UNIQUE INDEX IF NOT EXISTS usuarios_platform_email_uniq
    ON usuarios (LOWER(email))
    WHERE scope = 'platform';

CREATE INDEX IF NOT EXISTS usuarios_scope_idx
    ON usuarios (scope);

ALTER TABLE usuarios
    DROP CONSTRAINT IF EXISTS usuarios_scope_check,
    DROP CONSTRAINT IF EXISTS usuarios_scope_empresa_check;

ALTER TABLE usuarios
    ADD CONSTRAINT usuarios_scope_check
    CHECK (scope IN ('platform', 'tenant'));

ALTER TABLE usuarios
    ADD CONSTRAINT usuarios_scope_empresa_check
    CHECK (scope = 'platform' OR empresa_id IS NOT NULL);

CREATE TABLE IF NOT EXISTS user_sessions (
    id                          BIGSERIAL PRIMARY KEY,
    session_uid                 VARCHAR(64) NOT NULL UNIQUE,
    user_id                     BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    empresa_id                  BIGINT REFERENCES empresas(id) ON DELETE CASCADE,
    scope                       VARCHAR(10) NOT NULL DEFAULT 'tenant',
    refresh_token_hash          VARCHAR(128) NOT NULL,
    previous_refresh_token_hash VARCHAR(128),
    user_agent                  TEXT,
    ip_creacion                 VARCHAR(45),
    ip_ultimo_uso               VARCHAR(45),
    ultimo_login_en             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ultimo_refresh_en           TIMESTAMPTZ,
    ultima_actividad_en         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    refresh_expires_at          TIMESTAMPTZ NOT NULL,
    revocada_en                 TIMESTAMPTZ,
    motivo_revocacion           VARCHAR(120),
    metadata                    JSONB,
    creado_en                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_sessions_user_idx
    ON user_sessions (user_id, creado_en DESC);

CREATE INDEX IF NOT EXISTS user_sessions_empresa_idx
    ON user_sessions (empresa_id, creado_en DESC);

CREATE INDEX IF NOT EXISTS user_sessions_scope_idx
    ON user_sessions (scope);

CREATE INDEX IF NOT EXISTS user_sessions_active_idx
    ON user_sessions (user_id, revocada_en, refresh_expires_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS user_sessions_refresh_hash_uniq
    ON user_sessions (refresh_token_hash);

CREATE TABLE IF NOT EXISTS roles (
    id          SERIAL PRIMARY KEY,
    codigo      VARCHAR(50)  NOT NULL UNIQUE,
    nombre      VARCHAR(100) NOT NULL,
    descripcion TEXT,
    scope       VARCHAR(10)  NOT NULL DEFAULT 'tenant',
    es_sistema  BOOLEAN      NOT NULL DEFAULT TRUE,
    activo      BOOLEAN      NOT NULL DEFAULT TRUE,
    creado_en   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT roles_scope_check CHECK (scope IN ('platform', 'tenant', 'both'))
);

CREATE TABLE IF NOT EXISTS permisos (
    id          SERIAL PRIMARY KEY,
    codigo      VARCHAR(100) NOT NULL UNIQUE,
    nombre      VARCHAR(120) NOT NULL,
    descripcion TEXT,
    modulo      VARCHAR(50),
    accion      VARCHAR(50),
    scope       VARCHAR(10)  NOT NULL DEFAULT 'tenant',
    activo      BOOLEAN      NOT NULL DEFAULT TRUE,
    creado_en   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT permisos_scope_check CHECK (scope IN ('platform', 'tenant'))
);

CREATE INDEX IF NOT EXISTS permisos_modulo_idx
    ON permisos (modulo);

CREATE TABLE IF NOT EXISTS rol_permisos (
    id         SERIAL PRIMARY KEY,
    rol_id     INTEGER NOT NULL REFERENCES roles(id)    ON DELETE CASCADE,
    permiso_id INTEGER NOT NULL REFERENCES permisos(id) ON DELETE CASCADE,
    creado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (rol_id, permiso_id)
);

CREATE INDEX IF NOT EXISTS rol_permisos_rol_idx
    ON rol_permisos (rol_id);

CREATE TABLE IF NOT EXISTS usuario_roles (
    id           BIGSERIAL PRIMARY KEY,
    usuario_id   BIGINT  NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    rol_id       INTEGER NOT NULL REFERENCES roles(id)    ON DELETE CASCADE,
    empresa_id   BIGINT  REFERENCES empresas(id)          ON DELETE CASCADE,
    asignado_por BIGINT  REFERENCES usuarios(id)          ON DELETE SET NULL,
    creado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS usuario_roles_tenant_uniq
    ON usuario_roles (usuario_id, rol_id, empresa_id)
    WHERE empresa_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS usuario_roles_platform_uniq
    ON usuario_roles (usuario_id, rol_id)
    WHERE empresa_id IS NULL;

CREATE INDEX IF NOT EXISTS usuario_roles_usuario_empresa_idx
    ON usuario_roles (usuario_id, empresa_id);

CREATE TABLE IF NOT EXISTS sedes (
    id          BIGSERIAL PRIMARY KEY,
    empresa_id  BIGINT       NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    nombre      VARCHAR(150) NOT NULL,
    direccion   VARCHAR(200),
    ciudad      VARCHAR(80),
    telefono    VARCHAR(30),
    activa      BOOLEAN      NOT NULL DEFAULT TRUE,
    creado_en   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sedes_empresa_idx
    ON sedes (empresa_id);


CREATE TABLE IF NOT EXISTS clientes (
    id          BIGSERIAL PRIMARY KEY,
    empresa_id  BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    nombre      VARCHAR(150) NOT NULL,
    documento   VARCHAR(40),
    telefono    VARCHAR(40),
    correo      VARCHAR(120),
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS clientes_empresa_documento_uniq
    ON clientes (empresa_id, documento)
    WHERE documento IS NOT NULL;


CREATE TABLE IF NOT EXISTS vehiculos (
    id              BIGSERIAL PRIMARY KEY,
    empresa_id      BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    cliente_id      BIGINT REFERENCES clientes(id) ON DELETE SET NULL,
    placa           VARCHAR(20) NOT NULL,
    tipo_vehiculo   VARCHAR(30) NOT NULL,
    marca           VARCHAR(60),
    modelo          VARCHAR(60),
    color           VARCHAR(40),
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS vehiculos_empresa_placa_uniq
    ON vehiculos (empresa_id, placa);


CREATE TABLE IF NOT EXISTS empleados (
    id          BIGSERIAL PRIMARY KEY,
    empresa_id  BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    nombre      VARCHAR(150) NOT NULL,
    rol         VARCHAR(40) NOT NULL,
    telefono    VARCHAR(40),
    activo      BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS empleados_empresa_idx
    ON empleados (empresa_id);


-- ────────────────────────────────────────────
-- BLOQUE 2: MÓDULOS OPERATIVOS
-- ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tarifas (
    id                              BIGSERIAL PRIMARY KEY,
    empresa_id                      BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    tipo_vehiculo                   VARCHAR(30) NOT NULL,
    tarifa_por_hora                 NUMERIC(12,2) NOT NULL,
    tarifa_minima                   NUMERIC(12,2),
    descuento_prolongada_horas      INTEGER,
    descuento_prolongada_porcentaje NUMERIC(5,2),
    valor_dia                       NUMERIC(12,2),
    fraccion_dia_minutos            INTEGER,
    valor_primera_fraccion          NUMERIC(12,2),
    tiempo_primera_fraccion         INTEGER,
    valor_segunda_fraccion          NUMERIC(12,2),
    tiempo_segunda_fraccion         INTEGER,
    activo                          BOOLEAN DEFAULT TRUE,
    creado_en                       TIMESTAMPTZ DEFAULT NOW(),
    actualizado_en                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS tarifas_empresa_id_tipo_vehiculo_key
    ON tarifas (empresa_id, tipo_vehiculo);


CREATE TABLE IF NOT EXISTS parqueadero (
    id                  BIGSERIAL PRIMARY KEY,
    empresa_id          BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    vehiculo_id         BIGINT REFERENCES vehiculos(id) ON DELETE SET NULL,
    cliente_id          BIGINT REFERENCES clientes(id) ON DELETE SET NULL,
    placa               VARCHAR(20) NOT NULL,
    tipo_vehiculo       VARCHAR(30) NOT NULL,
    nombre_cliente      VARCHAR(150),
    telefono            VARCHAR(40),
    es_propietario      BOOLEAN DEFAULT TRUE,
    hora_entrada        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    hora_salida         TIMESTAMPTZ,
    minutos_total       INTEGER,
    valor_total         NUMERIC(12,2),
    metodo_pago         VARCHAR(30),
    detalle_pago        TEXT,
    observaciones       TEXT,
    conductor_nombre    VARCHAR(150),
    conductor_documento VARCHAR(40),
    conductor_telefono  VARCHAR(40),
    evidencia_url       TEXT,
    estado_pago         VARCHAR(30),
    tipo_servicio       VARCHAR(30) DEFAULT 'OCASIONAL_HORA',
    mensualidad_id      BIGINT,
    usuario_registro_id BIGINT,
    -- NOTA: cantidad_fotos existe en el dump original pero no tiene uso en código
    cantidad_fotos      INTEGER,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS parqueadero_empresa_idx
    ON parqueadero (empresa_id, hora_entrada);

CREATE INDEX IF NOT EXISTS parqueadero_abiertos_idx
    ON parqueadero (empresa_id)
    WHERE hora_salida IS NULL;


CREATE TABLE IF NOT EXISTS tipos_lavado (
    id          BIGSERIAL PRIMARY KEY,
    empresa_id  BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    nombre      VARCHAR(100) NOT NULL,
    descripcion TEXT,
    precio_base NUMERIC(12,2) DEFAULT 0,
    activo      BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS tipos_lavado_empresa_nombre_uniq
    ON tipos_lavado (empresa_id, nombre);


CREATE TABLE IF NOT EXISTS lavadero (
    id              BIGSERIAL PRIMARY KEY,
    empresa_id      BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    vehiculo_id     BIGINT REFERENCES vehiculos(id) ON DELETE SET NULL,
    cliente_id      BIGINT REFERENCES clientes(id) ON DELETE SET NULL,
    tipo_lavado_id  BIGINT REFERENCES tipos_lavado(id) ON DELETE SET NULL,
    lavador_id      BIGINT REFERENCES empleados(id) ON DELETE SET NULL,
    placa           VARCHAR(20) NOT NULL,
    precio          NUMERIC(12,2) NOT NULL,
    estado          VARCHAR(30) NOT NULL DEFAULT 'Pendiente',
    hora_inicio     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    hora_fin        TIMESTAMPTZ,
    observaciones   TEXT,
    metodo_pago     VARCHAR(30),
    detalle_pago    JSONB,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lavadero_empresa_estado_idx
    ON lavadero (empresa_id, estado);


CREATE TABLE IF NOT EXISTS taller_ordenes (
    id                  BIGSERIAL PRIMARY KEY,
    empresa_id          BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    vehiculo_id         BIGINT REFERENCES vehiculos(id),
    cliente_id          BIGINT REFERENCES clientes(id),
    mecanico_id         BIGINT REFERENCES empleados(id),
    numero_orden        VARCHAR(40) NOT NULL,
    placa               VARCHAR(20) NOT NULL,
    descripcion_falla   TEXT,
    estado              VARCHAR(30) NOT NULL DEFAULT 'Diagnóstico',
    fecha_creacion      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fecha_entrega       TIMESTAMPTZ,
    total_orden         NUMERIC(14,2) DEFAULT 0,
    metodo_pago         VARCHAR(30),
    detalle_pago        JSONB
);

CREATE UNIQUE INDEX IF NOT EXISTS taller_ordenes_empresa_orden_uniq
    ON taller_ordenes (empresa_id, numero_orden);


CREATE TABLE IF NOT EXISTS taller_items (
    id              BIGSERIAL PRIMARY KEY,
    orden_id        BIGINT NOT NULL REFERENCES taller_ordenes(id) ON DELETE CASCADE,
    tipo_item       VARCHAR(20) NOT NULL,
    descripcion     TEXT NOT NULL,
    cantidad        NUMERIC(12,2) NOT NULL DEFAULT 1,
    precio_unitario NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_linea     NUMERIC(14,2) NOT NULL DEFAULT 0
);


-- ────────────────────────────────────────────
-- BLOQUE 3: LICENCIAMIENTO
-- (consolidado de migrations/licencias_migration.sql)
-- ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS licencias (
    id          SERIAL PRIMARY KEY,
    nombre      VARCHAR(100) NOT NULL UNIQUE,
    descripcion TEXT,
    precio      NUMERIC(10,2),
    creado_en   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS modulos (
    id          SERIAL PRIMARY KEY,
    nombre      VARCHAR(100) NOT NULL UNIQUE,
    descripcion TEXT,
    activo      BOOLEAN NOT NULL DEFAULT TRUE,
    orden       SMALLINT DEFAULT 0,
    icono_clave VARCHAR(50),
    creado_en   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE modulos
    ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS orden SMALLINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS icono_clave VARCHAR(50);

CREATE TABLE IF NOT EXISTS licencia_modulo (
    id          SERIAL PRIMARY KEY,
    licencia_id INTEGER NOT NULL REFERENCES licencias(id) ON DELETE CASCADE,
    modulo_id   INTEGER NOT NULL REFERENCES modulos(id) ON DELETE CASCADE,
    UNIQUE (licencia_id, modulo_id)
);

CREATE TABLE IF NOT EXISTS empresa_licencia (
    id          SERIAL PRIMARY KEY,
    empresa_id  BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    licencia_id INTEGER NOT NULL REFERENCES licencias(id) ON DELETE CASCADE,
    fecha_inicio TIMESTAMPTZ DEFAULT NOW(),
    fecha_fin   TIMESTAMPTZ,
    activa      BOOLEAN DEFAULT TRUE,
    creado_en   TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS empresa_licencia_empresa_id_key
    ON empresa_licencia (empresa_id);

-- Columnas agregadas a empresas por el nuevo sistema de licencias
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS
    licencia_id INTEGER REFERENCES licencias(id);

-- NOTA: licencia_inicio y licencia_fin ya existen en empresas desde estructura.sql
-- Se mantienen para el sistema legado. No se duplican.

ALTER TABLE parqueadero
    ADD COLUMN IF NOT EXISTS tipo_servicio VARCHAR(30) DEFAULT 'OCASIONAL_HORA',
    ADD COLUMN IF NOT EXISTS mensualidad_id BIGINT;

ALTER TABLE tarifas
    ADD COLUMN IF NOT EXISTS valor_dia NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS fraccion_dia_minutos INTEGER,
    ADD COLUMN IF NOT EXISTS valor_primera_fraccion NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS tiempo_primera_fraccion INTEGER,
    ADD COLUMN IF NOT EXISTS valor_segunda_fraccion NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS tiempo_segunda_fraccion INTEGER;


-- ────────────────────────────────────────────
-- BLOQUE 4: PAGOS Y ARQUEOS
-- ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pagos_servicios (
    id                      BIGSERIAL PRIMARY KEY,
    empresa_id              BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    modulo                  VARCHAR(30) NOT NULL,
    referencia_id           BIGINT NOT NULL,
    monto                   NUMERIC(14,2) NOT NULL DEFAULT 0,
    metodo_pago             VARCHAR(30) NOT NULL,
    referencia_transaccion  VARCHAR(120),
    detalle_pago            JSONB,
    estado                  VARCHAR(30) NOT NULL DEFAULT 'APLICADO',
    usuario_registro_id     BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
    fecha_pago              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS pagos_servicios_lookup_idx
    ON pagos_servicios (empresa_id, modulo, referencia_id, fecha_pago DESC);

CREATE INDEX IF NOT EXISTS pagos_servicios_fecha_idx
    ON pagos_servicios (empresa_id, fecha_pago DESC);


CREATE TABLE IF NOT EXISTS arqueos_caja (
    id                  BIGSERIAL PRIMARY KEY,
    empresa_id          BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    usuario_id          BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
    fecha_caja          DATE NOT NULL,
    desde               TIMESTAMPTZ NOT NULL,
    hasta               TIMESTAMPTZ NOT NULL,
    total_facturado     NUMERIC(14,2) DEFAULT 0,
    total_recaudado     NUMERIC(14,2) DEFAULT 0,
    total_pendiente     NUMERIC(14,2) DEFAULT 0,
    efectivo_sistema    NUMERIC(14,2) DEFAULT 0,
    efectivo_contado    NUMERIC(14,2) DEFAULT 0,
    diferencia          NUMERIC(14,2) DEFAULT 0,
    servicios_total     INTEGER DEFAULT 0,
    servicios_pagados   INTEGER DEFAULT 0,
    servicios_pendientes INTEGER DEFAULT 0,
    metodos_pago        JSONB DEFAULT '[]'::jsonb,
    modulos             JSONB DEFAULT '[]'::jsonb,
    responsables        JSONB DEFAULT '[]'::jsonb,
    observaciones       TEXT,
    estado              VARCHAR(30) DEFAULT 'CERRADO',
    creado_en           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS arqueos_caja_empresa_fecha_idx
    ON arqueos_caja (empresa_id, fecha_caja DESC, creado_en DESC);


-- ────────────────────────────────────────────
-- BLOQUE 5: SUSCRIPCIONES Y FACTURACIÓN SAAS
-- ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS suscripciones_empresa (
    id                  BIGSERIAL PRIMARY KEY,
    empresa_id          BIGINT NOT NULL UNIQUE REFERENCES empresas(id) ON DELETE CASCADE,
    licencia_id         INTEGER REFERENCES licencias(id) ON DELETE SET NULL,
    estado              VARCHAR(20) NOT NULL DEFAULT 'TRIAL',
    fecha_inicio        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fecha_fin           TIMESTAMPTZ,
    renovacion_automatica BOOLEAN NOT NULL DEFAULT FALSE,
    pasarela            VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
    referencia_externa  VARCHAR(150),
    observaciones       TEXT,
    moneda              VARCHAR(10) NOT NULL DEFAULT 'COP',
    precio_plan         NUMERIC(12,2) NOT NULL DEFAULT 0,
    metadata            JSONB,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS suscripciones_empresa_estado_idx
    ON suscripciones_empresa (estado, fecha_fin);

CREATE INDEX IF NOT EXISTS suscripciones_empresa_licencia_idx
    ON suscripciones_empresa (licencia_id);


CREATE TABLE IF NOT EXISTS facturas_saas (
    id                  BIGSERIAL PRIMARY KEY,
    suscripcion_id      BIGINT REFERENCES suscripciones_empresa(id) ON DELETE SET NULL,
    empresa_id          BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    licencia_id         INTEGER REFERENCES licencias(id) ON DELETE SET NULL,
    numero_factura      VARCHAR(60) NOT NULL UNIQUE,
    concepto            VARCHAR(160) NOT NULL,
    periodo_inicio      DATE,
    periodo_fin         DATE,
    subtotal            NUMERIC(12,2) NOT NULL DEFAULT 0,
    impuestos           NUMERIC(12,2) NOT NULL DEFAULT 0,
    total               NUMERIC(12,2) NOT NULL DEFAULT 0,
    moneda              VARCHAR(10) NOT NULL DEFAULT 'COP',
    estado              VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    fecha_emision       DATE NOT NULL DEFAULT CURRENT_DATE,
    fecha_vencimiento   DATE,
    fecha_pago          TIMESTAMPTZ,
    metodo_pago         VARCHAR(40),
    referencia_pago     VARCHAR(150),
    pasarela            VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
    metadata            JSONB,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS facturas_saas_empresa_idx
    ON facturas_saas (empresa_id, fecha_emision DESC);

CREATE INDEX IF NOT EXISTS facturas_saas_estado_idx
    ON facturas_saas (estado, fecha_vencimiento);


-- ────────────────────────────────────────────
-- BLOQUE 5B: NÚCLEO SAAS NUEVO
-- (antes en database/002_saas_planes.sql)
-- ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS planes (
    id              SERIAL PRIMARY KEY,
    codigo          VARCHAR(30)   NOT NULL UNIQUE,
    nombre          VARCHAR(100)  NOT NULL,
    descripcion     TEXT,
    precio_mensual  NUMERIC(12,2) NOT NULL DEFAULT 0,
    precio_anual    NUMERIC(12,2),
    moneda          VARCHAR(10)   NOT NULL DEFAULT 'COP',
    trial_dias      INTEGER       NOT NULL DEFAULT 14,
    max_usuarios    INTEGER,
    max_vehiculos   INTEGER,
    max_empleados   INTEGER,
    max_sedes       INTEGER,
    es_publico      BOOLEAN NOT NULL DEFAULT TRUE,
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    orden           SMALLINT      NOT NULL DEFAULT 0,
    metadata        JSONB,
    creado_en       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    actualizado_en  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plan_modulos (
    id                  SERIAL PRIMARY KEY,
    plan_id             INTEGER NOT NULL REFERENCES planes(id) ON DELETE CASCADE,
    modulo_id           INTEGER NOT NULL REFERENCES modulos(id) ON DELETE CASCADE,
    limite_registros    INTEGER,
    activo              BOOLEAN NOT NULL DEFAULT TRUE,
    metadata            JSONB,
    UNIQUE (plan_id, modulo_id)
);

CREATE INDEX IF NOT EXISTS plan_modulos_plan_idx
    ON plan_modulos (plan_id)
    WHERE activo = TRUE;

CREATE TABLE IF NOT EXISTS suscripciones (
    id                      BIGSERIAL PRIMARY KEY,
    empresa_id              BIGINT      NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    plan_id                 INTEGER     NOT NULL REFERENCES planes(id)   ON DELETE RESTRICT,
    estado                  VARCHAR(20) NOT NULL DEFAULT 'TRIAL',
    fecha_inicio            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fecha_fin               TIMESTAMPTZ,
    trial_hasta             TIMESTAMPTZ,
    ciclo                   VARCHAR(10) NOT NULL DEFAULT 'MENSUAL',
    renovacion_automatica   BOOLEAN     NOT NULL DEFAULT FALSE,
    pasarela                VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
    referencia_externa      VARCHAR(150),
    precio_pactado          NUMERIC(12,2) NOT NULL DEFAULT 0,
    moneda                  VARCHAR(10) NOT NULL DEFAULT 'COP',
    observaciones           TEXT,
    metadata                JSONB,
    creado_en               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS suscripciones_activa_uniq
    ON suscripciones (empresa_id)
    WHERE estado IN ('TRIAL', 'ACTIVA');

CREATE INDEX IF NOT EXISTS suscripciones_estado_fin_idx
    ON suscripciones (estado, fecha_fin);

CREATE INDEX IF NOT EXISTS suscripciones_empresa_hist_idx
    ON suscripciones (empresa_id, creado_en DESC);

CREATE TABLE IF NOT EXISTS billing_invoices (
    id                      BIGSERIAL PRIMARY KEY,
    empresa_id              BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    suscripcion_id          BIGINT REFERENCES suscripciones(id) ON DELETE SET NULL,
    plan_id                 INTEGER REFERENCES planes(id) ON DELETE SET NULL,
    legacy_factura_id       BIGINT UNIQUE REFERENCES facturas_saas(id) ON DELETE SET NULL,
    numero_factura          VARCHAR(80) NOT NULL UNIQUE,
    tipo_documento          VARCHAR(20) NOT NULL DEFAULT 'INVOICE',
    motivo                  VARCHAR(40) NOT NULL DEFAULT 'SUBSCRIPTION_RENEWAL',
    estado                  VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    collection_method       VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    moneda                  VARCHAR(10) NOT NULL DEFAULT 'COP',
    subtotal                NUMERIC(14,2) NOT NULL DEFAULT 0,
    monto_impuestos         NUMERIC(14,2) NOT NULL DEFAULT 0,
    monto_descuento         NUMERIC(14,2) NOT NULL DEFAULT 0,
    total                   NUMERIC(14,2) NOT NULL DEFAULT 0,
    saldo_pendiente         NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_pagado            NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_acreditado        NUMERIC(14,2) NOT NULL DEFAULT 0,
    periodo_inicio          DATE,
    periodo_fin             DATE,
    emitida_en              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    vencimiento_en          TIMESTAMPTZ,
    pagada_en               TIMESTAMPTZ,
    cerrada_en              TIMESTAMPTZ,
    pasarela                VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
    external_customer_id    VARCHAR(150),
    external_invoice_id     VARCHAR(150),
    idempotency_key         VARCHAR(120),
    metadata                JSONB,
    created_by              BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
    updated_by              BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT billing_invoices_tipo_check CHECK (tipo_documento IN ('INVOICE', 'DEBIT_NOTE')),
    CONSTRAINT billing_invoices_motivo_check CHECK (motivo IN ('SUBSCRIPTION_RENEWAL', 'SUBSCRIPTION_REACTIVATION', 'PLAN_CHANGE', 'MANUAL_ADJUSTMENT', 'ADDON', 'LEGACY_IMPORT')),
    CONSTRAINT billing_invoices_estado_check CHECK (estado IN ('DRAFT', 'OPEN', 'OVERDUE', 'PARTIALLY_PAID', 'PAID', 'VOID', 'UNCOLLECTIBLE', 'CREDITED', 'REFUNDED')),
    CONSTRAINT billing_invoices_collection_check CHECK (collection_method IN ('MANUAL', 'AUTOMATIC'))
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_invoices_idempotency_uniq
    ON billing_invoices (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS billing_invoices_empresa_idx
    ON billing_invoices (empresa_id, emitida_en DESC);

CREATE INDEX IF NOT EXISTS billing_invoices_subscription_idx
    ON billing_invoices (suscripcion_id, emitida_en DESC);

CREATE INDEX IF NOT EXISTS billing_invoices_status_due_idx
    ON billing_invoices (estado, vencimiento_en);

CREATE TABLE IF NOT EXISTS billing_payment_attempts (
    id                      BIGSERIAL PRIMARY KEY,
    invoice_id              BIGINT NOT NULL REFERENCES billing_invoices(id) ON DELETE CASCADE,
    empresa_id              BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    suscripcion_id          BIGINT REFERENCES suscripciones(id) ON DELETE SET NULL,
    provider                VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
    mode                    VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    estado                  VARCHAR(30) NOT NULL DEFAULT 'CREATED',
    amount                  NUMERIC(14,2) NOT NULL DEFAULT 0,
    currency                VARCHAR(10) NOT NULL DEFAULT 'COP',
    attempt_number          INTEGER NOT NULL DEFAULT 1,
    idempotency_key         VARCHAR(120),
    external_attempt_id     VARCHAR(150),
    external_payment_id     VARCHAR(150),
    provider_event_id       VARCHAR(150),
    failure_code            VARCHAR(80),
    failure_message         TEXT,
    next_retry_at           TIMESTAMPTZ,
    requested_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at            TIMESTAMPTZ,
    request_payload         JSONB,
    response_payload        JSONB,
    metadata                JSONB,
    created_by              BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT billing_attempts_mode_check CHECK (mode IN ('MANUAL', 'AUTOMATIC', 'WEBHOOK')),
    CONSTRAINT billing_attempts_estado_check CHECK (estado IN ('CREATED', 'PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED', 'IGNORED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_attempts_idempotency_uniq
    ON billing_payment_attempts (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS billing_attempts_invoice_idx
    ON billing_payment_attempts (invoice_id, created_at DESC);

CREATE INDEX IF NOT EXISTS billing_attempts_status_retry_idx
    ON billing_payment_attempts (estado, next_retry_at);

CREATE TABLE IF NOT EXISTS billing_payments (
    id                      BIGSERIAL PRIMARY KEY,
    invoice_id              BIGINT NOT NULL REFERENCES billing_invoices(id) ON DELETE CASCADE,
    payment_attempt_id      BIGINT REFERENCES billing_payment_attempts(id) ON DELETE SET NULL,
    empresa_id              BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    suscripcion_id          BIGINT REFERENCES suscripciones(id) ON DELETE SET NULL,
    provider                VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
    payment_method          VARCHAR(40) NOT NULL DEFAULT 'OTRO',
    estado                  VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED',
    amount                  NUMERIC(14,2) NOT NULL DEFAULT 0,
    currency                VARCHAR(10) NOT NULL DEFAULT 'COP',
    idempotency_key         VARCHAR(120),
    external_payment_id     VARCHAR(150),
    referencia_externa      VARCHAR(150),
    paid_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata                JSONB,
    created_by              BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT billing_payments_estado_check CHECK (estado IN ('CONFIRMED', 'REFUNDED', 'VOIDED', 'CHARGEBACK'))
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_payments_idempotency_uniq
    ON billing_payments (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS billing_payments_external_uniq
    ON billing_payments (invoice_id, external_payment_id)
    WHERE external_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS billing_payments_invoice_idx
    ON billing_payments (invoice_id, paid_at DESC);

CREATE TABLE IF NOT EXISTS billing_credit_notes (
    id                      BIGSERIAL PRIMARY KEY,
    credit_note_number      VARCHAR(80) NOT NULL UNIQUE,
    invoice_id              BIGINT NOT NULL REFERENCES billing_invoices(id) ON DELETE CASCADE,
    empresa_id              BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    suscripcion_id          BIGINT REFERENCES suscripciones(id) ON DELETE SET NULL,
    estado                  VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    reason_code             VARCHAR(40) NOT NULL DEFAULT 'ADJUSTMENT',
    reason_text             TEXT,
    currency                VARCHAR(10) NOT NULL DEFAULT 'COP',
    subtotal                NUMERIC(14,2) NOT NULL DEFAULT 0,
    tax_amount              NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_amount            NUMERIC(14,2) NOT NULL DEFAULT 0,
    remaining_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
    issued_at               TIMESTAMPTZ,
    applied_at              TIMESTAMPTZ,
    voided_at               TIMESTAMPTZ,
    external_credit_note_id VARCHAR(150),
    idempotency_key         VARCHAR(120),
    metadata                JSONB,
    created_by              BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
    updated_by              BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT billing_credit_notes_estado_check CHECK (estado IN ('DRAFT', 'ISSUED', 'APPLIED', 'VOID'))
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_credit_notes_idempotency_uniq
    ON billing_credit_notes (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS billing_credit_notes_invoice_idx
    ON billing_credit_notes (invoice_id, created_at DESC);

CREATE TABLE IF NOT EXISTS billing_webhook_events (
    id                      BIGSERIAL PRIMARY KEY,
    provider                VARCHAR(30) NOT NULL,
    external_event_id       VARCHAR(150) NOT NULL,
    event_type              VARCHAR(120),
    signature_header        TEXT,
    signature_valid         BOOLEAN,
    estado                  VARCHAR(20) NOT NULL DEFAULT 'RECEIVED',
    related_invoice_id      BIGINT REFERENCES billing_invoices(id) ON DELETE SET NULL,
    related_attempt_id      BIGINT REFERENCES billing_payment_attempts(id) ON DELETE SET NULL,
    process_attempts        INTEGER NOT NULL DEFAULT 0,
    error_message           TEXT,
    headers                 JSONB,
    payload                 JSONB NOT NULL,
    received_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    first_processed_at      TIMESTAMPTZ,
    last_processed_at       TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT billing_webhook_estado_check CHECK (estado IN ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_webhook_events_provider_event_uniq
    ON billing_webhook_events (provider, external_event_id);

CREATE INDEX IF NOT EXISTS billing_webhook_events_estado_idx
    ON billing_webhook_events (estado, received_at DESC);

CREATE TABLE IF NOT EXISTS billing_customer_payment_sources (
    id                           BIGSERIAL PRIMARY KEY,
    empresa_id                   BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    suscripcion_id               BIGINT REFERENCES suscripciones(id) ON DELETE SET NULL,
    provider                     VARCHAR(30) NOT NULL DEFAULT 'WOMPI',
    provider_payment_source_id   BIGINT NOT NULL,
    customer_email               VARCHAR(255) NOT NULL,
    type                         VARCHAR(30) NOT NULL,
    status                       VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
    is_default                   BOOLEAN NOT NULL DEFAULT FALSE,
    public_data                  JSONB,
    metadata                     JSONB,
    created_by                   BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
    updated_by                   BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT billing_customer_payment_sources_provider_check CHECK (provider IN ('WOMPI')),
    CONSTRAINT billing_customer_payment_sources_status_check CHECK (status IN ('ACTIVE', 'INACTIVE', 'REVOKED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_customer_payment_sources_provider_uniq
    ON billing_customer_payment_sources (provider, provider_payment_source_id);

CREATE INDEX IF NOT EXISTS billing_customer_payment_sources_empresa_idx
    ON billing_customer_payment_sources (empresa_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS billing_customer_payment_sources_default_uniq
    ON billing_customer_payment_sources (empresa_id, provider)
    WHERE is_default = TRUE AND status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS empresa_modulos (
    id              BIGSERIAL PRIMARY KEY,
    empresa_id      BIGINT  NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    modulo_id       INTEGER NOT NULL REFERENCES modulos(id)  ON DELETE CASCADE,
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    limite_override INTEGER,
    notas           TEXT,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (empresa_id, modulo_id)
);

CREATE INDEX IF NOT EXISTS empresa_modulos_empresa_idx
    ON empresa_modulos (empresa_id);


-- ────────────────────────────────────────────
-- BLOQUE 6: TABLAS DINÁMICAS (extraídas del código JS)
-- Antes creadas en runtime; ahora versionadas aquí.
-- ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mensualidades_parqueadero (
    id              BIGSERIAL PRIMARY KEY,
    empresa_id      BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    cliente_id      BIGINT REFERENCES clientes(id) ON DELETE SET NULL,
    vehiculo_id     BIGINT REFERENCES vehiculos(id) ON DELETE SET NULL,
    placa           VARCHAR(20) NOT NULL,
    tipo_vehiculo   VARCHAR(30),
    nombre_cliente  VARCHAR(150),
    documento       VARCHAR(40),
    telefono        VARCHAR(40),
    correo          VARCHAR(120),
    direccion       VARCHAR(200),
    fecha_inicio    DATE NOT NULL,
    fecha_fin       DATE NOT NULL,
    valor_mensual   NUMERIC(12,2) NOT NULL DEFAULT 0,
    estado          VARCHAR(30) NOT NULL DEFAULT 'ACTIVA',
    observaciones   TEXT,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mensualidades_parqueadero_empresa_placa_idx
    ON mensualidades_parqueadero (empresa_id, placa);


CREATE TABLE IF NOT EXISTS configuracion_parqueadero (
    id                          BIGSERIAL PRIMARY KEY,
    empresa_id                  BIGINT NOT NULL UNIQUE REFERENCES empresas(id) ON DELETE CASCADE,
    capacidad_total             INTEGER DEFAULT 40,
    capacidad_carros            INTEGER DEFAULT 30,
    capacidad_motos             INTEGER DEFAULT 10,
    tiempo_maximo_horas         INTEGER DEFAULT 24,
    alertar_en_horas            INTEGER DEFAULT 8,
    descuento_cliente_frecuente BOOLEAN DEFAULT FALSE,
    modulo_activo               BOOLEAN DEFAULT TRUE,
    solo_facturacion            BOOLEAN DEFAULT FALSE,
    valor_valet_parking         NUMERIC(12,2) DEFAULT 0,
    creado_en                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE TABLE IF NOT EXISTS reglas_parqueadero (
    id                  BIGSERIAL PRIMARY KEY,
    empresa_id          BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    dia_codigo          VARCHAR(2) NOT NULL,
    dia_nombre          VARCHAR(20) NOT NULL,
    aplica              BOOLEAN DEFAULT FALSE,
    hora_inicio_gratis  INTEGER DEFAULT 7,
    hora_fin_gratis     INTEGER DEFAULT 11,
    minutos_gracia      INTEGER DEFAULT 15,
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS reglas_parqueadero_empresa_dia_key
    ON reglas_parqueadero (empresa_id, dia_codigo);


CREATE TABLE IF NOT EXISTS alertas (
    id              BIGSERIAL PRIMARY KEY,
    empresa_id      BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    tipo            VARCHAR(60),
    titulo          VARCHAR(200),
    descripcion     TEXT,
    severidad       VARCHAR(20) DEFAULT 'info',
    leida           BOOLEAN DEFAULT FALSE,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS alertas_empresa_leida_idx
    ON alertas (empresa_id, leida);


CREATE TABLE IF NOT EXISTS auditoria (
    id              BIGSERIAL PRIMARY KEY,
    empresa_id      BIGINT REFERENCES empresas(id) ON DELETE CASCADE,
    usuario_id      BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
    accion          VARCHAR(100),
    entidad         VARCHAR(60),
    entidad_id      BIGINT,
    detalle         JSONB,
    ip              VARCHAR(45),
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auditoria_empresa_idx
    ON auditoria (empresa_id, creado_en DESC);


-- ────────────────────────────────────────────
-- BLOQUE 7: VISTAS DE COMPATIBILIDAD
-- (definidas en estructura.sql, sin uso activo en código)
-- ────────────────────────────────────────────

CREATE OR REPLACE VIEW parqueadero_historial AS
    SELECT * FROM parqueadero WHERE hora_salida IS NOT NULL;

CREATE OR REPLACE VIEW lavados AS
    SELECT * FROM lavadero;

CREATE OR REPLACE VIEW ordenes_taller AS
    SELECT * FROM taller_ordenes;


-- ────────────────────────────────────────────
-- BLOQUE 8: DATOS SEMILLA — LICENCIAS, MÓDULOS Y PLANES
-- ────────────────────────────────────────────

INSERT INTO licencias (nombre, descripcion, precio) VALUES
    ('Demo',    'Acceso de prueba — solo parqueadero', 0),
    ('Básica',  'Parqueadero + clientes + reportes básicos',  50),
    ('Pro',     'Operación completa sin multi-empresa', 75),
    ('Premium', 'Acceso completo a todos los módulos', 100)
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO modulos (nombre, descripcion, activo, orden, icono_clave) VALUES
    ('dashboard',    'Panel general de operación', TRUE, 0, 'layout-dashboard'),
    ('parqueadero',  'Gestión de parqueadero', TRUE, 1, 'car'),
    ('lavadero',     'Gestión de lavadero', TRUE, 2, 'droplets'),
    ('taller',       'Gestión de taller mecánico', TRUE, 3, 'wrench'),
    ('clientes',     'Gestión de clientes y vehículos', TRUE, 4, 'users'),
    ('empleados',    'Gestión de empleados y equipo', TRUE, 5, 'user-check'),
    ('reportes',     'Reportes e indicadores de gestión', TRUE, 6, 'bar-chart-2'),
    ('configuracion','Configuración de empresa y tarifas', TRUE, 7, 'settings'),
    ('usuarios',     'Usuarios y roles de acceso', TRUE, 8, 'shield'),
    ('empresas',     'Administración multiempresa SaaS', TRUE, 9, 'building-2'),
    ('matricula',    'Módulo legacy de matrículas', FALSE, 10, 'id-card'),
    ('evaluacion',   'Módulo legacy de evaluación', FALSE, 11, 'clipboard-list')
ON CONFLICT (nombre) DO UPDATE
    SET descripcion = EXCLUDED.descripcion,
        activo = EXCLUDED.activo,
        orden = EXCLUDED.orden,
        icono_clave = EXCLUDED.icono_clave;

-- Módulos por licencia
INSERT INTO licencia_modulo (licencia_id, modulo_id)
SELECT l.id, m.id FROM licencias l, modulos m
WHERE l.nombre = 'Demo' AND m.nombre IN ('dashboard', 'parqueadero', 'clientes')
ON CONFLICT DO NOTHING;

INSERT INTO licencia_modulo (licencia_id, modulo_id)
SELECT l.id, m.id FROM licencias l, modulos m
WHERE l.nombre = 'Básica' AND m.nombre IN ('dashboard', 'parqueadero', 'clientes', 'reportes', 'configuracion')
ON CONFLICT DO NOTHING;

INSERT INTO licencia_modulo (licencia_id, modulo_id)
SELECT l.id, m.id FROM licencias l, modulos m
WHERE l.nombre = 'Pro'
  AND m.nombre IN (
      'dashboard', 'parqueadero', 'lavadero', 'taller',
      'clientes', 'empleados', 'reportes', 'configuracion', 'usuarios'
  )
ON CONFLICT DO NOTHING;

INSERT INTO licencia_modulo (licencia_id, modulo_id)
SELECT l.id, m.id FROM licencias l, modulos m
WHERE l.nombre = 'Premium'
  AND m.nombre IN (
      'dashboard', 'parqueadero', 'lavadero', 'taller',
      'clientes', 'empleados', 'reportes', 'configuracion',
      'usuarios', 'empresas'
  )
ON CONFLICT DO NOTHING;

INSERT INTO planes (codigo, nombre, descripcion, precio_mensual, precio_anual, moneda, trial_dias,
                    max_usuarios, max_vehiculos, max_empleados, max_sedes, es_publico, activo, orden)
VALUES
    ('starter',
     'Starter',
     'Ideal para parqueaderos pequeños. Incluye parqueadero, clientes y reportes básicos.',
     49900, 479000, 'COP', 14,
     3, 500, 5, 1,
     TRUE, TRUE, 1),
    ('pro',
     'Pro',
     'Para negocios en crecimiento. Parqueadero, lavadero, taller y equipo completo.',
     99900, 959000, 'COP', 14,
     10, NULL, NULL, 3,
     TRUE, TRUE, 2),
    ('enterprise',
     'Enterprise',
     'Plataforma completa con administración multiempresa y módulos ilimitados.',
     199900, 1919000, 'COP', 30,
     NULL, NULL, NULL, NULL,
     TRUE, TRUE, 3)
ON CONFLICT (codigo) DO UPDATE
    SET nombre = EXCLUDED.nombre,
        descripcion = EXCLUDED.descripcion,
        precio_mensual = EXCLUDED.precio_mensual,
        precio_anual = EXCLUDED.precio_anual,
        trial_dias = EXCLUDED.trial_dias,
        max_usuarios = EXCLUDED.max_usuarios,
        max_vehiculos = EXCLUDED.max_vehiculos,
        max_empleados = EXCLUDED.max_empleados,
        max_sedes = EXCLUDED.max_sedes,
        activo = EXCLUDED.activo,
        actualizado_en = NOW();

INSERT INTO plan_modulos (plan_id, modulo_id, limite_registros, activo)
SELECT p.id, m.id,
    CASE m.nombre
        WHEN 'reportes' THEN 90
        ELSE NULL
    END,
    TRUE
FROM planes p, modulos m
WHERE p.codigo = 'starter'
  AND m.nombre IN ('dashboard', 'parqueadero', 'clientes', 'configuracion', 'reportes')
ON CONFLICT (plan_id, modulo_id) DO UPDATE
    SET limite_registros = EXCLUDED.limite_registros,
        activo = EXCLUDED.activo;

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
        activo = EXCLUDED.activo;

INSERT INTO plan_modulos (plan_id, modulo_id, limite_registros, activo)
SELECT p.id, m.id, NULL, TRUE
FROM planes p, modulos m
WHERE p.codigo = 'enterprise'
  AND m.nombre IN (
      'dashboard', 'parqueadero', 'lavadero', 'taller',
      'clientes', 'empleados', 'reportes', 'configuracion',
      'usuarios', 'empresas'
  )
ON CONFLICT (plan_id, modulo_id) DO UPDATE
    SET limite_registros = EXCLUDED.limite_registros,
        activo = EXCLUDED.activo;

INSERT INTO roles (codigo, nombre, descripcion, scope, es_sistema, activo) VALUES
    ('superadmin', 'Super Administrador', 'Acceso total a plataforma y tenants.', 'both', TRUE, TRUE),
    ('admin',      'Administrador',       'Gestión completa de operaciones dentro del tenant.', 'tenant', TRUE, TRUE),
    ('operador',   'Operador',            'Operaciones de entrada, salida y atención.', 'tenant', TRUE, TRUE),
    ('empleado',   'Empleado',            'Acceso básico a servicios operativos.', 'tenant', TRUE, TRUE)
ON CONFLICT (codigo) DO UPDATE
    SET nombre = EXCLUDED.nombre,
        descripcion = EXCLUDED.descripcion,
        scope = EXCLUDED.scope,
        activo = EXCLUDED.activo;

INSERT INTO permisos (codigo, nombre, modulo, accion, scope) VALUES
    ('clientes:ver',       'Ver clientes',       'clientes',       'ver',      'tenant'),
    ('clientes:crear',     'Crear clientes',     'clientes',       'crear',    'tenant'),
    ('clientes:editar',    'Editar clientes',    'clientes',       'editar',   'tenant'),
    ('clientes:eliminar',  'Eliminar clientes',  'clientes',       'eliminar', 'tenant'),
    ('vehiculos:ver',      'Ver vehículos',      'vehiculos',      'ver',      'tenant'),
    ('vehiculos:crear',    'Crear vehículos',    'vehiculos',      'crear',    'tenant'),
    ('vehiculos:editar',   'Editar vehículos',   'vehiculos',      'editar',   'tenant'),
    ('empleados:ver',      'Ver empleados',      'empleados',      'ver',      'tenant'),
    ('empleados:crear',    'Crear empleados',    'empleados',      'crear',    'tenant'),
    ('empleados:editar',   'Editar empleados',   'empleados',      'editar',   'tenant'),
    ('empleados:eliminar', 'Eliminar empleados', 'empleados',      'eliminar', 'tenant'),
    ('parqueadero:ver',    'Ver parqueadero',    'parqueadero',    'ver',      'tenant'),
    ('parqueadero:crear',  'Registrar entrada',  'parqueadero',    'crear',    'tenant'),
    ('parqueadero:editar', 'Editar registro',    'parqueadero',    'editar',   'tenant'),
    ('lavadero:ver',       'Ver lavadero',       'lavadero',       'ver',      'tenant'),
    ('lavadero:crear',     'Crear servicio',     'lavadero',       'crear',    'tenant'),
    ('lavadero:editar',    'Editar servicio',    'lavadero',       'editar',   'tenant'),
    ('taller:ver',         'Ver taller',         'taller',         'ver',      'tenant'),
    ('taller:crear',       'Crear orden',        'taller',         'crear',    'tenant'),
    ('taller:editar',      'Editar orden',       'taller',         'editar',   'tenant'),
    ('ordenes:ver',        'Ver órdenes',        'ordenes',        'ver',      'tenant'),
    ('ordenes:crear',      'Crear órdenes',      'ordenes',        'crear',    'tenant'),
    ('ordenes:editar',     'Editar órdenes',     'ordenes',        'editar',   'tenant'),
    ('ordenes:cancelar',   'Cancelar órdenes',   'ordenes',        'cancelar', 'tenant'),
    ('reportes:ver',       'Ver reportes',       'reportes',       'ver',      'tenant'),
    ('reportes:exportar',  'Exportar reportes',  'reportes',       'exportar', 'tenant'),
    ('usuarios:ver',       'Ver usuarios',       'usuarios',       'ver',      'tenant'),
    ('usuarios:crear',     'Crear usuarios',     'usuarios',       'crear',    'tenant'),
    ('usuarios:editar',    'Editar usuarios',    'usuarios',       'editar',   'tenant'),
    ('usuarios:eliminar',  'Eliminar usuarios',  'usuarios',       'eliminar', 'tenant'),
    ('configuracion:ver',    'Ver configuración',    'configuracion', 'ver',    'tenant'),
    ('configuracion:editar', 'Editar configuración', 'configuracion', 'editar', 'tenant'),
    ('sedes:ver',      'Ver sedes',      'sedes', 'ver',      'tenant'),
    ('sedes:crear',    'Crear sedes',    'sedes', 'crear',    'tenant'),
    ('sedes:editar',   'Editar sedes',   'sedes', 'editar',   'tenant'),
    ('sedes:eliminar', 'Eliminar sedes', 'sedes', 'eliminar', 'tenant'),
    ('platform:empresas:ver',           'Ver empresas (plataforma)',      'empresas',      'ver',       'platform'),
    ('platform:empresas:crear',         'Crear empresas (plataforma)',    'empresas',      'crear',     'platform'),
    ('platform:empresas:editar',        'Editar empresas (plataforma)',   'empresas',      'editar',    'platform'),
    ('platform:billing:ver',            'Ver billing SaaS',               'billing',       'ver',       'platform'),
    ('platform:billing:gestionar',      'Gestionar billing SaaS',         'billing',       'gestionar', 'platform'),
    ('platform:suscripciones:gestionar','Gestionar suscripciones',        'suscripciones', 'gestionar', 'platform'),
    ('platform:planes:gestionar',       'Gestionar planes',               'planes',        'gestionar', 'platform'),
    ('platform:usuarios:gestionar',     'Gestionar usuarios plataforma',  'usuarios',      'gestionar', 'platform')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r, permisos p
WHERE r.codigo = 'admin'
  AND p.scope = 'tenant'
ON CONFLICT (rol_id, permiso_id) DO NOTHING;

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r, permisos p
WHERE r.codigo = 'operador'
  AND p.codigo IN (
      'clientes:ver', 'clientes:crear', 'clientes:editar',
      'vehiculos:ver', 'vehiculos:crear',
      'ordenes:ver', 'ordenes:crear', 'ordenes:editar',
      'parqueadero:ver', 'parqueadero:crear',
      'lavadero:ver', 'lavadero:crear',
      'taller:ver', 'taller:crear',
      'reportes:ver'
  )
ON CONFLICT (rol_id, permiso_id) DO NOTHING;

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r, permisos p
WHERE r.codigo = 'empleado'
  AND p.codigo IN (
      'parqueadero:ver', 'parqueadero:crear',
      'lavadero:ver', 'lavadero:crear',
      'taller:ver', 'taller:crear',
      'reportes:ver'
  )
ON CONFLICT (rol_id, permiso_id) DO NOTHING;

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r, permisos p
WHERE r.codigo = 'superadmin'
  AND p.scope = 'platform'
ON CONFLICT (rol_id, permiso_id) DO NOTHING;

INSERT INTO usuario_roles (usuario_id, rol_id, empresa_id)
SELECT
    u.id,
    r.id,
    CASE WHEN u.scope = 'platform' THEN NULL ELSE u.empresa_id END
FROM usuarios u
JOIN roles r ON r.codigo = CASE
    WHEN u.scope = 'platform'
      OR LOWER(REGEXP_REPLACE(translate(COALESCE(u.rol, ''), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'), '[\s_-]+', '', 'g')) = 'superadmin'
    THEN 'superadmin'
    WHEN LOWER(REGEXP_REPLACE(translate(COALESCE(u.rol, ''), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'), '[\s_-]+', '', 'g')) IN ('admin', 'administrador')
    THEN 'admin'
    WHEN LOWER(REGEXP_REPLACE(translate(COALESCE(u.rol, ''), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'), '[\s_-]+', '', 'g')) = 'operador'
    THEN 'operador'
    ELSE 'empleado'
END
WHERE NOT EXISTS (
    SELECT 1
    FROM usuario_roles ur
    WHERE ur.usuario_id = u.id
      AND ur.empresa_id IS NOT DISTINCT FROM
          (CASE WHEN u.scope = 'platform' THEN NULL ELSE u.empresa_id END)
)
ON CONFLICT DO NOTHING;

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
             WHEN LOWER(COALESCE(l.nombre, 'demo')) LIKE '%premium%' THEN 'enterprise'
             WHEN LOWER(COALESCE(l.nombre, 'demo')) LIKE '%pro%' THEN 'pro'
             ELSE 'starter'
         END
         LIMIT 1),
        (SELECT id FROM planes WHERE codigo = 'starter' LIMIT 1)
    ),
    se.estado,
    se.fecha_inicio,
    se.fecha_fin,
    CASE
        WHEN se.estado = 'TRIAL' AND se.fecha_fin IS NULL
        THEN se.fecha_inicio + INTERVAL '14 days'
        ELSE NULL
    END,
    'MENSUAL',
    se.renovacion_automatica,
    se.pasarela,
    se.precio_plan,
    se.moneda,
    'Migrada automáticamente desde suscripciones_empresa',
    se.creado_en,
    se.actualizado_en
FROM suscripciones_empresa se
LEFT JOIN licencias l ON l.id = se.licencia_id
WHERE NOT EXISTS (
    SELECT 1
    FROM suscripciones s2
    WHERE s2.empresa_id = se.empresa_id
      AND s2.estado IN ('TRIAL', 'ACTIVA')
)
ON CONFLICT DO NOTHING;

-- ============================================================
-- FIN DEL SCHEMA 001
-- ============================================================
