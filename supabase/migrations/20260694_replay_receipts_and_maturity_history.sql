-- =============================================================================
-- Replay receipts + maturity history (DESIGN ARTIFACT / OPTIONAL)
--
-- WHY:
--  - replay_lead_receipts: a PROVABLY-idempotent, ISOLATED replay sink. The
--    UNIQUE (company_id, dedupe_key) makes lead/webhook replay exactly-once by
--    DB invariant WITHOUT touching the public `leads` table (no duplicate lead
--    creation, no ingestion refactor). It is a verified receipt + lineage
--    anchor + export source — NOT a reconstruction of the lead row.
--  - maturity_snapshots / operational_trends: append-only operational maturity
--    history for trend/drift reporting (low write amplification — written on
--    explicit capture, not per request).
--
-- Shipped services use these tables WHEN PRESENT and fall back to the append-
-- only audit_events substrate otherwise → applying this is a pure
-- capacity/observability upgrade with NO behaviour change, NO regression.
--
-- SAFETY: purely additive, idempotent (IF NOT EXISTS), append-only, no
-- historical mutation, no backfill, no changes to existing tables. NOT applied
-- by this change — controlled migration process only.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.replay_lead_receipts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL,
  source      text        NOT NULL,            -- webhook|lead|attribution
  dedupe_key  text        NOT NULL,
  replay_origin text,
  verified    boolean     NOT NULL DEFAULT true,
  detail      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, dedupe_key)             -- provable exactly-once
);

CREATE INDEX IF NOT EXISTS idx_replay_receipts_company
  ON public.replay_lead_receipts (company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.maturity_snapshots (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL,
  maturity_score int      NOT NULL,
  grades      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  signals     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_maturity_snapshots_company
  ON public.maturity_snapshots (company_id, captured_at DESC);

ALTER TABLE public.replay_lead_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maturity_snapshots ENABLE ROW LEVEL SECURITY;
