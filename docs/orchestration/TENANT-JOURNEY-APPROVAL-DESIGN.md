# Tenant journey approval: design

**Status: design for approval. Not built.** Today only a platform super-admin can approve a WS-3 task, with no preview, and a WhatsApp step cannot be approved at all, so it refuses.

**Basis:** a read-only survey of the approval code, plus direct reads where this document says verified. Nothing in it has been built or executed.

## Goal

A tenant's authorized person sees exactly what would be sent, to whom, on which channel and when, and under what authority, then approves or rejects it. Platform-admin override stays, and stays visible.

## What exists and is reused

| Need | Existing | Reuse |
|---|---|---|
| State machine | `awaiting_approval → approved / rejected / cancelled / expired`, compare-and-set | As is |
| Audit | `outreach_approvals`, append-only by trigger | As is |
| Authorization pattern | `enforceCompanyAccess` + `requireCapability`, then tenant-scoped read | As is |
| Email preview | `prepareEmailSend`, read-only, returns context, recipient, rendered text | As is |
| Pre-bridge check | The adapter's recipient and render preflight | As is |
| Platform route | `pages/api/super-admin/outreach/approve.ts` | Unchanged, as the override |

**Closest precedent:** `pages/api/community-ai/actions/approve.ts`. It uses a role list, not a registered capability, and requires no reason. Follow its compare-and-set and idempotency, but use the capability registry.

## Decision A: one approval record for WhatsApp too

WhatsApp has no approval store. This is why it now refuses every step.

| Option | Assessment |
|---|---|
| **Bridge WhatsApp steps into `outreach_tasks`, approve there; the adapter's `hasApproval` reads that status** | **Recommended.** One queue, one audit trail, one state machine. WS-3 never dispatches them: no WhatsApp transport is registered, so `dispatch` skips the channel |
| New approval table | A second approval system, which your brief forbids unless existing ones cannot serve |

Community keeps its own approval, which is already enforced by that engine. Social publish needs none, because it observes a post approved elsewhere.

**Check during build:** the bridge currently refuses channels it does not support, and that rule must widen for WhatsApp only. Also confirm `outreach_tasks` readers tolerate a WhatsApp row (*unverified*).

## Capability

New `OUTREACH_JOURNEY_APPROVE`, registered per the established steps: constant and `ALL_CAPABILITIES` in `SecurityCapabilities.ts`, `ROLE_CAPABILITIES`, and kept out of `PLATFORM_TIER_CAPABILITIES`.

**Decision B:** which roles. Recommendation: COMPANY_ADMIN and SUPER_ADMIN, matching `PROSPECT_ICP_MANAGE`, plus CONTENT_REVIEWER, who already approves community actions. Roles must not include VIEW_ONLY.

**Decision C:** step-up. Recommendation: none per decision, as a queue of many approvals would make it useless. Require it for bulk approval if that is ever added.

## Routes

| Route | Purpose |
|---|---|
| `GET /api/journey-approvals?company_id=` | The queue: tasks awaiting approval, with preview. Bounded and paginated |
| `GET /api/journey-approvals/[taskId]?company_id=` | One preview, freshly rendered |
| `POST /api/journey-approvals/[taskId]` | `{ company_id, decision, reason, previewHash }` |

Authorization order: authenticate, `enforceCompanyAccess`, `requireCapability`, then tenant-scoped read returning 404 for another tenant's task. The tenant comes from the verified context, and the approver from the principal, never the body. These satisfy `check-route-auth.js`, which is run as a gate.

## The preview

