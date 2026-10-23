# PI-ADD-001 **v0.3-PROPOSED** - requirement traceability completion

**PENDING OWNER REVIEW AND RATIFICATION.**

| | |
|---|---|
| **Identifier** | **PI-ADD-001** |
| **Version** | **v0.3-PROPOSED** |
| **Status** | **PROPOSED - NOT RATIFIED, NOT APPROVED, NOT IMPLEMENTATION-AUTHORIZING** |
| File | `docs/pmo/prospect-intelligence/PI-REQUIREMENTS-ADDENDUM-003-PROPOSED.md` |
| Drafted | 2026-10-17 |
| v0.1 source | `PI-REQUIREMENTS-ADDENDUM-001-PROPOSED.md` - SHA-256 `f244adb96027f8078ec263c2ae6aa25f5b46c0ce2ba6cc7daab239a0438a5ad0` - 236 lines - **verified, preserved immutable, NOT edited** |
| v0.2 source | `PI-REQUIREMENTS-ADDENDUM-002-PROPOSED.md` - SHA-256 `c6ae24e2f482f547695625daa6512dce4d2fe58d1ab1e46f473eb9a66702e9d1` - 394 lines - **verified, preserved immutable, NOT edited** |
| Ratified carrier | `IMPLEMENTATION-MANIFEST-001.md` - **not edited** |

**Creating this artifact does not ratify v0.3. Implementation authorization remains NONE.** No application code, test, schema, migration, database state or runtime behaviour was changed under this task.

---

## 1. Why v0.3 exists

v0.2 stated *"All 83 v0.1 identifiers are preserved"*. A deterministic identifier-set comparison run for this task shows that claim is **true in substance but false in form**: **37 of the 83** original identifiers appear in v0.2 only inside a range reference or a blanket *"preserved unchanged"* statement, never as an individually auditable row.

v0.3 removes that reliance. **Every original identifier is stated individually below with its verbatim v0.1 wording**, extracted mechanically from the v0.1 file - not reconstructed from memory, from v0.2, or from any prompt.

### 1.1 Extraction method, so the inventory is reproducible

Identifiers were discovered by parsing every Markdown table row in v0.1 and v0.2 whose first cell matches `**<BAND>-A<n>**`, where `<BAND>` is `BR`, `FR`, `AC` or `NC`. The requirement text is that row's second cell, taken verbatim. The same parse ran against both files and the resulting sets were compared. **No identifier was renumbered.**

---

## 2. Table C - completeness and discrepancy report

### 2.1 Original identifier discovery

| Band | Expected (as reported) | **Discovered in v0.1** | Range | Duplicates | Numbering gaps |
|---|---|---|---|---|---|
| `BR-A` | 6 | **6** | `BR-A1`-`BR-A6` | **none** | **none** |
| `FR-A` | 37 | **37** | `FR-A1`-`FR-A37` | **none** | **none** |
| `AC-A` | 29 | **29** | `AC-A1`-`AC-A29` | **none** | **none** |
| `NC-A` | 11 | **11** | `NC-A1`-`NC-A11` | **none** | **none** |
| **Total** | **83** | **83** | - | **none** | **none** |

**The expected counts were verified, not assumed. Discovered total: 83. Expected: 83. MATCH.** No duplicate and no numbering gap exists in v0.1.

### 2.2 Individual representation in v0.3

| Measure | Count |
|---|---|
| Unique original identifiers discovered in v0.1 | **83** |
| Individually represented as their own row in **v0.3** | **83** |
| Missing from v0.3 | **0** |
| Duplicated in v0.3 | **0** |
| Renamed in v0.3 | **0** |
| Conflicting in v0.3 | **0** |
| New identifiers added by v0.2 | **32** |
| New identifiers individually represented in v0.3 | **32** |

**Completeness check: PASS.** Zero unexplained missing, duplicate, renamed or conflicting identifiers. The check compared identifier **sets and their content**, not counts alone.

### 2.3 The v0.2 shortfall this document corrects

**37 of 83** original identifiers were not individually present as rows in v0.2:

- **`AC-A` (26):** `AC-A1`, `AC-A2`, `AC-A3`, `AC-A4`, `AC-A5`, `AC-A6`, `AC-A7`, `AC-A8`, `AC-A9`, `AC-A10`, `AC-A11`, `AC-A12`, `AC-A13`, `AC-A14`, `AC-A15`, `AC-A16`, `AC-A17`, `AC-A18`, `AC-A19`, `AC-A20`, `AC-A21`, `AC-A22`, `AC-A23`, `AC-A24`, `AC-A27`, `AC-A28`
- **`NC-A` (11):** `NC-A1`, `NC-A2`, `NC-A3`, `NC-A4`, `NC-A5`, `NC-A6`, `NC-A7`, `NC-A8`, `NC-A9`, `NC-A10`, `NC-A11`

Each appeared in v0.2 only via a range (its section 3.1) or a blanket statement (section 3.3). **All are individually restated in section 3 below.**

### 2.4 UNRESOLVED DISCREPANCY - v0.2's own header understates its additions

Found during this task and **reported, not silently repaired**, as instructed.

v0.2's *"What changed from v0.1"* header states the new identifiers are **`FR-A38...FR-A46, AC-A30...AC-A42, NC-A12...NC-A19`**. The v0.2 **body** actually contains:

| Band | v0.2 header claims | v0.2 body contains | Discrepancy |
|---|---|---|---|
| `FR-A` | FR-A38-FR-A46 (9) | FR-A38-FR-A46 (9) | **none** |
| `AC-A` | AC-A30-AC-A42 (13) | **AC-A30-AC-A43 (14)** | **header omits `AC-A43`** |
| `NC-A` | NC-A12-NC-A19 (8) | **NC-A12-NC-A20 (9)** | **header omits `NC-A20`** |

**Classification: a documentation defect in v0.2's header, not a requirement conflict.** `AC-A43` and `NC-A20` each appear exactly once in the v0.2 body, are not duplicated, and collide with nothing. **v0.2 is not edited** to repair this. v0.3 enumerates all 32 new identifiers individually (section 4), so the shortfall does not propagate.

**Owner resolution required:** confirm that `AC-A43` and `NC-A20` are intended additions. If they are, no renumbering is needed and v0.2's header is simply stale. If they are not, they must be withdrawn by an explicit owner decision - **this document does not withdraw them, and does not renumber anything to make the set look tidy.**

