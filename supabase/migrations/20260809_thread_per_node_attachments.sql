-- 20260809_thread_per_node_attachments.sql
--
-- G6/G2 — per-node thread attachments persistence.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- BACKGROUND
-- ─────────────────────────────────────────────────────────────────────────────
-- 20260806_thread_multi_row_runtime.sql introduced multi-row thread inserts
-- via `insert_thread_atomic` and `replace_thread_children` RPCs. Children
-- were inserted TEXT-ONLY: the RPC reads only `v_node->>'content'` and
-- `v_node->>'position'` from each node JSONB. Per-node `media_urls` and
-- `media_types` are dropped at the RPC boundary even when the API caller
-- sends them, leaving every child row with NULL media columns.
--
-- The adapter consumption path already reads `media_urls` per-row at publish
-- time (xAdapter, linkedinAdapter, instagramAdapter all key off the row's
-- own `media_urls` column). So the ONLY change needed for end-to-end per-node
-- propagation is to teach the two RPCs to read and persist per-node media
-- arrays from the JSONB payload.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CONTRACT (additive, backward-compatible)
-- ─────────────────────────────────────────────────────────────────────────────
-- Each `nodes[]` entry MAY now contain:
--
--   {
--     "position":    int,                  -- existing
--     "content":     text,                 -- existing
--     "media_urls":  [text, ...],          -- NEW, optional
--     "media_types": [text, ...]           -- NEW, optional; parallel to media_urls
--   }
--
-- When media_urls is absent or empty, behavior is identical to the pre-G6
-- RPC: the child row's media columns stay NULL. When present, the arrays
-- are persisted directly into the child row's `media_urls` / `media_types`
-- columns (which the column already supported per-row; only the RPC needed
-- to populate them).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- RISK ANALYSIS
-- ─────────────────────────────────────────────────────────────────────────────
-- - Pure additive change. Pre-G6 callers omit the new fields → behavior is
--   identical to today (NULL columns).
-- - Post-G6 callers include the new fields → arrays are persisted.
-- - Reversible: re-applying 20260806_thread_multi_row_runtime.sql restores
--   the prior CREATE OR REPLACE FUNCTION body.
-- - No DDL on tables. The `scheduled_posts.media_urls` and `media_types`
--   columns already exist (per the base schema); only RPC bodies change.
-- - SECURITY INVOKER preserved.
-- - Idempotent: CREATE OR REPLACE FUNCTION can be re-run.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- OPERATOR APPLY CHECKLIST
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Inspect this migration; confirm no other concurrent migrations are
--    pending.
-- 2. Apply via the usual supabase CLI / SQL editor against the production
--    database. The application code is forward-compatible: any pre-migration
--    deploys silently drop the new JSONB fields (already happening today),
--    and any post-migration deploys will start persisting them.
-- 3. No code rollback is required to back out this migration — the prior
--    20260806_thread_multi_row_runtime.sql can be re-applied to restore the
--    RPC bodies. Existing per-node media on already-published threads stays
--    in the rows (just not readable via the multi-row helpers afterward).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. insert_thread_atomic — extend to persist per-node media arrays
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
  -- G6/G2 — per-node media extraction helpers.
  v_node_media_urls    text[];
  v_node_media_types   text[];
  -- Root row also accepts per-node media via nodes[0] (the root is position 0).
  v_root_media_urls    text[];
  v_root_media_types   text[];
