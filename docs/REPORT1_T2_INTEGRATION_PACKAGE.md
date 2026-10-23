# REPORT 1 — T2 INTEGRATION PACKAGE (PREPARED, NOT EXECUTED)

Refreshed 2026-10-17, revision 3 (Gate A fix). Supersedes revision 2; all unresolved rows retained.

**T2 WAS NOT EXECUTED.** No row below is T2 evidence. Everything here is **local implementation
testing**, which is not the integration gate. **T3, deployment, provider activation and
configuration change were not performed and are not authorized.**

---

## 1. CANDIDATE IDENTITY — changed this revision

| | |
|---|---|
| Base commit | `5604b50bdebd23efd6d040b90f5802954413b656` — candidate HEAD, local `origin/main` and the live remote tip all agree |
| Worktree | `C:\tmp\r1-integ`, detached, **0 staged**, HEAD still equals `origin/main`; branches 179 / tags 114 unchanged |
| **Tracked diff (current)** | **`9bc40eeefa252cd807632fc56e7dc9554735abfd5d418c6897e09f31967fde0d`** — 295 lines, **7 files** |
| Tracked diff (revision 2) | `7753544aad1f586f9b717c6f55c2d7d377d3c5636951bd0368d24a7317622d8b` — 252 lines, 6 files |
| Untracked candidate files | `metaAdLibraryClient.ts` `2ac79b6c29479e67` · `report1MetaAdsAcquisition.test.ts` `b0a19dc600f832d6` · **`report1DurableHistoryHonesty.test.ts` `d607d9adf44d3d71`** (was `7e58caec…`; changed by the TS2416 fix, §11) |
| Durable-history hunks | **`50fcdea60edc7e07…`** — byte-identical to the reviewed source patch and to `r1-hist`'s live diff, three ways. **`r1-hist` intact** |
| Protected | `deploy-current-main` **0 staged / 78 modified / 58 untracked**, unchanged. `C:\virality` on `preserve/creator-canonical-template-pool`, untouched. `.env.local` absent from both scratch worktrees |

### Modified files (7)

| File | Change | Revision |
|---|---|---|
| `historicalPersistence.ts` | `HistoricalStore.durable`; in-memory declares `false`; `isOperational` doc corrected | 1 |
| `supabaseHistoryStore.ts` | declares `durable = true` | 1 |
| `snapshotWriter.ts` | `PersistSnapshotResult.durable`, from the store on both return paths | 1 |
| `canonicalReportBuilderAssembly.ts` | `scan_metadata.persisted = written && durable` | 1 |
| `adsTransparencyObservation.ts` | `AdsPlatform` → `'google' \| 'meta'`; `ADS_PLATFORM_META`; 3 additive access-state mappings | 2 |
| `report1AdsPlatformDimension.test.ts` | guard realigned to two platforms; purpose preserved and strengthened | 2 |
| **`pages/api/company-grounding/[companyId].ts`** | **Gate A route-factory adoption (+21/−7)** | **3** |

---

## 2. LOCAL TEST EVIDENCE — **NOT T2**

Every exit code is jest's own, written to a log. **No run was piped into `tail`.**

### Current candidate (tracked diff `9bc40eee…`)

