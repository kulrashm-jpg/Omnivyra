# FIX 3 — PHASE 97: OWNER DECISIONS AND STAGE A READINESS

Governance and readiness phase. No implementation change, no production access, no SQL execution,
no migration application, no commit, no deployment. Companion to
`FIX3_PHASE96_BEHAVIORAL_VALIDATION.md` and `FIX3_ISSUE_REGISTER.md`.

---

## A. EXECUTIVE DECISION

**READY FOR OWNER DECISIONS; STAGE A BLOCKED**

Both decision briefs are complete and evidenced from source. Stage A remains blocked on a single,
precisely identified missing capability, stated in section E.

Investigating the two findings changed the picture Phase 96 handed over. Neither is a defect, and
both are better characterised than before:

- **Decision A** is not simply "STEP 7 adopts the existing trigger function". The selection has
  **four ordered branches**, and the second of them actively **prefers** `set_content_updated_at()`
  over `omnivyra_touch_updated_at()`. More importantly, the committed production baseline settles
  which branch production would take: `set_content_updated_at` appears **0 times** in it and
  `omnivyra_touch_updated_at` **68 times**, so a production apply lands on the house-standard
  function.
- **Decision B** is not a new question. The absence of a foreign key on `content_quality.content_id`
  is an **already-recorded owner decision**, cited in four places in the migration, enforced by a
  guard (`FIX3-FK-13`) that **refuses to apply if an FK is present**, and asserted by the
  verification artifact. What Phase 96 asked for as acknowledgement is therefore re-affirmation of
  an existing ruling, not a fresh decision.

Two corrections to statements this programme has previously made are recorded in section F.

### Baseline preserved

| | Value |
|---|---|
| HEAD | `5604b50bdebd23efd6d040b90f5802954413b656`, detached |
| staged / modified / untracked | 0 / 78 / 14 — unchanged from the end of Phase 96 |
| Phase 96 report | present, 522 lines, 33,521 bytes, sha256 `ec932aa1c503c1a1c1b4af63ce0fbb3c7a2860c10cb05464562552eaa299fe9d` — matches what Phase 96 recorded |

| Protected artifact | SHA-256 | Status |
|---|---|---|
| `20260718000002_content_quality_collaboration.sql` (frozen) | `34dffb69d4c500d0ed827ad9114778a1235ad79df3c022643decb3c55711a49d` | unchanged |
| `20261212000000_content_quality_collaboration_tenant_consistent.sql` | `2ab29a6e2f848d2051418ec7d371c99b15463bf83a6d00da6370153711693f4e` | unchanged |
| `_fix3_tenant_consistent/verification.sql` | `5c62e0155bf1d4d1d911597549d83bb252cf54b66f89ba0774070371da26601b` | unchanged |
| `scripts/ci/real-schema-ci.sh` | `63e8920b916f8ca3f5a717d5b4a98efbe85d68dc2e4a7f35100fa215469a5e1e` | unchanged |

No disposable test was re-run: the Phase 96 report and the repository source supplied every fact
needed. No Docker container or database was started in this phase.

### Register alignment

The existing register numbers owner decisions `OD-1` through `OD-10`. To keep one place to look,
these two should be filed as **OD-11** (trigger convergence) and **OD-12** (`content_quality`
foreign key). Filing them is a documentation edit and is **not** performed in this phase.

**Naming collision, flagged to prevent confusion.** The migration header already uses the labels
"DECISION B" and "DECISION C" for pre-existing rulings — DECISION B being the tenant-consistency
guarantee and DECISION C the approval-history nullability. The migration states that
`content_quality` is **outside** the DECISION B guarantee. This phase's "Owner decision B" is a
different thing: it is about `content_quality` itself. The OD-11 / OD-12 labels avoid the clash and
are used from here on.

---

## B. OWNER DECISION A (proposed OD-11) — TRIGGER-FUNCTION CONVERGENCE

### What is affected

Exactly one trigger on one table: `content_block_set_updated_at` on `public.content_block`,
`BEFORE UPDATE FOR EACH ROW`, `tgtype = 19`, enabled, no WHEN clause, no arguments. No other Fix 3
table has an `updated_at` column, so no other trigger is in scope. `public.content` separately
carries `content_touch_updated_at`, which Fix 3 does not own and does not modify.

### What each path produces, and why

STEP 7 selects an executor through **four ordered branches**
(`20261212000000_...tenant_consistent.sql:2631-2662`):

| Order | Condition | Result |
|---|---|---|
| 1 | the trigger already exists and executes one of the two approved functions | **adopt it** |
| 2 | otherwise, `public.set_content_updated_at()` exists | choose `set_content_updated_at()` |
| 3 | otherwise, `public.omnivyra_touch_updated_at()` exists | choose `omnivyra_touch_updated_at()` |
| 4 | otherwise | **create** `set_content_updated_at()` as SECURITY INVOKER |

Phase 96 described only branch 1. Branches 2 and 4 matter: the precedence **prefers**
`set_content_updated_at()` whenever no trigger is already in place, and will create it from nothing
if neither function exists.

