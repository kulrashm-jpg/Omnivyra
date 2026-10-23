# REPORT 1 — RELEASE-OWNER DECISION PACKAGE

Prepared 2026-10-17. **No code was written and no release gate was executed for this package.**

**T2, T3 and deployment remain unauthorized. Report 1 is not complete.**

---

## 1. FROZEN EVIDENCE RECORD

### Candidate identity

| | |
|---|---|
| Base commit | `5604b50bdebd23efd6d040b90f5802954413b656` — candidate HEAD and `origin/main` agree |
| Worktree | `C:\tmp\r1-integ`, detached, **0 staged, no commit**; branches 179 / tags 114 unchanged |
| Tracked diff | `9bc40eeefa252cd807632fc56e7dc9554735abfd5d418c6897e09f31967fde0d` — 295 lines, 7 files |

**Untracked candidate files — the diff alone is not the candidate:**

| File | sha256 |
|---|---|
| `backend/services/ads/metaAdLibraryClient.ts` | `2ac79b6c29479e67f62b151217796c0920c5ff14820b624066eb38be9a60cc1d` |
| `backend/tests/unit/report1DurableHistoryHonesty.test.ts` | `d607d9adf44d3d71b5c25c3b05c0bc128edf28e626a6e91f9c01da7b7a2845f3` |
| `backend/tests/unit/report1MetaAdsAcquisition.test.ts` | `b0a19dc600f832d65930de02ac3bb69c5e67b758c76aa6b948dc6b750ce3984a` |

### Authoritative evidence for THIS candidate

| Check | Command | Exit | Result | Log |
|---|---|---|---|---|
| **Report 1 scoped (L13)** | `jest --testPathPattern='(report1\|r1cCrawl\|…)'` | **0** | **71/71 suites · 1,496/1,496 tests · 0 failed, 0 skipped** · 18m 06s | `r1_full_v3.log` |
| Backend TS certification | `npm run typecheck:certification` | **0** | `backend.json` 0/0 · `backend-tests.json` **259/259** · net-new **0** · resolved 0 | `typecheck_cert2.log` |
| TypeScript baseline | `npm run typecheck:ci` | **0** | **3/3 projects clean**, baseline 0 | `typecheck_ci.log` |
| Lint (repo script, **not** a CI gate) | `npx eslint` × 10 changed files | **0** | no findings | `lint.log` |
| Gate A validator | `jest platformGateAValidation` | **0** | 4/4 | `gateA.log` |
| Route's own suites | `jest companyGroundingApi, companyProfileRegistryCoverage` | **0** | 85/85 | `route_direct.log` |
| Company Grounding | 15 suites | **0** | 235/235, 1 skipped | `grounding.log` |
| Tenant-guard / route-auth / route-factory | 23 suites | **0** | **853/853** | `authz.log` |
| Meta acquisition | 1 suite | **0** | 62/62 | `meta2.log` |
| Ads + platform regressions | 12 suites | **0** | 317/317 | `ads_reg2.log` |
| History dependents | 13 suites | **0** | 238/238 | `b3_integ.log` |
| Durable-history honesty, post-fix | 1 suite | **0** | 9/9 | `honesty2.log` |

**L13 is the authoritative scoped run for this candidate.** Candidate hashes were recomputed after
it and are unchanged.

### Stale evidence, explicitly retired

| Evidence | Why stale |
|---|---|
| **L12** (`r1_full_v2.log`, 71/71, 1,496/1,496) | Superseded by L13. The TS2416 fix changed `report1DurableHistoryHonesty.test.ts`, which is inside the Report 1 scope |
| **Certification run 1** (exit 1, 260/259, net-new 1) | Superseded by run 2 (exit 0). Retained as the record of the defect and its attribution |
| **`npx tsc` targeted run** (exit 134) | **Invalid, not stale** — a V8 heap OOM crash. Its empty log is not evidence of anything. Bare `tsc` is a documented hazard on this codebase |
| Whole-repo baseline (29 failed suites) | Prior pass, pre-Gate-A. Gate A was one of the 29, so a re-measurement should now show 28. T2 must re-establish it |

