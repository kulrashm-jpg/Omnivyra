# Owner decision register

**Every item is open. A recommendation here is not an approval.** Status changes only when the named owner decides, and the date and decider are then recorded here. Nothing has been signed on anyone's behalf.

| ID | Decision | Owner | Recommendation | Status | Blocks | Detail |
|---|---|---|---|---|---|---|
| D-2 | Handoff person link on erasure | Owner | SET NULL, erasure flow only | **Unsigned** | Landing `20270113000000` | `../D-2-A6-10-AUTHORIZATION.md` |
| D-3 | Gate-contract test change | Owner | Approve; test only | **Unsigned** | Landing | `../D-3-A6-07-AUTHORIZATION.md` |
| F-1 | Merge actor-FK `0001`..`0004` as one PR with writer validation | Owner | Approve | Open | Enabling orchestration | `../PI-ACTOR-FK-INTEGRATION-PROPOSAL.md` |
| F-2 | What counts as a valid human actor, including platform admins | PI | | Open | F-1 | Same |
| F-3 | One version number for H-3 | Owner | Keep the RC's `20270111000004` | Open | Release | Same |
| F-4 | Author `0005` for list actors; is `capability_assignments.granted_by` in scope | Owner, security | | Open | Enabling orchestration | Same |
| E-1 | Redact personal content in place on erasure | Owner, privacy | Approve | Open | Real email | `../EMAIL-EVIDENCE-ERASURE-DESIGN.md` |
| E-2 | May a governance record keep the address plus `attemptId` | Owner, privacy | Keep | Open | Real email | Same |
| E-3 | Authored `instruction` text: retain or scan | Owner, privacy | Retain, with authoring guidance | Open | Real email | Same |
| E-4 | Retention window for rendered content | Owner, counsel | 90 days as a starting point | Open | Real email | Same |
| E-5 | Build order | Owner | After D-2 | Open | Real email | Same |
| A | One approval record, including WhatsApp | Owner | Yes | Open | Tenant approval build | `../TENANT-JOURNEY-APPROVAL-DESIGN.md` |
| B | Approval roles | Owner | COMPANY_ADMIN, SUPER_ADMIN, CONTENT_REVIEWER | Open | Same | Same |
| C | Step-up per approval | Owner | No | Open | Same | Same |
| D | Self-approval | Owner | Allowed, tenant-configurable | Open | Same | Same |
| E | Approval expiry | Owner | 7 days | Open | Same | Same |
| L-1 | Retire legacy operator email (PI-041-A-E) | Owner | Approve phase 1 | Open | Attempt-history quality | `../LEGACY-EMAIL-RETIREMENT-PLAN.md` |
| L-2 | Run the read-only legacy email probe | Owner | Yes, before phase 2 | Open | Phase 2 | Same |
| CI-1 | Community verified identity: who may write it | Owner | | Open | Community engine (B-7) | `../VERIFICATION-AND-BLOCKERS.md` |
| WP-1 | Run the WhatsApp read-only production probe | Owner | Yes | Open | Knowing if broadcasts work today (B-10) | Same |
| AU-1 | Pursue autonomous dispatch at all, and when | Owner | Not before tenant approval has run | Open | **Stays disabled** | `../AUTONOMOUS-DISPATCH-OPT-IN-DESIGN.md` |
| AU-2..4 | Policy duration and caps; anomaly thresholds; legal review | Owner, counsel | | Open | AU-1 | Same |

## New in this phase

| ID | Decision | Owner | Recommendation | Why it is yours |
|---|---|---|---|---|
| C-1 | What each engine action costs in credits, and whether a journey reserves or charges | Owner | Decide before any paid tenant uses journeys. Until then usage is not metered | Pricing. No engine charges credits today |
| S-1 | Accept `certainty` beside your ten execution states | Owner | Accept. "May have acted" must not read as `FAILED`, because that invites a retry | It adds to the state list you specified |
| S-2 | Who may retry a provider-refused message | Owner, Outreach | Person only, through a new action. Today a person can only skip or cancel the step | Product behaviour |
| B-9 | Where a human `rejected` outcome comes from | Owner, PI | The tenant approval reject, or an operator route | `not_interested` is unreachable without it |
| WA-1 | Fix the WhatsApp operator routes (400 on POST) | Owner, Outreach | Sequence with decision A | Fixing them opens a send path with no tenant approval |
| WA-2 | WhatsApp columns and usage RPCs outside the chain | Owner, Outreach | Sequence with decision A | Same |
| WA-3 | Who writes `phone_number_id` and `waba_id` | Owner, Outreach | Sequence with decision A | Same |

## Raised by Outreach, recorded here so there is one register

Detail is in `docs/outreach/README.md` on `integration/outreach-engines-20261102`.

| ID | Decision | Owner | Recommendation (Outreach's) |
|---|---|---|---|
| O-1 | Backport the cron authorization fix to `main` ahead of the rest. The safety-net cron publishes with no `authorizePostPublish` **on main today**, by code reading | Owner | Yes. It stands alone |
| O-2 | Measure production: RPA rows or sessions, community executions, `USE_MOCK_PLATFORMS`, `RPA_SCREENSHOT_DIR` | Owner | Yes, before merging |
| O-3 | Is session-reuse RPA allowed at all (GAP-17) | Owner, counsel | Decide first |
| O-4 | May journeys act on non-consented community recipients? A cold prospect will not complete OAuth, so B-7 is more than a missing writer | Owner | Decide. Build acting-account proof regardless |
| O-5 | What one social post means for N people in a journey | Owner | Leave observe-only |
| O-6 | Retention for dead letters, which now hold raw WhatsApp payloads | Owner | Set before merge |
| O-7 | This work has no OMNI Story, so commits carry no `Governed-By` | Owner | Create one before merging. Only a human can |

## Standing positions, unchanged

Autonomous dispatch is disabled. Real email stays off until erasure, retention and provider setup are approved and verified. Orchestration is not enabled in production.
