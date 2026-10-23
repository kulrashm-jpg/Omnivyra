# FIX 3 — D-3 LIFECYCLE-CHECK PREFLIGHT: PROPOSED ADDITION

**Status: PROPOSED, NOT APPROVED, NOT ADDED, NOT EXECUTED.** No SQL below has been run or parsed by
any database. Static drafting only. The v2 package and v2 operator steps are **unmodified**.

Adding this to the executable package requires owner approval, because it adds a query.

---

## 1. WHAT THIS CLOSES

**D-3**, from `FIX3_STAGE_A_AUDIT_CLOSURE.md`: Fix 3's STEP 6 can **add** the lifecycle CHECK, which
validates every `public.content` row synchronously and aborts with **`23514`** if any row holds a
value outside the nine. No Stage A item detects that. Item 10 covers only the composite-FK `23503`
class; Item 6 reads the constraint *definition* and never looks at the data.

So today a zero-row Item 10 plus a passing Item 6 still leaves this abort class undetected.

### Branch map, re-derived from the migration rather than from the earlier proposal

Migration `20261212000000_…_tenant_consistent.sql`, sha256 `581926201d268d5b…`:

| Branch | Condition | DDL | Scans `content`? | Can fail `23514`? | Line |
|---|---|---|---|---|---|
| `content` absent | — | none — refuses `FIX3-LIFE-01` | no | no | `:2410-2412` |
| `lifecycle_status` absent | — | none — refuses `FIX3-LIFE-01` | no | no | `:2416-2418` |
| `v_ncons > 1` | more than one CHECK covers the column | none — refuses `FIX3-LIFE-02` | no | no | `:2428-2432` |
| **`v_ncons = 0`** | **no CHECK covers the column** | **`ADD CONSTRAINT … CHECK (nine values)`** | **yes** | **YES** | **`:2434-2450`, ADD at `:2445-2447`** |
| `v_ncons = 1`, nine-value, validated | the expected state | none — "LEFT UNCHANGED (no DDL, no revalidation scan)" | no | no | `:2493-2496` |
| `v_ncons = 1`, eight-value predecessor | DROP + ADD nine-value | yes | **no** — nine is a strict superset of eight, and `FIX3-LIFE-04` already refused if the old CHECK were `NOT VALID`, so every surviving row satisfies it | `:2498-2520` |
| `v_ncons = 1`, wrong key count | — | none — refuses `FIX3-LIFE-03` | no | no | within `:2456-2462` |
| `v_ncons = 1`, `NOT VALID` | — | none — refuses `FIX3-LIFE-04` | no | no | `:2463-2466` |
| `v_ncons = 1`, unsupported definition form | — | none — refuses `FIX3-LIFE-07` | no | no | `:2482-2488` |
| `v_ncons = 1`, supported form, unrecognised element list | — | none — refuses **`FIX3-LIFE-05`** | no | no | `:2522-2524` |

**Exactly one branch carries data risk.** Two branches scan `public.content`; only `v_ncons = 0` can
reject a row.

The branch test the migration itself uses — which this preflight must replicate, not paraphrase:

```text
:2392   r_content regclass := to_regclass('public.content');
:2413   SELECT attnum INTO a_life FROM pg_attribute
:2414    WHERE attrelid = r_content AND attname = 'lifecycle_status'
:2415      AND attnum > 0 AND NOT attisdropped;
:2425   SELECT count(*) INTO v_ncons FROM pg_constraint
:2426    WHERE conrelid = r_content AND contype = 'c' AND a_life = ANY (conkey);
```

---

## 2. THE PROPOSED SQL

`SELECT` only. No `DO`, no temporary object, no DDL, no write, no role change, no dynamic SQL.

### Step 10b-1 — catalog: which STEP 6 branch applies?

Always returns exactly one row, whatever exists.