**Not stale, and deliberately not re-run:** Gate A, route, Company Grounding, tenant-guard, Meta and
ads evidence. The only file that changed was a test inside the Report 1 scope; every file those
checks cover is byte-identical.

### Supporting documents

| Document | Location | Lines |
|---|---|---|
| T2 integration package | `r1-integ/docs/REPORT1_T2_INTEGRATION_PACKAGE.md` | 325 |
| Durable-history diagnostic proposal | `r1-integ/docs/REPORT1_DURABLE_HISTORY_DIAGNOSTIC_PROPOSAL.md` | 168 |
| Meta activation readiness | `r1-integ/docs/REPORT1_META_ACTIVATION_READINESS.md` | 81 |
| Meta API contract brief | `deploy-current-main/docs/REPORT1_META_ADS_INTEGRATION_BRIEF.md` | 257 |
| Phase A baseline | `deploy-current-main/docs/REPORT1_FINALIZATION_BASELINE.md` | 118 |

---

## 2. DURABLE-HISTORY DECISION

**The design proposal EXISTS** — `docs/REPORT1_DURABLE_HISTORY_DIAGNOSTIC_PROPOSAL.md`, 168 lines,
sha256 `b771e987a2598fc8…`, marked **PROPOSAL ONLY — NOT IMPLEMENTED**. It was not implemented, and
nothing in it has been built.

### Summary

**Access controls.** One `GET`, no parameters, proposed `/api/super-admin/provider-readiness`,
wrapped in `createApiRoute` (the convention 1,252 routes follow) with an in-handler **platform
super-admin** guard before any work — matching the existing pattern in
`pages/api/super-admin/analytics-health.ts`, which uses `requireSuperAdminGaAccess`. Non-GET → 405
before authorization work. The payload is **process-level, not tenant-scoped**, which is exactly why
it must be unreachable through tenant membership: a tenant-visible answer would leak deployment
posture to customers.

**Minimum output.** The existing `ProviderSlotReadiness` type already carries what is needed:
`slot`, `module`, `capability`, `availability` (`CONFIGURED` / `ADAPTER_LOAD_FAILED` / `DISABLED` / …),
`prerequisite`, `detail`, `loadFailure`.

**Failure-state handling, and the one real risk.** Most leak prevention is already designed in:
`prerequisite` is contractually "environment-variable NAMES only. Never a value, never a fragment of
one", and `describeProviderReadiness()` performs no provider call and no network access. **The
exception is `loadFailure.message`**, which originates from a thrown adapter-load error and could
embed a connection string — so it must be **classified into a bounded label set, never echoed**,
exactly as `classifyError` already does for the route-factory error counter.

**Tests.** Unauthenticated → 401; tenant user and tenant admin → 403; super-admin → 200; non-GET →
405; `historical_store` present with its declared capability; state mapping for all three
availabilities; a **non-vacuity** test proving a seeded failure changes the output; a read-only
assertion (no provider call, no network); and the most important one — a `loadFailure.message`
seeded with a connection-string-like value must **not** appear in the response.

### What it would and would not establish

| State | Addressed? |
|---|---|
| 1. Provider registered | **YES** — and it distinguishes `DISABLED` (flag unsatisfied) from `ADAPTER_LOAD_FAILED` (flag satisfied, admin client did not resolve — the case that silently retains the volatile store today) |
| 2. Store selected and operational | **NO** — needs the `isOperational()` probe, which is a database read |
| 3. Migration / table confirmed | **NO** — a production catalog read |
| 4. End-to-end durable write/read | **NO, and must not be attempted** — requires a production write |

**All four states remain `NOT VERIFIED`.** A `CONFIGURED` answer is per-process and says nothing
about the table existing, the probe succeeding, a write landing, or another serverless instance.

