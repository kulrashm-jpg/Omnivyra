# PI-ADD-001 **v0.2-PROPOSED** — canonical opportunity spine · requirement addendum

| | |
|---|---|
| **Identifier** | **PI-ADD-001** |
| **Version** | **v0.2-PROPOSED** |
| **Status** | **PROPOSED — NOT RATIFIED, NOT APPROVED, NOT IMPLEMENTATION-AUTHORIZING** |
| File | `docs/pmo/prospect-intelligence/PI-REQUIREMENTS-ADDENDUM-002-PROPOSED.md` |
| Supersedes (for review purposes only) | **v0.1-PROPOSED** at `PI-REQUIREMENTS-ADDENDUM-001-PROPOSED.md`, SHA-256 `f244adb96027f8078ec263c2ae6aa25f5b46c0ce2ba6cc7daab239a0438a5ad0`, 236 lines — **verified unchanged and NOT edited by this task** |
| Drafted | 2026-10-17 |
| Relationship to the ratified carrier | **ADDITIVE AND SEPARATE.** `IMPLEMENTATION-MANIFEST-001.md` (`651575cd73f1c3a7e6e04f0d…`, 540 lines) is **not edited** |
| Governing decisions | `PI-Q1-Q2-DECISION-CLOSURE-002.md` (`3b3d6e28f94132c91fe4f809…`, 291 lines), `PI-Q1-Q2-OWNER-DECISIONS-001.md` (`88be0578…`, 293), `PI-Q1-Q2-REMAINDER-001.md` (`52ae61bb…`, 318) |

**This document confers no authorization.** It is a draft for owner review. Ratification is a separate owner act, and implementation requires a further explicit authorization after ratification. **No direction below is described as ratified or implemented.**

### Identifier scheme — unchanged from v0.1

Addendum identifiers carry an `A` band (`BR-A…`, `FR-A…`, `AC-A…`, `NC-A…`) so they cannot collide with the ratified carrier's `BR-01…BR-30`, `FR-01…FR-30`, `AC-01…AC-12`, `SEC-001`.

### What changed from v0.1

**All 83 v0.1 identifiers are preserved** — BR-A1…BR-A6, FR-A1…FR-A37, AC-A1…AC-A29, NC-A1…NC-A11. Two are **restated** (BR-A6, FR-A6), one gains an explicit precondition (FR-A36/AC-A25), and the Q1/Q2 owner directions are added as **new** identifiers FR-A38…FR-A46, AC-A30…AC-A42, NC-A12…NC-A19. Nothing is deleted.

### Three boundaries that must not be eroded

1. **`lead_signals` not appearing in `RETENTION_TARGETS` is NOT evidence of a retention guarantee.** It is an absence of policy.
2. **`prospect_list_members.removal_reason` is NOT the contract for `opportunity_lifecycle_states.reasoning`.** It is supporting precedent only; the governing contract is named in FR-A44.
3. **Existing source documents are evidence, not authorization to implement their proposals.**

---

## 1. Business requirements

| ID | Requirement | Status |
|---|---|---|
| **BR-A1** | Represent a buying opportunity or need as a canonical, tenant-scoped record, independently of whether a named person is known | pending approval |
| **BR-A2** | An opportunity shall preserve **why it was identified**, for as long as it exists | pending approval |
| **BR-A3** | An opportunity shall carry **inferred buying roles** without asserting that a person exists | pending approval |
| **BR-A4** | Consent and suppression govern **action on** an opportunity, not the **existence of** knowledge about it | pending approval |
| **BR-A5** | Community Discovery remains the authority on signal **interpretation**; PI is the authority on **identity, permission, qualification and lifecycle** | **owner-approved direction** (D-A) |
| **BR-A6** | **RESTATED — see §1.1.** Opportunity records shall not become a competing prospect, person, account, suppression or signal repository, and no additional parallel lead/opportunity store shall be introduced | pending approval |

### 1.1 BR-A6 — corrected rationale (correction 1)

**The v0.1 rationale cited a stale claim and is withdrawn.** v0.1 justified BR-A6 by describing `lead_intelligence` as a tenant-unsafe outlier with *"`company_id text`, no FK"*. **That claim is stale and is not repeated as fact here.**

**Verified current reality.** `supabase/migrations/20260921000000_w2_lead_intelligence_uuid_reconciliation.sql` reconciled the types and foreign keys:

