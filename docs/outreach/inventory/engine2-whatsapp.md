# Engine 2: WhatsApp Broadcast, inventory

Refs: `feat/orchestration-recovery` dc7f2ae3 (tree `C:/tmp/orch-recovery`), `origin/main` 5025f51d. File:line refs are to the branch unless they say main.

**Method and its limit.** Everything here comes from reading code and git. I ran no tests, no SQL and no provider call, as the brief requires. So every "would fail" below is static reasoning about a named assertion, and every statement about production is an inference. Test results quoted from `VERIFICATION-AND-BLOCKERS.md` are that document's record, not my re-run.

## Honest status

**The engine has never been shown to send a message, and on the code as written it cannot.** Five separate breaks stand in the path, and none is covered by a fake-free test. Three of them are NOT in the blocker register (marked NEW).

Journey path (branch only):
1. `hasApproval: async () => false` (`whatsappEngineAdapter.ts:167`): refuses every step, by design (B-6).
2. NEW: nothing in the repo writes `social_accounts.phone_number_id` or `waba_id`, so `findWhatsAppAccount` finds no account unless someone edits the database by hand (WA-3).
3. NEW: `getValidAccessToken` selects two columns that do not exist on the chain schema, so `processBatch` throws before any send (WA-2). `orch_engines_real` stubs this function (`:45`), so it cannot see this.

Operator path (main and branch):
4. NEW: `enforceRole` is called with no `companyId` on all three POST routes, and `enforceRole` answers 400 `companyId required` in that case (`rbacService.ts:608-612`). So create, enqueue, retry, add-recipients and template submit all return 400 for every user, super-admin included (WA-1).
5. Behind that, on main: the UI sends the wrong contact key (WA-9), then 42P10 (fix 3), then the token break, then `status_at` (fix 4).

**The layering matters for B-10.** The register asks whether main's broadcast works today. It does not, regardless of what the probe returns, because the RBAC 400 comes before the database. Static read, trivially short control flow, but not executed.

What is genuinely solid: webhook signature and verify-token handling, the send-once claim, fail-closed contact governance at send, STOP recording, and the adapter's request ledger. All are local implementation with a stubbed provider. No sandbox or production verification exists for anything.

## 1. Capability table

"RPG" = real PostgreSQL with Meta HTTP, token, queue and Redis stubbed (`orch_engines_real.test.ts:4-7,35-50`). "Fake" = fake database.

