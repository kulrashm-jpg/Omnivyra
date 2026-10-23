# PI-Q1-Q2-AUDIT-001 — lifecycle and resolution governance audit

**STRICTLY READ-ONLY.** No implementation, no policy approval, no migration, no database write, no production access, no provider call, no commit, push, merge or deployment, no modification of `C:/virality`, **no existing report, addendum, manifest, code, test, schema or migration edited**. One new file: this audit.

**Q3 (legal-erasure policy) is OUT OF SCOPE and is not addressed, resolved or inferred here.**

**This audit is evidence for decisions. It is not implementation authorization and marks nothing approved.**

---

## 1. Verified repository state and source artifacts

Measured at **2026-10-17T17:38:54+05:30 (IST)**. The previous baseline was **not assumed**.

| | Expected | **Actual** | Result |
|---|---|---|---|
| Repository | `C:/tmp/r1-ctx` | `C:/tmp/r1-ctx` | **MATCH** |
| Branch | `fix/r1-profile-context` | `fix/r1-profile-context` | **MATCH** |
| HEAD | `29fea38a…81415774` | `29fea38a2d1642c1c2fd957e5151f6be81415774` | **MATCH** |
| Worktree | — | **133 entries (67 M / 66 ??), 0 staged** | unchanged from the prior close |

| Source document | Expected SHA-256 (24) | Actual | Result |
|---|---|---|---|
| `PI-C1-OWNER-DECISIONS-002.md` | `7296df67fd054717a66c3c1c` | `7296df67fd054717a66c3c1c` | **MATCH** |
| `PI-C1-DECISION-CLOSURE-001.md` | `7e74c05d6d991c94e46806e0` | `7e74c05d6d991c94e46806e0` | **MATCH** |
| `PI-REQUIREMENTS-ADDENDUM-001-PROPOSED.md` | `f244adb96027f8078ec263c2` | `f244adb96027f8078ec263c2` | **MATCH** |

Also inspected: `backend/types/opportunityLifecycle.ts`, `backend/services/opportunityLifecycleService.ts`, `pages/api/active-leads/lifecycle.ts`, `supabase/migrations/20260520_phase6_realtime_lifecycle_workflow.sql`, `supabase/migrations/20261127000000_pi_prospect_lists.sql`, `supabase/migrations/20260921000000_w2_lead_intelligence_uuid_reconciliation.sql`, `backend/types/retention.ts`, `backend/security/requireCapability.ts`, `backend/security/AuthorizationService.ts`, `backend/middleware/withIdempotency.ts`, the engagement bulk routes, and `PI-MILESTONE-A-EXECUTION-001.md`.

---

## 2. Q1 — the actual lifecycle model

### 2.1 The nine states are confirmed, in two independent places

| Source | Evidence |
|---|---|
| Schema | `20260520_phase6_realtime_lifecycle_workflow.sql` — `CHECK (state IN ('detected','triaged','reviewing','qualified','monitoring','outreach_planned','converted','dismissed','archived'))`, plus a matching CHECK on `previous_state` |
| Code | `backend/types/opportunityLifecycle.ts:1-11` — `LIFECYCLE_STATES` as a 9-member `as const` tuple, with `LifecycleState` derived from it |

**The two agree exactly.** `isLifecycleState()` (`:46-49`) is the runtime guard.

### 2.2 The transition allowlist is explicit AND enforced at write time

`ALLOWED_LIFECYCLE_TRANSITIONS` (`backend/types/opportunityLifecycle.ts:36-46`) and `canTransitionLifecycle()` (`:57-67`), enforced by `transitionLifecycle()` (`opportunityLifecycleService.ts:125-156`): it resolves the current state, calls the allowlist, throws `LifecycleTransitionError` on refusal, and only then inserts a new history row.

**Verified outgoing transitions, verbatim:**

