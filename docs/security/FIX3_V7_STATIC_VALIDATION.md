# FIX 3 — V7 STATIC SAFETY VALIDATION

Static review only. No production access, no database connection, no SQL executed or parsed, no role
or privilege change, no migration applied, no container or harness, no commit, no deployment. **No
runtime claim is made about the session, the project identity or the effective privileges.**

This task carried no correction mandate, so **no v8 was created**. The four remaining defects are
documented below with exact references for the owner to decide on.

---

## 1. DISPOSITION

**BLOCKED — V7 GATE SAFETY NOT ESTABLISHED**

Both v7 artifacts are byte-identical to their expected hashes, and H-1 passes in substance. But a
full read of the assembled package found **four remaining defects**, one of which means **H-4 is not
fully resolved**: a *third* live instruction still states the gate's scope as six relations and still
describes the read-only transaction as database-enforced.

| ID | Defect | Where | Impact |
|---|---|---|---|
| **J-1** | The closing "what to write" instruction tells the operator to record *"no write privilege on and no ownership of the **six named relations**, no superuser escalation path found, **database-enforced read-only transaction in effect**"*. The scope is **seven** relations plus two schemas plus database-level powers — this omits the **migration ledger** — and "database-enforced read-only transaction" **contradicts the L-1 decision** that it is a session safeguard. It is a live instruction, not a provenance quote. | package **lines 397-400** | **safety-relevant consistency.** H-4 incomplete |
| **J-2** | The aggregate-verdict field has four conjunct checkboxes and a verdict, but **no place to record the supporting rationale or any unresolved conditions**, which section 4 of this task requires. `rationale`/`unresolved conditions`: **0 occurrences** in the package. | package **lines 1584-1589** | evidence validity |
| **J-3** | The `NOT APPLICABLE` disposition rule does not **require escalation** where applicability is mandatory or unresolved, which section 3 requires. The paragraph mentions escalation **0** times; it routes such cases to `INCONCLUSIVE`, which blocks readiness but prescribes no escalation. | package **lines 363-369** | fail-closed completeness |
| **J-4** | **No blank line before numbered step 4** ("Wrap the work in a read-only transaction"). In Markdown the list item merges into the preceding paragraph, so SC-6's own instruction may not render as a distinct step. Present in v4, v5 and v6 as well — inherited, not introduced by v7. | package **line 400 → 401** | minor rendering, mildly safety-relevant |