| Capability | Classification | State | Where | File:line, symbols | Migrations | Tests | Ancestry |
|---|---|---|---|---|---|---|---|
| Journey adapter | IMPLEMENTED — INTEGRATION REQUIRED | integrated, disabled | branch | `orchestration/whatsappEngineAdapter.ts:184-311` `createWhatsAppAdapter`; registered `workflowProgressionSweeper.ts:215` | 20261230000000, 20261231000001 | `orch_engines_real` RPG; `orchestrationVerticalSlice:506-610` Fake | 02cc5dfb, f7ff85d0; not on main |
| Sweep trigger | IMPLEMENTED — NOT VERIFIED | disabled | branch | `pages/api/cron/workflow-execution-progression.ts:25-28` (`WORKFLOW_ORCHESTRATION_ENABLED`; no vercel.json entry) | none | sweep function RPG; route not exercised by these suites | not on main (`git cat-file` fails) |
| Request ledger, one per task | IMPLEMENTED AND VERIFIED (real PG only) | integrated | branch | adapter `:87-118,281-283` | 20261230000000 | RPG `:158-184`; Fake `:509` | branch |
| Approval | MISSING (refuses by constant) | disabled | branch | adapter `:167,262-264` | none | RPG `:126-138` | f7ff85d0 |
| Tenant and channel controls before creation | IMPLEMENTED AND VERIFIED (real PG only) | integrated | branch | adapter `:169-176,260-261` | none | RPG `:140-154`. Global switch and unreadable config branches have no WhatsApp test | f7ff85d0 |
| Tenant controls at send | MISSING | n/a | neither | `whatsappBroadcastService.ts:255-292` reads governance only | none | none | B-17 |
| createBroadcast, expandRecipients | IMPLEMENTED AND VERIFIED (real PG only) | integrated | main and branch; working key is branch only | service `:95-153` | 20270120000002 branch | RPG | key in f7ff85d0 |
| Operator routes | PARTIALLY IMPLEMENTED (POST is dead) | duplicated entry | main and branch, identical | `pages/api/whatsapp/broadcasts/index.ts:72`, `[id].ts:60`, `templates/index.ts:62` | none | no test references these routes (`git grep` over backend/tests is empty) | 6b8c5a8a |
| enqueueBroadcast and template check | IMPLEMENTED AND VERIFIED (real PG only) | integrated | main and branch | service `:161-251` | none | RPG `:265-272` | main |
| processBatch, send and claim | IMPLEMENTED — NOT VERIFIED against a provider | integrated | main without the claim; claim branch only | service `:255-392`, claim `:330-335` | none | RPG with HTTP stub `:158-184,246-263`; `w0c...:205-245` Fake | cefd8528 branch only |
| Contact governance at send | IMPLEMENTED AND VERIFIED (real PG only) | integrated | main; working blocked-write branch only | service `:288-323` | none | RPG `:235-244`; `w0c...:126-192` Fake | main's write fails: `error_code: 'contact_governance'` on an integer column, main `:315` |
| STOP detect and record | IMPLEMENTED AND VERIFIED (real PG only) | integrated | branch | `whatsappOptOut.ts:55-125`; processor `:103-119` | none | `whatsappStopOptOut` Fake; RPG `:216-233` | e652d356, not on main (`git show` count 0) |
| STOP to journey and PI | IMPLEMENTED AND VERIFIED (real PG only) | integrated | branch | `journeyResponses.ts:118-123`, `journeyFeedback.ts:103,111`, sweeper `:397` | none | RPG `:229-231` | f7ff85d0 |
| Retry and idempotency | IMPLEMENTED — NOT VERIFIED | integrated | branch for safe form | service `:416-442`; `send_uncertain` `:353-380` | none | RPG `:246-263`; `retryFailed` itself untested on RPG | cefd8528 |
| Webhook GET verify token | IMPLEMENTED AND VERIFIED (fake; no Meta) | integrated | main | `webhook/index.ts:26-33,64-76` | none | `sec91BMiscHardening:49-81` | ce5827fd |
| Webhook POST signature | IMPLEMENTED AND VERIFIED (fake queue; no Meta) | integrated | main | `webhook/index.ts:48-59,79-85` | none | `sec91IntP3Closures:200-258` | b286744c |
| Webhook durability | PARTIALLY IMPLEMENTED | integrated | main | `webhook/index.ts:97-114` acks 200 after shed or failure | none | none for this | WA-5 |
| Delivery status | PARTIALLY IMPLEMENTED | integrated | broken on main, fixed on branch | service `:446-474`; processor `:36-50` | none | RPG `:186-197` | f7ff85d0 |
| Inbound handling | IMPLEMENTED AND VERIFIED (real PG only) | integrated | main; opt-out branch only | processor `:90-171` | none | RPG `:199-214,284-299` | main |
| Template lifecycle | IMPLEMENTED — NOT VERIFIED | integrated, submit unreachable | main | `whatsappTemplateService.ts:61-224` | none | `getActiveTemplate` is real in RPG `:265-272`; no route test; I did not find `submitTemplate` or the template webhook exercised unmocked (`whatsappStopOptOut:52` mocks the handler), but did not search every suite | main |
| Token lookup | PARTIALLY IMPLEMENTED (broken on chain schema) | integrated | main | `auth/metaAuthService.ts:65-73,201-233` | none | stubbed everywhere I read | WA-2 |
| WhatsApp account connection | MISSING | n/a | neither | no writer; see WA-3 | none | fixture inserts it by SQL, `orch_engines_real:83-85` | n/a |
| Phone hash and encryption | IMPLEMENTED AND VERIFIED (real PG only) | integrated | main | service `:36,68-91` | none | RPG, with test salt `:53` | production values unknown (B-8) |
| Rate limiter | PARTIALLY IMPLEMENTED | integrated | main | `whatsappRateLimiter.ts:119-164` | none | Redis mocked | WA-15 |
| Counter RPCs | MISSING | calls to nothing | main and branch | service `:386,469`; limiter `:105` | none anywhere | none | B-11 |
| Analytics | PARTIALLY IMPLEMENTED (reads counters that stay 0) | integrated | main | `pages/api/analytics/whatsapp/broadcasts.ts:64-128` | none | `analyticsWhatsappSec001Broadcasts` (authorization) | main |
| Usage and credits | MISSING | n/a | neither | no credit or usage reference in service, template service or routes (`git grep` empty) | none | none | `CREDIT_COVERAGE_AUDIT.md:249` lists only the webhook processor, as exempt |
| Queues and workers | IMPLEMENTED — NOT VERIFIED here | integrated | main | `contentGenerationQueues.ts:172-190,451-505`; `workerTopology.ts:146-153` | none | topology unit and integration suites | main |
| `scheduled_for` | MISSING (stored, never read) | n/a | main | service `:55`; no reader in service or routes | none | none | WA-21 |
| Platform adapter send | IMPLEMENTED — NOT VERIFIED | parked in effect, duplicated | main | `platformAdapters/whatsappAdapter.ts:23-91`; `publishContent(` and `replyToComment(` have no caller in backend or pages | none | not examined | main |
| Provider sandbox or live verification | BLOCKED BY EXTERNAL DEPENDENCY | n/a | n/a | needs B-6, B-8, WA-3, Meta test number | n/a | none | n/a |

