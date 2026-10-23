# PI-C1-ARCHITECTURE-BLOCKER-REVIEW-001 — D-1 / D-2 / D-3 architecture review

**DOCUMENTATION-ONLY.** No application code, test, schema, migration, configuration or runtime change. No database operation, production access or provider call. No commit, push, merge or deployment. **No controlling document was modified.** v0.1, v0.2, v0.3, the readiness report, the companion independent review and `PI-ADD-001-RATIFICATION-CLOSURE-002.md` are byte-unchanged.

**PI-ADD-001 v0.3 is NOT ratified. No owner decision is made here. Implementation authorization remains NONE. C-1a and C-1b remain unauthorized.**

---

## 0. Headline — two of my own three published findings are REFUTED

`PI-ADD-001-RATIFICATION-CLOSURE-002.md` §2 recorded D-1 and D-2 as **CONFIRMED** architectural defects. **Direct inspection of the migration shows both are wrong as stated.** The controlling document is left unedited, as required; this report carries the correction.

**What I missed:** I read the foreign keys and the application-layer `APPEND_ONLY_TARGETS` list, and never read past line 54 of the lifecycle migration. Lines **57–74** of `20260520_phase6_realtime_lifecycle_workflow.sql` define a **database trigger** that blocks `DELETE` and `UPDATE` on `opportunity_lifecycle_states` at row level.

| My published claim | Verified reality |
|---|---|
| **D-1:** retention hard-deletes the feed item → the cascade destroys lifecycle history → terminality becomes unprovable → the account is permanently undeletable | **REFUTED.** A `BEFORE DELETE … FOR EACH ROW` trigger raises on any delete of a lifecycle row. Under documented PostgreSQL semantics a referential cascade performs a real `DELETE` on the child and therefore fires it, aborting the parent delete. **History is not destroyed** |
| **D-2:** `lifecycle_history`'s append-only protection is bypassed via the parent cascade, so the adopted mechanism already contains the silent cascade FR-A37 forbids | **REFUTED for this table.** Protection is **not** application-layer-only — there is a database trigger, and the `APPEND_ONLY_TARGETS` entry is a redundant second layer. There is no silent cascade here: the delete **fails loudly** |
| **D-3:** non-signal-origin opportunities cannot hold a lifecycle state | **CONFIRMED and strengthened** (§3) |

**AD-1 was subsequently authorized and EXECUTED. Every claim below is now confirmed by execution against real PostgreSQL — see §17.**

**The inversion matters.** The defect is not that evidence is silently destroyed; it is that **deletion cannot proceed at all**. Same blast radius, opposite mechanism, and a completely different fix. Two consequences I had not seen fall out of it, and one is more serious than the original claim (§1.4, §1.5).

**The published register's severity ordering is therefore wrong**, and B8/B9 must be restated rather than closed. §7 reconciles this.

---

## 1. D-1 — terminality durability

### 1.1 Verified facts

| # | Fact | Source | Confidence |
|---|---|---|---|
| 1 | There is **no current-state column**. The migration states it outright: *"Append-only history of state transitions per opportunity_feed_item. The CURRENT state is derived from the most-recent (by transitioned_at) row. No 'current state' column on opportunity_feed_items"* | `supabase/migrations/20260520_phase6_realtime_lifecycle_workflow.sql:8-11` | **VERIFIED** |
| 2 | Current state is read as a single ordered row | `backend/services/opportunityLifecycleService.ts:84-97` — `.order('transitioned_at', {ascending:false}).limit(1).maybeSingle()`, returning `null` when no row exists | **VERIFIED** |
| 3 | Lifecycle rows have **three** cascade parents: `organization_id … REFERENCES companies(id) ON DELETE CASCADE`; `opportunity_feed_item_id … REFERENCES opportunity_feed_items(id) ON DELETE CASCADE`; and transitively `opportunity_feed_items.signal_id … REFERENCES lead_signals(id) ON DELETE CASCADE` | `20260520…:15-16`; `20260518_phase4_community_discovery_opportunities.sql:97` | **VERIFIED** |
| 4 | **A database trigger blocks DELETE and UPDATE on lifecycle rows**, raising `opportunity_lifecycle_states is append-only` | `20260520…:57-74` — function `trg_opp_lifecycle_block_mutation()`, triggers `opp_lifecycle_block_update` and `opp_lifecycle_block_delete`, both `BEFORE … FOR EACH ROW` | **VERIFIED (DDL read)** |
| 5 | No later migration drops or alters either trigger | only three migrations mention the table; the sole `DROP TRIGGER` statements are the idempotent guards at `:65` and `:70` in the defining migration | **VERIFIED** |
| 6 | `opportunity_feed_items` is a retention target whose only possible mode is hard delete | `backend/types/retention.ts:4, 57` — `soft_delete_column: null` | **VERIFIED** |
| 7 | **All ten** retention bindings have `soft_delete_column: null`, and the service's soft-delete branch mutates nothing: `detail = 'soft_delete_skipped_no_column'; status = 'partial'; rowsAffected = 0` | `retention.ts:55-65`; `backend/services/retentionService.ts:160-167` | **VERIFIED** |
| 8 | Retention deletes a **batch** in one statement — `.delete({count:'exact'}).in('id', ids)` with `MAX_DELETE_BATCH = 10_000` — and on error records `status='failed'`, `detail=delErr.message` without partial progress | `retentionService.ts:33, 142-158` | **VERIFIED** |
| 9 | When no lifecycle row exists, `transitionLifecycle` **silently defaults the current state to `detected`**: `const from: LifecycleState = current?.state ?? 'detected'` | `opportunityLifecycleService.ts:132-133` | **VERIFIED** |
| 10 | The initial `detected` row is written by a **separate call** from feed-item creation, guarded by a partial unique index | `opportunityLifecycleService.ts:42-80` (`initialiseLifecycleForOpportunity`, `reasoning: 'auto_init_from_signal_pipeline'`); `20260520…:48-51` (`uq_opp_lifecycle_initial … WHERE is_initial = TRUE`) | **VERIFIED** |
| 11 | **Zero tests** anywhere reference `opportunity_lifecycle_states`, `opportunityLifecycleService`, `transitionLifecycle` or `initialiseLifecycleForOpportunity` | repo-wide scan of `*.test.ts`/`*.test.tsx` excluding `node_modules` — empty result | **VERIFIED** |

### 1.2 The one inference, stated as an inference

**That a referential cascade fires a row-level `BEFORE DELETE` trigger on the child table** is documented PostgreSQL behaviour: `ON DELETE CASCADE` performs an actual `DELETE` on referencing rows rather than a silent storage-level removal.

- **Not executed here.** Database operations are prohibited by this brief.
- **Not covered by any test.** The nearest executed evidence is `backend/tests/realschema/pi_wsc_prospect_lifecycle.test.ts:217-224`, which proves a **direct** `DELETE` is refused with SQLSTATE `42501` on the *sibling* PI table — not the cascade case, and not this table.
- Status at the time of writing: **HIGH CONFIDENCE from documented semantics; UNVERIFIED BY EXECUTION.**
- **Status now: VERIFIED BY EXECUTION.** Probe P2 in §17 refused the parent delete with `P0001 :: opportunity_lifecycle_states is append-only`, leaving both the parent and the lifecycle row in place. The inference was correct.

The invariant analysis below was written to be correct either way; §17 records which way it went.

### 1.3 Is the published failure scenario reproducible? **NO, as written**

| Step as published | Outcome on the inspected design |
|---|---|
| 1. An opportunity reaches `archived` | Reachable. `archived` is accepted from every state |
| 2. Retention hard-deletes its parent feed item | **FAILS.** The cascade hits `opp_lifecycle_block_delete`, which raises; the transaction aborts |
| 3. Lifecycle history is deleted or unavailable | **Does not occur** |
| 4. The deletion gate cannot prove terminality | **Does not occur by this route** |
| 5. The account may remain undeletable | **Occurs — by a different mechanism** (§1.4) |

