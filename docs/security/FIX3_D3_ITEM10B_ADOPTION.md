# FIX 3 — D-3 / ITEM 10b IMPLEMENTATION AUDIT

Documentation and static-validation work only. No production access, no SQL executed or parsed by
any database, no container or harness, no privilege change, no migration application, no commit, no
deployment.

---

## 1. STATUS

**READY FOR OWNER REVIEW — 10b BOTH STEPS INCORPORATED**

The owner-approved decision — adopt **both 10b-1 and 10b-2** as a sub-item of Item 10 — is
implemented in a new v3 pair. Every statement taken from the D-3 proposal was independently
re-verified against the migration before incorporation; the nine lifecycle literals were extracted
mechanically from the migration rather than retyped.

**Stage A remains BLOCKED** until a dedicated, database-enforced read-only session is provisioned
and independently verified against all eight stop conditions. Fix 3 application still requires
separate explicit authorization.

---

## 2. SCOPE AND ARTIFACTS CREATED

| Artifact | SHA-256 | Lines |
|---|---|---|
| `docs/security/FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED_V3.md` | `27680e1e70a24facc70b68fc7e17f7118e389f055d7ed3a5bd226d65fbb3b423` | 1,432 |
| `docs/security/FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED_V3.md` | `3749c93633524669b8f6b28316d16edef7124d7762754b47b84dfac959af3a4d` | 179 |
| this report | recoverable with `sha256sum` | — |

**v3 is the only pair for execution.** The v3 operator steps point at the v3 package by exact path
and by full SHA-256, and carry **0** stale v1 or v2 execution pointers. Their "Superseded" row names
the original, v1 and v2 explicitly as audit history that must not be executed — historical
references preserved and clearly labelled as such.

### Baseline verified before editing — all matched

| Artifact | SHA-256 |
|---|---|
| `FIX3_D3_LIFECYCLE_PREFLIGHT_PROPOSED.md` | `6b7303e036e5fca33006b129e2d9a1a715d588bf454a20ec9c51d9aa60a8bbd8` |
| `FIX3_D3_REVIEW_OUTCOME.md` | `0c7d99412d892c3771a0acb6578b4f1947811cf0f9af3ff21b8b954bf3a966d8` |
| `FIX3_STAGE_A_AUDIT_CLOSURE.md` | `b0650d82c8ee92397a44e615d01b22a4750f9d216080bba9b356763b71ecd22b` |
| `FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED_V2.md` | `c2b9eaf9e14661c4a47f7eedbb77f6f9a38b4637d3c415fdc97af06f6c5aab96` |
| `FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED_V2.md` | `e5e27fc8b23f08819c3ac503b13ca25cc6631f66fddf7eba75684c1b13723542` |
| Fix 3 migration | `581926201d268d5bde34b6a6b7be4ee118bac3ed8d62ef88756e7030b2d445d5` |
| `_fix3_tenant_consistent/verification.sql` | `5c62e0155bf1d4d1d911597549d83bb252cf54b66f89ba0774070371da26601b` |

No expected path or hash differed.

### Preserved byte-for-byte — verified after editing

Originals `FIX3_PHASE98_…` (`a0327d2ae48ba3be…`) and `FIX3_PHASE100_…` (`b490c648fd174c97…`); the v1
pair (`8e751f5bf9fc5188…`, `6b11013659b66da9…`); the v2 pair (`c2b9eaf9e14661c4…`,
`e5e27fc8b23f0881…`); both D-3 artifacts; the audit closure report; the migration; the frozen
predecessor (`34dffb69d4c500d0…`); the verification SQL; the CI harness (`63e8920b916f8ca3…`).
**Thirteen artifacts, none modified.**

---

## 3. MIGRATION BRANCH AND CHECK-EXPRESSION ANALYSIS

Re-derived from `20261212000000_…_tenant_consistent.sql` directly, not from the proposal.

**Resolution and branch test**, replicated literally in 10b-1:

| Migration line | Code |
|---|---|
| `:2392` | `r_content regclass := to_regclass('public.content');` |
| `:2413-2415` | `SELECT attnum INTO a_life FROM pg_attribute WHERE attrelid = r_content AND attname = 'lifecycle_status' AND attnum > 0 AND NOT attisdropped;` |
| `:2425-2426` | `SELECT count(*) INTO v_ncons FROM pg_constraint WHERE conrelid = r_content AND contype = 'c' AND a_life = ANY (conkey);` |

All four required components are present in the migration and reproduced in 10b-1: `contype = 'c'`,
`a_life = ANY (conkey)`, `attnum > 0`, `NOT attisdropped`.

**CHECK expression added**, `:2446` — and byte-identically at `:2516`:

```
ALTER TABLE public.content ADD CONSTRAINT content_lifecycle_status_check
  CHECK (lifecycle_status IN (…nine literals…))
```

**The nine literals were extracted mechanically** from `:2446` rather than reconstructed:
`draft, generated, edited, approved, adapted, scheduled, published, archived, quality_reviewed` —
count 9, and a diff of the literal lists at `:2446` and `:2516` confirmed they are identical. The
migration's normalized comparison target is `CHECK ((lifecycle_status = ANY (ARRAY[…])))`
(`v_pre`/`v_suf`, `:2399-2400`), and comparison is on the sorted element **set** (`:2420-2423`,
`:2490-2491`), not byte order.

