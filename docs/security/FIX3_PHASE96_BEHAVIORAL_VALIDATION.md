# FIX 3 — PHASE 96: BEHAVIORAL VALIDATION, ADVERSARIAL GUARD TESTING, OPERATIONAL RISK

Scope: disposable PostgreSQL only. No production access, no migration applied to any shared
database, no commit, no deployment. Companion to `FIX3_ISSUE_REGISTER.md`.

---

## A. EXECUTIVE DECISION

**PASS WITH LIMITATIONS — SPECIFIC GAPS REMAIN**

Fix 3 is behaviorally correct on every contract that could be conclusively tested, and its guard
families reject dangerous schema states with complete transactional rollback. Twenty adversarial
scenarios were rejected by the intended guard with the database proven byte-identical afterwards;
three further scenarios were repair paths that behaved correctly.

A PASS here does **not** mean production-ready, production-applied, or deployed. Six specific gaps
are listed in section E, of which two require an owner decision.

### New findings of this phase

1. **Every prior validation exercised the wrong code path.** The committed schema baseline contains
   `public.content` but **none** of the four Fix 3 tables, and the frozen predecessor sits below the
   baseline's ledger position so the harness never replays it. Fix 3 therefore took its **CREATE**
   path in every harness run to date, including all of Phase 95. The **RECONCILE** path — the one a
   production database carrying the predecessor's tables would take — had never been executed. It
   was executed for the first time in this phase and **passed** (section D).
2. **Fix 3 is not convergent.** The final `content_block` updated_at executor depends on the
   starting state: `omnivyra_touch_updated_at()` on the create path, `set_content_updated_at()` on
   the reconcile path. Both are behaviorally identical; the divergence is which function is
   referenced. STEP 7 adopts the executor the existing trigger already uses, by design. **Owner
   decision.**
3. **No preflight exists for tenant-inconsistent legacy data.** Legacy single-column FKs permit
   rows whose `company_id` disagrees with the parent's. Fix 3 adds the composite FK without
   `NOT VALID`, so such a row aborts the migration with a **raw PostgreSQL 23503 that carries no
   `FIX3-*` code**. The migration documents this as deliberate and the rollback is complete, but the
   operator gets no advance warning and no guided diagnostic. A preflight query is supplied in
   section F.

---

## B. BASELINE AND INTEGRITY

| | Before | After |
|---|---|---|
| HEAD | `5604b50bdebd23efd6d040b90f5802954413b656` (detached) | identical |
| staged / modified / untracked | 0 / 78 / 13 | 0 / 78 / 14 (this report) |

Repository `kulrashm-jpg/Omnivyra`, worktree `C:\tmp\deploy-current-main`. `C:\virality` was never
accessed. All four protected artifacts matched their expected hashes before **and** after:

| Artifact | SHA-256 |
|---|---|
| `supabase/migrations/20260718000002_content_quality_collaboration.sql` (frozen) | `34dffb69d4c500d0ed827ad9114778a1235ad79df3c022643decb3c55711a49d` |
| `supabase/migrations/20261212000000_content_quality_collaboration_tenant_consistent.sql` | `2ab29a6e2f848d2051418ec7d371c99b15463bf83a6d00da6370153711693f4e` |
| `supabase/migrations/_fix3_tenant_consistent/verification.sql` | `5c62e0155bf1d4d1d911597549d83bb252cf54b66f89ba0774070371da26601b` |
| `scripts/ci/real-schema-ci.sh` | `63e8920b916f8ca3f5a717d5b4a98efbe85d68dc2e4a7f35100fa215469a5e1e` |

Nothing was modified, restored or repaired. No repository file changed apart from this report.

### Disposable environment

`env -u W6_DB_URL W6_KEEP=1 bash scripts/ci/real-schema-ci.sh` -> **exit 0**. `W6_DB_URL` was
confirmed unset without reading any value. PostgreSQL **17.11** (Debian, x86_64) in container
`w6-real-schema` from `pgvector/pgvector:pg17`, host port 5433, no docker-compose, no production
env file, no external URL. Ready after 14 s via the two-consecutive-query check. Baseline restored
in 89 s (1 error, 0 unexpected), 823 public tables, 45 migrations replayed with Fix 3 last reporting
`ok`, then 28 suites / 525 tests passed.

