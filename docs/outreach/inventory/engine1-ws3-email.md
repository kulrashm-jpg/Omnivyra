# Engine 1 inventory: WS-3 lead outreach / email

Refs: `feat/orchestration-recovery` dc7f2ae3 (worktree `C:/tmp/orch-recovery`, abbreviated "branch"), `origin/main` 5025f51d ("main"). All paths are relative to the worktree. Read-only: no jest, tsc, npm, network, or `.env*` read. Nothing here was executed, so every claim is from code reading or a `git` command.

## Honest status

**The engine is built and runs on a real schema against a recording provider. It has never sent through a real provider in any test in this repo. Real sends remain off.** Two behaviours contradict the adapter contract and would matter on the day the flag is turned on (G-1, G-2). Blockers B-3, B-4, B-5, B-15 and B-16 all still hold; B-15 and B-16 are wider than recorded.

Verification levels used below: **local** (unit with fakes), **recording** (real PostgreSQL via SQL adapter, recording provider, fake Redis), **sandbox** (real provider sandbox), **production**. No capability in this engine reaches sandbox or production by any evidence in the repo (`docs/orchestration/VERIFICATION-AND-BLOCKERS.md:16,47,70-76` agree).

Production schema and environment state are **unmeasured** in this work. I had no access and did not try.

---

## 1. Capability table

"Main" means present at 5025f51d. "Branch" means only on the recovery branch. All branch-only commits are ancestors of dc7f2ae3.

