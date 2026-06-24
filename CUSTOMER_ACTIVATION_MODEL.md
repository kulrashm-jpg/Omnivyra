# CUSTOMER_ACTIVATION_MODEL.md

Phase 14B · Phase 2 — deterministic activation model. Evidence-only; UNKNOWN stays UNKNOWN.

## Activation stages

| Stage | Entry condition | Exit condition | Evidence source | Confidence | Blocking condition |
|---|---|---|---|---|---|
| COMPANY_CREATED | `companies` row exists | profile completed | companies | HIGH | — |
| PROFILE_COMPLETED | `company_profiles.overall_confidence ≥ 60` | domain verified | company_profiles | HIGH | PROFILE_INCOMPLETE |
| DOMAIN_VERIFIED | verified `company_domains` row | GA connected | company_domains | HIGH | DOMAIN_UNVERIFIED |
| GA_CONNECTED | active GA4 integration | GSC connected | analytics_integrations | MEDIUM | GA_NOT_CONNECTED |
| GSC_CONNECTED | active GSC integration | social connected | analytics_integrations | MEDIUM | GSC_NOT_CONNECTED |
| SOCIAL_CONNECTED | ≥ 1 social account | team established | social_accounts | MEDIUM | SOCIAL_NOT_CONNECTED |
| TEAM_ESTABLISHED | accepted team role | first activity | user_company_roles | HIGH | TEAM_NOT_ESTABLISHED |
| FIRST_MEANINGFUL_ACTIVITY | `active_user_count_30d > 0` | activation | readiness (sign-in proxy) | MEDIUM | NO_MEANINGFUL_ACTIVITY |
| ACTIVATED | `tenant_status = ACTIVE` | (terminal) | readiness | HIGH | — |

**Non-strict funnel:** `ACTIVATED` is activity-driven and is *not* a strict superset of all
prior milestones (a company can be ACTIVE without GA/GSC/etc.). The funnel therefore reports
**independent stage-reach**, and milestone↔activation links are **association only**.

## Per-company classification

`ACTIVATED` (tenant active) · `IN_PROGRESS` (engaged, `active_30d > 0`, with unmet
milestones) · `BLOCKED` (recent, unengaged, blocked by an unmet milestone) · `ABANDONED`
(stale > 14d, unengaged) · `UNKNOWN` (all area signals UNKNOWN and no activity).

Blocker = the unmet milestone (single) or `MULTIPLE_BLOCKERS` (≥ 2 unmet) or
`NO_MEANINGFUL_ACTIVITY` (only activity missing). Each classification carries reason,
evidence, and confidence (HIGH unless an unmet signal is UNKNOWN → MEDIUM).

## Correlation (association, not causality)

For each milestone: population with vs without it, activated count in each, and activation
rate in each. Reported as association — **no causal claim**, and small "with" populations
make rates high-variance.
