# PI-Q1-Q2-REMAINDER-001 — remaining owner decisions for Q1 and Q2

**READ-ONLY except for this file.** No implementation, no migration, no database write, no production access, no production migration-history query, no provider call, no feature-flag change, no commit, push, merge or deployment, no modification of `C:/virality`. **No application code, test, schema, migration, existing report, proposed addendum, ratified manifest or execution ledger was edited.**

**No implementation is authorized. C-1a remains unauthorized.**

---

## 1. Verified baseline and source hashes

Measured at **2026-10-17T19:02:43+05:30 (IST)**. The prior baseline was **not assumed**.

| | Expected | **Actual** | Result |
|---|---|---|---|
| Repository | `C:/tmp/r1-ctx` | `C:/tmp/r1-ctx` | **MATCH** |
| Branch | `fix/r1-profile-context` | `fix/r1-profile-context` | **MATCH** |
| HEAD | `29fea38a…81415774` | `29fea38a2d1642c1c2fd957e5151f6be81415774` | **MATCH** |
| Worktree | — | **135 entries (67 M / 68 ??), 0 staged** | unchanged from the prior close |
| This target file pre-existing? | must not exist | **ABSENT** | nothing overwritten |

| Source document | Expected | **Actual SHA-256 (24) / lines** | Result |
|---|---|---|---|
| `PI-Q1-Q2-OWNER-DECISIONS-001.md` | `88be0578…`, 293 lines | `88be0578b6bcacaa6dddff93` / **293** | **MATCH on both** |
| `PI-Q1-Q2-AUDIT-001.md` | `899781f2…`, 336 lines | `899781f20bd30fa558601cbf` / **336** | **MATCH on both** |
| `PI-C1-DECISION-CLOSURE-001.md` | — | `7e74c05d6d991c94e46806e0` / 285 | unchanged |
| `PI-C1-OWNER-DECISIONS-002.md` | — | `7296df67fd054717a66c3c1c` / 425 | unchanged |
| `PI-REQUIREMENTS-ADDENDUM-001-PROPOSED.md` | — | `f244adb96027f8078ec263c2` / 236 | unchanged |

**No hash discrepancy.** Also re-inspected: `backend/types/opportunityLifecycle.ts`, `backend/services/opportunityLifecycleService.ts`, `pages/api/active-leads/lifecycle.ts`, `components/recommendations/tabs/AnalystWorkspacePanel.tsx`, `supabase/migrations/20260520_phase6_realtime_lifecycle_workflow.sql`, `supabase/migrations/20261127000000_pi_prospect_lists.sql`, `backend/security/requireCapability.ts`, `backend/security/AuthorizationService.ts`, `backend/middleware/withIdempotency.ts`, and `PI-MILESTONE-A-EXECUTION-001.md`.

---

## 2. Status table

### 2.1 APPROVED — preserved, not reopened, not downgraded

| # | Approved policy direction |
|---|---|
| A-1 | The existing nine-state opportunity lifecycle vocabulary owns lifecycle and terminality |
| A-2 | **`archived` is the sole terminal state** for ordinary account-deletion eligibility |
| A-3 | Every other state — including `dismissed`, `converted`, unknown and future states — is **non-terminal** for this purpose unless the owner later approves a change |
| A-4 | `converted` must transition to `archived` **through the existing validated and audited lifecycle mechanism** before it qualifies as resolved |
| A-5 | The undefined business meanings of `triaged`, `reviewing`, `monitoring` are **documentation/clarification items**; their meanings are **not invented** |
| A-6 | The disposition enum must **not** be reused as a deletion-resolution vocabulary without separate justification and approval |
| A-7 | **Capability-based authorization plus step-up** is the approved baseline for future bulk opportunity resolution |
| A-8 | A-7 is a **required security upgrade**, not a claim that the current lifecycle route implements it |
| A-9 | Denied attempts must be **audited without leaking cross-tenant information** |
| A-10 | **No new reason-code enum** for C-1 |
| A-11 | Do **not** repurpose the existing disposition enum as a deletion-resolution vocabulary |
| A-12 | **Preserve optional free-text explanations** where the existing contract permits them |
| A-13 | Repeated archive requests must eventually return an explicit **already-resolved** result, not a spurious invalid-transition failure |