| # | Run | Scope | Exit | Result | Log |
|---|---|---|---|---|---|
| L8 | **Gate A validator** | `platformGateAValidation` | **0** | **4 passed / 4** — `unwrapped` is now `[]` | `gateA.log` |
| L9 | Company Grounding | 15 suites | **0** | **235 passed / 235**, 1 suite skipped | `grounding.log` |
| L10 | Route's own suites | `companyGroundingApi`, `companyProfileRegistryCoverage` | **0** | **85 passed / 85** | `route_direct.log` |
| L11 | **Tenant-guard / route-auth / route-factory** | 23 suites | **0** | **853 passed / 853** | `authz.log` |
| L12 | Report 1 scoped re-run (pre-TS-fix candidate) | 71 suites | **0** | 71/71; 1,496/1,496; 978.5 s | `r1_full_v2.log` |
| **L13** | **Report 1 scoped, post-TS-fix** | **71 suites** | **0** | **71 passed / 71; 1,496 passed / 1,496; 0 failed, 0 skipped**; 1,085.9 s | `r1_full_v3.log` |
| **L14** | **Backend TypeScript certification** | `npm run typecheck:certification` | **0** | `backend.json` **0/0**, net-new 0 · `backend-tests.json` **259/259**, net-new 0, resolved 0 · **RESULT: PASS**; 12m 47s | `typecheck_cert2.log` |
| **L15** | **TypeScript baseline** | `npm run typecheck:ci` | **0** | **3/3 projects clean**, baseline 0 · **PASS**; 19m 14s | `typecheck_ci.log` |
| **L16** | Lint — repo script, **not a CI gate** | `npx eslint` × 10 changed files | **0** | **no findings**; 2m 02s | `lint.log` |
| **L17** | Durable-history honesty, post-fix | 1 suite | **0** | 9 passed / 9 | `honesty2.log` |

Candidate identity was re-hashed **after** L13 and is unchanged, so L13-L17 validate exactly the
candidate in §1.

Candidate identity was re-hashed **after** L12 and is unchanged — tracked diff `9bc40eee…` and all
three untracked files — so L12 validates exactly the candidate described in §1.

### Previous candidate (tracked diff `7753544a…`) — **historical**

| # | Run | Scope | Exit | Result | Log |
|---|---|---|---|---|---|
| L1 | Report 1 scoped | 71 suites | **0** | 71/71 suites, **1,496 / 1,496** tests, 0 failed, 0 skipped; 1,091 s | `r1_full.log` |
| L2 | Meta acquisition | 1 suite | **0** | 62 / 62 | `meta2.log` |
| L3 | Ads + platform regressions | 12 suites | **0** | 317 / 317 | `ads_reg2.log` |
| L4 | History dependents | 13 suites | **0** | 238 / 238 | `b3_integ.log` |
| L5 | Durable-history RED | 1 suite | — | 9 failed / 9 | `../r1-hist/` |
| L6 | Durable-history GREEN | 1 suite | **0** | 9 passed / 9 | `../r1-hist/green.log` |
| L7 | Stale-domain, verbose | 3 suites | **0** | 59 passed, both negative controls | `../r1-hist/b2.log` |

**L1-L7 validate the PRE-Gate-A candidate and are not presented as validation of the changed
candidate.** They remain valid for the six files they covered — the Gate A change touched a
`pages/api` route that no Report 1 service imports — but the scoped re-run (L12) is what will
validate the current candidate, and until it lands row 1 is **NOT RUN on this candidate**.

**All Meta evidence is mocked-transport.** No Meta endpoint was contacted, no token exists, nothing
reached the network. **Contract validation, not live-provider validation.**

### Whole-repository baseline — historical, attribution only

Exit 1 — 29 failed suites, 107 failed tests / 29,538 over 1,951 suites. **27** fail identically on
unmodified product code → pre-existing. **2** fail only in a scratch worktree lacking `.env.local`,
proven by reverting the patch → environment. **0** attributable to the candidate; **0** were Report 1
suites. **One of the 29 — Gate A — is now fixed (L8)**, so a re-measured baseline should show 28.
T2 must re-establish this on the candidate.

---

## 3. T2 MATRIX — 18 ROWS

Candidate for every row: `5604b50b` + tracked diff `9bc40eee…` + the three new files in §1.

