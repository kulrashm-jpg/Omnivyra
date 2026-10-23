# FIX 3 — V5 GATE FINAL STATIC VALIDATION

Static inspection and documentation correction only. No production access, no database connection,
no SQL executed or parsed, no role provisioned, no privilege changed, no migration applied, no
commit, no deployment.

---

## 1. DISPOSITION

**BLOCKED — V5 GATE SAFETY NOT ESTABLISHED**

**The five approved changes V5-1 through V5-5 all validated as correctly implemented.** The
disposition is nonetheless BLOCKED, because validating them surfaced **three further defects in v5**,
one of which is a genuine privilege bypass and one of which could have let an operator record an
incomplete gate as satisfied. All three are corrected in a new **v6** pair, which awaits owner
confirmation of one scope extension.

So: the v5 gate is not the gate to verify. v6 is.

| ID | Defect in v5 | Impact |
|---|---|---|
| **G-1** | **All three ownership checks tested only `pg_has_role(…, 'USAGE')`.** That is **false** for a `NOINHERIT` member of an owning role — yet such a session can `SET ROLE` to the owner and then hold full ownership powers. **3d does not catch it**, because 3d scans only roles that are `rolsuper` or `rolbypassrls`, and a relation, schema or database owner need be neither. A session that is a NOINHERIT member of the owner role passed all eight conditions. | **read-only safety** |
| **G-2** | **The result template carried a stale second gate block.** Present since v1-corrected and *duplicated* from v4 onward (two `Read-only gate` headers), it declared **six** relations and omitted `can_create_roles`, database ownership and 3e entirely. An operator filling that block would have recorded an incomplete gate as satisfied. It also described the read-only transaction as "database-enforced; required" — directly contradicting the L-1 decision that it is a session safeguard. | **evidence validity** |
| **G-3** | **No aggregate-readiness rule.** V5-4 established that a stop overrides a later pass, but nothing stated that overall readiness is the *conjunction* of all mandatory conditions rather than the last answer recorded. | fail-closed completeness |

**G-2's provenance, recorded honestly.** The stale block entered at v1-corrected and survived v2 and
v3 unnoticed. My v4 edit then replaced three targeted template lines and *added* a new gate block
without removing the old one, producing the duplicate that persisted into v5. Four audits — including
two of my own — missed it. It was found here only by reading the template region in full rather than
grepping for the fields I expected to be there.

---

## 2. VERIFIED INPUT HASHES

| Artifact | SHA-256 | Status |
|---|---|---|
| `FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED_V5.md` | `2902242859b2891288784fe0113fc5323ee9a0b9c7e68ddee0447b3c7826426b` | matched |
| `FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED_V5.md` | `55823513d39c486eb77f731179cc15af155aca1db5c9b9ac904b5b5f631cb0c0` | matched |
| `FIX3_V4_GATE_AUDIT.md` | `15cf0c6c4ead65603b6ae5e7e717d65d314bf248c059e671e791e1e08f39c895` | matched |
| `FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED_V4.md` | `63498ef76eae0d7443b1cd02dbd66d9007ed54f18da4990bddb143d9c6f46e0c` | matched |
| `FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED_V4.md` | `7dc7b0863d9fce1dbd03897019eaa79e5ee53cca66f87eec43c82f39be2e548e` | matched |

HEAD `5604b50bdebd23efd6d040b90f5802954413b656`, detached, as expected. No path or hash differed.

### Corrections produced

| Artifact | SHA-256 | Lines |
|---|---|---|
| `docs/security/FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED_V6.md` | `df9672617e0f2699b91771d1e4c10e4390fbdee87a297326a343c54b8f993fa9` | 1,651 |
| `docs/security/FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED_V6.md` | `c4fcbdff98c0d20bb487e482ad4379c8e476ee3d0e001b2a3e2a14c7b408deb4` | 189 |
| this report | recoverable with `sha256sum` | — |

**v6 is the only pair for execution.** Its steps cite the v6 package by exact path and full hash,
with **0** stale v5 references; the superseded row now names the original plus v1 through v5.

---

## 3. V5-1 — `CREATEROLE` — **VALIDATED**

