# FIX 3 — PHASE 99: PREFLIGHT RECONCILIATION AND ISSUE-REGISTER HOUSEKEEPING

Static review and governance housekeeping. No production access, no SQL executed against any
database, no database contacted, no migration change, no commit, no deployment.

---

## A. EXECUTIVE DECISION

**PASS WITH LIMITATIONS — PREFLIGHT OR EVIDENCE GAPS REMAIN**

The reconciliation is complete and the approved preflight query survives it intact. Two gaps
remain, neither of which blocks the owner from running the Phase 98 package as written.

1. **The approved Phase 96 §F query is ADEQUATE.** Checked branch by branch against the migration's
   own foreign-key specification and column-shape specification: it covers all four composite
   foreign keys, its two nullable guards are exactly right under MATCH SIMPLE, it produces no false
   positives, and it cannot multiply rows. **No change is proposed to it.**
2. **The unapproved refinement carried in the package has a real latent defect.** Its second join,
   on the parent's `id` alone, can multiply output rows because `FIX3-PRECOND-20` permits a parent
   whose unique key is on `(company_id, id)` rather than `(id)`. It is already labelled
   `NEEDS REVIEW` in the package, so nothing is currently relying on it — but it must not be used
   until corrected. A duplicate-safe `EXISTS` form is proposed.
3. **One data-dependent abort condition is not covered anywhere.** STEP 6's `v_ncons = 0` branch
   **adds** the lifecycle CHECK, which validates every `public.content` row synchronously and would
   fail with **`23514`** — a different SQLSTATE from the foreign-key class, and again with no
   `FIX3-*` code. The preflight looks only at foreign keys. An addition is proposed.

Both proposals are review artifacts in a separately named document. The Phase 98 evidence package
was **not** modified and its hash is unchanged.

---

## B. BASELINE

| | Before this phase | After this phase |
|---|---|---|
| HEAD | `5604b50bdebd23efd6d040b90f5802954413b656`, detached | identical, detached |
| staged / modified / untracked | 0 / 78 / 17 | 0 / 78 / **19** (+2 new documents) |

The issue register is an **untracked** file (it was created inside this programme and never
committed), so editing it moves no count: it was already inside the 17. The +2 is exactly the two
new Phase 99 documents. Section D records the register's exact before/after state.

### Protected artifacts — all verified against the Phase 98 expectations, none restored or repaired

| Artifact | SHA-256 | Expected | Status |
|---|---|---|---|
| Fix 3 migration | `581926201d268d5bde34b6a6b7be4ee118bac3ed8d62ef88756e7030b2d445d5` | same | **OK, unchanged** |
| Frozen predecessor | `34dffb69d4c500d0ed827ad9114778a1235ad79df3c022643decb3c55711a49d` | same | **OK, unchanged** |
| Verification artifact | `5c62e0155bf1d4d1d911597549d83bb252cf54b66f89ba0774070371da26601b` | same | **OK, unchanged** |
| Harness | `63e8920b916f8ca3f5a717d5b4a98efbe85d68dc2e4a7f35100fa215469a5e1e` | same | **OK, unchanged** |

### Prior reports — verified unchanged, none overwritten

| Report | SHA-256 | Lines |
|---|---|---|
| `FIX3_PHASE96_BEHAVIORAL_VALIDATION.md` | `ec932aa1c503c1a1…` | 522 |
| `FIX3_PHASE97_OWNER_DECISIONS_AND_STAGE_A.md` | `a2374fb2ed158898…` | 695 |
| `FIX3_PHASE98_OWNER_DECISIONS_AND_STAGE_A.md` | `5ccf68cac36edc55…` | 437 |
| `FIX3_PHASE98_STAGE_A_OWNER_RUN_EVIDENCE.md` | `a0327d2ae48ba3bef0772eeb38947e8378f659a0eea3e2e30e0540dab0f23c5b` | 920 |

### Issue register identification

