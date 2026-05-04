-- Phase C fix migration — public_blogs.
--
-- Referenced by pages/admin/blog/index.tsx:143 (admin UI). Existed in prod via
-- database/public_blogs.sql (out-of-band). Now canonical.

CREATE TABLE IF NOT EXISTS public.public_blogs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title text NOT NULL,
  slug text NOT NULL,
  excerpt text,
  content_markdown text DEFAULT ''::text,
  content_html text,
  featured_image_url text,
  category text,
  tags text[],
  media_blocks jsonb,
  seo_meta_title text,
  seo_meta_description text,
  status text DEFAULT 'draft'::text,
  is_featured boolean DEFAULT false,
  published_at timestamp with time zone,
  views_count integer DEFAULT 0,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  likes_count integer DEFAULT 0,
  content_blocks jsonb,
  content_type text NOT NULL DEFAULT 'blog'::text,
  used_at timestamp with time zone,
  used_platform text
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='public_blogs_pkey') THEN
    ALTER TABLE public.public_blogs ADD CONSTRAINT public_blogs_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='public_blogs_slug_key') THEN
    ALTER TABLE public.public_blogs ADD CONSTRAINT public_blogs_slug_key UNIQUE (slug);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='public_blogs_status_check') THEN
    ALTER TABLE public.public_blogs
      ADD CONSTRAINT public_blogs_status_check
      CHECK (status IN ('draft','scheduled','published'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_public_blogs_category       ON public.public_blogs (category);
CREATE INDEX IF NOT EXISTS idx_public_blogs_content_blocks ON public.public_blogs USING gin (content_blocks);
CREATE INDEX IF NOT EXISTS idx_public_blogs_content_type   ON public.public_blogs (content_type);
CREATE INDEX IF NOT EXISTS idx_public_blogs_is_featured    ON public.public_blogs (is_featured) WHERE is_featured = true;
CREATE INDEX IF NOT EXISTS idx_public_blogs_published_at   ON public.public_blogs (published_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_public_blogs_slug           ON public.public_blogs (slug);
CREATE INDEX IF NOT EXISTS idx_public_blogs_status         ON public.public_blogs (status);
