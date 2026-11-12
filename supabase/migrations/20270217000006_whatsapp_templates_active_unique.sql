-- WhatsApp templates: at most ONE active version per (company, template name), and template status
-- events applied in EVENT order (version 20270217000006, reserved by virality-83; CLASS-2 B8 + B9,
-- e9 sweep; on fix/unread-error-send-main).
--
-- B8. activateTemplate deprecated the other active versions, then activated this one - two writes,
-- and the only index on is_active (idx_wa_templates_active) is NOT unique. Two APPROVED webhooks
-- (two versions, or a redelivery) interleaving left TWO active versions; getActiveTemplate's
-- `.single()` then errors and blocks EVERY template broadcast for that name. Now a partial UNIQUE
-- index makes a second active version impossible, and activation is ONE function, one transaction.
--
-- B9. Meta does not order its webhooks and redelivers them: an APPROVED arriving after a PAUSED /
-- DISABLED re-activated a template Meta had stopped. Now each template remembers when its last
-- applied event HAPPENED (status_event_at, Meta's own event time), and an older event is ignored.
--
-- PRODUCTION FACT (C19, via 83, read-only, 2026-11-12): whatsapp_templates has 0 rows. The preflight
-- still RAISES on any duplicate active pair rather than choosing one (owner rule: never silently).
-- NULLS NOT DISTINCT: company_id is nullable; a NULL company must not escape the rule.
--
-- whatsapp_apply_template_status(template, event, event_at, reason): locks the template's name group
-- (FOR UPDATE), ignores an event older than the template's status_event_at - and, at an EQUAL time
-- (Meta stamps whole seconds, so time cannot order them), one LESS restrictive than the status it
-- holds (APPROVED < PAUSED < REJECTED < DISABLED): wrongly restricting blocks a send, visibly and
-- recoverably; wrongly permitting sends on a template Meta stopped. Equal and as restrictive is
-- re-applied (a duplicate delivery is idempotent; a real same-second transition is not lost).
-- Restrictiveness is a TIE-BREAK, never an override: a LATER re-approval after a DISABLED applies.
-- It applies APPROVED
-- (deprecate the other active versions, then activate this one) or PAUSED / DISABLED / REJECTED
-- (deactivate) in the same transaction. Returns 'applied' | 'stale' | 'not_found'.
-- SECURITY INVOKER (the service role already writes this table), search_path pinned, EXECUTE by full
-- signature to service_role only; asserted below.

BEGIN;

DO $preflight$
DECLARE
  v_dups bigint;
BEGIN
  IF to_regclass('public.whatsapp_templates') IS NULL THEN
    RAISE EXCEPTION 'WTAU preflight: public.whatsapp_templates is missing';
  END IF;
  SELECT count(*) INTO v_dups FROM (
    SELECT company_id, template_name FROM public.whatsapp_templates
     WHERE is_active GROUP BY company_id, template_name HAVING count(*) > 1
  ) d;
  IF v_dups > 0 THEN
    RAISE EXCEPTION 'WTAU preflight: % (company, template_name) pair(s) have more than one ACTIVE version - decide which stays active (an owner-approved data step) before this migration; it does not choose', v_dups;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'whatsapp_apply_template_status'
                AND pg_get_function_identity_arguments(p.oid) <> 'p_template_id uuid, p_event text, p_event_at timestamp with time zone, p_reason text') THEN
    RAISE EXCEPTION 'WTAU preflight: another whatsapp_apply_template_status signature exists - refusing to overload it';
  END IF;
  -- ROLLBACK SOUNDNESS (05 / e1 rule): the rollback drops the column, the index and the function, so
  -- this apply must PROVE none of them predates it. IF NOT EXISTS / CREATE OR REPLACE alone would
  -- tolerate a pre-existing one and the rollback would remove it. Allowed: none present (first apply)
  -- or ALL present exactly as this migration makes them (a re-apply). Anything in between refuses.
  DECLARE
    v_col boolean := EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.whatsapp_templates'::regclass
                               AND attname = 'status_event_at' AND NOT attisdropped);
    v_col_exact boolean := EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.whatsapp_templates'::regclass
                               AND attname = 'status_event_at' AND NOT attisdropped AND atttypid = 'timestamptz'::regtype AND NOT attnotnull);
    v_idx boolean := to_regclass('public.whatsapp_templates_one_active') IS NOT NULL;
    v_idx_exact boolean := EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
                               WHERE i.indrelid = 'public.whatsapp_templates'::regclass AND c.relname = 'whatsapp_templates_one_active'
                                 AND i.indisunique AND i.indnullsnotdistinct AND pg_get_expr(i.indpred, i.indrelid) = 'is_active');
    v_fn boolean := to_regprocedure('public.whatsapp_apply_template_status(uuid, text, timestamptz, text)') IS NOT NULL;
  BEGIN
    IF (v_col OR v_idx OR v_fn) AND NOT (v_col_exact AND v_idx_exact AND v_fn) THEN
      RAISE EXCEPTION 'WTAU preflight: status_event_at / whatsapp_templates_one_active / whatsapp_apply_template_status partly exist or differ (column %, index %, function %) - they predate this migration; refusing (its rollback must never drop them)', v_col, v_idx, v_fn;
    END IF;
  END;
END
$preflight$;

