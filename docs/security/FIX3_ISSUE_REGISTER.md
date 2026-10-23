# Fix 3 — Cumulative Issue Register

**Scope.** Every finding raised across the Fix 3 remediation programme (review
phases 69, 71, 73, 75 and remediation phases 70, 72, 74, 76), with its current
classification and the evidence behind it. This is the single place that records
what is done, what is deferred, what needs an owner decision, and what is a
standing limitation. It is cumulative: entries are updated, never deleted.

**Change set.** Uncommitted, in a detached worktree at HEAD
`5604b50bdebd23efd6d040b90f5802954413b656`. Nothing is staged. The frozen
predecessor migration `20260718000002_content_quality_collaboration.sql`
(sha256 `34dffb69…49d`) is unmodified and must stay so.

**Authorization boundaries in force throughout.** No database access, SQL
execution, DDL, migration application or ledger change. No `supabase db push`.
No commits, pushes, merges, pull requests or deployment. No credential or secret
inspection. No access to the primary workspace checkout.

**How to read a classification.**

| Class | Meaning |
|---|---|
| RESOLVED | Implemented and validated locally. Evidence cited. |
| OWNER DECISION | Needs a decision this programme is not authorized to take. No code changed. |
| LIMITATION | Accepted and documented in the code itself. Not a defect. |
| BLOCKED | Cannot be settled without something unavailable here (in practice: a database). |

---

## A. RESOLVED

