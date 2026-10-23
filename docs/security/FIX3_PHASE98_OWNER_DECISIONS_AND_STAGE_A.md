# FIX 3 — PHASE 98: OWNER DECISIONS RECORDED, COMMENT-ONLY CORRECTION, STAGE A PACKAGE

Governance phase. Two owner decisions recorded as authorized, one comment-only correction to the
Fix 3 migration, and an owner-run Stage A evidence package prepared. No production access, no SQL
executed, no database contacted, no commit, no deployment.

Companions: `FIX3_PHASE96_BEHAVIORAL_VALIDATION.md`, `FIX3_PHASE97_OWNER_DECISIONS_AND_STAGE_A.md`,
`FIX3_ISSUE_REGISTER.md`.

---

## A. DECISION RECORD

Both decisions were taken by the owner and are recorded here exactly as authorized. Neither was
chosen by this session. They should be filed in `FIX3_ISSUE_REGISTER.md` section B under the
existing `OD-n` convention, which currently runs to OD-10; filing them there is a documentation edit
and was **not** performed in this phase.

### OD-11 — Trigger-function convergence — **DECIDED: A1, accept intentional non-convergence**

**Decision.** Accept that the CREATE and RECONCILE paths may leave different timestamp-trigger
function references. Do not standardize the functions. Do not change any trigger.

**Evidence this rests on**, carried from the Phase 97 report:

1. The CREATE and RECONCILE paths can leave different timestamp-trigger function references —
   `omnivyra_touch_updated_at()` and `set_content_updated_at()` respectively.
2. The two functions were reported behaviorally equivalent by **body, arity, language, security
   mode and configuration**: both normalise to the migration's accepted body allowlist, both return
   `trigger`, take zero arguments, are written in plpgsql, are not SECURITY DEFINER, and carry no
   pinned `proconfig`.
3. The production-shaped baseline reported **zero** references to `set_content_updated_at` and
   **68** references to `omnivyra_touch_updated_at`.
4. The migration's verification guard `FIX3-VERIFY-09` accepts **both** function names by design.
5. The intended contract does not require identical trigger-function names across migration paths.

**Scope limit on point 3, stated deliberately.** The baseline is a committed, dated, schema-only
dump described in the Phase 97 report. **It is evidence from the production-shaped baseline, not a
live production inspection, and it does not prove the actual current state of the production
database.** The inference that a production apply would land on `omnivyra_touch_updated_at()` is
well-founded and remains an inference. Evidence item 8 of the Stage A package replaces it with
observation.

**Maintenance condition, recorded as part of the decision.**

> Any future change to timestamp-update semantics must be evaluated for **both**
> `public.omnivyra_touch_updated_at()` and `public.set_content_updated_at()`, and applied
> consistently wherever both remain in use. **Function equivalence must not be assumed after a
> future code change without review and tests.** The equivalence recorded above is a finding about
> the functions as they stand today, not a property guaranteed to survive an edit to either one.

**Not done, by decision:** no function was standardized, created, dropped or altered; no trigger was
replaced; `FIX3-VERIFY-09` was not narrowed; no migration was created.

### OD-12 — `content_quality.content_id` foreign key — **DECIDED: B1, affirm the soft-reference contract**

**Decision.** Affirm the existing contract. Do not add a foreign key. Do not alter the migration's
executable logic.

**Intended implications, recorded explicitly so no future reader has to re-derive them:**

1. `content_quality.content_id` is **intentionally not protected by a foreign key** under the
   existing contract.
2. The database **does not independently enforce** that this reference belongs to the same tenant.
3. A referenced `public.content` record **can be deleted while the corresponding
   `content_quality` row remains**, leaving a dangling `content_id`.
4. Referential and tenant-consistency guarantees for this relationship therefore depend on the
   **documented application-level contract and caller behavior**, not on the database.
5. The existing Fix 3 guard **`FIX3-FK-13`**, as described in the Phase 97 report, **rejects adding
   a foreign key** to this relationship — the migration refuses to apply if one is present.