## 2. The five f7ff85d0 fixes

All five commits sit on the branch only: `git merge-base --is-ancestor f7ff85d0 origin/main` is false. Refs containing it: `feat/orchestration-recovery`, `preserve/orch-recovery-dc7f2ae3`. The tests are `orch_engines_real.test.ts` on real PostgreSQL through `helpers/pgTransport.ts`.

| # | Fix | Code path | Assertion that fails without it | Main's own route |
|---|---|---|---|---|
| 1 | Human-mode step sent with no approval | adapter `:167` default false, `:262-264`. Neither the adapter nor the sweeper reads `execution_mode` (grep: no hit in the sweeper) | `:131` `{needs_human, approval_required}` would be `waiting`; `:132` `mockJobs` length 0 would be 1; `:134` broadcast count | The adapter is not on main, so this form does not exist there. The route has a role gate and no approval record, and is dead at 400 (WA-1). Fixing that 400 restores a send with no approval |
| 2 | Tenant controls not reaching journeys | adapter `:169-176,260-261` | `:150` `outcome: code` would be `submitted`; `:151` | **Still has the defect, on both main and the branch.** The routes and `processBatch` never read `outreach_governance_config`. The fix is in the adapter, not the service |
| 3 | Upsert with no unique key | migration 20270120000002; call at service `:138-140`; pgTransport `:64` emits a real `ON CONFLICT` | `:164` `tasks_waiting` 1 (would be `submit_failed`, `needs_human`); `:166` | **Same upsert on main (main `:139`), no key in main's chain.** Present if production matches the baseline; unmeasured |
| 4 | `status_at` silent failure | service `:449-451`; pgTransport `:90-92` returns the error, `:458` discards it, `:464` returns | `:195` `toBe('delivered')` would stay `sent` | **Still has the defect:** main `:423` writes `status_at`; the column is on `engagement_messages` (baseline `:14263`) and not on recipients (baseline `:24983-24999`) |
| 5 | STOP counted as a reply | `journeyResponses.ts:118-123,145`; `journeyFeedback.ts:103,111`; sweeper `:397` | `:229` `exited.outcome` would be `replied`; `:231` would be `engaged`, not `closed_disqualified` | No journey layer on main, so no misclassification. **Worse there:** main has no STOP handling at all. Inbound STOP is stored as a message and writes no governance |

Limits of each claim:
- **1.** "Fixed" means "refuses everything". It is not an approval path, and no test exercises a real approval. The commit's "would have sent" is also conditional: on the chain schema the old code would have failed at 42P10 and then at the token lookup. It would have sent only on a database that had run `whatsapp_system.sql`.
- **2.** Applies only before a request exists. `submitted` returns at `:235`, before `:260` (B-17). The unit test `orchestrationJourneyCompletion` for fix 5 uses a fake port and proves pass-through only; the real proof is `:216-233`.
- **3.** Correct, but the migration is applied nowhere real. Its rollback and duplicate checks are one-off runs recorded at `VERIFICATION:60`, not a persistent test. Only one of the file's two missing recipient keys is restored (WA-22).
- **4.** Removes the bad column but not the silent failure: `:458` still discards `error`, so the next write failure is equally silent (WA-11).
- **5.** Bounded at 50 messages, and only while the journey lives (WA-18).

Also on the branch only, and worth saying because main still lacks them: send-once claim, `send_uncertain`, and the `error_code` integer fix (all cefd8528, `git diff origin/main HEAD`). On main a retried batch can message someone twice, and an exception marks the row `failed`, so `retryFailed` can resend.

## 3. Blockers

**B-6: confirmed.** `hasApproval` is a constant false. `TENANT-JOURNEY-APPROVAL-DESIGN.md:3` says not built; its Decision A recommends bridging WhatsApp into `outreach_tasks` and reading that status. The only WS-3 approver is `pages/api/super-admin/outreach/approve.ts:69`. Owner decision.

**B-8: confirmed, and more specific.** `PHONE_HASH_SALT` appears only at service `:36,69`, `infrastructureSecretNames.ts:25` and the test. It is in no workflow and no `.env*.example` (`git grep`). It is read at module load. `expandRecipients` runs wherever the adapter or route runs (Vercel) and needs salt plus `ENCRYPTION_KEY`; `decryptPhone` runs in the worker (Railway) and needs `ENCRYPTION_KEY` (inference from the topology). Failure mode: a broadcast row exists with no recipients, reported as `submit_failed`. Production unmeasured, not checked per the brief.