| ID | Finding | Evidence |
|---|---|---|
| H1 | `save-strategy` had two of its three no-options upserts UNDECLARED, so one fixture token reinstated the BLOCKER-1 false pass. The route writes `campaign_strategies` (`:64`), `content_pillars` (`:102`), `platform_strategies` (`:127`). | All three declared with `alsoForNoOptionsCalls`; branches deliberately activated; `assertNoHarnessConfigurationError()` adopted in `afterEach`; 5 mutants killed. |
| H2 | Company provenance was generated in exactly one way, so a mutant reading `query.company_id` — or a header, which is not a source at all — was invisible. | 4 divergence shapes x 3 request shapes, plus an absent-higher-source case and a control. Precedence proven from `lib/content/contentApiHelpers.ts:19-30`. 4 mutants killed. |
| H3 | Content provenance was never a separate dimension; a mutant reading `body.contentId` overwrote another document's block in the same company. | 4 rival sources x 4 assertions (ownership lookup, cross-document overwrite, id-less stamping, GET), plus a foreign-tenant insert and a control. 5 mutants killed. |
| H4 | The uniqueness rule asked whether a value was OCCUPIED, so writing one of two duplicated rows saw its own unchanged value as a conflict and returned a spurious 23505. | Rewritten to a MULTIPLICITY invariant: no value may exceed `max(1, before)`. Six cases pinned plus an order-independence regression. 3 mutants killed. |
| M-append-null | Append mode stored an explicit `id: null` silently, contradicting the documented 23502 rule. | Guard at all three branches, ordered AFTER the mandatory configuration refusals so a malformed row buys no exemption from one. |
| M-snapshot | `Call.payload` and `Call.options` were the caller's own objects by reference, so a route mutating its payload after writing changed the recorded observation. | `run()` deep-copies filters, payload and options. Two tests pin it. |
| M-indoption | Index ordering options were unchecked by the migration; an ASC index where the design wants DESC passed every guard and was reused by `IF NOT EXISTS`. | `FIX3-IDX-03f` (pre-creation) and `FIX3-IDX-04` (post). Expectations derived independently from the DDL and cross-checked: 16/16 spec rows agree. |
| M-include | INCLUDE columns were checked only post-creation, so the pre-guard list did not enumerate every state `IF NOT EXISTS` would skip. | `FIX3-IDX-03g` added (Phase 76). |
| M-opclass | Operator class was checked by NOTHING in the migration — delegated to a manual-paste script that nothing makes a condition of applying. | `FIX3-IDX-03h` (pre) and `FIX3-IDX-04` (post), using the same catalog predicates as the artifact (Phase 76). |
| M-collation | Collation override was likewise unchecked by the migration. | `FIX3-IDX-03i` (pre) and `FIX3-IDX-04` (post) (Phase 76). |
| M-audit-parity | The verification artifact never re-read the migration's audit-preservation preconditions, so a DELETE trigger added AFTER the migration applied passed it silently. | Artifact section 11: parity with `FIX3-AUDIT-00/01/02/03` over the same five relations, same predicates, same three-fact `_RETURN` test. |
| M-grant-accessor | Seven grant-path assertions used `writeCalls()`, which deliberately counts statements the harness REFUSED. One was a demonstrated live false pass. | All seven moved to `completedWrites()`; deny assertions deliberately left on `writeCalls()`. Mutation proof on the `angle-industry-matrix` route: forced write error plus the old accessor PASSES, the new accessor FAILS. |
| M-census | The no-options upsert census misclassified `whatsappWebhookProcessor.ts`: a scanner that did not skip comments inside the argument list desynchronised on an apostrophe. | Scanner fixed; census corrected to ten genuine sites across six files; all ten re-verified by reading the source. |
| M-census-population | The 301/287/14 split read as a clean partition of PostgREST statements, but at least 19 of the 301 are not Supabase upserts (4 store abstractions plus 15 CMS-adapter three-argument calls). | Population now stated explicitly in the harness docblock (Phase 76). Counts verified: 15 across 7 CMS files. |
| M-stale-counts | The `seed()` mid-test figures disagreed across four docblocks (two / ten / eleven). | All reconciled to EIGHT, with the reconciliation itself recorded. |
| M-adoption-count | "Adoption is 3 suites of 72" was ambiguous and went stale when Phase 74 added a fourth call site. | Now counted precisely: three HOOK adoptions, plus one self-test which is not an adoption (Phase 76). |
| M-array-id | The two caller-input helpers disagree about arrays — `resolveCompanyId` skips one, `firstQueryValue` takes element [0] — and only the company side was pinned. | Two tests added pinning the content side, including a positional test proving element [0] is what decides (Phase 76). |
| M-header-drift | Several migration header claims described coverage from earlier revisions, including one sentence that survived two corrections. | The header now enumerates all seven index-shape properties against the guard that checks each, pre and post. |
| M-unused-import | `writeCalls` was left imported but unused after the accessor swap. | Removed (Phase 76). |
| OD-1 | `pages/api/track/angle-industry-matrix.ts` returned `200 { ok: true }` whether or not its database write succeeded. On inspection there were TWO discarded errors, not one: the SELECT's error was dropped as well, which made `existing` undefined — indistinguishable from "no row yet" — so the upsert OVERWROTE a running aggregate with `post_count: 1`. A transient read failure destroyed accumulated data and still answered 200. | Both errors now read; 500 with a generic message, matching `save-strategy.ts:84` / `metrics.ts:121`. Logged as code + message only, never the error object (which carries `details`/`hint`) and never the payload. 14/14 in its suite, exit 0. TWO mutants killed: removing the write check fails 3 tests; removing the read check fails 1, returning 200 where 500 is required. Authorized in Phase 77. |
| OD-2 | `backend/services/authResolver.ts` deferred a DYNAMIC `import()` into a `setImmediate` callback. `import()` evaluates synchronously, so after Jest teardown it threw a ReferenceError before any promise existed — the `.catch` only ever covered rejections of a promise that had been constructed, and the throw escaped a timer callback as an unhandled exception. That is why the broad suite exited 1 with all 2490 assertions passing. The logged `bootAuthSubsystem is not a function` was the same root cause at another moment (degenerate module namespace); the export has always existed (now at `authSubsystemBoot.ts:154`; it was `:67` when Phase 77 wrote this, and Phase 78 inserted the degraded-snapshot helper above it). | Static import + direct call, wrapped in try/catch, with the tracked promise assigned synchronously. Timer removed: it bought nothing once the import was static. Run-once stays with the boot module, which is single-flight memoized internally, so there is one memoization rather than two racing. New `getAuthSubsystemBootPromise()` and `resetAuthSubsystemBootSchedule()` give it an observable completion path and a defined test/shutdown lifecycle. **Connector-auth suite ALONE: exit 0, 13/13, zero teardown errors.** New suite `authResolverBootLifecycle.test.ts` 8/8 covering successful boot, rejection, synchronous throw, non-Error throw, no-duplicate-boot, nothing-left-pending, reset, and never-awaited. TWO mutants killed: removing the try/catch fails 2 tests; restoring the `setImmediate` shape fails all 8. Authorized in Phase 77. |
| OD-8 | `bootAuthSubsystem` ran two operations that are NOT internally contained: `getSchemaHealth()` (its wrapper logs before caching, so a logger failure rejects it) and `emitBootFingerprint()` — **synchronous**, and it logs at `bootFingerprint.ts:126` BEFORE assigning its own cache at `:137`, so a throw from that log, or from `createHash`, propagates out. Either rejected the single-flight IIFE. `cachedReadiness` was assigned inside that IIFE so it stayed null, and `bootInFlight` retained the **rejected** promise, which the `if (!bootInFlight)` guard then handed to every later caller for the process lifetime. One transient failure permanently broke `/api/health/readiness`, whose documented contract is 200/ready or 503/degraded — it answered 500 instead, forever. This contradicted the module's own docblock: "Never throws — every failure mode is converted into a degraded readiness state". | **Confirmed by inspection, then fixed.** `.catch` appended to the single-flight promise converts any rejection into a degraded snapshot (`degradedBootSnapshot`, `authSubsystemBoot.ts:88-118`), which is cached and resolved. `schema.missing` is left EMPTY rather than fabricating drift detail the probe never established. A failure in the LOGGING after the snapshot exists returns the REAL snapshot rather than a fabricated degraded one. The degraded log call is itself try/caught so a broken logger cannot re-poison the handler. **No retry introduced** — "runs at most once per process" is the documented contract and `getSchemaHealth` already caches a degraded probe the same way. New suite `authSubsystemBootFailureLifecycle.test.ts` **16/16, exit 0**. THREE mutants killed: removing `.catch` fails 8 tests; removing the real-snapshot-wins early return fails exactly 1; removing the generation guard fails exactly 1. Phase 78. |
| OD-9 | `getSchemaHealth` carried the SAME unprotected-IIFE shape OD-8 had. `probeSchema` is internally contained, but the logging after it was not (`console.error` on the non-production drift path, plus `logger.error`/`logger.info`), and `cached = result` came AFTER that logging. A logger throw therefore rejected the single-flight IIFE, left `cached` null, and `inFlight` retained the REJECTED promise, which the `if (!inFlight)` guard handed to every later caller for the process lifetime. `pages/api/health/schema.ts:43` awaits it with no try/catch and its documented contract is 200/ok or 503/degraded, so one transient logging failure made that endpoint a permanent 500. Callers arriving via `bootAuthSubsystem` were already shielded by the OD-8 catch; this route was not. It also had the same reset-vs-stale-completion race. | **Fixed in Phase 80.** `.catch` on the single-flight promise resolves to the degraded result instead of rejecting; a failure AFTER publication returns the REAL result (a log failure is not a probe failure); the degraded log call is itself try/caught so a broken logger cannot re-poison the handler; a `probeGeneration` counter stops a stale in-flight probe publishing across `resetSchemaHealthCache()`. The degraded literal that `probeSchema` had always returned is now the named helper `degradedSchemaResult()` used by both paths, so the two cannot drift while claiming to produce the same thing. **RETRY POLICY UNCHANGED** — a degraded result is cached exactly as before, so there is still at most one probe per process; no retry was introduced. New suite `schemaHealthFailureLifecycle.test.ts` **15/15, exit 0**, covering healthy caching, concurrent single-flight, drift, logger failure on both the healthy and drift paths, pre-publication failure, the poison case, no unhandled rejection, the reset race, and the route at 200 / 503-on-drift / 503-not-500-when-unavailable / 503-on-a-second-request / 405. THREE mutants killed: removing `.catch` fails 8; removing the real-result-wins early return fails 5; removing the generation guard fails 3. |
| M-boot-reset-race | Separate defect found while tracing OD-8: `cachedReadiness = snapshot` was assigned unconditionally inside the boot IIFE, so a `resetAuthSubsystemBoot()` during an in-flight boot left the **stale** attempt free to publish its result into the freshly-cleared state afterwards. | Generation counter: an attempt captures `bootGeneration` at start and publishes only if it still matches; `resetAuthSubsystemBoot()` increments it. Pinned by "RESET does not let a stale in-flight boot publish into the fresh state", which fails if the guard is removed. Phase 78. |
| M-health-route-coverage | Neither `pages/api/health/readiness.ts` nor `pages/api/health/metrics.ts` had ANY test. The only pre-existing "health/metrics" test targets `pages/api/system/health/metrics`, a different route. The two routes have deliberately different contracts (readiness gates traffic with 200/503; metrics is a diagnostic surface and always answers 200) and neither was pinned. | Four tests added in the OD-8 suite covering both routes on both a healthy and a failed boot, asserting status codes and body shape. The readiness 503-not-500 test is the one that demonstrates OD-8's user-visible consequence. Phase 78. |
| M-failtable-op | `failTable()` was checked at the top of `runInner` before op dispatch, so a table-wide fault failed a read-then-write route's SELECT first and its WRITE was never reached. A test could not exercise write failure at all — it silently exercised the read path while claiming otherwise. | `failTable(table, op?)` added, backwards compatible (no `op` = every statement, as before). This is what makes OD-1's two failure paths provable apart. |
| M-envtest-key | The minimal `.env.test` created in Phase 74 omitted `ENCRYPTION_KEY`, so four suites that load the full env schema (`authCtx002WhoamiDisclosure`, `platformWave2`, `purchaseCompletePlatformAuthorization`, `opt002PilotRouteCacheHeaders`) failed with a ZodError before any assertion ran. They are not harness consumers, so the 72-suite run never exposed it. A defect in this programme's own environment setup, not in the product. | 64-hex placeholder added (`deadbeef` repeated, so it cannot be mistaken for a key); verified against `scripts/lib/certAwareEnv.cjs` to contain no production marker. `authCtx002WhoamiDisclosure` went 15-failed/12-passed → **27/27, exit 0**. Proven unrelated to OD-2 by A/B: identical 15/12 with the ORIGINAL and the FIXED resolver. |
| M-baseline-method | The backend-tests comparison was a SCALAR count against a figure carried in prose, never checked against `scripts/backend-tests-typecheck-baseline.json`. That guard's own docblock says a total count is "too weak … fixing one diagnostic while introducing another keeps the count at 260 and passes". | The committed guard was run (Phase 76): `baseline total: 260`, `actual total: 259`, **net-new 0**, resolved 1, `RESULT: PASS`, exit 0. Matches a hand-rolled set comparison done independently in Phase 75, including the specific resolved diagnostic. `--update-baseline` was NOT passed — see OD-7. |

