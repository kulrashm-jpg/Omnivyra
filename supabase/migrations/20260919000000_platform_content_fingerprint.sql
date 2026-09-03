-- ============================================================================
-- B5 — PLATFORM-WIDE CONTENT UNIQUENESS: platform_content_fingerprint
-- ============================================================================
--
-- The FIFTH uniqueness tier, above company → campaign → content-type →
-- individual. It answers one question: "is this artifact novel across Omnivyra
-- as a whole?" — and it answers it WITHOUT ever being able to say whose content
-- it resembles.
--
-- ── WHY THIS TABLE HAS NO TENANT COLUMN ────────────────────────────────────
-- Every other uniqueness store (content_memory, content_originality,
-- brand_memory) carries company_id NOT NULL, and retrieveRelevant() is
-- unconditionally `.eq('company_id', companyId)`. That predicate is never
-- removed. Cross-company comparison instead happens here, in a store that is
-- PHYSICALLY incapable of attributing a row to a tenant:
--
--   NO company_id · NO campaign_id · NO content_id · NO user_id
--   NO body · NO title · NO topic · NO excerpt · NO token_summary
--
-- Isolation is enforced by the ABSENCE OF COLUMNS, not by query discipline.
-- A future `.eq()` mistake cannot leak a tenant from this table because there
-- is no tenant in it to leak. (B4.3 closed seven routes where the authorized
-- company and the acted-upon company diverged; this table removes that class
-- of error by construction rather than relying on getting the predicate right.)
--
-- token_summary is deliberately EXCLUDED even though content_memory carries it:
-- it is the one derived field that materially reconstructs source wording.
--
-- ── ADDITIVE ONLY ──────────────────────────────────────────────────────────
-- Creates ONE table. Alters no existing table, column, index, policy or
-- trigger. Rollback: supabase/migrations/rollbacks/
-- platform_content_fingerprint_rollback.sql
-- ============================================================================

BEGIN;

-- pgvector is already installed (content_memory.embedding uses vector(1536));
-- this is a no-op safeguard for a clean-room rehearsal database.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.platform_content_fingerprint (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Forward compatibility for creator/visual fingerprints (perceptual hash /
  -- image embedding are a DIFFERENT fingerprint family). Constrained to 'text'
  -- today so B5 cannot silently start accepting a modality it cannot compare.
  modality          text NOT NULL DEFAULT 'text'
                      CHECK (modality IN ('text')),

  -- Format label, NOT tenant data. Required so the content-type tier has a
  -- platform-scoped counterpart. FK to the same reference table `content` uses.
  content_type      text NOT NULL REFERENCES public.content_type(id)
                      ON DELETE RESTRICT ON UPDATE CASCADE,

  -- Derived, non-reversible fingerprints. Identical representations to
  -- lib/content/originality/fingerprint.ts — no second implementation exists.
  -- exact_hash / normalized_hash are used for STORAGE DEDUP ONLY and are never
  -- returned in a signal: surfacing them would turn this table into a
  -- confirmation oracle ("does this exact text exist on the platform?").
  exact_hash        text NOT NULL,
  normalized_hash   text NOT NULL,
  simhash           text NOT NULL,
  minhash           jsonb,
  structural_shape  text,

  -- Semantic axis. vector(1536) + HNSW cosine matches the convention already
  -- proven on content_memory / intelligence_signals. model+version are stored
  -- alongside because comparing vectors across model generations is silently
  -- meaningless — the comparator MUST skip when they differ.
  embedding         vector(1536),
  embedding_model   text,
  embedding_version integer,

  -- Aggregate only; never returned in a signal. Lets a repeated artifact
  -- refresh rather than grow the table unboundedly.
  occurrence_count  integer NOT NULL DEFAULT 1,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ────────────────────────────────────────────────────────────────
-- Dedup: one row per distinct normalized artifact per (modality, format).
-- This is what makes recordPlatformFingerprint an idempotent upsert.
CREATE UNIQUE INDEX IF NOT EXISTS platform_fp_dedup_uidx
  ON public.platform_content_fingerprint (modality, content_type, normalized_hash);

-- Blocking stage (cheap, runs BEFORE any vector scan).
CREATE INDEX IF NOT EXISTS platform_fp_simhash_idx
  ON public.platform_content_fingerprint (content_type, simhash);
CREATE INDEX IF NOT EXISTS platform_fp_shape_idx
  ON public.platform_content_fingerprint (content_type, structural_shape);

-- Semantic stage. This is the one store with genuinely platform-scale row
-- counts, which is why the blocking stage precedes it.
CREATE INDEX IF NOT EXISTS platform_fp_embedding_idx
  ON public.platform_content_fingerprint USING hnsw (embedding vector_cosine_ops);

-- Retention sweep (rolling window on last_seen_at).
CREATE INDEX IF NOT EXISTS platform_fp_last_seen_idx
  ON public.platform_content_fingerprint (last_seen_at);

-- ── Security posture ───────────────────────────────────────────────────────
-- RLS ENABLED WITH ZERO POLICIES — deliberately.
--
-- Phase A's company tables carry a `company_id IN (SELECT ... FROM
-- user_company_roles WHERE user_id = auth.uid() AND status='active')` policy.
-- That pattern is INAPPLICABLE here: there is no company_id to scope by.
-- public.content_type takes the opposite posture (`FOR SELECT USING (true)`)
-- because it is public reference data.
--
-- This table takes the THIRD posture: RLS on, no policy at all. Under
-- PostgreSQL that denies every row to every non-superuser, non-owner role —
-- including anon and authenticated. Access is service-role only, through
-- exactly one module (backend/services/content/platformNoveltyService.ts).
-- No route, no admin endpoint and no MCP tool reads this table.
ALTER TABLE public.platform_content_fingerprint ENABLE ROW LEVEL SECURITY;

-- ── Trigger ────────────────────────────────────────────────────────────────
-- House convention (omnivyra_touch_updated_at serves 60 production triggers).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'platform_content_fingerprint_touch_updated_at'
       AND tgrelid = 'public.platform_content_fingerprint'::regclass
  ) THEN
    CREATE TRIGGER platform_content_fingerprint_touch_updated_at
      BEFORE UPDATE ON public.platform_content_fingerprint
      FOR EACH ROW EXECUTE FUNCTION public.omnivyra_touch_updated_at();
  END IF;
END $$;

COMMENT ON TABLE public.platform_content_fingerprint IS
  'B5 platform-wide uniqueness. Tenant-less derived fingerprints. Contains no '
  'company_id/campaign_id/content_id/user_id and no content text by design; '
  'isolation is enforced by the absence of those columns. RLS enabled with no '
  'policy: service-role access only, never reachable from a client API.';

COMMIT;
