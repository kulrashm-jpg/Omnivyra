# PI-C1-OWNER-DECISIONS-002 — open policy decisions and ratification readiness

**STRICTLY READ-ONLY.** No implementation, no migration created or applied, no database write, no production data or ACL access, no production migration-history query, no provider call, no credential or feature-flag change, no commit, push, merge or deployment, no modification of `C:/virality` or any other worktree, **no existing controlling document modified**, and **no frozen date, budget, estimate or scope changed**. One new file only: this report.

**This report authorizes nothing.** Neither does PI-ADD-001.

---

## 1. Verified baseline

| | Expected | **Actual** | Result |
|---|---|---|---|
| Repository | `C:/tmp/r1-ctx` | `C:/tmp/r1-ctx` | **MATCH** |
| Branch | `fix/r1-profile-context` | `fix/r1-profile-context` | **MATCH** |
| HEAD | `29fea38a…81415774` | `29fea38a2d1642c1c2fd957e5151f6be81415774` | **MATCH** |
| Worktree at start | — | **132 entries (67 M / 65 ??), 0 staged** | unchanged from the decision-closure close; nothing reset, cleaned, stashed, switched or disturbed |

Earlier repository state was **not assumed**; every value above was measured at 2026-10-17T17:17:22+05:30.

## 2. Source hashes and approval status

| Document | SHA-256 | Lines | Verified | Approval status |
|---|---|---|---|---|
| `PI-C1-DECISION-CLOSURE-001.md` | `7e74c05d6d991c94e46806e0960f20e287037db3721193d6904dd56518917aa0` | 285 | **MATCH** | report, not a policy |
| `PI-REQUIREMENTS-ADDENDUM-001-PROPOSED.md` | `f244adb96027f8078ec263c2ae6aa25f5b46c0ce2ba6cc7daab239a0438a5ad0` | 236 | **MATCH** | **PI-ADD-001 v0.1-PROPOSED — not ratified, not approved, not implementation-authorizing** (confirmed in §6.1) |
| `PI-C1-IMPLEMENTATION-GATE-001.md` | `f747c763bd0dbb48e6cd3f3f…` | 446 | MATCH | gate report |
| `OMNIVYRA-PI-OPPORTUNITY-SPINE-DESIGN-002.md` | `34564a452997d1a8efca32c3…` | — | MATCH | design |
| `OMNIVYRA-PI-OPPORTUNITY-SPINE-DESIGN-001.md` | `257185e621fa0b80eb970d4b…` | — | MATCH | design |
| `PI-MILESTONE-A-EXECUTION-001.md` | `1ad1105accdd5866aa8a61df…` | — | MATCH | schedule authority |
| `IMPLEMENTATION-MANIFEST-001.md` | `651575cd73f1c3a7e6e04f0d…` | — | MATCH | **ratified carrier — unchanged, not edited** |
| `PI-CONTRACT-002-data-lifecycle.md` | see §5 | — | read | **"CONTRACT PREPARED — AWAITING POLICY DECISIONS"** — **NOT an approved policy** |

---

## 3. Q1 — terminal states for ordinary deletion

### 3.1 The proposed policy could not be assessed as written, because those states do not exist

The brief asked me to assess `closed`, `superseded`, `disqualified`, `acted` **and any other opportunity states present in the actual model**. Inspecting the actual model produced a result that invalidates the premise of the proposed classification.

**There is already an opportunity lifecycle vocabulary in the schema, and it shares exactly one value with the proposal.**

`opportunity_lifecycle_states.state` — `supabase/migrations/20260520_phase6_realtime_lifecycle_workflow.sql`, CHECK constraint, **9 values**:

> `'detected','triaged','reviewing','qualified','monitoring','outreach_planned','converted','dismissed','archived'`

Compared with the six states proposed in DESIGN-001 §3.3, carried into PI-ADD-001 FR-A6:

| Proposed state | Exists in the actual model? | Closest existing value |
|---|---|---|
| `open` | **NO** | `detected` |
| `qualified` | **YES** | `qualified` |
| `disqualified` | **NO** | `dismissed` |
| `acted` | **NO** | `converted` and/or `outreach_planned` |
| `closed` | **NO** | `archived` |
| `superseded` | **NO** | — (nearest is disposition `duplicate`, §4.2) |

A **second**, independent vocabulary also exists: `opportunity_dispositions.disposition`, same migration, **7 values** — `'qualified','disqualified','low_priority','revisit_later','not_relevant','converted','duplicate'`.

And a **third** at person level: `unified_persons` lifecycle `active | merged | suppressed | archived` (`personDuplicates.ts:45`).

### 3.2 Consequence — the classification is left OPEN, not silently corrected

