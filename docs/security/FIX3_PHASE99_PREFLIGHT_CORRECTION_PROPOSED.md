# FIX 3 — PROPOSED PREFLIGHT CORRECTION (REVIEW ARTIFACT, NOT APPROVED)

**Status: PROPOSED. Not approved, not applied, and NOT EXECUTED against any database — not
production, not a shared database, not a disposable one.** Nothing in this document has been run.
Syntactic plausibility is not verification, and none of the SQL below has been parsed by PostgreSQL.

This is a review artifact produced by Phase 99. It does **not** modify
`docs/security/FIX3_PHASE98_STAGE_A_OWNER_RUN_EVIDENCE.md`, which remains byte-unchanged.

---

## 1. WHAT WAS REVIEWED, AND WHAT SURVIVED REVIEW

| Subject | Verdict |
|---|---|
| The approved Phase 96 §F preflight query, reproduced verbatim as item 10 of the Phase 98 package | **ADEQUATE — no change proposed** |
| The `NEEDS REVIEW` refinement embedded in item 10 (package lines 649-662) | **INCOMPLETE — a latent defect; correction proposed in section 3** |
| Coverage of data conditions that abort Fix 3 **other than** foreign-key validation | **INCOMPLETE — one uncovered condition; addition proposed in section 4** |

**The approved query is not being replaced.** Both proposals are additive or replace only the
unapproved refinement block.

---

## 2. THE APPROVED QUERY IS ADEQUATE — why

Checked against the migration's own FK specification (lines 1284-1287) and the column-shape
specification (lines 780-813), not against prior prose.

### The four relationships Fix 3 validates synchronously

| # | Child → Parent | Child columns | Parent columns | `ON DELETE` | Constraint added |
|---|---|---|---|---|---|
| R1 | `content_block` → `content` | `(company_id, content_id)` | `(company_id, id)` | `c` CASCADE | `content_block_content_fk` |
| R2 | `content_recommendation` → `content` | `(company_id, content_id)` | `(company_id, id)` | `c` CASCADE | `content_recommendation_content_fk` |
| R3 | `content_recommendation` → `content_block` | `(company_id, block_id)` | `(company_id, id)` | `c` CASCADE | `content_recommendation_block_fk` |
| R4 | `content_approval_history` → `content` | `(company_id, content_id)` | `(company_id, id)` | `n` SET NULL `(content_id)` | `content_approval_history_content_fk` |
| R5 | `content_quality` → *(none)* | — | — | — | **none, by owner decision OD-12/B1** |

R5 is correctly outside the preflight. `FIX3-FK-13` refuses to apply if `content_quality` carries
any foreign key, and OD-12 affirms the soft reference. **No foreign key is proposed for R5 here.**

### Nullability, and why the guards are exactly right

| Column | NOT NULL? | Guard in the approved query | Correct? |
|---|---|---|---|
| `content_block.company_id`, `.content_id` | both NOT NULL | none | **yes** — no NULL can occur, so no exemption applies |
| `content_recommendation.company_id`, `.content_id` | both NOT NULL | none | **yes** |
| `content_recommendation.block_id` | **nullable** (spec line 798, `FALSE`) | `r.block_id IS NOT NULL` | **yes** — NULL means "the whole content", and under MATCH SIMPLE a NULL in the referencing tuple exempts the row entirely. Without this guard every whole-content recommendation would be a false positive. |
| `content_approval_history.content_id` | NOT NULL in the legacy shape; **nullable after STEP 3** | `h.content_id IS NOT NULL` | **yes** — harmless pre-apply, essential if the query is ever run post-apply |

All four composite foreign keys are `MATCH SIMPLE` (`confmatchtype = 's'`), which is what makes the
NULL exemption apply at all.

### No false positives

The approved query's join is on the **full composite key** in every branch. A row is reported only
when no parent row matches on both columns — which is precisely the condition
`ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY` validates. Nothing else is reported.

### No row multiplication

`LEFT JOIN … ON c.id = b.content_id AND c.company_id = b.company_id` can match at most one parent
row, because `(company_id, id)` is unique on both parents:

- On `public.content`, `FIX3-PRECOND-20` requires a usable unique key on exactly `(id)` **or**
  exactly `(company_id, id)`. Either way `(company_id, id)` is unique.