- `:7` — `lead_intelligence.company_id  text -> uuid  FK -> companies(id)`
- `:8` — `lead_intelligence.unified_person_id  text -> uuid  composite FK -> unified_persons(id, company_id)`
- `:9` — `lead_intelligence_profiles.company_id  text -> uuid  FK -> companies(id)`
- `:184-187` — `ADD CONSTRAINT lead_intelligence_person_tenant_fk FOREIGN KEY (unified_person_id, company_id) REFERENCES public.unified_persons(id, company_id) ON DELETE RESTRICT`

**`lead_intelligence` is tenant-safe.** It uses a UUID tenant key with a foreign key to `companies(id)` and a composite tenant-safe foreign key to `unified_persons`. **It is not an outlier and must not be cited as one.**

**The corrected rationale for BR-A6, which does not depend on the withdrawn claim:**

1. **Count.** Six lead/opportunity-shaped models already exist — `canonical_leads`, `opportunity_feed_items`, `active_leads`, `lead_signals`, `contacts`, `lead_intelligence` — plus `lead_intelligence_profiles`, `marketpulse_signals` and the legacy `leads` (a different entity: web-form/visitor attribution). A seventh parallel store would add ambiguity about which record is authoritative, which is the problem this programme exists to reduce.
2. **Adoption, not safety, is the demonstrated failure mode.** `lead_intelligence` has a repository (`backend/services/leadIntelligence/leadIntelligenceRepository.ts:27`) and no observed producer. Its own migration header states it *"Creates two NEW tables; modifies/migrates NOTHING existing"* and lists the lead tables it leaves untouched. A new store can be perfectly tenant-safe and still fail by going unused while the old paths continue.
3. **Governance.** Consent, dedup and erasure attach to specific tables. Each additional store is another surface those controls must be extended to, or another gap.

**This is a corrected rationale, not a new requirement.** BR-A6's substance is unchanged.

---

## 2. Functional requirements

### 2.1 Canonical opportunity model and subject invariant

| ID | Requirement | Status |
|---|---|---|
| **FR-A1** | Tenant-scoped by `organization_id`, a non-null UUID foreign key to `companies(id)` | pending approval |
| **FR-A2** | May reference an **account**, a **person**, or **both**, and shall reference **at least one** | **owner-approved direction** (D-B) |
| **FR-A3** | The system shall **never create a person record** to satisfy FR-A2 | **owner-approved direction** (D-B, explicit) |
| **FR-A4** | `opportunity_type` drawn from the **existing** Community Discovery vocabulary | pending approval |
| **FR-A5** | Record **how the need was arrived at** (`need_source`), so an inference is never readable as a declaration | pending approval |
| **FR-A6** | **RESTATED — see §2.1.1.** The opportunity's lifecycle state and its terminality are governed by the **existing nine-state opportunity lifecycle vocabulary**, not by a vocabulary defined in this addendum | **owner-approved direction** (Q1-1) |
| **FR-A7** | Re-detection of the same need about the same subject shall **update one record**, not create a second | pending approval |

#### 2.1.1 FR-A6 — corrected lifecycle vocabulary

**The v0.1 six-value vocabulary is withdrawn.** v0.1 proposed `open`, `qualified`, `disqualified`, `acted`, `closed`, `superseded`. **Five of those six do not exist in the authoritative model, and `acted` exists nowhere in schema or code.**

**The authoritative vocabulary, verified in two independent places:**

- Schema: `supabase/migrations/20260520_phase6_realtime_lifecycle_workflow.sql` — `CHECK (state IN ('detected','triaged','reviewing','qualified','monitoring','outreach_planned','converted','dismissed','archived'))`, with a matching CHECK on `previous_state`.
- Code: `backend/types/opportunityLifecycle.ts:1-11` — `LIFECYCLE_STATES`, a nine-member `as const` tuple; runtime guard `isLifecycleState()` at `:46-49`.
- Enforcement: `ALLOWED_LIFECYCLE_TRANSITIONS` (`:36-46`) and `canTransitionLifecycle()` (`:57-67`), applied by `transitionLifecycle()` (`backend/services/opportunityLifecycleService.ts:125-156`), which resolves the current state, consults the allowlist, throws `LifecycleTransitionError` on refusal, and only then appends a history row.

**FR-A6 therefore requires that no parallel lifecycle or terminality vocabulary be introduced.**

### 2.2 Signal references, evidence and provenance

