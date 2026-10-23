# PI-C1-PHASE-1-IMPLEMENTATION-001 — bounded code-only remediation

**Scope:** the four authorized Phase 1 areas from `PI-C1-JEV-ARCHITECTURE-DECISION-002.md`. **Code and tests only.** No schema change, no migration, no database write, no production access, no provider call, no commit, push, merge or deployment. No Phase 2 work. **No requirement ratified and no acceptance granted.**

**Status: IMPLEMENTED and VERIFIED for the four authorized areas, by unit tests and a clean 3/3 typecheck. Not release approval. Phase 2 remains unauthorized.**

---

## 1. Baseline and final state

| | Value |
|---|---|
| Start | **2026-10-17T22:22:45+05:30 (IST)** |
| End | **2026-10-17T23:45:08+05:30 (IST)** |
| Repository / branch | `C:/tmp/r1-ctx` · `fix/r1-profile-context` |
| HEAD at start | `29fea38a2d1642c1c2fd957e5151f6be81415774` |
| **HEAD at end** | **`29fea38a2d1642c1c2fd957e5151f6be81415774` — unchanged; nothing was committed** |
| Worktree at start | **145 entries (67 M / 78 ??)**, manifest captured before editing |
| Worktree at end | **152 entries (72 M / 80 ??)** |
| Delta | **exactly the 7 paths in §2**; a line-by-line diff of the two manifests shows **no pre-existing entry lost or altered** |

**Source report hash gate (run before any edit):** `PI-C1-JEV-ARCHITECTURE-DECISION-002.md` = `bfbc683f3f7caa815ae3a4a717e232268e9a46a0c3ef60f16d355c14d393b780`, 633 lines — **MATCH**, re-verified unchanged at the end. `PI-C1-ARCHITECTURE-BLOCKER-REVIEW-001.md` = `a03d8aec…99a5b` — **unchanged**.

Nothing was cleaned, reset, stashed, reformatted or reconciled. The frozen schedule baseline is untouched (§8).

---

## 2. Exact changed paths

| Path | Change | SHA-256 (16) | Lines |
|---|---|---|---|
| `backend/services/lifecycleGuardErrors.ts` | **NEW** — append-only SQLSTATE classifier | `d63e5165d127e75b` | 86 |
| `backend/types/retention.ts` | `RETENTION_PROTECTED_CHILDREN` map | `60e9c05a8906fd8a` | 109 |
| `backend/services/retentionService.ts` | pre-exclusion, per-item outcomes, fail-closed probe | `ed0d5f59a452f5e2` | 386 |
| `backend/services/opportunityLifecycleService.ts` | typed fail-closed read, terminality predicate, transition refusal | `40bb4453ff14f4ca` | 323 |
| `backend/services/prospectLifecycle/lifecycleWriter.ts` | both SQLSTATEs; authorization kept distinct | `fde7e56c479a51a1` | 456 |
| `pages/api/active-leads/lifecycle.ts` | truthful 409 responses, never an auth status | `249e2ac3943b305e` | 119 |
| `backend/tests/unit/pic1Phase1RetentionAndLifecycleGuards.test.ts` | **NEW** — 45 tests | `cdbc648629c9299b` | 522 |

Tracked diffstat: **5 files, +422 / −22**. Control-byte scan on all seven: **CLEAN**.

---

## 3. Defect → change → test mapping

### 3.1 Retention pre-exclusion and per-item outcomes