---

## 3. Table A - original requirement inventory (all 83, individually enumerated)

Wording is **verbatim from v0.1**. The `v0.2 location` column records whether v0.2 carried that identifier as its own row or only by range/reference.

### 3.1 Business requirements (BR-A1 to BR-A6)

| ID | Original v0.1 wording (verbatim) | v0.2 location | v0.3 location | Change | Authority / source | Verified |
|---|---|---|---|---|---|---|
| **BR-A1** | Omnivyra shall represent a buying **opportunity or need** as a canonical, tenant-scoped record, independently of whether a named person is known | v0.2 1 table - **individual row** | 3.1 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **BR-A2** | An opportunity shall preserve **why it was identified**, for as long as the opportunity exists | v0.2 1 table - **individual row** | 3.1 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **BR-A3** | An opportunity shall be able to carry **inferred buying roles** without asserting that a person exists | v0.2 1 table - **individual row** | 3.1 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **BR-A4** | Consent and suppression shall govern **action on** an opportunity, not the **existence of** knowledge about it | v0.2 1 table - **individual row** | 3.1 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **BR-A5** | Community Discovery shall remain the authority on signal **interpretation**; PI shall be the authority on **identity, permission, qualification and lifecycle** | v0.2 1 table - **individual row** | 3.1 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **BR-A6** | Opportunity records shall not become a competing prospect, person, account, suppression or signal repository | v0.2 1 table - **individual row** | 3.1 | **CLARIFIED** | Verified migration `20260921000000_w2_lead_intelligence_uuid_reconciliation.sql:7-9, 184-187` | **YES** |

**Amendments and clarifications in this band, showing original and proposed wording:**

- **BR-A6 - CLARIFIED.**
  - *Original (v0.1):* Opportunity records shall not become a competing prospect, person, account, suppression or signal repository
  - *Proposed (v0.2, carried into v0.3):* **RESTATED — see §1.1.** Opportunity records shall not become a competing prospect, person, account, suppression or signal repository, and no additional parallel lead/opportunity store shall be introduced
  - *Reason:* Substance unchanged; the supporting rationale was corrected because the v0.1 rationale cited a stale claim.
  - *Authority:* Verified migration `20260921000000_w2_lead_intelligence_uuid_reconciliation.sql:7-9, 184-187`

### 3.2 Functional requirements (FR-A1 to FR-A37)

| ID | Original v0.1 wording (verbatim) | v0.2 location | v0.3 location | Change | Authority / source | Verified |
|---|---|---|---|---|---|---|
| **FR-A1** | A canonical opportunity record shall be tenant-scoped by `organization_id`, a non-null UUID foreign key to `companies(id)` | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A2** | An opportunity may reference an **account**, a **person**, or **both**, and shall reference **at least one**. *(Owner direction D-B)* | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A3** | The system shall **never create a person record** in order to satisfy FR-A2. *(Owner direction D-B, explicit)* | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A4** | An opportunity shall carry an `opportunity_type` drawn from the **existing** Community Discovery vocabulary, so detection and canonical records use one language | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A5** | An opportunity shall record **how its need was arrived at** (`need_source`), distinguishing a classified signal, a company event, manual entry and CRM import, so an inference is never readable as a declaration | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A6** | An opportunity shall carry a lifecycle `status` that is a **state and never a score**. An opportunity with no evaluation shall read as open, never as disqualified | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **AMENDED** | Owner decision **Q1-1**; `backend/types/opportunityLifecycle.ts:1-11`; `20260520_phase6_realtime_lifecycle_workflow.sql` | **YES** |
| **FR-A7** | Re-detection of the same need about the same subject shall **update one record**, not create a second | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A8** | An opportunity shall **reference** supporting signals in the existing signal store and shall **not copy their content**, so freshness, moderation state and provenance cannot drift between two copies. *(Owner direction D-A.1)* | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A9** | An opportunity shall support **one or more** supporting signals, accumulating over time | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A10** | An opportunity shall retain the detection reason verbatim, and a reference to the originating detection record | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A11** | Evidence observation times shall be authoritative and **never back-dated**. Evidence with no usable observation time shall be excluded, not assigned an ingestion time | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A12** | Contradictory signals shall **lower confidence** and shall **retain both signals**. Evidence shall never be silently overwritten or deleted, and a contradiction shall not auto-disqualify an opportunity | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A13** | Staleness shall be **reported**, not auto-closed, so recurrence remains visible | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A14** | Buying roles shall be stored in a **dedicated relational entity**, not as a serialized blob on the opportunity. *(Owner direction D-I)* | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A15** | A role record shall carry **mandatory inference provenance** stating how the role was arrived at, so an inference can never be read as a verified identity. *(Owner direction D-I)* | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A16** | A role record's person reference shall be **optional**; absent is the normal opportunity-first state | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A17** | When a real person is later discovered, the existing role record shall be **linked, not replaced**, so the inference and its confirmation are both auditable | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A18** | Role vocabulary shall reuse the existing canonical buying-role vocabulary, so a role means the same thing everywhere | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A19** | Fit, intent, urgency, opportunity, priority, confidence and qualification shall be recorded in the **existing single evaluation authority**. No second scoring store shall be introduced | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A20** | Each evaluation shall carry its **rules version** and a reasoned explanation, including the gaps and refusals that qualified it | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A21** | An evaluation shall reference **exactly one** subject — a prospect or an opportunity, never both and never neither — enforced as a database constraint | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A22** | Absence of evidence shall produce **abstention, never a zero score** | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A23** | The integration shall be **strictly one-way**: Community Discovery → PI. *(Owner direction D-A.1)* | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A24** | PI shall **not write** to Community Discovery detection, clustering, signal or roll-up records | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A25** | Existing Community Discovery read contracts shall remain **unchanged** | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A26** | The integration shall be **safely re-runnable**: replay shall create no duplicate opportunity and no duplicate signal link | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A27** | Cross-tenant reference shall be structurally **unconstructible**, via composite tenant-safe foreign keys, not only by application filtering | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A28** | Every write surface shall require an explicit authorization check, with **step-up** as the baseline for acting on an opportunity. *(Owner direction D-J baseline)* | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A29** | A **second approver** shall be required only for designated high-risk actions. The designation catalogue is **not defined by this addendum** — see §6 | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A30** | Authorization decisions, **including denials**, shall be audited to the existing security audit sink. No new audit store shall be introduced | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A31** | Refusal messages shall **never contain** a need statement or any attribute value, because a need statement can contain personal data and refusals travel into logs | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A32** | **Ordinary** account deletion shall be **refused** while non-terminal opportunities reference the account, atomically, with nothing partially deleted. *(Owner direction D-H)* | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A33** | A **governed resolution path** shall exist by which an operator clears blocking opportunities, under authorization and audit. Without it, FR-A32 would make an account permanently undeletable | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A34** | **Legal erasure** shall proceed through a **governed legal-erasure path under approved policy**, and shall not be permanently blocked by FR-A32. *(Owner direction D-H)* | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A35** | This addendum defines **no retention period** and specifies **no automatic retention**. Retention policy is an owner/legal matter — see §6 | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **FR-A36** | Person erasure shall remove the person and shall **not** destroy the account-anchored opportunity or its evidence. The surviving record shall name no individual | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **CLARIFIED** | `personErasure.ts:149, 356, 384`; `prospectIdentity/index.ts:129`; `20260921000000:184-187` | **YES** |
| **FR-A37** | Erasure and deletion behaviour shall **never** be implemented as a silent cascade of evidence, and shall never weaken FR-A2 | v0.2 2.1-2.7 tables - **individual row** | 3.2 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |

**Amendments and clarifications in this band, showing original and proposed wording:**

- **FR-A6 - AMENDED.**
  - *Original (v0.1):* An opportunity shall carry a lifecycle `status` that is a **state and never a score**. An opportunity with no evaluation shall read as open, never as disqualified
  - *Proposed (v0.2, carried into v0.3):* **RESTATED — see §2.1.1.** The opportunity's lifecycle state and its terminality are governed by the **existing nine-state opportunity lifecycle vocabulary**, not by a vocabulary defined in this addendum
  - *Reason:* The v0.1 six-value vocabulary is replaced. Five of its six values do not exist in the authoritative model, and `acted` exists nowhere in schema or code.
  - *Authority:* Owner decision **Q1-1**; `backend/types/opportunityLifecycle.ts:1-11`; `20260520_phase6_realtime_lifecycle_workflow.sql`
- **FR-A36 - CLARIFIED.**
  - *Original (v0.1):* Person erasure shall remove the person and shall **not** destroy the account-anchored opportunity or its evidence. The surviving record shall name no individual
  - *Proposed (v0.2, carried into v0.3):* Person erasure removes the person and does **not** destroy the account-anchored opportunity or its evidence; the surviving record names no individual. **PRECONDITION — see §2.7.1**
  - *Reason:* An explicit precondition was added: the person-erasure path is not currently reachable from any API route.
  - *Authority:* `personErasure.ts:149, 356, 384`; `prospectIdentity/index.ts:129`; `20260921000000:184-187`

### 3.3 Acceptance criteria (AC-A1 to AC-A29)

| ID | Original v0.1 wording (verbatim) | v0.2 location | v0.3 location | Change | Authority / source | Verified |
|---|---|---|---|---|---|---|
| **AC-A1** | An **account-only** opportunity persists | v0.2 3.1 - **range/reference only** | 3.3 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **AC-A2** | A **person-only** opportunity persists | v0.2 3.1 - **range/reference only** | 3.3 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **AC-A3** | An opportunity with **neither** subject is refused by a database constraint, **and no person is minted** to satisfy it | v0.2 3.1 - **range/reference only** | 3.3 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **AC-A4** | Detection reason is preserved verbatim | v0.2 3.1 - **range/reference only** | 3.3 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **AC-A5** | Replay creates no second opportunity; last-seen advances, first-seen does not | v0.2 3.1 - **range/reference only** | 3.3 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **AC-A6** | Re-linking the same signal is refused by a unique constraint and is a no-op | v0.2 3.1 - **range/reference only** | 3.3 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **AC-A7** | A role record persists with no person and with inference provenance set | v0.2 3.1 - **range/reference only** | 3.3 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **AC-A8** | Linking a later-discovered person **updates** the role record; the inference is retained | v0.2 3.1 - **range/reference only** | 3.3 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **AC-A9** | Inference provenance is **mandatory** — a null is refused | v0.2 3.1 - **range/reference only** | 3.3 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **AC-A10** | An evaluation references exactly one subject; both-or-neither is refused | v0.2 3.1 - **range/reference only** | 3.3 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **AC-A11** | An opportunity with no evaluation reads **open**, never disqualified | v0.2 3.1 - **range/reference only** | 3.3 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **AC-A12** | Contradictory signals yield **one** opportunity, reduced confidence, **both signals retained** | v0.2 3.1 - **range/reference only** | 3.3 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **AC-A13** | A stale opportunity is reported stale and is **not** auto-closed | v0.2 3.1 - **range/reference only** | 3.3 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **AC-A14** | A suppressed subject still yields an opportunity, and its action state is **not** actionable | v0.2 3.1 - **range/reference only** | 3.3 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **AC-A15** | Suppression is tenant-scoped: one tenant's instruction does not suppress another's subject | v0.2 3.1 - **range/reference only** | 3.3 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **AC-A16** | Cross-tenant account, person and signal references are **unconstructible** | v0.2 3.1 - **range/reference only** | 3.3 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **AC-A17** | Cross-tenant **read** returns zero rows under two genuinely separate authenticated sessions, with production-shaped grants re-created first, so the denial is attributable to row-level security and **not** to a missing grant | v0.2 3.1 - **range/reference only** | 3.3 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **AC-A18** | An unauthorized action is **denied and audited** | v0.2 3.1 - **range/reference only** | 3.3 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **AC-A19** | An action without satisfied step-up is denied with a step-up-required outcome, and audited | v0.2 3.1 - **range/reference only** | 3.3 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **AC-A20** | **Concurrent** duplicate creation: two genuine sessions race; one wins, the other observes the constraint or the lock, and exactly **one** opportunity exists afterwards | v0.2 3.1 - **range/reference only** | 3.3 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **AC-A21** | Retry after a failed attempt creates no second opportunity and no orphan links | v0.2 3.1 - **range/reference only** | 3.3 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **AC-A22** | A forced failure anywhere in the write leaves **no** opportunity, **no** links, **no** roles and **no** partial audit or provenance state | v0.2 3.1 - **range/reference only** | 3.3 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **AC-A23** | Ordinary account deletion is **refused** while a non-terminal opportunity exists; nothing is partially deleted | v0.2 3.1 - **range/reference only** | 3.3 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **AC-A24** | Ordinary account deletion **succeeds** once all referencing opportunities are terminal | v0.2 3.1 - **range/reference only** | 3.3 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **AC-A25** | Person erasure leaves the opportunity account-anchored, with no person reference and the evidence intact | v0.2 3.1 - **individual row** | 3.3 | **CLARIFIED** | Same evidence as FR-A36 | **YES** |
| **AC-A26** | Refusal messages contain no need statement and no attribute value | v0.2 3.1 - **individual row** | 3.3 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **AC-A27** | PI performs **no write** to any Community Discovery record, proven by a repository-wide scan | v0.2 3.1 - **range/reference only** | 3.3 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **AC-A28** | Existing Community Discovery read contracts are unchanged | v0.2 3.1 - **range/reference only** | 3.3 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **AC-A29** | **Legal erasure** completes through the governed path without being blocked by FR-A32 | v0.2 3.1 - **individual row** | 3.3 | **UNRESOLVED** | Q3 BLOCKED; `PI-CONTRACT-002-data-lifecycle.md` header; `backend/types/retention.ts:1-12` | **YES** |