### 2.2 OPEN — requires owner decision

| ID | Exact question, recovered verbatim | Where it is defined |
|---|---|---|
| **Q1-6-a** | Business meaning of **`triaged`** | audit §2.5, §2.10 item 3; record §3.3 |
| **Q1-6-b** | Business meaning of **`reviewing`** | same |
| **Q1-6-c** | Business meaning of **`monitoring`** | same |
| **Q2-1** | **"Is bulk resolution permitted?"** — recorded as *"bulk-operation scope"* | record `:132`, `:225`; audit `:268` |
| **Q2-4** | **"Is a controlled reason code required?"** — audit heading *"Controlled reason code required?"* | record `:135`, `:226`; audit `:271` |
| **Q2-5** | **"Free-text explanation optional or mandatory?"** — recorded as *"free-text mandatoriness"* | record `:136`, `:227`; audit `:272` |

Exact wording was **recovered from the prior documents by line reference**, not inferred from the numeric identifiers.

### 2.3 BLOCKED

| ID | Status |
|---|---|
| **Q3 — legal-erasure policy** | **BLOCKED** — see §5 |
| **OD-3 / OD-4 / OD-5** | **BLOCKED** — unchanged; block WP-4 and WP-5 |

### 2.4 Separate gates, not addressed here

**PI-ADD-001 ratification** (§6) · **D-C** · **D-E** · **Q4** high-risk action catalogue · company-event sources (**not authorized**) · production migration state (**UNVERIFIED**) · production tenant isolation (**UNVERIFIED**).

---

## 3. Q1 — the remaining documentation questions

### 3.1 The smallest documentation-only action

**Record the three definitions in `PI-ADD-001 v0.2-PROPOSED` as requirements-clarification items, answered by the owner.** That is the smallest action because:

- the addendum is already scheduled for a v0.2 carrying four corrections, so no new document is needed;
- it requires **no** change to application code, lifecycle types, schema, migrations or the ratified manifest;
- **A-2 is independent of it** — terminality rests only on `archived`, which is machine-verifiable, so the deletion gate can be specified and tested while these three remain undefined.

**The meanings are not invented here.**

### 3.2 What the source establishes — and what it does not

A full search for an existing definition returned **none**. Specifically:

| Candidate source | What it contains | Is it a definition? |
|---|---|---|
| `backend/types/opportunityLifecycle.ts` | `LIFECYCLE_STATES`, the transition allowlist, `canTransitionLifecycle` | **No** — transitions only, no semantics |
| `20260520_phase6_realtime_lifecycle_workflow.sql` | the `state` CHECK | **No** |
| `components/recommendations/tabs/AnalystWorkspacePanel.tsx:65-80` | `LIFECYCLE_ORDER` (a display sequence) and `LIFECYCLE_TONE` (colour classes only) | **No** — ordering and colour, no label text, no tooltip, no help copy |
| `opportunityLifecycleService.ts:175` | a zero-initialised count map | **No** |
| Repository-wide prose search for a definition of these states | **no match outside `archive/`**, where "triaged" refers to an unrelated conversation-triage feature | **No** |

**Conclusion: the three meanings are genuinely undocumented in this repository.** The claim is reported as verified, not assumed.

### 3.3 Structural evidence that constrains the answers

This is topology, not meaning, and is offered so the owner can answer from fact rather than from the state names.