## B. OWNER DECISIONS — status as of Phase 82

**The owner ruled on all open items in Phase 82.** Each row below now records
that ruling. A ruling of KEEP is a decision about what ships now; it is not a
claim that the alternative is wrong in every future product context.

| ID | Decision | Why it is not ours to take |
|---|---|---|
| ~~OD-1~~ | **RESOLVED in Phase 77** under explicit owner authorization. See section A. | — |
| ~~OD-2~~ | **RESOLVED in Phase 77** under explicit owner authorization. See section A. | — |
| ~~OD-8~~ | **RESOLVED in Phase 78.** The Phase 77 uncertainty is settled: `emitBootFingerprint` IS a reachable synchronous throw (it logs before caching its result), so the rejected-promise defect was real, not hypothetical. See section A. | — |
| D1 | **Already decided — recorded here for completeness.** Phase 79 noted it was documented only in the route. `GET /api/content/approval-history` additionally requires the CONTENT_WRITE_ROLES capability, deliberately STRICTER than the per-content route whose GET is gated on membership alone, because a company-wide read exposes every approval decision, actor and note across all content — including content that has been deleted. Rationale lives at `pages/api/content/approval-history.ts:27-32`. No new role and no bypass: `enforceContentWriteRole` is reused as-is. | Decided by the owner, NOT open. Listed so this register is the single place a reader has to look. |
| ~~OD-9~~ | **RESOLVED in Phase 80** under explicit owner authorization. The Phase 79 classification (confirmed defect, not an unverified concern) held up: the logging after `probeSchema` was unprotected and `cached = result` came after it, so a logger throw left `inFlight` permanently rejected and `pages/api/health/schema.ts:43` — which awaits it with no try/catch — answered 500 forever instead of its documented 503. See section A. | — |
| OD-3 | A repeated `?companyId=` is an array, which `resolveCompanyId` skips, so the body decides. Accept, or reject repeated parameters? | Precedence policy. Not exploitable: one value both authorizes and is used. Pinned as current behaviour. **OWNER DECISION (Phase 82): KEEP CURRENT BEHAVIOR.** `resolveCompanyId` and its repeated-query handling are unchanged. Not exploitable: the one resolved value both authorizes and is used, so nothing splits what is checked from what is acted on. Pinned by a test so it cannot drift. |
| OD-4 | `collaborationService.setBlockLocked` filters `id` and `company_id` and never `content_id`, so a writer holding document A can lock a block of document B in the same company. Should the lock path be content-scoped? | Intra-tenant authorization policy. Pinned by a test titled "pinned, not endorsed". **OWNER DECISION (Phase 82): KEEP COMPANY-SCOPED BEHAVIOR.** The `(id, company_id)` filter is unchanged and `content_id` was NOT added. This records what ships now; it is NOT a finding that content scoping is unnecessary in every product context. The tenant boundary holds — the exposure is intra-tenant, cross-document only — and the behaviour stays pinned by a test titled "pinned, not endorsed". |
| OD-5 | A repeated `?id=` resolves to element [0] rather than being rejected. | Same class as OD-3, content side. Pinned by two tests. **OWNER DECISION (Phase 82): KEEP FIRST-VALUE BEHAVIOR.** `firstQueryValue` still returns element [0] for a repeated `?id=`. Not exploitable for the same reason as OD-3. Pinned by two tests, one of them positional. |
| OD-6 | Non-deny `writeCalls()` uses beyond the seven in-scope sites (for example `routeAuth001Campaigns:266,275`). This is a census of candidates, NOT 44 proven defects. | Scope decision. Each needs individual assessment; most are helper definitions serving both directions, or the fidelity suite asserting the mechanism itself. **OWNER DECISION (Phase 82): AUTHORIZE MECHANICAL HOOK ADOPTION, REPORT FINDINGS ONLY.** The established `assertNoHarnessConfigurationError()` detector was adopted as an additive `afterEach` in **68** of the 72 harness-consumer suites. Excluded with reason: the 3 suites that already adopt it (no duplicate registration) and `routeAuthHarnessFidelity`, which TESTS the detector and deliberately leaves the refusal ledger dirty inside its own assertions, so a global hook would contradict the suite under test. No existing hook, import, assertion or conflict model was changed. Per the authorization, newly surfaced failures were to be REPORTED, not fixed. RESULT: see the Phase 82 report. This closes the mechanical sweep; it does NOT certify the remaining individual `writeCalls()` candidates as defect-free. |
| OD-7 | `scripts/backend-tests-typecheck-baseline.json` carries `"total": 260`; the tree yields 259. Its own note says it may be lowered "only in a deliberate, reviewed commit". | Changing a committed gate artifact. Pre-existing, not caused by this programme. **OWNER DECISION (Phase 82): DEFER.** The committed baseline stays at **260**; the file was not touched and `--update-baseline` was not passed. Lowering it is maintenance, not a gate requirement — the non-regression gate already passes with net-new 0. |
| OD-10 | **Retry policy for boot and schema health.** Both `bootAuthSubsystem` and `getSchemaHealth` cache a DEGRADED result and never retry: at most one probe per process, which is what `getSchemaHealth` has always done with its own degraded probe. The trade-off is that a process which hits a transient failure serves `503 degraded` until it restarts, even after the cause clears; retrying would risk every instance hammering a sick database and reintroduce the concurrency questions the single-flight design exists to avoid. | **OWNER DECISION (Phase 82): KEEP CACHED DEGRADED RESULT, NO AUTOMATIC RETRY.** No retry, no TTL, no background recovery was implemented. Both health routes already surface the degraded state honestly (readiness 503, metrics 200), and short-lived serverless processes make restart the natural recovery. If recovery is ever wanted, the shape to use is a bounded TTL on a cached DEGRADED result only — never on a successful one. |
| OD-11 | **Trigger-function convergence.** Fix 3's STEP 7 selects the `content_block_set_updated_at` executor through four ordered branches, so the CREATE and RECONCILE paths can leave different timestamp-trigger function references — `omnivyra_touch_updated_at()` and `set_content_updated_at()` respectively. Phase 97 reported the two behaviorally equivalent by body, arity, language, security mode and configuration, and the companion artifact's `FIX3-VERIFY-09` accepts both names by design. | **OWNER DECISION (Phase 98): A1 — ACCEPT INTENTIONAL NON-CONVERGENCE.** No function was standardized, created, dropped or altered; no trigger was replaced; `FIX3-VERIFY-09` was not narrowed. The intended contract does not require identical trigger-function names across migration paths. **Maintenance condition:** any future change to timestamp-update semantics must be evaluated for BOTH functions and applied consistently wherever both remain in use; equivalence must NOT be assumed after a code change without review and tests. **Evidence scope:** the 0-versus-68 function-reference counts come from the committed production-shaped baseline described in the Phase 97 report. They are NOT a live production inspection and do not prove the current production state. |
| OD-12 | **`content_quality.content_id` has no foreign key.** The column is a soft reference, declared as such in the frozen predecessor and recorded as an owner decision in four places in Fix 3. Phase 96 demonstrated that a cross-tenant `content_id` is accepted and that a scorecard row survives deletion of the content it names. | **OWNER DECISION (Phase 98): B1 — AFFIRM THE EXISTING SOFT-REFERENCE CONTRACT.** No foreign key was added; no executable SQL changed. Consequences, recorded deliberately: there is no FK on this relationship; the database does NOT enforce that the reference belongs to the same tenant; orphan retention is possible; caller-level behaviour remains material; and **`FIX3-FK-13` rejects adding a foreign key** to this relationship — the migration refuses to apply if one is present. **The Phase 97 call-site findings remain REPORTED EVIDENCE, not guarantees:** the route validates via `getContent(id, scopedCompanyId)`, while `lib/post/runPostGeneration.ts` and `lib/thread/runThreadGeneration.ts` rely on their construction paths; that reasoning must not be restated as a stronger guarantee. The writer `qualityService.persistScorecard` performs NO validation of its own and uses the RLS-bypassing service-role client; neither fact may be misrepresented. **Maintenance condition:** any future change to these callers, to the writer, to tenant-isolation or RLS-bypass behaviour, or to the content lifecycle must re-evaluate the soft-reference guarantee and its caller-level enforcement. |

