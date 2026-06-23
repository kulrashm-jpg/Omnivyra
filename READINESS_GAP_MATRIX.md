# READINESS_GAP_MATRIX.md

Phase 12B · Phase 3 — gap matrix per readiness area. **Audit only — no changes.**

Classification:
- **READY_FOR_UPGRADE** — a deeper, DB-only signal already exists and would improve accuracy.
- **NEEDS_NEW_DATA** — a better signal exists but needs live API calls or a new source.
- **NOT_APPLICABLE** — current signal is already best / no source to improve.

| Area | Current signal | Best available signal (deeper) | Confidence today | Improvement opportunity | Classification |
|---|---|---|---|---|---|
| **COMPANY_PROFILE** | name+website_url+industry present | `companyProfile/fieldConstants.calculateCompanyProfileCompleteness` (weighted 6-section 0–100) + `company_profiles.overall_confidence` (DB column) | Low | Gate on completeness score and/or `overall_confidence ≥ 60` (DB-only) | **READY_FOR_UPGRADE** |
| **WEBSITE** | `companies.website_domain` non-null | `company_domains.verification_status ∈ (verified, admin_override)` + `verified_at` (DB-only) | Very low (presence ≠ ownership) | Require a **verified** domain, not just present | **READY_FOR_UPGRADE** |
| **GOOGLE_ANALYTICS** | `analytics_integrations.status='connected'` | `getGoogleAnalyticsCapabilityReadiness`: connected + valid token (`analytics_tokens.expiry_date`) + active property (`analytics_properties.is_active`) [+ ≥100 `canonical_events`/30d for full] | Low | DB-only: connected + token-valid + active-property. Event-depth needs `canonical_events` (DB but heavier). | **READY_FOR_UPGRADE** (DB-only partial) / NEEDS_NEW_DATA (event depth) |
| **GOOGLE_SEARCH_CONSOLE** | `analytics_integrations.status='connected'` | `getGoogleSearchConsoleReadiness`: connected + GSC scope (`analytics_tokens.scope`) + active property (`account_id != siteUnverifiedUser`) + verified `company_domains` [+ `keyword_metrics` coverage] | Low | DB-only: connected + scope + property + verified domain. Coverage/freshness needs `keyword_metrics` + live GSC. | **READY_FOR_UPGRADE** (DB-only partial) / NEEDS_NEW_DATA (coverage) |
| **SOCIAL_INTEGRATIONS** | ≥1 active non-expired token via members | `platformTokenService.getPlatformsWithTokensForOrg` (same filters; per-platform list) | High | Marginal — expose per-platform detail in the drawer | **NOT_APPLICABLE** (signal already matches) |
| **COMMUNITY** | — (UNKNOWN) | none — no community feature/table | n/a | Build a community source first | **NEEDS_NEW_DATA** |
| **TEAM_MEMBERS** | ≥2 active members | same; could add recency/role-diversity | High | Marginal | **NOT_APPLICABLE** |
| **BILLING** | plan assigned OR `lifetime_purchased>0` | actively-paid: `lifetime_purchased>0` OR `credit_purchases.status='completed'`; available balance from `organization_credits` | Medium–High | Distinguish "plan-assigned" from "actively paid"; surface available balance | **READY_FOR_UPGRADE** (today they coincide, but the stricter signal is safer) |

## Live confidence calibration (read-only)

| Area | current READY | upgraded READY | delta |
|---|---|---|---|
| company_profile | 11 | 3 | −8 (confidence gate) |
| website | 38 | **1** | **−37** (verification gate) |
| ga | 0 | 0 | 0 |
| gsc | 0 | 0 | 0 |
| social | 2 | 2 | 0 |
| team | 1 | 1 | 0 |
| billing | 28 | 28 | 0 |

**Top upgrade by impact:** WEBSITE (verification) — removes 37 false positives.
Second: COMPANY_PROFILE (confidence gate) — removes 8.
