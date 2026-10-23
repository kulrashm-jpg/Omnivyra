# REPORT 1 — FINALIZATION BASELINE (PHASE A)

**Phase A is read-only.** No code, test, configuration, migration or production state was changed.
This document is uncommitted and unstaged.

---

## A1. Authoritative state — verified, not assumed

| Fact | Value | How verified |
|---|---|---|
| Worktree | `C:\tmp\deploy-current-main` | `pwd` |
| Git dir | `C:/virality/.git/worktrees/deploy-current-main` | `.git` pointer file; the primary working tree was **not** touched |
| Remote | `https://github.com/kulrashm-jpg/Omnivyra.git` | `git remote -v` |
| HEAD | `5604b50bdebd23efd6d040b90f5802954413b656`, **detached** | `git rev-parse HEAD` |
| Local `origin/main` | `5604b50b` — equals HEAD | `git rev-parse origin/main` |
| **True remote `main` tip** | **`5604b50b`**, 2026-10-11T00:47:23Z, "Merge pull request #293 … worker-shutdown-drain" | **`gh api repos/:owner/:repo/commits/main`** — live read, no fetch, no ref mutation |
| Local `main` branch ref | `fef34178` — **471 commits behind** `origin/main` | `git rev-list --left-right --count main...origin/main` → `0 471`. Stale; **not** the baseline |
| `FETCH_HEAD` age | 2026-10-11 06:35 | The local remote-tracking ref was 5 days old; the live API read above confirms it is nevertheless **correct** |

**`5604b50b` remains the correct baseline.** No newer Report 1 commits exist on `main`.

### Working tree — protected, unchanged

`0 staged / 78 modified / 56 untracked` — identical to the figures in the prior audit.

Ownership established by content, not filename: of the 78 modified files, **77 are auth / `sec91` /
route-authorization tests** plus `pages/api/content/[id]/blocks.ts`,
`pages/api/track/angle-industry-matrix.ts` and `scripts/ci/real-schema-ci.sh`. The single filename
that pattern-matches Report 1 vocabulary, `backend/tests/unit/tenantGuardCanonicalOwnership.test.ts`,
matched only on the word "canonical" and is a tenant-guard test.

**No Report 1 source or Report 1 test file is modified.** Verified per file with `git diff --quiet`
for `reportDomainScope.ts`, `reportCrawlEvidenceService.ts` and `publicDomainAuditService.ts`.
Report 1 code on disk is therefore byte-identical to `main @ 5604b50b`, and **an isolated worktree
is not required for Phase A or Phase B**: the read and the test run both target unmodified Report 1
code. An isolated worktree will be created before any Phase C/E code change.

### In-flight work

No open Report 1 pull request. The four open PRs are `#291` governance, `#290` typecheck WP-1,
`#277` and `#276` Prospect Intelligence — all out of scope and none touching Report 1.

### Release-plane state

| Plane | State | Evidence |
|---|---|---|
| **Vercel production** | Newest production deployment created **2026-10-04 13:55 IST — 12 days old**; `● Ready` | `vercel ls --prod`, `vercel inspect` (read-only). No commit metadata is attached, consistent with the manual-deploy procedure |
| **Railway** | **NOT ESTABLISHED** | `railway status` → "No linked project found" in this worktree. Linking was not performed |
| Deployed ≠ main | **CONFIRMED** | Vercel production predates `main @ 5604b50b` (2026-10-11) by a week. `a8cd5c5d..5604b50b` = 30 commits, **27 of them `report1`** |

### CI evidence that does exist

| Scope | Result | Evidence |
|---|---|---|
| `main @ 5604b50b` push | **9/9 workflows success** | Backend TypeScript Certification · TypeScript Baseline · Campaign Generation Contracts · Governance Verification · PI Verification · Platform Parity · Stability Contracts · Strategic Recommendation Intelligence · Thread Runtime Observability |
| Nightly on `5604b50b` | success ×6, through 2026-10-16 | Governance Nightly Verification |
| PR #292 (last Report 1 PR) | **12/12 checks pass** | incl. Production build, Migration replay + canonical invariants, Auth integrity regression lock, Non-regression TypeScript baseline |
| PR #287 | "Report 1 — pre-T3 integration release", candidate `288651c0`, certification table, V1–V4 local PASS | PR body. Explicitly excludes WP-14 real-tenant validation as "a separate authorization" |

**This is not a T2 matrix.** None of these runs covers the scoped Report 1 jest suites, lint,
renderer/HTML/PDF export checks, advertising provider contracts, B7 / Profile / competitive
integration, or security/dependency policy checks. CI green is also known not to imply suite-level
passes, because CI is not a whole-repo jest job.

---

## A2. The unfinished test run — recovered

