# FIX 3 — L-1 / L-3 / L-5 ADOPTION AUDIT

Documentation, static SQL review and consistency validation only. No production access, no database
connection, no SQL executed or parsed, no role provisioned, no privilege changed, no migration
applied, no commit, no deployment.

---

## 1. DISPOSITION

**READY FOR OWNER REVIEW — L-1, L-3, L-5 INCORPORATED**

All three approved decisions are implemented. One genuinely new gate element — **3e**, schema-level
privileges and schema ownership — was required to make L-3 safe rather than cosmetic, and is
**flagged below for owner review** rather than folded in silently. Three stop conditions were widened
in scope and one was clarified in meaning; **no ninth condition was added and none was weakened.**

**Stage A is not ready and is not complete.** The dedicated database-enforced read-only session must
still be provisioned and independently verified. Fix 3 application requires separate explicit
authorization.

---

## 2. ARTIFACTS

### Created

| Artifact | SHA-256 | Lines |
|---|---|---|
| `docs/security/FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED_V4.md` | `63498ef76eae0d7443b1cd02dbd66d9007ed54f18da4990bddb143d9c6f46e0c` | 1,573 |
| `docs/security/FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED_V4.md` | `7dc7b0863d9fce1dbd03897019eaa79e5ee53cca66f87eec43c82f39be2e548e` | 185 |
| `docs/security/FIX3_STAGE_A_READONLY_PREREQUISITE_V2.md` | `4f8c31305cee6e6efd56d5ffc87f82761c95d5b4346f02148b17b0ec4a24aaab` | 185 |
| this report | recoverable with `sha256sum` | — |

All four paths were checked against `.gitignore` **before** creation and confirmed present in
`git status` afterwards. This is not a formality: `*_CHECKLIST.md`, `*_READINESS*.md`, `*_REPORT.md`
and `*_IMPLEMENTATION*.md` are all ignored in this repository and five earlier deliverables had to be
renamed.

**v4 is the only pair for execution.** Its steps point at the v4 package by exact path and full
hash, with **0** stale v3 references, and the superseded row names the original plus v1, v2 and v3 as
audit history.

### Baseline verified before editing — all matched

| Artifact | SHA-256 |
|---|---|
| `FIX3_STAGE_A_READONLY_PREREQUISITE.md` | `24c3b07a819e03afeb8d7dad7246f4b7cc457ddf97e15e14d67d8072b08e5ded` |
| `FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED_V3.md` | `27680e1e70a24facc70b68fc7e17f7118e389f055d7ed3a5bd226d65fbb3b423` |
| `FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED_V3.md` | `3749c93633524669b8f6b28316d16edef7124d7762754b47b84dfac959af3a4d` |
| `FIX3_D3_ITEM10B_ADOPTION.md` | `217817551d3dc3d9a9104109ae29e7a327aa6a71d4d6bed4bae6397659857a36` |

No expected path or hash differed.

### Preserved byte-for-byte, verified after editing

The v1 checklist; the v3, v2 and v1 package/steps pairs; the two originals; both D-3 artifacts; the
audit-closure report; the migration; the frozen predecessor; the verification SQL; the CI harness.
**No historical report was edited to make a later decision look like part of an earlier review.**

---

## 3. WHAT EACH DECISION CHANGED

### L-1 — SC-6 clarified

SC-6 is preserved as a stop condition; only its evidentiary meaning is pinned down.

- It now requires `transaction_read_only` **observed `on` in the actual intended session**, recorded
  against the 3f backend PID. **Issuing the statement is not the evidence; the observation is.**
- A missing, ambiguous or failed observation is STOP/INCONCLUSIVE under the existing gate.
- `default_transaction_read_only` and transaction read-only mode are **not** described as
  persistent or non-bypassable. The package states why: the parameter is `USERSET`, so any session
  may turn it off.
- The package states explicitly that **"SC-6 alone does not establish database-enforced read-only
  access"**, and classifies it as a **session safeguard** against accident.