Observed, from Phase 96 run logs:

- **Reconcile path** (`trans_ok`, first apply): branch 1 — the frozen predecessor had already created
  `set_content_updated_at()` and bound the trigger to it, so Fix 3 adopted it. Notice recorded:
  "adopting set_content_updated_at() ... 1 existing trigger(s) depend on it — LEFT UNCHANGED".
- **Create path** (`w6`): no trigger and no `set_content_updated_at()` existed, so branch 3 chose
  `omnivyra_touch_updated_at()`. The reapply then logged branch 1 against that same function,
  "70 existing trigger(s) depend on it".

### Which path production would take

This is now answerable from the committed baseline, which is a schema-only `pg_dump` of the real
production database at ledger position `20260916000000`:

| Symbol | Occurrences in `supabase/_schema/baseline.sql` |
|---|---|
| `omnivyra_touch_updated_at` | **68** (including its `CREATE FUNCTION` at line 3472) |
| `set_content_updated_at` | **0** |

`set_content_updated_at()` is defined by the four Wave content migrations
(`20260718000000`, `...0001`, `...0002`, `...0003`), all of which sit **below** the baseline's ledger
position. Their function is nonetheless absent from the dump. The consistent reading is that the
whole `20260718*` content wave was never applied to production — which also matches the Phase 96
finding that none of the four Fix 3 tables appears in the baseline.

**Therefore, on the evidence available, a production apply would take branch 3 and land on
`omnivyra_touch_updated_at()`** — the house-standard function. The divergence materialises only in
environments where the Wave *was* applied. This is an inference from a dated dump, not a statement
about production today; confirming it is a Stage A item.

### Are the two functions equivalent?

Established from source and from Phase 96 catalog evidence, not from names:

| Property | `omnivyra_touch_updated_at()` | `set_content_updated_at()` |
|---|---|---|
| body (normalised) | `begin new.updated_at = now(); return new; end;` | `begin new.updated_at = now(); return new; end;` |
| return type / arity | trigger / 0 | trigger / 0 |
| language | plpgsql | plpgsql |
| SECURITY DEFINER | no | no |
| pinned `proconfig` | none | none |
| dependent triggers (observed) | 69 others plus Fix 3's own = 70 | 1 in the legacy database; up to 5 if the whole Wave is applied |

Both bodies normalise into the migration's own two-string accepted allowlist
(`...:2611-2614`), which is case- and whitespace-insensitive. STEP 7 validates whichever function it
selects against that allowlist and raises `FIX3-FN-06` if the body is anything else. The functions
are therefore **demonstrably equivalent in timestamp behavior**, and the divergence is referential
rather than behavioral.

### Does function identity matter to the contract?

Not to the application, and only in a bounded way to the schema contract:

- **No application code depends on either name.** A scoped sweep of `backend/`, `pages/`, `hooks/`
  and `scripts/` found zero references in product code. The only two hits are assertions in
  `backend/tests/unit/knowledgeGraphSchemaPrivacyB71.test.ts:147` and
  `platformNoveltyPrivacyB5.test.ts:95`, which assert that generated DDL for **unrelated** tables
  uses `omnivyra_touch_updated_at` and describe it as the "house trigger fn". That is evidence of a
  house convention, not a Fix 3 dependency.
- **The verification artifact accepts either, by name.** `FIX3-VERIFY-09`
  (`verification.sql:782-789`) requires the trigger to execute one of exactly those two functions and
  fails on anything else, then checks `tgtype`, enabled state, body and so on. Non-convergence is
  thus accommodated deliberately at the verification layer as well as in the migration.

### What convergence would cost

Standardising on one function would require, in a **new migration numbered above `20261212000000`**
(the highest version currently in the tree; the governance floor of `20261026000000` is already
exceeded by Fix 3 itself):

1. `DROP TRIGGER content_block_set_updated_at ON public.content_block` and recreate it executing the
   canonical function — the trigger must be replaced because a trigger's function cannot be altered
   in place.
2. A decision about the other four Wave triggers that also point at `set_content_updated_at()`
   (`20260718000000:124,127`, `...0001:94`, `...0002:94`, `...0003:110`), on tables outside Fix 3's
   ownership. Re-pointing only `content_block` would leave the schema *more* mixed, not less.
3. Possibly dropping the now-unreferenced function, which is a separate dependency question.
4. A narrowing of `FIX3-VERIFY-09` from two accepted names to one, which edits the frozen artifact.

It would **not** require data migration, a table rewrite or a validation scan. The trigger swap is a
catalog operation, though it takes a brief ACCESS EXCLUSIVE lock on `content_block`.

### Options

**A1 — Accept intentional non-convergence.** Record that the executor is one of two
behaviorally-equivalent functions chosen by documented precedence, and change nothing.
*Consequences:* no code change, no new migration, no risk to the frozen artifact set; Fix 3 and the
artifact already handle both cases. Production is expected to land on the house-standard function
anyway. *Risk:* in Wave-applied environments two near-identical functions persist, so any future
change to timestamp semantics must be applied to both or they will silently diverge in behavior
rather than merely in name. The register must carry that maintenance note.

