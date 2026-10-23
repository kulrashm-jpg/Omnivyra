# D22-B1b — RUNTIME CLOSURE

| | |
|---|---|
| **Gate** | B1b runtime closure — apply and verify in isolated non-production only |
| **Verdict** | **A. B1b CLOSED — runtime verified, no defects** |
| **Date** | 2026-10-06 |
| **D-4** | Ratified as implemented. Candidacy uses LIVE assertions only; incumbent attestation uses ALL historical assertions, live or superseded. Not revisited. |
| **Implementation code changed** | **None.** No defect was exposed, so none was touched. The boundary hashed `4c3237a8fbcb9585` at the start of this gate and `4c3237a8fbcb9585` at the end. |
| **Environment** | Isolated PostgreSQL 17.6, portable binaries in the session scratchpad, `listen_addresses = 127.0.0.1`, port 55432. Stopped at the end: no PID file, 0 processes, 0 listeners. |
| **Production** | **Untouched.** See §10. |

> **Read "CLOSED" precisely.** B1b's runtime behaviour is verified in the isolated environment. The migration is **still unapplied in production**, and applying it there was explicitly outside this gate's authorisation. Nothing about B1b is live.

---

## Classification summary

| # | Item | Status |
|---|---|---|
| 1 | Isolated PostgreSQL environment recreated and used | **VERIFIED** |
| 2 | Migration `20261119000000` applied | **VERIFIED** |
| 3 | Migration application and structural objects verified | **VERIFIED** |
| 4 | B1b real-schema suite run against the migrated environment | **VERIFIED** — 53/53 |
| 5 | End-to-end canonical write path | **VERIFIED** |
| 6 | D-4 cycle, including historical attestation of a superseded value | **VERIFIED** |
| 7 | Genuinely unattested incumbent is not overwritten | **VERIFIED** |
| 8a | `superseded_at` is written | **VERIFIED** |
| 8b | Returning assertions revive rather than duplicate | **VERIFIED** |
| 8c | Raw evidence remains intact | **VERIFIED** |
| 8d | `canonical_attribute_decisions` is append-only | **VERIFIED** |
| 8e | Cross-tenant composite boundaries enforced | **VERIFIED** |
| 8f | Account/person shape constraints enforced | **VERIFIED** |
| 8g | Invalid decision reasons rejected | **VERIFIED** |
| 8h | Existing applied provenance never re-stamped | **VERIFIED** |
| 9 | Mutation probes re-run against the migrated runtime | **VERIFIED** — 11/11 killed |
| 10 | No production connection, migration, deploy, provider call or flag change | **VERIFIED** |

**DEFECT FOUND: none. BLOCKED: none. NOT VERIFIED: none.**

---

## 1–3. The environment, the application, and the proof it did something

**"It was already there" is not evidence that a migration works.** So the schema was built **without** B1b first and the objects proved absent, then the migration was applied and they proved present.

```
replayed 61 migration(s), B1b deliberately excluded; 0 did not apply cleanly
PRE   table|parentkey|trigger|compositeFKs|indexes|policies = 0|0|0|0|0|0
      PRE-STATE CONFIRMED: every B1b object is absent
apply 20261119000000_pi_canonical_attribute_decisions.sql -> APPLIED
      NOTICE: B1b: canonical_attribute_decisions created, append-only,
              3 composite tenant FKs, 0 rows.
POST  table|parentkey|trigger|compositeFKs|indexes|policies = 1|1|1|3|3|1
      POST-STATE CONFIRMED
```

The driver **refuses to continue** if the pre-state is not all zeros, because a post-state check against a schema that already had the objects would prove nothing.

**Idempotence.** Replaying the migration applied cleanly, left the six structural facts identical (`1|1|1|3|3|1`), and left the table at **0 rows** — it creates no data.

**Constraints, read from the live catalogue** rather than from the migration source: 10 in total — 1 primary key, 4 foreign keys, 5 checks.

