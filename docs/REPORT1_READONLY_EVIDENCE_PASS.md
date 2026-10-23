# REPORT 1 — INDEPENDENT READ-ONLY EVIDENCE PASS

2026-10-17. **No candidate change. No database connection or schema query. No production read.
No Meta endpoint contacted. No release gate executed.**

**Candidate unchanged and L13 remains valid** — see §5.

---

## 1. TWO-PLANE DEPLOYMENT STATE — now fully documented for the worker

### Worker plane (Railway) — platform-attested history

`railway deployment list -p authentic-nature -e production --limit 4 --json`, no linking, observed
2026-10-17T08:3xZ.

| Deployment | Status | Created (UTC) | Commit |
|---|---|---|---|
| **`e940bed5`** | **SUCCESS** | **2026-10-11T00:47:25** | **`5604b50bdebd…`** ← live |
| `465353ad` | REMOVED | 2026-10-10T00:15:18 | `5f3c199784a2…` |
| `0c758afb` | REMOVED | 2026-10-04T08:18:42 | `a8cd5c5dc67f…` |
| `a9aabf57` | REMOVED | 2026-10-04T07:13:53 | `5d14ead242be…` |

Build: DOCKERFILE · `Dockerfile.worker` · 1 replica · `ON_FAILURE` ×5 · draining 30 s · region
`sfo` · plan `hobby` · image digest `sha256:7da8415b1f9c…`.

### Web plane (Vercel) — identified, commit still not exposed

`dpl_HTqPDCiaeTjspBjHu9c6CcsBHobP` · production · **● Ready** · created **2026-10-04 13:55:45
+0530 = 2026-10-04T08:25:45Z** · alias `omnivyra-rawats-projects-5fb9f1f3.vercel.app` ·
`buildId: build-TfctsWXpff2fKS`. A targeted grep of the inspected output for
`commit|sha|branch|repo|git` returns **nothing**.

### The web plane's source commit is UNAVAILABLE — withdrawn as any form of inference

**Revised 2026-10-17 on owner instruction: do not infer the Vercel commit from its build ID, its
timestamp, or correlation with a Railway deployment.**

An earlier revision of this document noted that the worker deployed `a8cd5c5d` at 08:18:42Z and the
web deployment was created at 08:25:45Z, and framed `a8cd5c5d` as a hypothesis the owner could
confirm. **That framing is withdrawn.** Proximity in time does not establish which commit a
manually-created Vercel deployment was built from — two planes can be advanced from different
commits minutes apart, and the earlier framing invited exactly the inference the owner has ruled
out.

**The position of record:** the web deployment carries **no git metadata of any kind** — a targeted
search of the inspected output for `commit|sha|branch|repo|git` returns nothing. Its source commit
is therefore **UNAVAILABLE from authorized read-only sources**, and **no candidate commit is
proposed**. It must come from the owner's own deployment record (E1).

The Railway row showing `0c758afb` → `a8cd5c5d` remains valid **as evidence about the worker plane
only**, because Railway attests it directly.

### Rollback targets — the planes differ, and this is a new finding

| Plane | Retained rollback candidates | Mechanism |
|---|---|---|
| **Web (Vercel)** | **8+ production deployments still `● Ready`**, immediate prior `omnivyra-iowl4y8es…` (13 d) | Promote a retained deployment. This programme's standing rule is `vercel promote`, never `alias set` |
| **Worker (Railway)** | **NONE live.** `e940bed5` is the only `SUCCESS`; every prior deployment is **`REMOVED`** | **No retained deployment to promote.** A rollback would have to be a **rebuild from a commit** — a different, slower mechanism with a build step in the path |

**Consequence for B2:** the two planes do not have symmetric rollback. The web plane can be reverted
by promotion in seconds; the worker plane cannot, and its rollback is a rebuild. Any deployment plan
must state the worker's rollback **commit** (the obvious candidate being `5f3c1997`, the prior
deployed commit) and accept that reverting it is not instantaneous.

### Proposed compatible end state

**Proposal, for owner decision — not a recommendation to deploy.**