| Field | Source | Notes |
|---|---|---|
| Rendered subject and body | `prepareEmailSend` | Exact text, or the render's refusal shown as a reason |
| WhatsApp template and body | `whatsapp_templates` | The step stores only `template_name`; template text must be read |
| Recipient | `unified_persons` | **Masked by default**: `a***@example.com`, `+1•••••0001` |
| Person | Name, company | Same capability; no other profile data |
| Channel | Step | |
| Timing | `ready_at`, `delay_after_previous_hours` | Plus "not before", from the frequency policy. **This is evaluated at sweep time and is not a promise**, and the UI must say so |
| Workflow and version | Plan snapshot | Which frozen version authorized this |
| Authorization context | `execution_mode`, `policy_source`, `workflow_requires_approval` | Why approval is required |
| Current gate state | Governance evaluated read-only | Kill switch, channel enablement, permission, quota, as "would be blocked by" |
| Previous steps | Journey decisions | What this person already received, codes only |

**Privacy:** no recipient value in logs or in `outreach_approvals`. Reading the full address is a **separate action**, audited, needing the capability. The existing tenant precedent for personal data, `pages/api/prospects/[id].ts`, admits any active member, including VIEW_ONLY. That should not be followed.

## Approving what was seen

Without this, a person approves one message and another is sent.

1. The preview returns `previewHash`: SHA-256 of rendered subject, body, channel, recipient and version.
2. The POST carries it. The server re-renders. If it differs: **409, "this message changed"**, with the fresh preview.
3. The hash is stored in the approval record. **No content in the audit row**: it is evidence the text was seen, not a copy.
4. At send, the engine compares again. Mismatch means no send and back to the queue.

This matters because the render reads the person live, so a changed name changes the text.

## Rules

| Rule | Behaviour |
|---|---|
| Reason | Required to reject; optional to approve |
| Self-approval | **Decision D.** The workflow's publisher approving their own step. Recommendation: allow by default with a per-tenant setting, since small tenants have one person |
| Expiry | **Decision E.** `expired` exists but nothing sets it. Recommendation: expire after a window (7 days), and the journey treats it like a rejection. A message approved weeks ago should not suddenly send |
| A journey exits while awaiting | Already built: the task is withdrawn and disappears from the queue |
| Audit failure | **Must fail visibly.** `approveOutreachTaskForOperator` currently drops `auditFailed` and returns `ok: true`, which I verified. The new route must not repeat that, and the old helper should be fixed |

## Platform-admin override

Stays, unchanged in authority: `OUTREACH_PLATFORM_MANAGE`, step-up, platform write authority, reason required.

**Added:** the approval record gains `tier: 'platform' | 'tenant'`, the tenant's queue shows "approved by platform administrator", and the record is visible to the tenant. An override should never be invisible to the tenant whose name the message goes out under.

**One existing behaviour to change:** the operator helper auto-submits, so it can approve a `pending` task directly. An override should act only on a task that reached approval, or say explicitly that it skipped.

## Interaction with kill switch and governance

Approval does not grant permission. Every gate re-runs at send. Approved plus killed means not sent, and the task stays approved. This is existing WS-3 behaviour and the new WhatsApp check matches it.

## UI

None exists for this; only community has an approval UI (`pages/community-ai/actions.tsx`). Backend first, then a queue page. Not started.

## Tests required

| Area | Test |
|---|---|
| Authorization | Wrong tenant 404; no capability 403; VIEW_ONLY refused; platform override works and is labelled |
| Preview | Read-only (row counts unchanged); masked by default; refusal shown, not hidden |
| Binding | Changed person or template means 409; mismatch at send means no send |
| WhatsApp | Approved sends through the real path; not approved refuses; rejected skips |
| Audit | Failed audit surfaces as an error; no content in the audit row |
| Lifecycle | Exit withdraws; expiry; duplicate POST is idempotent; two approvers, one winner |

## Decisions needed

| # | Decision | Recommendation |
|---|---|---|
| A | Single approval record including WhatsApp | Yes |
| B | Roles | COMPANY_ADMIN, SUPER_ADMIN, CONTENT_REVIEWER |
| C | Step-up per decision | No |
| D | Self-approval | Allowed, tenant-configurable |
| E | Approval expiry | 7 days |
