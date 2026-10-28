-- ROLLBACK for 20261231000004_social_publish_step_channel.sql
--
-- Restores publish_workflow_version exactly as 20261227000000 defined it (the
-- 11-channel vocabulary, no social_post rule). Refused while any workflow
-- version — draft or not — contains a social_post step: a published one is
-- immutable and is pinned by runs, and a draft one could no longer be published
-- by the code that authored it. Those versions must be dealt with first.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.workflow_versions v,
           jsonb_array_elements(v.definition -> 'steps') AS s
     WHERE (s.value ->> 'channel') = 'social_post'
  ) THEN
    RAISE EXCEPTION 'rollback refused: workflow versions contain social_post steps';
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
  -- internal step could never be published).
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_definition -> 'steps') AS s
     WHERE jsonb_typeof(s.value) <> 'object'
        OR jsonb_typeof(s.value -> 'key') <> 'string'
        OR length(btrim(s.value ->> 'key')) = 0
        OR jsonb_typeof(s.value -> 'channel') <> 'string'
        OR (s.value ->> 'channel') NOT IN (
             'email', 'linkedin', 'phone', 'whatsapp', 'sms',
             'github', 'discord', 'slack', 'community', 'content', 'internal')
        OR jsonb_typeof(s.value -> 'delay_after_previous_hours') <> 'number'
        OR (s.value ->> 'delay_after_previous_hours')::numeric < 0
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

COMMIT;
