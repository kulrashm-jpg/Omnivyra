# REPORT 1 — OWNER DECISION GATE

Prepared 2026-10-17. **No code was implemented, no database connected to, no release gate executed,
and the candidate was not changed.**

**T2, T3, deployment and production validation remain unauthorized. Report 1 is not complete.**

---

## 1. CANDIDATE INTEGRITY — confirmed, unchanged

| | |
|---|---|
| Base | `5604b50bdebd23efd6d040b90f5802954413b656` — candidate HEAD and `origin/main` agree |
| Tracked diff | `9bc40eeefa252cd807632fc56e7dc9554735abfd5d418c6897e09f31967fde0d` — 295 lines, 7 files |
| `metaAdLibraryClient.ts` | `2ac79b6c29479e67f62b151217796c0920c5ff14820b624066eb38be9a60cc1d` |
| `report1DurableHistoryHonesty.test.ts` | `d607d9adf44d3d71b5c25c3b05c0bc128edf28e626a6e91f9c01da7b7a2845f3` |
| `report1MetaAdsAcquisition.test.ts` | `b0a19dc600f832d65930de02ac3bb69c5e67b758c76aa6b948dc6b750ce3984a` |
| `r1-integ` | 0 staged · branches 179 · tags 114 — no commit, no branch, no tag |
| `deploy-current-main` | **0 staged / 78 modified / 58 untracked** — unchanged |
| `r1-hist` | reviewed history patch `50fcdea6…` **intact** |
| **L13** | `JEST_EXIT=0` · **1,496 passed / 1,496** — **authoritative and preserved** |

Every hash matches the recorded value. Nothing was re-run and no candidate file was touched.

---

## 2. TWO-PLANE DEPLOYMENT DECISION

### Recorded platform-attested evidence

| Plane | Evidence | Source |
|---|---|---|
| **Worker (Railway)** | deployment `e940bed5-…`, **SUCCESS**, created **2026-10-11T00:47:25.009Z**, commit **`5604b50b…`**, branch `main`, image digest `sha256:7da8415b…`, DOCKERFILE/`Dockerfile.worker`, 1 replica, draining 30 s, region `sfo` | `railway deployment list -p authentic-nature -e production --json`, observed 2026-10-17T08:14:12Z |
| **Web (Vercel)** | `dpl_HTqPDCiaeTjspBjHu9c6CcsBHobP`, production, **● Ready**, created **2026-10-04 13:55:45 +0530**, alias `omnivyra-rawats-projects-5fb9f1f3.vercel.app`, `buildId: build-TfctsWXpff2fKS`. **Source commit NOT exposed** — no `commit`/`sha`/`branch`/`repo`/`git` field in the inspected output | `vercel inspect`, observed 2026-10-17T08:12:50Z |

**The Vercel source commit is not inferred.** It is recorded as unavailable from the inspected
output.

### What the worker evidence does and does not establish

**Does:** which commit the *current worker deployment was built from* — `5604b50b`, platform-attested.

**Does NOT:**

- that the worker process is **healthy now** (the record is a deployment status, not a liveness probe);
- that the worker and web planes are **compatible** in their current skewed state;
- anything about the web plane's commit;
- that the skew is safe to leave in place.

### Evidence required for a compatible production end state

| # | Evidence | Collectible read-only from existing authorized sources? |
|---|---|---|
| E1 | Web plane **source commit** for `dpl_HTqPDCia…` | **No** — not exposed by `vercel inspect`. Needs the owner's deployment record, or a Vercel surface not yet authorized |
| E2 | Web plane **build identity** | **Already collected** — `buildId: build-TfctsWXpff2fKS` |
| E3 | Web plane **deployment timestamp** | **Already collected** — 2026-10-04 13:55:45 +0530 |
| E4 | Worker **commit, build and timestamp** | **Already collected** — see above |
| E5 | Web plane **health evidence** | **No** — requires a production request |
| E6 | Worker **health evidence** (running, not merely deployed) | **No** — requires a production query or log read |
| E7 | **Authenticated Report 1 validation** against the deployed stack | **No** — requires an authorized live run (B3) |
| E8 | **Intended end state** for both planes | **Not evidence — an owner decision** |

### The decision required

Production currently runs a **split**: the worker on `5604b50b`, the web plane on an Oct-4
deployment that necessarily predates it by seven days. This skew **exists today** and was not
created by this candidate.

**Decide:**

1. **Is the existing skew acceptable in the interim**, or is it itself a defect to close before
   anything else ships?
2. **What is the target end state** — both planes on one commit, and which? The candidate's base is
   `5604b50b`, which the worker already runs.
3. **Which plane deploys first**, and what is the rollback target for each? E1 is a prerequisite for
   the web plane's rollback target.
4. **Does any Report 1 behaviour depend on both planes being at the same commit?** If so, the
   deployment plan must say so, because the skew is live now.