| | |
|---|---|
| Target | **Both planes on one commit.** The natural target is **`5604b50b`**, which the worker already runs and which is the candidate's base — so only the web plane would move |
| Worker action | **None.** It is already at `5604b50b` |
| Web action | Deploy `5604b50b` (or the T2-verified candidate, if the candidate is being released rather than just the base) |
| Web rollback target | A retained `● Ready` deployment — **requires E1** to know which commit it corresponds to |
| Worker rollback target | Rebuild from **`5f3c1997`** — no retained deployment exists |
| Interim risk | The skew is **live today**; the proposal reduces it rather than creating it |

**Important distinction the owner must settle:** is the intended release the candidate
(`5604b50b` + the recorded diff and three new files), or just its base `5604b50b`? The worker is on
the base, **not** the candidate. Deploying only the web plane with the candidate would create a
*new* skew in the opposite direction.

### Compatibility evidence still unavailable

| # | Evidence | Read-only from authorized sources? |
|---|---|---|
| E1 | Web plane source commit | **No** — owner deployment record required |
| E5 | Web plane health | **No** — production read |
| E6 | Worker health (running, not merely deployed) | **No** — production query or log read |
| E7 | Authenticated Report 1 validation on the deployed stack | **No** — live-run authorization (B3) |
| E9 | **Whether Report 1 behaviour depends on both planes matching** | **Partly** — answerable by code analysis, but not yet performed; it is a design question, not a platform read |

---

## 2. META — M1-M5 CONTINUED, AND A SHARPER QUESTION FOUND

### Documented facts added this pass (official sources)

From **Meta's Research Tools product terms** — the first *official* text bearing on commercial use:

| Clause | Content |
|---|---|
| §2(p) | "Research" means work "conducted for **non-commercial purposes** for science or in the public interest" |
| §2(c) | Access is granted "solely for the Approved Purpose and for no other purpose whatsoever", authorized by Meta "in its sole discretion" |
| §5(b)(v) | Prohibits attempts to "sell, rent, or **commercially exploit** any Meta Data … or Research Outputs" |
| §5(b)(vii) | Bars use "in connection with the development of a competing product or **for benchmarking purposes**" |
| §2(i), §3(a), §3(b) | Eligibility is tied to an **Institution** (current employment or affiliation); application via a Meta-approved channel (Research Tools Manager); Meta reviews eligibility |
| §1 | The covered tools are the **Meta Content Library UI**, the **Meta Content Library API**, and the **Ads Transparency and Targeting Dataset**. **The Ad Library API is NOT listed** |
| §2(r) | Covers tools "designed for Research"; whether this reaches the Ad Library API **cannot be confirmed from the document** |

**This is the most consequential official finding of the pass**, and it cuts both ways. The
non-commercial restriction, the Institution requirement and the explicit benchmarking prohibition
would each disqualify Omnivyra's use case — **but they attach to the Research Tools route, and the
Ad Library API is not among the tools that route enumerates.**

### The new question this raises

**M7 — Is `ads_archive` governed by the Research Tools non-commercial terms, or by separate terms?**

- If **governed**: commercial brand/competitor monitoring is barred outright by §2(p), §5(b)(v) and
  §5(b)(vii), and **Option A is not viable as scoped**, regardless of coverage or identity checks.
- If **separate**: the Ad Library API is its own surface with its own (thinly documented)
  requirements, and Option A remains viable within the UK/EU coverage boundary.

**Unresolved, and it is a terms question for owner/legal review — not an engineering one.**

### Third-party claims — recorded, NOT relied upon

Several independent guides now converge on points Meta does not state officially. Recording the
convergence because it raises these from "disputed" to "likely but unverified", and one of them is
decision-critical:

| Claim | Source quality | Why it matters |
|---|---|---|
| Identity confirmation applies to **every API user**, not only political advertisers — government ID, selfie, proof of residency at `facebook.com/ID` | Multiple independent guides agree; **Meta's own text ties it to *running* political ads** | Directly answers **M1** if true. Would add a government-ID step before any Report 1 value |
| **"If your use case is commercial brand monitoring — competitor ad creative, landing page tracking, spend analysis — your application will be rejected"** | Single third-party source; **unverified** | **Decision-critical.** This is precisely Omnivyra's use case. It may well describe the **Research Tools** route (consistent with the official terms above) rather than `ads_archive` — which is exactly why **M7** must be settled |
| Token short-lived (1-2 h), extendable to ~60 days | Guides disagree | **M4** |
| Approval 2-7 business days, or hours to two days | Guides disagree | **M5** |
| App review required / not required | Guides directly contradict each other | **M3** |
| Error 190 "almost always" means identity confirmation is incomplete | Consistent across guides | Corroborates the client's `190 → requires_auth` mapping |

**No third-party claim is treated as established.** Each is listed against the official gap it would
fill.

### M1-M7 status

| # | Question | Status |
|---|---|---|
| M1 | Identity confirmation required to **read** non-political UK/EU commercial ads? | **UNRESOLVED.** Official text ties it to *running* political ads; multiple third-party sources say all API users |
| M2 | Business Verification applies to `ads_archive`? | **UNRESOLVED** |
| M3 | App review required? | **UNRESOLVED** — third-party sources contradict each other |
| M4 | Token type, lifetime, rotation | **UNRESOLVED** |
| M5 | Approval turnaround | **UNRESOLVED** |
| M6 | Does the paging/use qualify as "analysis" rather than batch download? | **UNRESOLVED — owner/legal** |
| **M7** | **Is `ads_archive` inside the Research Tools non-commercial terms?** | **UNRESOLVED — owner/legal. New, and the highest-stakes of the set** |

**Unchanged:** the strict `MATCHED`-only claim rule and the coverage wording. The UK/EU coverage
boundary was re-confirmed again this pass.

---

## 3. NON-PRODUCTION ENVIRONMENT RECONCILIATION — one blocker dissolved

**From file metadata only. No database was connected to and no schema was queried.**

### What the repository already provides

| Fact | Source |
|---|---|
| The harness can build **its own disposable database**: image `pgvector/pgvector:pg17`, container `w6-real-schema`, host port **5433** — all overridable (`W6_PG_IMAGE`, `W6_CONTAINER`, `W6_PG_PORT`) | `scripts/ci/real-schema-ci.sh:23-25` |
| It can instead use a **supplied** database with no container management | `:19`, `:55` — `W6_DB_URL` |
| It tears the container down on exit unless `W6_KEEP=1` | `:41-44` |
| Schema is built as **bootstrap → committed baseline → replay of migrations newer than the baseline** | `:11-12`, `:27-29`, `:87-94` |
| The committed baseline is schema-only, **no data, no PII**, generated by `pg_dump` | `supabase/_schema/baseline.json` — "Schema-only. No data, no PII." |
| Baseline scale | **823 tables**, 62,246 lines, 2.1 MB; `ledgerCount: 35`, **`ledgerMax: "20260916000000"`** |
| **`report_score_history` is CREATED BY THE BASELINE** | `supabase/_schema/baseline.sql:22076` — `CREATE TABLE public.report_score_history (`; 16 occurrences in total |
| Migration `20260601000000` is **`< ledgerMax`** | So it sits **inside** the baseline and is **not replayed** |

### What this changes

**D2's migration question is answered by file evidence: no migration needs applying.** A disposable
database built by the harness already contains `report_score_history`, because the governed baseline
creates it. The earlier concern — that the table might be absent and would require applying
`20260601000000` as a separately authorized schema change — **does not arise on the harness path.**

**What remains for D2** is therefore only *write authorization* in the chosen environment, not a
schema change.

### The only running local stack

`docker ps` container **names** show exactly one project: **`cert-supabase`** (WRITER-CERT-002). The
repository has **no `supabase/config.toml`**, so that stack is configured outside this worktree —
confirming it belongs to another workstream rather than to Report 1.

### Authorization and evidence needed before a dedicated disposable database could be approved

