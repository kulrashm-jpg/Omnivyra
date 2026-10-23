# PI-C1-LIFECYCLE-ORDERING-INDEPENDENT-REVIEW-001 — review of the ordering investigation

**REVIEW ONLY. No implementation was performed and none is authorized.** No product-code change, no test change, no schema or migration change, no database created or written, no production access, no provider call, no commit, push, merge or deployment. No controlling document was edited.

> ## Verdict
>
> **The investigation's diagnosis is sound and, if anything, understated. Its recommendation is NOT sound as specified and should not be implemented in that form.**
>
> Four material defects in the proposal, each verified against source:
>
> 1. **The ambiguous read is durably written.** `transitionLifecycle` writes the read's result into `previous_state` (`opportunityLifecycleService.ts:281`) in a table whose `UPDATE` is blocked. An ambiguous read therefore produces **permanent, unrepairable** data — not a transient wrong answer. **The original investigation missed this entirely**, and it changes the severity of everything downstream.
> 2. **`DEFAULT nextval(...)` instead of `GENERATED ALWAYS AS IDENTITY` is a material weakness**, not a stylistic choice: the column becomes writable through PostgREST, and with `NULLS LAST` and no `UNIQUE`, a single row with a maximal `seq` would pin an opportunity's current state permanently.
> 3. **"No backfill" is likely violated by the migration as written.** `nextval()` is VOLATILE, so a one-statement `ADD COLUMN … DEFAULT nextval(...)` does not get the fast-default path and would rewrite the table, **silently assigning every historical row a `seq` in heap order** — the precise outcome the investigation argued against.
> 4. **The rolling deployment is unsafe**, and the investigation's claim that the mixed-version window is "no worse than today" is **wrong** because of (1): two code versions can each write a different `previous_state` for the same prior state, leaving a self-contradictory chain that can never be corrected.
>
> And the proposal **does not address the live defect at all**: the read-modify-write fork (D-5) is wider and more reachable than the tie it does address, and a sequence column would make the wrong answer *stable* rather than intermittent — harder to detect.
>
> **Better direction, supported by repository evidence:** move read-validate-insert into a single plpgsql function behind the existing `ownedDbRpc` seam (`backend/db/writeOwner.ts:11-23`, whose doc comment describes exactly this case), so the lock, the read, the graph check, the sequence allocation and the insert share one transaction. **This is a recommendation, not a decision.**

---

## 1. Baseline and source hashes

Measured **2026-10-19T09:02:05+05:30 (IST)**.

| | Value |
|---|---|
| Review target | `docs/pmo/prospect-intelligence/PI-C1-LIFECYCLE-ORDERING-INVESTIGATION-001.md` |
| Expected / actual SHA-256 | `2be20d2d7300a4343884e7048a3247c30d3c1461fec12a99d4c7b1636f956e2e` — **MATCH**, 403 lines |
| Repository / branch | `C:/tmp/r1-ctx` · `fix/r1-profile-context` — **as expected** |
| HEAD, start and end | **`29fea38a2d1642c1c2fd957e5151f6be81415774`** — **as expected, unchanged** |
| Working tree, start | **161 entries (72 M / 89 ??)** |
| Working tree, end | **162 entries** — the one addition is this review |

| Source / migration | SHA-256 (16) |
|---|---|
| `backend/services/opportunityLifecycleService.ts` | `40bb4453ff14f4ca` |
| `backend/types/opportunityLifecycle.ts` | `90650ccb11deec8f` |
| `backend/services/strategicDashboardsService.ts` | `af440a15a11fff77` |
| `backend/services/prospectLifecycle/lifecycleReader.ts` | `909046dc7882021d` |
| `backend/services/prospectLifecycle/lifecycleWriter.ts` | `fde7e56c479a51a1` |
| `supabase/migrations/20260520_phase6_realtime_lifecycle_workflow.sql` | `51bab399a0831cde` |
| `supabase/migrations/20261028000000_pi_prospect_lifecycle_state.sql` | `368e6f6125597cae` |
| `supabase/migrations/20261029000000_pi_lifecycle_initial_state_valid.sql` | `8c288a4bb1301c46` |
| `backend/tests/realschema/pi_lifecycle_b21.test.ts` | `fa767658ebbea3f5` |

---

## 2. Independence statement and limitations

**This is not independent review in the sense that matters most, and it must not be recorded as one.**