**Phase 97 findings on the three `persistScorecard` call sites, recorded as reported:**

| Call site | What Phase 97 reported |
|---|---|
| `pages/api/content/[id]/quality.ts` | The route validates access through `getContent(id, scopedCompanyId)` before the write. |
| `lib/post/runPostGeneration.ts` | Relies on its construction path — the pipeline creates the content row itself with the same `company_id` it then passes to the scorecard write. |
| `lib/thread/runThreadGeneration.ts` | Relies on its construction path, in the identical pattern. |
| the writer itself, `backend/services/content/qualityService.ts` | **Performs no validation, and bypasses RLS** by using the service-role client. |

**Preserving the distinction between observed behavior and the approved contract.** The three rows
above describe **code behavior observed and reported in Phase 97**. The owner-approved contract is
narrower: it is that `content_id` is a soft reference the database does not enforce, and that
correctness rests on callers. The two generation pipelines' guarantees rest on construction — the
pipeline authoring both rows with one `company_id` — and that is the evidence Phase 97 documented;
it is **not** an independently enforced invariant, and it is not claimed as one here. Nothing above
should be read as a guarantee stronger than the Phase 97 evidence supports.

**Maintenance condition, recorded as part of the decision.**

> Any future change to these callers, to the writer, to tenant-isolation behavior, to RLS-bypass
> behavior, or to the content lifecycle must **re-evaluate the soft-reference guarantee and its
> caller-level enforcement**. Adding a fourth writer of `content_quality`, or removing the
> validation in the route, would silently weaken a guarantee that no database constraint backs.

**Not done, by decision:** no foreign key was added; `FIX3-FK-13` was not relaxed or removed; the
verification artifact's foreign-key-free assertion was not touched; no executable SQL was changed;
no migration was created.

---

## B. THE COMMENT-ONLY CORRECTION

### What was wrong

The Fix 3 migration header asserted that `content_quality` has a single writer and that correctness
of `content_id` is enforced **only** by one route. Phase 97 established that `persistScorecard` has
**three** production call sites. The header's security conclusion survives — all three establish the
pairing — but the sentence as written would send a future reviewer to one file.

The owner explicitly authorized a comment-only correction to that statement.

### Exact text, before and after

Located at lines 65-68 of the pre-edit file. Lines 63-64, which state the owner decision and the
DECISION B exclusion, are **accurate and were deliberately left untouched**, which is what makes
this the smallest possible correction.

**OLD — removed, 4 lines:**

```
--       guarantee: its only writer is a service-role path
--       (backend/services/content/qualityService.ts), so the correctness of its
--       content_id is enforced ONLY by the calling route
--       (pages/api/content/[id]/quality.ts), not by the database.
```

**NEW — inserted, 6 lines:**

```
--       guarantee: its writer is a service-role path
--       (backend/services/content/qualityService.ts), which performs no
--       validation of its own. The Phase 97 report records THREE call sites of
--       persistScorecard, with the caller-side validation and tenant-scoping
--       evidence for each; correctness of content_id rests on those callers,
--       not on the database.
```

### Why this wording

- It states that the report identifies **three call sites**, and points at the Phase 97 report for
  the caller-side validation and tenant-scoping evidence, rather than restating that evidence in
  the migration where it would drift.
- It says the writer **performs no validation of its own** — Phase 97 reports exactly that, and the
  old wording's "enforced ONLY by the calling route" could be misread as the writer doing the
  enforcing.
- It ends "not on the database", preserving the original sentence's most important claim and
  **not** implying database-enforced tenant consistency.
- It adds no new behavioral guarantee. It does not characterise how each of the three callers
  establishes the pairing; that detail lives in the Phase 97 report and in section A above.

### Diff

One hunk. Four comment lines removed, six comment lines inserted. No other hunk anywhere in the
file.

