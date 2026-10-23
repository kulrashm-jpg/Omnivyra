# PI-C1-JEV-ARCHITECTURE-DECISION-002 — integrated architecture decision package

**Work package:** `PI-C1-JEV-ARCHITECTURE-DECISION-002` · **Repository:** `C:/tmp/r1-ctx`

**INVESTIGATION, HARNESSING, DESIGN COMPARISON AND PROPOSED DOCUMENTATION ONLY.** No product code, test, schema, migration, configuration, database write, production access, provider call, commit, push, merge or deployment. **No controlling document modified.** No owner decision made on the owner's behalf.

**Architecture selection remains subject to owner decision. Q3 remains BLOCKED. Requirement ratification remains PENDING. Implementation authorization remains NONE.**

---

## 1. Baseline

Measured **2026-10-17T21:54:25+05:30 (IST)**.

| | Expected | Actual | Result |
|---|---|---|---|
| Repository / branch | `C:/tmp/r1-ctx` · `fix/r1-profile-context` | same | **MATCH** |
| HEAD | `29fea38a…81415774` | `29fea38a2d1642c1c2fd957e5151f6be81415774` | **MATCH** |
| Worktree at start | — | **144 entries (67 M / 77 ??), 0 staged** | pre-existing modified and untracked work **preserved, not overwritten** |

| Artifact | Expected | Actual | Result |
|---|---|---|---|
| `PI-C1-ARCHITECTURE-BLOCKER-REVIEW-001.md` | `a03d8aec…99a5b` / **604** | match / **604** | **VERIFIED** |
| `PI-ADD-001-RATIFICATION-CLOSURE-002.md` | `1f1f6735…9175` / 497 | match | **UNCHANGED** |
| `PI-ADD-001-V03-INDEPENDENT-REVIEW-002.md` | `9e496a09…06b6` / 134 | match | **UNCHANGED** |
| `PI-REQUIREMENTS-ADDENDUM-001-PROPOSED.md` (v0.1) | `f244adb9…a5ad0` / 236 | match | **UNCHANGED** |
| `PI-REQUIREMENTS-ADDENDUM-002-PROPOSED.md` (v0.2) | `c6ae24e2…e9d1` / 394 | match | **UNCHANGED** |
| `PI-REQUIREMENTS-ADDENDUM-003-PROPOSED.md` (v0.3) | `3ef5a365…5477` / 536 | match | **UNCHANGED** |
| `PI-ADD-001-V03-RATIFICATION-READINESS-001.md` | `30b00b93…a22c` / 368 | match | **UNCHANGED** |
| `PI-ADD-001-V03-SEMANTIC-REVIEW-001.md` | `466cc141…16be` / 183 | match | **UNCHANGED** |

### 1.1 Governance state reconfirmed

| Item | State |
|---|---|
| **Q1 / Q2** | **DECIDED AND RECORDED** — nine-state vocabulary, FR-A41 meanings for `triaged`/`reviewing`/`monitoring`, narrow bulk scope |
| **Q3** (legal erasure / retention policy) | **BLOCKED** — no approved policy, no approval evidence, **no accountable owner evidenced** across 11 previously exhausted scopes. Not re-searched; no new hypothesis |
| **PI-ADD-001 v0.1 / v0.2 / v0.3** | **PROPOSED, NOT RATIFIED.** v0.2's header still understates its own additions (`AC-A43`, `NC-A20`); v0.3 enumerates all 115 identifiers |
| Ratification readiness | **NOT ratification-ready** — 21 register entries open (B1–B21) |
| Independent review | **PARTIALLY SATISFIED** — separate-agent only; **no human review** |
| **C-1a / C-1b** | **UNAUTHORIZED** |
| AD-1 | **CLOSED** — executed, 7/7 probes confirmed |

---

## 2. JEV and GT governance — **UNAVAILABLE for this work package**

The installed tooling was inspected before use, as instructed. **No JEV command was invented, no competing governance system was created, and no denied gate was bypassed.** The workflow cannot run here, for five independently verified reasons.

### 2.1 What is actually installed

| Artifact | Verified |
|---|---|
| `scripts/jev-flow/` (`cli.ts`, `packet.ts`, `judgeFlow.ts`, `binding.ts`, `verify.ts`, `readiness.ts`, `verification-registry.json`) | present |
| `scripts/jev-bjc/`, `scripts/jev-jira/` | present |
| `.claude/skills/gov/SKILL.md` | present — user-invoked skill |
| Verb set, **reported by the tool itself** (`cli.ts` with no arguments, exit 0) | `start`, `attach`, `packet`, `verify`, `judge`, `submit`, `check-merge` |
| `GOV_HOME` | exists at `~/.omnivyra/gov` with `bindings.jsonl`, `packets/`, `evidence/`, `intake/`; packets for `OMNI-6, 9, 13, 23, 32, 38, 44` |
| `tsx` runner | present at `node_modules/tsx/dist/cli.mjs` |

### 2.2 The five blockers

| # | Blocker | Evidence | Can I clear it? |
|---|---|---|---|
| **J-1** | **No Jira Story exists for this work package.** Story and AC creation is a **human-only Jira gate**. The only lifecycle-adjacent story, **OMNI-44**, is *"Lifecycle predicate engine and read-only gov reconcile (dry-run)"* — the **gov tooling's own** lifecycle engine, whose Authorized Paths are `backend/tests/unit/jevFlow*.test.ts`. Binding PI architecture work to it would be a **scope violation** | packet read from `GOV_HOME` | **No** — human gate |
| **J-2** | **Jira reads are impossible.** `JEV_JIRA_IDENTITY` **not set**, `JEV_READER_TOKEN` **not set**. Readiness, packet and attach all require a Story read | presence-only check; **no value printed, no credential created, inspected or retrieved** | **No** — and I am forbidden to touch credentials |
| **J-3** | **gov refuses this worktree, as the tool reports.** `gov packet --story OMNI-44 --worktree /c/tmp/r1-ctx` → `REFUSED: no gov binding … run gov start or gov attach first`, `GOV_RESULT {"status":"REFUSED",…}`, **exit 11**. `attach` additionally requires a **clean** tree; this worktree has 144 entries, and the adoption baseline must be a **human** commit which both the skill ("Never create the adoption-baseline commit") and this brief forbid | tool-reported | **No** |
| **J-4** | **The verification registry has no applicable command.** Ids are `jev.unit`, `scripts.typecheck`, `pi-score.unit`, `pi-score.digest`, `report1.unit` — **none exercises opportunity lifecycle, retention or deletion**. Adding an entry is *"a code change to this file [that] goes through normal code review"* | `verification-registry.json` | **No** — unauthorized code change |
| **J-5** | **Structural: JEV cannot evaluate an architecture.** Its input contract is *"the AC statement, the Story invariants and summary, and evidence metadata (ids, kinds, results, hashes). **Never** code, diffs, logs, secrets or file contents."* It judges **one AC at a time against evidence metadata**, is **advisory**, and *"deterministic evidence is authoritative."* It cannot compare design options, and `gov judge` additionally requires an evidence-bundle hash from `gov verify` (blocked by J-3) | `scripts/jev-flow/README.md`, BJC/JEV boundary section | **No** — contract, not configuration |

`TYPESAFE_API_KEY` **is** set, so the judge model would be reachable — but only through `gov judge`, which is unreachable behind J-1 to J-4. Reachability does not help.

### 2.3 Consequence, stated plainly

**No JEV verdict exists for any decision in this package, and none is simulated.** Per §9 of the brief: the blocker is recorded and the deterministic evidence is retained. **My own analysis is NOT independent confirmation and is not presented as such.** Every evaluated claim below is marked `PASS` / `FAIL` / `INSUFFICIENT_EVIDENCE` **on deterministic evidence only**, with raw results (§10) kept separate from interpretation.

