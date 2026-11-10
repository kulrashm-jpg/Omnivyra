# Journey retiming, out-of-office and reply suspension (SC-7 Q-4)

Prompt 4, Deliverable C. Status: implemented on `orch/c4-b-journey`, not committed. **SC-7 is unratified (SC7-R open):** no classifier output drives a journey anywhere.

## 1. Follow-up rules

| # | Rule | Where it holds |
|---|---|---|
| R1 | Every inbound reply suspends the next automated follow-up until a person evaluates it | sweeper step 3: an unclassified reply **pauses** the run (`needs_human` `reply_awaiting_evaluation:<fingerprint>`), before any engine is asked |
| R2 | An out-of-office never ends a journey, and never produces an outcome, suppression, unsubscribe, complaint or channel switch | the suspension ends nothing; the retiming engine's `effects` are all null or false for `out_of_office` |
| R3 | With a reliable return date, the follow-up waits until the first permitted moment at or after (return date + delay), never before now | `decideFollowUpRetiming`, persisted as `execution_plan_steps.not_before` |
| R4 | No date, or an ambiguous one: hold for a person and never invent a date | `hold_for_human`; the run stays paused |
| R5 | `follow_up` ("contact me later") retimes the same way and records `replied` | `effects.outcome = 'replied'` (applied only once SC7-R wires it) |
| R6 | Pause, kill switch, and finished or terminated runs win | `no_change` (`run_paused`, `controls_refuse`, `run_finished`, `step_settled`) |
| R7 | Duplicates and repeated scheduler runs never create a second action | one `actionKey` per step; `duplicate_signal` / `older_than_prior` |
| R8 | Out-of-order signals are safe: a later answer keeps its own consequence | `superseded_by_consequence` |

### The deterministic consequences (owner decisions 2026-11-05)

**Unclassified reply.** A non-STOP inbound WhatsApp message, or a recorded WS-3 `replied`, **suspends** the run. This used to end it; it is the behaviour change for Outreach review.

**Complaint (Q-C1)** ends the run, including a **paused** run. It is read three ways, directly from the stores and never through `readJourneyEvents`:

- the canonical `contact_governance_records` `complaint`;
- the complaint-inferred `outreach_delivery_evidence` row (Agent A's `journeyEvents.isComplaintInferredEvidence`, resolved at runtime so the two rules cannot diverge; an interim local copy is used until A's export is merged; it fails toward a complaint);
- a future `complained` outcome row.

**Revocation (RV-1)** pauses the run (see Deliverable B).

**Unchanged:**

- a WhatsApp STOP, or a canonical `unsubscribe` restriction, ends the run as `unsubscribed`;
- operator-recorded `rejected`, `unsubscribed`, `converted` or `meeting_booked` end the run;
- a PI closed state ends the run.

### Governance precedence (the Outreach sign-off condition)

- Restrictions are **read first:** a complaint or an unsubscribe on the person ends the run before any reply is considered, so a reply can never turn an opt-out into a pause. The read order is pinned by a unit test.
- Restrictions are **written at ingestion**, independently of the journey:
  - the Meta webhook processor records a STOP before it persists the message, and there is no classifier on that path;
  - SES writes the restriction whether or not the evidence write succeeds.
- A paused or suspended run **independently fails governance** when anything tries to send, so termination is never the only protection (tests D-1, C-2, G-1).

## 2. Out-of-office classification (unratified)

`backend/services/engagementClassification/` (vocabulary `sc7-draft-1`) has `out_of_office` and `follow_up`. Nothing at runtime imports the retiming engine except the operator resume route, and the engine does not import the classifier; guard tests prove both. When SC7-R is ratified, the classifier will supply the `RetimingSignal`. Until then a **person** supplies the date (section 6).

## 3. Return-date handling

- **Structured input only.** `{ kind: 'date', date: 'YYYY-MM-DD' }` or `{ kind: 'instant', at: <ISO with offset> }`. No free text is parsed.
- **Validation:**
  - not a real calendar date, free text, or an instant without an offset → `invalid_return_date`;
  - at or before now (for a date: its whole day has passed) → `return_date_in_past`;
  - more than 366 days ahead → `return_date_too_far`.
- **A date-only return date** is midnight in the person's timezone, else the journey window's, else the tenant's (`company_scheduler_prefs.timezone`). With no valid zone it is refused; the date is never read as UTC by default.
- **Computation:** `max(return + delay, now)`, moved to the first moment the journey's `policy.execution_window` permits (weekdays and hours), judged exactly as the sweeper's own `isWithinExecutionWindow` judges it. The search walks a 15-minute UTC grid for up to 14 days; this is exact because every real UTC offset is a multiple of 15 minutes. A window that permits nothing in that time is held for a person.