Databases created inside that one disposable container: `w6` (harness), `pristine` (pre-Fix-3),
`legacy` (pristine + frozen predecessor), `trans_ok`, `trans_bad`, `s15keep`, `perf_big`,
`perf_empty`, and one short-lived clone per adversarial scenario. Retention was required and its
cleanup plan was recorded before `W6_KEEP=1` was used.

### Cleanup — fully verified

`docker rm -fv w6-real-schema` -> exit 0. Containers named `w6-real-schema`: **0**. Any `w6-*`:
**0**. Volume list **exactly restored**: 126 before, 127 while running, 126 after, with **0 added
and 0 removed** relative to the pre-phase baseline, and the one volume this phase created
(`dfe7cedbee3a...`, proven owned via `docker inspect` mount) confirmed absent. Container list
unchanged (0 added, 0 removed); the `cert-supabase` stack and `par-test` were untouched. No volume
other than this phase's own was removed.

**Harness observation (not a defect):** the harness's own `cleanup()` runs `docker rm -f` **without
`-v`**, so a harness-managed run leaves its anonymous data volume behind. This phase used `-v`
explicitly. That closes the Phase 95 "anonymous-volume cleanup not independently established" gap
for *this* phase only; whether earlier phases left orphans is not established by this evidence.

---

## C. TEST MATRIX — BEHAVIORAL

SQLSTATE values are as reported by PostgreSQL. Note that psql's `:LAST_ERROR_SQLSTATE` is sticky, so
where a test succeeded the success itself (`INSERT 0 1`, `UPDATE 1`) is the evidence, not an echoed
code.

### Lifecycle — nine-value CHECK on `public.content` including `quality_reviewed`

| ID | Test | Expected | Actual | Verdict |
|---|---|---|---|---|
| A1 | `UPDATE ... lifecycle_status='quality_reviewed'` | accepted | `UPDATE 1` | PASS |
| A2 | `INSERT` directly as `quality_reviewed` | accepted | `INSERT 0 1` | PASS |
| A3 | all nine contract values in one statement | all accepted | `INSERT 0 9` — not narrowed | PASS |
| A4 | `INSERT ... 'bogus_status'` | rejected | **23514** `content_lifecycle_status_check` | PASS |
| A5 | `INSERT ... 'Quality_Reviewed'` (case variant) | rejected | **23514** | PASS |
| A6 | `UPDATE ... 'not_a_state'` | rejected | **23514** | PASS |
| A7 | state after the three rejections | no bogus rows; A1 intact | 0 bogus rows; still `quality_reviewed` | PASS |
| A8 | after `ROLLBACK` | fixture state | 2 rows, all `draft` | PASS |

### Tenant isolation and composite foreign keys

The four composite FKs verified in the catalog, each `(company_id, <ref>)` referencing
`parent(company_id, id)`: `content_block_content_fk` CASCADE, `content_recommendation_content_fk`
CASCADE, `content_recommendation_block_fk` CASCADE, `content_approval_history_content_fk`
**SET NULL (content_id)**.

| ID | Test | Expected | Actual | Verdict |
|---|---|---|---|---|
| B1 | `content_block` to same-tenant content | accepted | `INSERT 0 1` | PASS |
| B2 | `content_block` company A to content of B | rejected | **23503** `content_block_content_fk` | PASS |
| B3 | `content_block` to nonexistent content | rejected | **23503** same FK | PASS |
| B4 | `content_recommendation` to same-tenant content | accepted | `INSERT 0 1` | PASS |
| B5 | `content_recommendation` A to content of B | rejected | **23503** `content_recommendation_content_fk` | PASS |
| B5b | `content_recommendation` to nonexistent content | rejected | **23503** same FK | PASS |
| B6 | `content_recommendation` to same-tenant block | accepted | `INSERT 0 1` | PASS |
| B7 | `content_recommendation` A to block of B | rejected | **23503** `content_recommendation_block_fk` | PASS |
| B8 | `content_approval_history` to same-tenant content | accepted | `INSERT 0 1` | PASS |
| B9 | `content_approval_history` A to content of B | rejected | **23503** `content_approval_history_content_fk` | PASS |
| B9b | `content_approval_history` to nonexistent content | rejected | **23503** same FK | PASS |
| B10 | `content_approval_history` with `content_id` NULL | accepted (MATCH SIMPLE) | `INSERT 0 1` | PASS |
| B11 | `content_quality` with cross-tenant `content_id` | **accepted — no FK exists** | `INSERT 0 1` | PASS (declared contract; gap E-4) |
| B12 | state after every rejection | only intended rows; tenant B intact | confirmed per table | PASS |
| B13 | after `ROLLBACK` | all four tables empty | 0 / 0 / 0 / 0 | PASS |

