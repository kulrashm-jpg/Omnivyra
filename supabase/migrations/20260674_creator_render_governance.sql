-- Creator Render Governance — additive enterprise governance sidecar
--
-- PURE ADDITIVE. Per-org governance/operational controls for the
-- rendering platform (R1–R5). MUTABLE config state only — no financial
-- truth (billing stays in billing_operations / credit ledger), no
-- lineage (immutable R1 tables). No scheduler change, no AI video.
--
-- Absence of a row ⇒ the evaluator applies FAIL-CLOSED conservative
-- defaults (rendering allowed but capped) — see renderGovernance.ts.
-- Reuses omnivyra_touch_updated_at.

CREATE TABLE IF NOT EXISTS public.creator_render_governance_state (
  organization_id        uuid PRIMARY KEY,
  rendering_enabled      boolean NOT NULL DEFAULT true,
  max_daily_renders      integer NOT NULL DEFAULT 200 CHECK (max_daily_renders >= 0),
  max_concurrent_renders integer NOT NULL DEFAULT 4   CHECK (max_concurrent_renders >= 0),
  -- empty array ⇒ "all canonical families allowed" (still image-only by
  -- the rendering runtime); non-empty ⇒ strict allowlist.
  allowed_asset_families text[] NOT NULL DEFAULT ARRAY['image']::text[],
  allowed_providers      text[] NOT NULL DEFAULT ARRAY['openai']::text[],
  moderation_mode        text NOT NULL DEFAULT 'standard'
    CHECK (moderation_mode IN ('standard','escalated','strict')),
  quota_window           text NOT NULL DEFAULT 'rolling_24h'
    CHECK (quota_window IN ('rolling_24h','calendar_day')),
  emergency_stop         boolean NOT NULL DEFAULT false,
  queue_paused           boolean NOT NULL DEFAULT false,
  -- per-provider hard disable (operator switch), keyed by provider_key
  disabled_providers     text[] NOT NULL DEFAULT ARRAY[]::text[],
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_crgs_touch ON public.creator_render_governance_state;
CREATE TRIGGER trg_crgs_touch
  BEFORE UPDATE ON public.creator_render_governance_state
  FOR EACH ROW EXECUTE FUNCTION public.omnivyra_touch_updated_at();

-- Global emergency-stop sentinel row (organization_id = all-zero UUID).
-- Operators flip emergency_stop / queue_paused here to halt EVERY org.
INSERT INTO public.creator_render_governance_state (organization_id, notes)
VALUES ('00000000-0000-0000-0000-000000000000', 'GLOBAL governance sentinel — emergency_stop/queue_paused here halt all orgs')
ON CONFLICT (organization_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_crgs_flags
  ON public.creator_render_governance_state(emergency_stop, queue_paused)
  WHERE emergency_stop = true OR queue_paused = true;
