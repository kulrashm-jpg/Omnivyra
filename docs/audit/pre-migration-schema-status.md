# Pre-Migration Billing Schema Status (Phase A — CORRECTED)

> **This document was corrected after a verification-integrity defect was
> found and fixed mid-phase.** The first probe run reported "24 present /
> 2 missing". That was a FALSE POSITIVE. Authoritative direct-DB
> introspection proved the billing schema is **entirely absent** from
> production. The corrected numbers below are the real state.

## Environment finding (critical)

`.env.local` points at `https://klkiseupptzbecbxwrky.supabase.co` —
**the same host as `.env.vercel.production`** and `.env.vercel.current`.
There is no separate dev database. The env-isolation guard fired:

```
[env-isolation] ENV_LOCAL_USES_REMOTE_SUPABASE … may collide with production.
```

All commands in this phase ran against **production** (read-only except
the one Phase B apply attempt, which rolled back cleanly — see the
execution report).

## The verification-integrity defect (found + fixed)

The original `probeTable` used a `head:true` + `count:exact` + `limit(0)`
probe. Verified against production:

```
HEAD-COUNT  error: null            ← table credit_action_approvals
REAL FETCH  error: PGRST205 "Could not find the table
            'public.credit_action_approvals' in the schema cache"
```

PostgREST answers a head/count request from its (stale) schema cache
**without resolving the underlying relation**, so a genuinely-absent
table returned `error: null` → silently classified `present`. This made
`verify-billing-schema.ts`, the boot validator and the health endpoint
all report **~21 absent critical tables as "present"** — a silent schema
mismatch, violating the project's mandatory fail-fast constraint.

**Fix applied** ([`billingSchemaSpec.ts`](../../backend/services/billing/bootstrap/billingSchemaSpec.ts)):
`probeTable` now does a relation-touching `select('*').limit(1)` (≤1 row,
read-only) which forces PostgREST to resolve the relation and surface the
exact `PGRST205`/`42P01` the application hits. Unit suite (26 tests) green
after the change.

## TRUE production state (corrected prober + direct introspection)

| Metric | Value |
|---|---|
| overall | **critical_missing** |
| present | **0** |
| missing | **26** |
| unverified | 2 (opaque triggers/indexes — moot, parent tables absent) |
| error | 0 |

Direct `pg` introspection (authoritative — `pg_class` across all schemas):

- `credit_action_approvals` — **NOT FOUND in any schema**
- `payment_provider_events` — **NOT FOUND** (prerequisite of 20260663)
- `billing_operations`, `job_execution_registry`, `currency_exchange_rates`,
  `enterprise_contracts`, … — **NOT FOUND**
- Only pre-existing older tables present: `credit_transactions`,
  `credit_admin_grants`, `super_admin_audit_logs`, `companies`, …
- `SELECT count(*) FROM public.credit_action_approvals`
  → `ERROR: relation "public.credit_action_approvals" does not exist`

**The user's reported error is real and correct** — the billing tables
genuinely do not exist in production.

## Migration-ledger desynchronization (root blocker)

| Fact | Value |
|---|---|
| Migration files in repo | **145 versions** |
| Recorded in `supabase_migrations.schema_migrations` | **4** (`20260321, 20260322, 20260323, 20260643`) |
| "Pending" per ledger | **141** |
| But: old tables (`companies`, `credit_transactions`) exist | yes |

The ledger is **fundamentally disconnected from reality**: production
was not provisioned through this 145-file migration history (only 4
entries recorded) yet most non-billing schema exists. This means
`supabase db push` would attempt **141 migrations** over an
already-populated production DB — many not vetted for idempotency —
risking conflicts/corruption on the first non-idempotent statement.

## Missing objects (all 26, corrected)

CRITICAL: `credit_action_approvals`, `credit_action_approval_signatures`,
`billing_operations`, `job_execution_registry`,
`required_approvals_for_action` (rpc), `sign_credit_action_approval` (rpc),
`claim_job_execution` (rpc), `advance_job_execution` (rpc).
HIGH: `admin_financial_audit_events`, `credit_untracked_actions`,
`payment_provider_event_state`, `currency_exchange_rates`,
`billing_export_manifests`, `v_reservation_health`, `lookup_fx_rate` (rpc).
MEDIUM: `company_billing_profiles`, `payment_transactions`,
`billing_subscriptions`, `invoices`, `invoice_line_items`,
`usage_billing_snapshots`, `enterprise_contracts`,
`enterprise_purchase_orders`, `v_billing_operations_health`,
`v_approval_health`, `v_company_financial_timeline`.

## Conclusion

This is not a "billing schema activation" — it is a **production
migration-history reconciliation** problem. Safe remediation is
operator-gated (see the execution report and final activation report).
Verdict: **HOLD GA**.
