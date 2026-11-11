# Orchestration: verification record and blocker register

Evidence-backed. "Real schema" means disposable PostgreSQL 17.6 with pgvector, built from baseline plus replay, with PostgREST replaced by a SQL adapter. Production has not been read or changed in this work.

## Engine integration status

| Engine | What really ran | What is stubbed | Can it act for a real person today? |
|---|---|---|---|
| **WS-3 internal** | Real adapter, bridge, governance, approval, dispatch, transport | Redis quota counter | Yes in code; flag off |
| **WS-3 email** | Real adapter, certified engine, render, evidence, unsubscribe link, SES ingestion after signature check | **Provider**, Redis | **No.** Blocked: B-3, B-4, B-5 |
| **WhatsApp** | Real adapter, broadcast service, enqueue validation, send path, webhook processor | **Meta HTTP**, token lookup, queue, Redis, and approval in send-path tests | **No, by design.** No approval path yet: B-6 |
| **Social publish** | Real adapter over real `scheduled_posts` | Nothing | It observes only and **cannot publish per person** |
| **Community** | Real adapter and refusal paths on the real schema | Nothing in these tests | **No.** No link can be created without a verified identity, and nothing writes one: B-7. The path that calls `executeAction` is unit-tested with fakes only. A scheduled action can execute after an opt-out (L-3) |
| **Browser** | Real adapter claims no channel | Nothing | **No, by design.** No RPA operation is safe to expose |

None of these is a provider integration test. **No test here proves a real message reaches a real provider.** That is T3.

## Lifecycle verification

Each row ran through the path that really records the event.

| Stage | Proof | Suite |
|---|---|---|
| List → target → enrollment → version → plan | Real stores and functions | `orch_campaign_targets`, `orch_journey_lifecycle` |
| Closed prospect refused at enrollment | PI state read live | `orch_journey_lifecycle` |
| Ledger opened at first action | PI's opener | `orch_journey_lifecycle` |
| Email: approval, send, recorded content | Evidence equals provider input | `orch_journey_lifecycle`, `pi_email_send_path_041a` |
| WhatsApp: queue, send once, retry safe | Real `processBatch` twice, one call | `orch_engines_real` |
| Delivery status | Real webhook processor | `orch_engines_real` |
| Reply by operator record | Journey ends, next task withdrawn, PI `engaged` | `orch_response_matrix` |
| Reply on WhatsApp | Real inbound processing, PI `engaged` with thread evidence | `orch_engines_real` |
| STOP | Governance written, journey ends, PI **closed** | `orch_engines_real` |
| One-click unsubscribe | Real service, governance written, no further send | `orch_response_matrix` |
| Hard bounce | Real ingestion, next email skipped | `orch_response_matrix` |
| Complaint, including replay | Person and address restricted, duplicate detected | `orch_response_matrix` |
| Delivery event | Evidence only, journey unchanged | `orch_response_matrix` |
| `opened` | Journey continues, PI unchanged | `orch_response_matrix` |
| Rejection | Journey ends, PI `not_interested`, human origin, re-enrolment refused. **Row inserted directly: B-9** | `orch_response_matrix` |
| Unknown send result | Never retried, goes to a person | `orch_engines_real` |
| Reply after the journey finished | Still reaches PI | `orch_journey_lifecycle` |
| Pause and resume | Nothing acts while paused | `orch_response_matrix` |
| Two concurrent sweeps | One message | `orch_response_matrix` |
| Tenant isolation | Outcome, sweep and WhatsApp inbound | `orch_response_matrix`, `orch_engines_real` |
| Lead-subject journey | Sends and ends on a reply | `orch_response_matrix` |
| Intelligence read back | Journey facts read PI score and state live | `orch_journey_lifecycle` |

**Not verified:** a real Meta or SES webhook over HTTP with signatures through these paths; supabase-js query shapes over PostgREST; `meeting_booked` (no integration exists); `no_response` (no writer exists); behaviour at scale.

## T1 / T2 / T3

**T1, per change:** affected unit suites and mutants. **T2, per commit:** typechecks, gates, full real-schema, rollback, whole-repo compare. **T3, release, needs authorization:** production parity, predeploy at merged main, real sends on a test tenant.

### T2 at the final commit

Run sequentially at `019b6de5`, tree `68ea57d7`, clean before and after. The disposable database was rebuilt for the run. Logs are in the evidence archive under `gates4/`.