### 2.4 What a human would have to do to make JEV available

1. Create an OMNI Story in Jira with Objective, Authorized Paths, Verification Requirements and ACs, satisfying readiness — **human only**.
2. Add a reviewed `verification-registry.json` entry that actually exercises lifecycle/retention invariants — **ordinary code review**.
3. Provide `JEV_JIRA_IDENTITY=reader` + `JEV_READER_TOKEN` **in the environment only**.
4. Commit the 144 pre-existing worktree entries as an adoption baseline (`Governed-By: OMNI-n`, no `Gov-Packet`) — **human only** — or run this work in a clean governed worktree.
5. Then `gov attach` → `gov verify` → `gov judge` (without `--write-back`).

Even then, **J-5 stands**: JEV could certify ACs against test evidence; it could never choose the architecture.

---

## 3. AD-2 — lifecycle history, retention and the deletion contract

### 3.1 Deterministic evidence (AD-1, re-verified)

Source references were re-read for this package; the AD-1 probes were **not** re-run — no evidence gap required it.

| Claim | Evidence | Verdict |
|---|---|---|
| Parent deletion with lifecycle history is refused `P0001` | AD-1 P2 | **PASS** |
| Parent and lifecycle history both remain after refusal | AD-1 P2 post-checks | **PASS** |
| Parent deletion **without** lifecycle history succeeds | AD-1 P3 | **PASS** |
| A mixed batch fails atomically; the eligible row is **not** deleted | AD-1 P7 | **PASS** |
| Company deletion is refused when protected rows exist | AD-1 P5 | **PASS** |
| Direct lifecycle `UPDATE`/`DELETE` refused | AD-1 P1, P6 | **PASS** |
| Retention cannot safely delete mixed batches containing protected rows | AD-1 P7 + `retentionService.ts:142-158` (`MAX_DELETE_BATCH = 10_000`, single `.delete().in('id', ids)`) | **PASS** |
| **Any of this proves production migration state** | — | **INSUFFICIENT_EVIDENCE — and explicitly not claimed.** The harness replays migrations onto a throwaway server |

### 3.2 Required invariants

| ID | Invariant |
|---|---|
| **I-1** | Lifecycle state must be derivable for as long as the opportunity exists; **absent history must be distinguishable from the initial state** |
| **I-2** | A retention action must not remove protected evidence **and must not fail opaquely**; outcomes must be observable per item and retry-safe |
| **I-7** | An append-only audit table must not be reachable by a cascade from a record the product intends to delete |
| **I-8** *(new)* | **One protected row must not indefinitely block unrelated eligible rows.** Today a single lifecycle-bearing row voids a 10,000-row batch, and the next run selects the same batch — so eligible rows are blocked **permanently**, not merely deferred |

### 3.3 Options

| | **2-A — keep blocking, handle blocked rows explicitly** | **2-B — `RESTRICT` + governed deletion path** | **2-C — separate lifecycle evidence from the retention-deleted entity** | **2-D — bounded per-item retention** |
|---|---|---|---|---|
| Shape | Trigger unchanged. Retention pre-identifies protected parents, excludes them, deletes the remainder, and records each exclusion with a reason | Change the three lifecycle FKs from `CASCADE` to `RESTRICT`; require an explicit governed archival step before a parent may be removed | Lifecycle evidence lives on a record that retention does not target, so the source entity can be deleted without touching protected history | Delete one id per statement with a per-item outcome, so one failure cannot void the batch |
| Parent records | Protected parents **survive**; unprotected parents delete | Parent deletion refused until the governed path runs | Parent deletable | Unprotected parents delete |
| Lifecycle history | Preserved | Preserved | Preserved, by construction | Preserved |
| Evidence references | `detection_ref` may dangle for deleted unprotected parents | Stable | **Stable — the strongest of the four** | may dangle as 2-A |
| Deletion still possible? | Yes, for unprotected rows only | Yes, via the governed path only | Yes | Yes, for unprotected rows only |
| Failure / retry | Deterministic and **idempotent**: excluded rows are reported, never silently retried into the same failure | Refusal is explicit and attributable | Not applicable to history | Per-item; a failure isolates to its row |
| **Satisfies I-8?** | **Yes** | Yes | Yes | **Yes** |
| Tenant isolation | Unchanged | Unchanged | Must carry a composite tenant FK | Unchanged |
| Erasure implications | **None resolved** — a protected row still cannot be erased | The governed path is exactly where erasure would attach | Cleanest basis for erasure, but **what may be removed is Q3** | None resolved |
| Schema / migration | **None** — code only | 3 FK changes + new path | New table + RLS + triggers + indexes | **None** — code only |
| Controls needed | retention-after-archival; mixed batch; repeat-run idempotence | refusal + governed success | all of I-1/I-2/I-7 | per-item isolation |
| **Q3 dependency** | **None** | **BLOCKED BY Q3** (tenant offboarding) | **BLOCKED BY Q3** for anything historical | **None** |
| Rollback | Trivial | Hard once data depends on it | Additive — droppable while unused | Trivial |
| Effort | **0.5–1.0** | 3.0–5.0 | 3.0–5.0 (overlaps AD-3) | **0.5–1.0** |
| Risk | Low | Medium–high | Medium | Low |

### 3.4 AD-2 decision record

**Recommended: 2-A combined with 2-D** — they are complementary (pre-exclusion plus per-item outcomes), together satisfy **I-2 and I-8**, need **no schema change and no policy decision**, and are individually reversible. **2-C is the right long-term shape but is inseparable from AD-3** (§4) and is Q3-dependent. **2-B is deferred** — it is the natural home for erasure, and erasure is exactly what Q3 blocks.

**Explicitly NOT done and NOT proposed:** weakening or removing the append-only trigger; discarding lifecycle history; adding a retention period; inventing a tombstone policy.

**Owner decisions still required:** AD-2.1 adopt 2-A+2-D now? · AD-2.2 is indefinite retention of signal-derived personal data acceptable in the interim (**Q3-dependent**)? · AD-2.3 defer 2-B to a Q3-gated package?

---

## 4. AD-3 — lifecycle support for every approved intake origin

### 4.1 Deterministic evidence

| Claim | Evidence | Verdict |
|---|---|---|
| The Community creator requires `signalId` | `opportunityFeedService.ts:1-22, 385-394, 488-500` — `recordOpportunityFromSignal`, *"Called by the Phase 3 listeningSignalPipeline immediately after a successful writeLeadSignal"*, idempotent on `(organization_id, signal_id)` | **PASS** |
| `signal_id UUID NOT NULL`; `UNIQUE (organization_id, signal_id)` | `20260518_phase4…:97, 113` | **PASS** |
| Lifecycle anchor is `opportunity_feed_item_id NOT NULL` | `20260520…:16` | **PASS** |
| Manual and CRM paths have **no reachable opportunity producer** | **zero** matches for `opportunit` across `backend/services/leadIngestion/**` (incl. `manualAdapter.ts`, `csvAdapter.ts`, `crmAdapter.ts`) and `backend/services/prospectIdentity/**` | **PASS** |
| Only other writer is an operator backfill script | `scripts/operator/db/backfill-active-leads.ts:155, 269` | **PASS** |
| FR-A9 multi-signal accumulation is unrepresentable | the unique constraint permits one feed item per signal | **PASS** |

**So three of FR-A5's four declared origins — company event, manual entry, CRM import — have no producer and no reachable lifecycle state.** The cause is **both** a schema restriction **and** absent adapter behaviour, and the second is the larger half: relaxing `signal_id` alone would still leave nothing creating the row.

