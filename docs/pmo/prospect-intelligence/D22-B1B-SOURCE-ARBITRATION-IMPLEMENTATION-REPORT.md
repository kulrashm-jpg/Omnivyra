# D22-B1b — SOURCE ARBITRATION IMPLEMENTATION
## VERIFICATION REPORT

| | |
|---|---|
| **Gate** | B1b — implement the arbitration policy ratified in D22-B1a |
| **Status** | **PASS.** Implemented, T1 + T2 verified, 11/11 mutation probes killed, typecheck clean. |
| **Date** | 2026-10-05 |
| **Worktree** | `C:/tmp/pi-consol`, base `7febdb28` plus prior PI gate work. **Nothing committed, nothing pushed.** |
| **Authorisation** | Owner ratification of D-1…D-5 and O-1…O-7, dated this session. |
| **Production** | **Untouched.** No migration applied, no `db push`, no deploy, no flag change, no provider call, no production read or write. **Docker never started** (the daemon auto-starts the production-connected `omnivyra-worker`); verified down. |
| **Database used** | Portable PostgreSQL 17.6 in the session scratchpad, `listen_addresses=127.0.0.1`, port 55432, built from bootstrap + baseline + all 62 migrations above the floor. Stopped at the end: 0 processes, 0 listeners, no PID file. |

---

## 1. One thing to confirm before this ships

**D-4 was ratified with wording I read as containing a dropped "except".** As written:

> *"RULE C is replaced by re-arbitration when the incumbent canonical value is unattested."*

Taken literally that inverts the recommendation — it would overwrite an unattested incumbent and keep RULE C for attested ones, which would leave first-writer-wins intact and make D-4 self-defeating (B2 would still be inert after B1b). Read with *"Use the existing unattested_incumbent concept"* and *"do not silently discard evidence"*, the intended rule is clearly the guard.

**Implemented, therefore, in the conservative direction:**

| Incumbent canonical value | Behaviour |
|---|---|
| attested by evidence (live **or** withdrawn) | **re-arbitrated** — may be replaced by the winner |
| attested by nothing, ever | **never overwritten** — `unattested_incumbent` |

This is safe by default: if the other reading was intended, nothing has been destroyed and one branch inverts. **Nothing else in the gate depends on it.**

---

## 2. What was built

### 2.1 Files

| File | Change | sha256 (16) |
|---|---|---|
| `backend/services/prospectIdentity/ingestionBoundary.ts` | the ratified algorithm, liveness reconciliation, decision provenance | `4c3237a8fbcb9585` |
| `backend/services/prospectIdentity/attributeAuthority.ts` | **new** — the authority declaration, as data | `a6d3c35cf36ac3ad` |
| `backend/services/prospectIdentity/accountIntelligence.ts` | WS-7 reads `contested`, carries `recorded_at` | `c45e6a3ce9c8eaf2` |
| `supabase/migrations/20261119000000_pi_canonical_attribute_decisions.sql` | **new** — append-only decision log + the assertion parent key | `e8b9d614449121f9` |
| `backend/tests/unit/b1bSourceArbitration.test.ts` | **new** — 53 tests, every ratified decision by name | `a0776c87e0cd2525` |
| `backend/tests/realschema/b1b_arbitration.test.ts` | **new** — 20 tests against real PostgreSQL | `c5ba5633ad629b48` |
| `backend/tests/unit/prospectIdentityIngestionBoundary.test.ts` | 3 invalidated expectations rewritten as decisions | `411eb5fda6243156` |
| `backend/tests/unit/li4eManualAdapter.test.ts` | its db mock gained `in` on the UPDATE builder | `ebe6d756fc3cb1b8` |
| `backend/tests/unit/p2bAccountFirmographicPersistence.test.ts` | RULE C expectation replaced; re-arbitration case added | `f9079559b987bdeb` |

All nine are LF with zero control bytes (checked by byte count, not by a regex that can pass vacuously).

**Migration census:** 437 → **438**. `20261119000000` is the 15th in the unapplied PI window that begins at `20261105000000`. It is **not applied anywhere**; applying it remains a separate, owner-driven step.

### 2.2 Each ratified decision, and where it lives