**B-10: confirmed, but the register understates it.**
- `baseline.json` records a dump from a managed Supabase pooler at ledger 20260916000000. Inference: that is production as of then. It has no `unique_broadcast_recipient`, and no migration before 20270120000002 adds one.
- The probe answers less than it claims. "Zero unique constraints with zero recipients would confirm the broadcast path has never worked" is true but incomplete: the RBAC 400 already stops it, and the probe misses WA-2. Suggested replacement (one statement, no semicolon, read-only; for the owner to run):

```sql
select (select count(*) from pg_constraint where conrelid = 'public.whatsapp_broadcast_recipients'::regclass and contype = 'u') as unique_constraints, (select count(*) from pg_proc where proname like 'increment_broadcast%' or proname = 'increment_wa_usage') as counter_functions, (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'social_accounts' and column_name in ('auth_client_id_ref','auth_client_secret_ref')) as auth_ref_columns, (select count(*) from public.social_accounts where platform = 'whatsapp' and phone_number_id is not null) as connected_accounts, (select count(*) from public.whatsapp_broadcast_recipients) as recipients, (select count(*) from public.whatsapp_broadcasts) as broadcasts
```

**B-11: confirmed, and there is a third.** `increment_broadcast_counts` and `increment_broadcast_stat` are called at service `:386,469` and defined nowhere: `git grep` across the tree finds only the callers, and `git log --all -S` on `supabase/migrations/*` and `database/*` finds nothing. `increment_wa_usage` (limiter `:105`) has no definition either and is not in the register. The register's "journeys unaffected" is right: the RPC result is ignored and the adapter reads recipient rows. Effect: `sent_count`, `delivered_count`, `read_count`, `failed_count` stay 0, so every rate in the analytics route is 0. Smallest fix: a migration defining two RPCs, with an allow-list on `p_column` (coordinator); or an engine-local alternative that drops the RPCs and has the analytics route aggregate recipient statuses.

**B-17: confirmed as written.** `processBatch` reads the broadcast, token, account, recipients and contact governance (`:259-288`), and nothing else. It does not read tenant controls, inbound messages, or `broadcast.status`, so `paused` is also not honoured. STOP is honoured at send (test `:235-244`); a plain reply and a kill switch are not, and no test covers either.

**Smallest engine-local fix, in `processBatch`, only for journey broadcasts (`broadcast.name` starting `wf:`, see `broadcastNameFor`, adapter `:182`):**

1. **Kill switch.** After loading the broadcast, before the loop: `isLeadOutreachGloballyDisabled()` and `loadTenantGovernanceConfig(company_id)`, the same logic as `channelRefusal`. A failed read gives `configured: false` and refuses, so it fails closed. Move that logic to one exported function in the service and have the adapter call it, rather than copying it.
2. **Reply.** Per recipient, before the claim: read `engagement_threads` where `platform_thread_id = wa:<social_account_id>:<digits>`, then inbound `engagement_messages` with `created_at >= broadcast.created_at`. If any, or if the read fails, do not send. This is stronger than recalling on exit, because the exit only happens at the next sweep. A journey broadcast has one recipient, so the cost is two reads.
3. **Status.** Update `pending` to a new text status such as `blocked_tenant_control`, guarded by `.eq('status','pending')`. The column has no CHECK (baseline `:24983-24999`; `sending` and `send_uncertain` already rely on this), so no migration.

**The one catch: the adapter.** `fromRecipient`'s default case (`:211-212`) would wait forever on an unknown status, so the adapter needs one new `case` going to `needs_human`. That file is orchestration-owned, so propose it. The purely engine-local alternative is to reuse `blocked_governance` with a `tenant_control:` message prefix. It needs no adapter change, but the adapter then reports "contact governance refused" and settles `skipped`, which advances the journey. I prefer the new status.

**Do not apply the check to operator broadcasts without a decision.** `outreach_governance_config` is a lead-outreach control, and a tenant with no row would have every operator broadcast refused.

**Not covered:** a journey exit for another reason (PI closed the prospect) does not recall the job. That needs either the sweeper's `exitJourney` or a read of orchestration tables: coordinator. The window between check and `fetch` remains, at milliseconds.

Test to add, mirroring `:235-244`: `sweep`, then `UPDATE ... kill_switch = true`, then `runQueuedJobs`, then `expect(metaCalls).toHaveLength(0)`; and the same with `inbound('yes')` in place of the update.

## 4. Providers, adapters and how the engine is reached

