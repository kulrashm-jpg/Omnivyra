# AI Orchestration: recovery baseline and completion record

**Status:** local branch `feat/orchestration-recovery`, based on `origin/main` 5025f51d. Nothing is pushed, merged, deployed or applied to any real database. No provider was called.

**How to read a classification:** "verified" means run against real PostgreSQL 17.6 with pgvector built from baseline plus replay, unless the row says otherwise. Production state is known only where stated; nothing here reads production.

## 1. Historical commit reconciliation

Rebased commits have new SHAs, so identity below was traced by commit subject across all refs.

| Commit | What it is | On `origin/main` | State |
|---|---|---|---|
| `e21a9867` | WhatsApp: never send twice on retry | No | Rebased as `cefd8528` on `rebase/orch-adapters-09a2cf49`. **Now integrated here.** |
| `fa18c9c8` | Orchestration vertical slice | No | Rebased as `02cc5dfb`. **Now integrated here.** |
| `72e827b5` | Lists and campaign targets to enrollment | No | Rebased as `dab7b966`, with its real-PG fixes `b30bbddf` as `0fb8f5bf`. **Now integrated here.** |
| `e652d356` | Inbound STOP becomes a WhatsApp opt-out | No | Never rebased, only on `feat/whatsapp-stop-optout`. **Now integrated here.** |

Nothing is unavailable and nothing is superseded. The originals remain untouched on their own branches and worktrees.

Also recovered, because the commits above depend on them:

| Work | Why it was needed |
|---|---|
| `fix/ws3-requeued-dispatch` (`cb0e3419`, `8734b780`, `b826e0f5`) | Without it a task returned to `queued` never dispatches again, so a journey would wait forever. Absent from every orchestration branch. |
| `privacy/a6-10-rollbacks` (`33c414be`) | Without it the bridge's `person_id` FK blocks main's person erasure. **Owner decision D-2 is unsigned.** |
| `test/a6-07-gate-count` (`d9548c3d`) | Without it main's provenance gate test fails against the stack. **Owner decision D-3 is unsigned.** |
| `refs/preserve/wt/pi-consol` `backend/services/emailEngine/*` | The certified Email Engine. It was on no integration branch, so a journey email could not send. |

The release candidate `integration/release-candidate-5025f51d` 7bdd76ae does **not** contain the orchestration stack. It merges cleanly with this branch, migration versions do not collide, and the combined schema replays and passes the orchestration and erasure suites (section 8).

## 2. Capability inventory