```sql
-- PROPOSED, NOT APPROVED, NOT EXECUTED.
-- Replicates Fix 3 STEP 6's own branch test (migration lines 2392, 2413-2415, 2425-2426).
WITH t AS (
  SELECT to_regclass('public.content') AS rel
), c AS (
  SELECT t.rel,
         (SELECT a.attnum
            FROM pg_attribute a
           WHERE a.attrelid = t.rel
             AND a.attname  = 'lifecycle_status'
             AND a.attnum   > 0
             AND NOT a.attisdropped) AS attnum
    FROM t
)
SELECT c.rel IS NOT NULL                                  AS content_present,
       c.attnum IS NOT NULL                               AS lifecycle_column_present,
       CASE WHEN c.rel IS NOT NULL AND c.attnum IS NOT NULL
            THEN (SELECT count(*)
                    FROM pg_constraint k
                   WHERE k.conrelid = c.rel
                     AND k.contype  = 'c'
                     AND c.attnum   = ANY (k.conkey))
       END                                                AS checks_covering_lifecycle_status
  FROM c;
```

`to_regclass` returns NULL for an absent relation rather than raising, so the statement cannot error
on a missing table. The `CASE` has no `ELSE`, so the count is **NULL — not 0 —** when the relation or
the column is absent. That distinction is load-bearing: a `0` means "no CHECK covers the column", a
`NULL` means "the question could not be asked".

### Step 10b-2 — data: run **only** if `checks_covering_lifecycle_status = 0`

```sql
-- PROPOSED, NOT APPROVED, NOT EXECUTED.
-- Values that would make STEP 6's ADD CONSTRAINT fail with 23514. Run only when step 10b-1
-- returned exactly 0. The nine literals are copied from migration line 2446.
SELECT c.lifecycle_status,
       count(*) AS row_count
  FROM public.content c
 WHERE c.lifecycle_status NOT IN ('draft','generated','edited','approved','adapted',
                                  'scheduled','published','archived','quality_reviewed')
 GROUP BY c.lifecycle_status
 ORDER BY row_count DESC, c.lifecycle_status;
```

**Why there is no `IS NULL` branch, and why that is correct.** A `CHECK` rejects a row only when its
expression evaluates to **FALSE**; `NULL` passes. For a NULL `lifecycle_status`, `NOT IN (…)`
evaluates to NULL, so the row is excluded here — which matches the constraint's behavior exactly.
Adding `OR c.lifecycle_status IS NULL` would manufacture false positives, reporting rows that would
not abort the migration. (The committed baseline shows `lifecycle_status` as NOT NULL with default
`'draft'`; that is **baseline-derived, not live-verified**, and the predicate above is correct either
way.)

---

## 3. PRECONDITIONS AND BRANCH APPLICABILITY

- Runs only after the preamble gate's eight stop conditions are clear, inside the same
  database-enforced read-only transaction as the other items.
- Step 10b-1 has no preconditions and may always be run.
- **Step 10b-2 runs if and only if step 10b-1 returned `checks_covering_lifecycle_status = 0`.** In
  every other case the migration performs no failable DDL on `public.content` and 10b-2 would be a
  pointless scan of a production table.
- Order: after Item 10, in the same session. It reads `public.content`, which Item 10 already reads.

---

## 4. EXPECTED OUTPUT AND INTERPRETATION

Step 10b-1 columns: `content_present`, `lifecycle_column_present`,
`checks_covering_lifecycle_status`. Step 10b-2 columns: `lifecycle_status`, `row_count`.

| 10b-1 result | 10b-2 | Verdict | Meaning |
|---|---|---|---|
| count = **0**, 10b-2 returns **zero rows** | run | **PASS** | STEP 6 will add the CHECK and no existing row can reject it, as of this moment |
| count = **0**, 10b-2 returns **rows** | run | **FAIL — do not apply** | each listed value aborts STEP 6 with `23514`. Remediation is a data change and is authorized by no phase |
| count = **1** | **not run** | **NOT APPLICABLE** | STEP 6 either changes nothing or performs the superset replacement, neither of which can reject a row |
| count **> 1** | **not run** | **NOT APPLICABLE** | the migration refuses at `FIX3-LIFE-02` before touching data |
| count = **NULL**, `content_present` false | not run | **INCONCLUSIVE — escalate** | `public.content` is absent, a far larger finding than this item; the migration refuses at `FIX3-LIFE-01` |
| count = **NULL**, `lifecycle_column_present` false | not run | **INCONCLUSIVE — escalate** | the column is absent; the migration refuses at `FIX3-LIFE-01` and contradicts `FIX3-PRECOND-15` |
| 10b-1 not run, errored, or ambiguous | — | **INCONCLUSIVE — stop** | do not infer the branch; do not run 10b-2 speculatively |

