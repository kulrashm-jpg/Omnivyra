# Contract compatibility report

Whether each engine, as it stands, honours contract 0.2.0, and what is unresolved between the three domains. Engine facts come from Outreach's inventory on `integration/outreach-engines-20261102` (`docs/outreach/inventory/`, read from code at `dc7f2ae3`) and from this branch's tests. "Outreach reports" marks a fact this work did not re-check.

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
| Outreach's branch merged contract 0.1.0 (`30a421c2`), not 0.2.0 | Orchestration, Outreach | **0.2.0 changes two adapter files** (`whatsappEngineAdapter.ts`, `communityEngineAdapter.ts`). Outreach must merge `019b6de5` and re-run its T2 |

## Branch compatibility

| Pair | Tested | Result |
|---|---|---|
| Orchestration `019b6de5` alone | T2 | Pass; see `../VERIFICATION-AND-BLOCKERS.md` |
| Orchestration `30a421c2` with Outreach's five engine branches | Outreach's T2 at `21f62238` | Real schema 71 of 71, 1488 passed; 60 jest failures, none new by its baseline. Outreach ran this, not this work |
| Orchestration `019b6de5` with Outreach | **Not tested** | Waiting on Outreach's merge |
| Orchestration `019b6de5` with RC `7bdd76ae` | Merge and replay | See `RELEASE-READINESS.md` |
| Parked: `feat/pi-enrichment-trigger`, `consolidate/pi-prospect-lists` | No | Not integrated. PI should say whether they matter |

The two jest baselines differ: Outreach compared with `fa1a5e58`, and this work with `5025f51d`.
