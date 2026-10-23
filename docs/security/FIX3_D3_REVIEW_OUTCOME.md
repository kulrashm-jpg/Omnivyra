# FIX 3 — D-3 REVIEW OUTCOME

Static review and drafting only. No production access, no SQL executed or parsed by any database, no
container or harness, no privilege change, no migration application, no commit, no deployment.

---

## DISPOSITION

**D-3 PROPOSAL READY FOR OWNER APPROVAL**

The abort condition is real, exactly one migration branch carries it, and a read-only two-step
preflight covers it accurately. The earlier candidate was **substantially sound but had four
defects**; all four are fixed in the proposal. Nothing was added to the executable package — that
needs owner approval, because it adds a query.

| Artifact | SHA-256 |
|---|---|
| `docs/security/FIX3_D3_LIFECYCLE_PREFLIGHT_PROPOSED.md` | recorded in §5 below |
| this report | recoverable with `sha256sum` |

---

## 1. MIGRATION BRANCH ANALYSIS

Source: `supabase/migrations/20261212000000_content_quality_collaboration_tenant_consistent.sql`,
sha256 `581926201d268d5bde34b6a6b7be4ee118bac3ed8d62ef88756e7030b2d445d5` (verified). STEP 6 spans
`:2324-2525`.

**Target and column.** `r_content regclass := to_regclass('public.content')` at `:2392`. The column
is `lifecycle_status`, resolved to `a_life` at `:2413-2415` with `attnum > 0 AND NOT attisdropped`.
Both absences refuse at `FIX3-LIFE-01` (`:2410-2412`, `:2416-2418`).

**The branch test**, `:2425-2426`:

```sql
SELECT count(*) INTO v_ncons FROM pg_constraint
 WHERE conrelid = r_content AND contype = 'c' AND a_life = ANY (conkey);
```

**Constraint definition added**, `:2446` — identical text at `:2516`:

```sql
ALTER TABLE public.content ADD CONSTRAINT content_lifecycle_status_check
  CHECK (lifecycle_status IN ('draft','generated','edited','approved','adapted',
                              'scheduled','published','archived','quality_reviewed'))
```

**Accepted values**: those nine, also held in `v_nine` at `:2406`. The eight-value predecessor set is
`v_eight` at `:2407`. Comparison is on the **sorted element set** (`:2420-2423`, `:2490-2491`), not
byte order — which is why Phase 96 found both the `quality_reviewed`-fourth and -ninth orderings
accepted.

**All ten reachable outcomes**, and which touch data:

| Condition | Outcome | Scans `content`? | Can fail `23514`? | Line |
|---|---|---|---|---|
| `content` absent | refuses `FIX3-LIFE-01` | no | no | `:2410` |
| `lifecycle_status` absent | refuses `FIX3-LIFE-01` | no | no | `:2416` |
| `v_ncons > 1` | refuses `FIX3-LIFE-02` | no | no | `:2428` |
| **`v_ncons = 0`** | **ADD CONSTRAINT nine-value** | **yes** | **YES** | `:2434-2450`, ADD `:2445` |
| nine-value, validated | LEFT UNCHANGED, no DDL, no revalidation scan | no | no | `:2493` |
| eight-value predecessor | DROP + ADD nine-value | yes | **no** | `:2498-2520` |
| key count ≠ 1 | refuses `FIX3-LIFE-03` | no | no | `:2457` |
| `NOT VALID` | refuses `FIX3-LIFE-04` | no | no | `:2463` |
| unsupported definition form | refuses `FIX3-LIFE-07` | no | no | `:2482` |
| supported form, unrecognised elements | refuses **`FIX3-LIFE-05`** | no | no | `:2522` |

**Which rows could fail.** Only in the `v_ncons = 0` branch, and only rows whose `lifecycle_status`
is outside those nine values.

**Do NULLs pass?** **Yes.** A `CHECK` rejects a row only when its expression evaluates to FALSE;
`NULL IN (…)` is NULL, which is not FALSE, so a NULL row satisfies the constraint and cannot cause
the abort. A preflight must therefore **exclude** NULLs, and `WHERE … NOT IN (…)` does so naturally
because `NOT IN` also yields NULL. Adding `OR … IS NULL` would manufacture false positives.

**Why the two DDL branches differ.** The eight-to-nine replacement cannot reject a row: nine values
is a strict superset of eight, and `FIX3-LIFE-04` has already refused if the existing CHECK were
`NOT VALID` — so every surviving row provably satisfies the eight and therefore the nine. It still
scans, which matters for lock duration, but not for abort risk. The `v_ncons = 0` branch has no such
guarantee, because no constraint has ever constrained the column.

**Why Items 6 and 10 do not establish this.**

