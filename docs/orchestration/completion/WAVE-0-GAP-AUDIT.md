# Orchestration completion: Wave 0 gap audit

Status 2026-11-03. **For the owner's review. Nothing in it is built.** It answers the Orchestration Completion Programme brief, deliverables 1 to 12, in order. Implementation starts only on the gaps the owner approves.

Evidence is from code at `feat/orchestration-recovery` `15dc63c0`, read on 2026-11-03. **V** means verified in code. **I** means inferred. Two read-only investigators covered approvals and the AI gateway, pause and kill switches. The two findings ranked highest were re-read before being recorded here.

## 1. Baseline

| Item | State |
|---|---|
| Branch, HEAD | `feat/orchestration-recovery` at `15dc63c0`, tree `392a2927`, clean. Worktree `C:/tmp/orch-recovery` |
| Base | `origin/main` `5025f51d`, unchanged since the branch was cut |
| Ancestors of HEAD | `5025f51d`, `dc7f2ae3`, `019b6de5` (last code), `c74404c7` (contract 0.2.0 documents) |
| Not ancestors | `d682ab13`, `1edb0c90`, `eec0117d` (Outreach), `7bdd76ae` (release candidate), `845d1355` (main alignment) |
| Preservation | `refs/preserve/orch-recovery-c74404c7` (and a bundle), `refs/preserve/orch-recovery-15dc63c0`; evidence in `C:/omnivyra-archive/evidence/orch-recovery-20261101T155255Z/` |
| Nothing pushed, merged, applied or deployed | Unchanged |

The reference points in the brief are slightly off:

- `c74404c7` is this branch's commit, not Outreach's. Outreach merged it as `d682ab13`.
- Outreach's jest baseline is `fa1a5e58`, not `1fa5a58`.

Outreach has since moved to `eec0117d`, which adds `docs/outreach/platform/ARCHITECTURE-PROPOSAL.md`. That proposal routes contract requests SC-1 to SC-6 to this workstream. They are answered in section 8.

## 2. Gap matrix

Status vocabulary as in the brief. "Owner" is the code owner, not the decision owner.

### C1. Journey lifecycle

| Capability | Where | Owner | Tests (level) | Status | Gap |
|---|---|---|---|---|---|
| Enrollment eligibility, creation | `orchestration/enrollment.ts`, `campaignEnrollment.ts`, `prospectCampaigns/*`; migrations `20261226`–`20261231000000` | Orchestration | Real PG: `orch_campaign_targets` | IMPLEMENTED_AND_VERIFIED | — |
| Duplicate enrollment, re-entry | Partial unique index `uq_execution_instances_active` on occupied states (`20261228000000:181-184`); terminal run allows a new run | Orchestration | Real PG: two sessions race, one wins | IMPLEMENTED_AND_VERIFIED | — |
| State transitions, step progression | `execution_instances.lifecycle_state`, `execution_plan_steps.state` with transition triggers (`20261228000001`, `20261228000002:160-196`); DB clock `advance_execution_plan` | Orchestration | Real PG: lifecycle, contract journey | IMPLEMENTED_AND_VERIFIED | — |
| One journey state, one place | Run state in `execution_instances`; step state in `execution_plan_steps`; engine action in `execution_engine_requests`; WS-3 task state in `outreach_tasks` (engine-owned, linked by `outreach_bridge_handoffs`) | Orchestration, Outreach | Real PG | IMPLEMENTED_AND_VERIFIED | No competing journey store. The legacy `orchestration/` directory (`knowledgeOrchestrator`, `distributed/`, `publishing/`) is content orchestration from `main`, not journeys. Its name collides (J-2) |
| Pending approval, scheduled, active | Step `running` while the engine holds the action; window and frequency waits recorded (`journeyPolicy.ts:205-222`, sweeper :535-552) | Orchestration | Real PG: window tests | IMPLEMENTED_AND_VERIFIED | — |
| Reply received, follow-up cancellation | `journeyResponses.ts:30`, `journeyExit.ts` (withdraw live tasks, CAS) | Orchestration | Real PG: response matrix | IMPLEMENTED_AND_VERIFIED | Every reply ends the journey: see C5 |
| Pause and resume | Generic `PATCH /api/execution-instances/:id {lifecycleState}` (`[id].ts:78-96`); the sweeper and the bridge ignore `paused` runs (`outreachBridgeStore.ts:156`) | Orchestration | Real PG: pause by direct UPDATE only | PARTIALLY_IMPLEMENTED | **D-03:** pausing does not stop an email task already handed to WS-3. **D-07:** pause writes no audit |
| Termination, completion | `withdrawUnsentTasks` on terminal PATCH; DB completes a run when all steps settle (`20261228000002:354-374`) | Orchestration | Real PG | IMPLEMENTED_AND_VERIFIED | — |
| Error and recovery | `stuck_waiting` after 168h, `facts_unreadable`, `holdOnly`, uncertain outcomes go to a person | Orchestration | Real PG, 59 mutants | IMPLEMENTED_AND_VERIFIED | Known limits L-1 to L-6 (`contract/GAP-REGISTER.md`) |
| Concurrent events | CAS on every transition; "two sweeps at once send one message" | Orchestration | Real PG | IMPLEMENTED_AND_VERIFIED | — |
| Audit history | `execution_journey_decisions`, append-only (`20270120000000`) | Orchestration | Real PG | IMPLEMENTED_BUT_INSUFFICIENTLY_TESTED | Human lifecycle changes through PATCH are not in it (D-07) |
| Journey expiry | None (grep `expir|deadline|ttl` in sweeper, policy, stores) | — | — | MISSING | Owner: is a journey deadline wanted? Not assumed |