Two early attempts used literals that are not valid hex UUIDs, which aborted the transaction and
returned **25P02** instead of a real verdict for B4/B5/B8/B9. Those four were re-run correctly and
the invalid results discarded.

### Approval-history retention

| ID | Test | Expected | Actual | Verdict |
|---|---|---|---|---|
| C1-C3 | `DELETE` the referenced content | history survives, only `content_id` NULLed | survives; `company_id`, `from_status`, `to_status`, `actor`, `note`, `created_at` all unchanged | PASS |
| C4 | cascade children | blocks and recommendations removed; tenant B untouched | both cascaded; tenant-B block intact | PASS |
| C5a | re-point a NULL-content row to another company | accepted (MATCH SIMPLE) | `UPDATE 1` | PASS (documented consequence) |
| C5b | NULL-content row naming a company in no table | accepted | `INSERT 0 1` | PASS (documented consequence) |
| C6 | re-attach an A-owned history row to B-owned content | rejected | **23503** | PASS |
| C6b | re-attach to nonexistent content | rejected | **23503** | PASS |
| C6c | row after both rejections | unchanged | unchanged | PASS |

**Documented MATCH SIMPLE consequence, reported as a known semantic consequence and not as a new
defect:** once `content_id` is NULL the composite key enforces nothing, so the surviving audit row's
`company_id` is unconstrained. Re-attachment to a non-NULL value is still fully enforced.

An initial C6 was mis-sequenced — C5a had already moved the row to tenant B, so pointing it at B's
content was legitimately valid. C6 was re-run from a clean A-owned row and the first result discarded.

### RLS

Two preconditions, both newly established here, determine what an RLS test can conclude: the
baseline carries **6,146 public table grants, every one to `postgres`** and none to
`authenticated`, `anon` or `service_role`; and `public.user_company_roles` has RLS enabled with a
single policy, `service_role_full_access`, applicable only to `service_role`.

| ID | Test | Expected | Actual | Verdict |
|---|---|---|---|---|
| D1 | **CONFIG 1** — policies exactly as they are, non-superuser role with manufactured grants | — | **0 rows visible in all four tables, 0 membership rows**: the predicate subquery is filtered to empty by `user_company_roles` RLS, so the policy is effectively deny-all for a non-`service_role` caller | INCONCLUSIVE for production (gap E-1) |
| D2 | **CONFIG 2** — plus a modelled `user_id = auth.uid()` read policy on `user_company_roles` | own tenant only | exactly 1 row per table, all tenant A | PASS |
| D3 | cross-tenant SELECT | filtered, not an error | 0 rows, no error | PASS |
| D4 | cross-tenant INSERT | refused by WITH CHECK | **42501** | PASS |
| D5 | own-tenant INSERT | accepted | `INSERT 0 1` | PASS |
| D6 | cross-tenant UPDATE | 0 rows | `UPDATE 0` | PASS |
| D7 | cross-tenant DELETE | 0 rows | `DELETE 0` | PASS |
| D8 | tenant-hop UPDATE of an own row | refused by WITH CHECK | **42501** | PASS |
| D9 | membership status `invited` rather than `active` | sees nothing | 0 rows — the active-status term is load-bearing | PASS |
| D10 | tenant B after every tenant-A attempt | unchanged | unchanged | PASS |
| — | post-rollback | role gone, policy gone, tables empty | 0 / 0 / 0 | PASS |

CONFIG 2's extra policy and both configs' grants are **manufactured prerequisites**, stated as such:
they isolate the Fix 3 **policy predicate**, which is correct. They say nothing about production's
privilege surface or production's `user_company_roles` policies. `relrowsecurity` is true and
`relforcerowsecurity` is false on all four tables, matching the contract — the migration issues
**zero** FORCE ROW LEVEL SECURITY statements. This dependency is **not introduced by Fix 3**:
`public.content`'s own policy, which Fix 3 does not own, carries the identical predicate.

### Indexes, triggers, timestamps