- On `public.content_block`, STEP 1B requires a usable unique key over `id`, and STEP 2 adds
  `content_block_company_id_key` on `(company_id, id)`.

So each offending child row produces exactly one output row. **This property is what the proposed
refinement in the package breaks — see section 3.**

### Column order is not a hazard

The foreign key is written `FOREIGN KEY (company_id, content_id) REFERENCES content (company_id, id)`
(migration line 1523, with `childcols` in spec order). The approved query matches on both columns
with `AND`, so its result is independent of the order the constraint names them.

### Output minimization

Each branch returns a relationship label and three UUIDs: the child row id, the child `company_id`,
and the reference. No business column, no free text, no personal data.

### Conclusion for the approved query

**ADEQUATE.** It detects exactly the foreign-key violation class, for all four relationships, with
correct NULL handling, no false positives, no row multiplication, and minimal output. **No change
is proposed to it, and the Phase 98 package's item 10 may stand as written in that respect.**

---

## 3. CORRECTION 1 — the unapproved refinement has a latent defect

### The defect

Package lines 649-662 propose distinguishing a tenant mismatch from a missing parent using a second
LEFT JOIN on the parent's `id` **alone**:

```sql
  LEFT JOIN public.content p ON p.id = b.content_id                        -- by id alone
```

`id` alone is **not guaranteed unique** on `public.content`. `FIX3-PRECOND-20` explicitly accepts a
unique key on exactly `(company_id, id)` as an alternative to one on exactly `(id)`, and the
migration's own commentary (lines 383, 872-873) calls a `PRIMARY KEY (company_id, id)` "a defensible
tenant-partitioning choice". Under that permitted shape two `content` rows may share an `id` across
different companies, and this join **multiplies the output**: one offending child row would be
reported two or more times, with a different `parent_company` each time.

Consequences, in order of seriousness:

1. **Inflated counts.** An operator counting returned rows would overstate how many rows need
   remediation.
2. **Contradictory `kind` values.** The same child row could appear once as `tenant_mismatch` and
   once more with a different parent, which reads as data corruption rather than a query artifact.
3. It is **silent**. On a target where `id` happens to be unique — such as the committed
   production-shaped baseline, where `content_pkey` is on `(id)` — the defect never shows, so
   testing on a baseline-like database would not reveal it.

This defect was introduced in Phase 97, carried into the Phase 98 package, and is caught here.
It is exactly why the block was marked `NEEDS REVIEW` rather than approved.

### The correction — `EXISTS` instead of a second join

`EXISTS` yields one boolean per child row regardless of how many parents match, so the output is
duplicate-safe under either permitted parent-key shape. The `WHERE NOT EXISTS (…composite…)`
predicate is logically identical to the approved query's `LEFT JOIN … WHERE … IS NULL`, so the
**set of reported rows is unchanged** — only the classification column is added.

```sql
-- PROPOSED, NOT APPROVED, NOT EXECUTED.
-- Duplicate-safe classification of the same rows the approved Phase 96 query returns.
-- `parent_company` is omitted deliberately: with a non-unique parent id there can be more than
-- one, and reporting one arbitrarily would be misleading. Remediation can look it up per row.

SELECT 'content_block' AS child, b.id AS child_id, b.company_id AS child_company,
       CASE WHEN EXISTS (SELECT 1 FROM public.content p WHERE p.id = b.content_id)
            THEN 'tenant_mismatch' ELSE 'missing_parent' END AS kind
  FROM public.content_block b
 WHERE NOT EXISTS (SELECT 1 FROM public.content m
                    WHERE m.id = b.content_id AND m.company_id = b.company_id)
UNION ALL
SELECT 'content_recommendation->content', r.id, r.company_id,
       CASE WHEN EXISTS (SELECT 1 FROM public.content p WHERE p.id = r.content_id)
            THEN 'tenant_mismatch' ELSE 'missing_parent' END
  FROM public.content_recommendation r
 WHERE NOT EXISTS (SELECT 1 FROM public.content m
                    WHERE m.id = r.content_id AND m.company_id = r.company_id)
UNION ALL
SELECT 'content_recommendation->block', r.id, r.company_id,
       CASE WHEN EXISTS (SELECT 1 FROM public.content_block p WHERE p.id = r.block_id)
            THEN 'tenant_mismatch' ELSE 'missing_parent' END
  FROM public.content_recommendation r
 WHERE r.block_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.content_block m
                    WHERE m.id = r.block_id AND m.company_id = r.company_id)
UNION ALL
SELECT 'content_approval_history', h.id, h.company_id,
       CASE WHEN EXISTS (SELECT 1 FROM public.content p WHERE p.id = h.content_id)
            THEN 'tenant_mismatch' ELSE 'missing_parent' END
  FROM public.content_approval_history h
 WHERE h.content_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.content m
                    WHERE m.id = h.content_id AND m.company_id = h.company_id);
```

