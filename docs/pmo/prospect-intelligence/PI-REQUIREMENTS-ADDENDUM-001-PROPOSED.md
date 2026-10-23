# PI-ADD-001 — canonical opportunity spine · **PROPOSED REQUIREMENT ADDENDUM**

| | |
|---|---|
| **Identifier** | **PI-ADD-001** |
| **Version** | **v0.1-PROPOSED** |
| **Status** | **PROPOSED — NOT RATIFIED, NOT APPROVED, NOT IMPLEMENTATION-AUTHORIZING** |
| Drafted | 2026-10-17 |
| Relationship to the ratified carrier | **ADDITIVE AND SEPARATE.** `IMPLEMENTATION-MANIFEST-001.md` (SHA-256 `651575cd73f1c3a7e6e04f0d…`) is **not edited by this addendum** and is not edited by anything in this programme |
| Why it exists | The ratified carrier contains **zero occurrences of "opportunit"**, so the canonical opportunity spine has no requirement identifier. Per owner direction, the authority vehicle is a separately approved, versioned addendum rather than a change to the ratified manifest |
| Governing design | `OMNIVYRA-PI-OPPORTUNITY-SPINE-DESIGN-001.md` (`257185e621fa0b80…`), `-002.md` (`34564a452997d1a8…`), `PI-C1-IMPLEMENTATION-GATE-001.md` (`f747c763bd0dbb48…`) |

**This document confers no authorization.** It is a draft for owner review. Ratification is a separate owner act, and implementation requires a further explicit authorization after ratification.

### Identifier scheme — deliberately non-colliding

Addendum identifiers carry an `A` suffix band (`BR-A1`, `FR-A1`, `AC-A1`) so they can never be confused with, or collide with, the ratified carrier's `BR-01…BR-30`, `FR-01…FR-30`, `AC-01…AC-12` and `SEC-001`.

---

## 1. Business requirements

| ID | Requirement | Rationale |
|---|---|---|
| **BR-A1** | Omnivyra shall represent a buying **opportunity or need** as a canonical, tenant-scoped record, independently of whether a named person is known | The capability audit established that both detection and canonical governance exist, and that the missing element is the noun joining them. Without it a detected need cannot be governed, audited or acted on |
| **BR-A2** | An opportunity shall preserve **why it was identified**, for as long as the opportunity exists | A recommendation whose reason cannot be reconstructed cannot be defended to a customer or a regulator |
| **BR-A3** | An opportunity shall be able to carry **inferred buying roles** without asserting that a person exists | Opportunity-first discovery requires naming the role to approach before a contact is known. Asserting a person who has not been observed would be fabrication |
| **BR-A4** | Consent and suppression shall govern **action on** an opportunity, not the **existence of** knowledge about it | Discarding a suppressed subject's opportunity destroys evidence and causes the same detection to recur indefinitely; it also does not serve the data subject, whose protection is against contact |
| **BR-A5** | Community Discovery shall remain the authority on signal **interpretation**; PI shall be the authority on **identity, permission, qualification and lifecycle** | Owner direction D-A. The classifier is deterministic, explainable and operational; relocating it would be rework with no new capability |
| **BR-A6** | Opportunity records shall not become a competing prospect, person, account, suppression or signal repository | The design review found **six** existing lead/opportunity-shaped models, one of which (`lead_intelligence`, `company_id text`, no FK) demonstrates the cost of adding another |

---

## 2. Functional requirements

### 2.1 Canonical opportunity model and subject invariant

| ID | Requirement |
|---|---|
| **FR-A1** | A canonical opportunity record shall be tenant-scoped by `organization_id`, a non-null UUID foreign key to `companies(id)` |
| **FR-A2** | An opportunity may reference an **account**, a **person**, or **both**, and shall reference **at least one**. *(Owner direction D-B)* |
| **FR-A3** | The system shall **never create a person record** in order to satisfy FR-A2. *(Owner direction D-B, explicit)* |
| **FR-A4** | An opportunity shall carry an `opportunity_type` drawn from the **existing** Community Discovery vocabulary, so detection and canonical records use one language |
| **FR-A5** | An opportunity shall record **how its need was arrived at** (`need_source`), distinguishing a classified signal, a company event, manual entry and CRM import, so an inference is never readable as a declaration |
| **FR-A6** | An opportunity shall carry a lifecycle `status` that is a **state and never a score**. An opportunity with no evaluation shall read as open, never as disqualified |
| **FR-A7** | Re-detection of the same need about the same subject shall **update one record**, not create a second |

### 2.2 Signal references, evidence and provenance

