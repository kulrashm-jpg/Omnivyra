# CUSTOMER_TELEMETRY_INVENTORY.md

Phase 13H · Phase 1 — every signal consumed by the Customer Operations platform.
**Audit only**, evidence from phases 13A–13G probes.

## Foundational signals (inputs)

| Signal | Source table | Source columns | Freshness source | Confidence source | Consumer engines | Owner service |
|---|---|---|---|---|---|---|
| COMPANY_PROFILE | `company_profiles` | `overall_confidence`, `confidence_score`, `last_refined_at` | `last_refined_at` | confidence ≥ 60 + freshness | Readiness, SignalConfidence, Playbooks | customerReadinessService |
| WEBSITE | `company_domains` | `verification_status`, `verified`, `verified_at` | `verified_at` | verified status (authoritative) | Readiness, Attribution, Playbooks | customerReadinessService |
| GOOGLE_ANALYTICS | `analytics_integrations` (GA4) | `provider`, `status`, `created_at`, `last_live_check_at` | `last_live_check_at` | connection-presence (DERIVED) | Readiness, Opportunity, Attribution, Playbooks | customerReadinessService |
| GOOGLE_SEARCH_CONSOLE | `analytics_integrations` (GSC) | `provider`, `status`, `last_live_check_at` | `last_live_check_at` | connection-presence (DERIVED) | Readiness, Opportunity, Attribution, Playbooks | customerReadinessService |
| SOCIAL_INTEGRATIONS | `social_accounts` | `platform`, `refresh_status`, `last_successful_refresh_at` | `last_successful_refresh_at` | connection-presence (DERIVED) | Readiness, Opportunity, Playbooks | customerReadinessService |
| TEAM_MEMBERS | `user_company_roles` | `status`, `accepted_at`, `invited_at` | `accepted_at` | accepted role (authoritative) | Readiness, Playbooks | customerReadinessService |
| BILLING | `organization_plan_assignments` / `organization_credits` | `assigned_at`, `created_at` | *(org-keyed, deferred)* | plan/credit presence (DERIVED) | Readiness, Priority, Playbooks | customerReadinessService |
| COMMUNITY | *(none)* | — | — | — | Readiness | customerReadinessService |
| SIGNUP attempts | `signup_intents` | `status`, `stage`, `created_at`, `completed_at` | `last_touch_at` | n/a | Acquisition | customerAcquisitionIntelligenceService |
| EMAIL verification | `auth.users` | `email_confirmed_at` | — (not in public schema) | n/a | Acquisition | customerAcquisitionIntelligenceService |
| Identity/domain validation | `domain_eligibility_cache`, `domain_events`, `signup_referrals` | `reason`, `event_type`, `domain`, `*_at` | `checked_at` / `last_attempt_at` | n/a | Acquisition | customerAcquisitionIntelligenceService |
| COMPANY lifecycle | `companies` | `id`, `created_at`, `website`, `website_domain`, `admin_email_domain` | `created_at` | authoritative | Readiness, Acquisition, Identity | customerReadinessService |
| SNAPSHOT history | `customer_readiness_snapshots` | all readiness/priority/area columns, `snapshot_date`, `taken_at` | `taken_at` | inherits source confidence | Evolution, Outcomes, Attribution | customerReadinessSnapshotService |

## Derived signals (no source columns — computed deterministically)

| Signal | Derived from | Consumer engines | Owner service |
|---|---|---|---|
| Opportunities | readiness | Priority, Insights | customerOpportunityService |
| Priority | readiness + opportunities | (terminal) | customerOpportunityPriorityService |
| Executive insights | readiness | (terminal) | customerExecutiveInsightService |
| Signal confidence | source timestamps + authority | Playbooks (suppression) | customerSignalConfidenceService |
| Evolution / Outcomes / Attribution | snapshot history | (terminal) | customerEvolution / Outcome / ImpactAttribution services |
| Playbooks | readiness + signal confidence + priority | (terminal) | customerActionPlaybookService |
