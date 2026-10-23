# FIX 3 — STAGE A PACKAGE: PROPOSED CORRECTION (REVIEW ARTIFACT, NOT APPLIED)

**Status: PROPOSED. Not applied, not approved, and NOT EXECUTED against any database.** No SQL below
has been run or parsed by PostgreSQL. Syntactic plausibility is not verification.

This document does **not** modify
`docs/security/FIX3_PHASE98_STAGE_A_OWNER_RUN_EVIDENCE.md`, which remains byte-unchanged at
`a0327d2ae48ba3bef0772eeb38947e8378f659a0eea3e2e30e0540dab0f23c5b`.

It is a **line-mapped patch**, not a duplicate of the 920-line package. That is deliberate: a second
full copy would be an independent artifact that could drift from the original, and the original must
stay authoritative. Every replacement block below is complete and mechanically applicable. Say so if
a full replacement file is wanted instead.

**Preserved unchanged by this proposal:** all eleven evidence items and their purposes; Item 10's
approved Phase 96 §F query, verbatim; every stop condition; the result template's structure. The
unapproved Phase 98 lines 649-662 refinement and the proposed Phase 99 correction are **not** used
and **not** introduced.

---

## CORRECTION 1 — READ-ONLY ACCESS PREFLIGHT

**Replaces package lines 29-45** (safety preamble, numbered item 3, from
`3. **Verify the effective database role**` through `…record that fact in the result template.`).

### Why

The existing gate asks four questions and then draws a conclusion none of them supports:

> A role reporting `is_superuser = true` or `can_create_in_db = true` is **not** a read-only role.

The stated direction is true. The **converse is what an operator will act on**, and it is false: a
role can be a non-superuser, lack database-level `CREATE`, and still hold `INSERT`, `UPDATE`,
`DELETE` and `TRUNCATE` on every table in `public`.

Five specific defects:

1. **No table-level write privilege is ever checked.** This is the decisive question and it is
   absent. Nothing tests `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`/`REFERENCES`/`TRIGGER` on the
   relations the package touches.
2. **Inherited privileges are invisible.** `pg_roles.rolsuper` and `rolbypassrls` are read for
   `current_user` only. Role **attributes** are not inherited through membership, but **table
   privileges are** (for an `INHERIT` role). A role that is harmless by attribute can hold full write
   access through a group role, and this gate would report it clean.
3. **Escalation paths are not checked.** Membership in a superuser or `BYPASSRLS` role lets the
   session `SET ROLE` into it. `rolsuper = false` for `current_user` does not exclude that.
4. **Ownership is not checked.** A table's owner may `ALTER` or `DROP` it regardless of granted
   privileges.
5. **Two near-irrelevant signals crowd out the relevant ones.** `rolcreatedb` concerns creating
   *databases*; `has_database_privilege(…,'CREATE')` concerns creating *schemas*. Neither governs
   writing to application tables. The missing one is
   `has_schema_privilege(current_user,'public','CREATE')`.

Separately, **database identity**: `current_database()` is typically `postgres` on Supabase and
cannot distinguish one project from another. No in-database query can confirm the project ref, so
target identity rests entirely on the out-of-band console check — which the package asks for but
does not label as unverifiable from SQL.

### Replacement text

