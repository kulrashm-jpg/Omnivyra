# FIX 3 — STAGE A PACKAGE GAP-CLOSURE REVIEW

Static review of `docs/security/FIX3_PHASE98_STAGE_A_OWNER_RUN_EVIDENCE.md`. No production access,
no SQL executed, no database or container contacted, no migration or schema change, no commit, no
deployment.

---

## VERDICT

**BLOCKED**

The two defects named in the brief are real, are more consequential than stated, and both are fully
corrected in the companion proposal. Two further material gaps were found in the rest of the
package, one patched and one not. Stage A nonetheless remains **BLOCKED**, for one reason that is
not a document defect and cannot be fixed by editing text:

> **The strengthened read-only gate will, on the evidence available, fail on the only role the owner
> is likely to have.** On this platform the readily available role is the project superuser.
> Correcting the gate makes that visible rather than hiding it. Resolving it requires an **owner
> decision** — provision a dedicated read-only role, or explicitly accept a discipline-based
> guarantee instead of a privilege-based one. Neither is authorized here, and the brief is explicit:
> do not weaken the safety standard to make the procedure executable. So it is left blocked rather
> than decided.

The original gate would have let an operator proceed believing a role was read-only when it held
full write privilege. That is the safety-critical finding, and it is why this is `BLOCKED` and not
`READY FOR OWNER REVIEW`.

---

## BASELINE AND INTEGRITY

| | |
|---|---|
| Repository | `C:\tmp\deploy-current-main` |
| HEAD | `5604b50bdebd23efd6d040b90f5802954413b656`, detached — matches expected |
| Package reviewed | `docs/security/FIX3_PHASE98_STAGE_A_OWNER_RUN_EVIDENCE.md`, 920 lines |
| Package SHA-256 **before** | `a0327d2ae48ba3bef0772eeb38947e8378f659a0eea3e2e30e0540dab0f23c5b` |
| Package SHA-256 **after** | `a0327d2ae48ba3bef0772eeb38947e8378f659a0eea3e2e30e0540dab0f23c5b` — **unchanged, not overwritten** |

### Files changed

**No existing file was modified.** The frozen predecessor, the Fix 3 migration, the verification
SQL, the harness, the approved package and every prior report are byte-unchanged. Two new review
artifacts were created:

| File | SHA-256 | Lines |
|---|---|---|
| `docs/security/FIX3_STAGE_A_PACKAGE_GAP_REVIEW.md` | this document; recoverable with `sha256sum` | — |
| `docs/security/FIX3_STAGE_A_PACKAGE_CORRECTION_PROPOSED.md` | `2af19698c165e9fc6ab76e9ceeb46ad7d1b0f01483455af12151f90f6c500e93` | 370 |

| Preserved artifact | SHA-256 |
|---|---|
| Fix 3 migration | `581926201d268d5bde34b6a6b7be4ee118bac3ed8d62ef88756e7030b2d445d5` |
| Frozen predecessor | `34dffb69d4c500d0ed827ad9114778a1235ad79df3c022643decb3c55711a49d` |
| Verification artifact | `5c62e0155bf1d4d1d911597549d83bb252cf54b66f89ba0774070371da26601b` |
| Harness | `63e8920b916f8ca3f5a717d5b4a98efbe85d68dc2e4a7f35100fa215469a5e1e` |

Both new paths were checked against `.gitignore` before creation and are visible to git. That check
is not ceremonial: `*_CHECKLIST.md`, `*_READINESS*.md` and `*_REPORT.md` are all ignored in this
repository, and two earlier deliverables in this programme had to be renamed.

---

## FINDINGS

| ID | Severity | Finding | Patched? |
|---|---|---|---|
| G-1 | **SAFETY-CRITICAL** | The read-only gate's conclusion does not follow from its checks, and the decisive check is missing entirely | **yes** — Correction 1 |
| G-2 | **MATERIAL** | Item 9's exact-count statement fails completely on the most likely production state | **yes** — Correction 2 |
| G-3 | **MATERIAL** | Item 1's instrument is membership-filtered and can under-report grants | **no** — needs an owner call |
| G-4 | MINOR | Internal inconsistency: Item 9 claims to be the only item reading user tables; Item 10 also does | **yes** — Correction 2 |
| G-5 | MINOR | Item 5 fails at parse time on PostgreSQL below 15, with no instruction to branch | **no** — noted below |

### G-1 — The read-only gate overstates what it establishes *(safety-critical)*

Package lines 29-45. The gate runs four checks and then states:

> A role reporting `is_superuser = true` or `can_create_in_db = true` is **not** a read-only role.

That direction is true. **The converse is what an operator will act on, and it is false.** A role
can be a non-superuser, lack database-level `CREATE`, and still hold `INSERT`, `UPDATE`, `DELETE`
and `TRUNCATE` on every table in `public`. Five distinct defects:

1. **No table-level write privilege is ever checked.** The decisive question is simply absent.
2. **Inherited privileges are invisible.** `rolsuper` and `rolbypassrls` are read for `current_user`
   alone. Role *attributes* are not inherited through membership — but table *privileges* are, for an
   `INHERIT` role. A role clean by attribute can hold full write access through a group role, and
   this gate reports it clean.
3. **Escalation paths are not checked.** Membership in a superuser or `BYPASSRLS` role permits
   `SET ROLE` into it; `rolsuper = false` for `current_user` does not exclude that.
4. **Ownership is not checked.** An owner may `ALTER` or `DROP` regardless of granted privileges.
5. **Two near-irrelevant signals displace the relevant one.** `rolcreatedb` governs creating
   *databases*; `has_database_privilege(…,'CREATE')` governs creating *schemas*. Neither governs
   writing to application tables. The missing check is
   `has_schema_privilege(current_user,'public','CREATE')`.

Also, on **database identity**: `current_database()` is typically `postgres` on this platform and
cannot distinguish one project from another. **No in-database query can confirm the project ref.**
The package asks for the ref to be confirmed but never says that confirmation is necessarily
out-of-band, which invites an operator to believe a SQL result settled it.

Correction 1 replaces the gate with four queries — attributes, effective privilege via
`has_table_privilege` (which does account for inherited membership), ownership via `pg_has_role`,
and escalation paths — followed by an explicit statement of what they establish and what they do
not, seven enumerated stop conditions, and wording for the result template that no longer says
"read-only verified".

**It deliberately does not lower the bar.** Residual exposure is named rather than resolved:
`SECURITY DEFINER` functions, event triggers, objects outside the six named relations, privileges
granted to `PUBLIC`, and pooler or middleware behavior.

### G-2 — Item 9 fails entirely when any table is absent *(material)*

Package lines 548-556. The exact-count statement is a single `UNION ALL` over five hard-coded
relations. A static statement naming a non-existent relation fails at **parse/analysis time** with
`42P01` and returns **nothing** — not partial results. **One absent table destroys the counts for
the four that exist.**

This is the likely case, not an edge case. Phase 96 established that the committed
production-shaped baseline contains `public.content` but **none of the four Fix 3 tables**. On the
single most probable production state, this evidence item yields no data at all.

Two further false-zero traps in the same item:

- The estimated alternative drives from `pg_class` filtered by `relname IN (…)`, so an absent table
  **silently does not appear**. Four rows come back instead of five, with nothing distinguishing
  "absent" from a mis-typed name.
- **`pg_class.reltuples` is `-1`**, not `0`, for a relation never vacuumed or analyzed — a
  PostgreSQL 14+ behavior introduced precisely so "no statistics" is distinguishable from "no rows".
  The target is PostgreSQL 15 or later, so the value is reachable, and the package does not mention
  it. An operator would read `-1` as corrupt, or worse, `NULL` as zero.

Correction 2 restructures the item as an existence probe (step 9a, using `to_regclass`, which
returns NULL rather than raising — the same idiom the Fix 3 migration itself uses in 28 places)
followed by per-table counts (step 9b) run only for tables confirmed present. It adds an explicit
recording table where `ABSENT`, `0` and `INCONCLUSIVE` are three distinct outcomes, and a path-mapping
table preserving the CREATE / RECONCILE distinction — including a "mixed, escalate" row for a state
no phase has exercised.

**No dynamic SQL is proposed**, and the reason is recorded in the correction: a `DO` block cannot
return a result set without creating a temporary table, which would be a write and would violate the
read-only transaction.

### G-3 — Item 1's instrument can under-report grants *(material, not patched)*

Item 1 reads `information_schema.role_table_grants`. That view shows only privileges **where a
currently enabled role is the grantor or the grantee**. Under a restricted read-only inspection
role — exactly the role this package demands — grants to `authenticated` or `service_role` may be
**invisible**, and the item would report what looks like "no grants exist".

That is the same shape as the Phase 96 local finding, and it would be misread as corroboration. The
failure is silent: there is no error, just a short result. Note the asymmetry — Phase 96 ran that
query as a superuser who owned and granted everything, so it saw everything; a restricted role will
not.

The unfiltered instrument is the ACL itself, `pg_class.relacl` expanded with `aclexplode`, which is
not membership-filtered. A `relacl` of NULL means default privileges — owner only — which is itself a
meaningful finding and is currently indistinguishable from "query returned nothing".

**Not patched**, because replacing the instrument of an approved evidence item is a change of
substance rather than a defect fix, and the brief reserves that. **Interim mitigation the owner can
adopt without any change:** record Item 1's verdict as `INCONCLUSIVE` whenever the effective role is
not a member of the grantee roles, rather than reading a short result as evidence of absence.

### G-4 — Internal inconsistency about which items read user tables *(minor, patched)*