### C2. Next-best action

| Capability | Where | Status | Gap |
|---|---|---|---|
| Next action selection | Authored workflow steps; DB frontier; choice groups (first permitted candidate in authored order); conditions over PI facts (sweeper :335-591) | IMPLEMENTED_AND_VERIFIED (deterministic) | No AI recommendation anywhere in the line (V: no gateway or provider call reachable). "AI recommends email" in scenarios 1 and 2 does not exist |
| PI context | `individualIntelligence.ts` facts (lifecycle, score, confidence, permissions, timezone) | IMPLEMENTED_AND_VERIFIED | Reads 5 PI tables directly, not through a port (PiProspectPort, PI-owned) |
| Channel readiness | Capability declarations + `channelRefusal` + engine refusal settles and lets the next candidate act | PARTIALLY_IMPLEMENTED | No readiness read (Outreach SC-1) |
| Consent, eligibility, permissions | Central gate + `mayContact` + permission facts | IMPLEMENTED_AND_VERIFIED | No opt-in consent store (K-1, owner and counsel) |
| Capacity, credits | WS-3 quota inside the engine; no credits anywhere | BLOCKED_BY_OWNER_DECISION | C-1 / K-8 |
| Confidence, abstention, explainability | Confidence readable as a fact; unknown fact = unmet; unreadable = wait; every decision logged with reasons | PARTIALLY_IMPLEMENTED | Confidence is never weighed by the engine; there is no recommendation to abstain from |

### C3. Scheduling and sequencing

