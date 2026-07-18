-- 2026-07-18 — WRITER-EXEC-003 Wave 2: Content Intelligence & Originality Engine.
--
-- The durable Content Memory layer that makes every new generation aware of the
-- company's historical content and prevents duplication while preserving brand
-- consistency. Builds ON the Wave 1 canonical `content` spine (does NOT redesign
-- it). Three NEW tables, ZERO changes to existing tables. Additive + backward
-- compatible. Company-scoped RLS (denormalized company_id).
--
-- Embeddings note: the embedding-similarity STAGE is feature-flagged OFF by
-- default, so this wave stores embeddings as nullable jsonb (float array) and
-- computes cosine in-process over a candidate set already narrowed by the cheap
-- stages. No pgvector dependency here — a pgvector column + HNSW index is a
-- scaling follow-up for 100k+ companies (Wave 3), not required now.
--
-- APPLY: cert/beta env via BETA_DB_URL. Production apply authored here, run via
-- the controlled pooler-DDL process (ledger desynced; do NOT db:push). Record.

-- ── content_memory — the durable per-unit historical knowledge base ─────────
-- One row per indexed content UNIT (a master post/thread, or a platform variant
-- when `platform` is set). This is what assertOriginality() queries.
CREATE TABLE IF NOT EXISTS public.content_memory (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL,
  content_id       uuid,                        -- soft ref → content.id (nullable for legacy/adapter-backed)
  campaign_id      uuid,                        -- nullable; enables per-campaign repetition checks
  content_type     text NOT NULL,
  platform         text,                        -- NULL = master; set = platform variant
  lifecycle_status text,                        -- snapshot of canonical status when indexed
  -- Staged duplicate-detection fingerprints (cheap → expensive):
  exact_hash       text NOT NULL,               -- sha256 of raw text
  normalized_hash  text NOT NULL,               -- sha256 of normalized text (case/space/punct-folded)
  simhash          text NOT NULL,               -- 64-bit simhash as hex (Hamming distance = near-dup)
  minhash          jsonb,                        -- minhash signature (int[]) for Jaccard estimation
  structural_shape text,                        -- sentence/among-lines shape signature
  token_summary    jsonb,                        -- shingle/token bag for semantic (token) similarity
  embedding        jsonb,                        -- nullable float[]; populated only when the embedding stage is enabled
  intelligence     jsonb,                        -- {hooks[], ctas[], narratives[], keyMessages[]} — campaign + brand memory
  text_excerpt     text,                         -- short excerpt for diagnostics / nearest-match display
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_memory_company_type_idx
  ON public.content_memory (company_id, content_type, created_at DESC);
CREATE INDEX IF NOT EXISTS content_memory_company_campaign_idx
  ON public.content_memory (company_id, campaign_id) WHERE campaign_id IS NOT NULL;
-- Cheap-stage lookups: exact + normalized hash equality are O(index).
CREATE INDEX IF NOT EXISTS content_memory_company_exact_idx
  ON public.content_memory (company_id, exact_hash);
CREATE INDEX IF NOT EXISTS content_memory_company_normalized_idx
  ON public.content_memory (company_id, normalized_hash);
CREATE INDEX IF NOT EXISTS content_memory_content_idx
  ON public.content_memory (content_id) WHERE content_id IS NOT NULL;

-- ── content_originality — the per-record originality decision + metadata ─────
-- Persisted alongside a canonical Content record (item 9). Supports diagnostics
-- and analytics; one row per accepted/decided generation.
CREATE TABLE IF NOT EXISTS public.content_originality (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL,
  content_id             uuid,                   -- soft ref → content.id
  originality_score      numeric,                -- 0..1 (1 = fully original)
  decision               text NOT NULL DEFAULT 'accepted'
                           CHECK (decision IN ('accepted','duplicate','regenerated','bypassed','error')),
  nearest_matches        jsonb,                  -- [{memoryId, score, dimension, excerpt}]
  similarity_dimensions  jsonb,                  -- {exact, normalized, structural, semantic, embedding, variant}
  regeneration_count     integer NOT NULL DEFAULT 0,
  generation_fingerprint text,                   -- fingerprint of the accepted output
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_originality_company_created_idx
  ON public.content_originality (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS content_originality_content_idx
  ON public.content_originality (content_id) WHERE content_id IS NOT NULL;

-- ── brand_memory — company-level reusable brand intelligence rollup (item 7) ─
-- One row per company; upserted as content is indexed. Reusable during
-- generation WITHOUT repeating previous content.
CREATE TABLE IF NOT EXISTS public.brand_memory (
  company_id        uuid PRIMARY KEY,
  voice             jsonb,       -- brand voice descriptors
  terminology       jsonb,       -- preferred terminology / lexicon
  style             jsonb,       -- writing-style signals
  audience          jsonb,       -- audience descriptors seen across content
  campaign_themes   jsonb,       -- recurring campaign themes
  messaging_history jsonb,       -- rolling key-message ledger (capped)
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ── updated_at trigger for brand_memory (reuse Wave 1 fn if present) ─────────
CREATE OR REPLACE FUNCTION public.set_content_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS brand_memory_set_updated_at ON public.brand_memory;
CREATE TRIGGER brand_memory_set_updated_at BEFORE UPDATE ON public.brand_memory
  FOR EACH ROW EXECUTE FUNCTION public.set_content_updated_at();

-- ── RLS — company-scoped (service role bypasses; mirrors Wave 1 pattern) ─────
ALTER TABLE public.content_memory      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_originality ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_memory        ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='content_memory' AND policyname='content_memory_company_rw') THEN
    CREATE POLICY content_memory_company_rw ON public.content_memory
      USING (company_id IN (SELECT company_id FROM public.user_company_roles WHERE user_id = auth.uid() AND status = 'active'))
      WITH CHECK (company_id IN (SELECT company_id FROM public.user_company_roles WHERE user_id = auth.uid() AND status = 'active'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='content_originality' AND policyname='content_originality_company_rw') THEN
    CREATE POLICY content_originality_company_rw ON public.content_originality
      USING (company_id IN (SELECT company_id FROM public.user_company_roles WHERE user_id = auth.uid() AND status = 'active'))
      WITH CHECK (company_id IN (SELECT company_id FROM public.user_company_roles WHERE user_id = auth.uid() AND status = 'active'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='brand_memory' AND policyname='brand_memory_company_rw') THEN
    CREATE POLICY brand_memory_company_rw ON public.brand_memory
      USING (company_id IN (SELECT company_id FROM public.user_company_roles WHERE user_id = auth.uid() AND status = 'active'))
      WITH CHECK (company_id IN (SELECT company_id FROM public.user_company_roles WHERE user_id = auth.uid() AND status = 'active'));
  END IF;
END $$;