### 4.2 Anchor candidates — verified

| Anchor | Tenant shape | Composite key for a tenant-safe FK |
|---|---|---|
| `canonical_leads` | `company_id` | **Exists** — `idx_canonical_leads_id_company`, already used by `prospect_lifecycle_transitions` |
| `prospect_accounts` | `organization_id → companies(id) ON DELETE CASCADE` (`20260920000000:68-72`) | **Does NOT exist** — a `UNIQUE (id, organization_id)` index would have to be added |
| `opportunity_feed_items` (today) | `organization_id`, `signal_id` both `NOT NULL` | signal-origin only |

### 4.3 Options

| | **3-A — canonical PI opportunity ledger** | **3-B — relax the Community schema** | **3-C — narrow scope to signal origin** |
|---|---|---|---|
| Subject identity | A PI opportunity row anchored to `prospect_accounts` (FR-A32 is account-anchored), behind a composite tenant FK — **requires the new unique index** | Community feed item with nullable `signal_id` + a signals join table | unchanged |
| Source provenance | `need_source` per FR-A5; `detection_ref` a soft pointer for signal origin | `source_context` | classified signal only |
| Creation per origin | One PI producer serving all four origins | Three adapters taught to write Community rows | signal only |
| Lifecycle init / update / query | Append-only ledger, current state = latest row, chain-trigger enforced | unchanged mechanism | unchanged |
| Evidence retention | Typed evidence refs with `ON DELETE RESTRICT`, per the proven PI pattern | inherits the cascade | inherits |
| Deletion / erasure | Gate reads one PI table — **but see §4.4** | unchanged problems | unchanged |
| Tenant isolation | Composite tenant FK + service-role RLS | unchanged | unchanged |
| **One-way boundary** | **Preserved** | **VIOLATES AC-A27 / BR-A5** — PI would write Community schema and rows | preserved |
| Duplicate source of truth? | **No** — the Community feed item stays the signal-interpretation record; the PI opportunity is the identity/permission/qualification/lifecycle record, matching BR-A5 exactly | risks two | none |
| Migration / backfill | New table + RLS + triggers + indexes + the `prospect_accounts` composite unique. **No historical backfill proposed** | Phase-4 schema change + join table + backfill implications | none |
| Requirement conflicts | **FR-A40** ("the existing validated mechanism") needs owner amendment | AC-A27, BR-A5 | **FR-A5 and FR-A9** need owner amendment |
| Effort | 3.0–5.0 | 6.0–10.0 | 0.5–1.0 (documentation) |

### 4.4 The finding that changes the recommendation

**The proven PI ledger is NOT safe to copy wholesale.** `prospect_lifecycle_transitions` carries `organization_id … REFERENCES companies(id) ON DELETE CASCADE` (`20261028000000:110`) **together with** `prospect_lifecycle_block_delete` (`:330-332`). That is precisely the **I-7** configuration that AD-1 probe **P5** proved deadlocks tenant deletion on the Community side. A new opportunity ledger built to the same shape would **reproduce the deadlock**.

So 3-A must additionally decide how tenant deletion coexists with append-only evidence — and **what may be removed on tenant offboarding is a Q3 policy question.** The PI ledger is a reference implementation for *shape*, as the brief requires; its subject model (a prospect), its seven-state vocabulary, and its tenant-cascade configuration are **not** reusable as-is.

### 4.5 AD-3 decision record

**Smallest coherent design satisfying the approved intake requirements: 3-A**, anchored to `prospect_accounts`, with the I-7 resolution decided **before** the table is created. **3-B is rejected on evidence** — it crosses the one-way boundary AC-A27 and BR-A5 exist to protect. **3-C is a legitimate scope decision** but requires amending two approved requirements and leaves FR-A5 permanently narrower than its own wording.

**Owner decisions required:** AD-3.1 origins in scope? · AD-3.2 anchor = `prospect_accounts`? · AD-3.3 **tenant-deletion semantics for an append-only PI ledger (Q3-dependent)** · AD-3.4 amend FR-A40, or FR-A5+FR-A9 under 3-C.

---

## 5. AD-4 — fail-closed lifecycle reads

### 5.1 Deterministic evidence

| Claim | Evidence | Verdict |
|---|---|---|
| `getCurrentLifecycleState` returns `null` when no history exists | `opportunityLifecycleService.ts:84-97` — `.limit(1).maybeSingle()`, `?? null` | **PASS** |
| **`transitionLifecycle` treats missing history as the valid initial state** | `:132-133` — `const from: LifecycleState = current?.state ?? 'detected'` | **PASS** |
| FR-A39 requires the opposite | *"**All other states are non-terminal** … including any **unknown or future** state, which **fails closed** as non-terminal"* | **PASS** |
| The initial row is written by a **separate** call from feed-item creation | `:42-80` `initialiseLifecycleForOpportunity`, `reasoning: 'auto_init_from_signal_pipeline'` | **PASS** |
| **The Community ledger can be born in ANY state, including `archived`** | `opp_lifecycle_state_check` constrains **words only**; `opp_lifecycle_previous_state_check` permits `NULL`; `uq_opp_lifecycle_initial` constrains **count only**. There is **no initial-shape and no initial-state CHECK** | **PASS — new finding, D-4** |
| The PI ledger had this exact defect and it was closed by an additive CHECK | `20261029000000_pi_lifecycle_initial_state_valid.sql:1-30` — *"an INSERT of `state = 'meeting_scheduled', is_initial = true` was ACCEPTED, as was every one of the seven states — including `closed_disqualified`… A ledger could therefore be born terminal and stay that way."* **That migration's header reports its own real-PostgreSQL demonstration; I did not re-run it** | **PASS (as a cited claim)** |
| Zero tests cover the Community lifecycle mechanism | repo-wide `*.test.ts` scan — empty | **PASS** |

**D-4 is new and material:** the fallback hazard is not only "absent history reads `detected`". The database also permits an opportunity to be **born `archived`** — immediately deletion-eligible under FR-A38, with no transition ever recorded and, per P1/P6, **unrepairable** because the row cannot be updated or deleted. The PI side fixed this; the Community side the owner adopted under Q1-1 did not.

### 5.2 Options

| | **4-A — explicit initial-state creation** | **4-B — typed result distinguishing the cases** | **4-C — fail-closed error / unavailable** |
|---|---|---|---|
| Shape | Create the initial row in the **same transaction** as the opportunity, so absence is impossible | Reader returns a discriminated result: `initial` / `present(state)` / `missing` / `unreadable` | Any missing, unknown, contradictory or malformed evidence raises, or yields an explicit `unavailable` |
| Satisfies FR-A39 | Indirectly — removes the case | **Yes, directly** | Yes |
| New lifecycle state? | No | **No** — a result type, not a state. **No new state is proposed anywhere in this package** | No |
| Testability | Good | **Best** — each branch is a named case | Good, but conflates distinct causes |
| Legacy rows | Does **not** fix opportunities that already lack history | Handles them | Handles them |
| Effort | 0.5–1.0 | **0.5–1.0** | 0.25–0.5 |

### 5.3 Proposed behaviour contract — **specification only, nothing executed**