```diff
@@ -62,10 +62,12 @@
 --       directly. None of those is visible to any catalog query here.
 --     content_quality.content_id REMAINS a soft reference with no foreign key,
 --       by owner decision. content_quality is therefore OUTSIDE the DECISION B
---       guarantee: its only writer is a service-role path
---       (backend/services/content/qualityService.ts), so the correctness of its
---       content_id is enforced ONLY by the calling route
---       (pages/api/content/[id]/quality.ts), not by the database.
+--       guarantee: its writer is a service-role path
+--       (backend/services/content/qualityService.ts), which performs no
+--       validation of its own. The Phase 97 report records THREE call sites of
+--       persistScorecard, with the caller-side validation and tenant-scoping
+--       evidence for each; correctness of content_id rests on those callers,
+--       not on the database.
 --     ON UPDATE — every composite FK below is ON UPDATE NO ACTION (the default,
 --       and the deliberate choice; ON UPDATE CASCADE would silently re-tenant
 --       children). Consequence, absent from the frozen file: once any child row
```

### Proof that the change is comment-only

`git diff` is **empty** for this file, and that is not evidence of anything: the migration is an
**untracked** file (`?? supabase/migrations/20261212000000_...`), so git has no baseline to diff
against. The authoritative comparison is a byte-exact pre-edit copy taken before any edit, whose
hash was confirmed to equal the Phase 97 recorded hash `2ab29a6e...`. Four independent checks were
run against that copy, all before the edit was installed and the decisive one again after:

| # | Check | Result |
|---|---|---|
| 1 | Every added and removed line in the diff matches `^[[:space:]]*--` | 6 changed lines, **0** non-comment |
| 2 | Strip **all** pure-comment lines from both versions; compare the remainder byte-for-byte | pre **1,564** lines, post **1,564** lines, both sha256 `2da8139697409d9b8b7d25134fbdecd86a06202a4ca97a8e3a4d611502cc22d6` — **identical** |
| 3 | Structural landmarks and guard inventory | `BEGIN;` 228 → 230, `COMMIT;` 2969 → 2971 (shifted by exactly +2, the net line change); distinct `FIX3-*` guard codes **95 → 95**; top-level `DO $$` blocks **11 → 11** |
| 4 | Byte hygiene | no raw control bytes; **0** lines containing CR in either version — LF endings throughout, unchanged |

Check 2 is the strongest of the four and deserves a note on method. It removes only **whole**
comment lines (`^\s*--`), never trailing inline comments, so it cannot be fooled by a `--` sequence
occurring inside a string literal — and this migration does contain `--` inside quoted `RAISE`
messages. Because the edit touches whole comment lines only, the surviving remainder must be
identical, and it is.

After installation, check 2 was re-run against the installed file: still 1,564 lines, still
`2da8139697409d9b8b7d25134fbdecd86a06202a4ca97a8e3a4d611502cc22d6`. **The executable SQL is
unchanged.**

The region edited sits at lines 65-68 of a header comment block whose first executable statement is
`BEGIN;` at line 228 (230 after the edit), so the change is structurally incapable of reaching
executable SQL.

### Resulting hashes

| | SHA-256 |
|---|---|
| Fix 3 migration, **before** | `2ab29a6e2f848d2051418ec7d371c99b15463bf83a6d00da6370153711693f4e` |
| Fix 3 migration, **after** | `581926201d268d5bde34b6a6b7be4ee118bac3ed8d62ef88756e7030b2d445d5` |
| Non-comment SQL, before and after | `2da8139697409d9b8b7d25134fbdecd86a06202a4ca97a8e3a4d611502cc22d6` (unchanged) |
| Line count | 2,969 → 2,971 |

**The verification artifact was deliberately NOT updated.** Its hash remains
`5c62e0155bf1d4d1d911597549d83bb252cf54b66f89ba0774070371da26601b`. It contains no hash of the
migration, so nothing in it needed to change, and changing it merely to "match" would have been a
modification with no justification.

**Carry-forward warning for later phases.** Phases 89 through 97 all record the migration hash as
`2ab29a6e...`. That value is now **historical**. Any future integrity check must expect
`581926201d268d5bde34b6a6b7be4ee118bac3ed8d62ef88756e7030b2d445d5`, and `FIX3_ISSUE_REGISTER.md`
section F (hash provenance) should be updated accordingly when the register is next edited.

