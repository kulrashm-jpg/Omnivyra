# Outreach Engines: completion and readiness report

Status at 2026-11-02. Branch `integration/outreach-engines-20261102`, code tested at 21f62238, which contains `feat/orchestration-recovery` 30a421c2 and the five engine branches. Local only: nothing is pushed, merged, deployed, applied to production or sent to a provider.

## Bottom line

**The definition of success is not met.** An authorized workflow cannot yet get a real action from any of the five engines through a real provider. Every engine was inventoried, 24 defects were fixed in the engines, the adapter changes were applied by the orchestration owner, and T2 passes, but no provider call has been made, and the remaining blockers are decisions and external setup, not missing engineering alone.

| Engine | Can a journey request it today? | What it can really do | Verified to |
|---|---|---|---|
| WS-3 internal | Yes in code; flag off | Internal task with approval | Real PostgreSQL |
| WS-3 email | Blocked (B-3, B-4, B-5, B-6) | Full send path up to the provider | Real PostgreSQL + recording provider |
| WhatsApp | Refused by design (B-6), and broken below that (WA-1, WA-2, WA-3) | Broadcast send path up to the provider | Real PostgreSQL + stubbed Meta |
| Social publishing | Observe only | Real publish code for 6 platforms, reached by the campaign flow rather than by a journey. **No person-level outreach at any layer** | Real PostgreSQL + fake provider |
| Community actions | Refused: no proof of the acting account or the recipient | Reply and like; all DMs refused | Refusal paths on real PostgreSQL; the rest fakes |
| Browser automation | Refused, and rightly | Reply and like via Playwright, as a transport under community. Not a separate engine | Fakes only |

"Real PostgreSQL" means a disposable local database. No test here proves a message reaches a provider.

## Live on `main` today, fixed only on this branch

These are findings from reading code. Production usage was not measured.

| Finding | Effect | Depends on |
|---|---|---|
| Safety-net cron `process-scheduled-posts` publishes with no `authorizePostPublish` | A post on a non-active campaign can go out | Whether a pause cancels rows: not established |
| RPA path unhardened: re-runs after a possible submit, plaintext sessions, replayable tokens, no URL policy | Duplicate actions, session exposure | Whether RPA rows or sessions exist in production |
| Community API failure falls back to browser; reply and like ids are random; the reaper marks possibly-sent rows failed | Duplicate actions by whichever account is logged in | Whether community actions run in production |
| WhatsApp send path: no send-once claim, status updates fail silently | Double send on retry, statuses lost | Operator POSTs return 400 first (WA-1), so likely unreachable |

Branch fixes that depend on migrations need 20261231000002 to 000010 applied first; see the runbook.

## What was fixed

Each fix has a test shown to fail without it, unless marked. All engine-side evidence is fake or recording, except where T2 below ran real PostgreSQL.

| Engine | Branch | Fixed | Not fixed, and why |
|---|---|---|---|
| WS-3 email | `outreach/ws3-email-20261102` 9c93fe42 | G-1 network or 5xx no longer reads as not sent; G-9a approval with no audit record is reported; G-7 SNS `SubscribeURL` logged after checks; G-4 stale `dispatching` reported; G-8 transport off writes nothing; G-3 false comments (no test possible) | G-2 and G-9b sit in shared code. G-4 reporting appears only when the unscheduled cron route is called |
| WhatsApp | `outreach/whatsapp-20261102` 0bd12963 | WA-5 webhook 503 when not queued; WA-6 rethrow so attempts apply; WA-11 status errors read, forward-only; WA-20 inbound lookup; WA-13 pagination; B-17 send-time controls for journey sends | WA-1, WA-2, WA-3 each open a send path: owner |
| Social | `outreach/social-20261102` fc41fac3 | G-1 cron authorization; G-2 no adapter is a definite refusal; G-3 mock providers refused in production; G-4 non-retryable honoured; G-11 unsupported platforms refused at the worker; G-15 comment corrected by orchestration | G-5 (adapter reads the retry state) is still only proposed. A failed post that will retry reads as failed to a journey until then |
| Community | `outreach/community-20261102` ea0fe5bd; `outreach/community-maycontact-20261102` ae5f5242 | G-8 observation lock now applies to network candidates. G-6, G-7, GAP-02 applied by orchestration (96c12e8b). Contact governance checked before the claim (30a421c2) | **G-13 rejected:** the inventory called it safe; running it showed a refusal would turn into a browser dispatch by whichever account is logged in. Browser mode and the API-to-browser fallback (G-10) stay unbound for rows that reach the engine outside a journey |
| Browser | `outreach/browser-20261102` 4322048b | GAP-09 redirect re-check; GAP-10 screenshot after a failure; GAP-11 signed URL no longer stored; GAP-13 cookie domain filter; GAP-14 no false verification stamp; twitter reply id | **GAP-03 unfinished: replies can still falsely report `executed`.** The honest status would drop out of limit counters and let refused actions run. Owner, with GAP-17 |

