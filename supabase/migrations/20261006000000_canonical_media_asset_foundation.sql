-- ============================================================================
-- Canonical Media Asset foundation
--
-- The Content Asset & Template audit found SEVEN different representations of
-- "an image" in this codebase, with two incompatible tenancy models and no
-- stable identity that survives reuse. This table is the canonical one. It is
-- ADDITIVE: nothing is migrated, redirected, dropped or backfilled here, and no
-- existing upload path is changed.
--
-- ─── WHY NOT `content_assets` (the name the audit proposed) ─────────────────
-- `content_assets` ALREADY EXISTS and means something else entirely: a campaign
-- CONTENT SLOT keyed (campaign_id, week_number, day, platform) with status and
-- current_version, read through backend/db/contentAssetStore.ts and referenced
-- by lead_attributions.asset_id. It holds no bytes and has no company_id.
-- Reusing that name would collide with a live concept, so the canonical media
-- asset is named for what it actually is.
--
-- ─── HOW THIS DIFFERS FROM THE FOUR NEIGHBOURS ─────────────────────────────
--   media_files          user-anchored (user_id, NO company_id) legacy uploads.
--                        Its tenancy IS row ownership — see mediaAuthorization.
--   creator_assets       company-anchored GENERATED creator output (rendered
--                        image/carousel/infographic), attachable to post/thread.
--   content_assets       campaign content slots (above). Not bytes.
--   cms_media_assets     per-CMS-connection upload mirror for publishing.
--   canonical_media_assets (THIS)
--                        one tenant-owned file, stable identity, reusable across
--                        any number of compositions.
--
-- ─── TENANCY IS EXPLICIT, AND IT IS THE COMPANY ────────────────────────────
-- company_id is NOT NULL. The audit found media_files anchored on user_id with
-- no company column, which forced "tenant == row owner". That equivalence is
-- exactly what this table refuses to inherit: `created_by` records WHO uploaded
-- for provenance and is deliberately NOT an authorization input. Authorization
-- reads company_id and nothing else.
--
-- ─── IDENTITY ──────────────────────────────────────────────────────────────
-- `id` is a generated uuid, independent of user, composition, template,
-- campaign, scheduled post, creator asset, URL and filename — every one of
-- which the audit found being used as de-facto identity somewhere. A canonical
-- asset must survive being reused in many compositions, so its identity cannot
-- be derived from any single use of it.
--
-- The storage object keeps its OWN stable identifier: (storage_bucket,
-- storage_path) is preserved verbatim rather than replaced by a second
-- invented one. The UNIQUE constraint over that pair stops two canonical rows
-- from claiming the same object, in either direction.
--
-- ─── NO USAGE SEMANTICS, DELIBERATELY ──────────────────────────────────────
-- There is no `usage`, `role`, `purpose`, `subject`, `background`, `overlay` or
-- `logo` column here, and there must not be one. The same uploaded photograph is
-- the subject in one composition, the background in another and a reference in a
-- third. Usage is a property of the RELATIONSHIP between an asset and a
-- composition, not of the asset, and the provider spike established that it also
-- ROUTES between deterministic composition and generative conditioning. Putting
-- it on the asset row would make one image unusable in a second role.
--
-- ─── LIFECYCLE IS THE MINIMUM THAT PREVENTS A HALF-UPLOAD BEING USED ────────
-- The existing direct-upload path is two-step (stream to storage, then finalize
-- verifies the object with a range request), so a row can legitimately exist
-- before its bytes are known-good. Three states express that and no more:
--   pending  row exists, object not yet verified — consumers MUST NOT use it
--   ready    verified, usable
--   failed   upload or verification failed — terminal
-- The existing CREATOR_LIFECYCLE_STATES vocabulary (awaiting_media_upload /
-- media_uploaded / ready_for_schedule / scheduled) is deliberately NOT reused:
-- it describes a daily_content_plans ROW moving toward publication, not a file
-- becoming readable. Borrowing those names would conflate the two lifecycles.
--
-- ─── SAFE BY CONSTRUCTION ──────────────────────────────────────────────────
-- Every statement is IF NOT EXISTS / idempotent. No existing table is altered,
-- no data is migrated, no trigger is installed, no policy on another table is
-- touched. Dropping this table would return the schema to its prior state.
--
-- APPLY via the controlled process (Supabase SQL editor / single targeted
-- migration) — NOT `supabase db push` (prod ledger is hand-managed).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.canonical_media_assets (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenant anchor. Authorization reads THIS column, never created_by.
  company_id        uuid        NOT NULL,
  -- Provenance only: who uploaded it. Nullable because system-generated assets
  -- have no human uploader. NEVER an authorization input.
  created_by        uuid        NULL,

  -- The storage object's own stable identifier, preserved rather than replaced.
  storage_bucket    text        NOT NULL,
  storage_path      text        NOT NULL,

  mime_type         text        NOT NULL,
  -- Nullable: known only after the bytes are measured. Absent means absent.
  byte_size         bigint      NULL,
  width             integer     NULL,
  height            integer     NULL,
  checksum_sha256   text        NULL,
  -- Trace only. Explicitly NOT identity — filenames collide and change.
  original_filename text        NULL,
  -- Where the bytes came from when they were fetched from elsewhere (a stock
  -- provider or an external link). Provenance, not identity, not a live source:
  -- a canonical asset always resolves through storage_bucket/storage_path.
  source_url        text        NULL,

  -- Provenance. Each value corresponds to a flow that exists TODAY:
  --   upload    a user uploaded the file (media/upload, workspace upload-media)
  --   generated the platform rendered it (creator render pipeline)
  --   stock     chosen from stock search (ImagePicker -> searchStockImages)
  --   external  supplied as an external link (upload-media source=external_link)
  -- No speculative values: nothing here is added because it "sounds useful".
  origin            text        NOT NULL
                      CHECK (origin IN ('upload', 'generated', 'stock', 'external')),

  lifecycle_state   text        NOT NULL DEFAULT 'pending'
                      CHECK (lifecycle_state IN ('pending', 'ready', 'failed')),

  -- Trace/diagnostic only. Application semantics must NOT be encoded here —
  -- that is the failure mode this table exists to end.
  metadata          jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- One canonical row per storage object, globally. Object paths already embed
  -- the company, so this also stops one tenant registering another's object.
  CONSTRAINT canonical_media_assets_storage_unique UNIQUE (storage_bucket, storage_path)
);