| ID | Requirement | Status |
|---|---|---|
| **FR-A8** | **Reference** supporting signals in the existing signal store; **do not copy their content** | **owner-approved direction** (D-A.1) |
| **FR-A9** | Support **one or more** supporting signals, accumulating over time | pending approval |
| **FR-A10** | Retain the detection reason verbatim, and a reference to the originating detection record | pending approval |
| **FR-A11** | Evidence observation times are authoritative and **never back-dated**; undated evidence is excluded, not assigned an ingestion time | pending approval |
| **FR-A12** | Contradictory signals **lower confidence** and **retain both signals**; evidence is never silently overwritten or deleted, and a contradiction does not auto-disqualify | pending approval |
| **FR-A13** | Staleness is **reported**, not auto-closed | pending approval |

### 2.3 Relational buying roles and inference provenance

| ID | Requirement | Status |
|---|---|---|
| **FR-A14** | Buying roles stored in a **dedicated relational entity**, not a serialized blob | **owner-approved direction** (D-I) |
| **FR-A15** | A role record carries **mandatory inference provenance** | **owner-approved direction** (D-I) |
| **FR-A16** | A role record's person reference is **optional**; absent is the normal opportunity-first state | **owner-approved direction** (D-I) |
| **FR-A17** | A later-discovered person is **linked, not replaced**, so inference and confirmation are both auditable | **owner-approved direction** (D-I) |
| **FR-A18** | Role vocabulary reuses the existing canonical buying-role vocabulary | pending approval |

### 2.4 Scoring and evaluation authority

| ID | Requirement | Status |
|---|---|---|
| **FR-A19** | Fit, intent, urgency, opportunity, priority, confidence and qualification recorded in the **existing single evaluation authority**; no second scoring store | pending approval |
| **FR-A20** | Each evaluation carries its **rules version** and a reasoned explanation, including gaps and refusals | pending approval |
| **FR-A21** | An evaluation references **exactly one** subject — a prospect or an opportunity, never both and never neither — enforced as a database constraint | pending approval |
| **FR-A22** | Absence of evidence produces **abstention, never a zero score** | pending approval |

### 2.5 One-way Community Discovery → PI integration

| ID | Requirement | Status |
|---|---|---|
| **FR-A23** | The integration is **strictly one-way**: Community Discovery → PI | **owner-approved direction** (D-A.1) |
| **FR-A24** | PI shall **not write** to Community Discovery detection, clustering, signal or roll-up records | **owner-approved direction** (D-A.1) |
| **FR-A25** | Existing Community Discovery read contracts remain **unchanged** | **owner-approved direction** (D-A.1) |
| **FR-A26** | The integration is **safely re-runnable**: replay creates no duplicate opportunity and no duplicate signal link | pending approval |

### 2.6 Security, authorization and audit

| ID | Requirement | Status |
|---|---|---|
| **FR-A27** | Cross-tenant reference is structurally **unconstructible**, via composite tenant-safe foreign keys | pending approval |
| **FR-A28** | Every write surface requires an explicit authorization check, with **step-up** as the baseline for acting on an opportunity | **owner-approved direction** (D-J baseline, Q2-3) |
| **FR-A29** | A **second approver** is required only for designated high-risk actions. The catalogue is **not defined here** — §6.1 Q4 | **unresolved** |
| **FR-A30** | Authorization decisions, **including denials**, audited to the existing security audit sink; no new audit store | **owner-approved direction** (A-9) |
| **FR-A31** | Refusal messages **never contain** a need statement or attribute value | pending approval |

### 2.7 Deletion and erasure

| ID | Requirement | Status |
|---|---|---|
| **FR-A32** | **Ordinary** account deletion is **refused** while non-terminal opportunities reference the account, atomically, nothing partially deleted | **owner-approved direction** (D-H, A-2/A-3) |
| **FR-A33** | A **governed resolution path** exists by which an operator clears blocking opportunities, under authorization and audit | **owner-approved direction**; mechanism constrained by FR-A40/FR-A42 |
| **FR-A34** | **Legal erasure** proceeds through a **governed legal-erasure path under approved policy**, and is not permanently blocked by FR-A32 | **owner-approved direction**, but **UNRESOLVED in substance — see §5** |
| **FR-A35** | This addendum defines **no retention period** and specifies **no automatic retention** | **owner-approved constraint** |
| **FR-A36** | Person erasure removes the person and does **not** destroy the account-anchored opportunity or its evidence; the surviving record names no individual. **PRECONDITION — see §2.7.1** | pending approval |
| **FR-A37** | Deletion and erasure are **never** a silent cascade of evidence, and never weaken FR-A2 | **owner-approved constraint** |

