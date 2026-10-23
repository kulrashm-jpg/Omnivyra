# D22-B2 — G-6 CLOSURE
## TENANT-SAFE ENRICHMENT ATTEMPT LEDGER

# G-6 CLOSED — G-3 CLOSED

**Isolated runtime verified. Repository verified. Production NOT verified and NOT touched** — the migration has been applied only to the disposable PostgreSQL in the session scratchpad.

| | |
|---|---|
| **Date** | 2026-10-06 |
| **Owner decision** | G-6 **not accepted**; the migration was authorized |
| **Migration** | `supabase/migrations/20261120000000_pi_attempt_ledger_tenant_fk.sql` · sha256 `1a426f268fb48d43` |
| **TypeScript changed** | **NONE.** G-6 needed no application change — the defect was entirely in the schema. |
| **`ingestionBoundary.ts`** | `4c3237a8fbcb9585` — **unchanged**, as required |
| **Production** | Untouched: no production DB, no migration, no credential, no provider call, no deploy, no Vercel, no Railway, no GitHub mutation, no flag change, Docker never started |

All fifteen completion criteria in §13 of the brief are met; each is evidenced below.

---

## Classification summary

| Item | Status |
|---|---|
| 1 Owner decision | **IMPLEMENTED** |
| 2 Pre-migration FK state | **VERIFIED** |
| 3 Preflight data checks | **VERIFIED** — 0 incompatible rows |
| 4 Migration name / hash | **IMPLEMENTED** |
| 5 Post-migration catalog proof | **VERIFIED** (isolated runtime) |
| 6 Positive same-tenant cases A–E | **VERIFIED** |
| 7 Negative cross-tenant cases ×4 | **VERIFIED** |
| 8 Exact point of rejection | **VERIFIED** — the attempt INSERT |
| 9 Proof the provider was not called | **VERIFIED** — tripwire never fired |
| 10 Attempt / evidence / canonical / decision state | **VERIFIED** — all zero |
| 11 G-3 regression | **VERIFIED** — 15 untouched tests pass; 2 pins flipped deliberately |
| 12 Typecheck | **VERIFIED** — 0 errors |
| 13 Mutation probes | **VERIFIED** — 3/3 killed |
| 14 Production safety | **VERIFIED** |
| 15 Files changed + hashes | **VERIFIED** |
| 16 Unrelated findings | **DEFERRED** — G-1, G-2, G-4, G-5 untouched; one correction recorded |

---

## 1. Owner decision

G-6 is **not accepted**. The attempt ledger must obey the same tenant invariant as the rest of the enrichment chain, using the existing parent composite keys, with no new isolation mechanism and no weakening of the evidence layer.

**One factual correction to the brief, not a deviation.** The brief specifies the person relationship as `unified_persons(id, organization_id)`. **`unified_persons` has no `organization_id` column — its tenant column is `company_id`** (confirmed against the live catalog). The correct composite reference is therefore `(person_id, organization_id) → unified_persons(id, company_id)`, which is **exactly** how `source_records_person_tenant_fk` and `source_assertions_person_tenant_fk` already spell it. The established convention was followed rather than a new one invented; the naming asymmetry is pre-existing and was not "corrected".

---

## 2. Pre-migration FK state — VERIFIED

Read from the catalog before anything was changed:

```
prospect_enrichment_attempts_account_id_fkey        cols=1  FOREIGN KEY (account_id)  REFERENCES prospect_accounts(id) ON DELETE CASCADE
prospect_enrichment_attempts_person_id_fkey         cols=1  FOREIGN KEY (person_id)   REFERENCES unified_persons(id)   ON DELETE CASCADE
prospect_enrichment_attempts_organization_id_fkey   cols=1  FOREIGN KEY (organization_id) REFERENCES companies(id)     ON DELETE CASCADE
prospect_enrichment_attempts_source_record_id_fkey  cols=1  FOREIGN KEY (source_record_id) REFERENCES source_records(id) ON DELETE SET NULL
```

Both entity keys **confirmed single-column**. Both existing parent keys **confirmed present, and not recreated**:

```
uq_prospect_accounts_id_org    UNIQUE (id, organization_id)
uq_unified_persons_id_company  UNIQUE (id, company_id)
```

`ON DELETE CASCADE` on both entity legs was recorded as the semantics to **preserve** — the evidence tables use `SET NULL (column_list)` because evidence must outlive its entity, but an *attempt* is a record of work on an entity and has always cascaded with it. Changing that would alter the attempt lifecycle, which is not authorized.

## 3. Preflight data checks — VERIFIED

Against the isolated database only:

| Check | Result |
|---|---|
| total attempt rows | **0** |
| `account_id` belongs to a different `organization_id` | **0** |
| `person_id` belongs to a different `organization_id` | **0** |
| orphaned `account_id` | **0** |
| orphaned `person_id` | **0** |