- **Item 6** reads `pg_get_constraintdef` and `convalidated`. It is a *definition* inspection. In the
  `v_ncons = 0` state there is no constraint to inspect, so Item 6's most informative possible result
  is "no CHECK covers `lifecycle_status`" — which identifies the branch and says nothing whatever
  about the rows. Its PASS criteria are about definition shape, not data conformance.
- **Item 10** covers the four composite foreign keys and predicts `23503`. Its four branches join
  child tables to parents; none reads `lifecycle_status`. A zero-row Item 10 is silent on this class.

The two failure classes also differ in SQLSTATE — `23514` versus `23503` — and neither carries a
`FIX3-*` code, so an operator seeing one has no guard identifier to look up.

---

## 2. CANDIDATE REVIEW — FOUR DEFECTS

The candidate is in **`FIX3_PHASE99_PREFLIGHT_CORRECTION_PROPOSED.md` §4**, not in
`FIX3_STAGE_A_PACKAGE_CORRECTION_PROPOSED.md` §4 as cited by the audit report and by this task's
brief. That file has no §4; its sections are Correction 1 (gate), Correction 2 (Item 9) and "WHAT
THIS PROPOSAL DOES NOT FIX". **Citation corrected; the audit report is left unaltered as the record
of a completed step.**

It was reviewed against the migration, not accepted on its face.

### Verified correct — carried forward unchanged

- **The nine literals** match `:2446` exactly, in the same order.
- **The NULL reasoning** is right, and right for the right reason: `CHECK` fails only on FALSE, so
  excluding NULLs matches the constraint's own semantics rather than being an oversight.
- **Two-step shape** — catalog first, data only when the branch is relevant — is the correct design
  and avoids scanning a production table in the branches where it would prove nothing.
- **`SELECT`-only**, no `DO`, no temp object, no DDL, no write, no role change, no dynamic SQL.
- **Minimization**: a count, then grouped vocabulary values. No identifiers, no payloads.
- **Not folded into Item 6** — correct, since Item 6 has different PASS criteria.

### Defects found

| # | Defect | Severity | Fix |
|---|---|---|---|
| **V-1** | `k.conrelid = 'public.content'::regclass` **raises `42P01`** when the relation is absent. The item would error rather than return a clean INCONCLUSIVE, and absence is a state Stage A explicitly expects to find. The migration uses `to_regclass` and refuses with `FIX3-LIFE-01`. | **material** | `to_regclass`, plus explicit `content_present` and `lifecycle_column_present` columns, and a **NULL** count — distinct from `0` — when the question cannot be asked |
| **V-2** | Re-expressed the branch test as `EXISTS (… unnest(k.conkey) …)` and omitted the migration's `attnum > 0 AND NOT attisdropped` guards. Equivalent in practice — `unnest(NULL)` yields no rows just as `x = ANY(NULL)` yields NULL, and dropped columns are renamed so could not match — but the preflight's entire value is predicting the migration's own branch, so it should replicate the test literally rather than argue equivalence. | fidelity | replicated literally, with line citations |
| **V-3** | Its branch table **omitted `FIX3-LIFE-05`** (`:2522`, supported form with an unrecognised element list), and its interpretation read "Step 1 returns **1** → no action. The common and expected case" — collapsing nine-value-validated, eight-value-predecessor and **four refusal** sub-branches into one line. That invites the operator to record a count of 1 as "Item 6 fine" when three of those outcomes stop the migration. This is exactly the misleading-pass state to avoid. | **material** | all ten branches tabulated; `NOT APPLICABLE` introduced as a distinct verdict; a dedicated subsection stating that `NOT APPLICABLE` is **not** a pass for Item 6 |
| **V-4** | No stop condition for "step 1 could not be obtained", and no verdict row for an absent relation or absent column. | material | both added to the interpretation table, with escalation |

Also stale: the candidate's insertion point, "package line 692". In v2, line 692 is a row of Item 7's
index table. The real Item 10 / Item 11 boundary is v2 line 1042, with `### ITEM 11` at 1044.

---

## 3. RECOMMENDATION

**REVISE AND ADOPT.**

The condition is real and currently undetected; the preflight is cheap — one catalog query always,
one grouped scan only in the single branch where it matters; it is `SELECT`-only and minimally
disclosive; and with V-1 to V-4 fixed it introduces no misleading pass state, because
`NOT APPLICABLE` is named as its own verdict and explicitly disclaimed as evidence about Item 6.

Against adopting: it adds a query to an owner-approved package, and Item 9's history in this
programme shows that even a well-intentioned addition can carry a latent defect. That is why it is
presented for approval rather than inserted, and why the diff is confined to **one insertion plus
one modified line** across the two executable artifacts.

A narrower alternative exists and is worth naming: adopt **step 10b-1 only**. That identifies the
branch for one catalog query and no data access at all, and converts the gap from "undetected" to
"detected but unquantified" — if 10b-1 returns 0, the owner then knows a data check is needed and can
authorize 10b-2 separately. This is the minimum that removes the blind spot.

