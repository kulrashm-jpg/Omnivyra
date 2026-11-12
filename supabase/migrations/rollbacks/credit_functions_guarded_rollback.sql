-- Rollback for 20270217000023_credit_functions_guarded.
--
-- PROVENANCE (05 rollback rule): the apply's precondition proved each guarded
-- function ABSENT (or byte-for-byte this migration's own body on a re-run), so
-- both were CREATED by 20270217000023. This drops exactly those two signatures
-- and nothing else: no CASCADE, and the old apply_credit_reservation /
-- apply_credit_partial_confirm are untouched (the apply never changed them).
--
-- ORDER: roll the APP back first (the repository calls the guarded functions);
-- dropping them under a live app fails every settlement closed. Refuses if
-- 20270217000024 (the legacy-pair revoke) is applied: without the guarded pair
-- AND without service_role EXECUTE on the old pair there is no settlement path.

DO $rb$
BEGIN
  IF NOT has_function_privilege('service_role', 'public.apply_credit_reservation(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.apply_credit_partial_confirm(uuid,uuid,integer,integer,integer,text,text,text,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'credit_guarded rollback: service_role cannot EXECUTE the legacy pair (20270217000024 applied?) - roll that back first; nothing changed';
  END IF;
END
$rb$;

DROP FUNCTION IF EXISTS public.apply_credit_reservation_guarded(uuid,text,integer,integer,integer,text,text,text,text,uuid,uuid,text);
DROP FUNCTION IF EXISTS public.apply_credit_partial_confirm_guarded(uuid,uuid,integer,integer,integer,text,text,text,text,uuid);