| Capability | Where | Status | Gap |
|---|---|---|---|
| Persistence, worker restart | DB clock and step state; cron `pages/api/cron/workflow-execution-progression.ts`, gated by `WORKFLOW_ORCHESTRATION_ENABLED` (:62) | IMPLEMENTED_AND_VERIFIED | Cron route unscheduled (release step, B-19) |
| Time zones | Person timezone, else window timezone (`journeyPolicy.ts:205-210`) | IMPLEMENTED_AND_VERIFIED | — |
| Duplicates, idempotency | Engine request ledger unique per task; WS-3 bridge unique per task; CAS claims | IMPLEMENTED_AND_VERIFIED | — |
| Retry | `retryability` per outcome; provider-refused = person only (S-2) | IMPLEMENTED_AND_VERIFIED | — |
| Stale recovery | Stale claim settles hold-only; 168h `stuck_waiting` | IMPLEMENTED_AND_VERIFIED | — |
| Rate limits, tenant isolation | Frequency policy per person; tenant scoping on every query and route | IMPLEMENTED_AND_VERIFIED | Batching past 25 tenants per sweep reports `workRemains` (B-22) |
| Scheduling after reply, suppression | Exit check first in every sweep; gate before every engine call | IMPLEMENTED_AND_VERIFIED | — |
| Pause propagation | See C1 | PARTIALLY_IMPLEMENTED | D-03 |
| One scheduler | Cron route plus DB clock; no second queue added | IMPLEMENTED_AND_VERIFIED | — |

### C4. Approval and authorization

| Capability | Where | Status | Gap |
|---|---|---|---|
| Human approval by default | Bridge inserts `awaiting_approval` when required (`20261229000000:371-373`); WS-3 sends only `approved`/requeued-after-approval (`governance.ts:306-312`); WhatsApp `hasApproval=false`; community adapter requires `approved_at` | IMPLEMENTED_AND_VERIFIED (journey paths) | **D-01** (main, outside journeys): community auto-rules execute AI-suggested actions with no human by default |
| Draft never authorizes | Email copy is a deterministic template (`emailContentGenerator.ts:1-31`), no drafts | IMPLEMENTED_AND_VERIFIED (journeys) | D-01, and social posts with no workspace copy publish generated content (`campaignRelease.ts:20-23`, Outreach/Content) |
| Approval bound to exact content and action | `outreach_approvals` has no content hash or revision (`20260910000000:141-153`); body rendered at send from `task.action` plus live personalization; `journeyApprovalPreview` hash computed but never stored or checked | PARTIALLY_IMPLEMENTED | **D-02** |
| Content edit after approval | `task.action` not protected by the provenance trigger | PARTIALLY_IMPLEMENTED | D-02; no writer found (I) |
| Expiry | None on WS-3 (any age); `execution_approvals` has 30 days but gates no real send | MISSING | **D-04**, decision E |
| Rejection, withdrawal, revocation | Rejection terminal; `cancelApprovalRequest` exists with no route; journey withdrawal CAS-cancels live tasks | PARTIALLY_IMPLEMENTED | Revocation of a granted approval: none |
| Roles, tenant approval | Super-admin only, with passkey step-up and capability audit (`pages/api/super-admin/outreach/approve.ts:43-64`) | BLOCKED_BY_OWNER_DECISION | Decisions A to E |
| Self-approval | No rule anywhere | BLOCKED_BY_OWNER_DECISION | Decision D |
| Platform admin visible, audited | `capability_audit_log` on approve; SUPER_ADMIN passes every `enforceRole` list (`rbacService.ts:625-628`) | IMPLEMENTED_BUT_INSUFFICIENTLY_TESTED | — |
| No bypass via retry, worker, route | All WS-3 entry points funnel through `dispatchInternalOutreachTask` (re-evaluates governance and approval, CAS claim) | IMPLEMENTED_AND_VERIFIED (WS-3) | Community execute route lets client `final_text` replace approved text (`execute.ts:111`, Outreach) |
| Contract state `AUTHORIZED` | Declared (`executionContract.ts:26`), never produced | PARTIALLY_IMPLEMENTED | D-14 |
| One approval store | Four exist on main (agent auto-approve, `execution_approvals`, WS-3, community). Orchestration added none | NOT_REQUIRED_DUPLICATE_OR_OUT_OF_SCOPE | Consolidation is J-2 / decision A, not this programme |

### C5. Reply and suppression consequences

