-- Persist external CMS permalink on blog rows after successful publication.

BEGIN;

ALTER TABLE public.blogs
  ADD COLUMN IF NOT EXISTS external_url TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_blogs_external_url
  ON public.blogs(external_url)
  WHERE external_url IS NOT NULL;

COMMIT;
