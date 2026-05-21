-- =============================================================================
-- hidden_billing_catalog — HIDDEN, operator-managed pricing source
--
-- Replaces the module-private pricing constant in billingAmountResolver with a
-- DB-backed source. STRICTLY internal:
--   - NO public exposure, NO frontend access, NO public catalog API.
--   - NOT a pricing page, NOT a plan-discovery surface.
--   - Read ONLY server-side by billingAmountResolver.resolveBillingAmount().
--   - Future super-admin (operator) management plugs in via this table; no
--     public management surface.
--
-- amount_minor is the smallest currency unit (paise for INR, cents for USD).
-- The resolver converts minor→major for the provider request.
--
-- The seed mirrors billingAmountResolver's COMPILED_FALLBACK exactly, so the
-- resolver is default-preserving: when this table is absent (migration
-- unapplied) it falls back to the compiled values and behavior is identical.
--
-- SAFETY: purely additive, idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING),
-- no historical mutation, no changes to existing tables/RPCs/ledger. NOT
-- applied by this change — controlled migration process only.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.hidden_billing_catalog (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable identifier referenced by checkout (plan_*/topup_*). UNIQUE.
  reference_key   text        NOT NULL UNIQUE,
  kind            text        NOT NULL CHECK (kind IN ('subscription','topup')),
  -- Smallest currency unit (e.g. 49900 = ₹499.00).
  amount_minor    bigint      NOT NULL CHECK (amount_minor >= 0),
  currency        text        NOT NULL,
  -- A retired entry stays for historical resolution but is rejected for new checkouts.
  enabled         boolean     NOT NULL DEFAULT true,
  -- Operator-facing label — internal only, never returned by the resolver.
  internal_label  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hidden_billing_catalog_lookup
  ON public.hidden_billing_catalog (reference_key, enabled);

COMMENT ON TABLE public.hidden_billing_catalog IS
  'HIDDEN operator-managed pricing source. Server-side ONLY — read by billingAmountResolver. NOT a public catalog, NOT a pricing page. amount_minor = smallest currency unit.';

-- ── Seed: mirrors billingAmountResolver COMPILED_FALLBACK exactly ───────────
-- India-first (INR). Two entries are seeded enabled=false (retired) so the
-- disabled-rejection path is exercised against real data.
INSERT INTO public.hidden_billing_catalog
  (reference_key, kind, amount_minor, currency, enabled, internal_label)
VALUES
  ('plan_starter_monthly', 'subscription', 49900,  'INR', true,  'Starter (monthly)'),
  ('plan_pro_monthly',     'subscription', 199900, 'INR', true,  'Pro (monthly)'),
  ('plan_legacy_v1',       'subscription', 99900,  'INR', false, 'Legacy v1 (retired)'),
  ('topup_credits_500',    'topup',        50000,  'INR', true,  'Top-up 500 credits'),
  ('topup_credits_2000',   'topup',        180000, 'INR', true,  'Top-up 2000 credits'),
  ('topup_legacy_pack',    'topup',        70000,  'INR', false, 'Legacy top-up pack (retired)')
ON CONFLICT (reference_key) DO NOTHING;
