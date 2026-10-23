# PI-ADD-001 v0.3 - semantic review of the 78 UNCHANGED items

**Companion to** `PI-ADD-001-V03-RATIFICATION-READINESS-001.md`. **Documentation-only. Nothing is amended, ratified or authorized by this file.**

## 1. Reviewer independence - stated plainly

**This is NOT an independent second-reader review.** The same agent authored v0.1, v0.2 and v0.3 and performed this review. **No independent second reviewer is available in this environment, and none is claimed.** No second reader exists, and no second reader has approved anything.

What that limitation does and does not affect:

| Component | Independence | Confidence |
|---|---|---|
| **Wording comparison v0.1 vs v0.3** | **Objective.** A deterministic parse compared each item byte-for-byte; no judgement involved | **HIGH** - reproducible by re-running the comparison |
| **Vocabulary-consistency scan** | **Objective.** A mechanical search for the five withdrawn state names across all 78 items | **HIGH** - reproducible |
| **Meaning, conflict and implication assessment** | **NOT independent** - self-review by the author | **MEDIUM.** Author bias cannot be excluded. An independent reviewer remains **required** before ratification |

The three CLARIFICATION items below were found by the **mechanical** scan, not by self-assessment, which is why they survive the independence limitation.

## 2. Method

1. The UNCHANGED set was derived as the 83 v0.1 identifiers minus the five previously reported as changed or unresolved (`BR-A6`, `FR-A6`, `FR-A36`, `AC-A25`, `AC-A29`). **Result: 78 - matching the reported figure.**
2. For each, v0.1 wording and the wording quoted in v0.3 were extracted by table-row parse and compared after unescaping pipe characters.
3. Each item was scanned for the five state names withdrawn by the FR-A6 amendment: `open`, `disqualified`, `acted`, `closed`, `superseded` (word-boundary matched).
4. Each item was scanned for a stated dependency on approved policy or a deferred owner decision.
5. The identifier set and wording were re-checked mechanically **after** review.

## 3. Aggregate outcome

| Outcome | Count |
|---|---|
| `PASS - unchanged wording and meaning supported` | **73** |
| `CLARIFICATION REQUIRED` | **3** |
| `OWNER DECISION REQUIRED` | **1** |
| `BLOCKED BY Q3` | **1** |
| `UNVERIFIED - evidence insufficient` | **0** |
| **Total** | **78** |

**Wording mismatches between v0.1 and v0.3: ZERO across all 78 items.** Every `PASS` therefore means *wording verified byte-identical* plus *no vocabulary or policy inconsistency found*.

## 4. Review table - one row per item

### 4.1 Business requirements (5 items)

| ID | v0.1 wording (verbatim) | Wording match | Outcome | Issue / required action |
|---|---|---|---|---|
| **BR-A1** | Omnivyra shall represent a buying **opportunity or need** as a canonical, tenant-scoped record, independently of whether a named person is known | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **BR-A2** | An opportunity shall preserve **why it was identified**, for as long as the opportunity exists | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **BR-A3** | An opportunity shall be able to carry **inferred buying roles** without asserting that a person exists | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **BR-A4** | Consent and suppression shall govern **action on** an opportunity, not the **existence of** knowledge about it | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **BR-A5** | Community Discovery shall remain the authority on signal **interpretation**; PI shall be the authority on **identity, permission, qualification and lifecycle** | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |

### 4.2 Functional requirements (35 items)