Three files in the repository match a register-like name:
`docs/pmo/prospect-intelligence/PI-CONTRACT-REGISTER.md`, `docs/pmo/TECH-DEBT-REGISTER.md`, and
`docs/security/FIX3_ISSUE_REGISTER.md`. The Phase 98 report names the third explicitly and the
other two belong to unrelated programmes, so the authoritative register is
**`docs/security/FIX3_ISSUE_REGISTER.md`**. No guess was required.

### Output path checks, performed before creating anything

| Path | `.gitignore` | Existed already? |
|---|---|---|
| `docs/security/FIX3_PHASE99_PREFLIGHT_RECONCILIATION.md` | visible | no |
| `docs/security/FIX3_PHASE99_PREFLIGHT_CORRECTION_PROPOSED.md` | visible | no |

Neither matches a pattern in `.gitignore`. This check is not ceremonial: Phase 97's originally
suggested filename ended `_READINESS.md`, which `.gitignore:51` silently hides, and had to be
renamed.

---

## C. PREFLIGHT FINDINGS

**This section is static review only.** No query in it, approved or proposed, was executed against
production, a shared database, or a disposable database. Nothing here has been parsed by
PostgreSQL. Syntactic plausibility is not verification.

Sources of truth: the Fix 3 migration's foreign-key specification (lines 1284-1287), its
column-shape specification (lines 780-813), its STEP 6 branches (lines 2425-2520), and the
Phase 96 report's section F. No table, column, constraint or contract name was invented.

### C.1 The relationship contract

| ID | Child table and columns | Parent table and columns | Nullability | Existing (legacy) FK behavior | Migration guard / constraint |
|---|---|---|---|---|---|
| R1 | `content_block (company_id, content_id)` | `content (company_id, id)` | both NOT NULL | single-column `content_block_content_id_fkey`, `ON DELETE CASCADE` | replaced by `content_block_content_fk`, CASCADE; `FIX3-FK-10` refuses any other legacy delete action |
| R2 | `content_recommendation (company_id, content_id)` | `content (company_id, id)` | both NOT NULL | single-column `content_recommendation_content_id_fkey`, CASCADE | replaced by `content_recommendation_content_fk`, CASCADE |
| R3 | `content_recommendation (company_id, block_id)` | `content_block (company_id, id)` | `block_id` **nullable** | single-column `content_recommendation_block_id_fkey`, CASCADE | replaced by `content_recommendation_block_fk`, CASCADE |
| R4 | `content_approval_history (company_id, content_id)` | `content (company_id, id)` | `content_id` NOT NULL before STEP 3, **nullable after** | single-column `content_approval_history_content_id_fkey`, CASCADE | replaced by `content_approval_history_content_fk`, **SET NULL (content_id)**; the `'c'→'n'` transition is the one authorized by the spec |
| R5 | `content_quality (content_id)` | *(none — soft reference)* | nullable | **none** | **`FIX3-FK-13` refuses if any FK exists.** Owner decision OD-12/B1; **no foreign key is proposed for it here** |

All four real foreign keys are composite, `MATCH SIMPLE`, and `ON UPDATE NO ACTION`. On the
RECONCILE path the migration **drops the legacy single-column constraint and adds the composite
one** in the same transaction; on the CREATE path it adds the composite one to a table it just
created, where no rows exist.

### C.2 Coverage assessment of the Phase 96 §F query

