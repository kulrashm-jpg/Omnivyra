-- ============================================================================
-- B7.8-C — PLATFORM USAGE LEDGER
--   public.platform_usage_events — provider spend that belongs to NO customer
-- ============================================================================
--
-- WHY A SEPARATE TABLE (B7.8-A / B7.8-B evidence)
-- `usage_events.organization_id` and `unified_transactions.organization_id` are
-- both NOT NULL, and every customer-facing consumer joins on them. Platform
-- resources (platform_topic_node, platform_content_fingerprint) are tenant-less
-- by construction, so there is no organization to supply.
--
-- The repository already answered this question once: blackHoleCostCapture.ts
-- refuses to record spend it cannot attribute —
--     if (!input.organizationId) return; // no org → skip (no fake attribution)
-- — twice, deliberately. This table is how that spend gets recorded instead of
-- dropped, WITHOUT inventing an organization and WITHOUT relaxing a NOT NULL
-- invariant on a financial table.
--
-- ISOLATION IS STRUCTURAL, NOT FILTERED
-- Customer credits, invoices, quotas, dashboards and margin all read
-- usage_events / unified_transactions. A row that exists in NEITHER cannot
-- appear in any of them — no query has to remember to exclude it. That is the
-- decisive advantage over making organization_id nullable, where isolation
-- would depend on every present and future query filtering correctly.
--
-- ADDITIVE ONLY: no existing table, column, index, policy, trigger or function
-- is created, altered or dropped. Customer billing is untouched.
-- Rollback: supabase/migrations/rollbacks/platform_usage_events_rollback.sql
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.platform_usage_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- DELIBERATELY ABSENT: organization_id, company_id, campaign_id, user_id.
  -- Their absence IS the isolation mechanism — this row cannot be joined into
  -- a customer report because it carries nothing to join on.

  provider_name     text NOT NULL,
  model_name        text NOT NULL,
  model_version     text,

  -- Mirrors the unified_transactions vocabulary so platform spend classifies
  -- consistently with the existing `source_type='system'` convention.
  source_type       text NOT NULL DEFAULT 'system'
                      CHECK (source_type IN ('system', 'embedding', 'llm', 'internal')),
  source_name       text NOT NULL,
  process_type      text NOT NULL,

  input_tokens      integer,
  output_tokens     integer,
  total_tokens      integer,

  -- Provider USD only. There is NO credits column and no credit conversion:
  -- platform spend has no customer credits, which is precisely why
  -- fetchCreditRateUsd (the only org-dependent step in pricing) is not called.
  unit_cost         numeric(20, 10),
  total_cost        numeric(20, 10),
  pricing_snapshot  jsonb,

  -- Reconciliation (B7.8-B §8): ties spend to the work that caused it, so the
  -- ledger can be audited against "how many topics actually got embedded".
  -- Without these the ledger is unauditable against work performed.
  resource_type     text NOT NULL,
  resource_id       uuid NOT NULL,

  -- The DATABASE is the final serialization point for idempotency. An
  -- application-level guard collapses the common case; this constraint is what
  -- makes a duplicate financial record impossible under a race or a retry.
  idempotency_key   text NOT NULL,

  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS platform_usage_events_idempotency_uidx
  ON public.platform_usage_events (idempotency_key);

-- Reporting / reconciliation window scans.
CREATE INDEX IF NOT EXISTS platform_usage_events_created_idx
  ON public.platform_usage_events (created_at DESC);

-- Justified by §8: "how much did we spend embedding THIS topic" must be
-- answerable without a full scan.
CREATE INDEX IF NOT EXISTS platform_usage_events_resource_idx
  ON public.platform_usage_events (resource_type, resource_id);

-- ── Security ───────────────────────────────────────────────────────────────
-- RLS ENABLED WITH ZERO POLICIES, the posture proven against real PostgreSQL
-- in B5 and B7.1: it denies every non-owner, non-superuser role — including
-- anon and authenticated — EVEN WITH table GRANTs present. There is no
-- organization_id to scope by, so the company policy pattern is inapplicable,
-- and unlike public.content_type this is not public reference data.
-- Writes are service-role only, through platformUsageLedgerService.
ALTER TABLE public.platform_usage_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.platform_usage_events IS
  'B7.8 platform/infrastructure provider spend with NO customer attribution. '
  'Structurally separate from usage_events and unified_transactions so it can '
  'never enter customer billing, credits, invoices or quotas. Tenant-less by '
  'design: no organization_id/company_id/campaign_id/user_id. RLS enabled with '
  'NO policy — service-role only. Records provider USD only; there is no '
  'credits column because platform spend charges nobody.';

COMMIT;