All eight contract indexes verified against the migration's own spec arrays — key columns and order,
`indoption` (`0 3` = DESC NULLS FIRST on both timestamp tails), default operator class on every key
column, no collation override, `indnatts = indnkeyatts` (INCLUDE-free), btree, non-unique,
valid/ready/live, and the one partial predicate `(content_id IS NOT NULL)`. Thirteen indexes exist
in total on the four tables: the eight, four primary keys, and `content_block_company_id_key`.

| ID | Test | Expected | Actual | Verdict |
|---|---|---|---|---|
| E1 | eight indexes vs contract | exact match | exact match on all nine properties | PASS |
| E2 | triggers on the five tables | exactly two, both on the shared executor | `content_touch_updated_at` on `content` and `content_block_set_updated_at`, both `tgtype=19`, both enabled | PASS |
| E3 | which tables have `updated_at` | only `content` and `content_block` | confirmed; the other three correctly have no timestamp trigger | PASS |
| E4 | shared executor properties | 0 args, plpgsql, not SECURITY DEFINER, no `proconfig` | confirmed; **70** dependent triggers, being 69 others plus Fix 3's own, which reconciles the 69/70 counts reported in prior phases | PASS |
| E5 | competing functions introduced by Fix 3 | none | 32 other timestamp-like trigger functions pre-exist in the schema; **none** attached to any Fix 3 table | PASS |
| E6 | `content_block.updated_at` on UPDATE | advances to now() | advanced | PASS |
| E7 | explicitly supplied stale `updated_at` on UPDATE | overridden by the trigger | overridden | PASS |
| E8 | `content_quality.evaluated_at` on UPDATE | unchanged, no trigger | unchanged | PASS |
| E9 | INSERT with an explicit old timestamp | preserved, the trigger is UPDATE-only | preserved | PASS |

---

## D. THE PRODUCTION TRANSITION, STRUCTURE AND IDEMPOTENCY

### The reconcile path, exercised for the first time

`legacy` is `pristine` plus the frozen predecessor, which creates precisely the legacy shape: three
single-column ON DELETE CASCADE foreign keys, `content_approval_history.content_id` **NOT NULL**,
and no composite unique key on `content_block`. Tenant-consistent rows were loaded, then Fix 3 was
applied: **exit 0, one COMMIT, 4 s, zero errors**. What it actually did, from its own notices:

- STEP 2 **added** `content_company_id_key` and `content_block_company_id_key`.
- STEP 3 **dropped NOT NULL** on `content_approval_history.content_id`.
- STEP 4 **dropped all three** legacy single-column FKs and **added all four** composite FKs,
  including the authorized ON DELETE `c` to `n` transition for approval history.
- STEP 4 reconciled each child against its whole FK population: 1 of 1, 2 of 2, 1 of 1, 0 of 0.

The migrated rows then behaved correctly: deleting the pre-existing content left the history row
with `content_id` NULL and every other column intact, cascaded the block and the recommendation, and
left the `content_quality` row in place.

### Convergence of the two paths

`w6` (create path) and `trans_ok` (reconcile path) were compared across 122 definition rows. They
differ in exactly **two** places:

1. The lifecycle CHECK's element **order** — `quality_reviewed` fourth versus ninth. Fix 3 accepts
   both as the supported form, because matching is on the set of nine elements rather than byte
   order. Benign, and now demonstrated rather than assumed.
2. The `content_block` trigger's **executor**: `omnivyra_touch_updated_at()` versus
   `set_content_updated_at()`. See gap E-2 — **owner decision**.

### Idempotency, extended beyond Phase 95

Phase 95 compared 49 catalog rows across the four owned tables only. This phase used a 122-row
fingerprint that **includes `public.content`**, plus `relrowsecurity`/`relforcerowsecurity` and every
column's NOT NULL flag, and added a 41-row **OID** snapshot.

| Database | Path | Reapply | Definitions including `public.content` | OIDs |
|---|---|---|---|---|
| `w6` | create | exit 0, COMMIT, 0 errors | **IDENTICAL**, 122 rows | only the **four policy OIDs** changed |
| `trans_ok` | reconcile | exit 0, COMMIT, 0 errors | **IDENTICAL**, 122 rows | only the **four policy OIDs** changed |