| Decision | Implementation |
|---|---|
| **D-1** timestamp | `arbitrationTimeMs` — `observed_at ?? recorded_at`, parsed; an unparseable or absent stamp is *no* stamp, never epoch zero. No ingestion-side column is read anywhere in arbitration. |
| **D-2** confidence | `statedConfidence` returns a confidence only inside `[0,1]`, else `null`. Step 4 runs **only** on the values tied at the maximum timestamp, and **only** when every tied candidate states one. No normalisation, no threshold. |
| **D-3** authority | `attributeAuthority.ts`: `AttributeAuthority` keyed `(entityType, attribute)`, resolved per tenant, passed into the pure function. **No provider name appears in arbitration code** — the frozen guard test still passes unchanged. `resolveAttributeAuthority` validates the tenant even though it is currently source-neutral. |
| **D-4** re-arbitration | `decideCanonicalUpdates` compares the winner with the incumbent: empty → write; equal → write nothing at all; different and attested → write; different and never attested → `unattested_incumbent`. |
| **D-5** no expiry | No duration, interval or TTL exists anywhere in the gate. Silence retires nothing: a source that stops supplying an attribute leaves its claim standing. |
| **O-1 / O-7** deferred | `resolveAttributeAuthority` returns an empty declaration for every tenant and both entity types. No declaration is seeded. An empty declaration is exactly source-neutral behaviour. |
| **O-2** no normalisation | Nothing maps, scales or calibrates confidence. |
| **O-3** dormant | `unified_persons.source_priority` is untouched and unread. |
| **O-5** opaque scalar | `technologies` arbitrates by its serialised string, like any other value. No set semantics. |
| **O-6** acknowledged | Arbitration does **not** compensate for the record-level `observed_at`. No heuristic correction was added. |

### 2.3 The two decisions B1a delegated to this gate

**S-4 — re-assertion (the 23505 B1a said to find here, not in production).** The dedupe index is `(organization_id, source_record_id, attribute, value_hash)`, so a source asserting A → B → A cannot insert the second A: the superseded row already holds that key.

**Decided: liveness is a function of what the source record currently asserts.** Exactly one row per `(source_record, attribute)` is live — the one matching the current claim — and a returning value is **revived**, not duplicated. `reconcileAssertionLiveness` reads the record's assertions once, then issues at most two batched updates.

What it costs, stated plainly: the timestamp of a *previous* supersession is overwritten when a value returns, so a supersede → revive → supersede cycle reads only as its last state. No row is deleted, no `raw_value` is lost and no `applied_*` provenance is cleared — **no evidence is discarded, only one derived marker is recomputed.** Preserving every supersession *event* would need a second log, which was not authorised.

**S-8 — the provenance shape.** `applied_to_canonical_at` and `applied_reason` are tied by a CHECK, so clearing one clears both. They are now never cleared and never overwritten: the stamp is written only onto an assertion that does not already carry one, and that is a database predicate (`.is('applied_to_canonical_at', null)`), not a read-then-write race.

A single timestamptz cannot express win → lose → win. **Decided: an additive append-only table**, `canonical_attribute_decisions` — one row per canonical write, newest `decided_at` per `(entity, attribute)` being current. B1a's contract permitted a migration only if the provenance shape required one; it does. The alternative — not re-stamping and keeping no log — leaves the *latest* assertion stamp pointing at a value that is no longer canonical, which is worse than no history.

The table encodes no policy and names no provider: `reason` records which ratified rule fired, constrained to the four-value vocabulary. Append-only is enforced by a trigger, not a convention, because the runtime connects as the service role and would bypass any grant. The trigger permits exactly one update: a foreign key detaching a deleted subject, so a decision outlives the person it described.

---

## 3. A defect found and fixed during the build

The unattested-incumbent guard was first keyed on the **live** assertion set. That is wrong, and the T2 case for S-4 is what exposed it:

```
source asserts A     -> canonical A,  A live
source changes to B  -> A superseded, B live, canonical re-arbitrated to B
source returns to A  -> B superseded, A revived
                        canonical is still B — and B is no longer LIVE,
                        so B looked "unattested" and would have been FROZEN.
```

Canonical would have stuck on a value its only source had withdrawn — a silent wrong answer, in exactly the path B1a told this gate to handle.

