-- =============================================================================
-- CSA-003 — Canonical Customer Health Engine (daily health time-series)
--
-- The ONE daily snapshot of the canonical Customer Health model per company:
-- composite score, health state, risk level, and the deterministic contributor
-- breakdown. Derived (never recomputed) from the existing authorities —
-- readiness, evolution, usage (CSA-001), integration coverage, Platform Ready.
--
-- Reuses the CSA-002 daily snapshot CADENCE (the same scheduler), and mirrors
-- the customer_readiness_snapshots shape/idempotency contract. Additive +
-- isolated: new table, no alters to existing tables, no FK, reversible by
-- DROP TABLE.
--
-- Idempotency (§7): one snapshot per company per UTC day
-- (UNIQUE company_id + snapshot_date) → ON CONFLICT DO NOTHING; rerun inserts 0.
--
-- NOT applied by this change — controlled migration process only.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.customer_health_snapshots (
  snapshot_id      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       text        NOT NULL,
  taken_at         timestamptz NOT NULL DEFAULT now(),
  snapshot_date    date        NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,

  health_score     integer     NOT NULL,
  health_state     text        NOT NULL,   -- EXCELLENT|HEALTHY|STABLE|NEEDS_ATTENTION|AT_RISK|INACTIVE
  risk_level       text        NOT NULL,   -- NONE|LOW|MEDIUM|HIGH|CRITICAL

  -- Reused (not recomputed) inputs, denormalized for fast history reads.
  readiness_score  integer     NOT NULL DEFAULT 0,
  trajectory       text        NOT NULL DEFAULT 'UNKNOWN',
  inactive_days    integer,

  -- Deterministic explanation payload (contributors + risk reasons + copy).
  contributors     jsonb,
  risk_reasons     jsonb,

  snapshot_version text        NOT NULL DEFAULT 'health-snapshot-v1'
);

-- §7 — one snapshot per company per day: the dedup anchor for the daily job.
CREATE UNIQUE INDEX IF NOT EXISTS idx_chs_company_day
  ON public.customer_health_snapshots (company_id, snapshot_date);

-- §6 — "latest health per company" + history reads for CS consumers.
CREATE INDEX IF NOT EXISTS idx_chs_company_taken
  ON public.customer_health_snapshots (company_id, taken_at DESC);

-- Portfolio distribution scans by state / risk on a given day.
CREATE INDEX IF NOT EXISTS idx_chs_state_day
  ON public.customer_health_snapshots (snapshot_date, health_state);
CREATE INDEX IF NOT EXISTS idx_chs_risk_day
  ON public.customer_health_snapshots (snapshot_date, risk_level);