### The misleading-pass state this is written to avoid

**`NOT APPLICABLE` is not a pass for Item 6, and must never be recorded as one.** A count of 1 means
only that *this* preflight has nothing to find. Which sub-branch actually applies — nine-value
validated, eight-value predecessor, or one of the four refusals `FIX3-LIFE-03/04/05/07` — is
established by **Item 6**, and three of those outcomes are refusals that would stop the migration.
Record 10b as `NOT APPLICABLE` and read Item 6 separately.

Equally: a 10b **PASS** excludes one abort class at one instant. It does not authorize application,
and it says nothing about the `23503` class Item 10 covers or about the ~95 other `FIX3-*` guards.

---

## 5. MINIMIZATION

Step 10b-1 returns two booleans and one integer. Step 10b-2 returns distinct `lifecycle_status`
values — a controlled nine-value-plus-outliers vocabulary — and counts. **No row identifiers, no
free text, no personal data, no payloads.** If even outlier vocabulary values are considered
sensitive, `SELECT count(*)` over the same `WHERE` answers the go/no-go question while losing the
ability to name what needs remediation; that trade should be decided before the session, not during.

---

## 6. LIMITATIONS AND STOP CONDITIONS

- **Time-of-check only.** A row written between 10b-2 and the apply reintroduces the exposure. Run
  it immediately before any future authorized application, in the same window as Item 10.
- **Scope is one abort class.** It predicts `23514` from STEP 6's `v_ncons = 0` branch and nothing
  else.
- **Step 10b-2 is a sequential scan** of `public.content`, taking `AccessShareLock`. It blocks
  nothing, but on a large table it costs I/O — and it only ever runs in the branch where it matters.
- **It predicts the migration's branch; it does not execute it.** The migration evaluates its own
  state at apply time, and that state can change in between.
- **Stop** and record INCONCLUSIVE if 10b-1 cannot be run or returns anything other than a single
  interpretable row. Do not run 10b-2 without a `0`, and do not infer the branch from Item 6's
  definition text as a substitute.

---

## 7. EXACT INSERTION POINT AND MINIMAL DIFF PREVIEW

**It is proposed as a sub-item of Item 10, not as a twelfth item.** That is the smaller change: a new
item would make the phrase "eleven items" wrong in five places in the package
(lines 228, 251, 1185, 1224, 1253) and three in the operator steps, and would break the
`Items PASS: ___ / 11` roll-up. As a sub-item, none of those counts changes. It must **not** be
folded into Item 6, which is a definition inspection with different PASS criteria.

### Diff 1 — `FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED_V2.md` (1,279 lines)

**One insertion. No existing line is modified or removed.** Insert after line **1041** — the blank
line that closes Item 10's limitations list — and before the `---` at line 1042, which separates
Item 10 from Item 11 (`### ITEM 11` at line 1044).

```diff
@@ v2 lines 1038-1042 @@
 - **A zero-row result does not authorize application.** It excludes exactly one failure class.
   Roughly 95 other `FIX3-*` guard conditions still apply, as do the lock and timeout risks in
   section 5, and the live schema questions in items 1 through 8.
+
+#### ITEM 10b — lifecycle-CHECK data condition
+
+   [sections 1, 2, 3, 4, 5 and 6 of this proposal, rendered as the sub-item body:
+    purpose and branch map; step 10b-1; step 10b-2; preconditions;
+    the interpretation table; minimization; limitations and stop conditions]
 
 ---
```

### Diff 2 — result template, same file

**One insertion**, into the per-item block so 10b is recorded without adding a twelfth item. Insert
after the `Verdict:` line of the generic block (v2 line 1205 region):