The OID evidence is strictly stronger than Phase 95's definitional comparison: all 37 non-policy
objects — constraints, indexes and triggers — **kept their OIDs**, which proves nothing else was
silently dropped and recreated. The four policy OIDs changing is the intended STEP 8
drop-and-recreate, which Phase 95 could only attest from notices. Semantic equivalence and catalog
identity are therefore now distinguished with evidence.

### Verification artifact

Hash unchanged at `5c62e015...`. Run **twice on each** database:

| Database | Run 1 | Run 2 | Determinism | Executor reported |
|---|---|---|---|---|
| `w6` | exit 0, PASSED | exit 0, PASSED | stderr byte-identical | `omnivyra_touch_updated_at()` |
| `trans_ok` | exit 0, PASSED | exit 0, PASSED | stderr byte-identical | `set_content_updated_at()` |

All eleven structural sections executed, no ERROR or FATAL on either stream, and no recurrence of
the `text || "char"` ambiguity corrected in Phase 90. The artifact **reports** the executor rather
than pinning it, validating by function body against a two-string allowlist, which is why it passes
on both paths. The artifact was not modified.

---

## E. ADVERSARIAL GUARD TESTING

Each scenario cloned `legacy` into its own database, introduced **exactly one** controlled defect,
applied Fix 3, compared a 114 to 119 row fingerprint before and after, then dropped the clone. No
guard was weakened to make any test pass.

**Methodological correction.** The first driver's fingerprint SQL used a `||"|"||` separator, which
PostgreSQL parses as a quoted identifier rather than a string literal. Both snapshots were therefore
empty and `cmp` matched trivially. Every rollback verdict from that first pass is **withdrawn**; all
scenarios were re-run with a corrected, file-based fingerprint query and only those results appear
below.

| ID | Injected defect | Guard | Exit | COMMIT | Rollback |
|---|---|---|---|---|---|
| S1 | same-named index, wrong column order | `FIX3-IDX-03c` | 3 | 0 | PROVEN UNCHANGED (118) |
| S2 | wrong per-column ordering option, ASC where DESC intended | `FIX3-IDX-03f` | 3 | 0 | PROVEN UNCHANGED (118) |
| S3 | index carrying an INCLUDE column | `FIX3-IDX-03g` | 3 | 0 | PROVEN UNCHANGED (118) |
| S4 | non-default operator class | `FIX3-IDX-03h` | 3 | 0 | PROVEN UNCHANGED (118) |
| S5 | explicit COLLATE override | `FIX3-IDX-03i` | 3 | 0 | PROVEN UNCHANGED (118) |
| S6 | partial predicate removed | `FIX3-IDX-03c` | 3 | 0 | PROVEN UNCHANGED (118) |
| S7 | index made UNIQUE | `FIX3-IDX-03` | 3 | 0 | PROVEN UNCHANGED (118) |
| S8 | non-btree, hash access method | `FIX3-IDX-03d` | 3 | 0 | PROVEN UNCHANGED (118) |
| S9 | prohibited DELETE trigger on `public.content` | `FIX3-AUDIT-01` | 3 | 0 | PROVEN UNCHANGED (119) |
| S10 | prohibited TRUNCATE trigger | `FIX3-AUDIT-02` | 3 | 0 | PROVEN UNCHANGED (119) |
| S11 | rewrite rule on an owned table | `FIX3-AUDIT-03` | 3 | 0 | PROVEN UNCHANGED (118) |
| S12 | legacy FK with unauthorized ON DELETE RESTRICT | `FIX3-FK-10` | 3 | 0 | PROVEN UNCHANGED (118) |
| S13 | inheritance hierarchy on an owned table | `FIX3-FK-17` | 3 | 0 | PROVEN UNCHANGED (118) |
| S14 | lifecycle CHECK marked NOT VALID | `FIX3-LIFE-04` | 3 | 0 | PROVEN UNCHANGED (118) |
| S16 | an extra, unmodelled policy | `FIX3-RLS-01` | 3 | 0 | PROVEN UNCHANGED (119) |
| S17 | owned policy missing WITH CHECK | `FIX3-RLS-01` | 3 | 0 | PROVEN UNCHANGED (114) |
| S18 | trigger executing a different function | `FIX3-TRG-01` | 3 | 0 | PROVEN UNCHANGED (118) |
| S19 | name collision, a plain index owns the constraint name | `FIX3-KEY-04` | 3 | 0 | PROVEN UNCHANGED (119) |
| S20 | vocabulary CHECK rewritten as a regex | `FIX3-SHAPE-11` | 3 | 0 | PROVEN UNCHANGED (118) |
| S23 | **tenant-inconsistent legacy data** | **none — raw 23503** | 3 | 0 | PROVEN UNCHANGED (118) |

