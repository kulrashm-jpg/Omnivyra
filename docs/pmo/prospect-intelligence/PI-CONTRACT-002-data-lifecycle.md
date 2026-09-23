# PI-CONTRACT-002 — PI data lifecycle governance

**Status:** CONTRACT PREPARED — **AWAITING POLICY DECISIONS.** Nothing is implemented.
**Base SHA:** `a07477e4` · **Prepared:** 2026-09-23
**Scope:** retention · erasure · suppression interaction · provenance · staleness · tenant isolation · auditability · provider-originated data · re-enrichment after deletion · contactability.

Prospect Intelligence holds **third-party personal data** — people who are not the tenant's users and have no account. No document in this programme has previously addressed its lifecycle. This contract states the obligations, the structural facts that constrain any answer, and the decision points. **It invents no legal or compliance policy.**

---

## 1. Current state — every lifecycle capability is ABSENT

| Capability | State at `a07477e4` | Evidence |
|---|---|---|
| Retention policy covering any PI table | **ABSENT** | `backend/types/retention.ts:1-12` — `RETENTION_TARGETS` is a closed 10-member list; `:51-65` bindings name 9 physical tables. **No PI table appears in either.** |
| Right-to-erasure path | **ABSENT** | No match for `erasure`, `gdpr`, `right_to_be_forgotten`, `deletePerson`, `erasePerson`, `data_subject`, `anonymi[sz]` outside marketing copy |
| Subject-access export | **ABSENT** | The only export is `pages/api/lead-intelligence/export.ts` — a tenant-level lead CSV, reading none of the identity tables |
| Any person-deletion path at all | **ABSENT** | 9 non-test `ownedDbTable('unified_persons')` call sites, **all SELECT/INSERT/UPDATE, zero DELETE**. `pages/api/prospects/[id].ts` is GET-only. No DELETE route exists anywhere under `pages/api/prospect*` |
| Lifecycle job touching PI identity data | **ABSENT** | No job in `backend/jobs/` deletes or ages PI data |
| Merge executor | **ABSENT by design** | `merge_unified_persons(...)` exists in SQL (`20260506000002`) with no TypeScript caller; `personDuplicates.ts:296-299` refuses `'merged'` |
| Staleness as stored evidence | **ABSENT** | No `freshness`/`stale_at`/`expires_at` column on `source_records` or `source_assertions`; staleness is a caller-supplied window only |
| Assertion retirement | **ABSENT** | `source_assertions.superseded_at` is **read** (`ingestionBoundary.ts:418`) and **never written** by any production file |

**One near-miss worth naming.** `dsar` exists in `execution/suppressionService.ts:63,79,96` — but as a **suppression reason**, mapped by `toGovernanceType()` into `dnc_permanent`/`dnc_channel`. Its own comment says *"an erasure request is a standing instruction never to contact."* That is a defensible treatment of the contactability half of a DSAR and it is **not erasure**. Nothing is deleted. Anyone reading `dsar` in the codebase and concluding the platform handles erasure would be wrong.

---

## 2. The structural obstacle — the database actively resists deletion

This is the finding that shapes everything below. Even with an erasure path written, a `DELETE FROM unified_persons` today would fail or do harm. From `supabase/_schema/baseline.sql`, 17 inbound FKs:

| Class | Constraint | Effect of deleting a person |
|---|---|---|
| **Hard block** | `lead_intelligence_person_tenant_fk` — `ON DELETE RESTRICT` | Aborts outright if any `lead_intelligence` row references the person |
| **Effective block** | `leads_person_tenant_fk` — `SET NULL (unified_person_id)` against a **NOT NULL** column | `23502`. This is **DEFECT-003** |
| **Effective block (new)** | `contact_governance_person_tenant_fk` — `SET NULL (person_id)` against CHECK `contact_governance_has_anchor` | `23514` if the record is person-anchored only. This is **DEFECT-008**, recorded below |
| **Silent evidence loss** | `identity_claims_person_tenant_fk` — **CASCADE** | Destroys every identity claim about the person |
| **Silent audit loss** | `unified_person_merges_{winner,loser}_tenant_fk` — **CASCADE** | Destroys the merge audit trail naming them |
| Benign | 13 further FKs — `SET NULL` against nullable columns | Severs links, retains rows |