Per the brief's instruction, the evidence is reported and the classification is **left OPEN**. I have not renamed the proposed states, not mapped them onto the existing vocabulary, and not edited any lifecycle semantics.

Three distinct things the owner must now choose between, and only the owner can:

| Option | Consequence |
|---|---|
| **(1) Reuse the existing 9-state vocabulary** for the canonical opportunity | One language across detection and canonical records — consistent with the already-approved principle that `opportunity_type` reuses the Community vocabulary. But those 9 states are **Community-lifecycle** states keyed to `opportunity_feed_item_id`, and some (`triaged`, `reviewing`, `monitoring`) describe operator workflow rather than canonical fact |
| **(2) Define a distinct PI vocabulary** | Cleaner separation of canonical fact from operator workflow, but creates a **second opportunity lifecycle vocabulary**, which is the divergence D-A.1 exists to prevent |
| **(3) Map PI status onto the existing vocabulary** with a documented translation | Avoids a new vocabulary and keeps canonical semantics, at the cost of a mapping that must be maintained and can drift |

**This is an inconsistency in my own prior design, and I am flagging it rather than repairing it quietly:** DESIGN-001 §3.3 explicitly reused the existing Community vocabulary for `opportunity_type` *"so the two models speak one language"*, and then proposed a brand-new six-value vocabulary for `status` without applying the same principle. The two decisions are not reconcilable on the stated rationale.

### 3.3 On `acted` specifically

The proposal that `acted` is not automatically terminal **stands on its own merits and is supported by evidence**, independently of the naming question:

- `opportunity_lifecycle_states` records `previous_state`, `reasoning`, `actor_user_id` and `transitioned_at` — i.e. transitions are an **append-only audit trail**, which implies a record whose action has occurred still carries audit obligations.
- The existing vocabulary distinguishes `outreach_planned` from `converted`, so "an action occurred" and "the outcome is settled" are already modelled as **different** states.
- `outreach_outcomes` is a separate live store with two write paths, so an action can be taken and its outcome arrive later. An opportunity whose action has happened may therefore still have an **unresolved outcome**.

**Conclusion on `acted`:** the evidence supports treating it as **non-terminal**, because an acted opportunity can still have outstanding outcome and audit obligations. Recorded as a recommendation, **not approved**.

### 3.4 Unknown states

Agreed and encoded as a requirement-level rule: an unrecognised or non-terminal state must **never** be treated as terminal. The safe default is "non-terminal unless explicitly listed", which fails closed — deletion is refused rather than permitted.

### 3.5 The exact question for owner approval

> **Q1-A.** Which lifecycle vocabulary governs the canonical PI opportunity: **(1)** reuse the existing 9-state `opportunity_lifecycle_states` vocabulary, **(2)** define a distinct PI vocabulary, or **(3)** define a PI vocabulary with a documented mapping to the existing one?
>
> **Q1-B.** Given that choice, which states are **terminal for ordinary account deletion**?
>
> **Q1-C.** Confirm that `acted` (or its chosen equivalent) is **non-terminal** while outcome or audit obligations remain.
>
> **Q1-D.** Confirm that any unrecognised state is treated as **non-terminal** (fail closed).

### 3.6 Implementation acceptance criterion that follows approval

| ID | Criterion |
|---|---|
| **Q1-AC1** | The terminal-state set is a single, named constant with exactly one definition in the codebase; a second spelling is a test failure |
| **Q1-AC2** | Ordinary account deletion is **refused** while any referencing opportunity is in a non-terminal state (per Q1-B), atomically, nothing partially deleted |
| **Q1-AC3** | Ordinary account deletion **succeeds** once every referencing opportunity is terminal |
| **Q1-AC4** | An opportunity in an **unrecognised** state is treated as non-terminal and **blocks** deletion — proven by inserting an out-of-vocabulary value where the schema permits it, or by a unit test of the predicate where it does not |
| **Q1-AC5** | A negative control relaxes the refusal and proves Q1-AC2 fails, then restores |

---

## 4. Q2 — bulk resolution and reason codes

### 4.1 Assessment of the proposal

The proposal under evaluation — **authorized and audited bulk resolution with per-opportunity validation and explicit per-item outcomes** — is **sound and consistent with established repository behaviour**, and is recorded as a recommendation, not an approved decision.

