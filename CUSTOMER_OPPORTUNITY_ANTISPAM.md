# CUSTOMER_OPPORTUNITY_ANTISPAM.md

Phase 12D · Phase 4 — anti-spam **model only**. This is a design for a FUTURE
suppression layer. **Nothing here is persisted, tabled, or implemented.** Detection
today is read-only and surfaces in the super-admin console only — nothing is ever sent
to customers, so no suppression runs yet. This document defines the rules that *would*
govern delivery if/when an opportunity is ever surfaced or actioned.

## Per-opportunity policy (proposed, not implemented)

| Opportunity | Cooldown | Max display frequency | Dismissible | Future suppression strategy |
|---|---|---|---|---|
| WEBSITE_UNVERIFIED | 7 days | 1 / week | Yes (snooze) | Suppress once `website_ready = READY`; auto-resolve on verification |
| PROFILE_INCOMPLETE | 14 days | 1 / 2 weeks | Yes | Suppress when profile crosses confidence threshold |
| MISSING_GA | 30 days | 1 / month | Yes | Suppress on GA connect; back off after 3 dismissals |
| MISSING_GSC | 30 days | 1 / month | Yes | Suppress on GSC connect; back off after 3 dismissals |
| MISSING_SOCIAL | 21 days | 1 / 3 weeks | Yes | Suppress when ≥1 platform connected |
| MISSING_TEAM | 60 days | 1 / 2 months | Yes | Low priority; suppress on 2nd seat |
| MISSING_BILLING | 14 days | 2 / month max | Yes | Hard cap; suppress on purchase; never re-show after explicit "not interested" |
| INACTIVE_COMPANY | 30 days | 1 / month | Yes (admin-side) | Win-back cadence; suppress on any new activity |
| DORMANT_COMPANY | 14 days | 1 / 2 weeks | Yes | Suppress on activity resumption |
| LOW_READINESS | 14 days | 1 / 2 weeks | Yes | Suppress when bucket leaves AT_RISK |

## Global guardrails (proposed)

- **Global cap:** at most **N opportunities surfaced per tenant per window** (e.g. 2 /
  week) regardless of how many are detected — show highest-severity first.
- **Cooldown** = minimum time between re-surfacing the *same* opportunity for the same
  tenant.
- **Max display frequency** = ceiling on how often an opportunity may appear in a
  rolling window.
- **Dismissibility** = every opportunity can be snoozed/dismissed; repeated dismissals
  apply exponential back-off (1×, 3×, then mute).
- **Auto-resolve** = when the underlying readiness gap closes (`NOT_READY → READY`), the
  opportunity disappears automatically — no manual cleanup.
- **Severity-aware ordering** = HIGH before MEDIUM before LOW when the global cap binds.

## Future persistence shape (NOT created here)

A future `customer_opportunity_state` table *would* hold `(company_id, opportunity_type,
first_detected_at, last_surfaced_at, surfaced_count, dismissed_count, snoozed_until,
muted)`. **No such table is created in this phase.** This document is the model only.