| ID | v0.1 wording (verbatim) | Wording match | Outcome | Issue / required action |
|---|---|---|---|---|
| **FR-A1** | A canonical opportunity record shall be tenant-scoped by `organization_id`, a non-null UUID foreign key to `companies(id)` | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A2** | An opportunity may reference an **account**, a **person**, or **both**, and shall reference **at least one**. *(Owner direction D-B)* | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A3** | The system shall **never create a person record** in order to satisfy FR-A2. *(Owner direction D-B, explicit)* | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A4** | An opportunity shall carry an `opportunity_type` drawn from the **existing** Community Discovery vocabulary, so detection and canonical records use one language | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A5** | An opportunity shall record **how its need was arrived at** (`need_source`), distinguishing a classified signal, a company event, manual entry and CRM import, so an inference is never readable as a declaration | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A7** | Re-detection of the same need about the same subject shall **update one record**, not create a second | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A8** | An opportunity shall **reference** supporting signals in the existing signal store and shall **not copy their content**, so freshness, moderation state and provenance cannot drift between two copies. *(Owner direction D-A.1)* | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A9** | An opportunity shall support **one or more** supporting signals, accumulating over time | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A10** | An opportunity shall retain the detection reason verbatim, and a reference to the originating detection record | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A11** | Evidence observation times shall be authoritative and **never back-dated**. Evidence with no usable observation time shall be excluded, not assigned an ingestion time | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A12** | Contradictory signals shall **lower confidence** and shall **retain both signals**. Evidence shall never be silently overwritten or deleted, and a contradiction shall not auto-disqualify an opportunity | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A13** | Staleness shall be **reported**, not auto-closed, so recurrence remains visible | **byte-identical** | `CLARIFICATION REQUIRED` | **Issue:** Uses *"auto-closed"*. Read as behavioural English the intent survives, but `closed` was a state name in the **withdrawn** v0.1 vocabulary and no longer exists; the approved analogue is `archived`.<br>**Action:** Recommend restating as "not auto-archived" for consistency with FR-A6/FR-A38. **Low severity** - no conflict with an approved decision. Not amended here. |
| **FR-A14** | Buying roles shall be stored in a **dedicated relational entity**, not as a serialized blob on the opportunity. *(Owner direction D-I)* | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A15** | A role record shall carry **mandatory inference provenance** stating how the role was arrived at, so an inference can never be read as a verified identity. *(Owner direction D-I)* | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A16** | A role record's person reference shall be **optional**; absent is the normal opportunity-first state | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A17** | When a real person is later discovered, the existing role record shall be **linked, not replaced**, so the inference and its confirmation are both auditable | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A18** | Role vocabulary shall reuse the existing canonical buying-role vocabulary, so a role means the same thing everywhere | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A19** | Fit, intent, urgency, opportunity, priority, confidence and qualification shall be recorded in the **existing single evaluation authority**. No second scoring store shall be introduced | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A20** | Each evaluation shall carry its **rules version** and a reasoned explanation, including the gaps and refusals that qualified it | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A21** | An evaluation shall reference **exactly one** subject — a prospect or an opportunity, never both and never neither — enforced as a database constraint | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A22** | Absence of evidence shall produce **abstention, never a zero score** | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A23** | The integration shall be **strictly one-way**: Community Discovery → PI. *(Owner direction D-A.1)* | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A24** | PI shall **not write** to Community Discovery detection, clustering, signal or roll-up records | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A25** | Existing Community Discovery read contracts shall remain **unchanged** | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A26** | The integration shall be **safely re-runnable**: replay shall create no duplicate opportunity and no duplicate signal link | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A27** | Cross-tenant reference shall be structurally **unconstructible**, via composite tenant-safe foreign keys, not only by application filtering | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A28** | Every write surface shall require an explicit authorization check, with **step-up** as the baseline for acting on an opportunity. *(Owner direction D-J baseline)* | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A29** | A **second approver** shall be required only for designated high-risk actions. The designation catalogue is **not defined by this addendum** — see §6 | **byte-identical** | `OWNER DECISION REQUIRED` | **Issue:** States on its face that the designation catalogue is *"not defined by this addendum"*. The requirement is therefore incomplete by construction until the high-risk action catalogue (Q4) exists.<br>**Action:** Owner to supply the designated high-risk action catalogue. Blocks a later work package, not C-1. |
| **FR-A30** | Authorization decisions, **including denials**, shall be audited to the existing security audit sink. No new audit store shall be introduced | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A31** | Refusal messages shall **never contain** a need statement or any attribute value, because a need statement can contain personal data and refusals travel into logs | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A32** | **Ordinary** account deletion shall be **refused** while non-terminal opportunities reference the account, atomically, with nothing partially deleted. *(Owner direction D-H)* | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A33** | A **governed resolution path** shall exist by which an operator clears blocking opportunities, under authorization and audit. Without it, FR-A32 would make an account permanently undeletable | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A34** | **Legal erasure** shall proceed through a **governed legal-erasure path under approved policy**, and shall not be permanently blocked by FR-A32. *(Owner direction D-H)* | **byte-identical** | `BLOCKED BY Q3` | **Issue:** Requires a *"governed legal-erasure path under approved policy"*. **No approved policy has been located and approval is unverified**, so the requirement cannot be specified, tested or ratified.<br>**Action:** Supply or identify the approved legal-erasure/retention policy. Until then FR-A34 stays blocked. |
| **FR-A35** | This addendum defines **no retention period** and specifies **no automatic retention**. Retention policy is an owner/legal matter — see §6 | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **FR-A37** | Erasure and deletion behaviour shall **never** be implemented as a silent cascade of evidence, and shall never weaken FR-A2 | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |

### 4.3 Acceptance criteria (27 items)

| ID | v0.1 wording (verbatim) | Wording match | Outcome | Issue / required action |
|---|---|---|---|---|
| **AC-A1** | An **account-only** opportunity persists | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **AC-A2** | A **person-only** opportunity persists | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **AC-A3** | An opportunity with **neither** subject is refused by a database constraint, **and no person is minted** to satisfy it | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **AC-A4** | Detection reason is preserved verbatim | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **AC-A5** | Replay creates no second opportunity; last-seen advances, first-seen does not | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **AC-A6** | Re-linking the same signal is refused by a unique constraint and is a no-op | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **AC-A7** | A role record persists with no person and with inference provenance set | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **AC-A8** | Linking a later-discovered person **updates** the role record; the inference is retained | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **AC-A9** | Inference provenance is **mandatory** — a null is refused | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **AC-A10** | An evaluation references exactly one subject; both-or-neither is refused | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **AC-A11** | An opportunity with no evaluation reads **open**, never disqualified | **byte-identical** | `CLARIFICATION REQUIRED` | **Issue:** Cites **two withdrawn state names**. The criterion reads *"reads **open**, never disqualified"*, but FR-A6 as amended (owner decision Q1-1) adopts the nine-state vocabulary in which **`open` does not exist** (the initial state is `detected`) and **`disqualified` does not exist** (the rejection state is `dismissed`). The criterion is therefore **not testable as written**.<br>**Action:** Restate against the approved vocabulary, preserving the intent that absence of an evaluation must never read as a negative verdict. Wording change requires owner approval; **not amended here**. |
| **AC-A12** | Contradictory signals yield **one** opportunity, reduced confidence, **both signals retained** | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **AC-A13** | A stale opportunity is reported stale and is **not** auto-closed | **byte-identical** | `CLARIFICATION REQUIRED` | **Issue:** Same issue as FR-A13: *"is **not** auto-closed"* uses a withdrawn state name as a verb.<br>**Action:** Recommend restating as "not auto-archived". **Low severity**. Not amended here. |
| **AC-A14** | A suppressed subject still yields an opportunity, and its action state is **not** actionable | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **AC-A15** | Suppression is tenant-scoped: one tenant's instruction does not suppress another's subject | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **AC-A16** | Cross-tenant account, person and signal references are **unconstructible** | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **AC-A17** | Cross-tenant **read** returns zero rows under two genuinely separate authenticated sessions, with production-shaped grants re-created first, so the denial is attributable to row-level security and **not** to a missing grant | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **AC-A18** | An unauthorized action is **denied and audited** | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **AC-A19** | An action without satisfied step-up is denied with a step-up-required outcome, and audited | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **AC-A20** | **Concurrent** duplicate creation: two genuine sessions race; one wins, the other observes the constraint or the lock, and exactly **one** opportunity exists afterwards | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **AC-A21** | Retry after a failed attempt creates no second opportunity and no orphan links | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **AC-A22** | A forced failure anywhere in the write leaves **no** opportunity, **no** links, **no** roles and **no** partial audit or provenance state | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **AC-A23** | Ordinary account deletion is **refused** while a non-terminal opportunity exists; nothing is partially deleted | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **AC-A24** | Ordinary account deletion **succeeds** once all referencing opportunities are terminal | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **AC-A26** | Refusal messages contain no need statement and no attribute value | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **AC-A27** | PI performs **no write** to any Community Discovery record, proven by a repository-wide scan | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **AC-A28** | Existing Community Discovery read contracts are unchanged | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |

### 4.4 Negative controls (11 items)

