-- =============================================================================
-- payment_provider_config — additive seed for cashfree + phonepe
--
-- Registers two additional payment providers into the existing governance
-- table (created by 20260714). PURELY ADDITIVE — INSERT-only, idempotent via
-- ON CONFLICT DO NOTHING. Does NOT alter the table, the existing rows, or any
-- other object.
--
-- Both providers are seeded HIDDEN + DISABLED by default (enabled=false,
-- visible_in_checkout=false) and sandbox_mode=true. They are inert until an
-- operator explicitly enables them via the super-admin governance surface —
-- so applying this migration is behavior-neutral.
--
-- The seeded rows mirror COMPILED_DEFAULT_PROVIDERS in
-- paymentProviderPolicyResolver.ts exactly (parity-guarded by
-- paymentProviderConfigParity.test.ts). NO pricing data.
--
-- SAFETY: additive, idempotent, no historical mutation, no changes to
-- existing tables/RPCs. NOT applied by this change — controlled process only.
-- =============================================================================

INSERT INTO public.payment_provider_config
  (provider, enabled, visible_in_checkout, subscriptions_enabled, topups_enabled,
   supported_countries, supported_currencies, supported_payment_methods,
   priority, maintenance_mode, sandbox_mode)
VALUES
  ('cashfree', false, false, false, true,
   ARRAY['IN']::text[], ARRAY['INR']::text[], ARRAY['card','upi','netbanking']::text[],
   30, false, true),
  ('phonepe',  false, false, false, true,
   ARRAY['IN']::text[], ARRAY['INR']::text[], ARRAY['upi','card']::text[],
   40, false, true)
ON CONFLICT (provider) DO NOTHING;