| | |
|---|---|
| Who authored the investigation under review | **This same agent, in this same session.** |
| How independence was sought | The technical reconstruction was delegated to a **separate agent instance with no authoring context**. It was briefed with the repository and a neutral statement of the candidate design, and **explicitly instructed not to read anything under `docs/pmo/prospect-intelligence/`** so it could not see the investigation, its conclusions or its recommendation. It reports that it did not open those files |
| What that buys | **Structural independence of the reconstruction.** It derived its own consumer inventory, its own semantics analysis and its own critique, and it **contradicted the original recommendation** — which a rubber stamp would not do |
| What it does **not** buy | It is the **same model family**, briefed by the original author, and I then verified and wrote up its findings. **No human has reviewed this work.** |
| **Direct evidence that this limitation is real** | Earlier in this same programme a separate-agent review of `PI-ADD-001` **agreed with findings D-1 and D-2 that later proved wrong** (recorded in `PI-C1-ARCHITECTURE-BLOCKER-REVIEW-001` §0 and §11). Correlated reviewers can and do share blind spots |
| JEV / GT | **No verdict exists and none is fabricated.** JEV/GT remains unavailable for the reasons in `PI-C1-JEV-ARCHITECTURE-DECISION-002` §2 |

**Method note.** Every material claim below was re-verified by me against source before being repeated; the reviewer's conclusions are not presented as evidence in themselves. Where I verified a claim, the citation is mine. Where a claim rests on PostgreSQL semantics rather than on execution, it is labelled `INFERRED` or `UNVERIFIED` — including claims the reviewer labelled more confidently.

**Two citation errors in the reviewer's report, found by verification** — substance correct, line numbers wrong: it cited the PI `seq` column at `:76` (actually **`:105`**) and the "sequence order equals commit order" comment at `:71-77` (actually **`:100-104`**). Noted because it shows the claims were checked rather than endorsed.

---

## 3. Verified reader/writer inventory

The investigation listed **8** consumers (5 readers + 3 windowing). The reviewer found **11** query sites. **I verified the larger figure is right**: the investigation under-enumerated by not counting the two `is_initial` existence probes and by collapsing retention's three distinct query sites into its binding entries.

### 3.1 Readers that derive a current state — `[CONFIRMED]`

| ID | Site | Ordering | Total? | Derivation | Feeds |
|---|---|---|---|---|---|
| **A1** | `opportunityLifecycleService.ts:98-104` `readCurrentLifecycleState` | `transitioned_at DESC LIMIT 1` | **No** | row 1, then shape validation | the `from` state of every transition **and** `isResolvedForAccountDeletion` |
| **A2** | `:207-213` `getCurrentLifecycleState` | identical | **No** | raw row, no `missing`/`unreadable` distinction | **nothing — zero callers** (§8.4) |
| **A3** | `:305-308` `getLifecycleBoardCounts` | `transitioned_at DESC`, **no `LIMIT`** — whole org | **No** | app-side first-seen-wins | board counts JSON |
| **A4** | `strategicDashboardsService.ts:153-157` | `transitioned_at DESC` | **No** | its **own** first-seen-wins reducer | `conversion_trends` tile |

### 3.2 Other consumers — `[CONFIRMED]`

| ID | Site | Category |
|---|---|---|
| **B1** | `opportunityLifecycleService.ts:222-226` `listLifecycleHistory` | full history, `ASC`; replay order shares the tie problem |
| **C1** | `:166-171` | `is_initial` existence probe; **`error` discarded** |
| **C2** | `:190-195` | the same probe after `23505`; **`error` discarded** |
| **C3** | `retentionService.ts` `findProtectedIds`, bound via `retention.ts:103-109` | **existence probe — the actual deletion gate**, no ordering |
| **D1** | `auditExportService.ts`, bound at `:27` | time-window export, 5000-row cap |
| **D2/D3** | `retentionService.ts` scope count and candidate ids, bound at `retention.ts:58` | time-window |

**Indirection matters.** C3, D1, D2 and D3 contain no literal `opportunity_lifecycle_states` in their queries — the table arrives through `TARGET_TABLES` and `RETENTION_TARGET_BINDINGS` / `RETENTION_PROTECTED_CHILDREN`. An inventory built from `.from('opportunity_lifecycle_states')` alone misses the deletion gate.

### 3.3 Writers — `[CONFIRMED]`

Two, both in `opportunityLifecycleService.ts`: `initialiseLifecycleForOpportunity` (`:174-186`) and `transitionLifecycle` (`:276-288`). **Neither supplies `transitioned_at`**, so both take `DEFAULT NOW()` — i.e. transaction start time. **No `BEFORE INSERT` trigger, no advisory lock, no chain check**; `uq_opp_lifecycle_initial` serialises initialisation only.

### 3.4 Can consumers disagree? — still `INFERRED`

A1, A3 and A4 are three separate non-total orderings, so nothing requires them to pick the same tied row. **The investigation labelled this INFERRED and that labelling was correct; I did not demonstrate it either**, and demonstrating it would need an authorized reproducible method. It remains **INFERRED**.

---

## 4. Findings by claim

