# FIX 3 — STAGE A READ-ONLY ACCESS PREREQUISITE

**For the owner.** What must be provisioned and independently verified before Fix 3 Stage A may run,
and how compliance with the v3 package's eight stop conditions will be evidenced.

Static review only. No production access, no database connection, no SQL executed or parsed, no role
provisioned, no privilege changed, no Stage A run, no commit.

---

## 1. DISPOSITION

**READY FOR OWNER VERIFICATION**

The checklist below is complete and reproduces all eight stop conditions faithfully. **The actual
session has not been provisioned and has not been independently verified**, so this is not
`READY FOR STAGE A`. Six limitations are recorded in §4; two of them are recommendations that would
change the v3 package and therefore need owner approval.

Documentation, a proposed role, a console screenshot or an operator assurance **cannot** move this to
`READY FOR STAGE A`. That requires evidence from the actual intended session.

### Verified sources

| Artifact | SHA-256 | Status |
|---|---|---|
| `docs/security/FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED_V3.md` | `27680e1e70a24facc70b68fc7e17f7118e389f055d7ed3a5bd226d65fbb3b423` | verified, unchanged |
| `docs/security/FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED_V3.md` | `3749c93633524669b8f6b28316d16edef7124d7762754b47b84dfac959af3a4d` | verified, unchanged |
| `docs/security/FIX3_D3_ITEM10B_ADOPTION.md` | `217817551d3dc3d9a9104109ae29e7a327aa6a71d4d6bed4bae6397659857a36` | verified, unchanged |

No path or hash differed. Nothing was recreated or overwritten.

---

## 2. THE EIGHT STOP CONDITIONS

Reproduced from the v3 package's section 1, step 3, **in source order and without alteration**. Each
is quoted, then expanded. No ninth condition is introduced and none is weakened.

The gate's own queries are 3a (role attributes), 3b (effective write privilege via
`has_table_privilege`), 3c (ownership via `pg_has_role`), 3d (escalation paths). Its privilege scope
is six relations: `content_quality`, `content_block`, `content_recommendation`,
`content_approval_history`, `content`, `user_company_roles`.

### SC-1 — *"3a reports `is_superuser = true`"*

| | |
|---|---|
| **Establish** | the session's role is not a PostgreSQL superuser |
| **Evidence** | `pg_roles.rolsuper` for `current_user`, from gate query 3a |
| **Who verifies** | the owner, or a delegate who is not the person who provisioned the role |
| **Clear pass** | `is_superuser = false` |
| **STOP** | `true` — a superuser bypasses every privilege check, so no other condition can constrain it |
| **Out-of-band?** | no — in-session evidence |

Note: `rolsuper` is a role **attribute** and is **not** inherited through membership, so a `false`
here does not exclude the escalation path SC-5 covers.

### SC-2 — *"3a reports `can_create_in_public = true`"*

| | |
|---|---|
| **Establish** | the session cannot create objects in schema `public` |
| **Evidence** | `has_schema_privilege(current_user, 'public', 'CREATE')`, from 3a |
| **Who verifies** | owner or delegate |
| **Clear pass** | `can_create_in_public = false` |
| **STOP** | `true` — schema `CREATE` is a write capability in its own right |
| **Out-of-band?** | no |

### SC-3 — *"3b reports `true` for `ins`, `upd`, `del`, `trunc`, `refs` or `trig` on **any** relation"*

| | |
|---|---|
| **Establish** | the session holds **no** write privilege on any of the six relations, **including privilege inherited through group roles** |
| **Evidence** | gate query 3b, six `has_table_privilege` probes per relation. This function accounts for privileges held via role membership, which 3a cannot see |
| **Who verifies** | owner or delegate |
| **Clear pass** | all six columns `false` for all six relations |
| **STOP** | any `true` |
| **Out-of-band?** | no |

**This, with SC-4, is the actual database-enforced guarantee.** See §3.

### SC-4 — *"3c reports `is_or_inherits_owner = true` for **any** relation"*

| | |
|---|---|
| **Establish** | the session is not, and does not inherit, the owner of any of the six relations |
| **Evidence** | gate query 3c, `pg_has_role(current_user, c.relowner, 'USAGE')` |
| **Who verifies** | owner or delegate |
| **Clear pass** | `false` for all six |
| **STOP** | any `true` — an owner may `ALTER` or `DROP` regardless of granted privileges, and ownership does not appear as an ACL entry |
| **Out-of-band?** | no |

### SC-5 — *"3d returns **any** row"*