### Relationship-by-relationship justification

| # | Nullable guard retained? | Parent probed for `kind` | Why |
|---|---|---|---|
| R1 | not needed — both columns NOT NULL | `public.content` | mirrors the approved branch exactly |
| R2 | not needed — both columns NOT NULL | `public.content` | mirrors the approved branch exactly |
| R3 | **yes**, `r.block_id IS NOT NULL` | `public.content_block` | a NULL `block_id` is a supported state, not a violation |
| R4 | **yes**, `h.content_id IS NOT NULL` | `public.content` | nullable after STEP 3; the guard also makes the query safe to run post-apply |
| R5 | n/a | n/a | `content_quality` has no FK, by OD-12/B1 — deliberately absent |

### Interpretation

- `kind = 'missing_parent'` — no parent row carries that id at all. A referential-integrity
  problem; the child points at something deleted or never created.
- `kind = 'tenant_mismatch'` — a parent with that id exists, but under a different `company_id`.
  A **tenant-isolation** problem, and the more serious of the two.
- Both abort the migration identically, at STEP 4, with a raw `23503`. The distinction guides
  remediation, not the go/no-go decision.

### Assumptions, stated

1. `public.content` and `public.content_block` exist. If the four tables are absent, production is
   on Fix 3's CREATE path and the whole preflight is moot.
2. `company_id` is NOT NULL on every child table, per the shape spec — so no child branch needs a
   `company_id IS NOT NULL` guard. A child row carrying a `company_id` that exists in no `companies`
   row is still detected, because it cannot match any parent pair; it would classify as
   `tenant_mismatch` if the referenced id exists elsewhere, or `missing_parent` if it does not.
3. The reader wants the same row set as the approved query, only classified. This proposal does not
   widen or narrow that set.

### Exact lines this would change in the Phase 98 package

**Replace lines 649-662** of `docs/security/FIX3_PHASE98_STAGE_A_OWNER_RUN_EVIDENCE.md` — the
fenced `sql` block containing the flawed refinement — with the block in this section. **Lines
644-647**, which introduce the refinement as unapproved, would need one wording change: they say the
refinement is "shown here for one relationship", whereas the corrected form covers all four.
No other line of the package changes under Correction 1.

---

## 4. CORRECTION 2 — one data-dependent abort is not covered at all

### The gap

The package treats the lifecycle CHECK only as **item 6**, a definition inspection. But STEP 6 can
also **add** that constraint, and an `ADD CONSTRAINT … CHECK` validates every existing row
synchronously, exactly as a foreign key does.

STEP 6's branches, from the migration:

| Branch | Condition | DDL | Can it fail on data? |
|---|---|---|---|
| `v_ncons > 1` | more than one CHECK covers `lifecycle_status` | none — refuses `FIX3-LIFE-02` | no |
| **`v_ncons = 0`** | **no CHECK covers `lifecycle_status`** | **`ADD CONSTRAINT … CHECK (…nine values…)`** (line 2445) | **YES — fails `23514` if any row holds an out-of-vocabulary value** |
| `v_ncons = 1`, nine-value form, validated | the expected state | **none** — "LEFT UNCHANGED (no DDL, no revalidation scan)" | no |
| `v_ncons = 1`, eight-value predecessor form | DROP + ADD the nine-value form (lines 2514-2516) | **no** — nine values is a strict superset of eight, so every row that satisfied the old CHECK satisfies the new one |
| `v_ncons = 1`, any other state | none — refuses `FIX3-LIFE-03/04/07` | no |

So exactly one branch carries data risk, and the preflight does not look at it. A failure there
would surface as **`23514`, not `23503`**, and again with **no `FIX3-*` code**.

### How likely is it?

