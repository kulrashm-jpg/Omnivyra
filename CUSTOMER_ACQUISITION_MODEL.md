# CUSTOMER_ACQUISITION_MODEL.md

Phase 13F · Phase 2 — deterministic acquisition funnel. Evidence-backed only: a stage
count comes from a persisted source or is reported UNKNOWN. **No inference, no guessing.**

## Funnel stages

| Stage | Evidence source | Measurable | Count basis |
|---|---|---|---|
| VISITOR | *(none)* | ❌ | no analytics source → UNKNOWN |
| SIGNUP_STARTED | `signup_intents` | ✅ | row count (partial coverage) |
| EMAIL_VERIFIED | `auth.users.email_confirmed_at` | ❌ | not in public schema → UNKNOWN |
| IDENTITY_VALIDATED | validation verdict | ❌ | not persisted per-signup → UNKNOWN |
| COMPANY_CREATED | `companies` | ✅ | row count |
| PROFILE_COMPLETED | `company_profiles` (`overall_confidence ≥ 60`) | ✅ | row count |
| ACTIVE_CUSTOMER | readiness `tenant_status = ACTIVE` | ✅ | derived count |

## Legal transitions (forward-only)

```
VISITOR → SIGNUP_STARTED → EMAIL_VERIFIED → IDENTITY_VALIDATED
        → COMPANY_CREATED → PROFILE_COMPLETED → ACTIVE_CUSTOMER
```

- Strictly forward; a stage logically requires all prior stages.
- **Known alternate path:** invite/manual creation enters at `COMPANY_CREATED`, bypassing
  `SIGNUP_STARTED`. This is why `companies` (38) exceeds tracked `signup_intents` (24).
- Because SIGNUP_STARTED and COMPANY_CREATED are measured on **different populations**, the
  `SIGNUP_STARTED → COMPANY_CREATED` transition is **not computable** and is reported as
  such — not as a >100% rate.

## Conversions (only population-compatible)

| Conversion | Definition |
|---|---|
| signup-intent completion | `completed / total` within `signup_intents` |
| company → profile completed | `profiles_completed / companies` |
| company → active | `active / companies` |

Any rate with a 0 denominator is `null` (UNKNOWN), never 0-by-fiat.

## Loss reasons (deterministic, evidence-mapped)

| Reason | Evidence |
|---|---|
| CLAIMED_DOMAIN | `signup_referrals` |
| PUBLIC_EMAIL | `domain_eligibility_cache` reason |
| NO_WEBSITE_FOUND | `domain_eligibility_cache` reason |
| DOMAIN_MISMATCH | `domain_events` (not_canonical/mismatch) |
| DOMAIN_BLOCKED | `domain_eligibility_cache` (no_mx/blocked) + `domain_events` |
| EMAIL_UNVERIFIED | *(no persisted source — 0)* |
| PROFILE_ABANDONED | company with no `company_profiles` row |
| COMPANY_SETUP_ABANDONED | *(no measurable source — 0)* |
| UNKNOWN | pending `signup_intents` (abandonment stage not captured) |

**UNKNOWN is used only when evidence is truly absent.**