> 3. **Verify what the effective role can actually do.** Checking the role's name is not sufficient,
>    and neither is checking that it is not a superuser. The decisive question is whether the role
>    holds write privilege on the objects this package touches, or owns them. Run all four queries;
>    each is read-only.
>
>    **3a — session context and role attributes.** Attributes are *not* inherited through role
>    membership, so this establishes only what this role is in its own right:
>
>    ```sql
>    SELECT current_user,
>           session_user,
>           current_database()                                                 AS db_name,
>           current_setting('server_version')                                  AS server_version,
>           current_setting('transaction_read_only')                           AS txn_read_only,
>           r.rolsuper                                                         AS is_superuser,
>           r.rolbypassrls                                                     AS bypasses_rls,
>           r.rolinherit                                                       AS inherits_privileges,
>           has_database_privilege(current_user, current_database(), 'CREATE')  AS can_create_schema,
>           has_schema_privilege(current_user, 'public', 'CREATE')              AS can_create_in_public
>      FROM pg_roles r
>     WHERE r.rolname = current_user;
>    ```
>
>    **3b — effective write privilege, the decisive check.** `has_table_privilege` *does* account for
>    privileges held through role membership, which 3a cannot see. Driving the query from `pg_class`
>    means absent relations are simply omitted rather than raising:
>
>    ```sql
>    SELECT c.oid::regclass::text                                 AS table_name,
>           has_table_privilege(current_user, c.oid, 'SELECT')     AS sel,
>           has_table_privilege(current_user, c.oid, 'INSERT')     AS ins,
>           has_table_privilege(current_user, c.oid, 'UPDATE')     AS upd,
>           has_table_privilege(current_user, c.oid, 'DELETE')     AS del,
>           has_table_privilege(current_user, c.oid, 'TRUNCATE')   AS trunc,
>           has_table_privilege(current_user, c.oid, 'REFERENCES') AS refs,
>           has_table_privilege(current_user, c.oid, 'TRIGGER')    AS trig
>      FROM pg_class c
>     WHERE c.relnamespace = 'public'::regnamespace
>       AND c.relname IN ('content_quality','content_block','content_recommendation',
>                         'content_approval_history','content','user_company_roles')
>     ORDER BY 1;
>    ```
>
>    **3c — ownership.** An owner may `ALTER` or `DROP` regardless of grants, and `pg_has_role`
>    catches ownership held through a group role:
>
>    ```sql
>    SELECT c.relname                                        AS table_name,
>           c.relowner::regrole::text                        AS owner,
>           pg_has_role(current_user, c.relowner, 'USAGE')    AS is_or_inherits_owner
>      FROM pg_class c
>     WHERE c.relnamespace = 'public'::regnamespace
>       AND c.relname IN ('content_quality','content_block','content_recommendation',
>                         'content_approval_history','content','user_company_roles')
>     ORDER BY 1;
>    ```
>
>    **3d — escalation paths.** Any row here means the session can `SET ROLE` into a superuser or
>    `BYPASSRLS` role, whatever 3a reported:
>
>    ```sql
>    SELECT r.rolname, r.rolsuper, r.rolbypassrls
>      FROM pg_roles r
>     WHERE (r.rolsuper OR r.rolbypassrls)
>       AND pg_has_role(current_user, r.oid, 'MEMBER')
>     ORDER BY 1;
>    ```
>
>    **What these four establish — and what they do not.**
>
>    They establish, **for the six named relations only**: whether the role holds any write
>    privilege, including privilege inherited through group roles; whether it is or inherits their
>    owner; and whether a `SET ROLE` path into a superuser or `BYPASSRLS` role exists.
>
>    They do **not** establish that the role is read-only in general. Not covered: `SECURITY DEFINER`
>    functions, which execute with the definer's privileges; event triggers; every object outside the
>    six named relations; privileges granted to `PUBLIC`; and anything a connection pooler or
>    middleware may do on the role's behalf. **Absence of superuser status and absence of
>    database-level `CREATE` do not make a role read-only.**
>
>    `transaction_read_only` is a **transaction-level** control, independent of all of the above. It
>    blocks writes in the current transaction regardless of privilege, and says nothing about what
>    the role could do in a different transaction. Privilege and transaction mode are two separate
>    guarantees; record them separately.
>
>    **Database identity cannot be established from inside the database.** `current_database()` is
>    typically `postgres` on this platform and does not distinguish projects. The project ref
>    `klkiseupptzbecbxwrky` is confirmable only out-of-band, from the platform console. Record that
>    the confirmation was visual and out-of-band.
>
>    **STOP — do not run items 1 through 11 — if any of these holds:**
>
>    - 3a reports `is_superuser = true`;
>    - 3a reports `can_create_in_public = true`;
>    - 3b reports `true` for `ins`, `upd`, `del`, `trunc`, `refs` or `trig` on **any** relation;
>    - 3c reports `is_or_inherits_owner = true` for **any** relation;
>    - 3d returns **any** row;
>    - step 4's read-only transaction cannot be established;
>    - the project ref cannot be confirmed out-of-band.
>
>    A separate, narrower condition: if 3b reports `sel = false` for a relation an item needs, that
>    item's result will be **incomplete rather than unsafe**. Record it as INCONCLUSIVE for that item
>    and continue; it is not a reason to stop the session.
>
>    If every stop condition is clear, do **not** write "read-only verified". Write: *no write
>    privilege on and no ownership of the six named relations, no superuser escalation path found,
>    read-only transaction in effect.* That is what was established.
>
>    **If the available session cannot meet this bar, Stage A stays BLOCKED.** Provisioning a
>    dedicated read-only role, or explicitly accepting a discipline-based guarantee in place of a
>    privilege-based one, is an **owner decision**. It is not authorized by this package and must not
>    be assumed. Do not weaken this gate to make the procedure executable.

