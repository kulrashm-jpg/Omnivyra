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

## 0. CORRECTION PROVENANCE — READ FIRST

**This is a corrected derivative. It supersedes the original package for execution purposes.**

| | |
|---|---|
| Derived from | `docs/security/FIX3_PHASE98_STAGE_A_OWNER_RUN_EVIDENCE.md`, sha256 `a0327d2ae48ba3bef0772eeb38947e8378f659a0eea3e2e30e0540dab0f23c5b`, which remains **byte-unchanged and preserved** |
| Gaps addressed | G-1 read-only gate, G-2 Item 9 absent-table handling, G-3 Item 1 grant instrument, G-4 internal inconsistency, G-5 Item 5 version compatibility |
| Review that found them | `docs/security/FIX3_STAGE_A_PACKAGE_GAP_REVIEW.md` |
| **Revision** | **v8.** Static validation of v7 (`FIX3_V7_STATIC_VALIDATION.md`) confirmed both v7 hashes and H-1, and found four defects, all fixed here. **J-1:** the closing "what to write" instruction in preamble step 3 was a **third stale restatement** of the gate — it named **six** relations, omitting the migration ledger, both schemas and the database-level powers, and called the read-only transaction **"database-enforced"**, contradicting the L-1 decision. It is now a cross-reference to the single authoritative list. **J-2:** the aggregate-verdict block had no field for the supporting rationale or for unresolved conditions; both are added, with an escalation field. **J-3:** the disposition rule did not require escalation where applicability is mandatory or unresolved; it now does. **J-4:** a missing blank line merged preamble step 4 into the preceding paragraph. The operator steps additionally lose two stale "v6 package" pointers and gain the v8 path and hash. Still eight stop conditions; none added, none weakened, and no change of scope. Supersedes v7 (`78ce050f0d351fc1…`) and all earlier versions, preserved as audit history and **not for execution**. |
| **Revision** | **v7.** Final validation of v6 (`FIX3_V6_FINAL_SAFETY.md`) confirmed V6-1, V6-2 and V6-3 as implemented, and found four further defects, all fixed here. **H-1:** the package's result template had **no fields** for V6-1's three `can_set_role_to_*_owner` columns, so SC-4's new disjuncts could not be recorded in the template the operator is told to fill — while the operator-steps template did have them. Added. **H-2:** the aggregate rule was silent on `NOT APPLICABLE`; it now states that NOT APPLICABLE is not a PASS, is admissible only where a check's approved semantics define it (**Item 10b alone** at present), and never overrides a stop condition. **H-3:** no aggregate-verdict field existed anywhere; one is added, to be filled last. **H-4:** section 1's "Stop conditions for the owner" was a **second stale restatement** of the gate — it said **six** relations, omitted `CREATEROLE`, schema `CREATE` on `supabase_migrations`, schema and database ownership and the `SET ROLE` paths, and called the read-only transaction **"database-enforced"**, contradicting the L-1 decision. It is now a **cross-reference** to the single authoritative list rather than a copy, which removes the defect's root cause. Still eight stop conditions; none added, none weakened. Supersedes v6 (`df9672617e0f2699…`) and all earlier versions, preserved as audit history and **not for execution**. |
| **Revision** | **v6.** Final static validation of v5 (`FIX3_V5_FINAL_VALIDATION.md`) confirmed V5-1 through V5-5 as correctly implemented, and found three further defects, all fixed here. **G-1 (safety):** all three ownership checks tested only `pg_has_role(…, 'USAGE')`, which is false for a **NOINHERIT** member of an owning role — such a session can `SET ROLE` to the owner and hold full ownership powers, and 3d does not catch it because 3d scans only `rolsuper`/`rolbypassrls` roles while an owner need be neither. A `'MEMBER'` test is added for relation, schema and database owners, and SC-4 widened. **G-2 (evidence validity):** the result template carried a **stale second gate block**, present since v1-corrected and duplicated from v4, which declared **six** relations and omitted `can_create_roles`, database ownership and 3e entirely — an operator filling it would have recorded an incomplete gate as satisfied. It also contained a line describing the read-only transaction as "database-enforced; required", contradicting the L-1 decision. Removed; the two unique fields it held are retained. **G-3:** an explicit aggregate-readiness rule is added. Still eight stop conditions — SC-4 widened once more, none weakened, none added. Supersedes v5 (`2902242859b28912…`) and all earlier versions, preserved as audit history and **not for execution**. |
| **Revision** | **v5.** Independent audit of v4 (`FIX3_V4_GATE_AUDIT.md`) found five defects, all fixed here. **F-1:** `rolcreaterole` was unchecked — a `CREATEROLE` role can manufacture the escalation path 3d only observes, so it is added to 3a and to SC-1. **F-2:** database ownership was unchecked — a DDL path outside every table and schema ACL — so it is added to 3a and to SC-4. **F-3:** the result template asked for a 3e `present` value the v4 query never returned, and that query would have **errored** on an absent schema because `has_schema_privilege` raises on an unknown name; 3e is now `VALUES`-driven with a `LATERAL` guard. **F-4:** an `UNKNOWN` on a *present* relation or schema is now itself a STOP, not merely an annotation. **F-5:** an explicit precedence rule is added — a stop condition overrides any nominal pass elsewhere. Still eight stop conditions: two further widened in scope, none weakened, none added. Supersedes v4 (`63498ef76eae0d74…`) and all earlier versions, preserved as audit history and **not for execution**. |
| **Revision** | **v4.** Implements owner decisions **L-1, L-3, L-5** from `FIX3_STAGE_A_READONLY_PREREQUISITE.md`. **L-1:** SC-6's evidentiary meaning is defined as `transaction_read_only` *observed* `on` in the actual intended session, recorded against the 3f backend PID, and is explicitly described as a session safeguard rather than the enforcement. **L-3:** `supabase_migrations.schema_migrations` is added to the 3b privilege and 3c ownership checks (seven relations), and a new **3e** covers schema `CREATE` and schema ownership for both `public` and `supabase_migrations`. **L-5:** a new **3f** records `pg_backend_pid()` before Item 1, matched against a post-Item-11 capture, with transaction-pooling treated as INCONCLUSIVE by construction. Still eight stop conditions — three widened in scope, one clarified, none weakened, none added. Supersedes v3 (`27680e1e70a24fac…`), v2 and v1, all preserved as audit history and **not for execution**. |
| **Revision** | **v3.** Adds owner-approved **sub-item 10b** (both steps) inside Item 10, closing **D-3**: Fix 3's STEP 6 can ADD the lifecycle CHECK and abort with `23514`, which no item previously detected. v3 also carries forward the v2 fixes — **D-1** Item 9 step 9b split into separately fenced statements, since a multi-statement batch is parsed in full before execution and one absent relation would fail all five with `42P01`; **D-2** the server-version stop added as the eighth preamble condition. Supersedes v2 (`c2b9eaf9e14661c4…`) and v1 (`8e751f5bf9fc5188…`), both preserved as audit history and **not for execution**. Item 10's approved Phase 96 §F query is byte-identical throughout; the eleven-item structure and the `Items PASS: ___ / 11` roll-up are unchanged, because 10b is a sub-item. |
| **Revision** | **v2.** The independent audit recorded in `FIX3_STAGE_A_AUDIT_CLOSURE.md` found two residual defects in v1 and both are fixed here: **D-1** Item 9 step 9b was a single fenced batch, which under the simple query protocol fails wholesale with `42P01` if one relation is absent — it is now five separately fenced statements with an explicit do-not-batch warning; **D-2** the preamble's stop list had no server-version condition although Item 5 declared a sub-15 server voids the assessment — it is now the eighth stop condition, evaluated before item 1. v1 (`8e751f5bf9fc5188…`) is preserved and must not be executed. |