| | |
|---|---|
| **Establish** | there is no `SET ROLE` path from this role into any superuser or `BYPASSRLS` role |
| **Evidence** | gate query 3d, `pg_has_role(current_user, r.oid, 'MEMBER')` over roles with `rolsuper OR rolbypassrls` |
| **Who verifies** | owner or delegate |
| **Clear pass** | zero rows |
| **STOP** | any row — membership permits escalation whatever SC-1 reported |
| **Out-of-band?** | no |

`MEMBER` rather than `USAGE` is the right test: it catches a `NOINHERIT` role that can still
`SET ROLE` into a privileged one.

### SC-6 — *"step 4's read-only transaction cannot be established"*

| | |
|---|---|
| **Establish** | the work runs inside a read-only transaction |
| **Evidence** | `BEGIN; SET TRANSACTION READ ONLY;` and `current_setting('transaction_read_only')` reported `on` in 3a |
| **Who verifies** | owner or delegate |
| **Clear pass** | `txn_read_only = on` in the same session that then runs items 1-11 |
| **STOP** | cannot be set, or is silently reset by the client between statements |
| **Out-of-band?** | no |

**Flagged as ambiguous — see §4, L-1.** The wording "cannot be established" does not define whether
*established* means issued, observed `on`, or guaranteed to persist. The three differ materially.

### SC-7 — *"the project ref cannot be confirmed out-of-band"*

| | |
|---|---|
| **Establish** | the session is connected to the intended database — project ref `klkiseupptzbecbxwrky` |
| **Evidence** | visual confirmation from the platform console. **The v3 package states plainly that no in-database query can establish this**: `current_database()` is typically `postgres` on this platform and does not distinguish projects |
| **Who verifies** | the owner, from the console, recording that the check was visual and out-of-band |
| **Clear pass** | the ref is confirmed and recorded as out-of-band |
| **STOP** | the ref cannot be confirmed |
| **Out-of-band?** | **YES — irreducibly.** See §4, L-4 |

### SC-8 — *"3a reports `server_version_num` below `150000`"*

| | |
|---|---|
| **Establish** | the server is PostgreSQL 15 or later |
| **Evidence** | `current_setting('server_version_num')` from 3a |
| **Who verifies** | owner or delegate |
| **Clear pass** | `>= 150000` |
| **STOP** | below `150000`. Record **FAIL — server below PostgreSQL 15** and escalate: `FIX3-PRECOND-00` refuses below that, so the target is incompatible with the migration itself and the whole applicability assessment is void |
| **Out-of-band?** | no |

### The narrower, non-stop condition — preserved verbatim in meaning

The v3 package adds, separately from the eight: *"if 3b reports `sel = false` for a relation an item
needs, that item's result is **incomplete rather than unsafe**. Record that item INCONCLUSIVE and
continue; it is not a reason to end the session."* This is **not** a ninth stop condition and must
not be treated as one.

### And the standing rule

*"There is no discipline-only route."* By owner decision, a database-enforced read-only session is
required and assurance resting on operator discipline is **not** accepted as a substitute.

---

## 3. WHAT THE GATE DOES AND DOES NOT ESTABLISH

Seven distinctions, kept separate because conflating them is how a session gets called read-only
when it is not.

| Distinction | Where it lands |
|---|---|
| **Database-enforced behavior vs operator promise** | SC-3 and SC-4 are enforced by the database: absent privilege and absent ownership cannot be waived by intent. SC-6 is a *control the session sets on itself* — see L-2 |
| **Effective table privileges vs role attributes** | SC-1/SC-2 read attributes; SC-3 reads **effective** privilege including inheritance. A role clean on attributes can hold full write access through a group role, which only SC-3 catches |
| **Ownership and inherited membership vs direct ACL entries** | SC-4 covers ownership, which appears in **no** ACL. Item 1's ACL inspection describes the *application's* grant surface and is not evidence about the inspecting session |
| **Role escalation vs ordinary membership** | SC-5 tests membership only in roles that are `rolsuper` or `rolbypassrls`. Ordinary membership is not an escalation path and is not flagged |
| **Database identity vs what SQL returns** | SC-7 is out-of-band by necessity. No query establishes the project ref |
| **Six-relation scope vs uncovered paths** | SC-3/SC-4 cover six relations. The package itself discloses what is not covered: `SECURITY DEFINER` functions, event triggers, **every object outside the six**, privileges granted to `PUBLIC`, and pooler or middleware behavior |
| **Catalog visibility vs proof that no write path exists** | the gate proves the *absence of specific privileges on specific objects*. It does not enumerate every write path in the database |

