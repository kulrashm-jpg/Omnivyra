# PI-C1-PHASE-1-LIFECYCLE-B21-PG-VERIFICATION-001 — lifecycle and SQLSTATE verification

**Verification and test authoring only.** No product-code change, no schema or migration edit, no existing test file touched, no production or shared database, no `cert-supabase` use, no provider call, no commit, push, merge or deployment. No Phase 2 work, no requirement ratification, no schedule change.

> ## Result
>
> **L1–L8 and L10–L11 are VERIFIED AGAINST POSTGRESQL**, in a new permanent suite: `backend/tests/realschema/pi_lifecycle_b21.test.ts` — **28 tests, all passing**. **L9 is NOT RUN**, with a verified reason.
>
> **The suite found a real product defect on its first run, and it is NOT fixed here.** The Community lifecycle ledger has **no tiebreaker for current-state ordering**: `transitioned_at` defaults to the transaction timestamp and the table has no sequence or identity column, so two rows sharing that timestamp leave "current state" undetermined. The PI sibling ledger has exactly the `seq` column this one lacks. Closing it needs a schema change — **§6 states the minimum authorization required**.
>
> A second finding, measured rather than assumed: **the schema does not prevent a lifecycle row from citing another tenant's opportunity.** Tenant correctness at that boundary rests entirely on the application predicate.
>
> **I also owe a correction:** my two previous reports claimed `scripts/ci/real-schema-ci.sh` "exits 0 even when the suite fails". **That is wrong for the current script** (§8).
>
> This is self-review. A passing run is not independent review.

---

## 1. Baseline and source hashes

Measured **2026-10-18T16:26:51+05:30 (IST)**.

| | Value |
|---|---|
| Repository / branch | `C:/tmp/r1-ctx` · `fix/r1-profile-context` |
| HEAD, start and end | **`29fea38a2d1642c1c2fd957e5151f6be81415774`** — unchanged |
| Working tree, start | **158 entries (72 M / 86 ??)** |
| Working tree, end | **159 entries** — the one addition is the new test file |

**Hash gate — all five evidence reports matched their expected SHA-256 before any work, and are unchanged at the end:**

| Report | SHA-256 (16) |
|---|---|
| `PI-C1-JEV-ARCHITECTURE-DECISION-002.md` | `bfbc683f3f7caa81` |
| `PI-C1-PHASE-1-IMPLEMENTATION-001.md` | `953adb5e53185a83` |
| `PI-C1-PHASE-1-F1-F2-REMEDIATION-001.md` | `f3bf6bff3bbcbd4d` |
| `PI-C1-PHASE-1-PG-VERIFICATION-002.md` | `838729e55d21061d` |
| `PI-C1-PHASE-1-RETENTION-REGRESSION-001.md` | `457c6091e11e8855` |

**Phase 1 files, hashed at start and byte-identical at end:** `lifecycleGuardErrors.ts` `d63e5165d127e75b` · `retention.ts` `60e9c05a8906fd8a` · `retentionService.ts` `b84a8605745130bd` · `opportunityLifecycleService.ts` `40bb4453ff14f4ca` · `prospectLifecycle/lifecycleWriter.ts` `fde7e56c479a51a1` · `pages/api/active-leads/lifecycle.ts` `249e2ac3943b305e` · `pic1Phase1RetentionAndLifecycleGuards.test.ts` `4a76e0c0155bb934` · `ret_retention_pre_exclusion.test.ts` `23881754548d62b3`.

### 1.1 Current implementation verified, not assumed from earlier reports

As required, each claim was traced to the code as it stands today rather than to a previous report's line numbers:

| Symbol | Current location |
|---|---|
| `LifecycleEvidenceUnavailableError` | `opportunityLifecycleService.ts:47` |
| `LifecycleUnreadableReason` | `:57` |
| `LifecycleReadResult` | `:75` |
| `readCurrentLifecycleState` | `:94` |
| `isResolvedForAccountDeletion` | `:153` |
| `initialiseLifecycleForOpportunity` | `:161` |
| `transitionLifecycle` | `:244`, with the no-default comment at `:250` |
| `classifyLifecycleGuardError` | `lifecycleGuardErrors.ts:69` |
| `isAuthorizationRefusal` | `:84` |