**What changed from the original, and nothing else:** the preamble's role-verification gate
(section 1, step 3) and its stop conditions; Item 1's grant instrument; Item 5's version gate;
Item 9's existence handling and verdicts; the result template's read-only block; and section 7's
stop condition. Every other line of the original is carried over unmodified.

**Owner decisions embodied here.** A dedicated, independently verified, **database-enforced**
read-only session is required; **discipline-only assurance is not accepted as a substitute**, and
Stage A stays BLOCKED until a compliant session exists. Item 1 uses catalog ACL inspection rather
than `information_schema`. Item 5 stops rather than degrading on a server below PostgreSQL 15.

**Unchanged and authoritative:** Item 10's approved Phase 96 §F tenant-consistency preflight,
verbatim. The unapproved Phase 98 refinement and the proposed Phase 99 correction are **not** used.

**Nothing in this document has been executed.** No query here has been run or parsed by PostgreSQL.

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
3. **Verify what the effective role can actually do.** Checking the role's name is not sufficient,
   and neither is checking that it is not a superuser: a role can be a non-superuser, lack
   database-level `CREATE`, and still hold `INSERT`, `UPDATE`, `DELETE` and `TRUNCATE` on every
   table in `public`. The decisive question is whether the role holds write privilege on the
   objects this package touches, or owns them. Run all four queries; each is read-only.

   **3a — session context, role attributes and database-level powers.** Role *attributes* are not
   inherited through role membership, so the attribute columns establish only what this role is in
   its own right. **[v5]** adds `rolcreaterole` and database ownership — see the two findings noted
   beneath the query.

   ```sql
   SELECT current_user,
          session_user,
          current_database()                                                 AS db_name,
          current_setting('server_version')                                  AS server_version,
          current_setting('server_version_num')                              AS server_version_num,
          current_setting('transaction_read_only')                           AS txn_read_only,
          r.rolsuper                                                         AS is_superuser,
          r.rolbypassrls                                                     AS bypasses_rls,
          r.rolinherit                                                       AS inherits_privileges,
          r.rolcreaterole                                                    AS can_create_roles,
          has_database_privilege(current_user, current_database(), 'CREATE')  AS can_create_schema,
          has_schema_privilege(current_user, 'public', 'CREATE')              AS can_create_in_public,
          d.datdba::regrole::text                                            AS database_owner,
          pg_has_role(current_user, d.datdba, 'USAGE')                       AS is_or_inherits_database_owner,
          pg_has_role(current_user, d.datdba, 'MEMBER')                      AS can_set_role_to_database_owner
     FROM pg_roles r
     CROSS JOIN pg_database d
    WHERE r.rolname = current_user
      AND d.datname = current_database();
   ```

   Record `server_version_num` — **Item 5 depends on it.**

   **Why `rolcreaterole` is here [v5].** 3d observes the role's **current** membership in privileged
   roles. A role holding `CREATEROLE` can create and alter non-superuser roles and grant role
   membership, so it can **manufacture** the escalation path 3d checks for — including altering a
   write-capable role's password and connecting as it. A `CREATEROLE` role would otherwise pass every
   stop condition while retaining a route to a write-capable identity. 3d alone is a snapshot; this
   closes the ability to change the snapshot.

   **Why database ownership is here [v5].** Relation ownership is 3c and schema ownership is 3e, but
   nothing observed **database** ownership. A database owner holds DDL powers that sit outside every
   table and schema ACL — `ALTER DATABASE`, and `DROP DATABASE` when not connected to it. It does not
   by itself confer privileges on objects inside the database, so it is not a path to application
   **data**; it is a destructive DDL path, and the gate claims to bound exactly that.

   **Deliberately still out of scope, recorded so the omissions are choices rather than oversights.**
   `rolcreatedb` governs creating *other* databases and opens no path into this one.
   `rolreplication` permits streaming WAL — a read path. `has_database_privilege(…, 'TEMP')` permits
   temporary objects, which cannot alter application data and which a read-only transaction blocks
   anyway; the package separately forbids creating any temporary object.

   **3b — effective write privilege. This is the decisive check.** `has_table_privilege` *does*
   account for privileges held through role membership, which 3a cannot see. The relation list is
   driven from an explicit `VALUES` list via `to_regclass`, so every relation appears in the output
   with a `present` flag and an absent one yields **NULL privileges, not `false`** — a `false` would
   read as "checked and clean" when nothing was checked:

   ```sql
   WITH want(qname) AS (
     VALUES ('public.content_quality'),
            ('public.content_block'),
            ('public.content_recommendation'),
            ('public.content_approval_history'),
            ('public.content'),
            ('public.user_company_roles'),
            ('supabase_migrations.schema_migrations')
   ), res AS (
     SELECT w.qname, to_regclass(w.qname) AS rel FROM want w
   )
   SELECT r.qname                 AS relation,
          r.rel IS NOT NULL       AS present,
          p.sel, p.ins, p.upd, p.del, p.trunc, p.refs, p.trig
     FROM res r
     LEFT JOIN LATERAL (
       SELECT has_table_privilege(current_user, r.rel, 'SELECT')     AS sel,
              has_table_privilege(current_user, r.rel, 'INSERT')     AS ins,
              has_table_privilege(current_user, r.rel, 'UPDATE')     AS upd,
              has_table_privilege(current_user, r.rel, 'DELETE')     AS del,
              has_table_privilege(current_user, r.rel, 'TRUNCATE')   AS trunc,
              has_table_privilege(current_user, r.rel, 'REFERENCES') AS refs,
              has_table_privilege(current_user, r.rel, 'TRIGGER')    AS trig
        WHERE r.rel IS NOT NULL
     ) p ON true
    ORDER BY r.qname;
   ```

   The `LATERAL` subquery returns no row when `r.rel IS NULL`, so `has_table_privilege` is never
   called on a non-existent OID — which would raise — and the `LEFT JOIN` keeps the absent relation
   visible with NULLs.

   **`supabase_migrations.schema_migrations` is in this list deliberately.** Item 11 reads it, and it
   is the one relation where a write would be worse than a schema change: **writing the migration
   ledger could record Fix 3 as applied while the schema was never altered**, which is exactly the
   ledger/schema desync this programme exists to avoid. It is **not** assumed to exist — its `present`
   flag reports that, and absence is recorded as `ABSENT`, never inferred as safe-because-clean.

   **3c — ownership.** An owner may `ALTER` or `DROP` regardless of granted privileges, and
   `pg_has_role` catches ownership held through a group role. Same seven relations, same
   absent-visible treatment:

   ```sql
   WITH want(qname) AS (
     VALUES ('public.content_quality'),
            ('public.content_block'),
            ('public.content_recommendation'),
            ('public.content_approval_history'),
            ('public.content'),
            ('public.user_company_roles'),
            ('supabase_migrations.schema_migrations')
   )
   SELECT w.qname                                       AS relation,
          to_regclass(w.qname) IS NOT NULL              AS present,
          c.relowner::regrole::text                     AS owner,
          pg_has_role(current_user, c.relowner, 'USAGE')  AS is_or_inherits_owner,
          pg_has_role(current_user, c.relowner, 'MEMBER') AS can_set_role_to_owner
     FROM want w
     LEFT JOIN pg_class c ON c.oid = to_regclass(w.qname)
    ORDER BY w.qname;
   ```

   **3d — escalation paths.** Any row returned means the session can `SET ROLE` into a superuser or
   `BYPASSRLS` role, whatever 3a reported:

   ```sql
   SELECT r.rolname, r.rolsuper, r.rolbypassrls
     FROM pg_roles r
    WHERE (r.rolsuper OR r.rolbypassrls)
      AND pg_has_role(current_user, r.oid, 'MEMBER')
    ORDER BY 1;
   ```

   **3e — schema-level privileges and schema ownership, for BOTH schemas Stage A touches.**
   *(New in v4; **[v5]** adds an explicit `present` column and guards the privilege functions.)* A
   table-level check is not sufficient for the ledger: `CREATE` on a schema is a write capability in
   its own right, and a schema's owner can drop objects in it. `public` was already covered by 3a's
   `can_create_in_public`; `supabase_migrations` was covered by nothing.

   **[v5] Two corrections.** The v4 form selected from `pg_namespace` directly, so an absent schema
   produced **no row** — which the prose handled but the result template could not, because it asks
   for a `present` value the query never returned. And `has_schema_privilege(name, text, text)`
   **raises** `3F000` on a schema that does not exist, so simply listing both names and calling it
   unconditionally would make the whole item error instead of reporting absence. Both are fixed
   below: the schema list drives the query, and the privilege functions are called only for a schema
   that exists.

   ```sql
   WITH want(schema_name) AS (
     VALUES ('public'), ('supabase_migrations')
   )
   SELECT w.schema_name,
          n.oid IS NOT NULL                                   AS present,
          n.nspowner::regrole::text                           AS schema_owner,
          pg_has_role(current_user, n.nspowner, 'USAGE')        AS is_or_inherits_schema_owner,
          pg_has_role(current_user, n.nspowner, 'MEMBER')       AS can_set_role_to_schema_owner,
          p.usage_priv,
          p.create_priv
     FROM want w
     LEFT JOIN pg_namespace n ON n.nspname = w.schema_name
     LEFT JOIN LATERAL (
       SELECT has_schema_privilege(current_user, w.schema_name, 'USAGE')  AS usage_priv,
              has_schema_privilege(current_user, w.schema_name, 'CREATE') AS create_priv
        WHERE n.oid IS NOT NULL
     ) p ON true
    ORDER BY w.schema_name;
   ```

   The `LATERAL` subquery returns no row when the schema is absent, so `has_schema_privilege` is
   never called on an unknown name and the `LEFT JOIN` leaves the privilege columns NULL.
   `pg_has_role` is strict, so a NULL `nspowner` yields NULL rather than raising.

   **Read `present` first.** For an absent schema record `ABSENT`; its NULL privilege columns are
   **not** evidence of safety. If `supabase_migrations` is absent, Item 11 cannot run and is recorded
   INCONCLUSIVE.

   **3f — backend session marker, START.** *(NEW in v4 — flagged for owner review.)* Record this
   immediately after the gate clears and before Item 1, and record it again after Item 11:

   ```sql
   SELECT pg_backend_pid() AS backend_pid_start,
          now() AT TIME ZONE 'UTC' AS captured_at_utc;
   ```

   The PID is a **non-secret continuity marker only.** It is not proof of project identity, not
   proof of privilege safety, and not proof of read-only enforcement. See the continuity rules
   below.
   **What these six checks establish — and what they do not.**

   They establish, **for the seven named relations only** — the six `public` relations plus
   `supabase_migrations.schema_migrations` — whether the role holds any write privilege, including
   privilege inherited through group roles; whether it is or inherits their owner; whether a
   `SET ROLE` path into a superuser or `BYPASSRLS` role exists; and, for the two schemas Stage A
   touches, whether the role holds schema `CREATE` or is or inherits the schema owner.

   They do **not** establish that the role is read-only in general. Not covered: `SECURITY DEFINER`
   functions, which execute with the definer's privileges; event triggers; every object outside the
   seven named relations and two named schemas; privileges granted to `PUBLIC`; and anything a
   connection pooler or middleware may do on the role's behalf. **Absence of superuser status and
   absence of database-level `CREATE` do not make a role read-only.** This gate is deliberately
   **not** a universal proof that no write path exists anywhere in the database, and must not be
   described as one.

   **Where the enforcement actually comes from.** The database-enforced part of this prerequisite is
   **3b, 3c and 3e**: a role holding no write privilege, owning nothing and holding no schema
   `CREATE` cannot write, whatever it intends. That is a property of the catalog, not of operator
   conduct.

   **`transaction_read_only` is a session safeguard, not that enforcement.** It is set by the
   session on itself: a new transaction is read-write unless `default_transaction_read_only` is on,
   and that parameter is `USERSET`, so any session may turn it off. It therefore protects against
   **accident**, which is worth having and is required — but it must not be described as a
   persistent or non-bypassable guarantee, and **SC-6 alone does not establish database-enforced
   read-only access.** Privilege and transaction mode are two separate things, recorded separately.

   **SC-6's evidentiary meaning, stated precisely.** What must be recorded is that
   `transaction_read_only` was **observed `on` in the actual intended session**, together with which
   session that observation belongs to — the `3f` backend PID. A missing, ambiguous or failed
   observation is STOP or INCONCLUSIVE under the existing gate; it is never assumed from the fact
   that the statement was issued.

   **Backend-session continuity, and its limits.** Record `pg_backend_pid()` at 3f before Item 1 and
   again after Item 11. **The two values must match.** If either observation is missing or fails, or
   the values differ, session continuity is **FAIL / INCONCLUSIVE** and evidence collection stops for
   review. Results from different sessions must never be combined and labelled one session's
   evidence.

   What PID continuity does: it detects a **reconnection** between the gate and the items — which
   would also have silently discarded the read-only transaction and the gate's findings. Within a
   single transaction the PID cannot change, so a match is expected; a mismatch is the signal.

   What it does **not** do: **PID equality does not prove the same target project was used.** Project
   identity must still be verified independently and out-of-band. Nor does it prove privilege safety
   or read-only enforcement.

   **Connection-mode limitation.** In a **transaction-pooling** connection mode, consecutive
   transactions may be served by different backends, so a PID observed at 3f need not belong to the
   backend serving a later statement — and equality, if it occurs, is not evidence of continuity. If
   the connection mode is a transaction pooler, or if the mode cannot be determined, **PID continuity
   is INCONCLUSIVE: stop and refer to the owner or platform administrator.** Use a session-mode or
   direct connection, or record the limitation explicitly. Do not claim continuity the connection
   mode cannot support.

   **Database identity cannot be established from inside the database.** `current_database()` is
   typically `postgres` on this platform and does not distinguish one project from another. No
   in-database query can confirm the project ref. Confirmation of `klkiseupptzbecbxwrky` is
   necessarily **out-of-band**, from the platform console, and must be recorded as such. **Never**
   record or paste host, port, connection strings, credentials or tokens as a substitute.
   **STOP — do not run items 1 through 11 — if any of these holds:**

   - 3a reports `is_superuser = true`, **[v5] or `can_create_roles = true`** — a `CREATEROLE` role can
     grant itself membership in a privileged role, or alter a write-capable role, and so can
     manufacture the escalation path 3d only observes *(scope extension in v5)*;
   - 3a reports `can_create_in_public = true`, **or 3e reports `create_priv = true` for either
     `public` or `supabase_migrations`** *(scope extension in v4: the schema check covers both
     schemas Stage A touches, not only `public`)*;
   - 3b reports `true` for `ins`, `upd`, `del`, `trunc`, `refs` or `trig` on **any** relation —
     **seven relations, including `supabase_migrations.schema_migrations`** *(scope extension in
     v4)*;
   - 3c reports `is_or_inherits_owner = true` for **any** relation — **seven** — **or 3e reports
     `is_or_inherits_schema_owner = true` for either schema** *(v4)* — **or 3a reports
     `is_or_inherits_database_owner = true`**, which is a DDL path outside every table and schema
     ACL *(v5)* — **[v6] or ANY of the three `can_set_role_to_*_owner` columns reports `true`.**
     `pg_has_role(…, 'USAGE')` is false for a **NOINHERIT** member of an owning role, yet such a
     session can `SET ROLE` to that owner and then hold full ownership powers. 3d does not catch it,
     because 3d scans only roles that are `rolsuper` or `rolbypassrls` and an owner need be neither
     *(scope extension in v6)*;
   - 3d returns **any** row;
   - **step 4's read-only transaction cannot be established — meaning
     `transaction_read_only` was not OBSERVED `on` in the actual intended session, or the
     observation is missing, ambiguous or failed.** Issuing the statement is not the evidence; the
     observation is, and it must be recorded against the 3f backend PID. SC-6 alone does not
     establish database-enforced read-only access *(clarification in v4; the condition itself is
     unchanged)*;
   - the project ref cannot be confirmed out-of-band;
   - **3a reports `server_version_num` below `150000`.** Stop here rather than at Item 5: a server
     below PostgreSQL 15 is incompatible with Fix 3's own `FIX3-PRECOND-00`, so the whole Stage A
     applicability assessment is void and running items 1 through 4 first would spend a production
     session establishing nothing. Record **FAIL — server below PostgreSQL 15** and escalate. Item 5
     step 5a restates this gate for operators who reach it by another route.

   **Still eight conditions.** v4 widened three and clarified one; v5 widened two further — SC-1 also
   covers `CREATEROLE`, SC-4 also covers database ownership; **[v6]** SC-4 is widened once more to
   cover a `SET ROLE` path to any relation, schema or database owner. **No ninth stop condition has
   been added and none has been weakened.** Every scope extension and clarification is itemised for
   owner review in `FIX3_V5_FINAL_VALIDATION.md`.

   **[v5] PRECEDENCE — a stop condition always wins.** If any stop condition above holds, Stage A
   does not proceed, **whatever any other part of this package, the operator steps or the result
   template reports as a nominal pass.** A PASS recorded for an individual item never overrides a
   stop condition, and a stop condition is never downgraded because the remaining evidence looks
   complete.

   **[v6] AGGREGATE READINESS — the verdict is the conjunction, not the last answer.** Readiness to
   proceed is derived from **all** mandatory conditions together: all eight stop conditions clear,
   **and** session continuity established, **and** the project ref confirmed out-of-band, **and**
   every evidence item recorded with a verdict. It is never read off the most recent query, the last
   item completed, or the roll-up line alone. If any mandatory condition is STOP, FAIL, UNKNOWN on a
   present object, or INCONCLUSIVE, the aggregate verdict is **not ready**, however many individual
   items recorded PASS.

   **[v7] How the four verdicts enter the conjunction.** `PASS` satisfies a condition. `FAIL` and
   `INCONCLUSIVE` both make the aggregate **not ready**. `NOT APPLICABLE` is **not a PASS**: it is
   admissible only where a specific check's approved semantics define it — **at present that is
   Item 10b alone**, where a lifecycle-CHECK count of 1 or more than 1 means the failable branch is
   not taken. Anywhere else, a result that is neither PASS, FAIL nor a defined NOT APPLICABLE is
   `INCONCLUSIVE`. A `NOT APPLICABLE` **never** overrides, satisfies or downgrades a separate stop
   condition, and never substitutes for evidence a different condition requires.

   **[v8] Where applicability is mandatory or unresolved, `NOT APPLICABLE` is not available.** If a
   check is mandatory, or if whether it applies cannot be established from the evidence actually
   obtained, the disposition is `INCONCLUSIVE`, the aggregate verdict is **not ready**, and the
   condition must be **escalated to the owner or platform administrator** — entered in the result
   template's unresolved-conditions field and raised, not merely filed. Disposing of a check whose
   applicability is unresolved by recording it `NOT APPLICABLE` is the specific failure this rule
   exists to prevent.

   **Separately from the eight — session continuity.** If the 3f start PID and the post-Item-11 PID
   are missing, fail, or differ, session continuity is **FAIL / INCONCLUSIVE**: stop evidence
   collection for review. Do not combine results from different sessions. In a transaction-pooling
   connection mode this evidence is INCONCLUSIVE by construction — refer to the owner or platform
   administrator.

   **A NULL, absent or errored result is never a pass.** If a relation's or schema's `present` flag is
   false, record it `ABSENT`; if a privilege or ownership column is NULL, record it `UNKNOWN`; if a
   query errors or returns no interpretable row, record it `INCONCLUSIVE`. **[v5] An `UNKNOWN` on a
   relation or schema that IS present is itself a STOP** — it means a required property could not be
   established, which is not the same as establishing that it is absent. None of `ABSENT`, `UNKNOWN`
   or `INCONCLUSIVE` may be read as "no write privilege". If `supabase_migrations` or its ledger
   relation is absent, Item 11 is INCONCLUSIVE and that is recorded, not inferred away.
   INCONCLUSIVE and that is recorded, not inferred away.
   A separate, narrower condition: if 3b reports `sel = false` for a relation an item needs, that
   item's result is **incomplete rather than unsafe**. Record that item INCONCLUSIVE and continue;
   it is not a reason to end the session.

   **There is no discipline-only route.** By owner decision, a database-enforced read-only session is
   required and assurance resting on operator discipline is **not accepted as a substitute**. If the
   available session cannot clear every stop condition above, **Stage A remains BLOCKED.**
   Provisioning a compliant role is an owner-operated access-provisioning task, outside the scope of
   this package; it is not described, scripted or authorized here. Do not weaken this gate to make
   the procedure executable.

   If every stop condition is clear, do **not** write "read-only verified". Record what step 3's
   stop-condition list establishes, field by field, against the read-only gate block of the result
   template in section 6. **That list is authoritative and is not restated here** — read it
   directly, every time. Record `transaction_read_only` as **observed `on` in this session**, which
   is a **session safeguard and not a database-enforced guarantee**, and record the project ref as
   confirmed out-of-band. That is what was established, and no more. **[v8]**

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