**Four `SELECT` statements do not prove a session read-only, and the v3 package does not claim they
do.** Its own words: they establish, *"for the six named relations only"*, absence of write
privilege, absence of ownership, and absence of a superuser escalation path — and *"do not establish
that the role is read-only in general."* That wording is accurate and is the standard this checklist
holds to.

---

## 4. LIMITATIONS AND AMBIGUITIES

### L-1 — SC-6's "established" is undefined *(ambiguity — owner clarification requested)*

Quoted wording: *"step 4's read-only transaction cannot be established"*.

Three readings differ materially: (a) the operator **issued** `SET TRANSACTION READ ONLY`;
(b) `current_setting('transaction_read_only')` was **observed** `on`; (c) read-only mode is
**guaranteed to persist** across every statement of the session. Reading (b) is evidenceable and is
what this checklist asks for. Reading (c) is not achievable — see L-2. **Please confirm (b) is
intended.**

### L-2 — SC-6 is accident protection, not enforcement against a cooperating operator

A transaction's read-only mode is set **by the session**. A new transaction is read-write unless
`default_transaction_read_only` is on, and that parameter is `USERSET` — any session may
`SET default_transaction_read_only = off`. So SC-6 cannot be made proof against a determined
operator by configuration alone.

This is **not** a hole in the prerequisite, because the genuine database-enforced guarantee is
**SC-3 + SC-4**: a role with no write privilege and no ownership cannot write regardless of
transaction mode. SC-6 remains valuable as defence against *accident* and should still be required.
It should not be described as the enforcement mechanism.

The one mechanism that is physically read-only is a **standby/replica**, which is a different
database with replication lag and is not the production primary. Named for completeness, not
recommended.

### L-3 — the migration ledger is outside the gate's privilege scope *(recommended addition)*

Item 11 reads `supabase_migrations.schema_migrations`. That relation is **not** among the six in
SC-3/SC-4 — confirmed, zero occurrences in gate query 3b. It falls under the package's disclosed
*"every object outside the six named relations"*, so this is a **disclosed** limit rather than a
hidden one.

It is nonetheless the one worth closing. A write to the ledger is the most damaging accident
available in this programme: it would record Fix 3 as applied while the schema was untouched —
precisely the desync the programme exists to avoid.

**Recommendation:** extend SC-3 and SC-4's relation list to include
`supabase_migrations.schema_migrations`. This changes the v3 package and therefore **requires owner
approval**; it is not applied here.

### L-4 — session-to-target binding is irreducibly out-of-band

SC-7 is confirmed in the console; the items run in a database session. Nothing ties the two together.
The only in-SQL evidence that would bind them is host and port, which the package **forbids pasting**
because they are connection-string components. A candidate exists — a cluster-unique identifier from
the `pg_control_system()` family, which is not a secret and not a connection string — but **whether a
restricted read-only role may execute it is unverified**, so it is recorded as a candidate needing
platform confirmation, not as a recommendation.

### L-5 — nothing binds the gate's findings to the session that runs items 1-11 *(recommended addition)*

The gate runs at step 3; the items run afterwards. The package instructs *"one session, in one
window"*, but no evidence field proves the same backend served both. If the operator opens a second
connection — a different tool, a reconnect after a timeout — the gate's findings no longer apply to
the session producing the evidence.

**Recommendation:** record `pg_backend_pid()` immediately after the gate and again after Item 11, and
require the two to match. It is non-secret, one extra value, and converts an instruction into
evidence. This changes the v3 result template and therefore **requires owner approval**.

### L-6 — production privileges and ownership cannot be predicted from this repository

**A correction to an earlier characterisation in this programme.** Phase 96 reported *"6,146 public
table grants, every one to `postgres`"*. That figure came from querying the **restored local
database**, in which `postgres` performed the restore and therefore owned everything. The committed
baseline itself contains **0 `GRANT` statements and 0 `OWNER TO` statements** — it is a schema-only
dump that captured no ACLs and no ownership.

Consequently: **whether any role that already exists can satisfy SC-3 and SC-4 is unknown**, and
nothing in this repository can predict it. The earlier inference that production's tables are owned
by an admin role is not evidenced. The owner must determine it by running the gate.

---

## 5. OWNER PROVISIONING AND VERIFICATION CHECKLIST

Actions for the owner. **None is performed here.** Where the platform-specific procedure is not
established by this repository's approved materials, it is identified as an owner or
platform-administrator action requiring separate review rather than prescribed.

