# FIX 3 — STAGE A OPERATOR STEPS

**For the owner, or an operator the owner delegates to.** One page of procedure plus a result
template. The SQL lives in the approved package and is not reproduced here.

| | |
|---|---|
| **Run the queries from** | `docs/security/FIX3_PHASE98_STAGE_A_OWNER_RUN_EVIDENCE.md` — sha256 `a0327d2ae48ba3bef0772eeb38947e8378f659a0eea3e2e30e0540dab0f23c5b` |
| **Do not** | copy, retype, substitute or "improve" its SQL. Run the items as published. |
| **Two qualifications** | see section 4 before you start |

Verify that hash before you begin. If it does not match, stop: you are looking at a different
document from the one reviewed.

---

## 1. BEFORE YOU RUN ANYTHING — six independent confirmations

Confirm all six **yourself**. Do not infer any of them from the fact that a query returned rows.
**If you cannot independently verify any one of them, stop and do not proceed.**

| # | Confirm | How |
|---|---|---|
| 1 | **The intended target** | Project ref `klkiseupptzbecbxwrky`, read from the platform console. Never identify the database by a Studio display name — it can be changed, and it has misled this programme before. |
| 2 | **The effective role** | `SELECT current_user, session_user;` — know which role you are actually connected as, not which one you intended. |
| 3 | **The role's real read-only privileges** | Run the privilege query in the package's section 1. A role reporting `is_superuser = true` or `can_create_in_db = true` is **not** read-only. |
| 4 | **The execution context is safe** | `BEGIN; SET TRANSACTION READ ONLY;` … `ROLLBACK;` around the work, so an accidental write fails instead of succeeding. **A `SELECT` statement alone is not proof the context is read-only** — the access path, permissions and session all have to hold. |
| 5 | **A non-secret way to name the target** | Capture `current_database()`, `server_version` and the UTC timestamp. That distinguishes the target without disclosing host, port, user or password. |
| 6 | **A safe way to capture output** | Plain text you can redact before sharing. Decide this before you run, not after. |

Stop immediately, and record why, if the target cannot be confirmed, the role cannot be confirmed
or holds write or DDL privilege with no read-only alternative available, `SET TRANSACTION READ ONLY`
is unavailable with no equivalent guarantee, or any statement errors in a way suggesting it did
something other than read.

**Hard prohibitions for the whole session:** no DDL, no DML, no migrations, no `supabase db push`,
no generic migration-ledger reconciliation, no `SET ROLE` or impersonation, no writes, no
authorization probes, and no execution of anything from
`FIX3_PHASE99_PREFLIGHT_CORRECTION_PROPOSED.md`.

---

## 2. RUN THE ELEVEN ITEMS

All eleven are specified in the approved package, each with its own SQL, expected columns,
PASS / FAIL / INCONCLUSIVE criteria, minimization rules and limitations. Run them in one session,
in one window, and record start and end timestamps in UTC.

| # | Evidence | Note |
|---|---|---|
| 1 | Relevant table grants | the five tables plus `user_company_roles` |
| 2 | `user_company_roles` policies and role configuration | **the most consequential item** — it decides whether the Fix 3 policy predicate is satisfiable at all |
| 3 | RLS enabled and forced status | all five tables |
| 4 | Actual policy predicates, including `public.content`'s `content_company_rw` | `content`'s policy is **not** owned by Fix 3 and shares the predicate |
| 5 | Foreign keys: ordered column mappings, delete actions, validation state | decides CREATE path vs RECONCILE path |
| 6 | Lifecycle CHECK definition and accepted values | see section 4.2 — read this one carefully |
| 7 | Index definitions and options | name equality is not enough; the options matter |
| 8 | Trigger definitions and referenced function names | also settles which timestamp function production actually has |
| 9 | Row counts for the four Fix 3 tables plus `public.content` | the only item that reads user tables; it reads no column values |
| 10 | Tenant-consistency preflight — the approved Phase 96 §F query | see section 4.1 |
| 11 | Migration-history evidence | record **separately**; never merge with schema state |

A table that is **absent** is a finding, not an error, and is different from a table that is
present and empty. Record which.

---

## 3. RESULT TEMPLATE

One block per item, eleven in total.

