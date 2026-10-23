# PI-C1-PHASE-1-PG-VERIFICATION-002 — the retention implementation against real PostgreSQL

**Verification only.** No product code or repository test file changed. No migration created or edited. No production access or credential. No provider call, commit, push, merge or deployment. No existing container connected to, mutated, stopped or removed.

> ## Result
>
> **Scenarios A–H are VERIFIED AGAINST POSTGRESQL.** The product's own `runRetentionPolicy` executed against a newly created disposable PostgreSQL 17.11 with the real schema — 823 baseline tables plus 52 replayed migrations — issuing real `DELETE` statements against real fixture rows, with the append-only trigger live and enforcing.
>
> **13 of 13 scenarios passed.** One scenario (E, the short-count branch) is **HARNESS-ASSISTED** in its *timing* only: the short count itself was produced by PostgreSQL truthfully, from a genuine race the harness interleaved.
>
> The retention pre-exclusion, tenant scoping, per-item attribution, fail-closed reads and F-1/F-2 remediation are now **PostgreSQL-verified**. This remains **self-review**, not independent verification, and it says nothing about the production database.

---

## 1. Baseline and source hashes

Measured **2026-10-18T15:17:21+05:30 (IST)**.

| | Value |
|---|---|
| Repository / branch | `C:/tmp/r1-ctx` · `fix/r1-profile-context` |
| HEAD, start and end | **`29fea38a2d1642c1c2fd957e5151f6be81415774`** — unchanged |
| Working tree, start | **155 entries (72 M / 83 ??)**, inventory captured first |
| Working tree, end | **155 entries** — identical; the one new file is this report, which replaces nothing |

**Hash gate:** `PI-C1-PHASE-1-F1-F2-REMEDIATION-001.md` = `f3bf6bff3bbcbd4d842f798df661f5fe2ee6f38eb9158dbc8ad8bc4f2a1a8df0` — **MATCH**.

Phase 1 implementation files, hashed at start and **byte-identical at end**:

| File | SHA-256 (16) |
|---|---|
| `backend/services/lifecycleGuardErrors.ts` | `d63e5165d127e75b` |
| `backend/types/retention.ts` | `60e9c05a8906fd8a` |
| `backend/services/retentionService.ts` | `b84a8605745130bd` |
| `backend/services/opportunityLifecycleService.ts` | `40bb4453ff14f4ca` |
| `backend/services/prospectLifecycle/lifecycleWriter.ts` | `fde7e56c479a51a1` |
| `pages/api/active-leads/lifecycle.ts` | `249e2ac3943b305e` |
| `backend/tests/unit/pic1Phase1RetentionAndLifecycleGuards.test.ts` | `4a76e0c0155bb934` |

Prior reports, all unchanged: `f3bf6bff…` (F-1/F-2), `02a7c1c9…` (PG-VERIFY-001), `953adb5e…` (implementation), `bfbc683f…` (architecture decision), `a03d8aec…` (blocker review).

---

## 2. Container isolation proof and actual connection method

| | |
|---|---|
| Container name | `pgv2-retention-<pid>` — checked for pre-existence first; the script **refuses** rather than reuse or force-remove |
| **Full container id** | **`f53369881386c56fd620093057782d044aa5e8c698a0a43f0b0dd275a4b5e9d3`** |
| Image | `pgvector/pgvector:pg17` → server **PostgreSQL 17.11 (Debian 17.11-1.pgdg12+2)** |
| Restart policy | **`no`**, read back from `docker inspect` |
| Publish request | `127.0.0.1::5432` |
| **Actual host-side binding** | **`127.0.0.1:59296`**, read from `docker port` and **asserted before connecting**; a non-loopback binding would have removed the container and stopped without connecting |
| Credentials | throwaway (`POSTGRES_PASSWORD=throwaway`, database `pgv2`). **No production hostname or credential; no credential value appears in this report** |
| Created by this run? | **Yes** — and nothing pre-existing was assumed disposable |

**Two distinct client connection methods, both recorded:**

1. **Provisioning and read-only inspection** — `docker exec <container-id> psql …`. No hostname, no network target, no connection string: it cannot resolve to a shared or production database.
2. **The test run** — the repository's own real-schema client (`pg.Client`) over TCP to `127.0.0.1:59296`, supplied as `W6_DB_URL`. The repository's `setup.ts` independently enforces a `FORBIDDEN` guard that refuses any URL matching `supabase.(co|com)`, `amazonaws.com`, `railway`, `neon.tech` or `render.com`, so a managed host could not have been used even by mistake.

