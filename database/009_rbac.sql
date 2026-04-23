-- ============================================================
-- AutoGestión360 — RBAC real + sedes
-- Versión: 009
-- Generado: 2026-04-22
--
-- Crea tablas: roles, permisos, rol_permisos, usuario_roles, sedes
-- Agrega: planes.max_sedes
-- Seeds:  roles de sistema, permisos por módulo, asignaciones
-- Migra:  usuarios.rol (string) → usuario_roles (tabla)
-- ============================================================

SET client_encoding = 'UTF8';

-- ────────────────────────────────────────────
-- 1. CATÁLOGO DE ROLES
-- ────────────────────────────────────────────

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

-- ────────────────────────────────────────────
-- 2. CATÁLOGO DE PERMISOS
-- ────────────────────────────────────────────

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

CREATE INDEX IF NOT EXISTS permisos_modulo_idx ON permisos (modulo);

-- ────────────────────────────────────────────
-- 3. PIVOT ROL ↔ PERMISO
-- ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rol_permisos (
    id         SERIAL PRIMARY KEY,
    rol_id     INTEGER NOT NULL REFERENCES roles(id)   ON DELETE CASCADE,
    permiso_id INTEGER NOT NULL REFERENCES permisos(id) ON DELETE CASCADE,
    creado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (rol_id, permiso_id)
);

CREATE INDEX IF NOT EXISTS rol_permisos_rol_idx ON rol_permisos (rol_id);

