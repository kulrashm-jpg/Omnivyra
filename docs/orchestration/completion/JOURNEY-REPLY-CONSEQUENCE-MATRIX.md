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
`PATCH /api/execution-instances/:id` with `{ company_id, evaluation: 'continue' | 'retime' | 'end' | 'opt_out', returnDate? }`. It is valid only on a run paused for an unevaluated reply (`reply_awaiting_evaluation`).

**`opt_out`** was added after the owner's G-11 decision (2026-11-07, in the owner's words: "g11 no they shouldn't be contacted"). The final design is the opt-out hold and its company-admin review (`backend/services/orchestration/optOutReview.ts`, store `contact_opt_out_reviews`, migration `20270127000001`).

Owner rules (2026-11-07):
1. **Tenant only.** The hold and the decision belong to that `organization_id`; another tenant is unaffected.
2. **Every opt-out starts it:** a WhatsApp STOP, an email unsubscribe link, or an operator-recorded free-text `opt_out`.
3. **Immediate hold.** From that moment ALL channels are held for that contact in that tenant: the person, plus their known address and number.
4. **The tenant's OWN admin decides** whether contact is allowed again, and on which channels: COMPANY_ADMIN in that company, never the platform super-admin bypass, within 3 WORKING days (Mon–Fri, the company's timezone).
5. **No decision:** every medium stays closed. Closed is the default, so no job runs.
6. **After the window** an admin may still reopen.

Amendment (confirmed by the owner 2026-11-07: "after a STOP or unsubscribe, that channel stays closed for good; for given contact............yes, a new email unsubscribe closes email permanently and holds the other channels for admin review."): a STOP or an unsubscribe keeps THAT channel closed for good, and only the person undoes it through the existing opt-in paths; after an operator `opt_out` the admin may reopen any channel.

The evaluation, in this order:
- **1. The person.** `loadIndividualFacts` resolves the person; with no person the answer is 409 `person_unknown`.
- **2. Their address and number** are read through the intelligence port (`readPersonContacts`).
- **3. The `*` holds.** Each is an `unsubscribe` on every channel and every purpose, written through the canonical writer on the person, the CANONICAL address (`normalizeEmail`) and the CANONICAL number (`normalizePhone`). The source is `optout_review:reply_opt_out`; the source ref is `<run id>:<reply fingerprint>`, stored in `evidence.source_ref`.
- **4. The review** is opened with trigger `reply_opt_out`, anchored on the person. It locks no channel.
- **5. The run ends.** The decision is `exited`, outcome `unsubscribed`, with `governance:<id>` for each hold and `optout_review:<id>`.

If 2, 3 or 4 fails, the answer is 503 `governance_write_failed` and the run stays paused. A hold already written stays: that is fail-safe, and the retry adopts it and joins the review.

| Action | Effect | Decision recorded (`recordPersonDecision`) |
|---|---|---|
| continue | compare-and-set paused → active | `waiting`, outcome `reply_evaluated:continue:<key>` |
| retime | `resumeJourneyWithReturnDate` (Prompt 4 floor) | `deferred`, outcome `reply_evaluated:retime:<key>` |
| end | `exitJourney` | `exited`, outcome `cancelled_by_person` |
| opt_out | `*` holds on the person, address and number, then the admin review, then `exitJourney` | `exited`, outcome `unsubscribed` |

- The reasons carry `actor:<uuid>` from `guard.principal.userId`, never from the request body, plus `evaluation:<action>` and `reply:<fingerprint>`.
- **400:** `evaluation_with_lifecycle_state`, `invalid_action`, `return_date_required`, `return_date_not_allowed`, plus the retiming date refusals.
- **404:** `run_not_found`.
- **409:** `not_paused`, `not_awaiting_evaluation`, `resume_race_lost`, `superseded`, `person_unknown`.
- **503:** `governance_write_failed` (opt_out only; the run stays paused).
- Nothing reaches PI (PI ruling P-1 = a). A human-confirmed engagement would need a human-origin transition with `actorUserId` and a `human:<uuid>` key, which is an owner decision.

