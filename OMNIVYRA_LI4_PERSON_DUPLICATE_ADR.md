# OMNIVYRA LI-4 — CANONICAL PERSON DUPLICATE, PARKING & MERGE ADR

| | |
|---|---|
| **Status** | PROPOSED — decision record only. Nothing here is implemented. |
| **Phase** | Authored in LI-4B. Implementation belongs to LI-4C. |
| **Supersedes** | nothing |
| **Binding on** | LI-4C and every later phase that touches person identity |
| **Source of truth** | LI-4A Lead Ingestion Foundation Audit; W1–W5 identity spine; LI-1 attributes; LI-2 provenance; LI-3 contact governance |

---

## 0. The problem, stated exactly

`unified_persons` deduplicates by two database constraints, both tenant-scoped:

- `idx_unified_persons_company_email_unique` — UNIQUE `(company_id, primary_email)` WHERE email IS NOT NULL
- `idx_unified_persons_company_phone_unique` — UNIQUE `(company_id, primary_phone)` WHERE phone IS NOT NULL AND `length ≥ 10`

`resolveUnifiedPerson` matches in a fixed order — **email → phone → external_keys → create** — and is deterministic. There is no fuzzy matching anywhere, and this ADR does not introduce any.

That gives one guarantee and leaves two holes:

1. **A definite duplicate is absorbed silently.** A second CRM row for a known email resolves onto the existing person. Nothing is surfaced, nothing is reviewable. The LI-4A audit's requirement — *a duplicate must NOT simply disappear* — is unmet.
2. **A person created from disjoint identifiers can never be unified.** Apollo supplies email-only; LinkedIn supplies phone-only. Neither matches the other, so two persons exist. When a CRM row later arrives carrying **both**, it resolves onto whichever matches first and the two remain permanently separate. There is no merge.

`prospect_accounts` already solved the equivalent problem for companies: `status ∈ {active, merged, suppressed, archived}`, `merged_into_id` with a self-FK, a `merge_coherent` CHECK and a `no_self_merge` CHECK. **`unified_persons` has none of this.** This ADR closes that asymmetry by reusing the proven shape rather than inventing a second one.

---

## 1. Decisions

| ID | Decision |
|---|---|
| **D-1** | **Person identity remains strictly tenant-scoped.** The same human in two tenants is two `unified_persons` rows, permanently. No platform-global person, no cross-tenant merge, ever. |
| **D-2** | **Merge is a tenant decision, never an automatic one.** Only a *definite* duplicate may be auto-linked, and even then it is **parked for review**, not merged. Probable and possible duplicates are surfaced and never acted on without a tenant instruction. |
| **D-3** | **Merge is a link, not a deletion.** The losing person survives with `status='merged'` and `merged_into_id` set. Its identity, provenance and governance remain readable forever. |
| **D-4** | **Governance survives merge unconditionally.** A DNC attached to either side continues to block. Merge may never reduce suppression coverage. |
| **D-5** | **Detection is deterministic.** Email, phone and provider identifiers only. No scoring model, no probabilistic matcher, no name-similarity auto-merge. |
| **D-6** | **Parking reuses LI-2, it does not replace it.** `source_records` already supports evidence with no canonical link — that is the parking primitive. |

---

## 2. Canonical person lifecycle states

`unified_persons.status`, mirroring `prospect_accounts` exactly:

| State | Meaning | Resolvable? | Contactable? |
|---|---|---|---|
| `active` | The canonical person. Default. | yes | subject to governance |
| `merged` | Superseded by another person in the same tenant. `merged_into_id` NOT NULL. | **no** — resolution follows the pointer | no (the survivor is) |
| `suppressed` | Retained, must not be contacted or enriched. A tenant decision distinct from a DNC. | yes | **no** |
| `archived` | Retained for audit, out of working scope. | no | no |

**Invariants (as CHECK constraints, following the account precedent):**

