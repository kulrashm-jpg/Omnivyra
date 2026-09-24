# PI-ADR-002 — The governed reassessment seam

**Status:** ACCEPTED, 2026-09-23. Decided by the programme owner.
**Supersedes:** the one-way-wall clause of the WS-3 feedback contract only. Everything else in `PI-ADR-001.md` stands.
**Base SHA at decision:** `a07477e4`

---

## 1. What was frozen, and why

`backend/services/leadOutreachExecution/feedbackIngestion.ts` states it plainly, and guard tests enforce it:

> *"Business outcomes NEVER move the lifecycle. A reply does not complete a task and a rejection does not cancel one… Feedback observes; it does not decide."*

It returns `stateAdvanced: false` with `stateRefusal: 'business outcomes are observational and do not drive lifecycle state'`. No outreach table appears in the scoring fingerprint (`leadIntelligenceOrchestration/fingerprint.ts:49-56`). No activation reason references an outcome (`leadIntelligenceActivation.ts:87-91`).

**That wall was correct for what it was protecting.** It prevented an outcome from silently mutating a task's lifecycle or a tenant's scoring policy — two things that must never happen without a human. It was never argued that outcomes are not *evidence*; it was argued that they are not *decisions*. The wall enforced both, because at the time nothing needed the first.

## 2. Why it must now change

The target product requires the system to answer *"what should happen next"* continuously, not once. Concretely it requires: reassessment after any meaningful event, no-response intelligence, response interpretation, nurture, reactivation, post-meeting outcome return, and a prospect lifecycle. Every one of those is a function of what happened after the first touch.

Under the current contract a prospect who replied, booked a meeting, converted, or ignored five emails is — to the intelligence layer — **indistinguishable from one who was never contacted**. The context is unchanged, the fingerprint is unchanged, the NBA is unchanged, the readiness verdict is unchanged. That is not a gap in coverage; it is the system being unable to hold the product's central question.

Per the programme's own rule, architecture is preserved *unless it cannot satisfy the target product requirements*. This is that case.

## 3. The decision

**Outcomes become a first-class EVIDENCE input to the prospect intelligence context and to the fingerprint that governs re-derivation. They do not become decisions.**

```
OUTCOME ──► evidence ──► context ──► fingerprint ──► re-derive ──► new NBA
                                                          │
              ratified policy ◄── human ratify ◄── proposal
```

### 3.1 What changes

1. `prospectContext` gains outreach evidence: attempts, outcomes, channel history, time since last attempt, attempt counts. It is evidence, carrying source, `observed_at` and confidence, exactly as engagement evidence does.
2. The re-derivation fingerprint includes that evidence, so a new outcome makes the prospect's intelligence stale and it is recomputed.
3. A **prospect lifecycle state** is introduced, with an explicit transition table, derived from evidence and recorded with the evidence that caused each transition.
4. The `no_response` derivation rule — documented in four places and implemented in none — is implemented, as a derived outcome carrying `derived: true`.
5. Outcome interpretation maps the eight-value outcome vocabulary onto lifecycle transitions and next actions.

### 3.2 What does not change — these remain frozen

1. **PI never sends.** No message composition, no dispatch, no scheduling, no retry in PI. Outreach Automation executes.
2. **Learning proposes only.** An outcome may never mutate a ratified ICP, a scoring weight, or any policy. It may produce an unratified proposal. Ratification stays human and stays enforced at route, service and database CHECK.
3. **No outcome moves a TASK's lifecycle.** The per-task state machine in `leadOutreachExecution` keeps its current contract; `stateAdvanced: false` for business signals is retained. The new lifecycle is a **prospect** concept and is a different object.
4. **Suppression still overrides everything.** A reassessment may never produce a recommendation for a suppressed person. `mayContact` remains the sole evaluator and still fails closed.
5. **Absence still abstains.** A prospect with no outcomes is unmeasured, not cold. No inactivity penalty is introduced. `feedbackSummary`'s refusal to grade stands.
6. **Append-only outcomes.** Dual idempotency keys, `derived` flag, unobservable-vs-zero distinction all retained.

### 3.3 The narrowed wall, stated precisely

> An outcome may change **what the platform knows** about a prospect, and therefore what it recommends.
> An outcome may never change **what the platform is permitted to do**, or what any policy says.

The first is evidence. The second is governance. The original contract conflated them because nothing yet needed the distinction.

## 4. Consequences

- `feedbackIngestion.ts`'s header and its guard tests must be amended, not deleted: the guard that no business signal advances a *task* state stays; the guard that nothing in the intelligence layer imports the ledger is replaced by a narrower one — the intelligence layer may **read** the ledger and may never **write** it.
- A prospect lifecycle state machine becomes a new canonical concept. It does not replace `outreach_tasks.status`, `operational_states`, `journeyState`, `FunnelStage` or `active_leads.bucket`, and it must not be conflated with any of them. `canonical_leads.lead_status` is free text with no vocabulary and is written `null` by PI today; whether the new state lands there or in a new column is an implementation decision for WS-E, but it may not silently adopt the CRM-mirrored values that `crmIngestionService` writes.
- Reassessment must be bounded. A re-derivation triggered by every outcome on a high-volume tenant is a cost and a stampede risk; WS-E owns the debounce and must state it.
- Every lifecycle transition must cite the evidence that caused it, per the existing explainability discipline.

## 5. What this ADR does not decide

- The lifecycle vocabulary itself — WS-E, contract-first.
- The debounce/trigger policy — WS-E.
- Contact-frequency and fatigue policy — still `POLICY-3`, still open, still product + compliance.
- Whether an engagement signal deserves a prospect, a candidate, or nothing — still `POLICY-2`.
- The unsubscribe scope and anchor — still `POLICY-1`.

## 6. No-code confirmation

This document changes no code, schema, migration, flag or provider. It authorises WS-E to begin contract work; it implements nothing.
