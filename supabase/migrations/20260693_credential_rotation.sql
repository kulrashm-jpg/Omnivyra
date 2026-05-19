-- =============================================================================
-- Credential rotation jobs + attempts (DESIGN ARTIFACT / OPTIONAL)
--
-- WHY: durable lineage for credential-rotation lifecycle. The shipped
-- credentialRotationService uses these tables WHEN PRESENT and otherwise falls
-- back to the append-only audit_events substrate — applying this is a pure
-- lineage/observability upgrade with NO behaviour change.
--
-- Rotation safety model (enforced in code, not schema):
--   - operator-approval gated; no silent destructive rotation
--   - OAuth rotation = real refresh (refreshConnectionToken); old token stays
--     valid until the new one is validated → reversible
--   - every transition is append-only audited (resource_type='credential_rotation')
--
-- SAFETY: purely additive, idempotent (IF NOT EXISTS), append-oriented, no
-- historical mutation, no backfill, no changes to existing tables. NOT applied
-- by this change — controlled migration process only.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.credential_rotation_jobs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL,
  connection_id uuid        NOT NULL,
  provider      text        NOT NULL,
  reason        text        NOT NULL,            -- expiring|degraded|operator|scheduled
  status        text        NOT NULL DEFAULT 'proposed', -- proposed|approved|rotating|rotated|failed|reverted
  requested_by  uuid,
  approved_by   uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cred_rotation_company
  ON public.credential_rotation_jobs (company_id, created_at DESC);

-- At most one in-flight rotation per connection (partial unique index — the
-- correct Postgres form for a conditional uniqueness constraint).
CREATE UNIQUE INDEX IF NOT EXISTS uq_cred_rotation_inflight
  ON public.credential_rotation_jobs (company_id, connection_id)
  WHERE status IN ('proposed','approved','rotating');

CREATE TABLE IF NOT EXISTS public.credential_rotation_attempts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      uuid        NOT NULL,
  company_id  uuid        NOT NULL,
  outcome     text        NOT NULL,             -- refreshed|failed|not_supported|reverted
  detail      text,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cred_rotation_attempts_job
  ON public.credential_rotation_attempts (job_id, attempted_at DESC);

ALTER TABLE public.credential_rotation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credential_rotation_attempts ENABLE ROW LEVEL SECURITY;
