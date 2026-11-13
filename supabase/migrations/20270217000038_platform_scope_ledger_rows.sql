-- 20270217000038 - platform-scope rows in usage_events (6f; version from 83; e9 ruling P1; ledger owner e1 signed off).
--
-- WHY. Platform AI / provider spend (no customer company) has two broken paths today:
--   - the DOCUMENTED path (blackHoleCostCapture.capturePlatformProviderCost -> logUsageEvent with organization_id NULL,
--     read by economicAccountingService.fetchPlatformGlobalUsageRows) has NEVER written: usage_events.organization_id
--     is NOT NULL, so every insert fails 23502 (proven on the CI-faithful replay; prod NOT NULL confirmed, C55);
--   - the UNDOCUMENTED path writes it under a FAKE tenant, UNKNOWN_ORG '00000000-0000-0000-0000-000000000000'
--     (prod C55: usage_events 688 of 2,845 rows; unified_transactions 467 of 69,868).
--
-- WHAT (schema only; NO data write - programme rule):
--   usage_events.organization_id becomes NULLABLE, and a NULL is allowed ONLY for an explicitly marked platform row:
--     CHECK (organization_id IS NOT NULL OR COALESCE(metadata->>'billing_scope', '') = 'platform')
--   The COALESCE is load-bearing: usage_events.metadata is NULLABLE, and without it a row with NULL org AND NULL
--   metadata makes the CHECK evaluate to NULL - and a CHECK PASSES on NULL - so an unmarked NULL org would slip in.
--   unified_transactions is NOT touched (P1): platform rows live in usage_events only, so economicAccounting's
--   platform read and its unified read stay disjoint (no double count).
--
-- DEPLOY ORDER (e9 / e1): this migration -> the app (logUsageEvent maps the sentinel to NULL + billing_scope
--   'platform'; economicAccounting's platform read widens to every NULL-org row) -> D-step (a) usage_events sentinel
--   rows -> NULL + platform -> D-step (b) the unified_transactions sentinel duplicates (backed up, twin-proven).
--   The app MUST NOT precede this migration: its NULL-org inserts would fail the NOT NULL.
--
-- usage_events / unified_transactions carry "CORE LEDGER - DO NOT ALTER WITHOUT REVIEW" (20260520): reviewed by
--   virality-05, ledger owner virality-e1 signed off (2026-11-13).
--
-- ROLLBACK: rollbacks/platform_scope_ledger_rows_rollback.sql - refuses while any NULL-org row exists (NOT NULL
--   cannot be restored over platform rows; re-attribute them first).

DO $preflight$
DECLARE
  v_def text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.usage_events'::regclass AND attname = 'organization_id' AND NOT attisdropped) THEN
    RAISE EXCEPTION '038 preflight: usage_events.organization_id is missing';
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.usage_events'::regclass AND conname = 'usage_events_org_or_platform_scope';
  IF v_def IS NOT NULL AND v_def NOT LIKE '%COALESCE((metadata ->> ''billing_scope''::text), ''''::text) = ''platform''::text%' THEN
    RAISE EXCEPTION '038 preflight: usage_events_org_or_platform_scope exists with another definition (%) - refusing to adopt it', v_def;
  END IF;
END
$preflight$;

ALTER TABLE public.usage_events ALTER COLUMN organization_id DROP NOT NULL;

DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.usage_events'::regclass AND conname = 'usage_events_org_or_platform_scope') THEN
    ALTER TABLE public.usage_events ADD CONSTRAINT usage_events_org_or_platform_scope
      CHECK (organization_id IS NOT NULL OR COALESCE(metadata->>'billing_scope', '') = 'platform');
  END IF;
END
$check$;

-- company_financial_reconciliation (20260712) is PER-COMPANY, but its usage_events CTE had no NULL filter: once
-- platform rows exist they would surface as a company with no id. Same query, one added filter (platform spend is
-- read by economicAccountingService's platform path instead). CREATE OR REPLACE keeps the owner and the grants
-- (owner-rights view, client roles revoked by 20261026000000) - measured in $verify$.
CREATE OR REPLACE VIEW public.company_financial_reconciliation AS
WITH credits_consumed AS (
  SELECT
    organization_id,
    date_trunc('day', created_at)               AS period_day,
    SUM(CASE WHEN execution_phase = 'confirm' THEN credits_delta ELSE 0 END)::numeric AS credits_confirmed,
    SUM(CASE WHEN execution_phase = 'release' THEN credits_delta ELSE 0 END)::numeric AS credits_released
  FROM public.credit_transactions
  GROUP BY organization_id, date_trunc('day', created_at)
),
provider_cost_estimated AS (
  SELECT
    organization_id,
    date_trunc('day', created_at)               AS period_day,
    SUM(COALESCE(total_cost_usd, 0))::numeric   AS provider_usd_estimated,
    COUNT(*)::int                                AS usage_event_count
  FROM public.usage_events
  WHERE organization_id IS NOT NULL   -- 038: platform-scope rows (NULL org) are not a company
  GROUP BY organization_id, date_trunc('day', created_at)
),
adjustments AS (
  SELECT
    organization_id,
    date_trunc('day', created_at)               AS period_day,
    SUM(adjustment_usd)::numeric                AS adjustment_usd_sum,
    COUNT(*)::int                                AS adjustment_count
  FROM public.cost_reconciliation_adjustments
  WHERE organization_id IS NOT NULL
  GROUP BY organization_id, date_trunc('day', created_at)
)
SELECT
  COALESCE(c.organization_id, p.organization_id, a.organization_id) AS organization_id,
  COALESCE(c.period_day,      p.period_day,      a.period_day)      AS period_day,
  COALESCE(c.credits_confirmed,      0) AS credits_confirmed,
  COALESCE(c.credits_released,       0) AS credits_released,
  COALESCE(p.provider_usd_estimated, 0) AS provider_usd_estimated,
  COALESCE(p.usage_event_count,      0) AS usage_event_count,
  COALESCE(a.adjustment_usd_sum,     0) AS adjustment_usd_sum,
  COALESCE(a.adjustment_count,       0) AS adjustment_count,
  -- Effective (reconciled-or-estimated) provider USD per company-day.
  COALESCE(p.provider_usd_estimated, 0) + COALESCE(a.adjustment_usd_sum, 0)
                                        AS provider_usd_effective
FROM credits_consumed       c
FULL OUTER JOIN provider_cost_estimated p
  ON p.organization_id = c.organization_id AND p.period_day = c.period_day
FULL OUTER JOIN adjustments a
  ON a.organization_id = COALESCE(c.organization_id, p.organization_id)
 AND a.period_day      = COALESCE(c.period_day,      p.period_day);

-- Owner-rights view (20261026000000 owner_rights_views): it stays closed to the client roles - stated HERE, not
-- inherited, so this migration is safe on its own (rule #26 / migration-quality).
REVOKE ALL ON public.company_financial_reconciliation FROM anon, authenticated;

COMMENT ON COLUMN public.usage_events.organization_id IS
  'The customer company the usage is billed to. NULL ONLY for platform-scope spend, which must carry metadata.billing_scope = ''platform'' (CHECK usage_events_org_or_platform_scope, 20270217000038).';

DO $verify$
DECLARE
  v_notnull boolean;
  v_def text;
  v_valid boolean;
BEGIN
  SELECT attnotnull INTO v_notnull FROM pg_attribute WHERE attrelid = 'public.usage_events'::regclass AND attname = 'organization_id';
  IF v_notnull THEN RAISE EXCEPTION '038 postcondition: usage_events.organization_id must be NULLABLE'; END IF;
  SELECT pg_get_constraintdef(oid), convalidated INTO v_def, v_valid FROM pg_constraint
   WHERE conrelid = 'public.usage_events'::regclass AND conname = 'usage_events_org_or_platform_scope';
  IF v_def IS NULL OR v_def NOT LIKE '%organization_id IS NOT NULL%' OR v_def NOT LIKE '%COALESCE((metadata ->> ''billing_scope''::text), ''''::text) = ''platform''::text%' THEN
    RAISE EXCEPTION '038 postcondition: the platform-scope CHECK is missing or different: %', coalesce(v_def, '<none>');
  END IF;
  IF NOT v_valid THEN RAISE EXCEPTION '038 postcondition: the platform-scope CHECK must be VALIDATED'; END IF;
  -- The company view excludes platform rows, and its exposure did not change.
  IF position('WHERE (usage_events.organization_id IS NOT NULL)' IN pg_get_viewdef('public.company_financial_reconciliation'::regclass)) = 0 THEN
    RAISE EXCEPTION '038 postcondition: company_financial_reconciliation must exclude NULL-org (platform) usage_events rows';
  END IF;
  IF has_table_privilege('anon', 'public.company_financial_reconciliation', 'SELECT')
     OR has_table_privilege('authenticated', 'public.company_financial_reconciliation', 'SELECT') THEN
    RAISE EXCEPTION '038 postcondition: company_financial_reconciliation must stay closed to anon / authenticated';
  END IF;
  -- unified_transactions is deliberately untouched (P1).
  IF NOT (SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.unified_transactions'::regclass AND attname = 'organization_id') THEN
    RAISE EXCEPTION '038 postcondition: unified_transactions.organization_id must stay NOT NULL (platform rows live in usage_events only)';
  END IF;
END
$verify$;