A further point the published report should have made: **the account-deletion gate does not exist.** `prospect_opportunities` appears in **no migration and no code** — only in four of my own documents. FR-A32/FR-A33/FR-A39/FR-A40 describe a gate that is entirely proposed, so no current behaviour can be attributed to it.

### 1.4 Real defect A — `opportunity_feed_items` retention is inoperable

Not a terminality defect; a **retention** defect, and it lands on Q3.

- The pipeline auto-initialises a `detected` row for every opportunity it creates (fact 10), so **substantially every feed item carries lifecycle history**.
- Hard delete is the only functional mode (facts 6–7), and it **aborts** for any such row.
- Deletion is batched (fact 8), so **one lifecycle-bearing row fails the whole batch of up to 10,000** — not just itself.
- Soft delete mutates nothing by construction.

**Consequence: there is no working retention path for `opportunity_feed_items` at all.** Signal-derived opportunity content — which carries third-party personal data — is retained indefinitely regardless of policy, and the failure surfaces only as a `retention_executions` row with `status='failed'`. **UNVERIFIED by execution**, confidence as §1.2.

### 1.5 Real defect B — tenant deletion is blocked by the append-only trigger

More serious than the published D-1, and it exists **today**, not only in the proposal.

`opportunity_lifecycle_states.organization_id REFERENCES companies(id) ON DELETE CASCADE` (fact 3) plus the delete-blocking trigger (fact 4) means **deleting a `companies` row raises** wherever any lifecycle row exists for that organization. The same shape exists on the PI ledger: `prospect_lifecycle_transitions.organization_id … ON DELETE CASCADE` (`20261028000000_pi_prospect_lifecycle_state.sql:110`) with its own `prospect_lifecycle_block_delete` (`:330-332`).

So an append-only audit guarantee and a cascade-deletable tenant row are **mutually exclusive as configured**. This bears directly on BR-A2, FR-A37 and any future tenant-offboarding or erasure path, and it is **not** a PI-ADD-001 requirement defect — it is a pre-existing property of the adopted mechanism. **UNVERIFIED by execution.**

### 1.6 Real defect C — the silent `detected` fallback

Fact 9 is a latent hazard independent of deletion. Feed-item creation and lifecycle initialisation are two separate calls (fact 10); if the second does not run or is rolled back, the opportunity has **no** lifecycle row and its state silently reads **`detected`** — the initial, maximally non-terminal value — with no error and no distinction from a genuinely new opportunity. Under FR-A39's fail-closed rule that reads as **unresolved**, blocking deletion.

With the trigger in place this cannot arise from deletion, so it is a narrower hazard than published — but it is real, **untested** (fact 11), and it is the specific line that would make my original D-1 true if the trigger inference is wrong. The safe reading is `null` ⇒ **unknown**, which FR-A39 already says must fail closed as non-terminal; silently substituting `detected` discards the distinction between *new* and *unknown*.

### 1.7 The invariant required

> **I-1 (terminality provable).** For every opportunity, its lifecycle state must be derivable for as long as the opportunity record exists, and the absence of lifecycle rows must be distinguishable from the initial state.

**Can existing mechanisms satisfy I-1 without schema change?** **Partially.** The trigger already preserves history against deletion, which is the hard part. What cannot be fixed without a change is the **anchor**: history is keyed to `opportunity_feed_items`, so a PI opportunity's state is only derivable while a Community feed item exists — and that record is a retention target. Replacing the `?? 'detected'` fallback with an explicit unknown is a **code** change, not a schema change, and is not authorized here.

---

## 2. D-2 — append-only protection versus cascade deletion

### 2.1 What the protection actually is

| Layer | Mechanism | Scope | Verified |
|---|---|---|---|
| **Database** | `opp_lifecycle_block_update`, `opp_lifecycle_block_delete` — `BEFORE UPDATE`/`BEFORE DELETE … FOR EACH ROW`, raising unconditionally | `opportunity_lifecycle_states` | `20260520…:57-74` |
| **Application** | `APPEND_ONLY_TARGETS = { 'lifecycle_history', 'moderation_decisions' }`, checked at exactly **two** throw sites | retention service only | `backend/types/retention.ts:69-72`; `retentionService.ts:52, 121` |

- Enforcement is **not** application-layer-only for the lifecycle table, and the `APPEND_ONLY_TARGETS` entry for `lifecycle_history` is **redundant** with the trigger.
- It protects against **direct mutation and, by documented semantics, parent-triggered cascades alike** — the trigger has no knowledge of what caused the delete.
- A parent delete therefore **cannot** remove lifecycle history. It fails instead.

### 2.2 The genuine application-layer-only gap is the *other* target

`moderation_decisions` has **no block trigger in any migration** — grep for a trigger on it returns nothing. Its append-only guarantee rests **solely** on the two `retentionService.ts` checks. Any other path — a cascade, an operator script, direct SQL, a different service — bypasses it silently. `opportunity_feed_items` likewise has no delete-blocking trigger.

So the published claim "a protection list does not guarantee database-level immutability" is **correct as a principle and correct for `moderation_decisions`**, and **wrong for the lifecycle table** it was asserted about.

### 2.3 FR-A37 versus FR-A40 — the conflict, restated precisely

The published conflict (FR-A37 forbids silent evidence cascades; the adopted mechanism contains one) **does not exist**. The real tension is the mirror image:

> **FR-A40** requires `converted` to transition to `archived` *"through the existing validated and audited lifecycle mechanism"* before qualifying as resolved. **FR-A32** refuses ordinary account deletion while non-terminal opportunities reference the account, *"atomically, with nothing partially deleted."* **AC-A24/AC-A32** require deletion to **succeed** once every referencing opportunity is terminal.
>
> But where lifecycle rows exist, **`companies` deletion raises** (§1.5) and **`opportunity_feed_items` deletion raises** (§1.4). Reaching `archived` does not make anything deletable, because the blocker is the append-only trigger, not the state.

**Smallest precise statement of the conflict:**

> **FR-A37's append-only evidence guarantee and AC-A24/AC-A32's requirement that deletion succeed cannot both hold while lifecycle history is reachable by a cascade from the record being deleted.** One of three things must give: the evidence must survive deletion in a form not reachable by that cascade; the cascade must be removed in favour of an explicit governed path; or "deletion" must mean something other than removing the parent row.

**This is an owner decision.** FR-A37 is an approved requirement and is **not** rewritten or weakened here. Note the direction of safety: the mechanism currently fails **towards preserving evidence**, which is the conservative failure and is consistent with FR-A37's intent.

### 2.4 Consequences for FR-A46, AC-A42 and NC-A19 — a decision may be moot

| Item | Exact wording | Consequence |
|---|---|---|
| **FR-A46** | *"`detection_ref` **may become unresolvable** … This is a documented limitation and acceptance decision, not a defect to be fixed by adding a foreign key"* | Its **premise may be false** for any feed item carrying lifecycle history, because that row cannot be deleted |
| **AC-A42** | *"When the referenced `opportunity_feed_items` row no longer exists, the opportunity still returns its `detected_reason` verbatim…"* | The precondition may be **unreachable** for lifecycle-bearing feed items |
| **NC-A19** | *"Hard-delete the referenced detection row, then read the opportunity"* | The control's **first step may be unexecutable** — the delete raises |

All three remain reachable **only** for feed items with no lifecycle rows (§1.6). The owner was asked in `PI-ADD-001-RATIFICATION-CLOSURE-002.md` §6.3 to accept or mitigate FR-A46; **that request should be re-scoped**, since what is being accepted may not be able to occur. Marked **UNVERIFIED by execution** on the same inference as §1.2.

