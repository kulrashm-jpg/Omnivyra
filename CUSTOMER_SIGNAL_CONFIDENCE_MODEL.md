# CUSTOMER_SIGNAL_CONFIDENCE_MODEL.md

Phase 13E · Phase 1 + 5 — the signal-confidence model. Measures the **trustworthiness
(confidence)** and **recency (freshness)** of every readiness signal. Read-only,
deterministic. No mutations, recommendations, notifications, automation, or remediation.

## Signal inventory

| Area | Owner table | Update mechanism (timestamp) | Expected freshness | Failure modes | Downstream consumers |
|---|---|---|---|---|---|
| COMPANY_PROFILE | `company_profiles` | profile edit / AI refine (`last_refined_at`) | days–weeks; goes stale without refine | read fail, null confidence, stale | readiness, opportunity, insight, outcome |
| WEBSITE | `company_domains` | domain verification (`verified_at`) | durable once verified | unverified, read fail | readiness, attribution (DOMAIN_VERIFICATION) |
| GOOGLE_ANALYTICS | `analytics_integrations` (provider GA4) | OAuth connect + live check (`last_live_check_at`/`created_at`) | refreshed on live check; stale if check old | token expiry, no row, read fail | readiness, opportunity, attribution |
| GOOGLE_SEARCH_CONSOLE | `analytics_integrations` (provider GSC) | same | same | same | readiness, opportunity, attribution |
| SOCIAL_INTEGRATIONS | `social_accounts` | OAuth connect + token refresh (`last_successful_refresh_at`/`created_at`) | refreshed on token refresh | token expiry, refresh failure | readiness, opportunity |
| TEAM_MEMBERS | `user_company_roles` | invite/accept (`accepted_at`) | durable once accepted | no accepted members | readiness |
| BILLING | `organization_plan_assignments` / `organization_credits` | plan assign / credit grant (`assigned_at`/`created_at`) | org-keyed; per-company freshness deferred | empty plan-assignment table | readiness, priority |
| COMMUNITY | *(none)* | n/a | n/a | structurally absent | readiness (always UNKNOWN) |

## Confidence + freshness rules (deterministic)

**Freshness** (vs `last_updated`): `≤ 7d` HIGH · `≤ 30d` MEDIUM · `> 30d` LOW · none UNKNOWN.

**Confidence** per area:
1. source read failed → **LOW** (status ERROR)
2. authority NONE (community) or source absent → **UNKNOWN** (status MISSING)
3. area state UNKNOWN → **UNKNOWN**
4. has a timestamp → confidence = freshness (HIGH/MEDIUM/LOW); status STALE when LOW
5. definite determination, no timestamp → **authority baseline** (AUTHORITATIVE = HIGH, DERIVED = MEDIUM)

**Authority** (12B/C): WEBSITE / COMPANY_PROFILE / TEAM_MEMBERS = AUTHORITATIVE;
GA / GSC / SOCIAL / BILLING = DERIVED (connection-presence, not deep validation);
COMMUNITY = NONE.

Company `overall_signal_confidence` = weakest confidence among areas with a real source
(PRESENT/STALE); UNKNOWN if none.

## Phase 5 — dependency propagation

Confidence rank: `UNKNOWN(0) < LOW(1) < MEDIUM(2) < HIGH(3)`.

**Rule:** a derived layer's confidence **cannot exceed the weakest contributing source.**
`propagate(layerOwn, sources) = level(min(rank(layerOwn), min(rank(source))))`.

| Derived layer | Bounded by |
|---|---|
| Readiness | all 8 area sources |
| Opportunity | the readiness signals it inspects |
| Priority | readiness + opportunity confidence |
| Evolution | snapshot source confidence (+ history availability) |
| Outcome | snapshot source confidence (+ history availability) |
| Attribution | snapshot source confidence (+ history availability) |

So **Outcome/Attribution confidence ≤ source confidence** — a low-confidence GA signal
caps any outcome/attribution that depends on it. Evolution/Outcome/Attribution are
*additionally* bounded by snapshot history (INSUFFICIENT_DATA until ≥ 2 days, per 13B–D).