| ID | Phase 96 coverage | Missing-parent detection | Cross-tenant detection | False-positive / false-negative risk | Conclusion |
|---|---|---|---|---|---|
| R1 | covered — composite join, no guard needed | yes, but **not distinguished** from a mismatch | yes, **not distinguished** | none identified. Both columns NOT NULL so no NULL exemption can be missed; `(company_id, id)` is unique on the parent so no row multiplication | **ADEQUATE** |
| R2 | covered — composite join, no guard needed | yes, not distinguished | yes, not distinguished | none identified, same reasoning | **ADEQUATE** |
| R3 | covered — composite join **with** `r.block_id IS NOT NULL` | yes, not distinguished | yes, not distinguished | **the guard prevents a false-positive class**: without it every whole-content recommendation (`block_id` NULL, a supported state) would be reported, though MATCH SIMPLE exempts them | **ADEQUATE** |
| R4 | covered — composite join **with** `h.content_id IS NOT NULL` | yes, not distinguished | yes, not distinguished | guard is harmless pre-apply (column is NOT NULL then) and **necessary** if the query is run post-apply, when STEP 3 has made the column nullable | **ADEQUATE** |
| R5 | correctly **excluded** | n/a | n/a | including it would contradict OD-12/B1 and `FIX3-FK-13` | **ADEQUATE — correct exclusion** |
| — | the `NEEDS REVIEW` refinement embedded at package lines 649-662 | would distinguish | would distinguish | **DEFECT: row multiplication.** Its second join is on `p.id = b.content_id` alone, and `id` alone is not guaranteed unique — `FIX3-PRECOND-20` permits a parent keyed on `(company_id, id)`. One offending child could be reported several times with contradictory `kind` values. Silent on a baseline-like target where `id` happens to be unique | **INCOMPLETE — correction proposed** |
| — | data conditions **other than** foreign keys | n/a | n/a | **FALSE NEGATIVE: not covered.** STEP 6's `v_ncons = 0` branch adds the lifecycle CHECK, validating every `content` row; an out-of-vocabulary `lifecycle_status` aborts with **`23514`**. Not reachable on a target resembling the committed baseline, which carries exactly one nine-value CHECK — but the live target is unverified | **INCOMPLETE — addition proposed** |

### C.3 The six required distinctions, resolved

| Case | Handling |
|---|---|
| Valid parent in the same tenant | not reported — the composite join matches |
| Parent exists but belongs to a different tenant | **reported** as a violation; not labelled as such by the approved query |
| Parent does not exist | **reported** as a violation; not labelled as such by the approved query |
| Nullable reference is NULL | **correctly exempt** — R3 and R4 carry explicit `IS NOT NULL` guards, matching MATCH SIMPLE semantics |
| Intentional soft reference, no database FK | **R5 `content_quality`** — correctly excluded; no FK proposed, per OD-12/B1 |
| Child row with an invalid or missing tenant identifier | `company_id` is NOT NULL on all four child tables, so it cannot be missing. A `company_id` referencing no `companies` row is still **detected**, because it cannot match any parent pair |

### C.4 Output exposure

The approved query returns, per offending row, a relationship label and three UUIDs — the child id,
the child `company_id`, and the reference. No business column, no free text, no personal data. The
package also offers an aggregated variant returning only counts. **Adequate; no minimization change
proposed.**

### C.5 Proposed correction — review artifact only

| | |
|---|---|
| Path | `docs/security/FIX3_PHASE99_PREFLIGHT_CORRECTION_PROPOSED.md` |
| SHA-256 | `c6523428bfb637c050db3fab0b89fdeaf57c5acf01b3d688b960ef1b57c865ef` |
| Size | 312 lines, 17,765 bytes |
| Status | **PROPOSED, NOT APPROVED, NOT EXECUTED** — stated four times in the document |

It contains Correction 1 (a duplicate-safe `EXISTS` form of the refinement, covering all four
relationships, replacing package lines 649-662 with a one-sentence wording change at lines 644-647)
and Correction 2 (the lifecycle-CHECK data condition, proposed as a new item 10b before package
line 692). Each carries relationship-by-relationship justification, interpretation, assumptions and
limitations.

### C.6 Required conclusion — can the package stand?

**The owner-run evidence package can remain unchanged, and the owner may run it as written.** The
approved preflight is adequate for the foreign-key violation class it covers, and the defective
refinement is already labelled `NEEDS REVIEW` inside the package, so nothing in the execution path
depends on it.

