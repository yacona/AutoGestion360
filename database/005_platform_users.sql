-- ============================================================
-- AutoGestión360 — Migración 005: Usuarios de plataforma vs. tenant
-- Sprint 4.5 — Separación de alcance de usuarios
--
-- OBJETIVO: Soportar usuarios de plataforma (superadmin, soporte, etc.)
-- que no pertenecen a ninguna empresa cliente.
--
-- CAMBIOS:
--   1. Agregar columna `scope` a `usuarios`
--   2. Hacer `empresa_id` nullable
--   3. Agregar constraint cross-campo: tenant => empresa_id NOT NULL
--   4. Índice de unicidad de email para usuarios de plataforma
--
-- EJECUCIÓN:
--   psql -U <usuario> -d autogestion360 -f database/005_platform_users.sql
--
-- IDEMPOTENTE: sí (usa IF NOT EXISTS / IF EXISTS / ALTER ... IF EXISTS)
-- ============================================================

BEGIN;

-- 1. Agregar columna scope (default 'tenant' para no romper registros existentes)
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS scope VARCHAR(10) NOT NULL DEFAULT 'tenant';

-- 2. Hacer empresa_id nullable (plataforma users no pertenecen a empresa)
ALTER TABLE usuarios
  ALTER COLUMN empresa_id DROP NOT NULL;

-- 3. Constraint: scope solo puede ser 'platform' o 'tenant'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'usuarios_scope_check'
      AND conrelid = 'usuarios'::regclass
  ) THEN
    ALTER TABLE usuarios
      ADD CONSTRAINT usuarios_scope_check
      CHECK (scope IN ('platform', 'tenant'));
  END IF;
END $$;

-- 4. Constraint cross-campo: tenant user siempre debe tener empresa_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'usuarios_scope_empresa_check'
      AND conrelid = 'usuarios'::regclass
  ) THEN
    ALTER TABLE usuarios
      ADD CONSTRAINT usuarios_scope_empresa_check
      CHECK (scope = 'platform' OR empresa_id IS NOT NULL);
  END IF;
END $$;

-- 5. Unicidad global de email para usuarios de plataforma
--    (La unicidad por empresa ya existe: usuarios_empresa_email_uniq)
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_platform_email_uniq
  ON usuarios (LOWER(email))
  WHERE scope = 'platform';

-- 6. Índice de rendimiento para consultas por scope
CREATE INDEX IF NOT EXISTS usuarios_scope_idx
  ON usuarios (scope);

-- 7. Dejar updatedAt como evidencia de la migración (columna futura)
--    No se modifica estructura existente, solo comentario.

COMMIT;

-- NOTAS OPERATIVAS:
--
-- a) Los usuarios existentes quedan con scope='tenant' y empresa_id tal cual.
--    No se migra automáticamente ningún SuperAdmin existente, ya que
--    puede estar correctamente asociado a una empresa demo.
--
-- b) Para crear el primer usuario de plataforma usa:
--      node scripts/create-platform-admin.js
--
-- c) Para promover un usuario existente a plataforma:
--      node scripts/promote-superadmin.js admin@ejemplo.com
--    Esto cambia el rol Y el scope a 'platform' y limpia empresa_id.
--
-- d) El constraint usuarios_scope_empresa_check garantiza que no pueda
--    existir un usuario con scope='tenant' y empresa_id = NULL.
