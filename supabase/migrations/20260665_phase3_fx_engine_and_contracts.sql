-- Enterprise Phase 3 — FX engine + enterprise contracts + audit manifests
--
-- Sections:
--   §1  Currency exchange rates table + lookup function (FX engine)
--   §2  Enterprise contracts + purchase orders (Phase F)
--   §3  Audit export manifests (Phase C)
--   §4  Indexes / views for operational tooling (Phase G)

------------------------------------------------------------------------------
-- §1  FX ENGINE
------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.currency_exchange_rates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_currency   text NOT NULL,
  target_currency   text NOT NULL,
  rate              numeric(24,12) NOT NULL CHECK (rate > 0),
  provider          text NOT NULL,           -- 'ECB' | 'openexchangerates' | 'manual' | 'static'
  snapshot_id       text,                    -- provider's snapshot id when available
  effective_at      timestamptz NOT NULL,
  valid_until       timestamptz,             -- NULL = current
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_currency, target_currency, effective_at, provider)
);

CREATE INDEX IF NOT EXISTS idx_fx_lookup
  ON public.currency_exchange_rates(source_currency, target_currency, effective_at DESC);

-- FX rates are financial-evidential — immutable.
DROP TRIGGER IF EXISTS fx_immutable_update ON public.currency_exchange_rates;
CREATE TRIGGER fx_immutable_update
  BEFORE UPDATE ON public.currency_exchange_rates
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

DROP TRIGGER IF EXISTS fx_immutable_delete ON public.currency_exchange_rates;
CREATE TRIGGER fx_immutable_delete
  BEFORE DELETE ON public.currency_exchange_rates
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

-- Lookup function: returns the most recent rate for (source, target) at or
-- before `as_of`. Returns NULL if no rate is on file.
CREATE OR REPLACE FUNCTION public.lookup_fx_rate(
  p_source text,
  p_target text,
  p_as_of  timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_row public.currency_exchange_rates%ROWTYPE;
BEGIN
  IF upper(p_source) = upper(p_target) THEN
    RETURN jsonb_build_object('rate', 1.0, 'provider', 'identity', 'effective_at', p_as_of);
  END IF;

  SELECT * INTO v_row FROM public.currency_exchange_rates
   WHERE source_currency = upper(p_source)
     AND target_currency = upper(p_target)
     AND effective_at <= p_as_of
   ORDER BY effective_at DESC
   LIMIT 1;

  IF v_row.id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'id',             v_row.id,
    'rate',           v_row.rate,
    'provider',       v_row.provider,
    'snapshot_id',    v_row.snapshot_id,
    'effective_at',   v_row.effective_at
  );
END;
$$;

-- Seed identity rates so callers don't have to special-case USD→USD etc.
-- We use a single sentinel row per major currency to prevent NULL returns
-- in environments where the FX cron hasn't yet populated rates.
INSERT INTO public.currency_exchange_rates
  (source_currency, target_currency, rate, provider, effective_at, metadata)
SELECT s, t, 1.0, 'identity', '1970-01-01T00:00:00Z', jsonb_build_object('seed', true)
FROM (VALUES ('USD'), ('INR'), ('EUR'), ('GBP'), ('JPY'), ('AUD'), ('CAD')) AS a(s),
     (VALUES ('USD'), ('INR'), ('EUR'), ('GBP'), ('JPY'), ('AUD'), ('CAD')) AS b(t)
WHERE s = t
ON CONFLICT DO NOTHING;

------------------------------------------------------------------------------
-- §2  ENTERPRISE CONTRACTS
------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.enterprise_contracts (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL,
  contract_number             text NOT NULL UNIQUE,
  start_date                  date NOT NULL,
  end_date                    date NOT NULL,
  currency                    text NOT NULL DEFAULT 'USD',
  total_contract_value        numeric(14,2) NOT NULL CHECK (total_contract_value >= 0),
  payment_terms               text NOT NULL
    CHECK (payment_terms IN ('NET15','NET30','NET45','NET60','ANNUAL_UPFRONT','QUARTERLY','MONTHLY')),
  total_credit_allotment      integer NOT NULL DEFAULT 0,
  credit_overage_rate_usd     numeric(20,10),
  custom_action_pricing       jsonb NOT NULL DEFAULT '{}'::jsonb,
  signed_contract_url         text,
  signed_by_org_name          text,
  signed_by_virality          uuid,
  status                      text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_signature','active','expired','terminated','renewed')),
  parent_contract_id          uuid REFERENCES public.enterprise_contracts(id),
  notes                       text,
  metadata                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ec_org_status
  ON public.enterprise_contracts(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_ec_active_period
  ON public.enterprise_contracts(start_date, end_date) WHERE status = 'active';

DROP TRIGGER IF EXISTS trg_ec_touch ON public.enterprise_contracts;
CREATE TRIGGER trg_ec_touch
  BEFORE UPDATE ON public.enterprise_contracts
  FOR EACH ROW EXECUTE FUNCTION public.omnivyra_touch_updated_at();

-- Once a contract is `active`, signed_by_* and total_contract_value should
-- never change. Enforce via trigger.
CREATE OR REPLACE FUNCTION public.guard_contract_immutable_after_active()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('active', 'expired', 'terminated', 'renewed') THEN
    IF NEW.signed_by_virality IS DISTINCT FROM OLD.signed_by_virality
       OR NEW.signed_by_org_name IS DISTINCT FROM OLD.signed_by_org_name
       OR NEW.total_contract_value IS DISTINCT FROM OLD.total_contract_value
       OR NEW.signed_contract_url IS DISTINCT FROM OLD.signed_contract_url
       OR NEW.start_date IS DISTINCT FROM OLD.start_date
       OR NEW.end_date   IS DISTINCT FROM OLD.end_date THEN
      RAISE EXCEPTION 'CONTRACT_FROZEN: signed-and-active contract % is immutable on financial fields', OLD.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_ec_freeze ON public.enterprise_contracts;
CREATE TRIGGER guard_ec_freeze
  BEFORE UPDATE ON public.enterprise_contracts
  FOR EACH ROW EXECUTE FUNCTION public.guard_contract_immutable_after_active();

CREATE TABLE IF NOT EXISTS public.enterprise_purchase_orders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id        uuid NOT NULL REFERENCES public.enterprise_contracts(id) ON DELETE RESTRICT,
  po_number          text NOT NULL,
  amount             numeric(14,2) NOT NULL CHECK (amount > 0),
  currency           text NOT NULL,
  issued_at          date NOT NULL,
  due_date           date,
  invoice_id         uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  paid_at            timestamptz,
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, po_number)
);