| # | Requirement | Type |
|---|---|---|
| 1 | Permission to **start the harness's own disposable container** (`w6-real-schema`, port 5433, `pgvector/pgvector:pg17`) | **Authorization.** Note the standing caution that Docker on this machine starts a production worker — that concerns the dev stack, not an isolated Postgres container, but starting *any* container is beyond read-only |
| 2 | Confirmation that port **5433** is free and will not collide with `cert-supabase` (54321-54327) | Read-only check — **not yet performed** |
| 3 | Permission for **synthetic-tenant writes** in that database | **Authorization** |
| 4 | Confirmation that building from the **production-derived baseline** in a disposable container is acceptable | **Owner decision.** The baseline is schema-only with no data or PII, but it is derived from the production schema |
| 5 | **No migration authorization needed** | **Dissolved** — see above |

---

## 4. DURABLE-HISTORY DECISION RECORD — D1-D3

### D1 — Which isolated non-production database?

| Option | Assessment |
|---|---|
| **(a) `cert-supabase`** | Already running; needs no container start. **But it is another workstream's certification environment** (WRITER-CERT-002), configured outside this worktree. Report 1 rows would land in it |
| **(b) The harness's own disposable container** — `w6-real-schema`, port 5433 | **Recommended.** Purpose-built, torn down on exit, schema from the governed baseline, zero cross-workstream exposure. Requires authorization to start one container, plus the port check |
| (c) A fresh owner-provisioned database | Also clean; more setup for no additional benefit over (b) |

**Recommendation: (b).**

### D2 — Write authorization, and migration state

- **Write authorization:** required — synthetic-tenant rows in `report_score_history` and its
  companion tables, cleaned up by the test on both entry and exit.
- **Migration state: RESOLVED by file evidence.** `report_score_history` is created by the committed
  baseline (`baseline.sql:22076`) and `20260601000000 < ledgerMax 20260916000000`, so it is inside
  the baseline and never replayed. **No migration needs applying, and none is requested.**

### D3 — Authorize implementing the test file?

**Consequence, stated plainly:** adding
`backend/tests/integration/report1DurableHistoryEndToEnd.test.ts`

- **changes the candidate** — the tracked diff and the untracked-file hash set both move;
- **invalidates L13** and every check above it. Full re-validation costs roughly
  **13 min** (certification) + **19 min** (baseline) + **18 min** (scoped suite) + the targeted
  suites — about **an hour of gates** before T2 could even begin;
- is placed under `backend/tests/integration/` **deliberately**, so it stays outside the Report 1
  unit-scope pattern and cannot silently enter the L13 scope.

**Sequencing:** decide D1-D3 **before** T2. Deciding afterwards means re-validating and re-gating.

### The test design — retained verbatim

```
PHASE 1 (process A):  persist via the intended DURABLE store
                      → { written: true, durable: true }
                      → scan_metadata.persisted === true

── process boundary: a genuinely separate process, fresh registry ──

PHASE 2 (process B):  loadSnapshots(...) MUST return PHASE 1's row

NEGATIVE CONTROL:     the identical sequence against the IN-MEMORY store MUST FAIL at PHASE 2
```

Plus `isOperational()` asserted against the real backend; table existence asserted **before** any
write; and all four failure modes required to leave **`scan_metadata.persisted === false`** — absent
configuration, failed admin-client initialisation, absent table, and a mid-bundle write rejection.

**No in-memory-only substitute is acceptable as durable verification.** The negative control is what
proves that; an in-memory store cannot establish durability by construction.

**All four production durable-history states remain `NOT VERIFIED`.** The diagnostic API remains
**PROPOSAL ONLY — NOT IMPLEMENTED**.

---

## 5. CANDIDATE PRESERVATION

