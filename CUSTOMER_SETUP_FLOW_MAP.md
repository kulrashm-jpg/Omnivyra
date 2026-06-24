# CUSTOMER_SETUP_FLOW_MAP.md

Phase 16D · Phase 1 — the actual onboarding-setup path, per milestone. Derived from the data
model + observed records. Evidence only.

| Milestone | Entry point | Required steps | Dependencies | Blocking condition (observed) |
|---|---|---|---|---|
| **PROFILE** | company created → `company_profiles` row | fill fields (name/website/industry) → **scoring/refinement** sets `overall_confidence` | scoring pipeline must run (`last_refined_at`) | row exists but `last_refined_at` null ⇒ **never scored** (confidence stays 0) |
| **DOMAIN** | `company_domains` row created | submit domain → verification (DNS/admin) → `verification_status = verified` | verification process completes | row present with `verification_status = pending/unverified` ⇒ **stuck pending** |
| **GA** | `analytics_integrations` (provider GA4) | OAuth connect → `status = active` + live check | token/connection persists | `status = disconnected` ⇒ **connected then lost** |
| **GSC** | `analytics_integrations` (provider GSC) | OAuth connect → active | same as GA | `status = disconnected` |
| **SOCIAL** | `social_accounts` row | OAuth connect → refresh ok | token persists | (1/5 customers connected) |
| **TEAM** | `user_company_roles` | send invite (`invited_at`) → accept (`accepted_at`) → ≥ 2 users | an invite must be sent | **0 invites sent** ⇒ never initiated |

## Setup states (forensic vocabulary)

- **COMPLETE** — the milestone's success record exists (verified domain, scored profile,
  active integration, ≥ 2 users / an invite).
- **ATTEMPTED_UNSCORED** (profile) — row exists, never refined → scoring trigger absent.
- **ATTEMPTED_PENDING** (domain) — verification row present, never reached `verified`.
- **ATTEMPTED_DISCONNECTED** (GA/GSC) — integration row present, `status = disconnected`.
- **NEVER_STARTED** — no record at all.

The states distinguish **product failed an attempt** (ATTEMPTED_*) from **never initiated**
(NEVER_STARTED) — the core of the forensic classification.
