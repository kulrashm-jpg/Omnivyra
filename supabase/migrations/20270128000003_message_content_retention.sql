-- Outreach (N-4) — message content is cleared only on an admin's approval, never before 3 days.
--
-- OWNER RULE (2026-11-06): stored message text and numbers are cleared only after an admin
-- approves it; anything not approved is kept, and nothing younger than 3 days is cleared.
--
-- TWO TABLES.
--   message_retention_approvals  one row per admin approval: who, which tenant, which store,
--                                and the cutoff. The 3-day floor is a CHECK, so no code path
--                                can approve clearing anything newer.
--   outreach_outcome_notes       the operator's free-text note on a manual outcome. It used to
--                                live in outreach_outcomes.evidence, which is append-only and
--                                so could never be cleared. New notes are written here instead;
--                                notes already in outreach_outcomes.evidence stay as they are
--                                (clearing them would break that table's append-only rule;
--                                an owner decision).
--
-- RULES, enforced here:
--   * approvals: cutoff <= approved_at - 3 days; dead-letter approvals are platform-scoped
--     (no tenant), every other store names its tenant; identity is immutable, and only the
--     execution record (executed_at, rows_cleared) may be written, once; never deleted;
--   * notes: one per (company, task, outcome type), matching the one-manual-outcome rule
--     (20270128000000); the note may only be cleared, once, by a named approval; nothing
--     else changes; never deleted;
--   * service_role only; anon and authenticated have no access.
--
-- Forward only; rollback in rollbacks/message_content_retention_rollback.sql.

CREATE TABLE IF NOT EXISTS public.message_retention_approvals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  text,
  store            text NOT NULL,
  cutoff           timestamptz NOT NULL,
  approved_by      uuid NOT NULL,
  approved_at      timestamptz NOT NULL DEFAULT now(),
  reason           text,
  executed_at      timestamptz,
  rows_cleared     integer,
  CONSTRAINT message_retention_approvals_store_valid
    CHECK (store IN ('engagement_messages', 'outreach_outcome_notes', 'dead_letters')),
  CONSTRAINT message_retention_approvals_three_day_floor
    CHECK (cutoff <= approved_at - interval '3 days'),
  CONSTRAINT message_retention_approvals_scope
    CHECK ((store = 'dead_letters') = (organization_id IS NULL)),
  CONSTRAINT message_retention_approvals_execution_pair
    CHECK ((executed_at IS NULL) = (rows_cleared IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_message_retention_approvals_org
  ON public.message_retention_approvals (organization_id, approved_at DESC);

CREATE TABLE IF NOT EXISTS public.outreach_outcome_notes (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             text NOT NULL,
  task_id                uuid NOT NULL REFERENCES public.outreach_tasks(id) ON DELETE RESTRICT,
  outcome_type           text NOT NULL,
  note                   text,
  recorded_by            uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  cleared_at             timestamptz,
  clearing_approval_id   uuid REFERENCES public.message_retention_approvals(id) ON DELETE RESTRICT,
  CONSTRAINT outreach_outcome_notes_once UNIQUE (company_id, task_id, outcome_type),
  CONSTRAINT outreach_outcome_notes_cleared_shape
    CHECK ((cleared_at IS NULL) = (clearing_approval_id IS NULL)
       AND (cleared_at IS NULL OR note IS NULL))
);

CREATE OR REPLACE FUNCTION public.message_retention_approvals_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'message_retention_approvals: approvals are never deleted' USING ERRCODE = '42501';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.store IS DISTINCT FROM OLD.store
     OR NEW.cutoff IS DISTINCT FROM OLD.cutoff
     OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
     OR NEW.reason IS DISTINCT FROM OLD.reason THEN
    RAISE EXCEPTION 'message_retention_approvals: an approval is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.executed_at IS NOT NULL THEN
    RAISE EXCEPTION 'message_retention_approvals: approval % was already executed', OLD.id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.message_retention_approvals_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS message_retention_approvals_guard ON public.message_retention_approvals;
CREATE TRIGGER message_retention_approvals_guard
  BEFORE UPDATE OR DELETE ON public.message_retention_approvals
  FOR EACH ROW EXECUTE FUNCTION public.message_retention_approvals_guard();

CREATE OR REPLACE FUNCTION public.outreach_outcome_notes_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'outreach_outcome_notes: notes are cleared, never deleted' USING ERRCODE = '42501';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.task_id IS DISTINCT FROM OLD.task_id
     OR NEW.outcome_type IS DISTINCT FROM OLD.outcome_type
     OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'outreach_outcome_notes: identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.cleared_at IS NOT NULL THEN
    RAISE EXCEPTION 'outreach_outcome_notes: note % is already cleared', OLD.id USING ERRCODE = '23514';
  END IF;
  IF NEW.cleared_at IS NULL OR NEW.note IS NOT NULL OR NEW.clearing_approval_id IS NULL THEN
    RAISE EXCEPTION 'outreach_outcome_notes: a note may only be cleared, by a named approval' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.outreach_outcome_notes_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS outreach_outcome_notes_guard ON public.outreach_outcome_notes;
CREATE TRIGGER outreach_outcome_notes_guard
  BEFORE UPDATE OR DELETE ON public.outreach_outcome_notes
  FOR EACH ROW EXECUTE FUNCTION public.outreach_outcome_notes_guard();

ALTER TABLE public.message_retention_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_outcome_notes ENABLE ROW LEVEL SECURITY;

DO $mcr_rls$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'message_retention_approvals'
       AND policyname = 'message_retention_approvals_service_role'
  ) THEN
    CREATE POLICY message_retention_approvals_service_role
      ON public.message_retention_approvals
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'outreach_outcome_notes'
       AND policyname = 'outreach_outcome_notes_service_role'
  ) THEN
    CREATE POLICY outreach_outcome_notes_service_role
      ON public.outreach_outcome_notes
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END
$mcr_rls$;

-- Own grants, not the platform defaults: the governed build does not
-- reproduce them, and a later class-wide REVOKE would not list these tables.
-- No DELETE for anyone.
REVOKE ALL ON TABLE public.message_retention_approvals FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.message_retention_approvals TO service_role;
REVOKE ALL ON TABLE public.outreach_outcome_notes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.outreach_outcome_notes TO service_role;

COMMENT ON TABLE public.message_retention_approvals IS
  'N-4: admin approvals to clear stored message content. Cutoff at least 3 days before approval; immutable; executed once; never deleted.';
COMMENT ON TABLE public.outreach_outcome_notes IS
  'N-4: operator free-text notes on manual outcomes, kept out of append-only outreach_outcomes so an approved clearing can remove them.';
