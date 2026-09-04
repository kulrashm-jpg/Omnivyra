-- 2026-08-11 — PHASE A: Canonical Content Intelligence Foundation.
--
-- WHAT THIS IS
-- ------------
-- The canonical content spine + its memory/verdict/lineage surfaces. This is the
-- FOUNDATION ONLY. It contains no intelligence: no knowledge graph, no global
-- novelty layer, no idea/concept nodes, no embedding generation, no backfill.
-- Creating these tables does NOT mean uniqueness is implemented.
--
-- WHY IT IS AUTHORED FRESH RATHER THAN RE-USING 20260718000000/000001/000003
-- --------------------------------------------------------------------------
-- Those files were authored but NEVER APPLIED (verified: 0 of 16 of their tables
-- exist in production). Applying them as written would ship five defects that
-- production evidence disproves:
--
--   1. content.content_type CHECK rejects values production already stores
--      (poll x7, tweet x1, feed_post x1) and every creator/visual type
--      (357 creator_assets rows: infographic 141, carousel 123, image 69, ...).
--      → replaced by an EXTENSIBLE reference table.
--   2. content.lifecycle_status CHECK rejects 'planned' (56 daily_content_plans
--      rows) and 'failed' (2 scheduled_posts rows).
--      → replaced by the evidence-backed 8-state model below.
--   3. content_asset.asset_id was typed `uuid`, but creator_assets.id is TEXT and
--      0 of 357 production ids are UUID-shaped (lengths 32-65). A uuid column
--      could never hold a real asset id — and because the reference is soft, the
--      DDL would have succeeded and the column would be silently unusable.
--      → corrected to TEXT.
--   4. content_memory.embedding was `jsonb` with pgvector "deferred to Wave 3".
--      pgvector 0.8.0 IS installed in production with two working HNSW
--      vector(1536) indexes. Shipping jsonb would force a second migration over
--      a table that by then holds rows.
--      → vector(1536) + HNSW cosine + explicit model/version columns.
--   5. It created a NEW function set_content_updated_at(). Production already has
--      omnivyra_touch_updated_at() serving 60 triggers (25 updated_at functions
--      exist in total — this is the house convention).
--      → reuse the existing function; create triggers only.
--
-- Plus content.campaign_id, which the originals lacked entirely.
--
-- ADDITIVE + SAFE
-- ---------------
-- Creates only new objects. Alters no existing table, renames nothing, deletes
-- nothing, migrates no rows. Legacy roots (blogs, daily_content_plans,
-- scheduled_posts) are untouched and keep working exactly as they do today.
-- Idempotent (IF NOT EXISTS throughout) and fully reversible — see
-- supabase/migrations/rollbacks/phase_a_canonical_content_foundation_rollback.sql
--
-- ⚠ ACTIVATION — READ BEFORE EXECUTING (CORRECTIONS D + E)
-- --------------------------------------------------------
-- Installing this schema does NOT activate canonical persistence. Two
-- INDEPENDENT policies govern the two surfaces, and BOTH must be off for the
-- foundation to land inert:
--
--   CANONICAL_PERSISTENCE_ENABLED=false   ← artifact surface (default DENY)
--       governs content, content_revision, content_variant, content_asset,
--       publication_lineage via backend/services/content/
--       canonicalPersistencePolicy.ts
--
--   ORIGINALITY_GATE_ENABLED=false        ← intelligence surface (default ON!)
--       governs content_memory + content_originality at the post/thread call
--       sites. It DEFAULTS ON when unset and is NOT set in production.
--
-- INTENDED INERT INSTALLATION STATE:
--       CANONICAL_PERSISTENCE_ENABLED=false   (its default — nothing to set)
--       ORIGINALITY_GATE_ENABLED=false        (MUST be set explicitly)
--
-- Setting ONLY the persistence policy is NOT sufficient: with originality left
-- at its default, content_memory and content_originality would begin receiving
-- rows as soon as these tables exist, and the clean-DROP rollback property
-- would be lost.
--
-- Historical note: before the persistence policy existed, this schema WAS an
-- activation trigger — lib/post/runPostGeneration.ts and lib/thread/
-- runThreadGeneration.ts call createContent OUTSIDE the originality flag, so
-- ORIGINALITY_GATE_ENABLED=false alone never prevented `content` writes. The
-- policy closes that gap. Note also that /api/content, /api/content/[id],
-- /api/content/[id]/status, /api/content/[id]/variants and
-- /api/content/[id]/lineage currently FAIL against the missing tables and will
-- begin succeeding once persistence is enabled.
--
-- CORRECTION C — DB / TypeScript taxonomy: RESOLVED AS "DB INTENTIONALLY WIDER".
-- CanonicalContentType (lib/content/canonicalContent.ts) is the 5-value union
-- ('post','thread','blog','article','story') and is annotated "Mirrors the
-- content.content_type CHECK" — that annotation is now stale. The database
-- taxonomy is deliberately WIDER (21 canonical + 7 aliases) so a new format is
-- an INSERT rather than a migration. Permissive-DB / narrow-code is forward
-- compatible: the TS union is widened only when application code actually
-- handles a new type, which keeps exhaustive switches honest. No `as any` cast
-- is used anywhere to bridge the two.
--
-- APPLY: staging rehearsal FIRST (production schema-only clone), then production
-- via the controlled pooler-DDL process. The migration ledger is desynced —
-- do NOT db:push.

