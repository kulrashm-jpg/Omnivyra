-- Rollback for 20270111000001_pi_opportunity_trigger_fn_hardening.sql.
--
-- Restores the privileges and configuration production had on 2026-10-30
-- (read-only evidence, coordinator query #14):
--   trg_opp_lifecycle_block_mutation:   EXECUTE to PUBLIC, anon, authenticated
--                                       (postgres/service_role were never
--                                       revoked); no pinned search_path;
--   trg_opp_disposition_block_mutation,
--   trg_opp_disposition_snooze_guard:   EXECUTE to authenticated (pinned
--                                       search_path untouched — it predates
--                                       the forward migration).
-- Re-widening is deliberate here: it is the exact pre-migration state, and
-- none of these grants is exploitable (see the forward migration header).
-- Function bodies, triggers and tables are never touched.

BEGIN;

ALTER FUNCTION public.trg_opp_lifecycle_block_mutation() RESET search_path;

-- grant-ok: rollback restores the pre-20270111000001 production ACL exactly.
GRANT EXECUTE ON FUNCTION public.trg_opp_lifecycle_block_mutation() TO PUBLIC, anon, authenticated;
-- grant-ok: rollback restores the pre-20270111000001 production ACL exactly.
GRANT EXECUTE ON FUNCTION public.trg_opp_disposition_block_mutation() TO authenticated;
-- grant-ok: rollback restores the pre-20270111000001 production ACL exactly.
GRANT EXECUTE ON FUNCTION public.trg_opp_disposition_snooze_guard() TO authenticated;

DO $verify$
BEGIN
  IF (SELECT proconfig FROM pg_proc
       WHERE oid = 'public.trg_opp_lifecycle_block_mutation()'::regprocedure) IS NOT NULL THEN
    RAISE EXCEPTION 'OPP-TRGFN rollback: lifecycle function still carries a proconfig';
  END IF;
  IF NOT has_function_privilege('anon', 'public.trg_opp_lifecycle_block_mutation()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.trg_opp_disposition_block_mutation()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.trg_opp_disposition_snooze_guard()', 'EXECUTE') THEN
    RAISE EXCEPTION 'OPP-TRGFN rollback: pre-migration EXECUTE grants not restored';
  END IF;
END
$verify$;

COMMIT;
