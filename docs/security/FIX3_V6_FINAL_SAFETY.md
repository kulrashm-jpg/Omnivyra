# FIX 3 — V6 GATE FINAL SAFETY VALIDATION

Static inspection and documentation correction only. No production access, no database connection,
no SQL executed or parsed, no role provisioned, no privilege changed, no migration applied, no
commit, no deployment. **No runtime validation is claimed.**

---

## 1. DISPOSITION

**BLOCKED — V6 GATE SAFETY NOT ESTABLISHED**

**V6-1, V6-2 and V6-3 are all implemented as reported.** The disposition is BLOCKED because
validating them surfaced **four further defects in v6**, all corrected in a new **v7** pair.

| ID | Defect in v6 | Impact |
|---|---|---|
| **H-1** | **The package's result template had no fields for V6-1's three `can_set_role_to_*_owner` columns.** The queries emit them and SC-4 stops on them, but the template the operator is told to fill had nowhere to record them — while the *operator-steps* template did. A reviewer could not confirm SC-4's new disjuncts were ever checked, and the two templates disagreed. | evidence validity |
| **H-2** | **The aggregate rule was silent on `NOT APPLICABLE`** — zero occurrences. With PASS, FAIL and INCONCLUSIVE named but NOT APPLICABLE unaddressed, it was open to being read as a pass. | fail-closed completeness |
| **H-3** | **No aggregate-verdict field existed anywhere.** V6-3 created the rule in prose; neither template gave the operator a place to record the resulting verdict. The same class of defect as L-5 — an instruction with no evidence. | evidence validity |
| **H-4** | **Section 1's "Stop conditions for the owner" was a second, stale restatement of the gate.** It said **six** relations; omitted `CREATEROLE`, `CREATE` on `supabase_migrations`, schema ownership, database ownership and the `SET ROLE` paths; and called the read-only transaction **"database-enforced"** — contradicting the L-1 decision, in a live instruction rather than a historical quote. | **safety-relevant consistency** |

**H-4 is the same defect class as G-2, and my v6 fix caught only one of its two instances.** G-2
removed the stale *template* gate block; this stale *prose* restatement survived. The root cause is
restating the stop conditions in more than one place, so v7 does not merely update the copy — **it
replaces it with a cross-reference to the single authoritative list**, which removes the mechanism
that produced both instances.

Two further errors were mine, in assembling v7 itself, and were caught before installation: a lost
blank line that would have merged two paragraphs, and an orphaned duplicate line left by a splice
range that stopped one line short of the paragraph it was replacing. Both were found by reading the
assembled output rather than trusting the splice.

---

## 2. VERIFIED BASELINE

| Artifact | SHA-256 | Status |
|---|---|---|
| `FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED_V6.md` | `df9672617e0f2699b91771d1e4c10e4390fbdee87a297326a343c54b8f993fa9` | matched |
| `FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED_V6.md` | `c4fcbdff98c0d20bb487e482ad4379c8e476ee3d0e001b2a3e2a14c7b408deb4` | matched |
| `FIX3_V5_FINAL_VALIDATION.md` | `ed38d141bc8b52b9011285ed4e14b2ea7327c5c34413735564e39e0115d297f0` | matched |

HEAD `5604b50bdebd23efd6d040b90f5802954413b656`, detached, as expected.

### Corrections produced

| Artifact | SHA-256 | Lines |
|---|---|---|
| `docs/security/FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED_V7.md` | `78ce050f0d351fc135d79b2a73f83ed09b3e38dff3fd1ed5231dcba358cbd40c` | 1,670 |
| `docs/security/FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED_V7.md` | `f7fb70d727ec7232c8f2ccc7c89ecc2f0da96b5dd9e26d2ce6326d65d74882eb` | 193 |
| this report | recoverable with `sha256sum` | — |

**v7 is the only pair for execution.** Its steps cite the v7 package by exact path and full hash,
with **0** stale v6 references; the superseded row names the original plus v1 through v6.

---

## 3. V6-1 — OWNERSHIP AND `SET ROLE` PATHS — **VALIDATED**

Six tests, at exact v6 lines:

| Layer | `USAGE` | `MEMBER` |
|---|---|---|
| database owner | `:86` | `:87` |
| relation owner | `:177` | `:178` |
| schema owner | `:216` | `:217` |