| Event | Today | Status | Gap |
|---|---|---|---|
| Any reply (positive, negative, neutral, meeting) | Ends the journey; next task withdrawn; PI engaged. No intent classification (`outcomeInterpreter.ts:49-54` has no sentiment axis) | PARTIALLY_IMPLEMENTED | **D-08**: one consequence for all replies. Email replies are not ingested at all (operator route only; Outreach builds inbound) |
| Meeting request | `meeting_booked` outcome ends the journey; only from an operator | PARTIALLY_IMPLEMENTED | Same |
| Rejected | Ends journey; PI `not_interested`; re-enrolment refused | IMPLEMENTED_AND_VERIFIED | — |
| Unsubscribe, WhatsApp STOP | Ends journey or no longer contacts; governance written | IMPLEMENTED_AND_VERIFIED | — |
| Complaint, hard bounce | Address and person restricted; later steps skipped, never sent; run completes | IMPLEMENTED_AND_VERIFIED | Run is not marked ended on a complaint (D-09, policy) |
| SMS opt-out | No SMS engine | NOT_REQUIRED_DUPLICATE_OR_OUT_OF_SCOPE | J-9 |
| Manual suppression, prospect closure | Gate and closed-prospect check before each step | IMPLEMENTED_AND_VERIFIED | — |
| Erasure | Handoff person link SET NULL in the erasure flow (`20270113000000`) | BLOCKED_BY_OWNER_DECISION | D-2, E-1 to E-5 |
| Delayed event revives a terminal run | Terminal states are final in the trigger; events are append-only | IMPLEMENTED_AND_VERIFIED | — |

### C6. Cross-channel execution envelope

`EngineStepContext` (`engineAdapters.ts`) carries organization, run, task, plan step, channel, subject, the frozen step, person and `holdOnly`. Idempotency (`task:<id>`) and correlation (`journey:<run>/step:<step>`) are derived and verified.

| Field the brief requires | Present | Status |
|---|---|---|
| Tenant, journey, prospect references | Yes | IMPLEMENTED_AND_VERIFIED |
| Intended action, channel | Yes (step + channel) | IMPLEMENTED_AND_VERIFIED |
| Approved content revision reference | No: the step carries a free `instruction` | MISSING (Outreach SC-3; owner GD-1) |
| Authorization and approval reference | No: approval lives inside each engine | MISSING (D-02) |
| Idempotency, correlation | Yes | IMPLEMENTED_AND_VERIFIED |
| Execution timing and expiry | `now` only | MISSING (decision E) |
| Policy context | `holdOnly` | PARTIALLY_IMPLEMENTED |
| Result and event correlation | Ledger `external_ref`, normalized result with `certainty` | IMPLEMENTED_AND_VERIFIED |
| Outcomes for engines other than WS-3 | No store (`outreach_outcomes.task_id` NOT NULL) | MISSING (G-4, Outreach SC-4) |

### C7. AI gateway

| Check | Finding | Status |
|---|---|---|
| Orchestration AI calls | None in the journey line (V: grep over the line and every module it imports) | IMPLEMENTED_AND_VERIFIED (vacuously) |
| Asset generation under `orchestration/asset-generation` | Reaches `runCompletionWithOperation` through the creator runtime, not through `runBilledAiCompletion` (I: the gateway re-checks billing) | NOT_REQUIRED_DUPLICATE_OR_OUT_OF_SCOPE (content, not journeys) |
| Cache isolation | Exact key has no tenant or prospect on the platform key, and normalisation replaces UUIDs; near-match is tenant-scoped but not prospect-scoped (Jaccard 0.80) | Latent; **D-10** for any future journey AI call |
| AI cannot authorize | No AI anywhere on the authorization path | IMPLEMENTED_AND_VERIFIED |

### C8. Pause and kill switches