| # | Condition | Required outcome |
|---|---|---|
| 1 | New opportunity, valid initial evidence | Reads the initial state; `previous_state IS NULL`; `is_initial = true` |
| 2 | **No history for an existing opportunity** | **`missing` — never `detected`.** Fails closed as non-terminal per FR-A39; blocks deletion; surfaces as a repairable condition, not a valid state |
| 3 | Valid non-terminal history | Latest row's state |
| 4 | Valid terminal history (`archived`) | `archived`; deletion-eligible per FR-A38 |
| 5 | Unknown / future state value | **`unreadable`**, fails closed as non-terminal. The DB CHECK makes this reachable only by a vocabulary migration, so it is a forward-compatibility guarantee |
| 6 | Contradictory history (e.g. two `is_initial` rows, or a `previous_state` that never was) | **`unreadable`**, fails closed. The partial unique index prevents the first; **the Community ledger has no chain trigger**, so the second is reachable — unlike the PI ledger |
| 7 | Read failure / incomplete evidence | **`unreadable`**, fails closed. Never a default state |
| 8 | **Retry / already-`archived`** | **Idempotent success, not an error.** Today `archived → archived` is refused — `archived: []` in `ALLOWED_LIFECYCLE_TRANSITIONS`, and `transitionLifecycle` **throws** rather than returning `no_op_same_state`. FR-A42's per-item bulk outcomes must therefore tolerate it, or the contract must make it a no-op |
| 9 | **Born-terminal row (D-4)** | Must be **impossible**. Requires an initial-state constraint equivalent to the PI side's |

**Recommended: 4-B plus 4-A**, with case 9 as a separate constraint decision. 4-B satisfies FR-A39 directly and is the most testable; 4-A removes the condition at source for new rows. Neither adds a lifecycle state.

**Owner decisions:** AD-4.1 adopt 4-B+4-A? · AD-4.2 case 8 — idempotent no-op or explicit error? · AD-4.3 **D-4** — add an initial-state constraint (a migration, hence separate authorization)?

---

## 6. B21 — SQLSTATE consistency

### 6.1 Deterministic evidence

| Guard | Raises | Evidence |
|---|---|---|
| `trg_opp_lifecycle_block_mutation` (Community) | **`P0001`** — plpgsql default `raise_exception` | **no `ERRCODE` clause** in `pg_proc.prosrc`; AD-1 probes P1/P2/P4/P5/P6/P7 all returned `P0001 :: opportunity_lifecycle_states is append-only` |
| `trg_prospect_lifecycle_guard` (PI) | **`42501`** | explicit `ERRCODE = '42501'` in `pg_proc.prosrc`; corroborated by `20261029000000:25` and by the PI suites asserting `42501` |

**Intentional on the PI side, default on the Community side.** The PI migration deliberately chose `42501`; the Community migration simply never specified a code. So the difference is **not a considered divergence — it is one deliberate choice and one default.**

### 6.2 How callers actually respond — verified

| Caller | Behaviour | Consequence |
|---|---|---|
| `lifecycleWriter.ts:245-250` (`translate`) | maps **`42501` → `append_only_violation`**; **no `P0001` branch** | A Community append-only refusal falls through to the generic branch at `:257` — `lifecycle insert failed (P0001): …` — and is **misclassified**, not recognised as an append-only violation |
| `attributionResolverService.ts:22` | `code === '42501' → 'permission'` | **`42501` is `insufficient_privilege`**, and this service already classifies it as a **permission** failure. So the PI guard's append-only refusal is semantically overloaded and could be read as an **authorization** problem |
| `retentionService.ts:152-157` | records `delErr.message` into `detail`, sets `status='failed'` | Neither code is interpreted; the operator sees a raw trigger string and **zero** rows affected |

**Both conventions are therefore wrong in different ways:** `P0001` is uninterpreted and anonymous; `42501` is interpreted, but as a *permission* class, which risks a credential or step-up path being taken for a condition that is actually immutability. Retry logic, telemetry classification, authorization handling and test assertions are all affected.

### 6.3 Options

| | **21-A — handle both codes at the boundary** | **21-B — standardize in a separately authorized change** |
|---|---|---|
| Shape | Recognise `P0001`-with-append-only-message **and** `42501` as one `append_only_violation` class at the error-translation boundary | Give the Community guard an explicit `ERRCODE`, ideally a code that is not `insufficient_privilege`, and align both |
| Risk | Low — message matching is a little loose, but it is additive and fails safe | Migration + coordinated handler and test updates |
| Blocks | Nothing | Needs a migration, so separate authorization |
| Effort | **0.25–0.5** | 1.0–2.0 |

**Recommended: 21-A now, 21-B later.** **`P0001` is NOT treated as equivalent to `42501`** — they are mapped to one *application* class on the evidence above, while remaining distinct codes. **Neither trigger nor any handler was modified.** Both codes enter the negative-control matrix (§9.2).

---

## 7. AD-6 — reachable retention acceptance and FR-A46

### 7.1 Reconciliation against observed behaviour

| Question | Answer | Evidence |
|---|---|---|
| Which source rows are eligible for deletion? | **Only feed items with no lifecycle rows** | AD-1 P3 (`SUCCESS`, 0 remaining) |
| Which are blocked? | **Every lifecycle-bearing feed item** | P2 (`P0001`) |
| Do mixed batches fail as a whole? | **Yes, atomically; the eligible row survives** | P7 |
| What does the pipeline normally produce? | Feed items **with** an auto-initialised `detected` row | `initialiseLifecycleForOpportunity`, *"Called from the signal pipeline"* |
| Is the acceptance criterion testing a reachable, production-intended condition? | **NO** | synthesis of the above |

### 7.2 The three affected items

| Item | Exact wording | Status |
|---|---|---|
| **FR-A46** | *"`detection_ref` **may become unresolvable** … This is a documented limitation and acceptance decision, not a defect to be fixed by adding a foreign key"* | **Premise is false for the normal case.** A lifecycle-bearing feed item cannot be deleted at all |
| **AC-A42** | *"When the referenced `opportunity_feed_items` row no longer exists, the opportunity still returns its `detected_reason` verbatim, and no referential error occurs"* | **Precondition unreachable** for pipeline-produced opportunities |
| **NC-A19** | *"Hard-delete the referenced detection row, then read the opportunity"* | **First step is refused** for pipeline-produced opportunities; the control as written cannot execute |

### 7.3 Proposed revised acceptance contract — **PENDING OWNER APPROVAL; v0.3 NOT edited**

| Item | Proposed |
|---|---|
| **FR-A46** | *"`detection_ref` is a soft reference. A referenced `opportunity_feed_items` row **cannot be deleted while lifecycle history exists for it** (refused by the append-only guard); where no lifecycle history exists the row **may** be deleted and the reference **may** become unresolvable. Both behaviours are documented limitations and acceptance decisions, not defects to be fixed by adding a foreign key."* |
| **AC-A42** | *"**Where the referenced `opportunity_feed_items` row has been deleted** — reachable only when it carried no lifecycle history — the opportunity still returns its `detected_reason` verbatim and no referential error occurs."* |
| **NC-A19** | Split: **NC-A19a** *"Hard-delete a referenced detection row that has **no** lifecycle history, then read the opportunity"* (executable) and **NC-A19b** *"Attempt to hard-delete a referenced detection row that **has** lifecycle history — the delete must be refused and both rows must remain"* (newly executable, proven by P2) |

### 7.4 The owner decision, with the three outcomes distinguished

1. **Accept the observed limitation** as an explicit tradeoff, adopting §7.3 — no architecture change.
2. **Require a retention architecture change first** (AD-2 2-A+2-D at minimum, or 2-C) before the criterion is accepted.
3. **Q3-dependent outcome:** if policy requires that signal-derived personal data be deletable within a period, then **neither 1 nor 2 suffices** — today that data is undeletable whenever lifecycle history exists, and the policy would govern the fix.

**`soft_delete_column: null` and the current absence of a retention guarantee are NOT treated as authorization to delete protected history.**

---

## 8. Q3 — policy dependencies per design

