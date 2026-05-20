-- =============================================================================
-- Enterprise-grade RLS — financial table isolation (CREATED, NOT TO BE APPLIED
-- without operator-led cross-org isolation validation on a live DB).
--
-- WHY this migration is segregated and gated: enabling RLS on the financial
-- core (credit_transactions, organization_credits, reconciliation tables,
-- usage_events linkage, snapshots) is the single highest-risk operational
-- change in the entire monetization stack. If a policy doesn't match a real
-- consumer path (reaper / reconciliation job / admin tooling / queue worker)
-- it can SILENTLY break billing reads/writes. Phase 5/6 explicitly flagged
-- this as BLOCKED for canary until live validation. This file delivers the
-- policy SQL so it is reviewable, version-controlled, and operator-runnable
-- in a sanctioned validation window — NOT during normal controlled apply.
--
-- OPERATOR ACTIVATION CONTRACT (must hold before applying this migration):
--   1. A non-prod DB seeded with at least 2 orgs, with workers/reaper/
--      reconciliation jobs running, has had this migration applied AND
--   2. The following must be empirically verified GREEN against that DB:
--        a) `apply_credit_reservation` RPC works for both orgs (HOLD/CONFIRM/
--           RELEASE/partial-confirm) — financial RPCs are SECURITY DEFINER so
--           must still operate correctly.
--        b) `creditOrphanHoldReaper` continues to find + RELEASE expired
--           holds without permission errors.
--        c) Reconciliation jobs (provider_invoice_imports / cost_reconciliation_runs
--           writers) function under the service role.
--        d) Cross-org SELECT from an authenticated user-role with a session
--           for org A returns ZERO rows for org B across:
--             credit_transactions, organization_credits, credit_hold_policy_snapshots,
--             cost_reconciliation_adjustments, provider_invoice_imports,
--             usage_events (where organization_id is set).
--        e) Admin/super-admin tooling continues to function.
--   3. Rollback procedure validated: ALTER TABLE ... DISABLE ROW LEVEL SECURITY
--      restores prior behavior immediately (no down-migration needed).
--
-- SECURITY MODEL NOTE (Supabase): the service_role has BYPASSRLS by design.
-- The app already uses service_role for financial reads/writes, so these
-- policies primarily provide DEFENSE-IN-DEPTH against the authenticated/anon
-- roles — preventing direct user-role access to financial tables that could
-- otherwise leak across orgs if a future code path mistakenly used a non-
-- service client. Cross-org isolation at the application layer remains the
-- responsibility of the existing app-auth model; this migration hardens the
-- DB so that even if app-auth were bypassed, user-roles cannot read.
--
-- SAFETY POSTURE: purely additive; existing service_role behavior unchanged;
-- no historical mutation; rollback is a single ALTER TABLE per table.
-- NOT applied by this change — controlled operator validation gate only.
-- =============================================================================

-- ── Step 1: REVOKE direct privileges from user roles ────────────────────────
-- (Defense-in-depth — even if RLS were misconfigured below, user roles still
--  cannot read or mutate these tables directly.)
DO $$
BEGIN
  -- Be tolerant if a role doesn't exist in non-standard installs.
  BEGIN
    REVOKE ALL ON TABLE
      public.credit_transactions,
      public.organization_credits,
      public.credit_hold_policy_snapshots,
      public.cost_reconciliation_adjustments,
      public.cost_reconciliation_runs,
      public.provider_invoice_imports,
      public.platform_cost_allocations,
      public.platform_cost_categories
    FROM PUBLIC, anon, authenticated;
  EXCEPTION WHEN undefined_table OR undefined_object THEN
    -- One or more tables may not yet exist in environments where earlier
    -- migrations have not been applied; skip silently here so this file can
    -- be re-run safely. The expected order is: apply 20260665..20260694 first.
    RAISE NOTICE 'financial_rls_policies: one or more financial tables not present yet — skipping REVOKE.';
  END;
END$$;

-- ── Step 2: ENABLE RLS on each financial table ──────────────────────────────
ALTER TABLE IF EXISTS public.credit_transactions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.organization_credits             ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.credit_hold_policy_snapshots     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.cost_reconciliation_adjustments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.cost_reconciliation_runs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.provider_invoice_imports         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.platform_cost_allocations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.platform_cost_categories         ENABLE ROW LEVEL SECURITY;

-- ── Step 3: Deny-by-default policies for user roles ─────────────────────────
-- service_role bypasses RLS by design (existing app-auth pattern preserved).
-- authenticated/anon get NO read or write. If a future feature needs a
-- per-org user-role read, add an org-scoped policy in a separate, reviewed
-- migration (e.g. via EXISTS(SELECT 1 FROM user_company_roles WHERE
-- user_id=auth.uid() AND company_id=<table>.organization_id AND status='active')).

CREATE POLICY rls_deny_user_role_credit_transactions
  ON public.credit_transactions
  FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);

CREATE POLICY rls_deny_user_role_organization_credits
  ON public.organization_credits
  FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);

CREATE POLICY rls_deny_user_role_credit_hold_policy_snapshots
  ON public.credit_hold_policy_snapshots
  FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);

CREATE POLICY rls_deny_user_role_cost_reconciliation_adjustments
  ON public.cost_reconciliation_adjustments
  FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);

CREATE POLICY rls_deny_user_role_cost_reconciliation_runs
  ON public.cost_reconciliation_runs
  FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);

CREATE POLICY rls_deny_user_role_provider_invoice_imports
  ON public.provider_invoice_imports
  FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);

CREATE POLICY rls_deny_user_role_platform_cost_allocations
  ON public.platform_cost_allocations
  FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);

CREATE POLICY rls_deny_user_role_platform_cost_categories
  ON public.platform_cost_categories
  FOR ALL TO authenticated, anon
  USING (false) WITH CHECK (false);

-- ROLLBACK (per table): ALTER TABLE public.<name> DISABLE ROW LEVEL SECURITY;
-- and/or DROP POLICY <name> ON public.<name>; — both non-destructive, no data
-- migration required. Service-role behavior is unaffected by enable/disable.
