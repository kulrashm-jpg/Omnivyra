-- ============================================================================
-- Composition Asset Reference — how a canonical asset is USED
--
-- Phase 43 added `canonical_media_assets`: what a file IS. It carries no usage
-- semantics on purpose, because the same photograph is the subject of one
-- composition, the background of another and an overlay in a third. This table
-- is the other half of that decision — the typed relationship that records how
-- one asset is used in one composition, so a single stored file can serve many
-- roles without being duplicated.
--
--   ASSET     = what the file is       (canonical_media_assets)
--   REFERENCE = how it is used here    (this table)
--
-- ─── CROSS-TENANT REFERENCE IS STRUCTURALLY IMPOSSIBLE ─────────────────────
-- The foreign key is COMPOSITE — (company_id, asset_id) onto
-- (company_id, id) — not a plain asset_id FK. A plain FK would happily let
-- company B reference company A's asset and leave the tenant boundary resting
-- entirely on application code remembering to check. With the composite key the
-- database itself refuses: to reference an asset you must name the company that
-- owns it, and the row you are writing carries that same company_id.
--
-- That requires a UNIQUE (company_id, id) on the parent, added below. It is
-- additive — `id` remains the primary key and the sole identity; the extra
-- constraint only makes the pair a legal FK target. No column changes, and no
-- usage semantics are added to the asset.
--
-- ─── MODE IS A GUARANTEE, NOT A STYLE ──────────────────────────────────────
--   compose    supplied pixels preserved, placed deterministically, no
--              generative reinterpretation. What an exact brand mark needs.
--   condition  the asset becomes model input; reinterpretation is expected and
--              there is NO identity or pixel-exact guarantee.
-- These route to different machinery later. Collapsing them would let a user
-- ask for "my logo" and silently receive a reinterpreted one, so the column is
-- typed and CHECKed rather than buried in jsonb.
--
-- ─── PURPOSE IS ONE VOCABULARY, NOT TWO ────────────────────────────────────
-- The eight provider values (logo … realism_reference) are the existing
-- ReferenceImagePurpose union, mirrored here so the CHECK can enforce them; the
-- four composition values (subject / background / overlay / product) are the
-- roles a user actually picks when uploading, which the provider vocabulary
-- cannot express. `product` is deliberately distinct from `product_screenshot`:
-- one is a photograph, the other is UI. The TypeScript contract binds the two
-- sets with a compile-time exhaustiveness guard so they cannot drift apart.
--
-- ─── ORDERING ──────────────────────────────────────────────────────────────
-- `ordinal` permits ties. A UNIQUE (composition, ordinal) would force every
-- reorder to route through temporary values to dodge the constraint, which is a
-- real ergonomic cost for no correctness gain: determinism is achieved by the
-- READ applying a total order of (ordinal, created_at, id), which is tested.
--
-- ─── ADDITIVE AND INERT ────────────────────────────────────────────────────
-- Nothing reads these rows yet. The provider seam is untouched, no existing
-- flow is redirected, no data is migrated, and media_files / creator_assets /
-- creator_asset_attachments / daily_content_plans are not referenced here.
--
-- APPLY via the controlled process (Supabase SQL editor / single targeted
-- migration) — NOT `supabase db push` (prod ledger is hand-managed).
-- ============================================================================