**Recommended: adopt both steps.** Stopping at 10b-1 leaves the operator holding a known risk with no
way to size it, and the session would have to be repeated to run 10b-2 — against production, under
the same read-only prerequisite.

---

## 4. PROPOSED SQL AND DIFF

Both steps, the interpretation table, minimization, limitations, stop conditions, exact insertion
points and the three minimal diffs are in the proposal artifact. Summary of the diff surface:

| Artifact | Change |
|---|---|
| `FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED_V2.md` | **one insertion** after line 1041 (sub-item 10b, before the `---` at 1042), plus **one insertion** into the result template's per-item block. No existing line modified or removed |
| `FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED_V2.md` | **one modified line** — line 61, the Item 10 row |

Proposed as **sub-item 10b of Item 10**, not as a twelfth item. A twelfth item would falsify "eleven
items" in five places in the package (lines 228, 251, 1185, 1224, 1253) and three in the operator
steps, and would break the `Items PASS: ___ / 11` roll-up. As a sub-item none of those counts
changes. It is not folded into Item 6.

**Item 10's approved Phase 96 §F query is untouched and is not re-stated anywhere in the proposal**,
so it cannot diverge from the authoritative copy. The unapproved Phase 98 lines 649-662 FK refinement
is not adopted.

---

## 5. ARTIFACT HASHES AND REPOSITORY STATUS

### Verified before use — all matched

| Artifact | SHA-256 |
|---|---|
| `FIX3_STAGE_A_AUDIT_CLOSURE.md` | `b0650d82c8ee92397a44e615d01b22a4750f9d216080bba9b356763b71ecd22b` |
| `FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED_V2.md` | `c2b9eaf9e14661c4a47f7eedbb77f6f9a38b4637d3c415fdc97af06f6c5aab96` |
| `FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED_V2.md` | `e5e27fc8b23f08819c3ac503b13ca25cc6631f66fddf7eba75684c1b13723542` |
| `FIX3_STAGE_A_PACKAGE_CORRECTION_PROPOSED.md` | `2af19698c165e9fc6ab76e9ceeb46ad7d1b0f01483455af12151f90f6c500e93` |
| Fix 3 migration | `581926201d268d5bde34b6a6b7be4ee118bac3ed8d62ef88756e7030b2d445d5` |

### Created by this task

| Artifact | SHA-256 |
|---|---|
| `docs/security/FIX3_D3_LIFECYCLE_PREFLIGHT_PROPOSED.md` | ``6b7303e036e5fca33006b129e2d9a1a715d588bf454a20ec9c51d9aa60a8bbd8`` |
| `docs/security/FIX3_D3_REVIEW_OUTCOME.md` | this file |

Both paths were checked against `.gitignore` before creation and are visible to git.

### Preserved byte-for-byte

The two immutable originals, the v1 corrected pair, the v2 pair, the migration, the frozen
predecessor, the verification SQL and the CI harness — **none modified.** Verified by hash after
drafting as well as before.

### Repository status

| | |
|---|---|
| HEAD | `5604b50bdebd23efd6d040b90f5802954413b656`, detached — matches expected |
| staged | **0** |
| modified | **78** |
| untracked | **32** (+2: the proposal and this report) |

Nothing staged, nothing committed.

---

## 6. CONFIRMATION OF PROHIBITED ACTIONS NOT TAKEN

| | |
|---|---|
| Production access or connection | **NO** |
| SQL executed, or parsed by any database — including disposable databases and containers | **NO**; every statement was reviewed as text |
| Role provisioning, privilege change, role switching | **NO** |
| Migration applied, or migration SQL changed | **NO** |
| Application code or environment changes | **NO** |
| Docker or harness execution | **NO** |
| Commit, push, PR or deployment | **NO** |
| `C:\virality` accessed or traversed | **NO** |
| Credentials, connection strings, tokens, secrets or secret-derived metadata printed | **NO** |
| v2 package or v2 operator steps modified | **NO** — proposal only |
| Item 10's approved §F query altered | **NO** |
| Unapproved Phase 98 FK refinement adopted | **NO** |

**The read-only prerequisite is unchanged: Stage A remains BLOCKED until a dedicated,
database-enforced read-only session is provisioned and independently verified.** Stage A is not
complete, and Fix 3 application is not authorized.

---

## 7. NEXT OWNER ACTION

1. **Approve, narrow or reject the 10b proposal.** If approved, the three diffs produce a v3 pair;
   the narrower option is 10b-1 only.
2. **Provision and independently verify the dedicated database-enforced read-only session.** This
   remains the standing prerequisite and is independent of the 10b decision.
3. Then execute the approved package and return all eleven sanitized result blocks — with 10b
   recorded under Item 10 if adopted.

---

**D-3 PROPOSAL READY FOR OWNER APPROVAL**