Thirteen distinct guard codes across eight families fired, each naming the exact deviation. S13 fired
`FIX3-FK-17` rather than `FIX3-AUDIT-00` only because FK reconciliation runs first; both guard the
same condition, so the coverage is not reduced.

### Repair paths — correctly committed rather than rejected

| ID | Injected state | Behavior | Verdict |
|---|---|---|---|
| S15 | lifecycle CHECK reduced to **eight** values, dropping `quality_reviewed` | STEP 6 **replaced** it with the nine-value form; `quality_reviewed` then writable, `UPDATE 2`, SQLSTATE 00000 | PASS, correct repair |
| S21 | RLS **disabled** on an owned table | re-enabled, `relrowsecurity` false to true | PASS, correct repair |
| S22 | owned policy **dropped** | recreated with the contract predicate | PASS, correct repair |

S15 was briefly suspected of being a defect on the strength of the invalid fingerprint. Direct
inspection disproved that and the suspicion is withdrawn.

### Transactional failure testing

S23 reaches its failure **inside** STEP 4, at migration line 1681, after STEP 0B has taken ACCESS
EXCLUSIVE on five tables and after STEP 2 and STEP 3 have already made catalog changes. The failure
point was therefore genuinely reached; it is not a parse error or a connection failure. Afterwards
the database was **proven byte-identical** to its pre-apply state: all three legacy single-column
FKs intact, no composite FK present, `content_id` still NOT NULL, no composite unique keys added,
and the offending row still in place. The single-transaction, zero-exception-handler design holds.

### Gaps that remain

1. **RLS in the as-is configuration is INCONCLUSIVE for production.** The local baseline has no
   grants to Supabase roles and no `authenticated`-applicable policy on `user_company_roles`, so
   CONFIG 1 can only demonstrate deny-all. Whether production's grants and `user_company_roles`
   policies make the Fix 3 predicate satisfiable is **unknown** and is a Stage A question.
2. **Non-convergence of the trigger executor** — **owner decision**. The brief states that
   `omnivyra_touch_updated_at()` must be used as intended and that `set_content_updated_at()` belongs
   to Fix 2. Fix 3 moves neither function and modifies neither; but on a predecessor-applied
   database it leaves the trigger bound to the Fix 2 function. The two functions' bodies are
   identical in effect, both plpgsql, zero-argument, not SECURITY DEFINER, no pinned configuration,
   so the difference is referential rather than behavioral.
3. **No preflight for tenant-inconsistent data**, scenario S23 — an operational prerequisite rather
   than a defect. The migration documents the behavior as deliberate: "no row is ever deleted or
   rewritten to force a constraint through."
4. **`content_quality` carries no foreign key at all.** The migration's own spec expects 0 of 0, so
   this is the declared contract. Two consequences were demonstrated: a cross-tenant `content_id` is
   accepted (B11), and a `content_quality` row **survives deletion of the content it names**,
   retaining a dangling `content_id`. In a migration whose stated purpose is tenant consistency this
   warrants an explicit owner acknowledgement.
5. **The artifact does not assert `relforcerowsecurity`.** The Phase 87 gap is **confirmed by
   grep**: the string does not occur anywhere in the artifact, so it would pass whether the flag were
   set or not. The observed value is false on all four tables, consistent with the migration issuing
   no FORCE statement.
6. **No negative control was run on the artifact.** Adversarial DDL against the artifact itself was
   not authorized in this phase, so its ability to fail remains inferred from its 65 RAISE EXCEPTION
   points rather than demonstrated.

---

## F. OPERATIONAL RISK — LOCK, SCAN AND TIMEOUT

Settings: `SET LOCAL lock_timeout = '5s'` and `SET LOCAL statement_timeout = '120s'`. STEP 0B takes
ACCESS SHARE on `user_company_roles` and **ACCESS EXCLUSIVE leaf-first on five tables**:
`content_recommendation`, `content_approval_history`, `content_quality`, `content_block`, `content`.
Because the whole migration is one transaction, **those locks are held for the entire apply**, so
the blocking window equals total apply time rather than any single statement's duration.