| # | Claim under review | Verdict | Evidence |
|---|---|---|---|
| 1 | `readCurrentLifecycleState` orders by `transitioned_at DESC LIMIT 1` | **CONFIRMED** | `:98-104` |
| 2 | `transitioned_at` is the only ordering column; PK is a random uuid; no sequence | **CONFIRMED** | `20260520…sql:13-37`; `id uuid DEFAULT gen_random_uuid()` |
| 3 | Two inserts in one transaction share `now()` | **CONFIRMED** | demonstrated `[PG]` in the prior run; asserted at `pi_lifecycle_b21.test.ts:443-459` |
| 4 | The PI sibling has a monotonic `seq` | **CONFIRMED** | `20261028000000…sql:105` — `seq bigint GENERATED ALWAYS AS IDENTITY` |
| 5 | `getLifecycleBoardCounts` shares the weakness | **CONFIRMED**, and worse than stated — it has **no `LIMIT`** and reduces app-side | `:305-308` |
| 6 | Four readers, not two | **CONFIRMED** | §3.1 |
| 7 | The inventory was complete at 8 consumers | **CONTRADICTED** — there are **11** query sites | §3 |
| 8 | **The read's result is durably written as `previous_state`** | **CONFIRMED — and the investigation missed it** | `:281` `previous_state: from`, inside the insert at `:276-288`; `UPDATE` raises `P0001` (`20260520…sql:55-73`) |
| 9 | Ordering affects "terminality and deletion eligibility" | **CONFIRMED for terminality; OVERSTATED for deletion** | `isResolvedForAccountDeletion` (`:153`) has **zero non-test callers** — verified by repository-wide grep — and **no account-deletion service exists** (`ls backend/services \| grep -iE 'delet\|erasur\|gdpr'` → empty). The deletion gate that *does* exist is the ordering-independent existence probe C3 |
| 10 | The repo's "sequence order equals commit order" claim | **CONTRADICTED as written; the investigation repeated it** | `20261028000000…sql:100-104` and `lifecycleReader.ts:92-96`. A column default — including an identity's `nextval()` — is evaluated at tuple formation, **before** `BEFORE INSERT FOR EACH ROW` triggers run, so the lock at `:293` is **downstream of allocation**. **INFERRED** (documented PostgreSQL semantics; not demonstrated) |
| 11 | What actually protects the sibling | **the chain CHECK + single retry**, not the lock — `INFERRED` | trigger compares `previous_state` to the current row and raises `23514` (`:303-318`); `lifecycleWriter.ts:414-416` retries once |
| 12 | A state can repeat, so history can't be linearised from `previous_state` | **CONFIRMED** | `opportunityLifecycle.ts:36-45` — at least five 2-cycles; `canTransitionLifecycle` forbids only `from === to` |
| 13 | Option B rejected (no authoritative mechanism exists) | **CONFIRMED** | no version, revision or predecessor-row-id column; `previous_state` is unordered and unenforced |
| 14 | Option C is deterministic but semantically arbitrary | **CONFIRMED** | `gen_random_uuid()` carries no time |
| 15 | `ADD COLUMN` does not fire the append-only trigger | **INFERRED, and the investigation's framing is dangerous** — see §7 | triggers are `BEFORE UPDATE`/`BEFORE DELETE` only (`:65-73`); DDL not firing DML triggers is standard semantics but **UNVERIFIED** here |
| 16 | An `UPDATE` backfill is blocked | **CONFIRMED** | `pi_lifecycle_b21.test.ts:494-505` demonstrated `P0001` and an unchanged row |
| 17 | Mixed-version deployment is "no worse than today" | **CONTRADICTED** | follows from finding 8 — see §7.4 |
| 18 | Three `error` values silently discarded | **CONFIRMED — new, not in the investigation** | `opportunityLifecycleService.ts:166`, `:190`, `strategicDashboardsService.ts:153` all destructure `data` only |

---

## 5. Sequence vs commit vs business order

The investigation raised the allocation-versus-commit distinction and flagged it as the key open question — **correctly**. But it then attributed the sibling's guarantee to the advisory lock, repeating the repo's own wording. That attribution does not hold.

| Order | In this codebase | Property |
|---|---|---|
| **(a) Allocation** | `nextval()` for the sibling's `seq` (`:105`); **does not exist** for the Community table | Non-transactional: evaluated at tuple formation, never rolled back, leaves gaps |
| **(b) Commit** | what any reader actually observes | A reader sees exactly the rows whose transactions have committed. Isolation level is PostgREST/PostgreSQL default — **UNVERIFIED**, no configuration found |
| **(c) Business decision** | approximated by `transitioned_at` = `now()` = **transaction start**, which is after the HTTP round trip and after the current-state read | The sibling lets the caller supply it and labels it "BUSINESS time" (`:100-101`); the Community writers never supply it |
| **(d) What readers use** | **(c), with no tiebreaker** | the defect |