Q3 remains **BLOCKED**. Prior searches were **not repeated**; no new hypothesis arose. **No legal authority, retention period, surviving record, erasure semantic or exception is invented here.** Absence from the repository is **not** taken to mean no policy exists elsewhere.

| Design element | Depends on retention/erasure policy? | Evaluable without legal assumptions? | Must wait for Q3? | Risk it creates |
|---|---|---|---|---|
| **2-A + 2-D** (retention observability) | **No** | **Yes** | **No** | None new. Makes an existing indefinite-retention condition **visible** rather than silent |
| **4-B + 4-A** (fail-closed reads) | No | Yes | No | None |
| **21-A** (both SQLSTATEs) | No | Yes | No | None |
| **§7.3** acceptance wording | No — it documents observed behaviour | Yes | No | None |
| **D-4** initial-state constraint | No | Yes | No (but it is a migration) | None |
| **3-A** opportunity ledger, **new rows only** | Partly — its **tenant-deletion** semantics do (§4.4) | **Only in part** | **Yes, for I-7** | — |
| **3-A** with historical backfill | **Yes** | No | **Yes** | Could entrench indefinite retention |
| **2-B** `RESTRICT` + governed deletion | **Yes** | No | **Yes** | — |
| **2-C** separated evidence | **Yes**, for anything historical | No | **Yes** | Premature evidence destruction if policy is assumed |

**Two standing risks, neither resolvable here:** signal-derived personal data is **retained indefinitely** wherever lifecycle history exists (P2/P5/P7); and any design that makes it deletable risks **premature evidence destruction** if it assumes a policy. Both need Q3.

**Accountable policy owner: still NOT EVIDENCED.** The targeted request drafted at `PI-ADD-001-RATIFICATION-CLOSURE-002.md` §7.3 stands unchanged and **has not been sent**. One addition is warranted: the policy must also state whether **tenant offboarding** may remove append-only lifecycle evidence (§4.4), which AD-1 P5 shows is currently impossible.

---

## 9. Unified invariant-to-design matrix and negative controls

### 9.1 Invariant coverage

| Invariant | Today | 2-A+2-D | 4-B+4-A | 21-A | 3-A | Q3-gated |
|---|---|---|---|---|---|---|
| Append-only lifecycle history | **MET** (trigger, P1/P6) | preserved | — | — | must be rebuilt in the new table | — |
| Durable, provable terminality (**I-1**) | **PARTLY** — history protected, anchor is a retention target | unchanged | **improves** (absence ≠ initial) | — | **MET** | — |
| Reachable lifecycle for all approved origins (**I-3**) | **NOT MET** | — | — | — | **MET** | — |
| Fail-closed on missing/unknown state | **NOT MET** (`?? 'detected'`) | — | **MET** | — | inherits | — |
| Observable, retry-safe retention (**I-2**) | **NOT MET** (opaque, batch-voiding) | **MET** | — | supports | — | — |
| One protected row must not block eligible work (**I-8**) | **NOT MET** | **MET** | — | — | — | — |
| Approved account-deletion rule (**I-4**) | **NOT IMPLEMENTED** — no gate; `prospect_opportunities` in no migration | — | — | — | enables | — |
| **Tenant deletion (I-7)** | **NOT MET** — refused (P5) | unchanged | — | — | **must not repeat it** | **YES** |
| Person erasure / legal retention (**I-5**) | **UNVERIFIED / BLOCKED** | — | — | — | — | **YES** |
| One-way Community→PI flow | **MET** | preserved | preserved | preserved | **preserved** (3-B would violate) | — |
| Tenant isolation | composite FKs + service-role RLS; service role bypasses RLS so isolation rests on application logic | unchanged | unchanged | unchanged | composite FK + RLS required | — |
| Idempotent already-archived handling | **NOT MET** — `transitionLifecycle` throws | — | **case 8** | — | — | — |
| Bulk-resolution scope restriction (FR-A42) | n/a — not implemented | per-item outcomes align | — | — | — | — |
| Error-code handling (**B21**) | **NOT MET** | — | — | **MET** | — | — |
| No invented legal policy (**I-6**) | **HELD** | held | held | held | held | — |

### 9.2 Negative-control matrix — **specification only; nothing was run**

| # | Control | Required outcome | Status today |
|---|---|---|---|
| N1 | Retention after archival, single protected row | Refused **attributably**, reported per item | **Proven refused** (P2); reporting absent |
| N2 | Mixed batch | Eligible rows delete; protected row reported; **no silent total failure** | **Proven to fail atomically** (P7) |
| N3 | Repeat run after N2 | **Idempotent** — same exclusions, no regression | not covered |
| N4 | Direct `UPDATE`/`DELETE` on lifecycle history | Refused | **Proven** (P1/P6) — **but no repository test** |
| N5 | Cascade from `companies` and from `lead_signals` | Refused | **Proven** (P5/P4) — no repository test |
| N6 | Manual/CRM opportunity with no signal id | Creates and reaches a lifecycle state | **impossible today** |
| N7 | Multiple supporting signals on one opportunity | Accepted | **unrepresentable today** |
| N8 | Account deletion with unresolved opportunities | Refused atomically | gate absent |
| N9 | Account deletion with all opportunities `archived` | Succeeds | **expected to fail** (P5) |
| N10 | Lifecycle read with no history | **`missing`**, fails closed | reads `detected` |
| N11 | Unknown/future state value | `unreadable`, fails closed | not covered |
| N12 | Contradictory history (`previous_state` that never was) | `unreadable`, fails closed | **reachable — no chain trigger on the Community ledger** |
| N13 | **Born-terminal initial row (D-4)** | Rejected by constraint | **accepted today** |
| N14 | Retry of an already-`archived` transition | Idempotent no-op, or a defined error | **throws** |
| N15 | **Both SQLSTATEs** — `P0001` and `42501` | Both classified `append_only_violation` | `42501` only, and as *permission* elsewhere |
| N16 | Cross-tenant lifecycle read / transition / delete | Refused | composite FK + RLS; service role bypasses RLS |
| N17 | Person erasure under approved policy | per policy | **BLOCKED BY Q3** |

### 9.3 Requirement identifier and vocabulary check

Deterministic scan first, contextual analysis second — the method and its **two-sided** limits are recorded at `PI-C1-ARCHITECTURE-BLOCKER-REVIEW-001.md` §9.

- Identifier set: **115** (83 v0.1 + 32 v0.2), no duplicates, no gaps. **Nothing renumbered, withdrawn or reinterpreted here.**
- Stem-aware scan over the 78 UNCHANGED items: **5** lexical hits → **4 genuine** (`AC-A11`, `FR-A12`, `FR-A13`, `AC-A13`) + **1 lexical-only** (`FR-A28`, *"acting on an opportunity"* — ordinary English, not the withdrawn `acted`).
- **The earlier word-boundary scan's false negative (`auto-disqualify` in FR-A12) is reconciled**, and **the withdrawn `closed`→`archived` substitution is NOT reinstated**: under FR-A38 `archived` is the sole terminal state for deletion eligibility, so auto-archiving stale opportunities would make them deletion-eligible and destroy FR-A13's recurrence-visibility intent.
- **No mechanical replacement of `open`, `disqualified`, `auto-disqualify` or `auto-closed` is proposed. No proposed wording names a lifecycle state except where the owner must designate one, and none introduces an automatic lifecycle transition.**

---

## 10. JEV evaluation results and raw evidence references

### 10.1 JEV verdicts

**NONE. JEV is UNAVAILABLE (§2). No verdict was produced, and none is simulated.**