**B2 can no longer be framed as "deploy the web plane."** It needs an end state for both.

---

## 3. DURABLE-HISTORY — THREE DECISIONS REQUIRED

**Nothing was connected to, queried, written, created, migrated or re-credentialed.** `cert-supabase`
was identified only from `docker ps` container names; its schema was **not** inspected.

### D1 — Which isolated non-production database is approved?

| Option | Consequence |
|---|---|
| **(a) `cert-supabase`** — already running (WRITER-CERT-002, up 46 h, ports 54321-54327) | No new environment needed, but Report 1 rows land in **another workstream's certification database**. That workstream's state could be disturbed |
| **(b) A dedicated disposable database** | Clean isolation, no cross-workstream risk; requires provisioning |

**Recommendation: (b)**, unless you know the certification workstream is idle. The test writes only
synthetic-tenant rows and cleans them up, but "should be harmless" is not the same as "authorized".

### D2 — Is that environment authorized for Report 1 test writes, and is the migration already applied there?

Two parts:

- **Write authorization** for synthetic-tenant rows in `report_score_history` and its companion tables.
- **Migration state.** `report_score_history` is defined in
  `supabase/migrations/20260601000000_canonical_intelligence_platform.sql`. **Whether it exists in
  the chosen database is UNKNOWN** — I did not query. If absent, the test needs that migration
  applied **there and only there**, which is a schema change requiring explicit approval.

### D3 — Is implementing the test file authorized?

Adding `backend/tests/integration/report1DurableHistoryEndToEnd.test.ts`:

- **changes the candidate**, so the tracked/untracked hashes in §1 all move;
- **invalidates L13** and every check above it, requiring a full local re-validation
  (certification ~13 min, baseline ~19 min, scoped suite ~18 min, plus the targeted suites);
- is placed under `backend/tests/integration/` **deliberately**, so it stays outside the Report 1
  unit-scope pattern and cannot silently enter the L13 scope.

**Sequencing note:** deciding D1-D3 **before** T2 avoids running the gate twice. Deciding after T2
means re-validating and re-gating.

### The test design is retained unchanged

```
PHASE 1 (process A):  persist via the intended DURABLE store
                      → { written: true, durable: true }, scan_metadata.persisted === true

── process boundary: fresh registry in a separate process ──

PHASE 2 (process B):  loadSnapshots(...) MUST return PHASE 1's row

NEGATIVE CONTROL:     the identical sequence against the IN-MEMORY store MUST FAIL at PHASE 2
```

Plus: `isOperational()` asserted against the real backend; table existence asserted **before** any
write; and all four failure modes required to leave **`scan_metadata.persisted === false`** —
absent configuration, failed admin-client initialisation, absent table, and a mid-bundle write
rejection.

**No in-memory-only substitute will be accepted as durable verification** — an in-memory store
cannot establish durability by construction, which is exactly what the negative control proves.

**All four production durable-history states remain `NOT VERIFIED`.** The diagnostic API remains
**PROPOSAL ONLY — NOT IMPLEMENTED**.

---

## 4. META — SIX UNRESOLVED QUESTIONS

**Documented facts** (official sources recorded in the package; no endpoint was contacted):

| Fact | Status |
|---|---|
| Any ad type is in the archive **only where it delivered to the UK or EU**, and only for the **past year** | **Documented.** Confirms the client's EU 27 + GB coverage list |
| Political / social-issue ads: **worldwide, ~7 years** | **Documented** |
| Setup: Facebook account + Meta for Developers account + Platform Policy agreement | **Documented** |
| Identity confirmation exists as a setup step, **tied to *running* political/social-issue ads** at `facebook.com/ID` | **Documented** |
| Research Tools is a **separate route** (application via Research Tools Manager, eligibility reviewed) — not a substitute for `ads_archive` | **Documented** |
| Permissions Reference app review covers Ads Insights `ads_read`, **not** Ad Library | **Documented** |
| Snapshot content is "for analysis"; **a batch of archived ads cannot currently be downloaded**; individual-ad creative may be | **Documented** |

**Unresolved interpretations** — none answerable without approved external access:

| # | Question | Why it matters |
|---|---|---|
| **M1** | **Is identity confirmation required merely to READ non-political UK/EU commercial ads?** Officially unstated — the requirement is documented only for *running* political ads | **The decisive unknown.** If yes, access needs a government-ID step before any Report 1 value is obtainable |
| **M2** | Does **Business Verification** apply to `ads_archive`? It is stated as required "for all apps making requests for Advanced Access", but not confirmed for this endpoint | Changes the lead time from days to potentially weeks |
| **M3** | Is **app review** required at all for this endpoint? | Same |
| **M4** | **Token type, lifetime and rotation.** Third-party guides disagree (≈1 h vs ≈60 days) and were **not** relied on | Determines whether acquisition needs a refresh mechanism. `code 190` already degrades honestly to `requires_auth`, so expiry is safe — but unattended operation needs an answer |
| **M5** | **Approval turnaround.** Guides claim 1-3 days vs 1-2 weeks; unverified | Scheduling only, but it is why M1-M3 should start now |
| **M6** | Does the implementation's **paging qualify as "analysis" rather than a prohibited batch download**? The client queries the API and keeps field values; it downloads no snapshot media | **A terms question for the owner, not an engineering one.** I am not the right judge of Meta's terms |