---

## 2. Isolation proof and connection method

| | |
|---|---|
| Container name | `l21-lifecycle-<pid>`; pre-existence checked, and the script **refuses** rather than reuse or force-remove |
| **Full container id** | **`19727938442deefb2575980f3bd2a1474d9acbf3ff10f5e4a72291fce03f0866`** |
| Image / server | `pgvector/pgvector:pg17` → **PostgreSQL 17.11** |
| Restart policy | **`no`**, read back from `docker inspect` |
| **Actual host-side binding** | **`127.0.0.1:60875`**, asserted **before connecting**; a non-loopback binding would have removed the container and stopped |
| Credentials | throwaway (`POSTGRES_PASSWORD=throwaway`, db `l21`); **no production hostname or credential, and no credential value appears here** |
| Created by this run | **yes** — nothing pre-existing was treated as disposable |

**Two connection methods, both recorded.** Provisioning and inspection ran through `docker exec <container-id> psql` — no hostname, no connection string, so it cannot resolve elsewhere. The suite itself connected as `pg.Client` over TCP to `127.0.0.1:60875` via `W6_DB_URL`.

**Three independent guards against selecting a shared database:** `setup.ts`'s existing `FORBIDDEN` regex refusing managed hosts; **a loopback guard added inside the new suite** that throws unless `W6_DB_URL` matches `@(127.0.0.1|localhost|[::1]):port/`; and provisioning that never takes a hostname at all.

**`cert-supabase` was never connected to, modified, stopped or removed** — 11 containers before, 11 after, 11 total running at the end.

---

## 3. Migrations replayed

Mechanism: steps 1–3 of the repository's own `scripts/ci/real-schema-ci.sh` — bootstrap (`scripts/ci/schema-bootstrap.sql`), the committed baseline (`supabase/_schema/baseline.sql`), then every migration above ledger position `20260916000000`. Step 4 (the full suite) was not part of provisioning.

**Verified before replay:** every statement is issued through `docker exec <container-id>`, so no environment-selected database configuration participates and no shared or production target is reachable.

| | |
|---|---|
| Baseline restore | **125 s**, **0 unexpected errors** (only `already exists` collisions, which the bootstrap necessarily causes, are tolerated and anything else is asserted to be zero) |
| Public tables | **823** |
| **Migrations replayed** | **52 of 52, all `ok`, 0 FAILED**, in **179 s** |

**No migration was edited or skipped**, and none failed to apply idempotently.

---

## 4. Schema, triggers, roles and RLS — asserted inside the suite

These are not prose claims; three tests assert them, so a change to any of them fails the suite:

| Fact | How asserted |
|---|---|
| `opp_lifecycle_block_delete` and `opp_lifecycle_block_update` both exist, are `BEFORE`, **row-level**, and `tgenabled='O'` | queried from `pg_trigger` / `pg_class` |
| The lifecycle→parent FK is `ON DELETE CASCADE` (`confdeltype='c'`) | queried from `pg_constraint` in L6 |
| **The effective role is a superuser** | `rolsuper = true` asserted, which is *why* the privilege scenarios switch role |
| **RLS is enabled** on `opportunity_lifecycle_states` and `prospect_lifecycle_transitions` | `relrowsecurity = true` for both |

**Role handling, and why it is necessary.** The suite connects as `postgres`, a superuser, which bypasses every privilege check — so **a query succeeding as that role proves nothing about a permission boundary**. L8 and L11 therefore create a per-scenario role and switch with `SET LOCAL ROLE`.

That role is created **`BYPASSRLS`** deliberately: with RLS enabled and no policy for the role, a read would return **zero rows instead of raising**, silently turning a permission test into an empty-result test. The bypass removes that confound and matches production, where the service role bypasses row-level security, so the **privilege** boundary is the one that actually governs these reads. **No RLS policy was created, modified or inspected for bypass purposes**, and policy-restricted RLS behaviour remains out of scope.

