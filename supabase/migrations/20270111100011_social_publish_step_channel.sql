-- Orchestration — the `social_post` workflow step channel.
--
-- A `social_post` step is a PUBLIC, tenant-wide social post. It is deliberately
-- NOT `content`, which keeps its meaning: share a resource WITH a prospect. The
-- step names one already-released `scheduled_posts` row of its tenant
-- (`social_post.scheduled_post_id`) and only AWAITS that post's publication by
-- the existing publishing engine; it creates, approves and triggers nothing.
-- Contract: backend/services/orchestration/socialPostStepContract.ts.
--
-- 20261227000000 created publish_workflow_version with an 11-channel vocabulary.
-- That file is not edited; this migration CREATE OR REPLACEs the function with
-- the body UNCHANGED except:
--   1. the channel list gains 'social_post' (WORKFLOW_STEP_CHANNELS in
--      backend/services/workflows/workflowStore.ts — kept equal by
--      orchestrationTargetingContract.test.ts, which reads the LATEST definition);
--   2. a social_post step must carry social_post.scheduled_post_id as a uuid
--      string, and no other step may carry a social_post object — the same
--      structural rule the TypeScript validator applies.
-- Signature, return type, privileges, locking and every other check are
-- identical. No table, column, constraint or existing channel is touched.
--
-- Additive; NOT applied anywhere yet. ROLLBACK:
-- supabase/migrations/rollbacks/social_publish_step_channel_rollback.sql

