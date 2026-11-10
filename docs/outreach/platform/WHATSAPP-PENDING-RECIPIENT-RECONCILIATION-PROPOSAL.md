# Pending-recipient gap after a queuing-uncertain enqueue: reconciliation proposal

Owner decision, 2026-11-09: "do not expand this change"; prepare a proposal that reuses the existing recipient, provider-event and audit infrastructure. **Proposal only; nothing is implemented. Release: NO-GO.**

## 1. The gap

`enqueueBroadcast` adds one queue job per batch (`jobId = wa-batch-<broadcast>-<n>`). When the add throws, the job may still have been stored. Work Item 2 then withdraws the batch's `pending` recipients (`pending → failed`, compare-and-set, `ENQUEUE_UNCONFIRMED_MESSAGE`).

**When the withdrawal itself cannot be written** (`WhatsAppEnqueueUncertainError`):
- the recipients stay `pending`;
- the adapter marks the step `uncertain` / `needs_human` (`8ae4af212`).

What follows depends on whether the queue kept the job:

| The queue… | What happens to the recipients | Visible today? |
|---|---|---|
| kept the job | The job claims and sends them normally (once, by the claim) | Yes: the recipients move |
| never kept the job | They stay `pending` indefinitely | **No.** Nothing looks at them: Follow-up A's sweep reads only `sending` and `send_uncertain`, and `retryFailed` only `failed` |

The operator sees an `uncertain` step but cannot tell which case occurred, and must not resend until it is known.

## 2. What already makes resolution safe

| Fact | Where |
|---|---|
| A `pending` recipient has **never been sent**: the claim `pending → sending` happens before any provider call, and only the invocation that wins it may send | `processBatch` (CAS claim) |
| The withdrawal is a CAS on `status = 'pending'`. Once it succeeds, no job, late or not, can claim the row | `settleUnconfirmedEnqueue` |
| A late job after a withdrawal sends nothing | WI2 test "the job was stored but runs later: the withdrawal wins" |
| A withdrawn row is retried safely by `retryFailed` (CAS reset, then the same claim) | Work Item 2 |
| Completed batch jobs are removed after 1 hour; failed ones are kept 7 days (`removeOnComplete` / `removeOnFail`); job ids are deterministic | `contentGenerationQueues.ts`, `enqueueBroadcast` |
| The queue's job lookup by id is already used by other adapters | `masterContentAdapter`, `blogContentAdapter`, `creatorContentAdapter` |

**So the question is never "was it sent?"; for a row still `pending`, it was not. The only question is whether a live job will still claim it.** Answering that needs to know which job the row was given to.

## 3. Proposal

**PR-1. Record the batch's job on its recipients *before* the add** (Outreach migration, two nullable columns on `whatsapp_broadcast_recipients`):
- `enqueue_job_id text` and `enqueue_attempted_at timestamptz`.
- They are written in one update for the batch's `pending` rows, immediately before `enqueueOrThrow`.
- **If that write fails, the add is not attempted.** Nothing is uncertain, and the error surfaces as it does today. So any uncertain enqueue has its job id on its rows.

**PR-2. Reconcile in the Follow-up A sweep, as a third candidate class.**
- **Candidates:** rows `pending` with `enqueue_job_id` set and `enqueue_attempted_at` older than the threshold, chosen well above the add's in-flight window.
- **Bounds:** tenant-scoped, bounded, using the same configuration as the sweep.
- **For each distinct job id, read the job from the queue (read-only):**

  | Job state | Meaning | Action |
  |---|---|---|
  | `waiting`, `delayed`, `prioritized`, `active` | The queue kept it and will run it | **None.** The claim decides; the next sweep re-checks |
  | `completed`, `failed`, or **absent** | No live job will claim these rows. A completed job would have moved them; a failed or absent job never claimed them | **Withdraw** with the existing CAS (`pending → failed`, the withdrawn message). Audit `enqueue_not_retained_withdrawn` |
  | **Queue unreadable** | Unknown | **Nothing changes.** Flag `awaiting_operator_review`; never inferred |

- **Atomicity:** each withdrawal and its audit row go in one database function, as in Follow-up A (tenant derived from the broadcast; the CAS on `pending`).
- **Race with a late job:** if a job claims a row between the queue read and the withdrawal, its claim wins and the withdrawal changes nothing (the CAS on `pending`).

**PR-3. Operator visibility; no automatic resend.**
- Withdrawn rows are `failed` with the withdrawn message. They join Follow-up B's proposed `withdrawn_count`.
- A person may then retry through the existing `retryFailed`; it is never automatic.
- **The adapter's `uncertain` request stays human-resolved** (owner decision on `8ae4af212`). The reconciliation changes recipient rows only; it never converts the step.
- The operator view (`listUnconfirmedWhatsAppSends`) gains the class, so a person sees: "queue did not keep batch X; recipients withdrawn; safe to retry".

**PR-4. Reuse, no duplication.**

| Need | Reused |
|---|---|
| Evidence of sending | Recipient status and the claim; provider events (`whatsapp_provider_events`) for anything that did send |
| Audit | `whatsapp_send_reconciliations`, with new `outcome` values in the same CHECK |
| Recovery | The withdrawal and `retryFailed` |
| Scheduling | The Follow-up A sweep function (still unscheduled) |
| New | Two columns, one database function, the queue read |

No new queue, store, event system or billing write.

## 4. Tests the implementation must carry

1. The queue kept the job (`waiting`/`delayed`): nothing changes; when the job runs, it sends once.
2. Not kept (absent): withdrawn once; a duplicate sweep changes nothing; `retryFailed` sends once.
3. A `failed` job whose rows are still `pending`: withdrawn, never sent.
4. A late job racing the withdrawal: exactly one of {claim, withdrawal} wins; at most one message.
5. Queue unreadable: no change, flagged.
6. A crash between the queue read and the withdrawal: the next run decides again; no double audit.
7. The pre-write fails: the add is not attempted, and no row is left with a job id but no job.
8. Tenant scope; the operator view; the adapter step stays `uncertain` throughout.
9. A legitimately delayed large broadcast (rows `pending` with a live job) is **never** withdrawn.

## 5. Decisions for the owner

| # | Decision | Recommendation |
|---|---|---|
| PR-A | Adopt the job-id pre-write and the queue read (PR-1/PR-2) | Adopt |
| PR-B | The threshold (e.g. 30 minutes, above the add's in-flight window and the batch delays) | 30 minutes, configurable |
| PR-C | Whether a confirmed "not retained" result, plus all recipients settled, should also let a person close the adapter's `uncertain` step from the operator view | A later Orchestration decision; not in this change |
| PR-D | Implementation on its own Outreach branch, after `8ae4af212` and Follow-up A are integrated | Yes |