**The four conditions the brief warns against conflating are kept apart explicitly:** a PostgreSQL permission error (L8b, L11 — `42501` + "permission denied"), an RLS policy returning zero rows (**avoided** via `BYPASSRLS`, and never claimed as a permission result), a guard-trigger refusal (L4–L7 — `P0001` + the append-only marker; L8a — `42501` + the marker), and a valid empty result (L2, L10a — `{kind:'missing'}`).

---

## 5. The new suite

| | |
|---|---|
| Path | **`backend/tests/realschema/pi_lifecycle_b21.test.ts`** |
| SHA-256 | **`fa767658ebbea3f533c08591bf904a3147a0d07f83d0bfd801ac9efc087affc6`** |
| Lines | **772** · control bytes clean |
| Tests | **28**, in 11 `describe` groups |

**Conventions followed:** the existing `jest.realschema.config.js` project (no config change needed), `db` / `inRollback` / `seedTenants` / `newLead` / `ORG_A` / `ORG_B` from `./setup`, the `pi_` naming prefix, unique `c1fec1fe-…` fixture identifiers, and rollback-per-scenario.

**The seam, and why it is unavoidable.** The lifecycle service reaches the database through `ownedDbTable`, which speaks the Supabase/PostgREST builder dialect over HTTP; a `pg` client cannot answer that. The suite replaces **only that seam** with a translator emitting real SQL on the real client — the same technique as `pl_prospect_lists.test.ts` and `dl_relationship_decisions.test.ts`. **No lifecycle decision is reimplemented**: `readCurrentLifecycleState`, `transitionLifecycle`, `initialiseLifecycleForOpportunity`, `isResolvedForAccountDeletion` and `classifyLifecycleGuardError` all run from their shipped modules. The translator is deliberately smaller than the retention one — it implements only `select/insert/eq/order/limit/maybeSingle/single`, the shapes this service actually issues.

Each statement gets its own SAVEPOINT because in production each `ownedDbTable` call is its own request, so one refusal must not poison the next; inside `inRollback`'s single transaction it otherwise would.

---

## 6. Scenario outcomes