### 2.5 The invariant required

> **I-2 (evidence survives, loudly).** A parent retention or deletion action must not remove protected lifecycle evidence, and must not fail opaquely. Either the action is refused with an attributable reason, or the evidence is preserved outside the cascade and the action proceeds.

Today's behaviour satisfies the first half and fails the second: the refusal surfaces only as a failed `retention_executions` row carrying a trigger message, with the deleted-row count silently zero.

---

## 3. D-3 — non-signal-origin opportunities — **CONFIRMED**

### 3.1 Verified facts

| # | Fact | Source |
|---|---|---|
| 1 | `signal_id UUID NOT NULL REFERENCES lead_signals(id) ON DELETE CASCADE` | `20260518_phase4…:97` |
| 2 | `CONSTRAINT opportunity_feed_items_signal_unique UNIQUE (organization_id, signal_id)` | `:113` |
| 3 | The lifecycle anchor is `opportunity_feed_item_id UUID NOT NULL` | `20260520…:16` |
| 4 | The **sole** production creator is `recordOpportunityFromSignal`, documented as *"pipeline writer. Called by the Phase 3 listeningSignalPipeline immediately after a successful writeLeadSignal"*, requiring `input.signalId` and idempotent on `(organization_id, signal_id)` | `backend/services/opportunityFeedService.ts:1-22, 385-394, 488-500` |
| 5 | Every other application reference to the table is a **read**; the only other write is an operator backfill script | repo-wide scan; `scripts/operator/db/backfill-active-leads.ts:155, 269` |
| 6 | Lifecycle initialisation is likewise signal-sourced — `reasoning: 'auto_init_from_signal_pipeline'` | `opportunityLifecycleService.ts:62` |
| 7 | **The PI identity tree contains zero references to "opportunit"** — `backend/services/prospectIdentity/**` | case-insensitive scan, empty |
| 8 | **The PI intake tree contains zero references to "opportunit"** — `backend/services/leadIngestion/**`, including `manualAdapter.ts`, `csvAdapter.ts`, `crmAdapter.ts` | case-insensitive scan, empty |

### 3.2 Conclusion

**Manual- and CRM-origin opportunities can neither be created nor reach any lifecycle state.** The restriction is **both** a schema restriction and absent adapter behaviour, and the second is the larger half:

- **Schema:** `signal_id NOT NULL` makes a signal-less feed item unrepresentable, and `UNIQUE (organization_id, signal_id)` makes FR-A9's *"one or more supporting signals, accumulating over time"* unrepresentable too — one feed item per signal, not many signals per opportunity.
- **Adapters:** manual, CSV and CRM intake have **no opportunity concept whatsoever** (facts 7–8). Even with a nullable `signal_id` nothing would create the row. FR-A5's four `need_source` values — classified signal, company event, manual entry, CRM import — have exactly **one** implemented producer.

**Directly contradicted requirements:** FR-A5 (four origins), FR-A9 (signal accumulation), FR-A32/FR-A39 (terminality for *every* referencing opportunity — unreachable for three of four origins).

No nullable field, alternative key, placeholder signal or synthetic source record is implemented or proposed as a fix; options are at §C.

### 3.3 The invariant required

> **I-3 (universal lifecycle path).** Every supported opportunity intake source must have a creation path and a lifecycle anchor that does not depend on a Community Discovery signal record.

---

## 4. A material mechanism not accounted for in any prior report

**`supabase/migrations/20261028000000_pi_prospect_lifecycle_state.sql` — the PI prospect lifecycle transition ledger.** It is implemented in code (`backend/services/prospectLifecycle/lifecycleWriter.ts`, `lifecycleReader.ts`) and **exercised against real PostgreSQL** (`backend/tests/realschema/pi_wsc_prospect_lifecycle.test.ts`, whose header states *"EXECUTED. This suite runs, and passes, against real PostgreSQL"* — **I did not run it in this task**).

| Property | Value | Source |
|---|---|---|
| Anchor | `canonical_leads (id, company_id)` via composite tenant FK, `ON DELETE CASCADE` | `:158` |
| Vocabulary | **7 states** in a database CHECK: `identified, qualified, engaged, nurture, meeting_scheduled, not_interested, closed_disqualified` | `:175-178` |
| Current state | derived from the greatest `seq`; *"There is no 'current state' column anywhere, so no second authority can drift from it"* | `:7-9, 256, 365` |
| Append-only | `prospect_lifecycle_block_update` / `block_delete`, `BEFORE … FOR EACH ROW` | `:324-332` |
| Chain integrity | `prospect_lifecycle_chain` on `BEFORE INSERT` refuses a `previous_state` that is not the current state, with a row lock serialising writers | `:277-316, 334-336` |
| Evidence refs | typed FKs, `ON DELETE RESTRICT` to `outreach_outcomes` and `source_records` | `:164, 168` |
| Apply status | header says *"AUTHORED, NOT APPLIED"*; production apply state **UNVERIFIED** (prohibited) | `:3` |

**Why this changes the options.** It is a proven template for exactly the problem D-1/D-3 pose — an append-only ledger with no drift-prone current-state column, anchored to a **PI** entity rather than a Community signal, with `RESTRICT` rather than `CASCADE` on its evidence references.

**It is not a drop-in answer.** It governs a **prospect** (`canonical_leads`), and an opportunity is a different entity — PI-ADR-003 is cited in that migration for precisely this distinction. Its vocabulary is 7 PI states, not the 9 the owner approved under Q1-1. **Conflating the two would introduce a second lifecycle authority over the same entity**, which BR-A5 and FR-A19's single-authority discipline forbid. Its value here is as a **shape**, and as evidence that the shape is buildable and testable in this repository.

---

## 5. Required invariants

| ID | Invariant | Status today |
|---|---|---|
| **I-1** | Terminality must remain provable after retention processing, and absent history must be distinguishable from the initial state | **PARTLY MET** — history is protected; the anchor is a retention target and absence silently reads `detected` |
| **I-2** | A parent retention action must not silently violate the append-only evidence invariant | **MET in substance, FAILS in observability** — refused, but opaquely |
| **I-3** | Every supported intake source must have a valid lifecycle path | **NOT MET** — signal origin only |
| **I-4** | Account deletion must follow the owner-approved resolution rule (FR-A38/FR-A39, `archived` sole terminal, unknown fails closed) | **NOT IMPLEMENTED** — no gate exists; `prospect_opportunities` is in no migration |
| **I-5** | Person erasure and tenant isolation boundaries must remain intact | **UNVERIFIED / BLOCKED** — `erasePerson` has no production caller and does not handle the `lead_intelligence` `RESTRICT` FK; unchanged by this review |
| **I-6** | No undocumented legal-retention policy may be invented | **HELD** — none invented here; §7 preserves Q3 as BLOCKED |
| **I-7** | *(new)* An append-only audit table must not be reachable by a cascade from a record the product intends to delete | **NOT MET** — three cascade parents on the Community ledger, one on the PI ledger (§1.5) |

---

## 6. Competing options

**None of these is implemented, authorized or recommended as a decision.** Options requiring a retention or legal policy are marked **BLOCKED BY Q3**.

### 6.1 D-1 — terminality durability

