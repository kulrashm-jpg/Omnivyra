-- Outreach (N-3) — an operator records each manual outcome of a task once.
--
-- WHY. POST /api/outreach/outcomes pins provider_event_id to null for a manual entry, so its
-- only idempotency key was outreach_outcomes_idempotent (company_id, task_id, outcome_type,
-- occurred_at). The same reply entered twice with a different occurred_at produced a second
-- row and a second `response.replied` journey event.
--
-- RULE. At most one MANUAL row per (company, task, outcome type). A second manual entry
-- collides here, and appendOutcome already reports a 23505 as `duplicate: true` (a success),
-- so the route answers exactly as it does for a same-instant repeat. Provider, import and
-- internal sources are unaffected: they keep their own keys.
--
-- Pre-check: outreach_outcomes is append-only, so existing duplicates cannot be cleaned
-- here. If any exist the migration stops and names how many, rather than failing on the
-- index build with a bare 23505.
--
-- NO grant, policy or RLS change. Forward only; rollback in
-- rollbacks/outreach_manual_outcome_once_rollback.sql.

DO $omoo_precheck$
DECLARE
  v_dupes bigint;
BEGIN
  IF to_regclass('public.idx_outreach_outcomes_manual_once') IS NOT NULL THEN
    RETURN;
  END IF;
  SELECT count(*) INTO v_dupes FROM (
    SELECT 1 FROM public.outreach_outcomes
     WHERE source = 'manual'
     GROUP BY company_id, task_id, outcome_type
    HAVING count(*) > 1
  ) d;
  IF v_dupes > 0 THEN
    RAISE EXCEPTION 'outreach_outcomes holds % (company, task, type) groups with more than one manual row; an owner decides which stands before this index is built', v_dupes
      USING ERRCODE = '23505';
  END IF;
END
$omoo_precheck$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_outcomes_manual_once
  ON public.outreach_outcomes (company_id, task_id, outcome_type)
  WHERE source = 'manual';

COMMENT ON INDEX public.idx_outreach_outcomes_manual_once IS
  'N-3: one manual outcome per (company, task, type). A repeat is a duplicate (success), not a second response.';
