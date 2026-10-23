# PI-Q1-Q2-OWNER-DECISIONS-001 — confirmed owner decisions for Q1 and Q2

**DOCUMENTATION-ONLY.** No implementation, no migration, no database write, no production access, no provider call, no feature-flag change, no commit, push, merge or deployment, no modification of `C:/virality`. **No existing report, addendum, ratified manifest, execution ledger, application code, test, schema or migration was edited.** One new file: this record.

**The four approved policy directions recorded here do not authorize implementation. C-1a remains unauthorized.**

---

## 1. Verified repository and worktree baseline

Measured at **2026-10-17T18:45:22+05:30 (IST)**. The previously reported baseline was **not assumed**.

| | Expected | **Actual** | Result |
|---|---|---|---|
| Repository | `C:/tmp/r1-ctx` | `C:/tmp/r1-ctx` | **MATCH** |
| Branch | `fix/r1-profile-context` | `fix/r1-profile-context` | **MATCH** |
| HEAD | `29fea38a…81415774` | `29fea38a2d1642c1c2fd957e5151f6be81415774` | **MATCH** |
| Worktree | — | **134 entries (67 M / 67 ??), 0 staged** | unchanged from the audit close |
| Target file pre-existing? | must not exist | **ABSENT** | safe to create; **nothing overwritten** |

## 2. Audit source

| | |
|---|---|
| Path | `docs/pmo/prospect-intelligence/PI-Q1-Q2-AUDIT-001.md` |
| Expected SHA-256 | `899781f20bd30fa558601cbf00469e02c1f41df20d96055fa04c78b1622b4683` |
| **Actual SHA-256** | `899781f20bd30fa558601cbf00469e02c1f41df20d96055fa04c78b1622b4683` — **MATCH** |
| Expected line count | 336 |
| **Actual line count** | **336** — **MATCH** |

§4 of that audit is the source of truth for the decision rows below. Cited source files were re-inspected directly for this record (§5.1, §5.4).

---

## 3. The four confirmed owner decisions

### 3.1 Q1-1 — Lifecycle vocabulary ownership · **OWNER-APPROVED**

> Use the existing nine-state opportunity lifecycle vocabulary as authoritative for opportunity lifecycle and terminality. Do not introduce a parallel terminality vocabulary or reuse the disposition enum as a deletion-resolution vocabulary without separate justification and approval.

**Rationale and source evidence.** The nine states are defined identically in two independent places and the transition allowlist is enforced at write time:

- Schema: `supabase/migrations/20260520_phase6_realtime_lifecycle_workflow.sql` — `CHECK (state IN ('detected','triaged','reviewing','qualified','monitoring','outreach_planned','converted','dismissed','archived'))`, plus a matching CHECK on `previous_state`.
- Code: `backend/types/opportunityLifecycle.ts:1-11` — `LIFECYCLE_STATES` as a nine-member `as const` tuple; `isLifecycleState()` at `:46-49` is the runtime guard.
- Enforcement: `ALLOWED_LIFECYCLE_TRANSITIONS` (`:36-46`) and `canTransitionLifecycle()` (`:57-67`), applied by `transitionLifecycle()` (`backend/services/opportunityLifecycleService.ts:125-156`), which resolves the current state, consults the allowlist, throws `LifecycleTransitionError` on refusal, and only then appends a history row.

**Consequence recorded:** the six-state vocabulary previously proposed in `OMNIVYRA-PI-OPPORTUNITY-SPINE-DESIGN-001.md` §3.3 and carried into `PI-ADD-001` FR-A6 (`open`, `qualified`, `disqualified`, `acted`, `closed`, `superseded`) is **superseded by this decision**. Five of its six values do not exist in the authoritative model, and `acted` exists nowhere in schema or code. **`PI-ADD-001` is not edited by this record**; the correction is carried as a required change for its future v0.2 (§6.3 of `PI-C1-OWNER-DECISIONS-002`).

### 3.2 Q1-4 — Converted opportunities · **OWNER-APPROVED**

> An opportunity in `converted` does not independently qualify as terminal for ordinary account-deletion eligibility. It must transition to `archived` through the existing validated and audited lifecycle mechanism before it qualifies as resolved.

**Rationale and source evidence.**