| | **Option 1-A — anchor the lifecycle to the PI opportunity** | **Option 1-B — make absence explicit, keep the anchor** | **Option 1-C — exclude the anchor from retention** |
|---|---|---|---|
| Shape | New append-only ledger keyed to the PI opportunity, following the §4 template; `detection_ref` stays a soft pointer | Keep `opportunity_lifecycle_states`; replace the `?? 'detected'` fallback with an explicit unknown that fails closed per FR-A39 | Remove `opportunity_feed_items` from `RETENTION_TARGETS`, or bind it to a real soft-delete column |
| Requirement consistency | High — satisfies FR-A5/FR-A9/FR-A32/FR-A39; needs FR-A40 amended, since "the existing validated mechanism" would no longer be the Community one | Medium — preserves FR-A40 verbatim; leaves FR-A5/FR-A9 unsatisfied | Low — does not address FR-A5/FR-A9 at all |
| Terminality durability | **Strong** — no Community cascade in the path | Medium — history still cascade-anchored | Medium — depends on policy holding |
| Append-only / evidence | Strong, if built with the §4 triggers and `RESTRICT` evidence FKs | Unchanged | Unchanged |
| Manual/CRM + signal origin | **Both supported** | Signal only | Signal only |
| Account deletion / erasure | Clean: the gate reads one PI table | Workable | Workable |
| Tenant isolation | Composite tenant FK, as §4 | Unchanged | Unchanged |
| Migration / backfill | **Highest** — new table, RLS, triggers, indexes; backfill of existing opportunities is a policy question, so **BLOCKED BY Q3** for historical rows | **None** (code only) | Config only, but a retention change **BLOCKED BY Q3** |
| Rollback | Additive, so droppable while unused | Trivial | Trivial |
| Testability | Strong — §4's suite is a working precedent | Strong | Weak — proving a negative |
| Operational / schedule risk | Material; largest of the three | **Lowest** | Low, but leaves the main defects open |

### 6.2 D-2 — append-only versus cascade

| | **Option 2-A — refuse loudly and attributably** | **Option 2-B — replace cascade with RESTRICT and a governed path** |
|---|---|---|
| Shape | Keep the trigger. Make retention **detect** protected children, skip those parents, and report them per item instead of failing a 10,000-row batch on a trigger message | Change the lifecycle FKs from `CASCADE` to `RESTRICT`, and require an explicit governed archival step before any parent may be removed |
| Requirement consistency | Preserves FR-A37 exactly; does not satisfy AC-A24/AC-A32 where a cascade still blocks | Resolves §2.3 at its root; FR-A40's "existing mechanism" wording likely needs amendment |
| Evidence preservation | Strong | Strong |
| Deletion / erasure | **Deletion still blocked** — makes the block visible, not absent | Deletion becomes possible **only** via the governed path, which is what FR-A33 asks for |
| Migration | Code only | Schema change on three FKs + a new governed path |
| Rollback | Trivial | Hard once data depends on it |
| Testability | Good | Good |
| Risk | Low | Medium–high |
| Q3 | Clear | **BLOCKED BY Q3** — what may be removed on tenant offboarding is a policy question |

### 6.3 D-3 — non-signal-origin opportunities

| | **Option 3-A — PI-anchored opportunity ledger** (= 1-A) | **Option 3-B — relax the Community schema** | **Option 3-C — narrow the scope to signal origin** |
|---|---|---|---|
| Shape | As §6.1 Option 1-A | Make `signal_id` nullable, replace the unique constraint, add a signals join table for FR-A9, and teach all three adapters to create opportunities | Amend FR-A5/FR-A9 so only classified-signal origin is in scope for C-1 |
| Requirement consistency | High | High if completed | **Requires explicit owner amendment** of two approved requirements |
| Scope honesty | Full | Full | Narrow but **truthful** |
| Writes to Community records | **None** — satisfies AC-A27 and BR-A5 | **Violates AC-A27/BR-A5** — PI would write Community schema and rows | None |
| Migration | New table | Schema change to a Phase-4 table plus a new join table; backfill implications | None |
| Risk | Material | **Highest** — crosses the one-way boundary the programme exists to keep | Lowest |
| Verdict | credible | **not recommended** — see §8 | credible as a scope decision |

### 6.4 Combined option — **C-COMB**

The three defects interact, so isolated fixes are partly unsafe: fixing D-3 by Option 3-B would **worsen** D-1 and D-2 by putting more PI data behind Community cascades; fixing D-1 by Option 1-C alone leaves D-3 untouched.

> **C-COMB = Option 1-A + Option 2-A + Option 3-A**, sequenced: (i) the observability fix (2-A, code only, no policy dependency); (ii) the explicit-unknown fix (1-B, code only — adopted *inside* C-COMB because it costs almost nothing and removes the §1.6 hazard regardless of anchor); (iii) the PI-anchored opportunity ledger (1-A/3-A), new rows only, **no historical backfill**, which keeps the whole combination clear of Q3.

Deferred from C-COMB: Option 2-B's FK change and any retention-policy change — **both BLOCKED BY Q3**.

---

## 7. Requirement conflict map

| Requirement | Exact wording (abridged) | D-1 | D-2 | D-3 | Affected by | Needs explicit owner amendment? |
|---|---|---|---|---|---|---|
| **BR-A2** | *"preserve **why it was identified**, for as long as the opportunity exists"* | ✓ | ✓ | | 1-A, 2-A | No — satisfied better by 1-A |
| **BR-A5** | *"PI shall be the authority on identity, permission, qualification and lifecycle"* | ✓ | | ✓ | 1-A, **3-B violates** | No |
| **FR-A5** | four `need_source` values incl. *"manual entry and CRM import"* | | | ✓ | 1-A/3-A, **3-C narrows** | **Yes, if 3-C** |
| **FR-A9** | *"one or more supporting signals, accumulating over time"* | | | ✓ | 1-A/3-A, **3-C narrows** | **Yes, if 3-C** |
| **FR-A10** | *"retain the detection reason verbatim, and a reference to the originating detection record"* | ✓ | ✓ | | 1-A | No |
| **FR-A32** | ordinary deletion *"refused while non-terminal opportunities reference the account, atomically"* | ✓ | ✓ | ✓ | all | No |
| **FR-A33** | *"a **governed resolution path** … Without it, FR-A32 would make an account permanently undeletable"* | ✓ | ✓ | | 2-B especially | No — **vindicated** by §1.5 |
| **FR-A37** | *"**never** be implemented as a silent cascade of evidence"* | | ✓ | | 2-A, 2-B | **No — and NOT weakened here.** The published claim that it is already violated is **withdrawn** |
| **FR-A38/39** | `archived` sole terminal; all others incl. unknown **fail closed** | ✓ | | ✓ | 1-B directly | No — §1.6 shows the code does **not** honour FR-A39's unknown rule |
| **FR-A40** | *"through the existing validated and audited lifecycle mechanism… the allowed-transition mechanism is not bypassed"* | ✓ | ✓ | | **1-A and 2-B both strain it** | **Yes, under 1-A/3-A** — the anchor would no longer be the "existing" mechanism |
| **FR-A41** | approved state meanings | | | | 1-A (7 PI states ≠ 9 approved) | **Yes, if the PI vocabulary were adopted** |
| **FR-A42** | bulk resolution only as transition-to-`archived`, per-item outcomes | ✓ | ✓ | | 2-A per-item reporting aligns well | No |
| **FR-A46** | *"`detection_ref` **may become unresolvable**"* | | ✓ | | §2.4 — **premise may be false** | **Yes — re-scope the acceptance request** |
| **AC-A24/32** | deletion **succeeds** once all referencing opportunities are terminal | ✓ | ✓ | ✓ | §2.3 core conflict | **Yes — cannot hold with FR-A37 as configured** |
| **AC-A27** | *"PI performs **no write** to any Community Discovery record"* | | | ✓ | **3-B violates** | No |
| **AC-A42 / NC-A19** | read after the detection row is gone / hard-delete it then read | | ✓ | | §2.4 — **may be unreachable/unexecutable** | **Yes — restate or mark conditional** |
| **AC-A43** | resolution uses the enforced transition path | ✓ | | | 1-A changes which path | No |

