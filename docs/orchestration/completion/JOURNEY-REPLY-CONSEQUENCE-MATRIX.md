# Journey reply consequence matrix (Orchestration Prompt 5)

Status: LOCAL, on `orch/c5-int` over `d11f08888`. **The classifier matrix is built and tested but switched OFF** (SC7-R unratified). In production code today, every inbound reply suspends the run for a person. The live part is the person's evaluation (§3).

## 1. `replyConsequence(input)` — pure and deterministic
Module: `backend/services/orchestration/replyConsequence.ts`. Output: `{ consequence: suspend | continue | retime | exit | route_to_human, reason, policy, businessOutcome, humanAction, endedBy }`.

Precedence, first match wins:
1. **A complaint restriction** → exit (`complained`). **An unsubscribe restriction** → exit (`unsubscribed`). Both are `endedBy: governance`, and a test pins them equal to `RESTRICTION_EXITS`.
2. **Any other restriction** → suspend. This covers dnc_permanent, consent_withdrawn, dnc_channel, bounce_hard, invalid_contact, campaign_exclusion, deferred, or an unrecognised one.
3. **A refusing control** (kill switch, tenant or channel off) → suspend.
4. Only then the signal itself:

| Signal | Consequence | businessOutcome | Human action |
|---|---|---|---|
| positive_interest, enquiry, information_request, pricing, objection | route_to_human | replied | sales_follow_up |
| meeting_request | route_to_human | replied (never `meeting_booked`) | sales_follow_up |
| not_interested | route_to_human | replied (never `rejected`) | decline_review |
| support_request | route_to_human | replied | support |
| follow_up | retime | replied | – |
| out_of_office | retime | null | – |
| wrong_recipient | route_to_human | null | contact_point_review |
| stop, unsubscribe, complaint (as labels only) | route_to_human | null | governance_review |
| governance class found by the detector (complaint > stop > unsubscribe) | route_to_human (`sc7.governance_detected.*`) | null | governance_review |
| spam_suspicious, ambiguous, unknown code | suspend | null | – |
| delivery, soft_bounce | continue | null | – |
| hard_bounce | route_to_human | null | contact_point_review |
| reject | route_to_human | null | delivery_review |
| unmapped operational event | suspend | null | – |
| abstention (any reason) | suspend (R1) | null | – |

With several labels, the most restrictive one decides.

**Invariants, tested over every input combination:**
- no classifier label ever exits a journey, or continues past a restriction;
- only governance exits;
- `businessOutcome` is only ever `replied` or null;
- the result is deterministic.

These follow the PI rulings: a negative is never `rejected`; a meeting request is `replied`; out-of-office, bounce and complaint are not business outcomes.

## 2. Classifier wiring (OFF)
- **Flag:** `ORCHESTRATION_REPLY_CLASSIFICATION_ENABLED` turns it on only when it is exactly `true`. It defaults off, no source file sets it, and turning it on requires SC7-R first (a code comment says so).
- **Adapter:** `classifyReplyConsequence`. While the flag is off it returns the R1 suspension without calling the classifier. When on, it calls the deterministic `classifyMessage` with one argument and returns codes only.
- **What the adapter never does:** no injected classifier, no AI Gateway call (Q-3 open), no fetch, no database access, no logger, and no text in its result.
- **Guard test** (`replyClassificationGuard.test.ts`):
  - the sweeper, the journey modules, the engines and the run route never name the flag, the adapter or the matrix;
  - with the flag on, no sample text exits or continues a journey;
  - STOP, unsubscribe and complaint text routes to a person;
  - a recorded complaint or unsubscribe exits by governance.
- **AI classification design (not built):** it would go through the AI Gateway (`runCompletionWithOperation`, an entry in `NO_CACHE_OPS`, untrusted text delimited), and its output would enter this same matrix as a label. A label can never end a journey. Owner decision Q-3.

## 3. A person's evaluation (live)
`PATCH /api/execution-instances/:id` with `{ company_id, evaluation: 'continue' | 'retime' | 'end', returnDate? }`. It is valid only on a run paused for an unevaluated reply (`reply_awaiting_evaluation`).

| Action | Effect | Decision recorded (`recordPersonDecision`) |
|---|---|---|
| continue | compare-and-set paused → active | `waiting`, outcome `reply_evaluated:continue:<key>` |
| retime | `resumeJourneyWithReturnDate` (Prompt 4 floor) | `deferred`, outcome `reply_evaluated:retime:<key>` |
| end | `exitJourney` | `exited`, outcome `cancelled_by_person` |

- The reasons carry `actor:<uuid>` from `guard.principal.userId`, never from the request body, plus `evaluation:<action>` and `reply:<fingerprint>`.
- **400:** `evaluation_with_lifecycle_state`, `invalid_action`, `return_date_required`, `return_date_not_allowed`, plus the retiming date refusals.
- **404:** `run_not_found`.
- **409:** `not_paused`, `not_awaiting_evaluation`, `resume_race_lost`, `superseded`.
- Nothing reaches PI (PI ruling P-1 = a). A human-confirmed engagement would need a human-origin transition with `actorUserId` and a `human:<uuid>` key, which is an owner decision.

## 4. O2-F1: every resume moves a run only from `paused`
- **The defect:** a plain resume landing between the retimed resume's paused check and its floor write made the run active before the floor existed, so a dispatch could send early.
- **The fix:** `compareAndSetExecutionInstanceState`, a single UPDATE with `lifecycle_state = expected` in the WHERE clause. Both the plain PATCH resume and `resumeJourneyWithReturnDate` use it, and the loser gets 409 `resume_race_lost`.
- **Proof:** the race tests (unit and real PostgreSQL) fail on the base, where both resumes "won" and the run was sendable before the floor, and pass on the fix.

**Residual effects (documented, not built):**
- A losing retimed resume leaves its floor in place. That can only delay a send. Writing floor and state as one transaction needs an RPC migration.
- An ABA case (paused → active → paused between the check and the compare-and-set) would need a version column.
- The evaluation decision kinds reuse the existing CHECK values. A dedicated `evaluated` kind needs a migration.

## 5. Open for the owner
- SC7-R (Q-1, Q-2, Q-3, Q-5).
- Should dnc_permanent and consent_withdrawn **end** a run instead of suspending it? Today only a complaint or unsubscribe ends one, which is the Prompt 4 rule.
- Soft bounce continues the run until Outreach's G-8 retry policy exists.