| Item | Finding |
|---|---|
| Command | `npx jest backend/tests/unit --runInBand --forceExit --silent --testPathPattern='(report1\|r1c\|reportCrawl\|publicDomainAudit\|snapshotReport\|contentAuthority\|competitorIntelligence)'` |
| Commit | `5604b50b` (worktree Report 1 code unmodified) |
| Jest version | **29.7.0** — `--testPathPattern` is valid on this version. The rename to `--testPathPatterns` is Jest 30, so **no option correction is required** and the scope was not silently narrowed |
| Process state | **STILL RUNNING.** PID 17552, started 21:32:44, ~131 s CPU and 260 MB RSS at 20.4 min elapsed, rising — progressing, not hung |
| Output so far | **0 bytes.** `--silent` plus a non-TTY stderr means jest emits its summary only at completion |
| Exit code | **Not yet available** |
| Action taken | **Observed, not replaced.** No competing jest process was started |

**Status: `DEFERRED` — in progress.** No outcome is inferred from the absence of output.

---

## A3. Blocker register

| # | Blocker | Evidence (at `5604b50b`) | Open? | Smallest next action | Owner | Authorization | Depends on | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|
| **1** | Scoped Report 1 test result not established | Run in progress, 0 bytes, no exit code (A2) | **OPEN** | Let the run finish; capture exit code, counts, duration, log | Engineering | none | — | Exit code 0 with counts recorded against `5604b50b` |
| **2** | T2 cross-workstream integration gate not evidenced | No T2 artifact for `5604b50b`, tracked or untracked. The only repo `T1–T5` are Report 2 boundary threats in `REPORT1_CLOSURE_EXECUTION_GAP_AUDIT.md:518-524` — **a different register** | **OPEN** | Execute and record the 17-row T2 matrix against `5604b50b` | Release engineering | T2 execution | #1 | Durable artifact, every row classified, mandatory rows PASS |
| **3** | T3 release gate not evidenced | No T3 artifact for `5604b50b` | **OPEN** | Produce `REPORT-1-T3-RELEASE-GATE` after T2 | Release engineering | T3 | #2 | Gate names the exact T2-verified SHA and all prerequisites |
| **4** | Production health/version and customer-visible validation not established | Vercel production is 12 days old; Railway unlinked; no authenticated Report 1 run recorded | **OPEN** | Deploy the T2-verified candidate, then run the authorized validation | Owner | Deployment + live-run | #2, #3 | Versions match the candidate on every plane; validation recorded |
| **5** | Meta advertising acquisition not implemented | `adsTransparencyObservation.ts:37` `export type AdsPlatform = 'google';` line 39 "**The only platform implemented**"; `KNOWN_ADS_PLATFORMS = [ADS_PLATFORM_GOOGLE]`; no Meta/Facebook client | **OPEN** | Owner decides Option A (implement) or Option B (formally re-scope) | Product/company owner | Owner decision | — | Either a tested Meta client, or a written re-scope stating the supported boundary |
| **6** | Advertising acquisition disabled | `adsAcquisitionScheduler.ts:11-12` — gated on `ADS_TRANSPARENCY_ACQUISITION_ENABLED`, "absent from every environment"; `:56` reads it; disabled ⇒ "reports `enabled: 0`, and does nothing". Code itself calls enabling it "**a T3 decision**" | **OPEN** | Document activation plan with safeguards; do not enable | Owner / release | T3 production-config | #3 | Authorized activation plan with rollback, or explicit deferral |
| **7** | Durable history unverified | `historicalPersistence.ts:279` `activeStore = new InMemoryHistoryStore()`; gate `SUPABASE_HISTORY_ENABLED` at `providerRegistry.ts:190` | **OPEN** | Establish whether durable history is mandatory for Report 1; verify the flag without exposing values | Owner | Config read / change | — | Proven operational, or absence explicitly accepted in scope |
| **8** | Railway deployed version unknown | `railway status` → not linked | **OPEN (new)** | Owner supplies the deployed worker version, or authorizes linking | Owner | read access | — | Worker version recorded and compared to the candidate |

### Historical items now proven CLOSED — not carried forward

| Item | Evidence at `5604b50b` |
|---|---|
| R1-OPEN-01 stale-domain crawl evidence | Fixed in `c241baee` (2026-09-22) via `backend/services/crawl/reportDomainScope.ts`; every Report 1 consumer scoped and fail-closed; dedicated regressions incl. a negative control (`report1DomainAncestrySimulation.test.ts:306`). **Preserved — not to be modified** |
| `digital_snapshot` computed and discarded | Now consumed: `canonicalReportPipeline.ts:102`, `exportRendererReport1.ts:115/160/248`, `exportRendererOutput.ts:521`; `performanceReportService.ts:657-687` makes `digital_snapshot.topPriorities` canonical |
| `evidenceProvenance` test-only | 10 runtime importers |
| Report-2 threat "T2" (legacy priority array) | Closed by the same `performanceReportService` change |

---

## A4. Phase A outcome

- Authoritative commit **verified fresh**: `5604b50b`, remote tip confirmed by live API read.
- Working tree **protected and unchanged**; Report 1 code proven unmodified.
- Test run **recovered and still running**; no competing copy started.
- Blocker register: **8 open**, 4 historical items proven closed.
- **Phase B is unblocked** and already executing (the in-flight run is B1's required suite).
- Phases C, D, E, F, G remain blocked on the owner decisions and authorizations listed above.

**No production mutation, deployment, configuration change, provider activation, commit, merge or
push was performed. No secret, credential, connection string or token was read or printed.**
