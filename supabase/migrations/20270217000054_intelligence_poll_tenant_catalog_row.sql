-- 20270217000054 - intelligence_poll_tenant catalog row (e1; e9 + OWNER ruling 2026-11-14; version from virality-83;
-- review: virality-05). UNDER THE PRICING HOLD: ships with the pricing release, not before.
--
-- THE RULING. Tenant-owned intelligence sources are checked ONCE A DAY; each check of one source for one company is
-- priced at a FIXED 1 credit per source per day. Basis (e9): 15x the REAL provider cost of the poll with a floor of
-- 1 credit; the poll makes no AI call (55's code trace) and an own-key source carries no platform vendor fee, so the
-- price is the floor. A scheduled poll is held then settled (idempotency key = the poll job id).
--
-- WHY credit_cost_config AND NOT action_pricing_config (deviation from the registry note, reported to 83/e9):
--   * The fixed charge is READ from credit_cost_config: getCreditCost (creditDeductionService.ts:144) and
--     fetchFlatCreditCost (pricingService.ts) both select credit_cost_config.credits by action_type.
--   * resolveActivityCreditRange (pricingService.ts) treats ANY active action_pricing_config row as TOKEN-PRICED (it does
--     not read source_type) and converts minimum_charge_usd at the org's credit_rate_usd - so a 'fixed' row there would
--     make the preview show a different number (e.g. 7 credits at a 0.001 rate) from the 1 credit actually charged.
--     The postcondition below therefore also asserts that NO active action_pricing_config row exists for this key.
--   * credits is an integer count of credits: independent of credit_rate_usd, so the rate equalisation cannot move it.
--   * EXPECTED CONSEQUENCE (05): the key is deliberately credit_cost_config-ONLY, so it is ABSENT from
--     public.v_pricing_catalog (that view enumerates action_pricing_config keys: FROM action_pricing_config apc LEFT JOIN
--     credit_cost_config ccc). Do NOT "fix" its absence by adding an apc row - the postcondition forbids exactly that;
--     the fix, if the view must list it, is the view (or resolveActivityCreditRange reading source_type), not the row.
--
-- SAFETY: one INSERT ... ON CONFLICT (action_type) DO NOTHING; no DDL, no GRANT (existing table, posture unchanged).
-- An existing row with the SAME values is accepted (re-run); an existing row with DIFFERENT values fails the
-- postcondition rather than being silently kept. Rollback: supabase/migrations/rollbacks/intelligence_poll_tenant_catalog_row_rollback.sql
-- deletes exactly the row this migration wrote (matched on its description marker).

INSERT INTO public.credit_cost_config (action_type, credits, category, description, smart_dedup_seconds, activity_class)
VALUES ('intelligence_poll_tenant', 1, 'low',
        'Tenant-owned source check, per source per day (20270217000054)', 0, 'INTELLIGENCE_SCAN')
ON CONFLICT (action_type) DO NOTHING;

DO $m054_post$
BEGIN
  IF (SELECT count(*) FROM public.credit_cost_config
       WHERE action_type = 'intelligence_poll_tenant' AND credits = 1 AND category = 'low'
         AND smart_dedup_seconds = 0 AND activity_class = 'INTELLIGENCE_SCAN'
         AND description = 'Tenant-owned source check, per source per day (20270217000054)') <> 1 THEN
    RAISE EXCEPTION '054 postcondition: credit_cost_config intelligence_poll_tenant is not exactly the ruled row (1 credit, low, INTELLIGENCE_SCAN)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.action_pricing_config WHERE action_key = 'intelligence_poll_tenant' AND is_active) THEN
    RAISE EXCEPTION '054 postcondition: an active action_pricing_config row for intelligence_poll_tenant would make the cost preview token-priced';
  END IF;
END
$m054_post$;