There is also **no soft-delete path**: `unified_persons` has the lifecycle vocabulary `active | merged | suppressed | archived` (`personDuplicates.ts:45`) and **no code ever sets `archived` or `suppressed`**.

### DEFECT-008 (new, latent) — governance anchor versus person deletion

`contact_governance_records.person_id` carries `ON DELETE SET NULL (person_id)`, deliberately, *"so governance outlives the person"* (`20261003000000_li3_contact_governance.sql:190-197`). But `contact_governance_has_anchor` requires `person_id IS NOT NULL OR target_normalized IS NOT NULL`. PostgreSQL validates CHECK constraints on the UPDATE that `SET NULL` performs.

**So a person-anchored-only governance record makes the person undeletable (`23514`) — and the design intent that governance should outlive the person is defeated in exactly the case it was written for.** Structurally identical to DEFECT-003, one constraint class over.

**Evidence status — stated precisely.** The FK (`ON DELETE SET NULL (person_id)`), the CHECK (`contact_governance_has_anchor`) and their collision are **observed** in `20261003000000_li3_contact_governance.sql`. The resulting `23514` is **reasoned** from PostgreSQL's CHECK-on-UPDATE semantics and has **not been executed**. Proving it needs a `backend/tests/realschema/` case against the disposable container — deferred, and recorded as work item **DL-7**. Do not cite this defect as proven until that runs.

**Latent, not live:** `contact_governance_records` is believed empty (UNVERIFIED, pending PROD-1) and no deletion path exists. It becomes real the moment either changes.

**⚠ This makes `POLICY-1`'s anchor decision load-bearing here.** If unsubscribes are anchored to the person only, every unsubscribed person becomes permanently undeletable. **Target-anchored, or both, keeps erasure possible.** The two contracts must be decided together.

---

## 3. The contract, by obligation

### 3.1 Retention
PI data must have a stated retention period per category, or a stated reason for indefinite retention. Three categories behave differently and must not share one policy:
- **Identity** (`unified_persons`, `identity_claims`) — the person
- **Evidence** (`source_records`, `source_assertions`) — what a source asserted and when
- **Governance** (`contact_governance_records`) — must outlive both; a suppression that expires is worse than none

*Structural note:* `retentionService` filters on `organization_id`, while `unified_persons`, `canonical_leads` and `leads` use `company_id`. Extending the existing service to PI is not a list edit — it needs a tenant-column indirection.

### 3.2 Erasure
An erasure request must have a defined, tested, auditable path. It must decide, per table, between **delete**, **anonymise** and **retain-with-tombstone**, and it must not silently CASCADE away evidence or audit (§2).

Erasure and suppression are in tension and the tension must be resolved explicitly: *if you erase the person, how do you remember not to contact them?* The existing `SET NULL (person_id)` design answers this — governance survives, anchored to the target — but **only if a target anchor exists** (§2, DEFECT-008).

### 3.3 Suppression interaction
Suppression must survive erasure. `contact_governance_records` is append-only and revocation-based, never deleted — that property must be preserved by any lifecycle job.

### 3.4 Provenance
`source_records.raw_payload` holds the provider's original response, redacted only for secrets (`ingestionBoundary.ts:104-121`). It is the audit trail *and* a copy of personal data. Retention and erasure must state what happens to it. Note `source_assertions_record_tenant_fk` is **CASCADE** — deleting a `source_record` destroys its assertions.

### 3.5 Staleness
Freshness is not stored (§1). Provider terms commonly require refresh-or-delete after a period; the platform currently cannot express "this attribute is too old to use" as data, only as a caller's window. Whether staleness becomes stored evidence is an architecture decision with a migration.