**Amendments and clarifications in this band, showing original and proposed wording:**

- **AC-A25 - CLARIFIED.**
  - *Original (v0.1):* Person erasure leaves the opportunity account-anchored, with no person reference and the evidence intact
  - *Proposed (v0.2, carried into v0.3):* person erasure leaves the opportunity account-anchored — **precondition §2.7.1**
  - *Reason:* Testable only where person erasure can actually run; otherwise deferred to the erasure work package.
  - *Authority:* Same evidence as FR-A36
- **AC-A29 - UNRESOLVED.**
  - *Original (v0.1):* **Legal erasure** completes through the governed path without being blocked by FR-A32
  - *Proposed (v0.2, carried into v0.3):* legal erasure completes through the governed path — **cannot be specified until §5 is resolved**
  - *Reason:* Cannot be specified until the authoritative legal-erasure policy is verified.
  - *Authority:* Q3 BLOCKED; `PI-CONTRACT-002-data-lifecycle.md` header; `backend/types/retention.ts:1-12`

### 3.4 Negative controls (NC-A1 to NC-A11)

| ID | Original v0.1 wording (verbatim) | v0.2 location | v0.3 location | Change | Authority / source | Verified |
|---|---|---|---|---|---|---|
| **NC-A1** | Remove the subject constraint → **AC-A3 must fail** | v0.2 3.3 - **range/reference only** | 3.4 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **NC-A2** | Weaken the duplicate-prevention index → **AC-A5 and AC-A20 must fail** | v0.2 3.3 - **range/reference only** | 3.4 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **NC-A3** | Change the account reference to cascade → **AC-A23 must fail** | v0.2 3.3 - **range/reference only** | 3.4 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **NC-A4** | Introduce a person-creating write into the opportunity services → a repository scan **must flag it** | v0.2 3.3 - **range/reference only** | 3.4 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **NC-A5** | Introduce a PI write to a Community Discovery record → the one-way scan **must flag it** | v0.2 3.3 - **range/reference only** | 3.4 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **NC-A6** | Make the canonical write non-atomic → **AC-A22 must fail** | v0.2 3.3 - **range/reference only** | 3.4 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **NC-A7** | Remove a composite tenant-safe foreign key → **AC-A16 must fail** | v0.2 3.3 - **range/reference only** | 3.4 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **NC-A8** | Force the consent evaluator to always allow → **AC-A14 must fail** | v0.2 3.3 - **range/reference only** | 3.4 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **NC-A9** | Relax inference provenance to optional → **AC-A9 must fail** | v0.2 3.3 - **range/reference only** | 3.4 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **NC-A10** | Run AC-A17 **without** re-creating grants, and confirm the failure mode is a privilege error rather than a zero-row result | v0.2 3.3 - **range/reference only** | 3.4 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |
| **NC-A11** | Scans must not match prose — comments stripped and string literals handled | v0.2 3.3 - **range/reference only** | 3.4 | **UNCHANGED** | v0.1, carried forward as the ratifiable baseline | **YES** |

---

## 4. Table B - new requirement inventory (v0.2 additions, individually enumerated)

Wording is **verbatim from v0.2**. All 32 additions are listed; none is renumbered.

### 4.1 New functional requirements (FR-A38 to FR-A46)

