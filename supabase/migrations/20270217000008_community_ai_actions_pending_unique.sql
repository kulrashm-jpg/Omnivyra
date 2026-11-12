-- Community AI actions: at most ONE pending action per (tenant, organization, platform, action type,
-- target) (version 20270217000008, slug community_ai_actions_pending_unique, reserved by virality-83;
-- CLASS-2 B-series, e9 sweep; on fix/s-wa-combined).
--
-- WHY. Every writer of a pending action reads "is there already a pending one for this target?" and
-- then inserts (communityAiAutoRuleService.resolveActionRecord, communityAiOmnivyraService, the
-- network-expansion candidates, engagementEvaluationService). Two concurrent evaluations both read
-- "none" and both inserted: duplicate pending rows for the same target, each of which could be
-- approved and SENT - a second real reply / DM. Only a unique index can make that impossible; the
-- writers now treat its 23505 as "already pending" (and return the existing row).
--
-- KEY = the writers' own dedupe: (tenant_id, organization_id, platform, action_type, target_id) WHERE
-- status = 'pending'. The writers lower-case platform and action_type before writing, so no lower()
-- here. NULLS NOT DISTINCT: the columns are NOT NULL in the base DDL, but a NULL must not escape
-- the rule if any environment differs; the preflight groups with the same (NULLs-equal) semantics.
--
-- PRODUCTION FACT (via 83, owner-approved data step D1, 2026-11-12): the older duplicate pending
-- rows (10 rows across 3 keys, keyed WITHOUT tenant_id - a coarser key than this index) were marked
-- 'failed' with a superseded skip_reason, newest kept; the re-check found 0 duplicate pending keys.
-- Any duplicate under this (finer) key is a duplicate under D1's, so today's data passes. The
-- preflight still RAISES on any duplicate rather than choosing a row (owner rule: never silently).
--
-- LOCK: CREATE UNIQUE INDEX (not CONCURRENTLY - this runs inside a transaction) holds a SHARE lock
-- on community_ai_actions while it builds: writes to the table wait for the build. The index is
-- partial (pending rows only), so the build reads the table once and indexes few rows.

BEGIN;

DO $preflight$
DECLARE
  v_dups bigint;
BEGIN
  IF to_regclass('public.community_ai_actions') IS NULL THEN
    RAISE EXCEPTION 'CAPU preflight: public.community_ai_actions is missing';
  END IF;
  SELECT count(*) INTO v_dups FROM (
    SELECT tenant_id, organization_id, platform, action_type, target_id
      FROM public.community_ai_actions
     WHERE status = 'pending'
     GROUP BY tenant_id, organization_id, platform, action_type, target_id
    HAVING count(*) > 1
  ) d;
  IF v_dups > 0 THEN
    RAISE EXCEPTION 'CAPU preflight: % (tenant, organization, platform, action_type, target) key(s) have more than one PENDING action - resolve them (an owner-approved data step, as D1) before this migration; it does not choose', v_dups;
  END IF;
  -- ROLLBACK SOUNDNESS (05 / e1 rule, 2026-11-12): a rollback may only remove what this apply
  -- proved was not there before. IF NOT EXISTS would silently TOLERATE a pre-existing index of this
  -- name, and the rollback would then drop something that predated us. So an existing object of this
  -- name must be EXACTLY this index (a re-apply of this migration); anything else refuses.
  IF to_regclass('public.community_ai_actions_one_pending') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE i.indrelid = 'public.community_ai_actions'::regclass AND c.relname = 'community_ai_actions_one_pending'
       AND i.indisunique AND i.indnullsnotdistinct
       AND pg_get_expr(i.indpred, i.indrelid) = '(status = ''pending''::text)'
       AND (SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(i.indkey) WITH ORDINALITY k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum)
           = ARRAY['tenant_id', 'organization_id', 'platform', 'action_type', 'target_id']::name[]
  ) THEN
    RAISE EXCEPTION 'CAPU preflight: an object named community_ai_actions_one_pending already exists with a different definition - it predates this migration; refusing (the rollback must never drop it)';
  END IF;
END
$preflight$;

CREATE UNIQUE INDEX IF NOT EXISTS community_ai_actions_one_pending
  ON public.community_ai_actions (tenant_id, organization_id, platform, action_type, target_id) NULLS NOT DISTINCT
  WHERE status = 'pending';

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE i.indrelid = 'public.community_ai_actions'::regclass AND c.relname = 'community_ai_actions_one_pending'
       AND i.indisunique AND i.indnullsnotdistinct
       AND pg_get_expr(i.indpred, i.indrelid) = '(status = ''pending''::text)'
       AND (SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(i.indkey) WITH ORDINALITY k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum)
           = ARRAY['tenant_id', 'organization_id', 'platform', 'action_type', 'target_id']::name[]
  ) THEN
    RAISE EXCEPTION 'CAPU postcondition: community_ai_actions_one_pending must be UNIQUE NULLS NOT DISTINCT (tenant_id, organization_id, platform, action_type, target_id) WHERE status = ''pending''';
  END IF;
  RAISE NOTICE 'CAPU: one pending community AI action per (tenant, organization, platform, action_type, target).';
END
$verify$;

COMMIT;