| # | Requirement / acceptance criteria | Owner | Command / evidence | Result (exit) | Log | Classification | Remaining prerequisite |
|---|---|---|---|---|---|---|---|
| 1 | Focused Report 1 suites all pass | Report 1 | `npx jest --testPathPattern='(report1\|r1cCrawl\|…)'` | **71/71 suites, 1,496/1,496 (0)** | `r1_full_v3.log` (L13) | **LOCAL PASS — NOT T2** | re-run under T2 |
| 2 | Cross-workstream regressions: no new failure vs baseline | release eng | `npx jest backend/tests` | not run on candidate | §2 historical | **NOT RUN** | T2 authorization |
| 3 | Auth / authz / tenant isolation intact | release eng | CI *Auth integrity regression lock*; local L11 | **853/853 (0)** locally | `authz.log` | **LOCAL PASS — NOT T2** | CI run under T2 |
| 4 | Typecheck clean against baseline | release eng | `npm run typecheck:certification` **and** `npm run typecheck:ci` — the two commands CI actually runs | **cert PASS (0)**, net-new 0 both projects; **baseline PASS (0)**, 3/3 clean | `typecheck_cert2.log`, `typecheck_ci.log` | **LOCAL PASS — NOT T2** | re-run under T2. ~8 GB — run alone, via the npm script, **never bare `tsc`** (it OOMs: exit 134) |
| 5 | Lint clean | release eng | `npx eslint` over the 10 changed files | **0 findings (0)** | `lint.log` | **LOCAL PASS — NOT T2** | **lint is NOT a CI gate** — no workflow runs eslint; `eslint.config.js` appears in `platform-parity.yml` only as a path trigger |
| 6 | Renderer, HTML+PDF export and view page consistent | release eng | `report1DomainAncestrySimulation` proves HTML↔PDF-input parity | partial | `r1_full.log` | **PARTIAL** | full export check under T2 |
| 7 | Advertising provider contracts incl. Meta | Report 1 | `report1MetaAdsAcquisition`, `report1AdsPlatformDimension` | 62/62, 317/317 (**0**) | `meta2.log`, `ads_reg2.log` | **LOCAL PASS — NOT T2** | mocked transport only |
| 8 | Advertising decision language; unavailable never implies absence | Report 1 | `report1AdvertisingDecision`, `report1AdsIntegration` | in 317/317 (**0**) | `ads_reg2.log` | **LOCAL PASS — NOT T2** | re-run under T2 |
| 9 | B7 market/ICP integrates and renders | Report 1 | `reportMarketIcpRecommendation` | in 238/238 (**0**) | `b3_integ.log` | **LOCAL PASS — NOT T2** | re-run under T2 |
| 10 | Company Profile not mutated outside approved fields | Report 1 | `wp11ReportProfileMutationGuard` | not run on candidate | — | **NOT RUN** | T2 authorization |
| 11 | Competitive baseline genuine or explicit abstention | Report 1 | `report1CompetitiveBaselineIntegrity` and peers | in 1,496/1,496 (**0**) | `r1_full_v2.log` | **LOCAL PASS — NOT T2** | re-run under T2 |
| 12 | Strict-null and evidence-provenance integrity | Report 1 | `report1NullContractTripwire` and peers | in 1,496/1,496 (**0**) | `r1_full_v2.log` | **LOCAL PASS — NOT T2** | re-run under T2 |
| 13 | Crawl-domain scoping and SERP isolation (R1-OPEN-01) | Report 1 | `report1CurrentDomain*`, `report1DomainAncestrySimulation` | 59 passed incl. negative controls (**0**) | `../r1-hist/b2.log` | **LOCAL PASS — NOT T2** | re-run under T2 |
| 14 | Generation assembly and canonical output consistent | release eng | CI *Campaign Generation Contracts*, *Migration replay* | — | — | **NOT RUN** | T2 authorization |
| 15 | Migration/schema compatibility, non-production | release eng | `npm run test:realschema` | — | — | **NOT TESTABLE** here — Docker starts a production worker | CI or non-production host |
| 16 | Build / deployment readiness | release eng | CI *Production build* | — | — | **NOT RUN** | T2 authorization |
| 17 | Security / dependency policy | release eng | repo security gate scripts | — | — | **NOT RUN** | T2 authorization |
| 18 | **Every default-exporting API route is factory-wrapped (Gate A)** | Company Grounding (fix authorized to Report 1 for this task) | `platformGateAValidation` | **4 passed / 4 (0)** | `gateA.log` | **LOCAL PASS — NOT T2** | re-run under T2 |