| Element | Assessment | Evidence / precedent |
|---|---|---|
| Bulk resolution permitted | **Recommend YES.** Without it, an account with many opportunities cannot realistically be cleared, and operators route around controls they cannot use | — |
| **Per-opportunity validation** | **Recommend REQUIRED.** Each item independently authorized and validated; a batch must never widen authority | WP-6 verified the orchestrator's rule: *one bad record fails that record and no other* |
| Explicit per-item outcomes | **Recommend REQUIRED.** The batch resolves rather than throwing, and each item reports `ok` plus a reason | same precedent |
| Capability + step-up | **Recommend REQUIRED** for every item, not once per batch | `requireCapability` (`backend/security/requireCapability.ts:81`); `StepUpRequirement` / `evaluateStepUp`, `STEP_UP_REQUIRED` → 401 (`AuthorizationService.ts:248-277`) |
| Partial success | Permitted and reported per item; the batch is **not** all-or-nothing, but **each item's own write is atomic** | the canonical-write precedent |
| Failure and retries | Idempotent by construction: re-resolving an already-terminal opportunity is a no-op, so retry is safe without a retry counter | `withIdempotency` (`backend/middleware/withIdempotency.ts:219-226`) for the route |
| Audit | One audit event **per item**, including denials, to the existing sink | `logSecurityEvent` → `capability_audit_log` (`requireCapability.ts:144`) |
| Tenant isolation | Every item re-validated against the caller's tenant; a cross-tenant item is refused, not skipped silently | composite tenant-safe FKs, proven unconstructible (`23503`) |
| Non-leaking refusals | Refusals name the condition and counts, never a `need_statement` or attribute value | WP-2 rule, carried as AC-A26 |

### 4.2 The reason-code vocabulary — NOT invented, and the repository precedent points the other way

**I have not proposed a vocabulary.** What the repository actually does is relevant, because imposing a controlled vocabulary would be a **new** convention rather than an existing one:

| Existing reason field | Shape | Evidence |
|---|---|---|
| `opportunity_dispositions.reason` | **free text, nullable**, beside a controlled `disposition` enum of 7 values | `20260520_phase6_realtime_lifecycle_workflow.sql` |
| `prospect_list_members.removal_reason` | **free text, nullable**, and deliberately so — the migration states the optionality was *"decided rather than left vague"* | `20261127000000_pi_prospect_lists.sql:178, 200` |
| `opportunity_lifecycle_states.reasoning` | **free text, nullable** | same Phase-6 migration |

So the established pattern is a **controlled state/disposition enum plus a free-text reason**. A controlled reason-code vocabulary exists nowhere in this domain.

There is, however, a **candidate already in the schema**: `opportunity_dispositions.disposition` (`qualified`, `disqualified`, `low_priority`, `revisit_later`, `not_relevant`, `converted`, `duplicate`). Whether a resolution reason should draw on that enum, a new vocabulary, or remain free text is **the open decision**.

### 4.3 The exact question for owner approval

> **Q2-A.** Is authorized, audited **bulk resolution** permitted, with **per-opportunity** validation, authorization and explicit per-item outcomes?
>
> **Q2-B.** Must every resolution carry a reason **from a controlled vocabulary**, or does the existing pattern — controlled disposition enum plus free-text reason — apply?
>
> **Q2-C.** If controlled: is the vocabulary the existing 7-value `opportunity_dispositions.disposition` enum, or a new one to be specified separately?

### 4.4 Acceptance tests that follow approval

| ID | Test |
|---|---|
| **Q2-AC1** | A bulk resolution of N opportunities performs N independent authorization checks; one denial does not deny the rest and does not permit it either |
| **Q2-AC2** | Each item returns an explicit outcome; the batch resolves rather than throwing |
| **Q2-AC3** | An item belonging to another tenant is **refused**, with no partial write, and the refusal is audited |
| **Q2-AC4** | An item resolved twice is a **no-op** the second time (idempotent retry) |
| **Q2-AC5** | Every item, allowed or denied, produces exactly one audit event |
| **Q2-AC6** | A resolution without a required reason is refused — **specifiable only after Q2-B** |
| **Q2-AC7** | Refusal text contains no need statement or attribute value |
| **Q2-AC8** | A negative control grants blanket authority and proves Q2-AC1 fails, then restores |

---

## 5. Q3 — authoritative legal-erasure policy

### 5.1 Search performed

Searched `docs/pmo/prospect-intelligence/` for contract, lifecycle, retention, erasure and ADR documents; searched the repository for retention targets and erasure code paths; inspected `backend/types/retention.ts` and the person-erasure service.

### 5.2 What was found — and its approval status

**`docs/pmo/prospect-intelligence/PI-CONTRACT-002-data-lifecycle.md`** is directly on point in scope. Its own header states its status, quoted minimally:

> **Status:** CONTRACT PREPARED — **AWAITING POLICY DECISIONS.** Nothing is implemented.
> **Base SHA:** `a07477e4` · **Prepared:** 2026-09-23
> **Scope:** retention · erasure · suppression interaction · provenance · staleness · tenant isolation · auditability · provider-originated data · re-enrichment after deletion · contactability.

and, in the same opening section:

> **It invents no legal or compliance policy.**

**What this establishes:** that the obligations and decision points for PI data lifecycle have been identified and documented, with scope covering erasure and retention; and that the author deliberately declined to supply policy.

**What it does NOT establish:** any approved retention period, any approved erasure procedure, any authorized initiator or approver, any legal basis, or any decision about what survives erasure. It is a **prepared contract awaiting decisions**, which is explicitly not proof of policy approval.

### 5.3 Verdict on Q3

### **POLICY NOT LOCATED / APPROVAL UNVERIFIED → Q3 remains BLOCKED**

No approved, versioned legal-erasure or data-retention policy applicable to PI data could be verified in this repository. **Absence from the repository does not prove no policy exists elsewhere** — it may exist in a legal, compliance or governance system outside this codebase, and this report makes no claim either way.

### 5.4 Supporting evidence, verified at current HEAD

The contract is dated 2026-09-23 at base `a07477e4`, so its claims were re-verified rather than trusted. Two are stale and two still hold.

| Contract claim | Verified status at HEAD `29fea38a` | Evidence |
|---|---|---|
| "Retention policy covering any PI table — **ABSENT**" | **STILL TRUE** | `backend/types/retention.ts:1-12` — `RETENTION_TARGETS` is a closed 10-member list: `raw_ingested_content`, `moderation_decisions`, `opportunity_feed_items`, `lifecycle_history`, `observability_traces`, `alerts`, `projection_sync_state`, `graph_edges`, `listening_executions`, `listening_signal_dedup`. **No PI identity table appears** |
| "Right-to-erasure path — **ABSENT**" | **NOW STALE — a path exists** | `backend/services/prospectIdentity/personErasure.ts:149` `erasePerson(...)`, with `deletePersonRow` at `:384` and a fail-closed guard at `:356`. Built after the contract's base commit |
| "No person-deletion path at all" | **NOW STALE** | same |
| `dsar` is suppression, not erasure | **STILL TRUE** | the contract's own note; `dsar` maps to `dnc_permanent`/`dnc_channel` |
| `lead_intelligence_person_tenant_fk` is a hard block | **STILL TRUE** | `20260921000000_w2_lead_intelligence_uuid_reconciliation.sql:184-187` — `FOREIGN KEY (unified_person_id, company_id) REFERENCES public.unified_persons(id, company_id) ON DELETE RESTRICT` |

**Two further findings from this verification, both material:**

1. **`erasePerson` exists but is unreachable.** It is exported from `backend/services/prospectIdentity/index.ts:129` and has **no API route caller** anywhere. So the capability exists and the entry point does not. An erasure obligation cannot currently be discharged through any interface.
2. **A hard `ON DELETE RESTRICT` already blocks person deletion.** `lead_intelligence` holds one. So the hazard the gate identified for the *proposed* account FK is not hypothetical — the same pattern is already present on the person path, which strengthens the case for settling the resolution path before adding another RESTRICT.

### 5.5 Policy-decision request — the missing decisions

Nothing below is answered, assumed or defaulted. **No retention period is proposed, no legal basis is asserted, and no claim is made that audit metadata may be retained.**

| # | Missing decision |
|---|---|
| **Q3-1** | **Authorized initiator and approver** — who may invoke legal erasure, and who approves it. Whether this is a designated high-risk action requiring a second approver (links to Q4) |
| **Q3-2** | **Evidence required** to establish a valid erasure request, and where that evidence is recorded |
| **Q3-3** | **Scope and subject references** — which subject identifiers the request covers, and whether it extends from a person to that person's inferred roles, their opportunities, and account-level records that no longer name them |
| **Q3-4** | **Handling of each artefact class**, decided individually, not as a cascade: opportunity content including `need_statement`; referenced signals; buying-role inferences; provenance records; evaluation records; audit records |
| **Q3-5** | **What may or must survive** erasure — **strictly as approved policy determines.** This report asserts nothing, including about audit metadata |
| **Q3-6** | **Authorization, audit and tenant-isolation requirements** for the erasure path itself |
| **Q3-7** | **Refusal and escalation** behaviour when a request cannot be safely resolved — for example when a RESTRICT blocks it, as `lead_intelligence` already can |
| **Q3-8** | **Retention periods** — not proposed here and not to be inferred from any technical default |

### 5.6 Consequence