---

## C. OWNER-RUN STAGE A EVIDENCE PACKAGE

| | |
|---|---|
| Path | `docs/security/FIX3_PHASE98_STAGE_A_OWNER_RUN_EVIDENCE.md` |
| SHA-256 | `a0327d2ae48ba3bef0772eeb38947e8378f659a0eea3e2e30e0540dab0f23c5b` |
| Size | 920 lines, 47,836 bytes |
| Ignored by git? | **No** — checked before creation |
| Evidence items | **11**, numbered ITEM 1 through ITEM 11 |

The eleven items map one-to-one onto the Stage A plan in Phase 97 section E:

| Item | Evidence |
|---|---|
| 1 | Grants on the five tables and `user_company_roles` |
| 2 | `user_company_roles` policies and role configuration |
| 3 | RLS enabled and forced status, five tables |
| 4 | Policy predicates, including `public.content`'s `content_company_rw` |
| 5 | Constraints: FK definitions, ordered column mappings, delete actions, validation state |
| 6 | Lifecycle CHECK definition and accepted values |
| 7 | Index definitions and options |
| 8 | Trigger definitions and referenced function names — also settles OD-11's open observation |
| 9 | Row counts for the five tables |
| 10 | Tenant-consistency preflight, Phase 96 section F query verbatim |
| 11 | Migration-history evidence, explicitly separated from schema state |

Each item carries an ID and purpose, the exact catalog objects involved, read-only SQL, the expected
output columns, PASS / FAIL / INCONCLUSIVE criteria, sensitive-data minimization requirements, and
known limitations. The package also contains a safety preamble with role and target verification, a
four-layer RLS interpretation guide, a row-count and lock interpretation section, a fill-in result
template, and an explicit Stage A stop condition.

**Queries marked NEEDS REVIEW: one.** Inside item 10, the Phase 97 refinement that would distinguish
a tenant mismatch from a missing parent row. The Phase 96 section F query does not make that
distinction — both cases produce a NULL on the same two-column LEFT JOIN — and the refinement has
not been approved. The Phase 96 query is reproduced **verbatim** (20 lines, extracted from the
Phase 96 report, sha256 begins `e02bfecd0a16729f`) and is marked authoritative; the refinement is
clearly labelled as a proposal and must not be substituted.

**Grounding.** Every table, column, constraint, index, trigger, function and policy name in the
package is derived from the Fix 3 migration, the frozen predecessor, or the committed
production-shaped baseline — `content_company_rw` was confirmed present in the baseline rather than
assumed from the disposable database, and item 11 discovers the production ledger table's actual
columns instead of assuming the local harness's `(version, statements, name)` shape. Nothing was
invented.

**Deliberate exclusions, named in the package so they are visibly deferred:** representative-role
read behavior via `SET LOCAL ROLE`, any write-path test of a policy's `WITH CHECK`, any
`EXPLAIN ANALYZE` of the DDL, any trial application even in a rolled-back transaction, and any
remediation of rows item 10 may find. Each is listed with what it would require.

---

## D. REMAINING BLOCKERS

**Production RLS behavior and the live target's schema and data state remain unknown until the
owner executes the Stage A package through a safe read-only mechanism and reviews the results.**

Nothing in this phase changed that. Specifically still open:

1. **The live production schema shape is unknown.** Whether production carries the post-Fix-3
   shape, the legacy predecessor shape, or none of the four tables is an inference drawn from a
   dated, schema-only baseline dump. Phase 96 verified that Fix 3 handles the RECONCILE and CREATE
   paths correctly, so either answer is workable — but which one applies is unobserved. Items 5
   through 8 settle it.
2. **Production RLS behavior is unknown.** The Phase 96 disposable baseline could demonstrate
   deny-all and nothing more. Items 1 through 4 would establish the **configuration**; the
   **behavior** of real production users would still not be established, because the read half
   needs role switching and the write half cannot be tested against production at all. The package
   says so explicitly and keeps the four layers separate.