#### 2.7.1 FR-A36 precondition (correction 3)

**FR-A36 and AC-A25 presume a reachable person-erasure path. That presumption is not currently satisfied, and the precondition is stated rather than assumed:**

- `erasePerson` exists at `backend/services/prospectIdentity/personErasure.ts:149`, with `deletePersonRow` at `:384` and a fail-closed guard at `:356`.
- It is exported from `backend/services/prospectIdentity/index.ts:129` and has **no API route caller**. The capability exists; the entry point does not.
- `lead_intelligence_person_tenant_fk` is `ON DELETE RESTRICT` (`20260921000000:184-187`), so person deletion can be blocked outright where a `lead_intelligence` row references the person.

**FR-A36 is therefore conditional on a reachable and unblocked person-erasure path. AC-A25 is testable only where erasure can actually run**, and is otherwise deferred to the erasure work package.

### 2.8 Lifecycle, terminality and resolution — NEW, from the Q1/Q2 owner decisions

**Policy directions. None is a claim that the application implements them — see §4.**

| ID | Requirement | Governing decision |
|---|---|---|
| **FR-A38** | **`archived` is the sole terminal state** for ordinary account-deletion eligibility | **A-2** |
| **FR-A39** | **All other states are non-terminal** for this purpose — including `dismissed`, `converted`, and any **unknown or future** state, which **fails closed** as non-terminal | **A-3** |
| **FR-A40** | `converted` must transition to `archived` **through the existing validated and audited lifecycle mechanism** before qualifying as resolved. No new state is invented and the allowed-transition mechanism is not bypassed | **A-4** |
| **FR-A41** | The lifecycle state meanings are the owner-approved definitions in §2.8.1 | **Q1 definitions** |
| **FR-A42** | Bulk resolution is permitted **only** as transition-to-`archived` for the purpose of clearing an ordinary account-deletion block, with **independent per-item validation and per-item outcomes**. It shall **not** be broadened into general bulk opportunity resolution | **Q2-1, narrowly scoped** |
| **FR-A43** | **No separate controlled reason code is required.** The **target lifecycle state** is the controlled element. No new reason-code enum is introduced, and the disposition enum is **not** repurposed as a deletion-resolution vocabulary | **Q2-4, A-10, A-6/A-11** |
| **FR-A44** | The explanation is **optional and retained verbatim**, under the existing nullable contract **`opportunity_lifecycle_states.reasoning`** — `reasoning TEXT NULL` (`20260520_phase6_realtime_lifecycle_workflow.sql:19`); type `reasoning: string \| null` (`opportunityLifecycle.ts:20`); written on every transition (`opportunityLifecycleService.ts:143`). **`prospect_list_members.removal_reason` is supporting precedent only and is NOT this contract** | **Q2-5, A-12** |
| **FR-A45** | A repeated archive request for an already-`archived` opportunity shall return an explicit **already-resolved** result, not a spurious invalid-transition failure | **A-13** |
| **FR-A46** | `detection_ref` **may become unresolvable** — see §2.8.2. This is a documented limitation and acceptance decision, not a defect to be fixed by adding a foreign key | **pending owner review** |

#### 2.8.1 Approved lifecycle state meanings

| State | Owner-approved definition |
|---|---|
| **`triaged`** | Initial assessment, ready for further qualification or review, and supports reopening accidental dismissal |
| **`reviewing`** | Active assessment with revisable qualification, respecting the existing lifecycle transition rules |
| **`monitoring`** | Observe an opportunity for future developments, including conversion without planned outreach, subject to the existing transition rules |

Each is consistent with the verified topology: `triaged` is the reopen target of `dismissed` (`opportunityLifecycle.ts:44`); `reviewing` is bidirectional with `qualified` (`:39`, `:40`); `monitoring` is the only non-outreach state that can reach `converted` directly (`:41`).

The remaining six states (`detected`, `qualified`, `outreach_planned`, `converted`, `dismissed`, `archived`) are **not** redefined here.

#### 2.8.2 `detection_ref` retention consequence (correction 4) — KNOWN LIMITATION, pending owner acceptance

**Verified facts:**

