# Billing Schema Inventory (Phase A)

Authoritative, per-migration inventory of every database object the
enterprise billing subsystem depends on. This is the human-readable
companion to the machine-readable source of truth in
[`backend/services/billing/bootstrap/billingSchemaSpec.ts`](../../backend/services/billing/bootstrap/billingSchemaSpec.ts).

If you add a billing migration, you MUST update both this file and
`billingSchemaSpec.ts` (the CI guard `scripts/audit/verify-billing-schema.ts`
and the boot validator probe the spec — drift is caught there, but the
spec only contains what was added to it).

## Dependency order (immutable)

```
20260663  →  20260664  →  20260665
(Phase 1)    (Phase 2)     (Phase 3)
```

`20260664` references objects created in `20260663` (e.g. it extends the
approval flow and reads `credit_action_approvals`). `20260665` references
the FX/contract surface independently but is sequenced last. The safe
runner [`scripts/audit/run-billing-migrations.ts`](../../scripts/audit/run-billing-migrations.ts)
hard-codes this order and applies one transaction per file, stopping on
the first failure (later files depend on earlier ones).

All three migrations are **idempotent**: `CREATE TABLE IF NOT EXISTS`,
`CREATE OR REPLACE FUNCTION/VIEW`, `CREATE INDEX IF NOT EXISTS`, and the
trigger pattern `DROP TRIGGER IF EXISTS … ; CREATE TRIGGER …`. Re-running
a fully-applied migration is a no-op. There is **no destructive DDL** (no
`DROP TABLE`, `TRUNCATE`, `DELETE FROM`, `DROP COLUMN`, `DROP SCHEMA`);
the runner refuses to execute a file that contains any.

There are **no RLS policies and no GRANT/REVOKE** in these migrations —
the billing subsystem is accessed exclusively through the Supabase
service-role key on the server; org isolation is enforced in the
application layer (`assertOrgAccess`) and at the DB layer by the
immutability/guard triggers and `FOR UPDATE` locking inside the RPCs.

---

## 20260663 — `20260663_ledger_immutability_and_governance.sql` (Phase 1)

Closes the four CRITICAL gaps: mutable ledger, no approval chain, queue
double-deduct, unwrapped AI billing.

### Tables

| Table | Severity | Consumer |
|---|---|---|
| `credit_action_approvals` | **critical** | approval flow (grant/adjust/refund), idempotency console |
| `credit_action_approval_signatures` | **critical** | `sign_credit_action_approval` |
| `credit_action_approval_thresholds` | **critical** | `required_approvals_for_action` N-of-M ladder |
| `billing_operations` | **critical** | enterprise billing orchestrator, reconciliation, dashboards |
| `job_execution_registry` | **critical** | queue billing middleware exactly-once |
| `admin_financial_audit_events` | high | financial audit trail, dashboards |
| `credit_untracked_actions` | high | aiGateway billing-guard allowlist |
| `payment_provider_event_state` | high | payment webhook fulfillment state |

### Functions / RPCs

| Function | Kind | Severity | Notes |
|---|---|---|---|
| `raise_ledger_immutable()` | trigger fn | critical | rejects UPDATE/DELETE on financial-history tables (`LEDGER_IMMUTABLE`) |
| `sign_credit_action_approval(...)` | mutating RPC | critical | N-of-M signature, segregation-of-duties (no self-sign) |
| `required_approvals_for_action(...)` | **read-only RPC** | critical | live-probed by the verifier (`p_action_type`, `p_amount`) |
| `claim_job_execution(...)` | mutating RPC | critical | exactly-once job claim |
| `advance_job_execution(...)` | mutating RPC | critical | monotonic job-status advance |
| `advance_payment_provider_event_state(...)` | mutating RPC | high | payment webhook state machine |
| `guard_approval_post_execute()` | trigger fn | critical | freezes approvals after execution |
| `guard_jer_status_monotonic()` | trigger fn | high | rejects non-monotonic job-status transitions |
| `guard_bo_no_delete()` | trigger fn | critical | blocks DELETE on `billing_operations` |

### Triggers

- `credit_transactions_immutable_update` / `_delete` — append-only ledger
- `credit_admin_grants_immutable_update` / `_delete`
- `super_admin_audit_logs_immutable_update` / `_delete`
- `payment_provider_events_immutable_update` / `_delete`
- `trg_ppe_state_touch` (updated_at), `trg_catt_touch`, `trg_caa_touch`
- `guard_caa_post_execute` (approval freeze-after-execute)
- `caas_immutable_update` / `_delete` (signature immutability)
- `guard_jer_status_monotonic` (job-status monotonicity)
- `afae_immutable_update` / `_delete` (audit-event immutability)
- `bo_no_delete` (billing_operations no-delete)
- `cua_immutable_update` (untracked-actions immutability)

### Indexes

`idx_ppe_state_status`, `idx_caa_client_request_unique` (UNIQUE —
idempotency), `idx_caa_status_expires`, `idx_caa_org_proposer`,
`idx_caas_approval`, `idx_jer_status_first_seen`, `idx_jer_job`,
`idx_jer_org`, `idx_jer_billing_op`, `idx_afae_actor`, `idx_afae_org`,
`idx_afae_action`, `idx_afae_approval`, `idx_bo_org_status`,
`idx_bo_module_status`, `idx_bo_correlation`, `idx_bo_open`.

### Views

- `v_pricing_catalog`

### Rollback