| | |
|---|---|
| **Defect** | A delete batch containing one append-only-protected row deleted **nothing** (AD-1 probe P7). The whole 10 000-row statement was voided, the next run re-selected the same batch, and the only trace was a `failed` execution row carrying a raw trigger string |
| **Change** | `RETENTION_PROTECTED_CHILDREN` declares which children a guard protects (today: `opportunity_lifecycle_states` via `opportunity_feed_item_id`). `findProtectedIds` probes them **tenant-scoped** before any delete. Protected parents are excluded and reported; the remainder is deleted in one statement; if that statement still fails, a **per-item pass isolates the failure to its own row** instead of voiding the eligible rows with it. Outcomes are returned per item and summarised into the stored `detail` |
| **Dispositions** | `deleted` · `would_delete` (dry-run) · `excluded_protected` · `failed` · `already_absent` |
| **Truthfulness** | `rows_affected` counts **only database-confirmed deletions**. `status` is computed from the outcomes, so the stored row cannot disagree with the per-item record, and a run that excluded or failed anything is never `completed` |
| **Fail-closed** | If the protection probe errors, **nothing is deleted**: `status='failed'`, `detail='protection_probe_failed:…'`, every candidate reported `failed/protection_undetermined`. An unreadable probe is never read as "nothing is protected" |
| **Retry-safe** | Exclusions are deterministic and reported, so a repeat run reaches the same conclusion and deletes nothing extra |
| **No schema change** | `retention_executions` has no per-item column, so outcomes travel on the return value and as a `detail` summary. None is added or implied |
| **Tests** | 13 — eligible row survives a protected sibling · protected row and its evidence both survive · exclusion reported and status `partial` · only confirmed deletions counted · retry-safe · probe is tenant-scoped · cross-tenant evidence does not confer protection but the guard still isolates · failed deletion never reported successful · probe failure deletes nothing · dry-run previews the split and mutates nothing · retention never writes a transition · unprotected target unaffected |

### 3.2 Fail-closed typed lifecycle reads

| | |
|---|---|
| **Defect** | `transitionLifecycle` resolved absent history to `detected` (`current?.state ?? 'detected'`), opening the full transition graph from a state that was never recorded. Reachable in production because the pipeline's lifecycle init is **best-effort with its failure swallowed** (`listeningSignalPipeline.ts`) |
| **Change** | New `readCurrentLifecycleState` returns a discriminated `LifecycleReadResult`: `present` (with `isInitial`, distinguishing valid initial evidence from later history) · `missing` · `unreadable` with reason `read_failed` / `unknown_state` / `contradictory`. `transitionLifecycle` now **refuses** `missing` and `unreadable` with a new `LifecycleEvidenceUnavailableError`, distinct from `LifecycleTransitionError` |
| **No fabrication** | The refusal writes nothing. No initial history is created, no state is added, no automatic transition is introduced — a test asserts the table is still empty after a refusal |
| **Terminality** | `isResolvedForAccountDeletion(read)` encodes FR-A38 and FR-A39 in one place: **only a present `archived` resolves**; the other eight states, `missing` and `unreadable` all fail closed. It is a predicate over the read **result**, not a bare state string, which is what makes undetermined evidence fail closed rather than be coerced into a state first |
| **Tests** | 20 — all six read cases · reading never writes · tenant-scoped · `archived` resolves and each of the other eight does not · `missing`/`unreadable` fail closed · transition refuses missing without fabricating · refuses unreadable · still permits a legitimate transition from real history · already-`archived` retry is an invalid **transition**, not missing evidence |

### 3.3 SQLSTATE classification (B21)

| | |
|---|---|
| **Defect** | The Community guard raises **`P0001`** (plpgsql default, no `ERRCODE`); the PI guard raises **`42501`**. `lifecycleWriter.translate()` handled only `42501`, so a Community refusal fell through as an anonymous "insert failed". Worse, **`42501` is `insufficient_privilege`** and `attributionResolverService.ts:22` already classifies it as a **permission** failure — so an append-only refusal could be read as a credential problem and send a caller to re-authenticate or step up for a condition no credential can fix |
| **Change** | New `classifyLifecycleGuardError` recognises a refusal only when the SQLSTATE is `P0001` **or** `42501` **and** the message carries the guards' own `append-only` marker. The two codes map to one **application** class while the raw SQLSTATE is preserved in the result, so they are never made equivalent. `isAuthorizationRefusal` names the complement — a `42501` **without** the marker — so a genuine permission denial stays a denial; `lifecycleWriter` now reports it as `permission_denied` instead of absorbing it as an append-only violation |
| **Why message evidence is required** | `P0001` is the catch-all for any `RAISE EXCEPTION`, so a bare code test would capture unrelated plpgsql raises; `42501` is overloaded, so a bare code test would swallow real authorization failures |
| **Boundaries wired** | `retentionService` (classifies a batch or per-item refusal as `excluded_protected`, not a generic failure) · `lifecycleWriter.translate()` · `pages/api/active-leads/lifecycle.ts` |
| **API responses** | An append-only refusal returns **409** `lifecycle_evidence_immutable` (with the SQLSTATE); missing/unreadable evidence returns **409** `lifecycle_history_missing` / `lifecycle_evidence_unreadable`. **Never 401 or 403** — the request was authenticated and authorized; the record's state is what refuses it, so an auth status would wrongly invite a credential retry or step-up |
| **Tests** | 12 — both guards recognised · distinct SQLSTATEs preserved · genuine permission denial is **not** append-only and **is** an authorization refusal · append-only is **not** an authorization refusal · unrelated `P0001` raise not mistaken · `23505`/`23503`/`57014` left alone · malformed error objects tolerated |