- **Structural:** `converted` is **not absorbing** — `converted: ['archived']` (`opportunityLifecycle.ts:43`). The model itself does not treat it as an end state.
- **The module comment is self-contradictory** on this point, calling `converted` and `archived` "terminal" (`:28-34`) while the allowlist gives `converted` an outgoing edge. This decision resolves that contradiction in favour of the allowlist.
- **Obligations:** conversion is a commercial outcome, and `outreach_outcomes` is a separate live store with two write paths, so an outcome can arrive after conversion.
- **Cost:** one already-legal transition. `archived` is reachable from `converted` directly.

No additional lifecycle state is invented, and the allowed-transition mechanism is not bypassed.

### 3.3 Q1-6 — Undefined state semantics · **OWNER-APPROVED**

> Document the business meanings of `triaged`, `reviewing`, and `monitoring` as requirements-clarification items. Do not invent their meanings.
>
> These documentation gaps do not invalidate the terminality decision: `archived` is the sole terminal state for ordinary account-deletion eligibility; every other state, including unknown or future states, fails closed as non-terminal.

**Rationale and source evidence.** `ALLOWED_LIFECYCLE_TRANSITIONS` defines the *transitions* for these three states but the codebase defines **no semantics** for them. Their meanings are therefore recorded as requirements-clarification items and are **not invented here**.

**Machine-verified terminality basis.** Every state's outgoing-transition count was computed directly from `ALLOWED_LIFECYCLE_TRANSITIONS` during this task:

| State | Outgoing transitions |
|---|---|
| `detected` | 3 |
| `triaged` | 4 |
| `reviewing` | 4 |
| `qualified` | 5 |
| `monitoring` | 5 |
| `outreach_planned` | 4 |
| `converted` | 1 |
| `dismissed` | 2 |
| **`archived`** | **0 — the sole absorbing state** |

### 3.4 Q2-3 — Authorization · **OWNER-APPROVED**

> Adopt capability-based authorization and step-up as the baseline for future bulk opportunity resolution. This is an explicit security upgrade from the existing lifecycle route's legacy role check, not a claim that the current route already enforces these controls.
>
> Denied attempts must be audited without leaking cross-tenant information.

**Rationale and source evidence.**

- **What exists today, stated as the upgrade's starting point and not as a claim of compliance:** `pages/api/active-leads/lifecycle.ts` authorizes inside the handler via `getUserRole(ctx.userId, companyId)` at `:59`, returning `403 FORBIDDEN_ROLE` at `:60` with a further role check at `:62`. It uses **no** `requireCapability`, **no** step-up, and **no** `withIdempotency`. `opportunityLifecycleService.ts:122-123` states plainly that *"Caller (API) is responsible for RBAC checks."* **Denied lifecycle transitions are therefore not audited today.**
- **Primitives available for the upgrade:** `requireCapability(req, res, {capability, organizationId, resourceId})` — `backend/security/requireCapability.ts:81`; `StepUpRequirement` / `evaluateStepUp` / `STEP_UP_REQUIRED` → 401 — `backend/security/AuthorizationService.ts:248-277`, `:307`; audited denial via `logSecurityEvent` → `capability_audit_log` — `requireCapability.ts:144`, which already audits unauthenticated attempts at `:89-95`.
- **Non-leaking refusal** is an existing programme rule: refusal text must carry no `need_statement` or attribute value, because such text can contain personal data and refusals travel into logs.

---

## 4. What the approval text additionally settles — flagged as a reading, open to correction

Two of the four approvals contain wording that, read plainly, also settles audit rows not listed by number in the brief. Recorded explicitly so the owner can narrow it if a narrower scope was intended.

| Audit row | Settled by | Resulting status |
|---|---|---|
| **Q1-2** — terminal set for ordinary account deletion | **Q1-6** text: *"`archived` is the sole terminal state for ordinary account-deletion eligibility"* | **OWNER-APPROVED: terminal set = `{ archived }`** |
| **Q1-3** — is `dismissed` terminal? | **Q1-6** text, by direct consequence: `dismissed` is not `archived`, therefore non-terminal | **OWNER-APPROVED: NO** |
| **Q1-5** — unknown or unrecognised state | **Q1-6** text: *"every other state, including unknown or future states, fails closed as non-terminal"* | **OWNER-APPROVED: non-terminal, fail closed** |
| Reuse of the disposition enum as a deletion-resolution vocabulary | **Q1-1** text: *"Do not … reuse the disposition enum as a deletion-resolution vocabulary without separate justification and approval"* | **OWNER-APPROVED: prohibited absent separate justification and approval** |

