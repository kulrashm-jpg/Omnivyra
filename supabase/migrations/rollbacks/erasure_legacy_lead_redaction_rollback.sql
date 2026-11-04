-- ROLLBACK for 20270112000004_erasure_legacy_lead_redaction.sql
--
-- ─── ORDER ─────────────────────────────────────────────────────────────────
-- Reverse version order, one transaction per file:
--   (20270113000000 A6-10 bridge, if applied) → 20270112000005 →
--   20270112000004 (this file) → 20270112000003 → 20270112000002 →
--   20270112000001 → 20270112000000.
-- This file and 20270112000005's rollback are independent of each other;
-- 20270112000003's rollback refuses until both have run.
--
-- ─── WHAT IT RESTORES ──────────────────────────────────────────────────────
-- public.pi_person_erasure_legacy_lead_policy(uuid, uuid) — the
-- 20270112000003 default hook (R = retain), verbatim. Owner, SECURITY DEFINER,
-- search_path = '' and ACL are identical before and after (both migrations
-- REVOKE ALL from PUBLIC/anon/authenticated/service_role; CREATE OR REPLACE
-- keeps the ACL). Nothing else was changed by the forward migration.
--
-- ─── WHAT IT DOES NOT DO ───────────────────────────────────────────────────
-- Legacy leads already redacted (name 'redacted', email 'redacted:<id>', ...)
-- STAY redacted. The redaction is irreversible by design and this rollback
-- never writes a row. FUTURE erasures retain the lead's own fields again.
--
-- Leads redacted so far (for the record; nothing here changes them):
--   SELECT count(*) FROM public.leads WHERE person_erased_at IS NOT NULL AND name = 'redacted';

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.pi_person_erasure_legacy_lead_policy(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION '20270112000004 rollback refused: pi_person_erasure_legacy_lead_policy is missing '
      '(20270112000003 is not applied or was already rolled back - rolling this back now would '
      're-create a 20270112000003 object; out of order)';
  END IF;
END
$preflight$;

-- 20270112000003_person_erasure_requests.sql, verbatim default hook.
CREATE OR REPLACE FUNCTION public.pi_person_erasure_legacy_lead_policy(p_organization_id uuid, p_person_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  -- R (retain): the legacy lead rows keep their own fields; only the person
  -- link is detached (step 6b). Pending the owner's subject_id decision.
  RETURN jsonb_build_object('legacy_lead_fields', 'retain');
END
$fn$;

DO $verify$
DECLARE r text;
BEGIN
  IF position('''legacy_lead_fields'', ''retain''' IN
       (SELECT prosrc FROM pg_proc WHERE oid = 'public.pi_person_erasure_legacy_lead_policy(uuid, uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '20270112000004 rollback postcondition: legacy_lead_policy is not the retain default';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)
       AND has_function_privilege(r, 'public.pi_person_erasure_legacy_lead_policy(uuid, uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION '20270112000004 rollback postcondition: role % can execute legacy_lead_policy', r;
    END IF;
  END LOOP;
END
$verify$;

COMMIT;