- **any stop condition in preamble step 3 is triggered.** That list is **authoritative and is not
  restated here** — restating it is how two stale copies came to exist, one claiming six relations
  and one calling the read-only transaction "database-enforced". **[v7]** Read step 3's list
  directly, every time, and record against it.
- the target cannot be confirmed by project ref, **out-of-band from the platform console** — no
  in-database query can establish it;
- a read-only transaction cannot be **observed** `on` in the intended session — `SET TRANSACTION
  READ ONLY` unavailable, or silently reset by the client between statements. **[v7]** This is a
  **session safeguard**, not a database-enforced guarantee; the enforcement is the absence of
  privilege and ownership established by 3b, 3c, 3e and 3a;
- session continuity cannot be established, or the connection mode makes it meaningless;
- any statement errors in a way that suggests it did something other than read;
- any output would require pasting a secret or row payload to be meaningful.

**By owner decision there is no discipline-only fallback.** If any condition above holds, Stage A
stays BLOCKED until a compliant, database-enforced read-only session is provisioned and
independently verified. That provisioning is an owner-operated task outside this package.

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

**Objects.** `pg_class.relacl` expanded with `aclexplode`, `acldefault`, `pg_roles`,
`pg_auth_members`. **Not** `information_schema.role_table_grants` — see the limitations below for
why that view was replaced.