| Gate | Result |
|---|---|
| Build | 104 migrations above the baseline's ledger, 878 public tables |
| Full real-schema | **Pass.** 71 of 71 suites; 1486 passed, 3 skipped, 0 failed |
| WhatsApp key migration | Rollback and re-apply both rc 0 |
| `typecheck-ci` | **Pass.** 3 of 3 projects, 0 errors |
| Worker typecheck | **Pass** |
| Route auth, route policy, migration quality, schema drift | **Pass** |
| Whole-repo jest | **Exit 1: 61 tests fail in 20 suites.** 40055 passed, 70 pending, 40186 total |
| Compared with `5025f51d` | **0 failures new.** Two baseline failures no longer fail: `extensionDispatchLeaseRenewal` and `extensionProductionTargeting`, which failed to run at the base |
| Mutants | **59 of 59 killed.** Three were re-anchored after the last fix and run again |

**The baseline was re-established at this branch's merge base `5025f51d`**, replacing the earlier `fa1a5e58` comparison. It had 61 failing tests in 22 suites, and 2 suites failed to run. The baseline failures are not diagnosed here and remain failures. `plannerOperationalMaturity` is in that baseline and passes and fails between runs. Outreach notes that seven baseline failures are in community and Meta suites, so those suites give this area no protection today.

**The typecheck gate is lenient in one way that matters here.** `strict` is off, so `.catch(() => null)` gives `any`, and a property read on a stale type is not reported. The reviewer reported a stale port type as a compile error. It was not one, and the type was corrected anyway.

### Combined with the release candidate

`019b6de5` merged with RC `7bdd76ae`, in a disposable worktree, never committed: merged with no conflicts; 112 migrations applied cleanly, 882 public tables; the five orchestration real-schema suites passed, 97 of 97 tests. Only the orchestration suites were run on the combination.

### Independent review

Two passes by a separate reviewer, with no conclusion handed to it. The first, on `f9f5d3f1`, found 10 issues; 8 were fixed and 2 recorded. The second, on the commits after it, found 7 defects and 2 plausible issues. Five were fixed in `019b6de5`, each with a test and a mutant. The others are recorded as L-1 to L-6 in `contract/GAP-REGISTER.md`.

### T3: not run

| Item | Needs |
|---|---|
| Strict schema parity against production | Read-only access, owner |
| Predeploy check at merged main | Merge authorization |
| Real email on a test tenant | B-3, B-4, B-5, provider-send authorization |
| Real WhatsApp on a test number | B-6, B-8, provider-send authorization |
| PostgREST-level journey | Local stack; can be done without authorization |

## Defects found and fixed in this phase

All in local commits. None was reachable in production, because orchestration is off there.

| Defect | Found by | Fixed in |
|---|---|---|
| A provider-refused email was sent again on every sweep | Contract test | `77e90518` |
| A new channel with no permission source would contact everyone | Contract test | `77e90518` |
| A gate hold was checked after the choice group, so a held candidate let the next one act | Review | `108169cd` |
| A skipped or cancelled step left a live WS-3 task that a later approval could send | Review | `108169cd` |
| An exit marked the run terminal before withdrawal, so a failed withdrawal could not be retried | Review | `108169cd` |
| A `requested` ledger row was read as an engine action, so an opt-out did not stop the step | Outreach, on community | `068e0343`, `30a421c2` |
| An interrupted WhatsApp submission later read as provider-refused | Test | `068e0343` |
| A stale claim could begin a step whose conditions had failed | Review | `019b6de5` |
| A failed broadcast read released the claim and created a second broadcast: a double send | Review | `019b6de5` |
| A settled WhatsApp request dropped its broadcast id, so a STOP after a failed submission was ignored | Review | `019b6de5` |
| An outage skipped a step for good, instead of waiting | Review | `019b6de5` |
| A failed WS-3 task was treated as nothing live, so a skip could let the next candidate contact the person again | Review | `019b6de5` |
| The report read a failed or truncated ledger read as "not requested" | Review | `019b6de5` |

## Defects found in the earlier phase

Found by running real engines on the real schema. Fakes had hidden all of these.

| # | Defect | Severity | Status |
|---|---|---|---|
| 1 | WhatsApp human-mode step sent with no approval | **Critical if enabled** | Fixed: `f7ff85d0` |
| 2 | Tenant kill switch and channel enablement did not reach WhatsApp journeys | **High** | Fixed: `f7ff85d0` |
| 3 | `expandRecipients` upsert has no matching unique key, so no recipient could be created | **High**, engine non-functional on this schema | Fixed: `20270120000002`. **May affect main's own broadcast route too; production unmeasured: B-10** |
| 4 | Every WhatsApp delivery status update failed silently (`status_at`) | Medium | Fixed: `f7ff85d0` |
| 5 | STOP counted as a reply, so PI called an opted-out person engaged | **High** | Fixed: `f7ff85d0`; my own earlier defect |

