# Contract compatibility report

Whether each engine, as it stands, honours the contract (0.2.0 below; 0.3.0 at the end), and what is unresolved between the three domains. Engine facts come from Outreach's inventory on `integration/outreach-engines-20261102` (`docs/outreach/inventory/`, read from code at `dc7f2ae3`) and from this branch's tests. "Outreach reports" marks a fact this work did not re-check.

## Engines against the contract

| Requirement | WS-3 email | WhatsApp | Social publish | Community | Browser |
|---|---|---|---|---|---|
| Implements `EngineAdapter`, one registry | Yes | Yes | Yes | Yes | Yes, with no channel |
| Capability declaration passes `checkCapabilityDeclaration` | Yes | Yes | Yes | Yes | Yes |
| Disposition alone settles the step | Yes | Yes | Yes | Yes | Not applicable |
| Idempotency | Bridge unique per task | Request ledger and claim | Observation only | Request ledger and engine claim | No actions |
| Honours `holdOnly` (0.2.0) | Not needed: it has no claim to release | Yes | Not needed | Yes | Not applicable |
| "May have acted" stays uncertain | Yes | Yes, including an interrupted submission | Not applicable | Yes | Not applicable |
| Central gate, section F | Yes | Yes | Not contact | Yes | Not applicable |
| Engine's own gates behind it | Yes | Yes, plus send-time controls on Outreach's branch | | Yes, permission before claim | |
| Reports delivery | SES events | Webhook processor | No | No | No |
| Reports responses | Recorded outcomes | Inbound processing | No | **No (G-6)** | No |
| Approval | WS-3 task, **super-admin only** | **None: refuses** | Release, not approval | Engine record | |
| Highest proof | Real schema, recording provider | Real schema, Meta stubbed | Real schema | Refusal paths on real schema; the rest fakes | Fakes only |
| Provider ever called for real | **No** | **No** | **No** | **No** | **No** |

**No engine has made a real provider call in this work.** Each engine's `verification` stays at `mocked` or `postgres_verified`. None claims `sandbox_provider_verified` or `production_verified`.

## Engine facts that limit the contract

Outreach reports these. Each needs fixing behind its engine before that engine can act for a real person.

| Engine | Fact | Effect |
|---|---|---|
| WS-3 email | The edge function ignores `idempotencyKey` | Provider-side deduplication is not in place. Orchestration's own dedupe still holds |
| WS-3 email | A 5xx or network error parks the task as `blocked_prior_attempt`, and no route clears it | A person cannot retry it (S-2) |
| WhatsApp | Operator POST routes return 400 (WA-1) | Main's operator broadcast path is likely unreachable |
| WhatsApp | `metaAuthService` columns and usage RPCs are outside the migration chain (WA-2, B-11) | Schema in production unknown (B-10) |
| WhatsApp | Nothing writes `phone_number_id` or `waba_id` (WA-3) | No account can be configured through the app |
| Social | Publishes to an account, never one-to-one | Cannot address a person. Observe-only by design |
| Social | Outreach's G-5 is unapplied: the adapter does not read the retry state | A failed post that will retry reads as failed to a journey |
| Community | All DMs refused. The proof checks the recipient, not the acting account. The token used is the account most recently updated | B-7 is larger than recorded; see the blocker register |
| Community | A scheduled action executes with no governance check (L-3) | Contact after opt-out once identity is unblocked |
| Browser | Reaches people only as a transport under community. Replies can falsely report `executed` (GAP-03) | Not an engine of its own. Owner decision O-3 |

## Unresolved between domains

| Conflict | Between | State |
|---|---|---|
| Actor rule: draft, unratified; three implementations; the FK removal is one-way | PI and governance, Orchestration | **Open: F-1, F-2.** Orchestration stays off until writer validation and FK removal land together |
| `prospect_lifecycle_transitions` has no production write path on `origin/main` | PI | Reported by the owner of that work |
| Provider availability: extend PI's `providerCapabilityModel` or not | Outreach proposes, PI owns the model | Undecided. Outreach's v0.2 proposal |
| Webhook verification contract | Outreach proposes, Orchestration owns the contract | Undecided |
| Non-WS-3 outcomes have no store (`outreach_outcomes.task_id` NOT NULL) | Orchestration, Outreach | G-4 |
| Any later inbound message from the person ends a journey, related or not | Orchestration | Narrowed to the same tenant, and only after this run messaged the person. Not narrowed further |
| Outreach's branch on contract 0.1.0 (`30a421c2`) | Orchestration, Outreach | **Resolved.** Outreach merged `c74404c7` (0.2.0) as `d682ab13`, with no conflicts, and its T2 passed. It records L-3 and L-4 as open on the engine side (`docs/outreach/README.md`, `1edb0c90`) |

