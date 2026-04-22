-- ============================================================
-- AutoGestion360 -- Migracion 008: auditoria compatible con SaaS
--
-- Objetivo:
--   permitir eventos de seguridad sin empresa asociada
--   (usuarios platform, login fallido, token invalido, etc.)
-- ============================================================

BEGIN;

ALTER TABLE auditoria
  ALTER COLUMN empresa_id DROP NOT NULL;

COMMIT;
