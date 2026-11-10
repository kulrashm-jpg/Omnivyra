# Owner decisions 2026-11-08: K-1, reply assistance, Work Item 2

Programme owner decisions, recorded by Outreach (session virality-52) on 2026-11-08. They supersede every conditional reading of the answers recorded in Orchestration's Prompt 6 Stage 2 design drafts (`06` §5 #13 and #14).

**Status vocabulary:**
- RECORDED: the decision is written down.
- IMPLEMENTED: code exists, with an exact commit, tests and verification evidence.

A recorded decision is never implemented merely because it is recorded. **Release: NO-GO.**

## D-K1: K-1, the role of AI in replies: CONFIRMED (RECORDED)

**AI may:**
- assist with drafting replies;
- offer alternative wording and tone;
- give evidence-based explanations.

**AI must not:**
- classify inbound messages or assign authoritative intent or status codes;
- decide prospect qualification, lifecycle or governance status;
- authorize, suppress, resume, pause, terminate or advance journeys;
- send messages or execute external actions.

**Also decided:**
- Human approval is required for consequential actions.
- Deterministic governance restrictions remain authoritative.
- SC-7 remains unratified and disabled.

**Implementation:** none. No assistance feature exists on the foundation.

## D-K1b: OD-K1b, next-step suggestion: APPROVED AS SUGGESTION ONLY (RECORDED)

AI may recommend a possible next step to a human. The recommendation must never become a classification, journey transition, scheduled action, authorization or execution.

**The suggestion must:**
- be presented to a human;
- include supporting evidence and uncertainty;
- stay separate from authoritative system state;
- require explicit human selection and approval before any consequential action.

**Implementation:** none.

## D-RA: reply-assistance enablement prerequisites (RECORDED, NONE IMPLEMENTED)

Every gate must be met before any tenant can enable reply assistance.

| # | Prerequisite | Owner | State |
|---|---|---|---|
| RA-1 | C-6: prospect-specific AI cache isolation, implemented **and verified** | Owner of `responseGenerationService` and the AI cache (to be confirmed by the programme owner) | Not started here. Blocks RA-5 enablement |
| RA-2 | Drafts table: tenant access and authorization rules (GRANT/REVOKE per table; see the enumerative-hardening rule) | To be assigned with the table | Not defined |
| RA-3 | Drafts table: draft-to-person/prospect erasure mapping | PI (erasure policy) + the table owner | Not defined |
| RA-4 | Drafts table: retention and deletion rules | The table owner | Not defined |
| RA-5 | The switch is introduced by an **Outreach migration**, default **OFF** | Outreach | Not written. No version reserved yet. Needs its own authorization to build |
| RA-6 | Only the company's own authorized admin may enable it | Outreach | Not written |
| RA-7 | A negative test proving Super Admin cannot enable it | Outreach | Not written |

**Further rules:**
- The switch enables drafting assistance only. It never authorizes sending.
- No feature may reference the drafts table until RA-2 to RA-4 are agreed.

## D-OWN: ownership of `outreach_decisions` and `engagement_authors` (UNASSIGNED)

- The programme owner will assign one canonical owner for each table.
- Purpose, consumers, lifecycle and integration contract must be established first.
- Outreach does not claim either table, and does not accept an assignment by assumption. This includes the Prompt 6 drafts, which mark both as owner UNCONFIRMED.

**Closure B** (the acting account inside the passkey-signed approval binding, `communityApprovalBinding.ts`) remains with Orchestration's owner. On 2026-11-08 Outreach asked Orchestration (virality-c7) to raise it with that owner. The four test requirements agreed with c7 stand.

## D-WI2: Work Item 2, `d37ebefed`: CONDITIONAL GO for integration

See `FOUNDATION-COMPLETION-REGISTER.md`, section "Work Item 2 (L-4) integrated, combined T2", for the evidence and the outcome.

## D-QU: queuing-uncertain outcome: REQUEST TO ORCHESTRATION APPROVED (SENT, NOT IMPLEMENTED)

**Sent to virality-c7 on 2026-11-08.** The request: `whatsappEngineAdapter` should represent `WhatsAppEnqueueUncertainError` (code `whatsapp_enqueue_uncertain`) as **uncertain**, not failed.

