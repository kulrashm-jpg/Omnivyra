-- =============================================================================
-- Sandbox settlement-lifecycle foundation (additive)
--
-- Establishes canonical backend settlement-state orchestration so persisted
-- checkout sessions can move through normalized lifecycle states deterministi-
-- cally in SANDBOX mode. Two additive deliverables:
--
--  (A) billing_checkout_sessions — additive settlement-lifecycle columns:
--      settlement_status / provider_event_reference / provider_raw_status /
--      settled_at / last_reconciled_at. Existing columns/behaviour unchanged.
--
--  (B) billing_settlement_events — APPEND-ONLY ledger of normalized provider
--      webhook events. UNIQUE(provider, provider_event_id) is the deterministic
--      idempotency anchor: a redelivered webhook collides and is a safe no-op.
--      Immutable via the EXISTING raise_ledger_immutable() (migration 20260663).
--
-- SAFETY: purely additive, idempotent (IF NOT EXISTS), no historical mutation,
-- no changes to existing tables/RPCs/ledger/HOLD semantics. SANDBOX ONLY — no
-- live settlement, no wallet funding, no credit issuance, no entitlement
-- activation, no invoicing. NOT applied by this change — controlled migration
-- process only.
-- =============================================================================

-- ── (A) billing_checkout_sessions — additive settlement-lifecycle columns ────
ALTER TABLE IF EXISTS public.billing_checkout_sessions
  ADD COLUMN IF NOT EXISTS settlement_status        text        NOT NULL DEFAULT 'created',
  ADD COLUMN IF NOT EXISTS provider_event_reference text,
  ADD COLUMN IF NOT EXISTS provider_raw_status      text,
  ADD COLUMN IF NOT EXISTS settled_at               timestamptz,
  ADD COLUMN IF NOT EXISTS last_reconciled_at       timestamptz;

-- Normalized internal states only — provider-specific raw states live in
-- provider_raw_status, never leak into settlement_status.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'billing_checkout_sessions_settlement_status_chk'
  ) THEN
    ALTER TABLE public.billing_checkout_sessions
      ADD CONSTRAINT billing_checkout_sessions_settlement_status_chk
      CHECK (settlement_status IN
        ('created','pending','authorized','succeeded','failed','cancelled','expired'));
  END IF;
END $$;

-- ── (B) billing_settlement_events — append-only normalized webhook ledger ────
CREATE TABLE IF NOT EXISTS public.billing_settlement_events (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider                 text        NOT NULL,
  -- Provider's own event id — the deterministic idempotency anchor.
  provider_event_id        text        NOT NULL,
  -- The provider order/session reference this event settles (matched against
  -- billing_checkout_sessions.provider_reference).
  session_reference        text,
  -- Link to the persisted checkout session (nullable — an event may arrive
  -- with no matching session; it is still recorded, never actioned).
  checkout_idempotency_key text,
  event_type               text,
  normalized_status        text        NOT NULL
                                        CHECK (normalized_status IN
                                          ('created','pending','authorized','succeeded','failed','cancelled','expired')),
  provider_raw_status      text,
  payload                  jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  -- A redelivered webhook collides here → recorded once, actioned once.
  CONSTRAINT billing_settlement_events_provider_event_uq UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_bse_session_ref
  ON public.billing_settlement_events (provider, session_reference, created_at DESC);

-- Append-only: reuse the existing immutability guard (no new trigger fn).
DROP TRIGGER IF EXISTS bse_immutable_update ON public.billing_settlement_events;
CREATE TRIGGER bse_immutable_update
  BEFORE UPDATE ON public.billing_settlement_events
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

DROP TRIGGER IF EXISTS bse_immutable_delete ON public.billing_settlement_events;
CREATE TRIGGER bse_immutable_delete
  BEFORE DELETE ON public.billing_settlement_events
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

COMMENT ON TABLE public.billing_settlement_events IS
  'Append-only normalized provider webhook ledger. UNIQUE(provider,provider_event_id) = deterministic idempotency. Sandbox-only. Immutable (raise_ledger_immutable).';
