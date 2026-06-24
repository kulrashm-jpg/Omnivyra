-- Phase 16A — governed customer population classification source.
-- Persists the deterministic tenant classification (CUSTOMER/INTERNAL/QA/TEST/DEMO/UNKNOWN)
-- so every engine stops re-deriving population identity and an operator can correct it.
-- Additive, isolated, reversible (DROP TABLE). No FKs. Operator-controlled writes only.

CREATE TABLE IF NOT EXISTS public.customer_population_classification (
  company_id      uuid PRIMARY KEY,
  classification  text NOT NULL,
  confidence      text NOT NULL,
  reason          text,
  classified_at   timestamptz NOT NULL DEFAULT now(),
  classified_by   text NOT NULL DEFAULT 'deterministic-classifier-14I'
);

CREATE INDEX IF NOT EXISTS idx_cpc_classification ON public.customer_population_classification (classification);

-- Rollback: DROP TABLE IF EXISTS public.customer_population_classification;