### Statements that scan or build on populated tables

| Statement | Work performed |
|---|---|
| STEP 2 `ADD CONSTRAINT ... UNIQUE (company_id, id)` on `content` and `content_block` | builds a unique btree — full scan plus sort. **Dominant cost.** |
| STEP 4 `ADD CONSTRAINT ... FOREIGN KEY`, four of them | validates every existing child row |
| STEP 6 `ADD CONSTRAINT ... CHECK (lifecycle_status IN ...)` when replacing | full scan of `content` |
| STEP 5 `CREATE INDEX IF NOT EXISTS`, eight of them | builds **only if absent**; no build at all on the reconcile path |
| STEP 3 `ALTER COLUMN ... DROP NOT NULL`, and every `DROP CONSTRAINT` | catalog-only, no scan |

No constraint is added `NOT VALID`, so every validation is synchronous.

### Measured on synthetic data

Volumes: 250,002 `content`, 500,004 `content_block`, 250,002 each of `content_recommendation`,
`content_approval_history` and `content_quality` — about 1.5 million rows.

| Statement | Measured |
|---|---|
| `ADD CONSTRAINT UNIQUE` on `content`, 250k rows | **681 ms** |
| `ADD CONSTRAINT UNIQUE` on `content_block`, 500k rows | **1,489 ms** |
| add composite FK on `content_block`, 500k rows validated | **305 ms** |
| add composite FK on `content_recommendation`, 250k rows | **221 ms** |
| add composite SET NULL FK on `content_approval_history`, 250k rows | **193 ms** |
| add lifecycle CHECK, 250k `content` rows validated | **41 ms** |
| each legacy `DROP CONSTRAINT` | 0.7 to 5.1 ms |
| **total scanning and building DDL** | **about 2.94 s** |

End-to-end apply of the same file on the same machine: **655 ms** on an empty `legacy` clone and
**4,505 ms** on the populated one, a data-attributable delta of about 3.85 s that is consistent with
the per-statement sum. The largest single statement was 1,489 ms against a 120,000 ms
`statement_timeout`, roughly eighty times headroom **at this volume**.

**These are synthetic timings from a four-CPU laptop container and are explicitly not a production
performance prediction.** Production row counts, hardware, concurrent load and lock contention are
all unknown. In particular `lock_timeout = '5s'` means that under real concurrent traffic the
migration may simply fail to acquire its locks and abort, which is safe but is an availability
consideration rather than a correctness one. **Lock and scan risk therefore remains UNRESOLVED**
pending representative evidence, which only Stage A together with production row counts can supply.

### Recommended operator preflight for scenario S23 — read-only, no DDL

```sql
-- Any row returned here will abort Fix 3 at STEP 4 with a raw 23503.
SELECT 'content_block' AS child, b.id, b.company_id, b.content_id
  FROM public.content_block b
  LEFT JOIN public.content c ON c.id = b.content_id AND c.company_id = b.company_id
 WHERE c.id IS NULL
UNION ALL
SELECT 'content_recommendation->content', r.id, r.company_id, r.content_id
  FROM public.content_recommendation r
  LEFT JOIN public.content c ON c.id = r.content_id AND c.company_id = r.company_id
 WHERE c.id IS NULL
UNION ALL
SELECT 'content_recommendation->block', r.id, r.company_id, r.block_id
  FROM public.content_recommendation r
  LEFT JOIN public.content_block b ON b.id = r.block_id AND b.company_id = r.company_id
 WHERE r.block_id IS NOT NULL AND b.id IS NULL
UNION ALL
SELECT 'content_approval_history', h.id, h.company_id, h.content_id
  FROM public.content_approval_history h
  LEFT JOIN public.content c ON c.id = h.content_id AND c.company_id = h.company_id
 WHERE h.content_id IS NOT NULL AND c.id IS NULL;
```

### Harness readiness evidence

The Phase 94 two-consecutive-successful-query readiness check held again in this phase, becoming the
fourth consecutive clean start since the fix. Ready after 14 s. This remains evidence, not proof,
that the initdb-shutdown race is impossible.

---

## G. PRODUCTION BOUNDARY

