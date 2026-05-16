# Final Production Rollout Order

**Date:** 2026-05-16
**Scope:** Exact step-by-step production rollout sequence after go-live checklist is signed
**Status:** Operator playbook. Use after [final-go-live-checklist.md](./final-go-live-checklist.md) is 100% green.

---

## Day -1 (final pre-flight)

| Step | Action | Verification |
|---|---|---|
| 1 | Confirm [final-go-live-checklist.md](./final-go-live-checklist.md) is 100% green | All sign-offs present |
| 2 | Re-run integrity audit | `overallStatus = 'healthy'` |
| 3 | Snapshot current production state | Save to `production-baseline-<date>.json` |
| 4 | On-call confirms availability for 7-day window | Slack + PagerDuty |
| 5 | Cancel/postpone any other infra changes during this window | Change management board |

---

## T0 — Internal cohort (Hour 0)

```sh
# Step 1: enable billing flags for internal/test orgs
curl -X POST "$BASE/api/super-admin/billing-rollout/apply-step" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "cohort": "internal",
    "flag": "billing.ai_enforced",
    "orgIds": ["<internal-org-uuid>", "<qa-org-uuid>"],
    "percent": 100,
    "reason": "Internal cohort enablement — Day 0",
    "actorUserId": "<super-admin-uuid>"
  }'

# Repeat for: billing.reservations_required, billing.refine_variant_enabled
```

**Hold 4 hours.** Watch the dashboard. If any anomaly fires → rollback.

| Verification | Pass criteria |
|---|---|
| `untracked_ai_call_blocked_total` for internal orgs | 0 |
| Internal org `usage_events` match credit CONFIRM rows | 100% |
| Wallet drift | 0 |

---

## T0 + 4h — Staging tenant cohort

Same `apply-step` call but cohort=`staging_tenant`, listing each staging tenant's org id.

**Hold 4 hours.** Same verification.

---

## T0 + 8h — Canary org (1 production org)

| Step | Action |
|---|---|
| 1 | Customer Success confirms canary customer is briefed |
| 2 | `enableBillingCanaryForOrg({ organizationId: '<canary-org>', actorUserId, requireCleanConsistency: true })` |
| 3 | Monitor for 24 hours |

| Verification | Pass criteria |
|---|---|
| Customer support tickets re billing | 0 |
| Anomaly counters | < 5 per hour |
| `verifyBillingConsistency({ organizationId: '<canary-org>' })` | `overallStatus = 'pass'` |
| Wallet drift for canary | 0 |

If clean for 24h → proceed. If any blocking signal → execute `emergencyDisableBillingCanary` and investigate.

---

## T0 + 32h — Limited production (10% cohort)

```sh
curl -X POST "$BASE/api/super-admin/billing-rollout/apply-percentage" \
  -d '{
    "organizationIds": [<all production org uuids>],
    "percent": 10,
    "actorUserId": "<super-admin-uuid>"
  }'
```

The coordinator's `applyPercentageRollout` deterministically hashes each org_id and selects ~10% for enablement. Selected orgs get `billing.ai_enforced` + `billing.reservations_required` + `billing.refine_variant_enabled`.

**Hold 48 hours.** Watch:

| Signal | Target | Action if breached |
|---|---|---|
| Customer tickets re billing | < 5 per cohort per 48h | Pause; investigate; possibly rollback |
| Anomaly `severity=critical` rate | 0 | Immediate page + investigate |
| Wallet drift count | 0 | Page on-call |
| `untracked_ai_call_blocked_total` rate | < 10/min for enforced cohort | Investigate registry gap |
| `reconciliation_failures_total` rate | 0 | Immediate page |

---

## T0 + 80h — Expanded production (50% cohort)

```sh
curl -X POST "$BASE/api/super-admin/billing-rollout/apply-percentage" \
  -d '{
    "organizationIds": [<all production org uuids>],
    "percent": 50,
    "actorUserId": "<super-admin-uuid>"
  }'
```

**Hold 48 hours.** Same verification.

---

## T0 + 128h — Full production (100%)