| Constraint | Definition |
|---|---|
| `canonical_decisions_assertion_tenant_fk` | `(assertion_id, organization_id) → source_assertions(id, organization_id) ON DELETE CASCADE` |
| `canonical_decisions_person_tenant_fk` | `(person_id, organization_id) → unified_persons(id, company_id) ON DELETE SET NULL (person_id)` |
| `canonical_decisions_account_tenant_fk` | `(account_id, organization_id) → prospect_accounts(id, organization_id) ON DELETE SET NULL (account_id)` |
| `canonical_decisions_reason_valid` | the four ratified reasons, and nothing else |
| `canonical_decisions_entity_coherent` | an account-shaped decision may never name a person |
| `canonical_decisions_entity_type_valid`, `..._attribute_not_blank`, `..._value_not_blank` | shape and non-blankness |

Every composite foreign key carries `organization_id` as its second leg. `uq_source_assertions_id_org` exists and is **not partial**, so it is a usable parent key.

---

## 4. The real-schema suite

**53/53** against the freshly migrated database — 23 B1b tests plus LI-2's own 30, which still pass unchanged, so the evidence layer was not disturbed by the new table.

```
PASS real-schema backend/tests/realschema/b1b_arbitration.test.ts
PASS real-schema backend/tests/realschema/li2_source_records.test.ts
Tests: 53 passed, 53 total
```

Three tests were **added** for this gate (tests only; no implementation code changed): the four-step D-4 cycle, raw-evidence survival, and the strengthened unattested-incumbent case.

---

## 5. The end-to-end canonical write path

Exercised through the **real boundary** against the **real schema** — `ownedDbTable` is bound to the live pg client, so no part of arbitration is stubbed.

```
source assertion -> arbitration -> canonical update -> canonical_attribute_decisions
                 -> provenance stamp -> subsequent re-arbitration
```

| Stage | Evidence |
|---|---|
| assertion retained | `source_records` + `source_assertions` rows written, `raw_value` verbatim, `value_hash` a sha256 |
| arbitration | the ratified order; `reason` recorded per decision |
| canonical update | `unified_persons.job_title` moves only when a rule permits |
| decision log | one append-only row per canonical write, ordered by `decided_at` |
| provenance | `applied_to_canonical_at` + `applied_reason` on the winning assertion |
| re-arbitration | a later, newer observation moves canonical again and appends another decision |

Idempotence held at the runtime level too: re-ingesting an identical payload reported `outcome: unchanged`, recorded 0 new assertions, applied nothing, and left the decision log at **one** row.

---

## 6. D-4, the full cycle — including the step that matters

The gate asked for the cycle *and* for the consequence that a superseded value stays historically attested. All four steps ran in one transaction through the real boundary.

| Step | Action | Canonical | Assertion rows |
|---|---|---|---|
| 1 | alpha asserts **A** (observed 2026-01-01) | **A** | A live, stamped `2026-06-01` |
| 2 | alpha changes to **B** (observed 2026-02-01) | **B** | A **superseded**, B live |
| 3 | alpha returns to **A** (observed 2026-03-01) | **A** | B **superseded**, A **revived** — 2 rows, never 3 |
| 4 | beta asserts **B** (observed 2026-04-01) | **B** | 3 rows: alpha/A live, alpha/B superseded, beta/B live |

**Step 3 is the one that would have broken under the earlier design.** Canonical held B, and B was no longer live; keying attestation on live evidence alone would have judged B "unattested" and frozen canonical on a value its only source had just withdrawn. Attestation over all historical assertions is what lets canonical follow the source back.

**Step 4 is the gate's specific ask.** B had been superseded, yet it remains historically attested — its row survives with its raw value and its original `applied_reason` — so when B next wins on recency, the transition is permitted and recorded. Liveness is scoped per source record, so beta's claim is its **own** row: alpha's withdrawn B stayed withdrawn and was not silently revived.

**Nothing was re-stamped.** A's `applied_to_canonical_at` was `2026-06-01` after step 1 and still `2026-06-01` after it won again in step 3. The re-win is recorded in the log, not by overwriting history:

```
decisions: A-title, B-title, A-title, B-title
reasons:   single_uncontested_assertion, single_uncontested_assertion,
           single_uncontested_assertion, newest_observation
```

---

## 7. The genuinely unattested incumbent

Canonical set to `Never-Asserted-X` directly, then two sources **agreeing**, **recent** and **both at confidence 0.99** asserted `Agreed-Y`.

- both ingestions returned `canonicalApplied: []` and `unattested_incumbent`;
- canonical remained `Never-Asserted-X`;
- the decision log stayed **empty** — nothing was decided, so nothing was logged;
- **both assertions were retained.** Refusing to write is not refusing to record.

Strength of evidence is irrelevant to this branch, which is the point: a value no evidence has ever carried cannot be re-derived if it is lost.

---

## 8. The eight guarantees, verified twice

Once through the application path (jest), and once through **independent SQL** that uses none of the test harness. That separation was deliberate: this programme has already been given two false readings by harness behaviour (`attempt()` rolls back on success; `now()` is transaction-stable), and a database guarantee should not be evidenced by the code whose quirks produced those readings.

**All 14 independent SQL checks passed**, inside a transaction that was rolled back, leaving 0 rows behind.

| Guarantee | SQL evidence |
|---|---|
| append-only — `value` | refused, `P0001` |
| append-only — `reason` | refused, `P0001` |
| append-only — `decided_at` | refused, `P0001` (literal timestamp, never `now()`) |
| append-only — `attribute` | refused, `P0001` |
| append-only — `organization_id` | refused, `P0001` |
| append-only — `DELETE` | refused, `P0001` |
| the one legal update | a deleted person **detaches** its decision; the decision survives with value and reason |
| cross-tenant assertion | refused, `23503` |
| cross-tenant person | refused, `23503` |
| account/person shape | refused, `23514` |
| invented reason | refused, `23514` |
| all four ratified reasons | accepted |
| raw evidence after supersession | `raw_value` preserved **verbatim**, trailing whitespace and all |
| withdrawn claim | marked, not deleted — the row is still present |

`superseded_at` — which had **four readers and no writer** before B1b — is written at runtime: the cycle in §6 shows it set on withdrawal and cleared on revival, confirmed per row.

---

## 9. Mutation probes against the migrated runtime — 11 of 11 killed

Re-run with the suite pointed at the freshly migrated database. Each probe breaks one ratified decision, asserts the anchor matches exactly once, asserts the injection changed bytes, requires the suite to fail, and restores in `finally` with a hash re-check.

| # | Probe | Verdict |
|---|---|---|
| 1 | D-1 — prefer the ingestion-side timestamp | KILLED (2 failed) |
| 2 | D-2 — treat an unstated confidence as zero | KILLED (2 failed) |
| 3 | D-2 — let confidence override recency | KILLED (16 failed) |
| 4 | D-3 — widen instead of narrow under self-disagreement | KILLED (1 failed) |
| 5 | D-4 — overwrite an unattested incumbent | KILLED (7 failed) |
| 6 | attestation — count only live evidence | KILLED (1 failed) |
| 7 | S-1 — never mark a withdrawn claim superseded | KILLED (3 failed) |
| 8 | S-4 — never revive a returning value | KILLED (2 failed) |
| 9 | provenance — do not append the decision | KILLED (6 failed) |
| 10 | S-6 — overwrite an existing canonical stamp | KILLED (2 failed) |
| 11 | the append-only trigger, weakened **in the database** | KILLED (2 failed in jest, **and** the independent SQL checks fell 14 → 9) |

Probes 7–10 each killed **more** tests than in the pre-closure run (3 vs 2, 2 vs 1, 6 vs 5, 2 vs 1) because the three closure tests added this gate also detect those regressions.

**Probe 11 restored by re-applying the migration**, which demonstrates three things at once: the guarantee comes from the migration, the migration is idempotent, and the weakened state is fully recoverable. After restore: jest 23/23, SQL 14/14.