### 3a. The opt-out review (G-11)
- **Holds and adoption.** Every hold source starts with `optout_review:` (`reply_opt_out`, `whatsapp_stop` with the Meta message id as ref, `email_unsubscribe` with `attempt:<id>` as ref). `openOptOutReview` throws `invalid_hold_source` for any other source.
  - `writeOptOutHolds({ organizationId, personId?, email?, phone?, holdSource, sourceRef, evidence? })` writes the `*` holds, normalising `email` and `phone` itself. It takes no `targets` list.
  - The canonical key `uq_contact_governance_identity` has no source in it, so two opt-outs on one anchor share ONE hold row: the second caller gets the first's id as `already_present` and records it as pre-existing. Hence the F1/F2 rules in the decision below.
  - `findOptOutReviewBySourceRef({ organizationId, sourceRef })` returns the review carrying a trigger's ref, tenant first; with several, pending first, then the latest. Outreach skips its producer work only when it returns a DECIDED review. It is read as `organization_id` plus an in-service filter on `source_refs` (no GIN index): reviews are few per tenant. Revisit with a GIN index and `.contains` if a tenant reaches thousands.
  - A review ADOPTS only the named holds whose source and source ref are the caller's, and only an `unsubscribe` on `*` that is live in the same tenant.
  - Any other named id (a W1-C `*` unsubscribe, another review's hold, a `dnc_permanent`) is recorded as pre-existing and never revoked.
  - A named hold that is already revoked, or that belongs to another tenant, is refused (`hold_revoked` / `hold_not_found`).
- **Why `evidence.source_ref` and not `source_record_id`.** `source_record_id` is a uuid with a composite foreign key to `source_records`, so a message id or a run-and-reply key is refused by the database. Adoption accepts either place.
- **One pending review per anchor.** The anchor is the person, else the canonical target. The unique partial index `(organization_id, anchor_kind, anchor_value) WHERE state = 'pending'` enforces it.
  - A trigger while a review is pending JOINS it.
  - The loser of a concurrent insert (23505) re-reads and joins, and never throws.
  - A trigger after a decision opens a NEW review.
  - Joins and decisions move the row by compare-and-set on `revision`.
- **Locked channels.** `whatsapp_stop` locks whatsapp, `email_unsubscribe` locks email, `reply_opt_out` locks none. The STOP or unsubscribe record itself (`trigger_record_ids`) is never revoked.
- **The decision.** `GET /api/contact-optout-reviews?company_id=` lists the reviews, pending first, with `qualifyingDays`, `overdue` and `activityUnreadable` (see Due date and overdue); both admin GETs record the day's admin activity. `GET|POST /api/contact-optout-reviews/:id` reads one, or decides it with `{ reopenChannels, reason }`.
  - **Guard:** `enforceCompanyAccess`, then COMPANY_ADMIN in that company from `assertTenantAccess` with `noPlatformBypass` (a bypass grant is refused again). The actor is the authenticated principal.
  - **The order, so there is never a gap:**
    1. CLOSE FIRST. Every known channel that stays closed gets a channel-scoped `unsubscribe` on every anchor of the review: its own, its adopted holds' AND its pre-existing holds' (F2). The source is `manual:optout_review`, which is unprefixed and so never adoptable. A close from an earlier, lost attempt answers `already_present`, is recognised by its `evidence.review_id`, and stays the review's own.
    2. THEN REVOKE the adopted holds, plus this review's own earlier closes on a channel now reopened.
       - **F2:** a hold that another PENDING review adopted or found present is NOT revoked; it is reported as `heldByOtherReview`, in the response and the audit.
       - **Inherited:** a pre-existing hold that a now-DECIDED review adopted (and skipped for this one) is released by this review. A hold no review ever adopted (W1-C, `dnc_permanent`) never is.
    3. THEN the review is marked decided, with `decided_by`, `decided_at` and the reason.
    4. THEN RECONCILE (F1). The pending set is read AFRESH, after every revoke has committed; it is never batched with, or reused from, the read before the revokes (Outreach condition, pinned by a call-order test and a mutant). Any pending review that references a revoked hold (this one too, when its decision lost) gets a fresh `*` hold: same anchor, same source, same `evidence.source_ref`, appended to that review's adopted holds. A lost or raced decision therefore leaves nothing reopened (`reinstatedHoldIds`).
  - **Audit:** an `execution_audit` row (stage `suppression`; `cancelled` for a reopen, `suppressed` for keep-closed), carrying ids and channels but never an address.
  - **`reconcile_incomplete` (503, retryable, Outreach m1):** holds were revoked but one owed to another pending review could not yet be reinstated. The admin retries the decision; its reconcile restores the hold from `adoptedHoldIds`. The partly applied decision is audited as `optout_review_reconcile_incomplete`.
  - **Refusals:** 400 `channel_locked` (with the channels), `reason_required`, `unknown_channel`, `invalid_channels`; 403 `company_admin_required`; 404 `review_not_found`; 409 `decision_race_lost`; 503 `governance_write_failed`.
  - A decided review may be decided again (rule 6).
- **Due date and overdue (RULED, 2026-11-07).**
  - **The rule.** In the owner's words: "5 days a week and in that can't we check through session login if they logged in during those 5 days to meet our condition". The variant chosen was "Admin opened reviews". Asked whether anything beyond activity is needed: "No, activity is enough".
  - **What counts.** A weekday (Mon–Fri, in the company's timezone) counts toward the 3-day window ONLY if a COMPANY_ADMIN of that company opened the opt-out reviews that day, the list or one review. A day with no admin activity simply does not count. There is no holiday list.
  - **Why not login.** Login itself is not read: there is no per-day login history to read, and login code belongs to another track.
  - **Recording.** Each authorised admin GET of `/api/contact-optout-reviews` or `/api/contact-optout-reviews/:id` records the company's local day in `contact_opt_out_review_activity_days` (migration `20270127000002`). It inserts the day, or moves `last_seen_at` on the existing row.
    - The record holds organization, local date, first and last seen: no user id, nothing to erase.
    - A refused request (non-admin, another tenant, bypass) records nothing.
    - A recording failure is logged and never fails the GET.
  - **Overdue,** computed at listing time.
    - A qualifying day is a weekday strictly AFTER the opening's local date, that has an activity row, and that has ENDED; so the admin is not overdue the moment they open the list on day 3.
    - `overdue` = pending with `qualifyingDays` ≥ 3. The listing returns `qualifyingDays`, `overdue` and `activityUnreadable`.
    - If the activity record cannot be read, every ended weekday counts (weekdays only) and `activityUnreadable` is set. It never blocks a hold or a decision, since closed is the default.
  - **The stored `due_at`** is an ESTIMATE: the earliest possible deadline (the same local time 3 Mon–Fri days after the opening, as if an admin opened the reviews every day). Fri → Wed, Sat/Sun → Wed.
  - **Timezone (RULED, "time zone should be UTC if not set").** `company_scheduler_prefs.timezone`, else UTC, with `due_timezone_fallback` set. The owner's answer covered the first three questions together: "yes to first three and time zone should be UTC if not set".
  - **Days are counted in the review's stored zone,** while activity days are recorded in the company's zone at the time of viewing. If a company changes its timezone, a day near midnight could be attributed to an adjacent date; this is accepted for an informational window.
- **OPEN:**
  - (1) RULED (no longer open): holidays are replaced by admin activity days, and the timezone falls back to UTC; see "Due date and overdue".
  - (2) **Two reviews for one person.** A STOP from an unresolved number gives a target-anchored review, and an operator `opt_out` for the same person gives a person-anchored one, until identity resolution links them. This is safe, because closed wins.
  - (3) **wa_id vs stored phone:** a `+` prefix difference that `normalizePhone` keeps. Pre-existing.
  - (4) **RULED:** P-1's PI closure is withdrawn. A prospect touched by a holding review, or closed by an admin, is refused at enrolment on the Orchestration side (§3b).
  - (5) **Erasure.** A target anchor holds no person (CHECK `contact_opt_out_reviews_target_has_no_person`, PI F-2), so a person delete can never abort on this table. A target anchor's canonical value is KEPT (PI ruling; erasure policy KEEP list). A PERSON anchor is tombstoned by the table's own guard when the foreign key clears `person_id`: `anchor_value` becomes `'erased:' || <the review's own id>`, never the person's. The prefix can never equal a canonical target, and the per-row id keeps the pending unique index collision-free across erasures. The review keeps its state.
  - (5a) **Re-anchor at erasure: BUILT on our side (owner-approved; interface by PI; PI will call it from personErasure, in its own files).**
    - **The function.** `public.g11_reanchor_pending_opt_out_reviews(p_organization_id, p_person_id, p_targets jsonb)` RETURNS `(review_id, disposition, onto_review_id)` (migration `20270127000003`).
      - SECURITY DEFINER with `search_path` pinned; EXECUTE goes only to service_role.
      - Called BEFORE the person delete, with the person's CANONICAL targets `[{"channel":"email"|"phone"|"whatsapp","value":"…"}]`.
    - **What it moves.** Each PENDING person review of that person moves onto the FIRST applicable target, in the order email, phone, whatsapp (the first listed within a channel). Decided, tombstoned and merged rows are untouched.
      - `re_anchored`: the row becomes target-anchored, with person_id NULL.
      - `merged`: if a pending review already holds that target, the row JOINS it (triggers, locks, adopted and pre-existing holds, trigger records and source refs unioned; its revision bumped) and the person review becomes **`merged`**.
      - `no_target`: with no targets the row is left for the FK tombstone. A target is never invented.
    - **Failure.** It RAISES on any failure: a person outside the organization, malformed targets, or a source ref carrying the person.
    - **Idempotent.** A second call with the same inputs writes nothing and returns the same dispositions. It reads back a ledger, `contact_opt_out_review_reanchors`, keyed by the person with ON DELETE CASCADE from unified_persons, so the ledger goes with the person and no person uuid survives on any row.
      - **The boundary: idempotency holds until the person delete.** A retried, failed erasure (the person still exists) sees the ledger and gets exactly the same set, each review once. A successful erasure deletes the person and the CASCADE removes the ledger with them, which is also why its person_id is not a residual; a call after that RAISES, because the person is no longer in the organization.
      - A call that raises part-way leaves nothing (one statement), so its retry starts clean.
      - One call moves at most one pending person review (one pending review per anchor), so a call returns that review plus what earlier calls for the person recorded. `no_target` (empty targets) and `re_anchored`/`merged` (targets given) therefore never meet in one call.
    - **`merged`** is a third review state: terminal, reachable only through the function (the guard admits it only under the function's transaction-local flag), carrying `merged_into` (same organization, by FK) and `merged_at`, with NO decision.
      - Decide refuses it with 409 `review_merged`; the review it was merged into is the one to decide.
      - The listing never shows it as pending or overdue (`state=merged` lists them).
      - findOptOutReviewBySourceRef prefers pending, then decided, then merged.
  - (6) **The decide/join race is not one transaction.** A join between a decision's claim and its revoke is repaired by the reconcile step (F1, tested). A revoke between a producer's hold write and its open is caught by the open's post-join/insert `hold_revoked` check, and the producer retries with a fresh hold (tested).
  - (7) **A webhook redelivered after a decision** re-closes the contact and opens a new review. That is safe, and producers can now skip it with `findOptOutReviewBySourceRef` (F3).
  - (7a) **Outreach m2:** `findOptOutReviewBySourceRef` has no row limit and no GIN index on `source_refs`. A miss only re-holds the contact (a new review), which is safe. Pair a row limit with the GIN index later.
  - (8) **The schema-parity verifier** does not yet list the table, as with `20270127000000`.
  - (9) ~~The amendment awaits owner confirmation~~: CONFIRMED by the owner 2026-11-07, including that a new email unsubscribe closes email permanently and holds the other channels for admin review.
- **Scope limit, unchanged:** WhatsApp broadcast recipients are matched by number. The number hold covers them now, wherever the number is known.

### 3b. Closed to new journeys (G-11 follow-up, RULED 2026-11-07)
- **The owner, verbatim:** "new journey gets closed while prospect is closed and once it is opened by admin it will be open for new journeys. only copany admin can close or reopen the prospect". Asked whether an admin can also close without an opt-out: "Also a manual close".
- **P-1's terminal closure is WITHDRAWN. PI ruled option (A):** the closure lives on the Orchestration side. PI's terminal `closed_disqualified` is NOT used or made reversible, because its terminality underpins the Prompt 5 key-change certification. No PI file changes; `recordHumanOriginClosure` is not called; the P-1 closure guard is unchanged.
- **TWO GATES at enrolment** (`enrollment.ts` → `contactEnrolmentClosure.ts`), both excluding with `contact_closed_by_admin`, beside PI's `prospect_lifecycle_closed`:
  - **Review-derived, with no write of its own.** A prospect is closed while an opt-out review in its tenant that TOUCHES it is pending, or decided `keep_closed` (its latest decision).
    - A review touches the prospect when it is anchored on the prospect's person, or on a target equal to the prospect's canonical email (an email anchor) or canonical phone (a phone or whatsapp anchor). The same normalizers as the anchors are used.
    - A merged review is followed through `merged_into` to the review that carries the state.
    - A reopen decision (any channel) opens it.
    - Reading the review state directly means an opt-out cannot half-land.
  - **Manual.** An active row in `contact_enrolment_closures` (migration `20270127000004`): append-only, reopened once, one active closure per prospect, with a composite FK to `canonical_leads` ON DELETE CASCADE.
    - It is written only through `POST /api/contact-enrolment-closures { action: 'close' | 'reopen', prospectId, reason }`, by COMPANY_ADMIN of that company (no bypass; a company SUPER_ADMIN is refused).
    - The reason is required (1–500 characters). Every close and reopen is audited in `execution_audit` with ids only.
    - `GET` reports which gate holds.
  - **A reopen clears the MANUAL gate only.** While a review still holds, the reopen is refused with 409 `closed_by_optout_review` and that review's id, and nothing changes: a review is reopened only by deciding it.
- **FAIL CLOSED.** An unreadable person, address, review store or closure store excludes with `contact_closure_unreadable`. Enrolment never proceeds on an unknown closure.
- **Only NEW journeys** are gated. A manual close does not end a run already active; its sends stay governed by the review's holds.
- **Erasure (PI item 1).** No journey send path reaches an address without a canonical person:
  - the bridge refuses `person_unresolved` before writing;
  - email resolves only `unified_persons.primary_email`, and WhatsApp only `primary_phone`;
  - community and WS-3 refuse `person_unresolved`;
  - nothing reads `lead_intelligence.identity`, `canonical_users` or contacts for a recipient.
  
  This proves SAFETY, not gating. After an erasure the prospect has no person, so a review re-anchored onto its address no longer links to it: a journey CAN still be created for the prospect (today's behaviour) and it fails at every send. This is tested on real schema. A MANUAL closure, which is prospect-level, does survive erasure and keeps refusing.
- **Erasure (PI ruled a SPLIT on `20270127000004`).** The row and every enforcing column are KEEP. `close_reason` and `reopen_reason` are MAPPED and redacted to `'[redacted: subject erased]'` by `public.g11_redact_enrolment_closure_reasons(org, prospect_ids)`.
  - The function is SECURITY DEFINER, service_role only, admitted by a transaction-local guard flag for that one change.
  - `{}` returns 0; NULL, a NULL element and another tenant's prospect raise; it is idempotent.
  - PI's erasure calls it with the person's prospect ids.

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