**Step 1a — the ACL itself, from the catalog.** `pg_class` is world-readable, so this is not
filtered by what the inspecting role happens to be a member of. `acldefault('r', relowner)`
materialises the *implicit* ACL for a relation whose `relacl` is NULL, so the default case is
reported rather than looking like an empty result:

```sql
SELECT c.relname                                   AS table_name,
       c.relowner::regrole::text                   AS owner,
       (c.relacl IS NULL)                          AS acl_is_default,
       a.grantee::regrole::text                    AS grantee,
       a.privilege_type                            AS privilege,
       a.is_grantable
  FROM pg_class c
  LEFT JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a ON true
 WHERE c.relnamespace = 'public'::regnamespace
   AND c.relname IN ('content_quality','content_block','content_recommendation',
                     'content_approval_history','content','user_company_roles')
 ORDER BY c.relname, grantee, privilege;
```

A `grantee` of `-` is **PUBLIC** (grantee OID 0). `acl_is_default = true` means no explicit grant
was ever made and the owner alone holds privileges — that is a positive finding, **not** an empty
result, and `acldefault` is what makes it visible.

**Step 1b — role memberships that confer those grants.** An ACL entry naming a group role grants to
every `INHERIT` member of it, which step 1a does not show:

```sql
SELECT r.rolname                     AS role_name,
       r.rolinherit                  AS inherits,
       m.rolname                     AS member_of
  FROM pg_roles r
  LEFT JOIN pg_auth_members am ON am.member = r.oid
  LEFT JOIN pg_roles m        ON m.oid = am.roleid
 WHERE r.rolname IN ('anon','authenticated','service_role','authenticator')
    OR m.rolname IN ('anon','authenticated','service_role','authenticator')
 ORDER BY 1, 3;
```

