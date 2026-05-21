-- =============================================================================
-- Lightweight billing-context capture (additive)
--
-- Captures the MINIMUM geography needed to resolve payment-provider
-- eligibility — billing_country / billing_currency / billing_region — WITHOUT
-- requiring a full company billing profile.
--
-- WHY a separate table (not company_billing_profiles):
--   company_billing_profiles is the FULL profile — it requires billing_email
--   (NOT NULL), billing_name, billing_address, tax_id, etc. Provider
--   eligibility must NOT depend on completing all of that. billing_context is
--   the lightweight, eligibility-only surface: an org can have geography
--   captured during onboarding long before it has a full billing profile.
--
-- NOT a duplicate identity model: this table carries NO identity fields
-- (no email, name, address, tax id). It is geography ONLY. The resolver
-- (orgBillingContextResolver) reads billing_context FIRST, then falls back to
-- company_billing_profiles, then to a conservative no-geography default.
--
-- NO pricing columns. Does not touch ledger/wallet/HOLD/reconciliation.
--
-- SAFETY: purely additive, idempotent (IF NOT EXISTS), no historical
-- mutation, no changes to existing tables/RPCs. NOT applied by this change —
-- controlled migration process only.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.billing_context (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL UNIQUE,
  -- ISO-3166-1 alpha-2 (e.g. 'IN', 'US'); nullable until captured.
  billing_country   text,
  -- ISO-4217 (e.g. 'INR', 'USD'); nullable until captured.
  billing_currency  text,
  -- Free-form sub-national region (state/province); optional.
  billing_region    text,
  -- How the context was acquired — provenance only, not behavior-bearing.
  source            text        NOT NULL DEFAULT 'onboarding'
                                  CHECK (source IN ('onboarding','billing_shell','operator','import')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_context_org
  ON public.billing_context (organization_id);

COMMENT ON TABLE public.billing_context IS
  'Lightweight, eligibility-only billing geography (country/currency/region). Captured independently of the full company_billing_profiles. NO identity fields, NO pricing. Resolved via orgBillingContextResolver.';