No incompatible rows, so no STOP was triggered and **no cleanup policy was invented**. The same four checks are embedded in the migration's own preflight, which **RAISEs with the exact counts and changes nothing** if any are non-zero — so applying it to a database that does hold such rows is a loud, safe no-op rather than a silent repair. That matters for any future production application: those rows record provider spend, and what they mean is a question for whoever reads them.

## 4. Migration — IMPLEMENTED

`supabase/migrations/20261120000000_pi_attempt_ledger_tenant_fk.sql` · sha256 `1a426f268fb48d43` · 254 lines, LF, 0 control bytes. Migration census **438 → 439**.

Exactly two constraints are replaced (dropped and re-added — PostgreSQL cannot widen a foreign key's column list in place). Explicitly untouched: `organization_id → companies`, `source_record_id → source_records`, every column, default and CHECK, RLS, and every index — including the live partial unique indexes that arbitrate the lease and the attempt-number uniqueness indexes. No trigger was added; none was needed.

## 5. Post-migration catalog proof — VERIFIED (isolated runtime)

Queried from `pg_constraint`, not read from the migration text:

```
prospect_enrichment_attempts_account_tenant_fk      cols=2  FOREIGN KEY (account_id, organization_id)
                                                              REFERENCES prospect_accounts(id, organization_id) ON DELETE CASCADE
prospect_enrichment_attempts_person_tenant_fk       cols=2  FOREIGN KEY (person_id, organization_id)
                                                              REFERENCES unified_persons(id, company_id)        ON DELETE CASCADE
prospect_enrichment_attempts_organization_id_fkey   cols=1  (unchanged)
prospect_enrichment_attempts_source_record_id_fkey  cols=1  (unchanged)
```

- both composite keys exist, both two-column, both carry `organization_id` as the second leg ✔
- the old single-column entity keys are **absent** ✔
- the referenced parents are the intended tenant-scoped keys ✔
- `ON DELETE CASCADE` preserved on both ✔
- all four lease / attempt-number indexes intact ✔
- **replaying the migration is a no-op** — same catalog, same counts ✔

The attempt ledger now matches the chain it belongs to:

| Table | Composite tenant FKs |
|---|---|
| `source_records` | 2 |
| `source_assertions` | 3 |
| `canonical_attribute_decisions` | 3 |
| **`prospect_enrichment_attempts`** | **2** (was **0**) |

---

## 6. Positive same-tenant cases — VERIFIED

The migration must not break valid enrichment, so all five are driven through the real recorder, lease, executor, adapter, LI-2 persistence and B1b.

| Case | Result |
|---|---|
| **A** tenant A → its own account | `enriched`; attempt 1, source record 1, assertion 1, decision 1; `employee_count = 4200`; cost authorized once; persistence called once |
| **B** tenant B → its own account | `enriched`; `employee_count = 777`; attempt 1, record 1, assertion 1, decision 1 |
| **C** both tenants → the **same external domain** | 4200 and 9999 respectively; one attempt each, in each tenant's own namespace, no contention |
| **D** tenant A → its own person | attempt opened, `person_id` set, `account_id` NULL |
| **E** tenant B → its own person | attempt opened, `person_id` set |

For D and E, the attempt **relationship** is what G-6 governs. Apollo answers no person attribute, so the enrichment itself refuses for an unrelated reason — that is attribute-support territory, not a G-6 concern, and is stated rather than glossed.

Also verified: **a NULL entity leg still satisfies the other composite key.** An account attempt has `person_id` NULL, and under the default MATCH SIMPLE a composite key with any NULL column is satisfied — the same mechanism the evidence tables already rely on. Proven by inserting an account attempt directly and getting `ok`.

## 7–10. Negative cross-tenant cases — VERIFIED

All four combinations, each with the provider wired as a **tripwire**: `safeFetch` throws a distinctive `G-6 VIOLATION` error if reached, so a test that gets to transport fails loudly instead of passing on a technicality.

| Combination | Rejection | Provider | Cost | Credential | Attempt | Evidence | Canonical | Decision |
|---|---|---|---|---|---|---|---|---|
| A → B **account** | `23503` | **never called** | **0 authorized** | **never resolved** | 0 | 0 | unchanged (NULL) | 0 |
| B → A **account** | `23503` | never called | 0 | — | 0 | 0 | unchanged | 0 |
| A → B **person** | `23503` | never called | 0 | never resolved | 0 | 0 | — | 0 |
| B → A **person** | `23503` | never called | 0 | — | 0 | 0 | — | 0 |

**§8 — the exact point of rejection: the attempt INSERT itself.** Proven two ways. Behaviourally, the thrown error is a foreign-key violation and is **not** the tripwire error. Structurally, the row the ledger would write is rejected by the composite key independently of any application code:

```sql
-- the account genuinely exists in ORG_B …
INSERT INTO prospect_enrichment_attempts (organization_id, account_id, …)
VALUES (ORG_A, accB, …);                               -- → 23503
```

**§9 — why the provider cannot be reached.** `executeEnrichmentRecorded` opens the attempt **first**, deliberately and for an unrelated reason (an open row is the evidence a crash leaves behind). The claim is not inside the fail-open try/catch, so a refusal there propagates before adapter resolution, before credential resolution, before cost authorisation and before any egress. That ordering already existed; G-6 simply gave the first step something to refuse. The recorded ports confirm it: `cost` and `credential` were called **zero** times.

For both tenants, after every cross-tenant attempt: `{attempts: 0, records: 0, assertions: 0, decisions: 0}`.

---

## 11. G-3 regression — VERIFIED

The existing G-3 composition suite was run **before** any edit to it:

**15 of 17 passed. The only two failures were the two tests that explicitly pinned the G-6 defect.** Every composition guarantee was unaffected — attempt creation, lease, the A–H Apollo→B1b sequence, the durable pre-transport mark, all five failure paths, CASES 1/2/3/5/6, lease collision, same-tenant isolation and the tenant-scoped lease index.

Those two pins were then **flipped deliberately**. The G-3 report recorded them as *"pinned by two tests — one behavioural, one structural — so the gap is visible and a future fix flips them deliberately rather than discovering them."* This is that flip, and it is the opposite of rewriting tests to make a suite pass: the 15 substantive tests were not touched, and the flip is what demonstrates the fix landed.

- *"…but it DOES record a mis-attributed attempt (G-6)"* → **"a cross-tenant composition is refused at the ATTEMPT boundary (G-6 closed)"**, now with the tripwire and `attemptsFor(accB)` expected to be **0** (was 1).
- *"the attempt ledger lacks the composite tenant FK…"* → **"…now carries the composite tenant FKs the rest of the chain has"**, `prospect_enrichment_attempts` expected **2** (was 0).

**Suites run:**

| Scope | Result |
|---|---|
| G-6 closure suite (new) | **15/15** |
| directly affected: g3 + g6 + apollo slice + b1b arbitration + li2 | **93/93**, 5 suites |
| **every suite touching the attempt ledger** — a4n lease, a4u abandoned recovery, a4y attribute-set identity, a5 execution status, a6a retry horizon, g3, g6 | **126/126**, 7 suites |

The a4n/a4u/a4y/a5/a6a suites are the lease, recovery, work-item-identity, status and retry-horizon guarantees. All green, which is the evidence that narrowing these two foreign keys did not disturb the lease or retry machinery.

## 12. Typecheck — VERIFIED

`npx tsc --noEmit --incremental false -p tsconfig.json` → **0 errors**. Unsurprising: G-6 changed no TypeScript.

## 13. Mutation probes — 3 of 3 KILLED

The invariant lives in the schema, so the mutations are schema mutations. The protocol holds in substance: capture the exact original catalog, mutate meaningfully, require the focused suite to **fail**, restore in `finally` by re-applying the migration, verify the catalog is identical, and **re-run the positive cases** so a probe cannot leave a state that merely looks restored.

The suite was confirmed green (15/15) **before** any probe — a failure proves nothing otherwise.

| # | Mutation | Verdict |
|---|---|---|
| 1 | restore the old single-column **account** FK | **KILLED** — 7 of 15 failed |
| 2 | restore the old single-column **person** FK | **KILLED** — 6 of 15 failed |
| 3 | remove the account tenant coupling **entirely** (no key at all) | **KILLED** — 6 of 15 failed |

`catalog restored identically: True`, and the suite passed again after each restore.

Mutation 3 is deliberately distinct from 1: "remove the `organization_id` component" of a two-column key has no two-column form, so the strongest faithful version is dropping the key outright. Stated plainly rather than presented as a third variant of the same thing.

## 14. Production safety — VERIFIED

| Claim | Evidence |
|---|---|
| No production DB connection | `W6_DB_URL = postgresql://…@127.0.0.1:55432/b1b_closure`; the harness independently refuses managed hosts, and the migration was applied only via local `psql` to that database |
| No production migration | `20261120000000` applied **only** to the scratchpad database. No `supabase db push`, no Studio, no pooler |
| No provider credential | the only credential present is `synthetic-tenant-apollo-key`; this worktree has **no `.env.local`** — only `.env.test` and two `.example` files |
| No provider call | `safeFetch` mocked throughout; on cross-tenant tests it is a tripwire that was never fired |
| No deployment / Vercel / Railway / GitHub mutation | none of those tools was invoked |
| No flag change | no `.env*` written |
| Docker | never started; `docker ps` fails at start and end |
| Isolated server stopped | no PID file, 0 processes, 0 listeners on 55432 |
| Production ports unreachable in tests | `makeProductionEnrichmentPorts` is stubbed to **throw**, so a silent fallback to the real credential store would fail loudly |

## 15. Files changed, with hashes

**Changed by G-6 — one migration, two test files:**

```
1a426f268fb48d43  supabase/migrations/20261120000000_pi_attempt_ledger_tenant_fk.sql   NEW
53c8f9c235616d52  backend/tests/realschema/b2_g6_attempt_tenant_fk.test.ts             NEW (15 tests)
6430141fb3354abd  backend/tests/realschema/b2_g3_attempt_composition.test.ts           two pins flipped
```

All LF, 0 control bytes.

**Implementation files — verified unchanged by content hash, not by `git status`:**

```
4c3237a8fbcb9585  backend/services/prospectIdentity/ingestionBoundary.ts   ← required value, confirmed
                  full: 4c3237a8fbcb9585c5dd8ef9639daaeb8c3e064d75d71c3246cc2296a744ce43
a6d3c35cf36ac3ad  backend/services/prospectIdentity/attributeAuthority.ts
fb484a41aa6c8d0b  backend/services/enrichment/recordedExecution.ts
af9a772af98adcb2  backend/services/enrichment/attempts.ts
ee4217e213cd28eb  backend/services/enrichment/providers/execute.ts
5b3da65e617b7590  backend/services/enrichment/providers/adapters/apollo.ts
4c767b405f0b4979  backend/services/enrichment/providers/persistence.ts
bfe068f0fa8111fd  backend/services/enrichment/providers/contract.ts
ab50ba643f883c60  backend/services/enrichment/providers/registry.ts
aa3fff36c064680f  backend/services/enrichment/productionPorts.ts
```

Every one matches the value recorded in the B2 and G-3 reports. **G-6 required no application change**: the defect was entirely in the schema, and the ordering that makes the fix effective — attempt first, provider later — was already there.

Nothing committed, nothing pushed.

## 16. Unrelated findings — all DEFERRED

| # | Finding | Status |
|---|---|---|
| **G-1** | `providerInferred` does not survive into the assertion | **DEFERRED** — not fixed, no migration, evidence schema not widened |
| **G-2** | `providersFor()` is unreachable and `executeEnrichment`'s JSDoc points future callers at it | **DEFERRED** — recorded, unchanged |
| **G-4** | No tenant Apollo credential anywhere; real execution is a separate operational gate | **DEFERRED** — none added |
| **G-5** | Four further Apollo attributes deliberately unmapped | **DEFERRED** — none mapped |
| — | The brief's `unified_persons(id, organization_id)` is `(id, company_id)` | **Corrected in place**, following the existing convention (§1) |
| — | `rls_anon_exposure` fails in this cluster (`role "postgres" does not exist`) | **Environmental**, pre-existing, unrelated — not re-run here |

No unrelated defect was discovered, and none was opportunistically fixed.

---

## Completion criteria — all fifteen

| # | Criterion | Met |
|---|---|---|
| 1 | composite account FK exists | ✔ |
| 2 | composite person FK exists | ✔ |
| 3 | old single-column FKs absent | ✔ |
| 4 | isolated runtime schema confirms both | ✔ (catalog query) |
| 5 | same-tenant account enrichment works | ✔ Cases A, B |
| 6 | same-tenant person enrichment works | ✔ Cases D, E |
| 7 | cross-tenant account fails at the attempt boundary | ✔ both directions |
| 8 | cross-tenant person fails at the attempt boundary | ✔ both directions |
| 9 | provider never called for cross-tenant cases | ✔ tripwire never fired |
| 10 | no attempt survives the invalid relationship | ✔ 0 rows, both tenants |
| 11 | no cost authorized for the rejected attempt | ✔ 0 calls; credential never resolved |
| 12 | no source / evidence / canonical / decision mutation | ✔ all zero |
| 13 | existing G-3 composition remains green | ✔ 15 untouched tests; 2 pins flipped deliberately |
| 14 | probes kill the removed-tenant-scope mutations | ✔ 3/3 |
| 15 | production untouched | ✔ §14 |

---

# G-6 CLOSED — G-3 CLOSED

The enrichment attempt ledger is tenant-coupled, a cross-tenant attempt is refused **before** the provider is reached, and no valid same-tenant enrichment was disturbed. Verified in the **isolated runtime** and in the **repository**; **production is not verified and was not touched** — applying `20261120000000` beyond the scratchpad remains a separate, owner-driven step, alongside the still-unapplied `20261119000000`.

**STOP.** No B3, B4 or B10. No G-1, G-2 cleanup, G-4 real-provider execution or G-5 attributes. No second provider.