| Control | Checked before the provider call | Status | Gap |
|---|---|---|---|
| Global (`LEAD_OUTREACH_EXECUTION_DISABLED`, `WORKFLOW_ORCHESTRATION_ENABLED`, `LEAD_OUTREACH_EMAIL_ENABLED`) | Sweeper gate; WS-3 dispatch; email transport | IMPLEMENTED_AND_VERIFIED | — |
| Tenant enabled, tenant kill switch, channel enabled | Sweeper gate per step; WS-3 dispatch | IMPLEMENTED_AND_VERIFIED | **D-07**: no route writes `kill_switch` and no audit trigger exists, so it is a database edit today |
| WhatsApp queued batch | Re-checked at send on Outreach's branch (`0bd12963`), not on this one | IMPLEMENTED_BUT_NOT_INTEGRATED | Lands with the Outreach merge |
| Community | Platform `execution_enabled` and guardrail re-checked in `executeAction` | IMPLEMENTED_AND_VERIFIED | L-3 (opt-out after approval), Outreach |
| Journey pause | Sweeper and bridge honour it; WS-3 send path does not | PARTIALLY_IMPLEMENTED | D-03 |
| `execution_controls` / `GTM_EXECUTION_ENABLED` | Used only by the dry-run `executionBridge` | NOT_REQUIRED_DUPLICATE_OR_OUT_OF_SCOPE | A second control system; do not adopt (J-2) |
| Resume revives expired or suppressed actions | Next sweep re-applies exit, closure, gate, permission and frequency checks (I) | IMPLEMENTED_BUT_INSUFFICIENTLY_TESTED | Test missing (T-03) |

## 3. Must not be rebuilt

These exist, are tested on real PostgreSQL and fit the brief. Extend them; never replace them.

- **Journey state:** `execution_instances`, `execution_plans`, `execution_plan_steps`, `advance_execution_plan`, `uq_execution_instances_active`.
- **Decisions:** the sweeper, `journeyPolicy`, `journeyGovernance.channelRefusal`, `journeyDecisionLog` / `execution_journey_decisions`.
- **Execution:** `EngineAdapter`, the five adapters, `execution_engine_requests` (one idempotency space), `executionContract.ts` normalisation with `certainty`.
- **Responses and exit:** `journeyResponses`, `journeyExit`, `journeyFeedback`, PI's `outcomeLifecycleProducer`.
- **Reporting and events:** `journeyReport`, `journeyEvents` (read-only cursor).
- **Approvals:** WS-3 `outreach_approvals` and `dispatchInternalOutreachTask`; `journeyApprovalPreview`.
- **Governance:** `contact_governance_records`, `mayContact`, `outreach_governance_config`.
- **Shared services:** the AI gateway and `runBilledAiCompletion`; the credit RPCs.

## 4. Ownership and shared files

| File or object | Owner | Others change it only through |
|---|---|---|
| `executionContract.ts`, `engineAdapters.ts`, `*EngineAdapter.ts`, `workflowProgressionSweeper.ts`, `journey*.ts`, `enrollment.ts`, `campaignEnrollment.ts` | Orchestration | Proposal to Orchestration |
| `pages/api/execution-instances/*`, `pages/api/workflows/*`, `pages/api/prospect-campaigns/*`, `executionInstanceStore.ts`, `workflowStore` | Orchestration | Same |
| Migrations `20261226`–`20261231*`, `20270113000000`, `20270120000000` | Orchestration (renumber under GD-4) | Release coordinator |
| `leadOutreachExecution/*` (WS-3 dispatch, approval, governance), `emailEngine/emailSendPath.ts`, `emailTransport.ts` | Outreach (WS-3 email) | Agreement with Outreach |
| `emailEngine/emailExecutionContext.ts` | Shared: it reads the orchestration handoff for the email engine | Both |
| `whatsappBroadcastService.ts`, community executor and scheduler, social pipeline, RPA | Outreach | Agreement |
| `contact_governance*`, `individualIntelligence` source tables, `providerCapabilityModel.ts`, `outcomeLifecycleProducer` | PI | Agreement |
| AI gateway, `aiResponseCache.ts` | AI Gateway owner | Defect report |
| Credit RPCs, catalogue | Billing | Defect report |

## 5. Defects and gaps, ranked

