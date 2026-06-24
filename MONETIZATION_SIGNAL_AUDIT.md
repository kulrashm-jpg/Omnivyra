# MONETIZATION_SIGNAL_AUDIT.md

Phase 14H · Phase 1 — monetization-signal inventory. **Audit only.** No billing actions.

| Signal | Source | Coverage | Freshness | Confidence | Classification |
|---|---|---|---|---|---|
| Subscription plan (name) | readiness `plan` (← `pricing_plans`) | 38 | per-request | MEDIUM | **REVENUE_SIGNAL** (tier name only, no amount) |
| Plan assignment | `organization_plan_assignments` | **0 rows** | — | LOW | **UNKNOWN** (table empty) |
| Credits | `organization_credits` | 29 (org-keyed) | real-time | LOW | **UNKNOWN** (org-keyed, no per-company amount) |
| Credit usage | — | — | — | — | **UNKNOWN** (no per-company usage amount) |
| Payment records | — | — | — | — | **UNKNOWN** (no per-company payment amount table found) |
| Billing readiness | readiness `billing_ready` | 28 paying | per-request | MEDIUM | **REVENUE_SIGNAL** (paying flag) |
| Activation | readiness `tenant_status` | 4 active | per-request | MEDIUM | **USAGE_SIGNAL** (proxy) |
| Value realization | 14E value categories | 4 | per-request | HIGH | **VALUE_SIGNAL** |
| Execution adoption | 14G execution volume | 4 (290 total) | per-request | HIGH | **USAGE_SIGNAL** |

## Findings

- **Actual revenue is UNKNOWN.** There is no per-company payment amount: plan-assignment is
  empty, credits are org-keyed, and no per-company payment table was located. **Revenue and
  credit concentration are reported UNKNOWN and never estimated.**
- The only monetization signal we can attribute per company is the **paying flag**
  (`billing_ready`) and the **plan name** — neither carries a dollar amount.
- "Paying" likely includes **test/sandbox billing** (the population is QA-heavy, per 14G), so
  even the paying count is not a clean revenue proxy.
