-- ─────────────────────────────────────────────────────────────────────────────
-- Blog block system migration
-- Adds content_blocks JSONB column to public_blogs.
-- Makes content_markdown nullable (new block-based posts skip it entirely).
-- Keeps media_blocks for backward compat (ignored by new editor).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add the structured blocks column
ALTER TABLE public_blogs
  ADD COLUMN IF NOT EXISTS content_blocks JSONB;

-- 2. Make content_markdown nullable so new posts can omit it
ALTER TABLE public_blogs
  ALTER COLUMN content_markdown DROP NOT NULL,
  ALTER COLUMN content_markdown SET DEFAULT '';

-- 3. GIN index for fast JSONB queries (block type filtering, search)
CREATE INDEX IF NOT EXISTS idx_public_blogs_content_blocks
  ON public_blogs USING GIN (content_blocks);

-- 4. Column documentation
COMMENT ON COLUMN public_blogs.content_blocks IS
  'Structured block array (ContentBlock[]). Source of truth for posts created/edited after 2026-03-22. NULL = legacy post not yet migrated to block system.';

COMMENT ON COLUMN public_blogs.content_markdown IS
  'Legacy: original markdown source. Kept for backward compatibility and legacy rendering. Deprecated for new posts.';

COMMENT ON COLUMN public_blogs.media_blocks IS
  'Legacy: separate media embed list. Replaced by inline media blocks in content_blocks. Kept for backward compatibility.';
