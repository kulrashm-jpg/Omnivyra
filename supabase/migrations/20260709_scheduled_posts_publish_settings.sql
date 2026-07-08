-- Generic per-platform publish options (nullable + additive, metadata-only).
-- Shape: { "tiktok": { "privacy": "...", "allow_comments": true, "allow_duet": true,
--          "allow_stitch": true, "cover_time_ms": 1000 }, ...future platforms }.
-- NULL = adapter defaults. Avoids a new column per platform per setting.
ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS publish_settings jsonb;
