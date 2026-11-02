# Release-readiness assessment

**Verdict: NO-GO for enabling orchestration, and for any real send.** The code can be reviewed for merge as local work, with the flag off. Every remaining blocker is an owner decision, external setup or another workstream's change. None is unfinished engineering inside Orchestration's ownership, except the limits in `GAP-REGISTER.md`.

The branch is `feat/orchestration-recovery` at `019b6de5` plus the documents commit. It is local, not pushed, not merged, not deployed. No migration is applied anywhere real, and no provider has been called.

## The target chain

| Link | State | Proof |
|---|---|---|
| Prospect Intelligence → Enrollment | Works | Real schema |
| Enrollment → Orchestration decision | Works | Real schema |
| Decision → authorized execution | Works up to the provider, for email. **Approval is super-admin only.** WhatsApp refuses for lack of approval | Real schema, provider stubbed |
| Execution → response and event | Works from recorded events | Real schema. **No real signed webhook has run** |
| Response → journey adaptation | Works | Real schema |
| Adaptation → PI update | Works through PI's producer | Real schema. **Actor rule unratified** |
| PI update → outcome reporting | Works | Real schema |

`orch_contract_journey` runs one whole email journey through every link in one test, with a recording provider. That is the strongest end-to-end evidence: real PostgreSQL, real stores, a stubbed provider.

## Evidence

| Level | Result |
|---|---|
| T1 | Affected unit suites pass: 19 suites, 526 tests |
| T2 | Pass at `019b6de5`: real schema 71 of 71; typechecks; gates; whole-repo jest has 0 failures new against `5025f51d`; 59 of 59 mutants killed |
| Combined with RC `7bdd76ae` | merged with no conflicts; 112 migrations applied cleanly, 882 public tables; the five orchestration real-schema suites passed, 97 of 97 tests. Only the orchestration suites were run on the combination. |
| T3 | **Not run.** Each part needs authorization |

## What must happen before enabling, in order

| # | Step | Owner | Blocks |
|---|---|---|---|
| 1 | Decide D-2 and D-3 | Owner | Landing `20270113000000` |
| 2 | Land the RC, with H-3 under one version (F-3) | Owner | Everything below |
| 3 | Ratify the actor rule; land writer validation with the actor-FK removal, writer first (F-1, F-2, F-4) | PI, governance, owner | Enabling |
| 4 | Outreach merges `019b6de5` and re-runs its T2; then one merge order: Orchestration, then Outreach | Outreach | Merge |
| 5 | Measure production for the stack's tables, especially `prospect_lists`, live from a local-only branch (read-only) | Owner | Applying migrations |
| 6 | Extend the release runbook (B-19), re-pin the verifier (B-20), predeploy at merged main | Orchestration, at merge | Release |
| 7 | Tenant approval: decide A to E, then build | Owner, then Orchestration | Any tenant-level journey; WhatsApp |
| 8 | Erasure and retention: decide E-1 to E-5, then build | Owner, privacy, counsel | Real email |
| 9 | Email externals in place and re-measured (B-5) | Owner, Outreach | Real email |
| 10 | T3 on a test tenant: one real email, after 7 to 9 | Owner authorizes | Any real send |
| 11 | Enable per tenant, never globally first | Owner | |

Autonomous dispatch stays disabled throughout (AU-1).

## Fix on main now, independent of this branch

Outreach reports one finding live on `main` that can publish wrongly today: the safety-net cron `process-scheduled-posts` publishes with no `authorizePostPublish`. That is decision O-1. It does not depend on orchestration.

## Not verified

- A real provider: SES, Meta or any social platform.
- A real signed webhook over HTTP.
- supabase-js query shapes over PostgREST (G-9). The real-schema suites replace PostgREST with a SQL adapter.
- Real Redis or BullMQ, and behaviour at scale. Tenants past 25 per sweep are reported as `workRemains` (B-22).
- That a typecheck with `strict` off catches a stale type. It does not.