## Blocker register

| ID | Blocker | Evidence | Blocks | Owner | Next action |
|---|---|---|---|---|---|
| B-1 | D-2 unsigned | `D-2-A6-10-AUTHORIZATION.md` | Landing | **You** | Sign or decline |
| B-2 | D-3 unsigned | `D-3-A6-07-AUTHORIZATION.md` | Landing | **You** | Sign or decline |
| B-3 | Erasure ignores email evidence | Survey; design written | Any real email | **You**, privacy | Decide E-1..E-5, then build |
| B-4 | No outreach retention policy | `personErasure.ts`; `PI-C1-JEV-ARCHITECTURE-DECISION-002.md` records it as blocked | Any real email | **You**, counsel | Decide E-4 |
| B-5 | Email externals not in place | Edge function, SES configuration, SNS, keys; last measured 2026-10-20 | Real email | Owner, Outreach | After B-3; re-measure |
| B-6 | No tenant approval, and only super-admin can approve WS-3 | Design written; WhatsApp refuses | All real journeys at tenant level | **You**, then build | Decide A..E |
| B-7 | No writer for verified identity. **Corrected by Outreach:** the proof checks the recipient only, and nothing checks the acting account, so wiring a tenant OAuth flow would forge the evidence. A cold prospect will rarely complete OAuth | Community link refused | Community engine | **You** | O-4, then acting-account proof, then L-3 |
| B-8 | `PHONE_HASH_SALT`, `ENCRYPTION_KEY` needed by WhatsApp | Runtime errors in tests; production values unmeasured | WhatsApp | Owner | Check by name, without reading values |
| B-9 | `rejected` has no writer | `feedbackIngestion.ts` excludes it by design; nothing else writes it | `not_interested` unreachable | **You**, PI | Decide the human path; likely the tenant approval reject, or an operator route |
| B-10 | WhatsApp schema in production unknown | `database/whatsapp_system.sql` is outside the chain; baseline lacks the key | Knowing whether main's broadcast works today | Owner | Run the probe below |
| B-11 | Counter RPCs `increment_broadcast_counts`, `_stat` defined nowhere in the repo | Grep; catalog empty | WhatsApp analytics show zero; journeys unaffected | Outreach | Define or remove |
| B-12 | PI actor-FK fixes uncommitted, no tests, need writer validation | Proposal | Enabling orchestration | PI, **you** | F-1..F-4 |
| B-13 | H-3 exists under two version numbers; partially applied in production | Headers | Release | **You** | F-3 |
| B-14 | Autonomous dispatch | Disabled; design written | Nothing now | **You** | AU-1, when ready |
| B-15 | Legacy email noise: activate writes attempts for email it cannot send | Survey | Attempt-history quality | **You** | L-1, L-2 |
| B-16 | `approveOutreachTaskForOperator` drops `auditFailed` and auto-submits | Verified in code | An approval with no record returns ok | WS-3 | Fix with the approval build |
| B-17 | Queued WhatsApp broadcast still sends after a reply or later kill switch | Exit does not recall it; opt-out is honoured at send | Edge | Outreach | Send-time controls are fixed on Outreach's branch, not here. A reply still does not recall it |
| B-18 | Prospect ambiguity: person with several prospects never reaches PI | Producer refuses by design | Feedback completeness | PI | Accept or decide |
| B-19 | Release ordering: 19 stack migrations sort before production's 2027 versions | Runbook | Landing | Orchestration | Extend the runbook with 20270120* |
| B-20 | Verifier pin A7-1 stale | Plan line 538 | Release gate | Orchestration | Re-pin at merge |
| B-21 | `pi_person_erasure_ledger` failure F-1 on the RC | Earlier validation | RC | Privacy | Re-check when combined |
| B-22 | Tenants past 25, and a step on a channel with no engine, stay unserved or open | Reported as `workRemains` and `unsupported` | Scale; edge | Orchestration | Fix before multi-tenant rollout |

## Read-only probe for B-10 (one statement, no semicolon)

```sql
select (select count(*) from pg_constraint where conrelid = 'public.whatsapp_broadcast_recipients'::regclass and contype = 'u') as unique_constraints, (select count(*) from pg_proc where proname like 'increment_broadcast%') as counter_functions, (select count(*) from public.whatsapp_broadcast_recipients) as recipients, (select count(*) from public.whatsapp_broadcasts) as broadcasts
```

Zero unique constraints with zero recipients would confirm the broadcast path has never worked in production.