| ID | Severity | Gap | Type | Owner of the fix | Needs |
|---|---|---|---|---|---|
| D-01 | Critical, live on main | Community auto-rules execute AI-suggested actions with `requires_human_approval:false` (`communityAiAutoRuleService.ts:521-535`). The platform policy defaults `auto_rules_enabled` to true and `require_human_approval` to false (`community-ai-policy.ts:112-119`). Ad-hoc engagement routes insert actions as already approved (`communityAiActionExecutorRuntime.ts:384-407`) | Defect against safety rules 2 and 3 | Outreach (community), platform policy owner | Owner decision now; production measurement (O-2) to size it |
| D-02 | High | Approval does not bind content: no hash or revision on `outreach_approvals`; the body renders at send from mutable `task.action` and live personalization; the preview hash is never stored or checked. Community execute accepts replacement text | Incomplete integration | Orchestration (preview, envelope) with Outreach (WS-3 approval, dispatch) | GD-1 and decision A; contract change P-2 |
| D-03 | High | Pausing a journey does not stop an email task already handed to WS-3: it can still be approved and sent. The send path reads the handoff but not the run's state | Defect | Orchestration, in the shared `emailExecutionContext.ts`; Outreach agrees | None beyond agreement |
| D-04 | High | WS-3 approvals never expire | Missing | Outreach (WS-3), semantics Orchestration | Decision E |
| D-05 | High | Only a platform super-admin can approve a journey email | Missing capability | Orchestration (semantics), Outreach (route, UI) | Decisions A to D |
| D-06 | Medium | Resume after a suppression or closure is not proven to act on nothing | Missing test | Orchestration | None |
| D-07 | Medium | Journey pause, resume and cancel (PATCH) and tenant kill-switch changes write no audit; no route sets the kill switch | Incomplete integration | Orchestration (PATCH audit); WS-3 governance owner (kill-switch route) | Agreement for the kill-switch route |
| D-08 | Medium | Every reply ends the journey; no intent; email replies not ingested | Missing capability | Orchestration (consequence policy), Outreach (inbound), AI gateway (classification) | Owner: reply consequence policy and whether AI classification is in scope |
| D-09 | Low | A complaint stops all contact but does not end the run | Policy | Orchestration | Owner: end or let complete |
| D-10 | Medium, latent | AI cache keys carry no tenant (platform key) or prospect; personalised output could be served across prospects | Defect in a shared service | AI Gateway owner | Report; any journey AI operation must be uncached until fixed |
| D-11 | Medium | No engine charges credits | Blocked | Billing, Outreach, Orchestration (`ExecutionUsage`) | C-1 |
| D-12 | Medium | No AI recommendation, no DecisionProposal; confidence never weighed | Missing capability | Orchestration with AI layer | Owner: scope and cost |
| D-13 | Medium | Envelope lacks content revision, authorization reference and expiry | Missing | Orchestration, Outreach | Contract proposal, section 8 |
| D-14 | Low | `AUTHORIZED` declared and never produced | Defect (contract hygiene) | Orchestration | With P-2 |
| D-15 | Low | `outcomeInterpreter.ts` header says "deliberately unwired" but it is called | Stale comment | PI | Note to PI |

Not orchestration's, recorded so nothing is lost: L-3 and L-4 (Outreach, on its branch's plan); WhatsApp direct routes gate on role only and likely return 400 (WA-1); social posts with no workspace copy publish generated content (Outreach, Content); four approval stores and the `execution_controls` system (J-2).

## 6. Agent assignments and worktree boundaries

The machine has 4 CPUs and 16 GB, and typecheck takes about 8 GB. **At most two implementation agents at once; one typecheck and one real-schema run at a time.** Seven agents, as the brief lists, would contend for the same files and the same memory. Their scopes are merged below where the work is small.