**No trigger definition was changed, and no SQLSTATE was standardized through a schema change** — that is 21-B, deferred.

---

## 4. Test commands and actual results

All commands run from `C:/tmp/r1-ctx`. Runner invoked directly, never through `npx`.

| # | Command | Result |
|---|---|---|
| 1 | `node ./node_modules/jest/bin/jest.js backend/tests/unit/pic1Phase1RetentionAndLifecycleGuards.test.ts --runInBand --forceExit` | **1 suite / 45 tests — 45 passed** |
| 2 | `node ./node_modules/jest/bin/jest.js backend/tests/unit/piWscProspectLifecycleWriter.test.ts backend/tests/unit/piWseOutcomeInterpreter.test.ts --runInBand --forceExit` | **2 suites / 65 tests — 65 passed** (the only existing suites importing a changed file) |
| 3 | `node ./node_modules/jest/bin/jest.js --runInBand --forceExit --testPathPattern 'backend/tests/unit/pi.*\.test\.ts$'` | **89 suites / 2430 tests — 2430 passed**, 70 s |
| 4 | `node ./node_modules/jest/bin/jest.js --runInBand --forceExit --testPathPattern '…(tenant\|isolation\|authz\|crossOrg…)…'` | **53 suites / 1360 tests — 1360 passed**, 150 s |
| 5 | `npm run typecheck` (run alone) | **first run FAILED — 0/3 clean** (§5) |
| 6 | `npm run typecheck` (after the fixes, run alone) | **`TYPECHECK_EXIT=0` · 3/3 projects clean · 0 error lines** |

Exit codes were captured directly, not through a pipe, because piping into `tail` masks them. No unbounded whole-app suite was launched.

### 4.1 One test-double defect, fixed in the test

The first run of suite 1 failed 13 tests with `…limit(...).maybeSingle is not a function`: my double returned a promise from `.limit()`, while the lifecycle reader chains `.order().limit(1).maybeSingle()`. **The defect was in the double, not the product** — `limit` is now chainable, with `then` serving retention's direct `await`. No product code was changed to make a test pass.

---

## 5. I broke typecheck and fixed it

The first `npm run typecheck` returned **exit 1, 0/3 projects clean**. Two distinct errors, repeated across the three projects, **both in my own file and no pre-existing file implicated**:

| Error | Cause | Fix |
|---|---|---|
| `retentionService.ts(168,24)` **TS2352** | `data as Array<Record<string, unknown>>` — the client types a narrowed `select` as its own row shape, which does not overlap an index signature | cast through `unknown`, with a comment saying why |
| `retentionService.ts(313,38)` **TS2367** | My restructure moved the whole-run failure decision into the probe-failure arm, so `status !== 'failed'` became **provably dead** in the alternative branch | guard removed, with a comment recording that only `completed` and `partial` are reachable there |

Both fixed; affected suites re-run green (81/81); typecheck re-run **3/3 clean**. Recorded rather than quietly corrected, because the first result was a real failure of this work package.

---

## 6. Security and tenant-isolation evidence