**Ten reachable outcomes; two issue scanning DDL; exactly one can reject a row.**

| Condition | Outcome | Scans | Fails `23514`? | Line |
|---|---|---|---|---|
| `content` absent | refuses `FIX3-LIFE-01` | no | no | `:2410` |
| `lifecycle_status` absent | refuses `FIX3-LIFE-01` | no | no | `:2416` |
| `v_ncons > 1` | refuses `FIX3-LIFE-02` | no | no | `:2428` |
| **`v_ncons = 0`** | **ADD CONSTRAINT nine-value** | **yes** | **YES** | `:2434-2450` |
| nine-value, validated | LEFT UNCHANGED | no | no | `:2493` |
| eight-value predecessor | DROP + ADD nine-value | yes | **no** | `:2498-2520` |
| key count ≠ 1 | refuses `FIX3-LIFE-03` | no | no | `:2457` |
| `NOT VALID` | refuses `FIX3-LIFE-04` | no | no | `:2463` |
| unsupported form | refuses `FIX3-LIFE-07` | no | no | `:2482` |
| supported form, unrecognised elements | refuses `FIX3-LIFE-05` | no | no | `:2522` |

**The two scanning branches are distinguished, and why they differ is stated.** The eight-to-nine
replacement cannot reject a row: nine values is a strict superset of eight, and `FIX3-LIFE-04` has
already refused if the existing CHECK were `NOT VALID`, so every surviving row provably satisfies
it. It costs scan time — relevant to section 5's lock analysis — but carries no abort risk. The
`v_ncons = 0` branch has no such guarantee, because no constraint has ever constrained the column.

**PostgreSQL CHECK semantics are respected.** A `CHECK` rejects a row only when its expression
evaluates to **FALSE**; `NULL` does not violate it. 10b-2 therefore uses `NOT IN (…)`, which yields
NULL for a NULL input and so excludes such rows — matching the constraint's own behavior. The
package states explicitly that adding `OR … IS NULL` would manufacture false positives. The
baseline's NOT NULL / default `'draft'` observation is labelled **baseline-derived, not
live-verified**, and the predicate is correct either way.

---

## 4. HOW THE FOUR VERDICTS ARE JUSTIFIED

| Verdict | When | Justification |
|---|---|---|
| **PASS** | 10b-1 count = 0 **and** 10b-2 returns zero rows | The applicable branch is the one that adds the CHECK, and no existing row evaluates the added expression to FALSE. Scoped explicitly to "as of this moment" |
| **FAIL** | 10b-1 count = 0 **and** 10b-2 returns rows | Each listed value makes `ADD CONSTRAINT` abort with `23514`. Stop and escalate; remediation is a data change authorized by no phase |
| **NOT APPLICABLE** | 10b-1 count = 1, or count > 1 | The migration either changes nothing, performs the provably-safe superset replacement, or refuses at `FIX3-LIFE-02` before touching data. In none of these can a row be rejected |
| **INCONCLUSIVE** | count NULL with `content_present` false; count NULL with `lifecycle_column_present` false; 10b-1 not run, errored or returning anything other than one interpretable row; 10b-2 errored or abandoned | The branch or the data condition cannot be established. Stop and escalate |

**No unknown or failed query can be recorded as PASS.** Four distinct INCONCLUSIVE triggers are
enumerated, and one of them is explicitly "10b-2 errored or was abandoned".

**`NOT APPLICABLE` is explicitly disclaimed as evidence about Item 6.** The package states that a
count of 1 means only that *this* sub-item has nothing to find, and that which sub-branch applies —
nine-value validated, eight-value predecessor, or one of the four refusals
`FIX3-LIFE-03/04/05/07` — is established by **Item 6**, three of whose outcomes are refusals that
stop the migration. The same caution is restated in the v3 operator steps and in the result
template.

---

## 5. STATIC VALIDATION RESULTS

No SQL was executed or database-parsed. **No runtime validation is claimed.**