### Totals — sum to 18

| Classification | Rows | Count |
|---|---|---|
| `LOCAL PASS — NOT T2` | 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 18 | **11** |
| `NOT RUN` | 2, 10, 14, 16, 17 | **5** |
| `PARTIAL` | 6 | **1** |
| `NOT TESTABLE` | 15 | **1** |
| `BLOCKED — OWNER DECISION` | — | **0** |
| **Total** | | **18** |

Rows 1, 11 and 12 were briefly returned to `NOT RUN` when the candidate changed — evidence is not
carried across a candidate change — and are restored to `LOCAL PASS` by L12, which ran against the
current candidate and was confirmed by re-hashing the candidate afterwards. Row 18 moved from
`BLOCKED — OWNER DECISION` to `LOCAL PASS`.

**A passing Gate A, typecheck, lint and scoped suite do not authorize T2.** Five rows have never
run on this candidate, one is partial, and one is not runnable here.

### Blocker count vs matrix rows — they are different registers

An earlier revision said "seven blockers" while §9 listed nine. **The prose was wrong.** The matrix
enumerates **18 checks**; §9 enumerates **what prevents T2**, most of which are not matrix rows at
all (deployment staleness, Meta access, flags, durable history, Railway). They are not merged to
make a number agree. The blocker count is **8** after this revision — the typecheck/lint blocker
closed; see §9.

---

## 4. GATE A — FIXED (Option A), authorized for this task

| | |
|---|---|
| File | `pages/api/company-grounding/[companyId].ts` |
| Change | **+21 / −7**; one import, and the default export recomposed as `createApiRoute(withTenantGuard(handler, …), { route: … })` |
| Option taken | **A — comply.** No skip-list entry, no waiver, no policy change |
| Validator untouched | `platformGateAValidation.test.ts` — **CLEAN** |
| Skip-list untouched | `scripts/.route-factory-adoption-report.json` — **CLEAN** |

### Why this is adoption and not a marker

`createApiRoute(handler, opts)` takes and returns a `NextApiHandler`, so the composition is
**factory(guard(handler))**. The tenant guard remains **inside** and still authorizes before the
handler runs, returning its own 401/403 unchanged. The factory adds only what the other 1,252
adopted routes get: request-execution context seeding, `withApiObservability`, and an
`api.request.error_class` counter — and it **rethrows**, so Next.js error handling stays
byte-identical. `resolveCompanyId` is byte-identical, merely re-indented.

### What was verified, and what was not

**Verified by test:** the adoption gate passes (L8, 4/4); the route's own suites pass (L10, 85/85);
Company Grounding passes (L9, 235/235); and tenant-guard / route-auth / route-factory regressions
pass (L11, **853/853** across 23 suites).

**Not verified, and not claimed:** that the route is *secure*. I reviewed the wrapper composition
and the factory's additive nature, not the route's authorization semantics or its data exposure.
The Gate A ratchet is a coverage convention; passing it is not a security assessment. The route was
already guarded before this change — the change neither added nor removed a protection.

---

## 5. TESTS STILL NEEDED AFTER THE ROUTE CHANGE

| Priority | Test | Why |
|---|---|---|
| ~~1~~ | ~~Report 1 scoped, 71 suites~~ — **DONE.** L12: 71/71, 1,496/1,496, exit 0 | rows 1, 11, 12 now satisfied on this candidate |
| 2 | Whole-repo `npx jest backend/tests` | Confirms the 29→28 baseline and that no suite outside the ones run regressed |
| 3 | Typecheck (`npm run typecheck:ci`, `typecheck:backend-tests`) | **Never run on any revision of this candidate.** The route change adds an import and a generic composition — a typecheck is the proper check for that, and jest here is transpile-only so green tests do not imply types check |
| 4 | Lint | Not run on any revision |
| 5 | Production build | The route is a Next.js page-API module; a build is the real integration check |
| 6 | Full renderer / HTML+PDF export | Row 6 is only partial |
| 7 | `wp11ReportProfileMutationGuard` | Row 10 never run on candidate |
| 8 | Security / dependency gates | Row 17 never run |

