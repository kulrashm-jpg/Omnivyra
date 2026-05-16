-- Enterprise Phase 2 — governance hardening + payment foundation
--
-- Sections:
--   §1  RBAC roles for finance segregation (Phase D)
--   §2  Org control extensions: emergency freeze + billing lock (Phase D)
--   §3  Adjustment cancellation tracking (Phase D)
--   §4  Payment foundation tables (Phase E) — provider-agnostic shape only
--   §5  Usage→ledger reconciliation index (Phase F)
--   §6  Indexes for the dashboard views (Phase G)

------------------------------------------------------------------------------
-- §1  FINANCE RBAC ROLES
------------------------------------------------------------------------------
-- Role values are strings in user_company_roles.role; no enum constraint
-- exists at the DB level, so this is purely a documentation + helper view.
-- Application code (rbacService) enforces the allowed set. Adding the values
-- to a comment lets downstream tools (Supabase dashboard, sql linters) see
-- the canonical list.

COMMENT ON TABLE public.user_company_roles IS
  'Per-(user, company) role assignment. Roles include: SUPER_ADMIN, ADMIN, COMPANY_ADMIN, '
  'CONTENT_MANAGER, CONTENT_REVIEWER, CONTENT_PUBLISHER, CONTENT_PLANNER, CONTENT_CREATOR, '
  'CONTENT_ENGAGER, VIEWER, VIEW_ONLY, FINANCE_ADMIN, FINANCE_APPROVER, FINANCE_AUDITOR. '
  'Finance roles are platform-tier (company_id may be the platform sentinel).';

-- View: who currently holds the new finance roles (for ops UI).
CREATE OR REPLACE VIEW public.v_finance_role_holders AS
SELECT user_id, company_id, role, status, created_at
  FROM public.user_company_roles
 WHERE role IN ('FINANCE_ADMIN', 'FINANCE_APPROVER', 'FINANCE_AUDITOR')
   AND status = 'active';

------------------------------------------------------------------------------
-- §2  ORG CONTROL EXTENSIONS
------------------------------------------------------------------------------

ALTER TABLE public.org_controls
  ADD COLUMN IF NOT EXISTS emergency_freeze       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS emergency_freeze_reason text,
  ADD COLUMN IF NOT EXISTS emergency_freeze_at    timestamptz,
  ADD COLUMN IF NOT EXISTS emergency_freeze_by    uuid,
  ADD COLUMN IF NOT EXISTS billing_lock           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS billing_lock_reason    text,
  ADD COLUMN IF NOT EXISTS billing_lock_at        timestamptz,
  ADD COLUMN IF NOT EXISTS billing_lock_by        uuid;

CREATE INDEX IF NOT EXISTS idx_org_controls_emergency_freeze
  ON public.org_controls(emergency_freeze) WHERE emergency_freeze = true;
CREATE INDEX IF NOT EXISTS idx_org_controls_billing_lock
  ON public.org_controls(billing_lock) WHERE billing_lock = true;

------------------------------------------------------------------------------
-- §3  ADJUSTMENT CANCELLATION FLOW
------------------------------------------------------------------------------
-- A super-admin can cancel a PENDING approval. The row remains in the table
-- (immutable history) but transitions to 'cancelled'. The DB function below
-- enforces invariants the application can't.