| State | Allowed outgoing |
|---|---|
| `detected` | `triaged`, `dismissed`, `archived` |
| `triaged` | `reviewing`, `qualified`, `dismissed`, `archived` |
| `reviewing` | `triaged`, `qualified`, `dismissed`, `archived` |
| `qualified` | `monitoring`, `outreach_planned`, `reviewing`, `dismissed`, `archived` |
| `monitoring` | `qualified`, `outreach_planned`, `converted`, `dismissed`, `archived` |
| `outreach_planned` | `monitoring`, `converted`, `dismissed`, `archived` |
| `converted` | **`archived` only** |
| `dismissed` | **`triaged`, `archived`** |
| `archived` | **`[]` — none** |

### 2.3 Three findings that decide Q1

**Finding 1 — `archived` is the ONLY absorbing state.** Its allowed list is empty. No other state is absorbing.

**Finding 2 — `dismissed` is explicitly REVERSIBLE, by design.** It permits `dismissed → triaged`, and the module's own comment states the intent:

> *"`dismissed` can be reopened to `triaged` to handle accidental dismissal."*

**This contradicts the proposed policy under assessment.** The brief proposed that `closed`, `superseded` and `disqualified` "may qualify as terminal". The real model has no `closed`, `superseded` or `disqualified`; the nearest analogue of `disqualified` is `dismissed`, and **`dismissed` is deliberately reopenable**. Treating it as terminal would permit deleting an account whose opportunities an operator could legitimately have recovered.

**Finding 3 — there is NO terminal-state concept in the codebase.** `grep -ni 'terminal'` across `opportunityLifecycle.ts` and `opportunityLifecycleService.ts` matches **only a doc comment**, never a constant, type or check. And that comment is **internally inconsistent**: it says *"`converted` and `archived` are terminal"* while the allowlist gives `converted` an outgoing edge to `archived`. No code anywhere computes terminality.

**Finding 4 — `acted` does not exist**, in the schema or in code. It is a proposed label only, as the brief anticipated.

### 2.4 A designed property that supplies the resolution path for free

**`archived` is reachable in exactly one legal transition from every other state.** Verified by inspecting all nine rows above: every state's allowed list contains `archived`.

Consequence: "resolve a blocking opportunity" is **always a single, already-enforced, already-audited transition** — `transitionLifecycle(..., to: 'archived')`. No new resolution mechanism, state or vocabulary is required. This is the most useful engineering finding in the audit and it materially shrinks Q2.

### 2.5 Per-state matrix

Definitions are drawn from the transition structure and the module comment; where the code does not define a state's meaning, that is recorded as ambiguity rather than filled in.

| State | Definition / entry condition | Incoming | Outgoing | Can obligations remain? | Terminality candidate? | Evidence / ambiguity |
|---|---|---|---|---|---|---|
| `detected` | Initial state, set when a signal becomes a feed item. `listeningSignalPipeline.ts:305` — *"initialise lifecycle to 'detected' (idempotent)"*; `opportunityLifecycleService.ts:59` seeds it; `:132` defaults to it when no history exists | initial | triaged, dismissed, archived | **YES** — untriaged | **NO** | clear |
| `triaged` | Operator has sorted it | detected, reviewing, dismissed | reviewing, qualified, dismissed, archived | **YES** | **NO** | meaning not defined in code |
| `reviewing` | Under active review | triaged, qualified | triaged, qualified, dismissed, archived | **YES** | **NO** | meaning not defined in code |
| `qualified` | Judged a real opportunity | triaged, reviewing, monitoring | monitoring, outreach_planned, reviewing, dismissed, archived | **YES** | **NO** | can revert to `reviewing` |
| `monitoring` | Watched, not yet actioned | qualified, outreach_planned | qualified, outreach_planned, converted, dismissed, archived | **YES** | **NO** | clear |
| `outreach_planned` | Outreach planned, not completed | qualified, monitoring | monitoring, converted, dismissed, archived | **YES — explicitly** | **NO** | a plan exists; the action has not concluded |
| `converted` | Commercial outcome reached | monitoring, outreach_planned | **archived only** | **PROBABLY — see §2.6** | **NO (recommended)** | comment calls it terminal; allowlist contradicts that |
| `dismissed` | Rejected by an operator | detected, triaged, reviewing, qualified, monitoring, outreach_planned | **triaged, archived** | **YES — reopenable** | **NO — evidence-based** | *"can be reopened to `triaged` to handle accidental dismissal"* |
| `archived` | Tombstoned | every other state | **none** | **NO** | **YES — the only one** | absorbing by construction |

