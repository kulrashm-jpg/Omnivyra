# PI-C1-LIFECYCLE-ORDERING-OWNER-REVIEW-001 — owner-decision and evidence-closure review

**Review and documentation only.** No product code, test, schema, migration, configuration, environment, database, governance record or deployment setting was changed. No database or container was started, connected to or queried. No commit, branch, PR, merge, push or deployment. The source proposal and all earlier reports were read, not edited.

**Implementation authorization: NOT GRANTED. No working position below is an approved owner decision, and none is inferred from this request, from earlier recommendations, or from technical feasibility.**

---

## 0. Evidence identity and provenance

| Document | SHA-256 (computed in this review) | Lines | Recorded hash | Status |
|---|---|---|---|---|
| `PI-C1-LIFECYCLE-ORDERING-DESIGN-PROPOSAL-001.md` (**PROP**) | `9e3e570c267b403562a3077ff9793c4b73f3bed930a5b877c515c154e88a6d10` | 403 | **none recorded anywhere** | identified; hash recorded here for the first time |
| `PI-C1-LIFECYCLE-ORDERING-INVESTIGATION-001.md` (**INV**) | `2be20d2d7300a4343884e7048a3247c30d3c1461fec12a99d4c7b1636f956e2e` | 403 | PROP §2, PG §2 | **MATCH** |
| `PI-C1-LIFECYCLE-ORDERING-INDEPENDENT-REVIEW-001.md` (**IR**) | `36edb0b7f6a2d4206c6e207cb10e59e47832f3809f203636694668ab387c6d85` | 396 | PROP §2, PG §2 | **MATCH** |
| `PI-C1-LIFECYCLE-ORDERING-POSTGRES-INVESTIGATION-002.md` (**PG**) | `74bdb3608766360b77ad6c68bbd4706ac47fcb6a2f9bdec4267241e96612f810` | 394 | PROP §2 | **MATCH** |

Also read: `PI-C1-IMPLEMENTATION-GATE-001.md` §9.5 (C-1 OVERRUN RISK record), `PI-C1-OWNER-DECISIONS-002.md` §5 (Q3), grep of `PI-C1-DECISION-CLOSURE-001.md` and `PI-MILESTONE-A-EXECUTION-001.md` §3 for the baseline. All of them, along with every PI document named here, are **untracked** working-tree files on `fix/r1-profile-context`. None is in git history.

PG's raw evidence (`…/scratchpad/pgi002/`, 35 files) was a different session's scratch directory. It was **not inspected** here, and executed results are cited as PG reports them.

### 0.1 Material provenance finding: the evidence describes uncommitted code

The evidence chain's source map (the 11 consumers, every line number, "A2 is dead", `isResolvedForAccountDeletion`, the `ownedDbRpc` seam and the `pi_apply_canonical_decisions` precedent) describes the **uncommitted working tree**. It does not describe HEAD `29fea38a` or `main` `fef34178`. Verified read-only:

| Claim in PROP | Working tree | Committed HEAD `29fea38a` |
|---|---|---|
| S-1: `ownedDbRpc` exists "and has a production caller" | present (`backend/db/writeOwner.ts` is **M**; caller at `ingestionBoundary.ts:1014`, also **M**) | **`ownedDbRpc` absent; `pi_apply_canonical_decisions` absent**. Also absent on `main` |
| S-2: precedent function in `20261128000000_pi_canonical_write_atomicity.sql` | present | **untracked (`??`)**, not committed |
| A1 `readCurrentLifecycleState`, A2 `getCurrentLifecycleState` dead, `previous_state` at `:281` | matches PROP §7 | `opportunityLifecycleService.ts` has **+139/−2 uncommitted lines**. At HEAD, **`getCurrentLifecycleState` is the live reader** (called by `transitionLifecycle` at `:131`, `previous_state` at `:144`) and `isResolvedForAccountDeletion` does not exist |

**Consequence.** No evidence is contradicted, because PG §2 records the dirty tree (162 entries). But "production caller" means "caller in uncommitted Phase-1 work", not deployed code. D-4 ("remove the dead reader") is true only of the working tree. Any implementation request therefore depends on that working tree being committed first. Under `CLAUDE.md` that means the governed adoption-baseline path. **This prerequisite is not listed in PROP.** It is not a stop condition, because the evidence is internally consistent and available. It is recorded as blocker **B-0**.

### 0.2 Material traceability finding: decision IDs are reused with different meanings

PROP §12 renumbers the register. It marks only D-1 as "replaces the original", but five IDs change meaning:

| ID | INV §8 / IR §10 | PG §9 | **PROP §12 (used in this review)** |
|---|---|---|---|
| D-3 | accept sequence-assignment ordering without serialization | **NOT SUPPORTED** | contractual meaning of the ordering field (= PG D-9) |
| D-5 | write race as a **separate** package (INV recommended *separate*) | separate, "must not mean deferred" | remediate **first, in this package** |
| D-6 | authorize the disposable-PG investigation | **DISCHARGED** | further verification (§6.5) required |
| D-8 | — | `GENERATED ALWAYS` cannot be nullable: choose (a)–(d) | legacy tied rows → terminality result |
| D-9 | — (IR §8.1 heading calls born-terminal "D-4") | contractual ordering property | born-terminal repair route |
| D-10 / D-11 | — | discarded `error`s / cross-tenant | write exclusivity / tenant-qualified FK (PG D-10 → PROP **D-14**) |

**Risk.** An owner answer recorded as "D-8: fail-closed" could be bound to the wrong question. **Recommendation:** record every owner answer as `PROP-001 D-n`, quoting the question text (§G does this). PG D-8 is **superseded in substance, not answered**: PROP Option B removes the column default, so the `GENERATED ALWAYS`/nullable contradiction no longer arises (PROP §5.2). The owner should confirm that supersession explicitly (G-1.6).

---

## A. Executive disposition

**PARTIALLY ALIGNED.** The six working positions match PROP §12's recommended candidates and are supported by the executed evidence. But three gaps found in this review mean the design is **not yet implementable as written**:

1. **The rollout plan contradicts itself (§E.4).** PROP §6.3 P1 adds `CHECK (seq IS NOT NULL) NOT VALID` and orders the rollout P1 → P3 → P2. The writer change comes last. Under documented `NOT VALID` semantics (`INFERRED`), every insert from the two existing writers would then be refused between P1 and P2: a lifecycle-write outage. Dropping the CHECK instead lets NULL-seq rows written by old writers rank below earlier sequenced rows, which breaks PROP §5.3's "sequenced ⇒ later" premise. PROP does not analyse the mixed-writer window.
2. **The write-exclusivity premise of D-3 conflicts with the chosen privilege model (§E.6).** Option B depends on "only the function writes `seq`" (PROP §5.2) to prevent the demonstrated pinning hazard (E-10). Yet PROP rates D-10 as "can proceed degraded". It also proposes revoking direct INSERT while keeping `SECURITY INVOKER`. Those two cannot both hold, because an invoker function inserts with the caller's privileges (`INFERRED`).
3. **The baseline is uncommitted (§0.1).** The design rests on code that exists only in the dirty working tree.

**Implementation authorization remains NOT GRANTED.** This document recommends; it decides nothing.

---

## B. Decision matrix — the six working positions

Labels follow PROP §2: **EXECUTED** (PG run), **SOURCE**, **INFERRED**, **UNVERIFIED**, **OWNER DECISION REQUIRED**.

