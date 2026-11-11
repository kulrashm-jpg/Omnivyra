# WhatsApp broadcast counters and billing: analysis and contract proposal (Follow-up B)

Owner direction, 2026-11-09, Follow-up B: **analysis and contract proposal only.** Nothing here is implemented.
- No refund, no new billing ledger writer, and no change to commercial charging semantics.
- Billing ownership must be obtained before any of those.

**Basis:** foundation head `6c5289c40`, the static code and the governed schema (`supabase/_schema/baseline.sql` plus every migration). No production database or provider was read. Where the answer depends on production, this document says so. **Release: NO-GO.**

## 1. The counters and what they mean today

`whatsapp_broadcasts` has five counters. Nothing else in the WhatsApp flow is a counter.

| Column | Intended meaning | What actually writes it | Effect today |
|---|---|---|---|
| `total_recipients` | Recipients of the broadcast | `insertRecipients` (`expandRecipients` and `expandPersonRecipients`): **set** to the rows inserted by *this call* | A second add-recipients call **overwrites** the total with that call's count |
| `sent_count` | Accepted by Meta | `processBatch` → `supabase.rpc('increment_broadcast_counts', { p_sent })`, at the end of each batch | See the finding below |
| `failed_count` | Failed | Same RPC, `p_failed` | See the finding below |
| `delivered_count` | Delivered | `updateRecipientDelivery` → `supabase.rpc('increment_broadcast_stat', { p_column: 'delivered_count' })` when a webhook moved a row to `delivered` | See the finding below |
| `read_count` | Read | The same, with `read_count` | See the finding below |

**Finding B-1: the increment functions do not exist in the governed schema.**
- Neither `increment_broadcast_counts` nor `increment_broadcast_stat` is defined in the baseline dump or in any migration.
- Neither caller checks the RPC's error. The unit fake records them as functions that "exist nowhere" (`backend/tests/helpers/fakeWhatsappDb.ts`).
- On any database built from the repository, `sent_count`, `failed_count`, `delivered_count` and `read_count` therefore stay 0.
- **Whether production has these functions out-of-band is unverified.** It needs a read-only catalog check, which in turn needs separate authorization; the Supabase CLI creates a login role.

**What the bucket inputs mean today** (the `processBatch` local counts):
- `sentCount`: Meta returned a message id.
- `failedCount` adds up four different things:
  - a confirmed provider refusal (4xx with a Meta code);
  - an **uncertain** outcome (timeout, lost response, 5xx/408, accepted without an id);
  - a governance block (`blocked_governance`);
  - a journey send-control block (`blocked_send_control`).

So `failed_count` cannot distinguish failed from uncertain from refused.

## 2. Which counter represents which outcome