- `unified_persons_merge_coherent` — `(status = 'merged') = (merged_into_id IS NOT NULL)`
- `unified_persons_no_self_merge` — `merged_into_id IS NULL OR merged_into_id <> id`
- `unified_persons_status_valid` — `status IN ('active','merged','suppressed','archived')`

**`merged_into_id` behaviour:** self-referencing FK, **tenant-safe composite** `(merged_into_id, company_id) → unified_persons(id, company_id)` using the existing `uq_unified_persons_id_company`. This makes a cross-tenant merge **impossible at the database level**, which is the only place D-1 can be genuinely enforced.

> **AMENDED BY LI-4C.1 — see §15.** This clause originally specified
> `ON DELETE SET NULL (merged_into_id)`, which is **incompatible** with
> `unified_persons_merge_coherent`: an FK action can null the pointer but cannot
> also change `status`, so the CHECK rejects the delete. The corrected action is
> **`ON DELETE NO ACTION`**. The bidirectional CHECK above is **retained
> unchanged**.

**Chain resolution:** merge pointers must be followed to a terminal `active` person, with a depth cap. A cycle is a bug; the resolver must detect and refuse rather than loop. Re-merging an already-merged person is a no-op that returns the existing terminal survivor.

---

## 3. Duplicate classification

| Class | Definition | Detection | Default action |
|---|---|---|---|
| **DEFINITE** | Same `company_id` + same normalized email, **or** same `company_id` + same normalized phone (`length ≥ 10`) | The two existing unique indexes. A collision is definite by construction. | **Cannot occur post-hoc** — the index prevents it. Arises only during merge candidacy (§4). |
| **PROBABLE** | Same `company_id` + same `account_id` + same normalized `full_name`; **or** two persons sharing a provider identifier in `external_keys` | Deterministic equality on normalized values | **PARK for review.** Never auto-merged. |
| **POSSIBLE** | Same `company_id` + same `account_id` + same `last_name` + same `job_title`; or same account + email local-part equality | Deterministic equality only | **PARK for review, lowest priority.** Never auto-merged. |

**No weighting, no confidence score, no threshold.** A rule either matches exactly or it does not. Introducing a similarity score would make merge decisions unexplainable to the tenant who has to defend them — and would make silent merging tempting, which D-2 forbids.

**Normalization is reused, never redefined:**
- Email — `normalizeEmail` (trim + lowercase). The existing rule. No gmail dot-stripping, no plus-address folding: those are provider-specific policies that would silently merge distinct mailboxes.
- Phone — `normalizePhone` (digits, leading `+` preserved). The `length ≥ 10` floor of the existing index is retained so short extensions never collide.
- Provider identifiers — `external_keys` jsonb, compared as exact `(provider, key)` pairs.

---

## 4. Where duplicates actually come from

Because the unique indexes already prevent two active persons sharing an email or phone **within a tenant**, a definite duplicate cannot be created by normal ingestion. Duplicates arise from exactly three situations, and the model must name them:

1. **Disjoint-identifier split.** Person A (email only), Person B (phone only). A later source asserts both. → The arriving evidence is a **merge candidate**, classified DEFINITE-on-arrival, and is **parked**, not applied.
2. **Enrichment collision.** Enrichment would set B's email to a value A already holds. The unique index raises `23505`. → Must be caught and converted into a parked merge candidate, **never** a swallowed error and never an overwrite.
3. **Tenant-asserted duplicate.** A human says "these two are the same person."

---

## 5. Parking and the review queue

**Staging model.** No new lead table (LI-4A found six already; a seventh is forbidden). Two additions only:

- `unified_persons.status` / `merged_into_id` (§2)
- **`person_duplicate_candidates`** — the review queue

**Why LI-2 is the parking primitive:** a `source_records` row may already exist with `person_id IS NULL`. Evidence that cannot be safely applied is therefore *already* parkable, with full provenance, without inventing a staging table. LI-2's own comments name this as what makes an LI-4 review queue possible. The queue table records the *decision to be made*; `source_records` retains the *evidence*.

**`person_duplicate_candidates` (proposed):**

