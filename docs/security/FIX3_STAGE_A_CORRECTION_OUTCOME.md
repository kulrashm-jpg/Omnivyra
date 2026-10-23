# FIX 3 — STAGE A PACKAGE CORRECTION REPORT

Documentation and evidence-package work only. No production access, no SQL executed or parsed, no
privilege change, no database mutation, no container execution, no migration application, no
deployment.

---

## STATUS

**READY FOR OWNER REVIEW**

All five recorded package defects are addressed. No unresolved *package* defect remains. What remains
is the prerequisite the owner has already defined: **provisioning and independently verifying a
dedicated, database-enforced read-only session.** Until that exists, Stage A stays BLOCKED — and the
corrected package now says so without offering a way around it.

---

## WHAT WAS PRODUCED

| Artifact | SHA-256 | Lines |
|---|---|---|
| `docs/security/FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED.md` | `8e751f5bf9fc5188915ac8f45ee7441bcffc89d99ef5f05b1c1a4cf5d4cddb42` | 1,244 |
| `docs/security/FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED.md` | `6b11013659b66da91c0dc70612b27e08420362431fbe8cae9f885f0fa7e032e5` | 179 |
| this report | recoverable with `sha256sum` | — |

### Originals preserved, byte-identical

| Artifact | SHA-256 | Status |
|---|---|---|
| `docs/security/FIX3_PHASE98_STAGE_A_OWNER_RUN_EVIDENCE.md` | `a0327d2ae48ba3bef0772eeb38947e8378f659a0eea3e2e30e0540dab0f23c5b` | **unchanged** |
| `docs/security/FIX3_PHASE100_STAGE_A_OPERATOR_STEPS.md` | `b490c648fd174c97884a7147204b098fdb7c233cce9a5f6f6455f360d975599f` | **unchanged** |
| `docs/security/FIX3_STAGE_A_PACKAGE_GAP_REVIEW.md` | `7d9a06d3e7f4ee6d2ab141fbefd86ecbab84a03ae170d46d730d964f34af32d9` | unchanged |
| `docs/security/FIX3_STAGE_A_PACKAGE_CORRECTION_PROPOSED.md` | `2af19698c165e9fc6ab76e9ceeb46ad7d1b0f01483455af12151f90f6c500e93` | unchanged |
| Fix 3 migration | `581926201d268d5bde34b6a6b7be4ee118bac3ed8d62ef88756e7030b2d445d5` | unchanged |
| Frozen predecessor | `34dffb69d4c500d0ed827ad9114778a1235ad79df3c022643decb3c55711a49d` | unchanged |
| Verification artifact | `5c62e0155bf1d4d1d911597549d83bb252cf54b66f89ba0774070371da26601b` | unchanged |
| Harness | `63e8920b916f8ca3f5a717d5b4a98efbe85d68dc2e4a7f35100fa215469a5e1e` | unchanged |

### How the corrected artifacts were built

**By splicing replacement blocks into a copy of the original, not by retyping it.** The original is
920 lines; retyping would have risked silent omission. Each corrected document was assembled by
substituting a fixed set of line ranges and carrying every other line over unmodified, then verified:

- **Corrected package:** 920 → 1,244 lines. Every `diff` hunk falls inside a planned range
  (insert@15, 29-45, 75-82, 128-153, 290-291, 323-326, 545-546, 548-573, 575-579, 843-845, 882-883).
  All **11** `### ITEM` headings survive; no original heading was lost (set comparison).
- **Corrected operator steps:** 174 → 179 lines, 8 hunks, all planned. All 10 headings survive.
- **Item 10's approved Phase 96 §F query was extracted from both documents and compared
  byte-for-byte: identical, 20 lines, sha256 `e02bfecd0a16729f`.**

Negative checks on the corrected package: `FROM information_schema.role_table_grants` as an
instrument — **0**; `session discipline only` — **0**; the old single-statement `UNION ALL` count —
**0**.

---

## GAP DISPOSITIONS

| ID | Gap | Disposition | Remaining limitation |
|---|---|---|---|
| G-1 | Read-only gate's conclusion unsupported; decisive check absent | **ADOPTED, amended** | Scope is the six named relations only; five residual exposure classes named, not eliminated |
| G-2 | Item 9 exact-count fails entirely if any table is absent | **ADOPTED** | Estimates remain lower-precision; counts are time-of-check |
| G-3 | Item 1's instrument is membership-filtered | **RESOLVED** per owner decision 3 | ACL inspection alone cannot prove read-only; column ACLs and `pg_default_acl` out of scope |
| G-4 | Internal inconsistency about which items read user tables | **FIXED** | none |
| G-5 | Item 5 fails at parse time below PostgreSQL 15 | **RESOLVED** per owner decision 4 | none material; see note |
| new | Operator steps carried the same defective rule, the discipline-only checkbox, and a pointer to the now-superseded package | **FIXED** | none |

### G-1 — read-only gate *(adopted, amended)*

