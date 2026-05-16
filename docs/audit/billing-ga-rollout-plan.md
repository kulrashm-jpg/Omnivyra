# Billing GA Rollout Plan

**Date:** 2026-05-15
**Scope:** Production enablement sequence for the enterprise billing infrastructure landed in Phases 1–3
**Status:** This document is operational — review with on-call before each rollout step

---

## 1. Rollout Order (T-7 days → GA day)

### T-7 — Schema + dry-run

| Step | Action | Owner | Verify |
|---|---|---|---|
| 1.1 | Apply migration `20260663_ledger_immutability_and_governance.sql` to staging | DBA | All tests in §5 pass against staging DB |
| 1.2 | Apply migration `20260664_phase2_governance_and_payment_foundation.sql` | DBA | Same |
| 1.3 | Apply migration `20260665_phase3_fx_engine_and_contracts.sql` | DBA | Same |
| 1.4 | Deploy code with ALL flags OFF | Eng | CI guard returns 0 errors |
| 1.5 | Verify shadow-mode counters increment (untracked AI calls) | Eng | Dashboard shows non-zero `untracked_ai_call_blocked_total` |
| 1.6 | Run staging load tests per [billing-scale-validation §6](./billing-scale-validation.md#6-required-load-test-plan-not-run-here) | Eng | All pass criteria met |

### T-3 — Registry seeding + audit dry-run

| Step | Action | Owner | Verify |
|---|---|---|---|
| 2.1 | Bulk-register `inside_orchestrated_scope` entries from [advisory classification](./direct-deduction-advisory-classification.md#3-per-file-classification-full-inventory) | Finance Admin | `auditRegistry()` shows 0 missing owner/reason |
| 2.2 | Register `internal_tool` entries | Finance Admin | Same |
| 2.3 | Run `scripts/audit/non-billable-registry-check.ts` in CI | Eng | exit 0 |
| 2.4 | Run a full billing-integrity-audit cron against staging | Eng | `overallStatus = 'healthy'` |
| 2.5 | Pick canary org for rollout | Product | One org with reasonable burn rate; user briefed |

### T-1 — Canary org

| Step | Action | Owner | Verify |
|---|---|---|---|
| 3.1 | Enable `billing.ai_enforced` for canary org | Finance Admin | Feature flag set; counter for that org isolated |
| 3.2 | Enable `billing.reservations_required` for canary org | Finance Admin | Same |
| 3.3 | Observe 24h: untracked-AI counter should stop incrementing for this org | On-call | Dashboard counter steady |
| 3.4 | Verify no customer complaints | Customer Success | No tickets opened |

### T-0 — GA enable

| Step | Action | Owner | Verify |
|---|---|---|---|
| 4.1 | Enable `billing.ai_enforced` for 10% rollout cohort | Finance Admin | Cohort key set on flag |
| 4.2 | Monitor for 24h | On-call | `billing_dashboard.aiBilling.countersFromMemory` per cohort |
| 4.3 | Roll to 50% | Finance Admin | Same |
| 4.4 | Roll to 100% | Finance Admin | Same |
| 4.5 | Repeat 4.1→4.4 for `billing.reservations_required` | Finance Admin | Same |

### T+7 — Hardening

| Step | Action | Owner |
|---|---|---|
| 5.1 | Enable `BILLING_REQUIRE_AI_HANDLE=true` env var (platform-wide enforcement) | Eng |
| 5.2 | Update CI to block PRs with new advisory warnings | Eng |
| 5.3 | Schedule first 30-day review of `inside_orchestrated_scope` entries | Finance Auditor |

---

## 2. Rollback Order

If any of the rollout steps fail their verification, **reverse in EXACT inverse order**:

| Failed step | Rollback action |
|---|---|
| 5.1 (env enforced) | Unset env var; falls back to flag-only enforcement |
| 4.5 (reservations 100%) | Lower cohort percent on flag; in-flight reservations complete normally |
| 4.4 (ai-enforced 100%) | Same |
| 4.1 (10% rollout) | Set cohort percent to 0; calls fall back to shadow mode |
| 3.x (canary org) | Disable both flags for canary org |
| 2.1 (registry seeding) | Registry entries are immutable but never enforced when flags are OFF; no rollback needed |
| 1.x (migrations) | **NEVER ROLL BACK SCHEMA.** All migrations are additive. Tables can sit empty if features are disabled. |

---

## 3. Kill Switches

When something goes wrong in production, these are the levers:

| Switch | Effect | Reversibility |
|---|---|---|
| Per-org `billing.reservations_required` = false | Stop charging queue work for this org | Instant |
| Per-org `billing.ai_enforced` = false | Stop throwing on unguarded AI calls for this org | Instant |
| Global `BILLING_REQUIRE_AI_HANDLE=false` env var | Stop platform-wide AI enforcement | Process restart |
| `org_controls.emergency_freeze = true` | Stop ALL credit-consuming actions for one org | Instant via super-admin UI |
| Disable any cron at `/api/cron/billing-*` | Set CRON_SECRET to unknown value or remove the cron job | Instant |
| Per-flag percent rollout = 0 | Disable a flag for all but the few orgs with overrides | Instant |

### Emergency procedures

**Scenario: Drift spike (reconciliation detects N orgs with non-zero delta)**

1. Page on-call via existing anomaly alerting (`reconciliation_failures_total` counter).
2. Operator inspects via [GET /api/super-admin/billing-dashboard?refresh=true](../../pages/api/super-admin/billing-dashboard.ts).
3. If a single org is the source → freeze that org (`emergency_freeze=true`).
4. If multi-org → roll back the most recent flag flip; investigate.

**Scenario: Mass duplicate-block alerts (queue_replay_blocked_total spike)**

This is usually GOOD — the system is blocking real replays. Confirm by:
1. Pulling 5 recent registry rows for the affected queue from `job_execution_registry` ordered by retry_count DESC.
2. Each should have a sane `first_seen_at` and progressive retry_count.
3. If `first_seen_at` is "now" but retry_count is high → real bug (e.g. lost Bull state). Roll back `billing.reservations_required` for the affected org.

**Scenario: Approval pipeline stuck**

1. Run `expirePendingApprovals` daily cron manually.
2. Each operator with pending approvals receives a notification (TODO: notification surface is Sprint 5).
3. As a safety net, the proposer can cancel via `POST /api/admin/credits/approvals/cancel`.

---

## 4. Verification Checkpoints

Each rollout step has explicit pass/fail criteria:

| Checkpoint | Pass | Fail |
|---|---|---|
| Migration applied | `SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'credit_action_approvals'` returns 1 | otherwise |
| Code deployed | `/api/super-admin/billing-dashboard` returns 200 | otherwise |
| Tests green | `npm test backend/tests/unit/billing*.test.ts` 100% pass | one or more red |
| Bench acceptable | Money 1M iterations < 1 second | otherwise |
| CI guard | `scripts/audit/no-direct-credit-deductions.ts` exits 0 | otherwise |
| Registry clean | `scripts/audit/non-billable-registry-check.ts` exits 0 | otherwise |
| Integrity audit | `runFinancialIntegrityAudit().overallStatus === 'healthy'` | `degraded` or `critical` |
| Canary 24h | 0 customer complaints, drift count stable | otherwise |

---

## 5. Monitoring Requirements

### 5.1 Counters that must be tracked over time

Pulled from `snapshotBillingMetrics()` via the dashboard endpoint:

- `billing_operations_total` — should grow with platform traffic
- `billing_operations_confirmed` / `billing_operations_total` — ratio approaching 1.0 means health
- `duplicate_prevention_hits_total` — non-zero is GOOD (system actively defending)
- `queue_replay_blocked_total` — non-zero is GOOD (Bull retries deduped)
- `untracked_ai_call_blocked_total` — should trend to zero as F2 registry entries are added
- `reservation_expiry_total` — non-zero indicates HOLDs aging out; investigate if rate increases
- `reconciliation_failures_total` — **must be zero** in steady state; alert immediately on increase
- `approval_self_signature_blocks` — non-zero is a governance event; investigate the actor

### 5.2 Required dashboard views

The unified dashboard endpoint at [GET /api/super-admin/billing-dashboard](../../pages/api/super-admin/billing-dashboard.ts) returns data for all six required views:

1. Financial Integrity (overall status badge)
2. AI Billing (untracked count, allowlist size, enforcement status)
3. Reservation Health (open HOLDs aging)
4. Admin Adjustment (counts by reason_type)
5. Company Burn (portfolio top-10)
6. Billing Drift (wallet vs ledger)

### 5.3 Alert routing

| Anomaly kind | Severity | Routing |
|---|---|---|
| `untracked_ai_call_blocked` | warn (shadow), critical (enforced) | Slack #billing-alerts |
| `queue_replay_blocked` | warn | logs only (good signal) |
| `reservation_orphan_reaped` | warn | logs only |
| `approval_self_signature_attempt` | warn | Slack #billing-alerts |
| `reconciliation_failures_total` | critical | PagerDuty |
| billing_integrity_audit `overallStatus = critical` | critical | PagerDuty |

---

## 6. GA Readiness Criteria

The platform is GA-ready when **ALL** of these are true:

### Code & schema
- ✅ All migrations (20260663, 20260664, 20260665) applied to production DB
- ✅ Code deployed with all flags OFF by default
- ✅ Tests green (52+ Phase 1+2+3 tests all pass)
- ✅ CI guard exits 0 (no hard violations)
- ✅ Non-billable registry check exits 0 (no expired entries)

### Operational
- ✅ Load tests per [billing-scale-validation §6](./billing-scale-validation.md#6-required-load-test-plan-not-run-here) passed against staging
- ✅ All 6 reconciliation/integrity crons scheduled and running successfully for 7 consecutive days on staging
- ✅ Canary org enabled for 7 days with no customer complaints
- ✅ Drift count steady at 0 across 7-day window

### Governance
- ✅ At least 2 super-admins identified for FINANCE_APPROVER role
- ✅ Threshold ladder reviewed by finance leadership
- ✅ Refund flow documented (even if not yet automated — Sprint 6 work)
- ✅ Customer communication shipped re: `refine_variant` charging change (per Phase 2 §11.3)

### Documentation
- ✅ This rollout plan reviewed by on-call
- ✅ Runbooks for each kill switch documented
- ✅ Customer-facing changelog drafted

### Stretch (not blocking)
- Customer-facing billing portal alpha
- Operator UI for non-billable registry

---

## 7. Communication Plan

### Customer-facing
- **T-14 days:** email customers about upcoming credit-charging behavior changes (specifically `refine_variant`).
- **T-7 days:** in-app banner for active users.
- **T-0:** changelog post.

### Internal
- **T-14 days:** brief eng + finance teams.
- **T-7 days:** runbook walkthrough with on-call.
- **T-3 days:** runbook walkthrough with finance.
- **T-0:** Slack channel update + monitoring dashboards linked.

---

## 8. Post-GA Roadmap

Tracking sprints aligned with the audit's remaining MEDIUM gaps. See [high-gap-remediation-phase2.md §12](./high-gap-remediation-phase2.md#12-remaining-medium-gaps-from-audits-full-inventory) for the full list. Top-priority items:

### Sprint 4 (T+2w)
- F3 migration window (per [advisory classification §4](./direct-deduction-advisory-classification.md#4-remediation-calendar))
- Stripe live-mode adapter
- Webhook fulfillment retry cron

### Sprint 5 (T+4w)
- FX rate cron (daily pull from ECB or OXR)
- Subscription renewal cron
- Per-month CONFIRM materialized view (perf)

### Sprint 6 (T+6w)
- Stripe Tax / Avalara integration
- Invoice PDF generation
- Customer-facing invoice download

### Sprint 7 (T+8w)
- Enterprise contract UI for finance admins
- Auto-recharge implementation
- Refund/reversal RPC

---

## 9. Approval & Sign-off

Pre-GA the following parties must sign:

- Engineering Lead: ___________
- DBA / Database Owner: ___________
- Head of Finance: ___________
- Customer Success Lead: ___________

Post-sign, GA enablement (steps 4.1+) proceeds at the discretion of the engineering lead with on-call coverage.