**On `inet_server_addr()`:** not relied upon. Under `docker exec` it returns empty because the connection uses the container's Unix socket, so loopback was asserted from the **host-side published binding**, which is what actually governs reachability.

**The pre-existing stack was never touched.** 11 `cert-supabase` containers before, 11 after; no `stop`, `restart`, `rm` or configuration change was issued against any of them, and no container was addressed by name, wildcard or port association.

---

## 3. Migrations replayed

**Mechanism:** steps 1–3 of the repository's own `scripts/ci/real-schema-ci.sh` — Supabase bootstrap (`scripts/ci/schema-bootstrap.sql`), the committed schema baseline (`supabase/_schema/baseline.sql`), then every migration above the baseline's ledger position `20260916000000`. Step 4 of that script (the full jest suite) was **not** run.

**Safety determination made before replay, as required:** the replay issues every statement through `docker exec <container-id> psql`, so it has **no hostname and no connection-string input** and cannot target a shared or production database. No environment-selected database configuration participates. Nothing outside the new container was written.

| | |
|---|---|
| Bootstrap | applied; one benign `NOTICE: extension "pgcrypto" already exists, skipping` |
| Baseline restore | **40 s**; 1 error, **0 unexpected** (the restore necessarily re-creates objects the bootstrap already made; only `already exists` collisions are tolerated and the count of anything else is asserted to be zero) |
| Public tables after restore | **823** (asserted `>= 823` from `baseline.json`) |
| **Migrations replayed** | **52 of 52, all `ok`, 0 FAILED**, in **54 s** |
| First / last replayed | `20261013…` … `20261128000000_pi_canonical_write_atomicity.sql` |

**No migration was edited or skipped**, and no pre-existing migration or schema issue was encountered: every one applied idempotently onto the baseline.

---

## 4. Schema, triggers, constraints and role context

Verified by read-only inspection **after** replay:

| Check | Result |
|---|---|
| Required tables | `retention_policies`, `retention_executions`, `opportunity_feed_items`, `opportunity_lifecycle_states`, `lead_signals`, `companies` — **all present** |
| Append-only triggers | `opp_lifecycle_block_delete` and `opp_lifecycle_block_update`, both **`BEFORE` / `ROW`**, `tgenabled = 'O'` |
| Cascade FKs | `opportunity_lifecycle_states.opportunity_feed_item_id` → **`c`** (CASCADE); `…organization_id` → **`c`**; `opportunity_feed_items.signal_id` → **`c`**; `…organization_id` → **`c`** |
| **RLS** | **enabled** on `opportunity_feed_items`, `opportunity_lifecycle_states`, `retention_policies`, `retention_executions`; **not forced** |
| Connected role | **`postgres`, `rolsuper = t`** |

**Why the superuser fact matters, and how it was handled.** A superuser bypasses **both** RLS and privilege checks, so scenarios F and G could not have induced a permission failure as `postgres`. They run under `SET LOCAL ROLE pgv2_restricted`, a role created per scenario with only the grants that scenario needs.

That role is created **`BYPASSRLS`** deliberately: RLS is enabled on every table involved, so without the bypass a missing policy would return **zero rows instead of raising**, and a permission test would silently degenerate into an empty-result test. The bypass also matches production, where the service role bypasses row-level security — so the **privilege** boundary is the one that actually governs these reads. This is a genuinely supported PostgreSQL permission boundary; no production security control was weakened, and no application exception is mislabelled as a database permission failure.

---

## 5. Fixtures

Reserved prefix **`c0ffee00-…`**, which cannot be confused with any real identifier. Inserted only into the new disposable database, through the **real schema with all constraints and triggers active** — nothing was disabled.