| ID | Scenario | Expected | Actual | Status |
|---|---|---|---|---|
| **L1** | Valid initial history via the supported path (`initialiseLifecycleForOpportunity`) | correct state read back; nothing fabricated | `present / detected / isInitial=true`; **exactly one row** with `previous_state=null`, `is_initial=true`, `organization_id=ORG_A`; re-initialisation is idempotent (still one row); `detected` does **not** resolve an account-deletion block | **VERIFIED AGAINST POSTGRESQL** |
| **L2** | Missing history for an existing opportunity | no silent `detected`; distinct error; no write | read is **`{kind:'missing'}`**, explicitly not `detected`; `transitionLifecycle` rejects with **`LifecycleEvidenceUnavailableError`**, `reason='missing'`; **row count stays 0** — the refusal did not create the history it lacked | **VERIFIED AGAINST POSTGRESQL** |
| **L3** | Valid subsequent transition | state/history, tenant attribution, append-only evidence | returned record `{state:'triaged', previous_state:'detected', organization_id:ORG_A}`; **two rows**, the initial one unchanged; read returns `triaged / isInitial=false`; a transition to `archived` **does** resolve the deletion block | **VERIFIED AGAINST POSTGRESQL** |
| **L3b** | *(new)* Current-state ordering has no tiebreaker | — | **See §7 — a product defect found by this suite** | **VERIFIED AGAINST POSTGRESQL (defect recorded, not fixed)** |
| **L4** | Append-only UPDATE refusal | expected SQLSTATE + marker; row unchanged | **`P0001`**, message matches `/append-only/i`; the row's `state` is still `detected` | **VERIFIED AGAINST POSTGRESQL** |
| **L5** | Append-only DELETE refusal | expected SQLSTATE + marker; evidence intact | **`P0001`** + marker; the row survives | **VERIFIED AGAINST POSTGRESQL** |
| **L6** | Parent deletion with lifecycle evidence — **measured, not assumed** | measure the guard's actual behaviour | FK confirmed `ON DELETE CASCADE`; the parent delete is **refused with `P0001`** + marker; **parent and lifecycle row both survive**. A parent with **no** lifecycle evidence **deletes cleanly**, which bounds the refusal to the protected case | **VERIFIED AGAINST POSTGRESQL** |
| **L7** | `P0001` classification | recognised only with the marker | a **real** guard error object is passed to `classifyLifecycleGuardError` → `{kind:'append_only_violation', sqlstate:'P0001'}`, and `isAuthorizationRefusal` is `false`. A **real** unrelated `P0001` (`DO $$ … RAISE EXCEPTION 'unrelated business rule failed' … $$`) classifies as **null** — proving the code alone is not sufficient | **VERIFIED AGAINST POSTGRESQL** |
| **L8** | `42501` classification | marked = append-only; unmarked = genuine permission error | **Marked:** a real refusal from the PI ledger guard gives `42501` + marker → `append_only_violation`, `isAuthorizationRefusal=false`, and the row's state is unchanged. **Unmarked:** a real privilege denial gives `42501` + "permission denied", **no** marker → classifier **null**, `isAuthorizationRefusal=true`. A third test asserts both guards side by side: `P0001 ≠ 42501`, yet **both** reach `append_only_violation` | **VERIFIED AGAINST POSTGRESQL** |
| **L9** | HTTP response classification | only where existing route conventions support it | **NOT RUN.** Verified: **no real-schema test exercises a `pages/api` route** (zero matches), and **the lifecycle route is untested anywhere in the repository** (zero matches for `active-leads/lifecycle` under `backend/tests/`). Testing it would mean **inventing a new convention**, not following one, and the route's `enforceCompanyAccess` / `getUserRole` / capability chain would need mocks that no real-schema suite establishes. The route's 409 branches remain **source-inspected only** | **NOT RUN** |
| **L10** | Tenant isolation at read, transition and mutation boundaries | cannot cross tenants; negative controls | a read for `ORG_A` against `ORG_B`'s opportunity returns **`{kind:'missing'}`** while `ORG_B`'s own read is `present`; a transition under the wrong tenant is **refused** and the row count is unchanged. **Mutation boundary measured** — see §7 | **VERIFIED AGAINST POSTGRESQL** |
| **L11** | Genuine read failure | not turned into a valid initial state; no unintended write | with `SELECT` revoked, the read is **`{kind:'unreadable', reason:'read_failed'}`**, explicitly **not** `missing`, and does not resolve deletion. With `SELECT` refused but **`INSERT` granted** — so a premature write would be visible — the transition is **refused** with `reason='read_failed'` and the row count is **unchanged** | **VERIFIED AGAINST POSTGRESQL** |

---

## 7. Two findings, measured and not fixed

### 7.1 Current-state ordering has no tiebreaker — a product defect

**How it surfaced.** L3 failed on the first run: after a successful transition to `triaged`, `readCurrentLifecycleState` returned **`detected` / `isInitial=true`** — the *initial* row, not the latest.

**Diagnosis, confirmed empirically in the disposable database:**

| Measurement | Result |
|---|---|
| Distinct `now()` values across two inserts in one transaction | **1** (for 2 rows) — `now()` is the transaction timestamp; `clock_timestamp()` would have given 2 |
| Ordering columns on `opportunity_lifecycle_states` | only `transitioned_at`; the PK is a **random uuid**; **zero identity/sequence columns** |
| Ordering columns on `prospect_lifecycle_transitions` | **`seq`, `is_identity = YES`** |

`readCurrentLifecycleState` derives current state from `ORDER BY transitioned_at DESC LIMIT 1`, and the migration says so explicitly. With no secondary key, **that ordering is not total**: when two rows share `transitioned_at`, which row is "current" is undetermined.