**A2 — Require convergence on a canonical function.** `omnivyra_touch_updated_at()` is the only
defensible canonical choice: it is the house convention, it is the one present in production, and it
already carries 69 other dependents. *Consequences:* a new migration above `20261212000000`
performing the trigger swap, plus a decision on the four sibling Wave triggers and on narrowing
`FIX3-VERIFY-09`. *Risk:* touches the frozen artifact; enlarges a change set that has just been
validated; the benefit is consistency rather than any corrected behavior. Note the awkwardness that
STEP 7's branch 2 and branch 4 both *prefer* `set_content_updated_at()`, so A2 would also mean
accepting that Fix 3's own precedence disagrees with the canonical choice, or changing Fix 3 too.

**A3 — Defer pending independent review.** Leave behavior unchanged and re-examine after Stage A
establishes which function production actually has. *Consequences:* none now; the question is
answered with live evidence rather than a dated dump. *Risk:* the item stays open across a release
boundary.

### Recommendation

**A1**, with one documentation requirement. The functions are equivalent in behavior by source and
by catalog evidence; no application code depends on either name; both the migration and the artifact
were built to accept either; and the production path is expected to be the house-standard function
regardless. A2 buys naming consistency at the price of editing the frozen artifact and enlarging a
freshly validated change set, which is a poor trade now. If the owner wants convergence as a tidiness
goal, it belongs in a separate, later migration that handles all five Wave triggers together rather
than `content_block` alone.

The documentation requirement under A1: the register entry must state that two equivalent functions
may coexist and that **any future change to timestamp semantics must be applied to both**.

### Owner response required

> **OD-11.** Choose **A1**, **A2** or **A3**. If A2, confirm the canonical function and whether the
> four sibling Wave triggers are in scope.

---

## C. OWNER DECISION B (proposed OD-12) — `content_quality.content_id` HAS NO FOREIGN KEY

### Is this a defect, a concession, or a decision? It is a recorded decision.

The specification is explicit and consistent across three artifacts.

**The frozen predecessor** declares the column as a soft reference in its own comment
(`20260718000002_content_quality_collaboration.sql:18`):

```sql
content_id    uuid,                       -- soft ref -> content.id
```

It is nullable from the outset, and its index is deliberately partial
(`WHERE content_id IS NOT NULL`), which only makes sense for a column expected to be NULL for some
rows.

**Fix 3 states the ruling four times**, and treats it as binding:

- `:63-68` — "content_quality.content_id REMAINS a soft reference with no foreign key, **by owner
  decision**. content_quality is therefore OUTSIDE the DECISION B guarantee: its only writer is a
  service-role path ... so the correctness of its content_id is enforced ONLY by the calling route
  ... not by the database."
- `:544` — the FK graph lists `content_quality -> (no FK, by owner decision)`.
- `:1565` — `FK-13  content_quality carries any foreign key at all (owner decision)`.
- `:1649-1652` — **`FIX3-FK-13` refuses to apply** if `content_quality` carries *any* foreign key:
  "content_quality.content_id is a SOFT reference by owner decision, and the companion verification
  script asserts the table is foreign-key-free. Refusing to remove them; resolve manually, or raise
  the owner decision to adopt a foreign key."

**The verification artifact** asserts the table is foreign-key-free, as the migration header at
`:128` describes.

So Fix 3 does not merely omit the constraint. It **actively refuses to proceed if one exists**, and
names the owner decision as the reason. Phase 96 was right to surface the behavior, but what is
being asked for is re-affirmation of an existing ruling, not a new one.

### Intended deletion behavior

Currently: **orphan retention**. Deleting the referenced content leaves the `content_quality` row in
place with a dangling `content_id`, demonstrated in Phase 96. Nothing in the specification states
that this is *desired*; it is simply the consequence of there being no constraint. The scorecard
table is append-only history ("Insert a scorecard snapshot (append-only history; the newest wins on
read)", `qualityService.ts:68-69`), so retention is at least coherent with its purpose — a historical
evaluation is arguably still a fact about what was scored, even after the content is gone.

### Which flows read and write the relationship

The migration header states the writer is a single service-role path. **That statement is
incomplete.** `persistScorecard` has **three** production call sites, not one:

| Call site | How the (company_id, content_id) pairing is established |
|---|---|
| `pages/api/content/[id]/quality.ts:76` | **By explicit validation.** `getContent(id, scopedCompanyId)` at `:53` returns 404 if the content does not belong to the caller's company, before any write. The route comment at `:20-23` says exactly that: "`enforceCompanyAccess` only proves user to company, not content to company." POST additionally requires `enforceContentWriteRole`. |
| `lib/post/runPostGeneration.ts:592` | **By construction.** The pipeline itself creates the content row via `createContent({ companyId: input.company_id, ... })` at `:512-531`, takes `content_id = persisted.id` at `:532`, then persists the scorecard with the *same* `input.company_id`. |
| `lib/thread/runThreadGeneration.ts:535` | **By construction**, identical pattern (`content_id = persisted.id` at `:475`). |

