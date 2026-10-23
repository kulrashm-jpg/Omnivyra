# FIX 3 — V4 READ-ONLY GATE SAFETY AUDIT

Independent static audit of the v4 Stage A package, operator steps and prerequisite checklist. No
production access, no database connection, no SQL executed or parsed, no role provisioned, no
privilege changed, no migration applied, no commit, no deployment.

---

## 1. DISPOSITION

**READY FOR OWNER REVIEW — CORRECTIONS REQUIRED BEFORE VERIFICATION**

The audit found **five defects in v4**, two of them affecting read-only safety. All five are
corrected in a new v5 pair. Two of the corrections widen the scope of an existing stop condition and
are **flagged for owner confirmation** rather than adopted silently.

A static audit cannot establish the target's real privileges or connection behavior. **Stage A
remains blocked** until the owner independently verifies the intended database-enforced read-only
session, the project identity and the connection mode. Fix 3 application remains separately
unauthorized.

### Findings

| ID | Defect | Impact | Fixed in v5 |
|---|---|---|---|
| **F-1** | **`rolcreaterole` was never checked.** 3d observes only *current* membership in privileged roles. A `CREATEROLE` role can create and alter non-superuser roles and grant role membership — so it can **manufacture** the very escalation path 3d samples, including altering a write-capable role and connecting as it. Such a role passed all eight conditions. | **read-only safety** | yes — added to 3a and to SC-1 |
| **F-2** | **Database ownership was never checked.** 3c covers relation ownership and 3e schema ownership, but nothing observed `pg_database.datdba`. A database owner holds `ALTER DATABASE` and `DROP DATABASE` — a destructive DDL path outside every table and schema ACL, which is exactly the class the gate claims to bound. | **read-only safety** | yes — added to 3a and to SC-4 |
| **F-3** | **The v4 3e query would have errored on an absent schema, and could not answer its own template field.** It selected from `pg_namespace` directly, so an absent schema produced *no row* — yet the result template asks for a `present` value. Worse, listing both names and calling `has_schema_privilege(name, …)` unconditionally **raises `3F000`** on an unknown schema, so the item would fail outright rather than report absence. | **evidence validity** | yes — 3e is now `VALUES`-driven with a `LATERAL` guard and an explicit `present` column |
| **F-4** | **`UNKNOWN` on a *present* relation was an annotation, not a stop.** v4 said "a NULL privilege is never a pass" and told the operator to record `UNKNOWN` — but no stop condition fired on it, so the gate could be walked past with a required property unestablished. | **fail-closed** | yes — `UNKNOWN` on a present relation or schema is now itself a STOP |
| **F-5** | **No precedence rule existed.** Nothing in the package, steps or checklist stated that a stop condition overrides a nominal pass recorded elsewhere. Zero occurrences across all three artifacts. | documentation consistency, with safety consequences | yes — an explicit precedence rule is added |

**F-3 deserves a note on how it was found.** My first draft of the v5 correction added the `present`
column but still called `has_schema_privilege` for every name in the list — reproducing the raise. It
was caught before installation and guarded with `LATERAL`, the same pattern 3b already used.

---

## 2. VERIFIED BASELINE

| Artifact | SHA-256 | Status |
|---|---|---|
| `FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED_V4.md` | `63498ef76eae0d7443b1cd02dbd66d9007ed54f18da4990bddb143d9c6f46e0c` | matched |
| `FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED_V4.md` | `7dc7b0863d9fce1dbd03897019eaa79e5ee53cca66f87eec43c82f39be2e548e` | matched |
| `FIX3_STAGE_A_READONLY_PREREQUISITE_V2.md` | `4f8c31305cee6e6efd56d5ffc87f82761c95d5b4346f02148b17b0ec4a24aaab` | matched |
| `FIX3_L1_L3_L5_ADOPTION.md` | `63a41a0958f37a5e2380e3b4c5f05ecb24ebecc90c4f374ea0944cb6904f47eb` | matched |

No path or hash differed. HEAD `5604b50bdebd23efd6d040b90f5802954413b656`, detached, as expected.