```
STAGE A EVIDENCE — FIX 3
Session window (UTC):   start ______________  end ______________
Target (project ref):   ______________  (expected klkiseupptzbecbxwrky)
current_database():     ______________   server_version: ______________
Effective role:         ______________
  is_superuser: ____   bypasses_rls: ____   can_create_in_db: ____
Read-only guarantee:    [ ] role privileges   [ ] session discipline only
SET TRANSACTION READ ONLY in effect?  ____
Item 9 variant:         [ ] exact count(*)   [ ] reltuples estimate
Package hash confirmed: ____  (a0327d2ae48ba3be…)

--- ITEM <n> ---
Evidence ID:           <1..11>
Executed at (UTC):     ______________
Query version:         package item <n>   [ ] unmodified   [ ] modified (attach)
Exit status:           [ ] ok   [ ] error (quote it, redacted)
Result summary:        ________________________________________________
Verdict:               [ ] PASS   [ ] FAIL   [ ] INCONCLUSIVE
Limitations/warnings:  ________________________________________________
```

**Never paste** credentials, connection strings (whole or partial), tokens, API keys, passwords,
personal data, raw row payloads, or any database content unrelated to these five tables — not into
the evidence report, not into a ticket, not into chat. If a result cannot be summarised without
one of those, write `WITHHELD — contains sensitive data` and describe the shape of the finding
instead.

---

## 4. FOUR QUALIFICATIONS THAT CHANGE HOW YOU READ THE RESULTS

### 4.1 Preflight scope — item 10

The approved Phase 96 §F query is **adequate for the four composite foreign-key relationships**
under review. Phase 99 confirmed this relationship by relationship: correct NULL handling, no false
positives, no row multiplication.

It does **not** establish every possible data-dependent failure condition.

**The refinement at package lines 649-662 is unapproved and must not be used.** It is already
labelled `NEEDS REVIEW` in the package, and Phase 99 found a real defect in it — its second join is
on the parent's `id` alone, which can multiply output rows. **Do not substitute the Phase 99
proposed correction into the package either**; it is review-only and has never been executed.

A **zero-row** preflight result excludes one failure class at one moment in time. It is **not**
proof that the migration is safe to apply, and it is not authorization to apply it.

### 4.2 Lifecycle CHECK — item 6 is not only a definition question

Inspect the **actual** lifecycle CHECK state on `public.content`, because what STEP 6 does depends
on it:

- **Exactly one CHECK covering `lifecycle_status`, in the nine-value form, validated** → STEP 6
  changes nothing and scans nothing. The expected case.
- **Exactly one, in the eight-value predecessor form** → STEP 6 replaces it. This **scans**
  `public.content` but cannot fail, because nine values is a strict superset of eight.
- **No CHECK covering `lifecycle_status`** → STEP 6 **adds** it. This scans `public.content` and
  **will abort with SQLSTATE `23514`** if any row holds a value outside the nine. This is a
  **separate condition from the foreign-key failures item 10 covers**, and item 10 will not detect
  it.
- **More than one** → the migration refuses before touching data.

Record which of the four states you find. Do **not** create a new query or run the Phase 99
proposed correction to probe this during Stage A; item 6 as published tells you which state you are
in, and that is enough for the owner to decide the next step.

### 4.3 RLS — configuration is not behavior

Items 1 to 4 establish **configuration**: grants, RLS flags, policy predicates. They do **not** by
themselves prove the runtime authorization behavior of real production users.

Do **not** attempt role switching, impersonation, writes, or authorization probes against
production to close that gap. Record the four layers separately — RLS flags, grants and role
memberships, policy predicates, and runtime behavior (not established) — and do not write
"RLS verified".

### 4.4 Performance — the existing numbers are synthetic

Phase 96 measured roughly 4,505 ms end-to-end at about 1.5 million synthetic rows, largest single
statement roughly 1,489 ms, on a four-CPU container with no concurrent load. **These are not
production performance predictions.**

Material operational risks remain, and none is to be changed: `lock_timeout` is five seconds and
**ACCESS EXCLUSIVE** locks are taken leaf-first on five tables, so under live traffic the migration
may simply fail to acquire its locks and abort; because the migration is one transaction, that lock
window spans the whole apply; and no constraint is added `NOT VALID`, so index builds and
constraint validation all happen inside that window. Item 9's row counts are one input to judging
this, not the answer.

---

## 5. WHEN YOU ARE DONE

Return the eleven filled-in blocks and the roll-up. Nothing else is required.

**Completing Stage A does not authorize applying Fix 3.** Even eleven PASS verdicts establish only
what the production schema currently *is*. Application remains a **separate, explicit owner
decision**, taken after the evidence and an operational plan are reviewed — including remediation
for anything item 10 finds, a maintenance window consistent with section 4.4, and re-confirmation
of the migration hash `581926201d268d5bde34b6a6b7be4ee118bac3ed8d62ef88756e7030b2d445d5` and the
verification-artifact hash `5c62e0155bf1d4d1d911597549d83bb252cf54b66f89ba0774070371da26601b` at
the time of application.