| Capability | Where | Storage | Verified by | Connected to | Class |
|---|---|---|---|---|---|
| Prospect lists | `backend/services/prospectLists/*`, `pages/api/prospect-lists/*` | PostgreSQL `prospect_lists`, `prospect_list_members` (20261127) | `orch_campaign_targets` | Campaigns, PI scores | IMPLEMENTED AND VERIFIED; live in prod per the 2026-11-01 measurement, while its DDL exists only on local branches until this lands |
| Campaigns, targets | `backend/services/prospectCampaigns/*`, `pages/api/prospect-campaigns/*` | PostgreSQL (20261226, 20261231) | `orch_campaign_targets` | Lists, enrollment | IMPLEMENTED AND VERIFIED |
| Workflow definitions, versions | `backend/services/workflows/workflowStore.ts`, `pages/api/workflows/*` | PostgreSQL (20261227); frozen on publish | `orch_campaign_targets`, `piWorkflowDefinition032` | Plans, enrollment | IMPLEMENTED AND VERIFIED |
| Enrollment | `orchestration/enrollment.ts`, `campaignEnrollment.ts` | Instance store; partial unique index | `orch_journey_lifecycle` | PI facts, PI state | IMPLEMENTED AND VERIFIED; PI state gate new here |
| Execution instances, plans, steps, tasks | `executionInstances/`, `executionPlans/`, `workflowExecution/` | PostgreSQL (20261228*) | Both real-schema suites | Sweeper | IMPLEMENTED AND VERIFIED |
| Scheduling | `advance_execution_plan`, sweeper, cron route | Database clock | `orch_journey_lifecycle` | All engines | IMPLEMENTED AND VERIFIED; **the cron is not scheduled and `WORKFLOW_ORCHESTRATION_ENABLED` is off**, both by design |
| Policy | `journeyPolicy.ts`, `individualIntelligence.ts` | Frozen in version; facts read live | Unit plus `orch_journey_lifecycle` | PI, governance | IMPLEMENTED AND VERIFIED |
| Decision record | `orchestration/journeyDecisionLog.ts` | PostgreSQL (20270120000000) | `orch_journey_lifecycle` | Report, progression route | IMPLEMENTED AND VERIFIED; new here, was in-memory only |
| Response ingestion, WS-3 | `feedbackIngestion.ts`, `pages/api/webhooks/ses.ts`, `pages/api/outreach/outcomes.ts` | `outreach_outcomes` | Main's suites plus `orch_journey_lifecycle` | Journey exit, PI | IMPLEMENTED AND VERIFIED for operator-recorded outcomes. SES reply detection does not exist: SES reports delivery, bounce and complaint only, so a reply must be recorded by an operator |
| Response ingestion, WhatsApp | `whatsappWebhookProcessor.ts`, `journeyResponses.ts` | `engagement_messages` | `orch_journey_lifecycle` with seeded inbound rows | Journey exit, PI | IMPLEMENTED — NOT VERIFIED against a real Meta webhook |
| Feedback to PI | `journeyFeedback.ts` calling PI's producer, interpreter, writer and opener | `prospect_lifecycle_transitions` | `orch_journey_lifecycle` | PI lifecycle | IMPLEMENTED AND VERIFIED; PI's four functions unchanged, they simply had no caller |
| Journey report | `journeyReport.ts`, `pages/api/workflows/[id]/report.ts` | Derived | `orch_campaign_targets`, `orch_journey_lifecycle` | All stores | IMPLEMENTED AND VERIFIED; cost is not measured because no engine records it |
| Engine: WS-3 internal | `engineAdapters.ts`, `internalTransport.ts` | `outreach_tasks`, handoffs | `orch_journey_lifecycle` | Sweeper | IMPLEMENTED AND VERIFIED |
| Engine: WS-3 email | `engineAdapters.ts`, `emailEngine/*` | Plus `email_outreach_content_evidence` | `orch_journey_lifecycle`, `pi_email_send_path_041a`, with a recording provider | Sweeper | BLOCKED BY EXTERNAL DEPENDENCY for a real send: edge function deploy, SES configuration set and SNS topic, unsubscribe keys, `LEAD_OUTREACH_EMAIL_ENABLED`. Code verified to the provider boundary |
| Engine: WhatsApp | `whatsappEngineAdapter.ts`, `whatsappBroadcastService.ts`, `whatsappOptOut.ts` | `execution_engine_requests`, broadcast tables | Unit with fakes | Sweeper, governance | IMPLEMENTED — NOT VERIFIED on real PG end to end, and needs a tenant WhatsApp account and approved template |
| Engine: social publish | `socialPublishEngineAdapter.ts` | Reads `scheduled_posts` only | Unit | Sweeper (new) | PARTIALLY IMPLEMENTED by design: a step observes a released post, it cannot publish per person |
| Engine: community | `communityEngineAdapter.ts`, `communityJourneyLinkStore.ts`, `communityIdentityProof.ts` | `community_action_journey_links`, engine ledger | Unit with fakes | Sweeper (new) | BLOCKED: every link is refused until a writer sets verified identity from OAuth evidence, and none exists |
| Engine: browser | `browserEngineAdapter.ts` | None | Unit | Sweeper (new); claims no channel | PARTIALLY IMPLEMENTED by design: refuses everything, since no RPA operation is safe to expose |
| Channels `linkedin`, `phone`, `sms`, `github`, `discord`, `slack`, `content` | Authorable in `WORKFLOW_STEP_CHANNELS` | n/a | `unsupported` decision | Nothing | MISSING: a step on these stays ready and is reported as unsupported |
| Operator UI for workflows and journeys | None | n/a | n/a | n/a | MISSING: APIs only |