**Step 1c — schema reachability.** A table grant is unusable without `USAGE` on its schema, and
`CREATE` on `public` is a write capability in its own right:

```sql
SELECT r.rolname,
       has_schema_privilege(r.rolname, 'public', 'USAGE')  AS usage_on_public,
       has_schema_privilege(r.rolname, 'public', 'CREATE') AS create_on_public
  FROM pg_roles r
 WHERE r.rolname IN ('anon','authenticated','service_role')
 ORDER BY 1;
```

**Expected columns.** As named in each step. Step 1a may return several rows per table, one per
(grantee, privilege) pair.

**PASS.** Steps 1a-1c ran, and the grant surface is explicable: the role(s) the application
authenticates as hold the privileges the application needs, and nothing more than the deployment
intends.
**FAIL.** A Fix 3 table is reachable by a role that should not reach it — most importantly `anon`,
whether directly or through a membership shown in step 1b — or `create_on_public` is true for
`anon` or `authenticated`.
**INCONCLUSIVE.** Any step did not run or errored; or step 1b cannot enumerate memberships; or a
relation is absent, in which case its ACL question does not yet arise. **Note what is NOT
inconclusive:** `acl_is_default = true` is a determinate finding (owner-only privileges), and a
table with no non-owner ACL entry is a determinate finding too. Neither may be recorded as
"no grants visible, therefore unknown".

**Minimization.** Role names, privilege names and booleans only. No table data, no row payloads.

**Limitations — read these before drawing a conclusion.**

- **Why the instrument changed.** `information_schema.role_table_grants` shows only privileges
  *where a currently enabled role is the grantor or the grantee*. Under the restricted read-only
  role this package requires, grants to `authenticated` or `service_role` can be **invisible**, and
  the view would return a short result that reads like "no grants exist" — silently, with no error.
  Phase 96 ran the equivalent query as a superuser that owned and had granted everything, so it saw
  everything; a restricted role will not. The catalog ACL is not filtered that way, which is why it
  replaces the view. **Do not equate absence of visible ACL entries with absence of effective
  privileges.**
- **ACL inspection alone cannot establish a read-only guarantee.** A **superuser bypasses all
  privilege checks and appears in no ACL at all**, and an owner's implicit privileges are not ACL
  entries either. That is precisely why the preamble's gate (steps 3a-3d) checks role attributes,
  effective privilege via `has_table_privilege`, ownership and escalation paths separately. This
  item describes the *application's* grant surface; it is not, and must not be read as, evidence
  about the inspecting session.
- **Grants are necessary but not sufficient for visibility.** A role may hold `SELECT` and still see
  no rows because of RLS. This item says nothing about row visibility — that is items 2, 3 and 4,
  and even together they establish configuration rather than runtime behavior.