**If the owner intended Q1-2, Q1-3 or Q1-5 to remain open, this section should be corrected.** The audit's own status for those rows was EVIDENCE-SUPPORTED/RECOMMENDED, not approved; they are elevated here solely by the quoted decision text, not by the audit's recommendation.

---

## 5. Disposition of all remaining Q1 and Q2 items

Audit identifiers are preserved exactly. Status vocabulary as instructed: **OWNER-APPROVED** · **EVIDENCE-SUPPORTED** · **RECOMMENDED** · **OPEN** · **BLOCKED / UNVERIFIED**.

### 5.1 Q1 rows

| ID | Decision | Status | Basis |
|---|---|---|---|
| **Q1-1** | Vocabulary ownership — use the existing nine states | **OWNER-APPROVED** | §3.1 |
| **Q1-2** | Terminal set = `{ archived }` | **OWNER-APPROVED** (via Q1-6 text — §4) | machine-verified: exactly one absorbing state |
| **Q1-3** | `dismissed` is **not** terminal | **OWNER-APPROVED** (via Q1-6 text — §4) | `dismissed: ['triaged','archived']` (`opportunityLifecycle.ts:44`); module comment: *"`dismissed` can be reopened to `triaged` to handle accidental dismissal"* |
| **Q1-4** | `converted` must be archived first | **OWNER-APPROVED** | §3.2 |
| **Q1-5** | Unknown state is non-terminal, fail closed | **OWNER-APPROVED** (via Q1-6 text — §4) | no terminality concept exists in code, so a default had to be chosen deliberately |
| **Q1-6** | Document `triaged` / `reviewing` / `monitoring` semantics | **OWNER-APPROVED** as a requirements-clarification item; the **content** of those definitions is **OPEN** and is not invented here | §3.3 |

### 5.2 Q2 rows

| ID | Decision | Status | Basis |
|---|---|---|---|
| **Q2-1** | Is bulk resolution permitted? | **OPEN** — **not approved.** Q2-3 approves the *authorization model* for "future bulk opportunity resolution"; it does not authorize the operation itself, and the brief forbids inferring approval for bulk-operation scope | audit §3.5 recommended YES; precedent exists (`pages/api/engagement/thread/bulk-ai-reply.ts:98-115` returns `{sent, skipped, errors, outcomes}`) |
| **Q2-2** | Independent per-item validation | **EVIDENCE-SUPPORTED** engineering requirement, conditional on Q2-1 | WP-6's verified rule that one bad record fails that record and no other |
| **Q2-3** | Capability-based authorization + step-up as the baseline | **OWNER-APPROVED** | §3.4 |
| **Q2-4** | Is a controlled reason code required? | **OPEN** — the brief explicitly forbids inferring approval for reason-code requirements. **Constrained**, however, by §6 items 5 and 6: no new enum, and no repurposing of the disposition enum | audit §3.3, §3.4 |
| **Q2-5** | Free-text explanation optional or mandatory? | **OPEN** as a formal decision; the **behaviour to preserve** is EVIDENCE-SUPPORTED (§6 item 7) | `opportunity_lifecycle_states.reasoning` is nullable; `prospect_list_members.removal_reason` is nullable by explicit design |
| **Q2-6** | Partial success: per-item outcomes, batch resolves, each item's write atomic | **EVIDENCE-SUPPORTED**, conditional on Q2-1 | bulk precedent above; canonical-write atomicity precedent |
| **Q2-7** | Retries: already-archived reported as already-resolved, not a failure | **EVIDENCE-SUPPORTED** (§6 item 4) | machine-verified: `canTransitionLifecycle` returns `{allowed:false, reason:'no_op_same_state'}` at `opportunityLifecycle.ts:61`, and `transitionLifecycle` **throws** at `opportunityLifecycleService.ts:136` |
| **Q2-8** | Audit evidence: append-only `opportunity_lifecycle_states` + `capability_audit_log` for every authorization decision including denials | **EVIDENCE-SUPPORTED**; the denial-audit half becomes achievable **because of** Q2-3 | both sinks exist; denials are unaudited on the current route (§3.4) |
| **Q2-9** | Negative controls | **RECOMMENDED** | §7.2 below |