| ID | v0.1 wording (verbatim) | Wording match | Outcome | Issue / required action |
|---|---|---|---|---|
| **NC-A1** | Remove the subject constraint → **AC-A3 must fail** | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **NC-A2** | Weaken the duplicate-prevention index → **AC-A5 and AC-A20 must fail** | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **NC-A3** | Change the account reference to cascade → **AC-A23 must fail** | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **NC-A4** | Introduce a person-creating write into the opportunity services → a repository scan **must flag it** | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **NC-A5** | Introduce a PI write to a Community Discovery record → the one-way scan **must flag it** | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **NC-A6** | Make the canonical write non-atomic → **AC-A22 must fail** | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **NC-A7** | Remove a composite tenant-safe foreign key → **AC-A16 must fail** | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **NC-A8** | Force the consent evaluator to always allow → **AC-A14 must fail** | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **NC-A9** | Relax inference provenance to optional → **AC-A9 must fail** | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **NC-A10** | Run AC-A17 **without** re-creating grants, and confirm the failure mode is a privilege error rather than a zero-row result | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |
| **NC-A11** | Scans must not match prose — comments stripped and string literals handled | **byte-identical** | `PASS - unchanged wording and meaning supported` | - |

## 5. Non-PASS items, consolidated

### FR-A13 - `CLARIFICATION REQUIRED`

- **v0.1 wording (verbatim):** Staleness shall be **reported**, not auto-closed, so recurrence remains visible
- **Issue:** Uses *"auto-closed"*. Read as behavioural English the intent survives, but `closed` was a state name in the **withdrawn** v0.1 vocabulary and no longer exists; the approved analogue is `archived`.
- **Required action:** Recommend restating as "not auto-archived" for consistency with FR-A6/FR-A38. **Low severity** - no conflict with an approved decision. Not amended here.

### FR-A29 - `OWNER DECISION REQUIRED`

- **v0.1 wording (verbatim):** A **second approver** shall be required only for designated high-risk actions. The designation catalogue is **not defined by this addendum** — see §6
- **Issue:** States on its face that the designation catalogue is *"not defined by this addendum"*. The requirement is therefore incomplete by construction until the high-risk action catalogue (Q4) exists.
- **Required action:** Owner to supply the designated high-risk action catalogue. Blocks a later work package, not C-1.

### FR-A34 - `BLOCKED BY Q3`

- **v0.1 wording (verbatim):** **Legal erasure** shall proceed through a **governed legal-erasure path under approved policy**, and shall not be permanently blocked by FR-A32. *(Owner direction D-H)*
- **Issue:** Requires a *"governed legal-erasure path under approved policy"*. **No approved policy has been located and approval is unverified**, so the requirement cannot be specified, tested or ratified.
- **Required action:** Supply or identify the approved legal-erasure/retention policy. Until then FR-A34 stays blocked.

### AC-A11 - `CLARIFICATION REQUIRED`

- **v0.1 wording (verbatim):** An opportunity with no evaluation reads **open**, never disqualified
- **Issue:** Cites **two withdrawn state names**. The criterion reads *"reads **open**, never disqualified"*, but FR-A6 as amended (owner decision Q1-1) adopts the nine-state vocabulary in which **`open` does not exist** (the initial state is `detected`) and **`disqualified` does not exist** (the rejection state is `dismissed`). The criterion is therefore **not testable as written**.
- **Required action:** Restate against the approved vocabulary, preserving the intent that absence of an evaluation must never read as a negative verdict. Wording change requires owner approval; **not amended here**.

### AC-A13 - `CLARIFICATION REQUIRED`

- **v0.1 wording (verbatim):** A stale opportunity is reported stale and is **not** auto-closed
- **Issue:** Same issue as FR-A13: *"is **not** auto-closed"* uses a withdrawn state name as a verb.
- **Required action:** Recommend restating as "not auto-archived". **Low severity**. Not amended here.

## 6. Post-review mechanical re-check

| Check | Result |
|---|---|
| UNCHANGED set size | **78** - matches the reported figure |
| Wording mismatches v0.1 vs v0.3 | **0** |
| Items citing a withdrawn state name | **3** - `AC-A11`, `FR-A13`, `AC-A13` |
| Items stating a dependency on approved policy | **2** - `FR-A34`, `FR-A35` (FR-A35 is a self-referential constraint and PASSES; FR-A34 is blocked) |
| Items deferring to a separate owner decision | **1** - `FR-A29` |
| Identifiers renumbered, withdrawn or amended by this review | **0** |

**No requirement was silently amended. No decision was made on the owner's behalf.**