- **Column- and default-privilege layers are out of scope.** Column-level ACLs
  (`pg_attribute.attacl`) and `pg_default_acl` are not inspected. If a finding here looks
  inconsistent with observed application behavior, those are the next places to look, under separate
  authorization.

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

**Objects.** `pg_constraint`, `pg_class`, `pg_attribute`, plus the `server_version_num` recorded in
preamble step 3a.

**Step 5a — version gate. Evaluate this BEFORE running step 5b.**

`pg_constraint.confdelsetcols` exists only in **PostgreSQL 15 and later**. On an earlier server the
column reference fails at parse time with `42703 column does not exist`, and the item returns
nothing at all rather than a partial result.

Use `server_version_num` from preamble step 3a, or read it again:

```sql
SELECT current_setting('server_version')                       AS server_version,
       current_setting('server_version_num')                   AS server_version_num,
       (current_setting('server_version_num')::int >= 150000)  AS pg15_or_later;
```

**If `pg15_or_later` is false: do not run step 5b. Record Item 5 as FAIL — server below PostgreSQL
15 — and STOP the Stage A applicability assessment.**

That is a deliberate stop rather than a workaround, and the reason is larger than this item.
Fix 3's own `FIX3-PRECOND-00` refuses to apply below `150000`, because both `ON DELETE SET NULL`
with a column list and the `confdelsetcols` catalog column require PostgreSQL 15. A sub-15 target is
therefore **incompatible with the migration itself**, not merely awkward to inspect. Escalate it.

**Do not omit the `confdelsetcols` column and report a pass.** A result produced without it would be
missing exactly the evidence that distinguishes `ON DELETE SET NULL (content_id)` from a bare
`SET NULL` — the property `content_approval_history_content_fk` depends on — and would therefore
look like a pass while establishing nothing about the one FK whose delete action matters most.

**Step 5b — the constraint inspection (PostgreSQL 15 or later only).**

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
are `smallint[]`, so they can be `unnest`ed with ordinality to recover **column order** — which a
bare definition string does not let you compare mechanically. The `confdelsetcols` version
requirement is handled by step 5a above; do not run this query without clearing that gate first.

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

**Objects.** Catalog metadata for step 9a; the five tables themselves for step 9b. Item 9 and
Item 10 are the two items that read user tables rather than catalogs; Item 9 is the only one that
reads them for a **count**, and it reads no column values.

**Step 9a — establish existence first, from catalog metadata only.** This statement always succeeds,
whatever exists: `to_regclass` returns `NULL` for an absent relation rather than raising. That is the
same absence-detection idiom the Fix 3 migration itself uses in 28 places.

```sql
SELECT v.table_name,
       (to_regclass('public.' || v.table_name) IS NOT NULL) AS present,
       (SELECT c.relkind::text
          FROM pg_class c
         WHERE c.oid = to_regclass('public.' || v.table_name)) AS relkind
  FROM (VALUES ('content_quality'),
               ('content_block'),
               ('content_recommendation'),
               ('content_approval_history'),
               ('content')) AS v(table_name)
 ORDER BY v.table_name;
```

All five names appear in the output, each with `present` true or false. Record this table **first**:
it determines what step 9b may run, and which migration path applies.

**Step 9b — exact counts. Run each statement SEPARATELY, and only for tables step 9a reported
present.**

> **Do not paste these five statements as one batch.** In PostgreSQL's simple query protocol a
> multi-statement string is **parsed in full before any statement executes**, so a single absent
> relation makes the whole batch fail with `42P01` and returns nothing at all — which is the exact
> failure this two-step design exists to prevent. Each statement therefore has its own block below.
> Run them one at a time. Skip any table step 9a reported absent; do not run it "to see what
> happens".

For `public.content_quality` — only if step 9a reported it present:

```sql
SELECT 'content_quality' AS table_name, count(*) AS exact_rows FROM public.content_quality;
```

For `public.content_block` — only if present:

```sql
SELECT 'content_block' AS table_name, count(*) AS exact_rows FROM public.content_block;
```

For `public.content_recommendation` — only if present:

```sql
SELECT 'content_recommendation' AS table_name, count(*) AS exact_rows FROM public.content_recommendation;
```

For `public.content_approval_history` — only if present:

```sql
SELECT 'content_approval_history' AS table_name, count(*) AS exact_rows FROM public.content_approval_history;
```

For `public.content` — only if present:

```sql
SELECT 'content' AS table_name, count(*) AS exact_rows FROM public.content;
```

**Why five statements rather than one `UNION ALL`.** A single static statement that names an absent
relation fails at parse time with `42P01` and returns **nothing at all** — not a partial result. One
absent table would therefore destroy the counts for every table that does exist. That is not an edge
case: Phase 96 established that the committed production-shaped baseline contains `public.content`
but **none of the four Fix 3 tables**, so on the most likely target state the old single-statement
form yielded no data whatsoever. Separate statements fail independently, and step 9a means none of
them should fail at all.

**No dynamic SQL, and no temporary objects.** A `DO` block cannot return a result set; making it
return one requires a temporary table, which is a **write** and would violate the read-only
transaction. The two-step shape above avoids both.

**Recording rule — absence is never zero.** For each of the five, record exactly one of:

| Step 9a `present` | Step 9b | Record as |
|---|---|---|
| `false` | not run | **`ABSENT`** |
| `true` | returned a count | that number, including **`0`** when the table exists and is empty |
| `true` | not run, or errored | **`INCONCLUSIVE`**, with the reason |

`ABSENT` and `0` are different findings and must never be collapsed into one another. `ABSENT` means
the object does not exist, so Fix 3 would **create** it. `0` means the object exists and holds no
rows, so Fix 3 would **reconcile** it — against no data.

**Which migration path the result implies:**

| Step 9a outcome | Path |
|---|---|
| all four Fix 3 tables `ABSENT`, `content` present | **CREATE path** — exercised and verified in Phase 96 |
| all four present | **RECONCILE path**, or already applied. Items 5 to 8 decide which; item 9 cannot |
| some present, some absent | **MIXED — escalate.** No phase has exercised this state; do not infer a path from it |
| `content` absent | **escalate immediately** — a far larger finding than this item |
| step 9a not run | **INCONCLUSIVE** — no path may be inferred |

**Zero-cost alternative** if a sequential scan is unwelcome on a busy system. Agree the substitution
in advance and record which variant produced the numbers. It lists all five names, including absent
ones, so nothing is silently omitted:

```sql
SELECT v.table_name,
       (to_regclass('public.' || v.table_name) IS NOT NULL) AS present,
       c.reltuples::bigint                                   AS estimated_rows,
       s.last_analyze,
       s.last_autoanalyze
  FROM (VALUES ('content_quality'),
               ('content_block'),
               ('content_recommendation'),
               ('content_approval_history'),
               ('content')) AS v(table_name)
  LEFT JOIN pg_class c            ON c.oid = to_regclass('public.' || v.table_name)
  LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
 ORDER BY v.table_name;
```

**Reading the estimate — three values that are not row counts:**

- `present = false` → the table is **`ABSENT`**. `estimated_rows` will be NULL; **do not read NULL as
  0.**