```diff
 Verdict:              [ ] PASS   [ ] FAIL   [ ] INCONCLUSIVE
+Item 10 only — sub-item 10b (lifecycle CHECK):
+  10b-1 content_present: ____  lifecycle_column_present: ____
+  10b-1 checks_covering_lifecycle_status: ____   (0 | 1 | >1 | NULL)
+  10b-2 run? [ ] yes  [ ] no — not applicable   rows returned: ____
+  10b verdict: [ ] PASS  [ ] FAIL  [ ] NOT APPLICABLE  [ ] INCONCLUSIVE
 Limitation / warning: ____________________________________________
```

`Items PASS: ___ / 11` is unchanged and remains correct.

### Diff 3 — `FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED_V2.md` (179 lines)

**One modified line.** Line 61, the Item 10 row of the item table:

```diff
-| 10 | Tenant-consistency preflight — the approved Phase 96 §F query | see section 4.1 |
+| 10 | Tenant-consistency preflight — the approved Phase 96 §F query, **plus sub-item 10b**, the lifecycle-CHECK data condition | see section 4.1. 10b: run 10b-1 always; run 10b-2 **only** if it returns 0. A count of 1 is `NOT APPLICABLE`, **not** a pass for Item 6 |
```

Optionally, one sentence appended to the steps' section 4.2 (lifecycle CHECK), which already
describes the four STEP 6 states, pointing at 10b as the data-side check for the no-CHECK state. Not
required for correctness.

### What is *not* touched

Item 10's approved Phase 96 §F query — **byte-identical, untouched, not re-stated anywhere in this
proposal.** The unapproved Phase 98 lines 649-662 FK refinement is not adopted. No change to the
migration, the verification SQL, the harness, the originals, or the v1 corrected pair.

---

## 8. CORRECTIONS MADE TO THE EARLIER CANDIDATE

The candidate in `FIX3_PHASE99_PREFLIGHT_CORRECTION_PROPOSED.md` §4 was reviewed against the
migration rather than accepted. Four defects were found and are fixed above.

| # | Defect in the earlier candidate | Fix |
|---|---|---|
| V-1 | `k.conrelid = 'public.content'::regclass` **raises `42P01`** if the relation is absent, so the item would error instead of returning a clean INCONCLUSIVE. The migration uses `to_regclass` and refuses with `FIX3-LIFE-01`. | `to_regclass`, plus explicit `content_present` / `lifecycle_column_present` columns and a NULL count |
| V-2 | Re-expressed the branch test as `EXISTS (… unnest(conkey) …)` and omitted the migration's `attnum > 0 AND NOT attisdropped` guards. Equivalent in practice, but the preflight's whole value is predicting the migration's own branch, so it should replicate the test literally. | replicated literally, with line citations |
| V-3 | Its branch table **omitted `FIX3-LIFE-05`** (supported form, unrecognised element list, `:2522`), and its interpretation collapsed three sub-branches into "returns 1 → no action. The common and expected case" — inviting the operator to read `NOT APPLICABLE` as "Item 6 fine" when three of those sub-branches are refusals. | all ten branches tabulated; a dedicated "misleading-pass state" subsection; `NOT APPLICABLE` named as a distinct verdict |
| V-4 | No stop condition for "step 1 could not be obtained", and no verdict row for an absent relation or column. | both added to the interpretation table |

Also corrected: the candidate's stated insertion point, "package line 692", was a Phase-98-v1 line
number. In v2, line 692 is a row of Item 7's index table. The real boundary is computed above.

**And a citation correction.** `FIX3_STAGE_A_AUDIT_CLOSURE.md` twice cites this candidate as
`FIX3_STAGE_A_PACKAGE_CORRECTION_PROPOSED.md` §4. That file has **no §4** — its sections are
Correction 1 (gate), Correction 2 (Item 9) and "WHAT THIS PROPOSAL DOES NOT FIX". The candidate is in
**`FIX3_PHASE99_PREFLIGHT_CORRECTION_PROPOSED.md` §4**. The audit report is left unaltered as the
record of a completed step; this is the correction of record.
