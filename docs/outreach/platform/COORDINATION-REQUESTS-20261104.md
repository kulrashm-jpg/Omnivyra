# Outreach coordination requests, 2026-11-04

Authorized by the owner ruling of 2026-11-04 (Checkpoint 1, item 9). Outreach sends these four requests and builds **no substitute store or interface** while waiting for the answers. Evidence for each is on `outreach/foundation-base-20261104`.

## CR-SC7: one message-classification vocabulary

**To:** PI and Orchestration.

**Draft:** `docs/outreach/platform/SC-7-CLASSIFICATION-VOCABULARY.md` (commit `c889087b9`).

**Ask:** agree sections 2–6 and answer Q-1..Q-5. The contract has three parts:

- **Vocabulary:** 16 codes. `stop`, `unsubscribe` and `complaint` are governance classes, detected by fixed rules, and AI can never override them.
- **Entry point:** `classifyMessage(...)`. It returns:
  - `code`
  - `governance[]`
  - `governanceMatches[]`
  - `labels[]`
  - `vocabularyVersion: 'sc7-draft-1'`
- **Proposed effects:**
  - `stop`, `unsubscribe` and `complaint` → PI outcome `unsubscribed`, which moves the prospect to `closed_disqualified`; `complaint` also adds a `*` restriction.
  - `not_interested` → `replied`, or `rejected` only when an operator confirms it.
  - `out_of_office` → no outcome and no journey exit.

**Orchestration decision needed:** today any inbound WhatsApp message other than STOP counts as `replied`, so an out-of-office auto-reply ends a journey. Adopting SC-7 changes that.

**Blocks:** B closure (persisting and wiring classifications).

## CR-SC4: outcome association for non-WS-3 engines

**To:** Orchestration (shared with Outreach).

**Ask:** agree the outcome contract for unsubscribe, WhatsApp and community outcomes.

**Concrete proposal for unsubscribe:** the link path already knows `task_id` (`unsubscribeService.ts:66-78`). It would write this row:

```
outreach_outcomes{
  company_id,
  task_id,
  outcome_type: 'unsubscribed',
  derived: false,
  occurred_at,
  source: <new value: recipient link>,
  provider_event_id: <attempt+keyId>,
  evidence
}
```

The `source` CHECK needs a value for a recipient-initiated link. The schema change is in the Outreach migration set; your agreement is needed before it is wired.

**Still open:** where an unsubscribe that is not tied to any task gets recorded, and the equivalent shape for WhatsApp and community outcomes.

**Also, `complained` outcome type (CR-4):** the SES path would be the only writer. It stays out of `FEEDBACK_SIGNALS`. `journeyEvents.ts` already maps it to `delivery.complained`. Readers `journeyEvents.ts:142-144` and `feedbackSummary` should exclude rows marked `transport_response.deliveryInferredFrom = 'Complaint'`.

**Blocks:** D-1 business outcomes; PI feedback for non-email engines.

## CR-BL1: channel credit actions

**To:** Billing.

**Ask:** define one credit action per channel through the existing feature registry and `apply_credit_reservation`, the only ledger writer. Outreach writes nothing to the ledger.

| Channel | Credit action |
|---|---|
| Email | `outreach.email.send` |
| WhatsApp | `outreach.whatsapp.send` |
| Social | `outreach.social.publish` |
| Community | `outreach.community.action` |

**Proposed charging rule:**
- Charge on a provider-accepted action (`sent_unverified` / `executed`).
- Never charge on `uncertain`.
- Idempotency key: the attempt id, the recipient claim id or the post id.

**Blocks:** any charged send (D closure).

## CR-PI1: conversation person identity and recipient consent

**To:** PI.

**Ask, two parts:**
1. A runtime writer of `engagement_threads.unified_person_id`, so that Engagement Intelligence can use cross-channel context. Today no writer exists.
2. Confirm that `contact_governance_records`, via `evaluateCanonicalGovernance` and `recordContactGovernance`, is the canonical recipient-consent store for social and community recipients.

**Related acting-account proof (C-PI-2):** `proveActingAccount` does not exist in code. `social_accounts.platform_user_id` is the OIDC subject, not the page URN.

**Blocks:** B1 cross-channel context; Community acting-account proof; 1.5.0.

## Status

| Request | To | Sent | Response |
|---|---|---|---|
| CR-SC7 | Orchestration | 2026-11-04 (c7) | — |
| CR-SC7 | PI | 2026-11-04 (virality-b6) | Queued. Blocker: `stop` and `not_interested` are not governance types; complaint is purpose-scoped; `rejected` only through the human path. Ratification is an owner decision. |
| CR-SC4 / CR-4 | Orchestration | 2026-11-04 (c7) | — |
| CR-BL1 | Billing | Not sent: no Billing session identified | — |
| CR-PI1 | PI | 2026-11-04 (virality-b6) | Queued. (1) No writer confirmed, and the PI read is severed. (2) Canonical store confirmed; social/community use not proven, so it goes to the owner. |
