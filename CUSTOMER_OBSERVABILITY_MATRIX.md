# CUSTOMER_OBSERVABILITY_MATRIX.md

Phase 13H · Phase 2 — observability classification for every lifecycle stage.
**COMPLETE** (persisted + trustworthy) · **PARTIAL** (observable with gaps) ·
**UNKNOWN** (could be observed, not persisted/linked) · **UNOBSERVABLE** (structurally
impossible today).

| Stage | Class | Evidence | Source | Missing data | Reason |
|---|---|---|---|---|---|
| VISITOR | **UNOBSERVABLE** | none | — | web-analytics integration | no source captures pre-signup traffic |
| SIGNUP_STARTED | **PARTIAL** | 24 intents | `signup_intents` | invite/manual entries | invites bypass signup_intents (24 vs 38 companies) |
| EMAIL_VERIFIED | **UNKNOWN** | — | `auth.users.email_confirmed_at` | public-schema mirror | auth schema not exposed via PostgREST |
| IDENTITY_VALIDATED | **UNKNOWN** | failure cache only | validation verdict | per-signup verdict persistence | verdict computed at signup, never stored |
| COMPANY_CREATED | **COMPLETE** | 38 companies | `companies` | — | row-level evidence |
| PROFILE_COMPLETED | **COMPLETE** | 3 (≥60) / 29 rows | `company_profiles` | — | row-level evidence + confidence |
| ACTIVE_CUSTOMER | **COMPLETE** | 4 active | readiness `tenant_status` | — | deterministic derivation |
| READINESS | **COMPLETE** | 38 scored | readiness areas | — | deterministic; signals present (some PARTIAL by authority) |
| OPPORTUNITIES | **COMPLETE** | per-company | derived from readiness | — | deterministic |
| PRIORITY | **COMPLETE** | tiers + distribution | derived | — | deterministic |
| OUTCOMES | **PARTIAL** (temporal) | all NO_HISTORY | snapshots | 2nd snapshot day | needs ≥ 2 daily snapshots |
| ATTRIBUTION | **PARTIAL** (temporal) | all INSUFFICIENT_DATA | snapshot area-flips | 2nd snapshot day + event timestamps | needs ≥ 2 days; co-observed within day |
| PLAYBOOKS | **COMPLETE** | 109 rec / 57 suppressed | derived from readiness + confidence | — | deterministic rules |

## Summary

- **COMPLETE:** COMPANY_CREATED, PROFILE_COMPLETED, ACTIVE_CUSTOMER, READINESS,
  OPPORTUNITIES, PRIORITY, PLAYBOOKS.
- **PARTIAL:** SIGNUP_STARTED (coverage), OUTCOMES + ATTRIBUTION (temporal — resolve to
  COMPLETE once snapshot history accrues, Day 2+).
- **UNKNOWN:** EMAIL_VERIFIED, IDENTITY_VALIDATED (not persisted — fixable).
- **UNOBSERVABLE:** VISITOR, COMMUNITY (no source — structural).