**The fix separates the two questions.** Candidacy uses live assertions only: a withdrawn claim must not compete. Attestation uses **any** assertion, live or superseded: a value that passed through this layer is ours to re-decide. A value no assertion has *ever* carried is still unattested, so the protection the guard exists for is unchanged. This needed no extra parameter and no extra query — the function is handed the whole evidence set and decides what each row is for.

A mutation probe now holds that distinction in place (probe 6).

---

## 4. Consumers

**WS-7 `accountIntelligence` keeps its exact question.** It asks *"do the sources disagree?"*, which under LI-2 was readable out of `withhold` because disagreement was the only reason anything was withheld. Recency now **resolves** most disagreements, so `withhold` would **under-report**. The decision function therefore also returns `contested` — raw disagreement, regardless of whether arbitration picked a winner — and WS-7 reads that. Its 46-test suite passes unchanged in substance; the empty-canonical-row calling convention still behaves as documented.

**`enrichment/result.markConflicting` needed no change.** It filters for `sources_disagree`, which is preserved byte-for-byte and now means something sharper: a conflict arbitration genuinely could not resolve.

**`canonical_value_already_set` is retained in the vocabulary and no longer emitted.** A test asserts no path emits it, so a consumer that recognises it keeps compiling while nothing produces it.

### 4.1 Three pinned tests were rewritten as decisions, not deleted

| Was | Now |
|---|---|
| *"does not silently pick the first, the newest, or a preferred provider"* | *"never picks the first, and picks the newest ONLY under the ratified rule"* — asserts both that unordered candidates still yield nothing **and** that timed ones resolve by recency, not by confidence or position. |
| *"treats an empty string as set — re-arbitration is LI-6, not here"* | *"an empty string is an unattested incumbent"* — states what an empty string now is. |
| RULE C *"withholds when the canonical value is already set"* | the `unattested_incumbent` guard, **plus** a new test for the case RULE C made impossible. |

`INGESTION_BOUNDARY_VERSION` moved `li2.1` → `b1b.1`; the version assertion moved with it. The `LI-6` forward pointers are retired — D-4 is what LI-6 was a placeholder for.

**One consumer test had a mock gap, not a production defect.** `li4eManualAdapter`'s in-memory db mock implements `eq` and `is` on its UPDATE builder but not `in`, which the real PostgREST builder has always supported. B1b's batched liveness update hit it and 17 tests failed with a TypeError inside the boundary. The mock gained the capability; the production shape was not weakened to suit it.

---

## 5. Verification

### 5.1 T1 — unit

| Suite set | Result |
|---|---|
| `b1bSourceArbitration` (new) | **53/53** |
| prospectIdentity / li2 / li4 / li5 / piWs2 / piWs6 / piWs7 / p2a / p2b / piWsf / b1Social / leadIngestion / piWs4 — 30 suites | **1028/1028** |
| a6 / a7 / piA3 / piA4 / piA5 / piA6 / piA7 / piM1 / piTenantScoped / p2c / li4d — 45 suites | **1192/1192** |
| route-auth — 15 suites | **611/611** |
| `tsc --noEmit --incremental false` | **0 errors** |

Every suite in the repository that references `decideCanonicalUpdates`, `canonicalWithheld`, `canonical_value_already_set`, `reconcileAssertionLiveness` or `canonical_attribute_decisions` was enumerated by grep and run. None was skipped.

### 5.2 T2 — real PostgreSQL

**20/20**, plus LI-2's own 30 tests still passing against the migrated schema (**50/50** together). The migration applied cleanly alongside all 62 others and **replaying it is a no-op**.

Structural assertions were made by the driver before the suite ran, so a suite that proved nothing could not pass silently:

```
decisions_table | assertion_parent_key | append_only_trigger | composite_fks | superseded_col | rows
       1        |          1           |          1          |       3       |       1        |  0
```

What T2 proves that a unit test could not:

- the append-only trigger refuses every protected column and every delete — **six** columns probed individually;
- a deleted person **detaches** its decisions rather than failing, and the decision survives with its value and reason;
- a decision cannot name another tenant's assertion or person (23503 on the composite keys);
- an account-shaped decision cannot name a person (23514);
- `reason` outside the ratified vocabulary is refused (23514);
- re-asserting a previously superseded value **revives** it — two assertion rows, never three, and no 23505 escapes;
- cross-tenant ingestion is refused by the schema **before** arbitration is reached — stricter than the behaviour the test originally assumed;
- `superseded_at`, which had no writer at all before B1b, is actually written.