| Property | Evidence |
|---|---|
| The protection probe cannot read across tenants | `findProtectedIds` applies `.eq('organization_id', …)` before `.in(…)`; a test asserts every probe query carries that tenant predicate |
| Cross-tenant evidence confers no protection, and is still not silently deleted | A lifecycle row owned by another tenant does **not** mark this tenant's row protected; the guard then refuses the delete and the per-item pass reports `excluded_protected / append_only_guard_P0001` rather than voiding the batch |
| Lifecycle reads are tenant-scoped | A read for org A with only an org-B row returns `missing`, not that row |
| Append-only evidence is preserved | After every retention path, the protected parent **and** its lifecycle rows still exist; tests assert both |
| No privilege or trigger weakening | No trigger, grant, RLS policy or migration touched. The guard remains the authority; pre-exclusion only makes its refusals predictable |
| Authorization semantics preserved | A genuine `42501` permission denial is no longer absorbed as an append-only violation, and an append-only refusal never returns 401/403 — so neither can trigger a credential retry or step-up for the other's condition |
| No automatic lifecycle transition | Tests assert zero inserts into `opportunity_lifecycle_states` from both a read and a retention run |
| Whole-suite confirmation | 53 tenant/isolation/authz suites, **1360/1360 pass**; 89 PI suites, **2430/2430 pass** |

---

## 7. JEV / GT status

**NOT RUN — BLOCKED.** Unchanged from `PI-C1-JEV-ARCHITECTURE-DECISION-002.md` §2, and re-confirmed rather than assumed: no OMNI Story exists for this work (human-only Jira gate); `JEV_JIRA_IDENTITY` and `JEV_READER_TOKEN` are unset; `gov packet` for this worktree reports `REFUSED` exit 11; `gov verify` requires a clean tree and this one carries 152 entries, whose adoption baseline must be a **human** commit; and the verification registry has no entry exercising lifecycle or retention invariants.

**No Jira Story was created, the verification registry was not altered, no governance tooling was changed, and no denied gate was bypassed. No JEV verdict is claimed or fabricated.**

**This agent implemented these changes and wrote these tests, so none of the above is independent verification.** The deterministic results in §4 are what they are; the judgement that they are sufficient has had no second reader.

---

## 8. Schedule

Frozen baseline **unchanged**: Milestone A′ **2026-11-25 / 28.5 human engineer-days** · WP-7 **2026-11-17 / 4.0** · C-1 **8–12** · **OVERRUN RISK remains raised, zero float at the high C-1 estimate** · next checkpoint **Friday 2026-10-23**. Nothing revised, no float claimed recovered, no recovery or de-scope applied.

| | |
|---|---|
| Phase 1 human estimate of record | **1.5–3.0 human engineer-days** (S1′) — **not revised** |
| Agent wall-clock, this task | **1 h 22 min 23 s** (22:22:45 → 23:45:08) |
| Of which machine gate time | **~1 h 06 min** — two full typecheck runs (20 min + 45 min 36 s) |
| Agent active engineering | **~25 min** |
| External waiting | **none inside this task**; 20 min 42 s before start (prior task closed 22:02:34) |
| 75 % effort warning | **Not triggered.** Agent wall-clock is **not** treated as equivalent to human engineer-days, so it cannot consume the human estimate; no overrun of the Phase 1 estimate is foreseeable from this work |

---

## 9. Checks not run, and residual risk

| # | Not run | Reason |
|---|---|---|
| 1 | **Any real-schema / database test of these changes** | Prohibited here: no database writes. **So the pre-exclusion is verified against a double that reproduces the guard, not against PostgreSQL itself** |
| 2 | Re-execution of the AD-1 probes | No evidence gap; the probes already established the behaviour being remediated |
| 3 | Whole-app jest run, lint, build | Not authorized by default; scoped suites were used instead |
| 4 | Production verification of any kind | Prohibited |
| 5 | `gov verify` / `gov judge` | **BLOCKED** (§7) |
| 6 | Human or independent review | None available |

**Residual risks, stated plainly:**