| State | Incoming | Outgoing | Structural facts worth noting |
|---|---|---|---|
| **`triaged`** | `detected`, `reviewing`, **`dismissed`** | `reviewing`, `qualified`, `dismissed`, `archived` | It is the **reopen target** for `dismissed`, so whatever it means must be a valid place to land after an accidental dismissal. It sits between detection and review, and can go straight to `qualified` without `reviewing` |
| **`reviewing`** | `triaged`, **`qualified`** | `triaged`, `qualified`, `dismissed`, `archived` | **Bidirectional with `qualified`** — so qualification is revisable, and review can legitimately follow it. It cannot reach `monitoring`, `outreach_planned` or `converted` directly |
| **`monitoring`** | `qualified`, **`outreach_planned`** | `qualified`, `outreach_planned`, **`converted`**, `dismissed`, `archived` | **The only non-outreach state that can reach `converted` directly**, so conversion without a planned outreach is a legal path. Bidirectional with both `qualified` and `outreach_planned` |
| Display order | — | — | `detected → triaged → reviewing → qualified → monitoring → outreach_planned → converted → dismissed → archived`. A **display** sequence only; the allowlist is not linear |

### 3.4 Exact owner questions for Q1

> **Q1-6-a — `triaged`.** What does it mean for an opportunity to be *triaged*, given that it is the state an accidentally-dismissed opportunity is reopened into, and that it may proceed to `qualified` without passing through `reviewing`?
>
> **Q1-6-b — `reviewing`.** What does *reviewing* mean, given that it is bidirectional with `qualified` (so a qualified opportunity may return to review) and cannot reach `monitoring`, `outreach_planned` or `converted` directly?
>
> **Q1-6-c — `monitoring`.** What does *monitoring* mean, given that it is bidirectional with both `qualified` and `outreach_planned`, and is the only non-outreach state from which an opportunity may become `converted`?

**Evidence needed to answer:** none further from the repository — the topology above is complete and there is no definition to find. These are **product-semantics questions**, answerable only by the owner.

### 3.5 Acceptance criteria once answered

| ID | Criterion |
|---|---|
| **AC-D1** | Each of the three definitions appears exactly once, in `PI-ADD-001 v0.2-PROPOSED`, attributed as an owner clarification |
| **AC-D2** | No definition contradicts the verified transition topology in §3.3 — in particular, `triaged` must admit a reopened dismissal, and `monitoring` must admit direct conversion |
| **AC-D3** | No definition changes the terminal set; **A-2 remains `{ archived }`** |
| **AC-D4** | No lifecycle type, schema, migration or application file is modified to record a definition |

**Can the owner decide now?** **Yes** for all three — no further evidence exists or is needed.

---

## 4. Q2 — the three remaining decisions

### 4.1 Q2-1 — "Is bulk resolution permitted?"

**Facts established by the source**

| Fact | Evidence |
|---|---|
| Bulk routes with per-item outcomes already exist in the platform | `pages/api/engagement/thread/bulk-ai-reply.ts:98-115` returns `{ sent, skipped, errors, outcomes }` including `skipped_not_actionable`; also `pages/api/engagement/message/bulk-like.ts`, `pages/api/admin/credits/idempotency/reconcile.ts` |
| **No bulk operation exists for opportunities.** The only lifecycle route transitions one item | `pages/api/active-leads/lifecycle.ts` |
| `archived` is reachable in **one legal transition from every state**, so resolution needs no new mechanism | machine-verified from `ALLOWED_LIFECYCLE_TRANSITIONS` |
| A-7 approved the **authorization model** for "future bulk opportunity resolution" — not the operation | approved direction, §2.1 |

**Recommendation (not approved): PERMIT, scoped narrowly** — bulk resolution limited to transitioning opportunities to `archived` for the purpose of clearing an account-deletion block, with per-item validation and explicit per-item outcomes.

**Strongest alternative:** permit **one-at-a-time only**. Defensible: it is the smallest surface, needs no new endpoint, and the single-item route already exists. The cost is that an account with many blocking opportunities becomes impractical to clear, which is how controls get routed around.

**Consequences**

| Dimension | Recommended (scoped bulk) | Alternative (single only) |
|---|---|---|
| Security | N items ⇒ N capability checks + step-up; larger surface but each item independently authorized | smallest surface |
| Operational | an account with many blockers is clearable | may be impractical; invites workarounds |
| Data integrity | each item's write stays atomic; batch resolves with per-item outcomes | trivially safe |