## Branch compatibility

| Pair | Tested | Result |
|---|---|---|
| Orchestration `019b6de5` alone | T2 | Pass; see `../VERIFICATION-AND-BLOCKERS.md` |
| Orchestration `30a421c2` with Outreach's five engine branches | Outreach's T2 at `21f62238` | Real schema 71 of 71, 1488 passed; 60 jest failures, none new by its baseline. Outreach ran this, not this work |
| Orchestration `c74404c7` (code `019b6de5`) with Outreach's five engine branches | Outreach's T2 at merge `d682ab13`, tree clean | Real schema 71 of 71, 1488 passed, 3 skipped; `typecheck-ci` 3 of 3 clean, worker typecheck, route auth, route policy, migration quality and schema drift pass; whole-repo jest 60 failures, none new by its `fa1a5e58` baseline. Outreach ran this; this work checked its logs in `C:/omnivyra-archive/evidence/outreach-engines-20261102/t2-final-d682ab13/` but did not re-run it |
| Orchestration `019b6de5` with RC `7bdd76ae` | Merge and replay | See `RELEASE-READINESS.md` |
| Parked: `feat/pi-enrichment-trigger`, `consolidate/pi-prospect-lists` | No | Not integrated. PI should say whether they matter |

The two jest baselines differ: Outreach compared with `fa1a5e58`, and this work with `5025f51d`.

## Contract 0.3.0

0.3.0 adds the event types `approval.revoked`, `journey.suspended` and `record.unmapped`, the optional `actor` on approval events, the complaint marker rule `isComplaintInferredEvidence`, and re-maps four delivery statuses (`SHARED-INTEGRATION-CONTRACT.md` E.3). No engine changes, and every engine declaration still passes at 0.3.0. Their `contractVersion` follows `EXECUTION_CONTRACT_VERSION`, and a 0.2.0 declaration passes too, because only the major is compared. The event version stays 1; the reasoning and the consumer note are in `API-AND-EVENT-SCHEMAS.md`, "From 0.2.0 to 0.3.0". It is implemented on `orch/c4-a-contract`, uncommitted. Outreach has not merged it.

### Revocation consumers (proven on real PostgreSQL)

Suite `backend/tests/realschema/orch_c4_approval_revoked.test.ts`, with `orch_contract_journey` and `d02_approval_binding` re-run green beside it.

| Requirement | State |
|---|---|
| A revoked approval authorises nothing at the sweep, the dispatch gate or the database claim | Proven. A `revoked` row alone refuses, even with the task left `approved` |
| A queued or approved task under a revoked approval cannot execute | Proven. Revocation cancels it by compare-and-set; the claim and the revocation cannot both win, in either order or concurrently |
| The journey records what became of the step | Proven on the frozen base: the step settles `skipped` and the journey continues. **Superseded by RV-1** (owner, 2026-11-05: pause for review). Agent B implements the pause, and the view reads it as `journey.suspended` |
| Duplicate and out-of-order reads | Proven. Same `eventId` on re-read; order `(occurredAt, eventId)`; a cursor walks every event once |
| Revocation after a completed send | Proven. It is refused. A revoked row recorded after a send anyway shows beside the send, and nothing reads as undone |
| Cross-tenant revocation | Proven refused (`task_not_found`), with nothing written, through the service and the tenant surface |
| The complaint marker is read from a stored row | Proven. A real SES Complaint through `ingestSesEvent` stores `transport_response.deliveryInferredFrom = 'Complaint'` on a `delivered` row; the helper reads it from that row; the view gives one `delivery.complained` and no `delivery.confirmed`, and a repeated provider event adds nothing. A stored JSON-string response and a pre-D7 row also read as complaints |
| Acceptance is not delivery | Proven. The send's own evidence rows never read as `delivery.confirmed`; a later SES Delivery does |

## Contract 0.4.0

0.4.0 adds the event type `response.received` and re-maps one reading: a WhatsApp inbound that is not an opt-out keyword is `response.received`, code `unclassified`, never positive engagement, where 0.3.0 read it as `response.replied` (X-3). A WhatsApp STOP stays `response.unsubscribed`, and an operator-recorded WS-3 `replied` stays `response.replied`. No engine changes, and every engine declaration still passes at 0.4.0, because only the major is compared. The event version stays 1 (EV-1). Details: `API-AND-EVENT-SCHEMAS.md`, "From 0.3.0 to 0.4.0". It is implemented on `orch/c5-b`, uncommitted.