```
Journey (branch, off)   cron -> sweepWorkflowExecutionProgression -> whatsappEngineAdapter
                          -> createBroadcast -> expandRecipients -> enqueueBroadcast
Operator (main, dead)   /whatsapp/broadcasts UI -> POST /api/whatsapp/broadcasts[/id] -> same three calls
                                     | queue whatsapp-broadcast
                                     v
                        processWhatsAppBroadcastJob -> processBatch -> Meta Graph v22.0 /{phone_number_id}/messages

Meta -> /api/whatsapp/webhook -> queue whatsapp-webhook -> processWhatsAppWebhookJob
          statuses  -> updateRecipientDelivery
          messages  -> recordWhatsAppOptOut, engagement_threads, engagement_messages
          templates -> handleTemplateStatusWebhook
engagement_messages -> journeyResponses -> sweeper exit -> feedWhatsAppReplyToLifecycle -> PI
```

Provider: Meta Graph API only. The one live send is service `:340`. Second implementation: `platformAdapters/whatsappAdapter.ts`, with `fetchComments` reached via `engagementIngestionService.ts:158,876` and `testConnection` via the social-account routes.

Routes:
- `GET/POST /api/whatsapp/broadcasts` and `/[id]?action=enqueue|retry|recipients`: GET works, POST returns 400.
- `GET/POST /api/whatsapp/templates`: POST returns 400.
- `GET/POST /api/whatsapp/webhook`.
- `GET /api/analytics/whatsapp/broadcasts`.
- `pages/whatsapp/inbox.tsx:135` posts to `/api/engagement/reply`. That route has no WhatsApp mention and `replyToComment` has no callers, so I found no path from the inbox to Meta. I did not trace the capability map further, so treat this as "not found", not "proven absent".

Queues:
- `whatsapp-broadcast`: concurrency 2, attempts 3, enqueued with `enqueueOrThrow`, jobId `wa-batch-<id>-<n>`, `wa-retry-<id>-<ts>`.
- `whatsapp-webhook`: concurrency 3, attempts 5, jobId sha256 of body, `safeEnqueue`.
- Both have dead-letter on exhaustion, 30-minute stall scan, and run on the shared worker (`workerTopology.ts:146-153`). `workerTopologyManifest.ts:84` has stale line numbers.

Crons: none for this engine. `resetDailyCounters` has no caller (`git grep`). `whatsapp_media_cache` has no reader or writer in code, only RLS lists.

Events: no event bus. Delivery reaches the journey only by the adapter polling recipient status; inbound reaches it by polling `engagement_messages`. Usage and credit accounting: none. The rate limiter is the only metering.

## 5. Compliance matrix (18 contract fields)

| Field | State | Where or from what |
|---|---|---|
| Engine identifier | Satisfied | `engine: 'whatsapp'`, adapter `:217`; `ENGINE_NAMES` |
| Capability declaration | Missing | Only `channels`. Nothing states template-only, no parameters, no cancel. `channelCapabilityModel.ts:204-217` declares it NOT_OPERATIONAL, with no inbound or receipts, which is stale |
| Channels and action types | Partly | `channels: ['whatsapp']`; action type implicit (template send) |
| Authorization context | Partly | `channelRefusal` checks tenant controls; `hasApproval` is a stub; no actor or approval id reaches the engine |
| Tenant and prospect refs | Satisfied, tenant; mappable, prospect | `ctx.organizationId`; `ctx.subject`, not persisted by the engine |
| Workflow and journey refs | Mappable | `ctx.executionInstanceId`, `executionTaskId`; ledger holds the task id; broadcast `name = wf:<task>` |
| Recipient | Satisfied, narrowly | `unified_persons.primary_phone` normalised, E.164 check, adapter `:270-275`; one recipient per broadcast |
| Rendered content or payload | Partly | `template_name` only. No parameters; language hard-coded `en_US` at service `:404`. No evidence of what was sent |
| Idempotency key | Satisfied | `executionTaskId`; unique ledger; recipient claim. Queue jobId as well |
| Correlation ID | Mappable | Task id, broadcast id, `wa_message_id`; job trace context `contentGenerationQueues.ts:453`. No single field |
| Execution request | Satisfied | `EngineStepContext`, `execute` |
| Execution result | Satisfied | `EngineResult` |
| Delivery status | Partly | Recipient row after fix 4. Stops at `sent`: settled at adapter `:198-201`, ledger terminal, so later `delivered`, `read`, `failed` never reach the journey |
| Error classification | Partly | `disposition` by consequence is good; `error_code` is stored but never classified, and all Meta refusals become `failed` |
| Retryability | Partly | `send_uncertain` never retried; `failed` is blanket-retryable under `retry_count < 3`, including permanent errors; no 429 handling; `next_retry_at` never set |
| Usage and credit | Missing | Nothing. Mappable only as a count of `sent` rows; no price or credit data |
| Outcome event | Partly | Only by polling; `feedWhatsAppReplyToLifecycle` for replies and STOP. No event for delivery |
| Audit metadata | Partly | Ledger state and `detail`, `execution_journey_decisions`, governance evidence; `created_by` unset on journey broadcasts; no timestamps on `EngineResult` by contract |