3. **Tenant-inconsistent legacy data is undetected.** Item 10 predicts whether a future apply would
   abort at STEP 4 with a raw `23503`. Until it is run, that risk is unquantified. A zero-row result
   would be time-of-check only and would still not authorize application.
4. **Lock and scan exposure remains UNRESOLVED.** Phase 96's figures — roughly 4,505 ms end-to-end
   at 1.5 million synthetic rows, largest statement roughly 1,489 ms — are synthetic and are carried
   forward as historical evidence only. Item 9's row counts are one necessary input; instance class,
   `maintenance_work_mem`, concurrency and the availability of a quiet window are others, and the
   five-second `lock_timeout` means an apply may fail to acquire its locks under live traffic.
5. **No provably read-only channel is established for this coding session.** Phase 97 found the
   `supabase` MCP server configured but returning `CONNECT_TIMEOUT`; `psql`, `pg_dump` and
   `pg_isready` absent from the host; and the Supabase CLI present but unlinked. The owner-run route
   this package enables needs no agent-held credential and is available now, but it depends on the
   owner independently verifying their own session's read-only character — which the package's
   safety preamble sets out and which only the owner can perform.
6. **The verification artifact's ability to fail is still inferred**, from its 65 `RAISE EXCEPTION`
   points, not demonstrated. No negative control has been authorized.
7. **Production application of Fix 3 remains unauthorized** and unsupported by any evidence about
   the actual target.

Two items are now **closed** that were open at the end of Phase 97: OD-11 and OD-12, both recorded
in section A.

---

## E. BOUNDARY CONFIRMATION

| Question | Answer |
|---|---|
| Production accessed by this coding session | **NO** |
| Production SQL executed by this coding session | **NO** — no SQL was executed anywhere, against any database |
| Database changes | **NO** — no database was started, connected to, or written |
| Migration application | **NO** |
| Commit, push, merge or deployment | **NO** |
| `C:\virality` accessed | **NO** |
| Credentials read | **NO** — no credential, connection string, token or secret-derived value was read or printed |
| Migration or ledger entry created | **NO** |
| Executable SQL changed | **NO** — proven byte-identical in section B |
| Verification artifact, frozen predecessor or harness changed | **NO** |
| Owner decision made on the owner's behalf | **NO** — OD-11 and OD-12 were decided by the owner and are recorded as given |
| Database harness re-run | **NO** — no concrete authorized reason existed; this phase is governance and a comment correction |

---

## F. REPOSITORY INTEGRITY

**The worktree is not otherwise unchanged.** Three things changed, all of them authorized: the
Fix 3 migration's header comment, and two new documents.

| | Before this phase | After this phase |
|---|---|---|
| HEAD | `5604b50bdebd23efd6d040b90f5802954413b656` (detached) | identical, detached |
| staged | 0 | 0 |
| modified | 78 | 78 |
| untracked | 15 | **17** (+2 new documents) |

The migration's edit does **not** move the modified count, because the migration is itself an
untracked file.

### Protected artifact hashes

| Artifact | Before | After | Status |
|---|---|---|---|
| Frozen predecessor `20260718000002_...` | `34dffb69d4c500d0ed827ad9114778a1235ad79df3c022643decb3c55711a49d` | same | **unchanged** |
| Verification artifact `_fix3_tenant_consistent/verification.sql` | `5c62e0155bf1d4d1d911597549d83bb252cf54b66f89ba0774070371da26601b` | same | **unchanged** |
| Harness `scripts/ci/real-schema-ci.sh` | `63e8920b916f8ca3f5a717d5b4a98efbe85d68dc2e4a7f35100fa215469a5e1e` | same | **unchanged** |
| Fix 3 migration | `2ab29a6e2f848d2051418ec7d371c99b15463bf83a6d00da6370153711693f4e` | `581926201d268d5bde34b6a6b7be4ee118bac3ed8d62ef88756e7030b2d445d5` | **changed — authorized comment-only correction** |
| Fix 3 migration, non-comment SQL only | `2da8139697409d9b8b7d25134fbdecd86a06202a4ca97a8e3a4d611502cc22d6` | same | **unchanged** |

