# PI-C1-PHASE-1-PG-VERIFICATION-001 — isolated PostgreSQL verification attempt

**Verification only.** No repository implementation or test file changed. No migration created, applied or replayed. No schema change. No database write. No production access or provider call. No commit, push, merge or deployment. No existing container modified or stopped.

> ## Headline
>
> **The retention pre-exclusion and per-item outcome behaviour was NOT verified against PostgreSQL.** Every case in the required evidence matrix needs either a schema (migration replay or DDL), fixture rows (`INSERT`), or an actual `DELETE` — none of which this authorization permits. That blocker was **tested, not assumed**: a freshly created disposable `pgvector/pgvector:pg17` container was confirmed to hold **0 public tables** and none of the five tables the implementation touches.
>
> **Source inspection did, however, find two real defects** that the passing unit suite does not catch (§6). One of them means the matrix case *"unexpected query result or exception → behaviour fails closed"* is **not satisfied** on two of three read paths.

---

## 1. Baseline fingerprints and source hashes

Measured **2026-10-18T04:34:02+05:30 (IST)**.

| | Value |
|---|---|
| Repository / branch | `C:/tmp/r1-ctx` · `fix/r1-profile-context` |
| HEAD at start and end | **`29fea38a2d1642c1c2fd957e5151f6be81415774`** — unchanged |
| Working tree at start | **153 entries (72 M / 81 ??)**, inventory captured before any action |
| Working tree at end | **154 entries** — the delta is **only this report** |

**Hash gate:** `docs/pmo/prospect-intelligence/PI-C1-PHASE-1-IMPLEMENTATION-001.md` = `953adb5e53185a83a31f81a445f71288fefcf61dc97f5fc9f7ab2c4f2fb25131` — **MATCH**, so the implementation report is the one this task was scoped against.

Phase 1 implementation files, re-hashed at start and **unchanged at end**:

| File | SHA-256 (16) |
|---|---|
| `backend/services/lifecycleGuardErrors.ts` | `d63e5165d127e75b` |
| `backend/types/retention.ts` | `60e9c05a8906fd8a` |
| `backend/services/retentionService.ts` | `ed0d5f59a452f5e2` |
| `backend/services/opportunityLifecycleService.ts` | `40bb4453ff14f4ca` |
| `backend/services/prospectLifecycle/lifecycleWriter.ts` | `fde7e56c479a51a1` |
| `pages/api/active-leads/lifecycle.ts` | `249e2ac3943b305e` |
| `backend/tests/unit/pic1Phase1RetentionAndLifecycleGuards.test.ts` | `cdbc648629c9299b` |

Nothing was cleaned, reset, stashed, overwritten or reformatted.

---

## 2. Isolation evidence and the actual connection target

### 2.1 Pre-existing environment, inspected and left alone

`docker ps` showed **11 running containers, all belonging to the `cert-supabase` stack** (studio, pg_meta, storage, rest, realtime, inbucket, auth, kong, vector, analytics, db — most "Up 2 days"). **None was created by this run, so none was touched.** No `docker rm`, `stop`, `restart` or configuration change was issued against any of them, and no container was ever addressed by a broad name, wildcard or port association.

**`cert-supabase` was deliberately NOT used as the verification target**, even though it has a populated schema. It is a persistent, shared local stack that other work depends on; this task's permitted read-only queries are scoped to *"that disposable database"* — the one this run creates — and the stop conditions include *"a production or shared database might be reached"*. Using it would also have meant relying on a credential this task is not authorized to handle. Treating it as disposable because its name resembles a test stack is exactly the inference the brief forbids.

### 2.2 The disposable container actually created

| | |
|---|---|
| Name | `pgv-phase1-<pid>` — unique per invocation |
| Image | `pgvector/pgvector:pg17` |
| Created by this run? | **Yes.** A pre-existence check ran first and would have refused rather than reuse or force-remove anything |
| Restart policy | `--restart no` |
| Publish request | `127.0.0.1::5432` — loopback only, port chosen by Docker |
| **Actual observed binding** | **`127.0.0.1:52043`**, read back from `docker port` and asserted **before connecting**. Had it not matched `127.0.0.1:*` the run would have removed the container and stopped |
| Credentials | throwaway (`POSTGRES_PASSWORD=throwaway`, db `pgv`). **No production hostname or credential was used, and no credential value is reproduced here** |
| Server | `PostgreSQL 17.11 (Debian 17.11-1.pgdg12+2)` |

**A note on how loopback was asserted.** `inet_server_addr()` returned **empty**, because `docker exec psql` connects over the container's unix socket. That is why the assertion was made on the **client-side published binding** (`docker port`), which is what actually governs reachability, rather than on a server-side function that cannot see it.

---

## 3. Everything actually executed