| Check | Evidence |
|---|---|
| Present in the role-attribute query | v5 line 81: `r.rolcreaterole AS can_create_roles` |
| Stops the gate | SC-1 bullet: *"3a reports `is_superuser = true`, or `can_create_roles = true`"* |
| A CREATEROLE role cannot pass merely for having no current privileged membership | **confirmed** — SC-1 fires on the attribute itself, independently of 3d's membership snapshot |
| Mandatory, and NULL/unavailable cannot pass | **confirmed** — 3a returns exactly one row for an existing `current_user` and `current_database()`; the general rule *"if a query errors or returns no interpretable row, record it INCONCLUSIVE"* covers the gate queries, not only the items |
| Interpretation matches the query's actual output column | **confirmed** — SC-1 names `can_create_roles`, which is the emitted alias |

No production role property was inferred from repository contents.

## 4. V5-2 — database ownership — **VALIDATED, then extended by G-1**

| Check | Evidence |
|---|---|
| The intended database's owner is identified | v5 lines 84-85: `d.datdba::regrole::text AS database_owner`, joined `WHERE d.datname = current_database()` |
| Compared with the effective session identity under role-membership semantics | `pg_has_role(current_user, d.datdba, 'USAGE')` — inheritance-aware |
| Stops the gate | SC-4 bullet includes `is_or_inherits_database_owner = true` |
| Cannot be overlooked because table and schema checks pass | **confirmed** — it is a distinct column in a distinct condition, and SC-4 is a disjunction across relation, schema and database ownership |
| Missing or ambiguous database identity | the join is on `current_database()`, which always resolves; if 3a returned no row the general no-interpretable-row rule makes it INCONCLUSIVE |
| Project identity still out-of-band | **confirmed** — SC-7 unchanged, and the package repeats that no in-SQL query establishes the project ref |

**But the comparison was incomplete — G-1.** `'USAGE'` answers *"does this session already hold the
owner's privileges"*. It does **not** answer *"can this session become the owner"*. v6 adds a
`'MEMBER'` test for all three ownership layers and widens SC-4 accordingly.

## 5. V5-3 and V5-4 — fail-closed — **VALIDATED, completed by G-3**

| Requirement | v5 | v6 |
|---|---|---|
| `UNKNOWN` for a present required relation → STOP | **PASS** — *"An `UNKNOWN` on a relation or schema that IS present is itself a STOP"* | unchanged |
| Missing evidence, NULL, query error, inaccessible catalog cannot become PASS | **PASS** — explicit per-case mapping | unchanged |
| Missing relation distinguished from present-but-unknown | **PASS** — `present` flag → `ABSENT`; NULL privilege → `UNKNOWN`; the two are named separately | unchanged |
| Every stop condition has precedence over a nominal PASS | **PASS** — the v5 precedence paragraph | unchanged |
| No later item, template or summary can override an earlier stop | **PASS** — *"whatever any other part of this package, the operator steps or the result template reports as a nominal pass"* | unchanged |
| Final verdict derived from all mandatory conditions, not the last query | **GAP (G-3)** — precedence covered override, not conjunction | **added:** *"AGGREGATE READINESS — the verdict is the conjunction, not the last answer"*, naming all eight conditions plus continuity plus the out-of-band ref plus every item verdict |

`PASS`, `FAIL`, `NOT APPLICABLE` and `INCONCLUSIVE` remain semantically distinct, and `ABSENT` and
`UNKNOWN` are distinct from all four, in the package, the steps and the checklist.

## 6. V5-5 — schema privilege inspection — **VALIDATED**

The v5 query was read in full. The `LATERAL` guard is correct:

```
LEFT JOIN LATERAL (
  SELECT has_schema_privilege(current_user, w.schema_name, 'USAGE')  AS usage_priv,
         has_schema_privilege(current_user, w.schema_name, 'CREATE') AS create_priv
   WHERE n.oid IS NOT NULL
) p ON true
```

| Check | Result |
|---|---|
| An absent schema does not invoke `has_schema_privilege` with an invalid name | **PASS** — the subquery's `WHERE n.oid IS NOT NULL` yields no row, so the function is never called; `3F000` cannot be raised |
| Absent / present-but-unknown / present-and-verified distinguished | **PASS** — `present` column, NULL privilege columns, and populated privilege columns respectively |
| Schema `CREATE` covered for both schemas | **PASS** — `create_priv`, consumed by SC-2 |
| Schema ownership covered for both | **PASS** — `is_or_inherits_schema_owner`, consumed by SC-4; **v6 adds the `MEMBER` test** |
| Effective session context | **PASS** — all tests take `current_user` |