| Capability | Classification | State | Where | File:line, symbols | Migrations | Tests (fake / real PG) | Ancestry |
|---|---|---|---|---|---|---|---|
| Task model, lifecycle, append-only audit | IMPLEMENTED AND VERIFIED (recording) | integrated | main | `leadOutreachExecution/types.ts:30-47`, `lifecycle.ts:54-72`, `storage.ts:308-325` `transitionOutreachTaskState` | 20260910000000 (append-only trigger :272-285), 20260913, 20260915 | `ws3Milestone1/3` unit (fake); `pi_email_send_path_041a`, `orch_journey_lifecycle` (real PG) | c60e15d0 on main |
| Dispatch runtime | IMPLEMENTED AND VERIFIED (recording) | integrated | main; requeue logic branch only | `leadOutreachExecution/dispatch.ts:184-401` `dispatchInternalOutreachTask` | 20260913, 20260914 | `ws3Milestone5a/5b`, `ws3RequeuedDispatch` (fake); `orch_response_matrix` two concurrent sweeps (real PG) | cb0e3419 branch only; main's version has no requeue path |
| Bridge (execution task to `outreach_tasks`) | IMPLEMENTED AND VERIFIED (recording) | integrated | branch | `outreachBridge/outreachBridgeStore.ts:263-345` `bridgeExecutionTask`; RPC `bridge_execution_task` | 20261229000000 (:285, status :372), 20270113000000 | `piOutreachBridge040` (fake); `a6_10_bridge_person_erasure`, `orch_*` (real PG) | Branch; 5-line delta from pi-consol |
| Orchestration adapter | IMPLEMENTED AND VERIFIED (recording) | integrated | branch | `orchestration/engineAdapters.ts:175-256` `createWs3Adapter` | none | `orchestrationEngineContract`, `orchestrationVerticalSlice` (fake); `orch_journey_lifecycle`, `orch_response_matrix` (real PG) | a25abddc, 9daf1cc5 |
| Certified Email Engine | IMPLEMENTED AND VERIFIED (recording) | integrated | branch | `emailEngine/workflowEmailDispatch.ts:85`, `emailSendPath.ts:77,124` | 20270120000001 | `piEmailSendPath041a`, `piEmailResolution041a`, `piEmailSendBoundary041a` (fake); `pi_email_send_path_041a` (real PG, fake provider :191) | `git diff refs/preserve/wt/pi-consol HEAD` empty for all 5 engine files |
| Recipient resolution | IMPLEMENTED AND VERIFIED (recording) | integrated | branch | `emailEngine/emailExecutionContext.ts:176-226`: one candidate, `unified_persons.primary_email`, tenant-scoped, fails closed | none | same as above | same |
| Content rendering | PARTIALLY IMPLEMENTED | integrated | branch | `emailEngine/emailContentGenerator.ts:119-159`: `{{field}}` substitution; subject is the first line of the instruction, and body is the whole instruction including that line. No template entity or `gtm_messages` read (J-5 deferred) | none | `pi_email_send_path_041a` | same |
| Content evidence, written before provider | IMPLEMENTED AND VERIFIED (recording) | integrated | branch | `emailEngine/emailContentEvidenceStore.ts:108`, `emailTransport.ts:257-278` | 20270120000001 (:69; guard :153 is `BEFORE INSERT OR UPDATE`) | `pi_email_send_path_041a` | same |
| Template catalog (`ses/email-templates`) | Not applicable to outreach | superseded / ancestor | main; one preserve snapshot | `refs/heads/ses/email-templates` 9a786aab is an ancestor of HEAD. `refs/preserve/wt/ses-email-templates` 8cfd6d81 is NOT: it adds a creator-content escalation template and edge changes, unrelated to outreach | none | n/a | parked, unrelated |
| Sender path | PARTIALLY IMPLEMENTED | integrated, single sender | main | `send-transactional-email/index.ts:392,409`: global `EMAIL_FROM` for every tenant. `companyId` and `idempotencyKey` are sent by `emailTransport.ts:118-119` and ignored by the function. No `ReplyToAddresses` | none | `sendTransactionalEmailLeadOutreach`, `outreachEmailFunctionContract` (fake) | 96768805 |
| Tenant sending domains (W4) | IMPLEMENTED — INTEGRATION REQUIRED | parked in main, disabled, unwired | main | `sendingDomains/sendingDomainService.ts:467` `validateSender`, comment :465 "Not wired into any send path yet". Routes `pages/api/sending-domains/*`. Adapter off unless `SENDING_DOMAINS_SES_PROVIDER=sesv2` (`sesV2IdentityAdapter.ts:202`). `sendingDomainRefreshWorker` has no non-test caller | 20261220000000 (:55) | `w4*` unit (fake port) | w4 3aa8e4a4 ancestor of main. **`C:/tmp/w4-sending-domains` no longer exists; memory and my brief are stale** |
| SES v2 send (edge function) | BLOCKED BY EXTERNAL DEPENDENCY | integrated, deployment unmeasured | main | `index.ts:391-426` `sendOutreachViaSESv2`; v1 for other templates :326 | none | contract tests only; no real SES call | 96768805 |
| Edge function caller auth | IMPLEMENTED — NOT VERIFIED (provider) | integrated | main | `send-transactional-email/auth.ts:66`; `--no-verify-jwt` deploy, manual (`index.ts:29`); no `functions deploy` in `.github`, `scripts`, `package.json` | none | `sendTransactionalEmailAuth` | main |
| SNS webhook and signature check | IMPLEMENTED — NOT VERIFIED | integrated, inert without env | main | `pages/api/webhooks/ses.ts:161-257`, `providerEvents/snsSignature.ts:121,91,177,201` | none | `wp3SesWebhook` (real RSA, fake DB, fake certificate fetch). No real AWS message | 96768805 |
| SNS subscription confirmation | PARTIALLY IMPLEMENTED | blocks setup | main | `ses.ts:230-235` logs only type and messageId. **`docs/pmo/ENG-003-IMPLEMENTATION-REPORT.md:105` says an operator confirms "by visiting the `SubscribeURL`", but the URL is not logged or stored** | none | `wp3SesWebhook:355` asserts no fetch only | main |
| Bounce processing | IMPLEMENTED — INTEGRATION REQUIRED | integrated | main | `sesEventNormalizer.ts`, `sesProviderEventIngestion.ts:48-133`: permanent gives `bounce_hard`, address, `email` | 20261003000000, 20260915 | `orch_response_matrix` (real PG, direct call, no HTTP), `wp3SesWebhook` | main |
| Complaint processing | IMPLEMENTED — INTEGRATION REQUIRED | integrated | main | Same; `complaint`, `*`, target and person. Signal is `delivered` (no complaint outcome type) | same | same, including replay | main |
| Unsubscribe link and route | IMPLEMENTED — INTEGRATION REQUIRED | integrated, needs key | main | `backend/security/outreachUnsubscribeToken.ts:129,159` (AES-256-GCM), `pages/api/outreach/unsubscribe.ts:71` (GET writes nothing), `unsubscribeService.ts:59`, `supabase/.../unsubscribe.ts:28,62` | contact governance tables | `wp3OutreachUnsubscribeToken`, `wp3UnsubscribeFlow` (fake); `orch_response_matrix` service (real PG) | main |
| Delivery event ingestion | IMPLEMENTED — INTEGRATION REQUIRED | integrated | main | `feedbackIngestion.ts:285-322`, `providerMessageResolver.ts:72` | 20260915 (:58,:81) | `ws3Milestone7` (fake), `orch_response_matrix` (real PG) | main |
| Retry | PARTIALLY IMPLEMENTED | integrated, unsafe edge | branch | No scheduled retry. Re-dispatch allowed only by `dispatch.ts:129,140-155`. Classification defect in G-1 | none | `ws3RequeuedDispatch` (fake). **The register's "Unknown send result: never retried" row cites `orch_engines_real:246`, which is a WhatsApp test; I found no real-schema email equivalent** (grep of the three `orch_*` suites) | cb0e3419 |
| Idempotency, local | IMPLEMENTED AND VERIFIED (recording) | integrated | main + branch | CAS claim `dispatch.ts:240,255`; `outreach_attempts_unique`; `uq_outreach_attempts_idempotency` (20260914:30); bridge unique | 20260910, 20260914, 20261229 | `orch_response_matrix` | main + branch |
| Idempotency, at provider | MISSING | n/a | n/a | `transport.ts:112-119` calls the key "the last line of defence". Edge function never reads it, SES has no such parameter in the call, and `duplicate` is never returned (`index.ts:531`) | none | none | n/a |
| Approval | PARTIALLY IMPLEMENTED | integrated, super-admin only | main (submit by adapter is branch) | `approval.ts:172,226,262,266,195`; route `pages/api/super-admin/outreach/approve.ts`. **`rejectOutreachTask` and `cancelApprovalRequest` have no route caller**; no route lists awaiting tasks; no UI | 20260910 | `ws3Milestone3` (fake); `closure009` (fake); real-PG uses direct approve fixtures. Skipped: `pi_email_send_path_041a:952,994` (PI-041-A-H) | main |
| Quota counter | IMPLEMENTED — NOT VERIFIED | integrated | main | `quota.ts:134,180,233,255`. Redis is mocked in every real-schema suite (`orch_response_matrix:36`) | none | fake Redis everywhere | c60e15d0. pi-consol has a parked person-keyed version |
| Suppression at send | IMPLEMENTED AND VERIFIED (recording) | integrated | main | `governanceService.ts:192` (`outreach_suppressions`), `:256-360` (`contact_governance_records`, recipient owner), `governance.ts:209-277`. `suppression_entries` deliberately not read (:31) | 20260912:53, 20261003:68 | `w2b*`, `li3*`, `orch_response_matrix` | main |
| Kill switches | IMPLEMENTED AND VERIFIED (recording) | integrated | main | `LEAD_OUTREACH_EXECUTION_DISABLED` `governanceService.ts:120`; tenant `outreach_governance_config` `governance.ts:178-194` | 20260912:20 | `ws3Milestone4`, `orch_response_matrix` | main |
| Email transport flag | IMPLEMENTED AND VERIFIED | disabled | main | `emailTransport.ts:42-45,196` | none | `pi_email_send_path_041a:1039,1266` (fake provider) | main |
| Operator reply recording | PARTIALLY IMPLEMENTED | integrated, API only | main | `pages/api/outreach/outcomes.ts:98,182`. No frontend caller (`git grep outreach/outcomes` in pages, components, hooks, lib: comments only) | 20260915 | `piP1W09DManualOutcomeRoute` (fake); `orch_response_matrix` (real PG) | main |
| Inbound email reply detection | MISSING | n/a | n/a | No SES receipt rule, inbound route or `Reply-To` in `supabase/functions`, `emailEngine`, `leadOutreachExecution`; `git log --all -S ReplyToAddresses -- supabase/functions` empty | none | none | not on any ref checked |
| `rejected` outcome writer | MISSING (B-9) | n/a | n/a | `feedbackIngestion.ts:71-76` excludes it; `outcomes.ts:83` excludes it | none | test inserts row directly | n/a |
| Evidence erasure (B-3) | MISSING | design only | n/a | `git grep`/`grep -rl email_outreach_content_evidence` hits only the store, parity script, migration and rollback. RC `7bdd76ae`: no hit in migrations. `personErasure.ts:54` | none | none | design at `docs/orchestration/EMAIL-EVIDENCE-ERASURE-DESIGN.md` |
| Outreach retention (B-4) | MISSING | n/a | n/a | `backend/types/retention.ts:1-12` no outreach target; `personErasure.ts:58-59` | none | none | n/a |
| Usage / credit accounting | MISSING | n/a | n/a | No credit call in `leadOutreachExecution` or `emailEngine` (grep). `RECOVERY-BASELINE.md:46` agrees | none | none | n/a |
| Stale `dispatching` recovery | MISSING | n/a | n/a | Only writers/readers are `dispatch.ts`, `engineAdapters.ts:240`; `health.ts` has no match; `listQueuedOutreachTasks` reads `queued` only | none | none | n/a |
| Recovery sweep | IMPLEMENTED AND VERIFIED (local) | disabled, unscheduled | branch | `leadOutreachRecoverySweep.ts:120`, `pages/api/cron/outreach-dispatch-recovery.ts`; `LEAD_OUTREACH_RECOVERY_SWEEP_ENABLED`; internal only | none | `ws3RecoverySweep`, `ws3RecoverySweepRoute` (fake) | 8734b780 |
| Telemetry, failure taxonomy | IMPLEMENTED — NOT VERIFIED | integrated | main | `telemetry.ts`, `failureTaxonomy.ts:103`, `health.ts` | none | `ws3Milestone6` (fake) | main |
| Guarded execution email connector | MOCKED / FAKE (dry-run only) | duplicated, dry-run | main | `execution/emailExecutionConnector.ts:1-8`, `executionBridge`, `pages/api/lead-intelligence/execution.ts` | 20260727030000 | existing unit suites | main |