## 4. Timezone

The person's `unified_persons.timezone` comes first, then the window's IANA zone, then the tenant's. DST is handled by computing offsets at the instant. Tests cover New York spring-forward, London fall-back, Kolkata (+5:30), Tokyo as a person zone, and two tenant zones.

## 5. State transitions

```
active ──unclassified reply──▶ paused (needs_human reply_awaiting_evaluation:<fp>)
active ──revoked approval────▶ paused (needs_human approval_revoked:<fp>)
active ──restriction / complaint / STOP / deterministic outcome / PI closed──▶ cancelled (exited)
paused ──complaint───────────▶ cancelled (exited complained)     [paused pass]
paused ──PATCH active────────▶ active   (the evaluated reply or revocation never re-suspends; a later one does)
paused ──PATCH active + returnDate──▶ not_before on the next step, then active
paused ──PATCH cancelled─────▶ cancelled (unsent tasks withdrawn)
```

**`not_before` (migration `20270127000000_execution_step_not_before.sql`, rollback `rollbacks/execution_step_not_before_rollback.sql`):**

- nullable; `advance_execution_plan` does not make a pending step ready before it, and the sweeper defers a ready step (`deferred` `not_before`);
- the database guard refuses a value that lowers or clears the floor, a past value, a settled or running step, and an insert carrying one. The application writer `deferStepUntil` applies greatest(): an earlier value leaves the floor as it is;
- governance, quiet hours (the window), the frequency policy and quotas still apply at dispatch;
- no grant, policy or RLS change; the test compares them through apply, rollback and reapply;
- **human-supplied only:** the single writer is `deferStepUntil`, called only by the resume, as a guard test proves.

## 6. Human-review fallback

`PATCH /api/execution-instances/:id { lifecycleState: 'active', returnDate }` uses the same tenant guards as before.

1. Only a **paused** run qualifies; any other state gets 409 `not_paused`.
2. The date is validated server-side; a failure gets 400 and the run stays paused.
3. The date goes through `decideFollowUpRetiming`. The reply the person evaluated does not supersede it; any other recorded answer does (409 `superseded`, run stays paused).
4. `not_before` is persisted **first**, and then the run is made active.

Without a `returnDate` the route resumes exactly as before.

## 7. Tests

| File | Tests |
|---|---|
| `backend/tests/unit/q4FollowUpRetiming.test.ts` | 46 + 2 guards: every rule, timezone and DST, window, duplicates, out-of-order, the one runtime importer, the single not_before writer |
| `backend/tests/unit/orchestrationJourneyCompletion.test.ts` | exit vs suspend vs continue |
| `backend/tests/unit/p4GovernancePrecedence.test.ts` | read order, restriction precedence, complaint sources, interim predicate, A's helper preferred, RV-1 detection |
| `backend/tests/realschema/q4_retiming_inputs.test.ts` | the read seam, read-only |
| `backend/tests/realschema/p4_reply_suspension.test.ts` | suspension, resume / end through the route, STOP and deterministic answers still exit |
| `backend/tests/realschema/p4_governance_precedence.test.ts` | G-1, Q-C1, C-2, D-1, D-2, RV-1, the migration, not_before guards and clock, the resume with a date |
| `backend/tests/realschema/p4_governance_whatsapp.test.ts` | C-1 (STOP with a throwing classifier double, a failed message write, a failed termination), G-1 and D-2 on WhatsApp |
| Re-pinned real-schema suites | 9 tests across `orch_contract_journey`, `orch_engines_real`, `orch_journey_lifecycle`, `orch_response_matrix` (reply → suspend) |

## 8. Existing infrastructure reused

- **Run state and its route:** `execution_instances.lifecycle_state`, `setExecutionInstanceState`, and `PATCH /api/execution-instances/:id`.
- **Clock and sweeper:** `advance_execution_plan` (the only clock, extended by one floor), the sweeper, and `execution_journey_decisions`.
- **Holds and governance:** the D-03 hold, `contact_governance_records` with its loader, and `channelRefusal`.
- **Time and timezone:** `policy.execution_window` with `isWithinExecutionWindow`, `company_scheduler_prefs.timezone`, and `unified_persons.timezone`.

No new scheduler, event store, approval store or status registry was created.
