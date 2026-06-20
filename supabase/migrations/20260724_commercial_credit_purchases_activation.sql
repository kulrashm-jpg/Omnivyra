-- ============================================================================
-- Commercial activation — credit_purchases + payment_provider_events columns
-- ----------------------------------------------------------------------------
-- The SAFE, minimum activation set from COMMERCIAL_SCHEMA_DRIFT_AUDIT (Section D).
-- It is the idempotent, ADDITIVE column subset of 20260625 + the full (already
-- idempotent) 20260626 — WITHOUT 20260625's RPC replacements / type changes /
-- DROP statements (those are MEDIUM-risk under the migration-ledger desync and
-- are NOT required for the top-up checkout/verify/allocation/invoice flow).
--
-- Apply via the controlled process (Supabase SQL editor / a single targeted
-- migration) against production — NOT `supabase db push` (the ledger is desynced;
-- a push would attempt ~140 unrelated migrations). Every statement is
-- IF NOT EXISTS → safe to run and safe to re-run. No data loss, no RPC/type/drop.
--
-- After applying, the 9 credit_purchases columns the commercial code writes
-- (provider, provider_event_id, provider_payment_id, provider_order_id,
--  provider_mode, amount_subunits, provider_payload, fulfilled_at,
--  fulfillment_error, updated_at) all resolve, unblocking create-order / verify /
-- completePurchase / invoice generation / billing center.
-- ============================================================================

-- ── credit_purchases: column subset from 20260625 ──────────────────────────
ALTER TABLE credit_purchases
  ADD COLUMN IF NOT EXISTS provider             text,
  ADD COLUMN IF NOT EXISTS provider_event_id    text,
  ADD COLUMN IF NOT EXISTS provider_payment_id  text,
  ADD COLUMN IF NOT EXISTS fulfilled_at         timestamptz,
  ADD COLUMN IF NOT EXISTS fulfillment_error    text,
  ADD COLUMN IF NOT EXISTS updated_at           timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_purchases_provider_event_unique
  ON credit_purchases (provider, provider_event_id)
  WHERE provider IS NOT NULL AND provider_event_id IS NOT NULL;

-- ── credit_purchases: all of 20260626 (provider order / mode / payload) ────
ALTER TABLE credit_purchases
  ADD COLUMN IF NOT EXISTS provider_order_id    text,
  ADD COLUMN IF NOT EXISTS provider_mode        text NOT NULL DEFAULT 'manual'
    CHECK (provider_mode IN ('manual', 'test', 'live')),
  ADD COLUMN IF NOT EXISTS amount_subunits      integer,
  ADD COLUMN IF NOT EXISTS provider_payload     jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_purchases_provider_order_unique
  ON credit_purchases (provider, provider_order_id)
  WHERE provider IS NOT NULL AND provider_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_credit_purchases_provider_mode_status
  ON credit_purchases (provider, provider_mode, status, fulfillment_status);

-- ── payment_provider_events: 20260626 columns ─────────────────────────────
ALTER TABLE payment_provider_events
  ADD COLUMN IF NOT EXISTS provider_mode        text NOT NULL DEFAULT 'test'
    CHECK (provider_mode IN ('test', 'live')),
  ADD COLUMN IF NOT EXISTS signature_valid      boolean,
  ADD COLUMN IF NOT EXISTS signature_algorithm  text,
  ADD COLUMN IF NOT EXISTS provider_order_id    text,
  ADD COLUMN IF NOT EXISTS provider_payment_id  text;

CREATE INDEX IF NOT EXISTS idx_payment_provider_events_order
  ON payment_provider_events (provider, provider_order_id, received_at DESC)
  WHERE provider_order_id IS NOT NULL;