Item 3 is the most significant gap: **no typecheck has been run on this candidate at any revision**,
and it is the check most likely to catch a defect in a composition change.

---

## 6. DURABLE HISTORY — four states, all `NOT VERIFIED`

Acceptance criterion unchanged and **not weakened**. The honesty fix remains in the candidate,
byte-identical to the reviewed patch.

| State | Status |
|---|---|
| 1. Provider registered | **NOT VERIFIED** — `historical_store` is a declared slot and `describeProviderReadiness()` computes its state and `loadFailure`, but **nothing exposes it**. Verified read-only that neither `pages/api/analytics/system-state.ts` nor `pages/api/super-admin/ga-analytics-summary.ts` references `historical_store` or imports `providerRegistry` |
| 2. Store selected and operational | **NOT VERIFIED** — needs the `isOperational()` probe at runtime |
| 3. Migration / table confirmed in production | **NOT VERIFIED** — repo defines `report_score_history` in `20260601000000`; application is unknown and confirming it is a production read |
| 4. End-to-end durable write/read | **NOT VERIFIED** — would require a production write |

`SUPABASE_HISTORY_ENABLED` is PRESENT in Production as a Hidden Secret (41 days), names and metadata
only. **No value read, decrypted, printed, copied or logged. Presence is not proof of enablement.**

**Design proposal:** `docs/REPORT1_DURABLE_HISTORY_DIAGNOSTIC_PROPOSAL.md` —
**PROPOSAL ONLY — NOT IMPLEMENTED.** It would address **state 1 only**; states 2-4 need separate
authorizations, and it records why a readiness response can never prove durable persistence.

---

## 7. RAILWAY — **`RAILWAY VERSION — NOT TESTABLE`**

Local metadata only: project `authentic-nature`; worker builds from `Dockerfile.worker` per
`railway.json`. Deployed SHA, timestamp and build provenance **not established**; no linking,
authentication, config change or build was performed, and no SHA was inferred.

**Minimum evidence needed:** a dashboard record for the worker giving the deployed commit SHA and
timestamp, or authorization to link.

---

## 8. META — approved scope preserved

`MATCHED`-only company claims hold **by truthfulness, not special-casing**: `MATCHED` requires
`advertiser.verified`; Meta publishes no identity assertion for commercial advertisers, so an honest
`verified: false` caps every Meta record at `PROBABLE_MATCH` / `eligibleForCompanyClaim: false`, with
the resolver unchanged and the Google path untouched. Coverage refusal happens **before any
request**. Production inactive: the acquisition flag is absent and no Meta client is registered with
the cycle. Access prerequisites remain owner-side —
`docs/REPORT1_META_ACTIVATION_READINESS.md`. **No Meta code changed this revision.**

---

## 9. OUTSTANDING T2 BLOCKERS

| # | Blocker | Owner | Resolvable from existing evidence? |
|---|---|---|---|
| 1 | T2 matrix not executed; 5 rows never run on this candidate | release engineering | **No** — authorization |
| 2 | T3 / deployment not executed | owner | **No** — authorization |
| 3 | Authenticated production validation not established | owner | **No** — authorization |
| 4 | Vercel production 13 days old; `main` carries 27 later Report 1 commits | owner / release | **No** |
| 5 | Meta API access prerequisites | owner | **No** — external provider action |
| 6 | `ADS_TRANSPARENCY_ACQUISITION_ENABLED` absent — activation is a T3 decision | owner | **No** |
| 7 | Durable-history states 1-4 `NOT VERIFIED` (§6) | owner | **No** — diagnostic decision or production read |
| 8 | Railway deployed worker version (§7) | owner | **No** |

