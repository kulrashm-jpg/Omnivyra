# CUSTOMER_ACTIVATION_SIGNAL_AUDIT.md

Phase 14B · Phase 1 — every signal involved in activation. **Audit only.** All signals are
already consumed by readiness (12A/C) — the activation engine adds no new DB reads.

| Signal | Table | Columns | Freshness | Reliability | Coverage | Confidence | Owner | Downstream | Class |
|---|---|---|---|---|---|---|---|---|---|
| Company base | `companies` | id, name, created_at | real-time | High | 38 (full) | HIGH | core | all | **COMPLETE** |
| Profile | `company_profiles` | overall_confidence, last_refined_at | on edit | High | 29/38; 3 ≥ 60 | HIGH | core | activation | **COMPLETE** |
| Domain | `company_domains` | verification_status, verified_at | on verify | High | 1 verified | HIGH | identity | activation | **COMPLETE** |
| GA | `analytics_integrations` (GA4) | provider, status, last_live_check_at | live-check | Med | 0 connected | MEDIUM (presence) | core | activation | **PARTIAL** |
| GSC | `analytics_integrations` (GSC) | provider, status | live-check | Med | 0 connected | MEDIUM (presence) | core | activation | **PARTIAL** |
| Social | `social_accounts` | platform, refresh_status | refresh | Med | 2 | MEDIUM (presence) | core | activation | **PARTIAL** |
| Team | `user_company_roles` | status, accepted_at | real-time | High | 1 established | HIGH | core | activation | **COMPLETE** |
| Plan | `organization_plan_assignments` | assigned_at | — | Low | 0 rows | LOW | billing | (not gating) | **PARTIAL** |
| Credits | `organization_credits` | created_at | real-time | Med | 29 (org-keyed) | MEDIUM | billing | (not gating) | **PARTIAL** |
| Snapshots | `customer_readiness_snapshots` | all area cols, snapshot_date | daily | High | day-1 only | HIGH | snapshots | evolution/outcomes | **PARTIAL** (temporal) |
| Tenant status | readiness (derived) | tenant_status, active_user_count_30d, last_activity_at | per-request | Med (sign-in proxy) | 38 | MEDIUM | readiness | activation (terminal) | **PARTIAL** |

## Findings

- The activation milestones map cleanly to readiness areas + a 30-day-activity proxy — all
  read-only, no new queries.
- **`FIRST_MEANINGFUL_ACTIVITY`** is a **sign-in proxy** (`active_user_count_30d`), not a
  product-event signal → MEDIUM confidence; it overlaps with how `tenant_status=ACTIVE` is
  derived, so the activity↔activation link is near-definitional (flagged in correlation).
- **GA/GSC are connection-presence** (12B), not data-flow → PARTIAL.
- `tenant_status=ACTIVE` is **activity-driven, not milestone-gated** → the funnel is reported
  as independent stage-reach, not a strict sequential funnel.