## 3. Architecture and dependency map

```
Prospect Intelligence (owner)         AI Orchestration (owner)                  Outreach engines (owner)
canonical_leads, unified_persons ───► lists → campaign targets
prospect_score_evaluations ─────────► enrollment (facts, conditions, PI state)
prospect_lifecycle_transitions ─────►      │
                                           ▼
                                    workflow version (frozen) → plan → steps → tasks
                                           │
                                    sweeper (cron, flag-gated; DB is the clock)
                                      1 advance_execution_plan
                                      2 facts, then exit check ◄──── outreach_outcomes, engagement_messages
                                      3 permission + conditions ◄─── contact_governance_records
                                      4 frequency
                                      5 adapter ───────────────────► WS-3 internal / email engine
                                      6 settle + record decision     WhatsApp broadcast
                                           │                         social publish (observe)
ensureProspectLifecycleOpen ◄──────────────┤                         community (linked, verified)
produceLifecycleFromOutcome ◄──────────────┤                         browser (refuses)
recordProspectTransition ◄─────────────────┘ (WhatsApp replies, via interpretOutcome)
```

Each engine's gates stay inside that engine. Orchestration decides *whether a step applies to this person now*. It never approves, retries an uncertain send, or overrides an opt-out.

## 4. Duplicate and conflicting implementation register

| # | Conflict | Evidence | Resolution here |
|---|---|---|---|
| 1 | Two list schemas: 20261127 vs pi-consol 20261104 | Prod runs 20261127 | 20261127 is canonical, byte-identical; pi-consol's stays parked |
| 2 | Email content: the parked certified engine vs a `step.email` field I first added in `9daf1cc5` | Found by this inventory before completion | **The field is removed, engine ported.** A real mistake caught by the duplication check, kept visible in the history |
| 3 | WS-3 approval vs "autonomous" steps | The parked merged rule (PI-041-A-H) lets autonomous tasks dispatch unapproved | **Open owner decision.** Every WS-3 action needs a human. Tests are skipped with the reason stated |
| 4 | Legacy operator email path vs engine | PI-041-A-E retires it; main still dispatches it | **Open owner decision.** Not retired. Application callers now compose the engine, so a task with no handoff fails closed rather than sending a placeholder |
| 5 | "Orchestration" naming: `aiOrchestration/` (LLM routing), `orchestration/distributed` (campaign runtime), `workflowExecution` (journeys) | Different domains | Kept. Not renamed, per your instruction |
| 6 | Three suppression stores | Prior W2 audit | Not touched. Journeys read `contact_governance_records` through `mayContact`, as the engines do |
| 7 | Many schedulers | `communityAiScheduler`, `autonomousScheduler` and others | No new scheduler. `advance_execution_plan` is the only journey clock |
| 8 | `workflowEmailDispatch` as the one email entry point | Parked design | Adopted: the adapter calls it |

**New objects, and why existing ones could not serve:**
- `execution_journey_decisions`: step state holds no reason, the engine ledger holds no skips, and `capability_audit_log` has no run key.
- `email_outreach_content_evidence`: ported, not new. Its header documents why no existing column can hold bodies.

## 5. Integration contract

**Retained unchanged:** `EngineAdapter` / `EngineResult` and dispositions; `SubjectRef`; `advance_execution_plan`, `cancel_execution_run`; the bridge; the engine request ledger; `produceLifecycleFromOutcome`, `interpretOutcome`, `recordProspectTransition`, `ensureProspectLifecycleOpen`; `mayContact`; `dispatchInternalOutreachTask`; `ingestFeedback`.

**Small extensions made:**
| Interface | Change | Consumers affected |
|---|---|---|
| `IndividualIntelligencePort` | Optional `readProspectState`; result gains `prospectLedgerAbsent` | Sweeper, enrollment. Ports without it behave as before |
| `JOURNEY_FACT_TYPES` | `prospect_lifecycle_state` | Authors may now condition on it |
| `createEmailTransport` options | `content`, `recordContent` hooks | Omit them and nothing changes |
| `registerDefaultTransports` | Optional `email: 'engine' \| 'placeholder'` | Application callers pass `engine`; a test pins this |
| `SweepCounters`, `TenantSweepResult`, `VersionReport`, progression `GET` | Additive fields | Cron and report readers |