### 2.6 Are `dismissed`, `archived` and `converted` genuinely terminal?

| State | Verdict | Grounds |
|---|---|---|
| `dismissed` | **NOT terminal** | Reversible to `triaged` by explicit design. Terminality here would allow irreversible account deletion on the strength of a reversible judgement |
| `archived` | **TERMINAL** | Absorbing: `archived: []`. No legal transition leaves it. This is the only state the verified state machine makes terminal |
| `converted` | **NOT terminal for deletion purposes (recommended)** | Two independent grounds. **(a) Structural:** it is not absorbing — `converted → archived` remains legal, so the model itself does not treat it as an end state despite the comment. **(b) Obligations:** conversion is a *commercial outcome*, and `outreach_outcomes` is a separate live store with two write paths (SES webhook and an operator route), so an outcome can arrive after the fact. A converted opportunity is the one most likely to carry continuing audit and reporting obligations. Requiring it to be archived first costs one already-legal transition |

**Distinguishing the three concepts the brief asked to keep apart:**

- **Lifecycle state** — `opportunity_lifecycle_states.state`, the 9-value enforced machine. The only thing with transition rules.
- **Disposition** — `opportunity_dispositions.disposition`, 7 values (`qualified`, `disqualified`, `low_priority`, `revisit_later`, `not_relevant`, `converted`, `duplicate`). A **triage judgement**, with **no transition rules and no enforcement**. Overlaps the state vocabulary on `qualified`/`converted` but is a different axis.
- **A historical event** — that an action occurred (`outreach_planned`, `converted`, and rows in `outreach_outcomes`). An event is not a state and does not make a record closed.

### 2.7 Person-level vocabulary, recorded for completeness

`unified_persons` lifecycle: `active | merged | suppressed | archived` (`personDuplicates.ts:45`). **No code sets `archived` or `suppressed`**, per `PI-CONTRACT-002`'s finding, which this audit did not re-verify beyond that citation. A **fourth** vocabulary; not an opportunity vocabulary, and not a basis for opportunity terminality.

### 2.8 Deletion restrictions that exist today

| Restriction | Status | Caller |
|---|---|---|
| `lead_intelligence_person_tenant_fk` — `ON DELETE RESTRICT` on `(unified_person_id, company_id)` | **ACTIVE** (`20260921000000:184-187`) | blocks person deletion whenever a `lead_intelligence` row references the person |
| `erasePerson` (`personErasure.ts:149`) | exists; **no API route caller** | — |
| Any existing terminal-state check before a delete | **NONE** | there is no terminality concept to check (§2.3, Finding 3) |

### 2.9 Proposed terminality policy, grounded in the verified state machine

**Only `archived` is terminal for ordinary account deletion.** Every other state, and any unrecognised value, is non-terminal and blocks deletion.

| Property | Value |
|---|---|
| Terminal set | **`{ archived }`** |
| Non-terminal | `detected`, `triaged`, `reviewing`, `qualified`, `monitoring`, `outreach_planned`, `converted`, `dismissed`, and **any unrecognised value** |
| Why it is safe | `archived` is the only absorbing state, so no archived opportunity can later be revived into something that needed the account |
| Why it is workable | `archived` is one legal transition from every state (§2.4), so nothing can get stuck |
| Fail-closed | an unknown state is non-terminal, so deletion is refused rather than permitted |

**This is an engineering recommendation from evidence, not an approved decision.**