**Acceptance criteria** — AC-R1…AC-R5 of the prior record apply: the existing enforced `transitionLifecycle` path is used and never bypassed; each item returns an explicit outcome; the batch resolves rather than throwing; a repeat on an already-`archived` item reports **already resolved** with no second history row; a cross-tenant item is refused with no partial write and the refusal is audited; an illegal transition is refused by the allowlist, not by caller discipline.

**Negative controls** — NC-4 (blanket authority ⇒ per-item check fails), NC-8 (remove the `no_op_same_state` mapping ⇒ the already-resolved test fails), NC-9 (cross-tenant item in a batch ⇒ refusal test fails). Each plants the defect in a disposable environment, proves the failure, restores, re-asserts.

**Decidable now?** **Yes.** The only genuinely open element is *scope*, and §4.1's recommendation states the narrowest useful scope explicitly.

### 4.2 Q2-4 — "Is a controlled reason code required?"

**Facts established by the source**

| Fact | Evidence |
|---|---|
| Controlled reason **codes** exist in this repository only where the reason is itself a ratified rule | `source_assertions.applied_reason` and `canonical_attribute_decisions.reason` — both CHECK-constrained to the four ratified apply reasons (`20261119000000`) |
| For **operator actions** the pattern is a controlled decision enum **plus an optional free-text reason** | `opportunity_dispositions` (controlled `disposition`, nullable `reason`); `opportunity_lifecycle_states` (controlled `state`, nullable `reasoning`); `prospect_list_members` (nullable `removal_reason`) |
| A controlled element **already exists** for this workflow: the **target state**, enforced by `canTransitionLifecycle` | `opportunityLifecycle.ts:57-67`, enforced at `opportunityLifecycleService.ts:132-137` |
| A-10 and A-11 already prohibit a new enum and prohibit repurposing the disposition enum | approved directions |

**Recommendation (not approved): NOT REQUIRED.** The controlled element is the **target state** (`archived`), which is already enforced and already audited. No reason-code vocabulary is introduced.

**Strongest alternative:** require a controlled code drawn from a vocabulary to be specified separately. Defensible if resolution must be reportable by category — but A-10 and A-11 mean such a vocabulary would have to be newly justified and approved, and the migration's own argument applies: *"requiring a reason would produce placeholder text that reads like evidence."*

**Consequences**

| Dimension | Recommended (no code) | Alternative (controlled code) |
|---|---|---|
| Data integrity | no fabricated evidence; the audited fact is the state transition | risks placeholder categories chosen to satisfy a required field |
| Operational | nothing blocks a legitimate resolution | categorised reporting becomes possible |
| Security | unchanged | unchanged |

**Acceptance criteria** — resolution requires a **legal target state**, not a reason code; no new enum, CHECK constraint or vocabulary is added; the transition is refused by the allowlist if illegal. **Negative control:** add a mandatory reason-code requirement and prove a legitimate resolution is blocked by it — demonstrating the cost the alternative carries.

**Decidable now?** **Yes.** Strongly evidenced, and already constrained by A-10/A-11.

### 4.3 Q2-5 — "Free-text explanation optional or mandatory?"

**Facts established by the source**

| Fact | Evidence |
|---|---|
| The field already exists and is **nullable** | `opportunity_lifecycle_states.reasoning` (`20260520_phase6_realtime_lifecycle_workflow.sql`), carried on every transition alongside `previous_state`, `actor_user_id`, `transitioned_at` |
| A second, independent precedent is nullable **by explicit design**, with the reasoning stated in the migration | `20261127000000_pi_prospect_lists.sql:200-203` — *"`removal_reason` is OPTIONAL, decided rather than left vague: a user removing someone from a list need not justify it, and requiring a reason would produce placeholder text that reads like evidence. When one IS given it is retained verbatim."* |
| A-12 already requires preserving optional free-text where the existing contract permits it | approved direction |

**The existing contract under which it remains sufficient:** `opportunity_lifecycle_states.reasoning` — nullable, written on every transition, retained verbatim when supplied, and already part of the append-only transition history.

