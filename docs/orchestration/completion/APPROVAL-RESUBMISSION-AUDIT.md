# Approval resubmission audit (N2) and the revocation pause (RV-1)

Prompt 4, Deliverable B. Status: implemented on `orch/c4-b-journey`, not committed. Tests pass on real PostgreSQL.

## 1. What a resubmission is

`requestFreshApproval` (`backend/services/leadOutreachExecution/approvalBinding.ts`) is the explicit resubmit. It takes a task whose approval is **stale** back to `awaiting_approval`, so a person can approve it again. It is reached only through `POST /api/outreach/journey-approval { action: 'resubmit' }`, which calls `journeyApproval.resubmitTenantJourneyTask`.

There is no other explicit resubmit entry point:

- `approval.resubmitForApproval` is an alias of the first submission (`pending → awaiting_approval`).
- `settleRefusedApproval` is the dispatch gate's own move, which has no requester.

A resubmission **approves nothing and never authorises execution**:

- The approval log is unchanged.
- Dispatch refuses with `eligibility.not_approved`.
- A new approval needs `begin` and `approve` again, with a new binding, the self-approval rule and the passkey.

## 2. Who resubmitted: the record

The resubmission is recorded in the **existing `audit_logs` trail**, through the existing `insertAuditLogStrict`. No new store and no migration were added.

Other stores were considered and rejected:

- **`outreach_approvals`:** it would change the "latest decision" rule that the gate and the claim trigger read.
- **`outreach_decisions`:** its CHECK constraints don't fit a resubmission.
- **`capability_audit_log`:** it has no metadata column.
- **`execution_journey_decisions`:** it has no actor column.

Row shape:

- `actor_user_id`: the requester. This is the **authenticated principal** the route resolved, never a body field.
- `company_id`: the tenant.
- `action`: `OUTREACH_APPROVAL_RESUBMITTED`.

| `metadata` field | Meaning |
|---|---|
| `schema` | `outreach.approval.resubmission.v1` |
| `task_id`, `requester_user_id`, `tier` | what was resubmitted, by whom, on which surface |
| `approval_id`, `approval_decision`, `approval_decided_at` | the approval it supersedes |
| `previous_status` → `new_status` | `approved`/`queued` → `awaiting_approval` |
| `previous_verdict`, `previous_verdict_reason` | always `stale`, because only a stale approval is resubmittable; plus why |
| `previous_content_hash`, `current_content_hash` | the approved binding, and the binding now (over the same recipient the verdict used) |
| `reason` | the requester's own reason, if they gave one |
| `correlation_id` | the request context's correlation id, else its request id, else a random UUID |
| `evaluated_at`, `requested_at` | the caller's instant and the server clock |
| `authorises_execution` | `false` |

The row holds no address and no message content.

## 3. Rules

- **Missing requester context** (absent, empty or non-UUID): the resubmission is refused and nothing is written. The check sits immediately before the compare-and-set, so every earlier refusal returns exactly what it did before.
- **Byte-identical otherwise:** the success result is unchanged. A failed audit write is reported as `auditFailed: true` (the `approval.ts` precedent), never swallowed.
- **Idempotency: record-free.**
  - A task already `awaiting_approval` takes the existing early return and writes nothing.
  - Under concurrency only the compare-and-set winner writes, so there is one row per accepted transition.
- **Tenant isolation:** the task is read tenant-scoped, and another tenant gets `task_not_found`.
- **Lifecycle:**
  - after **rejection** (`rejected` is terminal) the resubmission is refused;
  - after **expiry** the verdict `expired` is refused, and once the gate settles the task it is terminal;
  - after **revocation** the task is `cancelled` and the resubmission is refused.

## 4. RV-1: a revocation pauses the run (owner decision 2026-11-05)

**Before:** the WS-3 adapter mapped every `cancelled` task to `skipped`, and the journey moved on.

**Now:**

- **Detection** (`engineAdapters.ts`): a `cancelled` task whose **latest stored approval decision is `revoked`** returns `needs_human` with outcome `approval_revoked:<sha256 of the revoked row id>`. Detection reads the approval log and never guesses. An unreadable log waits; any other cancellation is still `skipped`.
- **Pause** (sweeper): the run is paused via `setExecutionInstanceState` (the existing pause state), and a `needs_human` decision is recorded with that outcome. This is the same pattern as reply suspension. Paused runs are not swept, and the D-03 hold keeps handed-off tasks from sending.
- **Resume** (`PATCH /api/execution-instances/:id { lifecycleState: 'active' }`, optionally with a `returnDate`): the suspension is on record and the run is active again, so the step is skipped with decision `approval_revoked_reviewed`.
  - The revoked approval is **never revived**: the task stays `cancelled`, and a direct dispatch of it does not send.
  - The next step waits for a fresh, bound approval.
  - Provider calls stay 0, as the test proves.
- **End:** the same route with `cancelled`, which withdraws unsent tasks.
- **Event view:** Agent A maps the `approval_revoked:` prefix to `journey.suspended`.

## 5. Tests

| Where | What |
|---|---|
| `backend/tests/unit/d02ApprovalBinding.test.ts` (N2 block) | authorised (full row, both hashes, no personal data); not an approval; missing requester ×3; cross-tenant; duplicate; interleaved; rejection / expiry / revocation; `auditFailed` surfaced |
| `backend/tests/unit/d02JourneyApprovalRoute.test.ts` (N2 block) | session user only, forged ids ignored; 8 unauthorised roles → 403; cross-tenant both ways; 401 |
| `backend/tests/realschema/n2_resubmission_audit.test.ts` | the trail exists; authorised + content changed; missing requester / cross-tenant; rejection / expiry / revocation; **two PostgreSQL sessions** (one blocked on the row lock, then loses with no row) and 4 unordered rounds |
| `backend/tests/unit/p4GovernancePrecedence.test.ts` (RV-1 block) | revoked vs no approval / rejection / revoked-then-approved; unreadable log waits |
| `backend/tests/realschema/p4_governance_precedence.test.ts` (RV-1) | revoke → paused → resume → skipped, never revived, 0 sends; an ordinary cancellation still skips |

One D-02 assertion was re-pinned explicitly (`// N2 — RE-PINNED`, d02ApprovalBinding.test.ts): the success call passes a requester. No file-hash pin covers `approvalBinding.ts`, `journeyApproval.ts` or `journey-approval.ts`.

## 6. Existing infrastructure reused

`audit_logs` + `insertAuditLogStrict`; the request context (correlation id); `computeApprovalBinding` / `readApprovalHistory`; the frozen lifecycle and its compare-and-set transition; `execution_instances.lifecycle_state = 'paused'`; the D-03 dispatch hold; `execution_journey_decisions`; the existing `PATCH /api/execution-instances/:id` route.
