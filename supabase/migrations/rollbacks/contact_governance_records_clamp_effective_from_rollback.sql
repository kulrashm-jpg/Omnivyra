-- Rollback of 20270212000000_contact_governance_records_clamp_effective_from.sql.
--
-- Removes the clamp. Rows already written keep the effective_from they were clamped to (that value
-- was the instant the restriction became enforceable; the provider's own time is in evidence).
-- After this rollback a provider/app clock ahead of the database can again leave a fresh
-- restriction not yet in force: revert the code first only if it depends on the clamp (none does).

DROP TRIGGER IF EXISTS trg_contact_governance_records_clamp_effective_from ON public.contact_governance_records;
DROP FUNCTION IF EXISTS public.contact_governance_records_clamp_effective_from();

DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_contact_governance_records_clamp_effective_from') THEN
    RAISE EXCEPTION 'governance clamp rollback postcondition: the trigger still exists';
  END IF;
  IF to_regprocedure('public.contact_governance_records_clamp_effective_from()') IS NOT NULL THEN
    RAISE EXCEPTION 'governance clamp rollback postcondition: the function still exists';
  END IF;
END
$post$;