**Q3 is BLOCKED.** No erasure workflow, migration, foreign key, trigger or deletion service was designed or implemented in this task, and none should be until the policy is verified. The deletion-and-erasure requirements of PI-ADD-001 (FR-A32…FR-A37, AC-A23…AC-A25, AC-A29) are therefore **not ratifiable yet**.

---

## 6. PI-ADD-001 ratification-readiness matrix

### 6.1 Identity confirmed unchanged

Identifier **PI-ADD-001**, version **v0.1-PROPOSED**, and the status rows in its header, every status field and §7 all state **not ratified, not approved, not implementation-authorizing**. Hash `f244adb96027f807…` matches §2. **Not edited by this task.**

### 6.2 Requirement-level review

| ID range | Traceability to approved directions | Proposed test evidence | Status |
|---|---|---|---|
| **BR-A1, BR-A2** | the canonical-spine direction | AC-A4, AC-A10 | **READY** |
| **BR-A3** | D-I | AC-A7–AC-A9, NC-A4 | **READY** |
| **BR-A4** | the consent direction | AC-A14, AC-A15, NC-A8 | **READY** |
| **BR-A5** | **D-A** | AC-A27, AC-A28, NC-A5 | **READY** |
| **BR-A6** | the no-new-repository constraint | — | **CHANGE REQUIRED — see §6.3 item 1** |
| **FR-A1** | tenant convention | AC-A16, AC-A17 | **READY** |
| **FR-A2, FR-A3** | **D-B** | AC-A1–AC-A3, NC-A1, NC-A4 | **READY** |
| **FR-A4** | reuse of the Community type vocabulary | AC-A4 | **READY** |
| **FR-A5** | inference-vs-declaration | AC-A4 | **READY** |
| **FR-A6** | lifecycle as state not score | AC-A11 | **CHANGE REQUIRED — see §6.3 item 2 (Q1)** |
| **FR-A7** | dedup | AC-A5, AC-A20, NC-A2 | **READY** |
| **FR-A8–FR-A10** | **D-A.1** reference-not-duplicate | AC-A6, AC-A4 | **READY**, with §6.3 item 4 noted |
| **FR-A11–FR-A13** | freshness and contradiction | AC-A12, AC-A13 | **READY** |
| **FR-A14–FR-A18** | **D-I** | AC-A7–AC-A9, NC-A9 | **READY** |
| **FR-A19–FR-A22** | one-authority invariant | AC-A10, AC-A11, AC-A22 | **READY** |
| **FR-A23–FR-A26** | **D-A.1** | AC-A27, AC-A28, NC-A5 | **READY** |
| **FR-A27–FR-A31** | tenant, authz, audit | AC-A16–AC-A19, AC-A26, NC-A7, NC-A10 | **READY** |
| **FR-A32, FR-A33** | **D-H** ordinary deletion | AC-A23, AC-A24, NC-A3 | **BLOCKED on Q1 and Q2** |
| **FR-A34, FR-A35** | **D-H** legal erasure | AC-A29 | **BLOCKED on Q3** |
| **FR-A36** | person erasure | AC-A25 | **CHANGE REQUIRED — see §6.3 item 3** |
| **FR-A37** | no silent cascade, invariant preserved | NC-A1, NC-A3 | **READY** |

### 6.3 Exact changes required before ratification

**Item 1 — BR-A6's supporting evidence is factually wrong, and the error is mine.**

BR-A6 justifies the no-new-repository constraint by citing `lead_intelligence` as a tenant-unsafe outlier with *"`company_id text`, no FK"*. **That is incorrect at current HEAD.** Migration `20260921000000_w2_lead_intelligence_uuid_reconciliation.sql` converted `lead_intelligence.company_id` from **text → uuid with an FK to `companies(id)`**, and `unified_person_id` from text → uuid with a **composite FK** to `unified_persons(id, company_id)` `ON DELETE RESTRICT` (lines 7-9, 184-187). The table is **tenant-safe**.

My earlier reading was taken from the original `CREATE TABLE` in `20260629000000` and missed the later reconciliation. The same incorrect claim appears in `OMNIVYRA-PI-OPPORTUNITY-SPINE-DESIGN-001.md` §1 and is repeated in `PI-C1-IMPLEMENTATION-GATE-001.md` §8 — **neither is edited by this task**, and both should be corrected when next revised.

**The conclusion still stands on the remaining evidence** — there are six lead/opportunity-shaped models and a seventh should not be added — but BR-A6's rationale must be restated without the false claim.

**Item 2 — FR-A6's state vocabulary conflicts with the actual model (Q1).** Six proposed states, five of which do not exist; an existing 9-value vocabulary and a 7-value disposition vocabulary do. FR-A6 cannot be ratified until Q1-A is answered. See §3.

