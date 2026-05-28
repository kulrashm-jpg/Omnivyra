-- Phase 1B.1 — Thread Multi-Row Runtime (write side).
--
-- Adds:
--   1. UNIQUE (parent_post_id, thread_position) constraint to protect against
--      duplicate node positions in the same thread. NULL parent_post_id (the
--      vast majority of existing rows — single-row posts) is treated as DISTINCT
--      by Postgres so this is a no-op for legacy data.
--
--   2. insert_thread_atomic(p_payload jsonb) — atomic N-row thread insert.
--      Inserts root (status='scheduled') + children (status='draft') in one
--      statement with full constraint enforcement. Children stay dormant
--      ('draft' is ignored by the cron publisher) until the Phase 1B.2 thread
--      orchestrator ships and processes them.
--
--   3. replace_thread_children(p_root_id uuid, p_children jsonb) — used by the
--      activity-workspace endpoint when an existing thread is re-scheduled.
--      DELETEs all descendants, INSERTs new children in one statement.
--
-- Both functions are SECURITY INVOKER so existing RLS policies on
-- scheduled_posts continue to apply at the caller's context.
--
-- Backward compatibility:
--   - Single-row inserts continue to work via the existing endpoint paths.
--   - This migration adds capability only; the application code only calls
--     these functions when THREAD_MULTI_ROW_RUNTIME env flag is on.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. UNIQUE constraint on thread node positions
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uniq_thread_position') THEN
    ALTER TABLE scheduled_posts
      ADD CONSTRAINT uniq_thread_position
      UNIQUE (parent_post_id, thread_position);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. insert_thread_atomic(p_payload jsonb) RETURNS jsonb
--
-- Payload shape:
--   {
--     "user_id":            "<uuid>",
--     "social_account_id":  "<uuid>" | null,
--     "campaign_id":        "<uuid>" | null,
--     "platform":           "twitter" | "linkedin" | ...,
--     "scheduled_for":      "<iso timestamptz>",
--     "title":              string | null,
--     "hashtags":           [string, ...] | [],
--     "root_status":        "scheduled" | "draft"   -- OPTIONAL. Default 'scheduled'.
--                                                      Phase 1B.1A: shadow-mode
--                                                      callers pass 'draft' so
--                                                      the cron's direct scan
--                                                      does not pick up the
--                                                      multi-row root (which
--                                                      would cause duplicate
--                                                      publish alongside the
--                                                      legacy joined row).
--     "nodes": [
--       { "position": 0, "content": "..." },   -- root
--       { "position": 1, "content": "..." },
--       ...
--     ]
--   }
--
-- Returns:
--   { "root_id": "<uuid>", "node_ids": ["<uuid>", ...] }
--
-- Errors:
--   - thread_must_have_at_least_two_nodes
--   - thread_invalid_root_status (when root_status is provided but is neither
--     'scheduled' nor 'draft')
--   - Any underlying chk_* constraint violation aborts the whole call
--     atomically (no partial insert can be observed).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION insert_thread_atomic(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $func$
DECLARE
  v_root_id            uuid := gen_random_uuid();
  v_node_ids           uuid[] := ARRAY[v_root_id];
  v_user_id            uuid := (p_payload->>'user_id')::uuid;
  v_social_account_id  uuid := NULLIF(p_payload->>'social_account_id', '')::uuid;
  v_campaign_id        uuid := NULLIF(p_payload->>'campaign_id', '')::uuid;
  v_platform           text := p_payload->>'platform';
  v_scheduled_for      timestamptz := (p_payload->>'scheduled_for')::timestamptz;
  v_title              text := NULLIF(p_payload->>'title', '');
  v_hashtags           text[] := ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'hashtags', '[]'::jsonb)));
  v_nodes              jsonb := p_payload->'nodes';
  v_content_type       text := CASE WHEN v_platform = 'twitter' THEN 'thread' ELSE 'post' END;
  v_root_status        text := COALESCE(NULLIF(p_payload->>'root_status', ''), 'scheduled');
  v_thread_title       text;
  v_idx                int;
  v_node               jsonb;
  v_child_id           uuid;
  v_hashtag_arg        text[] := CASE WHEN array_length(v_hashtags, 1) > 0 THEN v_hashtags ELSE NULL END;