CREATE OR REPLACE FUNCTION public.cancel_credit_action_approval(
  p_approval_id uuid,
  p_actor uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_row public.credit_action_approvals%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.credit_action_approvals
    WHERE id = p_approval_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'APPROVAL_NOT_FOUND: %', p_approval_id;
  END IF;
  IF v_row.executed_at IS NOT NULL THEN
    RAISE EXCEPTION 'APPROVAL_ALREADY_EXECUTED: cannot cancel after execute';
  END IF;
  IF v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'APPROVAL_NOT_PENDING: status=%', v_row.status;
  END IF;
  IF v_row.proposed_by <> p_actor THEN
    -- only the proposer (or a future cancellation-capable role) can cancel
    RAISE EXCEPTION 'APPROVAL_CANCEL_NOT_ALLOWED: only proposer may cancel';
  END IF;

  UPDATE public.credit_action_approvals
    SET status           = 'cancelled',
        rejection_reason = p_reason,
        rejected_at      = now(),
        rejected_by      = p_actor
    WHERE id = p_approval_id
    RETURNING * INTO v_row;

  RETURN jsonb_build_object('id', v_row.id, 'status', v_row.status);
END;
$$;

------------------------------------------------------------------------------
-- §4  PAYMENT FOUNDATION TABLES (PROVIDER-AGNOSTIC SHAPE)
------------------------------------------------------------------------------
-- These are scaffolding only: actual Stripe/Razorpay live integration is
-- Sprint 4+ work. The tables are designed so a future adapter plugs in
-- without changing core ledger logic.

CREATE TABLE IF NOT EXISTS public.company_billing_profiles (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL UNIQUE,
  billing_email            text NOT NULL,
  billing_name             text,
  billing_address          jsonb NOT NULL DEFAULT '{}'::jsonb,
  tax_id                   text,
  tax_id_type              text,         -- 'EU_VAT'|'IN_GST'|'US_EIN'|'AU_ABN'|...
  currency_preference      text NOT NULL DEFAULT 'USD',
  default_payment_provider text,         -- 'stripe'|'razorpay'|null
  is_business              boolean NOT NULL DEFAULT true,
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_cbp_touch ON public.company_billing_profiles;
CREATE TRIGGER trg_cbp_touch
  BEFORE UPDATE ON public.company_billing_profiles
  FOR EACH ROW EXECUTE FUNCTION public.omnivyra_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL,
  provider                 text NOT NULL,
  provider_transaction_id  text NOT NULL,
  provider_payment_method_id text,
  amount                   numeric(14,2) NOT NULL,
  currency                 text NOT NULL DEFAULT 'USD',
  fee_amount               numeric(14,2) NOT NULL DEFAULT 0,
  net_amount               numeric(14,2) NOT NULL,
  tax_amount               numeric(14,2) NOT NULL DEFAULT 0,
  tax_currency             text,
  status                   text NOT NULL
    CHECK (status IN ('pending','succeeded','failed','refunded','partially_refunded','disputed')),
  failure_code             text,
  failure_message          text,
  refunded_amount          numeric(14,2) NOT NULL DEFAULT 0,
  credit_purchase_id       uuid REFERENCES public.credit_purchases(id) ON DELETE SET NULL,
  invoice_id               uuid,
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at              timestamptz NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_tx_org_occurred ON public.payment_transactions(organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_tx_status      ON public.payment_transactions(status, occurred_at DESC);

-- Payment transactions are financial-evidential — immutable at update/delete.
DROP TRIGGER IF EXISTS payment_transactions_immutable_update ON public.payment_transactions;
CREATE TRIGGER payment_transactions_immutable_update
  BEFORE UPDATE ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

DROP TRIGGER IF EXISTS payment_transactions_immutable_delete ON public.payment_transactions;
CREATE TRIGGER payment_transactions_immutable_delete
  BEFORE DELETE ON public.payment_transactions
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL,
  provider                  text,           -- nullable while no provider linkage
  provider_subscription_id  text,
  plan_id                   uuid REFERENCES public.pricing_plans(id),
  status                    text NOT NULL
    CHECK (status IN ('trialing','active','past_due','paused','canceled','expired')),
  current_period_start      timestamptz NOT NULL,
  current_period_end        timestamptz NOT NULL,
  trial_ends_at             timestamptz,
  cancel_at_period_end      boolean NOT NULL DEFAULT false,
  auto_renew                boolean NOT NULL DEFAULT true,
  metadata                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subscription_id)
);

CREATE INDEX IF NOT EXISTS idx_subs_org_status ON public.billing_subscriptions(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_subs_period_end ON public.billing_subscriptions(current_period_end) WHERE status IN ('active','past_due');

DROP TRIGGER IF EXISTS trg_subs_touch ON public.billing_subscriptions;
CREATE TRIGGER trg_subs_touch
  BEFORE UPDATE ON public.billing_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.omnivyra_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.invoices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL,
  invoice_number    text NOT NULL UNIQUE,
  period_start      date NOT NULL,
  period_end        date NOT NULL,
  currency          text NOT NULL DEFAULT 'USD',
  subtotal_amount   numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount        numeric(14,2) NOT NULL DEFAULT 0,
  total_amount      numeric(14,2) NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','issued','paid','past_due','voided','refunded')),
  due_date          date,
  issued_at         timestamptz,
  paid_at           timestamptz,
  voided_at         timestamptz,
  pdf_url           text,
  payment_transaction_id uuid REFERENCES public.payment_transactions(id) ON DELETE SET NULL,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_org_period ON public.invoices(organization_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_invoices_status     ON public.invoices(status, due_date);

DROP TRIGGER IF EXISTS trg_invoices_touch ON public.invoices;
CREATE TRIGGER trg_invoices_touch
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.omnivyra_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.invoice_line_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id         uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description        text NOT NULL,
  quantity           numeric(20,6) NOT NULL DEFAULT 1,
  unit_price         numeric(20,6) NOT NULL,
  currency           text NOT NULL DEFAULT 'USD',
  subtotal           numeric(20,6) NOT NULL,
  tax_amount         numeric(20,6) NOT NULL DEFAULT 0,
  tax_rate           numeric(10,6),
  tax_jurisdiction   text,
  reference_type     text,
  reference_id       text,
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_line_invoice ON public.invoice_line_items(invoice_id);

-- Line items are immutable once the invoice is issued. We mark them frozen by
-- triggering on invoice status — modeled here via a check on the parent.
CREATE OR REPLACE FUNCTION public.guard_invoice_line_items_frozen()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF v_status IS NOT NULL AND v_status <> 'draft' THEN
    RAISE EXCEPTION 'INVOICE_LINE_ITEM_FROZEN: invoice status=% prevents line-item % on row %',
      v_status, TG_OP, COALESCE(OLD.id, NEW.id)
      USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS ili_freeze_on_issued ON public.invoice_line_items;
CREATE TRIGGER ili_freeze_on_issued
  BEFORE UPDATE OR DELETE ON public.invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_line_items_frozen();

CREATE TABLE IF NOT EXISTS public.usage_billing_snapshots (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL,
  period_start        timestamptz NOT NULL,
  period_end          timestamptz NOT NULL,
  total_credits       integer NOT NULL DEFAULT 0,
  total_usd_equivalent numeric(14,6) NOT NULL DEFAULT 0,
  llm_input_tokens    bigint NOT NULL DEFAULT 0,
  llm_output_tokens   bigint NOT NULL DEFAULT 0,
  by_action           jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { action_key: { credits, usd, count } }
  invoice_id          uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  taken_at            timestamptz NOT NULL DEFAULT now(),
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (organization_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_ubs_org_period ON public.usage_billing_snapshots(organization_id, period_end DESC);

-- Snapshots are append-only (the source-of-truth is credit_transactions).
DROP TRIGGER IF EXISTS ubs_immutable_update ON public.usage_billing_snapshots;
CREATE TRIGGER ubs_immutable_update
  BEFORE UPDATE ON public.usage_billing_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

------------------------------------------------------------------------------
-- §5  USAGE → LEDGER RECONCILIATION INDEX
------------------------------------------------------------------------------
-- The `usage_events` table records every aiGateway call (cost telemetry).
-- We want to find usage events that lack a CONFIRM in credit_transactions.
-- Add a partial index on usage_events.created_at so the orphan scan is cheap.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema='public' AND table_name='usage_events'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_usage_events_recent ' ||
            'ON public.usage_events(organization_id, created_at DESC)';
  END IF;
END$$;

------------------------------------------------------------------------------
-- §6  DASHBOARD VIEWS
------------------------------------------------------------------------------

-- billing_operations_health: orchestrator coverage + duplicate detection
CREATE OR REPLACE VIEW public.v_billing_operations_health AS
SELECT
  organization_id,
  count(*) AS total_ops_24h,
  count(*) FILTER (WHERE status = 'confirmed')      AS confirmed_24h,
  count(*) FILTER (WHERE status = 'released')       AS released_24h,
  count(*) FILTER (WHERE status = 'insufficient')   AS insufficient_24h,
  count(*) FILTER (WHERE status = 'error')          AS errored_24h,
  count(*) FILTER (WHERE status = 'duplicate')      AS duplicate_24h,
  max(started_at)                                   AS last_op_at
FROM public.billing_operations
WHERE started_at >= now() - interval '24 hours'
GROUP BY organization_id;

-- approval_health: pending counts + SLA aging
CREATE OR REPLACE VIEW public.v_approval_health AS
SELECT
  organization_id,
  count(*) FILTER (WHERE status = 'pending')        AS pending_count,
  count(*) FILTER (WHERE status = 'approved')       AS approved_count,
  count(*) FILTER (WHERE status = 'rejected')       AS rejected_count,
  count(*) FILTER (WHERE status = 'executed')       AS executed_count,
  count(*) FILTER (WHERE status = 'expired')        AS expired_count,
  max(EXTRACT(epoch FROM (now() - proposed_at))) FILTER (WHERE status = 'pending') AS oldest_pending_age_s
FROM public.credit_action_approvals
WHERE proposed_at >= now() - interval '30 days'
GROUP BY organization_id;

-- reservation_health: open HOLDs aging
CREATE OR REPLACE VIEW public.v_reservation_health AS
SELECT
  h.organization_id,
  count(*)                                          AS open_holds,
  count(*) FILTER (WHERE h.created_at < now() - interval '1 hour')  AS holds_older_1h,
  count(*) FILTER (WHERE h.created_at < now() - interval '6 hour')  AS holds_older_6h,
  count(*) FILTER (WHERE h.created_at < now() - interval '24 hour') AS holds_older_24h,
  sum(abs(h.free_delta + h.incentive_delta + h.paid_delta))         AS total_reserved
FROM public.credit_transactions h
LEFT JOIN public.credit_transactions c ON c.parent_transaction_id = h.id AND c.execution_phase = 'confirm'
LEFT JOIN public.credit_transactions r ON r.parent_transaction_id = h.id AND r.execution_phase = 'release'
WHERE h.execution_phase = 'hold'
  AND c.id IS NULL
  AND r.id IS NULL
GROUP BY h.organization_id;