**A syntactically successful query is not proof of complete privilege safety, and the package says
so.** It covers seven relations and two schemas; `SECURITY DEFINER` functions, event triggers, every
other object, `PUBLIC` grants and pooler behavior remain disclosed as uncovered. The excluded powers
— `rolcreatedb`, `rolreplication`, database `TEMP` — are described in the package as scope decisions
with reasons, not as evidence that the gate is universal.

---

## 7. SCOPE AND CROSS-ARTIFACT RECONCILIATION

| Check | Result |
|---|---|
| Eight stop conditions intact; no ninth introduced | **PASS** — 8 bullets in v5 and in v6; SC-4 widened, none added |
| Session continuity separate from the eight | **PASS** — under its own heading in both |
| Seven relation checks present, incl. the ledger | **PASS** |
| Both schema checks covered | **PASS** |
| Item 10 approved Phase 96 §F query byte-for-byte unchanged | **PASS** — extracted from v6 and compared: identical, 20 lines, sha256 `e02bfecd0a16729f` |
| Item 10b a sub-item; eleven-item `/11` roll-up intact | **PASS** — one `#### ITEM 10b`, 11 `### ITEM` headings, roll-up present |
| Paths, hashes, templates, verdicts and operator instructions agree | **PASS in v6.** **FAILED in v5** — that is G-2: two gate blocks, one declaring six relations |
| Excluded powers described as scope decisions | **PASS** |
| Historical artifacts unchanged | **PASS** — verified by hash after editing |
| New filenames not ignored, visible in `git status` | **PASS** — all three confirmed |

All SQL blocks across v6 contain **0** write-position keywords. No heading was lost between v5 and
v6. The v6 template now contains exactly **one** gate block, with `can_create_in_db` and the
contradictory "database-enforced; required" line gone, and the two unique fields the stale block held
— `Read-only mechanism used` and `server_version_num` — retained.

---

## 8. CHANGES FLAGGED FOR OWNER CONFIRMATION

| # | Change | Why |
|---|---|---|
| **V6-1** | **SC-4 widened** — also stops when any of `can_set_role_to_owner`, `can_set_role_to_schema_owner` or `can_set_role_to_database_owner` is true | G-1. `USAGE`-false does not mean the session cannot become the owner, and 3d cannot cover it |
| **V6-2** | **Stale template gate block removed** | G-2. It declared six relations and contradicted L-1 |
| **V6-3** | **Aggregate-readiness rule added** | G-3 |

V6-1 is the only scope extension. V6-2 and V6-3 are a correction and a completion.

---

## 9. REMAINING LIMITATIONS AND REQUIRED OWNER ACTIONS

| # | Item | Action |
|---|---|---|
| 1 | **No compliant read-only session exists** | provision it; run 3a-3f as that role, in the session that will run the items |
| 2 | **Target privileges and ownership are unknown** — the baseline holds 0 `GRANT` and 0 `OWNER TO` statements | determine by running the gate; nothing in the repository predicts it |
| 3 | **Connection mode must be established** before PID continuity means anything | session-mode or direct connection, or record the limitation |
| 4 | **Project identity is irreducibly out-of-band** | console confirmation of the ref; the PID does not close this |
| 5 | **The gate is not universal** | disclosed, with the excluded powers reasoned |
| 6 | **V6-1 to V6-3 await confirmation** | review §8 |
| 7 | **Static review cannot establish runtime privilege behavior** | only the owner-run gate can |

---

## 10. CONFIRMATIONS AND FINAL STATE

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
| untracked | **46** (+3 this validation) |

Nothing staged, nothing committed. All three new artifacts are additions; no existing file was
modified.

---

## 11. NEXT OWNER ACTION

1. **Confirm V6-1 to V6-3** (§8) — V6-1 is the scope extension.
2. **Provision the dedicated database-enforced read-only session** and verify it independently
   against all eight stop conditions, running 3a-3f **as that role, in the session that will run the
   items**.
3. **Establish the connection mode** before relying on PID continuity.
4. **Execute only the v6 pair** — `FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED_V6.md`
   (`df9672617e0f2699…`) with `FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED_V6.md` (`c4fcbdff98c0d20b…`).
   Everything earlier is audit history and must not be executed.
5. **Return all eleven sanitized result blocks**, plus the post-Item-11 PID and the connection mode.

Even once v6 is confirmed, **Stage A remains blocked** until the owner independently verifies the
intended database-enforced read-only session, the target project identity and the connection mode.
**Fix 3 application remains separately unauthorized.**

---

**BLOCKED — V5 GATE SAFETY NOT ESTABLISHED**