- The distinction is preserved and sharpened: the database-enforced part is **3b, 3c and 3e** — a
  role with no write privilege, no ownership and no schema `CREATE` cannot write whatever it intends,
  because that is a catalog property rather than operator conduct.

No weakening, and no discipline-only fallback: the standing rule *"There is no discipline-only
route"* is intact.

### L-3 — migration ledger covered

Item 11's exact object was taken from the v3 package itself: **`supabase_migrations.schema_migrations`**.

- **3b (effective write privilege)** now covers **seven** relations — the six `public` ones plus the
  ledger. The relation list is driven from an explicit `VALUES` list through `to_regclass`, so every
  relation appears with a `present` flag.
- **3c (ownership)** covers the same seven, the same way.
- **3e is new**: schema `CREATE` and schema ownership for **both** `public` and
  `supabase_migrations`. A table-level check alone was insufficient — `CREATE` on a schema is a write
  capability in its own right, and a schema owner can drop objects in it. `public` was partly covered
  by 3a's `can_create_in_public`; `supabase_migrations` was covered by nothing. **This is the one
  genuinely new element and is flagged for owner review.**
- The package explains why this relation matters in particular: **writing the ledger could record
  Fix 3 as applied while the schema was never altered** — the ledger/schema desync the programme
  exists to avoid.
- **Existence is not assumed.** The `present` flag reports it; absence is recorded `ABSENT`, and if
  the relation or its schema is absent, Item 11 is INCONCLUSIVE rather than inferred away.
- **No false PASS is reachable.** The `LATERAL` subquery carries `WHERE r.rel IS NOT NULL`, so
  `has_table_privilege` is never called on a non-existent OID — which would raise — and the
  `LEFT JOIN` keeps the row visible with **NULL privileges, not `false`**. The package states that a
  NULL is `UNKNOWN` and `present = false` is `ABSENT`, and that neither may be read as "no write
  privilege".
- **Scope was not expanded beyond justification.** Seven relations and two schemas, and the explicit
  statement that the gate "is deliberately **not** a universal proof that no write path exists
  anywhere in the database" is retained.

Privilege semantics were reviewed against the supported version and the role context:
`has_table_privilege` accounts for privileges held via role membership, which role attributes do not;
`pg_has_role(…, 'USAGE')` catches ownership held through a group role; and ACL presence alone is
never treated as proof of effective access — that is why effective-privilege functions are used
rather than reading `relacl`.

### L-5 — session continuity

- **3f** records `pg_backend_pid()` immediately after the gate clears and before Item 1; a second
  capture is taken after Item 11. **The two must match.**
- Missing, failed or differing → **FAIL / INCONCLUSIVE**, evidence collection stops for review.
  Results from different sessions must never be combined and labelled one session's evidence.
- The PID is described as a **non-secret continuity marker only** — not proof of project identity,
  privilege safety or read-only enforcement.
- **PID equality does not prove the same target project**, stated in the package, the steps and the
  checklist. The out-of-band project-ref check (SC-7) is preserved unchanged.
- The prohibition on recording host, port, connection strings, credentials or tokens is preserved and
  restated in the template line itself.
- **Connection-mode limitation stated.** In a transaction-pooling mode consecutive transactions may be
  served by different backends, so a PID observed at 3f need not belong to the backend serving a later
  statement and equality is not evidence of continuity. If the mode is a transaction pooler, or cannot
  be determined, continuity is **INCONCLUSIVE by construction**: stop and refer to the owner or
  platform administrator. No continuity is claimed that the connection mode cannot support.
- A precision point is recorded rather than glossed: if all eleven items genuinely run inside one
  transaction the PID cannot change, so a match is expected — the value of the check is that a
  **mismatch** detects a reconnection, which would also have silently discarded the read-only
  transaction and the gate's findings.

---

## 4. PRIVILEGE AND OWNERSHIP SCOPE, AS REVISED

