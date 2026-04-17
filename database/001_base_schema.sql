-- ============================================================
-- AutoGestión360 — Schema base consolidado
-- Versión: 001
-- Generado: 2026-04-16
--
-- Consolida: estructura.sql + todas las migrations/*.sql
-- Incluye también las tablas creadas dinámicamente en código.
--
-- INSTRUCCIONES DE USO:
--   psql -U <usuario> -d autogestion360 -f database/001_base_schema.sql
--
-- REQUISITOS: la base de datos debe existir previamente.
-- Este script es idempotente (IF NOT EXISTS en todo).
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
    empresa_id      BIGINT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    nombre          VARCHAR(120) NOT NULL,
    email           VARCHAR(120) NOT NULL,
    password_hash   VARCHAR(200) NOT NULL,
    rol             VARCHAR(30) NOT NULL,
    activo          BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS usuarios_empresa_email_uniq
    ON usuarios (empresa_id, email);


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
    creado_en   TIMESTAMPTZ DEFAULT NOW()
);

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
-- BLOQUE 8: DATOS SEMILLA — LICENCIAS Y MÓDULOS
-- (de licencias_setup.sql)
-- ────────────────────────────────────────────

INSERT INTO licencias (nombre, descripcion, precio) VALUES
    ('Demo',    'Acceso de prueba — solo parqueadero', 0),
    ('Básica',  'Parqueadero + Lavadero + Matrícula',  50),
    ('Premium', 'Acceso completo a todos los módulos', 100)
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO modulos (nombre, descripcion) VALUES
    ('parqueadero', 'Gestión de parqueadero'),
    ('lavadero',    'Gestión de lavadero'),
    ('taller',      'Gestión de taller mecánico'),
    ('matricula',   'Gestión de matrículas'),
    ('evaluacion',  'Módulo de evaluación')
ON CONFLICT (nombre) DO NOTHING;

-- Módulos por licencia
INSERT INTO licencia_modulo (licencia_id, modulo_id)
SELECT l.id, m.id FROM licencias l, modulos m
WHERE l.nombre = 'Demo' AND m.nombre = 'parqueadero'
ON CONFLICT DO NOTHING;

INSERT INTO licencia_modulo (licencia_id, modulo_id)
SELECT l.id, m.id FROM licencias l, modulos m
WHERE l.nombre = 'Básica' AND m.nombre IN ('parqueadero','lavadero','matricula')
ON CONFLICT DO NOTHING;

INSERT INTO licencia_modulo (licencia_id, modulo_id)
SELECT l.id, m.id FROM licencias l, modulos m
WHERE l.nombre = 'Premium'
ON CONFLICT DO NOTHING;

-- ============================================================
-- FIN DEL SCHEMA 001
-- ============================================================