---

## 8. Recommendation

A recommendation is **not** an owner decision and **not** implementation authorization.

**Technically preferred: C-COMB (§6.4), in its stated sequence.** Reasons, in order of weight:

1. **The cheap fixes are also the most certain.** Steps (i) and (ii) are code-only, need no policy, no schema and no migration, and remove the two defects whose evidence is strongest — opaque retention failure and the silent `detected` substitution. Step (ii) additionally makes the code honour **FR-A39's own fail-closed rule**, which it currently does not.
2. **Only a PI-anchored ledger satisfies I-3.** D-3 is confirmed on schema *and* on the total absence of adapter behaviour; no amount of Community-side relaxation fixes the second half without crossing the boundary AC-A27 forbids.
3. **The shape is already proven here.** §4's ledger is implemented and exercised against real PostgreSQL, so the design risk is far lower than a novel mechanism.
4. **It stays clear of Q3** by covering new rows only and proposing no retention or backfill change.

**Not recommended: Option 3-B.** It would have PI write Community Discovery schema and rows, contradicting AC-A27 and BR-A5 — the one-way boundary this programme exists to preserve.

**Blocked by policy, not by engineering:** any retention-configuration change (Option 1-C), the `CASCADE`→`RESTRICT` change and governed tenant-offboarding path (Option 2-B), and **any historical backfill** of lifecycle state for existing opportunities.

**Cannot be decided until Q3 resolves:** what may be removed on tenant offboarding; whether indefinite retention of signal-derived personal data (§1.4) is acceptable in the interim; and the FR-A34/FR-A36 erasure path.

**Requires explicit owner amendment under the preferred option:** FR-A40 (anchor wording), FR-A46/AC-A42/NC-A19 (re-scope, §2.4), and AC-A24/AC-A32 versus FR-A37 (§2.3). Under Option 3-C instead: FR-A5 and FR-A9.

---

## 9. Correction of the semantic-review findings

The earlier scan word-boundary-matched the five withdrawn state names, so it caught `closed` in "auto-closed" — where the inflection equals the state name — and **missed the stem in "auto-disqualify."** Both scans were re-executed over the 78 UNCHANGED items.

| Scan | Items flagged |
|---|---|
| Old, word-boundary | **3** — `FR-A13`, `AC-A11`, `AC-A13` |
| New, stem-aware (`disqualif`, `clos`, `supersed`, `acted`/`acting`, `open`) | **5** — the above plus `FR-A12` and `FR-A28` |

**Contextual review, which the stem scan cannot replace:**

| Item | Lexical hit | Genuine conflict? |
|---|---|---|
| `AC-A11` | `disqualif`, `open` | **YES** — two withdrawn names, and it conflates the lifecycle and evaluation axes |
| `FR-A12` | `disqualif` | **YES** — "auto-disqualify" denotes a transition to a rejection state |
| `FR-A13` | `clos` | **YES** — "auto-closed" denotes a lifecycle transition |
| `AC-A13` | `clos` | **YES** — same |
| `FR-A28` | `acting` | **NO — LEXICAL ONLY.** *"step-up as the baseline for **acting on** an opportunity"* is ordinary English for performing an action, not the withdrawn state `acted` |

**Corrected count: 4 genuine (`AC-A11`, `FR-A12`, `FR-A13`, `AC-A13`), 1 lexical-only false positive.** The count published in `PI-ADD-001-RATIFICATION-CLOSURE-002.md` §2.1 — four — is **unchanged and correct**; what is new is that the method is now characterised in **both** directions: the old scan under-flagged, and the stem scan over-flags.

### 9.1 Proposed wording — **ALL PENDING OWNER APPROVAL**

The `closed`→`archived` substitution is **withdrawn and not reinstated**: under FR-A38 `archived` is the sole terminal state for deletion eligibility, so auto-archiving stale opportunities would make them deletion-eligible and destroy FR-A13's stated intent that *"recurrence remains visible."* No proposal below names a state.

| Item | Before (verbatim) | Proposed after |
|---|---|---|
| **FR-A12** | *"Contradictory signals shall **lower confidence** and shall **retain both signals**. Evidence shall never be silently overwritten or deleted, and a contradiction shall not auto-disqualify an opportunity"* | *"…and a contradiction shall not by itself cause an opportunity to be `dismissed`, nor trigger any automatic lifecycle transition."* |
| **FR-A13** | *"Staleness shall be **reported**, not auto-closed, so recurrence remains visible"* | *"Staleness shall be **reported** and shall trigger **no automatic lifecycle transition**, so recurrence remains visible."* |
| **AC-A13** | *"A stale opportunity is reported stale and is **not** auto-closed"* | *"A stale opportunity is reported stale and **no automatic lifecycle transition occurs**; its state is unchanged by staleness alone."* |
| **AC-A11** | *"An opportunity with no evaluation reads **open**, never disqualified"* | **Option A (recommended):** *"An opportunity with no recorded evaluation reads `unevaluated` on the evaluation axis and is never `dismissed` on that basis; its lifecycle state is unaffected by the absence of an evaluation."* **Option B:** designate a lifecycle state explicitly |
| **FR-A28** | — | **No change proposed.** Lexical match only |

`AC-A11` remains an **owner decision**, not a clarification: FR-A41's approved meanings cover `triaged`, `reviewing` and `monitoring` and do not extend to `detected`. Option A invents nothing — `ScoreState = 'scored' | 'abstained' | 'unevaluated'` already exists at `backend/apiHandlers/prospects/prospectIntelligenceRead.ts:158`.

---

## 10. Reconciled ratification blocker register

Starting point: `PI-ADD-001-RATIFICATION-CLOSURE-002.md` §3. **No blocker is closed by this report.** Two are **restated** because the published finding was wrong, which is a change of content, not a closure.

