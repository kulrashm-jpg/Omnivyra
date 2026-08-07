-- WS-3 Milestone-4 — governance state (ADDITIVE ONLY).
--
-- Two tables the governance engine EVALUATES AGAINST. Nothing here dispatches,
-- schedules or contacts anyone; these hold the rules, not the actions.
--
-- The architecture recorded suppression as "absent platform-wide — New,
-- Critical". This is that table. It is the single most important control in
-- WS-3: it is the only thing standing between an approved task and contacting
-- someone who asked never to be contacted.
--
-- Modifies NOTHING existing.

-- ── 1. outreach_governance_config — per-tenant rules ────────────────────────
--
-- One row per tenant. Absent row = governed by defaults, which are
-- deliberately RESTRICTIVE: a tenant that has never been configured is not
-- enabled for outreach. Failing open here would mean a tenant nobody set up
-- could contact people.

CREATE TABLE IF NOT EXISTS outreach_governance_config (
  company_id            text PRIMARY KEY,
  -- Tenant enablement. False (or absent row) blocks all outreach.
  enabled               boolean NOT NULL DEFAULT false,
  -- Tenant-scoped kill switch, independent of the global one.
  kill_switch           boolean NOT NULL DEFAULT false,
  -- Channels this tenant may use. Empty = none permitted.
  enabled_channels      text[] NOT NULL DEFAULT ARRAY[]::text[],
  -- ISO 3166-1 alpha-2 regions this tenant may NOT contact.
  restricted_regions    text[] NOT NULL DEFAULT ARRAY[]::text[],
  -- Durable rate limits. NULL = no limit at that scope.
  daily_limit_tenant    integer,
  daily_limit_lead      integer,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outreach_governance_config_company_not_blank CHECK (length(btrim(company_id)) > 0),
  CONSTRAINT outreach_governance_config_limits_non_negative
    CHECK ((daily_limit_tenant IS NULL OR daily_limit_tenant >= 0)
       AND (daily_limit_lead IS NULL OR daily_limit_lead >= 0))
);

-- ── 2. outreach_suppressions — do-not-contact ───────────────────────────────
--
-- Append-only, like every other audit surface in WS-3. A suppression is
-- withdrawn by setting `revoked_at`, never by deleting the row: the record that
-- someone once asked not to be contacted must outlive the request itself.
--
-- `scope` distinguishes what is suppressed:
--   recipient — a person (email, phone, handle) — the compliance case
--   channel   — a channel for this tenant
--   task      — one specific materialised task
--   lead      — every task for one lead

CREATE TABLE IF NOT EXISTS outreach_suppressions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  text NOT NULL,
  scope       text NOT NULL,
  -- The suppressed value, normalized by the caller (lowercased email, etc.).
  value       text NOT NULL,
  reason      text,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Withdrawal, not deletion.
  revoked_at  timestamptz,
  revoked_by  text,
  CONSTRAINT outreach_suppressions_scope_valid CHECK (scope IN ('recipient', 'channel', 'task', 'lead')),
  CONSTRAINT outreach_suppressions_value_not_blank CHECK (length(btrim(value)) > 0)
);

-- Active suppressions are the hot read on every dispatch decision.
CREATE INDEX IF NOT EXISTS idx_outreach_suppressions_active
  ON outreach_suppressions (company_id, scope, value)
  WHERE revoked_at IS NULL;

-- Deletion is refused outright; UPDATE is permitted ONLY to record a
-- withdrawal, so a suppression can be lifted but never rewritten or erased.
CREATE OR REPLACE FUNCTION ws3_suppression_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ws3_append_only: outreach_suppressions is append-only; DELETE is not permitted'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.scope IS DISTINCT FROM OLD.scope
     OR NEW.value IS DISTINCT FROM OLD.value
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'ws3_suppression_immutable: only revoked_at/revoked_by may be updated'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS outreach_suppressions_guard ON outreach_suppressions;
CREATE TRIGGER outreach_suppressions_guard
  BEFORE UPDATE OR DELETE ON outreach_suppressions
  FOR EACH ROW EXECUTE FUNCTION ws3_suppression_guard();

-- ── row level security ──────────────────────────────────────────────────────

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['outreach_governance_config', 'outreach_suppressions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    BEGIN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')',
        t || '_service_role', t
      );
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END LOOP;
END $$;