**Severity and reachability, stated honestly.** In production each `ownedDbTable` call is its own PostgREST request, hence its own transaction, so timestamps normally differ at microsecond resolution — the defect is **LATENT, not active**. But any path that performs two transitions within one transaction (a future batch operation, or a plpgsql function) would hit it **deterministically**, and the PI sibling ledger demonstrates that the repository already knows the fix: a monotonic `seq`.

**What was done.** **No product code was changed.** L3's fixture now seeds the initial row with an explicitly earlier `transitioned_at`, which reproduces production ordering rather than a tie that does not occur there. To ensure the fix does not *hide* the finding, **L3b asserts the structural facts** — that the Community ledger has zero identity columns while the PI one has `seq`; that `now()` ties within a transaction; and that two secondary orderings over a tie return **different** rows, which is what "not a total order" means. L3b asserts the ambiguity, never the buggy outcome, so it stays true until the gap is closed and **starts failing the moment it is** — the signal to revisit.

**Minimum additional authorization required to fix it:** a migration adding a monotonic ordering column to `opportunity_lifecycle_states` (e.g. `seq bigint GENERATED ALWAYS AS IDENTITY`, mirroring the PI ledger), **plus** a product change to `readCurrentLifecycleState` and `getLifecycleBoardCounts` to order by it. That is **a schema change and a product change**, both outside this task.

### 7.2 The schema does not prevent a cross-tenant lifecycle citation

Measured rather than assumed, as the brief required. `opportunity_lifecycle_states` carries **separate** foreign keys to `companies` and to `opportunity_feed_items`, and the suite asserts that the table has **zero multi-column foreign keys**. Inserting a lifecycle row with `organization_id = ORG_A` citing `ORG_B`'s opportunity **succeeded** — the database did not refuse it.

**Consequence:** tenant correctness at this boundary rests entirely on the application predicate, which L10's first two tests exercise. This is **not** a regression introduced by Phase 1; it is a pre-existing schema property, now recorded with an assertion that will fail if a composite key is ever added. The PI ledger, by contrast, uses a **composite** tenant foreign key — the same divergence as §7.1.

---

## 8. A correction I owe

My previous two reports (`PI-C1-PHASE-1-F1-F2-REMEDIATION-001` §5 and `PI-C1-PHASE-1-RETENTION-REGRESSION-001` §6) stated that `scripts/ci/real-schema-ci.sh` **"exits 0 even when the suite fails"**, and used that to justify invoking jest directly.

**That claim is wrong for the current script.** Read directly:

- `set -euo pipefail` at line 21; the only `set +e` / `set -e` pair is around the baseline restore (lines 143/145), so `set -e` is **active** at the jest invocation.
- The script ends with `SUITE_STATUS=$?` and **`exit $SUITE_STATUS`**.

So a failing suite fails the script by **either** path. Invoking jest directly remains good practice for reading exact counts, but the stated reason was inaccurate. The controlling reports are left unedited; this is the correction of record.

---

## 9. CI discovery — read-only inspection

| Question | Finding |
|---|---|
| Does CI discover the new file automatically? | **YES**, by two independent globs |
| Workflow trigger | `.github/workflows/real-schema-ci.yml` triggers on paths including **`backend/tests/realschema/**`** (lines 21 and 41), plus `jest.realschema.config.js` and the workflow itself |
| Test discovery | the job runs `bash scripts/ci/real-schema-ci.sh`, whose step 4 runs `npx jest --config jest.realschema.config.js`, whose `testMatch` is **`<rootDir>/backend/tests/realschema/**/*.test.ts`** |
| Registry or allow-list entry needed? | **No.** Discovery is purely glob-based — no verification-registry entry, no config change |
| Does a failure fail the job? | **Yes** (§8). The workflow comments state there is no `continue-on-error` anywhere by design |
| Both new suites included | **Yes** — `pi_lifecycle_b21.test.ts` and `ret_retention_pre_exclusion.test.ts` both match both globs |

**Nothing in CI or any registry was modified.**

---

