-- Per-video YouTube visibility (public | unlisted | private). Nullable + additive
-- (metadata-only, no table rewrite). NULL = adapter default ('public').
ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS youtube_privacy varchar;