### 2.10 What still cannot be decided from evidence

| # | Owner decision required | Why evidence cannot settle it |
|---|---|---|
| **1** | Whether the canonical PI opportunity **reuses** this 9-state vocabulary, defines its own, or maps onto it | The 9 states are keyed to `opportunity_feed_item_id` — a Community Discovery record — and several (`triaged`, `reviewing`, `monitoring`) describe operator workflow rather than canonical fact. Reuse keeps one language; a separate vocabulary risks the divergence the one-way rule exists to prevent. This is a product-architecture choice |
| **2** | Whether `converted` must be archived before account deletion | Structurally it is not absorbing; whether a *converted* opportunity's obligations are discharged is a commercial/compliance judgement, not a code fact |
| **3** | Whether the meanings of `triaged`, `reviewing` and `monitoring` should be documented before being relied on for a deletion gate | The code defines transitions but **not semantics** for these three |
| **4** | Whether the self-contradictory comment on `converted` should be corrected | Documentation fix; not this audit's to make |

---

## 3. Q2 — bulk resolution and reason handling

### 3.1 Do bulk operations already exist?

**Yes, elsewhere in the platform, and they report per-item outcomes.**

| Precedent | Evidence |
|---|---|
| `pages/api/engagement/thread/bulk-ai-reply.ts:98-115` | returns `{ sent, skipped, errors, outcomes }` including `skipped_not_actionable` — explicit per-item outcome reporting, batch resolves rather than throwing |
| `pages/api/engagement/message/bulk-like.ts` | a second bulk route |
| `pages/api/admin/credits/idempotency/reconcile.ts` | bulk reconciliation |

**For opportunities specifically: no bulk operation exists.** The only lifecycle route is `pages/api/active-leads/lifecycle.ts`, which transitions **one** item.

### 3.2 Authorization on the existing comparable operation

`pages/api/active-leads/lifecycle.ts` — wrapped by `createApiRoute` (`lib/platform/routeFactory`) and authorizing **inside the handler**:

- `getUserRole(ctx.userId, companyId)` at `:59`, `403 FORBIDDEN_ROLE` on failure at `:60`, and a further role check at `:62`.
- **No `requireCapability`. No step-up. No `withIdempotency`.**

And the service is explicit that it does not authorize: *"Caller (API) is responsible for RBAC checks"* (`opportunityLifecycleService.ts:122-123`).

**So the existing pattern is a legacy role check.** Adopting `requireCapability` + step-up for opportunity resolution would be an **upgrade**, consistent with the CLOSURE-series finding that write routes need real authority, and **not** a continuation of the current pattern. Stated plainly so the owner knows this is a change, not an inheritance.

| Primitive available | Evidence |
|---|---|
| Capability check | `requireCapability(req, res, {capability, organizationId, resourceId})` — `backend/security/requireCapability.ts:81` |
| Step-up | `StepUpRequirement`, `evaluateStepUp`, `STEP_UP_REQUIRED` → 401 — `AuthorizationService.ts:248-277`, `:307` |
| Audited denial | `logSecurityEvent` → `capability_audit_log` — `requireCapability.ts:144`, auditing unauthenticated attempts at `:89-95` |
| Route idempotency | `withIdempotency(handler, {methods, scope, staleLockMs})` — `withIdempotency.ts:219-226`; does not wrap GET |

### 3.3 Reason fields and controlled vocabularies — inventory

| Field | Shape | Evidence |
|---|---|---|
`opportunity_lifecycle_states.reasoning` | **free text, nullable** | Phase-6 migration; carried on every transition |
| `opportunity_dispositions.disposition` | **controlled, 7 values** | `qualified`, `disqualified`, `low_priority`, `revisit_later`, `not_relevant`, `converted`, `duplicate` |
| `opportunity_dispositions.reason` | **free text, nullable** | beside the controlled enum |
| `prospect_list_members.removal_reason` | **free text, nullable** | `20261127000000:178` |
| `source_assertions.applied_reason` | controlled — the four ratified apply reasons | `20261119000000` CHECK |
| `canonical_attribute_decisions.reason` | controlled — same four | `20261119000000` CHECK |

