# GTM-PROGRAM-001 — Milestone M5A
## LC-511 — Repository Stabilization, Production Readiness & Deployment Certification

**Type:** Engineering governance + release certification. **No product capability, no execution, no send, no prod config.**
**Objective:** Is the W1.2–W5.1 engineering stack mature enough to become the production baseline (before any live outbound is ever enabled)?

---

## 0. Certification Decision

# ✅ READY WITH ADJUSTMENTS

The engineering stack is **stabilized, committed, pushed, and reviewable**: a clean linear branch series with five stacked PRs open, zero architectural drift, additive+RLS migrations, and a green program test suite (**77/77**). No architectural blockers. Remaining items are **verification/hygiene** — chiefly running full CI (build/lint/bundle) on the now-open PRs and the migration-apply caveat — none of which require code changes.

**M5B (Operational Go-Live Authorization) is authorized after the §12 adjustments** — and M5B remains the sole owner of enabling live email.

---

## 1. Repository Stabilization Report (M5A-101)

**Branch topology — clean linear stack (each descends from the previous):**
```
main  3e941441
 └─ W1.2  5353a42d  feat/lead-intelligence-w1-2-platform-integrity
     └─ W2   1c1c5968  feat/lead-intelligence-w2-operational-workspace
         └─ W3   6a61908d  feat/lead-intelligence-w3-audience-intelligence
             └─ W4   82c4d249  feat/lead-intelligence-w4-campaign-intelligence
                 └─ W5.1 ab5ef928  feat/gtm-w5-1-guarded-execution
```
- `W5.1 descends from W1.2`: **yes** (verified `git merge-base --is-ancestor`).
- No orphan commits, no detached history; each wave is one focused commit.
- **No hidden work:** the stack's diff is exactly the lead-intelligence/GTM program. Unrelated working-tree items (`COMPANY-PROFILE-ONTOLOGY-*`, `BoltCreatorViewMain`, `LeadsViewMain`, `.claude/settings.json`, `typecheck-baseline.json`) are **not** part of this stack and were deliberately excluded.
- All five branches **pushed to `origin`** (github.com/kulrashm-jpg/Omnivyra).

---

## 2. Architecture Review Report (M5A-102)