Agent-reported, and checked only through the T2 runs below: the per-fix "fails without the fix" proofs.

## T1 / T2 / T3

| Level | Result |
|---|---|
| T1 | Per-engine affected suites passed in each branch (fakes) |
| T2 real schema, at 21f62238 | **71 of 71 suites; 1488 passed, 3 skipped.** Disposable PostgreSQL 17.6 + pgvector rebuilt from baseline, 104 migrations |
| T2 typecheck-ci, worker | Pass, at 21f62238 |
| T2 route auth, route policy, migration quality, schema drift | Pass, at 21f62238 |
| T2 whole-repo jest, at 21f62238 | Exit 1: 2293 of 2318 suites, 40249 of 40379 tests passed. 60 failures, **all in the recorded baseline of 70, none new** |
| T3 | **Not run.** Needs authorization: production parity, predeploy at merged main, real sends on a test tenant |

The 60 baseline failures were recorded at fa1a5e58 and are not diagnosed. Seven touch this area, so these suites give no protection today: `community_ai_core_apis` (3), `community_ai_webhooks` (2, including "does not call cross-tenant webhooks"), `community_ai_scheduling` (1) and `metaGraphApiVersionConsistency` (1).

Journey evidence, on the disposable database: `orch_contract_journey` runs one whole email journey from enrolment through approval, send, delivery, reply and PI update to reporting, with a recording provider. `orch_engines_real` runs the real WhatsApp service and webhook processor with Meta HTTP stubbed, observes a real social row, and proves community and browser refuse.

Also not run: mutants for this round, PostgREST-level journey, real Redis or BullMQ, any real browser, any provider sandbox. A combined run with the release candidate has not been repeated.

## Ownership matrix

| Concern | Owner | Notes |
|---|---|---|
| Identity, enrichment, qualification, lifecycle | Prospect Intelligence | Outreach creates no prospect or contact records |
| Workflow, enrollment, decisions, sequencing, scheduling, approval, journey state | AI Orchestration | |
| `ENGINE_NAMES`, `EngineAdapter`, `buildAdapterRegistry`, sweeper, `execution_engine_requests`, execution contract | AI Orchestration (`virality-c7`) | One registry. The mandate names no lead; the owner can overrule |
| Adapters' engine-side behaviour, capability `verification` values, what sits behind each adapter | Outreach | Adapter files change through the orchestration owner while its work is open |
| Suppression | `contact_governance_records` | Canonical. Do not add dependencies on the other two stores |
| Tenant and channel enablement | `outreach_governance_config` + `LEAD_OUTREACH_EXECUTION_DISABLED` | No app writer yet (F-11) |
| Tenant API keys | `integration_credentials` + A3P | WhatsApp uses `social_accounts`; SES is platform-wide |

## Integration compatibility register

| Item | Status |
|---|---|
| Contract v0.1 (`executionContract.ts`, `engineCapabilities.ts`, `journeyEvents.ts`) | Owned by orchestration, committed, merged here. Tested at sha256 77bc3e609177c85b / 3e45271a80c268e7 / 38c56967e4c56714 |
| `uncertain` | Done: a `certainty` field, not a state, so it never reads as FAILED or RETRY_REQUIRED |
| DELIVERED | Done: only from a delivery report. Community and browser declare `reportsDelivery: false` |
| Rejected email re-sent each sweep | Fixed by orchestration; `orch_contract_journey` proves one provider call however many sweeps follow |
| `channelPermissionFact` null for unknown channels | Fixed by orchestration: the sweeper holds the step as `needs_human`/`no_permission_source`. Pinned for `sms` and `phone` |
| A requested row could still act after an opt-out | Found here on community, fixed by orchestration (068e0343, 30a421c2). It could not be reached while identity refuses |
| Community responses not read by journeys | Recorded gap, blocked behind identity |
| Non-WS-3 outcomes have no store (`outreach_outcomes.task_id` NOT NULL) | Recorded gap |
| Adapter changes from this round | Applied by orchestration as 96c12e8b, except G-5. See `PROPOSED-ADAPTER-CHANGES.md` |
| Contract v0.2 | `CONTRACT-V0.2-PROPOSALS.md`. Sent to the owner of the contract; not decided, not built |
| Merge order | Orchestration first, then this branch. One conflict was resolved as a union and tested. Orchestration's work continues: uncommitted changes in its worktree are not in this test |

## Provider dependency register

Names only. Nothing was read or retrieved.