| Stage | Tool-reported status |
|---|---|
| intake | **NOT RUN** — no Story (J-1), no Jira identity (J-2) |
| judge | **NOT RUN** — requires an evidence bundle from `gov verify` |
| bind | **NOT RUN** — `gov packet … --worktree /c/tmp/r1-ctx` → `REFUSED`, **exit 11** |
| gate verification | **NOT RUN** — `gov verify` refuses a dirty tree (144 entries) |

**No stage is marked complete. My own analysis is not independent confirmation.**

### 10.2 Deterministic evidence, kept separate from interpretation

| Ref | Raw result | Where |
|---|---|---|
| **EV-AD1** | 7 probes: P0 triggers `BEFORE`/`ROW`/enabled + 4 FKs `confdeltype='c'`; P1 `P0001`; **P2 `P0001`**; P3 `SUCCESS` 0 remaining; P4 `P0001`; P5 `P0001`; P6 `P0001`; P7 `P0001` with the clean row surviving; residue `0/0/0/0` | `PI-C1-ARCHITECTURE-BLOCKER-REVIEW-001.md` §17 |
| **EV-GOV** | `cli.ts` verb set (exit 0); `gov packet` → `GOV_RESULT {"status":"REFUSED","story":"OMNI-44","verb":"packet"}` exit 11; credential presence `JEV_READER_TOKEN` not set / `TYPESAFE_API_KEY` SET; registry ids | §2 of this report |
| **EV-SRC** | Source line references throughout §3–§7, each re-read for this package | this report |
| **EV-CITED** | `20261029000000:1-30` reports its own real-PostgreSQL demonstration of the born-terminal defect. **Cited as that migration's claim; not re-executed here** | §5.1 |

**Environment isolation for EV-AD1:** disposable `pgvector/pgvector:pg17`, unique container name, `127.0.0.1`-only binding with an asserted loopback check, throwaway credentials, per-probe transactions ending in `ROLLBACK`, exact `ad1…` fixture ids, container removed by exact id, unrelated 11-container `cert-supabase` stack verified untouched. **Proves nothing about production.**

**AD-1 probes were not re-run** — no evidence gap required it, per the brief.

---

## 11. Integrated architecture recommendation

**C-COMB was reassessed, not assumed.** The AD-1 execution evidence and §4.4 change it in one important way.

### 11.1 Options compared as wholes

