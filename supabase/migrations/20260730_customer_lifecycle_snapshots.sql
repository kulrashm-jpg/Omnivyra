-- =============================================================================
-- CSA-004 — Canonical Customer Lifecycle Engine (daily lifecycle time-series)
--
-- The ONE daily snapshot of the canonical Customer Lifecycle per company:
-- lifecycle stage, the transition from the prior stage, and the deterministic
-- signals behind it. Derived (never recomputed) from the existing authorities —
-- CSA-003 health, CSA-002 evolution, CSA-001 usage, readiness, Platform Ready.
--
-- Reuses the CSA daily snapshot CADENCE (the same scheduler), mirroring the
-- customer_health_snapshots shape/idempotency contract. Additive + isolated:
-- new table, no alters to existing tables, no FK, reversible by DROP TABLE.
--
-- Idempotency (§7): one snapshot per company per UTC day
-- (UNIQUE company_id + snapshot_date) → ON CONFLICT DO NOTHING; rerun inserts 0.
-- `stage_since` carries the transition timestamp forward across unchanged days,
-- so a rerun never fabricates a new transition.
--
-- NOT applied by this change — controlled migration process only.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.customer_lifecycle_snapshots (
  snapshot_id       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        text        NOT NULL,
  taken_at          timestamptz NOT NULL DEFAULT now(),
  snapshot_date     date        NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,

  lifecycle_stage   text        NOT NULL,   -- ONBOARDING|ACTIVATED|ADOPTING|GROWING|MATURE|DECLINING|DORMANT
  previous_stage    text,
  transition_changed boolean    NOT NULL DEFAULT false,
  transition_direction text     NOT NULL DEFAULT 'INITIAL', -- PROMOTION|REGRESSION|INITIAL|NONE
  transition_reason text        NOT NULL,
  stage_since       timestamptz NOT NULL,   -- when the current stage was entered
  trajectory        text        NOT NULL DEFAULT 'UNKNOWN',

  -- Reused (not recomputed) inputs, denormalized for fast reads.
  health_score      integer     NOT NULL DEFAULT 0,
  health_state      text        NOT NULL DEFAULT 'UNKNOWN',

  -- Deterministic explanation payload.
  signals           jsonb,

  snapshot_version  text        NOT NULL DEFAULT 'lifecycle-snapshot-v1'
);

-- §7 — one snapshot per company per day: the dedup anchor for the daily job.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cls_company_day
  ON public.customer_lifecycle_snapshots (company_id, snapshot_date);

-- §6 — "latest lifecycle per company" + history reads for CS consumers.
CREATE INDEX IF NOT EXISTS idx_cls_company_taken
  ON public.customer_lifecycle_snapshots (company_id, taken_at DESC);

-- Portfolio distribution scans by stage on a given day.
CREATE INDEX IF NOT EXISTS idx_cls_stage_day
  ON public.customer_lifecycle_snapshots (snapshot_date, lifecycle_stage);

-- Transition-count scans (only rows where the stage actually changed).
CREATE INDEX IF NOT EXISTS idx_cls_transitions
  ON public.customer_lifecycle_snapshots (snapshot_date, transition_direction)
  WHERE transition_changed = true;
