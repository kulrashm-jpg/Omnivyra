-- =============================================================================
-- Hidden pricing-governance audit + checkout-session persistence (additive)
--
-- Two additive deliverables:
--
--  (A) hidden_billing_catalog_audit — APPEND-ONLY forensic trail of every
--      hidden_billing_catalog mutation (create / update / enable / disable).
--      Immutable via the EXISTING raise_ledger_immutable trigger function.
--      Server-side only; written exclusively by the super-admin billing-
--      catalog endpoint. NO public access.
--
--  (B) billing_checkout_sessions — first-class persistence of normalized
--      checkout sessions. UNIQUE(idempotency_key) makes a repeated identical
--      checkout request a deterministic replay (return the persisted session,
--      no duplicate provider dispatch).
--
-- Carries NO pricing amounts on the checkout-session side; the audit
-- snapshots DO carry catalog rows (incl. amount_minor) but the table is
-- server-side / super-admin only — never publicly exposed.
--
-- SAFETY: purely additive, idempotent (IF NOT EXISTS), no historical
-- mutation, no changes to existing tables/RPCs/ledger. Append-only enforced
-- via the EXISTING raise_ledger_immutable() (migration 20260663). NOT applied
-- by this change — controlled migration process only.
-- =============================================================================

-- ── (A) hidden_billing_catalog_audit — append-only ──────────────────────────
CREATE TABLE IF NOT EXISTS public.hidden_billing_catalog_audit (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_key       text        NOT NULL,
  operation_type      text        NOT NULL
                                  CHECK (operation_type IN ('create','update','enable','disable')),
  -- NULL on create (no prior state). The full catalog row before the change.
  before_snapshot     jsonb,
  -- The full catalog row after the change. Always present.
  after_snapshot      jsonb       NOT NULL,
  changed_by_user_id  text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hbca_audit_ref
  ON public.hidden_billing_catalog_audit (reference_key, created_at DESC);

-- Append-only: reuse the existing immutability guard (no new trigger fn).
DROP TRIGGER IF EXISTS hbca_audit_immutable_update ON public.hidden_billing_catalog_audit;
CREATE TRIGGER hbca_audit_immutable_update
  BEFORE UPDATE ON public.hidden_billing_catalog_audit
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

DROP TRIGGER IF EXISTS hbca_audit_immutable_delete ON public.hidden_billing_catalog_audit;
CREATE TRIGGER hbca_audit_immutable_delete
  BEFORE DELETE ON public.hidden_billing_catalog_audit
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

COMMENT ON TABLE public.hidden_billing_catalog_audit IS
  'Append-only forensic trail of hidden_billing_catalog mutations. Server-side/super-admin only. Immutable (raise_ledger_immutable).';

-- ── (B) billing_checkout_sessions — persisted checkout sessions ─────────────
CREATE TABLE IF NOT EXISTS public.billing_checkout_sessions (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id            uuid        NOT NULL,
  provider                   text        NOT NULL,
  provider_reference         text,
  -- Deterministic replay anchor — a repeated identical request reuses this row.
  idempotency_key            text        NOT NULL UNIQUE,
  intent_type                text        NOT NULL CHECK (intent_type IN ('subscription','topup')),
  reference_key              text        NOT NULL,
  session_status             text        NOT NULL,
  redirect_url               text,
  currency                   text        NOT NULL,
  -- Round-trip fidelity (additive beyond the required field set) so a
  -- persisted session reconstructs the normalized contract byte-identically.
  provider_mode              text,
  expires_at                 timestamptz,
  supported_payment_methods  text[]      NOT NULL DEFAULT '{}'::text[],
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bcs_org
  ON public.billing_checkout_sessions (organization_id, created_at DESC);

COMMENT ON TABLE public.billing_checkout_sessions IS
  'Persisted normalized checkout sessions. UNIQUE(idempotency_key) = deterministic replay. NO pricing amount columns.';
