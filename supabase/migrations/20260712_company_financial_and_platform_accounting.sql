-- =============================================================================
-- Company-level financial reconciliation view + super-admin platform-cost
-- accounting FOUNDATION (placeholders only — no allocation logic yet).
--
-- Two additive deliverables in one migration (both read-side, no behavior
-- change; existing readers unaffected):
--
--  (A) company_financial_reconciliation VIEW — deterministic per-company,
--      per-period aggregation that joins ONLY existing tables; no new
--      ledger surface. Read-only.
--
--  (B) platform_cost_categories + platform_cost_allocations — extensible
--      foundation tables for future infra-cost attribution. NO logic, NO
--      seed data, NO computed allocations. Hooks/placeholders only, as
--      explicitly requested ("no fake allocations / no speculative cost
--      distribution / additive accounting only").
--
-- SAFETY: purely additive, idempotent, no historical mutation, no changes
-- to existing tables/RPCs. Append-only on the allocations side via the
-- existing raise_ledger_immutable trigger. NOT applied — controlled process.
-- =============================================================================

-- ── (A) Company financial reconciliation view ───────────────────────────────
-- Deterministic aggregation: org → credits consumed → provider USD (est.)
-- → reconciliation adjustments (when present). Only joins what already
-- exists; nothing speculative.
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

COMMENT ON VIEW public.company_financial_reconciliation IS
  'Per-company per-day aggregation joining credit settlement, estimated provider USD, and reconciliation adjustments. Read-only; deterministic; no historical mutation. Adjustments apply forward via cost_reconciliation_adjustments; the credit ledger is never mutated.';


-- ── (B) Platform-cost accounting foundation (PLACEHOLDERS ONLY) ─────────────
-- Extensible structure so future infra-cost surfaces (compute / DB / queue /
-- storage / CDN / inference infra) can be attributed deterministically.
-- NO seed data, NO logic, NO speculative allocations. This migration provides
-- the SHAPES; future tasks wire real sources.

CREATE TABLE IF NOT EXISTS public.platform_cost_categories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key          text        NOT NULL UNIQUE,        -- e.g. 'compute' | 'database' | 'queue' | 'storage' | 'cdn' | 'inference_infra'
  display_name text        NOT NULL,
  description  text        NOT NULL DEFAULT '',
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Append-only allocation rows. Allocation METHODS (the actual cost-
-- distribution logic) are intentionally NOT implemented here.
CREATE TABLE IF NOT EXISTS public.platform_cost_allocations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id     uuid        NOT NULL REFERENCES public.platform_cost_categories(id) ON DELETE RESTRICT,
  period_start    timestamptz NOT NULL,
  period_end      timestamptz NOT NULL,
  total_usd       numeric(20,10) NOT NULL,
  -- Optional org attribution; NULL means platform-level (unallocated to a
  -- single org). Future allocation hooks will populate per-org rows.
  organization_id uuid,
  -- Free-form "method_key" lets future allocators identify their algorithm
  -- without schema change (e.g. 'flat'|'usage_share'|'storage_share'|...).
  method_key      text        NOT NULL DEFAULT 'unallocated',
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pca_period
  ON public.platform_cost_allocations (period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_pca_org
  ON public.platform_cost_allocations (organization_id, period_start)
  WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pca_category
  ON public.platform_cost_allocations (category_id, period_start);

-- Allocations are append-only (compensating entries only, never mutate).
DROP TRIGGER IF EXISTS pca_immutable_update ON public.platform_cost_allocations;
CREATE TRIGGER pca_immutable_update
  BEFORE UPDATE ON public.platform_cost_allocations
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

DROP TRIGGER IF EXISTS pca_immutable_delete ON public.platform_cost_allocations;
CREATE TRIGGER pca_immutable_delete
  BEFORE DELETE ON public.platform_cost_allocations
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();