**Rules now in force for all three workstreams:**
- A response of `replied`, `meeting_booked`, `converted`, `rejected` or `unsubscribed` ends the journey. This is implicit and not authorable, because it only narrows contact.
- PI states `closed_disqualified` and `not_interested` block enrollment and end a live journey. An unreadable state means no contact that sweep.
- A prospect's ledger opens when a journey first acts on them.
- Email content is the step `instruction`. A placeholder the person has no value for skips that step; it never renders empty.

**Missing contracts, decisions needed:** see section 6, P1.

## 6. Exact remaining work

**P0: required before this branch can land** (owner authorization, in order)
1. Sign D-2 and D-3, which this branch already depends on. The D-2 errata also asks for the A6-10 rollback file to be renamed to slug-only form.
2. Authorize the push and PR. The branch adds 22 migrations: 19 from the stack, A6-10, and the two 20270120 files. The 19 sort before production's 2027 versions, so they need the out-of-order procedure in `docs/release/orchestration-engine-adapters-migration-runbook.md` (extend it with the two 20270120 files).
3. Sequence with the release candidate: both target main. Their combination is proven in section 8, so either order works at the git and schema level. The migration ordering still needs a decision in the runbook.
4. The PI actor-FK fixes in `fix/pi-actor-fk-migrations` (uncommitted there) must apply **before orchestration is enabled**. Today `prospect_lifecycle_transitions` is empty in prod, so the fix window is open, and orchestration writes the first rows into it.

**P1: required before real sends**
1. **Privacy:** `email_outreach_content_evidence` holds personalized text and is immutable, and the erasure flow does not know about it. Decide redaction before `LEAD_OUTREACH_EMAIL_ENABLED` is on anywhere real.
2. Email externals: edge function deploy, SES configuration set and SNS topic, `OUTREACH_UNSUBSCRIBE_TOKEN_KEYS`, `SES_SNS_TOPIC_ARNS`.
3. **Approval surface:** the only approval route is `pages/api/super-admin/outreach/approve.ts`, so tenants cannot approve their own journey steps, and it shows the task's action code rather than the rendered text. Every journey step currently depends on it.
4. Owner decisions PI-041-A-H (autonomous dispatch) and PI-041-A-E (retire legacy email).
5. Schedule the cron and set the flag, per tenant rollout. Deliberately not done.
6. Real-webhook test of WhatsApp inbound, on a test number.

**P2: known limits, stated rather than hidden**
1. A WhatsApp broadcast already queued when a reply arrives can still send; the exit does not recall it.
2. WhatsApp replies reach PI only while the journey is live. WS-3 outcomes have no such limit, but only within a 72-hour window of the sweep running.
3. Tenant rotation: past 25 enabled tenants the same 25 are swept. Run rotation covers up to 1000 occupied runs per tenant, and exceeding either is reported as `workRemains`.
4. A step whose channel has no adapter holds its journey open until a person cancels it, including when the person has replied.
5. The `no_response` outcome has no writer, so `nurture` is unreachable from silence.
6. Community identity verification writer, the social publish per-task interface, safe RPA operations, and the other seven channels. Each is an owner product decision.
7. Operator UI.

## 7. Parallel work assignments

Work on this repo is limited to one typecheck at a time on this machine (4 CPUs, about 8 GB each), so these are separated by file ownership rather than run concurrently.

| Lane | Owner | Scope | Must not touch | Starts after |
|---|---|---|---|---|
| A. Release integration | Orchestration integration | P0.2, P0.3, runbook extension, parity at merged main | Product code | Owner signs D-2, D-3 |
| B. PI actor FKs | PI | Finish `fix/pi-actor-fk-migrations`; add `prospect_list_members` actor columns, which need 20261127 from this branch | `orchestration/`, `workflowExecution/` | Now |
| C. Evidence erasure | Privacy (`feature/erasure-wiring`) | P1.1 | Email render and send | Owner decides redaction |
| D. Email activation | Outreach | P1.2, one test-tenant send | Sweeper, policy | A landed |
| E. Approval surface | Outreach and orchestration | P1.3 | Governance order | Owner decision on tenant approval capability |
| F. WhatsApp certification | Outreach | P1.6, P2.1 | Journey policy | A landed |