| ID | Requirement |
|---|---|
| **FR-A8** | An opportunity shall **reference** supporting signals in the existing signal store and shall **not copy their content**, so freshness, moderation state and provenance cannot drift between two copies. *(Owner direction D-A.1)* |
| **FR-A9** | An opportunity shall support **one or more** supporting signals, accumulating over time |
| **FR-A10** | An opportunity shall retain the detection reason verbatim, and a reference to the originating detection record |
| **FR-A11** | Evidence observation times shall be authoritative and **never back-dated**. Evidence with no usable observation time shall be excluded, not assigned an ingestion time |
| **FR-A12** | Contradictory signals shall **lower confidence** and shall **retain both signals**. Evidence shall never be silently overwritten or deleted, and a contradiction shall not auto-disqualify an opportunity |
| **FR-A13** | Staleness shall be **reported**, not auto-closed, so recurrence remains visible |

### 2.3 Relational buying roles and inference provenance

| ID | Requirement |
|---|---|
| **FR-A14** | Buying roles shall be stored in a **dedicated relational entity**, not as a serialized blob on the opportunity. *(Owner direction D-I)* |
| **FR-A15** | A role record shall carry **mandatory inference provenance** stating how the role was arrived at, so an inference can never be read as a verified identity. *(Owner direction D-I)* |
| **FR-A16** | A role record's person reference shall be **optional**; absent is the normal opportunity-first state |
| **FR-A17** | When a real person is later discovered, the existing role record shall be **linked, not replaced**, so the inference and its confirmation are both auditable |
| **FR-A18** | Role vocabulary shall reuse the existing canonical buying-role vocabulary, so a role means the same thing everywhere |

### 2.4 Scoring and evaluation authority

| ID | Requirement |
|---|---|
| **FR-A19** | Fit, intent, urgency, opportunity, priority, confidence and qualification shall be recorded in the **existing single evaluation authority**. No second scoring store shall be introduced |
| **FR-A20** | Each evaluation shall carry its **rules version** and a reasoned explanation, including the gaps and refusals that qualified it |
| **FR-A21** | An evaluation shall reference **exactly one** subject — a prospect or an opportunity, never both and never neither — enforced as a database constraint |
| **FR-A22** | Absence of evidence shall produce **abstention, never a zero score** |

### 2.5 One-way Community Discovery → PI integration

| ID | Requirement |
|---|---|
| **FR-A23** | The integration shall be **strictly one-way**: Community Discovery → PI. *(Owner direction D-A.1)* |
| **FR-A24** | PI shall **not write** to Community Discovery detection, clustering, signal or roll-up records |
| **FR-A25** | Existing Community Discovery read contracts shall remain **unchanged** |
| **FR-A26** | The integration shall be **safely re-runnable**: replay shall create no duplicate opportunity and no duplicate signal link |

### 2.6 Security, authorization and audit

| ID | Requirement |
|---|---|
| **FR-A27** | Cross-tenant reference shall be structurally **unconstructible**, via composite tenant-safe foreign keys, not only by application filtering |
| **FR-A28** | Every write surface shall require an explicit authorization check, with **step-up** as the baseline for acting on an opportunity. *(Owner direction D-J baseline)* |
| **FR-A29** | A **second approver** shall be required only for designated high-risk actions. The designation catalogue is **not defined by this addendum** — see §6 |
| **FR-A30** | Authorization decisions, **including denials**, shall be audited to the existing security audit sink. No new audit store shall be introduced |
| **FR-A31** | Refusal messages shall **never contain** a need statement or any attribute value, because a need statement can contain personal data and refusals travel into logs |

### 2.7 Deletion and erasure

| ID | Requirement |
|---|---|
| **FR-A32** | **Ordinary** account deletion shall be **refused** while non-terminal opportunities reference the account, atomically, with nothing partially deleted. *(Owner direction D-H)* |
| **FR-A33** | A **governed resolution path** shall exist by which an operator clears blocking opportunities, under authorization and audit. Without it, FR-A32 would make an account permanently undeletable |
| **FR-A34** | **Legal erasure** shall proceed through a **governed legal-erasure path under approved policy**, and shall not be permanently blocked by FR-A32. *(Owner direction D-H)* |
| **FR-A35** | This addendum defines **no retention period** and specifies **no automatic retention**. Retention policy is an owner/legal matter — see §6 |
| **FR-A36** | Person erasure shall remove the person and shall **not** destroy the account-anchored opportunity or its evidence. The surviving record shall name no individual |
| **FR-A37** | Erasure and deletion behaviour shall **never** be implemented as a silent cascade of evidence, and shall never weaken FR-A2 |

---

## 3. Acceptance criteria

Each AC is a property to be demonstrated against the **real schema** on a disposable database. Counts are read from the test runner, never from a wrapper exit code.

