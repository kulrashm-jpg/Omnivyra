# RELEASE-PROGRAM-001 — R3 / RL-003

## Controlled Deployment Certification (Merge, Deployment & Production Baseline Activation)

**Roles:** Release Manager · Production Deployment Authority · Platform Operations Lead · DevOps
Architect · Independent Deployment Certification Authority.
**Type:** Deployment only. Preserve default-OFF execution. No feature, no logic, no execution/live-email.
**Question:** Can the reviewed GTM stack safely become the new production baseline **now**?

---

## 0. Certification Decision

# ❌ DEPLOYMENT NOT CERTIFIED

**Not because deployment failed — because deployment has not been (and must not autonomously be)
performed: the R3 entry requirements are unmet, and the terminal actions are irreversible and
operator-owned.** This is the correct, expected gate immediately after R2 (which closed *with
conditions*). Nothing is deployed; production is unchanged and safe.

R3's own spec requires the entry gates confirmed **before deployment begins**. They are not:

| Entry requirement | Required | Actual (2026-07-27) | Verdict |
|---|---|---|---|
| R1 conditions resolved/accepted | A1 build-env resolved by CI-ops | Production-build CI **RED** on `main` + PRs (A1 open) | ❌ |
| R2 review conditions satisfied | M-3, M-4 closed | M-4 **now authored** (this milestone); **M-3 OPEN** | ❌ |
| Merge strategy finalized **and executed** (STACK-1) | squash landed on `main` | **OPEN** — `main` still `3e941441`; no wave branch is an ancestor | ❌ |
| Deployment runbook | complete | ✅ **authored** ([runbook](RELEASE-PROGRAM-001-DEPLOYMENT-ROLLBACK-RUNBOOK.md)) | ✅ |
| Rollback runbook | complete | ✅ **authored** (same doc §7) | ✅ |