- `backend/types/retention.ts:4` — `'opportunity_feed_items'` is a member of `RETENTION_TARGETS`.
- `:57` — its binding is `{ table: 'opportunity_feed_items', time_column: 'created_at', soft_delete_column: null }`.
- `:15-16` — `RETENTION_ARCHIVAL_MODES = ['soft_delete', 'hard_delete']`.

**Consequence.** Because `soft_delete_column` is `null`, soft delete is unavailable for that table, so a retention action on it is necessarily a **hard delete**. The proposed `detection_ref` — a plain UUID pointing at `opportunity_feed_items.id` — can therefore become **permanently unresolvable**.

**What is proposed, and what is deliberately not:**

| | |
|---|---|
| **Accepted** | `detection_ref` may become unresolvable after a retention action. This is **documented and accepted**, subject to owner review |
| **Why it is tolerable** | `detection_ref` is deliberately a plain UUID and **not** a foreign key, so retention cannot cause a referential failure; and **`detected_reason` is carried verbatim on the opportunity** (FR-A10), so the reason an opportunity exists survives the loss of the detection record |
| **NOT proposed** | **No foreign key is added** — that would make retention fail or cascade. **No retention guarantee is invented** for `opportunity_feed_items` |
| **Boundary** | **`lead_signals` not appearing in `RETENTION_TARGETS` is NOT a retention guarantee.** It is an absence of policy and may change |

**Status: KNOWN LIMITATION — pending owner acceptance.** FR-A46 records it; AC-A42 tests that the reason survives.

---

## 3. Acceptance criteria

All v0.1 criteria **AC-A1…AC-A29 are preserved unchanged**, except AC-A25, whose precondition is stated in §2.7.1, and AC-A29, which remains unspecifiable pending §5.

Criteria are properties to be demonstrated against the **real schema** on a disposable database. Counts are read from the test runner, never from a wrapper exit code.

### 3.1 Preserved from v0.1 — summary

| Range | Covers |
|---|---|
| **AC-A1…AC-A3** | account-only, person-only, and neither-subject-refused with **no person minted** |
| **AC-A4…AC-A6** | detection reason verbatim; replay creates no second opportunity; re-linking a signal is refused |
| **AC-A7…AC-A9** | role with no person; later person **links** not replaces; inference provenance mandatory |
| **AC-A10…AC-A11** | evaluation references exactly one subject; no evaluation reads **open**, never disqualified |
| **AC-A12…AC-A13** | contradiction lowers confidence and retains both signals; staleness reported not auto-closed |
| **AC-A14…AC-A15** | suppressed subject still yields an opportunity, not actionable; suppression tenant-scoped |
| **AC-A16…AC-A17** | cross-tenant references unconstructible; cross-tenant read returns zero rows with grants re-created first |
| **AC-A18…AC-A19** | unauthorized denied and audited; unsatisfied step-up denied and audited |
| **AC-A20…AC-A22** | concurrent duplicate creation yields exactly one; retry creates no orphans; forced failure leaves nothing partial |
| **AC-A23…AC-A24** | ordinary deletion refused while non-terminal; succeeds once all terminal |
| **AC-A25** | person erasure leaves the opportunity account-anchored — **precondition §2.7.1** |
| **AC-A26** | refusal messages carry no need statement or attribute value |
| **AC-A27…AC-A28** | PI writes nothing to Community Discovery, proven by scan; existing read contracts unchanged |
| **AC-A29** | legal erasure completes through the governed path — **cannot be specified until §5 is resolved** |

### 3.2 New criteria from the Q1/Q2 directions