**Count: 8.** Two blockers closed this revision — Gate A (previous revision) and the
typecheck/lint gap (this one, §11). None of the remaining 8 is resolvable from existing evidence;
all need owner or release-engineering authorization.

---

## 10. EVIDENCE LOCATIONS

| Artifact | Path |
|---|---|
| Candidate tracked diff | `C:\tmp\r1-integ\candidate.patch` (`9bc40eee…`) |
| Reviewed history patch | `C:\tmp\r1-hist\fix.patch` (`50fcdea6…`) |
| Local logs | `C:\tmp\r1-integ\{r1_full,r1_full_v2,meta2,ads_reg2,b3_integ,gateA,grounding,route_direct,authz}.log`; `C:\tmp\r1-hist\*.log` |
| Phase A baseline | `docs/REPORT1_FINALIZATION_BASELINE.md` (`deploy-current-main`) |
| Meta API brief | `docs/REPORT1_META_ADS_INTEGRATION_BRIEF.md` (`deploy-current-main`) |
| Meta activation checklist | `docs/REPORT1_META_ACTIVATION_READINESS.md` |
| Durable-history diagnostic proposal | `docs/REPORT1_DURABLE_HISTORY_DIAGNOSTIC_PROPOSAL.md` — **PROPOSAL ONLY** |
| This package | `docs/REPORT1_T2_INTEGRATION_PACKAGE.md` |

---

## 11. TYPECHECK FINDING — a real defect the test suite could not see

The certification gate caught a genuine type error that **every jest run had passed over**, because
ts-jest here is transpile-only: it strips types and never checks them.

| Run | Command | Exit | Outcome |
|---|---|---|---|
| Cert 1 | `npm run typecheck:certification` | **1** | `backend.json` 0/0 PASS; `backend-tests.json` **260/259**, **net-new 1, attributed** |
| *(invalid)* | `npx tsc -p tsconfig.backend-tests.json` | **134** | **Crashed — V8 heap OOM.** Produced an empty log that must not be read as a pass. Bare `tsc` is the documented hazard; use the npm script |
| Cert 2 | `npm run typecheck:certification` | **0** | `backend-tests.json` **259/259**, net-new 0, **resolved 0** — exactly baseline |

**The error:**

```
[ATTRIBUTED] backend/tests/unit/report1DurableHistoryHonesty.test.ts
  TS2416: Property 'durable' in type 'FakeDurableStore' is not assignable
          to the same property in base type 'InMemoryHistoryStore'.
  +1 (baseline 0 -> now 1) · fingerprint never seen before
```

**Cause.** `InMemoryHistoryStore` declares `readonly durable = false`, which TypeScript infers as
the **literal type `false`**, so a subclass cannot widen it to `true`.

**Fix — test-only.** The subclass was replaced with composition:

```ts
function fakeDurableStore(): HistoricalStore {
  return Object.assign(new InMemoryHistoryStore(), { durable: true as const });
}
```

Two reasons this, rather than loosening the product type. The literal `false` is **correct** — an
in-memory store is never durable, so narrowing is a feature. And a durable fake was never "an
in-memory store that happens to be durable"; subclassing was the wrong relationship. The
replacement reuses the idiom already in that file for the non-operational store.

**Not used:** `any`, `@ts-ignore`, `@ts-nocheck`, file exclusion, `--accept-new-debt`, or any
re-baselining. The baseline notes name each of those as out of contract, and re-baselining is
explicitly a governance act. `resolved 0` in Cert 2 confirms nothing was traded away.

**Evidence invalidated and re-established:** only `report1DurableHistoryHonesty.test.ts` changed
(`7e58caec…` → `d607d9ad…`), so the tracked diff is **unchanged** and Gate A, route, tenant-guard
and Meta evidence all stand. The Report 1 scoped run was re-executed as **L13** because that scope
includes the changed file.

---

**Report 1 is not complete.**

---

**T2 PREPARED — BLOCKERS REQUIRE OWNER DISPOSITION**
