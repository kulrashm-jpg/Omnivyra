# CUSTOMER_INTERVENTION_CATALOG.md

Phase 15A · Phase 2 — intervention **types only**. No delivery content, no messages, no
execution. Each defines what *would* make a company eligible — nothing is sent.

| Intervention | Purpose | Trigger source | Required evidence (gap) | Min confidence | Severity | Eligible states |
|---|---|---|---|---|---|---|
| PROFILE_COMPLETION | Complete company profile | Profile Completion (14C) | `COMPANY_PROFILE` ≠ READY | MEDIUM | HIGH | ONBOARDING, ACTIVATING, ADOPTING |
| DOMAIN_VERIFICATION | Verify company domain | Readiness / Onboarding (14A) | `WEBSITE` ≠ READY | MEDIUM | HIGH | ONBOARDING, ACTIVATING, ADOPTING |
| GA_CONNECTION | Connect Google Analytics | Digital Adoption (14D) | `GOOGLE_ANALYTICS` ≠ READY | MEDIUM | MEDIUM | ACTIVATING, ADOPTING, VALUE_REALIZING |
| GSC_CONNECTION | Connect Search Console | Digital Adoption (14D) | `GOOGLE_SEARCH_CONSOLE` ≠ READY | MEDIUM | MEDIUM | ACTIVATING, ADOPTING, VALUE_REALIZING |
| SOCIAL_CONNECTION | Connect social accounts | Digital Adoption (14D) | `SOCIAL_INTEGRATIONS` ≠ READY | MEDIUM | MEDIUM | ACTIVATING, ADOPTING, VALUE_REALIZING |
| TEAM_EXPANSION | Invite team members | Digital Adoption (14D) | `TEAM_MEMBERS` ≠ READY | MEDIUM | MEDIUM | ADOPTING, VALUE_REALIZING, EXPANDING |
| VALUE_REALIZATION | Drive first value | Value Realization (14E) | `has_value = false` | MEDIUM | HIGH | ADOPTING, ACTIVATING |
| ACTIVATION_RECOVERY | Recover stalled activation | Activation (14B) | `is_active = false` | MEDIUM | HIGH | ACTIVATING, AT_RISK |
| ADOPTION_EXPANSION | Expand capability adoption | Digital Adoption (14D) | `adoption_score < 50` | MEDIUM | MEDIUM | ADOPTING, VALUE_REALIZING |
| EXECUTION_EXPANSION | Expand execution depth | Execution Adoption (14G) | `has_value` & `execution_volume < 5` | MEDIUM | MEDIUM | VALUE_REALIZING, EXPANDING |

## Notes

- **This is a catalog of *types*, not actions.** No intervention here is delivered; the
  engine only computes whether a company *would be eligible*.
- Every intervention requires (1) a real gap, (2) a customer-state that fits, and (3) signal
  confidence ≥ the minimum — and is additionally subject to the suppression model (notably
  the population-integrity gate: non-customer tenants are never eligible).