## 6. Status mapping

| Engine status | Maps to |
|---|---|
| Ledger `requested` | REQUESTED |
| Ledger `submitting` | REQUESTED; it is a claim, not a contract state |
| Ledger `submitted`, recipient `pending`, broadcast `running` | QUEUED |
| Recipient `sending` | EXECUTING |
| Recipient `sent`, ledger `completed` | ACCEPTED. Meta accepted it; nothing proves delivery |
| Recipient `delivered` | DELIVERED |
| Recipient `read` | DELIVERED, lossy; no target for read |
| Recipient `blocked_governance`, ledger `skipped` | REJECTED. Ledger `skipped` also covers `no_e164_phone` and `person_unresolved` |
| Refusals `approval_required`, `tenant_kill_switch` and similar | REJECTED, but transient: no row records them, and the ledger stays `requested` |
| Recipient `failed` before acceptance | FAILED, or RETRY_REQUIRED; the engine does not distinguish them |
| Recipient `failed` by webhook after acceptance | FAILED, but the ledger still says `completed` |
| Ledger `failed` | FAILED, including `submission_interrupted`, where a job may still send: not honest as FAILED |
| Broadcast `paused` (rate limit) | RETRY_REQUIRED in spirit, but nothing resumes it, and the adapter settles it `failed` |

**No honest mapping:**
- **AUTHORIZED:** no record exists; there is only a check that passed in memory.
- **CANCELLED:** no such status; a journey exit does not cancel a queued job.
- **Recipient `send_uncertain`, ledger `uncertain`:** unknown outcome. FAILED and RETRY_REQUIRED would both be false, and retrying risks a duplicate. It needs its own contract value or an explicit extension.
- **Ledger `completed` when a later webhook says `failed`:** the two records disagree.
- **Broadcast terminal state:** none. Nothing ever writes `completed_at` or a completed status, so `running` is permanent.

## 7. Schema: `database/whatsapp_system.sql` against the chain

The file is outside the chain, referenced only in comments in 20260917000000 and 20270120000002. The baseline's tables differ from it in shape (for example `template_category` is NOT NULL in the baseline), so inference: production's tables came from an earlier or partial application.

| Declared in the file | Baseline or chain |
|---|---|
| `unique_broadcast_recipient` | Absent. Added by 20270120000002 on the branch |
| `wa_message_id UNIQUE` | **Absent, not restored.** Service `:458-462` uses `.single()` on it |
| `social_accounts.auth_client_id_ref`, `auth_client_secret_ref` | **Absent, no migration adds them.** Code selects them (WA-2) |
| Other `social_accounts` WhatsApp columns | Present (baseline `:23116-23128`) |
| `whatsapp_templates UNIQUE (company_id, template_name, version)` | Absent; `submitTemplate` races are unguarded |
| `whatsapp_media_cache UNIQUE (company_id, media_hash)` | Absent; `(social_account_id, media_hash)` present. Table unused |
| `idx_wa_recipients_retry` | Absent |
| `engagement_messages unique_platform_message` | Absent. Baseline has a partial global index and thread-scoped unique (`:38930,38951`); the processor correctly uses the thread-scoped one |
| Counter RPCs | Not in the file either; they are defined nowhere |

## 8. Gap register

"Local" = engine-local. "Coord" = touches a contract, migration, registry or dispatch, so propose only. "Owner" = needs an owner or external decision.