---

## 2. Providers and adapters

```
sweeper → createWs3Adapter (branch)
            ├ internal → dispatchInternalOutreachTask → internalTransport
            └ email → emailPreflight → bridgeExecutionTask → submitForApproval
                     → dispatchWorkflowEmailTask → sendEmailForOutreachTask
                     → dispatchInternalOutreachTask (channel generic)
                       governance → claim → quota → attempt
                     → createEmailTransport(engine composition)
                       flag → recipient → unsubscribe token → render → evidence
                     → EmailProviderPort: supabaseEdgeEmailProvider  (name supabase_edge_ses)
                     → functions.invoke('send-transactional-email', {type:'lead_outreach'})
                     → SESv2 SendEmail, EMAIL_FROM, SES_CONFIGURATION_SET
SES → SNS → POST /api/webhooks/ses → ingestSesEvent → ingestFeedback + recordContactGovernance
```

- One port, one real implementation, `emailTransport.ts:104`. Fakes implement the same port in tests.
- Registry is one process-global map, last write wins (`transport.ts:88-93`). `placeholder` composition remains for WS-3 harnesses (`transportRegistry.ts:27-46`).
- Region: `AWS_SES_REGION`. The v1 path still hard-fails on anything except `eu-north-1` under a "temporary diagnostic" (`index.ts:345-354`), and every request logs region variables (`:444-453`). The v2 path has no such assertion. W4 has its own `SES_SENDING_REGION` constant in `sesIdentityPort`.

