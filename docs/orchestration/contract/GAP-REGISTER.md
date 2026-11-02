# Implementation gap register

Mandate section 5, against the code. "Real" means it ran on real PostgreSQL through the real stores and, unless stated, with the provider stubbed. Nothing below is production-verified.

## Capabilities

| Capability | State | What exists | What is missing |
|---|---|---|---|
| Tenant versioned workflows | **Real** | `workflows`, `workflow_versions`, frozen plan snapshot | Authoring UI not reviewed here |
| Enrollment and lifecycle | **Real** | Eligibility, dedupe, provenance, withdrawal | |
| Persisted decisions | **Real** | `execution_journey_decisions` | |
| Next-best action | **Limited** | Rule-based conditions on facts read live, choice groups | No model; no action added at run time |
| Conditional branching | **Limited** | First-match choice groups on a linear plan | No graph; no jump; a response can only end a journey |
| Multi-step | **Real** | Linear plan and database clock | |
| Multi-engine routing | **Real, engines limited** | Registry by channel | See engine table |
| Scheduling and windows | **Real** | Delay, frequency, execution window in tenant or person timezone | |
| Retry and recovery | **Partial** | Next-sweep waits, uncertain goes to a person, blocked runs end, stuck reported after 7 days | A person can skip or cancel but not retry a refused message (S-2) |
| Human approval | **Partial** | WS-3 approval, read-only preview and hash | **Super-admin only.** No tenant route, role or hash check at send (A to E). WhatsApp has none, so it refuses |
| Termination | **Real** | Response, PI closed, person, blocked step; unsent tasks withdrawn | A queued WhatsApp broadcast still sends after exit (B-17; Outreach reports a fix on its branch) |
| Consent and suppression | **Real for email, WhatsApp, community facts** | `mayContact`, `contact_governance_records` | |
| Tenant and channel kill switches | **Real** | Central gate plus engine gates | No per-engine platform switch (G-5) |
| Quotas | **Partial** | WS-3 counts attempts | None for WhatsApp or community in this path |
| Credit accounting | **Missing** | Credit ledger exists, and no engine uses it | Pricing is C-1. `ExecutionUsage` is declared and reported by nothing yet |
| Idempotency | **Real** | Bridge unique per task, request ledger, engine claims | WS-3 edge function ignores `idempotencyKey` (Outreach, unexecuted) |
| Event ingestion | **Partial** | SES after signature check, WhatsApp webhook processor, operator outcomes | No real signed webhook has run through these paths |
| Reply classification | **Limited** | Recorded outcomes; STOP detection on WhatsApp | No classifier of free text |
| PI feedback | **Real, gated** | Outcome and WhatsApp reply to lifecycle through PI's producer | Actor rule unratified; `prospect_lifecycle_transitions` has no production write path on `origin/main` (reported by the owner of that work) |
| Outcome reporting | **Real** | `buildJourneyReport`, exits, attainment, all engines | |
| Audit and correlation | **Real** | Decisions, append-only approvals, correlation IDs in the event view | |

## Engines

| Engine | Highest proof | Can it act for a real person today? | Blocking |
|---|---|---|---|
| WS-3 email | Real schema, provider stubbed | **No** | B-3, B-4, B-5 |
| WhatsApp | Real schema, Meta stubbed | **No, refuses** | B-6, B-8, WA-1, WA-2 |
| Social publish | Real schema, observes only | Cannot address a person | By design |
| Community | Real schema refusal paths; send path on fakes only | **No** | B-7 |
| Browser | Claims no actions | **No, by design** | No safe operation |

## Contract gaps for later versions

| ID | Gap | Owner | Why it is not in v0.1 |
|---|---|---|---|
| G-1 | No capability negotiation; `checkCapabilityDeclaration` is static | Orchestration | Nothing yet needs to choose between engines at run time |
| G-2 | No provider availability, configuration or health | Outreach proposes, from the existing `providerCapabilityModel` | Avoids a second model |
| G-3 | No shared webhook verification contract | Outreach proposes | Each engine verifies its own today |
| G-4 | Non-WS-3 outcomes have no store (`outreach_outcomes.task_id` is NOT NULL) | Orchestration, with B-7 | Needs a migration and a live producer |
| G-5 | No per-engine platform kill switch | Orchestration | Config shape undecided |
| G-6 | Community responses are not read by journeys | Orchestration, with B-7 | No live producer |
| G-7 | `approval.requested` and `execution.failed` event types are declared and not emitted | Orchestration | Needs an approval request record or a mapping |
| G-8 | Event cursor can miss late rows with an earlier time | Orchestration | Documented; consumers re-read and dedupe |
| G-9 | PostgREST query shapes not exercised by any journey suite | Orchestration | A local stack can do this without authorization |

## Parked work not integrated

`feat/pi-enrichment-trigger` (3 unmatched patches) and `consolidate/pi-prospect-lists` (1 unmatched) are not on this branch. PI should say whether they matter.