| Id | Gap | Sev | Evidence | Smallest fix | Scope |
|---|---|---|---|---|---|
| WA-1 | All operator POSTs return 400 | High, currently protective | `index.ts:72`, `[id].ts:60`, `templates/index.ts:62`; `rbacService.ts:608-612`; same on main. Dead code path since at least 6b8c5a8a | Pass `companyId` in 3 calls | Local, but **Owner**: the fix switches on an unapproved send path with no kill switch. Do not bundle |
| WA-2 | Token lookup selects missing columns; every send throws | **Blocker** | `metaAuthService.ts:70`; no column in baseline or any migration; error surfaces as "Social account not found" `:75`. Callers are only service `:266` and template `:94` | Drop the two columns from the select, keep env fallback at `:85-86`; or a migration adding them | Local (small blast radius), or Coord for migration. Measure production first |
| WA-3 | No code connects a WhatsApp account | **Blocker** | No writer of `phone_number_id`, `waba_id`, `messaging_tier` in backend, pages, lib, components, scripts or migrations; fixture uses SQL | Connection flow, or a documented operator procedure | **Owner**, external |
| WA-4 | No approval (B-6) | **Blocker** | adapter `:167` | Build per the design | **Owner**, Coord |
| WA-5 | Webhook acks 200 when the event was not queued, so a STOP can be lost for good | **High**, compliance | `webhook/index.ts:105-114`; `safeEnqueue` returns null on shed | Return 503 when not enqueued. jobId dedupe makes a redelivery safe, and the comment's reason no longer holds. Inference: Meta retries non-200s | Local |
| WA-6 | Processor swallows every error, so attempts 5 never apply; opt-out failure after 3 immediate tries is only logged | **High**, compliance | Processor `:47-49,56-58,70-72,112-118`; `whatsappOptOut.ts:102-124` has no backoff | Collect errors and rethrow after the loop; treat `retryable_failure` as an error. Writes are idempotent | Local |
| WA-7 | B-17 | Medium | Section 3 | Section 3 | Local, plus one Coord line |
| WA-8 | Journey templates cannot carry parameters or a language; UI's parameter array is spread wrongly | **High** for product | Service `:404` (`en_US`, `...template_params`); adapter `:288-294`; UI `broadcasts.tsx:~212` array. `language_code` is stored but unused | Read language from `getActiveTemplate`; build `components` properly; step settings in the contract | Local for language; Coord for step params |
| WA-9 | UI sends `phone_number`, service reads `phone_e164`, so expand throws | Medium (hidden behind WA-1) | `broadcasts.tsx:203`; service `:123,70` | Fix UI key | Local |
| WA-10 | API accepts numbers without `+`, which miss the STOP gate | Medium | Route casts contacts unvalidated `index.ts:101`; pinned as KNOWN LIMITATION `whatsappStopOptOut.test.ts:215` | Validate E.164 in `expandRecipients` | Local |
| WA-11 | Delivery update: errors discarded; status can regress (late `sent` over `read`); failure after `sent` never reaches the journey | Medium | Service `:449-464`; adapter `:198-201` | Read `error` and throw; forward-only guard. Late failure needs Coord | Local, part Coord |
| WA-12 | Rows stuck `sending` (crash after claim) or `pending` (token failure, lost job); adapter waits forever | Medium | Service `:266,330`; adapter `:208-210`; no reaper (`git grep`) | Age out to `send_uncertain` / needs_human | Local + adapter Coord |
| WA-13 | Enqueue paginates by offset over a shrinking set, with no order; recipients can be missed | Medium, operator batches only | Service `:219-224`; batch 0 has delay 0 | Read all ids once, ordered, then chunk | Local |
| WA-14 | Counters absent, broadcast status never terminal; UI and analytics vocabulary (`sent`, `partial`, `queued`) never written | Medium | B-11; `broadcasts.tsx:43`; `analytics...:10` | Section 3; add terminal status | Local or Coord |
| WA-15 | Limiter: `plan` is client-supplied; DB fallback a no-op and fail-open; check-then-increment; never refunded | Medium | `index.ts:62`, `[id].ts:64`; limiter `:96-110,143-150` | Resolve plan server-side; fail closed without Redis | Local; plan source Owner |
| WA-16 | No usage or credit accounting | Medium | Section 1 | Decide the model first | **Owner**, Coord |
| WA-17 | "Since first reached out" counts from an unsent request, so an unrelated inbound message ends the journey and marks PI engaged | Medium, on enablement | Request row made at adapter `:225`, before the gates at `:260-264`; `journeyResponses.ts:69-78` has no state filter; comment `:69` is false | Filter requests by states that imply a send attempt | Coord |
| WA-18 | STOP after a journey exit never reaches PI; 50-row read cap | Medium | `journeyResponses.ts:33,116`; `RECOVERY-BASELINE:137`. Governance is still written | Feed opt-outs from the webhook, not the sweep | Coord |
| WA-19 | Meta's `wa_id` may differ from the dialled number in some countries, so a STOP would not match. Inference from provider knowledge, not verified | Medium | `whatsappOptOut.ts:67-71`; service `:303` | Verify on a test number | External |
| WA-20 | Inbound account lookup uses `.single()` on non-unique `phone_number_id`, no platform filter; duplicates drop every message including STOP | Medium | Processor `:93-99`; baseline unique is `(company_id, platform, platform_user_id)` `:33100` | Filter platform and active; handle ambiguity and log | Local |
| WA-21 | `scheduled_for` ignored: sends immediately or never | Low | Service `:55,161-251` | Honour or remove | Local |
| WA-22 | `wa_message_id` not unique | Low | Section 7 | Add to a migration | Coord |
| WA-23 | Person-anchored governance not seen at send (`personId: null`); journey sweep does check it | Low | Service `:302`; `contactGovernance.ts:187`; `individualIntelligence.ts:164` | Carry person id on journey broadcasts | Coord |
| WA-24 | Doc and comment drift | Low | Adapter header `:14-15` says next sweep ADOPTS the orphan, code `:246-248` and test `:565` refuse; `channelCapabilityModel.ts:216-217`; `engineAdapters.ts:7-9`; B-10 probe text | Correct them | Coord for adapter |
| WA-25 | Once WA-1 is fixed, retry, enqueue and add-recipients can act on a `wf:` broadcast | Low | `[id].ts:63-93` | Refuse `wf:` names | Local |