**The `removal_reason` precedent is verified, and its rationale is stronger than previously reported.** Quoted minimally from `20261127000000_pi_prospect_lists.sql:200-203`:

> *"`removal_reason` is OPTIONAL, decided rather than left vague: a user removing someone from a list need not justify it, and **requiring a reason would produce placeholder text that reads like evidence.** When one IS given it is retained verbatim."*

So the optionality was an **explicit design decision with a stated reason**, not an omission — confirming the brief's reported precedent.

**The pattern across the codebase:** a **controlled enum for the decision** plus an **optional free-text reason for the explanation**. Controlled reason *codes* appear only where the reason is itself a ratified rule (arbitration), never for operator actions.

### 3.4 Can the existing disposition enum serve Q2?

**No — not without semantic distortion.** Compared on actual values and meaning, as the brief requires:

| `disposition` value | Meaning | Fit as a deletion-resolution reason |
|---|---|---|
| `qualified` | this is a real opportunity | **opposite** of resolving it |
| `disqualified` | not a real opportunity | plausible |
| `low_priority` | deprioritised | **not** resolved |
| `revisit_later` | explicitly to be revisited | **contradicts** resolution |
| `not_relevant` | out of scope | plausible |
| `converted` | won | an outcome, not a resolution |
| `duplicate` | same as another | plausible |

Only three of seven are even plausible, and two (`low_priority`, `revisit_later`) assert the opposite of resolution. **It is a triage-judgement vocabulary for a different axis.** Reusing it would make "resolved for deletion" indistinguishable from "look at this later".

**No new vocabulary is created in this audit.** §3.5 instead proposes reusing something that already exists and is already enforced.

### 3.5 The Q2 proposal — nine questions answered independently

**Recommendations only. Nothing is approved.**