**Item 3 — FR-A36 / AC-A25 presume a reachable person-erasure path.** `erasePerson` exists but has **no route caller**, and a hard `ON DELETE RESTRICT` on `lead_intelligence` can block person deletion outright. AC-A25 as written ("person erasure leaves the opportunity account-anchored") is only testable where erasure can actually run. It should either state its precondition explicitly or be deferred to the erasure work package.

**Item 4 — `detection_ref` can dangle, and this was not stated.** `opportunity_feed_items` **is** a member of `RETENTION_TARGETS` (`backend/types/retention.ts:4`) with archival modes `soft_delete` / `hard_delete`. So a retention run can remove the detection record that `detection_ref` points to. The design deliberately made `detection_ref` a plain uuid rather than a foreign key, which avoids a hard failure — but the addendum should say that the reference **may become unresolvable** and that `detected_reason` is retained precisely so the reason survives. `lead_signals` is **not** in `RETENTION_TARGETS`, so the signal evidence itself is not retention-pruned today — an absence of policy, not a guarantee.

### 6.4 No revision file created, and why

A `v0.2-PROPOSED` was **not** produced. Items 2 and 3 cannot be settled without the answers to **Q1** and **Q3**, which will change the same sections; issuing v0.2 now would produce a document already requiring v0.3. The existing proposal is **not overwritten, not edited and not marked ratified**. Once Q1 and Q3 are answered, a single consolidated **v0.2-PROPOSED** can be prepared as a separate new file carrying all four corrections.

### 6.5 Scope boundaries held

`IMPLEMENTATION-MANIFEST-001.md` unchanged. **OD-3, OD-4, OD-5, D-C, D-E and company-event sources are not approved and not inferred.** Need-to-offering matching remains traceable to ratified **FR-16 / FR-17**, excluded from C-1 scope and unauthorized.

---

## 7. Schedule forecast

### 7.1 Frozen baselines — verified against the ledger

| Item | Brief states | **Ledger `1ad1105accdd5866…`** | Result |
|---|---|---|---|
| Milestone A′ | 2026-11-25, 28.5 human engineer-days | §3.1 **Wed 2026-11-25**; §3 **28.5 engineer-days** | **MATCH** |
| WP-7 | 2026-11-17, 4.0 engineer-days | §3 row WP-7 **Tue 2026-11-17 / 4.0** | **MATCH** |
| C-1 estimate | 8–12 engineer-days | gate §9.3 **8–12 d** | **MATCH** |

**Baseline source:** `PI-MILESTONE-A-EXECUTION-001.md` §3, frozen 2026-10-17T06:05:34+05:30. **No discrepancy; nothing changed.** C-1 remains sequenced before WP-7, subject to readiness and separate authorization.

### 7.2 Completed and remaining

| | |
|---|---|
| Completed (baselined) | WP-1 0.5 + WP-2 5.0 + WP-3 4.0 + WP-6 3.0 = **12.5 d**; actuals 2026-10-17T07:00:12, T12:53:51, T14:16:40 |
| Remaining (baselined) | WP-4 2.0 + WP-5 3.5 + WP-7 4.0 + WP-12 5.0 + WP-13 1.5 = **16.0 d** |
| New scope not in the baseline | **C-1: 8–12 d** |
| **Total remaining** | **24.0 – 28.0 engineer-days** |

### 7.3 This task's clock

| | |
|---|---|
| **Actual start** | **2026-10-17T17:17:22+05:30 (IST)** |
| External waiting time before start | **5 min 37 s** (closure close 17:11:45 → 17:17:22) — not engineering effort |
| Original estimate | **0.5 engineer-days** |
| Estimate consumed | **~7 minutes** active engineering |
| 75% threshold (0.375 d) | **not approached** |
| Remaining | 0 — complete at this report |
| Monitoring | **no continuous monitoring is claimed between reports;** every timestamp is a measured `date -Iseconds` |

### 7.4 Critical path and float

Path: **C-1 → WP-7 → WP-12 → WP-13**, with WP-4 and WP-5 re-entering when OD-3/OD-4/OD-5 are answered. Capacity remains **one sequential owner**, so nothing overlaps and no package holds independent float.

Calendar, Mon–Fri, from the next working day **Mon 2026-10-19**:

| Target | Working days available | Work required | Float |
|---|---|---|---|
| **WP-7 — Tue 2026-11-17** | **22** | C-1 (8–12) + WP-7 (4.0) = **12–16 d** | **+6 to +10 d — FEASIBLE** |
| **Milestone A′ — Wed 2026-11-25** | **28** | **24.0 – 28.0 d** | **+4 d at the low C-1 estimate; ZERO at the high estimate** |