**The proposal's own recommendation is not to build it first.** A non-production end-to-end test
against a disposable database with the flag on would prove states 2-4 for the code path at far lower
risk; and doing nothing is defensible, because the honesty fix already prevents the false claim. The
diagnostic improves **operability**, not correctness.

---

## 3. EVIDENCE CHECKLIST — 8 REMAINING BLOCKERS

Each is distinct. **Resolving one authorizes nothing else.**

### B1 — T2 execution

| | |
|---|---|
| Evidence required | The 18-row matrix run on this exact candidate, every row classified, with logs retained. 5 rows have never run on it: cross-workstream regressions, Company Profile mutation guard, generation/canonical output, production build, security/dependency policy |
| Owner | Release engineering |
| Next step | **Authorized action** (run the gate) |
| Proves | That the candidate passes the integration gate |
| Does **not** prove | That it is deployable, that production is healthy, or that any customer-visible behaviour is correct |
| Authorization | **T2 execution authorization** |

### B2 — T3 and deployment

| | |
|---|---|
| Evidence required | A `REPORT-1-T3-RELEASE-GATE` artifact naming the exact T2-verified SHA, required plane versions, build provenance, config prerequisites, health checks, smoke plan, rollback target, approvals and stop conditions |
| Owner | Release engineering, then owner approval |
| Next step | **Decision**, then an authorized production action |
| Proves | That a specific verified commit was deployed under a recorded procedure |
| Does **not** prove | That the deployed code behaves correctly for a customer — that is B3 |
| Authorization | **T3 authorization**, separate from T2. T2 passing does not authorize deployment |

### B3 — Authenticated production Report 1 validation

| | |
|---|---|
| Evidence required | An authorized run on a nominated tenant: report generates; HTML and PDF accessible and consistent; website evidence belongs to the **current** domain; SERP keywords not seeded by stale pages; unavailable evidence not presented as fact; advertising claims respect platform/region/access limits; competitive claims evidenced or abstained; B7 renders; Company Profile unmutated; tenant isolation holds. Recorded with a redacted report id, SHA and timestamp |
| Owner | Owner |
| Next step | **Authorized production action** |
| Proves | Customer-visible correctness on the deployed build |
| Does **not** prove | Anything about undeployed commits; and a single tenant is one sample, not a population |
| Authorization | **Explicit live-run authorization**, plus a nominated tenant and confirmed provider quota |

### B4 — Current Vercel deployed SHA and freshness · **PARTIALLY CONFIRMED**

**Confirmed by read-only evidence**, `vercel inspect`, observed **2026-10-17T08:12:50Z**:

| Field | Value |
|---|---|
| Project / scope | `omnivyra` / `rawats-projects-5fb9f1f3` |
| Deployment id | `dpl_HTqPDCiaeTjspBjHu9c6CcsBHobP` |
| Target / status | production / **● Ready** |
| Created | **Sun 2026-10-04 13:55:45 +0530** — **13 days old** |
| Alias | `https://omnivyra-rawats-projects-5fb9f1f3.vercel.app` |
| Build provenance | Next.js `buildId: build-TfctsWXpff2fKS` |
| **Commit SHA** | **NOT AVAILABLE** |

**Why the SHA is unavailable, established rather than assumed:** a targeted grep of the full
`vercel inspect` output for `commit|sha|branch|repo|git` returns **nothing**. The deployment carries
no Git metadata at all, which is consistent with the manual (non-Git-integration) deploy procedure.
The `buildId` is a provenance handle, **not** a commit.

I deliberately did **not** treat a prior internal note as evidence: the only local document naming
an Oct-4 commit is one I wrote myself in an earlier phase, so citing it would be circular.

| | |
|---|---|
| Remaining evidence required | The commit that produced `dpl_HTqPDCia…`, from the owner's deployment record |
| Owner | Owner / release engineering |
| Next step | **Read-only evidence collection** (owner-side record) |
| Proves | Which commit the web plane runs, and the rollback target for B2 |
| Does **not** prove | Deployment health, nor that redeploying is safe |
| Authorization | None for the read. Redeploying is B2 |