Low, on present evidence, and that evidence is dated. The committed production-shaped baseline
carries **exactly one** CHECK covering `lifecycle_status` — `content_lifecycle_status_check`, in the
nine-value form — so a target resembling the baseline takes the no-DDL branch and the risk does not
arise. But the live target is unverified; that is the entire premise of Stage A. The check below
costs one catalog query plus, only when that returns zero, one grouped scan.

### The proposed addition

```sql
-- PROPOSED, NOT APPROVED, NOT EXECUTED.  Step 1: does any CHECK cover lifecycle_status?
SELECT count(*) AS checks_covering_lifecycle_status
  FROM pg_constraint k
 WHERE k.conrelid = 'public.content'::regclass
   AND k.contype  = 'c'
   AND EXISTS (SELECT 1
                 FROM unnest(k.conkey) AS u(attnum)
                 JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.attnum
                WHERE a.attname = 'lifecycle_status');
```

**Run step 2 only if step 1 returns 0.** If it returns 1 the migration changes nothing or performs
a superset replacement, and if it returns more than 1 the migration refuses at `FIX3-LIFE-02`
before touching data — in both cases there is nothing to find.

```sql
-- PROPOSED, NOT APPROVED, NOT EXECUTED.  Step 2: values that would fail the CHECK Fix 3 would add.
SELECT lifecycle_status, count(*) AS row_count
  FROM public.content
 WHERE lifecycle_status NOT IN ('draft','generated','edited','approved','adapted',
                                'scheduled','published','archived','quality_reviewed')
 GROUP BY lifecycle_status
 ORDER BY row_count DESC;
```

**A deliberate subtlety.** No `IS NULL` branch is included, and that is correct rather than an
oversight. A `CHECK` fails only when its expression evaluates to **FALSE**; `NULL` passes. For a
NULL `lifecycle_status`, `NOT IN (…)` evaluates to `NULL`, so the row is excluded from this result
— which matches the constraint's own behavior exactly. Adding `OR lifecycle_status IS NULL` would
manufacture false positives. (`public.content.lifecycle_status` is in any case NOT NULL with default
`'draft'`.)

### Interpretation

- Step 1 returns **1** → no action. The common and expected case.
- Step 1 returns **0** and step 2 returns **zero rows** → PASS. The CHECK can be added safely.
- Step 1 returns **0** and step 2 returns **rows** → **FAIL, do not apply.** Each distinct value
  listed will abort STEP 6 with `23514`. Remediation is a data decision and is not authorized by
  any phase.
- Step 1 returns **more than 1** → the migration refuses at `FIX3-LIFE-02` regardless of data.

### Minimization

Step 1 returns a single integer. Step 2 returns distinct `lifecycle_status` values and counts — a
controlled vocabulary column, no identifiers, no free text, no personal data.

### Where it would go in the package

As **item 10b**, immediately after item 10 and before item 11 (package line 692), so that both
data-dependent abort conditions sit together. It could equally be a second part of item 10. It must
**not** be folded into item 6, which is a definition inspection with different PASS criteria.

---

## 5. CONCLUSION, AND WHAT IT MEANS FOR THE PHASE 98 PACKAGE

| Question | Answer |
|---|---|
| Is the approved Phase 96 §F query adequate? | **Yes.** No correction proposed. |
| Can the Phase 98 package's item 10 be relied on as the foreign-key preflight? | **Yes**, for the foreign-key violation class it covers. |
| Does the package need a versioned correction before the owner runs it? | **Not for the approved query.** Two improvements are proposed: replace the unapproved refinement (Correction 1), and add the lifecycle-CHECK data condition (Correction 2). |
| Should the owner rely on the refinement block as it currently stands? | **No.** It is already marked `NEEDS REVIEW` in the package, and this review finds a real defect in it. It must not be used until Correction 1 is approved. |
| Is production application authorized by any of this? | **No.** |

**Recommended handling.** The owner may run the Phase 98 package **as written**, provided the
`NEEDS REVIEW` block at package lines 649-662 is not used — it is already labelled unapproved, so
the package is safe to execute as it stands. Correction 2 is the more valuable of the two: it closes
a genuine coverage gap at the cost of one catalog query. Neither correction is required for the
approved query to be trustworthy.

**Nothing in this document has been executed.** The proposed SQL has not been parsed by PostgreSQL,
run against a disposable database, or validated by anything beyond static review against the
migration source. It must not be described as verified.