Assumptions: one sequential owner; five-day working week; C-1 starts the first working day after its gates clear; no package overlaps; estimates are human engineer-days and **agent wall-clock is not substituted**.

### 7.5 **OVERRUN RISK — REMAINS RAISED, AND CONFIDENCE HAS INCREASED**

First raised 2026-10-17T16:33+05:30 (gate §9.5); restated in the closure report; **this report raises its confidence from MEDIUM to MEDIUM-HIGH, identified 2026-10-17T17:2x+05:30**.

**What changed:** at closure, the three gating questions looked like same-day operational answers. Q3 is now established as **BLOCKED on a policy that does not exist in this repository** (§5.3) and that requires a legal/compliance decision covering eight sub-questions. That is a materially slower dependency than an operational answer, and it sits directly on the critical path because C-1a's schema includes the deletion gate.

| Field | Content |
|---|---|
| Baseline at risk | **Milestone A′ — Wed 2026-11-25**, 28.5 engineer-days |
| Baseline not at risk | **WP-7 — Tue 2026-11-17**, +6 to +10 days float |
| Forecast completion range | **2026-11-19 (low C-1) to 2026-11-25 (high C-1)**, *assuming C-1 starts Mon 2026-10-19* |
| **Quantified gap** | Zero float at C-1 = 12 d. **If C-1 exceeds 12.0 d, the breach equals the excess** (13 d → 1 day; 14 d → 2 days; 16 d → 4 days). Separately, **each working day of decision delay consumes one day of float**, so at the high estimate a **single day's delay breaches the date** |
| **Dominant driver** | **Q3 decision latency**, now a legal/compliance dependency rather than an operational one |
| Latest feasible C-1 start | **Mon 2026-10-19** at the 12-day estimate · **Fri 2026-10-23** at the 8-day estimate |
| Latest date for OD-3/OD-4/OD-5 | **Mon 2026-11-09** — WP-4+WP-5 (5.5 d) plus WP-12+WP-13 (6.5 d) = 12.0 d requires the final 12 working days |
| Confidence | **MEDIUM-HIGH** — the arithmetic is certain; the C-1 range and the legal-decision latency are not |
| Recovery options — **none applied** | **(a)** accept a revised Milestone A′ baseline · **(b)** keep the date, defer WP-4/WP-5 beyond Milestone A′ · **(c)** keep the date, defer C-1 after WP-7 · **(d)** answer Q1/Q2 now and **split C-1a** so the deletion gate lands only after Q3 — the only option that lets engineering start while a legal decision is pending. **(d) is a scope-sequencing change and requires explicit owner approval; it has not been applied** |
| Owner approval | **REQUIRED** for any baseline or sequencing change |
| **Next review checkpoint** | the earlier of **(i)** receipt of Q1-A…Q1-D, Q2-A…Q2-C and a verified Q3 policy, or **(ii)** **Fri 2026-10-23** — the last date on which C-1 can start and retain any Milestone A′ float |

### 7.6 Agent throughput — reported, not substituted

WP-2 **54 min 38 s** against 5.0 d; WP-3 **52 min 41 s** against 4.0 d; WP-6 **42 min 29 s** against 3.0 d. **Not used to clear the alert and not substituted for the human engineer-day baseline**, which is frozen. Offered solely as evidence the owner may weigh under recovery option (a).

---

## 8. Prerequisite matrix

