# CUSTOMER_REVENUE_SOURCE_AUDIT.md

Phase 15D · Phase 1 — every billing/subscription/payment/credit source. **Audit only. No
assumptions.** Probed live from production.

| Source | Rows | Amount columns | Linkage | Billing authority | Financial reliability | Company linkage | Class |
|---|---|---|---|---|---|---|---|
| `canonical_revenue_events` | 3 | `revenue_amount`, `currency_code` | **company_id** | canonical revenue | HIGH (recorded events) | **YES** | **DIRECT_REVENUE** |
| `invoices` | 3 | `total_amount`, `paid_at`, `status` | organization_id | invoice | HIGH | NO (org-keyed) | DIRECT_REVENUE (not company-attributable) |
| `credit_purchases` | 3 | `amount_paid`, `currency` | organization_id | purchase | HIGH | NO (org-keyed) | DIRECT_REVENUE (not company-attributable) |
| `payment_transactions` | **0** | `amount`, `net_amount` | organization_id | payment provider | — | — | DIRECT_REVENUE (**empty**) |
| `revenue_metrics` | **0** | `usd_revenue` | organization_id | metrics | — | — | DIRECT_REVENUE (**empty**) |
| `enterprise_purchase_orders` | **0** | `amount`, `paid_at` | — | PO | — | — | DIRECT_REVENUE (**empty**) |
| `organization_credits` | 29 | `paid_balance`, `credit_rate_usd` | organization_id | balance | — | NO | **INDIRECT_SIGNAL** (balance, not revenue) |
| `credit_transactions` | 381 | `usd_equivalent`, `paid_delta` | organization_id | ledger | MED | NO | **INDIRECT_SIGNAL** (ledger movements) |
| `usage_events` | 1001 | `final_price_usd`, `total_cost_usd` | organization_id | usage cost | MED | NO | **INDIRECT_SIGNAL** (usage cost, not booked revenue) |
| `unified_transactions` | 67910 | `credits_value_usd`, `final_price_usd`, `margin_usd` | organization_id | usage ledger | MED | NO | **INDIRECT_SIGNAL** |
| `pricing_plans` / `credit_packages` / `billing_plan_pricing` | 0–3 | `monthly_price`, `price`, `regular_usd` | — | catalog | — | — | **NOT_REVENUE** (list prices — using them = inference) |
| `llm_pricing_config` / `action_pricing_config` | 6–31 | cost config | — | cost | — | — | **NOT_REVENUE** (internal cost) |
| subscriptions (recurring amount) | — | *(none found populated)* | — | — | — | — | **NOT_REVENUE** (no recurring-amount source) |

## Findings

- **The only company-attributable revenue source is `canonical_revenue_events`** (3 rows,
  `company_id` + `revenue_amount`). Everything else is org-keyed (not joinable to the 38
  companies, since `companies` has no `organization_id`), empty, or catalog/cost config.
- **No recurring/subscription amount exists anywhere** → MRR / ARR / ACTIVE_SUBSCRIPTIONS are
  **UNMEASURABLE (UNKNOWN)**.
- Plan prices (`pricing_plans`, `credit_packages`) are **NOT_REVENUE** — modelling revenue
  from them is explicitly forbidden this phase, and is not done.
