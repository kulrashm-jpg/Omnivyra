-- Blog engagement: comments and likes for public_blogs
-- Run in Supabase SQL Editor after public_blogs exists.

-- Add likes_count to public_blogs (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'public_blogs' AND column_name = 'likes_count'
  ) THEN
    ALTER TABLE public_blogs ADD COLUMN likes_count integer DEFAULT 0;
  END IF;
END $$;

-- Blog comments (guest comments: name, email, content)
CREATE TABLE IF NOT EXISTS blog_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blog_id uuid NOT NULL REFERENCES public_blogs(id) ON DELETE CASCADE,
  author_name text NOT NULL,
  author_email text NOT NULL,
  content text NOT NULL,
  status text DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blog_comments_blog_id ON blog_comments(blog_id);
CREATE INDEX IF NOT EXISTS idx_blog_comments_status ON blog_comments(status);
CREATE INDEX IF NOT EXISTS idx_blog_comments_created ON blog_comments(created_at DESC);

-- Blog post likes (fingerprint to prevent double-like from same device, no auth required)
CREATE TABLE IF NOT EXISTS blog_post_likes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blog_id uuid NOT NULL REFERENCES public_blogs(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (blog_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_blog_post_likes_blog_id ON blog_post_likes(blog_id);

-- RLS: public read approved comments; public insert comments; public read/write likes via API (service role)
ALTER TABLE blog_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_post_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read approved blog comments" ON blog_comments;
CREATE POLICY "Public read approved blog comments"
  ON blog_comments FOR SELECT
  USING (status = 'approved');

-- Comments: INSERT via API (service role); no public insert policy needed

-- Likes: read via policy; INSERT/DELETE via API (service role)
DROP POLICY IF EXISTS "Public read blog likes" ON blog_post_likes;
CREATE POLICY "Public read blog likes"
  ON blog_post_likes FOR SELECT
  USING (true);

-- Trigger: keep public_blogs.likes_count in sync with blog_post_likes
CREATE OR REPLACE FUNCTION sync_blog_likes_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public_blogs SET likes_count = COALESCE(likes_count, 0) + 1 WHERE id = NEW.blog_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public_blogs SET likes_count = GREATEST(COALESCE(likes_count, 0) - 1, 0) WHERE id = OLD.blog_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_blog_post_likes_sync ON blog_post_likes;
CREATE TRIGGER trg_blog_post_likes_sync
  AFTER INSERT OR DELETE ON blog_post_likes
  FOR EACH ROW EXECUTE FUNCTION sync_blog_likes_count();

-- Backfill likes_count for existing blogs
UPDATE public_blogs b
SET likes_count = COALESCE((SELECT COUNT(*) FROM blog_post_likes l WHERE l.blog_id = b.id), 0)
WHERE likes_count IS NULL OR likes_count = 0;