| ID | Complete text (verbatim from v0.2) | Origin / rationale | v0.3 location | Classification | Approval |
|---|---|---|---|---|---|
| **FR-A38** | **`archived` is the sole terminal state** for ordinary account-deletion eligibility | Owner decision **A-2** | 4 | policy direction | **NOT APPROVED - pending owner review** |
| **FR-A39** | **All other states are non-terminal** for this purpose — including `dismissed`, `converted`, and any **unknown or future** state, which **fails closed** as non-terminal | Owner decision **A-3** | 4 | policy direction | **NOT APPROVED - pending owner review** |
| **FR-A40** | `converted` must transition to `archived` **through the existing validated and audited lifecycle mechanism** before qualifying as resolved. No new state is invented and the allowed-transition mechanism is not bypassed | Owner decision **A-4** | 4 | policy direction | **NOT APPROVED - pending owner review** |
| **FR-A41** | The lifecycle state meanings are the owner-approved definitions in §2.8.1 | Owner-approved Q1 state definitions | 4 | policy direction | **NOT APPROVED - pending owner review** |
| **FR-A42** | Bulk resolution is permitted **only** as transition-to-`archived` for the purpose of clearing an ordinary account-deletion block, with **independent per-item validation and per-item outcomes**. It shall **not** be broadened into general bulk opportunity resolution | Owner decision **Q2-1**, narrowly scoped | 4 | policy direction | **NOT APPROVED - pending owner review** |
| **FR-A43** | **No separate controlled reason code is required.** The **target lifecycle state** is the controlled element. No new reason-code enum is introduced, and the disposition enum is **not** repurposed as a deletion-resolution vocabulary | Owner decisions **Q2-4**, **A-10**, **A-6/A-11** | 4 | policy direction | **NOT APPROVED - pending owner review** |
| **FR-A44** | The explanation is **optional and retained verbatim**, under the existing nullable contract **`opportunity_lifecycle_states.reasoning`** — `reasoning TEXT NULL` (`20260520_phase6_realtime_lifecycle_workflow.sql:19`); type `reasoning: string \ | Owner decisions **Q2-5**, **A-12**; contract verified in source | 4 | policy direction plus verified current-state fact | **NOT APPROVED - pending owner review** |
| **FR-A45** | A repeated archive request for an already-`archived` opportunity shall return an explicit **already-resolved** result, not a spurious invalid-transition failure | Owner decision **A-13** | 4 | policy direction | **NOT APPROVED - pending owner review** |
| **FR-A46** | `detection_ref` **may become unresolvable** — see §2.8.2. This is a documented limitation and acceptance decision, not a defect to be fixed by adding a foreign key | `backend/types/retention.ts:4, 15-16, 57` | 4 | unresolved proposal, pending owner acceptance | **NOT APPROVED - pending owner review** |

### 4.2 New acceptance criteria (AC-A30 to AC-A43)

| ID | Complete text (verbatim from v0.2) | Origin / rationale | v0.3 location | Classification | Approval |
|---|---|---|---|---|---|
| **AC-A30** | The terminal set is a **single named constant** containing exactly `archived`; a second spelling anywhere is a test failure | Derived acceptance criterion for the FR-A38 to FR-A46 directions | 4 | pending approval | **NOT APPROVED - pending owner review** |
| **AC-A31** | Ordinary account deletion is **refused atomically** while any referencing opportunity is non-terminal; nothing partially deleted | Derived acceptance criterion for the FR-A38 to FR-A46 directions | 4 | pending approval | **NOT APPROVED - pending owner review** |
| **AC-A32** | Ordinary account deletion **succeeds** once every referencing opportunity is `archived` | Derived acceptance criterion for the FR-A38 to FR-A46 directions | 4 | pending approval | **NOT APPROVED - pending owner review** |
| **AC-A33** | A **`converted`** opportunity **blocks** deletion until archived | Derived acceptance criterion for the FR-A38 to FR-A46 directions | 4 | pending approval | **NOT APPROVED - pending owner review** |
| **AC-A34** | A **`dismissed`** opportunity **blocks** deletion until archived | Derived acceptance criterion for the FR-A38 to FR-A46 directions | 4 | pending approval | **NOT APPROVED - pending owner review** |
| **AC-A35** | An **unrecognised** state **blocks** deletion (fail closed), proven by an out-of-vocabulary value where the schema permits one, or by a unit test of the predicate where it does not | Derived acceptance criterion for the FR-A38 to FR-A46 directions | 4 | pending approval | **NOT APPROVED - pending owner review** |
| **AC-A36** | Bulk archive performs **N capability checks for N items**; one denial neither denies nor permits the rest | Derived acceptance criterion for the FR-A38 to FR-A46 directions | 4 | pending approval | **NOT APPROVED - pending owner review** |
| **AC-A37** | An action without satisfied step-up is denied with a step-up-required outcome | Derived acceptance criterion for the FR-A38 to FR-A46 directions | 4 | pending approval | **NOT APPROVED - pending owner review** |
| **AC-A38** | Every authorization decision, **including every denial**, writes one audit event, and the denial reveals **nothing** about another tenant — not row counts, not identifiers, not existence | Derived acceptance criterion for the FR-A38 to FR-A46 directions | 4 | pending approval | **NOT APPROVED - pending owner review** |
| **AC-A39** | A repeat archive request for an already-`archived` item reports **already resolved**, not a failure, and appends **no** second history row | Derived acceptance criterion for the FR-A38 to FR-A46 directions | 4 | pending approval | **NOT APPROVED - pending owner review** |
| **AC-A40** | **No bulk lifecycle operation other than archive-for-deletion-block-clearance is exposed**; any other bulk transition is absent or refused | Derived acceptance criterion for the FR-A38 to FR-A46 directions | 4 | pending approval | **NOT APPROVED - pending owner review** |
| **AC-A41** | A supplied explanation is stored **verbatim**; its absence is **not** an error; the mandatory audit facts (`previous_state`, `actor_user_id`, `transitioned_at`) are present on every transition regardless | Derived acceptance criterion for the FR-A38 to FR-A46 directions | 4 | pending approval | **NOT APPROVED - pending owner review** |
| **AC-A42** | When the referenced `opportunity_feed_items` row no longer exists, the opportunity still returns its **`detected_reason` verbatim**, and no referential error occurs | Derived acceptance criterion for the FR-A38 to FR-A46 directions | 4 | pending approval | **NOT APPROVED - pending owner review** |
| **AC-A43** | Resolution uses the existing enforced transition path; the allowlist is never bypassed, and an illegal transition is refused by the allowlist rather than by caller discipline | Derived acceptance criterion for the FR-A38 to FR-A46 directions | 4 | pending approval | **NOT APPROVED - pending owner review** |

### 4.3 New negative controls (NC-A12 to NC-A20)

| ID | Complete text (verbatim from v0.2) | Origin / rationale | v0.3 location | Classification | Approval |
|---|---|---|---|---|---|
| **NC-A12** | Add `converted` to the terminal set | Derived negative control for the new acceptance criteria | 4 | pending approval | **NOT APPROVED - pending owner review** |
| **NC-A13** | Add `dismissed` to the terminal set | Derived negative control for the new acceptance criteria | 4 | pending approval | **NOT APPROVED - pending owner review** |
| **NC-A14** | Make the terminal predicate default unknown states to terminal | Derived negative control for the new acceptance criteria | 4 | pending approval | **NOT APPROVED - pending owner review** |
| **NC-A15** | Grant blanket authority in place of the per-item check | Derived negative control for the new acceptance criteria | 4 | pending approval | **NOT APPROVED - pending owner review** |
| **NC-A16** | Remove the step-up requirement | Derived negative control for the new acceptance criteria | 4 | pending approval | **NOT APPROVED - pending owner review** |
| **NC-A17** | Suppress denial auditing | Derived negative control for the new acceptance criteria | 4 | pending approval | **NOT APPROVED - pending owner review** |
| **NC-A18** | Remove the already-resolved mapping | Derived negative control for the new acceptance criteria | 4 | pending approval | **NOT APPROVED - pending owner review** |
| **NC-A19** | Hard-delete the referenced detection row, then read the opportunity | Derived negative control for the new acceptance criteria | 4 | pending approval | **NOT APPROVED - pending owner review** |
| **NC-A20** | Expose a second bulk lifecycle transition | Derived negative control for the new acceptance criteria | 4 | pending approval | **NOT APPROVED - pending owner review** |

---

## 5. Substantive governance decisions carried forward

Carried from v0.2 unchanged in substance. **Policy direction, verified current behaviour and unresolved items are kept distinct throughout.**

### 5.1 Corrected `lead_intelligence` rationale (the stale claim is NOT repeated as fact)

The v0.1 rationale for **BR-A6** described `lead_intelligence` as a tenant-unsafe outlier with *"`company_id text`, no FK"*. **That claim is stale and is not asserted anywhere in this document.**

**Verified current reality** — `supabase/migrations/20260921000000_w2_lead_intelligence_uuid_reconciliation.sql`:

- `:7` — `lead_intelligence.company_id  text -> uuid  FK -> companies(id)`
- `:8` — `lead_intelligence.unified_person_id  text -> uuid  composite FK -> unified_persons(id, company_id)`
- `:9` — `lead_intelligence_profiles.company_id  text -> uuid  FK -> companies(id)`
- `:184-187` — `ADD CONSTRAINT lead_intelligence_person_tenant_fk FOREIGN KEY (unified_person_id, company_id) REFERENCES public.unified_persons(id, company_id) ON DELETE RESTRICT`

**`lead_intelligence` is tenant-safe.** It uses a UUID tenant key with a foreign key to `companies(id)` and a composite tenant-safe foreign key to `unified_persons`. **It is not an outlier and must not be cited as one.**

**BR-A6 stands on two grounds that do not depend on the withdrawn claim:**

1. **Count.** Six lead/opportunity-shaped models already exist — `canonical_leads`, `opportunity_feed_items`, `active_leads`, `lead_signals`, `contacts`, `lead_intelligence` — plus `lead_intelligence_profiles`, `marketpulse_signals`, and the legacy `leads` (a different entity: web-form/visitor attribution). A seventh parallel store would add ambiguity about which record is authoritative.
2. **Adoption, not safety, is the demonstrated failure mode.** `lead_intelligence` has a repository (`backend/services/leadIntelligence/leadIntelligenceRepository.ts:27`) and no observed producer. A new store can be perfectly tenant-safe and still fail by going unused while the old paths continue.

*Classification: the correction is a **verified current-state fact**; BR-A6 itself remains **pending approval**.*

### 5.2 Stale references in two existing documents — corrections recorded, sources NOT edited

| Document | Line | Stale text | Required correction | Status |
|---|---|---|---|---|
| `OMNIVYRA-PI-OPPORTUNITY-SPINE-DESIGN-001.md` | **32** | *"`company_id text NOT NULL` — no FK, not a uuid"* | Restate per §5.1 | **OPEN — not edited by this task** |
| `PI-C1-IMPLEMENTATION-GATE-001.md` | **300** | *"the `lead_intelligence` outlier (`company_id text`, no FK), which is **not** a model to follow"* | Restate per §5.1 | **OPEN — not edited by this task** |

Both documents remain byte-unmodified. Each correction requires its own authorized change.

### 5.3 `detection_ref` retention limitation (FR-A46)

**Verified facts** — `backend/types/retention.ts`:

- `:4` — `'opportunity_feed_items'` is a member of `RETENTION_TARGETS`
- `:57` — its binding is `{ table: 'opportunity_feed_items', time_column: 'created_at', soft_delete_column: null }`
- `:15-16` — `RETENTION_ARCHIVAL_MODES = ['soft_delete', 'hard_delete']`

Because `soft_delete_column` is `null`, soft delete is unavailable for that table, so a retention action on it is necessarily a **hard delete**. The proposed `detection_ref` — a plain UUID pointing at `opportunity_feed_items.id` — can therefore become **permanently unresolvable**.

| | |
|---|---|
| **Accepted** | `detection_ref` may become unresolvable after a retention action — **pending owner acceptance** |
| **Why tolerable** | `detection_ref` is deliberately a plain UUID and **not** a foreign key, so retention cannot cause a referential failure; and **`detected_reason` is carried verbatim** (FR-A10), so the reason an opportunity exists survives the loss of the detection record |
| **NOT proposed** | **No foreign key is added. No retention guarantee is invented.** |
| **Boundary** | **`lead_signals` not appearing in `RETENTION_TARGETS` is NOT a retention guarantee.** It is an absence of policy and may change |

*Classification: **unresolved proposal — pending owner acceptance.** Tested by AC-A42, with NC-A19 as its negative control.*

### 5.4 Approved Q1/Q2 directions

| Direction | Carried as |
|---|---|
| The existing nine-state lifecycle vocabulary owns lifecycle and terminality | **FR-A6** (amended), §3.2 |
| `archived` is the sole terminal state for ordinary account-deletion eligibility | **FR-A38** |
| All other states — including `dismissed`, `converted`, and any unknown or future state — are non-terminal, failing closed | **FR-A39** |
| `converted` must transition to `archived` through the existing validated and audited mechanism before qualifying as resolved | **FR-A40** |
| Lifecycle state meanings for `triaged`, `reviewing`, `monitoring` | **FR-A41**, §5.5 |
| Bulk resolution permitted **only** as archive-for-deletion-block-clearance, with per-item validation and outcomes | **FR-A42** |
| No separate controlled reason code; the target lifecycle state is the controlled element | **FR-A43** |
| Optional free-text explanation, retained verbatim | **FR-A44**, §5.6 |
| Capability-based authorization plus step-up as the baseline; denials audited without cross-tenant leakage | **FR-A28**, **FR-A30** |
| Repeated archive requests return an explicit already-resolved result | **FR-A45** |

### 5.5 Approved lifecycle state meanings (FR-A41)

| State | Owner-approved definition |
|---|---|
| **`triaged`** | Initial assessment, ready for further qualification or review, and supports reopening accidental dismissal |
| **`reviewing`** | Active assessment with revisable qualification, respecting the existing lifecycle transition rules |
| **`monitoring`** | Observe an opportunity for future developments, including conversion without planned outreach, subject to the existing transition rules |

Each is consistent with the verified topology: `triaged` is the reopen target of `dismissed` (`opportunityLifecycle.ts:44`); `reviewing` is bidirectional with `qualified` (`:39`, `:40`); `monitoring` is the only non-outreach state that can reach `converted` directly (`:41`). The other six states are **not** redefined here.

### 5.6 The optional-explanation contract, stated explicitly (FR-A44)

| | |
|---|---|
| **Governing contract** | **`opportunity_lifecycle_states.reasoning TEXT NULL`** |
| Schema evidence | `supabase/migrations/20260520_phase6_realtime_lifecycle_workflow.sql:19`; a search for `reasoning.*NOT NULL` in that migration returns **no match** |
| Type evidence | `reasoning: string \| null` — `backend/types/opportunityLifecycle.ts:20` |
| Write path | written on every transition — `backend/services/opportunityLifecycleService.ts:143` |
| **Explicit non-substitution** | **`prospect_list_members.removal_reason` is NOT this contract.** It is supporting precedent only and must not be substituted |

*Classification: the contract is a **verified current-state fact**; FR-A44's requirement is a **policy direction**.*

### 5.7 Policy direction versus current implementation behaviour

**No direction in this document is claimed to be implemented.**

| Direction | Current code | Gap |
|---|---|---|
| FR-A38 terminal set | **No terminality concept exists.** `grep -ni 'terminal'` across `opportunityLifecycle.ts` and `opportunityLifecycleService.ts` matches **only a doc comment** — never a constant, type or check | **NOT IMPLEMENTED** |
| FR-A32 / FR-A40 deletion gate | No deletion gate exists; the canonical opportunity entity does not exist | **NOT IMPLEMENTED** |
| FR-A41 state meanings | Documented nowhere in code. `components/recommendations/tabs/AnalystWorkspacePanel.tsx:65-80` carries a display ordering and colour classes only — no label text, tooltip or help copy | **NOT DOCUMENTED** before this addendum |
| FR-A42 bulk archive | No bulk operation exists for opportunities; `pages/api/active-leads/lifecycle.ts` transitions one item | **NOT IMPLEMENTED** |
| FR-A28 / FR-A30 capability, step-up, audited denials | The lifecycle route authorizes with `getUserRole(ctx.userId, companyId)` at `pages/api/active-leads/lifecycle.ts:59`, `403` at `:60`, a further role check at `:62`. **No capability check, no step-up, no idempotency wrapper.** `opportunityLifecycleService.ts:122-123` states *"Caller (API) is responsible for RBAC checks."* **Denied transitions are not audited today** | **NOT IMPLEMENTED — this is the approved security upgrade** |
| FR-A45 already-resolved | **Opposite behaviour today**: `canTransitionLifecycle` returns `{allowed:false, reason:'no_op_same_state'}` at `opportunityLifecycle.ts:61` and `transitionLifecycle` **throws** at `opportunityLifecycleService.ts:136` | **NOT IMPLEMENTED** |
| FR-A43 no new reason enum | Nothing to change; no such enum exists | **ALREADY COMPLIANT** |
| FR-A43 disposition enum not repurposed | Nothing reuses it; `opportunity_dispositions` is a separate triage axis | **ALREADY COMPLIANT** |
| FR-A44 optional free-text | **Already satisfied** by the contract in §5.6 | **ALREADY COMPLIANT** |

### 5.8 A contradictory comment in application code — identified, NOT edited

| | |
|---|---|
| File / lines | `backend/types/opportunityLifecycle.ts`, **lines 30–31** (doc block 27–34) |
| Exact text | *"`converted` and `archived` are terminal — they only accept `archived` as a follow-up (so a converted row can be tombstoned but never revived as detected)."* |
| **Two distinct errors** | **(a)** `converted` is **not** terminal — `converted: ['archived']` at `:43` gives it an outgoing transition. **(b)** *"they only accept `archived` as a follow-up"* is false **for `archived` itself** — `archived: []` at `:45` accepts **nothing** |
| Required correction | Restate so `archived` is the sole absorbing state and `converted` a non-absorbing outcome state that must be archived to qualify as resolved, consistent with FR-A38 and FR-A40 |
| **Status** | **OPEN — application-code comment. NOT edited by this task.** Requires a separate authorized change |

---

## 6. Q3 — legal-erasure policy remains BLOCKED

- **The authoritative legal-erasure and retention policy has NOT been located in the verified evidence.**
- **Approval remains UNVERIFIED.**
- **No retention period, legal authority, surviving-record rule or erasure semantics has been invented** in this document.
- **Q3 is still BLOCKED.**
- **v0.3 does not close Q3.**

### 6.1 Evidence searched

| Source searched | Result |
|---|---|
| `docs/pmo/prospect-intelligence/PI-CONTRACT-002-data-lifecycle.md` | On scope — covers retention, erasure, suppression interaction, provenance, staleness, tenant isolation, auditability, provider-originated data, re-enrichment after deletion, contactability. **But its own header states "CONTRACT PREPARED — AWAITING POLICY DECISIONS" and "It invents no legal or compliance policy."** It is **not** an approved policy |
| `docs/pmo/prospect-intelligence/` — filenames matching `BRS`, `FRS`, `definitive`, retention, erasure | No approved policy document found |
| `backend/types/retention.ts:1-12` | `RETENTION_TARGETS` is a closed ten-member list; **no PI identity table appears in it** |
| `IMPLEMENTATION-MANIFEST-001.md` | No erasure or retention policy clause located |

**Absence from this repository is NOT treated as proof that no policy exists elsewhere.** It may exist in a legal, compliance or governance system outside this codebase.

### 6.2 What is needed to resolve the gap

| # | Needed |
|---|---|
| 1 | **Policy owner identified** — who owns legal-erasure and retention policy for third-party personal data held by PI |
| 2 | **The approved policy document itself**, or a verifiable reference to it, with version and approval status |
| 3 | The eight sub-decisions already recorded in `PI-C1-OWNER-DECISIONS-002.md` §5.5: authorized initiator and approver; evidence required to establish a request; scope and subject references; handling of opportunity content, signals, role inferences, provenance and audit records; what may or must survive; authorization, audit and tenant-isolation requirements; refusal and escalation behaviour; retention periods |

**FR-A34, FR-A35 and AC-A29 remain unresolvable until the above is supplied.**

---

## 7. Ratification and implementation remain separate gates

- **v0.3 is PROPOSED and UNRATIFIED.**
- **Creation of this artifact does not ratify v0.3.**
- **Implementation authorization remains NONE.**
- **No application code, tests, schema, migrations, database state or runtime behaviour may be changed under this task, and none was.**

### 7.1 Ratification prerequisites, all OPEN

| # | Prerequisite |
|---|---|
| 1 | Owner review of this v0.3, including the **§2.4 unresolved discrepancy** (`AC-A43`, `NC-A20`) |
| 2 | Explicit owner acceptance of the **§5.3 `detection_ref` limitation** (FR-A46) |
| 3 | **Q3 resolved** — FR-A34, FR-A35 and AC-A29 depend on it |
| 4 | A formal owner act of ratification, which is a **separate gate** from the Q1/Q2 decisions already recorded |
| 5 | Correction of the two stale document references (§5.2) and the application-code comment (§5.8), each in its own authorized change |

### 7.2 Other unresolved dependencies — no approval inferred

**Q4** high-risk action catalogue (blocks FR-A29) · **D-C** person/contact reconciliation · **D-E** need-to-offering matching method · **OD-3 / OD-4 / OD-5** list permissions, `added_via`, erasure residue · **company-event sources** (none authorized — signal types and weights in code are code, not authorization) · **production migration state** of the PI migrations (**UNVERIFIED**) · **production tenant isolation** (**UNVERIFIED** — isolation on the live path rests on application logic plus composite foreign keys, not row-level security, because the service role holds a bypass and the application connects as that role).

**Need-to-offering matching** remains traceable to ratified **FR-16** *"product/service alignment"* and **FR-17** *"problem relevance"* in the carrier, is **excluded** from this addendum's scope, and is **not authorized** by it.

---

## 8. Frozen schedule and time accountability

### 8.1 Baselines preserved, unchanged

| Item | Frozen | Changed? |
|---|---|---|
| **Milestone A′ deadline** | **2026-11-25** | **NO** |
| **Milestone A′ baseline** | **28.5 human engineer-days** | **NO** |
| **WP-7 baseline** | **2026-11-17, 4.0 human engineer-days** | **NO** |
| **C-1 estimate** | **8–12 human engineer-days** | **NO — not revised** |
| **OVERRUN RISK** | **RAISED; zero float at the high C-1 estimate** | **unchanged** |
| **Next checkpoint** | **Friday, 2026-10-23** | **unchanged** |

No deadline moved, no estimate reset, no scope reduced, no float reclaimed, no clock reset. **Agent wall-clock throughput is not substituted for the human engineer-day baseline.**

### 8.2 This task

| | |
|---|---|
| **Actual start** | **2026-10-17T19:38:34+05:30 (IST)** |
| External waiting time before start | **9 min 04 s** (prior close 19:29:30 → 19:38:34) — **not** engineering effort |
| Original estimate | **0.25 engineer-days** |
| Active engineering effort consumed | **~8 minutes** |
| 75% threshold (0.1875 d) | **not approached** |
| Forecast overrun | **none** |
| Monitoring | **no continuous monitoring claimed between reports**; every timestamp is a measured `date -Iseconds` |

---

## 9. Verification report

### 9.1 Checks RUN

| # | Check | Result |
|---|---|---|
| 1 | v0.1 SHA-256 and line count | `f244adb9…a5ad0` / **236** — **MATCH**, unchanged |
| 2 | v0.2 SHA-256 and line count | `c6ae24e2…e9d1` / **394** — **MATCH**, unchanged |
| 3 | Deterministic identifier discovery in v0.1 | **83** identifiers; **no duplicates**; **no numbering gaps** |
| 4 | Expected-versus-discovered count comparison | BR-A 6/6, FR-A 37/37, AC-A 29/29, NC-A 11/11 — **MATCH** |
| 5 | Identifier-set comparison v0.1 → v0.2 | **37** original identifiers present only by range/reference in v0.2 |
| 6 | Identifier-set comparison v0.2 → v0.1 | **32** new identifiers in v0.2 |
| 7 | Individual representation in v0.3 | **83 original + 32 new = 115**, each its own row |
| 8 | Wording comparison, not identifiers alone | all original wording extracted **verbatim** from v0.1; the five changed items show original and proposed text with reason and authority |
| 9 | Renumbering check | **none performed** — no identifier was renamed or renumbered |
| 10 | Controlling documents unchanged | verified by hash (see completion report) |
| 11 | Pre-existing working-tree changes preserved | modified-file count unchanged; only this new file added |
| 12 | Control-byte scan on the new file | clean |

### 9.2 Checks NOT RUN, and why

| # | Not run | Reason |
|---|---|---|
| 1 | Any test suite, typecheck or lint | documentation-only task; no code changed |
| 2 | Any database operation | prohibited |
| 3 | Production migration-history read | prohibited |
| 4 | Production ACL or isolation verification | prohibited; remains **UNVERIFIED** |
| 5 | External provider calls | prohibited |
| 6 | Semantic equivalence review of unchanged wording by a second reader | out of scope; wording was copied mechanically rather than retyped, which removes transcription risk but is not a substitute for owner review |

### 9.3 Unresolved discrepancies

| # | Discrepancy | Status |
|---|---|---|
| 1 | **v0.2's header understates its own additions** — it omits `AC-A43` and `NC-A20` (§2.4) | **UNRESOLVED — owner confirmation required.** Not repaired, not renumbered |
| 2 | Two existing documents still carry the stale `lead_intelligence` claim (§5.2) | **OPEN** — not edited |
| 3 | `backend/types/opportunityLifecycle.ts:30-31` comment is self-contradictory (§5.8) | **OPEN** — not edited |
| 4 | `AC-A29` cannot be specified | **BLOCKED on Q3** |
| 5 | `FR-A36` / `AC-A25` depend on a person-erasure path that has no route caller | **OPEN** — precondition stated |

**No discrepancy was silently repaired, and no clean result was fabricated.**

---

## 10. Conclusion

- **v0.3 is PROPOSED and UNRATIFIED.** Creating it does not ratify it.
- **Implementation authorization remains NONE.** C-1a — three tables, one migration, one rollback — may be considered only after Q3 is resolved, this addendum is formally ratified, and the owner separately authorizes that work package.
- **Q1 and Q2 decisions remain recorded; Q3 remains BLOCKED.**
- **Completeness: 115 of 115 identifiers individually enumerated — 83 original, 32 new — with zero unexplained missing, duplicate, renamed or conflicting identifiers**, and one unresolved documentation discrepancy in v0.2's header reported for owner resolution.
- **v0.1 and v0.2 are preserved immutable and were not edited.** No code, test, schema, migration, database, commit, push, merge or deployment work occurred.