| ID | Criterion | Traces |
|---|---|---|
| **AC-A30** | The terminal set is a **single named constant** containing exactly `archived`; a second spelling anywhere is a test failure | FR-A38 |
| **AC-A31** | Ordinary account deletion is **refused atomically** while any referencing opportunity is non-terminal; nothing partially deleted | FR-A32, FR-A38 |
| **AC-A32** | Ordinary account deletion **succeeds** once every referencing opportunity is `archived` | FR-A38 |
| **AC-A33** | A **`converted`** opportunity **blocks** deletion until archived | FR-A40 |
| **AC-A34** | A **`dismissed`** opportunity **blocks** deletion until archived | FR-A39 |
| **AC-A35** | An **unrecognised** state **blocks** deletion (fail closed), proven by an out-of-vocabulary value where the schema permits one, or by a unit test of the predicate where it does not | FR-A39 |
| **AC-A36** | Bulk archive performs **N capability checks for N items**; one denial neither denies nor permits the rest | FR-A42, FR-A28 |
| **AC-A37** | An action without satisfied step-up is denied with a step-up-required outcome | FR-A28 |
| **AC-A38** | Every authorization decision, **including every denial**, writes one audit event, and the denial reveals **nothing** about another tenant — not row counts, not identifiers, not existence | FR-A30 |
| **AC-A39** | A repeat archive request for an already-`archived` item reports **already resolved**, not a failure, and appends **no** second history row | FR-A45 |
| **AC-A40** | **No bulk lifecycle operation other than archive-for-deletion-block-clearance is exposed**; any other bulk transition is absent or refused | FR-A42 |
| **AC-A41** | A supplied explanation is stored **verbatim**; its absence is **not** an error; the mandatory audit facts (`previous_state`, `actor_user_id`, `transitioned_at`) are present on every transition regardless | FR-A44 |
| **AC-A42** | When the referenced `opportunity_feed_items` row no longer exists, the opportunity still returns its **`detected_reason` verbatim**, and no referential error occurs | FR-A46 |
| **AC-A43** | Resolution uses the existing enforced transition path; the allowlist is never bypassed, and an illegal transition is refused by the allowlist rather than by caller discipline | FR-A33, FR-A40 |

### 3.3 Negative controls

v0.1's **NC-A1…NC-A11 are preserved unchanged**. Each plants a defect in a **disposable database or test double only**, proves the stated criterion fails, then restores and re-asserts. **A criterion with no negative control is not accepted as proven.**

| ID | Control | Proves |
|---|---|---|
| **NC-A12** | Add `converted` to the terminal set | **AC-A33 must fail** |
| **NC-A13** | Add `dismissed` to the terminal set | **AC-A34 must fail** |
| **NC-A14** | Make the terminal predicate default unknown states to terminal | **AC-A35 must fail** |
| **NC-A15** | Grant blanket authority in place of the per-item check | **AC-A36 must fail** |
| **NC-A16** | Remove the step-up requirement | **AC-A37 must fail** |
| **NC-A17** | Suppress denial auditing | **AC-A38 must fail** |
| **NC-A18** | Remove the already-resolved mapping | **AC-A39 must fail.** This control is load-bearing: `canTransitionLifecycle` returns `{allowed:false, reason:'no_op_same_state'}` at `opportunityLifecycle.ts:61` and `transitionLifecycle` **throws** at `opportunityLifecycleService.ts:136`, so without the mapping a retry surfaces a spurious failure |
| **NC-A19** | Hard-delete the referenced detection row, then read the opportunity | **AC-A42 must still pass** — `detected_reason` survives and no referential error occurs |
| **NC-A20** | Expose a second bulk lifecycle transition | **AC-A40 must fail** |

---

## 4. Policy versus current behaviour — nothing here is implemented

**No direction in this addendum is claimed to be implemented.** Verified current behaviour:

| Direction | Current code | Gap |
|---|---|---|
| FR-A38 terminal set | **No terminality concept exists.** `grep -ni 'terminal'` across `opportunityLifecycle.ts` and `opportunityLifecycleService.ts` matches **only a doc comment** — never a constant, type or check | **NOT IMPLEMENTED** |
| FR-A32 / FR-A40 deletion gate | No deletion gate exists; the canonical opportunity entity does not exist | **NOT IMPLEMENTED** |
| FR-A41 state meanings | Documented nowhere. `components/recommendations/tabs/AnalystWorkspacePanel.tsx:65-80` carries a display ordering and colour classes only — no label text, tooltip or help copy | **NOT DOCUMENTED** before this addendum |
| FR-A42 bulk archive | No bulk operation exists for opportunities; `pages/api/active-leads/lifecycle.ts` transitions one item | **NOT IMPLEMENTED** |
| FR-A28 / FR-A30 capability + step-up, audited denials | The lifecycle route authorizes with `getUserRole(ctx.userId, companyId)` at `pages/api/active-leads/lifecycle.ts:59`, `403` at `:60`, a further role check at `:62`. **No capability check, no step-up, no idempotency wrapper.** `opportunityLifecycleService.ts:122-123` states *"Caller (API) is responsible for RBAC checks."* **Denied transitions are not audited today** | **NOT IMPLEMENTED — this is the approved security upgrade** |
| FR-A45 already-resolved | **Opposite behaviour today** — see NC-A18 | **NOT IMPLEMENTED** |
| FR-A43 no new reason enum | Nothing to change; no such enum exists | **ALREADY COMPLIANT** |
| FR-A43 disposition enum not repurposed | Nothing reuses it; `opportunity_dispositions` is a separate triage axis | **ALREADY COMPLIANT** |
| FR-A44 optional free-text | **Already satisfied** by the named contract | **ALREADY COMPLIANT** |