| Check | Result |
|---|---|
| Covers relation, schema and **target database** owners | **PASS** — all three layers |
| Target-database binding | **PASS** — `CROSS JOIN pg_database d` at `:89` with `d.datname = current_database()` at `:91`, so the owner read is of *this* database |
| A `NOINHERIT` member who can `SET ROLE` cannot pass on `USAGE = false` | **PASS** — SC-4 is a disjunction that now includes all three `can_set_role_to_*_owner` columns |
| Effective role and membership semantics correct | **PASS** — both functions take `current_user`; `pg_has_role` is inheritance-aware |
| Missing / NULL / inaccessible / ambiguous | **PASS** — `pg_has_role` is strict, so a NULL owner yields NULL rather than raising; NULL is `UNKNOWN`, and UNKNOWN on a present object is itself a STOP |
| Does membership actually confer the relevant ownership powers? | **PASS, and the semantics are the right way round.** PostgreSQL's ownership check is an *inheriting* privilege test, so an `INHERIT` member passes it directly — which `USAGE` detects. A `NOINHERIT` member fails it directly but can `SET ROLE` to the owner and then **is** the owner — which only `MEMBER` detects. `USAGE` ⊆ `MEMBER`, so `MEMBER` alone would suffice for the stop decision; reporting both is diagnostic, distinguishing "already holds" from "can assume" |
| All three layers in the output **and the result template** | **FAILED in v6 — that is H-1.** Present in the queries and in the steps template; **absent from the package template**. Fixed in v7 |
| Interpretation prevents a false PASS | **PASS** in the stop conditions; **incomplete in v6's template**, since an unrecordable value cannot be reviewed |

**`MEMBER` is not assumed to establish every privilege property.** It establishes that the session
can assume the owning role. It does not establish that the session currently holds that role's
privileges — which is why both columns are reported. v7 is deliberately **conservative**: it will
stop a `NOINHERIT` member that would be harmless if it complied with the package's `SET ROLE`
prohibition. For a safety gate that is the correct direction of error.

---

## 4. V6-2 — SINGLE AUTHORITATIVE GATE TEMPLATE — **VALIDATED, with H-4 outstanding**

The whole template region was read in full, not grepped for expected fields.

| Check | v6 | v7 |
|---|---|---|
| Exactly one `Read-only gate` result block | **PASS** — 1 | 1 |
| Stale six-relation description in the template | **PASS** — none | none |
| `can_create_in_db` gone | **PASS** — 0 | 0 |
| Contradictory "database-enforced; required" template line gone | **PASS** — the only remaining occurrence is inside the v6 provenance row, *quoting* what the stale block said; that is legitimate history, not a live instruction | same |
| Unique fields from the removed block retained | **PASS** — `Read-only mechanism used` and `server_version_num` both present | same |
| All eight stop conditions represented in the block | **PASS** — SC-1 `is_superuser`/`can_create_roles`; SC-2 `can_create_in_public` + 3e `create_priv`; SC-3 the seven relations incl. the ledger; SC-4 ownership; SC-5 `3d escalation rows`; SC-6 observed `on`; SC-7 out-of-band ref; SC-8 `server_version_num` | same |
| Role, database, table, schema, ownership, escalation, session, project-identity and connection-mode evidence all present | **PASS** | same, **plus the three `can_set_role` fields and the aggregate verdict** |
| Package, steps, checklist and templates agree | **FAILED — H-1** (templates disagreed on `can_set_role`) and **H-4** (a second stale stop-condition list in section 1 prose) | **PASS** |

**H-4 in detail.** v6 lines 421-431 restated the gate as: *"any stop condition in preamble step 3 is
triggered (superuser; `CREATE` on `public`; any write privilege on the six relations; ownership or
inherited ownership of any of them; any escalation row)"* and *"a **database-enforced** read-only
transaction cannot be established"*. Both clauses are wrong as of v4/v5/v6, and an operator reading
section 1 before reaching step 3 would take them as the gate. v7 replaces the restatement with a
cross-reference and says why.

---

## 5. V6-3 — AGGREGATE READINESS — **VALIDATED, completed by H-2 and H-3**

| Requirement | v6 | v7 |
|---|---|---|
| Readiness is the conjunction of every mandatory condition | **PASS** — names all eight, plus continuity, plus the out-of-band ref, plus every item verdict | unchanged |
| A nominal PASS cannot override a stop condition | **PASS** — the v5 precedence paragraph plus the v6 rule | unchanged |
| …nor missing/incomplete evidence, UNKNOWN-on-present, failed privilege checks, unverified project identity, unverified or incompatible connection mode, failed PID continuity | **PASS** — each is named as making the aggregate not ready | unchanged |
| Handles PASS, FAIL, NOT APPLICABLE and INCONCLUSIVE consistently | **GAP (H-2)** — NOT APPLICABLE unmentioned | **added:** PASS satisfies; FAIL and INCONCLUSIVE make it not ready; **NOT APPLICABLE is not a PASS**, admissible only where a check's approved semantics define it — **Item 10b alone** at present — and anything else that is neither PASS nor FAIL nor a defined NOT APPLICABLE is INCONCLUSIVE |
| NOT APPLICABLE never overrides a separate stop condition | **partly** — stated for Item 10b vs Item 6 only | **stated generally:** it never overrides, satisfies or downgrades a separate stop condition, and never substitutes for evidence another condition requires |
| The verdict is not determined by the last query or last field filled | **PASS** in prose — *"never read off the most recent query, the last item completed, or the roll-up line alone"* | unchanged, **and now has a field marked "fill LAST"** |
| A place to record the aggregate verdict | **GAP (H-3)** — none | **added** to both templates: four conjunct checkboxes and an `AGGREGATE VERDICT: [ ] READY [ ] NOT READY` |