| Column | Notes |
|---|---|
| `id` | uuid PK |
| `organization_id` | uuid NOT NULL → `companies(id)`. TENANT. |
| `person_id` | uuid NOT NULL — the person under review |
| `candidate_person_id` | uuid NULL — the other person, when one exists |
| `source_record_id` | uuid NULL — the arriving evidence, when the candidate came from ingestion |
| `classification` | `definite` \| `probable` \| `possible` |
| `matched_on` | `email` \| `phone` \| `external_key` \| `name_account` \| `title_account` |
| `status` | `open` \| `merged` \| `retained` \| `dismissed` \| `deleted` |
| `resolved_by` / `resolved_at` / `resolution_reason` | the mandatory audit trail |
| `created_at` | |

Both person references use the **composite tenant-safe FK** `(x, organization_id) → unified_persons(id, company_id)`. A candidate spanning two tenants is refused by the database.

**Uniqueness — one open review per pair:**

```
UNIQUE (organization_id, least(person_id, candidate_person_id),
                        greatest(person_id, candidate_person_id))
  WHERE status = 'open' AND candidate_person_id IS NOT NULL
```

Ordered by `least`/`greatest` so (A,B) and (B,A) are the same review. **This index is PARTIAL, so `ON CONFLICT` cannot infer it — `42P10`.** Persistence must be **INSERT → catch `23505` → re-resolve**, exactly as W3, LI-2 and LI-3D do. This is stated here so it is not rediscovered for a sixth time.

---

## 6. Tenant actions and the audit trail

| Action | Effect | Reason required |
|---|---|---|
| **Review** | Read-only. Sees both persons, their assertions and their provenance. | no |
| **Retain** | Both persons stay `active`. Candidate → `retained`. Re-detection must not immediately re-raise it. | **yes** |
| **Merge** | Loser → `status='merged'`, `merged_into_id` = survivor. Candidate → `merged`. | **yes** |
| **Dismiss** | Not a duplicate. Candidate → `dismissed`; the pair is suppressed from future detection. | **yes** |
| **Delete** | Person → `archived`, never row-deleted. Governance and provenance survive. | **yes** |

`resolution_reason` is NOT NULL whenever `status <> 'open'`, enforced by CHECK — the LI-3 revocation precedent, where a revocation without a reason was ruled an unusable audit record.

**Deletion is never a row delete.** A person is the anchor for governance, provenance and lead history. Hard deletion would orphan a DNC — the exact outcome LI-3's D-3 exists to prevent. A DSAR erasure is a separate, legally-governed process and is explicitly **out of scope** here (see §12).

---

## 7. What happens to the losing person's data

| Artifact | Behaviour on merge |
|---|---|
| **Identity record** | **Survives.** The row is retained with `status='merged'`. Its `primary_email`/`primary_phone` are **not** moved — moving them would free the unique index and permit a third person to claim the address. |
| **`identity_claims`** | Survive, unchanged, still pointing at the merged person. They are historical fact. |
| **`source_records`** | **Stay attached to the person they described.** Re-pointing them would falsify the record of what each source actually observed. |
| **`source_assertions`** | Unchanged and append-only. After merge, the survivor's canonical view is computed over the assertions of **both** persons; a disagreement between them is a Rule-B disagreement and is **withheld**, not resolved. LI-2's rules are not modified. |
| **`contact_governance_records`** | **Both persons' governance continues to apply to the survivor.** This is D-4. |
| **Leads / canonical_leads / contacts** | Continue to reference the merged person. Reads resolve through `merged_into_id`. Bulk re-pointing is explicitly **not** required and is discouraged — it rewrites history. |

---

## 8. Cross-tenant behaviour

| Scenario | Required behaviour |
|---|---|
| Same real person in Tenant A and Tenant B | **Two independent persons.** Never a candidate, never a merge. |
| Same email in two tenants | Two persons. The unique index is `(company_id, primary_email)`, so both are legal. |
| Same phone in two tenants | Two persons. Same reasoning. |
| Tenant A merges | Invisible to B. No shared state. |
| Cross-tenant duplicate candidate | **Impossible** — refused by the composite FK, not merely by application code. |