**Established regardless of the SHA:** the web plane's deployment **predates `5604b50b` by 7 days**,
so it cannot be running the candidate's base — see the plane-skew finding under B8.

### B5 — Meta access prerequisites · **PARTIALLY CONFIRMED from official sources**

Investigated read-only against Meta's own documentation. **No Meta endpoint was contacted.**

**Confirmed from official sources:**

| Item | Finding |
|---|---|
| **Geographic coverage** | **Any ad type** — including ordinary commercial — only where it delivered to the **UK or EU**, and only for **the past year**. Political / social-issue ads: **worldwide, ~7 years**. This is stated on Meta's Ad Library API page and corroborated by the `ads_archive` reference ("Ads that reached no EU location appear only if they concern social issues, elections, or politics") and the transparency research-tools page |
| Developer setup | A Facebook account, a Meta for Developers account, and agreement to Meta's Platform Policy |
| Identity confirmation | Listed as a setup step but **tied to *running* political / social-issue ads** at `facebook.com/ID`, taking a few days |
| Research Tools route | **A separate path**, not a standard developer app: an application via the Research Tools Manager, with eligibility reviewed. Not a substitute for `ads_archive` |
| App review | The Permissions Reference covers app review for Ads Insights `ads_read`, **not** Ad Library. Business Verification is stated as required "for all apps making requests for Advanced Access" — **not confirmed to apply to `ads_archive`** |
| **Usage terms — newly found** | Ad snapshot content is **for analysis**; you **cannot currently download a batch of archived ads**, though creative for an *individual* ad may be downloaded, for analysis |

**Unresolved without approved external access:**

1. **Whether identity confirmation is required merely to READ non-political UK/EU ads.** Officially
   unstated. This is the single most consequential unknown.
2. Whether Business Verification applies to `ads_archive`.
3. Whether app review is required at all for this endpoint.
4. Token type, lifetime and rotation. Third-party guides disagree (≈1 h vs ≈60 days) and were
   **not** relied upon.
5. Approval turnaround (guides say 1-3 days vs 1-2 weeks; unverified).
6. **Whether paging `ads_archive` is "analysis" or a prohibited "batch download" under the usage
   terms.** The implementation queries the API and keeps field values rather than downloading
   snapshot media, which reads as analysis — but this is a **terms question for the owner**, not an
   engineering one.

Meta's most detailed access page is roughly two to seven years old depending on the surface, so
every item above should be re-confirmed in the App Dashboard at the time of application.

| | |
|---|---|
| Owner | Owner (external provider action) |
| Next step | **Read-only evidence collection** outside this repository — walk the flow and record what is actually demanded |
| Proves | Whether live Meta acquisition is obtainable, and on what terms |
| Does **not** prove | That acquisition should be enabled (B6); and it **cannot** change the UK/EU coverage boundary, which is a property of the archive rather than of access |
| Authorization | None to investigate. A token must be placed in the **worker** environment only — never a prompt, log, repo file or this document |

**Unchanged by these findings:** the strict `MATCHED`-only claim rule and the coverage wording in
the implementation. The UK/EU finding **confirms** the client's existing coverage list (EU 27 + GB).

### B6 — Production acquisition-flag decision

| | |
|---|---|
| Evidence required | A decision on `ADS_TRANSPARENCY_ACQUISITION_ENABLED`, with the safeguards in `REPORT1_META_ACTIVATION_READINESS.md` §B satisfied. Two remain open: **B8 duplicate handling against live data** and **B9 a Meta-specific access-state breakdown in scheduler observability** |
| Established | The flag is **ABSENT** from Vercel Production (read-only `vercel env ls`); the code states enabling it is "a T3 decision, not an implementation one" |
| Owner | Owner |
| Next step | **Decision**, then an authorized production configuration change |
| Proves | That acquisition may run in production |
| Does **not** prove | That Meta evidence will appear for a given company — the EU/UK coverage boundary still applies; nor does it grant a company-specific claim, which Meta can never reach |
| Authorization | **T3 production-configuration authorization.** Registering a Meta client with the acquisition cycle is additionally a **code change** subject to T2 |

