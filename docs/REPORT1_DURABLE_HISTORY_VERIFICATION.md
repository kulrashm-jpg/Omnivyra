# REPORT 1 — DURABLE-HISTORY VERIFICATION AND RELEASE DECISIONS

Record for the Report 1 release candidate. Covers the isolated durable-history
proof, the owner decisions taken with it, and what remains unproven.

**Report 1 is not released and is not production-ready.** Nothing in this record
changes that.

---

## 1. Candidate identity

| | |
|---|---|
| Base | `5133687aa2b227d9b35b875f029741b684e174c3` |
| Tracked diff | `9bc40eeefa252cd807632fc56e7dc9554735abfd5d418c6897e09f31967fde0d` — 7 files, +119 / −26 |
| `backend/services/ads/metaAdLibraryClient.ts` | `2ac79b6c29479e67…` (314 lines) |
| `backend/tests/unit/report1DurableHistoryHonesty.test.ts` | `d607d9adf44d3d71…` (155 lines) |
| `backend/tests/unit/report1MetaAdsAcquisition.test.ts` | `b0a19dc600f832d6…` (468 lines) |
| `backend/tests/realschema/report1DurableHistoryEndToEnd.test.ts` | `f996700c835eb5e1…` (425 lines) — **new** |

The tracked-diff digest is unchanged from the previously frozen candidate because
the new test is an untracked addition, not a modification of any candidate file.
All ten pre-existing candidate files hash-match the frozen candidate exactly.

---

## 2. The durable-history proof

`backend/tests/realschema/report1DurableHistoryEndToEnd.test.ts`.

### Why it had to be written this way

`report1DurableHistoryHonesty.test.ts` pins the **contract** — that
`scan_metadata.persisted` is `written && durable`, and that an in-memory store
declares `durable = false`. It cannot pin the **fact**, because a process-local
map satisfies every in-process write-then-read. Durability is only observable
from outside the writing process.

The test therefore writes in one OS process and reads in another. Re-executed
under `tsx` with `W6_DURABLE_CHILD_COMPANY` set, the file takes a child branch
instead of registering suites — one file, the real `SupabaseHistoryStore` on both
sides, and a genuinely cold module registry rather than `jest.resetModules()`,
which cannot guarantee the heap is free of a captured instance.

### Result — 2026-10-17T17:29:46Z → 17:45:02Z, harness exit 0

```
PASS real-schema backend/tests/realschema/report1DurableHistoryEndToEnd.test.ts (12.659 s)
Test Suites: 29 passed, 29 total
Tests:       530 passed, 530 total
gate: full      jest exit code: 0
```

Container `ed9ef590…` created and removed; run nonce
`cdcd97d423b4cb75b5f11287cc9201ff`; accident guard PASS; 823 public tables;
44 migrations replayed; **0 leak markers**; no residual containers or run
directories. The 28 pre-existing suites and 525 tests are unchanged.

| Assertion | Outcome |
|---|---|
| Cross-process read-back through the real store | `viaStore: 1` |
| Independent corroboration by raw SQL | `viaSql: 1` |
| **Negative control** — same sequence, in-memory store | reads back in-process, child finds **0** by both routes |
| Volatile store | `written: true`, `durable: false` → conjunction false |
| Non-operational store | `written: false`, `reason: history-store-not-operational` |
| Residue across all six history tables | **0 rows** |

The negative control is what makes the positive result non-vacuous: if the child
could see in-memory rows, the process boundary would be fake.

### Safety properties

Fails closed unless `current_database() = 'w6'` **and** the database carries a
`w6-harness run=<32 hex>` stamp written by `scripts/ci/real-schema-ci.sh`, **or**
the declared ephemeral GitHub-hosted markers are present. Loopback is checked
from the client's own URL, not from `inet_server_addr()` — a server behind a
forwarded port reports its own bridge address, which is the mistake that once
made CI refuse its own service container. The synthetic `company_id` is derived
from the harness run identity plus a UUID fragment, so runs cannot collide and
cleanup cannot reach another suite's rows. Cleanup is row-scoped `DELETE` across
exactly the six history tables, on entry and exit, with a residue assertion.

### One defect found and fixed during validation

The first run failed with `Client was closed and is not queryable` in the cleanup
hook — **all 530 tests had already passed**. `setup.ts` is a
`setupFilesAfterEach` module, so its `afterAll(db.end)` registers before any hook
in this file and jest runs root-level `afterAll` hooks in declaration order,
closing the shared client underneath this suite's cleanup. Every sibling suite
mutates through `inRollback()` and needs no cleanup, so this is the first suite
to commit and the first to hit it. Fixed by owning a dedicated client.
`setup.ts` was **not** modified — it is shared by 28 suites.

### WHAT THIS DOES NOT PROVE