| Check | Scope |
|---|---|
| 3a role attributes | `rolsuper`, `rolbypassrls`, `rolinherit`, database `CREATE`, `CREATE` on `public`, `server_version_num`, `transaction_read_only` |
| 3b effective write privilege | **seven relations**: `public.content_quality`, `public.content_block`, `public.content_recommendation`, `public.content_approval_history`, `public.content`, `public.user_company_roles`, **`supabase_migrations.schema_migrations`** |
| 3c ownership | the same seven |
| 3d escalation | membership in any `rolsuper` or `rolbypassrls` role |
| **3e schema level (new)** | `public` **and** `supabase_migrations`: `USAGE`, `CREATE`, schema owner, inherited schema owner |
| 3f continuity | backend PID, start and end |
| **Explicitly not covered** | `SECURITY DEFINER` functions, event triggers, every object outside the seven relations and two schemas, `PUBLIC` grants, pooler/middleware behavior |

---

## 5. CHANGES FLAGGED FOR OWNER REVIEW

Per the brief, these are identified rather than quietly adopted.

| # | Change | Rationale |
|---|---|---|
| **R-1** | **New gate check 3e** — schema `CREATE` and schema ownership for `public` and `supabase_migrations` | Without it, L-3 would be cosmetic: a role blocked from writing the ledger table could still create objects in, or drop, its schema. SC-2 and SC-4's wording was extended to consume 3e's output rather than adding a ninth condition |
| **R-2** | **SC-2 scope extension** — from `CREATE` on `public` to `CREATE` on either schema | same reason |
| **R-3** | **SC-3 / SC-4 scope extension** — from six relations to seven | the L-3 decision itself |
| **R-4** | **SC-6 clarification** — "established" now means *observed `on` in the intended session*, recorded against the PID | the L-1 decision. The condition is unchanged; only its evidence standard is pinned |
| **R-5** | **Session continuity is recorded separately from the eight**, not as a ninth stop condition | it is evidence about the collection process rather than a property of the session's privileges. Treating it as a ninth condition would have changed the eight-condition structure the owner approved |

None weakens an existing condition. R-1 is the only new element.

---

## 6. STATIC VALIDATION RESULTS

No SQL was executed or database-parsed. **No database verification, runtime validation or production
evidence is claimed.**

| # | Check | Result |
|---|---|---|
| 1 | Baseline hashes | **PASS** — 4/4 matched |
| 2 | SQL and instructions for the three changes inspected | **PASS** — 3b/3c rewritten to seven relations via `VALUES`+`to_regclass`; 3e and 3f added; SC-6 wording replaced; template extended |
| 3 | Ledger in both privilege and ownership checks | **PASS** — present in 3b, in 3c, and both schemas in 3e; referenced in the steps and the checklist |
| 4 | Absent relations, unknown privileges, insufficient visibility, query failure cannot produce a false PASS | **PASS** — `present` flag per relation; NULL privileges rather than `false`; `LATERAL ... WHERE rel IS NOT NULL` prevents a raise on a missing OID; explicit "NULL = `UNKNOWN`, `present = false` = `ABSENT`, neither is a pass"; absent schema → Item 11 INCONCLUSIVE |
| 5 | SC-6's observed session state vs actual enforcement | **PASS** — "observed `on`" required; "session safeguard" framing; "SC-6 alone does not establish database-enforced read-only access"; enforcement attributed to 3b/3c/3e |
| 6 | PID continuity rules and pooling qualifications | **PASS** — start/end capture, must-match rule, FAIL/INCONCLUSIVE on mismatch or absence, transaction-pooling INCONCLUSIVE by construction, equality disclaimed as identity proof |
| 7 | Item 10 approved §F query byte-for-byte vs baseline | **PASS** — extracted from v3 and v4 and compared: identical, 20 lines, sha256 `e02bfecd0a16729f` |
| 8 | Eleven item headings, Item 10b, `/11` roll-up | **PASS** — 11 `### ITEM` headings, 1 `#### ITEM 10b`, roll-up intact |
| 9 | Package and step references use correct new paths and full hashes | **PASS** — steps v4 cite the v4 path once and the full v4 hash; 0 stale v3 execution pointers; superseded row lists original, v1, v2, v3 |
| 10 | Diffs reviewed for accidental changes, missing caveats, stale instructions | **PASS** — package v3→v4 confined to the gate block (85-166) and one template block (1349-1351) plus the inserted provenance row; steps v3→v4 is 5 hunks, all intended (path+hash, superseded, row 3, template, template hash). No heading lost; all safety markers retained |
| 11 | New files visible in `git status` | **PASS** — all four confirmed `??` |
| 12 | Hashes recomputed, final state recorded | **PASS** — §2 and §8 |