| Outcome (owner's terms) | Recipient state (authoritative) | Counter today |
|---|---|---|
| Attempted | Reached `sending` (the claim; `send_started_at` on the Follow-up A branch) | **None** |
| Accepted | `wa_message_id IS NOT NULL` (Meta returned or reconciled an id) | `sent_count` (only for ids returned inline; never for reconciled ones) |
| Delivered | `delivered` or `read` (read implies delivered) | `delivered_count`, but only when a `delivered` event moved the row |
| Read | `read` | `read_count` |
| Failed (confirmed) | `failed` with Meta evidence (a code, or a `failed` event) | Mixed into `failed_count` |
| Uncertain | `send_uncertain`, or a stale `sending` | Mixed into `failed_count`; **no counter of its own** |
| Refused before sending | `blocked_governance`, `blocked_send_control` | Mixed into `failed_count` |
| Withdrawn (lost enqueue acknowledgement) | `failed` with `ENQUEUE_UNCONFIRMED_MESSAGE` | **Not counted**: `processBatch` never ran |

**The authoritative record is the recipient row, not the counter:**
- the broadcast detail route already recomputes `recipient_status_counts` from the rows;
- the Orchestration adapter reads recipient status, never counters;
- **no send decision reads a counter.**

The counters are read only for display: `pages/api/analytics/whatsapp/broadcasts.ts` and `pages/whatsapp/broadcasts.tsx`.

## 3. Events that update each counter, and double counting

If the two RPCs existed, the current wiring would count as follows:

| Case | Today | Correct? |
|---|---|---|
| The same webhook replayed | Counted once. The move is a compare-and-set on status; only the invocation that moved the row increments | Yes |
| `read` arrives before `delivered` | `read_count` +1. `delivered` can no longer move the row (read is ahead), so `delivered_count` never counts it | **Undercount** |
| `failed` event after `sent` | The row moves to `failed`; **no** counter changes | **Undercount** (`failed_count`) |
| `delivered` after a `failed` event | `delivered_count` +1. Nothing to undo (`failed_count` was never incremented by the webhook) | Yes, by accident |
| Uncertain, then reconciled by the webhook (Work Item 2) | `failed_count` +1 at the send, then `delivered`/`read` +1 later. `sent_count` never counts it | **Double**: one message counted as failed and as delivered |
| Uncertain, then attached by the sweep (Follow-up A) | `failed_count` +1 at the send. The sweep changes no counter by design (pending this proposal) | **Wrong**: failed, never delivered |
| Confirmed failure, then `retryFailed`, then sent | `failed_count` +1, then `sent_count` +1 | **Double**: one recipient in both |
| Lost enqueue acknowledgement (withdrawn), then retry, then sent | `sent_count` +1 only | Yes, but the withdrawal is invisible in counters |
| A second add-recipients call | `total_recipients` set to that call's count | **Wrong** (overwrite) |
| Concurrent batch jobs | Each increments its own counts; replays are guarded by the claim | Yes |

**Answer: yes, late or reconciling events can double-count**, under three conditions:
- an uncertain send is later reconciled;
- a confirmed failure is later retried and sent;
- the RPCs exist in production at all (unverified, B-1).

Out-of-order delivery and failure events can also **undercount**.

## 4. Transitions that need correction

1. `send_uncertain` → `sent`/`delivered`/`read`/`failed` (webhook reconcile or sweep attach). The uncertain count must go down and the real outcome up.
2. Stale `sending` → `send_uncertain` (sweep). Uncertain goes up.
3. `failed` → `pending` → `sent` (`retryFailed`). Failed must go down when the retry is claimed.
4. `sent` → `failed` (webhook). Failed goes up.
5. `read` without a prior `delivered`. Delivered must include read.
6. `pending` → `failed` (withdrawn). Withdrawn must be visible, distinct from failed.
7. `blocked_governance` / `blocked_send_control`. These are refusals, not failures.
8. `total_recipients` across several add-recipients calls.

## 5. Billing: reservation or committed charge

**There is none in the application for WhatsApp.**
- **No credits or billing ledger:** no credit deduction, credit ledger, wallet, or billing-ledger write exists on any WhatsApp path (`whatsappBroadcastService`, `whatsappEngineAdapter`, the webhook processor).
- **No reservation:** the WS-3 durable quota with reserve-and-reconcile (`leadOutreachExecution/quota.ts`, over `outreach_attempts`) is **not** on the WhatsApp broadcast path. The Orchestration adapter calls `enqueueBroadcast`.
- **The only consumption is a rate quota, `whatsappRateLimiter.checkAndConsume`:**
  - a Redis daily counter per `phone_number_id`;
  - incremented at enqueue by the count of pending recipients, after screening;
  - never released (FU-D2).
- **Quota finding B-2 (not billing):** the database fallback, used when Redis is unavailable, does not enforce.
  - It reads `api_provider_accounts.current_usage_day` matched on `account_name = social_account_id`, which its own comment calls the "best available link".
  - It increments through `increment_wa_usage`, which is absent from the governed schema; the comment says it "falls through silently".
  - So without Redis, every enqueue sees the same stale usage.
- **Provider charges are external and unrecorded:** Meta's conversation charges are billed to the WhatsApp Business Account outside the application, and nothing in the application records them.

**Consequence:**
- A counter correction changes no charge.
- Introducing a charge, a reservation or a refund for WhatsApp is new commercial semantics, and needs Billing ownership first.

## 6. Proposal: counters derived idempotently from the recipient rows

**Principle:** a counter is a function of the authoritative rows, never a running increment. A recount is idempotent by construction: replays, late webhooks, reconciliation, the sweep and retries all converge to the same numbers.

**P-1. One set-based function, `whatsapp_broadcast_recount(p_broadcast_id uuid)`** (Outreach migration, `service_role` only). It sets the counters from one `GROUP BY status` over `whatsapp_broadcast_recipients`:

| Counter | Definition |
|---|---|
| `total_recipients` | Count of all rows (fixes the overwrite) |
| `sent_count` (accepted) | Rows with `wa_message_id IS NOT NULL` |
| `delivered_count` | Rows in `delivered` or `read` |
| `read_count` | Rows in `read` |
| `failed_count` | Rows in `failed` **except** withdrawn ones (the withdrawn message) |
| **new** `uncertain_count` | Rows in `send_uncertain`, plus `sending` without an id |
| **new** `refused_count` | Rows in `blocked_governance` and `blocked_send_control` |
| **new** `withdrawn_count` | Rows in `failed` with the withdrawn message (or a dedicated status, if the owner prefers) |
| **new** `counted_at` | The recount time |

`attempted` is derivable (accepted + failed + uncertain) and needs no column.

**P-2. Callers, all existing event points.** No new event system, queue or scheduler:
- the end of `processBatch` (replaces `increment_broadcast_counts`);
- `updateRecipientDelivery` after a row moved (replaces `increment_broadcast_stat`);
- the Work Item 2 reconcile;
- the Follow-up A sweep after attach or mark;
- `retryFailed` after the reset;
- `insertRecipients`.

**A failed recount never fails the send path:** it is logged and the next event repairs it. The counters are display-only, so a lag is cosmetic and self-healing.

**P-3. Concurrency.**
- Two recounts racing each write a consistent snapshot. The later commit may briefly lag a move made between them, and the next recount corrects it.
- To make the last write always the newest, the function can take `pg_advisory_xact_lock(hashtext(p_broadcast_id::text))`.

**P-4. Cost.**
- One aggregate per event over one broadcast's rows. The existing `broadcast_id` access path is used; a covering index on `(broadcast_id, status) INCLUDE (wa_message_id)` is proposed with the migration.
- For very large broadcasts, webhook-driven recounts can be coalesced per broadcast (at most one per N seconds) without losing correctness, since any later recount is complete.

**P-5. Readers.**
- The analytics route and page read the corrected columns.
- `failed` in the UI splits into failed / uncertain / refused / withdrawn.
- The detail route already reads rows and needs no change.

**P-6. Backfill.** A one-time recount of every broadcast (bounded batches) once the function exists. It is idempotent, so it can be re-run.

**Alternatives considered:**
- **Fix the two missing increment RPCs:** rejected. Increments cannot represent the moves in §4 without per-transition decrement logic, and every new path would need its own increment rule. This is how B-1 and the doubles in §3 arose.
- **Compute on read only, in the analytics route:** correct, but it moves an aggregate over every recipient of every broadcast into a list endpoint. Acceptable as an interim fallback if the owner prefers no migration now.

## 7. Explicitly not proposed

- Refunds, quota release (FU-D2 stays design-only) and any billing-ledger writer.
- Any change to what is charged, reserved or limited. `checkAndConsume` is unchanged.
- Fixing the quota database fallback (B-2) is a separate decision. It touches enforcement, not counting.
- Any production read or write.

## 8. Decisions for the owner

| # | Decision | Recommendation |
|---|---|---|
| CB-1 | Adopt derived counters (P-1/P-2) over fixing the increment RPCs | Adopt |
| CB-2 | New counter columns (`uncertain_count`, `refused_count`, `withdrawn_count`, `counted_at`), or keep five columns and fold the new buckets into the API response only | New columns |
| CB-3 | Authorize a **read-only** production catalog check for `increment_broadcast_counts`, `increment_broadcast_stat` and `increment_wa_usage` (B-1/B-2), by a path that creates no login role | Authorize |
| CB-4 | Billing ownership for WhatsApp: whether any in-app charge, reservation or refund should exist at all | Name an owner before any design |
| CB-5 | Quota fallback B-2: fail closed without Redis, or fix the link and RPC | Separate review |

On approval of CB-1/CB-2, implementation would be a separate Outreach branch: one migration, the callers in §P-2, and tests for each §3 case and each §4 transition. The T1 evidence would come before any integration request.