```sh
curl -X POST "$BASE/api/super-admin/billing-rollout/apply-percentage" \
  -d '{
    "organizationIds": [<all production org uuids>],
    "percent": 100,
    "actorUserId": "<super-admin-uuid>"
  }'
```

**Hold 7 days.** Watch all signals. Customer Success runs weekly review.

---

## T0 + 14 days — Platform kill switch flip

```sh
# Set BILLING_REQUIRE_AI_HANDLE=true in env vars
# Restart worker pool to pick up env change
```

This is the **final lock-in**: from this point, the entire platform enforces AI billing at the gateway. Any new unguarded `runCompletionWithOperation` caller throws on first invocation.

| Verification | Pass criteria |
|---|---|
| After 1h: zero unexpected `BILLING_REQUIRED` exceptions in logs | Strict |
| After 24h: customer ticket rate not elevated | < 10% above baseline |
| After 7d: no settlement drift | Wallet recon clean |

---

## T0 + 21 days — Refine variant full enablement

```sh
# Switch from canary mode to enforce
# Set REFINE_VARIANT_BILLING_ENABLED=true (or unset, defaults to enabled)
```

| Verification |
|---|
| Pre-step: customer comms complete (per [customer-billing-impact-assessment.md](./customer-billing-impact-assessment.md)) |
| Pre-step: grace org list committed to `REFINE_VARIANT_BILLING_GRACE_ORGS` |
| Post-step: refine_variant credits charged on each call |
| Post-step: grace orgs NOT charged |

---

## Rollback order (mirror of rollout, inverse)

If at ANY rollout step the verification breaches a target:

| Active state | Rollback action |
|---|---|
| Refine variant full | `REFINE_VARIANT_BILLING_ENABLED=canary` (back to flag-gated) |
| Platform kill switch | Unset `BILLING_REQUIRE_AI_HANDLE`; restart workers |
| 100% cohort | `applyPercentageRollout({ percent: 50 })` |
| 50% cohort | `applyPercentageRollout({ percent: 10 })` |
| 10% cohort | Disable for the cohort: `executeRollback({ scope: 'cohort', cohort: 'limited_production' })` for each billing flag |
| Canary org | `emergencyDisableBillingCanary({ organizationId, ... })` |
| Staging tenant | `executeRollback({ scope: 'cohort', cohort: 'staging_tenant' })` |
| Internal | `executeRollback({ scope: 'cohort', cohort: 'internal' })` |

**Schema is NEVER rolled back.** All migrations are additive. Triggers remain in place. Empty tables remain.

---

## Kill switches reference

| Switch | Effect | Reversibility |
|---|---|---|
| `REFINE_VARIANT_BILLING_ENABLED=false` env | Stop charging refine_variant globally | Instant (next call) |
| `REFINE_VARIANT_BILLING_GRACE_ORGS=<csv>` env | Exempt specific orgs | Instant |
| `BILLING_REQUIRE_AI_HANDLE` unset | Disable platform-wide AI enforcement | Worker restart |
| `executeRollback({ scope: 'platform', flag })` | Disable a flag for ALL orgs | Instant |
| `executePlatformKillSwitch({ reason })` | Disable ALL billing flags at once | Instant |
| `applyFinancialControl({ action: 'freeze' })` per-org | Block ALL credit consumption for one org | Instant |

---

## Schedule (Gantt-style)

```
Day -1   ────────                                                              Final pre-flight
Day  0   ━━━━━━                                                               Internal cohort
Day 0+4h ──────────                                                           Staging tenants
Day 0+8h           ━━━━━━━━━━━━━━━━━━━━━━━━                                   Canary (24h hold)
Day 1+8h                                  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   10% (48h hold)
Day 3+8h                                                              ━━━━━   50% (48h hold)
Day 5+8h                                                                  ━   100% (7-day hold)
Day 14                                                                       Platform kill switch flip
Day 21                                                                       Refine variant full
```

---

## Operator log

After each step, append a row:

```markdown
## YYYY-MM-DD HH:MM
Step:        <step name>
Cohort:      <cohort>
Actor:       <super-admin-uuid>
Pre-check:   pass / fail
Action:      <verbatim API call>
Post-check:  pass / fail
Notes:       <free text>
```

Save to `production-rollout-log-<batch>.md` alongside this file.