All three therefore produce a correctly paired row. Readers are `quality.ts:42`,
`prediction.ts:67` and `recommendations.ts:64`, and all three filter on **both** `content_id` and
`company_id` (`qualityService.ts:109-110`), so a mis-paired row would not be returned to the other
tenant by any existing read path.

Two properties of the writer are worth stating plainly, because they bound the protection:
`persistScorecard` itself performs **no validation** — it writes whatever pair it is handed
(`qualityService.ts:77-82`) — and it uses the **RLS-bypassing service-role client**
(`qualityService.ts:5-6`), so neither the database constraint layer nor the policy layer is in the
path. The entire guarantee rests on those three callers.

### Would adding a foreign key reject existing data?

Yes, potentially. A composite `(company_id, content_id)` to `content(company_id, id)` would validate
synchronously, exactly as the four existing composite FKs do, and would abort with a raw `23503` on
any row that is orphaned or mis-paired — the same failure class as Phase 96 scenario S23. Because
`content_id` is nullable, MATCH SIMPLE would exempt NULL rows, which preserves the "scorecard not
tied to a content row" state the partial index was built for. Any move to B2 therefore requires its
own preflight and a remediation decision for whatever it finds.

### Options

**B1 — Affirm the current contract.** Record that `content_quality.content_id` is intentionally a
soft reference, that cross-tenant values are accepted by the database, and that rows survive
deletion of the content they name. *Consequences:* nothing changes; Fix 3, `FIX3-FK-13` and the
artifact are already consistent with this. *Risk:* tenant correctness for this one column depends
entirely on three application call sites, none of which is enforced by the database or by RLS. A
fourth writer added later, or a direct service-role write, would silently bypass it. The register
entry should therefore pin the three call sites by name so a reviewer can check them.

**B2 — Require referential and tenant consistency.** Add
`FOREIGN KEY (company_id, content_id) REFERENCES public.content(company_id, id)` with a deletion rule
the owner chooses — `ON DELETE SET NULL (content_id)` matching the approval-history pattern and
preserving scorecard history, or `CASCADE` which deletes scorecards with their content.
*Consequences:* requires a new migration above `20261212000000`, requires relaxing or removing
`FIX3-FK-13`, requires editing the frozen verification artifact's FK-free assertion, and requires a
preflight plus a remediation plan for existing violating rows. *Risk:* substantial; it reverses a
standing decision and modifies artifacts that have just been validated. *Benefit:* the one remaining
tenant-consistency gap in a migration whose stated purpose is tenant consistency would be closed in
the database rather than in three application call sites.

**B3 — Defer pending specification or independent review.** Preserve current schema behavior and
revisit once Stage A reveals whether production actually contains orphaned or mis-paired scorecard
rows. *Consequences:* none now; the decision would then be made against real data instead of
hypothetically. *Risk:* the gap stays open across a release boundary.

### Recommendation

**B1**, with two documentation requirements, on these grounds: it is an existing owner ruling rather
than an open question; all three writer paths were verified in this phase to establish the pairing
correctly; every reader is company-scoped; and B2 would reverse a standing decision while editing
the frozen artifact set immediately after validation.

The two documentation requirements under B1:

1. **Correct the migration header's writer statement.** `:65-68` names one writer; there are three.
   The security conclusion survives, but the sentence as written would mislead a future reviewer into
   checking one file. This is a comment-only correction to the migration and is therefore a
   **separately authorized future edit** — it is not made in this phase, and it would change the
   migration's hash.
2. **Pin the three call sites in the register**, so that adding a fourth writer is visibly a
   decision rather than an accident.

If the owner prefers database-level enforcement, B2 is coherent but should be sequenced **after**
Fix 3 is applied and verified in production, never folded into it.

### Owner response required

> **OD-12.** Choose **B1**, **B2** or **B3**. If B2, specify the deletion rule
> (`SET NULL (content_id)` or `CASCADE`) and confirm that editing `FIX3-FK-13` and the verification
> artifact is authorized. If B1, confirm whether the migration-header comment correction is
> authorized as a separate future edit.

---

## D. TENANT-CONSISTENCY PREFLIGHT

### Source

The exact query is the one specified in **Phase 96 report, section F**, "Recommended operator
preflight for scenario S23". It is reproduced there in full and is not restated here, so that one
version remains canonical.

### What it checks, and why each relationship is included

It covers the four composite foreign keys Fix 3 creates, which are precisely the four constraints
that validate synchronously on apply:

| Relationship | Child columns | Nullable? | Guard in the query |
|---|---|---|---|
| `content_block` to `content` | `(company_id, content_id)` | `content_id` NOT NULL in the legacy shape | none needed |
| `content_recommendation` to `content` | `(company_id, content_id)` | NOT NULL | none needed |
| `content_recommendation` to `content_block` | `(company_id, block_id)` | **nullable** — NULL means "the whole content" | `WHERE r.block_id IS NOT NULL` |
| `content_approval_history` to `content` | `(company_id, content_id)` | NOT NULL in the legacy shape, nullable after STEP 3 | `WHERE h.content_id IS NOT NULL` |