- **Not the production transport.** `supabaseHistoryStore.ts` takes a
  PostgREST-shaped client; a disposable Postgres has no PostgREST, so the test
  supplies a `pg` adapter and `require('../../db/supabaseClient')` is never
  exercised.
- **Not production grants or RLS.** `baseline.sql` is dumped `--no-privileges`,
  so the disposable database has zero grants, while RLS is ENABLED on all six
  history tables with zero policies. The test connects as `postgres` and
  bypasses both.
- **Not production.** The four required production states remain **NOT
  VERIFIED**: provider registered, durable store selected and operational,
  deployed migration/table state confirmed, and production cross-process
  durability.

---

## 3. Persistence-truthfulness defect — present in production, fixed only in the candidate

At the deployed web revision `a8cd5c5d`:

```
canonicalReportBuilderAssembly.ts:863
  reportShape.scan_metadata.persisted = persisted.written;
```

The conjunction fix `persisted.written && persisted.durable` is **absent from the
deployed web plane and absent from `main`**; it exists only in this candidate.
The durable store is wired and flag-gated, so whenever `SUPABASE_HISTORY_ENABLED`
is not `true` or the admin client fails to resolve, the in-memory store serves and
production reports `persisted: true` for writes that do not survive a cold start.

**This is a live defect, recorded here as unfixed in production.** The candidate
contains the fix. Nothing in this record asserts the fix is deployed.

---

## 4. Owner decisions recorded

| Decision | Record |
|---|---|
| **Meta M7** | **DEFERRED. Meta remains dormant for this release.** The legal/terms determination for `ads_archive` is unresolved. The prepared enquiry is **unsent**. No provider contact, credential use, activation or live call has occurred. No Meta credential or flag exists in any `.env*` file, so the client ships inert and is unreachable. |
| **Lint policy** | **Existing CI policy retained.** No lint gate is added. Local evidence recorded: `npx eslint` over the 11 candidate files — **0 findings**, exit 0. |
| **Durable history** | Scoped isolated verification only, as §2. No production write, schema change or flag change. |

---

## 5. T2 row 15 — reclassified on evidence

Row 15 of `REPORT1_T2_INTEGRATION_PACKAGE.md` recorded
`npm run test:realschema` as **NOT TESTABLE** here, on the basis that Docker
starts a production worker.

**That is disproven.** The hardened harness creates its own disposable container,
identified by the id `docker run` returns plus a per-invocation nonce label, with
an accident guard before any DDL and bounded cleanup. It has now completed
locally three times and on CI. Row 15 is **runnable**, and its result for this
candidate is the 29/29 · 530/530 run in §2.

---

## 6. Candidate revalidation — gates re-run on the exact changed tree

Prior results were **not** carried across; the new file changes the candidate.

| Gate | Command | Elapsed | Exit | Result |
|---|---|---|---|---|
| L13 | `npx jest --testPathPattern "(<71-suite alternation>)"` | 11m 14s | 0 | **71/71 suites · 1,496/1,496 tests**, 0 failed |
| L14 | `npm run typecheck:certification` | 25m 17s | 0 | `backend.json` 0/0 coverage 3573/3573 · `backend-tests.json` **259/259** coverage **2009/2009** · **net-new 0** · FINGERPRINT PASS both · **RESULT: PASS** |
| L15 | `npm run typecheck:ci` | 18m 51s | 0 | 3/3 projects clean · baseline 0 / actual 0 · **RESULT: PASS** |
| L16 | `npx eslint` × 11 files | 2m 32s | 0 | no findings |

L14's backend-tests coverage moved **2008 → 2009**: the new test entered the
type-checked program and added **zero** errors. `tsconfig.backend-tests.json` is
the only project that type-checks `backend/tests/**`, and ts-jest is
transpile-only, so this is the gate that could have caught a type defect in the
new file — and it did not find one.

---

## 7. Remaining release blockers — unchanged

| Blocker | Status |
|---|---|
| T2 integration execution | **Open** — no CI context has ever run against candidate content |
| T3 deployment + two-plane end state | **Open** — plan not ratified |
| Railway rollback | **Not ready** — every prior deployment is `REMOVED`; rollback is a rebuild from a commit and cannot restore a previous image digest |
| Production durable-history states 1–4 | **NOT VERIFIED** — see §2 |
| Meta M7 | **Deferred** — §4 |
| `CREATOR_OCR_ENDPOINT` | **Not a Report 1 blocker.** Consumed only by the creator renderer stack (12 `creator*` files); Report 1 engines and the Report 1 export pipeline reference it zero times. Remains an unset production variable and a creator-capability limitation |
| Boot fingerprint | **Open** — `authSubsystemBoot.ts:72` passes `schema.checkedAt` as the manifest hash, so `fingerprint` and `schema_manifest_hash` are per-boot. Only `/api/health/version`'s `build` field is trustworthy |
| Web/worker plane skew | **Open** — web `a8cd5c5d`, worker `5133687a` |