---

## 3. Routes, queues, consumers, accounting, and other ways in

| Kind | Item | Auth / gate | Where |
|---|---|---|---|
| Cron | `pages/api/cron/workflow-execution-progression.ts` | `CRON_SECRET`, `WORKFLOW_ORCHESTRATION_ENABLED`; not in `vercel.json` | branch |
| Cron | `pages/api/cron/outreach-dispatch-recovery.ts` | `CRON_SECRET`, `LEAD_OUTREACH_RECOVERY_SWEEP_ENABLED`; not in `vercel.json` | branch |
| Route | `POST /api/super-admin/outreach/activate` | `OUTREACH_PLATFORM_MANAGE`, platform write; refuses body `recipient` | main |
| Route | `POST /api/super-admin/outreach/approve` | same | main |
| Route | `POST /api/outreach/outcomes` | `requireTenantAccess`; any active member | main |
| Route | `GET/POST /api/outreach/unsubscribe` | token; rate limited, fallback on Redis failure | main |
| Route | `POST /api/webhooks/ses` | SNS signature, topic allow-list, age window | main |
| Route | `pages/api/sending-domains/*` | `INTEGRATION_MANAGE` | main |
| Queue / worker | None. Durable state machine only (`leadOutreachActivation.ts:29-32`). BullMQ is used for the Redis client only | | |
| Producers | `outreach_outcomes` from `feedbackIngestion`; delivery evidence from `dispatch.ts:336` and `feedbackIngestion.ts:288` | | |
| Consumers | `journeyResponses.ts:30` (exit), `journeyFeedback.ts:35` and `outcomeLifecycleProducer` (PI), `feedbackSummary`, `prospectOutcomes/corpus`, `lifecycleReader.ts:196` | | |
| Accounting | Attempt count quota only. No credits, no cost | | |

**Reached other than through the adapter:** activate route; recovery sweep; `scripts/ws3-m6*`, `scripts/ws3-m8/*`, `scripts/ws6a-activation-proof.ts`. None can reach a provider with a recipient in production code: see section 8.

**Doc contradiction:** `workflow-execution-progression.ts:21-22` says a disabled transport is reported as `tasks_disabled`. That name appears nowhere in the sweeper (grep); the adapter returns `skipped_transport_disabled` with disposition `wait`.

---

## 4. Compliance matrix, 18 contract fields