**Recommendation (not approved): OPTIONAL, retained verbatim.** This is also the behaviour A-12 requires preserving.

**Strongest alternative:** mandatory for *resolution* transitions specifically, on the grounds that clearing a deletion block is more consequential than removing a list member. Defensible — but it requires a column-level or application-level divergence from the existing nullable contract, and it reintroduces exactly the placeholder-text failure the migration documents.

**Consequences**

| Dimension | Recommended (optional) | Alternative (mandatory) |
|---|---|---|
| Data integrity | an absent reason is honest; a supplied one is verbatim evidence | placeholder text that reads like evidence |
| Operational | nothing blocks resolution | resolution can be blocked by a missing justification |
| Auditability | the audited facts are the transition, actor and timestamp — all mandatory | adds a narrative field of uncertain reliability |

**Acceptance criteria** — a supplied explanation is stored **verbatim**; its absence is **not** an error; the mandatory audit facts (`previous_state`, `actor_user_id`, `transitioned_at`) are present on every transition regardless. **Negative control:** make the field mandatory and prove a legitimate resolution is refused for want of narrative text.

**Decidable now?** **Yes**, and it is the option A-12 already points to.

### 4.4 Cross-cutting subjects, mapped to the approved directions

The brief asks that the package address these where they correspond to the open questions. None requires a new decision; each is already settled or already specified.

| Subject | Status |
|---|---|
| Per-item validation | **EVIDENCE-SUPPORTED** (Q2-2), conditional on Q2-1 |
| Partial outcomes | **EVIDENCE-SUPPORTED** (Q2-6), conditional on Q2-1 |
| Retry behaviour and idempotency | **A-13 APPROVED**; mechanism verified — `canTransitionLifecycle` returns `no_op_same_state` at `opportunityLifecycle.ts:61` and `transitionLifecycle` **throws** at `:136`, so an explicit mapping is required. Route-level replay via `withIdempotency` (`:219-226`), which does not wrap GET |
| Capability and step-up enforcement | **A-7 / A-8 APPROVED**; primitives at `requireCapability.ts:81` and `AuthorizationService.ts:248-277`, `:307` |
| Denial auditing | **A-9 APPROVED**; sink `capability_audit_log` via `logSecurityEvent` (`requireCapability.ts:144`). **Denials are not audited on the current route today** — that is the upgrade A-8 describes |
| Tenant isolation | cross-tenant items refused, not silently skipped; refusal reveals no row counts, identifiers or existence |

**No new reason-code enum, schema, API, migration or service is created by this package.**

---

## 5. Q3 remains BLOCKED

**Q3 — the authoritative legal-erasure policy — remains BLOCKED** pending verification or approval of an applicable policy. Status unchanged: **POLICY NOT LOCATED / APPROVAL UNVERIFIED**. `PI-CONTRACT-002-data-lifecycle.md` is on scope but states *"CONTRACT PREPARED — AWAITING POLICY DECISIONS"* and *"It invents no legal or compliance policy."*

**Nothing in this task invents a retention period, legal authority, surviving-record rule or erasure semantics.** Absence of a policy in this repository is **not** treated as proof that none exists elsewhere.

**The account-deletion FK design was not changed, no erasure path was implemented, and the opportunity subject invariant was not weakened.**

## 6. PI-ADD-001 remains proposed and unratified

**`PI-ADD-001` is v0.1-PROPOSED — not ratified, not approved, not implementation-authorizing, and not edited by this task** (hash `f244adb96027f8078ec263c2…`, 236 lines, verified unchanged in §1).

### 6.1 Changes to existing documents — identified here, NOT applied