Not examined: erasure of recipient rows (`erasurePlan.ts` mentions WhatsApp), and the `pages/whatsapp/*` UIs beyond the lines cited.

## 9. External dependencies (names only)

- Env: `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `PHONE_HASH_SALT`, `ENCRYPTION_KEY`, `WHATSAPP_APP_ID` / `META_APP_ID` / `META_CLIENT_ID`, `META_APP_SECRET` / `META_CLIENT_SECRET`, `WORKFLOW_ORCHESTRATION_ENABLED`, `LEAD_OUTREACH_EXECUTION_DISABLED`, `CRON_SECRET`. Platform adapter only: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_RECIPIENT_PHONE`, `USE_MOCK_PLATFORMS`.
- Meta: WhatsApp Business Account, phone number id, system-user or long-lived token, webhook subscription to `messages` and `message_template_status_update`, approved templates, messaging tier, test number for sandbox verification.
- Infrastructure: Redis, worker service (shared consumer), a public webhook URL.
- Owner: migrations 20261230000000, 20261231000001, 20270120000002 unapplied anywhere real; provider-send authorization; B-6.

## 10. Duplicates and competing implementations

- **Two Meta send implementations:** service `:340` (governed) and `platformAdapters/whatsappAdapter.ts:53,75` (no governance, env-wide phone number, `to` from an env var). The second's send methods have no callers, so it is latent, not active. Retire or leave unreachable.
- **Two entry points into the service:** operator routes and the adapter. Different gates: role only versus controls plus approval. This is why fix 2 did not reach main's route.
- **Schema twice:** `database/whatsapp_system.sql` against the chain (Section 7).
- **Capability claims twice:** `channelCapabilityModel.ts` says NOT_OPERATIONAL, while the adapter makes it routable in `ROUTED_CHANNELS` (sweeper `:74`).
- **Opt-out detection runs twice over the same words,** at webhook and in `journeyResponses`, sharing `detectWhatsAppOptOut`. Not a competing implementation.
- **Suppression stores:** WhatsApp writes only `contact_governance_records`, with no legacy store, which is correct.
- **History:** the send-once commit exists in six rebased copies (e21a9867, 0cb3602c, f91b90e9, 1307dd1e, 42952ec6, cefd8528); only cefd8528 is in the branch, the rest are superseded. Same pattern for the vertical slice (fa18c9c8 and rebases, with 02cc5dfb integrated).
- **Future overlap:** the approval design would bridge WhatsApp steps into `outreach_tasks`, while `execution_engine_requests` remains the idempotency record. Two per-task records by design; the coordinator should settle this when building B-6.

## 11. Commands behind the main claims

- `git merge-base --is-ancestor f7ff85d0 origin/main`: not an ancestor.
- `git diff origin/main HEAD -- backend/services/whatsappBroadcastService.ts backend/queue/jobProcessors/whatsappWebhookProcessor.ts`: claim, uncertain, `status_at`, opt-out.
- `git show origin/main:backend/services/whatsappBroadcastService.ts | grep`: `status_at` at main `:423`, text `error_code` at main `:315`, `onConflict` at main `:139`.
- `git grep -n "enforceRole(" origin/main -- pages/api/whatsapp`: 3 calls, none with `companyId`.
- `git grep -E "auth_client_id_ref|auth_client_secret_ref" HEAD -- supabase/migrations supabase/_schema scripts/ci`: no hits.
- `git grep -E "phone_number_id|waba_id|messaging_tier" HEAD -- backend pages lib components` (engine files excluded), plus `-- pages/api scripts supabase/migrations components lib backend/auth`: no writer.
- `git grep increment_broadcast`, and `git log --all -S'increment_broadcast_counts' -- 'supabase/migrations/*' 'database/*'`: callers only, no history.