| # | Prerequisite | Status | Evidence / action |
|---|---|---|---|
| G-1 | Repository, branch, HEAD, worktree baseline | **PASS** | §1, measured |
| G-2 | Source hashes and line counts verified | **PASS** | §2 — both expected hashes matched |
| G-3 | Controlling documents unmodified | **PASS** | §2; manifest unchanged |
| G-4 | PI-ADD-001 identity and non-ratified status | **PASS** | §6.1 |
| G-5 | Frozen baselines match the ledger | **PASS** | §7.1 |
| G-6 | **Q1 — lifecycle vocabulary and terminal states** | **OPEN** | §3.5 — four sub-questions; classification left OPEN on evidence |
| G-7 | Q1 — `acted` non-terminal | **OPEN (recommended)** | §3.3 |
| G-8 | Q1 — unknown states fail closed | **OPEN (recommended)** | §3.4 |
| G-9 | **Q2 — bulk resolution model** | **OPEN (recommended, evidence-backed)** | §4.3 |
| G-10 | **Q2 — reason-code vocabulary** | **OPEN** | §4.2 — not invented; precedent is enum + free text |
| G-11 | **Q3 — approved legal-erasure / retention policy** | **BLOCKED — POLICY NOT LOCATED / APPROVAL UNVERIFIED** | §5.3; eight missing decisions in §5.5 |
| G-12 | Q4 — high-risk action catalogue | **OPEN** | blocks the second-approver package, not C-1 |
| G-13 | PI-ADD-001 ratification | **OPEN — 4 changes required** | §6.3 |
| G-14 | BR-A6 evidence correction | **OPEN — my error, reported not silently fixed** | §6.3 item 1 |
| G-15 | Person-erasure path reachable from an interface | **OPEN** | §5.4 — `erasePerson` exists, no route caller |
| G-16 | PI tables covered by a retention target | **BLOCKED** | §5.4 — no PI table in `RETENTION_TARGETS` |
| G-17 | `detection_ref` dangling-reference statement | **OPEN** | §6.3 item 4 — `opportunity_feed_items` is retention-managed |
| G-18 | OD-3 / OD-4 / OD-5 | **BLOCKED** | unchanged; block WP-4/WP-5 |
| G-19 | D-C | **OPEN** | blocks the bridge package |
| G-20 | D-E | **OPEN** | blocks matching; traces to FR-16/FR-17 |
| G-21 | Company-event sources | **NOT APPLICABLE to C-1** | none authorized; code is not authorization |
| G-22 | Production migration state of PI migrations | **UNVERIFIED** | prohibited here; operator read required |
| G-23 | Production tenant isolation | **UNVERIFIED** | local only; service role holds a row-level-security bypass |
| G-24 | Technical primitives for C-1 | **PASS** | gate §5, 26 of 34 prerequisites PASS |

---

## 9. Verdict and smallest next action

### **NOT READY — Q3 is BLOCKED on a policy that could not be verified, and PI-ADD-001 requires four corrections before ratification**

No technical prerequisite fails. What blocks C-1a is: one **blocked** policy gate (Q3), two **open** decision sets (Q1, Q2), and four **addendum corrections** — one of which is a factual error of mine that I have reported rather than quietly repaired.

### 9.1 Compact owner-decision table — answerable without ambiguity

| # | Decision | Options | Status |
|---|---|---|---|
| **Q1-A** | Canonical opportunity lifecycle vocabulary | (1) reuse the existing 9-state vocabulary · (2) a distinct PI vocabulary · (3) a PI vocabulary with a documented mapping | **OPEN** |
| **Q1-B** | Terminal states for ordinary deletion | list, given Q1-A | **OPEN** |
| **Q1-C** | Is `acted` (or equivalent) non-terminal while outcome/audit obligations remain? | YES / NO | **OPEN — YES recommended** |
| **Q1-D** | Unrecognised state treated as non-terminal (fail closed)? | YES / NO | **OPEN — YES recommended** |
| **Q2-A** | Authorized, audited bulk resolution with per-opportunity validation and per-item outcomes? | YES / NO | **OPEN — YES recommended** |
| **Q2-B** | Reason from a controlled vocabulary, or enum + free text per existing precedent? | CONTROLLED / ENUM+FREE-TEXT | **OPEN** |
| **Q2-C** | If controlled: existing 7-value disposition enum, or a new vocabulary? | EXISTING / NEW | **OPEN** |
| **Q3** | Supply or point to the **approved** legal-erasure and retention policy (eight sub-decisions, §5.5) | — | **BLOCKED** |
| **Q4** | Designated high-risk action catalogue | — | **OPEN — blocks a later package, not C-1** |
| **R-1** | Authorize a consolidated **PI-ADD-001 v0.2-PROPOSED** carrying the four §6.3 corrections, after Q1 and Q3 | YES / NO | **OPEN** |
| **S-1** | Respond to §7.5: select a recovery option, or accept the zero-float position | (a)/(b)/(c)/(d)/accept | **OPEN** |

No option above is marked approved merely because it is recommended.

### 9.2 Smallest next action

1. **Answer Q1-A…Q1-D and Q2-A…Q2-C.** These need no legal input and unblock the schema's non-deletion portions.
2. **Supply or point to the approved legal-erasure/retention policy**, or confirm that none exists and a decision must be made — Q3 stays BLOCKED until then.
3. **Respond to S-1**, noting that recovery option **(d)** — splitting C-1a so the deletion gate lands after Q3 — is the only route that lets engineering begin while a legal decision is pending, and that it requires explicit approval.
4. Separately, **answer OD-3/OD-4/OD-5 by Mon 2026-11-09** to protect the end of the plan.

**No implementation is authorized by this report, by PI-ADD-001, or by any decision recorded here.** C-1a — three tables, one migration, one rollback — may be considered only after the applicable policy gates are resolved, PI-ADD-001 is formally ratified, and the owner separately authorizes that work package.