Detection queries must place `organization_id` as the **first predicate**, matching the pattern LI-3C established for the governance repository.

---

## 9. Interaction with adjacent systems

**Enrichment (LI-2).** Enrichment must pass a **known `personId`** and must never call `resolveUnifiedPerson` with newly discovered contact details — that is how enrichment silently creates a second person. When enrichment would set a value that collides on a unique index, the `23505` becomes a **parked merge candidate**. Enrichment never merges.

**Governance (LI-3).** Unchanged. `mayContact()` is not modified. Path B is not repointed. The single required addition at LI-4C: governance lookup for a person must consider the **merge chain**, so a DNC on a merged person still blocks the survivor. Until that exists, merging could reduce suppression coverage — so **merge must not ship before that lookup does.**

**Readiness.** Only `active` persons are readiness-eligible. `merged`, `suppressed` and `archived` are excluded. Readiness computes over the canonical model, **not** over `leads` — `leads.email` is `NOT NULL`, so a phone-only prospect cannot exist there.

**Platform intelligence.** Aggregate merge/duplicate *rates* (duplicate rate by provider, merge frequency, detection precision) are legitimate platform intelligence. Individual persons, emails, phones, candidate pairs and resolution reasons are **tenant-owned and must never cross a tenant boundary**. No tenant person tables may be joined to produce platform metrics.

**Lead carrier — DECISION DEFERRED.** LI-4A found six overlapping models (`leads`, `canonical_leads`, `lead_intelligence`, `canonical_users`, `active_leads`, `contacts`). This ADR **does not choose** one and adds none. The choice is required before readiness ships and is assigned to the readiness phase. Recorded here so it is not decided by accident.

---

## 10. Concurrency

- Candidate creation: **INSERT → catch `23505` → re-resolve** against the partial index (§5). No SELECT-then-INSERT.
- Merge: must take a deterministic lock order (lowest uuid first) so two concurrent merges of the same pair cannot deadlock or produce a cycle.
- Concurrent merge of A→B and B→A: exactly one wins; the loser observes the pointer and becomes a no-op returning the terminal survivor.
- Resolution of an already-resolved candidate is idempotent and must not overwrite the original `resolved_by` / `resolution_reason`.

## 11. Re-import behaviour

Re-importing an identical source record is already idempotent at LI-2 (`source_records` collides on `23505`; assertions dedupe by value hash). A re-import must therefore **not** raise a fresh duplicate candidate. A pair previously `retained` or `dismissed` must not be re-raised by the same evidence — otherwise the queue fills with decisions the tenant already made. Re-raising is permitted only when **new** evidence changes the classification (e.g. `possible` → `definite`).

---

## 12. Non-goals

Explicitly **not** in this ADR, and not to be inferred from it:

1. Fuzzy, phonetic or ML-based matching of any kind
2. Automatic merging without tenant instruction
3. Cross-tenant identity, cross-tenant merge, or a global person registry
4. A seventh lead model
5. Account/company duplicate handling (already solved in `prospect_accounts`)
6. Hard deletion of a person row
7. DSAR / right-to-erasure mechanics — legally governed, separate decision
8. Merge of `contacts`, `canonical_users` or `leads` rows
9. Any change to `mayContact()`, Path A or Path B
10. Provider precedence or confidence weighting (still deferred to LI-6)
11. Readiness computation
12. UI

---

## 13. Migration and rollback strategy

**Migration (LI-4C), additive only, in `supabase/migrations/` with a rollback artifact in `supabase/migrations/rollbacks/`:**

1. `ALTER TABLE unified_persons ADD COLUMN status text NOT NULL DEFAULT 'active'` — every existing row is `active`, so the default is the entire backfill.
2. `ADD COLUMN merged_into_id uuid` (nullable).
3. Add the three CHECK constraints (§2). All hold trivially at `status='active'` / `merged_into_id IS NULL`.
4. Add the composite tenant-safe self-FK with **`ON DELETE NO ACTION`** (amended by LI-4C.1, §15).
5. `CREATE TABLE person_duplicate_candidates` with its composite FKs, CHECKs, partial unique index and RLS.
6. Postconditions: table exists, constraint count as expected, and **both new structures empty on arrival**.

