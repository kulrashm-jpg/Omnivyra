# ONBOARDING_CONVERSION_SIGNAL_AUDIT.md

Phase 14A · Phase 1 — every signal involved in onboarding. **Audit only.** Evidence from
live production probes (13D/13F/13H + this phase).

| Signal | Table | Columns | Freshness | Ownership | Reliability | Coverage | Missing telemetry | Downstream | Class |
|---|---|---|---|---|---|---|---|---|---|
| Signup attempts | `signup_intents` | id, email, status, stage, created_at, completed_at, expires_at, last_touch_at, supabase_uid | real-time | onboarding | Med | 24 attempts (partial — invites bypass) | `stage` non-granular (always `pending`); `supabase_uid` empty → no company linkage | Conversion (prospect cohort) | **PARTIAL** |
| Auth users / email verification | `auth.users` | email_confirmed_at | real-time | Supabase auth | High (in auth) | n/a in public | not mirrored to public schema | — | **UNKNOWN** |
| Identity validation | validation verdict | — | at signup | gate | n/a | none | verdict not persisted per-signup | — | **UNKNOWN** |
| Company creation | `companies` | id, name, created_at | real-time | core | High | 38 (full) | — | Conversion (company cohort), Readiness | **COMPLETE** |
| Company profile | `company_profiles` | company_id, overall_confidence, last_refined_at | on edit | core | High | 29/38 rows; 3 ≥ 60 | — | Conversion, Readiness | **COMPLETE** |
| Domain verification | `company_domains` | company_id, verification_status, verified_at | on verify | identity | High | 1 verified among current companies | — | Conversion, Attribution | **COMPLETE** |
| Role creation | `user_company_roles` | company_id, status, accepted_at | real-time | core | High | 31 rows | — | Readiness | **COMPLETE** |
| Credit grants | `organization_credits` / `access_requests` | created_at, credits_granted | real-time | billing | Med | org-keyed; access_requests 0 rows | per-company linkage org-scoped | (not in conversion path) | **PARTIAL** |
| Referrals | `signup_referrals` | email, domain, first/last_attempt_at | real-time | onboarding | High | 2 domains | — | Conversion (CLAIMED_DOMAIN block) | **COMPLETE** |
| Eligibility cache | `domain_eligibility_cache` | domain, reason, checked_at | cached | onboarding | Med | 8 rows (6 valid, 2 no_mx) | passes domain-level, not per-signup | Conversion (block signals) | **PARTIAL** |
| Domain events | `domain_events` | event_type, final_domain, created_at | event | identity | Med | 2 rows (`DOMAIN_UNVERIFIED_USAGE`) | no signup-resolution failures captured | Conversion | **PARTIAL** |

## Cohort linkage finding

`signup_intents` (24, prospect cohort) and `companies` (38, company cohort) are **two
unjoinable populations** — `supabase_uid` is empty and there is no `company_id` on intents.
The conversion engine therefore reports two honest cohorts and **never fabricates** a
cross-population conversion.
