# GTM-PROGRAM-001 — R1 / RL-001

## CI Recovery & Release Baseline Certification

**Type:** Build-stabilization only. Root-cause CI recovery — no features, no logic, no migrations, no execution changes.
**Independent release authority.** Every fix in this milestone is **type-only / registry-only** and changes no runtime behavior.
**Question:** Is the engineering baseline restored to a green, releasable state?

---

## 0. Certification Decision

# ✅ RELEASE READY — WITH ADJUSTMENTS

The **one CI regression the GTM stack actually introduced is root-caused, fixed, and confirmed green on live CI.** Every check the stack can affect now passes on PR #9. Two red checks remain on the board, but both are **pre-existing on `main`**, independent of this program, and require **owner-side actions outside R1's code scope** — they are recorded as Adjustments A1–A2, not as stack defects.

| Check (PR #9, full stack) | Before R1 | After R1 | Owner |
|---|---|---|---|
| Backend TypeScript certification | ❌ fail (4 net-new) | ✅ **pass** (net-new 0) | GTM stack — **RESOLVED** |
| Non-regression TypeScript baseline | pending | ✅ **pass** | — |
| readiness (runtime observability gate) | pending | ✅ **pass** | — |
| Production build | ❌ fail | ❌ fail (pre-existing on `main`) | **CI-ops (A1)** |
| Stability regression lock* | ❌ fail on `main` | ❌ fail on `main` (not run on PR) | **Platform (A2)** |

\* Path-filtered to `tests/stability/**` + `jest.stability.config.js`; the GTM stack touches neither, so it does not execute on PR #9. It fails on `main` pushes for reasons wholly independent of this stack (see §5).

**Why "with adjustments" and not "not ready":** the stack is engineering-clean and its regression is gone. The residual red is a **CI-runner configuration gap** (missing build-time env) and a **pre-existing repo-hygiene diagnostic** — neither is silenceable under R1's rules, and neither is a GTM defect. A fully green board needs two owner actions, not stack rework.

---

## 1. RL-101 — CI Failure Audit

Authoritative source: GitHub check-runs on `main` HEAD + live PR #9 run `30233571663`.

### `main` baseline (before any GTM merge)
| Check | Conclusion |
|---|---|
| Backend TypeScript certification | ✅ success |
| Non-regression TypeScript baseline | ✅ success |
| Governance baseline & documentation | ✅ success |
| Platform parity validators | ✅ success |
| Runtime observability gate | ✅ success |
| Strategic narrative regression lock | ✅ success |
| **Production build** | ❌ **failure** |
| **Stability regression lock** | ❌ **failure** |

**Finding:** `main` is **already two-red before this program** — the Production build and Stability lock were failing on `main` independently. The GTM stack inherited, and did not cause, those two.

### PR #9 (full stack) delta vs `main`
| Check | main | PR #9 (post-fix) | Attribution |
|---|---|---|---|
| Backend TypeScript certification | success | ✅ pass | **GTM regression → fixed** |
| Production build | failure | ❌ fail | pre-existing (unchanged) |
| Non-regression TS baseline | success | ✅ pass | unaffected |
| readiness | success | ✅ pass | unaffected |

**Only one check flipped red because of the stack — Backend TypeScript certification — and it is now green.**

---

## 2. RL-102 — TypeScript Certification — ✅ PASS (regression resolved)

**Root cause (first-failing identity).** W2/W4/W5.1 emitted `trackEvent()` with event ids not present in the canonical `TelemetryEventType` union:
- W2 `operationalCoreService` → `operations.task_updated`, `operations.${eventType}`
- W5.1 `executionAuditService` → `execution.${stage}.${decision}`
- W4 `campaignService` → `campaign.recommended`

`ts-jest` runs `isolatedModules` (transpile-only) so the local Jest suite never type-checked these; the full-program `tsc` **ratchet** (`scripts/typecheck-certification.js`) caught them as **4 net-new error identities above baseline**. The ratchet fails on *net-new identities*, not on a rising scalar total — correct behavior.

**Fix (type-only, zero drift):**
1. `0d91066d` — widened the `TelemetryEventType` union: added literal `campaign.recommended` and template-literal members `` `operations.${string}` `` / `` `execution.${string}` ``. Template-literal members act as index signatures, so the dynamic stage/decision events need no registry rows.
2. `727449fd` — added the one required registry row `campaign.recommended` to `Record<TelemetryEventType, TelemetryEventDefinition>` in `telemetryRegistry.ts` (the literal — unlike the template members — demands an exhaustive-map entry). Category/entity/aggregation mirror the sibling `campaign.*` rows.

**Verification.** Local `node scripts/typecheck-certification.js`:
```
tsconfig.backend.json:        errors 0/1   · net-new 0 · resolved 1
tsconfig.backend-tests.json:  errors 442/443 · net-new 0 · resolved 1
RESULT: PASS
```
Live CI PR #9 run `30233571663`: **Backend TypeScript certification — pass (2m45s)**; **Non-regression TypeScript baseline — pass**.

**No error was silenced, no `@ts-ignore` added, no check weakened.** The union widening is the *correct* canonical home for these events (the registry is documented as "the single source of truth for events").

---

## 3. RL-103 — Production Build Report — ❌ pre-existing CI-config failure (A1)

**Symptom:** `npm run build` aborts at startup with `[CONFIG ERROR] Environment validation failed:`.

**Root cause:** the `Production build` job in `.github/workflows/typecheck-certification.yml` runs with `env: { CI: 'true' }` and **no application env/secrets**. `config/index.ts` performs fail-fast validation at config load and `process.exit(1)`s when required env vars are absent — so the Next build dies before webpack compiles. The workflow's own comment anticipates this: *"provide build-time env via repo secrets if static generation needs it."*

**Attribution:** **PRE-EXISTING on `main`** — main's Production build run (`30200012314`) fails with the byte-identical `[CONFIG ERROR] Environment validation failed:` signature. The GTM stack did not introduce it and cannot fix it in code without weakening the fail-fast guard (explicitly forbidden by R1 — "never silence errors").

**Corrective action (A1, CI-ops owned):** provide the build-time env to the Production build job via repo secrets (or a documented CI `.env` for build), matching the app's required-config contract. This is a workflow/secrets configuration change, not a code change, and belongs to the release/CI owner.

---

## 4. RL-104 — Environment Configuration Report

- `config/index.ts` is the single validated-config chokepoint; server paths fail-fast, browser/tests throw. **Correct and unchanged.**
- The failure in §3 is a **runner-provisioning** gap, not a config-schema defect. The schema is sound; the CI job simply isn't given the inputs it requires.
- **No production config was read or modified** in R1 (out of scope). Execution flags remain OFF (`GTM_EXECUTION_ENABLED` / `GTM_LIVE_SEND` unset in every env).

---

## 5. RL-105 — Stability Regression Lock — ❌ pre-existing repo-hygiene (A2)

Runs only when `tests/stability/**` or `jest.stability.config.js` change — **the GTM stack touches neither**, so this check does **not run on PR #9**. It fails on `main` pushes. Root-caused via local `jest --config jest.stability.config.js`:

`tests/stability/runtime-integrity/runtimeIntegrity.test.ts` — 2 of 41 assertions fail:
1. **`operator remote safety scan`** — `collectOperatorSafetyFindings()` raises `OPERATOR_REMOTE_ACCESS_WITHOUT_SAFETY` for `scripts/operator/db/db-push.sh`; the test asserts that specific file/code is absent.
2. **`startup env write scan`** — `collectStartupEnvWriteFindings({...fixed npm-script set...})` returns 16 `STARTUP_ENV_WRITE_RISK` findings; the test asserts `[]`.

**Attribution:** both assertions consume **inputs independent of the GTM stack** — test 1 keys on the literal path `scripts/operator/db/db-push.sh`; test 2 passes a **hardcoded** script map (`dev`, `dev:app`, `dev:full`, `start`, `prestart`, `env:validate`), *not* a repo scan. The stack's one added script (`scripts/operator/db/backfill-lead-intelligence.ts`) cannot influence either. Confirmed pre-existing on `main` HEAD.

**Corrective action (A2, platform owned):** remediate the flagged operator/startup scripts (add the safety guard to `db-push.sh`; move env-writing out of startup-adjacent scripts) **or** the platform team consciously updates the diagnostic's expectation. R1 will **not** silence it (forbidden) and it is **out of the GTM stack's causal scope**.

---

## 6. RL-106 — Testing Certification — ✅ deterministic

- GTM-stack suites: **77/77 green** locally (W0→W5.1), reproducible, no order dependence, no network.
- CI `readiness` (runtime observability gate, 120 scenarios + wiring + activation safety): **pass** on PR #9.
- Jest is transpile-only (`isolatedModules`) — a green suite is **not** a type-check; the `tsc` ratchet (§2) is the type authority, and it passes. This asymmetry is documented, not a defect.

---

## 7. RL-107 — Dependency Certification — ✅

`npm ci` succeeds in every CI job (all four jobs installed and ran). No lockfile drift, no new runtime dependency introduced by R1 (the two fixes edit two existing TS files only). No dependency changes were made.

---

## 8. RL-108 — GitHub Actions Certification

| Workflow / job | PR #9 | Notes |
|---|---|---|
| Backend TypeScript certification | ✅ pass | fixed in R1 |
| Non-regression TypeScript baseline | ✅ pass | |
| readiness (observability gate) | ✅ pass | |
| Production build | ❌ fail | A1 — CI env/secrets (pre-existing on main) |
| Stability regression lock | n/a on PR (fails on main) | A2 — repo-hygiene (pre-existing) |

Workflow definitions are sound; no workflow YAML was modified in R1.

---

## 9. Release Candidate

- Branch `feat/gtm-w5-1-guarded-execution` @ `727449fd` (top of the #5–#9 stack).
- Contents: LEAD-INTELLIGENCE / GTM W0→W5.1 + the two R1 type-only fixes.
- Execution **default-OFF** in all envs; migrations shipped as reviewed SQL (unapplied to prod; dark-validated on test tenant).

---

## 10. Root-Cause Summary

| # | Failure | Root cause | Owner | Status |
|---|---|---|---|---|
| 1 | Backend TS cert (4 net-new) | `trackEvent()` emitted event ids absent from `TelemetryEventType` union + registry; Jest transpile-only masked it | GTM stack | ✅ **fixed** (`0d91066d`, `727449fd`) — CI green |
| 2 | Production build | CI job runs `npm run build` with no app env; `config/index.ts` fail-fast exits | CI-ops (A1) | ⚠ pre-existing; owner action |
| 3 | Stability regression lock | `runtimeIntegrity.test.ts` flags `db-push.sh` remote-access + hardcoded env-write scripts | Platform (A2) | ⚠ pre-existing; owner action |

---

## 11. Corrective Action Register

| ID | Action | Type | Owner | Blocking merge? |
|---|---|---|---|---|
| **R1-FIX-1** | Widen `TelemetryEventType` union | type-only | GTM | ✅ done |
| **R1-FIX-2** | Register `campaign.recommended` definition | registry-only | GTM | ✅ done |
| **A1** | Provide build-time env/secrets to the Production build CI job | CI config | CI-ops | Yes (for fully-green board) |
| **A2** | Remediate operator/startup-script hygiene findings (or update diagnostic) | repo hygiene | Platform | No (not run on PR; independent of stack) |
| **STACK-1** | Carry R1-FIX-1/2 down to lower stack branches (or squash-merge #5–#9) so intermediate PRs #6/#8 also pass backend-TS | merge strategy | GTM/reviewer | Yes (for clean stacked merge) |

---

## 12. Final Release Certification

The GTM stack's **sole CI regression — the backend-TypeScript certification — is root-caused, fixed with type-only / registry-only changes (zero drift, nothing silenced), and confirmed green on live CI (PR #9).** Non-regression baseline and the runtime observability gate also pass; the stack's tests are deterministic (77/77). The two remaining red checks (Production build, Stability lock) are **pre-existing on `main`, independent of this program, and require owner-side configuration/hygiene actions** (A1, A2) that R1's scope and rules do not permit resolving in code.

**Decision: ✅ RELEASE READY — WITH ADJUSTMENTS (A1, A2, STACK-1).**
The engineering baseline attributable to the GTM stack is restored to green. A *fully* green board additionally requires the owner-held A1 (CI build env) and A2 (repo-hygiene), plus the STACK-1 merge strategy for a clean stacked land.

*Build-stabilization milestone — two type/registry-only fixes. No feature, no logic, no migration, no execution change, no PR merged/approved, no deploy, no send, no production config touched.*
