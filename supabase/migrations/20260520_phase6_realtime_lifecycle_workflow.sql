-- Phase 6 — Realtime delivery, opportunity lifecycle, analyst workflow,
-- escalations, projection sync state, execution observability, source
-- health monitoring. Fully additive — no edits to existing tables.

-- ---------------------------------------------------------------------------
-- OPPORTUNITY LIFECYCLE
-- ---------------------------------------------------------------------------
-- Append-only history of state transitions per opportunity_feed_item. The
-- CURRENT state is derived from the most-recent (by transitioned_at) row.
-- No "current state" column on opportunity_feed_items — keeps the Phase 4
-- table untouched and lets us audit every transition.

CREATE TABLE IF NOT EXISTS opportunity_lifecycle_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  opportunity_feed_item_id UUID NOT NULL REFERENCES opportunity_feed_items(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  previous_state TEXT NULL,
  reasoning TEXT NULL,
  actor_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  is_initial BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  transitioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT opp_lifecycle_state_check
    CHECK (state IN (
      'detected','triaged','reviewing','qualified','monitoring',
      'outreach_planned','converted','dismissed','archived'
    )),
  CONSTRAINT opp_lifecycle_previous_state_check
    CHECK (
      previous_state IS NULL
      OR previous_state IN (
        'detected','triaged','reviewing','qualified','monitoring',
        'outreach_planned','converted','dismissed','archived'
      )
    )
);

CREATE INDEX IF NOT EXISTS idx_opp_lifecycle_org_opp_transitioned
  ON opportunity_lifecycle_states (organization_id, opportunity_feed_item_id, transitioned_at DESC);

CREATE INDEX IF NOT EXISTS idx_opp_lifecycle_org_state_recent
  ON opportunity_lifecycle_states (organization_id, state, transitioned_at DESC);

-- One initial 'detected' transition per opportunity. Enforced via partial UNIQUE
-- so concurrent pipeline runs cannot double-init.
CREATE UNIQUE INDEX IF NOT EXISTS uq_opp_lifecycle_initial
  ON opportunity_lifecycle_states (opportunity_feed_item_id)
  WHERE is_initial = TRUE;

-- Append-only enforcement: blocks UPDATE/DELETE on lifecycle rows.
CREATE OR REPLACE FUNCTION trg_opp_lifecycle_block_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'opportunity_lifecycle_states is append-only';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'opportunity_lifecycle_states is append-only';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS opp_lifecycle_block_update ON opportunity_lifecycle_states;
CREATE TRIGGER opp_lifecycle_block_update
  BEFORE UPDATE ON opportunity_lifecycle_states
  FOR EACH ROW EXECUTE FUNCTION trg_opp_lifecycle_block_mutation();

DROP TRIGGER IF EXISTS opp_lifecycle_block_delete ON opportunity_lifecycle_states;
CREATE TRIGGER opp_lifecycle_block_delete
  BEFORE DELETE ON opportunity_lifecycle_states
  FOR EACH ROW EXECUTE FUNCTION trg_opp_lifecycle_block_mutation();

-- ---------------------------------------------------------------------------
-- ANALYST WORKFLOW
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS opportunity_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  opportunity_feed_item_id UUID NOT NULL REFERENCES opportunity_feed_items(id) ON DELETE CASCADE,
  assigned_to_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  role TEXT NOT NULL DEFAULT 'analyst',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  unassigned_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT opp_assignment_role_check
    CHECK (role IN ('analyst','reviewer','owner','observer')),
  -- Only one active assignment per opportunity at a time per role.
  CONSTRAINT opp_assignment_unique_active
    UNIQUE (opportunity_feed_item_id, role, unassigned_at)
);

CREATE INDEX IF NOT EXISTS idx_opp_assignments_org_user_active
  ON opportunity_assignments (organization_id, assigned_to_user_id)
  WHERE unassigned_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_opp_assignments_org_opportunity
  ON opportunity_assignments (organization_id, opportunity_feed_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS opportunity_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  opportunity_feed_item_id UUID NOT NULL REFERENCES opportunity_feed_items(id) ON DELETE CASCADE,
  author_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'internal',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  edited_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT opp_notes_visibility_check
    CHECK (visibility IN ('internal','team','redacted')),
  CONSTRAINT opp_notes_body_length CHECK (length(body) BETWEEN 1 AND 8000)
);