## C. LIMITATIONS — accepted and documented in code

| ID | Limitation |
|---|---|
| L-1 | The harness's uniqueness rule is a WHOLE-STATEMENT final-state model. Real PostgreSQL checks a non-deferrable unique index per tuple as the command walks rows and may reject statements this model accepts; the duplicated fixture state these tests start from could not exist under a real unique index at all. The swap and vacate cases therefore assert only that the two element orderings AGREE, never a verdict. |
| L-2 | The harness models PostgREST's shape, not its semantics: `req.query` and `req.body` carry whatever types a test passed, and a handler that responds asynchronously without returning a promise is not awaited. |
| L-3 | `completedWrites()` means "ran without error", NOT "changed a row". A zero-row UPDATE or DELETE is counted, faithfully to SQL. Grant assertions pair it with stored state wherever the row is the point. |
| L-4 | The verification artifact asserts no behaviour. It does not establish that an INSERT of `lifecycle_status = 'quality_reviewed'` is accepted, does not establish policy SEMANTICS, and does not check GRANTs. |
| L-5 | Audit-preservation parity proves no trigger or rule of the listed kinds exists AT THE MOMENT it runs, over five relations' own oids. It says nothing about DELETE permissions, RLS on the audit table, application code deleting audit rows directly, or cascades from other tables. |
| ~~L-6~~ | **RETIRED in Phase 82.** Through Phase 78 the broad 72-suite run exited 1 with zero test failures — a genuinely NON-PASSING gate whose cause was OD-2, never relabelled and never run with `--forceExit`. Since that fix the gate has been measured GREEN twice: **Phase 79 and Phase 80, 72/72 suites, 2496/2496 tests, exit 0**, with zero process-level anomalies in either run. The historical statement is kept above rather than deleted because the exit-1 era is the reason most of this register exists. |
| L-7 | `scripts/backend-tests-typecheck-baseline.json` is a non-regression baseline, not a clean bill. The surface carries 259 pre-existing diagnostics and `tsc` exits 2 on a clean tree. It must never be described as clean. |