### Corrections produced

| Artifact | SHA-256 | Lines |
|---|---|---|
| `docs/security/FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED_V5.md` | `2902242859b2891288784fe0113fc5323ee9a0b9c7e68ddee0447b3c7826426b` | 1,640 |
| `docs/security/FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED_V5.md` | `55823513d39c486eb77f731179cc15af155aca1db5c9b9ac904b5b5f631cb0c0` | 187 |
| this report | recoverable with `sha256sum` | — |

**v5 is the only pair for execution.** Its steps cite the v5 package by exact path and full hash,
with **0** stale v4 references; the superseded row now names the original plus v1, v2, v3 and v4.

---

## 3. SECTION 2 — EFFECTIVE PRIVILEGE AND OWNERSHIP GATE

Audited against the actual SQL, not the report.

| Required coverage | v4 | v5 |
|---|---|---|
| Role attributes | `rolsuper`, `rolbypassrls`, `rolinherit` | **plus `rolcreaterole`** |
| Database-level privileges | `has_database_privilege(…,'CREATE')` | unchanged, **plus database ownership via `datdba`** |
| Effective table write privileges, incl. inherited membership | 3b, `has_table_privilege` over 7 relations | unchanged |
| Ownership paths | 3c relations, 3e schemas | **plus database owner** |
| Role escalation / assuming privileged roles | 3d current membership | unchanged, **but F-1's gap closed at its source** |
| Schema `USAGE`, `CREATE`, ownership for `public` and `supabase_migrations` | 3e | **plus `present`, and guarded against raising** |
| All seven relations incl. the ledger | yes | yes |
| Missing relations and missing evidence | `present` flag, NULL-not-false | **plus UNKNOWN-is-STOP** |
| Table vs schema vs ownership vs database-level powers | three layers | **four layers, all distinguished** |

### Could a misleading PASS still occur?

| Scenario | v4 | v5 |
|---|---|---|
| Relation absent | `present=false`, NULL privileges — handled | handled |
| Incomplete evidence for the inspecting role | recorded `UNKNOWN`, **no stop** | **STOP** |
| Privilege function errors or returns NULL | `LATERAL` guard prevents the raise; NULL recorded | same, **plus STOP on a present object** |
| Privileges inherited through membership | `has_table_privilege` is inheritance-aware | same |
| Role owns a relation or schema | 3c / 3e | same |
| Role owns the **database** | **not detected** | **detected** |
| Role can escalate to a privileged identity | 3d, snapshot only | **`CREATEROLE` now also stops** |
| Database-level write/DDL path outside table ACLs | only `CREATE`-schema | **plus database ownership** |

**Deliberate omissions, now recorded in the package as choices rather than oversights:**
`rolcreatedb` governs creating *other* databases and opens no path into this one; `rolreplication`
is a read path; `has_database_privilege(…,'TEMP')` permits temporary objects, which cannot alter
application data, are blocked by a read-only transaction, and are separately forbidden by the
package.

**No inference was drawn about the target's real privileges.** The committed baseline contains **0
`GRANT`** and **0 `OWNER TO`** statements, so whether any existing role satisfies the gate is unknown
until independently verified. That limitation is restated, not resolved.

---

## 4. SECTION 3 — SC-6

| Requirement | Result |
|---|---|
| Requires `transaction_read_only` **observed `on` in the actual intended session** | **PASS** — the wording is explicit and appears in the package, the steps and the checklist |
| Observation recorded against the intended session | **PASS** — tied to the 3f backend PID |
| Missing or failed observation cannot pass | **PASS** — STOP/INCONCLUSIVE under the existing gate |
| Explicitly described as a session safeguard | **PASS** — and the reason is given: `default_transaction_read_only` is `USERSET`, so any session may turn it off |
| Effective privilege and ownership remain separate | **PASS** — enforcement attributed to 3b, 3c, 3e, and now the database-ownership check |
| No discipline-only fallback | **PASS** — the standing rule is intact in all three artifacts |
| Contradictory wording across artifacts | **none found.** The steps carry the shorter form "session safeguard, not the enforcement"; the package carries the full "SC-6 alone does not establish database-enforced read-only access". Consistent in substance |

