# VALUE_DRIVER_SIGNAL_AUDIT.md

Phase 14F · Phase 1 — signals that could plausibly precede value realization. **Audit only.**
**ASSOCIATION IS NOT CAUSATION.**

| Signal | Source | Coverage (with) | Freshness | Confidence | Classification |
|---|---|---|---|---|---|
| PROFILE_READY | readiness `company_profile_ready` | 3 | per-request | HIGH | **DIRECT_DRIVER** (candidate) |
| DOMAIN_VERIFIED | `company_domains` | 1 | on verify | HIGH | **DIRECT_DRIVER** (candidate) |
| GA_CONNECTED | `analytics_integrations` GA4 | 0 | live-check | MEDIUM | **INDIRECT_DRIVER** |
| GSC_CONNECTED | `analytics_integrations` GSC | 0 | live-check | MEDIUM | **INDIRECT_DRIVER** |
| SOCIAL_CONNECTED | `social_accounts` | 2 | refresh | MEDIUM | **INDIRECT_DRIVER** |
| TEAM_ESTABLISHED | `user_company_roles` | 1 | real-time | HIGH | **DIRECT_DRIVER** (candidate) |
| BILLING_ACTIVE | plan/credits | 28 | assign/grant | MEDIUM | **PROXY_DRIVER** |
| ACTIVATED | readiness `tenant_status` | 4 | per-request | MEDIUM | **PROXY_DRIVER** (activity-driven) |
| CONTENT_CREATED | `blogs`/`creator_assets` | 3 | on create | HIGH | **value constituent (CIRCULAR)** |
| CONTENT_PUBLISHED | `publishing_jobs` | 1 | on publish | HIGH | **value constituent (CIRCULAR)** |
| CAMPAIGN_CREATED | `campaigns` | 3 | on create | HIGH | **value constituent (CIRCULAR)** |
| REPORT_GENERATED | `reports` | 2 | on generate | HIGH | **value constituent (CIRCULAR)** |
| MARKET_PULSE_USED | `market_pulse_runs` | 1 | on run | HIGH | **value constituent (CIRCULAR)** |

## Findings

- **Genuine candidate drivers = the 8 capability signals.** The 5 value-activity signals
  **constitute the value outcome** (value = ≥ 1 of them), so associating them with value is
  **circular/definitional** — they are computed but excluded from driver ranking.
- **ACTIVATED is activity-driven** (`tenant_status`), so its association with value is partly
  mechanical — active companies are by definition the ones doing things. Treated as a
  PROXY_DRIVER, not a lever.
- **GA/GSC are never observed** (0 connected) → no association possible.