DO $$
BEGIN
  IF to_regprocedure('public.publish_workflow_version(uuid, uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'social_post channel: publish_workflow_version (20261227000000) is absent';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.publish_workflow_version(
  p_organization_id uuid,
  p_version_id      uuid,
  p_published_by    uuid
)
-- EVERY OUTPUT NAME IS PREFIXED. A RETURNS TABLE column is an ordinary plpgsql
-- variable inside the body, so naming one `workflow_id` or `version` makes every
-- unqualified reference to the real column ambiguous (42702) — which is exactly
-- what the first T2 run caught.
RETURNS TABLE (
  out_version_id    uuid,
  out_workflow_id   uuid,
  out_version       integer,
  out_superseded_id uuid
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_workflow_id     uuid;
  v_workflow_status text;
  v_status          text;
  v_version         integer;
  v_definition      jsonb;
  v_step_count      integer;
  v_key_count       integer;
  v_superseded      uuid;
BEGIN
  IF p_published_by IS NULL THEN
    RAISE EXCEPTION 'wf_publish:actor_required' USING ERRCODE = '23514';
  END IF;

  -- Lock the WORKFLOW, so publications for one workflow serialise, and read the
  -- version in the same breath so neither can be another tenant's.
  SELECT w.id, w.status, v.status, v.version, v.definition
    INTO v_workflow_id, v_workflow_status, v_status, v_version, v_definition
    FROM public.workflow_versions v
    JOIN public.workflows w
      ON w.id = v.workflow_id AND w.organization_id = v.organization_id
   WHERE v.id = p_version_id
     AND v.organization_id = p_organization_id
     FOR UPDATE OF w;

  IF v_workflow_id IS NULL THEN
    RAISE EXCEPTION 'wf_publish:version_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_workflow_status <> 'active' THEN
    RAISE EXCEPTION 'wf_publish:workflow_not_active' USING ERRCODE = '23514';
  END IF;

  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'wf_publish:not_draft' USING ERRCODE = '23514';
  END IF;

  -- ── Definition validation. The gate is HERE and not only in the store,
  -- because the store is not the only thing that could ever call this.
  SELECT count(*) INTO v_step_count
    FROM jsonb_array_elements(v_definition -> 'steps');
  IF v_step_count = 0 THEN
    RAISE EXCEPTION 'wf_publish:no_steps' USING ERRCODE = '23514';
  END IF;

  -- Every step needs a non-blank key, a channel from the closed vocabulary and a
  -- non-negative relative delay. `delay_after_previous_hours` is the WHOLE timing
  -- vocabulary of a Version. The vocabulary is WORKFLOW_STEP_CHANNELS in
  -- workflowStore.ts, `internal` included (2026-10-28: without it a validated
  -- internal step could never be published). `social_post` (20261231000004): a
  -- public post that awaits one released scheduled post; never `content`.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_definition -> 'steps') AS s
     WHERE jsonb_typeof(s.value) <> 'object'
        OR jsonb_typeof(s.value -> 'key') <> 'string'
        OR length(btrim(s.value ->> 'key')) = 0
        OR jsonb_typeof(s.value -> 'channel') <> 'string'
        OR (s.value ->> 'channel') NOT IN (
             'email', 'linkedin', 'phone', 'whatsapp', 'sms',
             'github', 'discord', 'slack', 'community', 'content', 'internal',
             'social_post')
        OR jsonb_typeof(s.value -> 'delay_after_previous_hours') <> 'number'
        OR (s.value ->> 'delay_after_previous_hours')::numeric < 0
  ) THEN
    RAISE EXCEPTION 'wf_publish:invalid_step' USING ERRCODE = '23514';
  END IF;

  -- A social_post step names exactly one approved post by uuid; no other step
  -- carries a social_post object. COALESCE: an absent member is a refusal, not NULL.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_definition -> 'steps') AS s
     WHERE ((s.value ->> 'channel') = 'social_post'
             AND NOT COALESCE(
               jsonb_typeof(s.value -> 'social_post') = 'object'
               AND jsonb_typeof(s.value -> 'social_post' -> 'scheduled_post_id') = 'string'
               AND (s.value -> 'social_post' ->> 'scheduled_post_id')
                     ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
               false))
        OR ((s.value ->> 'channel') IS DISTINCT FROM 'social_post' AND s.value ? 'social_post')
  ) THEN
    RAISE EXCEPTION 'wf_publish:invalid_step' USING ERRCODE = '23514';
  END IF;

  -- Step keys are unique WITHIN the version. Across versions they may repeat:
  -- v1's `intro` and v2's `intro` are different immutable definitions.
  SELECT count(DISTINCT s.value ->> 'key') INTO v_key_count
    FROM jsonb_array_elements(v_definition -> 'steps') AS s;
  IF v_key_count <> v_step_count THEN
    RAISE EXCEPTION 'wf_publish:duplicate_step_key' USING ERRCODE = '23514';
  END IF;

  -- ── Supersede the outgoing current Version FIRST. The partial unique index
  -- leaves no other order available.
  UPDATE public.workflow_versions AS wv
     SET status = 'superseded'
   WHERE wv.organization_id = p_organization_id
     AND wv.workflow_id = v_workflow_id
     AND wv.status = 'published'
  RETURNING wv.id INTO v_superseded;

  -- ── Then publish. If THIS fails the whole function rolls back, which is why
  -- the supersession above is safe despite being irreversible on its own.
  UPDATE public.workflow_versions AS wv
     SET status = 'published',
         published_at = now(),
         published_by = p_published_by
   WHERE wv.id = p_version_id
     AND wv.organization_id = p_organization_id;

  RETURN QUERY SELECT p_version_id, v_workflow_id, v_version, v_superseded;
END
$$;

-- Privileges as 20261227000000 set them (CREATE OR REPLACE keeps them; restated
-- so this file is correct on its own).
REVOKE EXECUTE ON FUNCTION public.publish_workflow_version(uuid, uuid, uuid)
  FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.publish_workflow_version(uuid, uuid, uuid) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.publish_workflow_version(uuid, uuid, uuid) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.publish_workflow_version(uuid, uuid, uuid) TO service_role';
  END IF;
END
$$;

-- Postcondition: the function now names the new channel.
DO $$
BEGIN
  IF position('''social_post''' IN pg_get_functiondef('public.publish_workflow_version(uuid, uuid, uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'social_post channel postcondition: publish_workflow_version does not accept social_post';
  END IF;
END
$$;