| | **Option I — bounded operational handling** | **Option II — opportunity-centric ledger** | **Option III — combined, phased** *(revised C-COMB)* | **Option IV — narrow the scope** |
|---|---|---|---|---|
| Content | 2-A + 2-D + 4-B + 4-A + 21-A + §7.3 wording | 3-A + 2-C, replacing the anchor | **Option I now; Option II only after AD-3.3 and Q3** | 3-C + Option I |
| Requirement coverage | I-1 (partly), I-2, I-8, fail-closed, B21, FR-A46 | I-1, I-3, I-7 (if designed for it), I-4 | **Both, in dependency order** | I-2, I-8, fail-closed; **FR-A5/FR-A9 amended away** |
| Data-ownership boundary | unchanged; one-way preserved | PI owns identity/permission/qualification/lifecycle; Community owns signal interpretation — **exactly BR-A5** | as II once reached | unchanged |
| Retention / deletion / erasure | Deletion still blocked for protected rows, but **visible, per-item and idempotent** | Deletion possible; erasure needs Q3 | Visible now; deletable later under policy | as Option I |
| Evidence integrity / terminality | Preserved; terminality still anchored to a retention target | **Strongest** | Strongest, reached safely | Preserved |
| Tenant isolation | unchanged | composite FK + RLS required | same | unchanged |
| Schema / migration scope | **None** (plus D-4's optional constraint) | New table, RLS, triggers, indexes, + `prospect_accounts` composite unique | Phase 1 none; Phase 2 as II | None |
| Backfill / rollback | None / trivial | No historical backfill proposed; additive so droppable while unused | Phase 1 trivially reversible | None |
| Test / negative controls | N1–N5, N10–N15 | adds N6–N9, N16 | full N1–N17 over two phases | N1–N5, N10–N15 |
| **Q3 dependency** | **NONE** | **YES** (I-7, erasure, any backfill) | **Phase 1 none; Phase 2 yes** | **NONE** |
| Effort | **1.5–3.0** | 4.0–7.0 | **1.5–3.0 now; +4.0–7.0 later** | 2.0–4.0 |
| Residual risk | Does not fix D-3; indefinite retention persists **and becomes visible** | Could repeat I-7; Q3 exposure | Phase 2 still unselected | FR-A5 permanently narrower than its wording |

### 11.2 Recommendation

**Option III, with Phase 1 recommended for authorization now and Phase 2 explicitly NOT selected.**

**Phase 1 — safe, unblocked, no policy dependency, no schema change (1.5–3.0 engineer-days):** 2-A + 2-D retention pre-exclusion and per-item outcomes; 4-B + 4-A fail-closed reads; 21-A both-SQLSTATE handling; and the §7.3 acceptance wording. Each is individually reversible, each closes a verified defect, and together they satisfy I-2, I-8, the fail-closed rule and B21.

**Phase 2 — technically preferred but NOT safe to select today.** 3-A is the only design satisfying I-3, and it is the right data-ownership boundary under BR-A5. But §4.4 shows the proven PI ledger carries the same **I-7** configuration that P5 proved deadlocks tenant deletion, so building to that shape would reproduce the deadlock — and **what may be removed on tenant offboarding is a Q3 policy question.**

**Stated explicitly, as the brief requires: no option that resolves AD-3 is safe without an unresolved owner decision (AD-3.3) that is itself Q3-dependent. I am therefore not selecting Phase 2 by default.**

**Why the alternatives are weaker.** Option I alone leaves D-3 permanently unfixed, so FR-A5 and FR-A9 would stay unsatisfiable while remaining ratified requirements. Option II first takes the largest, most Q3-exposed step before the cheap certain fixes, and risks reproducing I-7. Option IV is honest and cheap but amends two approved requirements to match an implementation limit rather than fixing it — legitimate only as a deliberate scope decision by the owner.

**Change from the earlier C-COMB:** its step (iii) — the PI-anchored ledger — is **demoted from "recommended, new rows only" to "not selectable until AD-3.3 and Q3 resolve"**, because the earlier recommendation did not account for the tenant-cascade deadlock now proven by P5 and present in the reference implementation.

---

## 12. Requirement conflicts and exact proposed wording

**All PENDING OWNER APPROVAL. v0.1, v0.2, v0.3 and every controlling document are unedited. Changes would land in a successor version only.** Governing authority for every item below: **programme owner** (no separate authority is evidenced).

| Item | Original (verbatim) | Proposed | Rationale / evidence |
|---|---|---|---|
| **FR-A46** | *"`detection_ref` **may become unresolvable** … not a defect to be fixed by adding a foreign key"* | §7.3 | Premise false for pipeline-produced opportunities — P2/P3 |
| **AC-A42** | *"When the referenced `opportunity_feed_items` row no longer exists, the opportunity still returns its `detected_reason` verbatim, and no referential error occurs"* | §7.3 | Precondition unreachable — P2 |
| **NC-A19** | *"Hard-delete the referenced detection row, then read the opportunity"* | split into NC-A19a / NC-A19b (§7.3) | First step refused — P2; the refusal is itself now testable |
| **FR-A40** | *"…**through the existing validated and audited lifecycle mechanism** … the allowed-transition mechanism is not bypassed"* | **Only if Phase 2 is later approved**, amend so "the existing validated mechanism" denotes the authoritative opportunity lifecycle ledger rather than specifically the Community one | 3-A changes the anchor; §4.4 |
| **AC-A24 / AC-A32** | deletion *"succeeds"* once all referencing opportunities are terminal | **Owner must reconcile with FR-A37**: as configured, deletion is refused even when every opportunity is `archived` | P5 — the blocker is the guard, not the state |
| **AC-A11** | *"An opportunity with no evaluation reads **open**, never disqualified"* | **Option A:** *"An opportunity with no recorded evaluation reads `unevaluated` on the evaluation axis and is never `dismissed` on that basis; its lifecycle state is unaffected by the absence of an evaluation."* **Option B:** owner designates a lifecycle state | Two withdrawn names; conflates two axes. `ScoreState` already exists at `prospectIntelligenceRead.ts:158`. FR-A41's approved meanings do not cover `detected`, so **this is an owner designation, not a clarification** |
| **FR-A12** | *"…a contradiction shall not auto-disqualify an opportunity"* | *"…and a contradiction shall not by itself cause an opportunity to be `dismissed`, nor trigger any automatic lifecycle transition."* | Withdrawn name in verb form; missed by the earlier scan |
| **FR-A13** | *"Staleness shall be **reported**, not auto-closed, so recurrence remains visible"* | *"Staleness shall be **reported** and shall trigger **no automatic lifecycle transition**, so recurrence remains visible."* | Names no state, so it cannot drift; preserves recurrence visibility |
| **AC-A13** | *"A stale opportunity is reported stale and is **not** auto-closed"* | *"A stale opportunity is reported stale and **no automatic lifecycle transition occurs**; its state is unchanged by staleness alone."* | as FR-A13 |
| **FR-A28** | *"…**step-up** as the baseline for acting on an opportunity"* | **No change** | Lexical match only |
| **FR-A5 / FR-A9** | four `need_source` values / *"one or more supporting signals, accumulating over time"* | **No change proposed.** Amendment required **only** if the owner chooses Option IV | §4.1 — unsatisfiable today, but the requirements are not the defect |

---

## 13. Owner-decision register

| ID | Question | Options | Evidence required | Owner | Status | Implementation depends? |
|---|---|---|---|---|---|---|
| **AD-2.1** | Adopt 2-A + 2-D retention handling? | adopt / defer | none — code-only | Programme owner | **PENDING** | **YES** (Phase 1) |
| **AD-2.2** | Is indefinite retention of signal-derived personal data acceptable in the interim? | accept / require change | **Q3** | **NOT EVIDENCED** | **BLOCKED** | YES |
| **AD-2.3** | Defer 2-B (`RESTRICT` + governed path) to a Q3-gated package? | defer / now | Q3 | Programme owner | **PENDING** | later |
| **AD-3.1** | Which intake origins are in C-1 scope? | all four (3-A) / signal-only (3-C) | none — scope | Programme owner | **PENDING** | **YES** |
| **AD-3.2** | Anchor an opportunity ledger to `prospect_accounts`? | yes / `canonical_leads` / other | §4.2 | Programme owner | **PENDING** | YES (Phase 2) |
| **AD-3.3** | **How does tenant deletion coexist with append-only evidence?** | guard exempts a governed tenant path / tenant FK `RESTRICT` + offboarding path / accept the deadlock | **Q3** | **NOT EVIDENCED** | **BLOCKED** | **YES — blocks Phase 2** |
| **AD-3.4** | Amend FR-A40 (Phase 2) or FR-A5+FR-A9 (Option IV)? | per chosen option | §12 | Programme owner | **PENDING** | YES |
| **AD-4.1** | Adopt 4-B + 4-A fail-closed reads? | adopt / defer | none | Programme owner | **PENDING** | **YES** (Phase 1) |
| **AD-4.2** | Already-`archived` retry — idempotent no-op or defined error? | no-op / error | none | Programme owner | **PENDING** | YES |
| **AD-4.3** | **D-4** — add an initial-state constraint so a ledger cannot be born terminal? | add (migration) / accept | §5.1 | Programme owner | **PENDING** | separate migration authorization |
| **B21.1** | Adopt 21-A now; 21-B later? | yes / standardize now / neither | §6.2 | Programme owner | **PENDING** | **YES** (Phase 1) |
| **AD-6.1** | Accept the observed retention limitation with §7.3 wording, require an architecture change first, or treat as Q3-dependent? | three outcomes, §7.4 | §7.1 | Programme owner | **PENDING** | YES |
| **AD-7.1** | Approve the §12 wording, and designate `AC-A11`'s axis or state | Option A / B / other | none | Programme owner | **PENDING** | No |
| **Q3** | Supply or identify the approved legal-erasure/retention policy, incl. tenant offboarding | — | policy + approval evidence + accountable authority | **NOT EVIDENCED** | **BLOCKED** | YES for I-5, I-7 |
| **GOV-1** | Create an OMNI Story (+ reviewed registry entry, reader identity) so JEV can advise on ACs | yes / proceed without JEV | §2.4 | Programme owner | **PENDING** | No — JEV is advisory |
| **REV-1** | Nominate a human independent reviewer | yes / accept current level | — | Programme owner | **PENDING** | No |

**No accountable owner is invented.** AD-2.2, AD-3.3 and Q3 are recorded as not evidenced.

---

## 14. Test, migration, backfill, rollback and release-gate plan

**Specification only. Nothing was implemented or run. No test is claimed to pass.**

### 14.1 Tests — Phase 1

| # | Test | Kind |
|---|---|---|
| T1 | N1–N3: retention with a protected row, a mixed batch, and a repeat run proving idempotence | real-schema |
| T2 | N4–N5: direct mutation and both cascade paths refused — **closes the zero-coverage gap (B20)** | real-schema |
| T3 | N10–N12: `missing` / `unreadable` reads fail closed and never read `detected` | unit + real-schema |
| T4 | N14: already-`archived` retry behaves per AD-4.2 | unit |
| T5 | **N15: both `P0001` and `42501` classify as `append_only_violation`** | unit |
| T6 | N13: born-terminal rejected — **only if AD-4.3 is approved** | real-schema |

Phase 2 adds N6–N9 and N16. **N17 stays BLOCKED BY Q3.**

### 14.2 Migration and backfill

- **Phase 1: no migration, no backfill.** AD-4.3's constraint, if approved, is one additive `CHECK` and goes through separate authorization.
- **Phase 2:** new table + RLS declared in the same migration (Supabase grants `ALL` on new public tables to `authenticated`, so an un-RLS'd table is served cross-tenant), composite tenant FK, `RESTRICT` on evidence refs, append-only triggers **with an explicit `ERRCODE`**, partial unique indexes kept partial, vocabulary CHECK in the database, **plus** the `prospect_accounts` `UNIQUE (id, organization_id)` index. **No historical backfill proposed** — any backfill is Q3-gated.
- **Discipline:** no deploy mechanism applies migrations; a green disposable replay is **never** evidence that a migration is applied in production.

### 14.3 Rollback

Phase 1 is code-only and revertible per change. AD-4.3's CHECK is additive and droppable. Phase 2's table is additive and droppable **while unused**; once written to, rollback requires a data decision that is itself Q3-dependent.

### 14.4 Release gates

Scoped unit + real-schema suites green; `npm run typecheck` (3 projects, ~8 GB, **run alone**); counts read from jest, never from `real-schema-ci.sh`'s exit code, which **exits 0 even when the suite fails**; web and worker planes shipped together where both are touched; and — if GOV-1 is taken — `gov verify` → `gov submit` → human Record Result / Record Verification → `gov check-merge`, with merge, release and deployment remaining human.

---

## 15. Schedule scenarios

### 15.1 Frozen baseline — preserved, unchanged

| Item | Frozen | Changed? |
|---|---|---|
| Milestone A′ | **2026-11-25**, **28.5 human engineer-days** | **NO** |
| WP-7 | **2026-11-17**, **4.0 human engineer-days** | **NO** |
| C-1 | **8–12 human engineer-days** | **NO — not revised** |
| **OVERRUN RISK** | **RAISED; zero float at the high C-1 estimate** | unchanged |
| Next checkpoint | **Friday, 2026-10-23** | unchanged |

No baseline revised, no float claimed recovered, no deadline extended, no recovery or de-scope option applied. **Agent wall-clock is kept separate from human engineer-days throughout.**

### 15.2 Scenarios — incremental human engineer-days on top of C-1's frozen 8–12

Assumptions: one sequential owner, so no package has independent float; no historical backfill; disposable harness available; Q3 unresolved.

| Scenario | Incremental | Dependencies | What would narrow it |
|---|---|---|---|
| **S1′ — Phase 1 only** (recommended) | **1.5–3.0** | AD-2.1, AD-4.1, B21.1, AD-6.1 | Whether per-item retention reporting needs a column for the skip reason |
| **S2′ — Phase 1 + Phase 2** | **5.5–10.0** | + AD-3.1/3.2/**3.3**, **Q3**, FR-A40 amendment | AD-3.3's resolution; how much of the PI ledger shape transfers |
| **S3 — Option IV** (narrow scope) | **2.0–4.0** | AD-3.1 + amending FR-A5/FR-A9 | Owner's amendment decision |
| **S4 — Option II first** | 4.0–7.0 | AD-3.3, Q3 | not recommended — defers the certain fixes |
| **S5 — D-4 constraint** | **+0.25–0.5** | AD-4.3 | — |
| **S6 — GOV-1 enablement** | **+0.5–1.0**, mostly human Jira work | human Story + registry entry + reader identity | — |

### 15.3 Risk — flagged immediately

**No estimate is revised.** On the best evidence:

- **S2′ adds 5.5–10.0 engineer-days to a C-1 estimate that already has zero float at its high end.** 12 + 10 = **22 engineer-days against a plan with no slack is an overrun**, and even 8 + 5.5 = 13.5 consumes float the high estimate does not have. **This is a foreseeable overrun and is flagged now, not at the checkpoint.**
- **S1′ is the only scenario that is cheap, certain and entirely unblocked** — 1.5–3.0 days, code-only, no policy dependency, closing four verified defects.
- **Phase 2 cannot be scheduled at all until AD-3.3 and Q3 resolve.** Treating it as schedulable would be the error that §4.4 exposes.
- **A governance cost is now visible:** JEV/GT is unavailable (§2), so AC-level advisory certification is not available for this work until GOV-1 is taken. That does not block engineering — JEV is advisory and deterministic evidence is authoritative — but it does mean the Jira evidence trail for C-1 is currently absent.

**Re-baselining, de-scoping or accepting the overrun is the owner's decision. None is applied here.**

---

## 16. Checks performed, not run, and residual uncertainty

### 16.1 Performed

Eight artifact hashes and line counts at open and close · gov tooling inventory; **verb set reported by the tool itself**; one real `gov packet` invocation capturing `REFUSED`/exit 11; credential **presence-only** check with no value printed; `GOV_HOME` and packet inventory; OMNI-44 scope read; registry id enumeration · re-read `retentionService.ts` policy/execution/delete paths, `retention.ts` bindings and `APPEND_ONLY_TARGETS`, `opportunityLifecycleService.ts` init/read/transition, `opportunityFeedService.ts` creation contract, the transition route · enumerated writers/readers of both lifecycle tables · confirmed zero `opportunit` references across `leadIngestion/**` and `prospectIdentity/**` · confirmed zero repository tests for the Community lifecycle mechanism · read both guard functions' `prosrc` for `ERRCODE` · traced `42501` handling in `lifecycleWriter.ts` and `attributionResolverService.ts` · read `20261029000000` and `20261028000000` headers, states, FKs, triggers · verified `canonical_leads` composite unique exists and `prospect_accounts` lacks one · re-ran the stem-aware vocabulary scan with contextual review · extracted verbatim wording for every requirement cited.

### 16.2 Not run, and why

| # | Not run | Reason |
|---|---|---|
| 1 | **Any JEV / gov stage** | **UNAVAILABLE — J-1…J-5 (§2).** No verdict simulated |
| 2 | Re-execution of the AD-1 probes | No evidence gap; brief forbids needless repetition |
| 3 | Any product test suite, typecheck or lint | No code changed |
| 4 | Any database **write** outside the AD-1 disposable container | Prohibited |
| 5 | Production access, migration-history read, provider call | Prohibited; **no denied operation re-routed** |
| 6 | `pi_wsc_prospect_lifecycle.test.ts`, `20261029000000`'s own demonstration | Cited as their authors' claims, not as my results |
| 7 | Re-search for the Q3 policy | 11 scopes exhausted; no new hypothesis |
| 8 | **Human independent review** | None available |

### 16.3 Residual uncertainty

**Production state is unverified throughout** — whether any cited migration is applied in production is unknown and unknowable within these constraints, and the AD-1 evidence speaks only to a replayed disposable schema. Isolation testing used the container superuser, which bypasses RLS; that matches the retention service's own owned-write posture but is **not** an authenticated-role test, so N16 remains specified rather than evidenced. Effort ranges are judgement, not measurement. **D-4 and the §6.2 caller consequences are new findings in this package and have had no independent review of any kind** — the §2 blockers mean they carry exactly the correlated-review weakness that this programme has already been bitten by once.

---

## 17. Time ledger

| | |
|---|---|
| **Actual start** | **2026-10-17T21:54:25+05:30 (IST)** |
| **Actual end** | **2026-10-17T22:02:34+05:30 (IST)** |
| **Wall-clock elapsed** | **8 min 9 s** |
| **Active engineering effort** | **~8 minutes** (no external wait inside this task) |
| External waiting before start | **17 min 31 s** (prior task closed 21:36:54 → 21:54:25) — not engineering effort |
| Agent wall-clock vs human engineer-days | kept **separate**; no substitution made |
| Monitoring | **no continuous monitoring claimed between reports**; every timestamp is a measured `date -Iseconds` |

---

## 18. Closing

| Gate | Status |
|---|---|
| **JEV / GT** | **UNAVAILABLE** — five verified blockers; `gov packet` reported `REFUSED` exit 11. **No verdict produced or simulated.** JEV is advisory and cannot evaluate an architecture (J-5) |
| **AD-2** | Evidence **PASS**; recommend **2-A + 2-D**; AD-2.2 **Q3-BLOCKED** |
| **AD-3** | Evidence **PASS** (confirmed, strengthened); recommend **3-A** — but **AD-3.3 is Q3-BLOCKED, so Phase 2 is not selectable** |
| **AD-4** | Evidence **PASS**; recommend **4-B + 4-A**; **new finding D-4** — the ledger can be born terminal |
| **B21** | Evidence **PASS**; recommend **21-A**; `P0001` is **not** treated as equivalent to `42501` |
| **AD-6** | The criterion **does not test a reachable condition**; §7.3 wording proposed, **acceptance NOT granted** |
| **Q3** | **BLOCKED** — unchanged; policy request stands, **not sent** |
| **Integrated recommendation** | **Option III** — Phase 1 now; **Phase 2 explicitly not selected**, because no AD-3 resolution is safe without a Q3-dependent owner decision |
| **Ratification of v0.3** | **NOT RATIFIED, NOT ratification-ready** |

**Architecture selection remains subject to owner decision; Q3 remains blocked unless verified policy evidence closes it; requirement ratification remains pending; implementation authorization remains NONE.**
