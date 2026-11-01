# Legacy operator email: dependency and retirement plan

**Status: plan only. Nothing removed.** "Legacy operator email" means email for an `outreach_tasks` row with no `outreach_bridge_handoffs` row.

**Basis:** code trace by read-only survey, plus the tests in this branch. Production flag values, governance rows and whether any such tasks exist are **unmeasured**.

## Current state: fails closed, with one untidy edge

No production path can deliver a no-handoff email:

| Caller | Reaches a provider? | Why not |
|---|---|---|
| `pages/api/super-admin/outreach/activate.ts` | No | Refuses a body `recipient`, so the transport returns `invalid_recipient` (or `disabled` with the flag off). `ActivationOptions.recipient` has no production caller |
| `pages/api/cron/outreach-dispatch-recovery.ts` | No | Internal-only by default, flag-gated, not scheduled |
| `workflowProgressionSweeper` via the adapter | Bridged tasks only | Sends through `dispatchWorkflowEmailTask`, which needs a handoff |
| `pages/api/super-admin/outreach/approve.ts` | No dispatch | Can approve one, but sends nothing |
| `pages/api/lead-intelligence/execution.ts` | No | No WS-3 import. Its `executionBridge` was not traced; the route's comment says dry-run |
| `scripts/ws3-*` | Stub provider only | Local certification |

**And if a recipient ever were supplied:** application callers now compose the `engine`, whose render refuses a task with no handoff (`content_unavailable`). A real-schema test proves no-handoff is not sendable.

**The untidy edge.** Activate with `channels: ['email']` gets past governance if allowed and **writes an attempt and evidence, then returns the task to `queued`**, each time it is called. Nothing is sent, but:
- It adds rows on each retry.
- Activate lists tasks by lead, so it also touches **bridged** email tasks: a non-sent attempt and a requeue.
- By inference, stranded queued email rows sit at the head of the recovery sweep's scan (oldest `updated_at`, limit 200) and could crowd out real work.

No send, no leak, but noise in the attempt history that erasure and reporting read.

## Dependencies

**Code that must keep working after retirement,** because it reads what this path wrote:

`dispatch.ts` re-dispatch checks · `providerMessageResolver.ts` and `sesProviderEventIngestion.ts` (late provider events) · `unsubscribeService.ts` (historic links) · `pages/api/outreach/outcomes.ts` and `feedbackSummary.ts` · `prospectOutcomes/corpus.ts` · `outcomeLifecycleProducer.ts` · `quota.ts`.

So retirement means **no new sends**. It does not mean deleting rows.

**Tests that pin legacy behaviour and will change:**

| Test | Asserts |
|---|---|
| `ws6aOutreachActivation.test.ts:96` | Widening dispatches email (inverted in the parked version) |
| `ws3RecoverySweep.test.ts:238` | `channel_not_permitted`; the parked check order breaks this |
| `closure009PrivilegedWriteAuthorization.test.ts:470` | No recipient override |
| `pi_email_send_path_041a.test.ts` | Skipped retirement test, to enable |
| `piEmailSendBoundary041a.test.ts:237`, `piChannelCapabilityModel.test.ts:76` | To review |

**The placeholder composition** in `transportRegistry.ts` remains only for WS-3 harnesses. A test pins that application callers choose `engine`.

## Parked design: what to take and what not to

`refs/preserve/wt/pi-consol` adds `RETIRED_ACTIVATION_CHANNELS = ['email']`, filtered from `permitted`, and a `channel_retired` action checked before the permitted and transport checks. No dispatch, attempt or evidence. It is enforced in the service, so a route change cannot reopen it.

**Take that part only.** That same diff also contains, and must **not** be ported:
- Loss of `taskIds` and `queued` handling, which would break the recovery sweep.
- A `SUPER_ADMIN_DASHBOARD_VIEW` authorization downgrade.
- A body `recipient` passthrough.

Its stated rationale is also stale: the edge function does now have a `lead_outreach` template.

## Plan

| Phase | What | Gate to proceed |
|---|---|---|
| **0. Measure** | Read-only: count no-handoff email tasks and attempts by status; any historical sends | Owner runs the probe below |
| **1. Stop the noise** | Port `channel_retired` in the service, only that. Activate no longer writes attempts for email. Bridged tasks stop being touched by activate | Owner approves PI-041-A-E; T1, T2 |
| **2. Drain** | Move stranded queued no-handoff email tasks to `cancelled`, through WS-3's writer, with a report. Non-destructive: terminal state, rows kept | Phase 0 counts reviewed; separate production authorization |
| **3. Remove code** | Remove the email option from activate's API. Remove the placeholder composition once harnesses are migrated | One release after phase 1 with no `channel_retired` hits |
| **Never** | Delete attempts, evidence, or outcomes | |

**Rollback:** phase 1 is a one-line constant. Phase 2's `cancelled` is terminal by the state machine, so it cannot be reversed; re-create tasks if ever needed, which is why it needs the counts first.

## Read-only probe (one statement, no semicolon, safe for the Supabase console)

```sql
select t.status, count(*) as tasks, count(*) filter (where exists (select 1 from public.outreach_attempts a where a.task_id = t.id)) as with_attempts from public.outreach_tasks t where t.channel = 'email' group by t.status
```

This counts all email tasks by status. The bridge table is not on main, so until the stack lands in production every email task there is no-handoff by definition. Whether the bridge table already exists in production is itself unmeasured: the probe in `RECOVERY-BASELINE.md` answers that first.

## Decisions needed

| # | Decision | Recommendation |
|---|---|---|
| L-1 | PI-041-A-E: retire legacy operator email | Approve phase 1 |
| L-2 | Run the read-only probe | Yes, before phase 2 |