ALTER TABLE public.whatsapp_templates ADD COLUMN IF NOT EXISTS status_event_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_templates_one_active
  ON public.whatsapp_templates (company_id, template_name) NULLS NOT DISTINCT
  WHERE is_active;

CREATE OR REPLACE FUNCTION public.whatsapp_apply_template_status(
  p_template_id uuid,
  p_event       text,
  p_event_at    timestamptz,
  p_reason      text
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
DECLARE
  v_company  uuid;
  v_name     text;
  v_last     timestamptz;
  v_status   text;
BEGIN
  IF p_template_id IS NULL OR p_event IS NULL OR p_event_at IS NULL
     OR p_event NOT IN ('APPROVED', 'REJECTED', 'PAUSED', 'DISABLED') THEN
    RAISE EXCEPTION 'whatsapp_apply_template_status: invalid arguments' USING ERRCODE = '22023';
  END IF;

  SELECT company_id, template_name INTO v_company, v_name
    FROM public.whatsapp_templates WHERE id = p_template_id;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  -- The whole name group, in a stable order, so two activations of one name serialise here.
  PERFORM 1 FROM public.whatsapp_templates
   WHERE company_id IS NOT DISTINCT FROM v_company AND template_name = v_name
   ORDER BY id FOR UPDATE;

  SELECT status_event_at, status INTO v_last, v_status FROM public.whatsapp_templates WHERE id = p_template_id;
  IF v_last IS NOT NULL AND p_event_at < v_last THEN
    RETURN 'stale'; -- an older event, delivered late: Meta's later decision stands
  END IF;
  IF v_last IS NOT NULL AND p_event_at = v_last
     AND array_position(ARRAY['APPROVED', 'PAUSED', 'REJECTED', 'DISABLED'], p_event)
       < coalesce(array_position(ARRAY['APPROVED', 'PAUSED', 'REJECTED', 'DISABLED'], v_status), 0) THEN
    RETURN 'stale'; -- same second, less restrictive than what is held: the restrictive outcome stands
  END IF;

  IF p_event = 'APPROVED' THEN
    UPDATE public.whatsapp_templates
       SET is_active = false, status = 'DEPRECATED', deprecated_at = now()
     WHERE company_id IS NOT DISTINCT FROM v_company AND template_name = v_name
       AND is_active AND id <> p_template_id;
    UPDATE public.whatsapp_templates
       SET is_active = true, status = 'APPROVED', approved_at = now(), status_event_at = p_event_at
     WHERE id = p_template_id;
  ELSE
    UPDATE public.whatsapp_templates
       SET status = p_event, rejection_reason = p_reason, is_active = false, status_event_at = p_event_at
     WHERE id = p_template_id;
  END IF;
  RETURN 'applied';
END
$fn$;

COMMENT ON FUNCTION public.whatsapp_apply_template_status(uuid, text, timestamptz, text) IS
  'Apply one Meta template status event in EVENT order (older events are ignored), activating at most '
  'one version per (company, template_name). Returns applied | stale | not_found.';

REVOKE ALL ON FUNCTION public.whatsapp_apply_template_status(uuid, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_apply_template_status(uuid, text, timestamptz, text) TO service_role;

DO $verify$
DECLARE
  v_fn regprocedure := to_regprocedure('public.whatsapp_apply_template_status(uuid, text, timestamptz, text)');
  v_n  integer;
  v_secdef boolean;
  v_config text[];
  v_vol    "char";
BEGIN
  SELECT count(*) INTO v_n FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE i.indrelid = 'public.whatsapp_templates'::regclass AND c.relname = 'whatsapp_templates_one_active'
     AND i.indisunique AND i.indnullsnotdistinct AND pg_get_expr(i.indpred, i.indrelid) = 'is_active';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'WTAU postcondition: whatsapp_templates_one_active must be UNIQUE NULLS NOT DISTINCT (company_id, template_name) WHERE is_active';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.whatsapp_templates'::regclass
                  AND attname = 'status_event_at' AND atttypid = 'timestamptz'::regtype AND NOT attisdropped) THEN
    RAISE EXCEPTION 'WTAU postcondition: whatsapp_templates.status_event_at must be a timestamptz';
  END IF;
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'WTAU postcondition: whatsapp_apply_template_status is missing';
  END IF;
  SELECT p.prosecdef, p.proconfig, p.provolatile INTO v_secdef, v_config, v_vol FROM pg_proc p WHERE p.oid = v_fn;
  IF v_secdef THEN RAISE EXCEPTION 'WTAU postcondition: the function must be SECURITY INVOKER'; END IF;
  IF v_vol <> 'v' THEN RAISE EXCEPTION 'WTAU postcondition: the function must be VOLATILE'; END IF;
  IF v_config IS NULL OR NOT ('search_path=pg_catalog, public, pg_temp' = ANY (v_config)) THEN
    RAISE EXCEPTION 'WTAU postcondition: the function must pin search_path, found %', v_config;
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'WTAU postcondition: anon / authenticated must not EXECUTE the function';
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   WHERE p.oid = v_fn AND a.grantee = 0 AND a.privilege_type = 'EXECUTE';
  IF v_n <> 0 THEN RAISE EXCEPTION 'WTAU postcondition: PUBLIC must not EXECUTE the function (proacl NULL means OPEN)'; END IF;
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'WTAU postcondition: service_role must EXECUTE the function';
  END IF;
  RAISE NOTICE 'WTAU: one active version per template name; status events applied in event order.';
END
$verify$;

COMMIT;
