-- ============================================================
-- AutoGestión360 — Billing SaaS oficial
-- Versión: 010
-- Generado: 2026-04-22
--
-- Objetivo:
--   - Crear ledger oficial de facturación del SaaS nuevo
--   - Mantener facturas_saas como compatibilidad legacy
--   - Preparar cobro manual primero y automático después
-- ============================================================

SET client_encoding = 'UTF8';

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
    CONSTRAINT billing_invoices_collection_check CHECK (collection_method IN ('MANUAL', 'AUTOMATIC')),
    CONSTRAINT billing_invoices_amounts_check CHECK (
      subtotal >= 0 AND monto_impuestos >= 0 AND monto_descuento >= 0
      AND total >= 0 AND saldo_pendiente >= 0 AND total_pagado >= 0 AND total_acreditado >= 0
    )
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
    CONSTRAINT billing_attempts_estado_check CHECK (estado IN ('CREATED', 'PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED', 'IGNORED')),
    CONSTRAINT billing_attempts_amount_check CHECK (amount >= 0)
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
    CONSTRAINT billing_payments_estado_check CHECK (estado IN ('CONFIRMED', 'REFUNDED', 'VOIDED', 'CHARGEBACK')),
    CONSTRAINT billing_payments_amount_check CHECK (amount >= 0)
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
    CONSTRAINT billing_credit_notes_estado_check CHECK (estado IN ('DRAFT', 'ISSUED', 'APPLIED', 'VOID')),
    CONSTRAINT billing_credit_notes_amount_check CHECK (
      subtotal >= 0 AND tax_amount >= 0 AND total_amount >= 0 AND remaining_amount >= 0
    )
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

INSERT INTO permisos (codigo, nombre, modulo, accion, scope) VALUES
    ('platform:billing:ver',       'Ver billing SaaS',       'billing', 'ver',       'platform'),
    ('platform:billing:gestionar', 'Gestionar billing SaaS', 'billing', 'gestionar', 'platform')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id
FROM roles r
JOIN permisos p ON p.codigo IN ('platform:billing:ver', 'platform:billing:gestionar')
WHERE r.codigo = 'superadmin'
ON CONFLICT (rol_id, permiso_id) DO NOTHING;

-- ────────────────────────────────────────────
-- Backfill best-effort desde facturación legacy
-- ────────────────────────────────────────────

WITH legacy_invoice_source AS (
  SELECT
    fs.*,
    s.id AS saas_suscripcion_id,
    s.plan_id AS saas_plan_id
  FROM facturas_saas fs
  LEFT JOIN LATERAL (
    SELECT s2.id, s2.plan_id
    FROM suscripciones s2
    WHERE s2.empresa_id = fs.empresa_id
    ORDER BY
      CASE WHEN s2.estado IN ('TRIAL', 'ACTIVA') THEN 0 ELSE 1 END,
      COALESCE(s2.actualizado_en, s2.creado_en) DESC NULLS LAST,
      s2.id DESC
    LIMIT 1
  ) s ON TRUE
)
INSERT INTO billing_invoices (
  empresa_id, suscripcion_id, plan_id, legacy_factura_id, numero_factura,
  tipo_documento, motivo, estado, collection_method, moneda,
  subtotal, monto_impuestos, monto_descuento, total, saldo_pendiente,
  total_pagado, total_acreditado, periodo_inicio, periodo_fin,
  emitida_en, vencimiento_en, pagada_en, cerrada_en, pasarela,
  metadata, created_at, updated_at
)
SELECT
  src.empresa_id,
  src.saas_suscripcion_id,
  src.saas_plan_id,
  src.id,
  src.numero_factura,
  'INVOICE',
  'LEGACY_IMPORT',
  CASE
    WHEN UPPER(src.estado) = 'PAGADA' THEN 'PAID'
    WHEN UPPER(src.estado) = 'VENCIDA' THEN 'OVERDUE'
    WHEN UPPER(src.estado) = 'ANULADA' THEN 'VOID'
    ELSE 'OPEN'
  END,
  CASE WHEN UPPER(COALESCE(src.pasarela, 'MANUAL')) = 'MANUAL' THEN 'MANUAL' ELSE 'AUTOMATIC' END,
  COALESCE(src.moneda, 'COP'),
  COALESCE(src.subtotal, 0),
  COALESCE(src.impuestos, 0),
  0,
  COALESCE(src.total, 0),
  CASE WHEN UPPER(src.estado) = 'PAGADA' THEN 0 ELSE COALESCE(src.total, 0) END,
  CASE WHEN UPPER(src.estado) = 'PAGADA' THEN COALESCE(src.total, 0) ELSE 0 END,
  0,
  src.periodo_inicio,
  src.periodo_fin,
  COALESCE(src.fecha_emision::timestamptz, src.creado_en),
  src.fecha_vencimiento::timestamptz,
  src.fecha_pago,
  CASE WHEN UPPER(src.estado) IN ('PAGADA', 'ANULADA') THEN COALESCE(src.fecha_pago, src.actualizado_en) ELSE NULL END,
  COALESCE(src.pasarela, 'MANUAL'),
  COALESCE(src.metadata, '{}'::jsonb) || jsonb_build_object(
    'legacy_facturas_saas_id', src.id,
    'migrated_from', 'facturas_saas',
    'migration', '010_billing_core'
  ),
  COALESCE(src.creado_en, NOW()),
  COALESCE(src.actualizado_en, NOW())
FROM legacy_invoice_source src
WHERE NOT EXISTS (
  SELECT 1
  FROM billing_invoices bi
  WHERE bi.legacy_factura_id = src.id
     OR bi.numero_factura = src.numero_factura
);

INSERT INTO billing_payments (
  invoice_id, empresa_id, suscripcion_id, provider, payment_method, estado,
  amount, currency, external_payment_id, referencia_externa, paid_at, metadata, created_at
)
SELECT
  bi.id,
  bi.empresa_id,
  bi.suscripcion_id,
  bi.pasarela,
  COALESCE(fs.metodo_pago, 'OTRO'),
  'CONFIRMED',
  COALESCE(fs.total, 0),
  COALESCE(fs.moneda, 'COP'),
  fs.referencia_pago,
  fs.referencia_pago,
  COALESCE(fs.fecha_pago, bi.pagada_en, bi.updated_at),
  COALESCE(fs.metadata, '{}'::jsonb) || jsonb_build_object(
    'legacy_facturas_saas_id', fs.id,
    'migrated_from', 'facturas_saas',
    'migration', '010_billing_core'
  ),
  COALESCE(fs.fecha_pago, bi.pagada_en, bi.updated_at)
FROM facturas_saas fs
JOIN billing_invoices bi ON bi.legacy_factura_id = fs.id
WHERE UPPER(fs.estado) = 'PAGADA'
  AND NOT EXISTS (
    SELECT 1
    FROM billing_payments bp
    WHERE bp.invoice_id = bi.id
      AND (
        (bp.external_payment_id IS NOT NULL AND bp.external_payment_id = fs.referencia_pago)
        OR (bp.external_payment_id IS NULL AND bp.amount = COALESCE(fs.total, 0))
      )
  );