### 4.1 A contradictory comment in application code — identified, NOT edited

| | |
|---|---|
| File / lines | `backend/types/opportunityLifecycle.ts`, **lines 30–31** (doc block 27–34) |
| Exact text | *"`converted` and `archived` are terminal — they only accept `archived` as a follow-up (so a converted row can be tombstoned but never revived as detected)."* |
| **Two distinct errors** | **(a)** `converted` is **not** terminal — `converted: ['archived']` at `:43` gives it an outgoing transition. **(b)** *"they only accept `archived` as a follow-up"* is false **for `archived` itself** — `archived: []` at `:45` accepts **nothing**. The sentence mis-describes both states it names |
| Required correction | Restate so `archived` is the sole absorbing state and `converted` a non-absorbing outcome state that must be archived to qualify as resolved, consistent with FR-A38 and FR-A40 |
| **Status** | **OPEN — application-code comment. NOT edited by this task.** Requires a separate authorized change |

---

## 5. Q3 — legal-erasure policy remains UNRESOLVED and BLOCKED

**The authoritative legal-erasure and retention policy has NOT been located, and approval remains UNVERIFIED.**

`docs/pmo/prospect-intelligence/PI-CONTRACT-002-data-lifecycle.md` is on scope but its own header states **"CONTRACT PREPARED — AWAITING POLICY DECISIONS"** and **"It invents no legal or compliance policy."** Supporting fact: `backend/types/retention.ts:1-12` — `RETENTION_TARGETS` is a closed ten-member list and **no PI identity table appears in it**.

**This addendum invents no legal authority, no retention period, no surviving-record rule and no erasure semantics.** Absence of a policy in this repository is **not** treated as proof that none exists elsewhere.

**The Q3 gate is NOT closed.** FR-A34, FR-A35 and AC-A29 remain unresolvable until it is. The eight missing sub-decisions stand as recorded in `PI-C1-OWNER-DECISIONS-002.md` §5.5.

---

## 6. Scope, exclusions and unresolved dependencies

### 6.1 Unresolved

| # | Item | Blocks |
|---|---|---|
| **Q3** | approved legal-erasure/retention policy | FR-A34, FR-A35, AC-A29 |
| **Q4** | designated high-risk action catalogue | FR-A29 |
| **D-C** | person/contact reconciliation | the bridge package |
| **D-E** | need-to-offering matching method | the matching package |
| **OD-3 / OD-4 / OD-5** | list permissions, `added_via`, erasure residue | WP-4, WP-5 |
| **Company-event sources** | **none authorized** — signal types and weights in code are code, not authorization | — |
| Production migration state of the PI migrations | **UNVERIFIED** | release |
| Production tenant isolation | **UNVERIFIED** | — |

### 6.2 Explicitly excluded from this addendum

The Community Discovery → PI bridge implementation (depends on **D-C**); **need-to-offering matching**, which is already ratified as **FR-16** *"product/service alignment"* and **FR-17** *"problem relevance"* in the carrier and is **not expanded or authorized here**; company-event signal production; generalizing the second-approver machinery; any change to existing canonical write atomicity, arbitration, security behaviour or list governance; any row-level-security redesign; and **retention periods** (FR-A35).

### 6.3 Honest limitation carried forward

AC-A16, AC-A17 and the new AC-A38 demonstrate isolation **on a disposable database**. On the live path, isolation rests on **application logic plus composite foreign keys, not row-level security**, because the service role holds a row-level-security bypass and the application connects as that role. **Production isolation is UNVERIFIED and this addendum does not claim it.**

---

## 7. Traceability