Two qualifications the owner should carry into execution:

- **Do not use the `NEEDS REVIEW` block at package lines 649-662.** This review found a real defect
  in it. Use the approved query, or Correction 1 once reviewed.
- **Item 10 does not cover every data-dependent abort.** A zero-row preflight result excludes the
  foreign-key class only. Correction 2 closes the remaining one at the cost of a single catalog
  query, and is the more valuable of the two proposals.

---

## D. REGISTER CHANGES

| | |
|---|---|
| Path | `docs/security/FIX3_ISSUE_REGISTER.md` (untracked within this programme) |
| SHA-256 before | `a8cc77b1fc92a5f542bd821ea65d6bc81c26a4f6724612d2322dddbaede17cf9` |
| SHA-256 after | `3194ea3bd4954b9b20fcd6a88b96640e97f370ad40b300fd27ca46bd97ccdc17` |
| Lines | 171 → 190 |

A byte-exact pre-edit copy was taken before any change and the diff was computed against it.

### Diff summary — two insertions, zero deletions, zero modifications

```
81a82,83      <- OD-11 and OD-12 appended to the section B table
171a174,190   <- migration-hash provenance subsection appended to section F
```

**Lines removed: 0. Lines altered: 0. Lines added: 19.** Every pre-existing line of the register
survives byte-identically and in its original order. No unrelated finding was rewritten, no entry
reordered, no status summary touched.

Table integrity was checked: every row of the section B table, old and new, carries exactly four
pipe characters (three columns), matching the existing `| ID | Decision | Why it is not ours to
take |` header. `OD-11` and `OD-12` each appear exactly once at line start, so no duplicate entry
was created — neither existed before this phase.

### D.1 Section B — OD-11, before and after

**Before:** absent. The table ran `OD-1, OD-2, OD-8, D1, OD-9, OD-3, OD-4, OD-5, OD-6, OD-7, OD-10`
and ended at line 81.

**After —** new line 82, reproduced in full:

> | OD-11 | **Trigger-function convergence.** Fix 3's STEP 7 selects the
> `content_block_set_updated_at` executor through four ordered branches, so the CREATE and RECONCILE
> paths can leave different timestamp-trigger function references — `omnivyra_touch_updated_at()`
> and `set_content_updated_at()` respectively. Phase 97 reported the two behaviorally equivalent by
> body, arity, language, security mode and configuration, and the companion artifact's
> `FIX3-VERIFY-09` accepts both names by design. | **OWNER DECISION (Phase 98): A1 — ACCEPT
> INTENTIONAL NON-CONVERGENCE.** No function was standardized, created, dropped or altered; no
> trigger was replaced; `FIX3-VERIFY-09` was not narrowed. The intended contract does not require
> identical trigger-function names across migration paths. **Maintenance condition:** any future
> change to timestamp-update semantics must be evaluated for BOTH functions and applied
> consistently wherever both remain in use; equivalence must NOT be assumed after a code change
> without review and tests. **Evidence scope:** the 0-versus-68 function-reference counts come from
> the committed production-shaped baseline described in the Phase 97 report. They are NOT a live
> production inspection and do not prove the current production state. |

All three required elements are preserved: the dual-function evaluation requirement, the
prohibition on assuming equivalence after a change, and the explicit scoping of the 0-versus-68
counts as baseline evidence rather than live production inspection.

### D.2 Section B — OD-12, before and after

**Before:** absent.

**After —** new line 83, reproduced in full:

> | OD-12 | **`content_quality.content_id` has no foreign key.** The column is a soft reference,
> declared as such in the frozen predecessor and recorded as an owner decision in four places in
> Fix 3. Phase 96 demonstrated that a cross-tenant `content_id` is accepted and that a scorecard
> row survives deletion of the content it names. | **OWNER DECISION (Phase 98): B1 — AFFIRM THE
> EXISTING SOFT-REFERENCE CONTRACT.** No foreign key was added; no executable SQL changed.
> Consequences, recorded deliberately: there is no FK on this relationship; the database does NOT
> enforce that the reference belongs to the same tenant; orphan retention is possible; caller-level
> behaviour remains material; and **`FIX3-FK-13` rejects adding a foreign key** to this
> relationship — the migration refuses to apply if one is present. **The Phase 97 call-site findings
> remain REPORTED EVIDENCE, not guarantees:** the route validates via
> `getContent(id, scopedCompanyId)`, while `lib/post/runPostGeneration.ts` and
> `lib/thread/runThreadGeneration.ts` rely on their construction paths; that reasoning must not be
> restated as a stronger guarantee. The writer `qualityService.persistScorecard` performs NO
> validation of its own and uses the RLS-bypassing service-role client; neither fact may be
> misrepresented. **Maintenance condition:** any future change to these callers, to the writer, to
> tenant-isolation or RLS-bypass behaviour, or to the content lifecycle must re-evaluate the
> soft-reference guarantee and its caller-level enforcement. |

All six required consequences are preserved, together with the explicit instruction not to upgrade
the generation pipelines' construction-path reasoning into a stronger guarantee, and not to
misrepresent the writer's lack of internal validation or its RLS bypass.

### D.3 Section F — migration-hash provenance

**Before:** section F carried a four-row table about the **TypeScript** change population of
Phases 74-78 (`authSubsystemBoot.ts`, the four never-pre-hashed content files, and so on). It
contained **no migration hash of any kind**, so there was no existing entry to overwrite. The
minimal faithful edit was therefore to append a scoped subsection rather than alter the existing
table, which remains byte-identical.

**After —** appended as lines 174-190, a subsection headed
`### Migration-hash provenance — Fix 3 (recorded Phase 99)`, introduced by a short note explaining
why the SQL artifacts are tracked separately: the Phase 98 comment-only correction changed the
migration's file hash without changing its executable logic, and a reader comparing against an
older report would otherwise read that as tampering.

The subsection's table makes the four required distinctions explicit:

| Row | Value | Distinction recorded |
|---|---|---|
| Fix 3 migration, Phases 90-97 | `2ab29a6e2f848d2051418ec7d371c99b15463bf83a6d00da6370153711693f4e` | **the earlier hash**, marked "Historical — superseded, not wrong" |
| Fix 3 migration, Phase 98 onward | `581926201d268d5bde34b6a6b7be4ee118bac3ed8d62ef88756e7030b2d445d5` | **the post-comment-correction hash**, with the extent of the change stated (4 comment lines removed, 6 inserted, 2,969 → 2,971 lines) |
| Fix 3 migration, non-comment SQL | `2da8139697409d9b8b7d25134fbdecd86a06202a4ca97a8e3a4d611502cc22d6` | **executable SQL byte-identical** after stripping whole-line comments — 1,564 lines, same hash before and after |
| Verification artifact | `5c62e0155bf1d4d1d911597549d83bb252cf54b66f89ba0774070371da26601b` | **unchanged**, and why: it carries no hash of the migration, so nothing needed to change |
| Frozen predecessor | `34dffb69d4c500d0ed827ad9114778a1235ad79df3c022643decb3c55711a49d` | unchanged throughout |

It closes with: *"Any integrity check still written against `2ab29a6e…` must be updated to
`58192620…`."* The prior hash is preserved as history; nothing was silently rewritten, and the text
states plainly that the executable migration logic did not change.

### D.4 Did any unrelated register content change?

**No.** Zero lines removed, zero altered. The diff is two pure insertions. Sections A, C, D and E
are untouched, as is section F's original table.

---

## E. STAGE A STATUS

**The Phase 98 owner-run evidence package is ready for owner use, as written, with two
qualifications.** It was not modified by this phase and its hash is unchanged at
`a0327d2ae48ba3bef0772eeb38947e8378f659a0eea3e2e30e0540dab0f23c5b`.