The gate is replaced with four read-only queries — 3a role attributes, **3b effective write
privilege via `has_table_privilege`, which does account for inherited membership**, 3c ownership via
`pg_has_role`, 3d `SET ROLE` escalation paths — followed by an explicit statement of scope, seven
enumerated stop conditions, and template wording that no longer permits "read-only verified".

**Amended against the proposal.** The proposal still allowed the owner to accept a discipline-based
guarantee. **Owner decision 1 rejects that**, so the corrected package removes the option entirely:
there is no discipline-only route, in the gate, in the stop conditions, in section 7, or in either
result template. The `[ ] session discipline only` checkbox is gone from both documents.

`server_version_num` was added to 3a, so Item 5's version gate has a recorded source rather than
asking for the value twice.

**Remaining limitation, stated in the package rather than resolved:** the gate establishes that the
role holds no write privilege on and no ownership of the six named relations and that no superuser
escalation path was found. It does **not** prove the role read-only in general. Uncovered:
`SECURITY DEFINER` functions, event triggers, objects outside the six, privileges granted to
`PUBLIC`, and pooler or middleware behavior. Also recorded: **database identity cannot be
established from inside the database** — `current_database()` is typically `postgres` here — so the
project-ref confirmation is necessarily out-of-band and must be logged as such.

### G-2 — Item 9 absent-table handling *(adopted)*

Restructured into step 9a, an existence probe using `to_regclass` (which returns NULL rather than
raising — the idiom the Fix 3 migration itself uses in 28 places), and step 9b, one count statement
per table, run only for tables 9a reported present.

Why not one statement: a static statement naming an absent relation fails at **parse time** with
`42P01` and returns nothing, so one absent table destroyed the counts for all the others. That was
the likely case, not an edge case — Phase 96 established the production-shaped baseline carries
`public.content` but **none of the four Fix 3 tables**.

**No dynamic SQL and no temporary objects**, as required: a `DO` block cannot return a result set
without a temporary table, which would be a write.

A recording table makes `ABSENT`, `0` and `INCONCLUSIVE` mutually exclusive, and a path table
preserves **CREATE / RECONCILE / MIXED / INCONCLUSIVE** — including a "mixed, escalate" row for a
state no phase has exercised, and immediate escalation if `content` itself is absent. The verdict
block now states that `ABSENT` is a determinate finding and **not** inconclusive.

The estimated variant was rewritten to drive from a `VALUES` list so all five names always appear,
and three non-count values are called out: `present = false` → `ABSENT` with NULL estimate (never
read NULL as 0); **`reltuples = -1` → UNKNOWN**, the PostgreSQL 14+ encoding for "never vacuumed or
analyzed", reachable on a PG15+ target; `0` with a non-null analyze timestamp → genuinely empty.

### G-3 — Item 1 grant instrument *(resolved per owner decision 3)*

`information_schema.role_table_grants` is replaced by catalog ACL inspection in three steps:

- **1a** — `pg_class.relacl` expanded with `aclexplode`, wrapped in
  `COALESCE(c.relacl, acldefault('r', c.relowner))` so that a **NULL `relacl` is materialised as
  PostgreSQL's default ACL** (owner-only) and reported as a determinate finding rather than an empty
  result. `pg_class` is world-readable, so this is **not** membership-filtered — which is the whole
  point of the change. Ownership and `acl_is_default` are surfaced as columns; grantee `-` is noted
  as PUBLIC (OID 0).
- **1b** — `pg_roles` joined to `pg_auth_members`, because an ACL entry naming a group role grants
  to every `INHERIT` member of it, which 1a cannot show. This is the "inherited effective
  privileges" requirement.
- **1c** — `has_schema_privilege` for `USAGE` and **`CREATE` on `public`**, since a table grant is
  unusable without schema `USAGE`, and `CREATE` on `public` is a write capability in itself.

The verdicts now state explicitly what is **not** inconclusive: `acl_is_default = true` and a table
with no non-owner ACL entry are both determinate findings and must not be recorded as "no grants
visible, therefore unknown". **Absence of visible ACL entries is not equated with absence of
effective privileges**, and the limitation section explains why the view was replaced, including the
asymmetry that Phase 96 saw everything only because it ran as the owning superuser.

**Remaining limitation, stated in the package:** **ACL inspection alone cannot establish a read-only
guarantee — a superuser bypasses all privilege checks and appears in no ACL, and an owner's implicit
privileges are not ACL entries.** That is why the gate's 3a-3d checks exist separately. Item 1
describes the *application's* grant surface and must not be read as evidence about the inspecting
session. Column-level ACLs (`pg_attribute.attacl`) and `pg_default_acl` are out of scope and named as
the next place to look under separate authorization.

### G-4 — internal inconsistency *(fixed)*

Item 9 claimed to be "the only item that reads user tables". Item 10 reads four. Corrected to: both
read user tables; Item 9 is the only one that reads them for a count.

### G-5 — Item 5 version compatibility *(resolved per owner decision 4)*

Item 5 is now version-aware in two steps. **Step 5a** records `server_version` and
`server_version_num` and computes `pg15_or_later`. **If false: do not run step 5b, record Item 5 as
FAIL — server below PostgreSQL 15 — and stop the Stage A applicability assessment.**