## 10. Commands, exit codes and results — including the failure

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `bash <scratchpad>/l21-provision.sh` | **0** | container created; binding `127.0.0.1:60875`; **823** tables; **52/52** migrations; restore 125 s, replay 179 s |
| 2 | `node ./node_modules/jest/bin/jest.js --config jest.realschema.config.js --runInBand --forceExit --testPathPattern 'pi_lifecycle_b21'` | **1** | **FAILED — 2 of 25.** Both failures in L3: after a successful transition the read returned `detected`/`isInitial=true` instead of `triaged`/`false`, and the `archived` case likewise returned `detected` |
| 3 | Diagnostic queries in the disposable database | — | confirmed the cause: `now()` constant in a transaction; **no identity column** on the Community ledger; `seq` present on the PI ledger (§7.1) |
| 4 | same as #2, after a **test-file-only** correction | **0** | **1 suite / 28 tests — 28 passed**, 5.4 s |
| 5 | `node ./node_modules/jest/bin/jest.js --config jest.realschema.config.js --runInBand --forceExit` (whole project) | **0** | **39 suites / 881 tests — all passed**, 142 s |
| 6 | `node ./node_modules/jest/bin/jest.js backend/tests/unit/pic1Phase1RetentionAndLifecycleGuards.test.ts --runInBand --forceExit` | **0** | **1 suite / 56 tests — 56 passed** |

**The failure is reported, not omitted.** The fix was confined to the **new test file**: L3's fixture now seeds the initial row with an earlier timestamp, and L3b was added to record the underlying defect. **No product code, migration or existing test file was changed to make an assertion pass.**

**Regression value, measured:** the real-schema project was **38 suites / 853 tests** before and is **39 suites / 881 tests** after — this suite's 28 tests, with **zero** interference in the other 38.

**Relevant tenant/isolation coverage** ran inside #5, which includes `ti_authenticated_tenant_isolation.test.ts` and the rest of the project. No unbounded full-app suite was launched.

**A successful test run is not independent review.** The same agent implemented Phase 1, wrote these tests, found both findings and wrote this report.

---

## 11. Cleanup evidence

| Check | Result |
|---|---|
| Container removed | `docker rm -f 19727938442deefb2575980f3bd2a1474d9acbf3ff10f5e4a72291fce03f0866` — **by full id**, never by name, wildcard or port |
| Exact container gone | `docker inspect` → **confirmed absent**; no `l21-lifecycle` container remains |
| `cert-supabase` | **untouched** — 11 before, 11 after; 11 total running |
| Reserved fixtures | after all 39 suites: `c1fec1fe` feed rows **0**, `pi-lifecycle-b21` signals **0**, opportunity lifecycle rows **0**, prospect lifecycle rows **0** |
| Temporary roles | `lc_restricted` **0**, `ret_restricted` **0** — every `CREATE ROLE` was inside a rolled-back transaction |
| Temporary files | provisioning script, container-id, db-url and scratch logs **removed**; two evidence logs retained for this report |
| Broad cleanup commands | **none** — no prune, no globbing, no port matching |

---

## 12. Final state