### Prior phase reports — unchanged, not overwritten

| Report | SHA-256 | Lines |
|---|---|---|
| `FIX3_PHASE96_BEHAVIORAL_VALIDATION.md` | `ec932aa1c503c1a1c1b4af63ce0fbb3c7a2860c10cb05464562552eaa299fe9d` | 522 |
| `FIX3_PHASE97_OWNER_DECISIONS_AND_STAGE_A.md` | `a2374fb2ed1588989f912ee2bfb8059962c53d9103962766e0e368f0e7767a72` | 695 |
| `FIX3_ISSUE_REGISTER.md` | unchanged from the start of this phase | 171 |

### New documents

| Document | SHA-256 | Lines | Ignored? |
|---|---|---|---|
| `docs/security/FIX3_PHASE98_STAGE_A_OWNER_RUN_EVIDENCE.md` | `a0327d2ae48ba3bef0772eeb38947e8378f659a0eea3e2e30e0540dab0f23c5b` | 920 | no |
| `docs/security/FIX3_PHASE98_OWNER_DECISIONS_AND_STAGE_A.md` | recorded on completion below | — | no |

Both paths were checked against `.gitignore` **before** creation and are visible to git. This
mattered: Phase 97's originally suggested filename ended in `_READINESS.md`, which
`.gitignore:51` (`*_READINESS*.md`) silently hides, and it had to be renamed. The two names chosen
here avoid every pattern in that file.

### Verification performed

All checks were local and non-mutating. No database, container or network resource was contacted.

| Check | Result |
|---|---|
| Migration diff contains no executable SQL change | **PASS** — 6 changed lines, all pure comments |
| Non-comment SQL identical to pre-edit | **PASS** — 1,564 lines, sha `2da81396...` both sides |
| Frozen predecessor hash unchanged | **PASS** |
| Verification artifact hash unchanged | **PASS** |
| Harness hash unchanged | **PASS** |
| Phase 96 and Phase 97 reports unchanged | **PASS** |
| Evidence package contains eleven numbered items | **PASS** — ITEM 1 through ITEM 11; one query marked NEEDS REVIEW, none blocked |
| All generated documentation paths visible to git | **PASS** |
| No production or remote database contacted | **PASS** |
| No commits or deployments | **PASS** |
| No raw control bytes in any generated file | **PASS** |
| Line endings unchanged (LF, zero CR) | **PASS** |

---

## G. WHAT THE OWNER IS ASKED FOR NEXT

Nothing in this phase requires a decision to be re-taken. Two items are outstanding, both carried
from Phase 97 and neither newly created here:

1. **Authorize one Stage A execution route.** Either investigate and restore the configured
   `supabase` MCP connection and confirm the role it connects with, or run the eleven-item package
   in section C through an independently verified read-only session. The package is written for the
   second route and needs no infrastructure change.
2. **Decide, separately and later, whether to apply Fix 3** — only after the Stage A evidence is
   reviewed, any item 10 findings are remediated, a maintenance window consistent with the lock
   analysis is available, and the migration and artifact hashes are re-confirmed at that time
   against the **new** migration hash `581926201d268d5bde34b6a6b7be4ee118bac3ed8d62ef88756e7030b2d445d5`.

Two housekeeping edits are also now justified but were **not** performed, since they were not
authorized: filing OD-11 and OD-12 into `FIX3_ISSUE_REGISTER.md` section B, and updating that
register's section F hash provenance to the new migration hash.

---

## NOTE ON THIS REPORT'S OWN HASH

A file cannot contain its own SHA-256. The table in section F therefore leaves this report's hash
unresolved by necessity. Its value is reported in the Phase 98 handoff and can be recomputed at any
time with:

```
sha256sum docs/security/FIX3_PHASE98_OWNER_DECISIONS_AND_STAGE_A.md
```

The evidence package's hash in section C is a real, verifiable value, because that file was written
and hashed before this one.