| # | Blocker | Prior status | Status now | Change |
|---|---|---|---|---|
| **B1** | Q3 legal-erasure / retention policy | BLOCKED | **BLOCKED** | **Unchanged and preserved.** 11 scopes already searched, including git history across all refs; no policy, no approval evidence, **no accountable owner evidenced**. Not re-searched — no new reason. **Aggravated** by §1.4: signal-derived personal data is retained indefinitely because retention cannot execute |
| **B2** | `AC-A43` / `NC-A20` owner intent | PENDING OWNER DECISION | **PENDING OWNER DECISION** | Unchanged. `AC-A43` remains the only AC tracing FR-A33; `NC-A20` the only NC covering AC-A40 |
| **B3** | Withdrawn lifecycle vocabulary | PENDING OWNER DECISION | **PENDING OWNER DECISION** | Count confirmed at **4**; method now characterised in both directions (§9); `FR-A28` cleared as lexical-only |
| **B4** | `FR-A46` / `detection_ref` | PENDING OWNER DECISION | **PENDING OWNER DECISION — RE-SCOPED** | §2.4: the **premise may be false**; `AC-A42`/`NC-A19` may be unreachable/unexecutable. The acceptance question must be restated before it can be answered |
| **B5** | Independent review | PARTIALLY SATISFIED / PENDING | **PARTIALLY SATISFIED / PENDING** | §11. **No human review has occurred.** Reinforced: the separate-agent review **confirmed** my wrong D-1/D-2 rather than catching them |
| **B6** | `FR-A29` Q4 catalogue | PENDING OWNER DECISION | **PENDING OWNER DECISION** | Unchanged. Blocks a later package, not C-1 |
| **B7** | `FR-A36` / `AC-A25` erasure path | UNVERIFIED / BLOCKED on B1 | **UNVERIFIED / BLOCKED on B1** | Unchanged — not re-examined here. I-5 preserved |
| **B8** | Terminality durability | PENDING OWNER DECISION (as "not durable") | **RESTATED — PENDING OWNER DECISION** | **The published mechanism is REFUTED** (§0, §1.3). Replaced by three verified defects: inoperable retention (§1.4), **tenant deletion blocked by the trigger** (§1.5), and the silent `detected` fallback (§1.6) |
| **B9** | Append-only bypassed by cascade | PENDING OWNER DECISION | **RESTATED — PENDING OWNER DECISION** | **REFUTED for the lifecycle table** — a DB trigger exists (§2.1). The app-layer-only gap is real for **`moderation_decisions`** (§2.2). The FR-A37/FR-A40 conflict is **inverted** (§2.3) |
| **B10** | Non-signal-origin opportunities | PENDING OWNER DECISION | **CONFIRMED — PENDING OWNER DECISION** | **Strengthened**: zero opportunity references in the PI identity *and* intake trees; FR-A9 also unrepresentable |
| **B11–B18** | Qualification authority, boundary scoping, `AC-A14`, `AC-A17`, `FR-A10`, `FR-A33` verb, `FR-A35`, "Verified: YES" | PENDING / UNVERIFIED | **Unchanged** | Not re-examined; carried forward as recorded. `FR-A33`'s rationale is **vindicated** by §1.5 |
| **B19** | *(new)* `moderation_decisions` append-only is application-layer only, with no DB trigger | — | **NEW — PENDING OWNER DECISION** | §2.2 |
| **B20** | *(new)* Lifecycle mechanism has **zero** test coverage | — | **NEW — PENDING OWNER DECISION** | §1.1 fact 11 — the adopted mechanism is untested, which is why §0's error survived three reports. §17 now supplies executed evidence but **adds no test to the repository** |
| **B21** | *(new)* The two append-only guards raise **different SQLSTATEs** — `P0001` (Community) versus `42501` (PI) | — | **NEW — PENDING OWNER DECISION** | §17.3. A handler keying on one will not catch the other; this directly affects Option 2-A |

**Closed: nothing.** **Verdict unchanged: v0.3 is NOT ratification-ready.**

---

## 11. Independence — what was achieved and what is missing

| | |
|---|---|
| Achieved | A **structurally separate agent instance** with no authoring context reviewed all 78 items, derived the set with its own parser, read the authoritative schema, surfaced 15 non-PASS items and corrected two of my claims |
| **Not achieved** | **Human review. None has occurred, none is simulated, and none is claimed** |
| **New evidence of the limitation's cost** | The separate-agent review **agreed with my D-1 and D-2**, and both were wrong. Correlated review confirmed a shared error that one migration file settles. This is concrete evidence that model-family-correlated review is **not** a substitute |
| Status | **PARTIALLY SATISFIED / PENDING** |

Handoff packet: `PI-ADD-001-RATIFICATION-CLOSURE-002.md` §8.1, **plus this report**, and specifically: *read `20260520_phase6_realtime_lifecycle_workflow.sql` in full, lines 1–95, before assessing any claim about lifecycle deletion.*

---

## 12. Test and migration implications

**Nothing below was implemented or run. No test is claimed to pass.** No broad or expensive suite was executed for this documentation-only work.

### 12.1 The one test that settles §1.2

> **Against the disposable harness only:** create a feed item, initialise its lifecycle row, then attempt `DELETE FROM opportunity_feed_items WHERE id = $1` and assert the outcome. If it raises, §0's correction stands and my original D-1 is wrong. If it succeeds and the lifecycle rows are gone, **the original D-1 is right and this report's §1.3 is wrong.**

This is the highest-value unit of verification available and it is **not authorized here**.

### 12.2 Negative controls required (none exist today)

| # | Control | Expected | Note |
|---|---|---|---|
| 1 | Retention after archival — run a hard-delete policy over a lifecycle-bearing feed item | Refused **attributably**, per item, not as a 10,000-row batch failure | §1.4 |
| 2 | Direct `UPDATE`/`DELETE` on `opportunity_lifecycle_states` | Refused by trigger | **No test exists** — the PI sibling has one, this table has none |
| 3 | Cascade delete from `companies` and from `lead_signals` | Refused by trigger | §1.5 — **untested in both systems** |
| 4 | Manual/CRM opportunity without a signal id | Creation path exists and reaches a lifecycle state | Fails today by construction |
| 5 | Multiple supporting signals on one opportunity | Accepted | Unrepresentable today (FR-A9) |
| 6 | Account deletion with unresolved opportunities | Refused atomically, nothing partially deleted | Gate does not exist |
| 7 | Account deletion with every opportunity `archived` | Succeeds | **Expected to fail today** — §1.5 |
| 8 | Lifecycle read with **no** history rows | Reads **unknown**, fails closed per FR-A39 | Reads `detected` today |
| 9 | Cross-tenant lifecycle read/transition/delete | Refused | Composite tenant FK + RLS; service role bypasses RLS, so isolation rests on application logic |
| 10 | Person erasure under the approved policy | Per policy | **BLOCKED BY Q3** |
| 11 | Retry / already-`archived` transition | `archived → archived` is **refused**: `archived: []`, and `transitionLifecycle` throws rather than returning `no_op_same_state` | A retry after a successful transition **errors**; bulk per-item outcomes (FR-A42) must tolerate it |

### 12.3 Migration checks, if an option is later authorized