## D. BLOCKED — needs a database

| ID | Blocker |
|---|---|
| B-1 | No part of either SQL file has been executed, or even parsed, by PostgreSQL. Every claim about `FIX3-IDX-03f/g/h/i`, `FIX3-IDX-04` and artifact section 11 is a reading of SQL text. Structural counts are keyword balance, not parsing. |
| B-2 | That the eight `CREATE INDEX` statements actually produce the derived expectations — notably `indoption = 3` for a plain `DESC` column — is unverified against any server version. |
| B-3 | That `ON DELETE SET NULL` behaves as deparsed, and that the lifecycle CHECK accepts `'quality_reviewed'`, remain unverified. |
| B-4 | The schema state of any target database is unknown to this programme, so the applicability of these guards to a real target cannot be assessed here. |

---

## E. Validation evidence ledger

Exit codes are recorded verbatim. "Inspected" means read, not executed.

| Check | Result | Exit | Phase |
|---|---|---|---|
| OD-9 schema-health failure suite + route (`schemaHealthFailureLifecycle`, new) | **15/15 tests** | **0** | 80 |
| Pre-existing suites covering the same module (`authSubsystemBoot` + OD-8 suite) | 20/20 tests | 0 | 80 |
| OD-8 failure-lifecycle suite + both health routes (`authSubsystemBootFailureLifecycle`, new) | **16/16 tests** | **0** | 78 |
| `node scripts/backend-tests-typecheck-baseline.js` after the new test file | baseline 260, actual 259, **net-new 0**, `RESULT: PASS` | **0** | 78 |
| Pre-existing boot suite (`authSubsystemBoot`) — unchanged behaviour | 4/4 tests | 0 | 78 |
| Auth-resolver boot lifecycle (`authResolverBootLifecycle`) | 8/8 tests | 0 | 78 |
| Connector-auth suite **ALONE**, after the boot-module change | 13/13, 0 teardown errors, 0 "not a function" | **0** | 78 |
| Auth + boot set (27 suites — every importer of authResolver, both boot suites) | **27 suites, 1139/1139 tests**, 0 teardown errors | **0** | 78 |
| OD-1 regression suite (`sec91AMethodGaps`) | 14/14 tests | 0 | 77 |
| OD-2 gate: connector-auth suite **ALONE** | 1 suite, 13/13, **zero** teardown errors (was exit 1) | **0** | 77 |
| OD-2 lifecycle suite (`authResolverBootLifecycle`, new) | 8/8 tests | 0 | 77 |
| Focused auth set — every suite importing authResolver, plus both boot suites | **26 suites, 1123/1123 tests**, 0 teardown errors | **0** | 77 |
| `failTable` + Fix 3 suite union | **33 suites, 1152/1152 tests**, 0 teardown errors | **0** | 77 |
| `npm run typecheck` after both production fixes | 3/3 projects clean | **0** | 77 |
| `node scripts/backend-tests-typecheck-baseline.js` | baseline 260, actual 259, **net-new 0**, `RESULT: PASS` | **0** | 77 |
| Ten Phase 74 suites together | 10 suites, 575/575 tests | 0 | 75 |
| Five suites affected by Phase 76 | 5 suites, 322/322 tests | 0 | 76 |
| Call-contract suite after the array-id tests | 60/60 tests (was 58) | 0 | 76 |
| `node scripts/backend-tests-typecheck-baseline.js` (the committed gate) | baseline 260, actual 259, **net-new 0**, resolved 1, `RESULT: PASS` | 0 | 76 |
| DDL-derived expectations re-checked after the new guards | 24/24 spec rows agree (16 migration + 8 artifact), 8/8 indexes covered | — | 76 |
| `npm run check:migrations` | 70 validated, 353 frozen, 0 violations | 0 | 74, 75, 76 |
| `npm run typecheck` | 3/3 projects clean | 0 | 74 |
| Broad 72-suite harness-consumer run | 72/72 suites, 2490/2490 tests, 0 FAIL | **1** | 74 |
| Broad 72-suite gate, rerun after the OD-2 fix | 72/72 suites, **2496/2496 tests**, 0 FAIL, zero process anomalies | **0** | 79 |
| Broad 72-suite gate, rerun after the OD-9 fix | 72/72 suites, **2496/2496 tests**, 0 FAIL, zero process anomalies | **0** | 80 |
| OD-6 mechanical hook adoption — the 68 newly adopted suites | 68/68 suites, **2222/2222 tests**, **0 refusal detections** | **0** | 82 |
| OD-6 INSTRUMENT CHECK — a deliberately swallowed undeclared upsert in one adopted suite | **FAILED as required**, detector message emitted; probe reverted by hash | **1** (intended) | 82 |
| Implicated suite ALONE (`sec91W2BConnectorAuth`) | 1 suite, 13/13 tests, same single teardown error | **1** | 75 |
| Three untouched control suites, each alone | 24/24, 7/7, 7/7 | 0, 0, 0 | 75 |
| `typecheck:backend-tests` | 259 diagnostics, 507 lines | **2** | 74 |
| Committed per-diagnostic set comparison | **net-new 0**, resolved 1 | — | 75 |
| DDL-derived index expectations vs both spec tables | 16/16 migration rows agree; the artifact's 8 agree | — | 75 |