BEGIN
  IF v_nodes IS NULL OR jsonb_typeof(v_nodes) <> 'array' OR jsonb_array_length(v_nodes) < 2 THEN
    RAISE EXCEPTION 'thread_must_have_at_least_two_nodes';
  END IF;

  IF v_root_status <> 'scheduled' AND v_root_status <> 'draft' THEN
    RAISE EXCEPTION 'thread_invalid_root_status';
  END IF;

  v_thread_title := COALESCE(v_title, LEFT(v_nodes->0->>'content', 200));

  -- G6/G2 — extract per-node media for the root (nodes[0]). Absent or empty
  -- arrays produce NULL (column default), preserving pre-G6 behavior.
  v_root_media_urls := ARRAY(
    SELECT jsonb_array_elements_text(COALESCE(v_nodes->0->'media_urls', '[]'::jsonb))
  );
  v_root_media_types := ARRAY(
    SELECT jsonb_array_elements_text(COALESCE(v_nodes->0->'media_types', '[]'::jsonb))
  );

  INSERT INTO scheduled_posts (
    id, user_id, social_account_id, campaign_id,
    platform, content_type, content, title, hashtags,
    media_urls, media_types,
    scheduled_for, status,
    parent_post_id, thread_position, is_thread_start, thread_title,
    created_at, updated_at
  ) VALUES (
    v_root_id, v_user_id, v_social_account_id, v_campaign_id,
    v_platform, v_content_type, v_nodes->0->>'content', v_title, v_hashtag_arg,
    CASE WHEN array_length(v_root_media_urls, 1) > 0 THEN v_root_media_urls ELSE NULL END,
    CASE WHEN array_length(v_root_media_types, 1) > 0 THEN v_root_media_types ELSE NULL END,
    v_scheduled_for, v_root_status,
    NULL, 0, TRUE, v_thread_title,
    now(), now()
  );

  -- Child rows: status='draft' so the legacy publisher cron ignores them.
  -- G6/G2 — per-node media_urls + media_types are extracted from each child's
  -- JSONB entry and inserted into the row's columns. The orchestrator's
  -- per-row platform call (publishToPlatform) already reads media_urls from
  -- the row's own column, so this is the only change required for per-node
  -- propagation.
  FOR v_idx IN 1 .. jsonb_array_length(v_nodes) - 1 LOOP
    v_node := v_nodes->v_idx;
    v_child_id := gen_random_uuid();
    v_node_media_urls := ARRAY(
      SELECT jsonb_array_elements_text(COALESCE(v_node->'media_urls', '[]'::jsonb))
    );
    v_node_media_types := ARRAY(
      SELECT jsonb_array_elements_text(COALESCE(v_node->'media_types', '[]'::jsonb))
    );
    INSERT INTO scheduled_posts (
      id, user_id, social_account_id, campaign_id,
      platform, content_type, content,
      media_urls, media_types,
      scheduled_for, status,
      parent_post_id, thread_position, is_thread_start,
      created_at, updated_at
    ) VALUES (
      v_child_id, v_user_id, v_social_account_id, v_campaign_id,
      v_platform, v_content_type, v_node->>'content',
      CASE WHEN array_length(v_node_media_urls, 1) > 0 THEN v_node_media_urls ELSE NULL END,
      CASE WHEN array_length(v_node_media_types, 1) > 0 THEN v_node_media_types ELSE NULL END,
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
-- 2. replace_thread_children — same per-node media extension
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION replace_thread_children(p_root_id uuid, p_children jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $func$
DECLARE
  v_root             scheduled_posts%ROWTYPE;
  v_idx              int;
  v_node             jsonb;
  v_child_id         uuid;
  v_node_ids         uuid[] := ARRAY[]::uuid[];
  v_node_media_urls  text[];
  v_node_media_types text[];
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
      v_node_media_urls := ARRAY(
        SELECT jsonb_array_elements_text(COALESCE(v_node->'media_urls', '[]'::jsonb))
      );
      v_node_media_types := ARRAY(
        SELECT jsonb_array_elements_text(COALESCE(v_node->'media_types', '[]'::jsonb))
      );
      INSERT INTO scheduled_posts (
        id, user_id, social_account_id, campaign_id,
        platform, content_type, content,
        media_urls, media_types,
        scheduled_for, status,
        parent_post_id, thread_position, is_thread_start,
        created_at, updated_at
      ) VALUES (
        v_child_id, v_root.user_id, v_root.social_account_id, v_root.campaign_id,
        v_root.platform, v_root.content_type, v_node->>'content',
        CASE WHEN array_length(v_node_media_urls, 1) > 0 THEN v_node_media_urls ELSE NULL END,
        CASE WHEN array_length(v_node_media_types, 1) > 0 THEN v_node_media_types ELSE NULL END,
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
