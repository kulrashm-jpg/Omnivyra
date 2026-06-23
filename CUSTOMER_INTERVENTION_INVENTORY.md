# CUSTOMER_INTERVENTION_INVENTORY.md

Phase 13D · Phase 2 — inventory of existing Omnivyra actions ("interventions") that can
drive a readiness change. **Audit only — no new actions.** Row counts + columns probed
live from production via `information_schema` (read-only).

| Intervention | Source table (rows) | Event timestamp | Company linkage | Readiness area | Traceability |
|---|---|---|---|---|---|
| **Domain verification** | `company_domains` (3) | `verified_at` (+ `verification_status`, `verified`, `created_via`) | company_id | WEBSITE | **High** — explicit verified_at |
| **GA connection** | `analytics_integrations` (6) | `created_at` / `status` / `last_live_check_at` | company/org | GOOGLE_ANALYTICS | **Med-High** — created_at + status (GA/GSC share table) |
| **GSC connection** | `analytics_integrations` (6) | `created_at` / `status` | company/org | GOOGLE_SEARCH_CONSOLE | **Med-High** — same table, provider-scoped |
| **Social connection** | `social_accounts` (7) | `created_at` / `last_successful_refresh_at` / `refresh_status` | company | SOCIAL_INTEGRATIONS | **High** — created_at + refresh state |
| **Profile completion** | `company_profiles` (29) | `last_refined_at` / `updated_at` (+ `overall_confidence`) | company | COMPANY_PROFILE | **Med** — confidence is a level, not a discrete event |
| **Team expansion** | `user_company_roles` (31) | `accepted_at` / `invited_at` / `status` | company | TEAM_MEMBERS | **High** — accepted_at |
| **Billing activation** | `organization_plan_assignments` (0) / `organization_credits` (29) | `assigned_at` / `created_at` | org | BILLING | **Low** — plan-assignment table empty; plan resolved elsewhere |
| **Campaign creation** | `campaigns` (12) | `launched_at` / `created_at` / `status` | company | *(activity, not a readiness area)* | High timestamp, but **no readiness-area mapping** |
| **Content creation** | *(not located in probe set: content_pieces/generated_content/posts absent)* | — | — | *(activity)* | **Unmapped** — table names differ; not snapshot-mapped |

## Findings

- Every **readiness-area** intervention has a reliably-timestamped source row, so finer
  event-level attribution is feasible in a future phase.
- **Campaign/content creation** are activity actions with timestamps but **no readiness
  area** — they cannot be correlated to a readiness improvement from snapshots and are
  inventoried for completeness only.
- The attribution engine (Phase 3) uses the **snapshot area-flip** as the dated,
  traceable proxy for these interventions (the area becoming READY = the intervention
  landed), which is deterministic and needs no cross-table time-joins. The source tables
  above are the ground-truth events these flips reflect.