**Unchanged by any of this:** the strict `MATCHED`-only claim rule, and the coverage wording. Neither
depends on access — Meta can never support a company-specific claim because it publishes no identity
assertion for commercial advertisers, and the UK/EU boundary is a property of the archive.

---

## 5. EIGHT-BLOCKER REGISTER

No blockers merged. Resolving one authorizes nothing else.

| # | Blocker | Status | Evidence state | Next step | Owner |
|---|---|---|---|---|---|
| **B1** | T2 execution | **OPEN** | 5 matrix rows never run on this candidate; 1 PARTIAL; 1 NOT TESTABLE here | Authorized action | Release engineering |
| **B2** | T3 / deployment **+ two-plane end state** | **OPEN — scope widened** | Worker commit confirmed; web commit unavailable; no health evidence | **Decision** (§2), then authorized action | Owner + release eng |
| **B3** | Authenticated production validation | **OPEN** | None | Authorized production action | Owner |
| **B4** | Vercel source SHA | **PARTIAL** | Deployment, build id, timestamp, status **confirmed**; **source commit NOT exposed** | Read-only owner record (E1) | Owner / release eng |
| **B5** | Meta prerequisites | **PARTIAL** | 7 facts documented; **M1-M6 unresolved** | Read-only external investigation | Owner |
| **B6** | Production acquisition flag | **OPEN** | Flag **ABSENT** from Production (read-only `vercel env ls`) | **Decision**, then T3 config action | Owner |
| **B7** | Durable-history verification | **OPEN — all four states NOT VERIFIED** | Plan ready; **not executable** as it stands | **Decisions D1-D3** (§3) | Owner |
| **B8** | Railway worker SHA | **RESOLVED — within its limits** | Deployment `e940bed5-…`, SUCCESS, **commit `5604b50b`**, 2026-10-11T00:47:25.009Z, image digest recorded | None for the SHA | — |

**B8's limit, stated explicitly:** the Railway metadata establishes **which commit the current worker
deployment was built from**. It does **not** establish that the worker is healthy now, and it does
**not** establish web/worker compatibility. Those remain inside B2, E5, E6 and B3.

---

## 6. AUTHORIZATIONS NEEDED, PER PROPOSED ACTION

| Proposed next action | Authorization required | Invalidates L13? |
|---|---|---|
| Owner supplies the web plane's source commit (E1) | None — an owner-side record | No |
| Collect web/worker **health** evidence (E5, E6) | **Production read authorization** | No |
| Decide the two-plane end state (§2) | **Owner decision** — no technical authorization | No |
| Decide D1 — which database | **Owner decision** | No |
| Apply `20260601000000` to the chosen non-production database (D2) | **Schema-change authorization, scoped to that database only** | No |
| Implement the durable end-to-end test (D3) | **Code-change authorization** | **YES** — full local re-validation required |
| Implement the readiness diagnostic API | **Code-change authorization** (separate from D3) | **YES** |
| Walk Meta's access flow (M1-M5) | None to investigate. A token goes to the **worker** environment only — never a prompt, log, repo file or document | No |
| Rule on Meta's usage terms (M6) | **Owner determination** | No |
| Execute T2 | **T2 authorization** | No |
| Execute T3 / deploy | **T3 authorization, separate from T2** | No |
| Run authenticated production validation | **Live-run authorization**, plus a nominated tenant and confirmed provider quota | No |

### Recommended order, unchanged in substance

1. **E1** web source commit — a read, and B2's rollback target depends on it.
2. **§2 two-plane decision** — the skew is live today.
3. **D1-D3** durable history — because D3 is a code change that must land **before** T2, not after.
4. **M1-M3** Meta access — external and slow; start now so it never becomes the critical path.
5. Then **B1** T2 → **B2** T3 → **B6** flag → **B3** production validation.

### Concerns recorded, not decided

- **Row 15 is not waived.** `npm run test:realschema` needs Docker, and Docker here starts a
  production worker. T2 must run it on CI or a non-production host.
- **Lint policy is not inferred.** No workflow runs eslint; whether release policy *requires* lint is
  an open question the repository does not answer.
- **No tenant-count acceptance criterion was invented.** How many tenants B3 must cover is an owner
  decision.
- **I am not recommending T2.** Local checks passing is one row of eighteen.

---

**LOCAL VALIDATION PASS — RELEASE DECISIONS STILL REQUIRED**