The nullable guards are correct and necessary: under MATCH SIMPLE a NULL reference is exempt from
the constraint, so flagging such rows would produce false positives.

`content_quality` is deliberately **absent** from the preflight, because it has no foreign key and
under OD-12/B1 never will. **If the owner chooses B2, the preflight must be extended** with a fifth
branch of the same shape.

### Interpretation

- **Zero rows: PASS.** No existing row can fail the synchronous validation of the four composite
  FKs. This does not mean the apply will succeed — every `FIX3-*` guard still applies — only that
  this particular failure class is excluded at the moment the query ran.
- **One or more rows: FAIL, do not apply.** Each returned row is one that will abort STEP 4 with a
  raw `23503`. Remediation is an owner decision and necessarily a data change, which no phase has
  authorized. Phase 96 proved the abort rolls back completely, so an un-remediated apply is safe but
  pointless: it will fail after taking ACCESS EXCLUSIVE locks on five tables.
- The result is **time-of-check only**. A row written between the preflight and the apply
  reintroduces the exposure. The preflight should be run immediately before a future authorized
  application, in the same maintenance window.

### Why it must run before any future authorized application

Fix 3 adds no constraint `NOT VALID`, so validation is synchronous and the failure surfaces **inside**
STEP 4 — after STEP 0B has taken ACCESS EXCLUSIVE on five tables and after STEP 2 and STEP 3 have
already made catalog changes. The migration documents this as deliberate: "no row is ever deleted or
rewritten to force a constraint through." The consequence is that without a preflight the first
signal of a data problem is a failed production maintenance window, reported as a raw PostgreSQL
error carrying **no `FIX3-*` code** to guide the operator.

### Evidence retention

Capture the full result text, the exact timestamp, the project ref the session was connected to, and
the row counts of all five tables at the same moment. Store it beside the apply log. A zero-row
result is only meaningful if it is dated and attributable to a specific target.

### Gap in the Phase 96 query, and a proposed refinement

The Phase 96 query is **complete in coverage** — all four constraints, correct nullable handling,
and it returns only identifiers (child table, row id, `company_id`, the reference), no business
data. It has one genuine shortcoming against this phase's requirements.

**Gap: it does not distinguish a tenant mismatch from a missing parent.** Both produce a NULL on the
same two-column LEFT JOIN, so the operator cannot tell whether a row points at another company's
content — a tenant-isolation problem — or at content that no longer exists — a referential-integrity
problem. The two call for different remediation.

A reviewable refinement, offered **separately** and not as a replacement for the canonical query.
Shown for one relationship; the other three take the same shape:

```sql
SELECT 'content_block'                                             AS child,
       b.id                                                        AS child_id,
       b.company_id                                                AS child_company,
       CASE WHEN p.id IS NULL THEN 'missing_parent'
            ELSE 'tenant_mismatch' END                             AS kind,
       p.company_id                                                AS parent_company
  FROM public.content_block b
  LEFT JOIN public.content p ON p.id = b.content_id                       -- by id alone
  LEFT JOIN public.content m ON m.id = b.content_id
                            AND m.company_id = b.company_id               -- by the composite key
 WHERE m.id IS NULL;
```

The second join reproduces exactly what the foreign key will enforce; the first distinguishes why it
fails. `parent_company` is included because remediation needs it, and it is a tenant identifier
rather than business data. If even that is considered too much exposure, the same query aggregated
to `SELECT child, kind, count(*) GROUP BY 1,2` answers the go/no-go question with no row identifiers
at all, at the cost of not naming the rows to fix. **This refinement is a proposal for review; the
Phase 96 query remains the approved one until the owner says otherwise.**

---

## E. STAGE A FEASIBILITY

No connection of any kind was attempted. What follows is a survey of mechanisms and their
properties.

### Mechanisms surveyed

| Mechanism | Present? | Requires the agent to handle credentials? | Verdict |
|---|---|---|---|
| **Supabase MCP server** | **configured** — `.mcp.json` declares exactly one server, named `supabase`; this session reports `CONNECT_TIMEOUT` after 30,000 ms | **No** — the server holds its own configuration outside the agent's view | **The only agent-usable path. Currently not connected.** |
| `psql` on the host | absent | — | unusable |
| `pg_dump` on the host | absent | — | unusable |
| `pg_isready` on the host | absent | — | unusable |
| **psql inside a container** | **available** — Docker 29.7.2 with `pgvector/pgvector:pg17` cached locally | **Yes** — needs a production connection string | **Prohibited.** Technically available, which is precisely why it must be ruled out explicitly rather than ignored. |
| **Supabase CLI** | **present** at a local install path | **Yes** — `supabase link` needs a project ref and database password | **Prohibited**, and the worktree is not linked: `supabase/.temp/` retains only `cli-latest`; the link metadata files were deleted earlier in this programme. |
| **Owner-run queries, output pasted back** | always available | **No** — the owner runs them in their own session | **Viable fallback.** |