- `estimated_rows = -1` → **`UNKNOWN (reltuples = -1)`**, not zero. Since PostgreSQL 14 a relation
  that has never been vacuumed or analyzed carries `reltuples = -1` precisely so that "no statistics"
  is distinguishable from "no rows". The target is PostgreSQL 15 or later, so this value is
  reachable. Record it as unknown and note that no exact count was taken.
- `estimated_rows = 0` with a non-null `last_analyze` or `last_autoanalyze` → genuinely empty, as of
  that timestamp.

An estimate is never evidence for the lock analysis in section 5 at the precision an exact count
gives. If the counts matter to an apply decision, take the exact counts in a quiet window.

**Expected columns.** Step 9a: `table_name`, `present`, `relkind`. Step 9b: `table_name`,
`exact_rows`. Estimated variant: `table_name`, `present`, `estimated_rows`, `last_analyze`,
`last_autoanalyze`.

**PASS.** Step 9a ran and returned all five names, and every table it reported present has either an
exact count or an explicitly recorded estimate. It is recorded which variant produced the numbers.
**FAIL.** Not applicable — this item gathers facts rather than testing a condition. The one
exception to escalate rather than record: `content` reported absent.
**INCONCLUSIVE.** Step 9a could not be run; or a table step 9a reported present was not counted or
errored in step 9b; or the exact counts were abandoned as too slow and no estimate was taken.
**A table reported `ABSENT` by step 9a is NOT inconclusive** — it is a positive, determinate finding,
recorded as `ABSENT` and never as zero, and it is what distinguishes the CREATE path from the
RECONCILE path.

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


#### ITEM 10b — lifecycle-CHECK data condition

**Purpose.** Item 10 above predicts the `23503` foreign-key abort class. This sub-item predicts the
**only other data-dependent abort** Fix 3 can suffer: STEP 6 can **add** the lifecycle CHECK, which
validates every `public.content` row synchronously and aborts with **`23514`** — a different
SQLSTATE, and like `23503` carrying **no `FIX3-*` code** for the operator to look up.

It is a sub-item of Item 10 rather than a twelfth item, because both predict data-dependent aborts
and because the package's eleven-item structure and `Items PASS: ___ / 11` roll-up are unchanged. It
is deliberately **not** folded into Item 6, which inspects a constraint *definition* and has
different PASS criteria.

**Objects.** `pg_class` and `pg_attribute` and `pg_constraint` for step 10b-1; `public.content` for
step 10b-2, and only in one branch.

**Which migration branch this covers.** STEP 6 of
`20261212000000_content_quality_collaboration_tenant_consistent.sql` has ten reachable outcomes. Two
issue DDL that scans `public.content`; **exactly one of them can reject a row**:

| Condition | Outcome | Scans? | Can fail `23514`? | Line |
|---|---|---|---|---|
| `public.content` absent | refuses `FIX3-LIFE-01` | no | no | `:2410-2412` |
| `lifecycle_status` absent | refuses `FIX3-LIFE-01` | no | no | `:2416-2418` |
| more than one CHECK covers the column | refuses `FIX3-LIFE-02` | no | no | `:2428-2432` |
| **no CHECK covers the column** | **`ADD CONSTRAINT … CHECK` (nine values)** | **yes** | **YES** | `:2434-2450`, ADD at `:2445-2447` |
| one CHECK, nine-value form, validated | LEFT UNCHANGED — no DDL, no revalidation scan | no | no | `:2493-2496` |
| one CHECK, eight-value predecessor | DROP + ADD nine-value | yes | **no** | `:2498-2520` |
| one CHECK, key count ≠ 1 | refuses `FIX3-LIFE-03` | no | no | `:2456-2462` |
| one CHECK, `NOT VALID` | refuses `FIX3-LIFE-04` | no | no | `:2463-2466` |
| one CHECK, unsupported definition form | refuses `FIX3-LIFE-07` | no | no | `:2482-2488` |
| one CHECK, supported form, unrecognised elements | refuses `FIX3-LIFE-05` | no | no | `:2522-2524` |

**Why the eight-to-nine replacement cannot fail, although it scans.** Nine values is a strict
superset of the eight, and `FIX3-LIFE-04` has already refused if the existing CHECK were
`NOT VALID`. Every surviving row therefore provably satisfies the eight values and so satisfies the
nine. It costs scan time, which matters to section 5's lock analysis, but it cannot reject a row.

---

**Step 10b-1 — which branch applies.** This replicates the migration's own branch test rather than
paraphrasing it: `to_regclass` at `:2392`, the column resolution with `attnum > 0 AND NOT
attisdropped` at `:2413-2415`, and `contype = 'c' AND a_life = ANY (conkey)` at `:2425-2426`.
It always returns exactly one row, whatever exists.

```sql
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

`to_regclass` returns NULL for an absent relation instead of raising, so this statement cannot error
on a missing table — unlike a bare `'public.content'::regclass` cast, which raises `42P01`. The
`CASE` has no `ELSE`, so the count is **NULL, not 0,** when the relation or the column is absent.
That distinction is load-bearing: `0` means "no CHECK covers the column"; `NULL` means "the question
could not be asked".

**Step 10b-2 — the data check. Run this if and only if step 10b-1 returned
`checks_covering_lifecycle_status = 0`.** In every other case the migration performs no failable DDL
on `public.content`, and running this would be a pointless sequential scan of a production table.

```sql
SELECT c.lifecycle_status,
       count(*) AS row_count
  FROM public.content c
 WHERE c.lifecycle_status NOT IN ('draft','generated','edited','approved','adapted',
                                  'scheduled','published','archived','quality_reviewed')
 GROUP BY c.lifecycle_status
 ORDER BY row_count DESC, c.lifecycle_status;