| Agent | Scope | Worktree, branch off `15dc63c0` | Files | Starts when |
|---|---|---|---|---|
| B (scheduling, pause) | D-03, D-06, orchestration half of D-07 | `C:/tmp/orch-w1-pause`, `orch/w1-pause-propagation` | `emailExecutionContext.ts` (shared, Outreach agrees), `pages/api/execution-instances/[id].ts`, `executionInstanceStore.ts`, new real-schema tests | Outreach agrees on the shared file |
| A + G (lifecycle and tests) | Scenario tests that need no decision: S3 recovery sweep cannot revive a withdrawn task; S5 pause with a bridged task (fails until B lands); S6 an `awaiting_approval` task never dispatches; resume after suppression | `C:/tmp/orch-w1-tests`, `orch/w1-scenario-tests` | `backend/tests/realschema/orch_*` only | Now, after approval of this plan |
| C (approval binding) | D-02, D-04, D-14 | `orch/w1-approval-binding` | `journeyApprovalPreview.ts`, `executionContract.ts`, plus WS-3 approval and dispatch (Outreach) | GD-1, decisions A and E, contract P-2 agreed |
| D (next-best action) | D-12, D-08 classification | `orch/w2-decision-proposal` | New module under `orchestration/`, gateway operation registration | Owner scope decision; D-10 fixed or operation uncached |
| E (contract) | Section 8 proposals | Documents only until agreed | `contract/*` | Now (documents) |
| F (gateway, kill switch) | D-10 report; kill-switch route and audit with the WS-3 governance owner | No code in this workstream | — | Now (report) |

No two agents edit the same file. `executionContract.ts` changes only in C, after the contract is agreed.

## 7. Dependency graph and sequence

```
Owner: approve this plan ──┬─► A+G scenario tests (now)
                           ├─► E contract proposals (documents) ──► Outreach agrees ──► C approval binding ◄── GD-1, A, E
                           ├─► F reports (D-10 to gateway; kill switch to WS-3 governance)
Outreach agrees on shared file ──► B pause propagation ──► S5 test turns green
Owner: D-01 decision (community auto-rules) ──► Outreach fixes on its branch
Owner: reply policy, AI scope, C-1 ──► D next-best action and reply classification (Wave 2)
All Wave 1 branches ──► Wave 2 sequential integration on the landing base (J-7: 845d1355 or 7bdd76ae) ──► T2
```

Wave 1 can run without any owner decision for: the A+G tests, the E documents, the F reports and, once Outreach agrees, B. Everything else waits on a decision.

## 8. Proposed contract changes (0.3.0, additive)

Each is a proposal. Nothing is written until Orchestration and Outreach agree, and PI where named.

| ID | Change | Answers | Compatible |
|---|---|---|---|
| P-1 | Optional `contentRef { kind: 'content_revision', id, hash }` on the authored step and on `EngineStepContext`; `instruction` stays for existing steps | Outreach SC-3; D-13 | Yes: absent means today's behaviour |
| P-2 | Optional `authorization { approvalRef, approvedHash, expiresAt }` on `EngineStepContext`; engines refuse with `approval_stale` when the content hash no longer matches or the approval has expired; `AUTHORIZED` produced when an approval of record matches | D-02, D-04, D-14 | Yes, behind the decision on expiry (E) |
| P-3 | Optional `notAfter` on `EngineStepContext`: the engine must not begin an action after it | Expiry in the brief | Yes |
| P-4 | Channel readiness read type, derived from existing declarations, `channelRefusal`, provider configuration and connection state, with no new enum | Outreach SC-1 (with PI SC-2) | Yes |
| P-5 | Outcome keyed by engine request, for engines other than WS-3 | Outreach SC-4; G-4 | Needs a migration; Orchestration and Outreach |
| P-6 | Webhook verification contract and test kit (document plus tests, no framework) | Outreach SC-5 | Yes |

SC-6 (channel vocabulary and STOP scope across channels) needs an owner decision before any contract text.

## 9. T1 acceptance per workstream