-- Listing a company's assets, newest first — the only read shape this phase has.
CREATE INDEX IF NOT EXISTS idx_canonical_media_assets_company
  ON public.canonical_media_assets(company_id, created_at DESC);

-- Usable-assets-only reads, which are the common case for any future picker.
CREATE INDEX IF NOT EXISTS idx_canonical_media_assets_company_state
  ON public.canonical_media_assets(company_id, lifecycle_state);

ALTER TABLE public.canonical_media_assets ENABLE ROW LEVEL SECURITY;

-- Same membership predicate creator_assets uses — active role in the owning
-- company. Introduces no new authorization concept.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'canonical_media_assets'
      AND policyname = 'canonical_media_assets_company_members'
  ) THEN
    CREATE POLICY canonical_media_assets_company_members ON public.canonical_media_assets
      USING (
        EXISTS (
          SELECT 1 FROM public.user_company_roles ucr
          WHERE ucr.company_id = canonical_media_assets.company_id
            AND ucr.user_id = auth.uid()
            AND ucr.status = 'active'
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.user_company_roles ucr
          WHERE ucr.company_id = canonical_media_assets.company_id
            AND ucr.user_id = auth.uid()
            AND ucr.status = 'active'
        )
      );
  END IF;
END $$;

COMMENT ON TABLE public.canonical_media_assets IS
  'Canonical tenant-owned media asset: one file, stable uuid identity, reusable across many compositions. Distinct from media_files (user-anchored legacy uploads), creator_assets (generated creator output), content_assets (campaign content slots) and cms_media_assets (per-connection publish mirror). Carries NO usage/role semantics by design — usage belongs to the asset-to-composition relationship.';

COMMENT ON COLUMN public.canonical_media_assets.company_id IS
  'Tenant anchor and the ONLY authorization input.';

COMMENT ON COLUMN public.canonical_media_assets.created_by IS
  'Provenance only — who uploaded. Never an authorization input; company_id decides access.';

COMMENT ON COLUMN public.canonical_media_assets.lifecycle_state IS
  'pending = bytes not yet verified, consumers must not use; ready = usable; failed = terminal. Distinct from CREATOR_LIFECYCLE_STATES, which tracks a content-plan row toward publication, not a file becoming readable.';