BEGIN
  IF v_nodes IS NULL OR jsonb_typeof(v_nodes) <> 'array' OR jsonb_array_length(v_nodes) < 2 THEN
    RAISE EXCEPTION 'thread_must_have_at_least_two_nodes';
  END IF;

  IF v_root_status <> 'scheduled' AND v_root_status <> 'draft' THEN
    RAISE EXCEPTION 'thread_invalid_root_status';
  END IF;

  v_thread_title := COALESCE(v_title, LEFT(v_nodes->0->>'content', 200));

  -- Root row: caller chooses status. 'scheduled' makes the row publish-eligible
  -- (cron's direct scan picks it up). 'draft' keeps it dormant for shadow-mode
  -- observability without duplicating the legacy joined row's publish.
  INSERT INTO scheduled_posts (
    id, user_id, social_account_id, campaign_id,
    platform, content_type, content, title, hashtags,
    scheduled_for, status,
    parent_post_id, thread_position, is_thread_start, thread_title,
    created_at, updated_at
  ) VALUES (
    v_root_id, v_user_id, v_social_account_id, v_campaign_id,
    v_platform, v_content_type, v_nodes->0->>'content', v_title, v_hashtag_arg,
    v_scheduled_for, v_root_status,
    NULL, 0, TRUE, v_thread_title,
    now(), now()
  );

  -- Child rows: status='draft' so the legacy publisher cron (which filters
  -- for status='scheduled') ignores them until the thread orchestrator ships.
  FOR v_idx IN 1 .. jsonb_array_length(v_nodes) - 1 LOOP
    v_node := v_nodes->v_idx;
    v_child_id := gen_random_uuid();
    INSERT INTO scheduled_posts (
      id, user_id, social_account_id, campaign_id,
      platform, content_type, content,
      scheduled_for, status,
      parent_post_id, thread_position, is_thread_start,
      created_at, updated_at
    ) VALUES (
      v_child_id, v_user_id, v_social_account_id, v_campaign_id,
      v_platform, v_content_type, v_node->>'content',
      v_scheduled_for, 'draft',
      v_root_id, (v_node->>'position')::int, FALSE,
      now(), now()
    );
    v_node_ids := array_append(v_node_ids, v_child_id);
  END LOOP;

  RETURN jsonb_build_object(
    'root_id',  v_root_id,
    'node_ids', to_jsonb(v_node_ids)
  );
END;
$func$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. replace_thread_children(p_root_id uuid, p_children jsonb) RETURNS jsonb
--
-- Used when an existing thread is re-scheduled via the activity-workspace
-- endpoint. The root row is updated in place by the endpoint (so its id is
-- preserved). This function atomically DELETEs all current descendants and
-- INSERTs the new children, inheriting the root's metadata.
--
-- Errors:
--   - thread_root_not_found  (no row with id=p_root_id AND is_thread_start=TRUE)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION replace_thread_children(p_root_id uuid, p_children jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $func$
DECLARE
  v_root      scheduled_posts%ROWTYPE;
  v_idx       int;
  v_node      jsonb;
  v_child_id  uuid;
  v_node_ids  uuid[] := ARRAY[]::uuid[];
BEGIN
  SELECT * INTO v_root
  FROM scheduled_posts
  WHERE id = p_root_id AND is_thread_start = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'thread_root_not_found';
  END IF;

  DELETE FROM scheduled_posts WHERE parent_post_id = p_root_id;

  IF p_children IS NOT NULL AND jsonb_typeof(p_children) = 'array' THEN
    FOR v_idx IN 0 .. jsonb_array_length(p_children) - 1 LOOP
      v_node := p_children->v_idx;
      v_child_id := gen_random_uuid();
      INSERT INTO scheduled_posts (
        id, user_id, social_account_id, campaign_id,
        platform, content_type, content,
        scheduled_for, status,
        parent_post_id, thread_position, is_thread_start,
        created_at, updated_at
      ) VALUES (
        v_child_id, v_root.user_id, v_root.social_account_id, v_root.campaign_id,
        v_root.platform, v_root.content_type, v_node->>'content',
        v_root.scheduled_for, 'draft',
        p_root_id, (v_node->>'position')::int, FALSE,
        now(), now()
      );
      v_node_ids := array_append(v_node_ids, v_child_id);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'root_id',  p_root_id,
    'node_ids', to_jsonb(v_node_ids)
  );
END;
$func$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. GRANT EXECUTE
-- ─────────────────────────────────────────────────────────────────────────────
-- Grant to the roles that Supabase clients impersonate. Service-role bypasses
-- but we grant explicitly to authenticated/anon so signed-in callers can use
-- the RPC via the API. RLS still applies inside SECURITY INVOKER.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION insert_thread_atomic(jsonb) TO authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION replace_thread_children(uuid, jsonb) TO authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION insert_thread_atomic(jsonb) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION replace_thread_children(uuid, jsonb) TO service_role';
  END IF;
END $$;