| Field | Status | Where / from what |
|---|---|---|
| Engine identifier | Satisfied | `'ws3'`, `engineAdapters.ts:65,180` |
| Capability declaration | Mappable | Adapter has `channels` only; richer data in `channelCapabilityModel.ts:180-200`, which already marks send `NOT_CONFIGURED` |
| Supported channels, action types | Partly | `['internal','email']` `:181`. No action-type declaration; mappable from `task.kind` |
| Authorization context | Partly | Tenant in context. Approval, governance internal. Approver in `outreach_approvals`. No authorization object passed in or returned |
| Tenant and prospect references | Satisfied | `organizationId`, `subject`, `personId`; `outreach_tasks.company_id`, handoff `subject_kind/id` |
| Workflow and journey references | Satisfied | `executionInstanceId`, `planStepId`; handoff carries campaign, workflow, version, instance, plan, step |
| Recipient / destination | Satisfied, internally | `resolveEmailRecipient`; not exposed on the result, correctly |
| Rendered content / payload | Satisfied | `email_outreach_content_evidence`. Footer is added at the edge and is not in evidence (`index.ts:298-311`) |
| Idempotency key | Satisfied locally, not at provider | `executionTaskId`, `buildIdempotencyKey` `transport.ts:120`, recorded on attempt. **Per attempt, so a re-dispatch gets a new key** (G-3) |
| Correlation ID | Mappable | `executionTaskId` to `outreachTaskId` to `attemptId` to `provider_message_id`. No single field on the result |
| Execution request | Satisfied | `EngineStepContext`, `TransportRequest` |
| Execution result | Satisfied | `EngineResult`, `DispatchResult` |
| Delivery status | Mappable | `outreach_tasks.delivery_status`, evidence; not on `EngineResult` |
| Error classification | Partly | `reason` code plus `failureTaxonomy.ts`; taxonomy is telemetry only and is not returned. Classification defect G-1 |
| Retryability | Missing as a field | Implied by `disposition` and `redispatchProblem`. `needs_human` on `rejected` is not honoured by the next sweep (G-2) |
| Usage and credit | Missing | Attempt count only. `limiterLayer` on the attempt |
| Outcome event | Mappable | `outreach_outcomes` and delivery evidence; pulled by `journeyResponses`/`journeyFeedback`, no push event |
| Audit metadata | Satisfied | `outreach_decisions`, `outreach_approvals`, `outreach_attempts` (versions, limiter), evidence. Weak spots G-5, G-9 |

---

## 5. Status mapping

Source fields: task status (T), delivery status (D), dispatch outcome (O), adapter disposition.

| Contract status | Mapping | Honest? |
|---|---|---|
| REQUESTED | T `pending` | Yes |
| AUTHORIZED | T `approved`; needs an `allowed` decision too | Partly: `approved` is human approval only. Governance is re-evaluated at dispatch, so full authorization exists only transiently in that call |
| QUEUED | T `queued` | **Partly.** `queued` also means "returned after a failed, disabled or deferred attempt" and "awaiting a person after rejection". Distinguish only by reading attempts |
| EXECUTING | T `dispatching` | Yes, but with no staleness signal a crashed dispatch reads EXECUTING forever (G-4) |
| ACCEPTED | T `sent` + D `sent_unverified`, O `sent` | Yes |
| DELIVERED | T `delivered` + D `delivered` | Yes when a Delivery event arrives. Note a Complaint also maps here (`sesEventNormalizer.ts:149,156-157`: signal stays `delivered`) |
| FAILED | T `failed` + D `bounced` | **Partly.** T `failed` arises only from a bounce (`feedbackIngestion.ts:226-229`), including transient bounces. A send failure leaves T `queued`, never `failed` (`dispatch.ts:356`) |
| RETRY_REQUIRED | No state. Nearest: O `deferred_quota`, `deferred_governance` with T `queued` | **No honest mapping as a stored status.** T `retried` exists in the model and has no writer |
| CANCELLED | T `cancelled`, also `expired` | Yes; `expired` has no writer found on the paths read |
| REJECTED | T `rejected` (human) vs O `rejected` (provider or local refusal) vs business outcome `rejected` | **Three meanings under one word.** Must be mapped by source: T `rejected` to REJECTED; O `rejected` to FAILED, and to uncertain if G-1 applies |

Also: an unknown result (O `timeout`, `failed`) has **no contract status**. The nearest is the adapter's `needs_human`, outcome `uncertain` per the contract comment, though the WS-3 adapter returns the raw outcome name.

`dispatching → queued` is executed three times in `dispatch.ts:283,314,356` and is **not in** `ALLOWED_TRANSITIONS` (`lifecycle.ts:60` allows only `sent`, `failed`). The table's comment calls it "the complete legal transition table". Nothing enforces it in the database as far as I read; `transitionOutreachTaskState` does not consult the table.

---

## 6. Gap register

Severities assume the moment real sends are enabled. **None of these proposes enabling them.**

