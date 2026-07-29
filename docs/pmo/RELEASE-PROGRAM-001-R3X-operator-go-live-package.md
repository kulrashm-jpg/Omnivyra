# RELEASE-PROGRAM-001 — R3X

## Operator Go-Live Package (Final Operator Release Authorization)

**Purpose:** the single hand-off document from Engineering & Release Governance to **Production
Operations**. Engineering, architecture, release review, and execution-safety certification are
complete. **No further engineering or governance work is authorized until operators execute the
deployment.** This package consolidates every operator action + the evidence to capture, then routes
back to R3B for independent verification.

> **Do NOT (out of scope for everyone until an operator acts):** enable execution, enable live email,
> select recipients, perform a send, modify production data. Execution stays **default-OFF** through
> deployment. This package changes no code, flag, or schema.

---

## 1. Program Status

| Stage | Status |
|---|---|
| Engineering (W0→W5.1) | ✅ complete |
| Architecture / zero-drift | ✅ certified (R2 §2) |
| Execution Safety (ES-001, M-1/M-2/m-1/m-2/m-3) | ✅ certified — `ba9b4665` |
| Release Review (R2) | ✅ complete (approved *with conditions*) |
| CI Recovery (R1) | ✅ stack regression fixed; ⚠ **A1 pre-existing CI-env failure open** |
| Operator Deployment (R3A) | ⏳ **PENDING — this package** |
| Production Verification (R3B) | ⏳ waiting (last run: **NOT VERIFIED** — nothing deployed) |
| Controlled Canary (R4) | ⏳ waiting (last run: **NOT AUTHORIZED**) |
| Production Rollout (R5) | ⏳ waiting |

**Certified release candidate:** `feat/gtm-w5-1-guarded-execution` @ **`1b230813`** (top of stack #5–#9;
**includes** the ES-001 safety remediation). Production baseline (pre-deploy): `origin/main` = `3e941441`.

---

## 2. Operator Preconditions (live status — 2026-07-27)

| # | Precondition | Confirm | Status now |
|---|---|---|---|
| 1 | Production Build CI (A1) green | `gh api …/commits/main/check-runs` → Production build = success | ❌ **failure** (CI-ops must supply build env/secrets) |
| 2 | Human approvals complete | `gh pr view 5..9 --json reviewDecision` → all APPROVED | ❌ all **NONE** |
| 3 | Merge strategy approved | squash #5–#9 (R2 M-3 rationale) | ⏳ awaiting sign-off |
| 4 | Release window approved | operator schedule | ⏳ operator |
| 5 | Rollback owner assigned | named owner | ⏳ operator |
| 6 | Production monitoring available | dashboards/alerts reachable | ⏳ operator (obs specs, ES-105/R2 §5) |

**All six must be ✅ before Phase 1.** Detailed steps: [R3A checklist](RELEASE-PROGRAM-001-R3A-operator-deployment-checklist.md) · [Runbook](RELEASE-PROGRAM-001-DEPLOYMENT-ROLLBACK-RUNBOOK.md).

---

## 3. Operator Execution (in order) — **[OPERATOR]**

**Phase 1 — Merge & tag.** Squash-merge #5–#9 into `main` as one atomic commit; create + push tag
`gtm-baseline-v1`; record the merged SHA. (Squash is required — #6/#8 are individually red on backend-TS;
the fix lands atomically. R2 M-3.)

**Phase 2 — Migrations (controlled process only; NEVER `db push`).** Apply in order, then reconcile the
ledger:
1. `20260727000000_operational_core.sql`
2. `20260727010000_audience_intelligence.sql`
3. `20260727020000_campaign_intelligence.sql`
4. `20260727030000_guarded_execution.sql`
5. `20260727040000_execution_approvals.sql`  ← **new (ES-001 approval authority)**

**Phase 3 — Deploy.** Deploy `main` (Vercel `omnivyra` + Railway worker). **Execution flags remain
unset/OFF** (`GTM_EXECUTION_ENABLED`, `GTM_LIVE_SEND`).

**Phase 4 — Runtime verify.** runtime · telemetry · worker · Redis · queues · cache · API · observability
(runbook §5).

**Phase 5 — Synthetic validation only.** internal tenant, dry-run only; **no customer communication, no
outbound** (runbook §6). Confirm `executionEnabled:false` and every dispatch → `dispatched:false`.

**Phase 6 — Capture evidence** (§4 below).

---

## 4. Evidence Capture (operator fills — required for R3B)

> These slots are **empty by design**: no evidence can exist until an operator executes §3. R3B will
> verify the filled values against the certified release. Do not pre-populate.

**Merge Evidence**
- Merged SHA: `__________`  · Release tag `gtm-baseline-v1` → SHA: `__________`
- `main` check-runs all green (Backend-TS / Non-regression / Production build / readiness): `__________`

**Deployment Evidence**
- Vercel deployment id: `__________`  · Railway build id: `__________`  · deploy timestamp: `__________`

**Migration Evidence**
- 6 regclasses non-null (incl. `execution_approvals`): `__________`
- RLS on + service-role policies present: `__________`  · ledger reconciled: `__________`

**Runtime Evidence**
- API health / worker registered / Redis connect / queue depth / telemetry recording: `__________`

**Observability Evidence**
- Dashboards live (execution telemetry, HARDEN-001, `execution.audit.write_failed`, approval/suppression, latency): `__________`  · alerting fires: `__________`

**Safety Evidence**
- `GTM_EXECUTION_ENABLED` OFF: `__________`  · `GTM_LIVE_SEND` OFF: `__________`
- `executionEnabled:false` via API: `__________`  · `select count(*) from execution_controls where enabled=true` = **0**: `__________`
- suppression active / approval authority active / kill-switch active (dry-run probes): `__________`

**Rollback Evidence**
- Prior baseline `3e941441` redeployable (promote-previous verified): `__________`
- Rollback owner: `__________`  · migration reverse-order policy acknowledged (additive/flag-dark, zero data loss): `__________`

---

## 5. Success Definition

The operator package is complete only when evidence exists for **all**: merged release · deployed
production baseline · healthy runtime · execution OFF · verified rollback · complete deployment evidence
(§4 fully filled).

---

## 6. Exit Condition

When §4 is complete, **re-run R3B — Production Baseline Verification** using the actual deployment
evidence. **No new engineering. No new governance milestones. No new certifications. Evidence
verification only.** A verified R3B then authorizes R4 (Controlled Canary).

---

## 7. Hand-off Statement

Software implementation and certification are complete: the certified release (`1b230813`) is
additive, flag-dark, execution default-OFF, with the five execution-safety findings remediated
(ES-001) and permanent regression protection. Progress now depends **entirely on operator-controlled
activities** — merge, controlled-process migrate, deploy, and evidence capture. Until that evidence
exists, no certification can truthfully advance the program; R3B last returned **NOT VERIFIED** because
`main` remains the pre-deploy baseline.

I can prepare the **safe, reversible** parts on request — stage the squash on a release branch **without
pushing to `main`**, pre-stage the migration + verify queries. I will not merge, deploy, apply
production SQL, choose a recipient, flip a flag, or send.

*Hand-off package — documentation only. No merge, no deploy, no `db push`, no flag change, no send.
Production untouched; execution OFF.*
