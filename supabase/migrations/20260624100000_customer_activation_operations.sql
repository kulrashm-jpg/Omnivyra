-- Phase 20 — customer activation outreach execution tracking.
-- Operational tooling (NOT analytics/intelligence): persists the per-customer activation
-- outreach workflow state and an append-only activity log so operators can track execution of
-- activation work. Additive, isolated, reversible (DROP TABLE). No FKs. Operator-controlled
-- writes only (super-admin gated).

CREATE TABLE IF NOT EXISTS public.customer_activation_outreach (
  company_id          uuid PRIMARY KEY,
  current_state       text NOT NULL DEFAULT 'NOT_CONTACTED'
                        CHECK (current_state IN ('NOT_CONTACTED','CONTACTED','CUSTOMER_RESPONDED','IN_PROGRESS','ACTIVATED')),
  last_activity_date  timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customer_activation_activity_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  activity_type   text NOT NULL,
  activity_date   timestamptz NOT NULL DEFAULT now(),
  owner           text,
  notes           text,
  status          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_caal_company ON public.customer_activation_activity_log (company_id, activity_date DESC);

-- Seed one outreach row per CUSTOMER-class company (NOT_CONTACTED). Idempotent.
INSERT INTO public.customer_activation_outreach (company_id, current_state)
SELECT company_id, 'NOT_CONTACTED'
FROM public.customer_population_classification
WHERE classification = 'CUSTOMER'
ON CONFLICT (company_id) DO NOTHING;
