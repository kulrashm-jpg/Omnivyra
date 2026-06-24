# CAMPAIGN_EXECUTION_SIGNAL_AUDIT.md

Phase 14G · Phase 1 — execution-signal inventory. **Audit only.** Counts probed live; all
DIRECT signals are company_id-keyed (reused from the 14E loader, no new reads).

| Signal | Source | Coverage (companies w/ ≥1) | Volume | Freshness | Confidence | Classification |
|---|---|---|---|---|---|---|
| Campaign creation | `campaigns` | 3 | 12 | on create | HIGH | **EXECUTION_SIGNAL** |
| Campaign publishing | `publishing_jobs` | 1 | 9 | on publish | HIGH | **EXECUTION_SIGNAL** |
| Campaign completion | `campaigns.status` | — | — | on complete | MEDIUM | EXECUTION_SIGNAL (status not volume-counted here) |
| Content creation | `blogs` + `creator_assets` | 3 | 184 | on create | HIGH | **EXECUTION_SIGNAL** |
| Content publishing | `publishing_jobs` | 1 | 9 | on publish | HIGH | **EXECUTION_SIGNAL** |
| Report generation | `reports` | 2 | 71 | on generate | HIGH | **VALUE_SIGNAL** (outcome) |
| Market pulse usage | `market_pulse_runs` | 1 | 16 | on run | HIGH | **EXECUTION_SIGNAL** |
| Engagement usage | `engagement_threads`/`_messages` | — | 117/116 | event | — | **UNKNOWN** (organization_id-keyed) |
| Community usage | `community_ai_actions` | — | 117 | event | — | **UNKNOWN** (organization_id-keyed) |

## Findings

- **5 company-attributable execution signals** (content, campaign, publishing, market-pulse,
  reports) with a total of **290 executions** across the population.
- **Engagement & community are organization_id-keyed** → not company-attributable → UNKNOWN
  (excluded; a real blind spot, not zero usage).
- **Execution is extraordinarily concentrated** (quantified in the report): one company
  generates the overwhelming majority — and the top contributors are the **vendor's own org
  and QA fixtures**, not external customers.