| # | Check | Result |
|---|---|---|
| 1 | Migration branch and CHECK expression vs both queries | **PASS** — components and literals re-derived mechanically; 10b-1 replicates `:2413-2415` and `:2425-2426` literally |
| 2 | All nine presence/failure cases covered | **PASS** — `content` absent; column absent or dropped; no matching CHECK; eight-value; nine-value; unexpected or ambiguous constraints; violating values; NULL values; query failure or incomplete. Each maps to exactly one verdict row |
| 3 | 10b-2 cannot run unless 10b-1 establishes applicability | **PASS** — gated by "if and only if step 10b-1 returned `checks_covering_lifecycle_status = 0`", restated in the operator steps |
| 4 | All SQL read-only; no dynamic SQL, temp objects or writes | **PASS** — **0** write-position keywords in any fenced `sql` block across the whole v3 package. Both 10b blocks begin `WITH` / `SELECT`; keyword census shows only SELECT/FROM/WHERE/CASE/GROUP/ORDER. The single `SET ROLE` match in the 10b region is prose stating the prohibition |
| 5 | Item 10 approved §F query byte-for-byte vs v2 | **PASS** — extracted from both and compared: identical, 20 lines, sha256 `e02bfecd0a16729f` |
| 6 | Eleven item headings in order; roll-up `/11` | **PASS** — ITEM 1…ITEM 11 in order; `Items PASS: ___ / 11` intact. 10b is a `####` sub-heading inside Item 10, so no count changed |
| 7 | Cross-references and verdict templates agree | **PASS** — `NOT APPLICABLE`, `INCONCLUSIVE`, `10b-1`, `10b-2` all present in both package and steps; the template records 10b-1's three outputs, whether 10b-2 ran, and a four-way 10b verdict |
| 8 | Full diff inspected for unrelated changes or lost safety instructions | **PASS** — package v2→v3 is **0 lines removed, 153 added**: purely additive, three insertions (provenance row, 10b sub-item, template block). Steps v2→v3 is exactly **4 modified lines** — 8 (path+hash), 9 (superseded history), 61 (Item 10 row), 87 (template hash) — and nothing else. Safety-marker census: `Never paste` 2/2, `STOP` 3/3, `Hard prohibitions` 1/1; `**Limitations` 11→12, `**PASS` 13→15, `**INCONCLUSIVE` 12→16 — all additions, no losses |
| 9 | Hashes recalculated; originals and v2 unchanged | **PASS** — 13 preserved artifacts verified unchanged after editing |

### Unresolved limitations

All are stated inside the package rather than resolved here:

1. **Time-of-check only.** A row written between 10b-2 and the apply reintroduces the exposure. Run
   it in the same window as Item 10, immediately before any authorized application.
2. **One abort class.** 10b predicts `23514` from the no-existing-CHECK branch and nothing else. A
   10b PASS says nothing about Item 10's `23503` class or the roughly 95 other `FIX3-*` guards.
3. **It predicts the migration's branch; it does not execute it.** The migration evaluates its own
   state at apply time, which can change in between.
4. **10b-1 counts covering constraints; it does not inspect their definitions.** Item 6 remains the
   authority on the constraint's definition, and `NOT APPLICABLE` for 10b is not a pass for Item 6.
5. **10b-2 is a sequential scan** of `public.content` taking `AccessShareLock`. It blocks nothing but
   costs I/O on a large table — and only ever runs in the branch where it matters.
6. **No runtime validation.** Nothing in v3 has been executed or parsed by PostgreSQL. Correctness
   rests on static review against the migration source.

---

## 6. REQUIRED CONFIRMATIONS

| | |
|---|---|
| Approved Item 10 §F query unchanged | **YES** — byte-identical to the v2 baseline and to the original, sha256 `e02bfecd0a16729f`, and not re-stated anywhere in the new material |
| Unapproved Phase 98 FK refinement substituted | **NO** — it remains only as the clearly-labelled `NEEDS REVIEW` proposal, prohibition intact |
| Unapproved Phase 99 FK correction substituted | **NO** |
| 10b added as a sub-item, not a twelfth top-level item | **YES** — `#### ITEM 10b` inside Item 10 |
| Eleven item headings and `/11` roll-up intact | **YES** |
| Existing template fields or safety caveats removed | **NO** — additions only |
| Originals and v2 artifacts unchanged | **YES** — 13 artifacts verified |
| Production accessed | **NO** |
| SQL executed or database-parsed, including disposable databases and containers | **NO** |
| Database mutation | **NO** |
| Role provisioning, grant change, privilege change, role switching | **NO** |
| Migration applied or modified | **NO** |
| Application code or environment files changed | **NO** |
| Docker or CI harness executed | **NO** |
| Commit, push, pull request or deployment | **NO** |
| `C:\virality` accessed, traversed or modified | **NO** |
| Credentials, connection strings, tokens, secrets or secret-derived metadata printed | **NO** |

---

## 7. FINAL REPOSITORY STATE

| | |
|---|---|
| HEAD | `5604b50bdebd23efd6d040b90f5802954413b656`, detached — matches expected |
| staged | **0** |
| modified | **78** |
| untracked | **35** (+3 this task: package v3, steps v3, this report) |

Nothing staged, nothing committed. All three new artifacts are additions; no existing file was
modified. Each new path was checked against `.gitignore` before creation and is visible to git.

---

## 8. NEXT OWNER ACTION

1. **Provision and independently verify a dedicated, database-enforced read-only session** clearing
   all eight stop conditions in the v3 package's section 1 step 3. Stage A stays BLOCKED until this
   exists; there is no discipline-only route.
2. **Execute only the v3 pair** — `FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED_V3.md`
   (`27680e1e70a24fac…`) with `FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED_V3.md`
   (`3749c93633524669…`). Verify the package hash before starting. The originals, v1 and v2 are
   preserved as audit history and must not be executed.
3. **Return all eleven sanitized result blocks**, with 10b recorded under Item 10.

**Fix 3 application requires separate explicit authorization and is not addressed here.**

---

**READY FOR OWNER REVIEW — 10b BOTH STEPS INCORPORATED**
