-- ============================================================================
-- LOCALHOST PHASE-7 BOOTSTRAP — minimal prerequisites for the Phase-7
-- reconciliation runtime certification on a clean local Supabase.
--
-- INTENT: this file is NEVER part of the canonical migration history. It
-- exists ONLY when `supabase/migrations_parked/` is populated (i.e. when an
-- operator has temporarily parked the full migration set to bring up a
-- clean local stack for Phase-7-only verification). The parking helper
-- restores the full set after the soak; this bootstrap is removed at that
-- point.
--
-- WHAT THIS PROVIDES:
--   1. raise_ledger_immutable() function — required by all immutability
--      triggers attached in 20260711 / 20260712.
--   2. Stub tables that the Phase-7 reconcilers/views READ from and that
--      runtime services WRITE to (purchaseService, razorpayStagingService,
--      usageLedgerService, stripeWebhookService, etc.). Columns are
--      permissively-typed and nullable; the goal is for INSERTs/UPDATEs
--      against these tables to succeed without ALTER-TABLE patching.
--   3. pgcrypto extension (gen_random_uuid).
--
-- VALIDATION: scripts/verify-localhost-bootstrap-parity.ts cross-checks this
-- file against runtime write callsites and exits non-zero on drift.
--
-- DO NOT use this file in any non-localhost context.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.raise_ledger_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'LEDGER_IMMUTABLE: row in % is append-only and cannot be % (id=%, audit-violation)',
    TG_TABLE_NAME, TG_OP, COALESCE(OLD.id::text, '<unknown>')
    USING ERRCODE = 'P0001';
END;
$$;

-- Stub: credit_transactions.
CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  execution_phase text,
  credits_delta   numeric(20,10),
  category        text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Stub: usage_events.
CREATE TABLE IF NOT EXISTS public.usage_events (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid,
  user_id                     uuid,
  campaign_id                 uuid,
  provider_name               text,
  provider                    text,
  model_name                  text,
  model                       text,
  model_version               text,
  source_type                 text,
  source_name                 text,
  process_type                text,
  feature_area                text,
  action_key                  text,
  input_tokens                bigint,
  output_tokens               bigint,
  total_tokens                bigint,
  input_cost_usd              numeric(20,10),
  output_cost_usd             numeric(20,10),
  total_cost_usd              numeric(20,10),
  total_cost                  numeric(20,10),
  unit_cost                   numeric(20,10),
  final_price_usd             numeric(20,10),
  pricing_snapshot            jsonb,
  latency_ms                  integer,
  error_flag                  boolean,
  error_type                  text,
  beta_cohort                 text,
  monetization_beta_enabled   boolean,
  metadata                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ledger_hold_transaction_id  uuid,
  reference_id                text,
  reference_type              text,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

-- Stub: credit_purchases.
CREATE TABLE IF NOT EXISTS public.credit_purchases (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL,
  provider                    text,
  provider_mode               text,
  provider_event_id           text,
  provider_payment_id         text,
  provider_order_id           text,
  provider_payload            jsonb,
  amount_usd                  numeric(20,10),
  amount_paid                 numeric(20,10),
  amount_subunits             bigint,
  currency                    text,
  credits                     integer,
  package_id                  text,
  plan_id                     uuid,
  reference_id                text,
  status                      text NOT NULL DEFAULT 'pending',
  fulfillment_status          text,
  fulfillment_error           text,
  beta_cohort                 text,
  beta_access_level           text,
  monetization_beta_enabled   boolean,
  occurred_at                 timestamptz NOT NULL DEFAULT now(),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- Stub: payment_provider_events.
CREATE TABLE IF NOT EXISTS public.payment_provider_events (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider                    text NOT NULL,
  provider_mode               text,
  provider_event_id           text NOT NULL,
  provider_order_id           text,
  provider_payment_id         text,
  event_type                  text NOT NULL,
  purchase_id                 uuid,
  organization_id             uuid,
  payload                     jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id                  text,
  correlation_id              text,
  signature_algorithm         text,
  signature_valid             boolean,
  beta_cohort                 text,
  beta_access_level           text,
  monetization_beta_enabled   boolean,
  processing_status           text NOT NULL DEFAULT 'recorded',
  processed_at                timestamptz,
  error_message               text,
  received_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

-- Stub: payment_transactions.
CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL,
  provider                 text NOT NULL,
  provider_transaction_id  text NOT NULL,
  amount                   numeric(14,2) NOT NULL,
  fee_amount               numeric(14,2) NOT NULL DEFAULT 0,
  net_amount               numeric(14,2) NOT NULL,
  currency                 text NOT NULL DEFAULT 'USD',
  status                   text NOT NULL,
  occurred_at              timestamptz NOT NULL,
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_transaction_id)
);

-- Stub: billing_subscriptions.
CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL,
  provider                  text,
  provider_subscription_id  text,
  status                    text NOT NULL,
  currency                  text,
  current_period_start      timestamptz NOT NULL,
  current_period_end        timestamptz NOT NULL,
  metadata                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                timestamptz NOT NULL DEFAULT now()
);