The broad suite's nonzero exit is PROVEN external, not inferred: it reproduces
with the implicated suite alone while three untouched controls exit 0, and the
three implicated files are byte-identical to HEAD. That measurement was taken
BEFORE Phase 77's OD-2 fix and is retained as the historical record of the
failure, not as the current state.

**The broad matrix HAS since been rerun, twice, and passes.** Phase 79 and
Phase 80 each measured 72/72 suites, 2496/2496 tests and process exit **0**,
with zero occurrences of every anomaly class checked (teardown-time import,
`is not a function`, unhandled rejection, worker failure, "did not exit", force
exit, out-of-memory, env/ZodError). The +6 test delta against the old 2490 is
fully accounted for: Phase 76 added 2 array-id tests and Phase 77 added 4 OD-1
tests. No `--forceExit` was used in any run.

---

## F. Hash provenance — what the integrity evidence actually covers

Stated explicitly because "unchanged" is only meaningful where a prior hash
exists to compare against.

| Class | Files | What is evidenced |
|---|---|---|
| Hashed at this phase boundary | all 29 in the change population (30 after this phase) | Full sha256 recorded before and after editing, outside the repo. |
| Changed during this phase | `backend/security/startup/authSubsystemBoot.ts`, `backend/tests/unit/authSubsystemBootFailureLifecycle.test.ts` (new), `docs/security/FIX3_ISSUE_REGISTER.md` | Before/after hashes both recorded; the unchanged head of the boot file (lines 1-59) was diffed byte-for-byte against its pre-edit copy. |
| Historical hashes available | the 14 files in the Phase 74 report, plus everything added to the population in Phases 76-78 | Byte identity across phase boundaries is genuinely provable and has been checked each phase (29/29 identical entering Phase 78). |
| **Pre-phase hashes NEVER recorded** | `backend/services/content/approvalService.ts`, `backend/services/content/collaborationService.ts`, `pages/api/content/[id]/blocks.ts`, `pages/api/content/approval-history.ts` | These four carry changes from phases BEFORE hashing began, so their pre-Phase-74 state was never captured. Their identity across Phases 74-78 IS proven; any claim about their state before that is **not evidenced** and must not be made. Full-population hashing began in Phase 76 precisely to stop this recurring. |

