-- ============================================================================
-- B7.1 — CONTENT KNOWLEDGE GRAPH FOUNDATION
--   public.platform_topic_node      canonical topic identity   (PLATFORM, tenant-less)
--   public.company_topic_coverage   what a company has covered (COMPANY, RLS-scoped)
-- ============================================================================
--
-- B7.0 resolved topic authority. Seven columns in this repository already hold a
-- "topic" string (intelligence_signals.topic, signal_clusters.cluster_topic,
-- strategic_themes.theme_title, content_opportunities.topic,
-- campaign_topic_map.topic, daily_content_plans.topic, content.topic) and NONE
-- of them can serve as canonical identity:
--
--   · signal_clusters was the strongest candidate but its identity domain is
--     bounded by signal ingestion — createClusterAndAssign() requires at least
--     one signal, so a topic no market signal ever mentioned cannot exist there.
--     It remains a CANDIDATE PRODUCER that resolves INTO this table.
--   · campaign_topic_map / daily_content_plans die with their campaign/week.
--   · content.topic is per-artifact free text.
--   · strategic_themes is the THEME layer (momentum, trend direction), which is
--     measured AGAINST a stable topic — it cannot be the stable topic.
--
-- This table is therefore the RESOLVER for the other seven, not a competitor:
-- none of them is deprecated, altered, or migrated by this file.
--
-- ── B7.1 IS FOUNDATION ONLY ────────────────────────────────────────────────
-- Two tables. No service, no writer, no runtime wiring, no AI behaviour, no
-- flag consumption — B7.2 owns all of that. Nothing in the application reads or
-- writes these tables after this migration, so the system is inert by
-- construction rather than by flag.
--
-- ADDITIVE ONLY: no existing table, column, index, policy, trigger, function or
-- extension is created, altered or dropped.
-- Rollback: supabase/migrations/rollbacks/content_knowledge_graph_foundation_rollback.sql
-- ============================================================================

BEGIN;

-- Already installed in production (content_memory.embedding, signal_clusters
-- .topic_embedding). Present here only so a clean-room rehearsal can apply.
CREATE EXTENSION IF NOT EXISTS vector;

-- ── 1. platform_topic_node — PLATFORM scope, tenant-less ───────────────────
--
-- WHY THERE IS NO TENANT COLUMN
-- Isolation is enforced by the ABSENCE of columns, not by query discipline.
-- There is no company_id/campaign_id/content_id/user_id and no content text, so
-- no row can be attributed to a tenant and none can be reconstructed into
-- content. This is the same posture proven for platform_content_fingerprint
-- (B5) and it removes, by construction, the class of defect B4.3 closed across
-- seven routes (authorized company ≠ acted-upon company).
--
-- WHAT MAY LIVE HERE
-- Abstract semantic identity only: labels, an embedding, alias/hierarchy links,
-- and a platform-wide occurrence total. The test each column must pass is
-- whether it could appear in an industry report without naming anyone.
-- occurrence_count passes because it is a single global total with NO
-- per-company breakdown — that breakdown lives in company_topic_coverage and
-- never crosses upward.
CREATE TABLE IF NOT EXISTS public.platform_topic_node (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Display form, and the uniqueness key it normalizes to. normalized_label is
  -- what makes "one identity per subject" enforceable at the database level.
  canonical_label    text NOT NULL,
  normalized_label   text NOT NULL,

  -- ALIAS: a row whose canonical_topic_id is set IS an alias of that row.
  -- Modelled as a self-reference rather than an array or a second table so that
  -- (a) the single UNIQUE(normalized_label) below guarantees a label can never
  -- resolve to two identities, (b) every alias carries its OWN
  -- state/confidence/source, and (c) merging two identities is one UPDATE and
  -- is reversible because nothing is deleted.
  canonical_topic_id uuid REFERENCES public.platform_topic_node(id) ON DELETE SET NULL,

  -- HIERARCHY: child_of. Curation-only — hierarchy is a judgement
  -- ("lead scoring ⊂ lead qualification") that embedding distance cannot
  -- express. B7.1 ships the column with NO writer; adjacency is deliberately
  -- NOT stored (it is derived from embedding proximity via the HNSW index
  -- below, so it can never go stale).
  parent_topic_id    uuid REFERENCES public.platform_topic_node(id) ON DELETE SET NULL,

  -- Semantic axis. vector(1536) + HNSW cosine matches the convention already in
  -- production on content_memory and platform_content_fingerprint. model and
  -- version are stored because comparing vectors across model generations is
  -- silently meaningless; a future comparator MUST skip on mismatch.
  embedding          vector(1536),
  embedding_model    text,
  embedding_version  integer,

  -- PROVENANCE — the existing vocabulary from
  -- backend/services/companyProfile/companyKnowledgeGraph.ts, reused verbatim.
  -- No second taxonomy is introduced. An AI-proposed identity is intended to
  -- land as state='inferred', source='ai_suggestion' and is NEVER authoritative;
  -- promotion to 'confirmed' is deterministic or human. B7.1 stores the
  -- contract only — it implements no AI behaviour.
  state              text NOT NULL DEFAULT 'observed'
                       CHECK (state IN ('unknown','observed','inferred','confirmed','corrected')),
  confidence         text NOT NULL DEFAULT 'none'
                       CHECK (confidence IN ('none','low','medium','high')),
  source             text,

  -- Platform-wide total. Never returned per-company; never exposed to a client.
  occurrence_count   integer NOT NULL DEFAULT 1,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz NOT NULL DEFAULT now(),

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- A row cannot be its own alias or its own parent. These are the only
  -- self-reference constraints evidence supports; deeper cycle detection is a
  -- service concern and is deliberately not invented here.
  CONSTRAINT platform_topic_node_not_self_alias  CHECK (canonical_topic_id IS NULL OR canonical_topic_id <> id),
  CONSTRAINT platform_topic_node_not_self_parent CHECK (parent_topic_id    IS NULL OR parent_topic_id    <> id)
);