**Can (a) differ from (b) without a lock acquired before allocation? Yes.** Txn A allocates `seq=10`; txn B allocates `seq=11`; B commits; A commits. A reader after both sees `max(seq) = 11` — **the transaction that committed last lost**. Identity values order *starts*, not *finishes*. Only a lock taken **before** allocation, or allocation inside the same critical section as the read-validate-write, makes (a) ≡ (b). `INFERRED` — documented semantics, not demonstrated.

**So for the Community table: (a) does not exist, (b) is unobserved, (c) is a start timestamp with no tiebreaker — and the readers order by (c).** A `seq` column added without serialisation would give a **total order over allocation**, which is neither commit order nor decision order.

**A-minimal guarantees deterministic selection only. It does not guarantee semantically correct current state, and must not be described as if it did.**

---

## 6. Alternatives and tradeoffs

| | Determinism | Chronological correctness | Concurrent writers | Reader impact | Schema / migration | Append-only integrity | Historical data | Rollback | Residual risk |
|---|---|---|---|---|---|---|---|---|---|
| **A-minimal as specified** | new rows only | **No** | unaddressed | all 4 readers + index | 1 column + 1 index | intact **if** two-statement | permanent two-regime | code-only safe; `DROP COLUMN` destructive | **High** — §7 defects 2–4 |
| **A-strict** (`GENERATED ALWAYS AS IDENTITY`, `UNIQUE`, nullable not possible ⇒ forces the backfill question) | **Yes** | No | unaddressed | same | forces a decision on historical rows | intact | must assign *something* | as above | Medium |
| **B** — existing mechanism | — | — | — | — | — | — | — | — | **Not available** — none exists |
| **C** — `transitioned_at, id` tie-break | **Yes** | **No, and arbitrary** | unaddressed | reader-only | **none** | intact | uniform | trivial | Low cost, low benefit; makes the wrong answer stable |
| **D** — `clock_timestamp()` default | reduces ties | No | unaddressed | none | 1 default | intact | unaffected | trivial | Semantic change to an existing column |
| **E — RPC: read-validate-insert in one plpgsql function** *(reviewer's proposal, which I endorse as the technically preferred direction)* | **Yes** | **Yes, to the extent the system can know it** | **Addressed** — lock, read, graph check, allocation and insert in one transaction | all 4 readers; writer moves behind `ownedDbRpc` | function + column + index | intact — INSERT is not blocked | same choice as A | function is droppable | Medium build cost; **the only option that fixes D-5** |
| **F — chain trigger** (sibling's design) | with a column | mostly, via the CHECK | **Addressed** by rejecting stale `previous_state` | readers unchanged | trigger + column | intact | same choice | droppable | Must ship *with* a total order; inherits the sibling's reassessment hole |

**Option E uses a seam that already exists for this purpose.** `backend/db/writeOwner.ts:11-23` documents `ownedDbRpc` as the answer for "an invariant that must hold at every committed instant across more than one table… a plpgsql function invoked as a single statement is a single transaction". `[CONFIRMED]`

**I do not choose on the owner's behalf.** My recommendation is **E, with the sequence column allocated inside the lock, shipped together with a reader change** — and explicitly **not** A-minimal as specified. Assumptions: that a plpgsql write path is acceptable for this surface; that one extra function is preferred over living with a known fork. Unresolved: whether the §5 allocation-ordering argument holds in execution (needs D-6).

---

## 7. Migration and historical-data analysis

### 7.1 Does the append-only trigger protect against a backfill? **Not the way the investigation implies**

The triggers are `BEFORE UPDATE` and `BEFORE DELETE` only (`20260520…sql:65-73`). So:

- an `UPDATE` backfill **is** blocked — `P0001`, statement aborts. `[CONFIRMED]` by `pi_lifecycle_b21.test.ts:494-505`;
- **`ALTER TABLE`, including a full table rewrite, is not blocked at all.** `INFERRED` (standard semantics), **UNVERIFIED** here.

**This inverts the investigation's comfort.** It presented "`ADD COLUMN` never provokes the guard" as a safety property. It is equally an **absence of protection**: the guard will not stop an accidental rewrite-backfill.

### 7.2 The specific hazard in the proposal as written

The investigation specifies "a nullable column with `DEFAULT nextval(...)`". If implemented as the single statement

```sql
ALTER TABLE opportunity_lifecycle_states ADD COLUMN seq bigint DEFAULT nextval('…');
```

then because `nextval()` is **VOLATILE**, the fast-default optimisation does not apply and PostgreSQL rewrites the table, **evaluating the default for every existing row** — so every historical row silently receives a `seq` in heap-scan order. That is exactly the "semantically indefensible" outcome the investigation argued against, arrived at by accident. Achieving the intended semantics requires **two statements**: `ADD COLUMN seq bigint;` then `ALTER COLUMN seq SET DEFAULT nextval('…');`.

**The investigation does not state which form, and the difference is its entire premise.** `INFERRED` (documented behaviour); **UNVERIFIED** against the target version.

### 7.3 `DEFAULT` versus `GENERATED ALWAYS AS IDENTITY`

The investigation chose `DEFAULT` to permit NULLs. That choice has consequences it did not weigh:

- a `DEFAULT` column is **writable** — PostgREST exposes it and any INSERT may supply `seq`; `GENERATED ALWAYS` would reject that absent `OVERRIDING SYSTEM VALUE`;
- no `UNIQUE` is proposed, so an explicitly supplied duplicate **reintroduces a tie** that falls back to `transitioned_at` — today's defect, now hidden behind a column that looks authoritative;
- combined with `NULLS LAST` and append-only immutability, **a single row with a maximal `seq` would pin that opportunity's current state permanently**;
- the sibling chose `GENERATED ALWAYS AS IDENTITY` (`:105`), so this deviates from the established pattern.

`CONFIRMED` that a DEFAULT column is writable where an identity-ALWAYS column is not; the pinning path is `INFERRED`.

### 7.4 Rolling deployment — the investigation's claim is wrong

The investigation stated the mixed-version window is "no worse than today". **It is materially worse**, because of finding 8: during a partial rollout an old instance orders by `transitioned_at DESC` and a new one by `seq DESC NULLS LAST, transitioned_at DESC`; for any tied or forked opportunity they hold **different beliefs about the current state**, and each then writes **its own belief into `previous_state`** (`:281`). Because `UPDATE` raises `P0001`, the resulting self-contradictory chain is **permanent**.

So the rollout converts a read inconsistency into **durable write corruption**. Only `transitionLifecycle` is exposed — `initialiseLifecycleForOpportunity` writes only `is_initial` rows protected by `uq_opp_lifecycle_initial`. `CONFIRMED` for the call chain and the durable write; `INFERRED` that two versions serve concurrently (deploy topology **UNVERIFIED**).

**Mitigation the proposal lacks:** ship the reader change to 100% of instances in one release before anything depends on it — or make ordering a single database-side concern (view or RPC) so version skew is impossible.

### 7.5 `NULLS LAST` across the two regimes

`NULLS LAST` on `DESC` is an explicit override (the default is `NULLS FIRST`), and its effect is that **any one new row outranks every old row forever**. Correct normally; wrong in two reachable cases: an out-of-band corrective append with `seq = NULL` and a later `transitioned_at` — which is the *only* repair available for a born-terminal row (§8.1) — would be ignored; and rows restored from backup without `seq` would be invisible to the current-state read.

Two `NULL`-`seq` rows with equal `transitioned_at` still tie, and because the table is append-only **they can never acquire a `seq`** — so the two-regime ordering is **permanent, not transitional**.

### 7.6 Historical ties remain unresolvable — the investigation was right

The only candidate orderings are `transitioned_at` (whose ties are the problem), `id` (random uuid), `ctid` (physical artifact), and the `previous_state` chain — which §4 finding 12 rules out. **A backfill cannot create history that was never recorded.** The honest choices are to leave old rows `NULL`, or to assign heap order and **document it in the migration as a guess, not a fact**. `CONFIRMED`.

### 7.7 Rollback

Code-only rollback is the safe direction but re-opens the §7.4 divergence in reverse. `DROP COLUMN seq` takes a brief `ACCESS EXCLUSIVE` lock and destroys the ordering information, leaving rows whose `previous_state` was validated under `seq` ordering in a state **neither ordering explains**. And there is no rollback for an accidental rewrite (§7.2): dropping the column removes the values, but the rewrite and any decision taken while they were live stand. A standalone sequence not owned by the column would also be orphaned — a further small point against `DEFAULT`.

---

## 8. D-4, D-5, cross-tenant and duplicate reader

### 8.1 D-4 — born-terminal row: **CONFIRMED, with an asymmetry the investigation missed**

The schema permits `INSERT (…, state 'archived', is_initial TRUE)`: the CHECKs are **vocabulary-only** (`20260520…sql:24-36`), there is no constraint coupling `is_initial` to `state` or to `previous_state IS NULL`, no `BEFORE INSERT` trigger, and `uq_opp_lifecycle_initial` only prevents a *second* initial row. The sibling closed both holes — `prospect_lifecycle_initial_shape` and `prospect_lifecycle_initial_state_valid` (`20261029000000…sql:88-90`).

Consequence: such a row reads as `present/'archived'`, satisfies `isResolvedForAccountDeletion`, and `ALLOWED_LIFECYCLE_TRANSITIONS.archived = []` refuses every exit.

**The asymmetry: the Community table is *more* repairable than the sibling, precisely because it is less constrained.** A corrective non-initial append with a later `transitioned_at` passes both vocabulary CHECKs and there is no chain trigger to object, so the latest-row reader would report the corrected state. Not possible through the application writer — only out-of-band. `CONFIRMED` from constraint analysis.

### 8.2 D-5 — concurrent transition race: **CONFIRMED, and it is the live defect**

`transitionLifecycle` (`:244-293`) reads current state in **one** PostgREST transaction (`:256`), validates in application code (`:271`), then inserts in a **second** transaction (`:276-288`) with no `WHERE` guard, no `ON CONFLICT`, no lock. Two concurrent requests both read `qualified`, both pass, both insert — producing **two rows claiming `previous_state = 'qualified'`**. Which is "current" is then decided by whichever transaction *started* first.

**Severity relative to the tie defect:** the tie window is microseconds and the repo's own test comment calls it *latent*; **the fork window is a full read-then-write round trip** — milliseconds — and its product is a permanent `previous_state` contradiction. **The latent defect has tests; the live one has none.**

**Would the ordering fix resolve it? No.** A sequence column changes only how the fork is tie-broken: it does not prevent, detect or reject it, and it makes the wrong resolution **stable** rather than intermittent — which is *harder* to discover. I agree with treating it as a separate defect only if it is scheduled, not shelved.

### 8.3 Cross-tenant reference: **CONFIRMED — the schema does not enforce it**

Three **single-column** FKs (`20260520…sql:15-16`); nothing ties `organization_id` to `opportunity_feed_items.organization_id`. `pi_lifecycle_b21.test.ts:701-730` already measured this against PostgreSQL: multi-column FK count `0`, and the cross-tenant insert **succeeds**.

**On "application predicates are sufficient" — I checked all mutation paths rather than asserting it.** There are exactly two writers (§3.3) and both set `organization_id` from the caller's argument, never from row data; the route derives it from `enforceCompanyAccess`. So **for these two paths** tenant correctness holds. It does **not** hold for any other writer, migration, operator script or direct SQL, and the database would not object.

A composite FK is **not currently expressible**: `opportunity_feed_items` has no `(id, organization_id)` unique index — its only unique constraint is `(organization_id, signal_id)`. Adding the parent key would be additive, exactly as the sibling's migration did for `outreach_outcomes`. `CONFIRMED`.

### 8.4 Duplicate reader: **CONFIRMED — zero callers; removal would be safe; not removed**

Repository-wide grep returns exactly one hit for `getCurrentLifecycleState`: its own definition at `:203`. It is also the *unsafe* variant — a bare row with no `missing`/`unreadable` distinction and no contradiction check, i.e. the shape `readCurrentLifecycleState` was written to replace. Leaving it invites a future caller to reintroduce the fail-closed violation.

**Bonus, verified:** `isResolvedForAccountDeletion` likewise has **zero non-test callers**. Two of the file's exported readers are unreachable from production.

**Nothing was removed.**

---

## 9. Test-gap analysis

T1–T12 are well-aimed at the tie defect. The gaps:

| Gap | Why it matters | Which failure it would catch |
|---|---|---|
| **G1 — no test that `previous_state` is written from the read** | finding 8 is the defect's durable consequence and is untested | a regression where an ambiguous read is persisted |
| **G2 — no test for version skew** | §7.4 is the most serious deployment risk | two orderings producing contradictory `previous_state` |
| **G3 — no test that `seq` is NOT client-writable** | §7.3 pinning hazard | a supplied `seq`, or a duplicate `seq` |
| **G4 — no test that the migration did not backfill** | §7.2 — a one-statement `ADD COLUMN` would silently assign heap order | asserting `count(*) WHERE seq IS NOT NULL` equals the number of post-migration rows |
| **G5 — no test for the `NULL seq` + later `transitioned_at` corrective append** | §7.5 — the only repair path for a born-terminal row would be ignored | `NULLS LAST` masking a genuine latest row |
| **G6 — no concurrency test at all** | D-5 is live and untested | the fork; needs two sessions, so a new harness capability |
| **G7 — no test for the three discarded `error` values** | finding 18 | a read failure becoming "no initial row" and proceeding to INSERT |
| **G8 — no test that all four readers agree** | T4 covers it in design; A4 lives in a different service, easy to miss | one reader left un-migrated |

**T5 as written may not be executable**: "concurrent writers" needs two database sessions, which the current real-schema harness (a single shared `pg` client under `inRollback`) does not provide. It should be marked **NOT RUN pending a harness capability** rather than appearing satisfiable.

### 9.1 L3 and L3b after an approved remediation

I agree with the investigation's proposal and add one correction.

| Test | Disposition |
|---|---|
| **L3** | Remove the `seedInitialEarlier` fixture so it performs two transitions in one transaction — L3 absorbs T1 and becomes the semantic regression test. **This is the assertion that fails today**, and it must be the one that proves the fix |
| **L3b** | **Rewritten, never weakened.** Its three structural assertions will fail once a column exists — by design. Replace them with structural *guarantees*: an ordering column exists, it is `GENERATED ALWAYS` (not writable), it is `UNIQUE`, the composite index exists, the order is total over a timestamp tie, and `NULL seq` sorts last |
| **Addition** | L3b should also assert **G4** — that the migration left historical rows `NULL` — because that is the premise the whole no-backfill argument rests on, and §7.2 shows it can be violated silently |

**No regression test should be weakened to make a suite green.**

---

## 10. D-1 to D-7 assessment

No decision is marked approved or ratified.

| ID | Decision | Classification | Why |
|---|---|---|---|
| **D-1** | Adopt A-minimal | **NOT YET SUPPORTED** | Sound in identifying that a monotonic column is needed; unsound as specified — §7.2 (silent backfill), §7.3 (writable column), §7.4 (durable corruption on rollout), §8.2 (leaves the live defect). It should be **re-specified**, not adopted or rejected wholesale |
| **D-2** | No historical backfill | **SUPPORTED BY EVIDENCE** | §7.6 — the ordering information does not exist in the rows. The strongest conclusion in the investigation. **Caveat:** it must be *implemented* as two statements, or it is violated by accident |
| **D-3** | Accept sequence-assignment ordering without serialisation | **REQUIRES ADDITIONAL TECHNICAL EVIDENCE, then OWNER JUDGEMENT** | §5 — allocation order ≠ commit order, and the repo's contrary claim is overstated. The argument is `INFERRED` from documented semantics and **has not been executed**. Decide after D-6 |
| **D-4** | Remove the dead duplicate reader | **SUPPORTED BY EVIDENCE** | §8.4 — zero callers, and it is the unsafe variant. Lowest-risk item on the list |
| **D-5** | Treat the write race as a separate package | **SUPPORTED WITH MATERIAL CAVEATS** | §8.2 — separable, but it is the **live** defect while the ordering tie is latent. Acceptable only if scheduled; "separate" must not become "deferred indefinitely" |
| **D-6** | Authorize a disposable-PostgreSQL investigation of the DDL/append-only interaction | **SUPPORTED BY EVIDENCE — and now more clearly necessary** | §7.1, §7.2. It must additionally test whether `ADD COLUMN … DEFAULT nextval` rewrites and backfills, and whether a `BEFORE INSERT` trigger sees an already-allocated identity value (which decides D-3) |
| **D-7** | Authorize implementation | **NOT YET SUPPORTED** | The design needs re-specification (D-1) and D-6's evidence first |

---

## 11. Schedule and effort

**The frozen baseline is unchanged and no estimate is revised:** Milestone A′ **2026-11-25 / 28.5 human engineer-days**; WP-7 **2026-11-17 / 4.0**; C-1 **8–12**; **OVERRUN RISK remains raised**; next checkpoint **Friday 2026-10-23**. **No float is claimed recovered and no scope reduction is proposed.**

| Option | Incremental human engineer-days | Assumptions |
|---|---|---|
| **D-6 investigation** | **0.25–0.5** | one disposable database, DDL authorized, no production |
| **D-4** remove dead reader | **0.1–0.25** | typecheck + scoped suites |
| **C** interim tie-break | **0.25–0.5** | reader-only; consistency, not chronology |
| **A re-specified** (`GENERATED ALWAYS`, `UNIQUE`, two-statement, index, 4 readers, single-release reader rollout) | **1.5–3.0** | revised **upward** from the investigation's 1.0–2.0 because of the index, the rollout constraint and G3/G4 tests |
| **E** RPC read-validate-insert | **+2.0–3.5** on top of A | plpgsql function, error mapping, retry, concurrency harness for G6 |
| **A + E together** (the technically preferred whole) | **3.5–6.5** | the only combination that fixes both defects |

**Does this block dependent work?** `[CONFIRMED]` **No terminality gate exists today** — `isResolvedForAccountDeletion` has zero non-test callers and there is no account-deletion service. So the ordering defect blocks **nothing currently running**. It **is** a prerequisite for any Phase 2 terminality or deletion gate, because such a gate would consume exactly the ambiguous read. Finding 8 sharpens the urgency differently: **every transition performed today already writes a possibly-ambiguous `previous_state` permanently**, so the evidence record degrades with use even while no gate consumes it.

Flagged, not revised: **3.5–6.5 engineer-days against a C-1 estimate with zero float at its high end is an overrun** at that end — consistent with the risk already raised.

---

## 12. Recommended next evidence-gathering steps

In order of value per unit of effort. **None performed here.**

1. **D-6, extended** — one disposable database, DDL authorized. Prove or disprove: (a) `ADD COLUMN seq bigint` nullable fires no trigger; (b) whether `ADD COLUMN … DEFAULT nextval(...)` rewrites and backfills, and in what order; (c) that an `UPDATE` backfill raises `P0001`; (d) **whether a `BEFORE INSERT` trigger observes an already-allocated identity value** — this single probe settles D-3; (e) whether the migration role can disable the triggers. **0.25–0.5 days.**
2. **A two-session concurrency probe** for D-5, demonstrating the fork directly rather than inferring it — two `pg` clients, interleaved read-then-insert. Needs a harness capability the real-schema suite lacks. **0.25–0.5 days.**
3. **A reader-agreement probe** — construct one tie, then run A1, A3 and A4 over it and record whether they actually disagree. Converts §3.4 from `INFERRED` to measured. **~0.1 days.**
4. **A human reviewer** for §5 and §7.4, the two claims where a shared-model blind spot would be most costly.

---

## 13. Checks not run and residual uncertainty

| Item | Status |
|---|---|
| Any database creation, migration replay, DDL, fixture write or query | **NOT RUN — not authorized by this task** |
| Execution of the §5 allocation-before-trigger claim | **UNVERIFIED** — the decisive input to D-3 |
| Execution of the §7.2 rewrite/backfill claim | **UNVERIFIED** — the decisive input to D-1 |
| Demonstration that two readers actually disagree | **INFERRED only** |
| Demonstration of the D-5 fork | **INFERRED from code; not executed** |
| Isolation level in effect | **UNVERIFIED** — no configuration found |
| Deploy topology (whether two versions serve concurrently) | **UNVERIFIED** |
| Heap order ≈ insertion order for this table | **UNVERIFIED** |
| Whether the migration role owns the table (could disable triggers) | **UNVERIFIED** |
| Any test run, typecheck or lint | **NOT RUN** — nothing was changed |
| **Human review** | **NOT RUN** |

**Residual uncertainty.** The two claims that overturn the recommendation — allocation-before-trigger (§5) and rewrite-on-volatile-default (§7.2) — both rest on **documented PostgreSQL semantics, not execution**. If either is wrong, part of this critique weakens: specifically, if a `BEFORE INSERT` trigger could observe allocation order, the sibling's claim would stand and D-3 would be straightforwardly supportable. That is why D-6 is the first recommendation. Separately, this review is **model-family-correlated** with the work it reviews, and the §2 precedent shows such a reviewer has already missed a real error in this programme once.

---

## 14. Final verification and ledger

| Check | Result |
|---|---|
| Investigation under review | **byte-identical** — `2be20d2d…6e2e`, 403 lines |
| `opportunityLifecycleService.ts`, `opportunityLifecycle.ts`, `strategicDashboardsService.ts`, `lifecycleReader.ts`, `lifecycleWriter.ts` | **unchanged** (§1 hashes) |
| Both lifecycle migrations and the initial-state migration | **unchanged** |
| `pi_lifecycle_b21.test.ts`, `ret_retention_pre_exclusion.test.ts`, the Phase 1 unit suite | **unchanged** |
| All prior reports | **unchanged** |
| HEAD | **`29fea38a…` unchanged** |
| Working tree | **161 → 162**; the only new entry is this review; **no pre-existing entry lost** |
| Commits / deployments | **none** |

| | |
|---|---|
| Start / end | **2026-10-19T09:02:05** → **09:22:40 +05:30 (IST)** |
| **Wall-clock** | **≈ 20 min 35 s** |
| **Machine time** | **≈ 13 min** — the delegated reviewer ran 12 min 50 s; my own verification greps ≈ 15 s. **No database, no test run** |
| **Active review effort** | **≈ 7 min** — briefing, verification of the reviewer's material claims, and this write-up |
| External waiting | **none** |
| Human engineer-days | not consumed by agent wall-clock; no substitution made |

---

## 15. Status

| Item | Status |
|---|---|
| Diagnosis in the investigation | **CONFIRMED, and understated** — 11 consumers not 8, and the durable `previous_state` write was missed |
| Recommendation (A-minimal as specified) | **NOT SUPPORTED** — four material defects, §7 |
| "No backfill" conclusion | **SUPPORTED** — the strongest part of the investigation |
| "Sequence order equals commit order" (repo's claim, repeated by the investigation) | **CONTRADICTED as written** — `INFERRED`, needs execution |
| "Mixed-version window is no worse than today" | **CONTRADICTED** |
| Deletion-eligibility consequence | **OVERSTATED** — zero callers, no account-deletion service |
| D-5 write race | **CONFIRMED — the live defect**, wider than the tie it is scoped apart from |
| Born-terminal, cross-tenant, duplicate reader | **CONFIRMED** |
| Technically preferred direction | **Option E + a re-specified A** — a recommendation, not a decision |
| This review's independence | **PARTIAL** — structurally separate agent, same model family, **no human review** |

**No implementation was performed and none is authorized. No owner decision is presumed or ratified. Phase 2 remains unauthorized, Q3 remains blocked unless verified policy evidence closes it, v0.3 remains unratified, and the frozen schedule baseline and overrun status are unchanged.**