| ID | Gap | Sev | Evidence | Smallest fix extending existing code | Scope | Owner decision? |
|---|---|---|---|---|---|---|
| G-1 | **Ambiguous provider failures are recorded as "proved not sent", allowing a second real send.** Every `res.error` from `functions.invoke` becomes `accepted:false`, outcome `rejected`. That includes `FunctionsFetchError` and `FunctionsRelayError` (network, relay) and any non-2xx, which can follow SES accepting. `rejected` is in `NOT_SENT_OUTCOMES`, so the next dispatch proceeds under a new key. Edge function ignores keys anyway | **High** | `emailTransport.ts:123-125,304-310`; `dispatch.ts:129,150`; `node_modules/@supabase/functions-js/dist/main/FunctionsClient.js:259-267,290` (errors are returned, not thrown); adapter contract `engineAdapters.ts:41-42` "NEVER auto-retried" | In `supabaseEdgeEmailProvider`: return `accepted:false` only for `FunctionsHttpError` with a 4xx response; otherwise throw so it lands in `provider_error` (`emailTransport.ts:337`), which already blocks re-dispatch. Add a test per error class | Engine-local | No |
| G-2 | **`needs_human` does not stop the next sweep.** After O `rejected` the task is `queued`, the step stays `ready`, and the adapter's `queued` branch dispatches again: new attempt, new evidence, a provider call each sweep. Same re-entry for `blocked_prior_attempt` appends a decision row every sweep | **High** | `dispatch.ts:356`; `engineAdapters.ts:214-238`; `workflowProgressionSweeper.ts:341,456,477-480` (the ready step is re-executed every sweep, with no record that a person was asked). `dispatch.ts:356` also moves `rejected` to `queued`, and `:129` treats it as not sent. Code trace, not run | Adapter checks `requeuedDispatchProblem` plus last outcome before re-dispatching, or a task flag for "awaiting person" | **Shared** (`engineAdapters.ts` is coordinator-owned). Propose only | No, design choice for coordinator |
| G-3 | Provider idempotency claimed but absent | Med | `transport.ts:112-119`, `emailTransport.ts:83-84`, `execution/emailExecutionConnector.ts:7`; `index.ts` has no `idempotencyKey` use; AWS SDK retries inside the function are also uncontrolled (inference) | Correct the comments; do not rely on it. Optional: pass key as an SES `EmailTags` value for tracing | Engine-local | No |
| G-4 | **Crash after claim strands a task in `dispatching` forever.** Adapter returns `wait` for good; nothing reports it. May or may not have sent | **High** | `dispatch.ts:255,322`; `engineAdapters.ts:240`; `health.ts` no `dispatching` | Report-only staleness in `leadOutreachRecoverySweep`/`health.ts`, needing a person. No automatic resolution | Engine-local | No |
| G-5 | **An accepted send whose evidence write fails loses `provider_message_id`.** Only telemetry records it. Task still goes `sent`; later bounce or complaint resolves `not_found`, gets 422, SNS will not retry, **and no suppression is written** | **High** | `dispatch.ts:336-348,369`; `ses.ts:253-255`; `providerMessageResolver.ts:87` | Retry the append, then alert. Bounded retries only | Engine-local | No |
| G-6 | **Bounce or complaint arriving before the evidence row is permanently dropped.** Same path: `not_found` is terminal. Narrow race (inference: window is one round trip), bad failure mode: lost suppression. Test pins 422 | Med | `sesProviderEventIngestion.ts:46,59`; `wp3SesWebhook.test.ts:396-400` | Answer `not_found` as 503 for events younger than a bound | Engine-local; changes a pinned test | No |
| G-7 | **SNS subscription cannot be confirmed from what the endpoint records.** URL and token dropped; doc says otherwise | **High for B-5** | `ses.ts:230-235`; `ENG-003:105,493` | Log `SubscribeURL` after signature and topic pass, or persist for the operator | Engine-local | No |
| G-8 | **Flag-off loop.** With `WORKFLOW_ORCHESTRATION_ENABLED` on and email flag off, each sweep over an approved email task appends a decision, attempt and evidence row and returns `wait`. **Each attempt also counts against quota** because usage is a raw attempt count. No pre-check anywhere. Test named "disabled ... records nothing" counts only content evidence | Med now, widens B-15 | `dispatch.ts:212,297,336`; `emailTransport.ts:196`; `quota.ts:142-155`; `governanceService.ts:393`; `engineAdapters.ts:238`; `pi_email_send_path_041a:1039-1056` | Optional `isAvailable()` on `OutreachTransport`; dispatch returns `skipped_transport_disabled` before writing. Check `ws3Milestone5b:287` | Engine-local | No |
| G-9 | **B-16 is wider.** `auditFailed` dropped (`leadOutreachActivation.ts:326-330`), route omits it (`approve.ts:77`), and a task in `approved` is dispatchable on status alone: approval log consulted only for `queued` (`governanceService.ts:575`, `governance.ts:306`). So an unrecorded approval can send once, then is blocked on requeue | **High** | as cited | (a) propagate `auditFailed` through both; (b) consult the log for `approved` too, which needs fixture review | (a) engine-local; (b) engine-local, behaviour change | (a) no; (b) coordinate with approval build |
| G-10 | No reject or list route; approval shows no rendered text | High for tenant use | `RECOVERY-BASELINE.md` P1 item 3; caller grep | Part of B-6 design: `prepareEmailSend` already yields preview | Shared/owner | **Yes**, B-6 |
| G-11 | Replies: no `Reply-To`, no inbound path; example sender is `noreply@`. A recipient reply may reach nobody, and the journey continues unless an operator records it, with no UI and no route listing task IDs to name | **High** | `index.ts:14,408-411`; `outcomes.ts`; caller grep; `channelCapabilityModel.ts` `inboundReply` PARTIALLY_SUPPORTED | Minimum: `Reply-To` env var. Full: SES inbound | Edge local; inbound is new external setup | **Yes**, product: who reads replies |
| G-12 | Single global sender and config set, versus W4's per-tenant `omnivyra-t-<org>` set. `validateSender` unwired; refresh worker has no caller. Every tenant mails as the platform | High if multi-tenant | `index.ts:392,396`; `sendingDomainService.ts:21-25,465`; `providerMessageResolver.ts:23` | Pass a validated From through the port; edge allow-list | Engine + edge | **Yes**, sender model |
| G-13 | Transient bounce and `Reject` set T `failed`, D `bounced`. A later Delivery is refused, so a full mailbox reads as failed permanently | Med | `sesEventNormalizer.ts:10-11,151-155`; `feedbackIngestion.ts:226-229`; `lifecycle.ts:108-109` | Evidence only for non-permanent bounces | Engine-local; check `wp3SesWebhook` pins | No |
| G-14 | Quota keyed on `lead_id`, though bridge comment says quota is person-keyed and `reserveQuota` answers `person_unresolved`: **false on this branch** (true only in parked pi-consol) | Med | `outreachBridgeStore.ts:22-24,308-311`; `quota.ts:74,148,180` vs `refs/preserve/wt/pi-consol` `quota.ts:86,163,186` | Port person keying, or correct the comment. Person-keyed limit is the honest one | Engine-local | Coordinate: test impact |
| G-15 | Erasure design mechanism does not cover what it asks for. It scrubs `outreach_delivery_evidence.transport_response` and `outreach_outcomes.evidence/metadata`, but those are under `ws3_reject_mutation` (BEFORE UPDATE OR DELETE) and the mechanism only opens the evidence guard. Operator `note` writes free text into outcomes | Med, for B-3 | Design :37-38,55-61; `20260910:272-285`; `outcomes.ts:193` | Add those two tables to the design's guard section | Shared (migration, privacy) | **Yes**, E-1..5 |
| G-16 | Person-only restriction risk is real on the operator path: `ingestFeedback` writes `personId` with no target; erasure re-anchors only from `identity_claims`, while recipient comes from `primary_email`. Not executed | Med-High | `feedbackIngestion.ts:386-400`; `personErasure.ts:33,318,460`; `emailExecutionContext.ts:200` | Pass the address as target on that write, plus design test 6 | Engine-local + privacy | Privacy review |
| G-17 | Compliance footer: unsubscribe only. **No postal address or sender identity** in `lead_outreach`. Legal requirement is for counsel; I make no legal finding | Unknown | `index.ts:297-313`; grep `postal` empty in these directories | Add a configured footer field, keeping body byte-identical | Edge | **Yes**, counsel |
| G-18 | Config not validated: `OUTREACH_UNSUBSCRIBE_TOKEN_KEYS`, `SES_SNS_TOPIC_ARNS` absent from `lib`, `shared`, `config`, `.github`, and from `scripts` except a reason string in `route-auth-allowlist.json:840` (no check reads them). Edge `APP_URL` and app `NEXT_PUBLIC_APP_URL` must share an origin or every send is refused (`unsubscribe.ts:39`); that surfaces only at send | Low (fails closed) | grep; `emailTransport.ts:39` | Readiness check by name only | Engine-local | No |
| G-19 | Temporary region diagnostics still in the function | Low | `index.ts:345-354,444-453` | Remove on next deploy | Edge | Owner deploys |
| G-20 | Skipped tests are what would prove approval on this path: `:952` human step, `:994` autonomy, `:1287` legacy refuses email | Med | `pi_email_send_path_041a` | `:952`: re-enable with reason `not_approved`, or wait for A-H | Engine-local test | `:994,:1287` need A-H, L-1 |
| G-21 | No usage or credit record | Low-Med | grep | Depends on commercial decision | Shared | **Yes** |

