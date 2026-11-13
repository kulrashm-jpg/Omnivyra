-- Rollback of 20270217000038_platform_scope_ledger_rows.sql (6f).
-- Restores usage_events.organization_id NOT NULL and drops the platform-scope CHECK. REFUSES while any NULL-org
-- (platform) row exists: NOT NULL cannot be restored over them, and they must never be silently re-attributed to a
-- fake tenant. Roll the app back first (so no new platform rows are written), then decide those rows explicitly.

DO $preflight$
DECLARE
  v_n bigint;
BEGIN
  SELECT count(*) INTO v_n FROM public.usage_events WHERE organization_id IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION '038 rollback: % platform-scope row(s) have organization_id NULL - NOT NULL cannot be restored over them; re-attribute them explicitly first', v_n;
  END IF;
END
$preflight$;

-- Restore company_financial_reconciliation exactly as 20260712 created it (038 only added the NULL-org filter).
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

REVOKE ALL ON public.company_financial_reconciliation FROM anon, authenticated;

ALTER TABLE public.usage_events DROP CONSTRAINT IF EXISTS usage_events_org_or_platform_scope;
ALTER TABLE public.usage_events ALTER COLUMN organization_id SET NOT NULL;
COMMENT ON COLUMN public.usage_events.organization_id IS NULL;

DO $verify$
BEGIN
  IF NOT (SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.usage_events'::regclass AND attname = 'organization_id') THEN
    RAISE EXCEPTION '038 rollback postcondition: usage_events.organization_id must be NOT NULL again';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.usage_events'::regclass AND conname = 'usage_events_org_or_platform_scope') THEN
    RAISE EXCEPTION '038 rollback postcondition: the platform-scope CHECK remains';
  END IF;
  IF position('WHERE (usage_events.organization_id IS NOT NULL)' IN pg_get_viewdef('public.company_financial_reconciliation'::regclass)) > 0 THEN
    RAISE EXCEPTION '038 rollback postcondition: company_financial_reconciliation still carries the 038 filter';
  END IF;
END
$verify$;
