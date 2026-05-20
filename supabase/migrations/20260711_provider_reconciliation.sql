-- =============================================================================
-- Provider-invoice reconciliation subsystem (SCHEMA ONLY, additive)
--
-- DESIGN: deterministic, append-only reconciliation between provider invoices
-- and our internal usage/ledger. Mirrors the Phase-4.1 Output E architecture:
--
--   provider invoice → provider_invoice_imports
--                    → cost_reconciliation_runs   (variance, status)
--                    → cost_reconciliation_adjustments (compensating delta,
--                      append-only — NEVER mutates historical ledger rows)
--
-- INGESTION ADAPTERS (provider-specific format parsing) are NOT in this
-- migration — they require real OpenAI/Anthropic/Stripe billing-export
-- samples and live validation, which cannot be authored non-speculatively
-- here. The schema accepts a verbatim payload jsonb so adapters can be
-- introduced later without schema change.
--
-- SAFETY: purely additive, idempotent (IF NOT EXISTS), no historical
-- mutation, no changes to existing tables/RPCs/wallet/ledger. Append-only
-- where required via the EXISTING raise_ledger_immutable() trigger function
-- (migration 20260663). Runs table stays mutable for status transitions.
-- NOT applied by this change — controlled migration process only.
-- =============================================================================

-- ── 1. Provider invoice imports (immutable, append-only) ────────────────────
--   One row per ingested invoice line (or whole invoice — caller decides
--   granularity). Idempotency via UNIQUE (provider, provider_invoice_id).
CREATE TABLE IF NOT EXISTS public.provider_invoice_imports (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider             text        NOT NULL,
  provider_invoice_id  text        NOT NULL,
  period_start         timestamptz NOT NULL,
  period_end           timestamptz NOT NULL,
  currency             text        NOT NULL DEFAULT 'USD',
  total_actual_usd     numeric(20,10) NOT NULL,
  line_items           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  raw_payload          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ingested_at          timestamptz NOT NULL DEFAULT now(),
  -- Adapter version that produced this normalized row (e.g. 'openai_v1').
  adapter_version      text        NOT NULL DEFAULT 'unspecified',
  UNIQUE (provider, provider_invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_pii_period
  ON public.provider_invoice_imports (provider, period_start, period_end);

-- Append-only: reuse the existing immutability guard (no new trigger fn).
DROP TRIGGER IF EXISTS pii_immutable_update ON public.provider_invoice_imports;
CREATE TRIGGER pii_immutable_update
  BEFORE UPDATE ON public.provider_invoice_imports
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

DROP TRIGGER IF EXISTS pii_immutable_delete ON public.provider_invoice_imports;
CREATE TRIGGER pii_immutable_delete
  BEFORE DELETE ON public.provider_invoice_imports
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

-- ── 2. Reconciliation runs (mutable status; one per provider+period) ────────
--   The "header" of a reconciliation pass. Status is mutable for the duration
--   of the pass (queued→running→completed|failed). Adjustments referencing
--   this run are immutable.
CREATE TABLE IF NOT EXISTS public.cost_reconciliation_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider              text        NOT NULL,
  period_start          timestamptz NOT NULL,
  period_end            timestamptz NOT NULL,
  estimated_usd_sum     numeric(20,10) NOT NULL DEFAULT 0,
  actual_usd_sum        numeric(20,10) NOT NULL DEFAULT 0,
  variance_usd          numeric(20,10) GENERATED ALWAYS AS (actual_usd_sum - estimated_usd_sum) STORED,
  variance_pct          numeric(10,4),  -- nullable: undefined when estimated_usd_sum = 0
  status                text        NOT NULL DEFAULT 'queued'
                                   CHECK (status IN ('queued','running','completed','failed','partial')),
  started_at            timestamptz,
  finished_at           timestamptz,
  error_message         text,
  metadata              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_crr_status
  ON public.cost_reconciliation_runs (status, created_at);

-- ── 3. Reconciliation adjustments (immutable compensating entries) ──────────
--   NEVER mutates historical ledger rows. Each adjustment is a forward-only
--   compensating delta linked to its run; the financial-core ledger remains
--   untouched. Optional org_id/usage_event linkage for attribution.
CREATE TABLE IF NOT EXISTS public.cost_reconciliation_adjustments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                uuid        NOT NULL REFERENCES public.cost_reconciliation_runs(id) ON DELETE RESTRICT,
  organization_id       uuid,
  provider              text        NOT NULL,
  action_key            text,
  -- Anchor back to the originating HOLD when the adjustment is attributable.
  ledger_hold_transaction_id uuid,
  estimated_usd         numeric(20,10) NOT NULL,
  actual_usd            numeric(20,10) NOT NULL,
  adjustment_usd        numeric(20,10) GENERATED ALWAYS AS (actual_usd - estimated_usd) STORED,
  reason                text        NOT NULL,            -- e.g. 'rounding'|'rate_drift'|'missed_event'|'orphan_usage'
  metadata              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cra_run
  ON public.cost_reconciliation_adjustments (run_id);
CREATE INDEX IF NOT EXISTS idx_cra_org
  ON public.cost_reconciliation_adjustments (organization_id, created_at)
  WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cra_ledger_hold
  ON public.cost_reconciliation_adjustments (ledger_hold_transaction_id)
  WHERE ledger_hold_transaction_id IS NOT NULL;

-- Append-only.
DROP TRIGGER IF EXISTS cra_immutable_update ON public.cost_reconciliation_adjustments;
CREATE TRIGGER cra_immutable_update
  BEFORE UPDATE ON public.cost_reconciliation_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

DROP TRIGGER IF EXISTS cra_immutable_delete ON public.cost_reconciliation_adjustments;
CREATE TRIGGER cra_immutable_delete
  BEFORE DELETE ON public.cost_reconciliation_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();
