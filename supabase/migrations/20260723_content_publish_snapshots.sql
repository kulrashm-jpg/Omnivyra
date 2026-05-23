-- Universal Publishing Orchestration — Publish Snapshot Persistence
--
-- Additive only. Stores immutable publish snapshots + publishing contracts so
-- future Schedule/Publish/Draft/Retry/Reconcile/Rollback all operate from a
-- frozen persisted snapshot instead of a live mutable draft.
--
-- No destructive schema changes. RLS enabled (service-role-only posture, in
-- line with 20260403_enable_rls_all_tables). A BEFORE UPDATE trigger enforces
-- snapshot/contract immutability at the database layer; only lifecycle status,
-- the append-only audit payload, and updated_at may change.

BEGIN;

CREATE TABLE IF NOT EXISTS public.content_publish_snapshots (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id          TEXT NOT NULL,
  publish_contract_id  TEXT NOT NULL,
  publish_version_hash TEXT NOT NULL,
  blog_id              UUID NULL REFERENCES public.blogs(id) ON DELETE SET NULL,
  content_id           TEXT NULL,
  company_id           UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  website_id           UUID NULL REFERENCES public.websites(id) ON DELETE SET NULL,
  integration_id       UUID NULL REFERENCES public.company_integrations(id) ON DELETE SET NULL,
  content_type         TEXT NOT NULL,
  publish_target_type  TEXT NOT NULL,
  publish_mode         TEXT NOT NULL,
  publish_intent       TEXT NOT NULL,
  scheduled_publish_at TIMESTAMPTZ NULL,
  snapshot_payload     JSONB NOT NULL,
  contract_payload     JSONB NOT NULL,
  audit_payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key      TEXT NOT NULL,
  snapshot_status      TEXT NOT NULL DEFAULT 'draft_snapshot',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT content_publish_snapshots_contract_unique UNIQUE (publish_contract_id),
  CONSTRAINT content_publish_snapshots_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT content_publish_snapshots_status_check
    CHECK (snapshot_status IN (
      'draft_snapshot', 'scheduled_snapshot', 'published_snapshot',
      'archived_snapshot', 'invalid_snapshot'
    ))
);

CREATE INDEX IF NOT EXISTS idx_content_publish_snapshots_snapshot_id
  ON public.content_publish_snapshots(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_content_publish_snapshots_company
  ON public.content_publish_snapshots(company_id);
CREATE INDEX IF NOT EXISTS idx_content_publish_snapshots_blog
  ON public.content_publish_snapshots(blog_id) WHERE blog_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_content_publish_snapshots_hash
  ON public.content_publish_snapshots(publish_version_hash);
CREATE INDEX IF NOT EXISTS idx_content_publish_snapshots_status
  ON public.content_publish_snapshots(snapshot_status);
CREATE INDEX IF NOT EXISTS idx_content_publish_snapshots_scheduled_for
  ON public.content_publish_snapshots(scheduled_publish_at)
  WHERE scheduled_publish_at IS NOT NULL;

ALTER TABLE public.content_publish_snapshots ENABLE ROW LEVEL SECURITY;

-- Immutability guard: frozen snapshot/contract columns can never be updated.
-- Lifecycle status, the append-only audit payload, and updated_at may change.
CREATE OR REPLACE FUNCTION public.content_publish_snapshots_guard_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.snapshot_id          IS DISTINCT FROM OLD.snapshot_id
     OR NEW.publish_contract_id  IS DISTINCT FROM OLD.publish_contract_id
     OR NEW.publish_version_hash IS DISTINCT FROM OLD.publish_version_hash
     OR NEW.idempotency_key      IS DISTINCT FROM OLD.idempotency_key
     OR NEW.snapshot_payload     IS DISTINCT FROM OLD.snapshot_payload
     OR NEW.contract_payload     IS DISTINCT FROM OLD.contract_payload
  THEN
    RAISE EXCEPTION 'content_publish_snapshots: immutable snapshot/contract columns cannot be updated';
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS content_publish_snapshots_guard_immutable
  ON public.content_publish_snapshots;
CREATE TRIGGER content_publish_snapshots_guard_immutable
  BEFORE UPDATE ON public.content_publish_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.content_publish_snapshots_guard_immutable();

COMMENT ON TABLE public.content_publish_snapshots IS
  'Immutable persisted publish snapshots + publishing contracts for universal publishing orchestration. Additive; non-executing.';

COMMIT;