| # | Correction or requirement | Governing owner decision / source | v0.2 section | Classification |
|---|---|---|---|---|
| 1 | `lead_intelligence` rationale corrected | `20260921000000_w2_lead_intelligence_uuid_reconciliation.sql:7-9, 184-187` | **§1.1** | **verified current behaviour** (the correction); BR-A6 **pending approval** |
| 2 | Stale claim in `OMNIVYRA-PI-OPPORTUNITY-SPINE-DESIGN-001.md:32` | same migration | **§1.1** + §8.1 | **correction documented, source NOT edited** |
| 3 | Stale claim in `PI-C1-IMPLEMENTATION-GATE-001.md:300` | same migration | **§1.1** + §8.1 | **correction documented, source NOT edited** |
| 4 | `detection_ref` retention consequence | `backend/types/retention.ts:4, 15-16, 57` | **§2.8.2**, FR-A46, AC-A42, NC-A19 | **known limitation — pending owner acceptance** |
| 5a | Lifecycle vocabulary owns terminality | Q1-1 / A-1 | FR-A6, **§2.1.1** | **policy direction** |
| 5b | `archived` sole terminal state | A-2 | FR-A38, AC-A30–AC-A32 | **policy direction** |
| 5c | All other states non-terminal, unknown fails closed | A-3 | FR-A39, AC-A34, AC-A35 | **policy direction** |
| 5d | `converted` must archive via the existing mechanism | A-4 | FR-A40, AC-A33 | **policy direction** |
| 5e | Lifecycle state meanings | Q1 definitions | FR-A41, **§2.8.1** | **policy direction** |
| 5f | Bulk archive, narrowly scoped | Q2-1 | FR-A42, AC-A36, AC-A40, NC-A20 | **policy direction** |
| 5g | No controlled reason code | Q2-4 / A-10 / A-6+A-11 | FR-A43 | **policy direction** |
| 5h | Optional free-text under the named contract | Q2-5 / A-12 | FR-A44, AC-A41 | **policy direction**; the contract itself is **verified current behaviour** |
| 5i | Capability + step-up; denials audited | Q2-3 / A-7, A-8, A-9 | FR-A28, FR-A30, AC-A36–AC-A38 | **policy direction — explicitly NOT current behaviour** (§4) |
| 5j | Repeat archive returns already-resolved | A-13 | FR-A45, AC-A39, NC-A18 | **policy direction — opposite of current behaviour** (§4) |
| 6 | Q3 unresolved | `PI-CONTRACT-002` header; `retention.ts:1-12` | **§5** | **unresolved / blocked** |
| 7 | FR-A36 person-erasure precondition | `personErasure.ts:149, 356, 384`; `index.ts:129`; `20260921000000:184-187` | **§2.7.1** | **verified current behaviour** (the gap); FR-A36 **pending approval** |
| 8 | Contradictory `converted` comment | `opportunityLifecycle.ts:30-31, 43, 45` | **§4.1** | **correction documented, code NOT edited** |

---

## 8. Corrections to other documents — identified, NOT applied

### 8.1 Stale `lead_intelligence` claim in two existing reports

| Document | Line | Stale text | Required correction | Status |
|---|---|---|---|---|
| `OMNIVYRA-PI-OPPORTUNITY-SPINE-DESIGN-001.md` | **32** | *"`company_id text NOT NULL` — no FK, not a uuid"* | Restate per §1.1: `lead_intelligence` is tenant-safe; the no-seventh-store conclusion survives on the model count and the adoption argument | **OPEN — not edited** |
| `PI-C1-IMPLEMENTATION-GATE-001.md` | **300** | *"the `lead_intelligence` outlier (`company_id text`, no FK), which is **not** a model to follow"* | Same | **OPEN — not edited** |

**Both documents remain unmodified.** The correction is recorded here, as instructed, and the stale claim is **not repeated as fact** anywhere in this addendum.

---

## 9. Status and next step

| | |
|---|---|
| Identifier / version | **PI-ADD-001 v0.2-PROPOSED** |
| Ratified | **NO** |
| Approved | **NO** |
| Authorizes implementation | **NO** |
| v0.1 | **unchanged and unedited** (`f244adb9…`, 236 lines) |

**Ratification prerequisites, all OPEN:**

1. **Owner review of this v0.2**, including explicit acceptance of the **FR-A46 / §2.8.2 `detection_ref` limitation**.
2. **Q3 resolved** — FR-A34, FR-A35 and AC-A29 depend on it.
3. A formal owner act of ratification, which is a **separate gate** from the Q1/Q2 decisions already recorded.
4. Correction of the two stale claims (§8.1) and the application-code comment (§4.1), each in its own authorized change.

**Q1 and Q2 decisions remain recorded. Q3 remains blocked. This v0.2 remains proposed and unratified. Implementation authorization remains NONE.** C-1a — three tables, one migration, one rollback — may be considered only after Q3 is resolved, this addendum is formally ratified, and the owner separately authorizes that work package.