| Agent | T1 |
|---|---|
| B | Unit: the email send path defers, without sending or changing the task, when the handoff's run is `paused`, and sends when `active`. PATCH writes one decision-log row per lifecycle change, with the actor. Typecheck (`npm run typecheck`, one at a time). A mutant that removes the run check fails a test |
| A+G | Each new scenario test fails on a mutant of the behaviour it pins (one mutant per test, recorded) |
| C | Unit: a changed `task.action` after approval refuses with `approval_stale`; an expired approval refuses; a matching approval produces `AUTHORIZED`; no existing contract test changes meaning |
| D | Unit: insufficient evidence abstains; the gateway is the only model path (import closure test); a recommendation never reaches an engine without the gate and approval; the gateway down yields abstention |
| E | Contract tests for each agreed proposal; every existing adapter passes the declaration check unchanged |

## 10. T2 and end-to-end plan

T2 runs once, after Wave 2 integration, on the landing base the owner chooses (X-01 in the control tower: `845d1355` or `7bdd76ae`).

1. Full real-schema suite on a rebuilt disposable database; build count of migrations and tables recorded.
2. The five orchestration suites plus Outreach's `outreachFutureEngineCompatibility` and `orchestrationCommunityAdapterGates` on the combined branch.
3. `typecheck-ci` and the worker typecheck; route auth, route policy, migration quality, schema drift.
4. Whole-repo jest against **one** baseline re-recorded at the landing base. Outreach's (`fa1a5e58`) and this branch's (`5025f51d`) are not compared with each other.
5. Mutants re-run for every changed behaviour.

Scenarios from the brief, with stubbed or recording providers:

| # | Scenario | Today | Plan |
|---|---|---|---|
| 1 | Enter, recommend email, approve, request, result, state | Covered without the AI recommendation (`orch_contract_journey`) | AI part waits on D-12 |
| 2 | Reply, correlate, intent, next action | Correlation covered; intent missing; email replies not ingested | Waits on D-08 and Outreach inbound |
| 3 | Unsubscribe, suppression, terminate, cancel, retry cannot revive | Covered except the recovery-sweep revival test | A+G adds it |
| 4 | Ambiguous WhatsApp acknowledgement | Interrupted submission stays uncertain (covered); lost queue acknowledgement is L-4 | Outreach L-4, then a combined test |
| 5 | Pause, withdraw or block, resume restores eligible | Fails today for a bridged email task | B fixes; A+G pins |
| 6 | Draft never sends before approval | Journey email has no drafts; approval required (covered) | A+G adds the `awaiting_approval` never-dispatches test |
| 7 | Channel unhealthy, alternative only if permitted | An engine decline lets the next authored candidate act (covered) | Readiness read waits on P-4 |
| 8 | Gateway unavailable, abstain | Not applicable: no AI in the line | Part of D |

## 11. Owner decisions

1. **D-01:** turn off community auto-rule execution without a human, or require `require_human_approval` by default, and measure production use (O-2). Live on main; not orchestration code.
2. **Approve this Wave 0 plan** and the two-agent limit.
3. **GD-1 and tenant approval A to E**, including expiry and self-approval (D-02, D-04, D-05).
4. **Reply consequence policy:** which replies end a journey, pause it for a person, or continue (D-08); and whether a complaint ends the run (D-09).
5. **AI in journeys this phase:** next-best-action recommendations and reply classification (D-12, D-08), and their cost under C-1.
6. **Journey expiry:** is a run deadline wanted at all?
7. **Kill-switch route ownership** (D-07): WS-3 governance or Orchestration.
8. Existing, still open: J-7 landing base, F-1/F-2 actor rule, E-1 to E-5, K-1 consent, C-1 credits, AU-1 (autonomy stays disabled).

## 12. Blockers and release status

**NO-GO, unchanged.** Nothing here changes production readiness. All providers stay stubbed; no migration is applied anywhere real; nothing is pushed or merged.

Blocking the programme's own work: D-01 is outside this workstream but is the most serious finding; C and D wait on owner decisions; B waits on Outreach's agreement for one shared file; Wave 2 waits on the landing-base decision (J-7).
