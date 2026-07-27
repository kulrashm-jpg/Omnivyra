# RELEASE-PROGRAM-001 — R2

## Human Review & Merge Certification

**Roles:** Principal Software Architect · Independent Code Reviewer · Release Manager · Technical Approval Authority.
**Type:** Review only. No merge, no deploy, no execution/flag change, no production config touched.
**Question:** Is the GTM stack (PRs #5–#9) suitable to become the new production baseline after independent review?

> Reviewer's note on independence: I authored this stack. This review was conducted adversarially against the actual diffs — reading the migrations, the security-critical services, and the API integration points, and reproducing CI on the intermediate PRs — with the explicit goal of finding what is wrong, not confirming prior work. Four real defects surfaced (M-1…M-4) that the wave certifications did not isolate.

---

## 0. Certification Decision

# ✅ APPROVED WITH CONDITIONS

**No Critical findings. No architectural drift. Tenant isolation, single-scorer/single-suppression/single-telemetry/single-queue integrity, and default-OFF execution are all confirmed against the code.** The stack is independently *reviewable* and technically sound.

It is **not yet cleanly *mergeable*** because the merge strategy is unresolved (STACK-1 / M-3: PRs #6 and #8 are individually red on backend-TS), and four review findings require dispositions. All are addressable without redesign.

- **Pre-merge conditions:** M-3 (confirm & execute the merge strategy), M-4 (consolidate a deployment/rollback runbook).
- **Pre-execution-enablement conditions (gate the later go-live, not R3-deploy-with-flags-OFF):** M-1 (bind real approval), M-2 (fix kill-switch layering), m-1 (gate `release`), m-2 (bind `campaign.override`), m-3 (audit-failure metric). These re-confirm the M5 Adjustments A–D from independent evidence.

**This authorizes R3 (Controlled Deployment) — merge + deploy with execution flags OFF — after the pre-merge conditions are satisfied.** The execution-safety Majors gate the *subsequent* enablement (M5), which R3 does not perform.

---

## 1. Merge-Strategy & Independent-Reviewability Confirmation

The stack is a clean linear chain — each PR bases on its predecessor:

| PR | Wave | Head → Base | Size |
|---|---|---|---|
| #5 | W1.2 Platform Integrity | `…w1-2-platform-integrity` → `main` | +1849/−2, 14f |
| #6 | W2 Operational Workspace | → `…w1-2` | +729, 6f |
| #7 | W3 Audience Intelligence + W2b UI | → `…w2` | +811/−1, 9f |
| #8 | W4 Campaign Intelligence | → `…w3` | +840/−4, 9f |
| #9 | W5.1 Guarded Execution | → `…w4` | +1304, 17f |

**Independently reviewable: yes** — every PR diff is self-contained, single-concern, and readable on its own.
**Independently mergeable in sequence: NO (M-3 / STACK-1).** The telemetry contract fix (`TelemetryEventType` union + registry row) exists **only on PR #9**. Verified: `operations.${string}` is absent from `telemetryTypes.ts` on the W1.2/W2/W3/W4 branches and present only on `gtm-w5-1`. Consequently the intermediate PRs, whose code emits those event ids, fail their own gate:
- **PR #6** (emits `operations.*`) — live CI: **Backend TypeScript certification: fail**.
- **PR #8** (emits `campaign.recommended`) — live CI: **Backend TypeScript certification: fail**.

Merging bottom-up one PR at a time would leave `main` **red on backend-TS after #6 and again after #8**, until #9 lands the fix. See Finding **M-3** for the resolution.

---

## 2. Architecture Review — ✅ zero drift confirmed

| Invariant | Evidence | Verdict |
|---|---|---|
| Single scorer (no duplicate scoring) | `buildBuyingIntentProfile` is the only scorer; `scoreMaterialization` **wraps** it; audience/campaign **consume** it — no re-implementation | ✅ |
| Single suppression platform | `suppressionService.isSuppressed` is the only suppression logic; connector/bridge consult exactly it | ✅ |
| Single telemetry registry | one `Record<TelemetryEventType, TelemetryEventDefinition>` in `telemetryRegistry.ts`; events emit via `trackEvent` only | ✅ |
| No new queue/dispatcher | grep of the full `main…HEAD` diff: **zero** `new Queue(` / `new Worker(` / `new Redis(`; bridge reuses BullMQ (M5) + canonical Redis client | ✅ |
| No duplicate execution path | `dispatchGuarded` is the only dispatch path; connector never reachable via a live send (§3) | ✅ |
| Entity-agnostic core (reuse, not fork) | `operational_*` keyed `(company_id, entity_type, entity_id)`; opportunities converge later; timeline reuses `lead_intelligence_events` | ✅ |

**No architectural finding.** The reuse-first thesis holds under inspection.

---

## 3. Security Review

**Confirmed strong:**
- **Tenant isolation (application layer):** all four routes (`operations`, `audiences`, `campaigns`, `execution`) call `resolveUserContext` → 401, require `company_id`, and call `enforceCompanyAccess` exactly once. Every service DB read/write scopes by `company_id` (or a tenant-owned uuid handle, e.g. `audience_id`) — verified line-by-line in `audienceService`/`campaignService`/`operationalCoreService`.
- **Execution default-OFF (structural):** `envExecutionEnabled()` gates on `GTM_EXECUTION_ENABLED==='true'`; a global control row must exist `enabled=true`; the connector is **unconditionally dry-run** — `dispatchEmail` returns the literal type `{ dispatched:false, dryRun:true }` and never references the live email service (grep confirms no `sendTransactional`/`emailService` call in `execution/*`). Even `GTM_LIVE_SEND=true` cannot send in W5.1.
- **Suppression fail-closed:** `isSuppressed` returns `suppressed:true` on both query error and exception; correctly matches global+tenant × any-channel+specific.
- **RBAC separation of duties (definitions):** `ROLE_CAPABILITIES` are disjoint — approver≠executor; default-deny via `hasExecutionCapability`.

**Findings:**

### M-1 (Major) — Approval is caller-asserted, not server-verified
**Evidence:** `execution.ts` `dispatch_dry_run` calls `dispatchGuarded({ …, approved: b.approved === true })` and only checks `campaign.execute`. The bridge enforces `req.approved` but its value comes **straight from the request body**. No persisted, approver-signed approval record is consulted.
**Impact:** an actor holding `campaign.execute` (the Executor) can self-approve by sending `approved:true`, defeating the approver/executor separation the platform claims. Latent today (connector is dry-run), but it is the exact boundary that must hold before any live send.
**Recommendation:** the bridge must read a persisted approval (an approver-signed state on the campaign/message) and **never** accept `approved` from the client.
**Disposition:** **Condition on execution enablement (M5), not on merge.** Re-confirms M5 Adjustment D.

### M-2 (Major) — Kill-switch layered evaluation can fail OPEN across companies
**Evidence:** `executionControlService.isExecutionEnabled` builds `rows` for `['__global__', companyId]`, then per layer does `rows.find(x => x.scope===scope && x.scope_id===id && (scope==='tenant' ? x.company_id===companyId : true))`. For `connector`/`campaign` scopes the company filter is `true` — so a `__global__` connector row (`enabled=true`) can be matched **before** a tenant connector row carrying `emergency_stop`, and `.find` returns the first, masking the stop.
**Impact:** a tenant's connector/campaign emergency-stop can be silently overridden by a coexisting global-enabled row of the same `scope_id`. Fail-**open** in a safety-critical kill-switch. Latent (execution OFF) but disqualifying for go-live.
**Recommendation:** evaluate the **most-restrictive** matching row per layer (any `emergency_stop`/`enabled=false` among all matching rows blocks), and scope campaign/connector matches to the owning company.
**Disposition:** **Condition on execution enablement.**

### m-1 (Minor) — `release` (un-suppress) requires no capability
**Evidence:** `execution.ts` `case 'release'` calls `releaseSuppression` with no `requireCap`. Any authenticated tenant member can un-suppress a previously suppressed target.
**Impact:** consent/compliance risk — re-subscribing someone who unsubscribed. (Adding suppression is the safe direction and is acceptably open; removing it is not.)
**Recommendation:** gate `release` behind a capability (e.g. `campaign.override` or a compliance role).
**Disposition:** Condition on execution enablement.

### m-2 (Minor) — `campaign.override` is granted to no role
**Evidence:** `EXECUTION_CAPABILITIES` includes `campaign.override`, but no entry in `ROLE_CAPABILITIES` grants it; `set_control`/`kill_switch` require it → both endpoints are default-deny to **everyone**.
**Impact:** the kill-switch/control API is unreachable until `campaign.override` is bound to a role/grant — a go-live operability gap.
**Recommendation:** bind `campaign.override` to the operator/security role as part of capability-grant binding (M5 Adjustment D).
**Disposition:** Condition on execution enablement.

**Observation o-1:** RLS on all seven new tables is service-role `USING(true)` — tenant isolation is *application*-enforced (consistent with the existing lead spine, and verified airtight above). Defense-in-depth (company-aware RLS) would harden but is not required for parity.

---

## 4. Database Review — ✅ additive & safe (one doc gap)

Four migrations (`20260727000000/010000/020000/030000`): all `CREATE TABLE IF NOT EXISTS`, **additive + idempotent**, safe to re-run.
- **Indexes:** present and purposeful — composite `(company_id, entity_type, …)`, partial unique `uq_operational_assignment_active … WHERE active` (one active owner), suppression lookup `ON (target) WHERE active`.
- **Constraints:** CHECKs on status/priority/origin/reason/scope; UNIQUE with sentinels (`__global__`/`__none__`) to avoid expression-based uniqueness.
- **RLS:** enabled on every table; service-role policy created idempotently.
- **FKs:** none to parent entities — **intentional** (entity-agnostic core can't FK to multiple parents). Trade-off: orphan rows possible (o-4). Acceptable.
- **Rollback:** additive → rollback = `DROP TABLE`; flag-dark means zero read/write until services deploy. **No explicit down-migration file** — see M-4.

Consistency with repo policy verified: files are **not** auto-applied; controlled apply only (never `db push`, per the ledger-desync policy).

---

## 5. Runtime Review

- **Telemetry:** every guarded stage emits `execution.${stage}.${decision}`; operational/campaign events registered. Single dispatcher.
- **Observability:** reuses HARDEN-001 seams (`ownedDbTable`); no new platform.
- **Quota/cache:** distributed Upstash counters, **fail-closed** on error/2.5s timeout; in-memory fallback only when Redis is unconfigured. Capture-path rate-limit degrades to in-memory (availability-favoring) — correctly *opposite* to execution's safety-favoring fail-closed.
- **Rollout flags:** `LEAD_SCORE_MATERIALIZATION_ENABLED` (default-ON, additive), `GTM_EXECUTION_ENABLED`/`GTM_LIVE_SEND` (default-OFF), `LEAD_CAPTURE_CAPTCHA_SECRET` (dark). Correct posture.

**Finding m-3 (Minor) — audit persistence swallows errors.** `recordExecutionAudit` wraps the `execution_audit` insert in `try{…}catch{ /* best-effort */ }`; a DB write failure is silent (only telemetry fires), contradicting the table's "no silent failures" intent. **Recommendation:** emit a HARDEN-001 failure metric on audit-write failure. **Disposition:** Minor; before execution enablement.
**Observation o-2:** `checkQuota` increments buckets sequentially and only decrements the *exceeding* bucket on block — earlier buckets stay incremented, so blocked attempts slightly inflate tenant/connector counters. Safe direction (over-blocks). Optional hardening.

---

## 6. API Review — ✅ backward compatible

- All four routes are **net-new** endpoints under `/api/lead-intelligence/*` — no existing route signature changed. `pages/api/track.ts` and `pages/api/website/lead-capture.ts` are modified additively (protection wrap + canonical tracking) without changing response contracts.
- Deterministic: no `Date.now()`-driven response bodies leaking into contracts; dry-run always returns `dispatched:false`.
- Uniform envelope (`{error}` / `{ok}` / typed payloads); consistent 401/400/403/405/500.

---

## 7. Testing Review — ✅ deterministic (CI evidence green)

- Four new unit suites: `operationalStateModel`, `audienceSegmentation`, `campaignStrategy`, `executionGuards`. Program-wide 77/77 green locally (per R1); reproducible, no network.
- **CI evidence (PR #9):** Backend TypeScript certification **pass**, Non-regression baseline **pass**, readiness (120-scenario observability gate) **pass**.
- Regression coverage present for the guard logic (default-off, suppressed, unapproved, killed, quota) and the score-scale normalization fix.
- **Gap noted, not blocking:** no test asserts the M-1 approval-source or M-2 cross-company kill-switch layering — add regression tests alongside those fixes.

---

## 8. Documentation Review

Present: per-wave certification docs (LC-000…501, M4/M5/M5A/M5B, R1) with deploy/rollback *guidance embedded* (M5 §13 runbook; M5B §8 path-to-authorization).
**Finding M-4 (Major — documentation):** there is **no consolidated deployment guide, rollback guide, operational runbook, or release notes**, and **no down-migration files**. Guidance is scattered across certification docs. For a production-baseline merge this must be consolidated. **Recommendation:** a single `R3` deployment+rollback runbook (apply order for the 4 migrations, flag matrix, rollback = drop-in-reverse, verification steps). **Disposition:** Pre-merge / pre-R3 condition.

---

## 9. Risk Register

| Risk | Sev | Likelihood (now) | Mitigation / owner |
|---|---|---|---|
| Executor self-approves (M-1) | High at go-live | N/A (dry-run) | Bind persisted approval before enablement |
| Kill-switch fails open cross-company (M-2) | High at go-live | Low (needs coexisting rows) | Most-restrictive layer eval before enablement |
| Sequential merge reddens `main` (M-3) | Med | High if merged bottom-up | Squash/atomic merge or relocate telemetry fix |
| Un-suppress without RBAC (m-1) | Med | Low | Gate `release` |
| Kill-switch API unreachable (m-2) | Med at go-live | Certain until bound | Bind `campaign.override` |
| Silent audit loss (m-3) | Low | Low | Failure metric |
| No consolidated deploy/rollback doc (M-4) | Med | Certain | Author R3 runbook |
| Production build red in CI (R1 A1) | Med | Certain | CI-ops provides build env (pre-existing, not stack) |

---

## 10. Review Findings (classified)

| ID | Class | Title | Disposition |
|---|---|---|---|
| M-1 | Major | Approval caller-asserted, not server-verified | Fix before execution enablement |
| M-2 | Major | Kill-switch layered fail-open cross-company | Fix before execution enablement |
| M-3 | Major | PRs #6/#8 not independently green (telemetry fix only on #9) | **Pre-merge**: confirm merge strategy |
| M-4 | Major (docs) | No consolidated deployment/rollback runbook or release notes | **Pre-merge/R3** |
| m-1 | Minor | `release` un-suppress lacks RBAC | Before enablement |
| m-2 | Minor | `campaign.override` bound to no role | Before enablement |
| m-3 | Minor | Audit insert swallows errors | Before enablement |
| o-1 | Observation | RLS `USING(true)` — app-enforced isolation (verified) | Optional hardening |
| o-2 | Observation | Quota over-counts on partial block (safe direction) | Optional |
| o-3 | Observation | `envLiveSendEnabled` exported but unused (belt-and-suspenders) | None |
| o-4 | Observation | Operational tables have no parent FK (entity-agnostic) | Accepted |

**Critical: 0. Major: 4 (one merge-strategy, one docs, two latent execution-safety). Minor: 3. Observation: 4.**

---

## 11. Merge Recommendation

**Approve the stack for merge once the two pre-merge conditions are met:**
1. **M-3 — confirm & execute the merge strategy.** Recommended: **squash-merge the #5–#9 series as a single atomic baseline commit into `main`** (the intermediate PRs are review units, not sequential merge units; squashing lands all code + the telemetry contract fix atomically → `main` stays green). Acceptable alternative: relocate the telemetry union+registry change to the lowest branch introducing each event id (`operations.*` at #6, `campaign.recommended` at #8) and re-verify #6/#8 green.
2. **M-4 — publish the consolidated R3 deployment + rollback runbook.**

The execution-safety Majors (M-1, M-2) and Minors (m-1…m-3) are **not merge blockers** — the merged subsystem is default-OFF and structurally dry-run — but they are **hard gates on the later execution-enablement (M5)** and are carried into R3 as conditions on go-live, not on deployment.

Note (independent of the stack): the **Production build** CI check remains red on both `main` and the PRs — a pre-existing CI env/secrets gap (R1 Adjustment A1), owned by CI-ops. It must be green before merge but is not a stack defect.

---

## 12. Final Release Review Report

The GTM stack (W1.2 → W5.1) is **architecturally clean (zero drift), tenant-isolated, and correctly default-OFF**, with a single scorer, single suppression platform, single telemetry registry, and no new queue or dispatcher — all verified against the diffs, not asserted. Its tests are deterministic and its stack-attributable CI is green (R1). Independent review found **no Critical issues and no architectural defects**; it did surface four Major findings — a merge-strategy blocker (M-3), a documentation gap (M-4), and two latent execution-safety defects (M-1 approval binding, M-2 kill-switch layering) that gate the eventual go-live — plus three Minors. None require redesign.

**Decision: ✅ APPROVED WITH CONDITIONS.**
- **Merge authorized after:** M-3 (merge strategy confirmed & executed) + M-4 (deployment/rollback runbook) + Production-build CI green (A1, CI-ops).
- **R3 (Controlled Deployment) is authorized** on that basis — merge + deploy with execution flags **OFF**.
- **Execution enablement (M5) remains gated** on M-1, M-2, m-1, m-2, m-3 (which re-confirm M5 Adjustments A–D from independent evidence).

*Review-only milestone — no PR merged, no deploy, no execution/flag change, no live email, no production config modified, no canary. Those belong to R3 and the subsequent go-live phases.*