| Dependency | Needed for | State |
|---|---|---|
| SES configuration set, edge function deployed, sender identity | Real email | Last measured 2026-10-20: not in place. Re-measure |
| SNS topic, subscription confirmation | Bounces, complaints | Needs the now-logged `SubscribeURL` |
| Email unsubscribe keys | Real email | Not in place when last measured |
| Email evidence erasure and retention (E-1..E-5) | Any real email | Owner and counsel |
| Compliance footer postal address | Real email | None exists; no legal finding made |
| Meta app, system token, verified webhook, `phone_number_id`, `waba_id` | WhatsApp | Nothing writes the last two (WA-3) |
| `PHONE_HASH_SALT`, `ENCRYPTION_KEY` | WhatsApp | Production unmeasured. The salt is in no workflow or env example |
| `LEAD_OUTREACH_EXECUTION_DISABLED` | Journey WhatsApp sends | **Must now be set on Railway as well as Vercel** |
| Social platform permissions per platform | Publishing | No provider sandbox evidence in the repo |
| Acting-account proof, recipient evidence | Community | Design in `inventory/engine4-community.md` and below; recipient proof is a product decision |
| RPA session authorization | Browser | Open legal question (GAP-17) |
| Extension client | Community extension path | Not in the repo, history or this machine |

## Owner decisions

| # | Decision | Recommendation |
|---|---|---|
| 1 | Backport the cron authorization fix to `main` ahead of the rest? | Yes. It is the one finding that can publish wrongly today, and it stands alone |
| 2 | Measure production: any RPA rows or sessions, any community executions, `USE_MOCK_PLATFORMS`, `RPA_SCREENSHOT_DIR` | Yes, before merging. Setting `USE_MOCK_PLATFORMS` in production would now fail every publish |
| 3 | Is session-reuse RPA allowed at all? `WP8_LINKEDIN_FEASIBILITY_DECISION.md` put it out of bounds, written for ad-library work (GAP-17) | Decide first. If no, retire the scripts, and GAP-03 disappears |
| 4 | Tenant approval (A..E, B-6), then WA-1, WA-2, WA-3 in that order | Approval first, since those fixes open a send path |
| 5 | Community recipient proof: a cold prospect will not complete OAuth, so `subject_platform_oauth` will rarely exist. The recorded blocker B-7 understates this | Decide whether journeys may act on non-consented recipients at all. Build `proveActingAccount` regardless: the other 10 entry points need it |
| 6 | Email: E-1..E-5, retention, who reads replies, sender model | Needed before any real email |
| 7 | Social: what does one post mean for N people in a journey? | Leave observe-only until decided |
| 8 | What does an action cost in credits (C-1)? No engine charges today | Needed before rollout; reporting can come first |
| 9 | Dead letters now hold raw WhatsApp payloads, including phone numbers and text | Set a retention period before merge |
| 10 | Governed path: this work has no OMNI Story, so commits carry no `Governed-By` | Create a Story before merging. Only a human can |

## What changes in production once merged

- WhatsApp webhook can return 503 during Redis trouble; exhausted jobs reach dead letters with personal data.
- Email: 5xx or network errors park the task permanently (`blocked_prior_attempt`), including failures that sent nothing, and no route clears it. With email off, tasks stay `approved` and write nothing. The approve route can return 500 with the task already approved. SNS `SubscribeURL`, containing AWS's one-time confirmation token, reaches logs.
- Social: posts on non-active campaigns wait and go out late on resume, with no staleness check. Empty posts stay `scheduled`, visible only in logs. `retryable:false` fails on the first attempt.
- Browser: session saves with no platform cookie or a non-ISO expiry get 400. Local screenshots stop unless `RPA_SCREENSHOT_DIR` is set.

## Corrections to earlier records

- B-7 is wrong as recorded. The proof checks the recipient only; nothing checks the acting account. Wiring a tenant OAuth flow into `subject_platform_oauth` would forge the evidence.
- The prior "browser cannot act" claim is incomplete: journeys can reach RPA through the community adapter once links exist (GAP-02).
- The "unknown result never retried" row cites a WhatsApp test; no real-schema email equivalent was found.
- Integration Hub phases 1 to 4 are on main (33288cd2). The PI discovery registry holds Apollo, not nothing. `suppression_entries` is still written; only `outreach_suppressions` is write-dead.
- Historical safety commits (38dd25de and others) are integrated by patch-id, not by ancestry.

## Other documents

- `inventory/`: the six inventory reports with classifications, file references, 18-field compliance, state mappings and gap registers. They describe dc7f2ae3, before these fixes, and were produced by reading code.
- `PROPOSED-ADAPTER-CHANGES.md`: what was applied, and what remains for orchestration-owned files.
- `CONTRACT-V0.2-PROPOSALS.md`: provider availability and webhook verification, for the contract owner.
- `FUTURE-ENGINES-SMS-VOICE.md`: extensibility evidence.
- `proposals/`: the copies sent to orchestration, kept as a record. The applied versions in `backend/` supersede them.
