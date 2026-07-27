-- LEAD-INTELLIGENCE-001 / W2 / LC-201 — Entity-agnostic Operational Core.
--
-- ADDITIVE + idempotent. Reusable operational primitives for ANY lead-like entity,
-- keyed by (company_id, entity_type, entity_id). Canonical leads adopt now
-- (entity_type='canonical_lead', entity_id = lead_intelligence.id); opportunities and
-- future entities converge onto the SAME core later — one assignment/status/notes/task
-- model, never a per-entity duplicate. The operational TIMELINE reuses the existing
-- lead_intelligence_events (no duplicate timeline table). RLS mirrors the service-role
-- pattern used across the lead spine. NOT applied by this file — controlled apply only
-- (Supabase SQL editor / operator; never `db push`, per the repo migration-ledger policy).

-- ── Current operational state (one row per entity; transitions logged to the timeline) ──
CREATE TABLE IF NOT EXISTS public.operational_states (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      text NOT NULL,
  entity_type     text NOT NULL,
  entity_id       text NOT NULL,
  status          text NOT NULL,
  previous_status text,
  reason          text,
  changed_by      text,
  changed_at      timestamptz NOT NULL DEFAULT now(),
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operational_states_unique UNIQUE (company_id, entity_type, entity_id),
  CONSTRAINT operational_states_status_not_blank CHECK (length(btrim(status)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_operational_states_status ON public.operational_states (company_id, entity_type, status);

-- ── Ownership (append-only history; a partial unique index enforces one ACTIVE owner) ──
CREATE TABLE IF NOT EXISTS public.operational_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    text NOT NULL,
  entity_type   text NOT NULL,
  entity_id     text NOT NULL,
  assignee_id   text,                       -- null row = an explicit unassignment record
  assigned_by   text,
  active        boolean NOT NULL DEFAULT true,
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  unassigned_at timestamptz,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_operational_assignments_entity ON public.operational_assignments (company_id, entity_type, entity_id, assigned_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_operational_assignment_active ON public.operational_assignments (company_id, entity_type, entity_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_operational_assignments_assignee ON public.operational_assignments (company_id, assignee_id) WHERE active AND assignee_id IS NOT NULL;

-- ── Structured notes (rich text + mentions + pinning; AI-summary compatible) ──
CREATE TABLE IF NOT EXISTS public.operational_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text NOT NULL,
  author_id   text,
  body        text NOT NULL,
  body_format text NOT NULL DEFAULT 'markdown',
  mentions    jsonb NOT NULL DEFAULT '[]'::jsonb,
  pinned      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT operational_notes_body_not_blank CHECK (length(btrim(body)) > 0),
  CONSTRAINT operational_notes_format_check CHECK (body_format IN ('markdown','plain','html'))
);
CREATE INDEX IF NOT EXISTS idx_operational_notes_entity ON public.operational_notes (company_id, entity_type, entity_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_operational_notes_pinned ON public.operational_notes (company_id, entity_type, entity_id) WHERE pinned AND deleted_at IS NULL;

-- ── First-class operational tasks (future AI-generated tasks reuse this exact model) ──
CREATE TABLE IF NOT EXISTS public.operational_tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   text NOT NULL,
  entity_type  text NOT NULL,
  entity_id    text NOT NULL,
  task_type    text NOT NULL DEFAULT 'follow_up',
  title        text NOT NULL,
  description  text,
  owner_id     text,
  due_at       timestamptz,
  priority     text NOT NULL DEFAULT 'medium',
  status       text NOT NULL DEFAULT 'open',
  origin       text NOT NULL DEFAULT 'human',   -- human | ai_suggested | ai_executed (autonomy ladder)
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT operational_tasks_status_check CHECK (status IN ('open','in_progress','done','cancelled')),
  CONSTRAINT operational_tasks_priority_check CHECK (priority IN ('low','medium','high','urgent')),
  CONSTRAINT operational_tasks_origin_check CHECK (origin IN ('human','ai_suggested','ai_executed')),
  CONSTRAINT operational_tasks_title_not_blank CHECK (length(btrim(title)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_operational_tasks_entity ON public.operational_tasks (company_id, entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operational_tasks_owner ON public.operational_tasks (company_id, owner_id, status) WHERE status IN ('open','in_progress');

ALTER TABLE public.operational_states      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operational_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operational_notes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operational_tasks       ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text; tables text[] := ARRAY['operational_states','operational_assignments','operational_notes','operational_tasks'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='operational_service_role') THEN
      EXECUTE format('DROP POLICY operational_service_role ON public.%I', t);
    END IF;
    EXECUTE format('CREATE POLICY operational_service_role ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

COMMENT ON TABLE public.operational_states IS 'W2/LC-201 entity-agnostic operational lifecycle state (current). Transitions logged to lead_intelligence_events.';
COMMENT ON TABLE public.operational_assignments IS 'W2/LC-201 entity-agnostic ownership (append-only; one active owner via partial unique index).';
COMMENT ON TABLE public.operational_notes IS 'W2/LC-201 entity-agnostic structured notes (mentions, pinning, AI-summary compatible).';
COMMENT ON TABLE public.operational_tasks IS 'W2/LC-201 entity-agnostic operational tasks (human | ai_suggested | ai_executed).';