CREATE INDEX IF NOT EXISTS idx_opp_notes_org_opp_created
  ON opportunity_notes (organization_id, opportunity_feed_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS opportunity_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  opportunity_feed_item_id UUID NOT NULL REFERENCES opportunity_feed_items(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT opp_tag_length_check CHECK (length(tag) BETWEEN 1 AND 64),
  CONSTRAINT opp_tag_unique UNIQUE (opportunity_feed_item_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_opp_tags_org_tag
  ON opportunity_tags (organization_id, tag);

CREATE TABLE IF NOT EXISTS opportunity_dispositions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  opportunity_feed_item_id UUID NOT NULL REFERENCES opportunity_feed_items(id) ON DELETE CASCADE,
  disposition TEXT NOT NULL,
  reason TEXT NULL,
  set_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT opp_disposition_check
    CHECK (disposition IN (
      'qualified','disqualified','low_priority','revisit_later',
      'not_relevant','converted','duplicate'
    ))
);

CREATE INDEX IF NOT EXISTS idx_opp_dispositions_org_opp_created
  ON opportunity_dispositions (organization_id, opportunity_feed_item_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- ESCALATIONS
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  opportunity_feed_item_id UUID NULL REFERENCES opportunity_feed_items(id) ON DELETE CASCADE,
  escalation_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  severity TEXT NOT NULL DEFAULT 'medium',
  requested_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  assigned_to_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NULL,
  sla_due_at TIMESTAMPTZ NULL,
  resolved_at TIMESTAMPTZ NULL,
  resolved_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  history JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT escalation_type_check
    CHECK (escalation_type IN (
      'executive_review','compliance_review','sales_review',
      'moderation_review','strategic_review'
    )),
  CONSTRAINT escalation_status_check
    CHECK (status IN ('open','in_review','resolved','dismissed')),
  CONSTRAINT escalation_severity_check
    CHECK (severity IN ('low','medium','high','critical'))
);

CREATE INDEX IF NOT EXISTS idx_escalations_org_status_recent
  ON escalations (organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_escalations_org_assigned
  ON escalations (organization_id, assigned_to_user_id)
  WHERE status IN ('open','in_review');

-- ---------------------------------------------------------------------------
-- PROJECTION SYNC STATE
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS projection_sync_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  projection_kind TEXT NOT NULL,
  cursor_position TEXT NULL,
  last_replayed_at TIMESTAMPTZ NULL,
  last_synced_at TIMESTAMPTZ NULL,
  pending_retry_count INTEGER NOT NULL DEFAULT 0,
  payload_version INTEGER NOT NULL DEFAULT 1,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT projection_sync_kind_check
    CHECK (projection_kind IN ('opportunity_feed','graph','alerts','clusters','lifecycle')),
  CONSTRAINT projection_sync_retry_bounds
    CHECK (pending_retry_count BETWEEN 0 AND 10),
  CONSTRAINT projection_sync_unique UNIQUE (organization_id, projection_kind)
);

CREATE INDEX IF NOT EXISTS idx_projection_sync_org_kind
  ON projection_sync_state (organization_id, projection_kind);

-- ---------------------------------------------------------------------------
-- EXECUTION OBSERVABILITY
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS execution_observability_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  listening_execution_id UUID NULL REFERENCES listening_executions(id) ON DELETE CASCADE,
  trace_kind TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  duration_ms INTEGER NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT exec_obs_kind_check
    CHECK (trace_kind IN ('execution','projection','moderation','rate_limit','connector_health','source_health')),
  CONSTRAINT exec_obs_status_check
    CHECK (status IN ('ok','warn','error'))
);

CREATE INDEX IF NOT EXISTS idx_exec_obs_org_recent
  ON execution_observability_records (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_exec_obs_org_execution
  ON execution_observability_records (organization_id, listening_execution_id, created_at DESC)
  WHERE listening_execution_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_exec_obs_org_kind_status
  ON execution_observability_records (organization_id, trace_kind, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- SOURCE HEALTH
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS source_health_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  listening_source_id UUID NOT NULL REFERENCES listening_sources(id) ON DELETE CASCADE,
  health_state TEXT NOT NULL DEFAULT 'healthy',
  rationale TEXT NULL,
  inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT source_health_state_check
    CHECK (health_state IN ('healthy','degraded','unstable','silenced'))
);

CREATE INDEX IF NOT EXISTS idx_source_health_org_source_recent
  ON source_health_states (organization_id, listening_source_id, computed_at DESC);

CREATE INDEX IF NOT EXISTS idx_source_health_org_state_recent
  ON source_health_states (organization_id, health_state, computed_at DESC);

-- ---------------------------------------------------------------------------
-- Updated_at triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_phase6_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS escalations_set_updated_at ON escalations;
CREATE TRIGGER escalations_set_updated_at
  BEFORE UPDATE ON escalations
  FOR EACH ROW EXECUTE FUNCTION trg_phase6_set_updated_at();

DROP TRIGGER IF EXISTS projection_sync_set_updated_at ON projection_sync_state;
CREATE TRIGGER projection_sync_set_updated_at
  BEFORE UPDATE ON projection_sync_state
  FOR EACH ROW EXECUTE FUNCTION trg_phase6_set_updated_at();