| ID | Acceptance criterion | Traces |
|---|---|---|
| **AC-A1** | An **account-only** opportunity persists | FR-A2 |
| **AC-A2** | A **person-only** opportunity persists | FR-A2 |
| **AC-A3** | An opportunity with **neither** subject is refused by a database constraint, **and no person is minted** to satisfy it | FR-A2, FR-A3 |
| **AC-A4** | Detection reason is preserved verbatim | FR-A10 |
| **AC-A5** | Replay creates no second opportunity; last-seen advances, first-seen does not | FR-A7, FR-A26 |
| **AC-A6** | Re-linking the same signal is refused by a unique constraint and is a no-op | FR-A8, FR-A26 |
| **AC-A7** | A role record persists with no person and with inference provenance set | FR-A15, FR-A16 |
| **AC-A8** | Linking a later-discovered person **updates** the role record; the inference is retained | FR-A17 |
| **AC-A9** | Inference provenance is **mandatory** — a null is refused | FR-A15 |
| **AC-A10** | An evaluation references exactly one subject; both-or-neither is refused | FR-A21 |
| **AC-A11** | An opportunity with no evaluation reads **open**, never disqualified | FR-A6, FR-A22 |
| **AC-A12** | Contradictory signals yield **one** opportunity, reduced confidence, **both signals retained** | FR-A12 |
| **AC-A13** | A stale opportunity is reported stale and is **not** auto-closed | FR-A13 |
| **AC-A14** | A suppressed subject still yields an opportunity, and its action state is **not** actionable | BR-A4 |
| **AC-A15** | Suppression is tenant-scoped: one tenant's instruction does not suppress another's subject | BR-A4, FR-A27 |
| **AC-A16** | Cross-tenant account, person and signal references are **unconstructible** | FR-A27 |
| **AC-A17** | Cross-tenant **read** returns zero rows under two genuinely separate authenticated sessions, with production-shaped grants re-created first, so the denial is attributable to row-level security and **not** to a missing grant | FR-A27 |
| **AC-A18** | An unauthorized action is **denied and audited** | FR-A28, FR-A30 |
| **AC-A19** | An action without satisfied step-up is denied with a step-up-required outcome, and audited | FR-A28, FR-A30 |
| **AC-A20** | **Concurrent** duplicate creation: two genuine sessions race; one wins, the other observes the constraint or the lock, and exactly **one** opportunity exists afterwards | FR-A7, FR-A26 |
| **AC-A21** | Retry after a failed attempt creates no second opportunity and no orphan links | FR-A26 |
| **AC-A22** | A forced failure anywhere in the write leaves **no** opportunity, **no** links, **no** roles and **no** partial audit or provenance state | FR-A19, FR-A30 |
| **AC-A23** | Ordinary account deletion is **refused** while a non-terminal opportunity exists; nothing is partially deleted | FR-A32 |
| **AC-A24** | Ordinary account deletion **succeeds** once all referencing opportunities are terminal | FR-A32, FR-A33 |
| **AC-A25** | Person erasure leaves the opportunity account-anchored, with no person reference and the evidence intact | FR-A36 |
| **AC-A26** | Refusal messages contain no need statement and no attribute value | FR-A31 |
| **AC-A27** | PI performs **no write** to any Community Discovery record, proven by a repository-wide scan | FR-A23, FR-A24 |
| **AC-A28** | Existing Community Discovery read contracts are unchanged | FR-A25 |
| **AC-A29** | **Legal erasure** completes through the governed path without being blocked by FR-A32 | FR-A34 — **cannot be specified further until §6 Q1–Q3 are answered** |

### 3.1 Negative controls — the test suite must be proven capable of failing

Each plants a defect in a **disposable database only**, proves the corresponding acceptance criterion fails, then restores and re-asserts. A criterion with no negative control is not accepted as proven.

| ID | Control | Proves |
|---|---|---|
| **NC-A1** | Remove the subject constraint → **AC-A3 must fail** | the constraint refuses, not the test's own predicate |
| **NC-A2** | Weaken the duplicate-prevention index → **AC-A5 and AC-A20 must fail** | duplicate prevention is a real index |
| **NC-A3** | Change the account reference to cascade → **AC-A23 must fail** | refusal is the schema, not the application |
| **NC-A4** | Introduce a person-creating write into the opportunity services → a repository scan **must flag it** | FR-A3 is enforced, not merely stated |
| **NC-A5** | Introduce a PI write to a Community Discovery record → the one-way scan **must flag it** | FR-A24 is enforced |
| **NC-A6** | Make the canonical write non-atomic → **AC-A22 must fail** | atomicity is the transaction |
| **NC-A7** | Remove a composite tenant-safe foreign key → **AC-A16 must fail** | isolation is structural |
| **NC-A8** | Force the consent evaluator to always allow → **AC-A14 must fail** | consent is evaluated, not assumed |
| **NC-A9** | Relax inference provenance to optional → **AC-A9 must fail** | FR-A15 is enforced |
| **NC-A10** | Run AC-A17 **without** re-creating grants, and confirm the failure mode is a privilege error rather than a zero-row result | a missing grant cannot masquerade as isolation |
| **NC-A11** | Scans must not match prose — comments stripped and string literals handled | a detector that matches a header comment proves nothing |