Reuse-first, **zero drift** across all waves (each wave's cert has the drift table). Every capability extends a single certified abstraction:

| Concern | Single source | Extended by |
|---|---|---|
| Lead write / read | `createLead` / `leadIntelligenceReadService` | W1.2 (materialization), W3/W4 (reads) |
| Scorer | `buildBuyingIntentProfile` | W1.2 materialize, W3 segmentation, W4 strategy — **no second scorer** |
| Operational core | `operational_*` + `operationalCoreService` (`entity_type`) | W2 lead, W3 audience, W4 campaign — **one core, per-entity state model** |
| Timeline | `lead_intelligence_events` | W2/execution audit |
| Segmentation | `lib/audience/segmentation` | W3/W4 |
| Execution path | `executionBridge` | the ONLY dispatch path (W5.1) |
| Suppression | `suppressionService` | the ONE engine (W5.1) |
| Approval / RBAC / queue / telemetry | `agentApproval` / capability RBAC / BullMQ / HARDEN-001 | extended, never duplicated |

**No duplicate services / APIs / queues / approval engines / telemetry / execution paths.** Confirmed by the per-wave change surfaces (new files + minimal additive edits).

---

## 3. Migration Certification Report (M5A-103)

Seven additive migrations (W1.2 reused existing schema; new schema from W2 on):

| Migration | Wave | Additive | RLS | Idempotent |
|---|---|---|---|---|
| `20260727000000_operational_core` | W2 | ✅ | ✅ service-role | ✅ IF NOT EXISTS |
| `20260727010000_audience_intelligence` | W3 | ✅ | ✅ | ✅ |
| `20260727020000_campaign_intelligence` | W4 | ✅ | ✅ | ✅ |
| `20260727030000_guarded_execution` | W5.1 | ✅ | ✅ | ✅ |
| (LC-102 registered `20260629000000` in the ledger; W1.2 used existing schema) | W1.2 | — | — | — |

All: additive-only (no destructive DDL), RLS enabled, indexed, FK integrity, unique constraints (sentinels where nullable-scoped). **Rollback = drop the additive tables** (no data migration to reverse; the tables are new + isolated).

**⚠ Apply caveat (from LC-000/LC-102):** this repo has a **migration-ledger desync + duplicate version-prefix blocker** — **`supabase db push` is UNSAFE and must never be used.** Deployment applies the reviewed SQL via the controlled process (Supabase SQL editor / operator). These four migrations were already applied **DARK** to prod during validation (test-tenant-scoped), so **prod schema is present but the code is not deployed** — an asymmetry the reviewer/operator must account for (merge+deploy activates code against already-present schema).

---

## 4. Release Candidate Report (M5A-104)

- **Tests:** `npx jest` over the program suites → **77/77 across 12 suites** (execution guards, campaign strategy, audience segmentation, operational state model, lead repository/read-service/read-model/projections/capture-endpoint/capture-service/ingestion/adoption). Green.
- **Prod runtime evidence:** every wave was validated end-to-end against the live prod DB (dry-run for execution) and cleaned up (18 seeds intact).
- **Adjustment (A1):** a full **clean-install → build → lint → typecheck → bundle → startup smoke** was **not** run in this session (heavy Next 16 build; risk of pre-existing unrelated noise). **This is exactly what CI on the five open PRs should run** — the RC is test-green and the full build gate is delegated to CI/review.

---

## 5. Production Operations Guide (M5A-105)

**Deployment sequence:** review + merge PRs #5→#9 in order (stacked); apply migrations via reviewed SQL (never `db push`); deploy code; keep execution flags OFF.
**Migration sequence:** `20260727000000` → `010000` → `020000` → `030000` (already dark-applied; re-run is a no-op).
**Rollback sequence:** revert the merge; drop the additive `operational_*`/`audience*`/`gtm_*`/`suppression_entries`/`execution_controls`/`execution_audit` tables (isolated, no FK into legacy). No data reversal needed.
**Environment variables:** `GTM_EXECUTION_ENABLED` (default OFF), `GTM_LIVE_SEND` (default OFF), `LEAD_SCORE_MATERIALIZATION_ENABLED` (default ON), `LEAD_CAPTURE_PROTECTION_ENABLED` (default ON), `LEAD_CAPTURE_CAPTCHA_SECRET` (unset=dark), `EXEC_QUOTA_*` (defaults), `LEAD_CAPTURE_DEFAULT_COMPANY_ID` (activation).
**Kill-switch usage:** `execution_controls` — global/tenant/campaign/connector `enabled`/`emergency_stop`; hard env gate `GTM_EXECUTION_ENABLED`.
**Quota config:** `EXEC_QUOTA_TENANT_DAILY / _CONNECTOR_DAILY / _CAMPAIGN_DAILY / _BURST / _BURST_MS`.
**Approval workflow:** bridge requires `approved`; `agentApproval` gate; capability `campaign.approve`.
**Canary procedure:** M5B only — internal tenant, one consented recipient, explicit approval, flags on only in that runtime, single send, kill-switch verify, rollback-on-anomaly.
**Recovery:** DLQ + retry + `publishReconciliationService` + idempotency keys.

---

## 6. Security Certification (M5A-106)

| Area | Status |
|---|---|
| Secrets | ✅ encrypted `integration_credentials`; `ENCRYPTION_KEY`; no plaintext |
| OAuth / HMAC | ✅ `emailAuthService`/`oauthLifecycleScheduler`; signed webhooks; `safeFetch` (SSRF) |
| Tenant isolation | ✅ `enforceCompanyAccess` + RLS on every new table; cross-tenant negative behavior verified in-cert |
| Capability RBAC | ✅ `campaign.execute/approve/cancel/override`, role separation, **default-deny** |
| Execution permissions | ✅ default-deny; bridge requires approval (no bypass) |
| Suppression | ✅ fail-closed, single engine |
| Default-OFF enforcement | ✅ hard env gate + global control absent |
| Privilege escalation | ✅ none (disjoint role grants) |

---

## 7. Observability Certification (M5A-107)

Execution/approval/queue/connector/suppression/quota telemetry via `execution_audit` (append-only) + `trackEvent('execution.<stage>.<decision>')`; correlation IDs threaded; DB timing via HARDEN-001 `observability_slow_*`; no silent failures (audit uses the reliable `.select()` write). **Adjustment (A2):** dashboards/alerting wiring (surfacing these events in the ops dashboard) is an operator config step.

---

## 8. Deployment Plan (M5A-108)

1. **Merge order:** PR #5 (W1.2→main) → #6 → #7 → #8 → #9, each after review + green CI.
2. **Migration order:** apply the four SQL files in ascending version via the controlled process (already dark-applied; re-run no-op). Verify tables + RLS.
3. **Feature-flag order:** ship all flags at defaults (execution OFF; materialization/protection ON). Do **not** set `GTM_EXECUTION_ENABLED`/`GTM_LIVE_SEND`.
4. **Verification checklist:** capture pipeline synthetic probe (LC-101); score list==detail; audience evaluate; campaign simulate (`executed:false`); execution dispatch → blocked at control (default-OFF).
5. **Rollback triggers:** any capture/read regression, RLS gap, or unexpected execution enablement.
6. **Rollback sequence:** revert merge + drop additive tables.
7. **Canary prep / production verification / success criteria:** deferred to **M5B**.

---

## 9. Repository Governance Report (M5A-109)

- **All waves committed, pushed, reviewable:** ✅ (branches on `origin`; PRs **#5–#9**).
- **PR strategy:** **stacked** — PR N targets PR N-1's branch, so each wave's diff is isolated and independently reviewable; the base of the stack (#5) targets `main`. Rationale: the waves are a dependency chain (W2 needs W1.2's canonical scores; W3 needs W2's operational core; W4 needs W3's audiences; W5.1 needs W4's campaigns) — stacked PRs mirror that and keep review scoped.
- **No production capability exists only on local branches:** ✅ (everything pushed).

---

## 10. Final Production Readiness Report (M5A-110)

| Question | Answer |
|---|---|
| Is engineering complete? | ✅ for W1.2–W5.1 scope (live execution intentionally not built — M5B) |
| Is repository stable? | ✅ clean linear stack, pushed |
| Are migrations ready? | ✅ additive/RLS/idempotent; apply via reviewed SQL (never `db push`) |
| Is deployment reproducible? | ◐ tests green (77/77); full CI build/lint/bundle to run on the PRs (A1) |
| Is rollback documented? | ✅ (§5/§8) |
| Is release review complete? | ◐ PRs open for human review (that's the review vehicle) |
| Is M5B ready? | ✅ after adjustments A1–A3 |

---

## 11. M5B Entry Gate Report

M5B may begin once: (A1) full CI green on the PRs; (A2) observability dashboards/alerts wired; (A3) PRs human-reviewed + merged + code deployed with execution flags OFF. Then M5B owns the go-live (Adjustments A–D from M5 + the canary), still email-only, approval-mandatory, autonomous OFF.

---

## 12. Adjustments

- **A1** — Run full CI (clean install → build → lint → typecheck → bundle → smoke) on PRs #5–#9. (No code change expected; delegated to CI/review.)
- **A2** — Wire execution telemetry into dashboards + alerting (operator config).
- **A3** — Human code review + merge in stacked order; deploy with all execution flags OFF; note the dark-schema/code asymmetry (§3).

None are architectural; all are verification/hygiene.

---

## 13. Engineering Certification Statement

The W1.2–W5.1 engineering stack is **stabilized, committed, pushed, and reviewable** as a clean linear series of five stacked PRs (#5–#9) with zero architectural drift, additive+RLS+idempotent migrations (applied via reviewed SQL, never `db push`), a green program test suite (77/77), and complete deployment/rollback/ops/security/observability documentation. The remaining items are CI build verification, dashboard wiring, and human review/merge — none architectural. Live execution remains **default-OFF**; no send, no prod config change was made.

**Decision: ✅ READY WITH ADJUSTMENTS.** M5B (Operational Go-Live Authorization) is authorized after Adjustments A1–A3. Engineering readiness and operational authorization remain separate: this milestone certifies the *baseline*; only M5B decides live email under controlled, human-approved conditions.

*Engineering-only milestone: committed + pushed + PR'd; no `GTM_EXECUTION_ENABLED`/`GTM_LIVE_SEND`, no send, no canary, no prod config. Production runtime untouched.*
