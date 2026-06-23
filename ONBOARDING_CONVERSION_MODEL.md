# ONBOARDING_CONVERSION_MODEL.md

Phase 14A · Phase 2 — deterministic onboarding funnel. A stage count comes from a persisted
source or is reported **UNKNOWN**. Never inferred.

## Funnel stages

| Stage | Entry condition | Exit condition | Evidence source | Confidence |
|---|---|---|---|---|
| VISITOR | lands on site | starts signup | *(none)* | **UNKNOWN** |
| SIGNUP_STARTED | `signup_intents` row created | email verified | `signup_intents` | MEDIUM (partial coverage) |
| EMAIL_VERIFIED | email confirmed | identity validated | `auth.users.email_confirmed_at` | **UNKNOWN** (not in public schema) |
| IDENTITY_VALIDATED | domain/identity verdict passes | company created | validation verdict | **UNKNOWN** (not persisted) |
| COMPANY_CREATED | `companies` row exists | profile completed | `companies` | HIGH |
| PROFILE_COMPLETED | `company_profiles.overall_confidence ≥ 60` | domain verified | `company_profiles` | HIGH |
| DOMAIN_VERIFIED | verified `company_domains` row | activation | `company_domains` | HIGH |
| ACTIVATED | `tenant_status = ACTIVE` | (terminal) | readiness | HIGH |

## Transitions

Strictly forward. The **SIGNUP_STARTED → COMPANY_CREATED** transition (spanning EMAIL_VERIFIED
+ IDENTITY_VALIDATED) crosses the unjoinable cohort boundary → reported **NOT COMPUTABLE**,
never as a rate. Company-side transitions (CREATED → PROFILE → DOMAIN → ACTIVATED) are all
`company_id`-joinable and fully measurable.

## Per-prospect classification

`COMPLETED` · `ABANDONED` · `BLOCKED` · `PENDING` · `UNKNOWN` — each with reason, evidence,
and confidence. Loss reasons: `CLAIMED_DOMAIN`, `PUBLIC_EMAIL`, `DOMAIN_BLOCKED`,
`NO_WEBSITE_FOUND`, `DOMAIN_MISMATCH`, `EMAIL_UNVERIFIED`, `PROFILE_ABANDONED`,
`DOMAIN_UNVERIFIED`, `ACTIVATION_ABANDONED`, `UNKNOWN`.

- **Prospect cohort** (signup_intents): completed → COMPLETED; domain matches a block signal
  → BLOCKED (CLAIMED_DOMAIN / PUBLIC_EMAIL / DOMAIN_BLOCKED / …); expired/stale pending →
  ABANDONED (reason UNKNOWN — abandonment stage not captured); else PENDING.
- **Company cohort** (companies): ACTIVE → COMPLETED; else first unmet step →
  PROFILE_ABANDONED / DOMAIN_UNVERIFIED / ACTIVATION_ABANDONED, labelled ABANDONED if stale
  (> 14d) else PENDING.

**UNKNOWN is used only when evidence is genuinely unavailable.**