| | **D-1 Design** | **D-3 Ordering contract** | **D-8 Legacy ties** | **D-5 Concurrency scope** | **D-6 Verification** | **D-9 Born-terminal** |
|---|---|---|---|---|---|---|
| **Exact question (PROP §12)** | "Which design?" | "What does the ordering field mean contractually?" | "Legacy tied rows: what should a terminality read return?" | "Concurrency remediation and timing" | "Further verification needed after the executed run?" | "A born-terminal row has no repair route. Accept, or provide a governed correction path?" |
| **Working position** | Provisional | Per-opportunity serialized transition order | Fail-closed | Same-scope remediation | Further verification required | Defer |
| **PROP candidate** | Option 1: atomic op + ordering allocated inside it | per-opportunity serialized order; *not* global commit or business order | fail closed (unknown ⇒ non-terminal) | do it first, in this package | yes: the six §6.5 items | accept for now; record the limitation |
| **Alternatives (PROP §9, §12)** | Opt 2 (no column: replay ambiguous on repeated states); Opt 3 (tie-break only: fixes neither defect) | commit order: **contradicted** by E-2 | deterministic pick: a fabricated order would drive deletion eligibility | separate package (INV's original recommendation) | proceed without verification | governed privileged correction path (a new write into append-only evidence) |
| **Supporting evidence** | E-4 fork live; E-14 PoC chain-not-fork; E-1/E-3 trigger lock cannot serialize | E-2, E-3 (EXECUTED); PROP §5.1 table | E-7 (backfill invents order); PG E4 (ties unrecoverable) | E-4 + E-6: every transition can permanently write a false predecessor; ordering alone makes the fork *stable* (PG §8) | PROP §6.5; IR §13 | E-6 (UPDATE/DELETE → P0001); PROP §5.3 cost note |
| **Contradicting / weakening** | §E.4 rollout contradiction; §E.6 privilege conflict; lock primitive not demonstrated (§C-4) | holds **only if** no other path writes `seq` (E-10) and no NULL-seq row lands after the first sequenced row (§E.4) | covers **ties only**. A legacy **fork** with distinct timestamps (E-4 shape) has a well-defined but possibly false "latest" and is not caught | none found | none | none. The PG E2 2030 corrective-append scenario is closed by the design, not repaired |
| **Verified** | PoC shape (EXECUTED, superuser, purpose-built schema) | E-2 (EXECUTED) | ties exist (E-5, EXECUTED) | fork (EXECUTED, query shapes, not TS) | — | append-only (EXECUTED) |
| **Inferred** | `NOT VALID` semantics; single-txn DDL | per-opportunity commit order under row lock | — | — | — | — |
| **Unverified** | grants, roles, production, product TS | write-path exclusivity (D-10) | count of affected legacy opportunities (D-13 not run) | production equivalence | items 5–6 need real-environment access | — |
| **Dependencies** | B-0, D-3, D-8, D-10, D-6 gates | D-10, CHECK timing (§E.4) | D-13 (detection could scope it); a terminality consumer exists only in uncommitted code (S-4) | D-1 | owner authorization for a disposable DB / read-only grant inspection | none |
| **Prerequisite for implementation authorization?** | **Yes** | **Yes** (PROP: "the critical question") | **Yes for any terminality consumer**; recommended before authorization because the reader contract (A1) must encode it | **Yes** | **Yes** | **No**, if the limitation is recorded |
| **Remaining owner question** | G-1.1 | G-1.2 | G-2.1, G-2.2 | G-4.1 | G-3 | G-2.3 |
| **Review recommendation (not a decision)** | **Keep provisional.** Do not confirm Option 1 until the §E.4 rollout sequence and the §E.6 privilege model are re-specified | **Support**, conditional on D-10 being made a hard prerequisite, not "degraded" | **Support**, and **extend the question** to cover detected legacy forks, not only ties | **Support.** The evidence reverses INV's "separate" recommendation, and PROP documents why | **Support**, with three additional gates (§C-8–§C-10) | **Support deferral.** Any future correction mechanism needs a **separate governance decision**; nothing here creates one |

**Design assertions the brief asked to be verified against PROP text:**

| Assertion | PROP text | Result |
|---|---|---|
| Lock acquired before the authoritative read | §4.1 step 2 "BEFORE any read or allocation" | **Documented**; demonstrated with an advisory lock (E-14), not with the proposed `FOR UPDATE` |
| Validation against that state | §4.1 steps 3–4 | Documented |
| Insert and allocation inside the same operation | §4.1 step 5; §5.2 B "calls `nextval()` explicitly after the lock" | Documented |
| Lock held to transaction end | §4.1 step 7 | Documented; `FOR UPDATE` row locks are transaction-scoped (`INFERRED`) |
| No reliance on a column default or trigger-held lock | §5.2 A rejected; §1 corrections | Documented: "no DEFAULT and no identity declaration" |
| No historical backfill / fabricated chronology | §6.2 "never given a value"; D-2 | Documented. **Caveat:** §E.4's mixed-writer window can create *new* NULL-seq rows that are later than sequenced ones |

---

## C. Verification register

None of these gates has passed. "Blocks?" means whether the missing proof blocks a separate implementation-authorization request.

| # | Gate | Current evidence | Label | Missing proof | Safe method | Environment / role | Acceptance criteria | Blocks? |
|---|---|---|---|---|---|---|---|---|
| **C-1** | `CHECK (seq IS NOT NULL) NOT VALID`: new rows bound, legacy exempt, no scan | PROP §6.5-1 | **INFERRED** | execution; also proof of the **insert-refusal consequence for existing writers** (§E.4) | disposable PG, same major version as target | disposable container (needs owner Docker authorization, per PG §2.1 precedent); superuser acceptable for DDL semantics | legacy NULL rows survive; new NULL insert refused; no table scan (lock/timing or `pg_stat_user_tables.seq_scan` delta); filenode unchanged | **Yes** |
| **C-2** | `ADD COLUMN` + `ADD CONSTRAINT … NOT VALID` + `CREATE UNIQUE INDEX` in one transaction: no rewrite, no intermediate state | PROP §6.5-2; E-8 covers the two-statement form only | **INFERRED** (E-8 EXECUTED for the non-transactional form) | single-txn execution; lock level held (`CREATE INDEX` without `CONCURRENTLY` blocks writes for the build) | as C-1, on the replayed real schema | disposable; superuser | filenode unchanged; 0 legacy rows valued; append-only trigger not fired; concurrent insert blocks or is refused, never NULL | **Yes** |
| **C-3** | `UNIQUE (seq)` tolerates many NULLs | PG E3 answer (8): "a UNIQUE index … builds over NULLs without complaint" | **EXECUTED** (index build over NULLs); multi-NULL *insert* after build **INFERRED** | insert ≥2 NULL rows after index exists (only if any NULL path survives) | as C-1 | disposable | ≥2 NULL rows coexist; duplicate non-NULL refused `23505` | No (low risk) |
| **C-4** | Parent-row `SELECT … FOR UPDATE` gives the serialization the advisory lock demonstrated | **Not demonstrated.** E-14 used `pg_advisory_xact_lock`; S-2's `FOR UPDATE` is in an **uncommitted** migration | **UNVERIFIED** | two-session chain-not-fork, unrelated-opportunity non-blocking, wrong-tenant refusal, **as a non-superuser role** (FOR UPDATE needs UPDATE privilege on `opportunity_feed_items` and, under RLS, passing UPDATE policies: `INFERRED`) | rerun PG Experiment D with the row-lock variant | disposable; **both superuser and the application-equivalent role** | identical outcomes to E-14 table rows; succeeds under the app-equivalent role | **Yes** |
| **C-5** | Actual grants; feasibility of revoking direct INSERT | none. Text search of `supabase/_schema/baseline.sql` finds no table-specific GRANT/POLICY lines for either table. The server client uses `SUPABASE_SECRET_KEY` (`supabaseClient.ts:53-56`, **SOURCE**), probably a BYPASSRLS role (**INFERRED**) | **UNVERIFIED** | effective privileges in the target environment; which role the app connects as; compatibility of REVOKE with a `SECURITY INVOKER` function (§E.6) | **read-only** catalog inspection (`information_schema.role_table_grants`, `pg_roles.rolbypassrls`, `has_table_privilege`) | **target environment, read-only role, requires separate owner authorization**. Not a disposable DB | written grant inventory; a stated privilege model in which the authoritative op can INSERT and ordinary callers cannot | **Yes** (D-3 depends on it) |
| **C-6** | Lock-wait under realistic concurrency and statement timeouts | E-14: a handful of trials; PG §10 "not a statistical distribution" | **UNVERIFIED** | timeout settings in the target; behaviour on `lock_timeout`/`statement_timeout` expiry; error mapping to a structured refusal | disposable load harness + read-only `SHOW` of timeouts in the target | disposable + read-only target | no fork under N concurrent writers; timeout yields a documented refusal, no partial row; p99 wait recorded | Yes, for rollout; not for design |
| **T22** | Authenticated-role RLS isolation | **NOT RUN.** Every experiment ran as `postgres`, `rolsuper = t` (PG §2.2, §10; PROP §11) | **NOT RUN** | any non-superuser test | authenticated-role harness (does not exist: PROP §9.1) | disposable, a JWT-claims role under RLS | cross-tenant read/write refused | **Superuser results must not be substituted.** Blocks any tenant-isolation claim; whether it blocks authorization is G-3.2 |
| **C-8** *(new)* | Writer cutover: no NULL-seq row after the first sequenced row, and no write outage | none; PROP §6.3/§6.4 do not analyse it | **UNVERIFIED** | a cutover sequence (see §E.4) | disposable rehearsal of the full P-sequence with an old-version writer running concurrently | disposable | zero refused legitimate writes **or** an approved pause window; zero NULL-seq rows after the first sequenced row | **Yes** |
| **C-9** *(new)* | Committed baseline | §0.1 | **SOURCE** | Phase-1 working-tree changes committed under the governed path | `git` read-only check after the human adoption commit | repository | `ownedDbRpc`, A1–A4/B1/C1–C2 present at the committed base; line map re-verified | **Yes** |
| **C-10** *(new)* | Product TypeScript exercised | Experiments B/C reproduced query shapes only (PG §10) | **UNVERIFIED** | the real `transitionLifecycle`/`initialiseLifecycleForOpportunity` against a disposable DB | real-schema test suite (`backend/tests/realschema`) | disposable | R5/T5 fork reproduced through the TS today (red), absent after the change (green) | Yes, before merge; not before authorization |

---

## D. Dependency register

Owners and roles are **UNKNOWN** throughout. No role assignment exists in the evidence, and none is invented.

| ID | Question (PROP §12) | Status | Blocker / dependency | Owner / role | Proposed next action (recommendation) |
|---|---|---|---|---|---|
| **D-2** | Any historical backfill? | Candidate **No**; IR/PG: **SUPPORTED BY EVIDENCE** (E-7, PG E4) | none. But it **must be two statements or a transaction without a volatile default** (E-7) | OWNER DECISION REQUIRED (confirm) | Confirm "no backfill" with the explicit constraint "no volatile DEFAULT, no trigger suspension" |
| **D-4** | Remove dead `getCurrentLifecycleState`? | Candidate remove | **True only in the working tree.** At HEAD it is the live reader (§0.1) | technical owner — UNKNOWN | Re-evaluate after B-0; decide on the committed base |
| **D-9** | Born-terminal repair route | Candidate accept/defer | none. A future correction path needs **separate governance** and must not weaken append-only (I-7) | product owner — UNKNOWN | Record the limitation in the decision record; no mechanism designed |
| **D-10** | Enforce write exclusivity by revoking direct INSERT? | Candidate yes "if grants permit"; PROP rates it "degraded" | **C-5 UNVERIFIED**; conflicts with `SECURITY INVOKER` (§E.6); **D-3's guarantee depends on it** (E-10 pinning) | technical + DB-admin owner — UNKNOWN | **Re-classify as a prerequisite** for D-3. Owner chooses the mechanism class: privilege + `SECURITY DEFINER` with pinned `search_path`, or a guard (PROP §4.2 names both) |
| **D-11** | `UNIQUE (id, organization_id)` + tenant-qualified FK | Candidate yes | E-12: not expressible today; deletion-behaviour review pending (PROP §12); **PROP §13 counts it in scope but §9.1 omits it** | technical owner — UNKNOWN | Decide in or out of this package; align the estimate |
| **D-12** | Retry after lost post-commit response | Candidate: define idempotency | none blocking; blind retry is safe but opaque (PROP §4.2) | product owner — UNKNOWN | Decide whether an opaque refusal is acceptable for the first release |
| **D-13** | Report-only detection of existing false predecessors | Candidate yes, **detection only** | needs read access to the target data (production), which **requires separate authorization** | data / privacy owner — UNKNOWN | Authorize a read-only count. **No repair, no UPDATE, no historical mutation.** The result scopes D-8 |
| **D-14** | Three discarded `error` values (A4 `strategicDashboardsService.ts:153`, C1 `:166`, C2 `:190`) | SOURCE-verified to exist (re-checked here; working-tree lines) | C1 can lead to an INSERT after a read failure | technical owner — UNKNOWN | Include C1/C2 in scope (they sit on the writer path); A4 per role |
| **D-15** | Q3 legal-erasure dependency | **BLOCKED.** `PI-C1-OWNER-DECISIONS-002` §5.3: "POLICY NOT LOCATED / APPROVAL UNVERIFIED" | policy absent | legal / policy owner — UNKNOWN | No action in this package. Nothing in PROP depends on Q3 or advances it |

**Material dependencies not in the brief's list:**

| ID | Dependency | Why material |
|---|---|---|
| **B-0** | Commit the Phase-1 working tree under the governed adoption-baseline path | §0.1: the design's seam, precedent and reader map are uncommitted |
| **B-1** | CHECK timing and the writer cutover sequence | §E.4: the plan as written causes a write outage or breaks §5.3 |
| **B-2** | Initial-row ordering value | PROP §7 flags that `initialiseLifecycleForOpportunity` (`:174`) also needs `seq`, but §4.1 defines only the transition function. With the CHECK, initialisation would also be refused |
| **B-3** | Decision-ID binding | §0.2 |
| **B-4** | Production PostgreSQL version | PG ran 17.11; target version **UNKNOWN**. The `NOT VALID`, fast-default and `FOR UPDATE` behaviours should be confirmed on the target major version |

---

## E. Rollout and integrity risks

1. **Stale-predecessor race (live).** `transitionLifecycle` reads in one autocommitted statement and inserts in another, with no lock (PG Experiment C, **EXECUTED** on query shapes). Two sessions both read `detected` and both inserted rows claiming it. `previous_state` is persisted from the read (S-3). UPDATE/DELETE raise P0001 (E-6), so each fork is **permanent**. Only the atomic operation (I-1/I-2) prevents it. An ordering column alone makes the arbitrary resolution stable and quieter (PG §8).
2. **Ordering ambiguity (latent).** Two writes in one transaction share `now()`. Four secondary keys produced four answers (PG B). Legacy tie chronology is unrecoverable (PG E4).
3. **Reader-first rollout.** Because the writer persists its read, two code versions that order differently can each write a different predecessor for the same prior state (PG E3 deployment requirement; PROP §6.3). The readers that derive current state are A1 (and so the writer), A3 board, A4 dashboard and B1 history; A2 is dead in the working tree. They must converge at 100 % of instances before anything depends on the new order. A per-instance feature flag is insufficient (PROP §6.3).
4. **Intermediate migration state and writer cutover (this review's finding).**
   - PROP §6.3 P1 adds `CHECK (seq IS NOT NULL) NOT VALID` with **no column DEFAULT**. The rollout runs P1 → P3 → P2.
   - The existing writers (`:174`, `:276`) never supply `seq`, so after P1 every insert would fail the CHECK. `NOT VALID` exempts only existing rows (**INFERRED**, C-1). The result is a fail-closed **lifecycle-write outage**, including initialisation of new opportunities, until P2 reaches 100 %.
   - Without the CHECK, old-version instances still writing during P2 rollout produce NULL-seq rows *after* sequenced rows exist. `NULLS LAST` then ranks them below older sequenced rows, which gives a wrong current state. Those unlocked writes also keep the fork possible.
   - PROP §6.4 also states that a NULL row inserted before the CHECK "would violate the NOT VALID check once added". Under `NOT VALID` it would not be checked. It would silently become indistinguishable from a legacy row (**INFERRED**).
   - **Owner choice required (G-1.3):** a brief write pause at cutover; the CHECK added only after P2 reaches 100 %, with old-writer NULL rows accepted as "legacy"; or a database-side write path that makes the skew impossible. No option is adopted here.
5. **Append-only protections.** UPDATE/DELETE stay P0001 (E-6, T11). DDL bypasses the guard: a volatile-default `ADD COLUMN` rewrote all rows without firing it (E-7). Hence D-2's two-statement or no-default constraint and I-7's "no migration may disable a trigger".
6. **Tenant isolation and privilege model.**
   - The cross-tenant row is accepted today (E-12), and a composite FK is not expressible without D-11.
   - The PoC's tenant-qualified lookup gives identical refusals for wrong-tenant and nonexistent ids (E-14).
   - The server credential is a secret key (SOURCE), so RLS is probably **not** a layer on the application write path (INFERRED). T22 is NOT RUN.
   - Revoking INSERT (D-10) while keeping `SECURITY INVOKER` (PROP §4.2) would also block the function's own INSERT (INFERRED). Exclusivity by privilege implies `SECURITY DEFINER` with a mandatory pinned `search_path` (PROP §4.2 itself notes this). The other route is a guard.
7. **Fail-closed behaviour.** D-8 fail-closed covers tied legacy rows. C1 currently turns a read error into "no initial row" and then INSERTs (PG §3), which is the opposite of fail-closed. Retention (C3, D2, D3) is ordering-independent and already fails closed (PG §3). The terminality predicate has no non-test caller, and only in uncommitted code. **Terminal states are not redefined:** `archived` remains the only terminal state (PROP §10). No repair is authorized, and retention eligibility is unchanged by any position here.

---

## F. Schedule impact — baseline unchanged

| Item | Value | Source |
|---|---|---|
| Milestone A′ | **Wed 2026-11-25 / 28.5 human engineer-days** | `PI-MILESTONE-A-EXECUTION-001` §3 ("Focused effort: 28.5 engineer-days"), verified in `PI-C1-IMPLEMENTATION-GATE-001` §9.1 |
| WP-7 | **2026-11-17 / 4.0** | PG §11, PROP §13 (carried forward) |
| C-1 | **+8–12 d new scope**, not in the 28.5-day baseline | `PI-C1-IMPLEMENTATION-GATE-001` §9.5; `PI-C1-DECISION-CLOSURE-001` §5 |
| OVERRUN RISK | **RAISED 2026-10-17T16:33 +05:30**: forecast breach at the high C-1 estimate, variance 0 to +4 working days; recovery options (a)–(d), **none applied**; owner decision required | `PI-C1-IMPLEMENTATION-GATE-001` §9.5 |
| Next checkpoint | **Friday 2026-10-23** | PROP §13 |
| **PROP Option 1 estimate** | **4.5–8.0 human engineer-days** = implementation 3.0–5.0 + verification 1.0–2.0 + rollout 0.5–1.0 (PROP §9.1); arithmetic checked | PROP §9.1, §13 |
| Earlier figure | 3.5–6.5, labelled **"incremental"** | IR §11 |

**Assumptions and exclusions (PROP §9.1):** excludes CI, code review, Phase 2 work and T22's harness. Not stated in PROP, found in this review:
- the §6.5 items 5–6 environment checks are not in "verification", which covers T1–T21 on a disposable DB;
- D-11's parent key appears in §13's scope list but not in §9.1's assumptions;
- B-0 (committing the baseline) and B-1 (cutover rehearsal) are not estimated.

**Overrun.** PROP §13 and IR §11 both report that the work overruns at the high end of a zero-float C-1. **UNKNOWN:** whether 4.5–8.0 sits **inside** C-1's 8–12 or **on top** of it, and whether it is on the Milestone A′ critical path. IR labels its figure "incremental". If it is incremental and on the critical path, the adverse variance grows beyond §9.5's 0 to +4 days. **No forecast is computed or adopted here.**

**Owner approval required for:** any baseline change, any recovery option (a)–(d), and treating the lifecycle work as inside or outside C-1. **Nothing here revises the baseline, moves a date or claims float.**

---

## G. Owner decision sheet

Record each answer as **`PROP-001 D-n`** with the question text, because IDs collide across documents (§0.2). **All answers: PENDING OWNER DECISION.**

### G-1 Technical / design

| # | Question | Options and consequences (from evidence) | Answer |
|---|---|---|---|
| G-1.1 | **PROP-001 D-1:** adopt Option 1 (atomic transition op, ordering allocated inside it), subject to G-1.3 and G-1.4? | Opt 1: fixes fork and tie, largest migration. Opt 2: fixes fork, replay ambiguous on repeated states. Opt 3: fixes neither; display-only stop-gap | **PENDING OWNER DECISION** |
| G-1.2 | **PROP-001 D-3:** is the field's contract **exactly** "per-opportunity serialized transition order", explicitly *not* global commit order, business-event order or legacy chronology? | A broader claim repeats the error E-2 disproved | **PENDING OWNER DECISION** |
| G-1.3 | **New (B-1):** which cutover? (a) brief write pause; (b) CHECK only after the writer is at 100 %, old-writer NULL rows treated as legacy; (c) database-side write path first | (a) short outage; (b) a window of mis-rankable rows; (c) more up-front work | **PENDING OWNER DECISION** |
| G-1.4 | **PROP-001 D-10:** make write exclusivity a **prerequisite**, and choose its mechanism class: privilege + `SECURITY DEFINER` (pinned `search_path`), or a guard? | Without it the E-10 pinning hazard stays open and D-3 rests on convention | **PENDING OWNER DECISION** |
| G-1.5 | **PROP-001 D-11:** include the tenant-qualified parent key in this package? | In: more scope (estimate unchanged in §9.1). Out: tenant integrity stays application-only (E-12) | **PENDING OWNER DECISION** |
| G-1.6 | Confirm that **PG-002 D-8** (`GENERATED ALWAYS` choice) is superseded by Option B's no-default column, not separately answered | Leaving it open leaves a dangling decision | **PENDING OWNER DECISION** |
| G-1.7 | **PROP-001 D-2:** no historical backfill, with no volatile DEFAULT and no trigger suspension? | Backfill invents heap order (E-7) | **PENDING OWNER DECISION** |
| G-1.8 | **PROP-001 D-4:** remove `getCurrentLifecycleState`, decided **after** B-0 on the committed base? | It is the live reader at HEAD | **PENDING OWNER DECISION** |
| G-1.9 | **PROP-001 D-14:** fix C1/C2 (writer path) in this package; A4 by role? | Leaving C1 lets a read failure lead to an INSERT | **PENDING OWNER DECISION** |

### G-2 Product / policy

| # | Question | Options and consequences | Answer |
|---|---|---|---|
| G-2.1 | **PROP-001 D-8:** for a legacy-only opportunity with tied top rows, does a terminality read return **unknown (non-terminal)**? | Deterministic pick: a fabricated order drives deletion eligibility | **PENDING OWNER DECISION** |
| G-2.2 | Does the fail-closed rule also cover legacy opportunities with a **detected fork** (same predecessor claimed twice, distinct timestamps)? | No: forked history can still drive terminality. Yes: depends on D-13 detection | **PENDING OWNER DECISION** |
| G-2.3 | **PROP-001 D-9:** accept "no repair route for born-terminal rows" for now, with the limitation recorded, and any future correction path left to a separate governance decision? | A correction path is a new privileged write into append-only evidence | **PENDING OWNER DECISION** |
| G-2.4 | **PROP-001 D-12:** is an opaque refusal on retry-after-lost-response acceptable for the first release? | Otherwise an idempotency contract is in scope | **PENDING OWNER DECISION** |
| G-2.5 | **PROP-001 D-13:** authorize a **report-only** detection count of existing false predecessors (read-only, no repair)? | Without it the damage is unknown | **PENDING OWNER DECISION** |
| G-2.6 | **PROP-001 D-15 / Q3:** acknowledge it remains blocked and independent of this package? | — | **PENDING OWNER DECISION** |

### G-3 Verification acceptance

| # | Question | Answer |
|---|---|---|
| G-3.1 | Which of C-1…C-6 and C-8…C-10 must pass **before** authorization, and which before merge? (This review recommends C-1, C-2, C-4, C-5, C-8, C-9 before authorization) | **PENDING OWNER DECISION** |
| G-3.2 | Is T22 (authenticated-role RLS) required before authorization, before merge, or recorded as an accepted gap? Superuser results are **not** a substitute | **PENDING OWNER DECISION** |
| G-3.3 | Authorize a disposable PostgreSQL run (Docker start) for C-1–C-4, C-6, C-8 | **PENDING OWNER DECISION** |
| G-3.4 | Authorize **read-only** target-environment inspection for C-5 (grants, roles), C-6 (timeouts) and B-4 (version) | **PENDING OWNER DECISION** |
| G-3.5 | Is any review by a reviewer outside this model family (human) required? See §H | **PENDING OWNER DECISION** |

### G-4 Schedule / scope

| # | Question | Answer |
|---|---|---|
| G-4.1 | **PROP-001 D-5:** remediate the race in this package (same scope as ordering)? | **PENDING OWNER DECISION** |
| G-4.2 | Is the 4.5–8.0 d estimate inside C-1's 8–12 d or additional, and is it on the Milestone A′ critical path? | **PENDING OWNER DECISION** |
| G-4.3 | Response to the standing OVERRUN RISK (`IMPLEMENTATION-GATE-001` §9.5 options a–d, or accept zero float) | **PENDING OWNER DECISION** |

### G-5 Explicit implementation authorization

| # | Question | Answer |
|---|---|---|
| G-5.1 | **PROP-001 D-7:** authorize implementation? Recommended only after §I is met; this review does **not** recommend authorizing now | **PENDING OWNER DECISION** |

---

## H. Recommended next review (bounded)

| Step | Entry criteria | Work | Exit criteria / evidence | Stop conditions |
|---|---|---|---|---|
| **H-1 Decision binding** | this document | owner answers G-1.1, G-1.2, G-1.3, G-1.4, G-2.1, G-2.2, G-4.1, G-4.2, recorded as `PROP-001 D-n` | written answers with question text | any answer that conflicts with evidence (e.g. contract = commit order) → return to evidence, do not proceed |
| **H-2 Baseline** | G-3/B-0 acknowledged | human commits the Phase-1 work as the governed adoption baseline (human-only action per `CLAUDE.md`) | `ownedDbRpc`, A1–C2 present at a committed SHA; line map re-verified | the committed code diverges from §0.1 → re-run the consumer reconciliation |
| **H-3 PROP revision** | H-1, H-2 | revised proposal (new document ID): cutover sequence per G-1.3, privilege model per G-1.4, initial-row allocation (B-2), estimate realigned with D-11 and verification scope | revised PROP with its own recorded hash | revision would require production access → stop |
| **H-4 Disposable verification** | G-3.3 authorized | C-1, C-2, C-3, C-4 (incl. app-equivalent role), C-6 harness, C-8 cutover rehearsal, C-10 TS fork reproduction | raw outputs retained; each acceptance criterion quoted | non-loopback binding, shared DB reachable, any production credential needed → stop (as PG §2.1) |
| **H-5 Read-only environment inspection** | G-3.4 authorized | C-5 grants and role, C-6 timeouts, B-4 version, optional D-13 count | written inventory; no writes | any statement other than SELECT/SHOW required → stop |
| **H-6 Return to owner** | H-3–H-5 | updated decision sheet; G-5.1 posed | — | — |

**Independence.** No structurally independent review exists in the chain. INV, IR (via a same-family delegated reconstruction) and PG share one author (IR §2; PG §10; PROP §11). IR §2 records a precedent in which a same-family reviewer confirmed findings that later proved wrong. **This review is also produced by the same model family and is not independent review.** It did not author the evidence, but it shares the blind-spot class. A human or other-family review of H-3's revised proposal is recommended (G-3.5).

---

## I. Implementation authorization gate — minimum conditions

**This document does not authorize implementation.** A separate implementation request should not be considered until all of these hold:

1. **Decisions:** written owner answers to G-1.1, G-1.2, G-1.3, G-1.4, G-2.1 and G-4.1, recorded against `PROP-001` IDs.
2. **Baseline:** B-0 met. The design's dependencies exist at a committed SHA.
3. **Design:** a revised proposal resolves §E.4 (cutover), §E.6 (privilege model) and B-2 (initial row), with a recorded hash.
4. **Verification:** C-1, C-2, C-4, C-5 and C-8 pass with quoted evidence. T22's status is explicitly accepted or required per G-3.2.
5. **Schedule:** owner response to G-4.2 and G-4.3. No implicit baseline change.
6. **Governance:** an OMNI Story with Authorized Paths covering exactly the function, migration, two writers and affected readers. Verification is through registry commands only (`gov verify`).
7. **Unchanged boundaries:** append-only protections intact; no backfill; no trigger disabled; retention eligibility unchanged; Q3 still blocked and not depended on.

---

## J. Files inspected and integrity

**Read:** the four PROP/INV/IR/PG documents (hashed; INV and IR by section); `PI-C1-IMPLEMENTATION-GATE-001.md` §9.5; grep of `PI-C1-OWNER-DECISIONS-002.md`, `PI-C1-DECISION-CLOSURE-001.md` and `PI-MILESTONE-A-EXECUTION-001.md`; `backend/services/opportunityLifecycleService.ts` (working tree and `HEAD`); `backend/services/strategicDashboardsService.ts:150-160`; `backend/services/prospectIdentity/ingestionBoundary.ts:1008-1020` (working tree and `HEAD`); `backend/db/writeOwner.ts` (working tree and `HEAD`, `main`); `backend/db/supabaseClient.ts:50-56`; `supabase/migrations/20261128000000_pi_canonical_write_atomicity.sql` (grep); `supabase/migrations/20261026000000_close_anon_rls_exposure.sql:200-225`; `supabase/_schema/baseline.sql` (grep); a grep for writes to `opportunity_feed_items` (no `update`/`upsert`/`delete` chained within 4 lines of any `ownedDbTable('opportunity_feed_items')` call, consistent with PROP §6.1).

**Created:** this file only. **Changed:** nothing else. Only read-only `git`, `sha256sum`, `grep` and `sed` commands were run. No database, container, commit, branch, PR, push or deployment.

**Effort accounting.** No numeric estimate was recorded at task start. This is a process deviation, disclosed. Work was read-only document and source inspection. No machine time is converted into engineer-hours, and nothing here is charged against any baseline.