-- ────────────────────────────────────────────
-- 4. ASIGNACIÓN USUARIO ↔ ROL
-- ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS usuario_roles (
    id           BIGSERIAL PRIMARY KEY,
    usuario_id   BIGINT  NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    rol_id       INTEGER NOT NULL REFERENCES roles(id)    ON DELETE CASCADE,
    empresa_id   BIGINT  REFERENCES empresas(id)          ON DELETE CASCADE,
    asignado_por BIGINT  REFERENCES usuarios(id)          ON DELETE SET NULL,
    creado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unicidad separada para usuarios tenant vs platform
CREATE UNIQUE INDEX IF NOT EXISTS usuario_roles_tenant_uniq
    ON usuario_roles (usuario_id, rol_id, empresa_id)
    WHERE empresa_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS usuario_roles_platform_uniq
    ON usuario_roles (usuario_id, rol_id)
    WHERE empresa_id IS NULL;

CREATE INDEX IF NOT EXISTS usuario_roles_usuario_empresa_idx
    ON usuario_roles (usuario_id, empresa_id);

-- ────────────────────────────────────────────
-- 5. SEDES (sucursales por empresa)
-- ────────────────────────────────────────────

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

CREATE INDEX IF NOT EXISTS sedes_empresa_idx ON sedes (empresa_id);

-- ────────────────────────────────────────────
-- 6. LÍMITE DE SEDES POR PLAN
-- ────────────────────────────────────────────

ALTER TABLE planes ADD COLUMN IF NOT EXISTS max_sedes INTEGER;

UPDATE planes SET max_sedes = 1     WHERE codigo = 'starter'    AND max_sedes IS NULL;
UPDATE planes SET max_sedes = 3     WHERE codigo = 'pro'        AND max_sedes IS NULL;
UPDATE planes SET max_sedes = NULL  WHERE codigo = 'enterprise';  -- ilimitado

-- ────────────────────────────────────────────
-- 7. SEEDS — ROLES DE SISTEMA
-- ────────────────────────────────────────────

INSERT INTO roles (codigo, nombre, descripcion, scope, es_sistema, activo) VALUES
    ('superadmin', 'Super Administrador', 'Acceso total a plataforma y tenants. No requiere permisos explícitos.', 'both',     TRUE, TRUE),
    ('admin',      'Administrador',       'Gestión completa de operaciones dentro del tenant.',                    'tenant',   TRUE, TRUE),
    ('operador',   'Operador',            'Operaciones de entrada/salida y atención al cliente.',                  'tenant',   TRUE, TRUE),
    ('empleado',   'Empleado',            'Acceso básico a servicios operativos.',                                 'tenant',   TRUE, TRUE)
ON CONFLICT (codigo) DO UPDATE
    SET nombre = EXCLUDED.nombre,
        descripcion = EXCLUDED.descripcion,
        scope = EXCLUDED.scope,
        activo = EXCLUDED.activo;

-- ────────────────────────────────────────────
-- 8. SEEDS — PERMISOS TENANT
-- ────────────────────────────────────────────

INSERT INTO permisos (codigo, nombre, modulo, accion, scope) VALUES
    -- clientes
    ('clientes:ver',       'Ver clientes',       'clientes',       'ver',      'tenant'),
    ('clientes:crear',     'Crear clientes',     'clientes',       'crear',    'tenant'),
    ('clientes:editar',    'Editar clientes',    'clientes',       'editar',   'tenant'),
    ('clientes:eliminar',  'Eliminar clientes',  'clientes',       'eliminar', 'tenant'),
    -- vehículos
    ('vehiculos:ver',      'Ver vehículos',      'vehiculos',      'ver',      'tenant'),
    ('vehiculos:crear',    'Crear vehículos',    'vehiculos',      'crear',    'tenant'),
    ('vehiculos:editar',   'Editar vehículos',   'vehiculos',      'editar',   'tenant'),
    -- empleados
    ('empleados:ver',      'Ver empleados',      'empleados',      'ver',      'tenant'),
    ('empleados:crear',    'Crear empleados',    'empleados',      'crear',    'tenant'),
    ('empleados:editar',   'Editar empleados',   'empleados',      'editar',   'tenant'),
    ('empleados:eliminar', 'Eliminar empleados', 'empleados',      'eliminar', 'tenant'),
    -- parqueadero
    ('parqueadero:ver',    'Ver parqueadero',    'parqueadero',    'ver',      'tenant'),
    ('parqueadero:crear',  'Registrar entrada',  'parqueadero',    'crear',    'tenant'),
    ('parqueadero:editar', 'Editar registro',    'parqueadero',    'editar',   'tenant'),
    -- lavadero
    ('lavadero:ver',       'Ver lavadero',       'lavadero',       'ver',      'tenant'),
    ('lavadero:crear',     'Crear servicio',     'lavadero',       'crear',    'tenant'),
    ('lavadero:editar',    'Editar servicio',    'lavadero',       'editar',   'tenant'),
    -- taller
    ('taller:ver',         'Ver taller',         'taller',         'ver',      'tenant'),
    ('taller:crear',       'Crear orden',        'taller',         'crear',    'tenant'),
    ('taller:editar',      'Editar orden',       'taller',         'editar',   'tenant'),
    -- órdenes
    ('ordenes:ver',        'Ver órdenes',        'ordenes',        'ver',      'tenant'),
    ('ordenes:crear',      'Crear órdenes',      'ordenes',        'crear',    'tenant'),
    ('ordenes:editar',     'Editar órdenes',     'ordenes',        'editar',   'tenant'),
    ('ordenes:cancelar',   'Cancelar órdenes',   'ordenes',        'cancelar', 'tenant'),
    -- reportes
    ('reportes:ver',       'Ver reportes',       'reportes',       'ver',      'tenant'),
    ('reportes:exportar',  'Exportar reportes',  'reportes',       'exportar', 'tenant'),
    -- usuarios
    ('usuarios:ver',       'Ver usuarios',       'usuarios',       'ver',      'tenant'),
    ('usuarios:crear',     'Crear usuarios',     'usuarios',       'crear',    'tenant'),
    ('usuarios:editar',    'Editar usuarios',    'usuarios',       'editar',   'tenant'),
    ('usuarios:eliminar',  'Eliminar usuarios',  'usuarios',       'eliminar', 'tenant'),
    -- configuración
    ('configuracion:ver',    'Ver configuración',    'configuracion', 'ver',    'tenant'),
    ('configuracion:editar', 'Editar configuración', 'configuracion', 'editar', 'tenant'),
    -- sedes
    ('sedes:ver',      'Ver sedes',      'sedes', 'ver',      'tenant'),
    ('sedes:crear',    'Crear sedes',    'sedes', 'crear',    'tenant'),
    ('sedes:editar',   'Editar sedes',   'sedes', 'editar',   'tenant'),
    ('sedes:eliminar', 'Eliminar sedes', 'sedes', 'eliminar', 'tenant')
ON CONFLICT (codigo) DO NOTHING;

-- Permisos de plataforma (solo superadmin)
INSERT INTO permisos (codigo, nombre, modulo, accion, scope) VALUES
    ('platform:empresas:ver',          'Ver empresas (plataforma)',          'empresas',      'ver',      'platform'),
    ('platform:empresas:crear',        'Crear empresas (plataforma)',        'empresas',      'crear',    'platform'),
    ('platform:empresas:editar',       'Editar empresas (plataforma)',       'empresas',      'editar',   'platform'),
    ('platform:suscripciones:gestionar','Gestionar suscripciones',           'suscripciones', 'gestionar','platform'),
    ('platform:planes:gestionar',      'Gestionar planes',                   'planes',        'gestionar','platform'),
    ('platform:usuarios:gestionar',    'Gestionar usuarios plataforma',      'usuarios',      'gestionar','platform')
ON CONFLICT (codigo) DO NOTHING;

-- ────────────────────────────────────────────
-- 9. SEEDS — ROL ↔ PERMISOS
-- ────────────────────────────────────────────

-- Admin: todos los permisos tenant
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r, permisos p
WHERE r.codigo = 'admin'
  AND p.scope = 'tenant'
ON CONFLICT (rol_id, permiso_id) DO NOTHING;

-- Operador: permisos operativos básicos
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r, permisos p
WHERE r.codigo = 'operador'
  AND p.codigo IN (
      'clientes:ver',    'clientes:crear',  'clientes:editar',
      'vehiculos:ver',   'vehiculos:crear',
      'ordenes:ver',     'ordenes:crear',   'ordenes:editar',
      'parqueadero:ver', 'parqueadero:crear',
      'lavadero:ver',    'lavadero:crear',
      'taller:ver',      'taller:crear',
      'reportes:ver'
  )
ON CONFLICT (rol_id, permiso_id) DO NOTHING;

-- Empleado: solo servicios directos
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r, permisos p
WHERE r.codigo = 'empleado'
  AND p.codigo IN (
      'parqueadero:ver', 'parqueadero:crear',
      'lavadero:ver',    'lavadero:crear',
      'taller:ver',      'taller:crear',
      'reportes:ver'
  )
ON CONFLICT (rol_id, permiso_id) DO NOTHING;

-- Superadmin: permisos de plataforma (los tenant se manejan con '*' en código)
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r, permisos p
WHERE r.codigo = 'superadmin'
  AND p.scope = 'platform'
ON CONFLICT (rol_id, permiso_id) DO NOTHING;

-- ────────────────────────────────────────────
-- 10. MIGRACIÓN: usuarios.rol → usuario_roles
-- ────────────────────────────────────────────
-- Cada usuario existente recibe su rol equivalente en la tabla normalizada.
-- La columna usuarios.rol se mantiene para compatibilidad; se puede deprecar
-- en una migración futura una vez que todo el código use usuario_roles.

INSERT INTO usuario_roles (usuario_id, rol_id, empresa_id)
SELECT
    u.id,
    r.id,
    CASE WHEN u.scope = 'platform' THEN NULL ELSE u.empresa_id END
FROM usuarios u
JOIN roles r ON r.codigo = CASE
    WHEN u.scope = 'platform'
      OR LOWER(
           REGEXP_REPLACE(
             translate(COALESCE(u.rol, ''), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'),
             '[\s_-]+', '', 'g'
           )
         ) = 'superadmin'
    THEN 'superadmin'
    WHEN LOWER(
           REGEXP_REPLACE(
             translate(COALESCE(u.rol, ''), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'),
             '[\s_-]+', '', 'g'
           )
         ) IN ('admin', 'administrador')
    THEN 'admin'
    WHEN LOWER(
           REGEXP_REPLACE(
             translate(COALESCE(u.rol, ''), 'áéíóúÁÉÍÓÚ', 'aeiouAEIOU'),
             '[\s_-]+', '', 'g'
           )
         ) = 'operador'
    THEN 'operador'
    ELSE 'empleado'
END
WHERE NOT EXISTS (
    SELECT 1 FROM usuario_roles ur
    WHERE ur.usuario_id = u.id
      AND ur.empresa_id IS NOT DISTINCT FROM
          (CASE WHEN u.scope = 'platform' THEN NULL ELSE u.empresa_id END)
)
ON CONFLICT DO NOTHING;

-- ============================================================
-- FIN DE MIGRACIÓN 009
-- ============================================================