- The approved preflight (item 10) does **not** require a versioned correction. It is adequate for
  the foreign-key violation class.
- The `NEEDS REVIEW` block inside item 10, at package lines 649-662, **must not be used.** This
  review found a real defect in it. It is already labelled unapproved in the package, so the
  package is safe to execute as it stands.
- Item 10 should be read as covering the foreign-key class **only**. Correction 2 in the proposal
  document closes the one remaining data-dependent abort condition and is recommended for review
  before execution, though not required for the approved query to be trustworthy.

**No production connection was made and no SQL was executed**, against production or any other
database, in this phase. The configured Supabase MCP server previously returned `CONNECT_TIMEOUT`;
no connection was attempted here and no alternative connection path was improvised. Stage A
continues to require that the owner independently establish a provably read-only access mechanism —
a `SELECT` statement alone is not proof that the execution context is read-only.

---

## F. BOUNDARY CONFIRMATION

| Question | Answer |
|---|---|
| Production accessed | **NO** |
| Production SQL executed | **NO** |
| Any SQL executed against any database, including disposable | **NO** — no database or container was started or contacted |
| Database changes | **NO** |
| Migration application | **NO** |
| Commit, push, merge or deployment | **NO** |
| `C:\virality` accessed | **NO** |
| Credentials read or exposed | **NO** |
| Executable SQL in the Fix 3 migration changed | **NO** — the migration is byte-unchanged from Phase 98 |
| Frozen predecessor, verification artifact or harness altered | **NO** |
| New migration created | **NO** |
| Phase 98 evidence package overwritten | **NO** |
| Any register edit beyond the two authorized | **NO** |
| Harness run, Docker container or database started | **NO** |
| Application code modified | **NO** |

---

## G. REMAINING BLOCKERS AND NEXT ACTION

### Blockers, unchanged by this phase

1. **No provably read-only channel is established.** The `supabase` MCP server is configured but
   returned `CONNECT_TIMEOUT`; `psql`, `pg_dump` and `pg_isready` are absent from the host; the
   Supabase CLI is present but unlinked. The owner-run route needs no agent-held credential but
   depends on the owner verifying their own session's read-only character.
2. **The live production schema and data state remain unknown.** Whether the target carries the
   post-Fix-3 shape, the legacy shape, or none of the four tables is still an inference from a
   dated, schema-only baseline.
3. **Production RLS behavior remains unknown.** Items 1-4 of the package would establish
   configuration; runtime behavior for real users would still not be established.
4. **Tenant-inconsistent data is undetected** until item 10 runs, and a zero-row result would be
   time-of-check only.
5. **Lock and scan exposure remains UNRESOLVED**, pending real row counts and a view of concurrency.
6. **Production application of Fix 3 remains unauthorized.**

### Newly identified in this phase

7. **The preflight does not cover the lifecycle-CHECK data condition** (STEP 6, `v_ncons = 0`,
   SQLSTATE `23514`). Low likelihood on a baseline-like target; cheap to close.
8. **The unapproved refinement in package lines 649-662 is defective** and must not be used until
   Correction 1 is reviewed.

### Minimum next step

**Authorize an owner-run Stage A execution through an independently verified read-only session**,
using `docs/security/FIX3_PHASE98_STAGE_A_OWNER_RUN_EVIDENCE.md` as written, with the two
qualifications in section E.

Optionally and separately, **review the two proposals** in
`docs/security/FIX3_PHASE99_PREFLIGHT_CORRECTION_PROPOSED.md`. Correction 2 is worth taking before
execution; Correction 1 only matters if the owner wants the mismatch-versus-missing-parent
classification, which is a remediation aid rather than a go/no-go input.

**Production application of Fix 3 is not authorized by this phase**, and nothing in this review
should be read as moving it closer to authorization. What this phase establishes is that the
instrument the owner would use to decide is sound for what it measures, and precisely where it is
silent.