CREATE INDEX IF NOT EXISTS idx_epo_contract ON public.enterprise_purchase_orders(contract_id);
CREATE INDEX IF NOT EXISTS idx_epo_unpaid   ON public.enterprise_purchase_orders(paid_at) WHERE paid_at IS NULL;

-- POs are financial-evidential — immutable at update/delete.
DROP TRIGGER IF EXISTS epo_immutable_update ON public.enterprise_purchase_orders;
CREATE TRIGGER epo_immutable_update
  BEFORE UPDATE ON public.enterprise_purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

DROP TRIGGER IF EXISTS epo_immutable_delete ON public.enterprise_purchase_orders;
CREATE TRIGGER epo_immutable_delete
  BEFORE DELETE ON public.enterprise_purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

------------------------------------------------------------------------------
-- §3  AUDIT EXPORT MANIFESTS
------------------------------------------------------------------------------
-- Every export produced by the finance team gets a row here. The manifest
-- records what was exported, by whom, the row count, and a content checksum
-- — so finance can later prove an export was not tampered with.

CREATE TABLE IF NOT EXISTS public.billing_export_manifests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  export_type          text NOT NULL
    CHECK (export_type IN (
      'ledger',
      'company_usage',
      'admin_adjustments',
      'reservation_lifecycle',
      'billing_anomalies',
      'approval_chain'
    )),
  organization_id      uuid,                  -- null = portfolio-wide
  requested_by         uuid NOT NULL,
  requested_at         timestamptz NOT NULL DEFAULT now(),
  period_start         timestamptz,
  period_end           timestamptz,
  filters              jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count            integer NOT NULL DEFAULT 0,
  content_sha256       text NOT NULL,         -- SHA-256 of the serialized export body
  byte_size            integer NOT NULL DEFAULT 0,
  format               text NOT NULL CHECK (format IN ('csv', 'json', 'ndjson')),
  download_url         text,                  -- nullable; populated when stored externally
  retention_until      timestamptz,
  metadata             jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_bem_org_type
  ON public.billing_export_manifests(organization_id, export_type, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_bem_requester
  ON public.billing_export_manifests(requested_by, requested_at DESC);

-- Export manifests are immutable — once written, the checksum proves the
-- export's integrity at retrieval time.
DROP TRIGGER IF EXISTS bem_immutable_update ON public.billing_export_manifests;
CREATE TRIGGER bem_immutable_update
  BEFORE UPDATE ON public.billing_export_manifests
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

DROP TRIGGER IF EXISTS bem_immutable_delete ON public.billing_export_manifests;
CREATE TRIGGER bem_immutable_delete
  BEFORE DELETE ON public.billing_export_manifests
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

------------------------------------------------------------------------------
-- §4  OPERATIONAL TOOLING VIEWS
------------------------------------------------------------------------------

-- Company financial timeline — composite read-only view joining ledger,
-- approvals, payments, audit events. Powers the operations tooling endpoint.
CREATE OR REPLACE VIEW public.v_company_financial_timeline AS
SELECT
  organization_id,
  created_at AS event_at,
  'ledger'         AS event_kind,
  jsonb_build_object(
    'transaction_id',   id,
    'execution_phase',  execution_phase,
    'credits_delta',    credits_delta,
    'reference_type',   reference_type,
    'reference_id',     reference_id,
    'idempotency_key',  idempotency_key,
    'usd_equivalent',   usd_equivalent
  ) AS payload
FROM public.credit_transactions
UNION ALL
SELECT
  organization_id,
  created_at AS event_at,
  'admin_audit'    AS event_kind,
  jsonb_build_object(
    'audit_id',     id,
    'action_type',  action_type,
    'amount',       amount_credits,
    'reason',       reason,
    'approval_id',  approval_id,
    'actor',        actor_user_id
  ) AS payload
FROM public.admin_financial_audit_events
UNION ALL
SELECT
  organization_id,
  proposed_at AS event_at,
  'approval'       AS event_kind,
  jsonb_build_object(
    'approval_id',  id,
    'status',       status,
    'action_type',  action_type,
    'proposed_by',  proposed_by,
    'amount',       (payload->>'amountCredits')::numeric
  ) AS payload
FROM public.credit_action_approvals
UNION ALL
SELECT
  organization_id,
  occurred_at AS event_at,
  'payment'        AS event_kind,
  jsonb_build_object(
    'payment_id',  id,
    'provider',    provider,
    'amount',      amount,
    'currency',    currency,
    'status',      status
  ) AS payload
FROM public.payment_transactions;