### Consequential edit to the result template

**Package line 648** currently reads:

```
Read-only guarantee rests on:           [ ] role privileges   [ ] session discipline only
```

Replace with:

```
Read-only guarantee rests on:  [ ] no write privilege/ownership on the six relations (3a-3d all clear)
                               [ ] session discipline only — owner accepted this explicitly
3a is_superuser: ____  can_create_in_public: ____    3b any write priv: ____
3c is/inherits owner: ____                            3d escalation rows: ____
Project ref confirmed out-of-band (console): ____
```

No other template line changes.

---

## CORRECTION 2 — ITEM 9 ABSENT-TABLE HANDLING

**Replaces package lines 548-556** (`Preferred, exact:` and the `sql` block beneath it) and
**lines 558-572** (the estimated alternative), plus the two recording lines noted at the end.

### Why

The exact-count statement is a single `UNION ALL` over five hard-coded relations:

```sql
SELECT 'content_quality' AS table_name, count(*) AS exact_rows FROM public.content_quality
UNION ALL SELECT 'content_block', count(*) FROM public.content_block
…
```

A static statement that names a non-existent relation fails at **parse/analysis time** with
`42P01 relation does not exist`. It does not return partial results. **One absent table therefore
destroys the counts for the four that do exist**, and the whole evidence item yields nothing.

This is not a hypothetical. Phase 96 established that the committed production-shaped baseline
contains `public.content` but **none of the four Fix 3 tables** — the CREATE path. On the single
most likely production state, this item fails outright and reports nothing.

Two further false-zero traps in the same item:

- The estimated alternative drives from `pg_class` filtered by `relname IN (…)`, so an absent table
  **silently does not appear**. The operator sees four rows instead of five and must infer which is
  missing, with nothing distinguishing "absent" from "mis-typed name".
- `pg_class.reltuples` is **`-1`** in PostgreSQL 14 and later for a relation that has never been
  vacuumed or analyzed. That means *unknown*, not zero. The target is PostgreSQL 15 or later
  (asserted by `FIX3-PRECOND-00`), so this is live. The current text does not mention it.

**No dynamic SQL is proposed.** A `DO` block cannot return a result set; making it return one
requires a temporary table, which is a **write** and would violate the read-only transaction. The
correct shape is an existence probe followed by per-table counts.

### Replacement text