---

## 4. Scope and exclusions

### 4.1 In scope of this addendum

The canonical opportunity entity, its signal references, its relational buying roles, its linkage to the single evaluation authority, the ordinary-deletion refusal gate, person-erasure behaviour, and the security, audit, idempotency and concurrency properties above.

### 4.2 Explicitly excluded

| Excluded | Reason |
|---|---|
| The Community Discovery → PI bridge implementation | Separate work package; depends on **D-C**, which is **OPEN** |
| **Need-to-offering matching** | **Already ratified elsewhere — see §5.** Not in this addendum, and **not authorized by it** |
| Company-event signal production | **No source is authorized.** Signal types and weights existing in code are **code, not authorization** |
| Generalizing the second-approver machinery | Depends on the high-risk catalogue (§6 Q4) |
| Any change to existing canonical write atomicity, arbitration, security behaviour or list governance | Out of scope and protected |
| Any row-level-security redesign | Separate design track, **OPEN** |
| Retention periods | **Not defined here** (FR-A35) |

---

## 5. Traceability to the ratified carrier

| Addendum area | Ratified requirement | Carrier status |
|---|---|---|
| Buying role | **FR-21** | PARTIAL |
| Buying committee | **FR-22**, **BR-25** | PARTIAL / PARTIALLY SATISFIED |
| Intent contribution | **FR-19** | EXISTS |
| Engagement evidence | **FR-20** | EXISTS |
| Suppression at action time | **FR-27** | EXISTS |
| **Canonical opportunity entity** | **none** | **the gap this addendum addresses** |

### 5.1 Need-to-offering matching is already ratified — and is not expanded here

The ratified carrier already records **FR-16 Account → `product/service alignment`** and **FR-17 Person → `problem relevance`** as **"REQUIRED — NOT YET IMPLEMENTED"**.

Need-to-offering matching therefore **traces to FR-16 and FR-17 and needs no addendum requirement.** It is deliberately **excluded** from this addendum's scope (§4.2), it does **not** expand the opportunity-spine scope, and nothing here authorizes it. Its method — curated vocabulary versus embeddings — remains **OPEN (D-E)**.

---

## 6. Unresolved dependencies

Nothing below is resolved by this addendum, and no approval is inferred for any of it.

### 6.1 Policy questions that must be answered before FR-A33/FR-A34 can be implemented

| # | Question | Blocks |
|---|---|---|
| **Q1** | Which lifecycle states count as **terminal** for ordinary deletion — in particular, does an **acted** opportunity block deletion? | FR-A32, AC-A23/AC-A24 |
| **Q2** | May an operator **bulk-resolve** blocking opportunities, and must a resolution carry a **reason code** — and from which vocabulary? | FR-A33 |
| **Q3** | What constitutes the **"approved policy"** governing the legal-erasure path: who may invoke it, what authorization and evidence it requires, and what record survives erasure? | FR-A34, AC-A29 |
| **Q4** | The **designated high-risk action catalogue**, and whether the existing approval machinery should be generalized or paralleled | FR-A29 |

### 6.2 Decisions explicitly still open — no approval inferred

**OD-3** list permissions and archive semantics · **OD-4** `added_via` contract · **OD-5** person-erasure residue · **D-C** person/contact reconciliation · **D-E** matching method · **company-event sources** (none authorized) · **row-level-security design track** · **production migration state** of the PI migrations (UNVERIFIED) · **production tenant isolation** (UNVERIFIED).

### 6.3 Honest limitation carried into this addendum

AC-A16 and AC-A17 demonstrate isolation **on a disposable database**. On the live path, isolation rests on **application logic plus composite foreign keys, not row-level security**, because the service role holds a row-level-security bypass and the application connects as that role. **Production isolation is UNVERIFIED and this addendum does not claim it.**

---

## 7. Status and next step

| | |
|---|---|
| Status | **PROPOSED — v0.1** |
| Ratified | **NO** |
| Approved | **NO** |
| Authorizes implementation | **NO** |
| Next step | **Owner review.** Ratification is a separate act. Q1–Q3 must be answered before the deletion and erasure requirements (FR-A32…FR-A37) are implementable, and Q4 before FR-A29 |