| # | Command / query | Result |
|---|---|---|
| 1 | `sha256sum` on the implementation report and 7 implementation files | all match §1 |
| 2 | `git rev-parse` / `git status --porcelain` (before and after) | HEAD unchanged; inventory preserved |
| 3 | `docker ps` (before) | 11 `cert-supabase` containers |
| 4 | `docker ps -a \| grep -E 'ad1-\|pgv-'` | **none** — no stale container from earlier work |
| 5 | `docker inspect <name>` pre-existence check | absent, so creation was safe |
| 6 | `docker run -d --name pgv-phase1-<pid> --restart no … -p 127.0.0.1::5432 pgvector/pgvector:pg17` | container created |
| 7 | `docker port <id> 5432/tcp` | **`127.0.0.1:52043`** → loopback assertion **PASS** |
| 8 | `pg_isready` poll | ready after 10 s |
| 9 | `select current_database()\|\|' @ '\|\|inet_server_addr()…` | empty (unix socket — see §2.2) |
| 10 | `select version()` | `PostgreSQL 17.11 …` |
| 11 | **`information_schema.tables` probe for the 5 required tables** (read-only) | **`retention_policies` 0 · `retention_executions` 0 · `opportunity_feed_items` 0 · `opportunity_lifecycle_states` 0 · `alerts` 0** |
| 12 | `select count(*) from information_schema.tables where table_schema='public'` | **0** |
| 13 | `docker rm -f <exact id>` | removed (§8) |
| 14 | `docker ps \| grep -c cert-supabase` (after) | **11** — unchanged |
| 15 | Existing targeted jest suites (files unmodified) | **2 suites / 81 tests — 81 passed** |
| 16 | Source inspection of every `ownedDbTable` call, predicate and error path in `retentionService.ts` | §5, §6 |