### Migration-hash provenance — Fix 3 (recorded Phase 99)

The table above covers the TypeScript change population of Phases 74-78. The Fix 3 SQL artifacts
are tracked separately here, because the Phase 98 comment-only correction changed the migration's
file hash without changing its executable logic, and a reader comparing against an older report
would otherwise read that as tampering.

| Stage | SHA-256 | What it covers |
|---|---|---|
| Fix 3 migration, Phases 90-97 | `2ab29a6e2f848d2051418ec7d371c99b15463bf83a6d00da6370153711693f4e` | The value recorded by every phase from 90 through 97. **Historical — superseded, not wrong.** |
| Fix 3 migration, Phase 98 onward | `581926201d268d5bde34b6a6b7be4ee118bac3ed8d62ef88756e7030b2d445d5` | **Current.** Differs from the row above only by the Phase 98 comment-only header correction: 4 comment lines removed, 6 inserted, 2,969 → 2,971 lines. |
| Fix 3 migration, non-comment SQL | `2da8139697409d9b8b7d25134fbdecd86a06202a4ca97a8e3a4d611502cc22d6` | **Unchanged across that correction.** Phase 98 reported the executable SQL byte-identical after stripping whole-line comments — 1,564 lines, same hash before and after. The executable migration logic did not change. |
| Verification artifact | `5c62e0155bf1d4d1d911597549d83bb252cf54b66f89ba0774070371da26601b` | **Unchanged.** It carries no hash of the migration, so the correction required no change to it and none was made. |
| Frozen predecessor | `34dffb69d4c500d0ed827ad9114778a1235ad79df3c022643decb3c55711a49d` | Unchanged throughout the programme. |

Any integrity check still written against `2ab29a6e…` must be updated to `58192620…`.