| # | Action | Required evidence | Notes |
|---|---|---|---|
| **P-1** | **Select or provision a dedicated read-only access mechanism.** Required *properties*, not a command: a role that holds `SELECT` on the relations the items read, holds none of `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`/`REFERENCES`/`TRIGGER` on the six, owns none of them, is not a superuser, lacks `CREATE` on `public`, and is a member of no `rolsuper`/`rolbypassrls` role | the four gate queries 3a-3d run **as that role**, in the session that will run the items | **No provisioning command is prescribed.** This repository's approved materials do not establish the platform-specific procedure, and privilege changes are outside this phase. Platform-administrator action, separate review |
| **P-2** | **Independently verify database identity.** Confirm project ref `klkiseupptzbecbxwrky` from the platform console | a record that the confirmation was **visual and out-of-band**, plus `current_database()` and `server_version` from 3a | SC-7. Irreducibly out-of-band — L-4 |
| **P-3** | **Establish that the session cannot write, perform DDL, alter privileges, or escalate.** | 3b all-false across six relations; 3c all-false; 3d zero rows; 3a `is_superuser` and `can_create_in_public` both false | SC-1 to SC-5. **This is the enforcement** — L-2 |
| **P-4** | **Check inherited memberships, ownership, schema privileges and role attributes** rather than role names | 3b (inheritance-aware), 3c (`pg_has_role`), 3a (`has_schema_privilege` on `public`), 3d (membership in privileged roles) | a role clean by name or attribute can still hold write access through a group role |
| **P-5** | **Confirm the session that runs the items is the session that passed the gate**, using the expected identity and enforcement | `current_user` and `session_user` from 3a; `txn_read_only = on`; and — if the L-5 recommendation is approved — matching `pg_backend_pid()` before and after | currently an instruction, not evidence. L-5 |
| **P-6** | **Record evidence safely.** | plain text: booleans, counts, catalog metadata, role names, version numbers | **never** credentials, connection strings whole or partial, tokens, API keys, passwords, personal data or raw row payloads. If a result cannot be summarised without one, write `WITHHELD — contains sensitive data` and describe the shape |
| **P-7** | **Stop and escalate if any required property cannot be established.** | the failing condition named, with what was observed | **no discipline-only route.** Do not proceed on the basis that the operator will be careful. Stage A stays BLOCKED |

### Sequence

P-2 before connecting · P-1 as a prerequisite to P-3 · P-3 and P-4 in the session that will run the
items, before Item 1 · P-5 bracketing the item run · P-6 throughout · P-7 at any failure.

---

## 6. BOUNDARY AND REPOSITORY STATE

| | |
|---|---|
| Production accessed or any database connection made | **NO** |
| SQL executed or database-parsed | **NO** |
| Role provisioned, grant changed, privilege changed, role switched | **NO** |
| Migration applied or modified | **NO** |
| Application code or environment changed | **NO** |
| Docker, container or CI harness executed | **NO** |
| Stage A run | **NO** |
| Commit, push, PR or deployment | **NO** |
| `C:\virality` accessed, traversed or modified | **NO** |
| Secrets, credentials, connection strings, tokens or secret-derived metadata printed | **NO** |
| Existing artifacts modified | **NO** — the v3 pair, the adoption audit and every prior artifact are unchanged |

| | |
|---|---|
| HEAD | `5604b50bdebd23efd6d040b90f5802954413b656`, detached — matches expected |
| staged | **0** |
| modified | **78** |
| untracked | **36** (+1: this checklist) |

Nothing staged, nothing committed. This file's path was checked against `.gitignore` before creation
and is visible in `git status` — a necessary check here, where `*_CHECKLIST.md`, `*_READINESS*.md`,
`*_REPORT.md` and `*_IMPLEMENTATION*.md` are all ignored and five earlier deliverables in this
programme had to be renamed.

---

## 7. EXACT NEXT ACTION FOR THE OWNER

1. **Clarify L-1** — confirm that SC-6 means `transaction_read_only` observed `on` in the session
   that runs the items.
2. **Decide the two recommended additions**, each of which changes the v3 package: **L-3**, add
   `supabase_migrations.schema_migrations` to SC-3/SC-4's relation list; **L-5**, add
   `pg_backend_pid()` capture to bind the gate to the item run.
3. **Provision the dedicated read-only mechanism (P-1)** — a platform-administrator action requiring
   separate review. Note L-6: nothing in this repository predicts whether an existing role can
   satisfy SC-3 and SC-4.
4. **Run the four gate queries as that role, in the session that will run the items**, and return the
   results for all eight conditions, sanitized.

Only then can the disposition move to `READY FOR STAGE A`. This session is not authorized to run
Stage A, and Fix 3 application remains subject to separate explicit authorization.

---

**READY FOR OWNER VERIFICATION**