| # | Document | Recommended change |
|---|---|---|
| 1 | `PI-ADD-001` → future **v0.2-PROPOSED** | FR-A6's six-state vocabulary is superseded by **A-1**; restate against the authoritative nine states. Also the three §3.4 definitions once answered, plus the three other corrections already listed in `PI-C1-OWNER-DECISIONS-002` §6.3 |
| 2 | `backend/types/opportunityLifecycle.ts:28-34` (**application code — not edited**) | The comment calls `converted` and `archived` "terminal" while the allowlist gives `converted` an outgoing edge. **A-4** resolves the policy; the comment remains self-contradictory and should be corrected in a future authorized change |
| 3 | `OMNIVYRA-PI-OPPORTUNITY-SPINE-DESIGN-001.md` §1 and `PI-C1-IMPLEMENTATION-GATE-001.md` §8 | Both repeat the incorrect claim that `lead_intelligence` has `company_id text` with no FK. Migration `20260921000000` reconciled it to uuid with composite FKs. Already recorded in `PI-C1-OWNER-DECISIONS-002` §6.3 item 1; **restated here, still not applied** |

---

## 7. Schedule and time accountability

### 7.1 Frozen baselines — preserved, unchanged

| Item | Frozen | Source | Changed? |
|---|---|---|---|
| **Milestone A′** | **2026-11-25**, 28.5 human engineer-days | `PI-MILESTONE-A-EXECUTION-001.md` §3 / §3.1 | **NO** |
| **WP-7** | **2026-11-17**, 4.0 engineer-days | same, row WP-7 | **NO** |
| C-1 estimate | 8–12 engineer-days | gate §9.3 | **NO — not revised** |

No deadline, estimate, scope or sequencing changed. Agent wall-clock throughput is **not** substituted for human engineer-days.

### 7.2 This task

| | |
|---|---|
| **Actual start** | **2026-10-17T19:02:43+05:30 (IST)** |
| External waiting time before start | **14 min 55 s** (prior close 18:47:48 → 19:02:43) — **not** engineering effort |
| Original estimate | **0.25 engineer-days** |
| Active engineering effort consumed | **~6 minutes** |
| 75% threshold (0.1875 d) | **not approached** |
| Remaining estimate | 0 — complete at this report |
| Monitoring | **no continuous monitoring claimed between reports**; every timestamp is a measured `date -Iseconds` |

### 7.3 OVERRUN RISK — REMAINS RAISED

First identified **2026-10-17T16:33+05:30**; confidence **MEDIUM-HIGH**; **unchanged by this task**.

| | |
|---|---|
| Baseline at risk | **Milestone A′ — 2026-11-25**: **+4** working days float at the low C-1 estimate, **ZERO** at the high estimate |
| Baseline not at risk | **WP-7 — 2026-11-17**: +6 to +10 working days float |
| Dominant driver | **Q3 decision latency** — a legal/compliance dependency, still **BLOCKED** |
| Effect of closing Q1/Q2 | **Favourable, unquantified.** Specification risk falls, but **no estimate is revised and no float is claimed back** |
| **Newly identified risk** | **none** |
| Next review checkpoint | the earlier of a verified Q3 policy, or **Fri 2026-10-23** — the last date C-1 can start and retain any Milestone A′ float |

---

## 8. Smallest next action for the owner

Six answers, none requiring legal input:

| # | Decision | Recommended |
|---|---|---|
| 1 | **Q1-6-a** meaning of `triaged` | owner-supplied; must admit a reopened dismissal |
| 2 | **Q1-6-b** meaning of `reviewing` | owner-supplied; must admit return from `qualified` |
| 3 | **Q1-6-c** meaning of `monitoring` | owner-supplied; must admit direct conversion |
| 4 | **Q2-1** Is bulk resolution permitted? | **PERMIT, scoped to archiving for deletion-block clearance** |
| 5 | **Q2-4** Is a controlled reason code required? | **NOT REQUIRED** — the controlled element is the target state |
| 6 | **Q2-5** Free-text explanation optional or mandatory? | **OPTIONAL, retained verbatim**, under the existing `opportunity_lifecycle_states.reasoning` contract |

Answering 4–6 closes Q2 entirely. Answering 1–3 closes Q1 entirely. **Neither closes Q3, neither ratifies PI-ADD-001, and neither authorizes implementation.**

**Nothing in this package is approved. C-1a remains unauthorized** and may be considered only after Q3 is resolved, `PI-ADD-001` is formally ratified, and the owner separately authorizes that work package.