### Previously reported blockers

| Blocker | Verdict | Evidence |
|---|---|---|
| **B-3** erasure | **Holds.** Also true on RC `7bdd76ae`. DELETE is unguarded as reported: trigger is `BEFORE INSERT OR UPDATE` (`20270120000001:153`), revoke covers `anon, authenticated` only (:115). Design incomplete: G-15 | grep results above |
| **B-4** retention | **Holds** | `retention.ts:1-12`, `personErasure.ts:58-59` |
| **B-5** SES/SNS, keys | **Holds in code terms; external state unmeasured, last measured 2026-10-20 per the register.** Function does have `lead_outreach`, so the comment `emailTransport.ts:99-102` is stale. New item G-7 | index.ts, ses.ts |
| **Replies** | **Holds.** Operator route only, no UI | G-11 |
| **B-16** | **Holds, and is wider** | G-9 |
| **B-15** | **Holds, and is wider.** The plan's "No send, no leak" stands. It says the sweeper path is not the noise source; by code trace it is one too | G-8; activate trace `leadOutreachActivation.ts:212-225` |

---

## 7. External dependencies, by name

- Edge secrets: `EMAIL_FROM`, `AWS_SES_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `APP_URL`, `SES_CONFIGURATION_SET`, platform-injected `SUPABASE_SECRET_KEYS`
- App: `LEAD_OUTREACH_EMAIL_ENABLED`, `OUTREACH_UNSUBSCRIBE_TOKEN_KEYS`, `NEXT_PUBLIC_APP_URL`, `SES_SNS_TOPIC_ARNS`, `CRON_SECRET`, `WORKFLOW_ORCHESTRATION_ENABLED`, `LEAD_OUTREACH_RECOVERY_SWEEP_ENABLED`, `LEAD_OUTREACH_EXECUTION_DISABLED`, `SENDING_DOMAINS_SES_PROVIDER` plus W4's dedicated credentials
- AWS: SES identity, production access (unknown), configuration set with event destination, SNS topic and HTTPS subscription
- Supabase: manual `functions deploy` with `--no-verify-jwt`
- Database: `outreach_governance_config` row per tenant (fail-closed if absent)
- Redis, optional: quota falls back to database
- Migrations not on main: 20261229000000, 20270113000000, 20270120000001. 20270113 depends on the RC's 20270112000000 for erasure admission

---

## 8. Duplicates and competing implementations

| Item | Competes? | Finding |
|---|---|---|
| Legacy operator email (activate) | **No send; writes noise** | `activate.ts:63` refuses recipient, so null recipient reaches the engine transport: `disabled`, or `invalid_recipient` with flag on. Each call writes attempt and evidence. `ActivationOptions.recipient` has no route caller. Plan's table is correct |
| `placeholder` composition | Harness only | `transportRegistry.ts:46`; all three application roots choose `engine` (`leadOutreachActivation.ts:135`, `leadOutreachRecoverySweep.ts:136`, `workflowEmailDispatch.ts:74`) |
| Guarded execution (`executionBridge`, `emailExecutionConnector`, `suppressionService`, `executionApprovalService`) | **Duplicate control plane, dry-run** | Own suppression, approval and kill switch. Never sends: `dispatched: false`. Not in the send path |
| `emailService`, `domainReminderService`, `cron/email-jobs` | **Other mail through the same function** | Ungoverned transactional; v1 path; no configuration set, so their bounces produce no SES events by that route. Classified in `emailService.ts:20-60`, with item 2b undecided. `sendActivationOutreach` is the prospect-shaped one to watch; it has its own governance test `activationOutreachGovernance` |
| `refs/preserve/wt/pi-consol` | Parked variants | Engine identical. Differs in `dispatch.ts` (+71/-48), `emailTransport.ts` (+51/-26), `leadOutreachActivation.ts` (+24/-94), person-keyed `quota.ts`. Plan correctly warns which parts not to port. Person-keyed quota looks worth taking (G-14) |
| `wp3/*`, `wp12/*`, `w4/*`, `ses/email-templates` | No | Ancestors of main |
| `suppression_entries` vs `outreach_suppressions` vs `contact_governance_records` | Known transitional | Path B reads the last two; `__global__` does not reach this gate, by recorded decision (`governanceService.ts:29-35`) |

---

## Could not determine

- Production: whether the function is deployed, SES and SNS state, secrets, tenant rows, task counts. No access; the plan's probe remains the way.
- Whether SES emits duplicate-safe behaviour under SDK retries: no provider run.
- Whether `dispatching → queued` is refused by any trigger I did not read: I read the WS-3 migrations by grep, found no status-transition trigger, and the real-schema suites exercise requeue, so inference is that none exists.