---

## 5. SECTION 4 — SESSION BINDING AND CONNECTION MODE

| Requirement | Result |
|---|---|
| Initial PID captured before Item 1 | **PASS** — 3f, immediately after the gate clears |
| Final PID captured after Item 11 | **PASS** |
| Missing, failed or mismatched cannot pass | **PASS** — FAIL/INCONCLUSIVE, collection stops for review |
| PID equality not presented as proof of project identity | **PASS** — stated in all three artifacts |
| Project identity independently verified out-of-band | **PASS** — SC-7 unchanged; no in-SQL substitute offered |
| Pooling or any mode invalidating continuity → STOP/INCONCLUSIVE | **PASS** — transaction-pooling is INCONCLUSIVE **by construction** |
| Connection mode must be established, not guessed | **PASS** — an `unknown` mode is INCONCLUSIVE, and the template forces a choice |
| Instructions do not require or encourage pasting connection strings, host/port, credentials, tokens or secrets | **PASS** — prohibited, and the prohibition is restated on the template line itself |

**Are the PID observations sufficient for the stated claim?** They are sufficient for what the
package claims and no more, and the package does not overstate them. What they establish: a
**reconnection** between the gate and the items did not occur — which matters because a reconnection
would also have silently discarded the read-only transaction and the gate's findings. What they do
not establish: project identity, privilege safety, or read-only enforcement. The package also records
the precision point that within a single transaction the PID cannot change, so a match is expected
and a **mismatch is the signal**.

---

## 6. SECTION 5 — FAIL-CLOSED BEHAVIOR

| Input | v5 handling |
|---|---|
| `false` | the pass value for a privilege or ownership column |
| `NULL` | `UNKNOWN`. **On a present relation or schema it is now a STOP** (F-4) |
| Empty result set | 3d: the pass condition. 3e: an absent schema is `ABSENT`, never clean |
| Missing relation | `present = false` → `ABSENT`; privilege columns are not evidence |
| Query error | `INCONCLUSIVE`, stop and escalate |
| Inaccessible catalogs | `INCONCLUSIVE` — no item infers from an unreadable catalog |
| Ambiguous result | `INCONCLUSIVE`; "anything other than one interpretable row" is named explicitly |
| Missing start/end session observation | continuity **FAIL/INCONCLUSIVE**, collection stops |
| Unverified project identity | SC-7 STOP |
| Unknown connection mode | continuity **INCONCLUSIVE** |

`PASS`, `FAIL`, `NOT APPLICABLE` and `INCONCLUSIVE` remain semantically distinct wherever used, and
`ABSENT` and `UNKNOWN` are distinct from all four. **Precedence is now explicit (F-5):** a stop
condition overrides any nominal pass recorded elsewhere, and is never downgraded because the
remaining evidence looks complete.

---

## 7. SECTION 6 — CROSS-ARTIFACT INTEGRITY

| Check | Result |
|---|---|
| Package, steps, checklist and adoption audit agree | **PASS** — the two new elements are echoed in the steps' pre-start row and template |
| Seven-relation scope consistently described | **PASS** |
| Eight stop conditions preserved, not weakened | **PASS** — 8 bullets; two widened in v5, none weakened |
| No unapproved ninth condition | **PASS** — session continuity is recorded *separately from the eight*, by design |
| Item 10 approved Phase 96 §F query byte-for-byte unchanged | **PASS** — extracted from v5 and compared: identical, 20 lines, sha256 `e02bfecd0a16729f` |
| Item 10b remains a sub-item | **PASS** — one `#### ITEM 10b`, no twelfth top-level item |
| Eleven item headings and `Items PASS: ___ / 11` | **PASS** |
| References, version labels and hashes correct | **PASS** — v5 steps cite the v5 path and full hash; 0 stale v4 pointers; four revision rows newest-first |
| Historical artifacts unchanged | **PASS** — verified by hash after editing |
| New filenames not ignored and visible in `git status` | **PASS** — all three confirmed `??` |

