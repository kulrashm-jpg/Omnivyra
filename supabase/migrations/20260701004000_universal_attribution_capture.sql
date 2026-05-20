-- =============================================================================
-- Universal lead capture & cross-domain attribution (DESIGN ARTIFACT / OPTIONAL)
--
-- Backs the three new continuity surfaces (cross-domain handoffs, external
-- landing-page registry, embedded-form lineage). All three shipped services
-- use these tables WHEN PRESENT and otherwise fall back to the append-only
-- audit_events substrate — applying this is a pure observability upgrade with
-- NO behaviour change, NO regression. Hardened ingestion routes
-- (/api/website-events/track, /api/leads) are unchanged.
--
-- SAFETY: purely additive, idempotent (IF NOT EXISTS), append-only, no
-- historical mutation, no backfill, no changes to existing tables. NOT applied
-- by this change — controlled migration process only.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.attribution_handoffs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL,
  -- Token nonce (HMAC payload nonce) — UNIQUE within company so a replayed
  -- handoff is a no-op insert (provable exactly-once at the DB layer).
  token_nonce     text        NOT NULL,
  anonymous_id    text,
  session_id      text,
  website_id      uuid,
  origin_url      text,
  destination_url text,
  utm             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  expires_at      timestamptz NOT NULL,
  issued_at       timestamptz NOT NULL DEFAULT now(),
  verified_at     timestamptz,
  tampered        boolean     NOT NULL DEFAULT false,
  UNIQUE (company_id, token_nonce)
);

CREATE INDEX IF NOT EXISTS idx_attr_handoffs_company
  ON public.attribution_handoffs (company_id, issued_at DESC);

CREATE TABLE IF NOT EXISTS public.external_landing_pages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL,
  provider        text        NOT NULL,           -- clickfunnels|leadpages|unbounce|instapage|hubspot|generic
  page_url        text        NOT NULL,
  attribution_param text      NOT NULL DEFAULT '_attr',
  registered_by   uuid,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, page_url)
);

CREATE INDEX IF NOT EXISTS idx_external_landing_company
  ON public.external_landing_pages (company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.embedded_form_lineage (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid        NOT NULL,
  provider        text        NOT NULL,           -- hubspot|typeform|tally|jotform|calendly|google_forms|generic
  form_external_id text       NOT NULL,
  host_page_url   text,
  registered_by   uuid,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, provider, form_external_id)
);

CREATE INDEX IF NOT EXISTS idx_embedded_form_company
  ON public.embedded_form_lineage (company_id, created_at DESC);

ALTER TABLE public.attribution_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_landing_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.embedded_form_lineage ENABLE ROW LEVEL SECURITY;
