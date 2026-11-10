-- ============================================================================
-- Extension 1.5.0: v15-only delivery mark on approved LinkedIn writes (U1)
-- (docs/outreach/platform/EXTENSION-1.5.0-CONTRACT.md §4, open item U1)
-- Version 20270207000002, reservation requested from Release-controls (virality-83);
-- depends on 20270207000000 and 20270207000001.
-- LOCAL ONLY: NOT APPLIED.
-- ============================================================================
--
-- U1: the 1.4 route (GET /api/extension/commands) skips LinkedIn reply/like only
-- for a session whose OWN user has a 1.5 binding. An unbound 1.4.x session of
-- ANOTHER user in the same organization could still claim an action that targets
-- a 1.5-collected own post and click it from a different LinkedIn account.
--
-- Fix: a mark on the action, computed by the database at creation for EVERY
-- writer (there are several insert paths, so the mark is not left to callers):
--   delivery_path = 'extension_v15' when a LinkedIn reply/like targets a message
--   in a thread collected by extension 1.5 (raw_payload.ingested_via =
--   'extension_v15'; the same target -> thread match as authorize_extension_submit).
-- The 1.4 route skips marked rows for every session; the v15 route offers only
-- marked rows. The two routes therefore offer disjoint sets.
--
-- The mark is authoritative and sticky:
--   * on INSERT the trigger computes it and overwrites any caller-supplied value;
--   * on UPDATE the trigger keeps the old value (a later re-ingestion of the
--     thread by 1.4, which rewrites raw_payload, cannot unmark a v15 action, and
--     no caller can set or clear it).
-- The trigger function is SECURITY DEFINER so the match does not depend on the
-- inserting role's RLS view of engagement_messages/threads (an invisible thread
-- would leave the row unmarked, i.e. 1.4-eligible: the unsafe direction). It reads
-- only, writes only NEW, and has its search_path pinned.
--
-- Backfill runs BEFORE the trigger exists (the sticky UPDATE rule would otherwise
-- keep NULL). Expected 0 rows wherever 1.5 has not ingested anything.
--
-- Postconditions (each RAISEs and names its trigger):
--   V1 the column or its CHECK is missing / not validated
--   V2 the trigger is missing, not BEFORE INSERT OR UPDATE, or disabled
--   V3 the function is not SECURITY DEFINER, or its search_path pin is missing
--   V4 PUBLIC, anon or authenticated may EXECUTE the function
--   V5 a matching row was left unmarked by the backfill
-- Rollback: rollbacks/extension_v15_delivery_path_rollback.sql

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.authorize_extension_submit(uuid,uuid,text,text,uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'extension v15 delivery path: apply 20270207000001 first (authorize_extension_submit missing)';
  END IF;
END
$$;

-- 1. the column (nullable, no default: catalog-only, no table rewrite)
ALTER TABLE public.community_ai_actions ADD COLUMN IF NOT EXISTS delivery_path text;
ALTER TABLE public.community_ai_actions DROP CONSTRAINT IF EXISTS community_ai_actions_delivery_path_check;
ALTER TABLE public.community_ai_actions ADD CONSTRAINT community_ai_actions_delivery_path_check
  CHECK (delivery_path IS NULL OR delivery_path = 'extension_v15') NOT VALID;
ALTER TABLE public.community_ai_actions VALIDATE CONSTRAINT community_ai_actions_delivery_path_check;

-- 2. the shared predicate
CREATE OR REPLACE FUNCTION public.community_ai_action_v15_delivery_path(
  p_organization_id uuid,
  p_platform        text,
  p_action_type     text,
  p_target_id       text
) RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN lower(btrim(coalesce(p_platform, ''))) = 'linkedin'
               AND lower(btrim(coalesce(p_action_type, ''))) IN ('reply', 'like')
               AND p_target_id IS NOT NULL
               AND EXISTS (
                     SELECT 1 FROM public.engagement_messages m
                       JOIN public.engagement_threads t ON t.id = m.thread_id AND t.organization_id = p_organization_id
                      WHERE m.organization_id = p_organization_id
                        AND m.platform = 'linkedin'
                        AND m.platform_message_id = p_target_id
                        AND t.platform = 'linkedin'
                        AND t.raw_payload ->> 'ingested_via' = 'extension_v15')
              THEN 'extension_v15' END
$$;

REVOKE ALL ON FUNCTION public.community_ai_action_v15_delivery_path(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

-- 3. backfill (before the trigger: see header)
UPDATE public.community_ai_actions a
   SET delivery_path = 'extension_v15'
 WHERE a.delivery_path IS NULL
   AND public.community_ai_action_v15_delivery_path(a.organization_id, a.platform, a.action_type, a.target_id) IS NOT NULL;

-- 4. the trigger
CREATE OR REPLACE FUNCTION public.community_ai_actions_set_delivery_path()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.delivery_path := public.community_ai_action_v15_delivery_path(NEW.organization_id, NEW.platform, NEW.action_type, NEW.target_id);
  ELSE
    NEW.delivery_path := OLD.delivery_path;
  END IF;
  RETURN NEW;
END
$$;

REVOKE ALL ON FUNCTION public.community_ai_actions_set_delivery_path() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS community_ai_actions_delivery_path ON public.community_ai_actions;
CREATE TRIGGER community_ai_actions_delivery_path
  BEFORE INSERT OR UPDATE ON public.community_ai_actions
  FOR EACH ROW EXECUTE FUNCTION public.community_ai_actions_set_delivery_path();

-- 5. postconditions
DO $$
DECLARE
  fns oid[] := ARRAY[
    to_regprocedure('public.community_ai_action_v15_delivery_path(uuid,text,text,text)'),
    to_regprocedure('public.community_ai_actions_set_delivery_path()')];
  fn  oid;
  r   text;
  bad text[] := ARRAY[]::text[];
BEGIN
  -- V1
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.community_ai_actions'::regclass
                  AND attname = 'delivery_path' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.community_ai_actions'::regclass
                     AND conname = 'community_ai_actions_delivery_path_check' AND convalidated) THEN
    RAISE EXCEPTION 'extension v15 delivery path postcondition V1: column or validated CHECK missing';
  END IF;
  -- V2: BEFORE (bit 1) ROW (bit 0) INSERT (bit 2) UPDATE (bit 4), enabled
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.community_ai_actions'::regclass
                  AND tgname = 'community_ai_actions_delivery_path' AND NOT tgisinternal
                  AND tgenabled = 'O' AND (tgtype & 23) = 23
                  AND tgfoid = to_regprocedure('public.community_ai_actions_set_delivery_path()')) THEN
    RAISE EXCEPTION 'extension v15 delivery path postcondition V2: trigger missing, wrong timing/events, or disabled';
  END IF;
  FOREACH fn IN ARRAY fns LOOP
    IF fn IS NULL THEN RAISE EXCEPTION 'extension v15 delivery path postcondition V3: function missing'; END IF;
    -- V3
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = fn)
       OR (SELECT proconfig FROM pg_proc WHERE oid = fn) IS DISTINCT FROM ARRAY['search_path=public, pg_temp'] THEN
      RAISE EXCEPTION 'extension v15 delivery path postcondition V3: % not SECURITY DEFINER or search_path pin is %',
        fn::regprocedure, (SELECT proconfig FROM pg_proc WHERE oid = fn);
    END IF;
    -- V4 (proacl IS NULL means the PUBLIC default: open)
    IF (SELECT proacl FROM pg_proc WHERE oid = fn) IS NULL THEN
      RAISE EXCEPTION 'extension v15 delivery path postcondition V4: % has the default (PUBLIC) EXECUTE', fn::regprocedure;
    END IF;
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) AND has_function_privilege(r, fn, 'EXECUTE') THEN
        bad := bad || (r || ':' || fn::regprocedure::text);
      END IF;
    END LOOP;
  END LOOP;
  IF array_length(bad, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'extension v15 delivery path postcondition V4: client roles may execute: %', array_to_string(bad, ', ');
  END IF;
  -- V5
  IF EXISTS (SELECT 1 FROM public.community_ai_actions a
              WHERE a.delivery_path IS NULL
                AND public.community_ai_action_v15_delivery_path(a.organization_id, a.platform, a.action_type, a.target_id) IS NOT NULL) THEN
    RAISE EXCEPTION 'extension v15 delivery path postcondition V5: a v15 LinkedIn write is unmarked';
  END IF;
END
$$;

COMMIT;