### 3.6 Tenant isolation
Already strong: composite tenant-safe FKs, tenant-first predicates, in-memory re-filters. Erasure must be **per tenant** — the same human in two tenants is deliberately two rows, and erasing one must not touch the other.

### 3.7 Auditability
An erasure must itself be auditable without retaining what was erased — a tombstone recording that a request was honoured, when, and its scope, with no personal data. No such record type exists today.

### 3.8 Provider-originated data
Apollo and Clearbit data arrives under **their** terms, which may impose retention limits and deletion-propagation obligations the platform has never enumerated. Note credentials are per-tenant, so the contracting party may be the tenant, not Omnivyra — which changes who owes the obligation.

### 3.9 Re-enrichment after deletion
The sharpest operational trap: nothing stops a deleted person being re-created by the next import or enrichment, because identity resolution is deterministic on email/phone. **Erasure without a suppression tombstone is temporary.** Note the executor's duplicate-suppression window reads `source_assertions` — which erasure may have removed, so a re-enrichment would also be re-billed.

### 3.10 Contactability
A DSAR objection-to-processing is already handled as permanent suppression (§1). That treatment should be confirmed or corrected by counsel, not by engineering.

---

## 4. Decision points — `POLICY-4`

Engineering states the structure; these are business, legal and compliance calls.

| # | Decision | Notes |
|---|---|---|
| 1 | Retention period per category — identity, evidence, governance | Governance likely indefinite; the other two need a number or a stated reason |
| 2 | Erasure semantics per table — delete / anonymise / tombstone | §2 shows delete is currently impossible for several |
| 3 | **Does an erasure leave a suppression tombstone?** | If no, §3.9 makes erasure temporary. Strongly interacts with `POLICY-1` |
| 4 | Is a subject-access export owed, and what does it contain | None exists |
| 5 | Provider deletion-propagation obligations | Requires reading Apollo/Clearbit terms; may be the tenant's obligation |
| 6 | Staleness policy — refresh-or-delete, and whether freshness becomes stored | Implies a migration |
| 7 | Who may trigger an erasure, and under what verification | Note `IDENTITY_ADMIN_ASSIGN`-class actions already require step-up; no PI route uses step-up today |
| 8 | Lawful basis for holding third-party contact data per jurisdiction | Squarely legal; gates whether this is a compliance fix or a product change |

---

## 5. Sequencing

**This gets structurally harder the moment real rows exist**, and the current emptiness is an asset that will not last.

1. **Now, while tables are empty:** close DEFECT-003 and DEFECT-008. Both are `SET NULL` against a constraint that forbids the null, both are cheap now and become data migrations across append-only, trigger-protected tables later.
2. **Before the first real import:** decide `POLICY-1` and `POLICY-4` #3 together — they jointly determine whether erasure is possible at all.
3. **Before a second tenant:** the erasure path, tested.
4. **Deferred:** subject-access export, staleness-as-data, provider propagation.

---

## 6. Work items created

| ID | Item | Class |
|---|---|---|
| **DL-1** | Close DEFECT-003 and DEFECT-008 — additive migrations, authored not applied | REQUIRED NOW |
| **DL-2** | Erasure path: per-table semantics, tombstone, tenant scoping, audit record | Blocked on POLICY-4 #1–#3 |
| **DL-3** | Extend retention to PI, incl. the `organization_id`/`company_id` indirection | Blocked on POLICY-4 #1 |
| **DL-4** | Subject-access export | Blocked on POLICY-4 #4 |
| **DL-5** | Staleness as stored evidence | Blocked on POLICY-4 #6; needs a migration |
| **DL-6** | Write `source_assertions.superseded_at`, closing DEFECT-006 | REQUIRED LATER — independent of policy |
| **DL-7** | Real-schema test proving (or disproving) DEFECT-008's `23514` against the disposable container | REQUIRED NOW — the defect is reasoned, not executed |

---

## 7. No-code confirmation

No application code, schema, migration, flag, provider or production data was changed. This document states a contract and identifies decisions; it implements nothing.