Rollback-safe by **non-application** only. These objects are additive and
financial-history-immutable; there is intentionally **no down-migration**
(dropping the immutability triggers or `billing_operations` would
re-open the CRITICAL gaps and could orphan in-flight reservations). To
disable behaviour without dropping schema, use the billing feature flags
(`billingFeatureFlags.ts`) — the schema can sit dormant safely.

---

## 20260664 — `20260664_phase2_governance_and_payment_foundation.sql` (Phase 2)

Finance RBAC views, org freeze/lock controls, approval cancellation, and
the payment/invoice/subscription projection foundation.

### Tables / columns

| Object | Severity | Consumer |
|---|---|---|
| `org_controls` (+ `emergency_freeze`, `billing_lock` columns via `ALTER TABLE … ADD COLUMN IF NOT EXISTS`) | high | emergency freeze / billing lock |
| `company_billing_profiles` | medium | payment foundation |
| `payment_transactions` | medium | payment foundation |
| `billing_subscriptions` | medium | subscription projection |
| `invoices` | medium | invoice projection / portal |
| `invoice_line_items` | medium | invoice projection / portal |
| `usage_billing_snapshots` | medium | usage aggregation |

### Functions / RPCs

| Function | Kind | Severity |
|---|---|---|
| `cancel_credit_action_approval(...)` | mutating RPC | high |
| `guard_invoice_line_items_frozen()` | trigger fn | medium (freeze line items once invoice issued) |

### Triggers

`trg_cbp_touch`, `payment_transactions_immutable_update` / `_delete`,
`trg_subs_touch`, `trg_invoices_touch`, `ili_freeze_on_issued`,
`ubs_immutable_update`.

### Indexes

`idx_org_controls_emergency_freeze`, `idx_org_controls_billing_lock`,
`idx_payment_tx_org_occurred`, `idx_payment_tx_status`,
`idx_subs_org_status`, `idx_subs_period_end`, `idx_invoices_org_period`,
`idx_invoices_status`, `idx_inv_line_invoice`, `idx_ubs_org_period`.

### Views

- `v_finance_role_holders` — finance RBAC resolution
- `v_billing_operations_health` — super-admin dashboard
- `v_approval_health` — super-admin dashboard
- `v_reservation_health` — **high**: company portal + reservation reconciliation

### Rollback

The `ALTER TABLE public.org_controls ADD COLUMN IF NOT EXISTS …` is
additive and idempotent. No down-migration: the immutability triggers on
`payment_transactions` and the freeze trigger on `invoice_line_items`
protect financial history and must not be reversed in place. Dormant-safe
via feature flags.

---

## 20260665 — `20260665_phase3_fx_engine_and_contracts.sql` (Phase 3)

Multi-currency FX engine, enterprise contracts/POs, export integrity
manifests, forensic timeline.

### Tables

| Table | Severity | Consumer |
|---|---|---|
| `currency_exchange_rates` | high | FX engine |
| `enterprise_contracts` | medium | contract resolver / portal |
| `enterprise_purchase_orders` | medium | enterprise billing |
| `billing_export_manifests` | high | export integrity (SHA-256) manifests |

### Functions / RPCs

| Function | Kind | Severity |
|---|---|---|
| `lookup_fx_rate(p_source, p_target, …)` | **read-only RPC** | high — live-probed by the verifier with `{USD,USD}` |
| `guard_contract_immutable_after_active()` | trigger fn | medium |

### Triggers

`fx_immutable_update` / `_delete`, `trg_ec_touch`, `guard_ec_freeze`
(contract freeze after active), `epo_immutable_update` / `_delete`,
`bem_immutable_update` / `_delete`.

### Indexes

`idx_fx_lookup` (FX rate lookup), `idx_ec_org_status`,
`idx_ec_active_period`, `idx_epo_contract`, `idx_epo_unpaid`,
`idx_bem_org_type`, `idx_bem_requester`.

### Views

- `v_company_financial_timeline` — forensic timeline

### Rollback

Additive, idempotent, immutability-protected. No down-migration. FX rates
and export manifests are append-only by trigger; dropping them would
break audit integrity. Dormant-safe via feature flags.

---

## What the prober can and cannot definitively verify

| Object class | Verification | Status emitted |
|---|---|---|
| tables, views | PostgREST head-count select (read-only, zero rows) | `present` / `missing` |
| read-only RPCs (`lookup_fx_rate`, `required_approvals_for_action`) | safe live call with neutral args | `present` / `missing` |
| mutating RPCs | **never called** — inferred from a same-migration critical table | `present` / `missing` / `unverified` |
| triggers, indexes | **not PostgREST-visible** — inferred from `inferredFrom` table; exact `verifySql` emitted for the operator | `present` / `missing` / `unverified` |

`unverified` is never silently treated as present (satisfies the "no
silent schema mismatch" constraint). For every opaque object the report
carries the precise SQL an operator runs for a definitive check
(`SELECT … FROM information_schema.triggers` / `pg_indexes`).

## Verification entry points

| Surface | File | Use |
|---|---|---|
| CI guard | `scripts/audit/verify-billing-schema.ts` | fail CI on critical-missing (`STRICT_BILLING_SCHEMA` to fail on any) |
| Safe runner | `scripts/audit/run-billing-migrations.ts` | apply only the missing migrations, transaction-per-file, `--dry-run` |
| Boot validator | `backend/services/billing/bootstrap/billingBootstrapValidator.ts` | once-per-process; loud in DEV, degraded health in PROD, never `process.exit()` |
| Health endpoint | `pages/api/admin/billing/health.ts` | `GET` (FINANCE_AUDITOR) — schema/migration/trigger/readiness, 200 ok / 503 degraded |