`ingestionBoundary.ts` hashed `4c3237a8fbcb9585` before the probes and `4c3237a8fbcb9585` after.

---

## 10. Production untouched

| Claim | Evidence |
|---|---|
| No production database connection | `W6_DB_URL = postgresql://eng004:***@127.0.0.1:55432/b1b_closure` — loopback. The harness additionally **refuses** any managed host: `FORBIDDEN = /supabase\.(co\|com)\|amazonaws\.com\|railway\|neon\.tech\|render\.com/i`. |
| No production env file was read | **This worktree contains no `.env.local` at all** — only `.env.test` and two `.example` files. `backend/tests/setupEnv.ts` states it: *".env.local IS production … is deliberately never loaded by tests"*, and refuses to run without a non-production env file. |
| No migration applied to production | The migration was applied only to `b1b_closure`, created from `b1b_pre` on the local server. No `supabase db push`, no Studio, no pooler connection. |
| No deploy | `vercel`, `railway` and `gh` were never invoked. `vercel.json` and `railway.json` are untouched (mtimes 2026-10-04 and 2026-09-27, both before this gate). |
| No flag change | No `.env*` file was written. `LEAD_OUTREACH_EMAIL_ENABLED` and every other flag are untouched. |
| No provider call | Arbitration performs no I/O. No network egress: every test used the local server or an in-memory mock. |
| Docker never started | `docker ps` fails — the daemon is down, verified at the start and the end. It is never used here because starting it auto-starts the production-connected `omnivyra-worker`. |
| Nothing committed or pushed | 9 files changed, all in `C:/tmp/pi-consol`, uncommitted. |

**Files touched by B1b, hashed:**

```
4c3237a8fbcb9585  backend/services/prospectIdentity/ingestionBoundary.ts
a6d3c35cf36ac3ad  backend/services/prospectIdentity/attributeAuthority.ts
c45e6a3ce9c8eaf2  backend/services/prospectIdentity/accountIntelligence.ts
e8b9d614449121f9  supabase/migrations/20261119000000_pi_canonical_attribute_decisions.sql
a0776c87e0cd2525  backend/tests/unit/b1bSourceArbitration.test.ts
b1f0c7cfee38eecc  backend/tests/realschema/b1b_arbitration.test.ts   (3 closure tests added)
411eb5fda6243156  backend/tests/unit/prospectIdentityIngestionBoundary.test.ts
ebe6d756fc3cb1b8  backend/tests/unit/li4eManualAdapter.test.ts
f9079559b987bdeb  backend/tests/unit/p2bAccountFirmographicPersistence.test.ts
```

Three source files, one migration, five tests. No env file, no CI config, no deploy manifest, no flag file. **Only one file changed during this gate** — the real-schema test, by the addition of three tests.

---

## What this gate did NOT do

Per the authorisation: no production access, no production migration, no deploy, no `db push`, no flag change, no provider call, no enrichment, no scoring activation, **B2 not started**, no source adapter added, the six unwritable attributes **not** fixed, manual authority **not** made authoritative, Sales Navigator authority **not** seeded.

No implementation code was modified, because no runtime test exposed a B1b defect.

---

## Still outstanding (outside this gate)

| Item | Note |
|---|---|
| **Apply `20261119000000` to production** | Arbitration appends to `canonical_attribute_decisions` on every canonical write, so the migration must be applied **before** the new boundary runs anywhere. No deploy mechanism applies migrations; this is a deliberate, separate owner action. |
| The six structurally unwritable attributes | `authority`, `influence`, `buying_role`, `market`, `business_model`, `growth_stage` — recorded, deliberately not fixed. |
| B2 — one enrichment provider | Unblocked by B1b, not started. |

---

# A. B1b CLOSED — runtime verified, no defects

Migration applied and verified against a proven pre-state in the isolated environment; 53/53 real-schema tests; 14/14 independent SQL constraint checks; 11/11 mutation probes killed; implementation code unchanged; production untouched.

**STOP.** B2 was not begun.