| | |
|---|---|
| Base | `5604b50bdebd23efd6d040b90f5802954413b656` — HEAD and `origin/main` agree |
| Tracked diff | `9bc40eeefa252cd807632fc56e7dc9554735abfd5d418c6897e09f31967fde0d` |
| `metaAdLibraryClient.ts` | `2ac79b6c29479e67f62b151217796c0920c5ff14820b624066eb38be9a60cc1d` |
| `report1DurableHistoryHonesty.test.ts` | `d607d9adf44d3d71b5c25c3b05c0bc128edf28e626a6e91f9c01da7b7a2845f3` |
| `report1MetaAdsAcquisition.test.ts` | `b0a19dc600f832d65930de02ac3bb69c5e67b758c76aa6b948dc6b750ce3984a` |
| `r1-integ` | 0 staged · branches 179 · tags 114 |
| `deploy-current-main` | 0 staged / 78 modified / 58 untracked |
| `r1-hist` | patch `50fcdea6…` intact |
| **L13** | `JEST_EXIT=0` · **1,496 / 1,496** — **VALID** |

Only documentation was added. No candidate file was touched.

---

## 6. EIGHT-BLOCKER REGISTER

| # | Blocker | Status | Movement this pass |
|---|---|---|---|
| **B1** | T2 execution | **OPEN** | — |
| **B2** | T3 / deployment + two-plane end state | **OPEN — better specified** | End state proposed; **asymmetric rollback discovered** (web promotable, worker rebuild-only); the candidate-vs-base release question surfaced |
| **B3** | Authenticated production validation | **OPEN** | — |
| **B4** | Vercel source SHA | **PARTIAL** | Deployment id, build id, timestamp and status **confirmed**; **source commit UNAVAILABLE** — no git metadata exists on the deployment. The earlier correlation-derived hypothesis is **withdrawn** (§1); no candidate commit is proposed |
| **B5** | Meta prerequisites | **PARTIAL — stakes raised** | Official Research Tools terms found: non-commercial, Institution-bound, benchmarking barred — but **the Ad Library API is not among the tools they enumerate**. **New M7** is now the highest-stakes question |
| **B6** | Production acquisition flag | **OPEN** | Unchanged. **Note:** M7 could make B6 moot — if `ads_archive` is inside the non-commercial terms, there is nothing to enable |
| **B7** | Durable-history verification | **OPEN — one obstacle dissolved** | **No migration authorization needed**: the table is created by the committed baseline. D2 reduces to write authorization |
| **B8** | Railway worker SHA | **RESOLVED, within its limits** | Full 4-deployment history added. Still proves only *which commit the deployment was built from* — **not** worker health, **not** web/worker compatibility |

**Still eight. None merged.**

---

## 7. AUTHORIZATIONS REQUIRED

| Next action | Authorization | Invalidates L13? |
|---|---|---|
| Owner supplies the web plane's source commit (E1), from their own deployment record | None | No |
| Check port 5433 is free | None meaningful; not yet done | No |
| Settle **M7** and **M6** | **Owner / legal determination** | No |
| Walk Meta access (M1-M5) | None to investigate. A token goes to the **worker** environment only | No |
| Start the harness's disposable container (D1-b) | **Authorization to start one container** | No |
| Synthetic-tenant writes there (D2) | **Write authorization** | No |
| Implement the durable test (D3) | **Code-change authorization** | **YES** |
| Implement the readiness diagnostic | **Code-change authorization** (separate) | **YES** |
| Collect plane health (E5, E6) | **Production read authorization** | No |
| Decide the two-plane end state | **Owner decision** | No |
| T2 / T3 / production validation | Their own separate authorizations | No |

### Recommended order

1. **Settle M7** — it can invalidate the entire Meta workstream, including B6. Cheapest decision with
   the largest consequence.
2. **E1** web commit — supplied from the owner's deployment record; B2's web rollback target depends on it. No candidate commit is proposed here.
3. **Two-plane decision**, including candidate-vs-base and the worker's rebuild-only rollback.
4. **D1-D3** — before T2, since D3 is a code change.
5. **M1-M3** Meta access — external and slow.
6. Then **B1** T2 → **B2** T3 → **B6** → **B3**.

### Concerns recorded, not decided

- Row 15 (`test:realschema`) is **not waived** — needs CI or a non-production host.
- Lint policy is **not inferred** from CI's silence.
- No tenant-count criterion for B3 was invented.
- **I am not recommending T2.**

---

**LOCAL VALIDATION PASS — RELEASE DECISIONS STILL REQUIRED**