### B7 — Durable-history operational verification

| | |
|---|---|
| Evidence required | Per state: (1) provider registered — the readiness slot read at runtime; (2) store operational — the `isOperational()` probe; (3) migration applied — a ledger/catalog read for `report_score_history` (`20260601000000`); (4) end-to-end — a write then read |
| Established | `SUPABASE_HISTORY_ENABLED` is **PRESENT** in Production as a Hidden Secret (41 days). **No value read, decrypted or printed. Presence is not proof of enablement**, and the registry deliberately retains the volatile store if the admin client fails — so even a correct value would not establish state 1 |
| Owner | Owner |
| Next step | **Decision first** — build the states-1-only diagnostic (§2), or run the non-production end-to-end test now planned in `REPORT1_DURABLE_HISTORY_NONPROD_TEST_PLAN.md`, or accept the current position. Then whichever authorized action follows |
| Proves | Depends on the option: the diagnostic proves state 1 only; the non-production test proves states 1-4 for the **code path**, not for production |
| Does **not** prove | A readiness response can never prove durable persistence (§2) |
| Authorization | **Code-change authorization** for the diagnostic; or the three decisions in the test plan §7; or a production read. **None is granted today** |

**Non-production test plan status: PLAN ONLY, and NOT safely executable as it stands.** A suitable
Postgres *is* already running (`cert-supabase`, WRITER-CERT-002, up 46 h) and `pg` is available, and
the real-schema harness supports a supplied `W6_DB_URL` with no container management — but three
things block execution: the running stack belongs to **another workstream**; whether
`report_score_history` exists there is **unknown** and creating it would mean applying a migration;
and adding the test file **changes the candidate, invalidating L13**. See the plan's §1 and §7.

### B8 — Railway deployed worker SHA and timestamp · **RESOLVED — CONFIRMED**

Obtained read-only **without linking**, by passing the project and environment explicitly:
`railway deployment list -p authentic-nature -e production --json`. Observed
**2026-10-17T08:14:12Z**.

| Field | Value — platform-attested |
|---|---|
| Project / environment | `authentic-nature` / `production` |
| Deployment id | `e940bed5-8760-4584-9487-ea4a76bcb454` |
| Status | **SUCCESS** (all older deployments `REMOVED`) |
| Created | **2026-10-11T00:47:25.009Z** |
| **Commit SHA** | **`5604b50bdebd23efd6d040b90f5802954413b656`** |
| Branch / repo | `main` / `kulrashm-jpg/Omnivyra` |
| Commit message | "Merge pull request #293 … worker-shutdown-drain" |
| Image digest | `sha256:7da8415b1f9c666532e24acd855f655612b0c99f96b6b27f219e9ea26dd4da37` |
| Build | DOCKERFILE · `Dockerfile.worker` · 1 replica · `ON_FAILURE` ×5 · draining 30 s · region `sfo` |

**`RAILWAY VERSION — NOT TESTABLE` is withdrawn.** The SHA was read from the platform's own
deployment metadata, not inferred from `railway.json`, the Dockerfile or the candidate.

### The plane-skew finding this exposes

| Plane | Runs | Dated |
|---|---|---|
| **Railway worker** | **`5604b50b`** — the candidate's base commit, i.e. current `main` | 2026-10-11 |
| **Vercel web** | `dpl_HTqPDCia…`, SHA unavailable but **necessarily not `5604b50b`** (it predates it by 7 days) | 2026-10-04 |

**Production is running a split.** The worker already carries all 27 Report 1 commits that the web
plane lacks. This is a cross-plane version skew in production **today**, independent of this
candidate, and it materially affects B2: a deployment plan must state the intended end state for
both planes rather than only advancing the web plane.

