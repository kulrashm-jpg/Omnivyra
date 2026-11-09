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