### 5.3 Explicitly not inferred

No owner approval is recorded for: bulk-operation scope (Q2-1), reason-code requirements (Q2-4), free-text mandatoriness (Q2-5), the content of the three state definitions, commercial or compliance handling beyond Q1-4's stated terms, or any unrelated decision.

### 5.4 The seven engineering requirements named in the brief — each verified or marked

Verified against the audit **and** re-inspected in current source during this task.

| # | Requirement as stated | Status | Verification |
|---|---|---|---|
| 1 | `archived` is the sole absorbing state in the current state machine | **EVIDENCE-SUPPORTED — machine-verified** | outgoing-transition counts computed from `ALLOWED_LIFECYCLE_TRANSITIONS`: exactly one state has zero (§3.3 table) |
| 2 | Unknown lifecycle states must not qualify as terminal | **OWNER-APPROVED** (Q1-6 text) — *and the premise is verified* | no terminality concept exists in code: `grep -ni 'terminal'` across `opportunityLifecycle.ts` and `opportunityLifecycleService.ts` matches **only a doc comment**, never a constant, type or check. The requirement is therefore a policy choice, now approved, not a description of existing behaviour |
| 3 | Bulk resolution, if implemented, needs per-item validation and explicit per-item outcomes | **EVIDENCE-SUPPORTED**, conditional on Q2-1 | `bulk-ai-reply.ts:98-115` per-item outcome precedent; WP-6 one-bad-record rule |
| 4 | A repeated request for an already-archived item should be represented as already resolved rather than a spurious invalid-transition failure | **EVIDENCE-SUPPORTED — machine-verified** | `opportunityLifecycle.ts:61` returns `no_op_same_state` with `allowed:false`; `opportunityLifecycleService.ts:136` throws on `!allowed`. `archived: []` also refuses any onward transition. So **without an explicit mapping a retry surfaces a spurious failure** — the requirement is necessary, not cosmetic |
| 5 | Do not introduce a new reason-code enum for C-1 | **EVIDENCE-SUPPORTED** | controlled reason *codes* appear in this repository only where the reason is a ratified rule (`source_assertions.applied_reason`, `canonical_attribute_decisions.reason` — four ratified apply reasons). For operator actions the pattern is a controlled decision enum plus an optional free-text reason |
| 6 | Do not repurpose the existing disposition enum for deletion-resolution reasons | **OWNER-APPROVED** (Q1-1 text, absent separate justification) **and EVIDENCE-SUPPORTED** | audit §3.4 value-by-value comparison: only three of seven values are plausible, and two — `low_priority`, `revisit_later` — assert the **opposite** of resolution |
| 7 | Preserve optional free-text explanation behaviour where the existing contract permits it; do not require placeholder text that could be mistaken for evidence | **EVIDENCE-SUPPORTED** | `20261127000000_pi_prospect_lists.sql:200-203`, quoted minimally: *"`removal_reason` is OPTIONAL, decided rather than left vague: a user removing someone from a list need not justify it, and requiring a reason would produce placeholder text that reads like evidence. When one IS given it is retained verbatim."* `opportunity_lifecycle_states.reasoning` is likewise nullable |

**No claim in this list is UNVERIFIED.** All seven are supported by the audit and by current source; items 1 and 4 were re-derived mechanically rather than quoted.

---

## 6. Acceptance criteria for future implementation

These follow from the approvals. They are **specifications, not authorization**, and no test was written.

### 6.1 Terminality (Q1-1, Q1-2, Q1-4, Q1-5, Q1-6)