> **Step 9a — establish existence first, from catalog metadata only.** This statement always
> succeeds, whatever exists: `to_regclass` returns `NULL` for an absent relation rather than raising.
> That is the same absence-detection idiom the Fix 3 migration itself uses in 28 places.
>
> ```sql
> SELECT v.table_name,
>        (to_regclass('public.' || v.table_name) IS NOT NULL) AS present,
>        (SELECT c.relkind::text
>           FROM pg_class c
>          WHERE c.oid = to_regclass('public.' || v.table_name)) AS relkind
>   FROM (VALUES ('content_quality'),
>                ('content_block'),
>                ('content_recommendation'),
>                ('content_approval_history'),
>                ('content')) AS v(table_name)
>  ORDER BY v.table_name;
> ```
>
> All five names appear in the output, each with `present` true or false. Record this table first; it
> determines what step 9b may run **and** which migration path applies.
>
> **Step 9b — exact counts, one statement per table, only for those with `present = true`.**
> Run only the lines whose table step 9a reported present. Skip the others entirely — do not run them
> "to see what happens".
>
> ```sql
> SELECT 'content_quality'          AS table_name, count(*) AS exact_rows FROM public.content_quality;
> SELECT 'content_block'            AS table_name, count(*) AS exact_rows FROM public.content_block;
> SELECT 'content_recommendation'   AS table_name, count(*) AS exact_rows FROM public.content_recommendation;
> SELECT 'content_approval_history' AS table_name, count(*) AS exact_rows FROM public.content_approval_history;
> SELECT 'content'                  AS table_name, count(*) AS exact_rows FROM public.content;
> ```
>
> **Why five statements rather than one `UNION ALL`.** A single static statement naming an absent
> relation fails at parse time with `42P01` and returns nothing at all, so one absent table would
> destroy the counts for every table that does exist. Separate statements fail independently, and
> step 9a means none of them should fail at all. No dynamic SQL is used: a `DO` block cannot return
> rows without creating a temporary table, which would be a write.
>
> **Recording rule — absence is never zero.** For each of the five, record exactly one of:
>
> | Step 9a `present` | Step 9b | Record as |
> |---|---|---|
> | `false` | not run | **`ABSENT`** |
> | `true` | returned a count | that number, including **`0`** when the table exists and is empty |
> | `true` | not run or errored | **`INCONCLUSIVE`**, with the reason |
>
> `ABSENT` and `0` are different findings and must never be collapsed. `ABSENT` means the object does
> not exist, so Fix 3 would **create** it. `0` means the object exists and holds no rows, so Fix 3
> would **reconcile** it — against no data.
>
> **Which migration path the result implies:**
>
> | Step 9a outcome | Path |
> |---|---|
> | all four Fix 3 tables `ABSENT`, `content` present | **CREATE path** — exercised and verified in Phase 96 |
> | all four present | **RECONCILE path**, or already applied. Items 5 to 8 decide which; item 9 cannot |
> | some present, some absent | **mixed — escalate.** Not a state any phase has exercised; do not infer a path |
> | `content` absent | escalate immediately; a far larger finding than this item |
>
> **Zero-cost alternative** if a sequential scan is unwelcome on a busy system. Agree this
> substitution in advance and record which variant produced the numbers. Note it lists all five names
> including absent ones, so nothing is silently omitted:
>
> ```sql
> SELECT v.table_name,
>        (to_regclass('public.' || v.table_name) IS NOT NULL) AS present,
>        c.reltuples::bigint                                   AS estimated_rows,
>        s.last_analyze,
>        s.last_autoanalyze
>   FROM (VALUES ('content_quality'),
>                ('content_block'),
>                ('content_recommendation'),
>                ('content_approval_history'),
>                ('content')) AS v(table_name)
>   LEFT JOIN pg_class c           ON c.oid = to_regclass('public.' || v.table_name)
>   LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
>  ORDER BY v.table_name;
> ```
>
> **Reading the estimate — three values that are not row counts:**
>
> - `present = false` → the table is **ABSENT**. `estimated_rows` will be NULL; do not read it as 0.
> - `estimated_rows = -1` → **UNKNOWN**, not zero. Since PostgreSQL 14 a relation that has never been
>   vacuumed or analyzed carries `reltuples = -1` precisely so that "no statistics" is distinguishable
>   from "no rows". The target is PostgreSQL 15 or later, so this value is reachable. Record it as
>   `UNKNOWN (reltuples = -1)` and note that no exact count was taken.
> - `estimated_rows = 0` with a non-null `last_analyze` or `last_autoanalyze` → genuinely empty, as
>   of that timestamp.
>
> An estimate is never evidence for the lock analysis in section 5 at the precision an exact count
> gives. If the counts matter to the apply decision, take the exact counts in a quiet window.

### Two further recording lines in Item 9

**Package line 577** currently reads:

> **INCONCLUSIVE.** A table is absent (record as "absent", not zero — the distinction matters: absent
> means the CREATE path, zero means the RECONCILE path with no data), or the exact count was abandoned
> because the scan was too slow and no estimate was taken.

Replace with:

> **INCONCLUSIVE.** Step 9a could not be run; or a table step 9a reported present failed or was not
> counted in step 9b; or the exact counts were abandoned as too slow and no estimate was taken.
> **A table reported `ABSENT` by step 9a is NOT inconclusive** — it is a positive finding, recorded as
> `ABSENT` and never as zero, and it is what distinguishes the CREATE path from the RECONCILE path.

**Package lines 545-546** currently read:

> **Objects.** The five tables themselves. **This is the only item that reads user tables rather than
> catalogs.** It reads no column values.

That claim is **factually wrong** and is an internal inconsistency: Item 10 also reads
`content_block`, `content_recommendation`, `content_approval_history` and `content`. Replace with:

> **Objects.** Catalog metadata for step 9a; the five tables themselves for step 9b. Item 9 and
> Item 10 are the two items that read user tables rather than catalogs; Item 9 is the only one that
> reads them for a count, and it reads no column values.

---

## WHAT THIS PROPOSAL DOES NOT FIX

Two further material gaps are reported in the companion review and are **not** patched here, because
one needs an owner decision and the other needs a decision about scope:

- **Item 1's instrument is membership-filtered** (`information_schema.role_table_grants` shows only
  grants where a currently enabled role is grantor or grantee), so under a restricted read-only role
  it can under-report and look like "no grants exist". A `pg_class.relacl` / `aclexplode` form would
  not be filtered. Proposing that replacement changes an approved evidence item's instrument, which
  is an owner call.
- **The read-only gate will probably fail on the only readily available role.** See the review's
  BLOCKED finding.

No other change to the package is proposed. Nothing here has been executed.
