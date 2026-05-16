# AI Billing Enforcement Activation

**Date:** 2026-05-16
**Scope:** Staged rollout plan for `BILLING_REQUIRE_AI_HANDLE=true` + `billing.ai_enforced` flag
**Status:** Operational playbook. Activation actions are operator-side; this doc is the procedure.

---

## 1. Activation surface

Two switches drive AI billing enforcement; they layer rather than conflict:

| Switch | Granularity | When ON |
|---|---|---|
| `BILLING_REQUIRE_AI_HANDLE=true` (env) | Platform-wide | `aiGateway.runCompletionWithOperation` throws on any unguarded call (no credit handle AND no allowlist entry) |
| `billing.ai_enforced` (feature flag, per-org) | Per-org cohort | Same behavior, but only for the cohort the flag is enabled for |

Default state: **both OFF.** The platform runs in shadow mode — anomaly counters increment but no calls are blocked.

---

## 2. Pre-activation invariants

Before any enforcement step, ALL of these must be true. The activation operator verifies via the consistency verifier:

```sh
# Run via super-admin / ops endpoint:
GET /api/super-admin/billing-dashboard?refresh=true
```

| Invariant | Source | Required state |
|---|---|---|
| Wallet ↔ ledger drift | reconciliation cron output | 0 orgs |
| Reservation mismatches | reservation reconciliation | 0 |
| Orphan usage (last hour) | orphan-usage cron | ≤ 5 |
| Non-billable registry expired entries | `auditRegistry()` | 0 |
| Non-billable registry missing owner/reason | `auditRegistry()` | 0 |
| CI guard | `scripts/audit/no-direct-credit-deductions.ts` | 0 errors |

Plus the non-billable registry must be seeded (§3).

---

## 3. Non-billable registry seeding

The Phase 3 advisory classification identified 126 sites that are intentionally non-billable (mostly `inside_orchestrated_scope`). Before enforcement, these must be registered so the guard treats them as allowlisted.

**Action:** run

```sh
APPROVED_BY_USER_ID=<super-admin-uuid> npx tsx scripts/audit/seed-non-billable-registry.ts
```

Verify:

```sh
npx tsx scripts/audit/non-billable-registry-check.ts
# expected: exit 0
```

After seeding:
- Run the CI guard with `STRICT_BILLING_AUDIT=true` to confirm the unowned count = 0
- The 4 F3 (migration_pending) sites are STILL flagged because they're scheduled to be migrated to `runBilledAiCompletion`. They are listed in [direct-deduction-advisory-classification.md §4 — Remediation Calendar](./direct-deduction-advisory-classification.md#4-remediation-calendar).

---

## 4. Staged rollout — cohorts

Use the `billingRolloutCoordinator` to apply each cohort step. The coordinator validates dependencies and consistency before/after each step; if `verifyBillingConsistency` returns `overallStatus='fail'`, the rollout auto-stops.

| Step | Cohort | Action |
|---|---|---|
| 1 | `internal` | `enableBillingCanaryForOrg({ organizationId: '<internal-test-org>', actorUserId: ... })` for platform-owned QA orgs |
| 2 | `staging_tenant` | Repeat for each staging tenant |
| 3 | `canary` | Pick a single low-risk production org. Communicate with customer success in advance. |
| 4 | `limited_production` | `applyPercentageRollout({ organizationIds: [...], percent: 10, ... })` |
| 5 | `expanded_production` | Same, percent: 50 |
| 6 | `full` | Same, percent: 100 |
| 7 | `BILLING_REQUIRE_AI_HANDLE=true` env | Final platform-wide kill switch flip (after step 6 has held for ≥ 7 days) |

Between each step, wait **24 hours minimum** and run `verifyBillingConsistency()`. Only proceed if `overallStatus='pass'`.

---

## 5. Detection during rollout

Throughout enforcement rollout the dashboard reports these signals continuously:

| Signal | What to watch for |
|---|---|
| `untracked_ai_call_blocked_total` | After enforcement, this should be near-zero for enforced orgs. A non-zero count = an unregistered legitimate path. |
| `untracked_ai_call_blocked` anomalies (severity=critical) | Indicates an enforced caller actually being blocked. Investigate immediately. |
| Customer complaints about AI feature failures | Direct signal of an over-restrictive enforcement |
| `usage_events` vs `credit_transactions` mismatch (orphan usage) | Reverse of the above — calls slipping through enforcement |
| `cost_anomalies` table (existing) | LLM provider mismatch or model-pricing drift |
| `reconciliation_failures_total` | Settlement drift |

---

## 6. Auto-disable

`billingRolloutCoordinator.enableBillingCanaryForOrg` runs a post-enablement consistency check. If it reports `rollbackRequired=true`, the coordinator calls `emergencyDisableBillingCanary` for that org automatically — flipping `billing.ai_enforced` and `billing.refine_variant_enabled` OFF without operator intervention.

This is the **automated safety net**. Operator-initiated rollbacks use the same `rollbackBillingForOrg` API.

---

## 7. Verification steps per cohort step

After each step (1 → 7 in §4):

```sh
# 1. Consistency check
curl -X GET 'https://<staging>/api/super-admin/billing-dashboard?orgId=<canary-org>'

# 2. Inspect counters
# Look for non-zero values of `untracked_ai_call_blocked_total` filtered to this cohort.

# 3. 24h cool-down
# Watch for any customer complaints or anomaly alerts.

# 4. If clean → proceed to next step.
# If degraded → investigate, fix, re-validate.
# If failed → execute rollback.
```

---

## 8. Validation: AI calls route through the orchestrator

Each enforcement step is validated by:

- Confirming `usage_events` rows have a matching CONFIRM row in `credit_transactions` (the orphan-usage cron catches misses).
- Confirming `billing_operations` rows exist for HTTP routes that migrated to `runBilledAiCompletion`.
- Confirming no `unauthorized` errors from `aiGateway.runCompletionWithOperation` for unfamiliar operations.

---

## 9. Rollback procedure

If at any point a step fails its post-enablement consistency check OR a critical anomaly fires:

| Scope | API |
|---|---|
| Single org | `rollbackBillingForOrg({ organizationId, reason, actorUserId })` |
| Cohort | reset cohort percent to 0 via `applyRolloutStep` (or set `enabled=false`) |
| Platform | unset `BILLING_REQUIRE_AI_HANDLE` env var; restart workers; flag-flip to 0% |
| Emergency | `executePlatformKillSwitch({ reason, actorUserId })` — disables ALL billing flags at once |

---

## 10. Activation status (tracked by operator)

When activation completes, append a status row to this document:

```
| Date       | Cohort                  | Actor          | Pre-check | Post-check | Status |
|------------|-------------------------|----------------|-----------|------------|--------|
| 2026-MM-DD | internal                | <super-admin>  | pass      | pass       | done   |
| 2026-MM-DD | staging_tenant          | <super-admin>  | pass      | pass       | done   |
| 2026-MM-DD | canary (org=<id>)       | <super-admin>  | pass      | pass       | done   |
| 2026-MM-DD | limited_production 10%  | <super-admin>  | pass      | pass       | done   |
| 2026-MM-DD | expanded_production 50% | <super-admin>  | pass      | pass       | done   |
| 2026-MM-DD | full 100%               | <super-admin>  | pass      | pass       | done   |
| 2026-MM-DD | env BILLING_REQUIRE_AI_HANDLE=true | <super-admin>  | pass      | pass       | done   |
```

---

## 11. Post-activation maintenance

- Quarterly: re-run `auditRegistry()` to catch expired non-billable entries
- Quarterly: review `untracked_ai_call_blocked_total` trend — sustained non-zero = registry gap
- On every new code addition: CI guard catches new unguarded `runCompletionWithOperation` callers
