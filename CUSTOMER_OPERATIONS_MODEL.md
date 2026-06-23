# CUSTOMER_OPERATIONS_MODEL.md

Phase 13A · Phase 2 — the unified per-company model exposed by the Command Center.
**Read-only aggregation.** Source: [backend/services/customerOperationsCockpitService.ts](backend/services/customerOperationsCockpitService.ts).

## Per-company (`CockpitCompany`)

| Group | Fields | Origin |
|---|---|---|
| **Identity** | `company_id`, `company_name`, `website`, `website_domain`, `admin_email_domain`, `identity_health` (OK/DRIFT/UNKNOWN) | `companies` + `companyIdentityDriftService` |
| **Lifecycle** | `tenant_status` (SIGNUP_STARTED · EMAIL_VERIFIED · COMPANY_CREATED · ACTIVE · DORMANT · INACTIVE) | readiness |
| **Subscription** | `plan`, `paying`, `user_count`, `active_user_count_30d` | readiness billing/users |
| **Readiness** | `readiness_score`, `readiness_bucket` | 12A/C |
| **Priority** | `priority_score`, `priority_tier` | 12E |
| **Insights** | `key_insight`, `primary_blocker`, `primary_opportunity`, `narrative` | 12F |
| **Evolution** | `trajectory`, `score_delta` | 12G/H |
| **Integrations** | `ga`, `gsc`, `social`, `community` (READY/NOT_READY/UNKNOWN) | readiness area states |
| **Opportunity summary** | `opportunity_count`, `highest_severity` | 12D |
| **Activity** | `last_activity_at` | readiness |

## Result envelope (`CockpitResult`)

```
{
  summary:   { total_companies, active, dormant, inactive, paying,
               critical_priority, signup_failures, identity_drift },
  companies: CockpitCompany[]              // filtered + priority-sorted
  signup_funnel: { onboarded, total_failures, failures: [{ bucket, count, last_occurrence, affected_domains }] }
  portfolio: { priority_distribution, trajectory_distribution, top_blockers }
}
```

## Filters

`status`, `plan`, `priority`, `readiness`, `trajectory`, `search` — applied by the pure
`applyCockpitFilters`, which also priority-sorts (score desc, tie-broken by company_id).

## Guarantees

- **Aggregation only** — no business logic, no recommendations, no mutations. Every
  field is sourced from an existing read-only service or table.
- Defensive: any missing source degrades to UNKNOWN/0, never an error.
