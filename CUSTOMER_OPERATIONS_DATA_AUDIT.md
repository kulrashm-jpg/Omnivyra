# CUSTOMER_OPERATIONS_DATA_AUDIT.md

Phase 13A · Phase 1 — inventory of every source the Command Center unifies. **Audit
only.** All sources are read-only; the cockpit aggregates, it does not compute new
business logic.

| Source | Owner service | API/data source | Freshness | Reliability | Missing fields / notes |
|---|---|---|---|---|---|
| **Readiness (12A/C)** | `customerReadinessService` | `companies`, `user_company_roles`, `users`, `company_profiles`, `analytics_integrations`, `social_accounts`, billing tables | live (per request) | High (defensive → UNKNOWN on gaps) | COMMUNITY always UNKNOWN (no source) |
| **Opportunities (12D)** | `customerOpportunityService` | derived from readiness | live | High (deterministic) | — |
| **Priority (12E)** | `customerOpportunityPriorityService` | derived from readiness + opportunities | live | High (deterministic) | weights are heuristic (tunable) |
| **Executive insights (12F)** | `customerExecutiveInsightService` | derived from readiness | live | High (deterministic) | narrative grammar is rules-based |
| **Evolution (12G/H)** | `customerEvolutionService` + `customer_readiness_snapshots` | snapshot table | **none yet** (table not applied) | n/a | trajectory = UNKNOWN until snapshots accumulate |
| **Identity drift** | `companyIdentityDriftService` | `companies` (website/website_domain/admin_email_domain) | live | High | drift = structural inconsistency |
| **Company identity** | `companies` table | `website`, `website_domain`, `admin_email_domain` | live | High | — |
| **Subscriptions** | readiness billing layer | `organization_plan_assignments`, `organization_credits` | live | Med (plan-vs-paid nuance) | credit balance not surfaced in cockpit |
| **Users / activity** | readiness | `user_company_roles`, `users.last_sign_in_at` | live | Med (sign-in proxy) | coarse last-activity signal |
| **Integrations** | readiness area states | `analytics_integrations`, `social_accounts` | live | Med (connection-presence) | deep GA/GSC checks deferred (12B) |
| **Signup validation (funnel)** | `customerOperationsCockpitService.loadSignupFunnel` | `domain_eligibility_cache`, `domain_events`, `signup_referrals` | live | Med | NO_WEBSITE_FOUND has no dedicated persisted source (closest = `domain_events.DOMAIN_RESOLUTION_FAILED`); eligibility cache is sparse |

## Signup-funnel source mapping

| Bucket | Source | Notes |
|---|---|---|
| PUBLIC_EMAIL | `domain_eligibility_cache.reason` ∈ {PUBLIC_EMAIL, public_provider} | |
| FORWARDING_DOMAIN | `domain_eligibility_cache` FORWARDING_DOMAIN + `domain_events.DOMAIN_FORWARDING_BLOCKED` | merged |
| DOMAIN_NOT_CANONICAL | `domain_eligibility_cache` + `domain_events.DOMAIN_NOT_CANONICAL` | merged |
| DOMAIN_RESOLUTION_FAILED | `domain_events` ∈ {DOMAIN_RESOLUTION_FAILED, RESOLUTION_BLOCKED} | |
| NO_WEBSITE_FOUND | `domain_eligibility_cache.reason = NO_WEBSITE_FOUND` | **no dedicated persisted source** — typically 0; closest live signal is DOMAIN_RESOLUTION_FAILED |
| CLAIMED_DOMAIN | `signup_referrals` (prospect attempts from claimed domains) | |

Each funnel entry reports `count`, `last_occurrence` (max timestamp), and
`affected_domains` (deduped, capped at 25).
