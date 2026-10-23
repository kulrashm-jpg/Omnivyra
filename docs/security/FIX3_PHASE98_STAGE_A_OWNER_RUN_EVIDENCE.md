# FIX 3 — STAGE A: OWNER-RUN READ-ONLY EVIDENCE PACKAGE

**Audience: the owner, or an operator the owner delegates to, executing against the production
database through an independently verified read-only session.**

This document is a set of instructions. The coding session that produced it has **not** executed any
of these queries, has **not** connected to production, and is **not** authorized to inspect the
results unless a future phase says so. Preparing this package does not perform Stage A.

Derived from `FIX3_PHASE96_BEHAVIORAL_VALIDATION.md` and
`FIX3_PHASE97_OWNER_DECISIONS_AND_STAGE_A.md`. Every table, column, constraint, index, trigger,
function, policy and role name below is taken from the Fix 3 migration, the frozen predecessor, or
the committed production-shaped baseline. Nothing is invented; anything that could not be grounded
is marked **NEEDS REVIEW**.

---

## 1. SAFETY PREAMBLE — READ BEFORE RUNNING ANYTHING

**A `SELECT` statement is not proof that the execution context is safe.** The statement text is only
one of four things that must hold. Verify all four before running item 1.

1. **Run only through an approved production read-only session.** Not a general admin console
   session that happens to be running a SELECT.
2. **Verify the connection target before querying.** Confirm you are on the intended database, by
   project ref — the expected target for this programme is **`klkiseupptzbecbxwrky`**. Confirm it by
   ref, never by a Studio display name, which can be changed and has previously been misleading in
   this programme.
3. **Verify the effective database role**, and verify that it **cannot mutate application data or
   schema**. Checking the role's name is not sufficient; check its privileges. Suggested, and itself
   read-only:

   ```sql
   SELECT current_user,
          session_user,
          current_setting('transaction_read_only')          AS txn_read_only,
          (SELECT rolsuper      FROM pg_roles WHERE rolname = current_user) AS is_superuser,
          (SELECT rolbypassrls  FROM pg_roles WHERE rolname = current_user) AS bypasses_rls,
          (SELECT rolcreatedb   FROM pg_roles WHERE rolname = current_user) AS can_create_db,
          has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_in_db;
   ```

   A role reporting `is_superuser = true` or `can_create_in_db = true` is **not** a read-only role.
   Stop and obtain one that is, or accept explicitly that the read-only guarantee rests on
   discipline rather than on privileges — and record that fact in the result template.
4. **Wrap the work in a read-only transaction** wherever the client supports it:

   ```sql
   BEGIN;
   SET TRANSACTION READ ONLY;
   -- run the evidence items here
   ROLLBACK;
   ```

   With `transaction_read_only` on, any accidental write fails rather than succeeding.

### Hard prohibitions for this package

- **No DDL, no DML**, no `CREATE`, `ALTER`, `DROP`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`.
- **No migrations and no migration application**, and specifically **no `supabase db push`**.
- **No stored-procedure or function execution** beyond the read-only catalog helpers used below
  (`pg_get_constraintdef`, `pg_get_indexdef`, `pg_get_triggerdef`, `pg_get_expr`, `format_type`,
  `has_database_privilege`). None of these mutates anything.
- **No generic migration-ledger reconciliation.** A generic prober would report Fix 3 as APPLIED
  purely because tables of those names exist. Item 11 reads the ledger as *text*, and its result is
  never merged with schema state.
- **No role switching, impersonation, `SET ROLE`, or write attempts** — see section 4.
- **Never paste** credentials, connection strings, tokens, passwords, API keys, or any
  secret-derived value into the results, the report, a ticket, or a chat.
- **Never paste** row payloads or personal data. Every item below returns catalog metadata,
  identifiers or counts by design.

### Stop conditions for the owner

Stop immediately, and record why, if:

- the target cannot be confirmed by project ref;
- the effective role cannot be confirmed, or is confirmed to hold write or DDL privilege and no
  read-only alternative exists;
- `SET TRANSACTION READ ONLY` is unavailable and the client cannot otherwise guarantee read-only;
- any statement errors in a way that suggests it did something other than read;
- any output would require pasting a secret or row payload to be meaningful.

### Inspection window

Run all eleven items in **one session, in one window**, as close together as practical, and record
the start and end timestamps in UTC. Items 9 and 10 in particular are point-in-time observations:
a schema fact and a row count taken hours apart cannot be interpreted together. If the items must be
split across sessions, record a timestamp per item and say so.

### Target identity capture, without disclosing connection details

Record, in the result template:

```sql
SELECT current_database()                                   AS db_name,
       current_setting('server_version')                    AS server_version,
       (SELECT count(*) FROM pg_namespace WHERE nspname = 'public') AS public_schema_present,
       now() AT TIME ZONE 'UTC'                             AS captured_at_utc;
```

Plus the project ref, confirmed visually from the platform console. That set distinguishes the
intended target without disclosing host, port, user or password.

---

## 2. EVIDENCE ITEMS

Eleven items. They correspond one-to-one with the Stage A plan in the Phase 97 report, section E.

Throughout, the five relevant tables are:

| | |
|---|---|
| the four Fix 3 tables | `public.content_quality`, `public.content_block`, `public.content_recommendation`, `public.content_approval_history` |
| the touched parent | `public.content` |

and the authorization dependency is `public.user_company_roles`.

---

### ITEM 1 — Grant surface on the target tables and `user_company_roles`

**Purpose.** Establish which roles can reach these tables at all. Phase 96 found the local baseline
carried grants only to `postgres`, which made its RLS test inconclusive for production. This item
closes the configuration half of that question.

**Objects.** `information_schema.role_table_grants`.

```sql
SELECT table_name,
       grantee,
       string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public'
   AND table_name IN ('content_quality','content_block','content_recommendation',
                      'content_approval_history','content','user_company_roles')
 GROUP BY table_name, grantee
 ORDER BY table_name, grantee;
