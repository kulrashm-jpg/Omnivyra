CREATE TABLE IF NOT EXISTS public.creator_assets (
  id text PRIMARY KEY,
  tenant_id uuid,
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  source_type text CHECK (source_type IS NULL OR source_type IN ('post', 'thread')),
  source_id text,
  creator_type text NOT NULL,
  title text NOT NULL,
  url text,
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  preview_kind text,
  platform_context text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_content jsonb,
  render_identity_hash text,
  block_template_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.creator_asset_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('post', 'thread')),
  source_id text NOT NULL,
  creator_asset_id text NOT NULL REFERENCES public.creator_assets(id) ON DELETE CASCADE,
  creator_type text NOT NULL,
  title text NOT NULL,
  url text,
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  preview_kind text,
  platform_context text,
  attachment_order integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_content jsonb,
  render_identity_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id, source_type, source_id, creator_asset_id)
);

CREATE INDEX IF NOT EXISTS idx_creator_assets_company_user ON public.creator_assets(company_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creator_assets_render_hash ON public.creator_assets(company_id, render_identity_hash);
CREATE INDEX IF NOT EXISTS idx_creator_asset_attachments_source ON public.creator_asset_attachments(company_id, user_id, source_type, source_id, attachment_order, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creator_asset_attachments_hash ON public.creator_asset_attachments(company_id, render_identity_hash);

ALTER TABLE public.creator_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_asset_attachments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'creator_assets' AND policyname = 'creator_assets_company_members'
  ) THEN
    CREATE POLICY creator_assets_company_members ON public.creator_assets
      USING (
        EXISTS (
          SELECT 1 FROM public.user_company_roles ucr
          WHERE ucr.company_id = creator_assets.company_id
            AND ucr.user_id = auth.uid()
            AND ucr.status = 'active'
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.user_company_roles ucr
          WHERE ucr.company_id = creator_assets.company_id
            AND ucr.user_id = auth.uid()
            AND ucr.status = 'active'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'creator_asset_attachments' AND policyname = 'creator_asset_attachments_company_members'
  ) THEN
    CREATE POLICY creator_asset_attachments_company_members ON public.creator_asset_attachments
      USING (
        EXISTS (
          SELECT 1 FROM public.user_company_roles ucr
          WHERE ucr.company_id = creator_asset_attachments.company_id
            AND ucr.user_id = auth.uid()
            AND ucr.status = 'active'
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.user_company_roles ucr
          WHERE ucr.company_id = creator_asset_attachments.company_id
            AND ucr.user_id = auth.uid()
            AND ucr.status = 'active'
        )
      );
  END IF;
END $$;