The connection failure is a failure, not an absence: the `supabase` MCP server is configured and
this session could not reach it. It must not be reported as unconfigured or as proof that no access
exists.

### Why a SELECT is not sufficient proof

Per the brief, the access path itself must be demonstrably safe, not merely the statement text.
For the MCP route the relevant properties are the server's configured role and privileges, whether
it exposes any write or DDL tool at all, and whether its session can escalate. Prior phases in this
programme recorded the Supabase MCP as read-only. **That property cannot be verified in this
session, because the server will not connect** — so it is carried forward as a prior claim, not as
established fact, and re-establishing it is part of what the next authorization must cover.

For the owner-run route, read-only character is established differently: by the statements being
bare `SELECT`s against `pg_catalog` and `information_schema` with no data-modifying CTE, executed
where possible inside `BEGIN; SET TRANSACTION READ ONLY; ... ROLLBACK;`, and ideally as a role
without write privileges.

### Minimum read-only evidence plan

Every item is catalog metadata or a count. None reads business data. All are `SELECT`-only, take no
lock beyond `AccessShareLock` on catalog relations, and are safe to run during normal traffic. The
single exception on locking is noted in item 9.

| # | Evidence | Access needed | Read-only? | Lock / exposure | PASS / FAIL / INCONCLUSIVE |
|---|---|---|---|---|---|
| 1 | Grant surface on the four Fix 3 tables, `public.content` and `user_company_roles` | `information_schema.role_table_grants` | yes | none / none | PASS: grants exist for the roles the application authenticates as. FAIL: the Fix 3 tables are reachable by a role that should not reach them. INCONCLUSIVE: query not run. |
| 2 | `user_company_roles` policies and applicable roles | `pg_policy`, `pg_class`, `pg_roles` | yes | none / predicate text only | PASS: a policy exists that lets an authenticated user read their own membership rows, so the Fix 3 predicate is satisfiable. FAIL: no such policy, meaning the policy is deny-all for ordinary users. |
| 3 | `relrowsecurity` and `relforcerowsecurity` for all five tables | `pg_class` | yes | none / none | PASS: RLS enabled on the four owned tables. The forced flag is recorded, not asserted — Fix 3 issues no FORCE statement. |
| 4 | Policy predicates, including `public.content`'s | `pg_policy` with `pg_get_expr` | yes | none / predicate text | PASS: one modelled policy per owned table with the expected USING and WITH CHECK. |
| 5 | Constraints, FK column mappings, delete actions, validation state | `pg_constraint` with `pg_get_constraintdef`, `conkey`, `confkey`, `confdeltype`, `confupdtype`, `confmatchtype`, `confdelsetcols`, `convalidated` | yes | none / none | PASS: matches the post-Fix-3 contract, or matches the legacy shape so the now-verified reconcile path applies. FAIL: an object has the right name and an incompatible definition no guard repairs. |
| 6 | Lifecycle CHECK definition and accepted values | `pg_constraint` on `public.content` | yes | none / none | PASS: the nine-element set, in any order — Phase 96 proved both orderings are accepted. |
| 7 | Index definitions and options | `pg_index`, `pg_class`, `pg_indexes` with `indoption`, `indclass`, `indcollation`, `indpred`, `indnatts`, `indnkeyatts`, validity flags | yes | none / none | PASS: the eight contract indexes match on all nine properties Phase 96 checked. |
| 8 | Trigger definitions and referenced function names | `pg_trigger` with `pg_get_triggerdef`, joined to `pg_proc` | yes | none / none | PASS: `content_block_set_updated_at` exists, `tgtype = 19`, enabled, executing one of the two approved functions. **Also answers OD-11** by revealing which function production actually has. |
| 9 | Row counts for all five tables | `count(*)` on the five tables | yes | `AccessShareLock`; a sequential scan on large tables | PASS: counts obtained. This is the **only** item that touches user tables rather than catalogs. It reads no column values. If scan cost is a concern, `pg_class.reltuples` gives an estimate with no scan at all, and that substitution should be agreed in advance. |
| 10 | Tenant-consistency preflight | the Phase 96 section F query | yes | `AccessShareLock`; joins over the four child tables | PASS: zero rows. FAIL: one or more rows — do not apply. |
| 11 | Migration-history evidence | `supabase_migrations.schema_migrations` | yes | none / version strings | Reported **separately and never merged with schema state.** The ledger is known to be desynced, and a generic prober would give a false APPLIED for Fix 3 because its tables may already exist. Ledger rows are evidence about the ledger only. |

Capture: plain text, catalog metadata and counts only, no connection strings, no credentials, no
secret-derived metadata. The target must be confirmed by **project ref `klkiseupptzbecbxwrky`**,
never by a Studio display name. Every `"char"` column — `contype`, `polcmd`, `confdeltype`,
`relkind`, `tgenabled` — must be cast with `::text` before concatenation; that is the Phase 89
defect and it recurs easily in hand-written catalog queries.