```

**Expected columns.** `table_name`, `grantee`, `privileges`.

**PASS.** Grants exist for the role(s) the application authenticates as (in a Supabase deployment
typically `authenticated` and/or `service_role`), and the set is explicable.
**FAIL.** A Fix 3 table is reachable by a role that should not reach it — most importantly `anon`.
**INCONCLUSIVE.** The query did not run, or returned nothing for every table, which would mean the
same situation Phase 96 found locally and would leave item 2's interpretation open.

**Minimization.** Role names and privilege names only. No data.

**Limitations.** Grants are necessary but not sufficient: a role may hold `SELECT` and still see no
rows because of RLS. This item says nothing about row visibility.

---

### ITEM 2 — `user_company_roles` policies and applicable role configuration

**Purpose.** The Fix 3 policy predicate reads `user_company_roles`. Phase 96 found that in the local
baseline this table had RLS enabled with only a `service_role` policy, which made the Fix 3
predicate return the empty set — deny-all — for any ordinary role. Whether production is the same is
the single most consequential unknown in this package.

**Objects.** `pg_policy`, `pg_class`, `pg_roles`.

```sql
SELECT c.relname                                              AS table_name,
       c.relrowsecurity                                       AS rls_enabled,
       c.relforcerowsecurity                                  AS rls_forced,
       p.polname                                              AS policy_name,
       p.polcmd::text                                         AS command,
       p.polpermissive                                        AS permissive,
       p.polroles::regrole[]::text[]                          AS roles,
       pg_get_expr(p.polqual, p.polrelid)                     AS using_expr,
       pg_get_expr(p.polwithcheck, p.polrelid)                AS with_check_expr
  FROM pg_class c
  LEFT JOIN pg_policy p ON p.polrelid = c.oid
 WHERE c.relnamespace = 'public'::regnamespace
   AND c.relname = 'user_company_roles'
 ORDER BY p.polname;
```

Note the `::text` cast on `polcmd`. It is `"char"`, and concatenating `"char"` without a cast is the
exact ambiguity defect this programme found in Phase 89. Keep the cast if you rewrite the query.

**Expected columns.** As named above. `roles` of `{-}` means the policy applies to `PUBLIC`.

**PASS.** A policy exists that lets an authenticated end user read their **own** membership rows —
in practice a `USING` expression equivalent to `user_id = auth.uid()`. The Fix 3 predicate is then
satisfiable.
**FAIL.** No such policy. The Fix 3 policies would then be deny-all for ordinary users, exactly as
Phase 96 observed locally. Note this is **not** a defect introduced by Fix 3: `public.content`
already carries the identical predicate (item 4), so the same would already be true of `content`
today.
**INCONCLUSIVE.** Query not run, or RLS is enabled with policies whose effect on an ordinary role
cannot be read off the predicate text.

**Minimization.** Predicate text and role names only. No membership rows are selected.

**Limitations.** Predicate text is configuration, not behavior. See section 4.

---

### ITEM 3 — RLS enabled and forced status for all five tables

**Purpose.** Confirm `relrowsecurity` on the four owned tables, and record `relforcerowsecurity`.
Phase 96 confirmed the verification artifact never asserts the forced flag, so it is recorded here
rather than asserted.

**Objects.** `pg_class`.

```sql
SELECT c.relname        AS table_name,
       c.relkind::text  AS relkind,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace
   AND c.relname IN ('content_quality','content_block','content_recommendation',
                     'content_approval_history','content')
 ORDER BY c.relname;
```

**Expected columns.** `table_name`, `relkind`, `rls_enabled`, `rls_forced`, `policy_count`.

**PASS.** `rls_enabled = true` on all four owned tables, `relkind = 'r'` on all five, and
`policy_count = 1` on each owned table.
**FAIL.** RLS disabled on an owned table, or `relkind <> 'r'` — the latter would also cause Fix 3 to
refuse at `FIX3-AUDIT-00`/`FIX3-FK-17`.
**INCONCLUSIVE.** A table is absent. That is **not** a failure: Phase 96 established the baseline
contains `public.content` but none of the four, so absence means production would take Fix 3's
CREATE path. Record it plainly.

**Minimization.** Booleans and counts only.

**Limitations.** `rls_forced = false` is expected and correct — the migration issues no
`FORCE ROW LEVEL SECURITY`. It means the table owner bypasses RLS, which is normal for Supabase.

---

### ITEM 4 — Policy predicates on the four owned tables and on `public.content`

**Purpose.** Confirm one modelled policy per owned table with the contract predicate, and capture
`public.content`'s own policy, which shares that predicate and is **not** owned by Fix 3.

**Objects.** `pg_policy`, `pg_class`.

```sql
SELECT c.relname                                   AS table_name,
       p.polname                                   AS policy_name,
       p.polcmd::text                              AS command,
       p.polpermissive                             AS permissive,
       p.polroles::regrole[]::text[]               AS roles,
       pg_get_expr(p.polqual, p.polrelid)          AS using_expr,
       pg_get_expr(p.polwithcheck, p.polrelid)     AS with_check_expr
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
 WHERE c.relnamespace = 'public'::regnamespace
   AND c.relname IN ('content_quality','content_block','content_recommendation',
                     'content_approval_history','content')
 ORDER BY c.relname, p.polname;