Additive-only; no edit to Phase-4 or Phase-6 tables; RLS declared in the same migration (Supabase grants `ALL` on new public tables to `authenticated`, so an un-RLS'd table is served cross-tenant); composite tenant FKs; `RESTRICT` on evidence references; partial unique indexes kept partial; vocabulary CHECK in the database, not only TypeScript; **no historical backfill**; and the harness replay caveat — a green disposable run is **never** evidence that a migration is applied in production.

---

## 13. Decision register

| ID | Question | Options | Consequence if not taken | Evidence required | Owner | Status | Implementation depends on it? |
|---|---|---|---|---|---|---|---|
| **AD-1** | Is the §1.2 cascade-versus-trigger inference correct? | Run §12.1 in the disposable harness / accept the documented-semantics reading / treat as unknown | D-1's mechanism stays ambiguous and the fix cannot be chosen | One harness test — **not authorized here** | *(verification task, not a policy owner)* | **UNVERIFIED** | **YES — blocks the choice between 1-A/1-B/1-C** |
| **AD-2** | How is terminality made durable? | 1-A / 1-B / 1-C / C-COMB | FR-A32/AC-A24/AC-A32 unsatisfiable | AD-1 | Programme owner | **PENDING** | **YES** |
| **AD-3** | FR-A37 versus AC-A24/AC-A32 (§2.3) — which gives? | Preserve evidence outside the cascade / remove the cascade for a governed path / redefine "deletion" | The two cannot both hold; deletion stays blocked | AD-1 + Q3 for offboarding | Programme owner | **PENDING** | **YES** |
| **AD-4** | Are manual/CRM-origin opportunities in scope for C-1? | 3-A (support) / 3-C (narrow, amending FR-A5 + FR-A9) / 3-B (**not recommended**) | FR-A5/FR-A9 unratifiable | None — decision is scope | Programme owner | **PENDING** | **YES** |
| **AD-5** | Adopt the observability fix (2-A) and explicit-unknown fix (1-B) independently? | Yes / bundle / no | Retention fails opaquely; absent history reads `detected` | None — both code-only | Programme owner | **PENDING** | Independent; **no policy dependency** |
| **AD-6** | Re-scope the FR-A46 acceptance request (§2.4) | Restate as conditional / withdraw / keep as written | The owner is asked to accept a limitation that may be unreachable | AD-1 | Programme owner | **PENDING** | No — documentation |
| **AD-7** | Approve the §9.1 wording, and designate `AC-A11`'s axis or state | Option A / Option B / other | Four criteria cite withdrawn names; `AC-A11` untestable | None | Programme owner | **PENDING** | No |
| **AD-8** | Give `moderation_decisions` database-level append-only protection? | Add a trigger / accept app-layer only / remove from the list | A silent bypass remains possible | None | Programme owner | **PENDING** | No |
| **AD-9** | Require test coverage for the lifecycle mechanism before C-1 builds on it | Yes / no | An untested mechanism carries the spine; §0's error is the precedent | None | Programme owner | **PENDING** | Recommended before **YES** items |
| **AD-10** | Q3 legal-erasure / retention policy | Supply or identify it | Ratification blocked; §1.4 unresolved | The policy + approval evidence + accountable authority | **NOT EVIDENCED** — none named in any accessible source | **BLOCKED** | **YES**, for FR-A34/FR-A36 |
| **AD-11** | Nominate a human independent reviewer | Yes / accept current level | Review gate unclosed; §11 shows the cost | A reviewer outside this system | Programme owner | **PENDING** | No |

**No accountable owner is invented.** AD-10's owner is recorded as not evidenced, consistent with the preserved Q3 finding.

---

## 14. Schedule — forecast only, no baseline change

### 14.1 Frozen baselines — preserved, unchanged

| Item | Frozen | Changed? |
|---|---|---|
| Milestone A′ deadline | **2026-11-25** | **NO** |
| Milestone A′ baseline | **28.5 human engineer-days** | **NO** |
| WP-7 baseline | **2026-11-17, 4.0 human engineer-days** | **NO** |
| C-1 estimate | **8–12 human engineer-days** | **NO — not revised** |
| **OVERRUN RISK** | **RAISED; zero float at the high C-1 estimate** | **unchanged** |
| Next checkpoint | **Friday, 2026-10-23** | **unchanged** |

No float is claimed recovered, no deadline extended, no recovery option applied. Agent wall-clock is **not** treated as equivalent to human engineer-days.

### 14.2 Incremental forecast per option — scenarios, not estimates of record

Ranges are **incremental human engineer-days on top of** the frozen 8–12 day C-1 estimate. Assumptions: one sequential owner, so nothing runs in parallel and no package has independent float; no historical backfill; the disposable harness remains available.

| Scenario | Incremental | Dependencies | What would narrow it |
|---|---|---|---|
| **AD-1 verification** (§12.1) | **0.25–0.5** | authorization only | — |
| **S1 — 2-A + 1-B only** (AD-5) | **1.0–2.0** | none; no policy | Whether per-item retention reporting needs a schema column for the skip reason |
| **S2 — C-COMB** (preferred) | **4.0–7.0** | AD-1, AD-2, AD-4; FR-A40 amendment | AD-1's outcome; whether the §4 ledger can be followed closely or needs rework for the 9-state vocabulary |
| **S3 — Option 3-B** | **6.0–10.0** | AD-4; **AC-A27/BR-A5 conflict** | Not recommended; range wide because boundary violation may force redesign |
| **S4 — Option 2-B** (FK change + governed path) | **3.0–5.0** | **BLOCKED BY Q3** | Q3 resolution |
| **S5 — 3-C scope narrowing** | **0.5–1.0** (documentation + amendments) | AD-4 | Owner's amendment decision |

### 14.3 Risk assessment — **flagged immediately**

**No baseline is changed and no estimate is revised.** On the best evidence available:

- The preferred scenario **S2** adds **4.0–7.0 engineer-days** to a C-1 estimate of 8–12 days that **already has zero float at its high end**. On that arithmetic a C-1 of 12 + 7 = **19 engineer-days against a plan with no slack is an overrun**, and even the low pairing (8 + 4 = 12) consumes the float that the high estimate does not have.
- **This is a forecast, not a revision.** The decision to re-baseline, de-scope or accept the overrun is the owner's.
- **S1 is the one scenario that is both cheap and unblocked** — 1.0–2.0 days, code-only, no policy dependency — and it removes the two defects whose evidence is strongest. It does **not** resolve D-3.
- **The cheapest risk-reducing action is AD-1** (0.25–0.5 days): until the §12.1 test runs, the mechanism of the most expensive defect is ambiguous, and §0 shows what that ambiguity has already cost — three successive reports carried a wrong finding.
- **A new schedule risk not previously recorded:** the adopted lifecycle mechanism has **zero test coverage** (B20). Any C-1 built on it inherits that, and discovering its behaviour during implementation rather than before is exactly the failure mode that produced §0.

**Recovery options remain the four previously recorded; none is applied. Any baseline change requires owner approval.**

---

### 14.4 Time ledger

| | |
|---|---|
| **Actual start** | **2026-10-17T21:08:23+05:30 (IST)** |
| **Actual end** | **2026-10-17T21:20:14+05:30 (IST)** |
| **Wall-clock elapsed** | **11 min 51 s** |
| **Active engineering effort** | **~11.5 minutes** (no external wait inside this task) |
| External waiting before start | **20 min 38 s** (prior task closed 20:47:45 → 21:08:23) — not engineering effort |
| Monitoring | **no continuous monitoring claimed between reports**; every timestamp is a measured `date -Iseconds` |

---

## 15. Verification and limitations

### 15.1 Verified at the end of this task

| Artifact | Expected | Actual | Result |
|---|---|---|---|
| `PI-ADD-001-RATIFICATION-CLOSURE-002.md` | `1f1f6735…9175` / 497 | re-checked at close | **BYTE-UNCHANGED** |
| `PI-ADD-001-V03-INDEPENDENT-REVIEW-002.md` | `9e496a09…06b6` / 134 | re-checked at close | **BYTE-UNCHANGED** |
| `PI-REQUIREMENTS-ADDENDUM-003-PROPOSED.md` | `3ef5a365…5477` / 536 | re-checked at close | **BYTE-UNCHANGED** |
| v0.1, v0.2, readiness report, semantic review | prior hashes | unchanged | **NOT MODIFIED** |
| Worktree | 143 entries at start (67 M / 76 ??) | +1 untracked = this report | **PRE-EXISTING WORK PRESERVED** |

### 15.2 Checks performed

Read `20260520_phase6_realtime_lifecycle_workflow.sql` lines 1–95 in full, including the trigger block missed by all prior reports · `20260518_phase4…` feed-item DDL · `20261028000000_pi_prospect_lifecycle_state.sql` header, states, FKs, triggers · `retention.ts` in full · `retentionService.ts` policy and execution paths including the delete branch · `opportunityLifecycleService.ts` init, current-state read, transition and the `?? 'detected'` fallback · `opportunityFeedService.ts` creation contract and insert site · the only transition route · enumerated every writer and reader of both tables · confirmed zero opportunity references in the PI identity and intake trees · confirmed zero tests for the Community lifecycle mechanism · confirmed no block trigger on `moderation_decisions` or `opportunity_feed_items` · confirmed no later migration drops the triggers · re-executed both vocabulary scans and contextually reviewed all 5 hits · extracted the exact wording of 27 requirements for the conflict map · re-verified three artifact hashes at open and close.

### 15.3 Checks NOT performed

| # | Not performed | Reason |
|---|---|---|
| 1 | ~~The §12.1 cascade test~~ | **SUPERSEDED — AD-1 was authorized after this report was drafted and the test was EXECUTED. See §17** |
| 2 | Any test suite, typecheck or lint | Documentation-only; no code changed |
| 3 | Any database operation, production access, migration-history read | Prohibited; **no denied operation re-routed** |
| 4 | Execution of `pi_wsc_prospect_lifecycle.test.ts` | Not authorized; its header is cited as the test's own claim, not as my result |
| 5 | Verification that any migration is applied in production | Prohibited |
| 6 | **Human independent review** | None available |
| 7 | Re-search for the Q3 policy | 11 scopes already exhausted; no new reason |
| 8 | Re-examination of B7, B11–B18 | Out of this brief's scope; carried forward as recorded |

### 15.4 Limitations

The central correction in §0 rests on **documented PostgreSQL semantics, not execution** (§1.2), and is therefore marked UNVERIFIED by execution throughout; §12.1 is written so that either outcome is actionable. Production behaviour is unverified everywhere. The separate-agent review is model-family-correlated and **confirmed the very error this report corrects**, which is the strongest available argument for human review. §1.4, §1.5, §2.4 and the FR-A9 unrepresentability finding all depend on the same inference and inherit its status.

---

## 16. Closing statements

| Gate | Status |
|---|---|
| **D-1** | **REFUTED AS PUBLISHED.** Replaced by three defects — inoperable retention, tenant deletion blocked by the trigger, silent `detected` fallback. Confidence **VERIFIED BY EXECUTION** for the first two (§17 P2/P4/P5/P7); the `detected` fallback is a code reading, unchanged |
| **D-2** | **REFUTED AS PUBLISHED** for the lifecycle table — a database trigger exists and **refuses the cascade in execution** (§17 P1/P2/P6). The app-layer-only gap is real for `moderation_decisions`. The FR-A37/FR-A40 conflict is **inverted** |
| **D-3** | **CONFIRMED and strengthened.** Confidence **HIGH** — schema and the total absence of adapter behaviour |
| **Q1 / Q2** | **DECIDED AND RECORDED** — unchanged |
| **Q3** | **BLOCKED** — policy not located, approval unverified, no accountable owner evidenced; **aggravated** by §1.4 |
| **Independent review** | **PARTIALLY SATISFIED / PENDING** — no human review has occurred |
| **Ratification of v0.3** | **NOT RATIFIED. NOT ratification-ready.** 20 register entries open; 11 architecture decisions pending |
| **Recommendation** | **C-COMB**, with **AD-1** first and **S1** as the cheap unblocked subset — a recommendation, not a decision |

**Implementation authorization remains NONE.**

---

## 17. AD-1 execution record — the cascade question, settled

**Authorized by the owner after this report was drafted**, scoped to the §12.1 probe against the documented disposable harness only.

### 17.1 How it was run

Steps 1–3 of `scripts/ci/real-schema-ci.sh` were mirrored in a scratchpad script — bootstrap, `supabase/_schema/baseline.sql`, then every migration newer than ledger position `20260916000000`. **Step 4, the full jest suite, was deliberately not run:** AD-1 needs one targeted probe, not 28+ suites. Nothing was added to the repository; every script lives in the session scratchpad.

| | |
|---|---|
| Image | `pgvector/pgvector:pg17`, container `ad1-cascade-probe-<pid>`, `--restart no` |
| Binding | **`127.0.0.1` only**, port chosen by Docker, asserted loopback before use |
| Provisioning | baseline restored in **39 s**, `823` public tables met, **52/52 migrations replayed ok in 48 s** |
| Credentials | throwaway (`postgres:w6`); **no production credential, no production hostname** |
| Isolation | every probe ran in its own transaction ending in `ROLLBACK`; fixtures used **exact ids** under the `ad1…` prefix; a final residue check returned **0 / 0 / 0 / 0** |
| Teardown | container removed by **exact id**, never by name. The unrelated 11-container `cert-supabase` stack was verified still running and **untouched** |

### 17.2 Results — 7 probes, all predictions confirmed

| Probe | Action | Predicted | **Actual** | Verdict |
|---|---|---|---|---|
| **P0** | Trigger introspection | `BEFORE`, `ROW`, DELETE + UPDATE, enabled | `opp_lifecycle_block_delete` and `opp_lifecycle_block_update`, both **`BEFORE` / `ROW`**, `tgenabled = 'O'`. All four cascade FKs confirmed `confdeltype = 'c'` | **CONFIRMED** |
| **P1** | Direct `DELETE` on a lifecycle row | Refused | `REFUSED P0001 :: opportunity_lifecycle_states is append-only`; row remains | **CONFIRMED** — first executed proof for **this** table |
| **P2** | **`DELETE` the parent feed item that HAS a lifecycle row** | Refused | **`REFUSED P0001`**; parent remains, lifecycle row remains | **CONFIRMED — AD-1 SETTLED** |
| **P3** | `DELETE` a parent feed item with NO lifecycle row | Succeeds | **`SUCCESS`**, 0 rows remaining | **CONFIRMED** |
| **P4** | `DELETE` the `lead_signals` row (two-hop cascade) | Refused | **`REFUSED P0001`**; signal and lifecycle row both remain | **CONFIRMED** |
| **P5** | `DELETE` the `companies` row | Refused | **`REFUSED P0001`**; company remains | **CONFIRMED — §1.5 tenant-deletion finding PROVEN** |
| **P6** | `UPDATE` a lifecycle row | Refused | **`REFUSED P0001`** | **CONFIRMED** |
| **P7** | **One batched `DELETE` covering a lifecycle-bearing row AND a clean row** | Whole batch fails; the clean row is not deleted | **`REFUSED P0001`**; the clean row **survived — 1 row remaining** | **CONFIRMED — §1.4 batch poisoning PROVEN** |

### 17.3 What execution added beyond confirmation

1. **P7 proves batch poisoning directly.** `retentionService.ts` deletes up to `MAX_DELETE_BATCH = 10_000` ids in a single statement; one lifecycle-bearing row aborts the statement and **no row in the batch is deleted**, including rows that would have been deletable on their own. Retention of `opportunity_feed_items` is therefore not merely partial — it is **all-or-nothing and, in practice, nothing**.
2. **P3 bounds FR-A46/AC-A42/NC-A19 exactly.** A feed item with no lifecycle row deletes cleanly, so §2.4's consequence is precise: those three items are reachable **only** for lifecycle-less feed items, which per `initialiseLifecycleForOpportunity` the pipeline does not normally produce.
3. **A new defect — the two append-only guards raise different SQLSTATEs.** `trg_opp_lifecycle_block_mutation` has **no `ERRCODE` clause**, so it raises plpgsql's default **`P0001`**; `trg_prospect_lifecycle_guard` declares **`ERRCODE = '42501'`**. The PI suites assert `42501`. Any handler keying on one **will not catch the other**, which matters directly for Option 2-A's per-item retention reporting. Recorded as **B21**.
4. **It cost 0.08 engineer-days, not the 0.25–0.5 forecast** — see §17.4.

### 17.4 Scope, limits and time

| | |
|---|---|
| **What this does NOT prove** | **Nothing about the production database.** The harness replays migrations onto a throwaway server; a green probe here is **not** evidence that any migration is applied in production, and must never be reported as such |
| Role caveat | Probes ran as the container superuser, which bypasses RLS — the same posture as the retention service's own owned-write client, so the comparison is apt, but it is not an authenticated-role test |
| Repository impact | **None.** No test file, no migration, no code. Scratchpad only |
| Start / end | **2026-10-17T21:31:31** → **21:35:10 +05:30 (IST)** |
| Wall-clock / active | **3 min 39 s** / **~3.5 min ≈ 0.08 engineer-days** against a 0.25–0.5 forecast |

### 17.5 Consequence for the recommendation

**C-COMB is unchanged, and AD-1 is now closed.** The mechanism is settled, so AD-2/AD-3/AD-4 can be decided on executed evidence rather than on documented semantics. **AD-5's two code-only fixes gain a third companion:** whatever handles the refusal must recognise **both** `P0001` and `42501` (B21). Every other blocker, decision and schedule figure in this report stands as written.
