# CUSTOMER_VALUE_REALIZATION_SIGNAL_AUDIT.md

Phase 14E · Phase 1 — value-signal inventory. **Audit only**, row counts + linkage probed
live from production.

| Signal | Table(s) | Rows | Linkage | Value class |
|---|---|---|---|---|
| Content generation | `blogs` (30), `creator_assets` (154) | 184 | **company_id** | **DIRECT_VALUE** |
| Campaign creation | `campaigns` (12) | 12 | **company_id** | **DIRECT_VALUE** |
| Campaign publishing | `publishing_jobs` (9) | 9 | **company_id** | **DIRECT_VALUE** |
| Market pulse usage | `market_pulse_runs` (16) | 16 | **company_id** | **DIRECT_VALUE** |
| Report generation | `reports` (71) | 71 | **company_id** | **DIRECT_VALUE** |
| Analytics integrations | `analytics_integrations` | GA/GSC = 0 | company_id | **INDIRECT_VALUE** (enabler) |
| Social integrations | `social_accounts` (2) | 2 | company_id | **INDIRECT_VALUE** (enabler) |
| Readiness improvements | `customer_readiness_snapshots` | day-1 only | company_id | **INDIRECT_VALUE** (needs ≥ 2 days) |
| Activation status | readiness `tenant_status` | 4 active | derived | **PROXY_VALUE** |
| Engagement usage | `engagement_threads` (117), `engagement_messages` (116) | many | **organization_id** | **UNKNOWN** (not company-attributable) |
| Community usage | `community_ai_actions` (117), `community_posts` (0) | many | **organization_id** | **UNKNOWN** (not company-attributable) |

## Findings

- **5 clean DIRECT_VALUE signals** are company_id-keyed and measurable: content, campaign,
  publishing, market-pulse, reports.
- **Engagement & community are organization_id-keyed** — `organizations` ≠ `companies`, so
  these cannot be attributed per company → **UNKNOWN** (excluded from scoring; this is a real
  blind spot, not zero usage).
- **Value is highly concentrated:** the 184 content rows / 71 reports / 16 pulse runs sit in
  a handful of companies — most companies have zero of every signal (quantified in the report).
- **Payment timing is not company-attributable** → value-before/after-payment is
  NOT_COMPUTABLE.
