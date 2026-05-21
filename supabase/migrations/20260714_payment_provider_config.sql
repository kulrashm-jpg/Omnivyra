-- =============================================================================
-- Payment-provider governance layer (config ONLY, additive)
--
-- Homes per-provider operational governance — enablement, checkout
-- visibility, supported geography/currency/methods, maintenance mode,
-- sandbox/live metadata — into a deterministic DB surface, mirroring the
-- proven billing_policy_config / action_pricing_config pattern.
--
-- This migration governs PROVIDER ORCHESTRATION ONLY. It does NOT touch:
--   - the credit ledger / wallet / organization_credits
--   - HOLD/CONFIRM/RELEASE settlement RPCs
--   - reconciliation tables/logic
--   - pricing (no plan prices, no public pricing exposure — pricing remains
--     hidden; this table carries NO price columns by design)
--
-- RESOLUTION: the single read path is paymentProviderPolicyResolver.ts. When
-- this table is absent (migration unapplied) OR empty, the resolver returns
-- compiled-in defaults that match the seed below — byte-identical behavior.
--
-- SAFETY: purely additive, idempotent (IF NOT EXISTS), no historical
-- mutation, no changes to existing tables/RPCs. NOT applied by this change —
-- controlled migration process only.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.payment_provider_config (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Provider tag — must match a SupportedProvider in paymentProviderAdapter.
  provider                   text        NOT NULL UNIQUE,
  -- Master switch: provider can be dispatched at all.
  enabled                    boolean     NOT NULL DEFAULT false,
  -- Whether the provider is offered as a checkout option to customers.
  visible_in_checkout        boolean     NOT NULL DEFAULT false,
  subscriptions_enabled      boolean     NOT NULL DEFAULT false,
  topups_enabled             boolean     NOT NULL DEFAULT false,
  -- ISO-3166-1 alpha-2 country codes. Empty array = no geography restriction.
  supported_countries        text[]      NOT NULL DEFAULT '{}'::text[],
  -- ISO-4217 currency codes. Empty array = no currency restriction.
  supported_currencies       text[]      NOT NULL DEFAULT '{}'::text[],
  -- Free-form method tags (card | upi | netbanking | wallet | ach | sepa ...).
  supported_payment_methods  text[]      NOT NULL DEFAULT '{}'::text[],
  -- Lower number = higher precedence in the resolved checkout ordering.
  priority                   integer     NOT NULL DEFAULT 100,
  -- Temporary operational disable without losing config.
  maintenance_mode           boolean     NOT NULL DEFAULT false,
  -- TRUE = provider runs against test/sandbox credentials.
  sandbox_mode               boolean     NOT NULL DEFAULT true,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ppc_enabled_visible
  ON public.payment_provider_config (enabled, visible_in_checkout, priority);

COMMENT ON TABLE public.payment_provider_config IS
  'Per-provider orchestration governance (enablement, checkout visibility, geography/currency/method support, maintenance/sandbox). NO pricing columns. Resolved exclusively via paymentProviderPolicyResolver.ts.';

-- ── Seed: reflects CURRENT runtime reality (idempotent) ─────────────────────
-- razorpay — staging/test integration is live for top-ups; sandbox-only.
-- stripe   — webhook ingestion only; checkout NOT implemented → disabled.
-- The compiled defaults in paymentProviderPolicyResolver.ts mirror these rows
-- exactly, so resolver behavior is identical whether or not this seed ran.
INSERT INTO public.payment_provider_config
  (provider, enabled, visible_in_checkout, subscriptions_enabled, topups_enabled,
   supported_countries, supported_currencies, supported_payment_methods,
   priority, maintenance_mode, sandbox_mode)
VALUES
  ('razorpay', true,  true,  false, true,
   ARRAY['IN']::text[], ARRAY['INR','USD']::text[], ARRAY['card','upi','netbanking']::text[],
   10, false, true),
  ('stripe',   false, false, false, false,
   ARRAY[]::text[], ARRAY['USD','EUR','GBP']::text[], ARRAY['card']::text[],
   20, false, true)
ON CONFLICT (provider) DO NOTHING;