| Question | Answer |
|---|---|
| Was production accessed? | **NO** |
| Were there any production database changes? | **NO** |
| Any deployment, commit, merge, push or staging? | **NO** |
| Was Stage A performed? | **NO** — not authorized by this prompt |
| Is production application authorized? | **NO** |
| Was `C:\virality` accessed? | **NO** |
| Were credentials read, printed or derived? | **NO** |
| Was `supabase db push` used? | **NO** |
| Was the generic migration-ledger prober run? | **NO** |
| Were any Docker volumes other than this phase's own removed? | **NO** |

### Stage A readiness plan — plan only, no authorization implied

**Required mechanism.** A provably read-only channel. Phases 84 and 95 established that none exists
today: Supabase MCP was unavailable, `psql` and `pg_dump` are absent from the host, and the CLI
worktree is not linked to the project. The only acceptable routes are a restored read-only MCP
connection, or an **owner-run** query set whose output is pasted back. Direct connection by the
agent would require handling production credentials and is prohibited.

**Minimum query set.** For `content_quality`, `content_block`, `content_recommendation`,
`content_approval_history` and the touched `public.content`: existence and `relkind`; the full column
list with types and NOT NULL; every `pg_constraint` row with `pg_get_constraintdef`, `contype`,
`convalidated`, and for foreign keys the `conkey` and `confkey` column mappings plus `confdeltype`,
`confupdtype`, `confmatchtype` and `confdelsetcols`; every `pg_index` row with `pg_get_indexdef`,
`indisunique`, `indnatts`, `indnkeyatts`, `indoption`, `indclass`, `indcollation`, `indpred` and
`indisvalid`/`indisready`/`indislive`; every non-internal `pg_trigger` with `pg_get_triggerdef` and
the resolved function name; `relrowsecurity` and `relforcerowsecurity`; every `pg_policy` with
`polcmd`, `polpermissive`, `polroles` and both expressions; `pg_inherits` membership; `pg_rewrite`
rules; **and**, newly required by this phase, the grant surface on these five tables plus
`user_company_roles`, together with `user_company_roles`'s own policies, without which gap E-1
cannot be closed. Finally the tenant-consistency preflight in section F and the row counts for all
five tables.

Every `"char"` column must be cast with `::text` before concatenation. That is the Phase 89 defect
and it recurs easily in hand-written catalog queries.

**Read-only demonstration.** Every statement a bare SELECT against `pg_catalog` or
`information_schema` with no CTE containing a data-modifying statement; executed as a role lacking
write privileges where one is available; and, where supported, inside
`BEGIN; SET TRANSACTION READ ONLY;` with a closing `ROLLBACK`.

**Capture.** Results pasted as plain text containing only catalog metadata and counts. No row data,
no connection strings, no credentials, no secret-derived metadata. The target must be confirmed by
project ref `klkiseupptzbecbxwrky`, never by a Studio display name.

**Outcome definitions.** PASS — the live structure matches the post-Fix-3 contract on every property
above, or matches the legacy shape so that the now-verified reconcile path applies, and the preflight
returns zero rows. FAIL — any object has the right name but an incompatible definition that no Fix 3
guard would repair, or the preflight returns rows. INCONCLUSIVE — any query could not be run or
returned ambiguously.

**Prerequisite before Stage A can be authorized:** a working, provably read-only inspection channel.
Until one exists the correct status is **BLOCKED — NO PROVABLY READ-ONLY TARGET CHANNEL**.

### What a future production application decision still requires

Behavioral tests pass and adversarial guard tests pass, both now satisfied. Idempotency and
structural verification pass, now satisfied on both code paths. Beyond that: the lock and scan risk
documented against representative data rather than synthetic; a safe Stage A inspection performed
and reviewed; the actual production schema state understood; the hashes confirmed at the time of
application; a deliberate application and rollback plan reviewed; and the owner's explicit
authorization of the specific production action. Approval to test, inspect, plan or draft does not
imply approval to apply.

### Recommendation

Request separate authorization for **Stage A read-only target inspection**, with three additions
over the earlier plan: include the grant surface and `user_company_roles` policies, to close the RLS
question; include the section F tenant-consistency preflight, to find S23 exposure before it aborts
a production apply; and include row counts for all five tables, so the section F timings can be
anchored to real volumes.

In parallel, two **owner decisions** are needed and neither requires database access: the
trigger-executor non-convergence (gap E-2) and an explicit acknowledgement that `content_quality`
carries no foreign key (gap E-4).

Do not change the migration, its guards, the verification artifact or the harness without separate
authorization.