-- ONE identity per normalized label. This single constraint is what makes the
-- alias model safe: an alias row cannot collide with its canonical, and no two
-- identities can claim the same subject string.
CREATE UNIQUE INDEX IF NOT EXISTS platform_topic_node_normalized_uidx
  ON public.platform_topic_node (normalized_label);

-- Alias / hierarchy traversal.
CREATE INDEX IF NOT EXISTS platform_topic_node_canonical_idx
  ON public.platform_topic_node (canonical_topic_id) WHERE canonical_topic_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS platform_topic_node_parent_idx
  ON public.platform_topic_node (parent_topic_id) WHERE parent_topic_id IS NOT NULL;

-- Derived adjacency (no stored edges) + future semantic resolution.
CREATE INDEX IF NOT EXISTS platform_topic_node_embedding_idx
  ON public.platform_topic_node USING hnsw (embedding vector_cosine_ops);

-- Staleness / retention sweeps.
CREATE INDEX IF NOT EXISTS platform_topic_node_last_seen_idx
  ON public.platform_topic_node (last_seen_at);

-- ── 2. company_topic_coverage — COMPANY scope ──────────────────────────────
--
-- What a company has covered, how often, how recently. This is the seam that
-- does not exist anywhere today: accepted content currently contributes to
-- brand_memory (four capped string arrays with silent eviction and no rebuild
-- path) and nothing else.
--
-- SOFT REFERENCES (no FKs to content / campaigns / platform_topic_node):
-- deleting an artifact or a campaign must never cascade knowledge away. This is
-- the same rationale already recorded for content.campaign_id, where 36 of 56
-- production daily_content_plans already reference deleted campaigns.
--
-- FULLY REBUILDABLE from content + content_memory + topic resolution — see the
-- rebuild contract at the end of this file.
CREATE TABLE IF NOT EXISTS public.company_topic_coverage (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  company_id        uuid NOT NULL,
  topic_id          uuid NOT NULL,          -- soft ref → platform_topic_node.id
  content_id        uuid,                   -- soft ref → content.id
  campaign_id       uuid,                   -- soft ref → campaigns.id
  -- The ANGLE axis. Nullable because B7.1 ships NO extractor: B7 established
  -- that content_memory.intelligence.narratives has never been evaluated for
  -- cross-artifact comparability, and inventing an angle without that
  -- measurement would be inventing semantics. Part of the uniqueness key so a
  -- second angle on the same topic is a distinct coverage row, not a collision.
  angle_label       text,

  coverage_count    integer NOT NULL DEFAULT 1,
  first_covered_at  timestamptz NOT NULL DEFAULT now(),
  last_covered_at   timestamptz NOT NULL DEFAULT now(),

  -- Same provenance vocabulary. Coverage is a deterministic MEASUREMENT, so it
  -- is expected to be 'observed' — never AI-asserted.
  state             text NOT NULL DEFAULT 'observed'
                      CHECK (state IN ('unknown','observed','inferred','confirmed','corrected')),
  confidence        text NOT NULL DEFAULT 'none'
                      CHECK (confidence IN ('none','low','medium','high')),
  source            text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Idempotent expansion: re-covering the same (company, topic, angle) must
-- increment, never insert a second row.
-- NULLS NOT DISTINCT so a NULL angle_label collides with itself — without it,
-- every un-angled acceptance would create a new row and coverage_count would
-- never rise above 1.
CREATE UNIQUE INDEX IF NOT EXISTS company_topic_coverage_uidx
  ON public.company_topic_coverage (company_id, topic_id, angle_label) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS company_topic_coverage_recent_idx
  ON public.company_topic_coverage (company_id, last_covered_at DESC);
CREATE INDEX IF NOT EXISTS company_topic_coverage_topic_idx
  ON public.company_topic_coverage (topic_id);

-- ── 3. Security ────────────────────────────────────────────────────────────
--
-- platform_topic_node: RLS ENABLED WITH ZERO POLICIES, deliberately.
-- Under PostgreSQL this denies every row to every non-owner, non-superuser role
-- — including anon and authenticated — EVEN IF table GRANTs are present. There
-- is no company_id to scope by, so the Phase A company policy is inapplicable,
-- and unlike public.content_type (FOR SELECT USING (true)) this is not public
-- reference data. Access is service-role only, via the future topic-resolution
-- service; no route, admin endpoint or MCP tool reads it.
ALTER TABLE public.platform_topic_node ENABLE ROW LEVEL SECURITY;

-- company_topic_coverage: the Phase A company-scoped policy, verbatim.
ALTER TABLE public.company_topic_coverage ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'company_topic_coverage'
       AND policyname = 'company_topic_coverage_company_rw'
  ) THEN
    CREATE POLICY company_topic_coverage_company_rw ON public.company_topic_coverage
      USING (company_id IN (SELECT company_id FROM public.user_company_roles
                             WHERE user_id = auth.uid() AND status = 'active'))
      WITH CHECK (company_id IN (SELECT company_id FROM public.user_company_roles
                                  WHERE user_id = auth.uid() AND status = 'active'));
  END IF;