No heading was lost between v4 and v5. All SQL blocks across v5 contain **0** write-position
keywords.

---

## 8. CHANGES FLAGGED FOR OWNER CONFIRMATION

| # | Change | Why |
|---|---|---|
| **V5-1** | **SC-1 widened** — also stops on `can_create_roles = true` | F-1. Without it a `CREATEROLE` role passes the gate while retaining a route to a write-capable identity |
| **V5-2** | **SC-4 widened** — also stops on `is_or_inherits_database_owner = true` | F-2. Database ownership is a DDL path outside every table and schema ACL |
| **V5-3** | **UNKNOWN on a present object is a STOP** | F-4. An unestablished property is not an established absence |
| **V5-4** | **Explicit precedence rule** | F-5. Required so a nominal item PASS cannot be read as overriding a gate stop |
| **V5-5** | **3e rewritten** — `VALUES`-driven, `LATERAL`-guarded, explicit `present` | F-3. The v4 form would have errored on an absent schema |

None weakens an existing condition. V5-1 and V5-2 are scope extensions; V5-3 to V5-5 are fail-closed
and correctness fixes.

---

## 9. UNRESOLVED PREREQUISITES

| # | Item | Owner / platform action |
|---|---|---|
| 1 | **No compliant read-only session exists** | provision it; run 3a-3f as that role in the session that will run the items |
| 2 | **Target privileges and ownership are unknown** — the baseline holds 0 `GRANT` and 0 `OWNER TO` statements | determine by running the gate; nothing here predicts it |
| 3 | **Connection mode must be established** | use a session-mode or direct connection, or record the limitation |
| 4 | **Project identity is irreducibly out-of-band** | console confirmation of the project ref; the PID does not close this |
| 5 | **The gate is not universal** | disclosed: `SECURITY DEFINER` functions, event triggers, objects outside the seven relations and two schemas, `PUBLIC` grants, pooler/middleware |
| 6 | **V5-1 to V5-5 await confirmation** | review §8 |

---

## 10. CONFIRMATIONS AND FINAL STATE

| | |
|---|---|
| Production connection or access | **NO** |
| SQL executed or database-parsed, including disposable databases and containers | **NO** |
| Role provisioning, grant change, privilege change, role switching | **NO** |
| Migration applied or modified | **NO** |
| Application code or environment files changed | **NO** |
| Docker, container or CI harness executed | **NO** |
| Commit, push, pull request or deployment | **NO** |
| `C:\virality` accessed, traversed or modified | **NO** |
| Credentials, connection strings, tokens, secrets or secret-derived metadata printed | **NO** |
| All historical artifacts unchanged | **YES** — verified by hash after editing |
| Stage A run, ready or complete | **NO** |

| | |
|---|---|
| HEAD | `5604b50bdebd23efd6d040b90f5802954413b656`, detached |
| staged | **0** |
| modified | **78** |
| untracked | **43** (+3 this audit) |

Nothing staged, nothing committed. All three new artifacts are additions; no existing file was
modified.

---

## 11. NEXT OWNER ACTION

1. **Confirm V5-1 to V5-5** (§8) — V5-1 and V5-2 are the scope extensions.
2. **Provision the dedicated database-enforced read-only session** and verify it independently
   against all eight stop conditions, running 3a-3f **as that role, in the session that will run the
   items**.
3. **Establish the connection mode** before relying on PID continuity.
4. **Execute only the v5 pair** — `FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED_V5.md`
   (`2902242859b28912…`) with `FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED_V5.md` (`55823513d39c486e…`).
   Everything earlier is audit history and must not be executed.
5. **Return all eleven sanitized result blocks**, plus the post-Item-11 PID and the connection mode.

**Fix 3 application requires separate explicit authorization.**

---

**READY FOR OWNER REVIEW — CORRECTIONS REQUIRED BEFORE VERIFICATION**