| | |
|---|---|
| Remaining evidence required | None for the worker SHA |
| Next step | **Owner decision** — whether the existing skew is acceptable, and what the target end state is |
| Proves | Which worker build is live |
| Does **not** prove | That the worker is healthy, nor that the two planes are compatible in this skewed state |
| Authorization | None was needed for the read; no link, authentication change or local config change was made |

---

## 4. RECOMMENDED ORDER

### Independent — resolvable now, no candidate or deployment needed

These four need no verified candidate and do not block each other. Doing them first means the
deployment decision is taken with complete information.

| Order | Blocker | Status after this pass | Why first |
|---|---|---|---|
| 1 | **B8** Railway worker SHA | **DONE — `5604b50b`, confirmed** | Read-only, no linking. It revealed the plane skew below |
| 2 | **B4** Vercel deployed SHA | **PARTIAL** — deployment fully identified; **SHA not exposed by the platform** | Needs one owner-side record. B2's rollback target depends on it |
| 3 | **B5** Meta access | **PARTIAL** — coverage and setup confirmed officially; 6 questions open | External and slow. Start now so it never becomes the critical path |
| 4 | **B7** durable-history **decision** | **Plan ready, 3 decisions needed** | It determines whether a code change enters the candidate, which must happen **before** T2, not after |

### The plane skew now changes the order

B8 confirmed the **worker runs `5604b50b`** while the **web plane runs an Oct-4 deployment**. That
skew exists in production today and is not created by this candidate — but it means **B2 can no
longer be framed as "deploy the web plane"**. The deployment plan must state the intended end state
for *both* planes and whether the current skew is acceptable in the interim. That is a new owner
decision, and it sits ahead of B2.

**B7 is the one with a sequencing trap:** if you choose to build the diagnostic, it is a code change
and the candidate changes — which invalidates L13 and every check above it, requiring a full local
re-validation before T2. Deciding it *before* T2 avoids re-running the gate twice.

### Candidate-dependent

| Order | Blocker | Depends on |
|---|---|---|
| 5 | **B1** T2 execution | A frozen candidate. If B7 adds code, re-validate locally first |
| 6 | **B2** T3 and deployment | B1 passing, **plus a separate authorization**. Also needs B4 for the rollback target |
| 7 | **B6** acquisition-flag decision | B2 deployed, and its own code change (client registration) back through T2 |
| 8 | **B3** production validation | B2 deployed and healthy |
| 9 | **B7** durable-history *verification* | Whichever option was chosen in step 3 |

### Unresolved release-policy and acceptance concerns

1. **Local checks passing is not a T2 recommendation, and I am not making one.** Five matrix rows
   have never run on this candidate, one is partial, and one is not runnable here. The strongest
   true statement is: *the candidate passes every check that can be run locally.*
2. **Lint is not a CI gate.** No workflow runs eslint; `eslint.config.js` appears in
   `platform-parity.yml` only as a path trigger. Whether release policy *requires* lint is an open
   policy question, not something the repository answers.
3. **Row 15 is `NOT TESTABLE` on this machine** — `npm run test:realschema` needs Docker, and Docker
   here starts a production worker. T2 must run it on CI or a non-production host, and it should not
   be waived silently.
4. **The whole-repo baseline needs re-measuring.** It was 29 failed suites pre-Gate-A; Gate A was one
   of them. T2's cross-workstream row should re-establish the number rather than inherit it.
5. **A single-tenant production validation is one sample.** B3 proves correctness for the tenant
   run, not for the population. If that matters, the acceptance criterion should say how many
   tenants and which.
6. **Meta's coverage boundary is permanent.** Even fully authorized and enabled, Meta yields evidence
   only for EU/UK-delivering advertisers and political advertisers, and can **never** support a
   company-specific claim. If the release note implies broader Meta coverage, that is a wording
   defect, not an implementation gap.

---

**LOCAL VALIDATION PASS — RELEASE DECISIONS STILL REQUIRED**