| # | Identifier | Table | Tenant | Relationship | Expected role |
|---|---|---|---|---|---|
| 1 | `…000001` | `retention_policies` | A | `opportunity_feed_items` / `hard_delete` / 30 days | the service's input |
| 2 | `…000011` | `lead_signals` | A | — | parent of the protected feed item |
| 3 | `…000012` | `lead_signals` | A | — | parent of eligible #1 |
| 4 | `…000013` | `lead_signals` | A | — | parent of eligible #2 (batch plurality) |
| 5 | `…000014` | `lead_signals` | **B** | — | cross-tenant control |
| 6 | `…000021` | `opportunity_feed_items` | A | signal #2 | **protected** parent |
| 7 | `…000022` | `opportunity_feed_items` | A | signal #3 | **eligible** parent |
| 8 | `…000023` | `opportunity_feed_items` | A | signal #4 | second **eligible** parent |
| 9 | `…000024` | `opportunity_feed_items` | **B** | signal #5 | **matches no row for tenant A** |
| 10 | `…000031` | `opportunity_lifecycle_states` | A | feed `…000021`, `state='archived'`, `is_initial` | the protection itself |

Two tenant rows in `companies` (`ORG_A`/`ORG_B`, the repository's deterministic synthetic tenants) are inserted idempotently as infrastructure.

**Justified adjustment, stated as required.** The brief specified seven rows. Seven cannot cover A–H cleanly under the real constraints, for three reasons that the schema itself imposes: `opportunity_feed_items.signal_id` is `NOT NULL` with `UNIQUE (organization_id, signal_id)`, so **every** feed item needs its own `lead_signals` parent; "multiple eligible items in one batch" (scenario C) therefore needs two signal+feed pairs, not one; and the cross-tenant control needs a third pair in tenant B. The ten rows above are the **minimum** that satisfies the stated scenarios without disabling a constraint. Each scenario inserts only the subset it needs.

**Isolation:** every scenario runs in its own `BEGIN … ROLLBACK`, so no fixture outlives its scenario.

---

## 6. Exact invocation

```
W6_DB_URL=postgres://postgres:***@127.0.0.1:59296/pgv2 \
  node ./node_modules/jest/bin/jest.js \
  --config <scratchpad>/pgv2-jest.config.js --runInBand --forceExit
```

**Exit code 0 · 1 suite · 13 tests · 13 passed · 11.2 s.**

**The product ran, not a reimplementation.** The harness replaces exactly one seam — `ownedDbTable` — with a translator that turns the service's builder calls into real SQL on the real `pg` client. This is the same seam and the same technique the repository's existing real-schema suites already use (`backend/tests/realschema/pl_prospect_lists.test.ts`). **All retention decision logic — pre-exclusion, tenant predicates, per-item attribution, the short-count branch, status derivation, fail-closed reads — executed from `backend/services/retentionService.ts`.** No retention algorithm exists in the harness.

The harness lives in the scratchpad, **outside the repository**, because this authorization forbids changing a repository test file.

**Why every statement gets a SAVEPOINT.** In production each `ownedDbTable` call is its own PostgREST request, hence its own transaction, so one failing call cannot poison the next. Inside a single test transaction a raised trigger would abort everything after it, so each statement is wrapped in a `SAVEPOINT` and rolled back to it on error. That **reproduces** production's statement-per-call isolation rather than inventing something more forgiving.

### 6.1 The actual SQL the product issued (scenario D, verbatim)

```sql
SELECT * FROM public."retention_policies" WHERE "organization_id" = $1 AND "id" = $2 LIMIT 1
SELECT count(*)::int AS c FROM public."opportunity_feed_items" WHERE "organization_id" = $1 AND "created_at" < $2
SELECT "id" FROM public."opportunity_feed_items" WHERE "organization_id" = $1 AND "created_at" < $2 ORDER BY "created_at" ASC LIMIT 10000
SELECT "opportunity_feed_item_id" FROM public."opportunity_lifecycle_states" WHERE "organization_id" = $1 AND "opportunity_feed_item_id" = ANY($2)
DELETE FROM public."opportunity_feed_items" WHERE "organization_id" = $1 AND "id" = ANY($2) RETURNING "id"
INSERT INTO public."retention_executions" (…) VALUES (…) RETURNING *
```

**All four reads and the DELETE carry `"organization_id" = $1`, with `$1 = ORG_A` — the authoritative tenant of the operation.** This is the F-1 fix observed in real SQL.

---

## 7. Scenario results

| | Scenario | Expected | Observed | Status |
|---|---|---|---|---|
| **A** | Protected parent not deleted | parent, signal and lifecycle evidence survive | parent present, lifecycle row present, outcome `excluded_protected / append_only_child_present`, `rows_affected=0`, `status=partial`, **and zero DELETE statements issued** — pre-exclusion kept the row out of the statement entirely, so the guard was never provoked | **VERIFIED AGAINST POSTGRESQL** |
| **B** | Eligible parent deleted | row absent, outcome confirms | row **absent** after the run, outcome `deleted`, `rows_affected=1`, `status=completed` | **VERIFIED AGAINST POSTGRESQL** |
| **C** | Mixed batch loses no eligible work | protected stays, eligible go independently | both eligible rows **absent**, protected row **and** its lifecycle row present, `rows_affected=2`, `status=partial` | **VERIFIED AGAINST POSTGRESQL** |
| **D** | Tenant isolation of both delete paths | cross-tenant row neither deleted nor misreported | ORG_B row **present**, **absent from the outcomes entirely**, `rows_scanned=1`; every DELETE carries `organization_id = ORG_A` | **VERIFIED AGAINST POSTGRESQL** |
| **E** | Short batch count ⇒ `indeterminate` | no per-item retry; count-only `rows_affected`; nothing falsely `deleted` | **exactly 1 DELETE statement issued**; `rows_affected=1`; both ids `indeterminate` with reason `batch_count_short_1_of_2`; `detail = "batch_count_short_1_of_2;per_id_attribution_unavailable / deleted=0 indeterminate=2"`; `status=partial` | **VERIFIED AGAINST POSTGRESQL (HARNESS-ASSISTED timing)** |
| **F1** | Scan-count failure fails closed | failure reported; no probe; no DELETE | `status=failed`, `detail` contains `scan_count_failed`, `rows_affected=0`, **no outcomes**, **zero** probe statements, **zero** DELETEs, fixture row still present | **VERIFIED AGAINST POSTGRESQL** |
| **F2** | Candidate-select failure fails closed, independently | count succeeds, candidate select refused | `status=failed`, `detail` contains `candidate_select_failed`, zero probes, zero DELETEs, row present | **VERIFIED AGAINST POSTGRESQL** |
| **G** | Unreadable protection probe deletes nothing | failure reported truthfully | `status=failed`, `detail` contains `protection_probe_failed`, every candidate `failed / protection_undetermined`, **zero** DELETEs, row present | **VERIFIED AGAINST POSTGRESQL** |
| **H1** | Genuine empty run | distinguishable from a failed read | `status=completed`, **`detail = null`**, `rows_scanned=0`, `rows_affected=0`, no outcomes, no DELETE | **VERIFIED AGAINST POSTGRESQL** |
| **H2** | Retry after success | nothing more deleted, nothing invented | second run `rows_affected=0`, no outcomes, `status=completed` | **VERIFIED AGAINST POSTGRESQL** |
| **H3** | Retry over a protected row | exclusion repeats, never escalates | `excluded_protected` again, `rows_affected=0`, parent and lifecycle row both still present | **VERIFIED AGAINST POSTGRESQL** |
| **H4** | Dry run | previews the split, mutates nothing | `would_delete` + `excluded_protected`, both rows present, zero DELETEs | **VERIFIED AGAINST POSTGRESQL** |
| **—** | Guard provocation | the trigger is genuinely live | deleting a lifecycle-bearing parent **directly** raised **`P0001`** and the row survived | **VERIFIED AGAINST POSTGRESQL** |

### 7.1 F2's separation is a real PostgreSQL privilege boundary

Both failing reads target the **same table**, so a table-level revoke cannot tell them apart. F2 grants `SELECT (organization_id, created_at)` only: `SELECT count(*)` is permitted with a privilege on *any* column, while `SELECT "id"` is refused. The run confirms the service reached the candidate select — `detail` says `candidate_select_failed`, not `scan_count_failed` — so **the two reads were failed independently**, as the brief required.

### 7.2 Scenario E, labelled precisely

The product's branch requires PostgreSQL to report **fewer** affected rows than the ids submitted. That is a real race: a row removed between the candidate select and the batch delete. The harness created that interleaving by deleting one eligible row out of band at exactly that point; **PostgreSQL then produced the short count itself, truthfully.**

So: the **short count is PostgreSQL's own**, the **decision logic is the product's own**, and only the **timing** is harness-arranged. It is labelled **HARNESS-ASSISTED** and is **not** claimed as a state the database produced spontaneously. The out-of-band delete is the harness's and appears nowhere in the product's statement log — which is precisely what makes "exactly one DELETE issued by the product" a meaningful assertion.

---

## 8. Before-and-after evidence

Each scenario asserted database state directly, by primary key, before and after the product ran — not inferred from the return value:

- **A/H3:** parent present before → **present after**; lifecycle row **present after**.
- **B:** parent asserted **present before** → **absent after**.
- **C:** two eligible **absent after**; protected parent **and** lifecycle row **present after**.
- **D:** ORG_B row **present after**, ORG_A row **absent after**.
- **F1/F2/G:** fixture row **present after** in all three.
- **H4:** both rows **present after** a dry run.

**Residue check on the disposable database after all scenarios:** every reserved-prefix table count **0**, `retention_executions` **0**, `pgv2 tenant%` companies **0**, role `pgv2_restricted` **0** — the per-scenario rollbacks left nothing at all.

---

## 9. PostgreSQL execution versus other evidence

| Basis | What rests on it |
|---|---|
| **PostgreSQL execution** | Scenarios A, B, C, D, F1, F2, G, H1–H4, the guard provocation; the real SQL in §6.1; the schema, trigger, FK, RLS and role facts in §4; the migration replay in §3 |
| **PostgreSQL execution, harness-assisted timing** | Scenario E's short-count branch (§7.2) |
| **Harness, not product** | the `ownedDbTable` → SQL translation; the SAVEPOINT-per-statement isolation; the scenario-E interleaving; `BYPASSRLS` on the restricted role |
| **Unit-tested only** | nothing in this report. The 56 unit tests remain separate, prior evidence |
| **Not established** | anything about the **production** database. The harness replays migrations onto a throwaway server, so a green run here is **not** evidence that any migration is applied in production |

**Not independent.** The same agent implemented Phase 1, found F-1 and F-2, fixed them, wrote the unit tests, built this harness and ran it. This is **self-review**. A separate execution by the same agent is not a second reader.

---

## 10. Cases not run

| Case | Why |
|---|---|
| The `.in()` list at full `MAX_DELETE_BATCH = 10 000` | Not exercised. The fixtures are tiny, so a PostgREST URL-length limit at scale remains **UNVERIFIED**. After F-2 such a failure would at least fail closed and be reported, rather than look like an empty scope |
| RLS-enforced behaviour without `BYPASSRLS` | Deliberately out of scope: it would convert a privilege test into an empty-result test (§4). How retention behaves under a *policy-restricted* role is **NOT RUN** |
| Concurrency beyond scenario E's single interleaving | Not exercised; no multi-connection contention test |
| Production verification of any kind | Prohibited, and nothing here speaks to it |
| The lifecycle read/transition changes (`readCurrentLifecycleState`, `isResolvedForAccountDeletion`), the B21 classifier, the route responses | **Outside this task's scope** — it authorized retention verification. These remain **UNIT-TESTED ONLY** and source-inspected |

---

## 11. Cleanup proof

| Check | Result |
|---|---|
| Container removed | `docker rm -f f53369881386c56fd620093057782d044aa5e8c698a0a43f0b0dd275a4b5e9d3` — **by full id**, never by name, wildcard or port |
| Exact container gone | `docker inspect` → **confirmed absent** |
| Any `pgv2-` container left | **none** |
| `cert-supabase` stack | **11 containers before, 11 after**; total running containers **11** |
| Fixture rows | nothing to remove — per-scenario rollback left **0** reserved-prefix rows, verified before teardown |
| Temporary harness files | the harness test, its jest config, the provisioning script, the container-id and db-url files and the replay scratch files were **removed**; only two evidence logs were retained for this report |
| Broad cleanup commands | **none used** — no volume prune, no name globbing, no port-based matching |

---

## 12. Final repository and container state

| Check | Result |
|---|---|
| Phase 1 implementation files | **all 7 byte-identical** to §1 |
| Architecture, implementation, PG-VERIFY-001 and F-1/F-2 reports | **all unchanged** (`a03d8aec…`, `bfbc683f…`, `953adb5e…`, `02a7c1c9…`, `f3bf6bff…`) |
| HEAD | **`29fea38a…` unchanged** |
| Working tree | **155 → 155 entries**; **no pre-existing entry lost**; this report is the only addition |
| Commits / deployments | **none** |

---

## 13. Time ledger

| | |
|---|---|
| Start / end | **2026-10-18T15:17:21** → **15:28:00 +05:30 (IST)** |
| **Wall-clock** | **10 min 39 s** |
| **Machine time** | **≈ 2 min 30 s** — baseline restore 40 s, migration replay 54 s, container create/ready ≈ 10 s, harness runs ≈ 25 s, inspection and teardown ≈ 20 s |
| **Active engineering** | **≈ 8 min** |
| External waiting | **none** inside this task |
| Human engineer-days | **not consumed by agent wall-clock**; no substitution. Frozen baseline unchanged: Milestone A′ **2026-11-25 / 28.5 d**, WP-7 **2026-11-17 / 4.0**, C-1 **8–12**, **OVERRUN RISK still raised with zero float at the high estimate**, next checkpoint **Friday 2026-10-23** |

---

## 14. Residual defects and next authorization

**No new defect was found.** Every scenario behaved as the implementation claims, including both F-1 and F-2 remediations.

Residual risks, unchanged or newly bounded:

1. **Batch scale is unverified.** A 10 000-id `.in()` list was never issued; a PostgREST URL-length limit at scale is **UNVERIFIED**, though it would now fail closed.
2. **`RETENTION_PROTECTED_CHILDREN` is still a hand-maintained mirror** of database reality. Scenario A shows pre-exclusion working for the one child it knows; a future append-only child added without updating the map would fall through to the per-item isolation path — contained, but a fallback.
3. **Behaviour under a policy-restricted (non-`BYPASSRLS`) role is NOT RUN.** Production's service role bypasses RLS, so this matches production today, but it would matter if that ever changed.
4. **The lifecycle and B21 changes are not PostgreSQL-verified** — out of scope here, still unit-tested and source-inspected only.
5. **No independent review** of any of this work exists.

**Next authorization that would add the most value, in order:**

1. **A real-schema suite for the lifecycle and B21 changes** — `readCurrentLifecycleState`'s six cases, `isResolvedForAccountDeletion`, and both SQLSTATEs at the caller boundary, against a disposable database. Same safeguards as this run.
2. **Landing these tests in the repository.** This run's harness was deliberately outside it, so **nothing durable was added**: the next regression would not be caught. Adding an equivalent real-schema suite needs authorization to create a repository test file.
3. **A human or otherwise independent reviewer** for the Phase 1 work as a whole.

---

## 15. Status

| Item | Status |
|---|---|
| Retention pre-exclusion (A, C) | **VERIFIED AGAINST POSTGRESQL** |
| Confirmed deletion and counts (B) | **VERIFIED AGAINST POSTGRESQL** |
| **F-1** tenant scoping of both delete paths (D, §6.1) | **VERIFIED AGAINST POSTGRESQL** |
| **F-1b** short count ⇒ `indeterminate`, no retry (E) | **VERIFIED AGAINST POSTGRESQL — HARNESS-ASSISTED timing** |
| **F-2** both required reads fail closed (F1, F2) | **VERIFIED AGAINST POSTGRESQL** |
| Protection-probe failure (G) | **VERIFIED AGAINST POSTGRESQL** |
| Empty run, retries, dry run (H1–H4) | **VERIFIED AGAINST POSTGRESQL** |
| Append-only guard genuinely live | **VERIFIED AGAINST POSTGRESQL** (`P0001`) |
| Batch at `MAX_DELETE_BATCH` scale | **NOT RUN** |
| Policy-restricted RLS behaviour | **NOT RUN** |
| Lifecycle reads, terminality predicate, B21 classifier, route responses | **UNIT-TESTED ONLY** |
| Durable repository regression coverage for these scenarios | **NOT RUN — needs authorization to add a repository test file** |
| Independent review | **NOT RUN** |
| Production behaviour | **UNVERIFIED** |
| Phase 2 · Q3 · v0.3 | **UNAUTHORIZED · BLOCKED · NOT RATIFIED** |

**Nothing was committed or deployed. Phase 2 remains unauthorized, Q3 remains blocked, and v0.3 remains unratified.**