Package lines 545-546 state that Item 9 is "the only item that reads user tables rather than
catalogs". Item 10 reads `content_block`, `content_recommendation`, `content_approval_history` and
`content` — four user tables. The claim is simply wrong, and it matters because an operator weighing
read-only risk will have been told, incorrectly, that only one item touches user data. Corrected in
Correction 2 to: both items read user tables; Item 9 is the only one that reads them for a count.

### G-5 — Item 5 fails below PostgreSQL 15 *(minor, not patched)*

Item 5 selects `k.confdelsetcols`, which exists only in PostgreSQL 15 and later. On an earlier
server the column reference fails at parse time and the whole item returns nothing. The package notes
the version requirement and attributes it to `FIX3-PRECOND-00`, but **that precondition is asserted
by the migration at apply time — Stage A runs before it**, so the server version is unverified when
Item 5 is run.

In practice the risk is low: the preamble's identity capture records `server_version` before Item 1.
**Not patched** because a conditional branch would add a second variant of an approved query for a
case the evidence suggests will not arise. **Mitigation without any change:** if `server_version` is
below 15, drop the `on_delete_set_columns` column from Item 5 and record that it was dropped and why.

---

## VALIDATION PERFORMED

| Required check | Outcome |
|---|---|
| Full package reviewed, not only the two named sections | **done** — all eleven items, the preamble, the exclusions table, the RLS interpretation, the performance section, the result template and the provenance table. G-3, G-4 and G-5 came from outside the two named sections. |
| Revised instructions internally consistent with the result template and stop conditions | **yes.** Correction 1 adds seven stop conditions and the one consequential template edit (line 648) needed to record its outputs; Correction 2 adds no new template field and reuses the existing per-item block. G-4 was itself an internal-consistency failure and is fixed. |
| Item 9 handles every combination of present and absent tables without treating absence as zero | **yes.** Step 9a always returns all five names with a boolean. The recording table makes `ABSENT`, `0` and `INCONCLUSIVE` mutually exclusive. The path table covers all-absent, all-present, mixed and the `content`-absent escalation. Absence can no longer be rendered as zero in either the exact or the estimated variant, and `reltuples = -1` is called out as UNKNOWN. |
| The read-only gate does not overstate what its checks establish | **yes.** It now states its scope as the six named relations, names five residual exposure classes it does not cover, separates transaction-level from privilege-level guarantees, states that database identity is not establishable from SQL, and replaces "read-only verified" with the narrower claim the checks support. |
| Additional material gaps reported | **yes** — G-3, G-4, G-5. |
| Exact files changed, before/after hashes | **recorded above.** No existing file modified; package hash identical before and after. |
| Unresolved gaps left blocked rather than decided | **yes** — the role-provisioning decision, G-3's instrument change, and G-5's conditional variant are all left to the owner. |

### Preserved

All eleven evidence items and their purposes. Item 10's approved Phase 96 §F query — **not restated
anywhere in the correction**, so it cannot diverge from the authoritative copy. The unapproved
Phase 98 lines 649-662 refinement and the proposed Phase 99 correction are neither used nor
introduced; the correction document references the former only to repeat its prohibition. No change
to the Fix 3 migration, the verification SQL, the schema, or application code. No migration
application or data remediation is authorized or proposed.

---

## WHAT THE OWNER MUST DECIDE

Three items, none of which this review decides:

1. **The read-only role.** Either provision a dedicated role holding `SELECT` only on the six
   relations and no ownership, or explicitly accept that the guarantee rests on session discipline.
   Provisioning is a privilege change and is **not** authorized by this task. Until one path is
   chosen, Stage A stays blocked.
2. **Adopt Corrections 1 and 2?** They are mechanically applicable to the package at the line ranges
   given. Correction 2 should be adopted before any Stage A run: without it, the most likely
   production state produces no row counts at all.
3. **G-3's instrument.** Replace Item 1's `information_schema` view with an `aclexplode` form, or
   accept the interim mitigation of recording `INCONCLUSIVE` when the role cannot see others' grants.

---

## BOUNDARY CONFIRMATION

| | |
|---|---|
| Production accessed | **NO** |
| SQL executed, against production or any other database | **NO** — no statement in either document has been run or parsed by PostgreSQL |
| Dynamic SQL executed against production | **NO**, and none is proposed; the correction explains why |
| Database or container started | **NO** |
| Database changes | **NO** |
| Migration applied, or data remediated | **NO** |
| Fix 3 migration, verification SQL, schema or application code changed | **NO** |
| Approved package overwritten | **NO** — byte-identical, hash confirmed before and after |
| Role switching, impersonation, write attempts, privilege changes | **NONE** performed or introduced |
| Commit, push, merge or deployment | **NO** |
| `C:\virality` accessed or traversed | **NO** |
| Credentials, connection strings or secret-derived metadata read or exposed | **NO** |

HEAD `5604b50bdebd23efd6d040b90f5802954413b656` unchanged. The only repository change is the two new
review artifacts named above.

---

**BLOCKED**
