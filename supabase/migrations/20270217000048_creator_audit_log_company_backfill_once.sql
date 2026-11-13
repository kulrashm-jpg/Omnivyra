-- creator_audit_log: ONE-TIME company_id backfill of the legacy NULL rows. Version 20270217000048 reserved by the
-- registry owner (83, registry 9aa68c784). OWNER RULING 2026-11-13 (in virality-83): the one-time fix (option A) was
-- chosen over leaving the rows. GOV-SECURITY: virality-83; review: virality-05.
--
-- WHY. 83 C91 (owner-approved read): company_id was NULL on all 65 creator_audit_log rows (publish_succeeded 34,
-- publish_failed 31). Every row came from publishNowService.runSingleRowPublish, which passed campaignId but never
-- companyId. The writer is fixed in fix/creator-records-company-id-20261113 (c96a641c7), so new rows carry the
-- company; this migration repairs the rows written before that fix.
--
-- APPEND-ONLY EXCEPTION (owner-approved). trg_creator_audit_log_no_update (20260658) raises P0001 on EVERY
-- UPDATE/DELETE. This migration, in its single transaction:
--   1. preflight: the trigger exists, is ENABLED ('O') and calls creator_audit_log_immutable();
--   2. resolves each NULL-company row: campaign_id -> campaigns.company_id; if that does not resolve,
--      scheduled_post_id -> scheduled_posts.campaign_id -> campaigns.company_id. NEVER scheduled_posts.company_id
--      (absent in prod). PK joins: each path yields at most one company. Both resolve and DISAGREE -> NOT written
--      (campaign_post_company_conflict). Neither resolves -> NOT written (no_campaign_company). Reasons are reported
--      via RAISE NOTICE only - nothing but company_id is ever written into a log row;
--   3. ABORTS (RAISE) if any NULL row resolves to Embrosales (73e5fa6f-...) by either path, BEFORE the trigger is
--      touched;
--   4. ALTER TABLE ... DISABLE TRIGGER trg_creator_audit_log_no_update;
--   5. UPDATE company_id only, only rows still NULL, only to the resolved company;
--   6. ALTER TABLE ... ENABLE TRIGGER trg_creator_audit_log_no_update;
--   7. postcondition: tgenabled = 'O'; updated = resolvable pre-count; remaining NULLs = unresolved pre-count;
--      no row anywhere carries an Embrosales company that this migration wrote.
-- ATOMIC: the migration runs in one transaction, so if ANY step raises, the whole file rolls back - including the
-- DISABLE - and the trigger was never off for any other session (ALTER TABLE holds ACCESS EXCLUSIVE until commit;
-- concurrent writers wait, they never see the trigger disabled).
-- RE-APPLY: a second run finds no resolvable NULL rows, so it disables and re-enables the trigger with 0 updates.
-- The row population is NOT pinned to 65: rows written between the C91 read and the writer deploy are included.
-- Rollback: rollbacks/creator_audit_log_company_backfill_once_rollback.sql (deliberately a no-op - see there).

BEGIN;

DO $pre$
DECLARE
  v_enabled "char";
  v_func text;
BEGIN
  SELECT t.tgenabled, p.proname INTO v_enabled, v_func
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE n.nspname = 'public' AND c.relname = 'creator_audit_log' AND t.tgname = 'trg_creator_audit_log_no_update';
  IF v_enabled IS NULL THEN
    RAISE EXCEPTION '048 preflight: trigger trg_creator_audit_log_no_update not found on public.creator_audit_log';
  END IF;
  IF v_enabled <> 'O' THEN
    RAISE EXCEPTION '048 preflight: trg_creator_audit_log_no_update is not ENABLED (tgenabled=%); refusing to touch it', v_enabled;
  END IF;
  IF v_func <> 'creator_audit_log_immutable' THEN
    RAISE EXCEPTION '048 preflight: trigger calls %, expected creator_audit_log_immutable', v_func;
  END IF;
END
$pre$;