`db push` is forbidden. The migration must replay in the real-schema CI container before production.

**Rollback:** drop `person_duplicate_candidates`; drop the FK and CHECKs; drop `merged_into_id` and `status`. Lossless **only while no person has been merged** — once `merged_into_id` is populated, dropping it destroys the merge history. **Therefore: rollback is safe only before the first merge, and the runbook must say so rather than claim general reversibility.** Rollback must be tested, not asserted.

**Sequencing constraint:** §9 requires the governance merge-chain lookup to exist before any merge is permitted. LI-4C may ship schema and detection with merge **disabled**; enabling merge is a separate, gated step.

---

## 14. Open questions requiring a decision outside engineering (continued below)

| ID | Question |
|---|---|
| Q-1 | Retention period for `merged` and `archived` persons. |
| Q-2 | Whether a DSAR erasure may remove a person who is the anchor of a DNC created *by* that DSAR. (Mirrors LI-3's unresolved L-4.) |
| Q-3 | Whether `suppressed` at person level and a `dnc_permanent` governance record are operationally distinct, or whether one should imply the other. |
| Q-4 | Whether a tenant may un-merge. This ADR assumes **no**; the survivor's canonical state has already absorbed both sides' assertions. |

---

## 15. AMENDMENT LI-4C.1 — merge survivor deletion semantics

| | |
|---|---|
| **Status** | ACCEPTED — supersedes the `ON DELETE` action stated in §2 |
| **Raised by** | LI-4C implementation, which proved the contradiction rather than working around it |
| **Scope** | The FK action on `unified_persons.merged_into_id`, and nothing else |

### 15.1 The contradiction

§2 originally required both:

1. `unified_persons_merge_coherent` — `(status='merged') = (merged_into_id IS NOT NULL)`
2. `ON DELETE SET NULL (merged_into_id)`

These cannot both hold. When a survivor is deleted, PostgreSQL performs the
referential action as an **UPDATE** that sets `merged_into_id = NULL`. A
referential action **cannot also change `status`**, which remains `'merged'`.
The row then violates the bidirectional CHECK and the DELETE aborts with
`23514`.

The stated rationale — *"deleting a survivor does not cascade away the merged
record's tenant"* — was therefore never achieved. Deleting a survivor was simply
impossible.

**The same defect is already live in `prospect_accounts`** (W4), which carries
the identical CHECK plus a bare `ON DELETE SET NULL`. Verified empirically
against the production-derived schema: survivor deletion returns `23514`.

### 15.2 Decision

**OPTION B, specified as `ON DELETE NO ACTION`** — not `RESTRICT`.

The bidirectional CHECK in §2 is **retained unchanged**. Only the referential
action changes.

`NO ACTION` rather than `RESTRICT` is load-bearing, not stylistic.
`unified_persons.company_id` is `ON DELETE CASCADE` from `companies`, so
deleting a tenant deletes all of its people in one operation. `RESTRICT` is
checked **immediately** and would abort that cascade the moment it removed a
survivor that another person pointed at — meaning **a tenant with any merged
person could not be deleted**. `NO ACTION` is checked at **end of statement**,
by which time the referencing row has also been deleted, so the cascade
succeeds. Both give the identical guarantee against dangling references.

### 15.3 Why not Option A

Option A would have relaxed the CHECK to the one-way implication
`merged_into_id IS NOT NULL → status='merged'`, permitting an *orphaned merged*
row (`status='merged'`, pointer NULL).

It was rejected for a reason that only became clear on close inspection: **a
CHECK constraint is row-level, not transition-level.** Under the relaxed
invariant, `UPDATE ... SET status='active'` on an orphaned row satisfies the
implication vacuously — so **an orphaned merged person could be silently
reactivated and become contactable again**. Closing that hole would require a
transition-enforcing TRIGGER, which is new mechanism this ADR does not have.

Option A also **breaks the merge chain** that D-4 depends on: an orphaned row
has no survivor, so a governance lookup following the chain has nothing to
resolve to, and a DNC held by the orphan protects no one.

### 15.4 Why not Option C

Option C would perform survivor deletion through an application transaction that
clears the pointer, adjusts `status`, then deletes. It was rejected because it
moves an integrity guarantee out of the database and into code that the
service-role client can bypass — the posture this programme has repeatedly
rejected — and because it requires building merge/deletion execution while
**merge is deliberately disabled** pending D-4's governance chain lookup.

### 15.5 Survivor deletion semantics

- A person that others have merged into **cannot be deleted directly**. The
  attempt fails with `23503`, plainly and immediately.
- Deleting such a survivor requires first, and explicitly, deciding what happens
  to the records pointing at it. That decision is consequential and must not be
  a side effect of a DELETE.
- **Tenant deletion still works.** A `companies` cascade removes the survivor and
  the merged rows in the same statement, and `NO ACTION` is satisfied at end of
  statement.

### 15.6 Orphaned merged records

**They cannot exist.** Under this amendment every `status='merged'` row has a
live survivor in the same tenant, at all times. The merge chain is always
complete.

**Safety question, answered unambiguously:** the state
`status='merged' AND merged_into_id IS NULL` is **unreachable** for
`unified_persons` — the CHECK forbids it and no referential action can produce
it. The question "can such a person become active again" therefore does not
arise. The same answer applies to `prospect_accounts` once §15.8 is applied;
today that state is likewise unreachable there, because the delete that would
create it fails.

A merged person can be returned to `active` **only** by a deliberate single
statement setting `status='active'` and `merged_into_id=NULL` together. No
referential action, cascade, deletion or application code path produces it, and
no merge executor exists. Whether un-merge should ever be permitted remains
open — see Q-4.

### 15.7 Governance implication (D-4 preserved and strengthened)

D-4 is not weakened. It is **better served** than under the original clause:

- A merged person **never** becomes contactable as a side effect of deleting the
  survivor, because that deletion cannot happen.
- The merge chain is always complete, so the future governance lookup that must
  follow it can always resolve a merged person to a live survivor.
- Governance records are unaffected: they attach to persons via their own
  `ON DELETE SET NULL (person_id)` FK, which is a **different table** and is not
  touched by this amendment.

Merge remains **disabled** until that governance chain lookup exists. This
amendment does not enable it.

### 15.8 `prospect_accounts` implication

The same correction applies conceptually: change
`prospect_accounts_merged_into_id_fkey` to `ON DELETE NO ACTION`, retaining its
CHECK unchanged.

**As a SEPARATE controlled remediation, not the LI-4C migration.** Reasons:
`prospect_accounts` is a live W4 table with its own governance history; bundling
an unrelated live-table change into LI-4C would violate the rule against
batching unrelated migrations; and the table currently holds 0 rows, so nothing
is at risk today.

It must be **scheduled, not forgotten**: the defect is real. Today, deleting a
company that has any merged `prospect_account` would fail with `23514`, so
tenant deletion is latently broken for that case.

### 15.9 Rollback implication

Unchanged in substance. Rollback remains **lossless only before the first
merge**, for the reasons in §13. `NO ACTION` slightly *improves* the rollback
position: because orphaned merged rows cannot exist, there is no ambiguous state
to reason about when measuring what a rollback would destroy.

### 15.10 Non-goals of this amendment

1. No change to the CHECK constraints — the invariant in §2 stands as written.
2. No change to the composite tenant-safe key; cross-tenant merge remains
   impossible.
3. No trigger, and no transition-enforcement mechanism.
4. No enabling of merge execution.
5. No change to `mayContact()`, Path A, Path B, or the governance evaluator.
6. No modification of `prospect_accounts` in this phase.
7. No decision on un-merge (Q-4 remains open).
8. No change to detection, parking, or the review queue.