END $$;

-- ── 4. Triggers ────────────────────────────────────────────────────────────
-- House convention: omnivyra_touch_updated_at() serves 60 production triggers.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'platform_topic_node_touch_updated_at'
       AND tgrelid = 'public.platform_topic_node'::regclass
  ) THEN
    CREATE TRIGGER platform_topic_node_touch_updated_at
      BEFORE UPDATE ON public.platform_topic_node
      FOR EACH ROW EXECUTE FUNCTION public.omnivyra_touch_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'company_topic_coverage_touch_updated_at'
       AND tgrelid = 'public.company_topic_coverage'::regclass
  ) THEN
    CREATE TRIGGER company_topic_coverage_touch_updated_at
      BEFORE UPDATE ON public.company_topic_coverage
      FOR EACH ROW EXECUTE FUNCTION public.omnivyra_touch_updated_at();
  END IF;
END $$;

-- ── 5. Documentation ───────────────────────────────────────────────────────
COMMENT ON TABLE public.platform_topic_node IS
  'B7 canonical topic identity (PLATFORM scope). Tenant-less by design: no '
  'company_id/campaign_id/content_id/user_id and no content text — isolation is '
  'enforced by the absence of those columns. RLS enabled with NO policy: '
  'service-role only, never reachable from a client API. AUTHORITATIVE, NOT '
  'derivable — identity resolution is a judgement and cannot be recomputed from '
  'content; this table requires backup, not rebuild.';

COMMENT ON TABLE public.company_topic_coverage IS
  'B7 company topic coverage (COMPANY scope, RLS via user_company_roles). '
  'DERIVED and fully rebuildable from content + content_memory + topic '
  'resolution. Soft references only — artifact or campaign deletion must never '
  'cascade knowledge away.';

-- ── REBUILD CONTRACT (documentation only — no helper is created) ───────────
--
-- company_topic_coverage is DERIVED. The future rebuild, owned by B7.2, is:
--
--   for each content row c of company X (joined to its content_memory row m):
--     topic_id  := resolveTopicIdentity(c.topic)        -- deterministic first:
--                                                       -- normalize → exact
--                                                       -- normalized_label
--                                                       -- lookup (incl. alias)
--     angle     := NULL until an angle extractor is certified (B7.3)
--     upsert (company_id, topic_id, angle) →
--            coverage_count = count(matching content rows)
--            first_covered_at = min(c.created_at)
--            last_covered_at  = max(c.created_at)
--            state = 'observed', source = 'rebuild'
--
-- No database helper is created here: the resolution step is application logic
-- (embedding comparison + provenance rules) and cannot live in SQL without
-- duplicating it. Creating a partial SQL rebuild would produce a second,
-- divergent resolver — exactly the multi-authority problem B7.0 resolved.
--
-- platform_topic_node is NOT covered by this contract. It is authoritative:
-- recomputing identities from content would produce a DIFFERENT set and
-- invalidate every topic_id reference in coverage.
--
-- Contrast with brand_memory, the standing warning: it accumulates with silent
-- eviction (hooks 25 / themes 50 / messages 100 / terms 200) and has no rebuild
-- path, so knowledge is destroyed there today with no recovery.

COMMIT;