Two grep checks initially read `0` for phrases that are in fact present; both were line-wrap
artifacts in the check itself, confirmed by wrap-tolerant re-matching. The content was never missing.
Recorded because a silent false negative in a validation script is the kind of thing that otherwise
becomes a false claim.

---

## 7. UNRESOLVED ISSUES AND REQUIRED OWNER ACTION

| # | Issue | Required action |
|---|---|---|
| 1 | **No compliant read-only session exists.** The standing prerequisite, not a defect | Provision and independently verify it; run 3a-3f as that role in the session that will run the items |
| 2 | **R-1 through R-5** are flagged changes | Review and confirm, in particular R-1, the new 3e check |
| 3 | **L-4 persists** — session-to-target binding is irreducibly out-of-band. L-5's PID does **not** close it | None now; SC-7 remains the only identity check and is out-of-band by necessity |
| 4 | **L-6 persists** — the committed baseline holds **0 `GRANT`** and **0 `OWNER TO`** statements, so nothing in this repository predicts whether an existing role can satisfy SC-3, SC-4 or 3e | Determine it by running the gate |
| 5 | **L-7 (new, from L-5)** — connection mode governs whether PID continuity means anything | Use a session-mode or direct connection, or record the limitation and refer to a platform administrator |
| 6 | **The gate is not a universal proof** that no write path exists | None; disclosed in the package and retained |

---

## 8. CONFIRMATIONS AND FINAL STATE

| | |
|---|---|
| Production accessed or any database connection | **NO** |
| SQL executed or database-parsed, including disposable databases and containers | **NO** |
| Role provisioned, grant changed, privilege changed, role switched | **NO** |
| Migration applied or modified | **NO** |
| Application code or environment files changed | **NO** |
| Docker, container or CI harness executed | **NO** |
| Commit, push, pull request or deployment | **NO** |
| `C:\virality` accessed, traversed or modified | **NO** |
| Credentials, connection strings, tokens, secrets or secret-derived metadata printed | **NO** |
| All previous artifacts unchanged | **YES** — verified by hash after editing |
| Stage A run, ready or complete | **NO** |

| | |
|---|---|
| HEAD | `5604b50bdebd23efd6d040b90f5802954413b656`, detached — matches expected |
| staged | **0** |
| modified | **78** |
| untracked | **40** (+4 this task) |

Nothing staged, nothing committed. All four new artifacts are additions; no existing file was
modified.

---

## 9. NEXT OWNER ACTION

1. **Review R-1 to R-5**, especially the new 3e schema check.
2. **Provision the dedicated database-enforced read-only session** and verify it independently
   against all eight stop conditions, using gate queries 3a-3f **as that role, in the session that
   will run the items**.
3. **Execute only the v4 pair** — `FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED_V4.md`
   (`63498ef76eae0d74…`) with `FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED_V4.md` (`7dc7b0863d9fce1d…`).
   Everything earlier is audit history and must not be executed.
4. **Return all eleven sanitized result blocks**, plus the post-Item-11 PID and the connection mode.

**Fix 3 application requires separate explicit authorization.**

---

**READY FOR OWNER REVIEW — L-1, L-3, L-5 INCORPORATED**
