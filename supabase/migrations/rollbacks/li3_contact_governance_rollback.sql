-- ROLLBACK for 20261003000000_li3_contact_governance.sql
--
-- ############################################################################
-- #  DESTRUCTIVE — THIS DESTROYS STANDING "DO NOT CONTACT" INSTRUCTIONS      #
-- ############################################################################
--
-- This is the most consequential rollback in the programme so far. The other
-- destructive rollbacks (LI-1, LI-2) lose attributes or evidence. This one
-- loses a person's explicit instruction not to be contacted.
--
-- The failure mode is not a broken query. It is:
--
--   drop the table -> the unsubscribe is gone -> the next campaign contacts
--   someone who asked us not to -> the tenant has a compliance incident and
--   the person has a legitimate grievance
--
-- and nothing in the system will report that it happened, because from the
-- outreach engine's perspective the person simply has no governance record.
--
-- There is no second copy. LI-2 `source_records` may hold the ORIGINATING
-- evidence (the email that said "unsubscribe"), but evidence is not an
-- instruction: rebuilding governance from it would require re-running detection
-- that does not exist yet, and manual records have no source record at all.
--
-- BEFORE RUNNING, measure exactly what will be destroyed:
--
--   SELECT governance_type, channel, count(*)
--     FROM public.contact_governance_records
--    WHERE revoked_at IS NULL
--    GROUP BY 1, 2 ORDER BY 3 DESC;
--
--   SELECT count(*) FROM public.contact_governance_records
--    WHERE revoked_at IS NULL
--      AND governance_type IN ('dnc_permanent','dnc_channel','unsubscribe',
--                              'consent_withdrawn','complaint');
--
-- The second figure is the number of people who will become contactable again.
-- If it is greater than zero, this rollback should almost certainly not run;
-- prefer fixing forward.
--
-- This is cheap ONLY while the table is empty — its state on arrival, and
-- until a channel is activated and detection begins writing.

BEGIN;

DO $guard$
DECLARE
  v_ack     TEXT := current_setting('li3.confirm_drop_contact_governance', true);
  v_total   BIGINT;
  v_binding BIGINT;
  v_deferred BIGINT;
BEGIN
  IF v_ack IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION
      'LI-3B rollback refused. Dropping this table DESTROYS standing do-not-contact '
      'instructions and will make suppressed people contactable again. There is no '
      'second copy. To proceed deliberately: '
      'SET LOCAL "li3.confirm_drop_contact_governance" = ''yes'';';
  END IF;

  SELECT count(*) INTO v_total FROM public.contact_governance_records;
  SELECT count(*) INTO v_binding FROM public.contact_governance_records
   WHERE revoked_at IS NULL
     AND governance_type IN ('dnc_permanent','dnc_channel','unsubscribe',
                             'consent_withdrawn','complaint');
  SELECT count(*) INTO v_deferred FROM public.contact_governance_records
   WHERE revoked_at IS NULL AND governance_type = 'deferred';

  IF v_binding > 0 THEN
    RAISE WARNING 'LI-3B ROLLBACK: % person(s) currently protected by a binding instruction WILL BECOME CONTACTABLE AGAIN.', v_binding;
  END IF;
  IF v_deferred > 0 THEN
    RAISE WARNING 'LI-3B ROLLBACK: % active deferment(s) will be lost.', v_deferred;
  END IF;
  RAISE WARNING 'LI-3B ROLLBACK: destroying % governance record(s) in total.', v_total;
END
$guard$;

DROP TABLE IF EXISTS public.contact_governance_records;

-- Nothing else is touched. The canonical spine, LI-1 attributes, LI-2 evidence,
-- the W5 composite keys and both legacy suppression tables are unaffected —
-- only the ability to honour a person's stated wish is removed.

COMMIT;