| Check | Result |
|---|---|
| All Phase 1 implementation files | **byte-identical** to §1 |
| `ret_retention_pre_exclusion.test.ts` (previous task's suite) | **byte-identical** (`23881754548d62b3`) |
| All five evidence reports | **unchanged** |
| Existing test files / migrations | **none changed.** The ` M` entries under `backend/tests/realschema/` and `supabase/` were already in the start-of-task inventory |
| CI / registry | **untouched** |
| HEAD | **`29fea38a…` unchanged** |
| Working tree | **158 → 159**; the only new entry is `?? backend/tests/realschema/pi_lifecycle_b21.test.ts`; **no pre-existing entry lost** |
| Commits / deployments | **none** |

---

## 13. Time ledger

| | |
|---|---|
| Start / end | **2026-10-18T16:26:51** → **16:39:40 +05:30 (IST)** |
| **Wall-clock** | **12 min 49 s** |
| **Machine time** | **≈ 10 min 20 s** — provisioning 5 min 4 s (restore 125 s + replay 179 s), whole-project run 142 s, suite runs 19 s + 5 s, unit suite ≈ 15 s, inspection and teardown ≈ 30 s |
| **Active engineering** | **≈ 5 min** |
| External waiting | **none** inside this task |
| Human engineer-days | **not consumed by agent wall-clock**; no substitution. Frozen baseline unchanged: Milestone A′ **2026-11-25 / 28.5 d**, WP-7 **2026-11-17 / 4.0**, C-1 **8–12**, **OVERRUN RISK still raised with zero float at the high estimate**, next checkpoint **Friday 2026-10-23**. **No float claimed recovered** |

---

## 14. Checks not run and residual uncertainty

| Item | Status |
|---|---|
| **L9 HTTP response classification** | **NOT RUN** — no route-level convention exists in the real-schema project and the lifecycle route is untested anywhere; the 409 branches remain source-inspected only |
| **Fixing §7.1 (ordering tiebreaker)** | **NOT RUN** — needs a migration **and** a product change; §7.1 states the minimum authorization |
| **Fixing §7.2 (cross-tenant citation)** | **NOT RUN** — would need a composite tenant foreign key, i.e. a migration |
| Policy-restricted RLS behaviour | **NOT RUN** — out of scope; §4 explains why it would confound the privilege tests |
| `lifecycleWriter.translate()` end-to-end | **UNIT-TESTED ONLY** — `translate` is not exported, so L8 exercises the classifier at the boundary instead; the writer's mapping is covered by `piWscProspectLifecycleWriter.test.ts` |
| `getLifecycleBoardCounts`, `listLifecycleHistory` | **NOT RUN** — outside the stated scope; note `getLifecycleBoardCounts` shares the §7.1 ordering weakness |
| Retention scale and the 10 000-id batch | **NOT RUN** — separate work package |
| Production behaviour | **UNVERIFIED**, and nothing here speaks to it. A green run on a replayed disposable schema is **not** evidence that any migration is applied in production |
| Independent review | **NOT RUN** |

**Residual uncertainty.** §7.1's production reachability is a judgement, not a measurement: the defect is proven in a single transaction and argued latent across separate ones, because microsecond-resolution collisions were not tested. §7.2 is a current schema property and could change under a future migration — both are pinned by assertions that will fail if they do.

---

## 15. Status

| Item | Status |
|---|---|
| Durable lifecycle/B21 real-schema suite | **IMPLEMENTED** — `pi_lifecycle_b21.test.ts`, 772 lines, `fa767658…ffc6` |
| L1 initial history · L2 missing history · L3 valid transition | **VERIFIED AGAINST POSTGRESQL** |
| L4 UPDATE refusal · L5 DELETE refusal · L6 parent deletion (measured) | **VERIFIED AGAINST POSTGRESQL** |
| L7 `P0001` classification · L8 `42501` classification, both marked and unmarked | **VERIFIED AGAINST POSTGRESQL** |
| L10 tenant isolation · L11 read failures fail closed | **VERIFIED AGAINST POSTGRESQL** |
| **L3b ordering tiebreaker defect** | **VERIFIED AGAINST POSTGRESQL — defect recorded, NOT fixed** |
| Cross-tenant lifecycle citation | **VERIFIED AGAINST POSTGRESQL — pre-existing schema property recorded** |
| L9 HTTP classification | **NOT RUN** |
| Real-schema project regression | **VERIFIED** — 39/39 suites, 881/881 tests |
| Phase 1 unit suite | **VERIFIED** — 56/56 |
| CI discovery of both new suites | **VERIFIED** — glob-based, no registry entry needed, failures propagate |
| Production behaviour | **UNVERIFIED** |
| Independent review | **NOT RUN** |
| Phase 2 · Q3 · v0.3 | **UNAUTHORIZED · BLOCKED · NOT RATIFIED** |

**Nothing was committed or deployed. Phase 2 remains unauthorized, Q3 remains blocked, v0.3 remains unratified, and the frozen schedule baseline and overrun status are unchanged.**