-- ── Make (company_id, id) a legal composite FK target on the parent ─────────
-- ADD CONSTRAINT has no IF NOT EXISTS in Postgres, so guard on pg_constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'canonical_media_assets_company_id_key'
      AND conrelid = 'public.canonical_media_assets'::regclass
  ) THEN
    ALTER TABLE public.canonical_media_assets
      ADD CONSTRAINT canonical_media_assets_company_id_key UNIQUE (company_id, id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.composition_asset_references (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenant anchor. Must equal the referenced asset's company — enforced by the
  -- composite FK below, not by convention.
  company_id        uuid        NOT NULL,

  -- What owns this composition. There is no canonical composition table yet
  -- (composition state still lives in creator_card jsonb,
  -- daily_content_plans.content and others), so the owner is identified the way
  -- creator_asset_attachments already identifies its own: a type plus an id.
  composition_type  text        NOT NULL,
  composition_id    text        NOT NULL,

  -- The canonical asset. Never a URL, never a storage path: storage location is
  -- not identity and must never be an authorization input.
  asset_id          uuid        NOT NULL,

  purpose           text        NOT NULL
                      CHECK (purpose IN (
                        -- provider vocabulary (ReferenceImagePurpose)
                        'logo', 'favicon', 'dashboard', 'ui_surface',
                        'product_screenshot', 'style_reference',
                        'composition_reference', 'realism_reference',
                        -- composition vocabulary (user-chosen roles)
                        'subject', 'background', 'overlay', 'product'
                      )),

  mode              text        NOT NULL
                      CHECK (mode IN ('compose', 'condition')),

  ordinal           integer     NOT NULL DEFAULT 0 CHECK (ordinal >= 0),

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- Tenant-safe composite FK: naming the asset requires naming its owner.
  CONSTRAINT composition_asset_references_asset_fk
    FOREIGN KEY (company_id, asset_id)
    REFERENCES public.canonical_media_assets (company_id, id)
    ON DELETE CASCADE,

  -- One asset may serve two DIFFERENT roles in the same composition (a mark
  -- used both as overlay and as style reference is legitimate), so the
  -- uniqueness key includes purpose. What it forbids is the meaningless exact
  -- duplicate: same composition, same asset, same role.
  CONSTRAINT composition_asset_references_unique
    UNIQUE (composition_type, composition_id, asset_id, purpose)
);

-- The primary read: every reference for one composition, in order.
CREATE INDEX IF NOT EXISTS idx_composition_asset_references_composition
  ON public.composition_asset_references(company_id, composition_type, composition_id, ordinal);

-- The reverse read: where is this asset used? Needed before an asset can ever
-- be safely retired, and it is why identity had to survive reuse.
CREATE INDEX IF NOT EXISTS idx_composition_asset_references_asset
  ON public.composition_asset_references(company_id, asset_id);

ALTER TABLE public.composition_asset_references ENABLE ROW LEVEL SECURITY;

-- Same membership predicate canonical_media_assets and creator_assets use.
-- No new authorization concept is introduced.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'composition_asset_references'
      AND policyname = 'composition_asset_references_company_members'
  ) THEN
    CREATE POLICY composition_asset_references_company_members
      ON public.composition_asset_references
      USING (
        EXISTS (
          SELECT 1 FROM public.user_company_roles ucr
          WHERE ucr.company_id = composition_asset_references.company_id
            AND ucr.user_id = auth.uid()
            AND ucr.status = 'active'
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.user_company_roles ucr
          WHERE ucr.company_id = composition_asset_references.company_id
            AND ucr.user_id = auth.uid()
            AND ucr.status = 'active'
        )
      );
  END IF;
END $$;

COMMENT ON TABLE public.composition_asset_references IS
  'How a canonical media asset is USED in one composition. The asset itself stays usage-neutral so one file can be subject here, background there and overlay elsewhere without duplication. Cross-tenant reference is structurally impossible via the composite FK onto (company_id, id).';

COMMENT ON COLUMN public.composition_asset_references.mode IS
  'compose = supplied pixels preserved, deterministic placement, no generative reinterpretation. condition = asset becomes model input, reinterpretation expected, NO identity or pixel-exact guarantee. A guarantee, not a style.';

COMMENT ON COLUMN public.composition_asset_references.purpose IS
  'One vocabulary: the eight provider ReferenceImagePurpose values plus the four user-chosen composition roles. product (a photograph) is distinct from product_screenshot (UI).';

COMMENT ON COLUMN public.composition_asset_references.ordinal IS
  'Ordering within a composition. Ties permitted; the read applies a total order of (ordinal, created_at, id).';