**The recurrence is itself the finding.** The stale-restatement defect has now appeared three times —
the template block (G-2), the section-1 summary (H-4), and now the closing instruction (J-1) — and
each fix addressed only the instance that had been found. The structural remedy stated in v7 ("the
list is authoritative and is not restated here") was applied to one location, not enforced across
the document. Until every live restatement is replaced by a reference, a fourth instance should be
expected rather than assumed absent.

---

## 2. ARTIFACT INTEGRITY — **PASS**

| Artifact | Actual SHA-256 | Expected | Result |
|---|---|---|---|
| `docs/security/FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED_V7.md` (1,670 lines) | `78ce050f0d351fc135d79b2a73f83ed09b3e38dff3fd1ed5231dcba358cbd40c` | same | **MATCH** |
| `docs/security/FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED_V7.md` (193 lines) | `f7fb70d727ec7232c8f2ccc7c89ecc2f0da96b5dd9e26d2ce6326d65d74882eb` | same | **MATCH** |

Paths were as expected; no substitution was needed. HEAD `5604b50bdebd23efd6d040b90f5802954413b656`,
detached, as expected.

### Preserved — all unchanged

| Artifact | SHA-256 |
|---|---|
| Original Phase 98 package | `a0327d2ae48ba3bef0772eeb38947e8378f659a0eea3e2e30e0540dab0f23c5b` |
| Frozen predecessor | `34dffb69d4c500d0ed827ad9114778a1235ad79df3c022643decb3c55711a49d` |
| Fix 3 migration | `581926201d268d5bde34b6a6b7be4ee118bac3ed8d62ef88756e7030b2d445d5` |
| Verification artifact | `5c62e0155bf1d4d1d911597549d83bb252cf54b66f89ba0774070371da26601b` |
| CI harness | `63e8920b916f8ca3f5a717d5b4a98efbe85d68dc2e4a7f35100fa215469a5e1e` |

### Assembly

Both artifacts were read in full rather than sampled. Paragraph boundaries, duplicated and orphaned
lines, headings, references and template completeness were checked directly.

- **Orphaned or duplicated lines:** none found. The v6 orphan (`items recorded PASS.`) is gone;
  exactly one occurrence remains.
- **Paragraph boundaries:** correct throughout the gate and aggregate sections — blank lines present
  at 348, 354, 362, 370 — **except** J-4 at 400 → 401.
- **Headings:** 26 in v6 and 26 in v7, **0 lost**.
- **Template completeness:** one gate block; all eight stop conditions represented; role, database,
  table, schema, ownership, escalation, session, project-identity and connection-mode evidence all
  present; plus the aggregate verdict — subject to J-2.

---

## 3. H-1 — OWNERSHIP EVIDENCE — **PASS in substance**

All six ownership-test results are recordable in the package template, and the two templates agree
field for field.

| Layer | `USAGE` field | `MEMBER` field | Package template | Steps template |
|---|---|---|---|---|
| database | `is_or_inherits_database_owner` | `can_set_role_to_database_owner` | line 1572 | line 81 |
| relation | `is_or_inherits_owner` | `can_set_role_to_owner` | line 1575 | line 84 |
| schema `public` | `owner-inherited` | `can_set_role` | line 1576 | line 86 |
| schema `supabase_migrations` | `owner-inherited` | `can_set_role` | line 1577 | line 87 |

- **Three cases checked separately:** database (3a, bound to `current_database()` at package line 91),
  relation (3c, seven relations), schema (3e, both schemas). Each has its own template row.
- **`USAGE` and `MEMBER` are distinguishable** — separate named columns and separate template
  fields, so "already holds the owner's privileges" and "can assume them" are never conflated.
- **Any positive owner-role path triggers the stop condition** — SC-4 is a disjunction over the
  three `is_or_inherits_*` columns **and** the three `can_set_role_to_*` columns.

**One cosmetic inconsistency, not a content defect:** the package rows are tagged `[v7]` while the
steps rows carry `[v6]` for the same fields. The fields themselves agree; only the version
annotation differs.

---

## 4. H-2 — AGGREGATE VERDICT SEMANTICS — **PASS with one gap (J-3)**

Package lines 356-369.

| Requirement | Result |
|---|---|
| Explicitly defines how PASS, FAIL, NOT APPLICABLE and INCONCLUSIVE affect readiness | **PASS** — all four named: *"`PASS` satisfies a condition. `FAIL` and `INCONCLUSIVE` both make the aggregate **not ready**. `NOT APPLICABLE` is **not a PASS**"* |
| FAIL or INCONCLUSIVE prevent readiness | **PASS** |
| NOT APPLICABLE never silently counts as PASS | **PASS** — *"not a PASS"*, admissible *"only where a specific check's approved semantics define it — at present that is Item 10b alone"* |
| …follows an explicit disposition rule | **PASS** — anything neither PASS, FAIL nor a defined NOT APPLICABLE is INCONCLUSIVE |
| …**requires escalation where applicability is mandatory or unresolved** | **FAIL — J-3.** Zero escalation mentions in the rule; it routes to INCONCLUSIVE, which blocks readiness but prescribes no escalation step |
| A nominal aggregate PASS cannot override any stop condition | **PASS** — the v5 precedence paragraph (lines 350-354) plus *"never overrides, satisfies or downgrades a separate stop condition"* |
| Missing, blank, contradictory or unrecorded mandatory evidence cannot yield readiness | **PASS** — *"every evidence item recorded with a verdict"* is a named conjunct, and UNKNOWN-on-present is a STOP |

---

## 5. H-3 — RECORDABLE AGGREGATE VERDICT — **PARTIAL (J-2)**

| Requirement | Result |
|---|---|
| A dedicated, unambiguous field | **PASS** — `AGGREGATE VERDICT: [ ] READY to proceed [ ] NOT READY`, package line 1587 |
| A place for the **supporting rationale** | **FAIL — J-2** |
| A place for **unresolved conditions** | **FAIL — J-2** |
| Steps instruct completion only after all mandatory evidence is evaluated | **PASS** — *"fill LAST, derived from every mandatory condition above"* (package line 1584) and *"fill LAST, not from the last query or field"* (steps line 90) |

The four conjunct checkboxes capture *whether* each condition is satisfied, but there is nowhere to
record *why* a NOT READY verdict was reached or which conditions remain open — which is what a
reviewer would need.

---

## 6. H-4 — SINGLE AUTHORITATIVE STOP-CONDITION LIST — **FAIL (J-1)**

Every live mention of stop conditions in the package was enumerated and classified:

| Package line | Mention | Classification |
|---|---|---|
| 311-343 | the eight-bullet list | **authoritative** ✔ |
| 344-348 | "Still eight conditions" change log | commentary, no scope claim ✔ |
| 350-354 | precedence rule | reference ✔ |
| 356-369 | aggregate rule | reference ✔ |
| 372-381 | session continuity, "separately from the eight" | reference ✔ |
| 390-395 | no-discipline-only route, "cannot clear every stop condition above" | reference ✔ |
| **397-400** | **"what to write" instruction** | **STALE LIVE COPY — J-1** |
| 430-440 | "Stop immediately, and record why" | **reference** ✔ (fixed in v7) |
| 1631 | section 7, "clears every stop condition in preamble step 3" | reference ✔ |
| 35, 37, 433 | provenance and history, including *"one claiming six relations"* | historical, clearly marked ✔ |

| Required check | Result |
|---|---|
| Stale summaries replaced with references | **partially** — 430-440 yes; **397-400 no** |
| No live copy omits `CREATEROLE`, `CREATE` on `supabase_migrations`, schema/database ownership, or `SET ROLE` paths | **FAIL** — lines 397-400 omit all four |
| No live instruction calls the transaction read-only setting database-enforced | **FAIL** — line 399 does |
| Historical quotations clearly identified as provenance | **PASS** — lines 35, 37 and 433 are in the revision row and the v7 rationale |

---

## 7. CROSS-ARTIFACT AND REGRESSION CHECKS

| Check | Result |
|---|---|
| Eight stop conditions intact, none weakened | **PASS** — 8 bullets |
| Session continuity separate from privilege and identity checks | **PASS** — its own heading, outside the eight |
| Seven relations incl. `supabase_migrations.schema_migrations` | **PASS** |
| All six `USAGE`/`MEMBER` ownership tests represented consistently | **PASS** — 3 `USAGE` + 3 `MEMBER` in the SQL, all six in both templates |
| Approved Phase 96 §F query byte-identical to `e02bfecd0a16729f` | **PASS** — extracted and hashed: `e02bfecd0a16729f`, 20 lines |
| Item 10b a sub-item; eleven item headings; `/11` roll-up | **PASS** — one `#### ITEM 10b`, 11 `### ITEM`, roll-up present |
| Connection-mode, project-identity, privilege, ownership, escalation and session evidence explicit | **PASS** |
| No new SQL write operation, privilege change or expanded execution authority | **PASS** — **0** write-position keywords across every SQL block; no `SET ROLE`, no `DO`, no temporary object, no DDL |
| Every referenced file and hash accurate | **PASS** — steps cite the v7 path and full hash, **0** stale v6 pointers; the v7 provenance row cites `FIX3_V6_FINAL_SAFETY.md`, which exists |

Nothing was marked INCONCLUSIVE: every check above was established from the actual files, and no
result was inferred from the prior report.

---

## 8. REMAINING DEFECTS — EXACT REFERENCES

| ID | File | Lines | Fix (not applied) |
|---|---|---|---|
| **J-1** | `FIX3_STAGE_A_OWNER_RUN_EVIDENCE_CORRECTED_V7.md` | **397-400** | replace the enumerated claim with a reference: record *what step 3 established*, naming seven relations, both schemas and database-level powers, and describing the read-only transaction as an **observed session safeguard** rather than database-enforced |
| **J-2** | same | **1584-1589** | add `Rationale: ____` and `Unresolved conditions: ____` to the aggregate block, in both templates |
| **J-3** | same | **363-369** | add that where applicability is mandatory or unresolved, NOT APPLICABLE is INCONCLUSIVE **and must be escalated**, not merely recorded |
| **J-4** | same | **400 → 401** | insert a blank line before numbered step 4 |
| minor | `FIX3_STAGE_A_OPERATOR_STEPS_CORRECTED_V7.md` | 81, 84, 86, 87 | align the `[v6]` version tags with the package's `[v7]` — cosmetic |

None requires a scope change. J-1 is the one that matters for safety.

---

## 9. SAFETY BOUNDARY AND FINAL STATE

| | |
|---|---|
| Production access or any database connection | **NO** |
| SQL executed or database-parsed, including disposable databases and containers | **NO** |
| Role or privilege provisioned or modified; role switched | **NO** |
| Migration applied or modified | **NO** |
| Application code or environment files changed | **NO** |
| Docker, container or CI harness executed | **NO** |
| Commit, push, pull request or deployment | **NO** |
| `C:\virality` accessed, traversed or modified | **NO** |
| Credentials, connection strings, tokens or secrets printed | **NO** |
| Any artifact modified | **NO** — this report is the only addition |

**No claim is made that the database session is read-only, that the project identity is confirmed, or
that runtime privileges are safe.** Those remain owner-side prerequisites, establishable only by
running the gate as the intended role in the intended session.

| | |
|---|---|
| HEAD | `5604b50bdebd23efd6d040b90f5802954413b656`, detached |
| staged | **0** |
| modified | **78** |
| untracked | **50** (+1: this report) |

Nothing staged, nothing committed.

---

## 10. NEXT OWNER ACTION

1. **Decide on J-1 to J-4.** J-1 is the safety-relevant one. A v8 would be a four-line-region edit
   with no scope change; it was not created because this task authorized review only.
2. **Consider enforcing the structural rule rather than patching instances.** Three occurrences of
   the same stale-restatement defect have now been found in three separate audits. A single rule —
   *the stop conditions are stated once and referenced everywhere else* — applied document-wide
   would close the class.
3. **Provision and independently verify the dedicated database-enforced read-only session**, run
   3a-3f as that role in the session that will run the items, and establish the connection mode.
4. **Execute no package until J-1 is resolved**, since its current wording would have the operator
   record a narrower claim than the gate establishes, omitting the migration ledger.

**Fix 3 application remains separately unauthorized.**

---

**BLOCKED — V7 GATE SAFETY NOT ESTABLISHED**