| ID | Criterion |
|---|---|
| **AC-T1** | The terminal set is a single named constant containing exactly `archived`; a second spelling anywhere is a test failure |
| **AC-T2** | Ordinary account deletion is **refused atomically** while any referencing opportunity is in a non-terminal state; nothing is partially deleted |
| **AC-T3** | Ordinary account deletion **succeeds** once every referencing opportunity is `archived` |
| **AC-T4** | A `converted` opportunity **blocks** deletion until archived |
| **AC-T5** | A `dismissed` opportunity **blocks** deletion until archived |
| **AC-T6** | An **unrecognised** state blocks deletion (fail closed), proven by an out-of-vocabulary value where the schema permits one, or by a unit test of the predicate where it does not |
| **AC-T7** | The terminal set is derived from, or asserted equal to, the authoritative nine-state vocabulary — no parallel vocabulary is introduced |
| **AC-T8** | Refusal text names the condition and a blocking count, and contains **no** need statement or attribute value |

### 6.2 Authorization and audit (Q2-3)

| ID | Criterion |
|---|---|
| **AC-A1** | Every resolution action requires `requireCapability`; N items ⇒ N checks |
| **AC-A2** | Step-up is required and an unsatisfied step-up is denied with `STEP_UP_REQUIRED` |
| **AC-A3** | Every authorization decision, **including every denial**, writes one `capability_audit_log` event |
| **AC-A4** | A denial reveals **nothing** about another tenant's data — not row counts, not identifiers, not existence |
| **AC-A5** | Each transition appends exactly one `opportunity_lifecycle_states` row carrying `previous_state`, `reasoning`, `actor_user_id`, `transitioned_at` |

### 6.3 Resolution mechanics (conditional on Q2-1, which is OPEN)

| ID | Criterion |
|---|---|
| **AC-R1** | Resolution uses the existing enforced `transitionLifecycle` path; the allowlist is never bypassed |
| **AC-R2** | Each item returns an explicit outcome; the batch resolves rather than throwing |
| **AC-R3** | A repeat request for an already-`archived` item reports **already resolved**, not a failure, and appends **no** second history row |
| **AC-R4** | A cross-tenant item is **refused** with no partial write, and the refusal is audited |
| **AC-R5** | An illegal transition is refused by the allowlist, not by caller discipline |

### 6.4 Required negative controls

Each plants a defect in a **disposable database or test double only**, proves the stated criterion fails, then restores and re-asserts. A criterion with no negative control is not accepted as proven.

| ID | Control | Proves |
|---|---|---|
| **NC-1** | Add `converted` to the terminal set | **AC-T4 must fail** |
| **NC-2** | Add `dismissed` to the terminal set | **AC-T5 must fail** |
| **NC-3** | Make the terminal predicate default unknown states to terminal | **AC-T6 must fail** |
| **NC-4** | Grant blanket authority in place of the per-item check | **AC-A1 must fail** |
| **NC-5** | Remove the step-up requirement | **AC-A2 must fail** |
| **NC-6** | Suppress denial auditing | **AC-A3 must fail** |
| **NC-7** | Relax the transition allowlist | **AC-R5 must fail** |
| **NC-8** | Remove the `no_op_same_state` mapping | **AC-R3 must fail** — this is the control that proves requirement 4 in §5.4 is load-bearing |
| **NC-9** | Place a cross-tenant item in a batch | **AC-R4 must fail** if refusal is not enforced |
| **NC-10** | Detector hygiene: any repository scan must strip comments and handle string literals, so prose cannot satisfy it | a scan that matches a header comment proves nothing |

---

## 7. Remaining blockers

| Item | Status | Note |
|---|---|---|
| **Q3 — legal-erasure policy** | **BLOCKED** | **POLICY NOT LOCATED / APPROVAL UNVERIFIED.** `PI-CONTRACT-002-data-lifecycle.md` is on scope but its own header reads *"CONTRACT PREPARED — AWAITING POLICY DECISIONS"* and *"It invents no legal or compliance policy."* **No retention period, legal authority, surviving-record rule or erasure semantics is invented here.** Absence from this repository does not prove no policy exists elsewhere |
| **Q2-1** bulk-operation scope | **OPEN** | not approved; Q2-3 approves only the authorization model for a future operation |
| **Q2-4** reason-code requirement | **OPEN** | constrained by §5.4 items 5 and 6 |
| **Q2-5** free-text mandatoriness | **OPEN** | behaviour to preserve is evidence-supported |
| **Q1-6 content** | **OPEN** | the three definitions are not invented here |
| **Q4** high-risk action catalogue | **OPEN** | blocks the second-approver flow, not C-1 |
| **PI-ADD-001 ratification** | **OPEN** | **not ratified, not approved, not edited by this record.** Still carries the four corrections in `PI-C1-OWNER-DECISIONS-002` §6.3, of which Q1-1 now determines the FR-A6 correction |
| **OD-3 / OD-4 / OD-5** | **BLOCKED** | unchanged; block WP-4 and WP-5 |
| **D-C** | **OPEN** | blocks the bridge package |
| **D-E** | **OPEN** | blocks matching; traces to ratified FR-16 / FR-17 |
| **Company-event sources** | **NOT AUTHORIZED** | signal types and weights in code are code, not authorization |
| Production migration state of the PI migrations | **UNVERIFIED** | prohibited operation; operator read required |
| Production tenant isolation | **UNVERIFIED** | local only; the service role holds a row-level-security bypass and the application connects as that role |