Two gates are now closed by this milestone (both runbooks). Three remain open — and the three that
remain (A1 CI-ops, the merge to `main`, and the deploy+prod-migration) are **operator-owned**: merging
to `main`, applying SQL to the **production** database `klkiseupptzbecbxwrky`, and deploying
Vercel/Railway are hard-to-reverse, outward-facing production mutations. Launching the R3 milestone
authorizes me to *certify readiness and prepare*, not to push to production autonomously — the same
boundary honored at M5/M5B, and consistent with standing deploy-discipline ("deploy only clean
`origin/main`").

**A single unmet entry gate blocks certification; three are unmet.** Remain in R3.

---

## 1. R3-301 — Merge Report — ❌ not performed (strategy finalized)

- **State:** `origin/main` = `3e941441` (unchanged). PRs #5–#9 **OPEN**, none merged; verified none is
  an ancestor of `main`. Branch integrity intact (clean linear stack; R2 §1).
- **Strategy finalized:** **squash-merge #5–#9 as one atomic baseline commit** (rationale: STACK-1 /
  R2 M-3 — PRs #6/#8 are individually red on backend-TS because the telemetry contract fix lives only
  on #9; squashing lands code + fix atomically so `main` stays green). Documented in the runbook §1.
- **Release tag / version:** planned `gtm-baseline-v1` on the squash sha (runbook §1). Not yet created.
- **Blocker:** the merge is an **[OPERATOR]** action pending PR approvals + green CI (incl. A1).

## 2. R3-302 — Deployment Report — ❌ not performed

- No SQL applied through this milestone; **no `db push`** invoked (policy honored). The four migrations
  are reviewed (R2 §4), additive + idempotent, and were previously applied **DARK** for shadow
  validation; the controlled production apply + ledger reconciliation is an **[OPERATOR]** step
  (runbook §2) that has not run in R3.
- No application deploy performed (Vercel `omnivyra` / Railway worker unchanged).
- Startup/migration/RLS verification: **pending deployment** — procedures specified (runbook §2, §5).

## 3. R3-303 — Runtime Verification Report — ⏸ pending (procedure ready)

Not executable until deployed. The verification matrix (API/worker/cache/telemetry/observability/flags
+ `executionEnabled:false` probe) is defined in runbook §5. **Execution posture to assert post-deploy:
OFF.** Statically confirmed today: connector is unconditionally dry-run; control default-OFF requires an
enabling row that does not exist (0 enabling rows is a deploy-verify assertion).

## 4. R3-304 — Operational Validation Report — ⏸ pending (procedure ready)

Health/smoke/synthetic-lead/audience-eval/campaign-sim/dry-run/suppression/approval are specified as
**read/dry-run-only, no-outbound-email** steps in runbook §6. Not executable pre-deploy. R2 already
verified the guard logic statically (suppression fail-closed, approval enforced in the bridge,
dry-run-only connector).

## 5. R3-305 — Rollback Certification — ✅ documented & executable

Rollback is **confirmed executable by inspection** without a live deploy:
- **Application rollback:** prior baseline commit `3e941441` is intact and redeployable (O(1) promote).
- **Migration policy:** additive + flag-dark → rolled-back code simply stops referencing the new tables;
  optional reverse-order drop is safe. **No destructive reversal required.**
- **Configuration rollback:** unset introduced flags; execution already OFF.
- **Data loss:** **none** — zero deletions in the change set (R2 §4); existing data untouched.

This satisfies R3-305's "confirm the documented procedure is executable."

## 6. R3-306 — Production Baseline Report — ❌ no baseline established

No deployment → no new production baseline. The *readiness* for one is established: reviewed,
additive, default-OFF, rollback-proven, runbooks complete. The baseline itself requires the operator to
execute merge → migrate → deploy → verify per the runbook.

---

## 7. Outstanding Risk Register

| Risk | Sev | Owner | Mitigation |
|---|---|---|---|
| Merge not executed (STACK-1/M-3) | Blocker | Operator | Squash-merge per runbook §1 |
| Production-build CI red (A1) | Blocker | CI-ops | Provide build env/secrets to CI job |
| Prod migration apply + ledger reconcile | High | Operator | Controlled apply, never `db push` (runbook §2) |
| Accidental execution enablement during deploy | High | Operator | Keep `GTM_EXECUTION_ENABLED`/`GTM_LIVE_SEND` unset; verify 0 enabling rows |
| Approval caller-asserted (R2 M-1) | High **at flip** (not at deploy) | Eng | Gated to R4/M5; not triggered by flags-OFF deploy |
| Kill-switch layered fail-open (R2 M-2) | High **at flip** | Eng | Gated to R4/M5 |
| M-1..M-3 execution-safety minors | Med **at flip** | Eng | Fix before R4 |

The two execution-safety Majors (R2 M-1/M-2) do **not** affect an R3 flags-OFF deployment (execution is
structurally dry-run + hard-OFF) — they gate R4, not R3. They remain tracked.

---

## 8. Deployment Certification (statement)

The reviewed GTM stack is **deployment-READY** — additive, flag-dark, rollback-proven, with both
runbooks now complete — but it is **NOT DEPLOYED and NOT CERTIFIABLE as deployed today**: it is unmerged
(`main` = `3e941441`), the merge strategy is finalized-but-unexecuted (STACK-1/M-3 open), the
Production-build CI gate is red (A1, CI-ops), and the terminal merge/migrate/deploy are irreversible
operator-owned actions I do not perform autonomously.

**Decision: ❌ DEPLOYMENT NOT CERTIFIED.** Remain in R3.

**Executable path to certification (operator-owned, in order):**
1. **CI-ops:** provide build-time env/secrets → Production-build CI green on `main` and #9 (R1/A1).
2. **Reviewers:** approve PRs #5–#9.
3. **[OPERATOR]:** squash-merge #5–#9 → `main` (runbook §1); tag `gtm-baseline-v1`; confirm `main` green.
4. **[OPERATOR]:** apply the 4 migrations via the controlled process (never `db push`); reconcile the
   ledger; verify existence + RLS + **0 enabling control rows** (runbook §2).
5. **[OPERATOR]:** deploy `main` to Vercel `omnivyra` + Railway worker with all execution flags **unset**
   (runbook §3–§4).
6. **Verify** runtime (§5) + operational dry-run validation (§6); confirm `executionEnabled:false`
   everywhere and **no send**.
7. **Re-run R3** for a **✅ DEPLOYMENT CERTIFIED** decision → authorizes **R4 (Controlled Canary)**.

I can execute the safe, reversible preparation on request (e.g., prepare the squash commit on a release
branch **without pushing to `main`**, draft the tag, pre-stage verification queries). I will **not**
merge to `main`, apply production SQL, deploy, or touch any execution flag without explicit
authorization.

*Deployment milestone — runbooks authored; no merge, no `db push`, no deploy, no flag change, no send,
no canary, production untouched. `GTM_EXECUTION_ENABLED` / `GTM_LIVE_SEND` remain OFF.*
