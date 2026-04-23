-- ============================================================
-- AutoGestión360 — Billing Wompi payment sources
-- Versión: 011
-- Generado: 2026-04-22
-- ============================================================

SET client_encoding = 'UTF8';

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