**No approval is inferred for any item above.**

---

## 8. Schedule and time accountability

### 8.1 Frozen baselines — preserved, unchanged

| Item | Frozen | Source | Changed? |
|---|---|---|---|
| **Milestone A′** | **2026-11-25**, 28.5 human engineer-days | `PI-MILESTONE-A-EXECUTION-001.md` §3 / §3.1 | **NO** |
| **WP-7** | **2026-11-17**, 4.0 engineer-days | same, row WP-7 | **NO** |
| C-1 estimate | 8–12 engineer-days | gate §9.3 | **NO — not revised** |

No date, budget, estimate, scope or sequencing was changed. Agent wall-clock throughput is **not** substituted for the human engineer-day baseline.

### 8.2 This task

| | |
|---|---|
| **Actual start** | **2026-10-17T18:45:22+05:30 (IST)** |
| External waiting time before start | **1 h 01 min 55 s** (audit close 17:43:27 → 18:45:22) — **not** engineering effort |
| Original estimate | **0.25 engineer-days** (documentation-only record) |
| Active engineering effort consumed | **~5 minutes** |
| 75% threshold (0.1875 d) | **not approached** |
| Remaining estimate | 0 — complete at this record |
| Monitoring | **no continuous monitoring is claimed between reports**; every timestamp is a measured `date -Iseconds` |

### 8.3 OVERRUN RISK — REMAINS RAISED, unchanged

First identified **2026-10-17T16:33+05:30**; confidence **MEDIUM-HIGH**.

| | |
|---|---|
| Baseline at risk | **Milestone A′ — 2026-11-25**: +4 working days float at the low C-1 estimate, **ZERO** at the high estimate |
| Baseline not at risk | **WP-7 — 2026-11-17**: +6 to +10 working days float |
| Dominant driver | **Q3 decision latency** — a legal/compliance dependency, still **BLOCKED**, and out of scope for this task |
| Effect of these four approvals | **Favourable but not quantified.** Q1-1 removes the need to design a new vocabulary and Q2-3 fixes the authorization model, so design risk falls. **No estimate is revised and no float is claimed back** |
| Newly identified risk | **none** |
| Next review checkpoint | the earlier of a verified Q3 policy, or **Fri 2026-10-23** — the last date C-1 can start and retain any Milestone A′ float |

---

## 9. Final status

| | |
|---|---|
| **Q1** | **DECIDED.** Q1-1, Q1-4 and Q1-6 approved directly; Q1-2, Q1-3 and Q1-5 settled by the Q1-6 decision text (§4, open to correction). The **content** of the three state definitions remains OPEN |
| **Q2** | **PARTIALLY DECIDED.** Q2-3 approved. Q2-1, Q2-4 and Q2-5 remain **OPEN**. Q2-2, Q2-6, Q2-7 and Q2-8 stand as **EVIDENCE-SUPPORTED** engineering requirements; Q2-9 as **RECOMMENDED** |
| **Q3** | **BLOCKED** — policy not located, approval unverified. Untouched by this record |
| **PI-ADD-001** | **v0.1-PROPOSED — not ratified, not approved, not edited** |
| **Implementation authorization** | **NONE** |

### This record does not authorize implementation.

The four approved policy directions are **policy and planning directions only**. **C-1a — three tables, one migration, one rollback — remains unauthorized** and may be considered only after Q3 is resolved, `PI-ADD-001` is formally ratified, and the owner separately authorizes that work package.
