-- =============================================================================
-- Additive versioned billing-policy governance layer (config ONLY)
--
-- Homes operational governance knobs (safety_factor, safety_gate_mode,
-- kill_switch, shadow_mode, refine_variant_billing_enabled) that were
-- env/compile-time, into a deterministic, versioned, replay-safe DB surface —
-- mirroring the proven action_pricing_config / llm_model_pricing pattern
-- (effective_from + is_active). NO wallet/HOLD/ledger/RPC change.
--
-- Resolution precedence (in the resolver, not here):
--   organization-scoped active row  →  global active row  →  env/compile default
-- DEFAULT-PRESERVING: when NO active row exists for a key, the resolver
-- returns undefined and callers keep their exact existing env/default
-- behavior (byte-identical). The resolver also never throws if this table is
-- absent, so code is safe in environments where this migration has not been
-- applied.
--
-- SAFETY: purely additive, idempotent (IF NOT EXISTS), no historical
-- mutation, no backfill, no changes to existing tables/RPCs. Governance
-- changes are auditable via the EXISTING credit_action_approvals
-- 'admin_rate_change' flow (no new approval system).
-- NOT applied by this change — controlled migration process only.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.billing_policy_config (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key             text        NOT NULL,
  scope           text        NOT NULL CHECK (scope IN ('global', 'organization')),
  organization_id uuid,
  value           jsonb       NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_policy_scope_org_consistent
    CHECK ((scope = 'organization') = (organization_id IS NOT NULL))
);

-- One active GLOBAL row per key (latest effective_from wins at read time;
-- mirrors action_pricing_config's single-active-row discipline).
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_policy_global_active
  ON public.billing_policy_config (key)
  WHERE scope = 'global' AND is_active = true;

-- One active ORG row per (key, organization_id).
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_policy_org_active
  ON public.billing_policy_config (key, organization_id)
  WHERE scope = 'organization' AND is_active = true;

-- Resolver lookup path.
CREATE INDEX IF NOT EXISTS idx_billing_policy_resolve
  ON public.billing_policy_config (key, is_active, effective_from);