-- ── extension precondition (assert, do not create) ──────────────────────────
-- pgvector is already installed in production (0.8.0). This migration does NOT
-- create it: enabling an extension is a privileged, separately-reviewed action.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    RAISE EXCEPTION 'PHASE A PRECONDITION FAILED: pgvector extension is not installed';
  END IF;
  IF to_regclass('public.user_company_roles') IS NULL THEN
    RAISE EXCEPTION 'PHASE A PRECONDITION FAILED: user_company_roles is required by RLS policies';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'omnivyra_touch_updated_at'
  ) THEN
    RAISE EXCEPTION 'PHASE A PRECONDITION FAILED: omnivyra_touch_updated_at() is required for updated_at triggers';
  END IF;
END $$;

-- ── content_type — the extensible taxonomy ──────────────────────────────────
-- A reference table rather than a CHECK because the taxonomy is large (16+ live
-- values), spans two families, carries alias relationships, and grows whenever a
-- new format ships. A CHECK would require a foundation migration per format.
--
-- `alias_of` canonicalises without losing the original name. Seeds below are
-- taken from lib/shared/bolt/formatGovernance.ts (TEXT_FORMAT_ALIASES),
-- backend/utils/boltTextContentConfig.ts (BOLT_TEXT_CONTENT_TYPES),
-- utils/contentTaxonomy.ts (CREATOR_DEPENDENT_IDS) and the production
-- creator_assets.creator_type distribution.
CREATE TABLE IF NOT EXISTS public.content_type (
  id          text PRIMARY KEY,
  label       text NOT NULL,
  family      text NOT NULL CHECK (family IN ('text', 'creator')),
  -- Self-reference: a row is either canonical (alias_of IS NULL) or an alias.
  -- RESTRICT so a canonical type cannot be deleted while aliases point at it.
  alias_of    text REFERENCES public.content_type(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 100,
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.content_type IS
  'Canonical content format taxonomy. alias_of NULL = canonical format; otherwise an alias that normalises to alias_of.';

-- Canonical TEXT formats.
INSERT INTO public.content_type (id, label, family, sort_order) VALUES
  ('post',        'Post',           'text', 10),
  ('thread',      'Thread',         'text', 20),
  ('tweet',       'Tweet',          'text', 30),
  ('article',     'Article',        'text', 40),
  ('blog',        'Blog',           'text', 50),
  ('newsletter',  'Newsletter',     'text', 60),
  ('poll',        'Poll',           'text', 70),
  ('short_story', 'Short Story',    'text', 80),
  ('whitepaper',  'Whitepaper',     'text', 90),
  ('case_study',  'Case Study',     'text', 100),
  ('guide',       'Guide',          'text', 110),
  -- CORRECTION B (A1.1/A1.2) — `story` is TEXT canonical content, not creator.
  -- Evidence: CanonicalContentType is ('post','thread','blog','article','story');
  -- runStoryGeneration delegates to runManagedContentGeneration (text); the
  -- Wave-1 migration groups "Blogs/Articles/Stories" as adapter-backed text
  -- roots; and production holds 0 creator_assets with creator_type='story'.
  -- The `story` in CREATOR_DEPENDENT_IDS is the Instagram/Facebook PLACEMENT —
  -- a presentation, expressed as a content_variant with platform='instagram',
  -- NOT a content format. Do not add a creator-family 'story'.
  ('story',       'Story',          'text', 120)
ON CONFLICT (id) DO NOTHING;

-- Canonical CREATOR / VISUAL formats. Production creator_assets.creator_type
-- counts at authoring time: infographic 141, carousel 123, image 69,
-- brand_card 14, supporting_image 5, pdf 3, banner 2.
INSERT INTO public.content_type (id, label, family, sort_order) VALUES
  ('image',            'Image',            'creator', 200),
  ('infographic',      'Infographic',      'creator', 210),
  ('carousel',         'Carousel',         'creator', 220),
  ('brand_card',       'Brand Card',       'creator', 230),
  ('supporting_image', 'Supporting Image', 'creator', 240),
  ('pdf',              'PDF',              'creator', 250),
  ('banner',           'Banner',           'creator', 260),
  ('video',            'Video',            'creator', 270),
  ('reel',             'Reel',             'creator', 280)
  -- NOTE: no creator-family 'story' — see CORRECTION B above.
ON CONFLICT (id) DO NOTHING;

-- Aliases — EXACTLY as defined by TEXT_FORMAT_ALIASES in formatGovernance.ts.
-- NOTE: `tweet` is deliberately NOT an alias of `post`. The repository makes it
-- the alias TARGET of twitter_post / x_post / microblog, so it is canonical.
INSERT INTO public.content_type (id, label, family, alias_of, sort_order) VALUES
  ('feed_post',     'Feed Post',      'text', 'post',        900),
  ('linkedin_post', 'LinkedIn Post',  'text', 'post',        901),
  ('twitter_post',  'Twitter Post',   'text', 'tweet',       902),
  ('x_post',        'X Post',         'text', 'tweet',       903),
  ('microblog',     'Microblog',      'text', 'tweet',       904),
  ('shortstory',    'Shortstory',     'text', 'short_story', 905),
  ('blog_article',  'Blog Article',   'text', 'article',     906)
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS content_type_family_active_idx
  ON public.content_type (family, is_active, sort_order);

-- ── content — the canonical content root ────────────────────────────────────
-- ONE row per piece of content. Platform adaptations are children
-- (content_variant), never new roots.
CREATE TABLE IF NOT EXISTS public.content (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL,
  -- Nullable BY DESIGN: production contains legitimate standalone content
  -- (17 of 24 scheduled_posts carry no campaign). No FK to campaigns — campaign
  -- deletion must not cascade away content, and 36 of 56 daily_content_plans
  -- already reference deleted campaigns.
  campaign_id      uuid,
  content_type     text NOT NULL REFERENCES public.content_type(id)
                     ON DELETE RESTRICT ON UPDATE CASCADE,
  -- CORRECTION A (A1.1/A1.2) — the canonical NINE. This CHECK must mirror
  -- ContentLifecycleStatus in lib/content/canonicalContent.ts and the
  -- canTransition() FSM in lib/content/contentLifecycle.ts, which are the ONLY
  -- writers of this column:
  --   draft → generated → edited → [quality_reviewed] → approved → adapted
  --         → scheduled → published → archived
  --
  -- An earlier draft of this file derived the vocabulary from the LEGACY tables
  -- (planned / review / failed). That was wrong: every createContent() call site
  -- writes lifecycleStatus 'generated', which such a CHECK REJECTS — canonical
  -- inserts would have failed 100% of the time, silently, because every caller
  -- is fail-open. Legacy vocabularies are already folded in by mapLegacyStatus()
  -- + LEGACY_STATUS_MAPS (e.g. scheduled_post 'failed' → 'scheduled', "awaiting
  -- retry; the lifecycle has no failure terminal in Wave 1"), so 'planned',
  -- 'review' and 'failed' must NOT appear here.
  lifecycle_status text NOT NULL DEFAULT 'draft'
                     CHECK (lifecycle_status IN ('draft','generated','edited','quality_reviewed','approved','adapted','scheduled','published','archived')),
  title            text,
  body             text,
  topic            text,
  objective        text,
  audience         text,
  tone             text,
  brief            jsonb,
  source_metadata  jsonb,
  -- Adapter link for legacy roots that are NOT copied into this table
  -- (blogs/articles/stories): {"table":"blogs","id":"..."}. This is how legacy
  -- content is adopted WITHOUT migrating rows.
  source_ref       jsonb,
  current_revision integer NOT NULL DEFAULT 1,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz
);
COMMENT ON TABLE public.content IS
  'Canonical content root. Legacy tables (blogs/daily_content_plans/scheduled_posts) remain authoritative for their own rows and are adopted via source_ref, not copied.';

-- Consumer: company content lists / workspace (most common read).
CREATE INDEX IF NOT EXISTS content_company_updated_idx
  ON public.content (company_id, updated_at DESC) WHERE archived_at IS NULL;
-- Consumer: campaign assembly — "all content for this campaign".
CREATE INDEX IF NOT EXISTS content_company_campaign_idx
  ON public.content (company_id, campaign_id) WHERE campaign_id IS NOT NULL;
-- Consumer: filtered workspace views (type + lifecycle facets).
CREATE INDEX IF NOT EXISTS content_company_type_status_idx
  ON public.content (company_id, content_type, lifecycle_status);
-- Consumer: the legacy adapter — one canonical row per source row, idempotent upsert.
CREATE UNIQUE INDEX IF NOT EXISTS content_source_ref_uidx
  ON public.content ((source_ref->>'table'), (source_ref->>'id')) WHERE source_ref IS NOT NULL;

-- ── content_variant — platform adaptations as CHILDREN ──────────────────────
CREATE TABLE IF NOT EXISTS public.content_variant (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- CASCADE: a variant has no meaning without its parent.
  content_id          uuid NOT NULL REFERENCES public.content(id) ON DELETE CASCADE ON UPDATE CASCADE,
  company_id          uuid NOT NULL,          -- denormalised for single-row RLS
  platform            text NOT NULL,
  source_version      integer NOT NULL DEFAULT 1,
  generated_content   text,
  edited_content      text,                   -- user edits kept separate from AI output
  adaptation_metadata jsonb,
  approval_state      text NOT NULL DEFAULT 'draft'
                        CHECK (approval_state IN ('draft','approved','rejected')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
-- One current variant per (content, platform): re-adapting updates in place.
CREATE UNIQUE INDEX IF NOT EXISTS content_variant_content_platform_uidx
  ON public.content_variant (content_id, platform);
CREATE INDEX IF NOT EXISTS content_variant_company_idx ON public.content_variant (company_id);

-- ── content_asset — association to creator assets ───────────────────────────
-- asset_id is TEXT, not uuid: creator_assets.id is TEXT and 0 of 357 production
-- ids are UUID-shaped. Deliberately a SOFT reference (no FK) so the asset library
-- stays decoupled and asset deletion never cascades into content.
CREATE TABLE IF NOT EXISTS public.content_asset (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id  uuid NOT NULL REFERENCES public.content(id) ON DELETE CASCADE ON UPDATE CASCADE,
  variant_id  uuid REFERENCES public.content_variant(id) ON DELETE SET NULL ON UPDATE CASCADE,
  company_id  uuid NOT NULL,          -- own column: RLS must not require a join
  asset_id    text NOT NULL,          -- soft ref → creator_assets.id (TEXT)
  role        text NOT NULL DEFAULT 'primary',
  version     integer NOT NULL DEFAULT 1,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_asset_content_idx ON public.content_asset (content_id);
CREATE INDEX IF NOT EXISTS content_asset_company_idx ON public.content_asset (company_id);
CREATE UNIQUE INDEX IF NOT EXISTS content_asset_unique_link_uidx
  ON public.content_asset (content_id, asset_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid), version);

-- ── content_revision — autosave / undo snapshots ────────────────────────────
-- RETENTION IS DEFERRED: this table grows unbounded by design in Phase A. A
-- retention policy is required before it is written at volume (later phase).
CREATE TABLE IF NOT EXISTS public.content_revision (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id    uuid NOT NULL REFERENCES public.content(id) ON DELETE CASCADE ON UPDATE CASCADE,
  company_id    uuid NOT NULL,        -- denormalised for RLS
  revision      integer NOT NULL,
  revision_type text NOT NULL CHECK (revision_type IN ('generated','autosave','manual','pre_adapt','pre_publish')),
  snapshot      jsonb NOT NULL,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS content_revision_content_rev_uidx
  ON public.content_revision (content_id, revision);
CREATE INDEX IF NOT EXISTS content_revision_content_recent_idx
  ON public.content_revision (content_id, revision DESC);

-- ── content_memory — the comparison surface ─────────────────────────────────
-- What the originality gate queries. content_id is a SOFT ref (nullable): BOLT
-- campaign content has no canonical content.id yet, so memory must be able to
-- exist without one.
CREATE TABLE IF NOT EXISTS public.content_memory (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL,
  campaign_id       uuid,                 -- enables per-campaign repetition checks
  content_id        uuid,                 -- soft ref → content.id
  content_type      text,
  platform          text,                 -- NULL = master; set = platform variant
  lifecycle_status  text,
  -- Staged duplicate-detection fingerprints (cheap → expensive).
  exact_hash        text NOT NULL,
  normalized_hash   text NOT NULL,
  simhash           text NOT NULL,
  minhash           jsonb,
  structural_shape  text,
  token_summary     jsonb,
  -- Semantic axis. vector(1536) matches the production convention already proven
  -- on intelligence_signals / signal_clusters. Model + version are REQUIRED
  -- alongside it: without them a model upgrade silently invalidates every stored
  -- comparison, and mixed-generation vectors become undetectable.
  embedding         vector(1536),
  embedding_model   text,
  embedding_version integer,
  intelligence      jsonb,                -- {hooks[], ctas[], narratives[], keyMessages[]}
  text_excerpt      text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN public.content_memory.embedding IS
  'Nullable. Phase A creates the column only — no embeddings are generated. Always filter comparisons by (embedding_model, embedding_version).';

-- Consumer: retrieveRelevant() default candidate fetch (company, recent-first).
CREATE INDEX IF NOT EXISTS content_memory_company_created_idx
  ON public.content_memory (company_id, created_at DESC);
-- Consumer: campaign-scoped comparison (EC-R2 week N vs weeks 1..N-1).
CREATE INDEX IF NOT EXISTS content_memory_company_campaign_idx
  ON public.content_memory (company_id, campaign_id) WHERE campaign_id IS NOT NULL;
-- Consumer: gate stage 1/2 — exact + normalized hash equality.
CREATE INDEX IF NOT EXISTS content_memory_company_exact_idx
  ON public.content_memory (company_id, exact_hash);
CREATE INDEX IF NOT EXISTS content_memory_company_normalized_idx
  ON public.content_memory (company_id, normalized_hash);
-- Consumer: lifecycle filter (committed statuses OR any platform variant).
CREATE INDEX IF NOT EXISTS content_memory_company_lifecycle_idx
  ON public.content_memory (company_id, lifecycle_status);
-- Consumer: artifact → memory lookup.
CREATE INDEX IF NOT EXISTS content_memory_content_idx
  ON public.content_memory (content_id) WHERE content_id IS NOT NULL;
-- Consumer: semantic stage. HNSW + cosine, mirroring idx_signal_embedding.
CREATE INDEX IF NOT EXISTS content_memory_embedding_hnsw_idx
  ON public.content_memory USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

-- ── content_originality — the verdict store ─────────────────────────────────
-- Written by EC-R2's persistOriginality(). The decision vocabulary matches the
-- OriginalityResult contract exactly (accepted | duplicate | regenerated |
-- bypassed | error). NO similarity logic lives in SQL — the gate is the engine.
CREATE TABLE IF NOT EXISTS public.content_originality (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL,
  content_id             uuid,               -- soft ref → content.id (nullable: BOLT has none yet)
  campaign_id            uuid,               -- which campaign the verdict was scoped to
  originality_score      numeric,            -- 0..1 (1 = fully original)
  decision               text NOT NULL DEFAULT 'accepted'
                           CHECK (decision IN ('accepted','duplicate','regenerated','bypassed','error')),
  threshold              numeric,            -- the threshold in force for this verdict
  nearest_matches        jsonb,              -- [{memoryId, score, dimension, excerpt}]
  similarity_dimensions  jsonb,              -- {exact, normalized, structural, semantic, embedding, variant}
  regeneration_count     integer NOT NULL DEFAULT 0,
  generation_fingerprint text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_originality_company_created_idx
  ON public.content_originality (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS content_originality_content_idx
  ON public.content_originality (content_id) WHERE content_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS content_originality_decision_idx
  ON public.content_originality (company_id, decision);

-- ── publication_lineage — append-only publication history ───────────────────
-- Rows are NEVER mutated: a repost/regeneration records a NEW event pointing at
-- parent_content_id, forming a reconstructable chain. Soft refs throughout —
-- scheduled_posts is a legacy root this foundation must not couple to.
CREATE TABLE IF NOT EXISTS public.publication_lineage (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL,
  content_id        uuid,                    -- soft ref → content.id
  variant_id        uuid,                    -- soft ref → content_variant.id
  parent_content_id uuid,                    -- regeneration / repost lineage
  event_type        text NOT NULL CHECK (event_type IN ('published','reposted','regenerated','revised','scheduled')),
  platform          text,
  scheduled_post_id uuid,                    -- soft ref → scheduled_posts.id (legacy root)
  external_post_id  text,                    -- platform-side identity
  metadata          jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS publication_lineage_content_idx
  ON public.publication_lineage (content_id, created_at DESC);
CREATE INDEX IF NOT EXISTS publication_lineage_company_idx
  ON public.publication_lineage (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS publication_lineage_parent_idx
  ON public.publication_lineage (parent_content_id) WHERE parent_content_id IS NOT NULL;

-- ── brand_memory — company-level reusable brand intelligence ────────────────
CREATE TABLE IF NOT EXISTS public.brand_memory (
  company_id        uuid PRIMARY KEY,
  voice             jsonb,
  terminology       jsonb,
  style             jsonb,
  audience          jsonb,
  campaign_themes   jsonb,
  messaging_history jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ── updated_at triggers — REUSE the house function ──────────────────────────
-- omnivyra_touch_updated_at() already exists and serves 60 production triggers.
-- It is NOT redefined here: CREATE OR REPLACE would rewrite a function those 60
-- triggers depend on. Triggers only.
DROP TRIGGER IF EXISTS content_touch_updated_at ON public.content;
CREATE TRIGGER content_touch_updated_at BEFORE UPDATE ON public.content
  FOR EACH ROW EXECUTE FUNCTION public.omnivyra_touch_updated_at();

DROP TRIGGER IF EXISTS content_variant_touch_updated_at ON public.content_variant;
CREATE TRIGGER content_variant_touch_updated_at BEFORE UPDATE ON public.content_variant
  FOR EACH ROW EXECUTE FUNCTION public.omnivyra_touch_updated_at();

DROP TRIGGER IF EXISTS content_memory_touch_updated_at ON public.content_memory;
CREATE TRIGGER content_memory_touch_updated_at BEFORE UPDATE ON public.content_memory
  FOR EACH ROW EXECUTE FUNCTION public.omnivyra_touch_updated_at();

DROP TRIGGER IF EXISTS content_originality_touch_updated_at ON public.content_originality;
CREATE TRIGGER content_originality_touch_updated_at BEFORE UPDATE ON public.content_originality
  FOR EACH ROW EXECUTE FUNCTION public.omnivyra_touch_updated_at();

DROP TRIGGER IF EXISTS brand_memory_touch_updated_at ON public.brand_memory;
CREATE TRIGGER brand_memory_touch_updated_at BEFORE UPDATE ON public.brand_memory
  FOR EACH ROW EXECUTE FUNCTION public.omnivyra_touch_updated_at();

-- ── RLS — company-scoped ────────────────────────────────────────────────────
-- Service role bypasses RLS (background workers keep working). Authenticated
-- users are scoped to their ACTIVE company memberships. content_type is
-- reference data: RLS enabled, readable by all authenticated users, writable
-- only by the service role.
ALTER TABLE public.content              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_variant      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_asset        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_revision     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_memory       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_originality  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publication_lineage  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_memory         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_type         ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  company_tables text[] := ARRAY[
    'content','content_variant','content_asset','content_revision',
    'content_memory','content_originality','publication_lineage','brand_memory'
  ];
BEGIN
  FOREACH t IN ARRAY company_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_company_rw'
    ) THEN
      EXECUTE format($f$
        CREATE POLICY %I ON public.%I
          USING (company_id IN (SELECT company_id FROM public.user_company_roles
                                 WHERE user_id = auth.uid() AND status = 'active'))
          WITH CHECK (company_id IN (SELECT company_id FROM public.user_company_roles
                                      WHERE user_id = auth.uid() AND status = 'active'))
      $f$, t || '_company_rw', t);
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'content_type' AND policyname = 'content_type_read_all'
  ) THEN
    CREATE POLICY content_type_read_all ON public.content_type FOR SELECT USING (true);
  END IF;
END $$;

-- ── PLATFORM-WIDE NOVELTY BOUNDARY (design note, no objects created) ────────
-- Every table above is COMPANY-PRIVATE and carries company_id (brand_memory
-- keys on it). The future global concept/saturation layer is NOT created here
-- and, when it is, must contain NO company_id, NO raw content, NO briefs and NO
-- per-artifact embeddings — only aggregated concept centroids, archetypes and
-- saturation counters above a minimum-cohort threshold. Nothing in this
-- migration requires a cross-tenant read, so that separation stays possible.
