-- ============================================================
-- Active Leads Object Model — Phase 1: Schema
-- ============================================================
-- Introduces a first-class Lead entity ("active_leads") that
-- rolls up classified signals (opportunity_feed_items) into a
-- user-actionable lead.
--
-- NAMING: the existing public.leads table is the unrelated
-- form-capture / website-lead-submission system (see
-- database/leads.sql, backend/services/leadService.ts). This
-- new entity powers /command-center/active-leads — the social
-- listening lead workspace — and is deliberately named
-- active_leads to avoid that collision.
--
-- ROLLUP RULE: one active_lead per
--   (organization_id, contact_id, opportunity_type)
-- Per product decision: the same person discussing buying_intent
-- vs. hiring_signal becomes two distinct leads. Status / owner /
-- snooze are per-opportunity-type so won/lost outcomes don't
-- collide.
--
-- ATTACHMENT MODEL: opportunity_feed_items.active_lead_id links
-- each classified signal to its lead. Raw lead_signals that have
-- not yet produced an opportunity_feed_items row remain
-- unattached (they have no opportunity_type yet).
--
-- INGESTION CONTRACT: only score/timestamp/count rollup fields
-- are mutated by ingestion. status / owner_user_id /
-- snoozed_until / status_changed_* / metadata are user-owned
-- and never touched by the ingestion path.
--
-- SAFETY:
--   - Purely additive (CREATE TABLE IF NOT EXISTS,
--     ADD COLUMN IF NOT EXISTS).
--   - No backfill in this migration. Existing rows are filled
--     by scripts/operator/db/backfill-active-leads.ts, which
--     defaults to dry-run.
--   - Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS active_leads (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_id            UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,

  -- Spec: Opportunity Type. Mirrors opportunity_feed_items.opportunity_type.
  opportunity_type      TEXT NOT NULL,

  -- Spec: Status. Defaults to 'new' on creation.
  status                TEXT NOT NULL DEFAULT 'new',

  -- Spec: Owner. Nullable = Unassigned.
  owner_user_id         UUID NULL REFERENCES users(id) ON DELETE SET NULL,

  -- Spec: rollup scores (max across attached signals).
  intent_score          NUMERIC,
  icp_score             NUMERIC,
  confidence_score      NUMERIC,
  total_score           NUMERIC,

  -- Spec: Source Platforms — deduped union across attached signals.
  source_platforms      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  -- Denormalized count for cheap list rendering.
  signal_count          INTEGER NOT NULL DEFAULT 0,

  -- Spec: timestamps.
  first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Spec: Company. Nullable v1; plain text. Enrichment is future.
  company_name          TEXT NULL,

  -- Snooze: status='snoozed' until this timestamp passes, then
  -- the unsnooze pass flips back to 'reviewing'.
  snoozed_until         TIMESTAMPTZ NULL,

  -- Status audit.
  status_changed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status_changed_by     UUID NULL REFERENCES users(id) ON DELETE SET NULL,

  -- Notes, outcome reasons, etc.
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Rollup key.
  CONSTRAINT active_leads_rollup_unique
    UNIQUE (organization_id, contact_id, opportunity_type),

  CONSTRAINT active_leads_status_check
    CHECK (status IN (
      'new', 'reviewing', 'contacted', 'qualified',
      'won', 'lost', 'dismissed', 'snoozed'
    )),

  -- Must stay in sync with opportunity_feed_items.opportunity_type's CHECK.
  CONSTRAINT active_leads_opportunity_type_check
    CHECK (opportunity_type IN (
      'buying_intent',
      'competitor_dissatisfaction',
      'hiring_signal',
      'migration_signal',
      'product_research',
      'integration_need',
      'support_frustration',
      'generic_interest'
    )),

  CONSTRAINT active_leads_score_bounds_check
    CHECK (
      (intent_score     IS NULL OR intent_score     BETWEEN 0 AND 1) AND
      (icp_score        IS NULL OR icp_score        BETWEEN 0 AND 1) AND
      (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1) AND
      (total_score      IS NULL OR total_score      BETWEEN 0 AND 1)
    ),

  -- snoozed_until must be set whenever status='snoozed'.
  CONSTRAINT active_leads_snooze_check
    CHECK (status <> 'snoozed' OR snoozed_until IS NOT NULL)
);

-- Triage queue: org + status + activity recency.
CREATE INDEX IF NOT EXISTS idx_active_leads_org_status_activity
  ON active_leads (organization_id, status, last_activity_at DESC);

-- "My leads" / owner-scoped queries.
CREATE INDEX IF NOT EXISTS idx_active_leads_org_owner
  ON active_leads (organization_id, owner_user_id)
  WHERE owner_user_id IS NOT NULL;

-- Unsnooze sweep.
CREATE INDEX IF NOT EXISTS idx_active_leads_org_snoozed_until
  ON active_leads (organization_id, snoozed_until)
  WHERE snoozed_until IS NOT NULL;

-- Opportunity-type triage.
CREATE INDEX IF NOT EXISTS idx_active_leads_org_type_score
  ON active_leads (organization_id, opportunity_type, total_score DESC NULLS LAST);

-- Person-to-lead lookup.
CREATE INDEX IF NOT EXISTS idx_active_leads_org_contact
  ON active_leads (organization_id, contact_id);

-- ------------------------------------------------------------
-- Attachment: opportunity_feed_items -> active_leads
-- ------------------------------------------------------------
ALTER TABLE IF EXISTS opportunity_feed_items
  ADD COLUMN IF NOT EXISTS active_lead_id UUID NULL
    REFERENCES active_leads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_opportunity_feed_items_active_lead
  ON opportunity_feed_items (active_lead_id)
  WHERE active_lead_id IS NOT NULL;

-- ------------------------------------------------------------
-- updated_at trigger
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_active_leads_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS active_leads_set_updated_at ON active_leads;
CREATE TRIGGER active_leads_set_updated_at
  BEFORE UPDATE ON active_leads
  FOR EACH ROW EXECUTE FUNCTION trg_active_leads_set_updated_at();

ALTER TABLE active_leads ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE active_leads IS
  'First-class Lead entity for the Active Leads workspace (/command-center/active-leads). Rollup of opportunity_feed_items by (organization, contact, opportunity_type). Status / owner / snooze are user-owned. DISTINCT from public.leads (form-capture system).';

COMMENT ON COLUMN opportunity_feed_items.active_lead_id IS
  'Link to active_leads. NULL means not yet rolled up (pending classification or backfill).';