### What this plan cannot establish

Items 1 to 4 give the **configuration** of authorization. They do not give its **behavior**. A
read-only channel could demonstrate read behavior for a representative role by combining
`SET LOCAL ROLE` with a `SELECT` inside a read-only transaction, but that requires role-switch
privilege and is a materially larger ask than catalog inspection, so it should be a separate
decision. Write-path authorization — whether a policy's `WITH CHECK` actually refuses a cross-tenant
insert — **cannot be demonstrated at all without attempting a write**, which is prohibited and
should remain so. For the write path, the predicate text plus the Phase 96 CONFIG 2 result is the
strongest evidence obtainable, and it is an inference about production, not a measurement of it.

### Verdict

**BLOCKED — NO PROVABLY READ-ONLY TARGET CHANNEL**

**The exact missing capability:** a working connection to the already-configured `supabase` MCP
server, together with confirmation of the role and privileges it connects with.

**What would establish it safely**, in preference order:

1. **Restore the `supabase` MCP connection** and confirm the server is configured read-only — that
   it connects as a role without write or DDL privilege, and that it exposes no write tool. No
   credential ever reaches the agent. This is the cleanest path and needs only that the server start
   and respond.
2. **Owner-run execution.** The owner runs the agreed query set in their own session and pastes back
   the text. No credential handling by the agent at all, and read-only character is established by
   the statements plus a read-only transaction. This works today and requires no infrastructure
   change.

Both paths are compatible: the owner-run route can proceed immediately while the MCP connection is
investigated. Neither requires, and this phase does not request, broad production access.

---

## F. REMAINING RISKS AND UNVERIFIED ASSUMPTIONS

### Two corrections to this programme's earlier statements

1. **Phase 96 said the verification artifact "reports rather than pins" the trigger executor.** That
   is wrong in one respect. `FIX3-VERIFY-09` (`verification.sql:782-789`) **pins the executor to a
   two-name allowlist** and raises if the trigger executes anything else; it then validates the body
   against a separate two-string allowlist. The practical conclusion Phase 96 drew — that the
   artifact passes on both paths — stands, but the mechanism is a two-name constraint plus body
   validation, not name-agnostic body validation.
2. **Phase 96 characterised STEP 7 as adopting the existing trigger function.** That is branch 1 of
   four. Branch 2 **prefers** `set_content_updated_at()` when no trigger exists, and branch 4
   **creates** it when neither function exists. The create-path outcome Phase 96 observed came from
   branch 3, not branch 1.

Neither correction changes any Phase 96 verdict.

### RLS behavior

Unchanged from Phase 96 and still the largest open question. The disposable baseline's 6,146 public
grants are all to `postgres`, and `user_company_roles` carries only a `service_role` policy, so the
as-is environment can demonstrate deny-all and nothing more. Production's grants and
`user_company_roles` policies are unknown. The dependency is **not introduced by Fix 3** —
`public.content`'s own policy, which Fix 3 does not own, carries the identical predicate — so if the
predicate is unsatisfiable in production it is already unsatisfiable for `content` today. Items 1
to 4 of the Stage A plan would close the configuration question. The behavioral question would
remain partly open, as section E describes. **No change to production grants or policies is
recommended or requested.**

### Data consistency

Two distinct exposures, with different standing:

- **The four composite FKs**: fully enforced by the database once Fix 3 is applied, proven in Phase
  96 across cross-tenant, nonexistent-parent and re-attachment cases. The residual risk is
  pre-existing legacy data, addressed by the section D preflight.
- **`content_quality.content_id`**: not enforced by the database at all, by standing decision.
  Correctness rests on three application call sites, all verified correct in this phase, none of
  which is protected by RLS because the writer uses the service-role client. This is OD-12.

A third, quieter consequence carried forward from the migration's own header at `:69-72`: every
composite FK is `ON UPDATE NO ACTION`, deliberately, because `ON UPDATE CASCADE` would silently
re-tenant children. The consequence is that **once any child row exists, `public.content.company_id`
can no longer be updated**. That is correct behavior for a tenant boundary, but it is a new
operational constraint that did not exist under the single-column FKs, and it is absent from the
frozen predecessor's documentation.

### Lock and scan exposure

Carried forward from Phase 96 unchanged, and still **UNRESOLVED**: approximately **4,505 ms**
end-to-end on 1.5 million synthetic rows, largest single statement approximately **1,489 ms** (the
unique index build on 500k `content_block` rows), against a `statement_timeout` of 120,000 ms.

- `SET LOCAL lock_timeout = '5s'` with ACCESS EXCLUSIVE taken leaf-first on five tables. Under real
  concurrent traffic the migration may simply fail to acquire its locks and abort. That is safe —
  Phase 96 proved rollback is complete — but it is an availability consideration: the apply may need
  a quiet window to succeed at all.
- Because the whole migration is one transaction, the ACCESS EXCLUSIVE window equals total apply
  time, not any single statement's duration. For the duration of the apply, writes to all five
  tables block.