---

## 6. FULL-PACKAGE REGRESSION — v7

| Check | Result |
|---|---|
| Exactly eight stop conditions; none added or weakened | **PASS** — 8 bullets |
| Session continuity separate from the eight | **PASS** |
| All seven relations incl. `supabase_migrations.schema_migrations` | **PASS** |
| `CREATEROLE`, database ownership, schema `CREATE`, schema ownership, escalation paths | **PASS** — all present; 3 `USAGE` + 3 `MEMBER` ownership tests |
| Item 10 approved Phase 96 §F query byte-for-byte unchanged | **PASS** — identical, 20 lines, sha256 `e02bfecd0a16729f` |
| Item 10b remains a sub-item | **PASS** — one `#### ITEM 10b` |
| Eleven top-level item headings and `/11` roll-up | **PASS** |
| Hashes and cross-references correct | **PASS** — v7 steps cite the v7 path and full hash, 0 stale v6 pointers, six revision rows newest-first |
| No unrelated content or safety caveat lost | **PASS** — 26 headings in v6 and v7, **0 lost**; diff is 7 hunks, 9 lines removed / 28 added, all within the four targeted regions |
| New reports not ignored and visible in `git status` | **PASS** |
| No write-position keyword in any SQL block | **PASS** — 0 |

---

## 7. REMAINING DEFECTS AND OWNER PREREQUISITES

No further defect was found in v7 by this audit. Standing prerequisites, unchanged:

| # | Item | Action |
|---|---|---|
| 1 | **No compliant read-only session exists** | provision it; run 3a-3f as that role, in the session that will run the items |
| 2 | **Target privileges and ownership unknown** — the baseline holds 0 `GRANT` and 0 `OWNER TO` statements | determine by running the gate |
| 3 | **Connection mode must be established** before PID continuity means anything | session-mode or direct connection, or record the limitation |
| 4 | **Project identity is irreducibly out-of-band** | console confirmation; the PID does not close this |
| 5 | **The gate is not universal** | disclosed, with excluded powers reasoned |
| 6 | **v7's four corrections await confirmation** | H-1 to H-4; none is a scope extension — H-1 and H-3 add fields, H-2 completes a rule, H-4 replaces a stale copy with a reference |
| 7 | **Static review cannot establish runtime privilege behavior** | only the owner-run gate can |

---

## 8. CONFIRMATIONS AND FINAL STATE

| | |
|---|---|
| Production access or connection | **NO** |
| SQL executed or database-parsed, including disposable databases and containers | **NO** |
| Role provisioning, grant change, privilege change, role switching | **NO** |
| Migration applied or modified | **NO** |
| Application code or environment files changed | **NO** |
| Docker, container or CI harness executed | **NO** |
| Commit, push, pull request or deployment | **NO** |
| `C:\virality` accessed, traversed or modified | **NO** |
| Credentials, connection strings, tokens, secrets or secret-derived metadata printed | **NO** |
| Historical artifacts unchanged | **YES** |
| Stage A run, ready or complete | **NO** |

| | |
|---|---|
| HEAD | `5604b50bdebd23efd6d040b90f5802954413b656`, detached |
| staged | **0** |
| modified | **78** |
| untracked | **49** (+3 this validation) |

Nothing staged, nothing committed. All three new artifacts are additions; no existing file modified.

---

## 9. NEXT OWNER ACTION

1. **Confirm the four v7 corrections** (§1). None extends the gate's scope.
2. **Provision the dedicated database-enforced read-only session** and verify it independently
   against all eight stop conditions, running 3a-3f **as that role, in the session that will run the
   items**.
3. **Establish the connection mode** before relying on PID continuity.
4. **Execute only the v7 pair** — `FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED_V7.md`
   (`78ce050f0d351fc1…`) with `FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED_V7.md` (`f7fb70d727ec7232…`).
   Everything earlier is audit history and must not be executed.
5. **Return all eleven sanitized result blocks**, plus the post-Item-11 PID, the connection mode and
   the aggregate verdict.

Stage A remains blocked until the intended database-enforced read-only session, the target project
identity and the connection mode are independently verified by the owner. **Fix 3 application
remains separately unauthorized.**

---

**BLOCKED — V6 GATE SAFETY NOT ESTABLISHED**