The package states why this is a stop rather than a workaround: Fix 3's own `FIX3-PRECOND-00` refuses
below `150000`, so a sub-15 target is **incompatible with the migration itself**, not merely awkward
to inspect. It also states why the field must not simply be dropped — without `confdelsetcols` the
result is missing exactly the evidence that distinguishes `ON DELETE SET NULL (content_id)` from a
bare `SET NULL`, the property `content_approval_history_content_fk` depends on, so the item would
look like a pass while establishing nothing about the one FK whose delete action matters most.

**Note worth the owner's attention:** the migration checks this precondition at *apply* time. Stage A
now checks it *before* the apply, which is strictly better — a sub-15 finding is caught before a
maintenance window is spent.

---

## FULL-PACKAGE CONSISTENCY REVIEW

All eleven items were re-read in the corrected document.

| Check | Outcome |
|---|---|
| Eleven items and their purposes preserved | **yes** — 11 `### ITEM` headings, purposes unchanged |
| Item 10's approved §F query verbatim | **yes** — byte-identical, `e02bfecd0a16729f` |
| Unapproved Phase 98 lines 649-662 refinement used? | **no** — it remains present in the package *as the clearly-labelled `NEEDS REVIEW` proposal it already was*, with its prohibition intact, and is referenced nowhere as an instruction |
| Proposed Phase 99 correction used? | **no** |
| Stop conditions consistent across preamble, section 7 and both templates | **yes** — all three now require a database-enforced read-only session and none offers a discipline route |
| PASS / FAIL / INCONCLUSIVE definitions truthful | **yes** — Item 1's and Item 9's were rewritten so that determinate findings (`acl_is_default`, `ABSENT`) are not mislabelled INCONCLUSIVE; Item 5 gained a genuine FAIL condition it previously lacked |
| Minimization preserved | **yes** — Item 1 now returns role names, privilege names and booleans; Item 9 step 9a returns names and booleans. No item gained access to row payloads or personal data |
| Internal cross-references still accurate | **yes** — the "four layers" RLS section, the exclusions table and the performance section were unaffected and still match the items they describe |
| Result template records every new output | **yes** — gate 3a-3d results, `server_version_num`, Item 5 version gate, corrected package hash |

**No further material gap was found.** Two items carry limitations that are inherent rather than
defects, and both are stated in the package: items 1-4 establish authorization *configuration*, never
runtime behavior; and item 10 is time-of-check only, so a zero-row result does not authorize
application.

---

## WORKTREE CHANGES — NOT STAGED, NOT COMMITTED

| | Before | After |
|---|---|---|
| HEAD | `5604b50bdebd23efd6d040b90f5802954413b656`, detached — matches expected | identical |
| staged | 0 | **0** |
| modified | 78 | **78** |
| untracked | 24 | **27** (+3: the two corrected artifacts and this report) |

No file was staged, committed, pushed or deployed. No existing file was modified: all three new
artifacts are additions, and every original listed above hashes to its prior value.

Both corrected paths and this report's path were checked against `.gitignore` before creation and
are visible to git — a necessary check in this repository, where `*_CHECKLIST.md`, `*_READINESS*.md`
and `*_REPORT.md` are ignored and three earlier deliverables had to be renamed.

---

## BOUNDARY CONFIRMATION

| | |
|---|---|
| Production accessed | **NO** |
| SQL executed — against production or any other database | **NO**; no statement in either corrected artifact has been run or parsed by PostgreSQL |
| Privilege change, role provisioned, grant altered, role switched or user impersonated | **NONE** — provisioning a compliant read-only role is named as an owner-operated task and is neither scripted nor described step-by-step here |
| Database mutation | **NO** |
| Container started, or harness run | **NO** |
| Migration applied, or `supabase db push` | **NO** |
| Application code, migration SQL, verification SQL, schema or environment files changed | **NO** |
| Original evidence package or operator steps overwritten | **NO** — both byte-identical, hashes confirmed before and after |
| `C:\virality` accessed or traversed | **NO** |
| Credentials, tokens, passwords, connection strings or secret-derived metadata read | **NO** |
| Commit, push, PR or deployment | **NO** |

---

## WHAT THE OWNER DOES NEXT

1. **Provision and independently verify a dedicated, database-enforced read-only session** that
   clears all seven stop conditions in the corrected package's section 1, step 3. This is the single
   remaining prerequisite, it is an access-provisioning task outside this phase, and Stage A stays
   BLOCKED until it exists.
2. **Execute Stage A from the corrected artifacts** — `FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED.md`
   (`8e751f5bf9fc5188…`) with `FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED.md` (`6b11013659b66da9…`). The
   originals are preserved for audit and **must not be executed**.
3. **Return the eleven sanitized result blocks** — no credentials, connection strings, tokens,
   personal data or raw row payloads.

**Stage A is not complete, and nothing here authorizes its execution or the application of Fix 3.**

---

**READY FOR OWNER REVIEW**