**No `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, `GRANT` or migration was executed anywhere.** Queries 9–12 are the only database statements issued, all `SELECT`, all against the disposable container.

---

## 4. Expected versus observed

| Expectation | Observed | Verdict |
|---|---|---|
| A disposable container can be created, bound to loopback, and asserted before use | created; binding `127.0.0.1:52043`; asserted | **PASS** — the isolation path itself is proven sound and ready |
| A fresh container has the schema the implementation needs | **0 public tables; 0 of 5 required tables** | **As feared — this is the blocker** |
| The pre-existing stack is unaffected | 11 → 11 containers, none touched | **PASS** |
| Existing unit evidence still holds | 81/81 | **PASS** (unit-level only) |

**So the schema gap is measured, not presumed.** The implementation reads `retention_policies`, writes `retention_executions`, and reads/deletes `opportunity_feed_items` while probing `opportunity_lifecycle_states`. With zero tables present, not one of those paths can execute. Creating them is DDL; populating them is `INSERT`; observing exclusion requires `DELETE` — all three outside this authorization.

---

## 5. Required evidence matrix

**Basis column is explicit, per the brief: no conclusion below is attributed to PostgreSQL execution, because none occurred.**

| Case | Required property | Status | Basis | Why it needs writes |
|---|---|---|---|---|
| Protected child exists | Parent excluded from deletion | **NOT RUN — ADDITIONAL AUTHORIZATION REQUIRED** | — | Needs a schema, a parent row, a protected child row, and a delete attempt |
| Eligible parent exists | Eligibility established by the actual predicate | **NOT RUN** (predicate itself **VERIFIED BY SOURCE INSPECTION**) | source | Needs rows older than the cutoff to exist |
| Mixed protected + eligible batch | Protected excluded; eligible not silently lost | **NOT RUN — ADDITIONAL AUTHORIZATION REQUIRED** | — | Needs ≥2 parents, 1 child, and a real `DELETE` to see whether the statement aborts |
| Probe fails / unreadable | **No deletion attempted** | **VERIFIED BY SOURCE INSPECTION** + **UNIT-TESTED ONLY** | source + double | PostgreSQL proof would need an induced read failure (e.g. `REVOKE`) = DDL |
| Per-item deletion failure | Failed item not reported as deleted | **VERIFIED BY SOURCE INSPECTION** + **UNIT-TESTED ONLY** | source + double | Needs a real failing `DELETE` |
| Confirmed deletion | `rows_affected` reflects only confirmed deletions | **VERIFIED BY SOURCE INSPECTION** + **UNIT-TESTED ONLY** | source + double | Needs a real `DELETE` returning a count |
| Retry | Prior outcomes not misrepresented; already-resolved truthful | **UNIT-TESTED ONLY** | double | Needs two successive real runs over real rows |
| Cross-tenant record | Protection not inferable from another tenant's rows | **VERIFIED BY SOURCE INSPECTION** + **UNIT-TESTED ONLY** — **but see finding F-1** | source + double | Needs two tenants' rows |
| Empty batch | No unintended database operation | **VERIFIED BY SOURCE INSPECTION** | source | — guard conditions are statically checkable |
| Unexpected result or exception | **Behaviour fails closed** | **PARTIALLY SATISFIED — FINDING F-2.** The protection probe fails closed; **the scan and candidate-select do NOT** | source | — defect is visible in source |

**Nothing in this table is marked verified against PostgreSQL. No result was fabricated for a case that could not be exercised.**

### 5.1 What source inspection did establish

Read directly from `retentionService.ts` as it now stands:

| Question | Finding |
|---|---|
| Exact protection predicate | `ownedDbTable(child.table).select(child.parent_column).eq('organization_id', orgId).in(child.parent_column, ids)` — a reverse lookup on the child's FK, with no join |
| Identifiers used | `RETENTION_PROTECTED_CHILDREN` declares `{ table: 'opportunity_lifecycle_states', parent_column: 'opportunity_feed_item_id' }`; parent ids are the target's own `id` |
| Tenant scoping of **reads** | Policy load, scan count, candidate select and protection probe **all** carry `.eq('organization_id', …)` — **4 of 4** |
| Tenant scoping of **deletes** | **NEITHER delete carries it — see F-1** |
| Unreadable / failed probe | `findProtectedIds` returns `{ probeFailed }` on `error`; the caller sets `status='failed'`, writes `detail='protection_probe_failed:…'`, marks every candidate `failed/protection_undetermined`, and **skips the delete branch entirely** |
| Eligible vs excluded classification | `eligible = candidateIds.filter(id => !protectedIds.has(id))`; every id in `protectedIds` is emitted as `excluded_protected/append_only_child_present` |
| `rows_affected` derivation | Only from a database-reported count: the batch `count` on success, or the per-item `count` when `> 0`. A `count` of 0 becomes `already_absent`, never `deleted` |
| Status consistency | Recomputed from the outcomes themselves (`tally()`), so `completed` is impossible when anything was excluded or failed |
| **Can any error path proceed to deletion?** | **No.** `if (probeFailure) … else if (execute) … else if (dry_run) …` makes the failure arm mutually exclusive with the delete arm; and the delete is further guarded by `candidateIds.length > 0` and `eligible.length > 0` |

---

## 6. Two findings from source inspection

Both are **product-code changes, which this task is not authorized to make.** Neither is fixed here.

### F-1 — the `DELETE` statements carry no tenant predicate

```
.delete({ count: 'exact' }).in('id', eligible)     // batch
.delete({ count: 'exact' }).eq('id', id)           // per-item
```

Neither includes `.eq('organization_id', input.organizationId)`.

- **Severity: defence-in-depth, not an open cross-tenant hole.** The ids come from a tenant-scoped select, and they are uuid primary keys, so a cross-tenant id cannot realistically enter the list.
- **But the honest attribution matters:** the missing predicate is **pre-existing** in the batch delete, and **this Phase 1 work propagated the same pattern into the new per-item fallback.** The four read paths are all tenant-scoped; the two write paths are not.
- Minimal fix: add the organization predicate to both deletes. One line each.

### F-2 — two read failures are reported as a clean, complete run

```
const { count: scannedCount } = await ownedDbTable(binding.table).select(…)   // `error` not destructured
const { data: pks }           = await ownedDbTable(binding.table).select('id') // `error` not destructured
```

If either read fails, `rowsScanned` becomes `0` or `candidateIds` becomes `[]`. Control flow then skips every branch that could record a problem, and the run is stored as **`status='completed'`, `rows_affected=0`, no outcomes** — indistinguishable from "there was nothing to do."

- This is **pre-existing**, and Phase 1 did not introduce it — but Phase 1 **did not fix it either**, while adopting "never report a failure as success" as an explicit goal for deletions. The same standard is not met for reads.
- It also makes the matrix case *"unexpected query result or exception → fails closed"* **unsatisfied**: the probe fails closed, the two older reads fail **open and silent**.
- **Why the unit suite misses it:** the double supports per-table failure injection, but no test injects a failure on the *target* table's select — confirmed by searching the suite for `db.failures['opportunity_feed_items']` and `db.failures['alerts']`: **no matches**.
- Minimal fix: destructure and check `error` on both reads and fail closed, plus two tests injecting those failures.

---

## 7. Basis of every conclusion

| Basis | What rests on it |
|---|---|
| **PostgreSQL execution** | **Only** these: a disposable container can be created and asserted loopback-bound; the server is PostgreSQL 17.11; a fresh container holds **0 public tables and none of the 5 required**. **No retention or lifecycle behaviour.** |
| **Source inspection** | The eight contract answers in §5.1, and findings F-1 and F-2 |
| **Test double (unit)** | The 45 Phase 1 tests and the 81 re-run tests. The double reproduces the append-only guard's `P0001` on a cascade, which matches probes P2/P7 — but **it is not PostgreSQL**, and SQL a double accepts is not proof PostgreSQL behaves identically |
| **Not established at all** | Any claim that the pre-exclusion works against a real schema; anything about the production database |

**This is also not independent verification.** The same agent implemented Phase 1, wrote its tests, and performed this check. A separate execution by the same agent is not a second reader.

---

## 8. Cleanup evidence

| Check | Result |
|---|---|
| Container removed | `docker rm -f <exact 64-char id>` — **by id, never by name** |
| Removed id no longer exists | `docker inspect` → **confirmed absent** |
| Any `pgv-` container left | **none** |
| `cert-supabase` stack after | **11 containers, unchanged** |
| Temporary files | only `pgv-container-id` in the session scratchpad, **removed**; nothing temporary was written inside the repository |
| Repository files | **no implementation or test file changed** — all 7 hashes identical to §1 |
| HEAD | **`29fea38a…` unchanged**; nothing committed |
| Working tree | 153 → 154 entries; **the single new entry is this report**; no pre-existing modified or untracked entry altered or lost |

---

## 9. Time ledger

| | |
|---|---|
| Start | **2026-10-18T04:34:02+05:30 (IST)** |
| End | **2026-10-18T04:38:30+05:30 (IST)** |
| **Wall-clock** | **≈ 4 min 28 s** |
| **Machine time** | **≈ 1 min 13 s** container create + ready + queries + removal; **≈ 25 s** jest |
| **Active engineering** | **≈ 3 min** |
| External waiting | none inside this task |
| Agent wall-clock vs human engineer-days | kept **separate**; no substitution. The frozen baseline is untouched (Milestone A′ **2026-11-25 / 28.5 d**, WP-7 **2026-11-17 / 4.0**, C-1 **8–12**, **OVERRUN RISK still raised with zero float at the high estimate**, next checkpoint **Friday 2026-10-23**) |

---

## 10. Minimum next authorization required

Verification is **incomplete**. The smallest authorization that would close the six `NOT RUN` cases, in one bounded run:

1. **Replay existing migrations (or restore `supabase/_schema/baseline.sql` plus migrations above its ledger position) into a NEWLY CREATED disposable container.** Explicitly the step this task was told to stop at. No migration would be created or edited — only replayed into a throwaway database.
2. **Insert a small fixture set with exact ids** under a reserved prefix: one `companies` row, two `lead_signals`, two `opportunity_feed_items` (one protected, one clean), one `opportunity_lifecycle_states`, one `retention_policies` row.
3. **Execute the service's own delete path** — i.e. let `runRetentionPolicy` issue its real `DELETE`s — against that disposable database, in `execute` mode.
4. **Optional, for the fail-closed cases:** a `REVOKE` on the child table to induce a genuine probe failure, which is DDL and should be named explicitly if wanted.

Safeguards already demonstrated in §2 would carry over unchanged: unique container name, pre-existence refusal, loopback-asserted binding, throwaway credentials, exact-id teardown, per-probe transactions ending in `ROLLBACK`, exact fixture ids, and residue checks.

**Separately, and independent of any database work:** F-1 and F-2 are product-code fixes needing implementation authorization, plus two tests for the untested read-failure paths.

---

## 11. Completion status

| Item | Status |
|---|---|
| Environment isolation path | **VERIFIED AGAINST POSTGRESQL** — container created, loopback binding asserted, server identified, torn down by exact id |
| Fresh disposable container lacks the required schema | **VERIFIED AGAINST POSTGRESQL** — 0 public tables, 0 of 5 required tables |
| **Retention pre-exclusion behaviour** | **NOT RUN — BLOCKED.** Requires migration replay, fixture inserts and a real `DELETE`, none authorized here |
| Protection predicate, tenant scoping of reads, classification, `rows_affected` derivation, status consistency, no-error-path-to-deletion, empty-batch safety | **VERIFIED BY SOURCE INSPECTION** |
| The 45 Phase 1 tests and the 81-test re-run | **UNIT-TESTED ONLY** — a double, not PostgreSQL |
| Case "unexpected result or exception fails closed" | **NOT SATISFIED — finding F-2** |
| Tenant predicate on deletes | **NOT SATISFIED — finding F-1** |
| Independent review | **NOT RUN** — same agent throughout |
| Production behaviour | **UNVERIFIED** — and nothing here speaks to it |

**The Phase 1 retention fix is NOT PostgreSQL-verified.** It remains **unit-tested and source-inspected**, with two defects now identified that neither of those had surfaced before.

**Nothing was committed or deployed. Phase 2 remains unauthorized and Q3 remains blocked.**