| # | Question | Recommendation | Grounds |
|---|---|---|---|
| **1** | Is bulk resolution allowed? | **YES** | Per-item-outcome bulk routes already exist (§3.1). Without it an account with many opportunities cannot realistically be cleared, and operators route around controls they cannot use |
| **2** | Must each opportunity be independently validated? | **YES — required** | WP-6 verified the orchestrator rule that one bad record fails that record and no other. A batch must never widen authority: N items ⇒ N authorization checks |
| **3** | What authorization and step-up applies? | **`requireCapability` per item, plus step-up on the batch** | Primitives exist (§3.2). **This is an upgrade from the existing role check, not a continuation** |
| **4** | Is a controlled reason code required? | **NO — and none should be invented.** The controlled element is the **target state** (`archived`), already enforced by `canTransitionLifecycle` | §3.3 — controlled reason *codes* exist only for ratified rules. The migration's own argument applies directly: requiring a reason "would produce placeholder text that reads like evidence" |
| **5** | Is free-text explanation optional or mandatory? | **OPTIONAL, retained verbatim when given** | `opportunity_lifecycle_states.reasoning` already provides exactly this field. Matches both in-repo precedents |
| **6** | Partial success? | **Per-item outcomes; the batch resolves rather than throwing.** Each item's own write stays atomic | `bulk-ai-reply` precedent plus the canonical-write precedent |
| **7** | Retries and duplicate submissions? | **Idempotent — with one specific requirement.** Re-resolving an already-archived item must be reported as **already-resolved success**, not failure | **Important detail:** `canTransitionLifecycle` returns `{allowed:false, reason:'no_op_same_state'}` when `from === to`, and `transitionLifecycle` **throws** on that. A naive retry would therefore surface a spurious failure. The bulk layer must map `no_op_same_state` (and `archived`'s empty allowlist) to *already resolved*. Route-level replay via `withIdempotency` |
| **8** | What audit evidence is required? | **Two sinks, both existing.** `opportunity_lifecycle_states` already records `previous_state`, `reasoning`, `actor_user_id`, `transitioned_at` as an append-only history; `capability_audit_log` records every authorization decision including denials | no new audit table |
| **9** | Negative controls? | see §3.6 | — |

**Net effect: Q2 needs no new enum, schema, API or vocabulary.** Bulk resolution is a bulk invocation of the existing, enforced, already-audited `archived` transition, wrapped in per-item capability checks.

### 3.6 Existing test coverage and missing negative controls

| Area | Coverage found | Missing |
|---|---|---|
| Transition allowlist | `canTransitionLifecycle` is pure and unit-testable; the repo has lifecycle tests | no test that a **bulk** path cannot bypass the allowlist |
| Authorization on the lifecycle route | role check present in-handler | **no negative control** proving a denied role cannot transition |
| Audit of denials | `capability_audit_log` is written by `requireCapability`, which this route does not use | **no audit evidence** for denied lifecycle transitions today |
| Cross-tenant | `organization_id` scoping present | **no test** that a cross-tenant item in a batch is refused rather than silently skipped |
| Idempotency | `no_op_same_state` exists | **no test** that a retry reports already-resolved rather than failure |

**Proposed negative controls (not implemented):** grant blanket authority and prove the per-item check fails; remove the step-up requirement and prove the step-up test fails; place a cross-tenant item in a batch and prove refusal with no partial write; submit the same batch twice and prove no second transition row and no spurious failure; relax the allowlist and prove an illegal transition is caught. Each plants the defect in a disposable database only, proves the failure, then restores.

---

## 4. Decision-ready owner table

Each row names the exact decision. **Repository facts** are in §2–§3; **engineering recommendations** are labelled as such; **nothing below is approved.**

### 4.1 Q1 decisions

| # | Exact decision | Recommended | Strongest alternative | Evidence | Consequences / risks | Acceptance criteria that follow | Finalizable now? |
|---|---|---|---|---|---|---|---|
| **Q1-1 — Vocabulary ownership:** does the canonical PI opportunity reuse the existing 9-state vocabulary, define its own, or define its own with a documented mapping? | **Reuse the existing 9 states** | **Separate PI vocabulary** | The 9 states are verified in schema and code and enforced; but they are keyed to a Community Discovery record and three describe operator workflow, not canonical fact | Reuse: one language, no divergence; but imports workflow semantics into a canonical record. Separate: clean separation; but a second lifecycle vocabulary is the divergence the one-way rule exists to prevent | one named constant for the vocabulary; a second spelling is a test failure | **NEEDS OWNER DECISION** — product architecture, not derivable from code |
| **Q1-2 — Terminal set for ordinary account deletion:** which states permit deletion? | **`{ archived }` only** | `{ archived, converted }` | `archived` is the **only absorbing state** (`archived: []`); `archived` is reachable in one legal transition from **every** state, so nothing gets stuck | Recommended: strictest, safe, workable. Alternative: fewer archive steps, but `converted` is not absorbing and may carry outcome obligations | deletion refused while any referencing opportunity is outside the terminal set, atomically; succeeds once all are inside it | **YES — evidence-based**, conditional on Q1-1 |
| **Q1-3 — Is `dismissed` terminal?** | **NO** | yes, treat rejection as final | **`dismissed → triaged` is explicitly permitted**, and the module comment states it exists "to handle accidental dismissal" | Treating it as terminal would allow irreversible account deletion on the strength of a reversible judgement | a dismissed opportunity **blocks** deletion until archived | **YES — evidence decides this** |
| **Q1-4 — Is `converted` terminal?** | **NO — require archiving first** | yes, a won opportunity is finished | Structurally not absorbing (`converted → archived` legal); `outreach_outcomes` has two live write paths so outcomes can arrive later | Recommended: one extra already-legal transition. Alternative: risks deleting an account whose converted opportunity still has reporting obligations | converted opportunities block deletion until archived | **NEEDS OWNER DECISION** — commercial/compliance judgement |
| **Q1-5 — Unknown or unrecognised state:** terminal or not? | **NON-TERMINAL (fail closed)** | treat as terminal | no terminality concept exists in code today, so a default must be chosen deliberately | fail-closed refuses deletion on an unexpected value; the alternative permits it | an out-of-vocabulary state **blocks** deletion, proven by test | **YES — recommended, trivially safe** |
| **Q1-6 — Should `triaged`/`reviewing`/`monitoring` semantics be documented before a deletion gate relies on them? | **YES** | rely on transitions alone | the code defines transitions but **not meanings** for these three | relying on undefined semantics in a deletion gate is how a gate becomes wrong later | documented definitions, or an explicit note that only terminality matters | **NEEDS OWNER DECISION** — documentation scope |

### 4.2 Q2 decisions

| # | Exact decision | Recommended | Strongest alternative | Evidence | Consequences / risks | Acceptance criteria that follow | Finalizable now? |
|---|---|---|---|---|---|---|---|
| **Q2-1 — Is bulk resolution permitted?** | **YES** | one-at-a-time only | bulk routes with per-item outcomes already exist (§3.1) | Permitting it makes the control usable; refusing it invites workarounds | a bulk endpoint exists with per-item outcomes | **YES — recommended** |
| **Q2-2 — Independent per-item validation?** | **YES — required** | validate once per batch | WP-6's one-bad-record-fails-alone rule | batch-level validation would widen authority across items | N items ⇒ N authorization checks; one denial neither denies nor permits the rest | **YES — recommended** |
| **Q2-3 — Authorization and step-up model** | **`requireCapability` per item + step-up on the batch** | keep the existing role check | primitives exist; the current lifecycle route uses only `getUserRole` + 403 | Recommended is an **upgrade**, consistent with CLOSURE-series direction; it is new behaviour, not inherited | denied and insufficiently-stepped-up attempts refused **and audited** | **NEEDS OWNER DECISION** — it changes an existing pattern |
| **Q2-4 — Controlled reason code required?** | **NO.** The controlled element is the **target state**; no new vocabulary | require a controlled code | controlled reason codes exist only for ratified rules; the migration's own argument is that a mandatory reason "would produce placeholder text that reads like evidence" | Recommended avoids fabricated evidence; the alternative produces exactly that | resolution requires a legal target state, not a reason code | **YES — recommended, strongly evidenced** |
| **Q2-5 — Free-text explanation: optional or mandatory?** | **OPTIONAL, retained verbatim** | mandatory | `opportunity_lifecycle_states.reasoning` already nullable; two independent in-repo precedents | matches established behaviour | a given reason is stored verbatim; absence is not an error | **YES — recommended** |
| **Q2-6 — Partial success handling** | **Per-item outcomes; batch resolves; each item's write atomic** | all-or-nothing batch | `bulk-ai-reply` returns `{sent, skipped, errors, outcomes}` | all-or-nothing makes one bad item block legitimate work | every item reports an outcome; no partial write within an item | **YES — recommended** |
| **Q2-7 — Retries and duplicates** | **Idempotent; already-archived reported as already-resolved success** | report it as a failure | `canTransitionLifecycle` returns `no_op_same_state` and `transitionLifecycle` **throws** on it, so a naive retry surfaces a spurious failure | without the mapping, retries look broken and operators stop retrying | re-submitting a resolved item is a no-op success; no second history row | **YES — recommended; the mapping is the specific requirement** |
| **Q2-8 — Required audit evidence** | **Both existing sinks**: append-only `opportunity_lifecycle_states` + `capability_audit_log` for every decision incl. denials | a new audit table | both already exist; the repo already carries ≥5 audit tables | no new table; denials currently unaudited on this route | one history row per transition; one audit event per authorization decision | **YES — recommended** |
| **Q2-9 — Negative controls** | the five in §3.6 | fewer | WP-2/WP-3 showed a detector that silently matches nothing is worse than none | without them, a passing suite proves little | each plants a defect, proves failure, restores, re-asserts | **YES — recommended** |

---

## 5. Schedule and time accountability

### 5.1 Frozen baselines — verified against the ledger, unchanged

| Item | Frozen | Ledger `1ad1105accdd5866…` | Result |
|---|---|---|---|
| Milestone A′ | 2026-11-25, 28.5 human engineer-days | §3.1 / §3 | **MATCH** |
| WP-7 | 2026-11-17, 4.0 engineer-days | §3 row WP-7 | **MATCH** |

**No date, budget, estimate, scope or sequencing changed by this audit.**

### 5.2 This task

| | |
|---|---|
| **Actual start** | **2026-10-17T17:38:54+05:30 (IST)** |
| External waiting time before start | **16 min 20 s** (prior close 17:22:34 → 17:38:54) — not engineering effort |
| Original estimate | **0.5 engineer-days** (read-only audit) |
| Active engineering effort consumed | **~7 minutes** |
| 75% threshold (0.375 d) | **not approached** |
| Remaining | 0 — complete at this report |
| Monitoring | **no continuous monitoring claimed between reports**; every timestamp is a measured `date -Iseconds` |

### 5.3 OVERRUN RISK status

**REMAINS RAISED on Milestone A′, unchanged from PI-C1-OWNER-DECISIONS-002 §7.5** — Milestone A′ carries +4 days float at the low C-1 estimate and **zero** at the high estimate; WP-7 at 2026-11-17 remains feasible with +6 to +10 days. First raised 2026-10-17T16:33+05:30; confidence MEDIUM-HIGH.

**This audit does not resolve it, and marginally improves the inputs:** §2.4 and §3.5 establish that Q1 and Q2 require **no new enum, schema, API or vocabulary** — resolution reuses an existing enforced transition. That reduces the C-1 work implied by the deletion gate, but it is **not** evidence that the C-1 range has narrowed, and **no estimate is revised here**. Q3 remains the dominant driver and is out of scope.

**Next review checkpoint unchanged:** the earlier of receipt of the Q1/Q2 answers plus a verified Q3 policy, or **Fri 2026-10-23** — the last date C-1 can start and retain any Milestone A′ float.

Agent wall-clock throughput is **not** used to rewrite the human engineer-day budget.

---

## 6. Summary of repository facts established

1. The 9-state vocabulary is real, identical in schema and code, and **enforced at write time**.
2. **`archived` is the only absorbing state.**
3. **`dismissed` is deliberately reversible** — which contradicts the proposed policy that the `disqualified` analogue may be terminal.
4. **`converted` is not absorbing**, and its own doc comment contradicts the allowlist.
5. **No terminal-state concept exists in the codebase** — only a self-contradictory comment.
6. **`acted` does not exist.**
7. **`archived` is one legal transition from every state**, so the resolution path already exists and is already audited.
8. The existing lifecycle route authorizes with a **legacy role check**, not capability + step-up, and **does not audit denials**.
9. Bulk operations with per-item outcomes exist elsewhere; **none exists for opportunities**.
10. The repository pattern is **controlled enum + optional free-text reason**; controlled reason *codes* appear only for ratified rules.
11. `prospect_list_members.removal_reason` optionality is a **verified explicit design decision**, on the stated grounds that a mandatory reason "would produce placeholder text that reads like evidence".
12. The existing 7-value disposition enum **does not fit** deletion-resolution semantics; two of its values assert the opposite.

---

## 7. Stop condition

This audit is **evidence for decisions**. It implements nothing, approves nothing, and authorizes nothing. Q3 was not addressed. Six Q1 decisions and nine Q2 decisions are presented in §4 — **five Q1 and seven Q2 items are finalizable now on the evidence; four require owner judgement** that code cannot supply.

C-1a remains unauthorized and unchanged in scope.
