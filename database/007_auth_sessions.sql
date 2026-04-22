-- ============================================================
-- AutoGestion360 -- Migracion 007: sesiones y refresh tokens
--
-- Objetivo:
--   - Soportar refresh tokens con rotacion y revocacion
--   - Habilitar cierre de sesion por dispositivo y logout global
--   - Permitir auditoria de sesiones y eventos de autenticacion
-- ============================================================

BEGIN;

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

COMMIT;
