-- GTM-PROGRAM-001 / W5.1 / LC-501 — Guarded Execution Platform (INFRASTRUCTURE ONLY).
--
-- ADDITIVE + idempotent. Builds the safety substrate for future execution: ONE
-- suppression platform, a layered kill-switch/enablement store (DEFAULT OFF), and an
-- append-only execution audit trail. NOTHING here enables sending — execution stays
-- globally disabled and every connector runs dry-run. RLS = service-role. Controlled
-- apply only (never `db push`).

-- ── C1: the ONE canonical suppression platform (every connector consults exactly this) ──
CREATE TABLE IF NOT EXISTS public.suppression_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  text NOT NULL DEFAULT '__global__',-- '__global__' = GLOBAL (all tenants)
  scope       text NOT NULL DEFAULT 'tenant',    -- global | tenant
  channel     text NOT NULL DEFAULT '*',         -- '*' = all channels | email | linkedin | …
  target      text NOT NULL,                     -- lowercased email / identifier
  reason      text NOT NULL,                     -- unsubscribe|consent_withdrawn|dsar|legal_hold|bounce|manual
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,                        -- non-null = re-subscribed / released
  active      boolean NOT NULL DEFAULT true,
  CONSTRAINT suppression_reason_check CHECK (reason IN ('unsubscribe','consent_withdrawn','dsar','legal_hold','bounce','manual','complaint')),
  CONSTRAINT suppression_scope_check CHECK (scope IN ('global','tenant')),
  CONSTRAINT suppression_target_not_blank CHECK (length(btrim(target)) > 0),
  CONSTRAINT uq_suppression UNIQUE (company_id, channel, target)
);
CREATE INDEX IF NOT EXISTS idx_suppression_lookup ON public.suppression_entries (target) WHERE active;

-- ── C5: layered execution controls / kill-switch (DEFAULT OFF — a row must EXIST + enabled) ──
CREATE TABLE IF NOT EXISTS public.execution_controls (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  text NOT NULL DEFAULT '__global__',-- '__global__' = global scope
  scope       text NOT NULL,                     -- global | tenant | campaign | connector
  scope_id    text NOT NULL DEFAULT '__none__',  -- campaign id / connector name ('__none__' for global/tenant)
  enabled     boolean NOT NULL DEFAULT false,    -- DEFAULT OFF
  emergency_stop boolean NOT NULL DEFAULT false, -- hard STOP overrides enabled
  reason      text,
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT execution_controls_scope_check CHECK (scope IN ('global','tenant','campaign','connector')),
  CONSTRAINT uq_execution_control UNIQUE (company_id, scope, scope_id)
);
CREATE INDEX IF NOT EXISTS idx_execution_controls_lookup ON public.execution_controls (company_id, scope, scope_id);

-- ── Append-only execution audit trail (every stage decision) ──
CREATE TABLE IF NOT EXISTS public.execution_audit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  text NOT NULL,
  campaign_id text,
  entity_id   text,
  channel     text,
  stage       text NOT NULL,                     -- control|approval|suppression|guardrail|quota|queue|connector
  decision    text NOT NULL,                     -- allowed|blocked|suppressed|quota_blocked|killed|dry_run|cancelled|dead_letter
  reason      text,
  evidence    jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor       text,
  correlation_id text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_execution_audit_campaign ON public.execution_audit (company_id, campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_audit_decision ON public.execution_audit (company_id, decision, created_at DESC);

ALTER TABLE public.suppression_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_controls  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_audit      ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text; tables text[] := ARRAY['suppression_entries','execution_controls','execution_audit'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='execution_service_role') THEN
      EXECUTE format('DROP POLICY execution_service_role ON public.%I', t);
    END IF;
    EXECUTE format('CREATE POLICY execution_service_role ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

COMMENT ON TABLE public.suppression_entries IS 'W5.1/LC-501 C1 — the ONE suppression platform; every connector must consult it before dispatch.';
COMMENT ON TABLE public.execution_controls IS 'W5.1/LC-501 C5 — layered kill-switch/enablement; DEFAULT OFF (a row must exist + enabled=true + no emergency_stop).';
COMMENT ON TABLE public.execution_audit IS 'W5.1/LC-501 C6 — append-only execution stage-decision audit (no silent failures).';