1. **The double is not the database.** It raises `P0001` on a cascade onto a protected lifecycle row, which matches probe P2/P7, but a real-schema test of the new pre-exclusion path is the only thing that would prove the production behaviour. **Recommended as the first follow-up**, and it needs database authorization.
2. **`RETENTION_PROTECTED_CHILDREN` is a hand-maintained mirror of database reality.** A future append-only child added without updating it would not be pre-excluded. The per-item fallback contains the damage — the unknown protection isolates to its own row and is reported — but it is a fallback, not a guarantee.
3. **The transition refusal is a behavioural change.** An opportunity whose best-effort lifecycle init never ran could previously be transitioned (from an assumed `detected`) and now returns **409 `lifecycle_history_missing`**. That is the intended fail-closed behaviour, but it is a visible change for any such record, and nothing here repairs those records — repair is not authorized and would mean writing history.
4. **`isResolvedForAccountDeletion` has no caller.** The account-deletion gate does not exist (`prospect_opportunities` is in no migration), so the predicate encodes FR-A38/FR-A39 and is unit-tested, but nothing consumes it yet. That is Phase 2.
5. **Error-message matching.** Classification depends on the guards' `append-only` wording. A future migration rewording a `RAISE EXCEPTION` without updating the classifier would downgrade a refusal to a generic failure — which is one more reason 21-B (explicit `ERRCODE`s) remains the durable fix.

---

## 10. Remaining Phase 2 and Q3 blockers — all still open

| Blocker | Status |
|---|---|
| **AD-3 / D-3** — manual, CRM and company-event origins still have **no opportunity producer and no lifecycle path**; FR-A9 multi-signal accumulation still unrepresentable | **OPEN — Phase 2, unauthorized** |
| **AD-3.3 / I-7** — tenant deletion still refused wherever lifecycle rows exist (probe P5), and the reference PI ledger carries the same cascade-plus-guard configuration | **OPEN — Q3-dependent** |
| **AD-2.2** — signal-derived personal data is still retained indefinitely wherever lifecycle history exists. Phase 1 makes this **visible and attributable**; it does not make it deletable, and **nothing here establishes legal eligibility to delete anything** | **OPEN — Q3-dependent** |
| **AD-4.3 / D-4** — the Community ledger can still be **born terminal**: no initial-state or initial-shape CHECK. Closing it needs a migration | **OPEN — needs separate authorization** |
| **B21 / 21-B** — the guards still raise different SQLSTATEs; only the application boundary was hardened | **OPEN by design** |
| **AD-6 / FR-A46, AC-A42, NC-A19** — §7.3 wording remains **PROPOSED**. **No acceptance is claimed or granted, and v0.1/v0.2/v0.3 were not edited** | **OPEN — owner decision** |
| **Q3** — legal-erasure / retention policy: not located, approval unverified, **no accountable owner evidenced**. No policy, period, tombstone rule or erasure semantic was invented | **BLOCKED** |
| **Ratification of PI-ADD-001 v0.3** | **NOT RATIFIED** |
| **Human independent review** | **OPEN** |

---

## 11. Final status

| Area | Status |
|---|---|
| Retention pre-exclusion and per-item outcomes | **IMPLEMENTED · VERIFIED** (unit, 13 tests) |
| Fail-closed typed lifecycle reads | **IMPLEMENTED · VERIFIED** (unit, 20 tests) |
| Both SQLSTATEs classified; authorization kept distinct | **IMPLEMENTED · VERIFIED** (unit, 12 tests) |
| Targeted tests | **IMPLEMENTED · VERIFIED** — 45/45; 2430/2430 PI; 1360/1360 tenant/authz; typecheck **3/3** |
| Proposed acceptance wording (§7.3 of the architecture report) | **PROPOSED — NOT ACCEPTED** |
| Behaviour against the real database | **UNVERIFIED** — no database test was authorized |
| JEV / GT gates | **BLOCKED / NOT RUN** |
| Independent review | **NOT RUN** |
| Phase 2, D-4 migration, 21-B, Q3 | **BLOCKED / UNAUTHORIZED** |

**Implementation is not release approval. Nothing was committed, merged or deployed. Phase 2 remains unauthorized, and Q3 remains blocked.**