## 8. Verification

**Plan**
- T1, per change: affected unit suites and mutation checks.
- T2, branch: both typechecks, worker typecheck, route-auth, route-policy, migration quality, schema drift, full real-schema on a fresh replay, rollback proof, whole-repo unit project compared to main's known failures.
- T3, release (not run, needs authorization): strict schema parity at merged main, predeploy check, a real send on a test tenant.

**T1 and T2 results at this commit**

| Check | Result |
|---|---|
| Fresh replay: baseline plus every migration | 103 applied, 0 unexpected errors |
| Full real-schema suite | **68/68 suites, 1416 passed, 3 skipped** |
| New journey suite, included above | `orch_journey_lifecycle`, 10 tests |
| Mutation checks on the new behaviour | **20/20 killed** |
| `typecheck-all`, worker typecheck (at `a25abddc`) | Pass |
| CI typecheck baseline (at `073b8bce`) | Pass, net-new 0 |
| Route auth (at `073b8bce`), route policy, schema drift | Pass |
| Migration quality (at `073b8bce`) | Pass, after renaming the A6-10 rollback file |
| Rollbacks of both new migrations | Succeed empty, re-apply cleanly, **refuse while rows exist** |
| Client grants on the evidence table | 0 for anon and authenticated |
| Whole-repo unit project | 2306 suites. The 266 not green in the first pass (252 of them from a minimal test env of mine) were re-run on the repo's placeholder env at `073b8bce`: 60 failures, **0 outside main's recorded baseline of 70** |
| Combined with RC 7bdd76ae, scratch merge | Git merge clean; 111 migrations replay clean; orchestration, A6-10 and erasure suites 5/5 suites, 117 passed, 3 skipped |

**Limits of this evidence:**
- The whole-repo pass compares by test name against a baseline recorded at main fa1a5e58, not re-measured at 5025f51d. Suites that passed in the first pass (at `a25abddc`) were not re-run at the final commit; only test files and a rollback filename changed after it.
- The real-schema harness replaces PostgREST with a SQL adapter, so supabase-js query shapes are not proven over HTTP.
- WhatsApp, social, community and browser adapters are verified by unit tests with fakes, plus the WhatsApp reply read on real PostgreSQL. No real provider was called.
- Strict schema parity against production and every T3 item have not been run.

**Duplication and ownership check**
- Shared files changed: `emailTransport.ts` and `transportRegistry.ts` (WS-3, additive hooks), `leadOutreachActivation.ts` and `leadOutreachRecoverySweep.ts` (one argument each), `verify-schema-parity.js` (manifest entries).
- PI files changed: none. PI's functions are called unchanged.
- Schema changes: 22 migrations on this branch: 19 from the stack (written and verified earlier), one A6-10, one new table, one ported table.
- Hash pins re-pinned, because the files they guard legitimately changed: `executionPlanStore.ts`, the progression route, `emailTransport.ts`, `governance.ts` and `dispatch.ts` (from the WS-3 fix).

**Parked tests deliberately not ported:** `piEmailActivation041ae` (pins the no-default composition rule and legacy retirement, both open), and 8 individual tests marked `it.skip` with their reasons.

**Read-only probe for the owner** (one statement, safe for the Supabase console; no semicolon, no comments):

```sql
select t, to_regclass('public.' || t) is not null as exists_in_prod from unnest(array['prospect_lists','prospect_list_members','prospect_campaigns','workflows','workflow_versions','execution_instances','execution_plans','execution_plan_steps','execution_tasks','outreach_bridge_handoffs','execution_engine_requests','prospect_campaign_targets','community_action_journey_links','execution_journey_decisions','email_outreach_content_evidence']) as t
```