```

The nine literals are those the migration adds at `:2446` — identical to `:2516` — and were copied
from the migration rather than reconstructed.

**Why there is no `IS NULL` branch, and why that is correct rather than an omission.** A `CHECK`
rejects a row only when its expression evaluates to **FALSE**; `NULL` does not violate it. For a NULL
`lifecycle_status`, `NOT IN (…)` evaluates to NULL, so the row is excluded here — which matches the
constraint's own behavior exactly. Adding `OR c.lifecycle_status IS NULL` would manufacture false
positives, reporting rows that could never abort the migration. (The committed baseline shows the
column as NOT NULL with default `'draft'`; that is baseline-derived, **not** live-verified, and the
predicate is correct either way.)

**Read-only.** Both steps are bare `SELECT`s. No `DO` block, no temporary object, no DDL, no write,
no dynamic SQL, no `SET ROLE`. Step 10b-2 takes `AccessShareLock` and performs a sequential scan,
which blocks nothing.

**Expected columns.** 10b-1: `content_present`, `lifecycle_column_present`,
`checks_covering_lifecycle_status`. 10b-2: `lifecycle_status`, `row_count`.

**Verdicts.**

| 10b-1 result | 10b-2 | Verdict | Meaning |
|---|---|---|---|
| count = **0**, 10b-2 returns **zero rows** | run | **PASS** | STEP 6 will add the CHECK and no existing row can reject it, as of this moment |
| count = **0**, 10b-2 returns **rows** | run | **FAIL — stop and escalate** | each listed value aborts STEP 6 with `23514`. Remediation is a data change and is authorized by no phase |
| count = **1** | **not run** | **NOT APPLICABLE** | STEP 6 either changes nothing or performs the superset replacement; neither can reject a row |
| count **> 1** | **not run** | **NOT APPLICABLE** | the migration refuses at `FIX3-LIFE-02` before touching data |
| count = **NULL** with `content_present` false | not run | **INCONCLUSIVE — stop and escalate** | `public.content` is absent, a far larger finding than this sub-item; the migration refuses at `FIX3-LIFE-01` |
| count = **NULL** with `lifecycle_column_present` false | not run | **INCONCLUSIVE — stop and escalate** | the column is absent or dropped; the migration refuses at `FIX3-LIFE-01`, contradicting `FIX3-PRECOND-15` |
| 10b-1 not run, errored, or returned anything other than one interpretable row | not run | **INCONCLUSIVE — stop and escalate** | do not infer the branch, and do not run 10b-2 speculatively |
| 10b-2 errored or was abandoned | — | **INCONCLUSIVE — stop and escalate** | an unknown or failed query is never recorded as PASS |

**`NOT APPLICABLE` is not a pass for Item 6, and must never be recorded as one.** A count of 1 means
only that *this* sub-item has nothing to find. Which sub-branch actually applies — nine-value
validated, eight-value predecessor, or one of the four refusals `FIX3-LIFE-03/04/05/07` — is
established by **Item 6**, and three of those outcomes are refusals that would stop the migration.
Record 10b as `NOT APPLICABLE` and read Item 6 on its own terms.

Equally, a 10b **PASS** excludes one abort class at one instant. It does not authorize application,
and it says nothing about the `23503` class Item 10 covers or about the roughly 95 other `FIX3-*`
guard conditions.

**Minimization.** 10b-1 returns two booleans and one integer. 10b-2 returns distinct
`lifecycle_status` values — a controlled vocabulary plus any outliers — and counts. No row
identifiers, no free text, no personal data, no payloads. If outlier vocabulary values are themselves
considered sensitive, `SELECT count(*)` over the same `WHERE` answers the go/no-go question while
losing the ability to name what needs remediation; decide that before the session, not during it.

**Limitations.**

- **Time-of-check only.** A row written between 10b-2 and the apply reintroduces the exposure. Run it
  immediately before any future authorized application, in the same window as Item 10.
- **One abort class.** It predicts `23514` from STEP 6's no-existing-CHECK branch and nothing else.
- **It predicts the migration's branch; it does not execute it.** The migration evaluates its own
  state at apply time, and that state can change in between.
- **Item 6 remains the authority on the constraint's definition.** 10b-1 counts covering
  constraints; it does not inspect their definitions.
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
Read-only mechanism used:               ____________________________________________
server_version_num (3a; Item 5 needs it): ____________________
Project ref confirmed out-of-band from the console: ____   (no in-SQL substitute; never paste host, port or connection strings)
Read-only gate — seven relations, two schemas, and database-level powers; all must be clear:
  3a is_superuser ____  can_create_roles ____ [v5]  can_create_in_public ____  bypasses_rls ____
3a database_owner-inherited ____   can_set_role_to_database_owner ____ [v7]
  3b any write priv (ins/upd/del/trunc/refs/trig) on any of the seven: ____
     of which `supabase_migrations.schema_migrations`: present ____  write priv ____
3c is_or_inherits_owner on any of the seven ____   can_set_role_to_owner on any ____ [v7]
3e public:              present ____ create_priv ____ owner-inherited ____ can_set_role ____ [v7]
3e supabase_migrations: present ____ create_priv ____ owner-inherited ____ can_set_role ____ [v7]
  Fail-closed: ABSENT / UNKNOWN / INCONCLUSIVE are NOT passes. UNKNOWN on a PRESENT
  relation or schema is itself a STOP. A stop condition overrides any nominal pass elsewhere.
SC-6 transaction_read_only OBSERVED `on` in this session: ____   (observation, not merely issued)
Session continuity (L-5):
  3f backend_pid_start: ____________   post-Item-11 backend_pid_end: ____________
  match?  [ ] yes  [ ] no -> FAIL/INCONCLUSIVE, stop for review
  connection mode: [ ] session/direct  [ ] transaction pooler -> INCONCLUSIVE by construction  [ ] unknown -> INCONCLUSIVE
  PID equality does NOT prove the same target project; see the out-of-band ref check above.
Preflight query version:                Phase 96 section F, sha256 e02bfecd0a16729f (first 16)
AGGREGATE READINESS [v7] — fill LAST, derived from every mandatory condition above:
  all eight stop conditions clear? ____   session continuity established? ____
  project ref confirmed out-of-band? ____   every item recorded with a verdict? ____
  AGGREGATE VERDICT:  [ ] READY to proceed   [ ] NOT READY
  NOT READY if any of the above is no, or any mandatory result is STOP / FAIL /
  UNKNOWN-on-present / INCONCLUSIVE — however many items recorded PASS.
  Rationale for this verdict — required for READY and for NOT READY [v8]:
    ______________________________________________________________________
    ______________________________________________________________________
  Unresolved conditions — list every STOP / FAIL / UNKNOWN-on-present /
  INCONCLUSIVE, and every mandatory check whose applicability could not be
  established; write NONE only if there are none [v8]:
    ______________________________________________________________________
    ______________________________________________________________________
  Escalated to, and when — required if any condition above is unresolved [v8]:
    ______________________________________________________________________

--- ITEM <n> ---
Evidence ID:          <1..11>
Executed at (UTC):    ____________________
Query/procedure:      as published in this document, item <n>   [ ] unmodified   [ ] modified (attach)
Exit status:          [ ] ok   [ ] error (quote the message, redacted)
Result summary:       ____________________________________________________________
Verdict:              [ ] PASS   [ ] FAIL   [ ] INCONCLUSIVE
Item 10 ONLY — sub-item 10b (lifecycle-CHECK data condition):
  10b-1 content_present: ____   lifecycle_column_present: ____
  10b-1 checks_covering_lifecycle_status: ____   ( 0 | 1 | >1 | NULL )
  10b-2 run?  [ ] yes   [ ] no — not applicable       rows returned: ____
  10b verdict: [ ] PASS  [ ] FAIL  [ ] NOT APPLICABLE  [ ] INCONCLUSIVE
    NOT APPLICABLE for 10b does NOT establish that Item 6 passes — read Item 6 separately.
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

**Stage A remains BLOCKED until the owner provisions and independently verifies a dedicated,
database-enforced read-only session that clears every stop condition in preamble step 3, and then
reviews the resulting evidence. By owner decision, assurance resting on operator discipline is NOT
accepted as a substitute for a database-enforced guarantee.**

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