### 5.3 Mutation probes — 11 of 11 killed

Each probe breaks one ratified decision, asserts the anchor matches exactly once, asserts the injection changed bytes, runs the suite, requires failure, and restores in `finally` with a hash re-check.

| # | Probe | Verdict |
|---|---|---|
| 1 | D-1 — prefer the ingestion-side timestamp | KILLED (2 failed) |
| 2 | D-2 — treat an unstated confidence as zero | KILLED (2 failed) |
| 3 | D-2 — let confidence override recency | KILLED (16 failed) |
| 4 | D-3 — widen instead of narrow under self-disagreement | KILLED (1 failed) |
| 5 | D-4 — overwrite an unattested incumbent | KILLED (7 failed) |
| 6 | attestation — count only live evidence | KILLED (1 failed) |
| 7 | S-1 — never mark a withdrawn claim superseded | KILLED (2 failed, T2) |
| 8 | S-4 — never revive a returning value | KILLED (1 failed, T2) |
| 9 | provenance — do not append the decision | KILLED (5 failed, T2) |
| 10 | S-6 — overwrite an existing canonical stamp | KILLED (1 failed, T2) |
| 11 | the append-only trigger, weakened **in the database** | KILLED (2 failed, T2) |

`ingestionBoundary.ts` hashed `4c3237a8fbcb9585` before the probes and `4c3237a8fbcb9585` after.

**Probe 10 initially SURVIVED.** Nothing asserted that an already-stamped assertion is not re-stamped — a real coverage gap on a ratified invariant. The T2 revival test now captures the stamp after the first decision and asserts it is unchanged after the third, with explicit distinct decision times so the assertion cannot pass vacuously by landing in the same millisecond.

**Probe 11 restores by re-applying the migration**, which also demonstrates that the guarantee comes from the migration and that the migration is idempotent.

---

## 6. Two traps worth recording

**`now()` is transaction-stable.** The first version of the tamper probe used `SET decided_at=now()` inside the transaction that had just inserted the row with `now()`. The value did not change, the trigger correctly allowed a no-op, and the test read as a trigger failure. A probe that mutates to the same value proves nothing — the same rule as a zero-byte source mutation.

**`attempt()` rolls back on success.** The real-schema helper takes a savepoint and rolls back whether the statement succeeded or failed. It answers *"would this be refused?"* and can never perform an action whose effect you then observe. The person-detach test used it to delete a person and then looked for the effect; there was none, because the delete had been rolled back.

---

## 7. What this gate did NOT do

- **No enrichment or provider work.** No adapter, no credential, no network. Arbitration performs no I/O.
- **No ICP, lifecycle, scoring, suppression, identity-resolution or Common Outreach change.** The scoring engine is untouched; a canonical attribute changing *will* change a score input, which is the intended downstream effect, not a scoring change.
- **No authority declaration seeded** (O-1, O-7 deferred).
- **The six structurally unwritable attributes were NOT fixed.** `authority`, `influence`, `buying_role`, `market`, `business_model`, `growth_stage` are in the allowed surface and normalised, but `pendingFromPerson`/`pendingFromAccount` never map them, so no assertion can exist for them. This is a mapping gap, not arbitration, and fixing it would widen what is writable. **Recorded, deliberately not fixed** — it needs its own authorisation.
- **No conflict table and no review workflow.** The conflict stays derived.
- **No migration applied.** Applying `20261119000000` is a separate owner-driven step; no deploy mechanism does it.

---

## 8. Outstanding

| Item | Owner action |
|---|---|
| **The D-4 reading** (§1) | Confirm the guard direction, or say to invert it. |
| **Apply `20261119000000`** | Arbitration writes to `canonical_attribute_decisions`; until the migration is applied, the provenance insert fails and `ingestSourceRecord` throws on any canonical write. **This migration must be applied before the new boundary runs anywhere.** |
| The six unwritable attributes | Authorise a separate fix, or accept. |
| B2 — one enrichment provider | Now unblocked: the ordering constraint is satisfied. |

---

**Gate status: B1b COMPLETE. STOP.**

No enrichment provider was implemented. No source adapter was added. Scoring was not activated. B3 / B4 / B10 were not started. Production was not touched.