- Synchronous validation is unavoidable here: no constraint is added `NOT VALID`, so both unique
  index builds and all four FK validations complete inside the window.
- The synthetic figures come from a four-CPU laptop container with no concurrent load. They are
  **not** a production performance prediction and must not be quoted as one.

**Production facts needed for a credible assessment**, all obtainable from the Stage A plan or from
the platform console without any write: row counts for the five tables (item 9); whether
`content_block` is large enough that its unique index build dominates; the instance class and
available memory, since `maintenance_work_mem` governs index build speed; typical concurrent write
volume against `public.content` during the intended window; and whether a maintenance window with
quiesced writes is available, which would remove the `lock_timeout` risk entirely.

### Unverified assumptions, stated as such

- **That production has not changed since the baseline dump.** The inference that production lacks
  the four tables and `set_content_updated_at()` rests on a schema-only dump taken at ledger
  position `20260916000000`. It is the best available evidence and it is dated. Stage A replaces it.
- **That the Supabase MCP server is read-only.** A prior claim from earlier phases, unverifiable
  this session because the server will not connect.
- **That no fourth writer of `content_quality` exists outside the scanned directories.** The sweep
  covered `backend/`, `pages/`, `lib/`, `hooks/` and `scripts/`, excluding tests. A writer reached
  through dynamic dispatch or a raw SQL string would not have been found.
- **That the verification artifact can fail.** Still inferred from its 65 `RAISE EXCEPTION` points
  rather than demonstrated; no negative control has been authorized.

---

## G. BOUNDARY CONFIRMATION

| Question | Answer |
|---|---|
| Was production accessed? | **NO** — no connection of any kind was attempted |
| Were there any database changes? | **NO** — no database was started, connected to, or written in this phase |
| Was any SQL executed anywhere? | **NO** |
| Any commit, push, merge, deployment or reset? | **NO** |
| Was `C:\virality` accessed, traversed, read or modified? | **NO** |
| Were credentials, connection strings or secret-derived metadata read or printed? | **NO** — tooling was probed for presence only, and `.mcp.json` was read for server **names** only |
| Was `supabase db push`, reconciliation or a ledger prober run? | **NO** |
| Was any migration, artifact, harness or application file modified? | **NO** — all four protected hashes are unchanged |
| Was a migration or ledger entry created? | **NO** |
| Was an owner decision made on the owner's behalf? | **NO** — both are presented as open with recommendations |
| Was any disposable test re-run? | **NO** — no evidence gap required it |

The only file created by this phase is this report.

---

## H. NEXT AUTHORIZATION REQUESTED

Three separate items. None asks for broad production access.

### 1. Owner decision OD-11 — trigger-function convergence

> Choose **A1** (accept intentional non-convergence), **A2** (require convergence) or **A3**
> (defer). If A2, confirm the canonical function and whether the four sibling Wave triggers on
> tables outside Fix 3's ownership are in scope.
>
> Recommended: **A1**, with a register note that any future change to timestamp semantics must be
> applied to both functions.

### 2. Owner decision OD-12 — `content_quality.content_id` foreign key

> Choose **B1** (affirm the existing soft-reference decision), **B2** (require a composite foreign
> key) or **B3** (defer). If B2, specify the deletion rule and confirm that editing `FIX3-FK-13` and
> the verification artifact is authorized. If B1, confirm whether the migration-header comment
> correction at `:65-68` — which names one writer where there are three — is authorized as a
> separate, hash-changing future edit.
>
> Recommended: **B1**, with that comment correction and with the three call sites pinned in the
> register.

### 3. Authorization for one specific Stage A mechanism — not for production access generally

> Authorize **one** of the following, scoped to the eleven read-only evidence items in section E:
>
> **(a)** Investigate and restore the already-configured `supabase` MCP connection, and confirm the
> role and privileges it connects with. No credential would reach the agent. This is the preferred
> path.
>
> **(b)** Owner-run execution: the agent drafts the eleven queries for review, the owner runs them
> and pastes back the text. Available immediately, requires no infrastructure change, and involves
> no credential handling by the agent at all.
>
> Explicitly **not** requested: a production connection string, a `supabase link`, containerised
> `psql` against production, any write or DDL capability, or any change to production grants,
> policies, roles or configuration.

Until one of those is authorized and succeeds, Stage A stays **BLOCKED — NO PROVABLY READ-ONLY
TARGET CHANNEL**, and production application of Fix 3 remains unauthorized and unsupported by
evidence about the actual target.

---

## FILENAME NOTE

The brief suggested `FIX3_PHASE97_OWNER_DECISIONS_AND_STAGE_A_READINESS.md`. That name is matched by
`.gitignore:51` (`*_READINESS*.md`), which would have hidden this report from `git status` exactly as
it already hides `*_PLAN` and `*_CHECKLIST` documents elsewhere in this repository. The report is
therefore filed as `FIX3_PHASE97_OWNER_DECISIONS_AND_STAGE_A.md`, which is visible. No content was
changed by the rename.