**The owner requires:**
- a durable, distinct state;
- reconciliation or operator visibility;
- tests that prevent silent conversion to failed **or** to successful;
- an uncertain result never automatically triggers a resend.

The adapter is Orchestration's file. Outreach reviews the change when Orchestration delivers it.

**Orchestration's acknowledgement (2026-11-08):**
- **The queuing-uncertain request (D-QU):** not started. Orchestration is in a documentation-only stage, so the change needs its owner's go, which has been requested.
- **Closure B:** raised again with Orchestration's owner.
- **K-1:** Orchestration's owner had already ruled it the same way.
- **OD-K1b:** Orchestration's drafts mark it pending its owner's confirmation. This is Orchestration's own bookkeeping; the programme owner's decision above stands.
- **The F/RC erasure route** (Orchestration register 07, gate G-0 in 09): it has no feature flag, so merging it is itself an activation event. Noted for any future integration of that route.

**Until then:** the adapter maps this rare case to failed, a known residual of Work Item 2. In the ordinary lost-acknowledgement case nothing is uncertain: the recipients are withdrawn before any send, and failed is accurate.

## D-QU-SEL (2026-11-09): ownership exception recorded; RUL-C SELECTED

**The one-off ownership exception (B).** On 2026-11-09 the programme owner authorized Outreach to implement the queuing-uncertain change in Orchestration's `whatsappEngineAdapter.ts` while Orchestration was unreachable. The result was commit `8ae4af212` (parent `e28be7ce5`). The owner's ruling on it: "The one-off ownership exception permitted implementation, not ownership bypass. Obtain Orchestration owner review before integration. Do not expand this change." No approval of `8ae4af212` was given by its author.

**Two implementations.** Orchestration (virality-55) had independently prepared RUL-C, an uncommitted patch on base `a746ad268`, sha256 `c9a82a1f322098aa85496dbb6dba3681c516475058eb83dc59d2e0a529ef0308`, preserved as `refs/preserve/orch-rulc-patch-c9a82a1f`.

**Outreach's integration review of RUL-C: PASS** (sent to Orchestration 2026-11-09). Findings:
- **F-1 (HIGH, against `8ae4af212`).** Its outcome word `enqueue_uncertain` is not in `MAY_HAVE_ACTED` (`executionContract.ts:81`), so the contract normalizes it to FAILED / definite. RUL-C's `uncertain` normalizes to EXECUTING / may_have_acted / human_only. Confirmed by execution by Orchestration.
- **F-2 (LOW, RUL-C).** `instanceof` on the imported class would throw in a jest suite that mocks the service module without the class. No production effect; no current suite reaches it.
- **F-3 (INFO).** Both add the same test file name and registry line; only one can integrate.
- **Compatibility.** RUL-C applies cleanly on `e28be7ce5` and on the Follow-up A merge (`330c891c1`). Orchestration's executed cross-check: both candidates are safe against resends with Follow-up A. The matching-policy difference (RUL-C requires class AND code) is by design.

**Programme Owner Decision (2026-11-09):**
- **SELECT A, Orchestration's RUL-C.** `8ae4af212` is not selected: preserved unchanged (`refs/preserve/outreach-wa-adapter-enqueue-uncertain`), never integrated.
- **Orchestration must:** commit RUL-C under its own ownership; preserve the error-class and error-code matching; retain the distinct `uncertain` and `needs_human` semantics; preserve the withdrawn-recipient `failed` path; provide the exact commit, diff and T1 evidence.
- **Outreach must:** review compatibility against Follow-up A (`6a69f4700`) and the governance branch; then rebuild the candidate from the approved integration head plus Follow-up A and RUL-C, run the combined T2 against the exact resulting commit, and compare failures against the established baseline.
- **Ownership:** Orchestration retains implementation and maintenance ownership of the adapter. Outreach performs integration compatibility review. The programme owner retains final approval authority.

**Status:** awaiting Orchestration's RUL-C commit. The candidate branch `outreach/int-candidate-20261109`, which still contains `8ae4af212`, is held and will be rebuilt without it. No T2 has run.