DROP TABLE IF EXISTS pg_temp._cal048_resolution;
CREATE TEMP TABLE _cal048_resolution ON COMMIT DROP AS
SELECT a.id,
       c1.company_id AS via_campaign,
       c2.company_id AS via_post,
       CASE WHEN c1.company_id IS NOT NULL AND c2.company_id IS NOT NULL AND c1.company_id <> c2.company_id THEN NULL
            ELSE COALESCE(c1.company_id, c2.company_id) END AS company_id,
       CASE WHEN c1.company_id IS NOT NULL AND c2.company_id IS NOT NULL AND c1.company_id <> c2.company_id
              THEN 'campaign_post_company_conflict'
            WHEN COALESCE(c1.company_id, c2.company_id) IS NULL THEN 'no_campaign_company' END AS reason
  FROM public.creator_audit_log a
  LEFT JOIN public.campaigns c1 ON c1.id = a.campaign_id
  LEFT JOIN public.scheduled_posts sp ON sp.id = a.scheduled_post_id
  LEFT JOIN public.campaigns c2 ON c2.id = sp.campaign_id
 WHERE a.company_id IS NULL;

DO $guard$
DECLARE
  v_null integer; v_res integer; v_unres integer; v_emb integer; r record;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE reason IS NULL), count(*) FILTER (WHERE reason IS NOT NULL),
         count(*) FILTER (WHERE via_campaign::text LIKE '73e5fa6f-%' OR via_post::text LIKE '73e5fa6f-%')
    INTO v_null, v_res, v_unres, v_emb
    FROM _cal048_resolution;
  IF v_emb > 0 THEN
    RAISE EXCEPTION '048 STOP: % NULL-company audit row(s) resolve to Embrosales (73e5fa6f); nothing written, trigger untouched', v_emb;
  END IF;
  RAISE NOTICE '048: % NULL-company rows; % resolvable; % stay NULL', v_null, v_res, v_unres;
  FOR r IN SELECT id, reason FROM _cal048_resolution WHERE reason IS NOT NULL ORDER BY id LOOP
    RAISE NOTICE '048: row % stays NULL (%)', r.id, r.reason;
  END LOOP;
END
$guard$;

ALTER TABLE public.creator_audit_log DISABLE TRIGGER trg_creator_audit_log_no_update;

UPDATE public.creator_audit_log a
   SET company_id = r.company_id
  FROM _cal048_resolution r
 WHERE a.id = r.id
   AND r.reason IS NULL
   AND a.company_id IS NULL;

ALTER TABLE public.creator_audit_log ENABLE TRIGGER trg_creator_audit_log_no_update;

DO $verify$
DECLARE
  v_enabled "char"; v_res integer; v_unres integer; v_done integer; v_left integer;
BEGIN
  SELECT t.tgenabled INTO v_enabled
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'creator_audit_log' AND t.tgname = 'trg_creator_audit_log_no_update';
  IF v_enabled IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION '048 postcondition: trigger not re-enabled (tgenabled=%)', v_enabled;
  END IF;
  SELECT count(*) FILTER (WHERE reason IS NULL), count(*) FILTER (WHERE reason IS NOT NULL) INTO v_res, v_unres FROM _cal048_resolution;
  SELECT count(*) INTO v_done
    FROM public.creator_audit_log a JOIN _cal048_resolution r ON r.id = a.id
   WHERE r.reason IS NULL AND a.company_id = r.company_id;
  SELECT count(*) INTO v_left
    FROM public.creator_audit_log a JOIN _cal048_resolution r ON r.id = a.id
   WHERE a.company_id IS NULL;
  IF v_done <> v_res THEN
    RAISE EXCEPTION '048 postcondition: % of % resolvable rows carry their company', v_done, v_res;
  END IF;
  IF v_left <> v_unres THEN
    RAISE EXCEPTION '048 postcondition: % rows still NULL, expected % (the unresolved)', v_left, v_unres;
  END IF;
END
$verify$;

COMMIT;
