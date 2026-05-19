-- =============================================================================
-- Raw replay payload capture + quarantine (DESIGN ARTIFACT / OPTIONAL)
--
-- WHY: durable capture of failed raw payloads so nothing is lost and replay is
-- idempotent. The shipped rawReplayCaptureService uses these tables WHEN
-- PRESENT and otherwise falls back to the append-only audit_events substrate
-- (size-bounded) — so applying this is a pure capacity/lineage upgrade with NO
-- regression to existing behaviour.
--
-- Idempotency model:
--   - replay_payloads.dedupe_key is UNIQUE per (company_id, source) → a
--     re-captured identical failure is a no-op (ON CONFLICT DO NOTHING),
--     guaranteeing replay never produces duplicate captures.
--   - replay execution dedupe is enforced separately in audit_events
--     (resource_type='replay_job', see replayOrchestrationService).
--
-- SAFETY: purely additive, idempotent (IF NOT EXISTS), append-oriented, no
-- historical mutation, no backfill, no changes to existing tables. NOT applied
-- by this change — controlled migration process only.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.replay_payloads (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL,
  source      text        NOT NULL,            -- ingestion|webhook|publish|reconciliation|attribution
  target      text        NOT NULL,            -- replay target kind
  dedupe_key  text        NOT NULL,
  payload     jsonb       NOT NULL,
  error       text,
  status      text        NOT NULL DEFAULT 'pending', -- pending|replayed|failed|quarantined
  attempts    int         NOT NULL DEFAULT 0,
  captured_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  UNIQUE (company_id, source, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_replay_payloads_company_status
  ON public.replay_payloads (company_id, status, captured_at DESC);

CREATE TABLE IF NOT EXISTS public.quarantine_payloads (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid        NOT NULL,
  source      text        NOT NULL,
  reason      text        NOT NULL,            -- malformed|schema_invalid|untrusted
  raw         text        NOT NULL,            -- raw (unparsed) body, never executed
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quarantine_company_captured
  ON public.quarantine_payloads (company_id, captured_at DESC);

ALTER TABLE public.replay_payloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quarantine_payloads ENABLE ROW LEVEL SECURITY;