```

**Expected columns.** As named. Expected policy names are `content_quality_company_rw`,
`content_block_company_rw`, `content_recommendation_company_rw`,
`content_approval_history_company_rw` (the migration's `<table>_company_rw` convention), and
`content_company_rw` on `public.content` — that last name is confirmed present in the committed
production-shaped baseline.

**PASS.** Exactly one policy per owned table, `command = '*'`, permissive, with both `using_expr`
and `with_check_expr` present and equivalent to
`company_id IN (SELECT company_id FROM user_company_roles WHERE user_id = auth.uid() AND status = 'active')`.
**FAIL.** More than one policy on an owned table, a missing `WITH CHECK`, or a materially different
predicate. Fix 3 would refuse at `FIX3-RLS-01` in the first two cases.
**INCONCLUSIVE.** Table absent (see item 3), or predicate text that cannot be compared confidently.

**Minimization.** Predicate text only.

**Limitations.** Configuration, not behavior. See section 4.

---

### ITEM 5 — Constraints: foreign-key definitions, ordered column mappings, delete actions, validation state

**Purpose.** The central schema question. Determine whether production carries the post-Fix-3
composite foreign keys, the legacy single-column ones, or neither — which decides whether a future
apply takes Fix 3's RECONCILE path (verified in Phase 96) or its CREATE path.

**Objects.** `pg_constraint`, `pg_class`, `pg_attribute`.

```sql
SELECT c.relname                                   AS table_name,
       k.conname                                   AS constraint_name,
       k.contype::text                             AS contype,
       pg_get_constraintdef(k.oid)                 AS definition,
       k.convalidated                              AS validated,
       k.condeferrable                             AS deferrable,
       k.condeferred                               AS deferred,
       k.confdeltype::text                         AS on_delete,
       k.confupdtype::text                         AS on_update,
       k.confmatchtype::text                       AS match_type,
       (SELECT array_agg(a.attname ORDER BY u.ord)
          FROM unnest(k.conkey) WITH ORDINALITY AS u(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.attnum)
                                                   AS child_columns_in_order,
       (SELECT array_agg(a.attname ORDER BY u.ord)
          FROM unnest(k.confkey) WITH ORDINALITY AS u(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = k.confrelid AND a.attnum = u.attnum)
                                                   AS parent_columns_in_order,
       (SELECT array_agg(a.attname ORDER BY u.ord)
          FROM unnest(k.confdelsetcols) WITH ORDINALITY AS u(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.attnum)
                                                   AS on_delete_set_columns
  FROM pg_constraint k
  JOIN pg_class c ON c.oid = k.conrelid
 WHERE c.relnamespace = 'public'::regnamespace
   AND c.relname IN ('content_quality','content_block','content_recommendation',
                     'content_approval_history','content')
 ORDER BY c.relname, k.contype::text, k.conname;
```

Note the `::text` casts on all four `"char"` columns, and that `conkey`/`confkey`/`confdelsetcols`
are `smallint[]` and so can be `unnest`ed with ordinality to recover **column order**, which a bare
definition string does not let you compare mechanically. `confdelsetcols` requires PostgreSQL 15 or
later; the migration asserts that itself at `FIX3-PRECOND-00`.

**Expected columns.** As named.

**PASS, post-Fix-3 shape.** Four composite foreign keys:

| Constraint | Child columns | Parent | `on_delete` |
|---|---|---|---|
| `content_block_content_fk` | `{company_id, content_id}` | `content {company_id, id}` | `c` (CASCADE) |
| `content_recommendation_content_fk` | `{company_id, content_id}` | `content {company_id, id}` | `c` |
| `content_recommendation_block_fk` | `{company_id, block_id}` | `content_block {company_id, id}` | `c` |
| `content_approval_history_content_fk` | `{company_id, content_id}` | `content {company_id, id}` | `n` (SET NULL), with `on_delete_set_columns = {content_id}` |

plus unique keys `content_company_id_key` and `content_block_company_id_key` on `(company_id, id)`,
`on_update = 'a'` (NO ACTION) on all four, `match_type = 's'` (MATCH SIMPLE), and
`validated = true` everywhere. `content_quality` carries **no** foreign key — that is OD-12/B1 and
`FIX3-FK-13` refuses to apply if one is present.

**PASS, legacy shape.** Single-column foreign keys
`content_block_content_id_fkey`, `content_recommendation_content_id_fkey`,
`content_recommendation_block_id_fkey`, `content_approval_history_content_id_fkey`, all
`on_delete = 'c'`, and **no** composite unique key on `content_block`. Phase 96 applied Fix 3 to
exactly this shape successfully, so this is a PASS for applicability, not a defect.

**FAIL.** A constraint with an expected name but an incompatible definition that no Fix 3 guard
repairs — for example a legacy FK with `on_delete` other than `c`, which Fix 3 refuses at
`FIX3-FK-10`; a `NOT VALID` constraint; or any foreign key at all on `content_quality`.
**INCONCLUSIVE.** Tables absent, meaning the CREATE path; record and move on.

**Minimization.** Catalog metadata only.

**Limitations.** Says nothing about whether existing rows satisfy the constraints that Fix 3 would
add. That is item 10, and it is the one that predicts an apply failure.

---

### ITEM 6 — Lifecycle CHECK definition and accepted values

**Purpose.** Confirm `public.content` accepts `quality_reviewed`, and whether the CHECK is in a form
Fix 3's STEP 6 recognises.

**Objects.** `pg_constraint` on `public.content`.

```sql
SELECT k.conname                       AS constraint_name,
       pg_get_constraintdef(k.oid)     AS definition,
       k.convalidated                  AS validated
  FROM pg_constraint k
 WHERE k.conrelid = 'public.content'::regclass
   AND k.contype = 'c'
 ORDER BY k.conname;
```

**Expected columns.** `constraint_name`, `definition`, `validated`.

**PASS.** `content_lifecycle_status_check` exists, is `validated = true`, and permits exactly the
nine values `draft`, `generated`, `edited`, `approved`, `adapted`, `scheduled`, `published`,
`archived`, `quality_reviewed`. **Element order does not matter**: Phase 96 observed both the
`quality_reviewed`-fourth and `quality_reviewed`-ninth orderings and proved Fix 3 accepts both,
because the comparison is on the set of nine elements.
**PASS, repairable.** An eight-value CHECK without `quality_reviewed`. Phase 96 proved STEP 6
replaces it with the nine-value form and that `quality_reviewed` is writable afterwards.
**FAIL.** `validated = false`, which Fix 3 refuses at `FIX3-LIFE-04`; or a definition in a form
other than `IN (...)` / `= ANY (ARRAY[...])`, which STEP 6 rejects rather than reinterprets.
**INCONCLUSIVE.** `public.content` absent — which would be a far larger finding than this item, and
should be escalated rather than recorded.

**Minimization.** Definition text only.

**Limitations.** The definition is not behavior. This item does **not** establish that an insert of
`quality_reviewed` succeeds; that would be a write. Phase 96 established acceptance behaviorally on
a disposable database only.

---

### ITEM 7 — Index definitions and options

**Purpose.** Confirm the eight contract indexes, on all the properties Fix 3's guards check. Name
equality is not enough: Phase 96 proved guards fire on column order, ordering options, operator
class, collation, INCLUDE columns, uniqueness, access method and partial predicate.

**Objects.** `pg_index`, `pg_class`, `pg_am`, `pg_attribute`, `pg_opclass`.

```sql
SELECT c.relname                                   AS table_name,
       i.relname                                   AS index_name,
       am.amname                                   AS access_method,
       x.indisunique                               AS is_unique,
       x.indnatts                                  AS total_columns,
       x.indnkeyatts                               AS key_columns,
       x.indisvalid                                AS is_valid,
       x.indisready                                AS is_ready,
       x.indislive                                 AS is_live,
       x.indoption::text                           AS ordering_options,
       x.indcollation::text                        AS collations,
       (SELECT array_agg(a.attname ORDER BY u.ord)
          FROM unnest(x.indkey) WITH ORDINALITY AS u(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = u.attnum)
                                                   AS key_columns_in_order,
       (SELECT array_agg(op.opcname ORDER BY u.ord)
          FROM unnest(x.indclass) WITH ORDINALITY AS u(oid, ord)
          JOIN pg_opclass op ON op.oid = u.oid)    AS operator_classes,
       (SELECT bool_and(op.opcdefault)
          FROM unnest(x.indclass) u(oid)
          JOIN pg_opclass op ON op.oid = u.oid)    AS all_default_opclass,
       pg_get_expr(x.indpred, x.indrelid)          AS partial_predicate,
       pg_get_indexdef(i.oid)                      AS definition
  FROM pg_index x
  JOIN pg_class i  ON i.oid = x.indexrelid
  JOIN pg_class c  ON c.oid = x.indrelid
  JOIN pg_am    am ON am.oid = i.relam
 WHERE c.relnamespace = 'public'::regnamespace
   AND c.relname IN ('content_quality','content_block','content_recommendation',
                     'content_approval_history')
 ORDER BY c.relname, i.relname;
```

**Expected columns.** As named.

**PASS.** The eight contract indexes present as below, each `btree`, `is_unique = false`,
`total_columns = key_columns` (no INCLUDE), `is_valid`/`is_ready`/`is_live` all true,
`all_default_opclass = true`, and no collation override:

| Index | Key columns | `indoption` | Partial predicate |
|---|---|---|---|
| `content_quality_company_idx` | `{company_id, evaluated_at}` | `0 3` | — |
| `content_quality_content_idx` | `{content_id}` | `0` | `(content_id IS NOT NULL)` |
| `content_block_content_idx` | `{content_id, position}` | `0 0` | — |
| `content_block_company_idx` | `{company_id}` | `0` | — |
| `content_recommendation_content_idx` | `{content_id, status}` | `0 0` | — |
| `content_recommendation_company_idx` | `{company_id}` | `0` | — |
| `content_approval_history_content_idx` | `{content_id, created_at}` | `0 3` | — |
| `content_approval_history_company_idx` | `{company_id}` | `0` | — |

`indoption` is per key column: `0` plain ascending, `3` = DESC (1) + NULLS FIRST (2), which is what
plain `DESC` produces. Primary-key indexes and `content_block_company_id_key` will also appear and
are expected.

**FAIL.** Any index with a contract name but a differing property. Each maps to a specific guard
Phase 96 exercised: column order `FIX3-IDX-03c`, ordering options `03f`, INCLUDE `03g`, operator
class `03h`, collation `03i`, uniqueness `FIX3-IDX-03`, access method `03d`, partial predicate
`03c`. Fix 3 refuses rather than silently reusing.
**INCONCLUSIVE.** Tables absent — CREATE path.

**Minimization.** Catalog metadata only.

**Limitations.** Index presence says nothing about index health, bloat or usage.

---

### ITEM 8 — Trigger definitions and referenced function names

**Purpose.** Confirm the `updated_at` trigger, and — because OD-11 was decided as A1 — record
**which** of the two accepted functions production actually uses. Phase 97 inferred from the
baseline that production has `omnivyra_touch_updated_at` and not `set_content_updated_at`. This item
replaces that inference with observation.

**Objects.** `pg_trigger`, `pg_class`, `pg_proc`.

```sql
SELECT c.relname                       AS table_name,
       t.tgname                        AS trigger_name,
       t.tgtype                        AS tgtype,
       t.tgenabled::text               AS enabled,
       p.proname                       AS function_name,
       p.pronargs                      AS function_args,
       l.lanname                       AS language,
       p.prosecdef                     AS security_definer,
       p.proconfig                     AS pinned_config,
       (SELECT count(*) FROM pg_trigger t2
         WHERE t2.tgfoid = p.oid AND NOT t2.tgisinternal) AS dependent_triggers,
       pg_get_triggerdef(t.oid)        AS definition
  FROM pg_trigger t
  JOIN pg_class c  ON c.oid = t.tgrelid
  JOIN pg_proc  p  ON p.oid = t.tgfoid
  JOIN pg_language l ON l.oid = p.prolang
 WHERE NOT t.tgisinternal
   AND c.relnamespace = 'public'::regnamespace
   AND c.relname IN ('content_quality','content_block','content_recommendation',
                     'content_approval_history','content')
 ORDER BY c.relname, t.tgname;
```

Also record which of the two functions exist at all:

```sql
SELECT 'set_content_updated_at'    AS fn,
       to_regprocedure('public.set_content_updated_at()')    IS NOT NULL AS exists
UNION ALL
SELECT 'omnivyra_touch_updated_at',
       to_regprocedure('public.omnivyra_touch_updated_at()') IS NOT NULL;
```

**Expected columns.** As named. `tgenabled` is `"char"`; `O` means enabled.

**PASS.** `content_block_set_updated_at` exists on `content_block` with `tgtype = 19`
(ROW | BEFORE | UPDATE), `enabled = 'O'`, executing **either** `omnivyra_touch_updated_at` **or**
`set_content_updated_at`. Both are accepted — that is OD-11/A1, and the verification artifact's
`FIX3-VERIFY-09` accepts exactly these two names.
**FAIL.** The trigger executes a third function, is disabled, or has a `tgtype` other than 19. Fix 3
refuses at `FIX3-TRG-01`; the artifact refuses at `FIX3-VERIFY-09`.
**INCONCLUSIVE.** `content_block` absent — CREATE path. Note that on the CREATE path Fix 3's STEP 7
will pick a function by its documented precedence, and the second function query above predicts
which: if neither exists it creates `set_content_updated_at`; if only `omnivyra_touch_updated_at`
exists it uses that.

**Minimization.** Catalog metadata only.

**Limitations.** Does not establish that `updated_at` actually advances; that is a write.
`dependent_triggers` is informational — Phase 96 observed 70 for `omnivyra_touch_updated_at` on a
disposable database and a count alone is not a defect.

---

### ITEM 9 — Row counts for the five relevant tables

**Purpose.** Anchor the lock-and-scan risk assessment to real volumes. Phase 96's timings were
measured on synthetic data and cannot be interpreted without knowing production's scale.

**Objects.** The five tables themselves. **This is the only item that reads user tables rather than
catalogs.** It reads no column values.

Preferred, exact:

```sql
SELECT 'content_quality'          AS table_name, count(*) AS exact_rows FROM public.content_quality
UNION ALL SELECT 'content_block',            count(*) FROM public.content_block
UNION ALL SELECT 'content_recommendation',   count(*) FROM public.content_recommendation
UNION ALL SELECT 'content_approval_history', count(*) FROM public.content_approval_history
UNION ALL SELECT 'content',                  count(*) FROM public.content;
```

Zero-cost alternative if a sequential scan is unwelcome on a busy system — agree this substitution
in advance and record which variant was used:

```sql
SELECT c.relname AS table_name,
       c.reltuples::bigint AS estimated_rows,
       s.last_analyze, s.last_autoanalyze
  FROM pg_class c
  LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
 WHERE c.relnamespace = 'public'::regnamespace
   AND c.relname IN ('content_quality','content_block','content_recommendation',
                     'content_approval_history','content');
```

**Expected columns.** `table_name` and either `exact_rows` or `estimated_rows` with the analyze
timestamps.

**PASS.** Counts obtained for all five, and it is recorded which variant produced them.
**FAIL.** Not applicable — this item gathers a fact rather than testing a condition.
**INCONCLUSIVE.** A table is absent (record as "absent", not zero — the distinction matters: absent
means the CREATE path, zero means the RECONCILE path with no data), or the exact count was abandoned
because the scan was too slow and no estimate was taken.

**Minimization.** Counts only. No column values, no sample rows.

**Limitations.** `count(*)` takes `AccessShareLock` and performs a sequential scan, which on a large
table costs I/O but **blocks nothing** — it does not conflict with reads or writes. `reltuples` is
an estimate whose accuracy depends on the last ANALYZE, hence capturing those timestamps. Counts are
point-in-time and, as section 5 explains, **do not by themselves predict lock duration**.

---

### ITEM 10 — Tenant-consistency preflight

**Purpose.** The single most operationally important item. It predicts whether a future authorized
apply would abort. Fix 3 adds the four composite foreign keys **without `NOT VALID`**, so each one
validates every existing row synchronously. Any row whose `company_id` disagrees with its parent's
aborts STEP 4 with a raw PostgreSQL `23503` that carries **no `FIX3-*` code** — after ACCESS
EXCLUSIVE locks have been taken on five tables and after STEPs 2 and 3 have already made catalog
changes. Phase 96 reproduced this exactly (scenario S23) and proved the rollback is complete.

**Objects.** `public.content_block`, `public.content_recommendation`,
`public.content_approval_history`, `public.content`.

**The approved query is the one specified in Phase 96 section F**, reproduced here verbatim and
unmodified:

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

**Which relationships are checked.** Exactly the four composite foreign keys Fix 3 creates — the
four that validate synchronously. Nothing else can produce this failure class.

**How nullable references are treated.** Under MATCH SIMPLE a reference containing a NULL is exempt
from the constraint, so flagging such rows would be a false positive. Two of the four branches
therefore carry explicit guards: `r.block_id IS NOT NULL` (a NULL `block_id` means "the whole
content", a supported state) and `h.content_id IS NOT NULL` (nullable after Fix 3's STEP 3; in the
legacy shape it is NOT NULL, so the guard is harmless there). The other two child columns are NOT
NULL in the legacy shape and need no guard.

**`content_quality` is deliberately absent.** It has no foreign key, by the owner decision recorded
as OD-12/B1, and `FIX3-FK-13` refuses to apply if one exists. **If OD-12 is ever revisited to B2,
this preflight must gain a fifth branch of the same shape.**

**Distinguishing a tenant mismatch from a missing parent — a known gap.** The approved query does
**not** distinguish them: both produce a NULL on the same two-column LEFT JOIN. The two call for
different remediation — a tenant mismatch is an isolation problem, a missing parent is a referential
one. Phase 97 proposed a refinement that separates them, shown here for one relationship and
**marked NEEDS REVIEW**; it is a proposal, not an approved substitute, and the approved query above
remains authoritative:

```sql
-- NEEDS REVIEW — proposed in Phase 97, not yet approved. Do not substitute for the query above.
SELECT 'content_block'                                  AS child,
       b.id                                             AS child_id,
       b.company_id                                     AS child_company,
       CASE WHEN p.id IS NULL THEN 'missing_parent'
            ELSE 'tenant_mismatch' END                  AS kind,
       p.company_id                                     AS parent_company
  FROM public.content_block b
  LEFT JOIN public.content p ON p.id = b.content_id                        -- by id alone
  LEFT JOIN public.content m ON m.id = b.content_id
                            AND m.company_id = b.company_id                -- by the composite key
 WHERE m.id IS NULL;
```

**Minimization.** The approved query returns a relationship label and three UUIDs per offending
row — no business data and no personal data. If even identifiers are considered too much for a
first pass, this aggregation answers the go/no-go question with no identifiers at all, at the cost
of not naming the rows to fix:

```sql
SELECT child, count(*) AS offending_rows FROM ( /* the approved query above */ ) q GROUP BY child;
```

**Expected columns.** `child`, `id`, `company_id`, and the reference column.

**PASS — zero rows.** No existing row can fail the synchronous validation of the four composite
foreign keys, at the moment the query ran.
**FAIL — one or more rows.** Do not apply. Each row will abort STEP 4. Remediation is a data change
and is an owner decision; no phase of this programme has authorized one.
**INCONCLUSIVE.** Query not run, or tables absent (CREATE path, where the question does not arise
because the tables carry no rows).

**Limitations — read these before acting on a PASS.**

- **Time-of-check only.** A row written between the preflight and the apply reintroduces the
  exposure. Run it immediately before any future authorized application, in the same window.
- **A zero-row result does not authorize application.** It excludes exactly one failure class.
  Roughly 95 other `FIX3-*` guard conditions still apply, as do the lock and timeout risks in
  section 5, and the live schema questions in items 1 through 8.

---

### ITEM 11 — Migration-history evidence, reported separately from schema state

**Purpose.** Record what the ledger says, as text, and nothing more.

**Objects.** `supabase_migrations.schema_migrations`.

Discover the column set first rather than assuming it — the local harness bootstrap creates this
table as `(version text PRIMARY KEY, statements text[], name text)`, but production's was created by
the Supabase CLI and need not match:

```sql
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations'
 ORDER BY ordinal_position;
```

Then read only the version identifiers relevant to this programme, plus the ledger's extent:

```sql
SELECT version
  FROM supabase_migrations.schema_migrations
 WHERE version IN ('20260718000000','20260718000001','20260718000002',
                   '20260718000003','20261212000000')
 ORDER BY version;

SELECT count(*) AS ledger_rows,
       min(version) AS min_version,
       max(version) AS max_version
  FROM supabase_migrations.schema_migrations;
```

**Expected columns.** `version`; and `ledger_rows`, `min_version`, `max_version`.

**PASS.** The queries ran and the rows were captured **as ledger facts only**.
**FAIL.** Not applicable — this item cannot fail, because no ledger state is required.
**INCONCLUSIVE.** The schema or table does not exist, or is not readable by the role.

**Minimization.** Version strings and counts. **Do not select the `statements` column** if it
exists: it contains full migration SQL text, which is bulky and unnecessary here.

**Limitations — the most important caveat in this package.**

- **The ledger is known to be desynced in this environment.** A ledger row is evidence about the
  ledger, never about the schema. **Never merge this item's result with items 1 through 10.**
- **Do not run a generic migration-ledger prober.** It would classify Fix 3 as APPLIED purely
  because tables of those names exist. Items 5 through 8 are the only trustworthy evidence of what
  the schema actually contains.
- A row for `20261212000000` would mean someone recorded Fix 3 as applied; it would **not** mean the
  schema matches the Fix 3 contract. Equally, the absence of a row would not prove the objects are
  absent.
- The absence of rows for the `20260718*` wave would corroborate the Phase 96/97 inference that the
  predecessor was never applied to production — corroborate, not prove.

---

## 3. WHAT THIS PACKAGE DELIBERATELY EXCLUDES

The following would answer real questions but cannot be done safely within a read-only package.
Each is named here so it is visibly deferred rather than quietly omitted. **Each requires its own
explicit authorization and, where it involves writes, a non-production environment.**

| Excluded | Why | What it would need |
|---|---|---|
| Representative-role **read** behavior (`SET LOCAL ROLE` + `SELECT` in a read-only transaction) | Technically read-only, but needs role-switch privilege and is a materially larger ask than catalog inspection | A separate decision, and a role permitted to switch |
| Representative-role **write** behavior — whether a policy's `WITH CHECK` actually refuses a cross-tenant insert | **Cannot be demonstrated without attempting a write.** Prohibited, and should stay prohibited against production | A non-production environment seeded to resemble production |
| Any `EXPLAIN ANALYZE` of the migration's DDL | `ANALYZE` executes the statement | A non-production copy |
| Trial application of Fix 3, even in a rolled-back transaction | Takes ACCESS EXCLUSIVE on five tables and performs real catalog work before rolling back | Separate authorization and a maintenance window |
| Any remediation of rows found by item 10 | A data change | An owner decision |

---

## 4. HOW TO INTERPRET RLS AND GRANTS — FOUR DISTINCT LAYERS

Phase 96's disposable baseline could show deny-all and nothing more, because its 6,146 public grants
were all to `postgres` and `user_company_roles` carried only a `service_role` policy. Keep these
four layers separate when recording results; conflating them is the easiest way to overstate what
this package proves.

1. **RLS catalog configuration** — item 3. Whether RLS is enabled and forced. A boolean.
2. **Grants and role memberships** — item 1. Whether a role can reach the table at all. Necessary,
   not sufficient.
3. **Policy predicates** — items 2 and 4. What the rule *says*. Text.
4. **Actual runtime behavior for representative roles** — **not established by this package.**

**Catalog inspection alone does not prove the complete authorization behavior of real production
users.** Items 1 through 4 establish configuration. They permit a well-founded inference —
especially item 2, which determines whether the Fix 3 predicate is satisfiable at all — but an
inference is what it remains. Layer 4 needs the role-switched read test named in section 3, and the
write half cannot be tested against production at all.

Record each layer separately in the result template. Do not write "RLS verified".

Two findings to carry into the reading, both from earlier phases:

- The predicate's dependency on `user_company_roles` is **not introduced by Fix 3**.
  `public.content` already carries the identical predicate, so if the predicate is unsatisfiable in
  production it is already unsatisfiable for `content` today. Item 4 captures both.
- `content_quality`'s writer uses the **RLS-bypassing service-role client**, so for that table the
  policy layer is not in the write path at all. That is OD-12/B1, affirmed.

---

## 5. ROW COUNTS, LOCKS AND PERFORMANCE — HOW TO READ ITEM 9

**Row counts alone do not predict lock duration.** They are one input among several; instance class,
`maintenance_work_mem`, I/O throughput, cache state and concurrent load all matter and none is
visible in a row count.

**Historical synthetic evidence, carried forward from Phase 96 and not a production prediction.**
On a four-CPU laptop container with no concurrent load, at 250,002 `content` rows, 500,004
`content_block` rows and 250,002 rows in each of the other three — about 1.5 million rows in total:

- end-to-end apply **approximately 4,505 ms** (against approximately 655 ms on an empty database);
- largest single statement **approximately 1,489 ms**, the unique index build on 500k
  `content_block` rows;
- total scanning and building DDL approximately 2.94 s.

**These figures must not be quoted as a production performance prediction.** Different hardware,
different data, different concurrency.

**The three risks to weigh against item 9's counts, none of which is to be changed in this phase:**

1. **`SET LOCAL lock_timeout = '5s'`.** STEP 0B takes ACCESS SHARE on `user_company_roles` and
   **ACCESS EXCLUSIVE leaf-first on five tables**. Under real concurrent traffic the migration may
   simply fail to acquire those locks within five seconds and abort. That is *safe* — Phase 96
   proved rollback is complete — but it means an apply may need a quiet window to succeed at all.
2. **The ACCESS EXCLUSIVE window equals the whole apply**, because the migration is a single
   transaction. For its full duration, reads and writes to all five tables block.
3. **Synchronous validation and index building.** No constraint is added `NOT VALID`. Both composite
   unique index builds and all four foreign-key validations complete inside that window, and the
   lifecycle CHECK scans `public.content` when it is replaced. `statement_timeout` is 120 s per
   statement; whether that is ample depends on volumes this item is being run to discover.

**Do not propose changing `lock_timeout`, `statement_timeout`, the locking strategy or the
constraints in this phase.** Record the counts and let the owner weigh them.

---

## 6. RESULT TEMPLATE

Fill one block per evidence item, eleven in total. Keep it plain text.

```
STAGE A EVIDENCE — FIX 3
Session window (UTC):  start ____________________  end ____________________
Target confirmed by project ref:        ____________________  (expected klkiseupptzbecbxwrky)
current_database():                     ____________________
server_version:                         ____________________
Effective role (current_user):          ____________________
  is_superuser:  ____   bypasses_rls: ____   can_create_in_db: ____
Read-only mechanism used:               ____________________________________________
  SET TRANSACTION READ ONLY in effect?  ____
Read-only guarantee rests on:           [ ] role privileges   [ ] session discipline only
Item 9 variant used:                    [ ] exact count(*)    [ ] reltuples estimate
Preflight query version:                Phase 96 section F, sha256 e02bfecd0a16729f (first 16)

--- ITEM <n> ---
Evidence ID:          <1..11>
Executed at (UTC):    ____________________
Query/procedure:      as published in this document, item <n>   [ ] unmodified   [ ] modified (attach)
Exit status:          [ ] ok   [ ] error (quote the message, redacted)
Result summary:       ____________________________________________________________
Verdict:              [ ] PASS   [ ] FAIL   [ ] INCONCLUSIVE
Limitation / warning: ____________________________________________________________
```

**Omit from every field:** credentials, full or partial connection strings, tokens, API keys,
passwords, personal data, raw row payloads, and any table contents unrelated to these five tables.
If a result cannot be summarised without including one of those, write
`WITHHELD — contains sensitive data` and describe the shape of the finding instead.

### Overall roll-up

```
Items PASS: ___ / 11      FAIL: ___      INCONCLUSIVE: ___
Does production appear to carry the post-Fix-3 shape, the legacy shape, or neither?
  [ ] post-Fix-3 (items 5-8 match the contract)
  [ ] legacy shape (RECONCILE path — exercised and verified in Phase 96)
  [ ] tables absent (CREATE path — exercised and verified in Phase 96)
  [ ] mixed / unclear — describe:
Item 10 preflight:  [ ] zero rows   [ ] ___ rows returned   [ ] not run
Item 2 verdict — is the Fix 3 RLS predicate satisfiable for an ordinary user?
  [ ] yes   [ ] no   [ ] cannot tell from configuration alone
```

---

## 7. STAGE A STOP CONDITION

**Stage A remains BLOCKED until the owner independently establishes a provably read-only access
mechanism and reviews the resulting evidence.**

Preparing these instructions does **not**:

- perform Stage A;
- authorize production access by the coding session that wrote them;
- authorize that session to read the results;
- authorize application of the Fix 3 migration;
- authorize remediation of anything item 10 finds;
- authorize any change to production grants, policies, roles, timeouts or configuration.

Completing all eleven items with eleven PASS verdicts would establish what the production schema
**is**. It would not by itself authorize applying Fix 3. That remains a separate owner decision
requiring, at minimum: the evidence below reviewed; a remediation plan for anything item 10 finds;
a maintenance window consistent with the lock analysis in section 5; the migration and verification
artifact hashes re-confirmed at the time of application; and a rollback and recovery plan.

---

## 8. PROVENANCE

| Source | Identity |
|---|---|
| Fix 3 migration | `supabase/migrations/20261212000000_content_quality_collaboration_tenant_consistent.sql` |
| Frozen predecessor | `supabase/migrations/20260718000002_content_quality_collaboration.sql`, sha256 `34dffb69d4c500d0ed827ad9114778a1235ad79df3c022643decb3c55711a49d` |
| Verification artifact | `supabase/migrations/_fix3_tenant_consistent/verification.sql`, sha256 `5c62e0155bf1d4d1d911597549d83bb252cf54b66f89ba0774070371da26601b` |
| Behavioral evidence | `docs/security/FIX3_PHASE96_BEHAVIORAL_VALIDATION.md`, sha256 `ec932aa1c503c1a1c1b4af63ce0fbb3c7a2860c10cb05464562552eaa299fe9d` |
| Stage A plan and decisions | `docs/security/FIX3_PHASE97_OWNER_DECISIONS_AND_STAGE_A.md`, sha256 `a2374fb2ed1588989f912ee2bfb8059962c53d9103962766e0e368f0e7767a72` |
| Preflight query (item 10) | Phase 96 section F, extracted verbatim, 20 lines, sha256 begins `e02bfecd0a16729f` |

**Items marked NEEDS REVIEW:** one — the mismatch-versus-missing-parent refinement inside item 10.
It is a proposal from Phase 97 and is not approved; the Phase 96 query remains authoritative.

Every other identifier used above is grounded: table, constraint, index, trigger, function and
policy names come from the Fix 3 migration and the frozen predecessor; `content_company_rw` is
confirmed present in the committed production-shaped baseline; the ledger table name and its local
column set come from `scripts/ci/schema-bootstrap.sql`, and item 11 discovers production's actual
columns rather than assuming them.
