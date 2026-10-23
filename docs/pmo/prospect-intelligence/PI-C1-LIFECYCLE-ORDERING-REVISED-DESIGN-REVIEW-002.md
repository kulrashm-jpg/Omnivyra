# PI-C1-LIFECYCLE-ORDERING-REVISED-DESIGN-REVIEW-002 — blocker resolution and revised design review

**Review and documentation only.** No product code, test, schema, migration, grant, configuration or environment was changed. No Docker, database, migration or production access. No commit, branch, stage, stash, PR, merge, push or deployment. The original proposal (`PROP-001`) and the owner-review package (`OR-001`) are **not** replaced or edited. This document sits beside them.

**Implementation authorization: NOT GRANTED. No owner decision is approved, adopted or inferred.** Every "candidate" below is a recommendation for the owner to accept or reject.

---

## 1. Executive disposition

**The three critical contradictions from OR-001 are resolvable, but none is resolved by evidence alone. Each needs an owner decision, and two need new verification.**

| Blocker | Finding | Candidate (recommendation only) | Status |
|---|---|---|---|
| **B-1 Writer cutover** | PROP-001's P1 → P3 → P2 with an early CHECK causes a write outage. Deferring the CHECK without a quiesce misranks rows. **New:** `transitioned_at` is transaction-start time, so even serialized rows can carry inverted timestamps (§4.4) | **R-4: a database-mediated boundary.** An insert trigger takes the per-opportunity lock, *then* allocates `seq`, then checks `previous_state` against the authoritative current state. Fallback is **R-3**, a coordinated single-release cutover with a write quiesce | **INFERRED / UNVERIFIED**. R-4 is new and not demonstrated |
| **B-2 Initial row** | PROP-001 §4.1 defines no initialisation path. There is exactly one creation path (`listeningSignalPipeline.ts:307`). It is best-effort, outside the feed-item write, and swallows its errors | the initial row is allocated under the same lock and the same allocation rule as transitions (by R-4's trigger, or by an init mode of the function) | **UNVERIFIED**. No mechanism exists |
| **B-3 Privilege model** | **SOURCE:** every server path uses the service-role key, and `service_role` has BYPASSRLS (committed migration `20261026000000` header). Revoking INSERT from that role breaks a `SECURITY INVOKER` function. A `SECURITY DEFINER` function would, by the repo's own record of Supabase defaults, be **EXECUTE-able by `authenticated`** unless explicitly revoked | **M-1:** keep `SECURITY INVOKER` (the committed precedent) and enforce exclusivity in the database through R-4's trigger, not through privilege revocation | **INFERRED**. Production grants **UNVERIFIED** |

**New findings that change OR-001 or PROP-001:**
- **F-1 (security, SOURCE-reasoned, not executed).** At committed HEAD, a user authorized for company A can transition a lifecycle row citing company B's opportunity id. The API never checks that the opportunity belongs to `companyId`, and HEAD's writer defaults missing history to `'detected'`. The working tree closes this only incidentally. **Which version is deployed is UNKNOWN.** §6.5.
- **F-2.** The detector proposed in PROP-001 I-3/T23 and PG-002 R8, "no `previous_state` claimed by two rows", **raises false positives**. The committed transition graph permits revisits. §7.2.
- **F-3.** The schedule records conflict about C-1 float (§12.1). OR-001 §F cited the earlier figure.
- **F-4 (corrects OR-001 §0.1).** A **committed** precedent exists for a `SECURITY INVOKER` plpgsql function with an explicit tenant argument and `FOR UPDATE`: `pi_relationship_set_primary`, in commit `3e920fa1`. The *cited* precedent (`20261128…`) is untracked.

**Implementation authorization remains NOT GRANTED.** This review recommends; it does not decide.

---

## 2. Baseline and source provenance

### 2.1 Repository state, recorded read-only at task start

| | Value |
|---|---|
| Root / branch | `C:/tmp/r1-ctx` · `fix/r1-profile-context` |
| HEAD | `29fea38a2d1642c1c2fd957e5151f6be81415774` |
| `main` | `fef341785dffcbaf4c3a5ac715a6ce63b58e58c2` |
| `git status --short` at start | **165 entries: 72 ` M`, 93 `??`**, nothing staged |
| At end | **166 entries.** The only addition is this file |

**No baseline is declared established.** The working tree is observed, not committed, and its presence authorizes nothing (`CLAUDE.md`: adoption baselines are a human-only commit).

### 2.2 Document identity

| Short ID | File | SHA-256 | Lines | Recorded elsewhere | Status |
|---|---|---|---|---|---|
| **INV-001** | `PI-C1-LIFECYCLE-ORDERING-INVESTIGATION-001.md` | `2be20d2d7300a4343884e7048a3247c30d3c1461fec12a99d4c7b1636f956e2e` | 403 | PROP-001 §2, PG-002 §2 | **MATCH** |
| **IR-001** | `PI-C1-LIFECYCLE-ORDERING-INDEPENDENT-REVIEW-001.md` | `36edb0b7f6a2d4206c6e207cb10e59e47832f3809f203636694668ab387c6d85` | 396 | PROP-001 §2, PG-002 §2 | **MATCH** |
| **PG-002** | `PI-C1-LIFECYCLE-ORDERING-POSTGRES-INVESTIGATION-002.md` | `74bdb3608766360b77ad6c68bbd4706ac47fcb6a2f9bdec4267241e96612f810` | 394 | PROP-001 §2 | **MATCH** |
| **PROP-001** | `PI-C1-LIFECYCLE-ORDERING-DESIGN-PROPOSAL-001.md` | `9e3e570c267b403562a3077ff9793c4b73f3bed930a5b877c515c154e88a6d10` | 403 | OR-001 §0 | **MATCH** |
| **OR-001** | `PI-C1-LIFECYCLE-ORDERING-OWNER-REVIEW-001.md` | `b06bf982f9350307b001f304168d267964b4fac87275ca222271de611120812c` | 277 | **first recorded here** | identified |
| **GATE-001** | `PI-C1-IMPLEMENTATION-GATE-001.md` | `f747c763bd0dbb48e6cd3f3f75809a781451abb114791a4f749a250e8b2622e9` | 446 | — | read §9.5 |
| **OD-002** | `PI-C1-OWNER-DECISIONS-002.md` | `7296df67fd054717a66c3c1ccfc9324f8a7f2eb06e7555d40dc1d2b891408791` | 425 | — | read §5.3, §7.5 |
| **DC-001** | `PI-C1-DECISION-CLOSURE-001.md` | not hashed (read §5.4–§5.5 only) | — | — | read |

All of these are **untracked** working-tree files. None has git history, so "identity" means content hash at the time of reading, not a committed revision.

### 2.3 Traceability: committed versus working tree

`HEAD` means `29fea38a`. `WT` means the working tree as read on 2026-10-19. Line numbers are WT unless marked.

| Claim | HEAD evidence | Working-tree evidence | Source revision | Confidence | Consequence |
|---|---|---|---|---|---|
| `ownedDbRpc` seam exists (PROP-001 S-1) | **absent** in `backend/db/writeOwner.ts` (also absent on `main`) | present, `writeOwner.ts` (**M**) | WT only | SOURCE | The seam the design names does not exist in committed code. Committed code calls `supabase.rpc(...)` directly (e.g. `creditExecutionRepository.ts:61`) |
| `ownedDbRpc` "has a production caller" (`ingestionBoundary.ts:1014`) | **absent** | present (**M**) | WT only | SOURCE | "Production caller" means "uncommitted caller" |
| Cited precedent `20261128000000_pi_canonical_write_atomicity.sql` (S-2) | **untracked** | present | WT only | SOURCE | Not a committed precedent |
| A committed INVOKER + tenant-arg + `FOR UPDATE` precedent | **`pi_relationship_set_primary`**, `20261122000000_pi_person_account_relationships.sql:493-523`, commit `3e920fa1` | same | **HEAD** | SOURCE | Corrects OR-001 §0.1: the pattern *is* committed, on a different table |
| A1 `readCurrentLifecycleState` (`:98`) | **absent** | present | WT only | SOURCE | Typed reader with fail-closed `missing`/`unreadable` is uncommitted Phase-1 work |
| A2 `getCurrentLifecycleState` is dead | **live**: the sole reader for `transitionLifecycle` (HEAD `:131`) | dead (`:207`, zero callers) | **mixed** | SOURCE | PROP-001 D-4 holds only in the WT |
| Writer persists its read as `previous_state` | HEAD `:144`, from `current?.state ?? 'detected'` | `:281`, from `read.state`; `missing` refused | both, **different behaviour** | SOURCE | At HEAD, missing history becomes `'detected'` (enables F-1) |
| `isResolvedForAccountDeletion` (S-4) | **absent** | `:153`, zero non-test callers | WT only | SOURCE | The terminality predicate is uncommitted |
| C1/C2 `is_initial` probes discard `error` | yes (HEAD `:47`, `:71`) | yes (`:166`, `:190`) | both | SOURCE | Unchanged by Phase 1 |
| A3 board (`:305`), B1 history (`:222`) | present (HEAD `:168`, `:103`) | present | both | SOURCE | Line numbers differ |
| A4 dashboard discards `error` (`strategicDashboardsService.ts:153`) | identical | identical (file unmodified) | **HEAD** | SOURCE | Committed fact |
| D1 audit export (`auditExportService.ts:27`) | present | present (unmodified) | **HEAD** | SOURCE | Committed fact |
| C3 `findProtectedIds` deletion gate (`retention.ts:107`, `retentionService.ts:165`) | **absent**: no `RETENTION_PROTECTED_CHILDREN`, no protection probe | present (`retention.ts` **M** +37; `retentionService.ts` **M**) | WT only | SOURCE | "The live deletion gate" is uncommitted |
| D2/D3 retention reads "fail closed" | **not at HEAD**: `retentionService.ts:128` and `:142` discard `error` | fail closed (`:215`, `:234`) | WT only | SOURCE | The fail-closed retention claims hold only in the WT |
| Initial-row creation path | `listeningSignalPipeline.ts:307` → `initialiseLifecycleForOpportunity`, error swallowed (`console.warn`) | identical (file unmodified) | **HEAD** | SOURCE | Committed fact (B-2) |
| Existing tests T11 (`pi_lifecycle_b21`), T14 (`ret_retention_pre_exclusion`) | **untracked** | present | WT only | SOURCE | "Existing" regression tests are uncommitted |
| Lifecycle table DDL, append-only triggers, `uq_opp_lifecycle_initial` | `baseline.sql:19505`, `:45951`, `:46826-46833`; migration `20260520_phase6…` | same | **HEAD** | SOURCE | Committed |
| Server credential = service role with BYPASSRLS | `20261026000000_close_anon_rls_exposure.sql:28-33` (header), `supabaseClient.ts` secret-key seam | same | **HEAD** | SOURCE (the header records a read-only production measurement dated 2026-09-14) | Governs B-3 |
| That migration is applied to production | header: **"NOT YET APPLIED TO PRODUCTION"** (prepared 2026-09-14) | — | — | **UNVERIFIED** | T22 and B-3 expectations depend on it |
| 11-consumer map (PG-002 §3, PROP-001 §7) | 9 query sites (A2 live; A1 and C3 absent) | 11 sites | **WT** | SOURCE | The map describes the WT. A HEAD-based map differs in A1, A2 and C3 |
| Evidence hashes identify the reviewed documents | — | four MATCH (§2.2) | file content | SOURCE | Identity is content-hash only; no committed revision exists |

**The owner should read every "WT only" row as an observed working-tree fact, not a committed one.** It becomes a committed fact only after the human adoption-baseline commit (`CLAUDE.md`, *Existing work*).

---

## 3. Qualified decision identifiers

Unqualified D-numbers are not used anywhere below. Source prefixes:

| Prefix | Document | Notes |
|---|---|---|
| `INV-001 D-n` | INV-001 §8 | original register |
| `IR-001 D-n` | IR-001 §10 | assessment of INV-001's register; §8.1 heading calls born-terminal "D-4" in text (`IR-001 §8.1`) |
| `PG-002 D-n` | PG-002 §9 | adds D-8 to D-11 with **different meanings** from PROP-001 |
| `PROP-001 D-n` | PROP-001 §12 | renumbered register; only D-1 is marked "replaces the original" |
| `OR-001 G-n.m`, `OR-001 B-n`, `OR-001 C-n` | OR-001 | owner questions, blockers, gates |
| **`RDR-002 Q-n`, `RDR-002 V-nn`, `RDR-002 R-n`, `RDR-002 M-n`** | this document | questions, verification items, rollout and privilege alternatives |

**Cross-reference of colliding IDs**, quoted from the sources. Historical records are not edited.

| Subject | INV-001 / IR-001 | PG-002 | PROP-001 |
|---|---|---|---|
| Design selection | `INV-001 D-1` (A-minimal) / `IR-001 D-1` NOT YET SUPPORTED | `PG-002 D-1` OWNER DECISION REQUIRED | `PROP-001 D-1` Option 1 ("replaces the original") |
| No backfill | `INV-001 D-2` | `PG-002 D-2` SUPPORTED | `PROP-001 D-2` |
| Sequence ordering without serialization | `INV-001 D-3`, `IR-001 D-3` | `PG-002 D-3` **NOT SUPPORTED** | (no equivalent: absorbed into `PROP-001 D-3`) |
| Contractual ordering property | — | `PG-002 D-9` | **`PROP-001 D-3`** |
| Dead reader | `INV-001 D-4`, `IR-001 D-4` | `PG-002 D-4` | `PROP-001 D-4` |
| Write race scope | `INV-001 D-5` "Separate" / `IR-001 D-5` with caveats | `PG-002 D-5` | **`PROP-001 D-5`** "first, in this package" |
| Disposable-PG investigation | `INV-001 D-6`, `IR-001 D-6` | `PG-002 D-6` **DISCHARGED** | — |
| Further verification | — | — | **`PROP-001 D-6`** |
| Implementation authorization | `INV-001 D-7`, `IR-001 D-7` | `PG-002 D-7` | `PROP-001 D-7` |
| `GENERATED ALWAYS` vs nullable | — | **`PG-002 D-8`** | superseded in substance by PROP-001 §5.2 Option B; never answered (`OR-001 G-1.6`) |
| Legacy ties → terminality | — | — | **`PROP-001 D-8`** |
| Born-terminal repair | `IR-001 §8.1` ("D-4" in text) | — | **`PROP-001 D-9`** |
| Discarded `error` values | — | **`PG-002 D-10`** | `PROP-001 D-14` |
| Write exclusivity / grants | — | — | **`PROP-001 D-10`** |
| Cross-tenant / composite key | — | `PG-002 D-11` | `PROP-001 D-11` (same subject) |
| Retry, detection, Q3 | — | — | `PROP-001 D-12`, `D-13`, `D-15` |

---

## 4. B-1: writer cutover and rollout ordering

### 4.1 Current writers and readers, as documented

| Actor | HEAD behaviour | WT behaviour | Supplies `seq`? | Lock? |
|---|---|---|---|---|
| **W-INIT** `initialiseLifecycleForOpportunity` | probe → INSERT `is_initial=true` → on `23505` re-probe | same | no | no; `uq_opp_lifecycle_initial` only |
| **W-TRANS** `transitionLifecycle` | read via A2; missing ⇒ `'detected'`; INSERT | read via A1; missing/unreadable ⇒ refuse; INSERT | no | no |
| Readers A1/A2, A3, A4 | `transitioned_at DESC` (A3/A4 app-side reducers) | same | — | — |
| B1, D1 | `transitioned_at ASC` | same | — | — |

All writes go through `ownedDbTable` as the service role (§6.1). PostgREST gives each call its own transaction (`writeOwner.ts` comment, WT). **`transitioned_at` is `DEFAULT now()`**, the *transaction start* time (`baseline.sql:19505` + PostgreSQL semantics, INFERRED).

### 4.2 Alternatives

"Old" means current code; "new" means code that uses the authoritative operation and the PROP-001 §5.3 reader rule (`seq DESC NULLS LAST, transitioned_at DESC`).

| | **R-1 PROP-001 as written** (P1 incl. CHECK → P3 → P2) | **R-2 Deferred CHECK, no quiesce** | **R-3 Coordinated single-release cutover with quiesce** | **R-4 Database-mediated boundary** (trigger: lock → allocate → validate predecessor) |
|---|---|---|---|---|
| **1 Schema / writer states** | column + sequence + index + `CHECK NOT VALID`; then new readers; then new writers | column + sequence + index; new readers; new writers rolled gradually; CHECK last | (a) column + sequence + index, no CHECK, no default; (b) quiesce writers; (c) one release: new readers + new writers; (d) CHECK `NOT VALID`; (e) resume | (a) column + sequence + index; (b) one atomic DDL step installs a `BEFORE INSERT` trigger that takes the per-opportunity lock, then sets `NEW.seq := nextval()` (overriding any caller value), then refuses if `NEW.previous_state` ≠ the authoritative current state; (c) CHECK `NOT VALID`; (d) readers and writers updated at leisure |
| **2 Old/new readers and writers** | old writers **refused** from P1 to P2 | old writers write NULL-seq rows while new writers write sequenced rows | only one version writes at any time | old writers' rows get `seq` from the trigger; a stale old-writer predecessor is **refused**; old readers still order by time |
| **3 Insert without `seq` possible?** | no (refused) | **yes** | only before the cutover, and those rows are legitimately "legacy" | **no**, once the trigger is installed |
| **4 Misranked as older than a numbered row?** | no | **yes**: NULLS LAST ranks a later NULL row below earlier sequenced rows | no, **if** the quiesce is complete | no by `seq`. Old readers can still be wrong by time (§4.4) |
| **5 Constraint rejects valid writes?** | **yes**: every W-INIT and W-TRANS insert until P2 is 100 % (INFERRED from `NOT VALID` semantics; `RDR-002 V-01`) | no | no; writes are *paused*, not rejected | rejects only stale-predecessor writes, which are the fork. Also rejects initial rows if history exists (already refused by the unique index) |
| **6 Tenant / append-only** | unchanged | unchanged | unchanged | the trigger can also refuse a pair `(organization_id, opportunity_feed_item_id)` absent from `opportunity_feed_items`, which closes F-1 for all writers. Append-only: INSERT-only, no UPDATE, triggers untouched |
| **7 Rollback / forward recovery** | code rollback restores old writers but they stay refused while the CHECK exists ⇒ `DROP CONSTRAINT` needed | code rollback safe; NULL rows written in the window are permanent | rollback before (d) is safe; after (d), old code is refused (as R-1) | `DROP TRIGGER` reverts to today's behaviour; sequenced rows remain valid. Old code keeps working throughout |
| **8 Verification** | V-01, V-08 | V-08 | V-08 + deployment topology (instance drain) **UNVERIFIED** | **V-09** (new mechanism, *not* demonstrated), V-10, V-08 |
| **Main risk** | lifecycle-write outage | permanent misranking | **pausing W-INIT loses initial rows**: the pipeline swallows init failure and never retries (`listeningSignalPipeline.ts:305-316`), so a quiesced opportunity stays `missing` forever (WT refuses to transition it) | **new and unverified.** It moves enforcement into a trigger, which PROP-001 §5.2 rejected **only for column-default allocation** (E-1/E-3). Allocation inside the trigger *after* the lock is a different mechanism, and E-3 does not cover it (INFERRED) |

### 4.3 Recommendation (not a decision)

**Candidate: R-4, conditional on V-09 passing on a disposable database. Fallback: R-3**, with W-INIT queued rather than dropped during the quiesce.

Reasons, with sources:
- R-4 is the only option where old and new writers coexist safely, so rollout ordering stops being a correctness dependency (PG-002 E3 deployment requirement).
- R-4 makes `seq` impossible to pin from any caller (E-10), because the trigger overwrites it. That removes the need for privilege-based exclusivity (§6).
- R-1 and R-2 are rejected by the analysis above.

**Departures from PROP-001 that the owner must accept explicitly:**
- I-10's "one authoritative operation" becomes "one authoritative *enforcement point* (the trigger), optionally fronted by a function that returns structured results".
- The PoC (E-14) did **not** test this shape.

**Owner decision:** `RDR-002 Q-2`.

### 4.4 Newly identified hazard: timestamp inversion under serialization

`transitioned_at` is transaction-start time. Suppose transaction B starts, A acquires the lock first, and B waits. B then inserts after A, with a **higher `seq`** but an **earlier `transitioned_at`** (INFERRED; PG-002 E-14's timings report lock times, not row timestamps).

- New readers rank by `seq`, which is correct.
- Old readers, B1/D1 history order and any human reading timestamps see the inverse.

**Options:**
- set `transitioned_at := clock_timestamp()` after the lock (in the trigger or function);
- or document that `transitioned_at` is not an ordering field.

This is a design change, so it is raised as `RDR-002 Q-3`. Verification is `RDR-002 V-10`.

---

## 5. B-2: initial lifecycle-row ordering

| Question | Finding | Label |
|---|---|---|
| All initial-row creation paths | **one:** `listeningSignalPipeline.ts:307` → `initialiseLifecycleForOpportunity`. No SQL `INSERT INTO opportunity_lifecycle_states` exists in `supabase/` or `backend/` outside tests | SOURCE (HEAD = WT) |
| Same transaction as the opportunity insert? | **No.** A separate call after the feed item is written; failure is logged and swallowed | SOURCE |
| Uses the authoritative operation? | **No.** PROP-001 §4.1 covers transitions only, and its step 3 refuses `lifecycle_history_missing` | SOURCE (PROP-001) |
| Interaction with the per-opportunity lock | **None designed.** Under R-1/R-2/R-3 the init INSERT carries no `seq` (no DEFAULT, PROP-001 §6.3 P1); with the CHECK, it is refused | INFERRED |
| Duplicate initialisation / retries | `uq_opp_lifecycle_initial` on `(opportunity_feed_item_id) WHERE is_initial`. A concurrent duplicate gets `23505`, then a re-probe. **C1's discarded error** turns a read failure into an INSERT attempt, which the unique index bounds to one row. **C2's discarded error** returns `null` | SOURCE |
| Unique index is not tenant-qualified | it keys on `opportunity_feed_item_id` alone, so an initial row under the wrong org would block the right org's initialisation. No path is known to produce one, since W-INIT takes both ids from the pipeline's own write | SOURCE; risk **UNVERIFIED** |
| First row ordered before later transitions? | Only if init and transition allocate under the **same** lock and rule. **R-4** gives this for every writer. A PROP-001-style function needs an explicit **init mode** that takes the lock, refuses if any history exists, allocates `seq` and inserts with `previous_state = NULL` | INFERRED |
| Same semantics for initial rows and transitions guaranteed? | **Not by PROP-001 as written: UNVERIFIED.** Achievable by R-4, or by a function init mode | — |
| Opportunities whose init already failed (`missing`) | permanently untransitionable in the WT (refused, not repaired, per the WT comment at `transitionLifecycle`). **The count is UNKNOWN.** Writing an initial row later would fabricate creation evidence | SOURCE; count **UNVERIFIED** |

**Evidence needed:**
- `RDR-002 V-11` (init ordering, duplicates and retries under the chosen mechanism);
- detection category `M-MISSING` in §8 (how many opportunities lack history).

**Owner decisions:** `RDR-002 Q-4` (init mechanism) and `RDR-002 Q-5` (what happens to `missing` opportunities). No initialisation mechanism is implemented or specified beyond these options.

---

## 6. B-3: write exclusivity and privilege model

### 6.1 Facts versus inferences

| # | Statement | Label | Source |
|---|---|---|---|
| P-1 | "Every server path (API routes, cron, Railway worker, Edge Functions, operator scripts) uses the service-role key. service_role has BYPASSRLS" | **SOURCE** (committed migration header; it records a 2026-09-14 read-only production measurement, so the *current* production state is **UNVERIFIED**) | `20261026000000_close_anon_rls_exposure.sql:28-33` |
| P-2 | The server client loads `SUPABASE_SECRET_KEY` through a single credential seam | SOURCE | `backend/db/supabaseClient.ts:53-56` |
| P-3 | That migration enables RLS and **revokes ALL from `anon`, `authenticated`** on 177 tables, including `opportunity_feed_items` and `opportunity_lifecycle_states` (listed at `:211`, `:214`). No policy on either table exists in `supabase/` | SOURCE | migration; grep |
| P-4 | That migration was **"NOT YET APPLIED TO PRODUCTION"** when prepared | SOURCE; application now **UNVERIFIED** | header |
| P-5 | "Supabase's default privileges grant … EXECUTE on every new public function, to anon and authenticated." The migration changes defaults to revoke EXECUTE from `anon` and `PUBLIC`, but **not from `authenticated`** | SOURCE (`:453-457`) | migration |
| P-6 | ⇒ a **new** public function is EXECUTE-able by `authenticated` unless explicitly revoked | **INFERRED** from P-5 | — |
| P-7 | A `SECURITY INVOKER` function runs with the caller's privileges | INFERRED (PostgreSQL semantics) | — |
| P-8 | `SELECT … FOR UPDATE` requires UPDATE privilege on the locked table. BYPASSRLS skips policies | INFERRED | — |
| P-9 | Precedents are INVOKER with an explicit tenant argument. `20261128…` (untracked) states "PUBLIC EXECUTE … widens nothing — a caller who cannot write the tables directly cannot write them through this function" | SOURCE | `20261122…:493`; `20261128…:28-33` |
| P-10 | The transition API authorizes `companyId` membership and role (`enforceCompanyAccess`, `MANAGE_LISTENING_CAPABILITIES`) but **never checks that `opportunityId` belongs to `companyId`** | SOURCE (HEAD and WT) | `pages/api/active-leads/lifecycle.ts:51-66` |

**The conflict in OR-001, resolved analytically.** If the function and the server share the service role, revoking that role's INSERT blocks the function too (P-7). Revoking INSERT from `anon`/`authenticated` is already done by P-3, *if applied* (P-4). **Privilege-based exclusivity against server code is therefore only achievable with an elevated execution model (M-2).**

### 6.2 Privilege models (none enacted)

| | **M-1 INVOKER + database-enforced invariants** (candidate) | **M-2 SECURITY DEFINER, dedicated owner, service_role INSERT revoked** | M-0 INVOKER, convention only (PROP-001 as written, D-10 "degraded") |
|---|---|---|---|
| How exclusivity holds | R-4's trigger enforces `seq`, predecessor and pair existence on **every** insert, whoever writes it. Direct writes stay *possible* but cannot violate the invariants | only the function's owner can INSERT; the server calls the function | repository convention plus a source scan |
| Tenant identity | from arguments, set by server code after `enforceCompanyAccess`. The DB checks that the pair exists **in the same org** | same: service_role has no JWT claims, so the DB **cannot derive** the tenant | same |
| Can callers forge org / opportunity ids? | any server code path can pass any org id. The DB prevents a **mismatched pair** (closes F-1) but not a wrong-but-consistent org. That is the API's job (P-10) | same; no improvement | at HEAD, **yes**, mismatched pair accepted (F-1, consistent with E-12) |
| `search_path` | INVOKER, not elevated; pinning recommended (PG-002 E-14's PoC pinned it) | **mandatory** `SET search_path` (e.g. `pg_catalog, pg_temp` with schema-qualified names) | — |
| Ownership / privilege boundary | unchanged | new owner role holding INSERT; **REVOKE EXECUTE FROM PUBLIC, anon, authenticated** (P-6); GRANT EXECUTE TO service_role only. The repo has a record of 29 definer functions with no caller check (`20261026…` header §2) | unchanged |
| RLS | bypassed for service_role (P-1); not a layer on this path | the owner role is subject to RLS unless it owns the table or has BYPASSRLS; with no policies it is denied (INFERRED) ⇒ design work | bypassed |
| Direct writes via another route | possible, but invariant-checked | blocked for service_role; owner/superuser and migrations retain them | possible, unchecked ⇒ **E-10 pinning reachable** |
| Fit with repo precedent | matches P-9 | **departs** from every PI precedent | matches |
| Security review needed | trigger logic, lock ordering (deadlock between parent `FOR UPDATE` and other writers) | **full definer review**: search_path, EXECUTE grants, owner role, RLS interaction, argument validation, P-5/P-6 defaults | — |

**Recommendation (not a decision): M-1 with R-4.** It needs no grant change, follows the committed INVOKER precedent and does not depend on P-4's production status. A service key that bypasses RLS is **not** treated as safe: under M-1 tenant correctness rests on (i) the API validating the pair, which is **missing today (P-10)**, and (ii) the trigger's pair-existence check. Both are required.

**Owner decision:** `RDR-002 Q-6`. **Security review:** `RDR-002 Q-12`.

### 6.3 Note on F-1 (HEAD cross-tenant write path)

Reasoned from source, not executed through the product TypeScript:
1. At HEAD, POST `/api/active-leads/lifecycle` with an authorized `companyId` A and company B's opportunity UUID reaches `transitionLifecycle`.
2. `getCurrentLifecycleState(A, oppB)` finds no rows, so `from = 'detected'`.
3. `detected → triaged` is allowed (`opportunityLifecycle.ts:35-45`).
4. A row `(organization_id=A, opportunity_feed_item_id=oppB, previous_state='detected')` is inserted. PG-002 Experiment F shows the schema **accepts** such a row.

In the WT, step 2 returns `missing` and the transition is refused. That is incidental, not a tenant check. Preconditions: an authenticated user with the role, plus knowledge of a foreign UUID.

**Which version is deployed is UNKNOWN.** This is surfaced for the owner (`RDR-002 Q-13`), not exploited or tested.

---

## 7. Legacy integrity: ties, forks and unknown history

### 7.1 Categories

| # | Condition | Detectable from available fields? | Notes |
|---|---|---|---|
| **L-1** | **Tied top timestamps**: ≥2 rows share the opportunity's maximum `transitioned_at` with different states | **Yes, reliably** | the *order* within the tie is unrecoverable (PG-002 E4) |
| **L-2** | **Chain break with distinct timestamps**: ordering by `transitioned_at`, some non-initial row's `previous_state` ≠ the state of the immediately preceding row | **Yes, as a symptom.** The cause (fork, tie artefact, or the §4.4 inversion) is **not** always distinguishable | the E-4 fork produces exactly this |
| **L-3** | **Unrecoverable chronology**: tie groups anywhere in the history, or chain breaks with more than one consistent explanation | detectable as "ambiguous", not resolvable | — |
| **L-4** | **New rows** written under serialization (R-4 or function) | chain-consistent by construction **if** V-08/V-09 pass | verifiable by the same chain scan restricted to `seq IS NOT NULL` |
| L-5 | `missing` (no rows) / `contradictory` (initial row with a predecessor) | yes; the WT reader already classifies them | SOURCE (WT `readCurrentLifecycleState`) |

### 7.2 Correction to the proposed detector (F-2)

PROP-001 I-3/T23 and PG-002 R8 test "no `(opportunity, previous_state)` claimed by two rows". The **committed** graph permits revisits: `triaged ↔ reviewing`, `qualified ↔ monitoring`, `dismissed → triaged` (`backend/types/opportunityLifecycle.ts:35-45`). A legitimate history `triaged → reviewing → triaged → reviewing` contains two rows with `previous_state = 'triaged'`. **That test produces false positives.** The chain-consistency test (L-2) is the correct invariant.

### 7.3 Proposed gate behaviour (policy candidate, not adopted)

| Condition | Display readers (A3, A4, B1) | Transition validation | Terminality / deletion gate |
|---|---|---|---|
| Sequenced current row | `seq` order | proceed | normal rule |
| L-1 / L-3 at the top of a legacy-only history | deterministic pick, may mark uncertain (PROP-001 §6.2) | **open question.** PROP-001 §6.2 says "proceed", which permanently records a predecessor taken from an arbitrary pick. Refusing would leave the opportunity stuck forever (no repair route, `PROP-001 D-9`) | **non-terminal (fail closed)** |
| L-2 detected in a legacy history | deterministic | as above | **non-terminal (fail closed)**: extends `PROP-001 D-8` (`OR-001 G-2.2`) |
| L-5 missing / contradictory | as today | refused (WT) | non-terminal (WT predicate) |

**Preserved:** `archived` is the sole terminal state for ordinary deletion, as `isResolvedForAccountDeletion` encodes in the WT. A comment at `opportunityLifecycle.ts:30-31` calls `converted` and `archived` "terminal" in the *transition* sense. That is a vocabulary difference, **not** a redefinition, and nothing here changes it. Retention eligibility is unchanged: C3 is ordering-independent (WT only, §2.3). **Owner decisions:** `RDR-002 Q-7` and `RDR-002 Q-8`.

---

## 8. Report-only false-predecessor detection proposal (`PROP-001 D-13`)

**Proposal only. Not run. Repair, backfill, UPDATE, DELETE and any historical mutation are prohibited.** Under `CLAUDE.md`, raw evidence must not enter the repository or Jira, so the output is **aggregate counts only**.

| Element | Specification |
|---|---|
| Scope | all rows of `opportunity_lifecycle_states`, **analysed per `organization_id`**; results reported per tenant as counts, never pooled across tenants before classification |
| Method | read-only `SELECT` with window functions over `(organization_id, opportunity_feed_item_id)` ordered by `transitioned_at` (and `seq` once it exists) |
| Categories | **C-OK** chain-consistent · **C-TIE** tie group present, chain consistent under some ordering · **C-TIE-BREAK** no ordering of the tie group yields a consistent chain · **C-BREAK** chain break with distinct timestamps (L-2) · **M-MISSING** feed item with no lifecycle row · **M-CONTRA** initial row with a predecessor, or more than one initial row · **X-TENANT** row whose `organization_id` ≠ the parent feed item's `organization_id` |
| Confidence | C-BREAK = *definite inconsistency, cause unknown*; C-TIE-BREAK = *definite inconsistency, order unknown*; C-TIE = *ambiguous, not inconsistent*; X-TENANT = *definite* |
| Known false positives / limits | §4.4 timestamp inversion can make a serialized pair look like a break, though no serialization exists today. A break proves inconsistency, not *which* row is false. Decisions silently dropped by a fork cannot be recovered. Heap order is irrelevant: not used |
| Environment | the authoritative database, **read-only role, separately authorized**. The query can be rehearsed on the disposable replayed schema first |
| Output | counts per category per tenant id (or hashed tenant id). No row content, `reasoning`, `metadata` or actor ids |
| Prohibited follow-on | any correction. Results inform `PROP-001 D-8` scope and `RDR-002 Q-5`, nothing else |

---

## 9. Master verification register

**Status values:** EXECUTED (evidenced), SOURCE-VERIFIED, INFERRED, UNVERIFIED, BLOCKED, OWNER DECISION REQUIRED.

**Environments:**
- **DISP**: disposable PostgreSQL. Requires owner authorization to start Docker (PG-002 §2.1 precedent).
- **RO-TGT**: read-only inspection of the target environment. Requires separate authorization.
- **REPO**: read-only source.

**No item has passed.**

| ID | Requirement | Evidence available | Evidence missing | Env | Safe test method | Acceptance criteria | Authorization required | Status |
|---|---|---|---|---|---|---|---|---|
| **V-01** | `CHECK … NOT VALID` binds new rows, exempts legacy, no scan (PROP-001 §6.5-1) | none executed | execution; old-writer refusal consequence (R-1) | DISP | apply to replayed schema with NULL rows; insert NULL; measure scan | legacy survive; NULL insert refused; `seq_scan` delta 0; filenode unchanged | Docker | INFERRED |
| **V-02** | single-transaction `ADD COLUMN` + `ADD CONSTRAINT NOT VALID` + `CREATE UNIQUE INDEX` (§6.5-2) | E-8 (two-statement, non-txn) | single-txn run; lock level during index build | DISP | as V-01 inside one txn; concurrent insert session | no rewrite; 0 legacy valued; trigger not fired; concurrent insert blocks, never NULL | Docker | INFERRED |
| **V-03** | `UNIQUE (seq)` with many NULLs (§6.5-3) | PG-002 E3 (8): index built over NULLs | ≥2 NULL inserts after build | DISP | insert two NULL rows | both accepted; duplicate non-NULL `23505` | Docker | EXECUTED (build) / INFERRED (insert) |
| **V-04** | parent-row `FOR UPDATE` serializes like the advisory lock (§6.5-4) | E-14 (advisory only); committed precedent pattern (`20261122…`) | demonstration | DISP | rerun PG-002 Exp. D with `FOR UPDATE`, as superuser **and** a service-role-equivalent role | chain not fork; unrelated opportunity unblocked; identical wrong-tenant/nonexistent refusal | Docker | UNVERIFIED |
| **V-05** | actual grants, connecting role, BYPASSRLS; whether `20261026…` is applied (§6.5-5) | P-1–P-5 (SOURCE, dated) | current target state | RO-TGT | `has_table_privilege`, `information_schema.role_table_grants`, `pg_roles.rolbypassrls`, migration ledger | written inventory | separate read-only authorization | UNVERIFIED |
| **V-06** | lock wait under concurrency and timeouts (§6.5-6) | E-14 (a few trials) | target `lock_timeout`/`statement_timeout`; behaviour on expiry | DISP + RO-TGT | N-writer harness; `SHOW` timeouts | no fork; timeout → structured refusal, no partial row; p99 recorded | Docker + read-only | UNVERIFIED |
| **V-07** | **T22 authenticated-role RLS isolation** | **NOT RUN.** Every PG-002 experiment ran as `postgres`, `rolsuper=t` (PG-002 §2.2, §10) | any non-superuser test. Expected result under P-3 is **no access at all** (no grants, no policies), which is still unverified | DISP | JWT-claims `authenticated` role; read/write/execute both tables and the new function | all denied; function EXECUTE denied (P-6) | Docker | **NOT RUN.** Superuser results are **not** a substitute |
| **V-08** | writer cutover: no NULL-seq row after the first sequenced row; no valid write refused | none | rehearsal with an old-version writer running concurrently | DISP | run old W-TRANS/W-INIT loops while applying R-3 or R-4 steps | zero NULL rows after the first `seq`; zero refused legitimate writes (or an approved pause); zero lost initial rows | Docker | UNVERIFIED; **OWNER DECISION REQUIRED** (`Q-2`) |
| **V-09** | R-4 trigger: lock **before** `nextval`, predecessor check, overriding caller `seq` | none. E-1/E-3 cover default allocation only | demonstration | DISP | adapt PG-002 Exp. A2/C to a trigger that locks then allocates | lock order = seq order = commit order per opportunity; stale predecessor refused; caller `seq` overwritten; pinning impossible | Docker | UNVERIFIED |
| **V-10** | `transitioned_at` vs `seq` inversion (§4.4) | none | measurement | DISP | two sessions, B starts first, A locks first | inversion observed or excluded; if `clock_timestamp()` is adopted, no inversion | Docker | INFERRED |
| **V-11** | initial-row ordering, duplicate init, retry | SOURCE (§5) | mechanism-specific test | DISP | concurrent init ×2; init + transition race; init after history | one initial row; init `seq` < every transition `seq`; duplicates bounded | Docker | UNVERIFIED |
| **V-12** | direct-write denial or invariant enforcement for the chosen model | SOURCE (P-3, P-9) | test of the chosen model | DISP | M-1: direct `ownedDbTable` insert with forged `seq`/stale predecessor/mismatched pair. M-2: direct insert as service_role | M-1: refused or overwritten. M-2: `42501` | Docker | **OWNER DECISION REQUIRED** (`Q-6`) |
| **V-13** | new function EXECUTE grants | P-5/P-6 (SOURCE/INFERRED) | catalog check after deployment in DISP | DISP | `has_function_privilege` for PUBLIC, anon, authenticated | none can execute (unless the owner decides otherwise) | Docker | INFERRED |
| **V-14** | retry after a lost post-commit response (`PROP-001 D-12`) | PROP-001 §4.2 analysis | contract and test | DISP | commit, drop response, retry | outcome matches the chosen contract; never a duplicate row | Docker | **OWNER DECISION REQUIRED** (`Q-9`) |
| **V-15** | report-only false-predecessor detection (§8) | none | the run | DISP rehearsal → RO-TGT | §8 queries | counts per category per tenant; zero writes (verified by `pg_stat_user_tables` n_tup_ins/upd/del unchanged) | Docker; separate production read authorization | **OWNER DECISION REQUIRED** (`Q-10`) |
| **V-16** | transition regression: race, same-destination, unrelated opportunity, post-validation failure, tenant refusal (PROP-001 T5–T8, T10) | E-14 (PoC) | product path | DISP | real-schema suite through the product TS | as PROP-001 §8 | Docker | EXECUTED (PoC only) / UNVERIFIED (product) |
| **V-17** | reader regression: all current-state readers agree (T1, T3, T4, T12, T15, T17) | PG-002 B (ties give four answers) | post-change run | DISP | fixed history through A1, A3, A4, B1 | identical current state; legacy fallback per `Q-7` | Docker | UNVERIFIED |
| **V-18** | discarded errors C1, C2, A4 (T13) | SOURCE (§2.3) | test | unit + DISP | inject read failure | C1/C2 fail closed without INSERT; A4 surfaces the error | none beyond Docker | SOURCE-VERIFIED (defect) / UNVERIFIED (fix) |
| **V-19** | tenant isolation: mismatched pair refused at API and DB (T20, F-1) | E-12 (schema accepts); P-10 (SOURCE) | API-level test; DB-level test under the chosen model | DISP | POST with a foreign opportunity id; direct insert of a mismatched pair | both refused; wrong-tenant and nonexistent indistinguishable | Docker | SOURCE-VERIFIED (gap) / UNVERIFIED (fix) |
| **V-20** | append-only integrity (T11, T21) | E-6, E-13 (EXECUTED); test `pi_lifecycle_b21` **untracked** | post-change re-run | DISP | UPDATE/DELETE row; delete parent/company | `P0001`; rows survive | Docker | EXECUTED (pre-change) |
| **V-21** | retention unchanged (T14) | test `ret_retention_pre_exclusion` **untracked**; C3 WT only | post-change re-run on the committed base | DISP | protected + eligible rows | outcomes identical before and after | Docker | UNVERIFIED on the committed base |
| **V-22** | no accidental backfill; migration re-runnable (PG-002 R19/R20, PROP-001 T18/T19) | E-7, E-8 | run of the actual migration | DISP | apply, interrupt, re-apply | valued rows = post-migration inserts only | Docker | UNVERIFIED |
| **V-23** | product TypeScript exercised (OR-001 C-10) | B/C reproduced query shapes only | product run | DISP | real-schema tests calling the services | fork reproduced red today, green after | Docker | UNVERIFIED |
| **V-24** | committed baseline (OR-001 B-0/C-9) | §2.3 | human adoption commit | REPO | `git` read-only after the commit | every "WT only" row in §2.3 is present at a committed SHA | **human-only commit** | BLOCKED (human action) |
| **V-25** | target PostgreSQL major version | PG-002 ran 17.11 | target version | RO-TGT | `SHOW server_version` | recorded; DISP version matched | read-only | UNVERIFIED |

---

## 10. Boundaries: tenant isolation, append-only, retention, legal erasure

| Boundary | Position in this review |
|---|---|
| Tenant isolation | defence in depth: API pair validation (missing today, P-10), DB pair check (R-4 or function step 1), composite FK (`PROP-001 D-11`, not expressible today, E-12). RLS is **not** a layer on the service-role path (P-1). T22 NOT RUN |
| Append-only | UPDATE/DELETE stay `P0001`. No trigger disabled. No backfill. R-4 **adds** an insert-time trigger and alters no existing one. DDL bypass risk (E-7) is handled by the no-volatile-default rule (`PROP-001 D-2`) |
| Retention | eligibility unchanged. The protective probe (C3) exists **only in the WT**; at HEAD the retention reads discard errors (§2.3). This review proposes no retention change |
| Terminal states | `archived` is the only terminal state for ordinary deletion; nothing is redefined (§7.3) |
| Legal erasure / Q3 | **BLOCKED**: OD-002 §5.3 "POLICY NOT LOCATED / APPROVAL UNVERIFIED". Nothing here advances, implements or depends on it (`PROP-001 D-15`) |
| Repair | none proposed. Any future correction mechanism for append-only evidence needs a **separate governance decision** (`PROP-001 D-9`) |

---

## 11. Schedule and estimate comparison

### 11.1 Baseline and a source conflict

| Item | Value | Source |
|---|---|---|
| Milestone A′ | **Wed 2026-11-25 / 28.5 human engineer-days**, frozen | `PI-MILESTONE-A-EXECUTION-001` §3 via DC-001 §5.1 |
| WP-7 | **Tue 2026-11-17 / 4.0**; float **+6 to +10 d** | DC-001 §5.4 |
| C-1 | **+8–12 d new scope** | GATE-001 §9.5; DC-001 §5.4 |
| OVERRUN RISK | **RAISED** 2026-10-17T16:33+05:30; confidence raised to **MEDIUM-HIGH** | GATE-001 §9.5; OD-002 §7.5 |
| Next checkpoint | **Fri 2026-10-23**, the last date C-1 can start and keep any float | DC-001 §5.5; OD-002 §7.5 |

**Recorded conflict. Not resolved here.**
- **GATE-001 §9.5:** "Forecast finish 2026-11-25 at the low C-1 estimate; breach at the high estimate", variance "0 to +4 working days adverse".
- **DC-001 §5.4–§5.5 and OD-002 §7.5** (written later the same day): "+4 d at the low C-1 estimate; ZERO at the high estimate", forecast "2026-11-19 (low) to 2026-11-25 (high)", breach "if C-1 exceeds 12.0 d".

The later records agree with each other and with the "zero float at the high C-1 estimate" wording in every subsequent record. **OR-001 §F cited the GATE-001 figure.** The owner should confirm which statement is authoritative (`RDR-002 Q-11`). Both are shown below.

### 11.2 Estimates

| | Figure | Scope | Source |
|---|---|---|---|
| Previous | **3.5–6.5 d**, labelled **"incremental"** | A re-specified + E | IR-001 §11 |
| Proposed | **4.5–8.0 d** = impl. 3.0–5.0 + verification 1.0–2.0 + rollout 0.5–1.0 | Option 1; excludes CI, review, Phase 2, T22 harness | PROP-001 §9.1 |
| Other additions on record | S2: **4.0–7.0 d**; S2′: **5.5–10.0 d**, each on top of C-1 | separate architecture scope; overlap with this work **UNKNOWN** | `PI-C1-ARCHITECTURE-BLOCKER-REVIEW-001` :480; `PI-C1-JEV-ARCHITECTURE-DECISION-002` :571 |
| **Newly identified, not estimated here** | — | R-4 trigger + V-09/V-10; init mechanism (B-2); API pair validation (F-1); M-1/M-2 security review; detection exercise (§8); HEAD-based reconciliation after V-24; cutover rehearsal (V-08) | this document |
| Verification exclusions | — | V-05, V-06 (target part), V-15 (production), V-25 need read-only target access; V-07 needs a harness that does not exist | PROP-001 §9.1; this document |

**No new estimate is produced or adopted.** Newly identified work is listed, not sized.

### 11.3 Conditions that would constitute an overrun

This is arithmetic on recorded figures, not a forecast, and it uses the DC-001/OD-002 model: one sequential owner, 28 working days from Mon 2026-10-19, and 16.0 d of remaining baselined work.

| Inclusion (`RDR-002 Q-11`) | Condition for a Milestone A′ breach |
|---|---|
| **Inside C-1's 8–12 d** | C-1's total exceeds 12.0 d, including this work and the newly identified work |
| **Additional and on the critical path** | 16.0 + C-1 + ordering > 28.0. At the lowest pairing, 16 + 8 + 4.5 = **28.5**, already a breach of 0.5 d. At the highest, 16 + 12 + 8.0 = **36** (8 d) before newly identified work |
| Either | each working day of decision delay consumes one day of float (DC-001 §5.5). C-1's latest start at the 12-d estimate was **today, Mon 2026-10-19**. Whether C-1 has started is **UNKNOWN** |

Under GATE-001 §9.5's model the breach starts lower (above the low C-1 estimate). **The warning stays raised. No date is moved, no estimate revised, no float claimed.**

---

## 12. Owner decision sheet

All answers are **PENDING OWNER DECISION**. "Prereq" means the answer is a prerequisite for a separate implementation-authorization request.

| Ref | Question | Supported alternatives | Material consequences / risks | Evidence required | Prereq | Answer |
|---|---|---|---|---|---|---|
| **RDR-002 Q-1** (`PROP-001 D-1`, `PROP-001 D-3`) | Adopt Option 1 with ordering allocated under the per-opportunity lock, and is the contract **exactly** "per-opportunity serialized transition order" (not global commit, business-event or legacy chronology)? | Opt 1 / Opt 2 / Opt 3 (PROP-001 §9) | broader contract repeats E-2's error; Opt 3 fixes neither defect | V-04 or V-09 | **Yes** | **PENDING OWNER DECISION** |
| **RDR-002 Q-2** | Writer cutover strategy | **R-4** (candidate) / **R-3** (fallback) / R-1 / R-2 | R-1 write outage; R-2 permanent misranking; R-3 loses initial rows unless init is queued, and needs topology knowledge; R-4 is new and undemonstrated, and departs from PROP-001 I-10's wording | V-08, V-09 (R-4), topology (R-3) | **Yes** | **PENDING OWNER DECISION** |
| **RDR-002 Q-3** | Set `transitioned_at` from `clock_timestamp()` after the lock, or declare it non-ordering? | clock_timestamp / declare / both | inversion confuses history and audit (B1, D1) | V-10 | Yes | **PENDING OWNER DECISION** |
| **RDR-002 Q-4** | Initial-row ordering mechanism | R-4 trigger covers it / function init mode / separate init function under the same lock | without one, init is refused (CHECK) or unordered | V-11 | **Yes** | **PENDING OWNER DECISION** |
| **RDR-002 Q-5** | Opportunities with no lifecycle history (`missing`): leave permanently untransitionable, or a governed path? | leave / separate governed decision | a later initial row would fabricate creation evidence | §8 M-MISSING count | No (record the limitation) | **PENDING OWNER DECISION** |
| **RDR-002 Q-6** (`PROP-001 D-10`) | Privilege and exclusivity model | **M-1** (candidate) / M-2 / M-0 | M-0 leaves E-10 pinning reachable; M-2 needs a definer review and a grant change to service_role; M-1 needs R-4 | V-05, V-12, V-13 | **Yes** | **PENDING OWNER DECISION** |
| **RDR-002 Q-7** (`PROP-001 D-8` extended) | Terminality on ambiguous or inconsistent legacy history: non-terminal for L-1, L-2 **and** L-3? | ties only / ties + breaks / all ambiguity | ties-only lets a fork drive deletion eligibility | V-15 | Yes, for any terminality consumer | **PENDING OWNER DECISION** |
| **RDR-002 Q-8** | Transition validation on a tied legacy top: proceed (PROP-001 §6.2), refuse, or proceed and record the basis in `metadata`? | proceed / refuse / proceed-and-mark | proceed records an arbitrary predecessor permanently; refuse strands the opportunity | — | Yes | **PENDING OWNER DECISION** |
| **RDR-002 Q-9** (`PROP-001 D-12`) | Retry/idempotency contract after a lost response | opaque refusal accepted / idempotency key | opaque refusal confuses clients; a key adds scope | V-14 | No | **PENDING OWNER DECISION** |
| **RDR-002 Q-10** (`PROP-001 D-13`) | Authorize the report-only detection (§8): DISP rehearsal, then read-only target run | rehearsal only / both / neither | without it the damage and the M-MISSING count are unknown | — | No | **PENDING OWNER DECISION** |
| **RDR-002 Q-11** | Is 4.5–8.0 d inside C-1 or additional? Which float statement (GATE-001 §9.5 vs DC-001/OD-002) is authoritative? Response to the standing OVERRUN RISK (recovery options a–d) | inside / additional; GATE / DC-OD | §11.3 conditions | — | **Yes** | **PENDING OWNER DECISION** |
| **RDR-002 Q-12** | Required independent review: human or other-model-family review of the revised design; security review of the trigger and privilege model | human / other-family agent / both | every review in the chain is same-family (IR-001 §2; PG-002 §10); a same-family reviewer previously confirmed wrong findings (IR-001 §2) | — | **Yes** | **PENDING OWNER DECISION** |
| **RDR-002 Q-13** | F-1: treat the HEAD cross-tenant transition path as a security finding to triage now, independent of this package? Which code version is deployed? | triage now / fold into this package | if HEAD is deployed, mismatched-pair rows may already exist (§8 X-TENANT) | deployed version; V-19 | No (independent) | **PENDING OWNER DECISION** |
| **RDR-002 Q-14** (`PROP-001 D-11`) | Add `UNIQUE (id, organization_id)` and a tenant-qualified FK in this package? | in / out | out: DB tenant integrity rests on the R-4 pair check only | deletion-behaviour review | No | **PENDING OWNER DECISION** |
| **RDR-002 Q-15** | Accept verification limitations: which V-items must pass before authorization, which before merge; is V-07 (T22) required or an accepted gap? | per item | superuser results do not prove RLS | — | **Yes** | **PENDING OWNER DECISION** |
| **RDR-002 Q-16** | Authorize the DISP run (Docker) and, separately, read-only target inspection (V-05, V-06, V-25) | each independently | none run without it | — | Yes (for the gates) | **PENDING OWNER DECISION** |
| **RDR-002 Q-17** | Baseline: perform the human adoption-baseline commit of the Phase-1 work (V-24) | commit / keep uncommitted | the design rests on WT-only code | — | **Yes** | **PENDING OWNER DECISION** |
| **RDR-002 Q-18** (`PROP-001 D-7`) | **Authorize implementation** | — | not recommended until §14 is met | §14 | — | **PENDING OWNER DECISION** |

Carried forward unchanged and still pending: `PROP-001 D-2` (no backfill), `PROP-001 D-4` (decide after V-24), `PROP-001 D-9` (born-terminal deferral), `PROP-001 D-14` (discarded errors), `PROP-001 D-15` (Q3 blocked), and `OR-001 G-1.6` (`PG-002 D-8` supersession).

---

## 13. Acceptance criteria for the next review

The next review (for example `…-003`) should be accepted only if:
1. **V-24 is done.** Every "WT only" row in §2.3 is re-verified at a committed SHA, and the consumer map is regenerated from that SHA.
2. Q-1, Q-2, Q-4, Q-6, Q-11, Q-12 and Q-17 have written answers recorded with their qualified references.
3. A revised design document specifies the chosen cutover, init mechanism and privilege model, with a recorded hash, and cites PG-002/RDR-002 evidence for every claim.
4. Every V-item the owner marks "before authorization" (Q-15) has quoted raw evidence from an authorized DISP or RO-TGT run. Superuser runs are labelled as such, and none stands in for V-07.
5. The schedule float conflict (§11.1) is resolved by the owner, not by the reviewer.
6. A human or other-family review per Q-12 is recorded.
7. **Stop conditions:** any need for production writes, grant changes, trigger disabling or historical mutation; any hash mismatch; any answer that would require inferring owner intent.

---

## 14. Implementation authorization gate

**This document does not authorize implementation.** A separate request should not be considered until all of the following hold:

1. **Baseline:** V-24 met.
2. **Decisions:** Q-1, Q-2, Q-3, Q-4, Q-6, Q-7, Q-8, Q-11, Q-12, Q-15 and Q-17 answered.
3. **Evidence:** V-01, V-02, V-04 (or V-09 if R-4), V-05, V-08, V-10, V-11 and V-12 pass with quoted evidence. V-07 is passed or explicitly accepted as a gap.
4. **Review:** an independent and security review per Q-12 is complete.
5. **Schedule:** Q-11 answered. Any baseline change is explicitly approved.
6. **Governance:** an OMNI Story whose Authorized Paths cover exactly the migration, the function/trigger, the two writers, the affected readers and the API pair check, verified via `gov verify` registry commands only.
7. **Invariant boundaries:** no backfill, no trigger disabled, append-only intact, retention eligibility unchanged, Q3 untouched.

---

## 15. Limitations and unresolved dependencies

- **Nothing is executed.** R-4, M-1, the §4.4 inversion and the §5 init behaviour are inferences from source and documented PostgreSQL semantics. R-4 in particular is **a new mechanism that no experiment has tested**.
- Production facts (grants, roles, applied migrations, PostgreSQL version, deployed code version, timeouts, topology) are **UNVERIFIED**. P-1 rests on a dated record inside a committed file, not on an observation made here.
- F-1 is reasoned from source and is consistent with E-12, but was not reproduced through the product TypeScript.
- PG-002's raw scratch evidence (`…/scratchpad/pgi002/`) was not inspected. Its results are cited as reported.
- Every PI governance document is untracked, so document identity is by content hash only.
- **This is not independent review.** It was produced by the same model family as INV-001, IR-001, PG-002, PROP-001 and OR-001, and shares their blind-spot class.
- Unresolved dependencies: V-24 (human commit), Q-11 (estimate inclusion and float conflict), Q-12 (independent review), Q-13 (F-1 triage), Q-16 (authorizations for DISP and RO-TGT), Q3 (legal policy, blocked).

### Files inspected (read-only)
- **Documents:** INV-001, IR-001, PG-002 and PROP-001 (hashed, read in full or by section); OR-001 (own prior artifact, hashed); GATE-001 §9.5; OD-002 §5.3, §7.5; DC-001 §5.4–§5.5; and a grep of the other C-1 records for "zero float".
- **WT and `git show HEAD:` (diffed):** `backend/services/opportunityLifecycleService.ts`, `pages/api/active-leads/lifecycle.ts`, `backend/services/retentionService.ts`, `backend/types/retention.ts`.
- **WT only:** `backend/services/listeningSignalPipeline.ts:298-320`, `backend/types/opportunityLifecycle.ts:30-50`, `backend/db/writeOwner.ts`, `backend/db/supabaseClient.ts`, `backend/services/strategicDashboardsService.ts:150-160`.
- **Migrations and schema:** `supabase/migrations/20261026000000_close_anon_rls_exposure.sql`, `supabase/migrations/20261122000000_pi_person_account_relationships.sql:488-530`, `supabase/migrations/20261128000000_pi_canonical_write_atomicity.sql:15-50`, `supabase/migrations/20260520_phase6_realtime_lifecycle_workflow.sql` (grep), `supabase/_schema/baseline.sql` (grep).
- **Repository-wide:** `git grep` at HEAD for `opportunity_lifecycle_states`, `initialiseLifecycleForOpportunity` and `.rpc(` usage.

**Created:** this file only. **Changed:** nothing else.
