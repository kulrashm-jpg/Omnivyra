-- Image metadata cache — avoids duplicate API calls across users/sessions.
-- Images are keyed by provider_id (e.g. "unsplash-abc123") to prevent re-fetching
-- the same image from different search queries.

CREATE TABLE IF NOT EXISTS image_metadata (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id     text NOT NULL,          -- e.g. "unsplash-abc123"
  source          text NOT NULL,          -- 'unsplash' | 'pexels' | 'pixabay'
  thumb_url       text NOT NULL,
  full_url        text NOT NULL,
  alt_text        text,
  width           integer,
  height          integer,
  author          text,
  author_url      text,
  source_url      text,
  attribution     text NOT NULL,
  color           text,                   -- dominant hex color hint
  search_queries  text[] DEFAULT '{}',    -- all queries that surfaced this image
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz NOT NULL DEFAULT now()
);

-- Unique on provider_id to allow upsert
CREATE UNIQUE INDEX IF NOT EXISTS image_metadata_provider_id_idx
  ON image_metadata (provider_id);

-- Index for reverse-lookup: "which images match this search query?"
CREATE INDEX IF NOT EXISTS image_metadata_search_queries_gin_idx
  ON image_metadata USING gin (search_queries);

-- Index for cleanup of stale entries
CREATE INDEX IF NOT EXISTS image_metadata_last_used_idx
  ON image_metadata (last_used_at);

-- Search query result cache — maps a normalized query to a list of provider_ids
-- so we can reconstruct results without re-calling the API.
CREATE TABLE IF NOT EXISTS image_search_cache (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_key       text NOT NULL,          -- normalized + options fingerprint
  original_query  text NOT NULL,
  resolved_query  text NOT NULL,
  provider_ids    text[] NOT NULL,        -- ordered list of provider_ids
  sources         text,                   -- e.g. "unsplash, pexels"
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '1 day'
);

CREATE UNIQUE INDEX IF NOT EXISTS image_search_cache_query_key_idx
  ON image_search_cache (query_key);

CREATE INDEX IF NOT EXISTS image_search_cache_expires_idx
  ON image_search_cache (expires_at);

-- RPC helper: append a query string to search_queries[] without duplicates
CREATE OR REPLACE FUNCTION image_metadata_append_query(
  p_provider_ids text[],
  p_query text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE image_metadata
  SET search_queries = array_append(search_queries, p_query)
  WHERE provider_id = ANY(p_provider_ids)
    AND NOT (search_queries @> ARRAY[p_query]);
END;
$$;

-- Cleanup: remove search cache entries older than 7 days (run periodically)
-- DELETE FROM image_search_cache WHERE expires_at < now() - interval '7 days';

-- RLS: image metadata is read-only for authenticated users, write via service role only
ALTER TABLE image_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE image_search_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "image_metadata_read" ON image_metadata
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "image_search_cache_read" ON image_search_cache
  FOR SELECT TO authenticated USING (true);
