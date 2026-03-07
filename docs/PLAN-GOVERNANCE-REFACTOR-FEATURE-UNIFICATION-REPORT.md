# Plan Governance Refactor — Feature Unification Report

---

## 1. Schema Changes

| Change | Description |
|--------|-------------|
| `plan_limits.monthly_limit` → `limit_value` | Column renamed for unified representation of numeric limits and feature flags (0/1) |
| `plan_limits.limit_value` | INTEGER/BIGINT, supports both numeric limits (e.g. `max_topics = 10`) and boolean flags (e.g. `enable_api_presets = 1`) |
| `plan_features` migration | Existing `plan_features` rows migrated into `plan_limits`: `enabled = true` → `limit_value = 1`, else `0` |
| `plan_features` table | Dropped after migration |

**Example resource_keys after unification:**

| resource_key | Type | Example value |
|--------------|------|---------------|
| max_topics | Numeric limit | 5 |
| max_competitors | Numeric limit | 8 |
| max_regions | Numeric limit | 10 |
| max_products | Numeric limit | 5 |
| max_keywords | Numeric limit | 20 |
| enable_api_presets | Feature flag | 1 (enabled) / 0 (disabled) |
| enable_custom_templates | Feature flag | 1 / 0 |
| llm_tokens | Numeric limit | 50000 |
| external_api_calls | Numeric limit | 1000 |
| max_campaign_duration_weeks | Numeric limit | 12 |

---

## 2. Migration Executed

**File:** `database/plan_limits_feature_unification.sql`

| Step | Action |
|------|--------|
| 1 | Rename `plan_limits.monthly_limit` → `limit_value` (if column exists) |
| 2 | Migrate `plan_features` into `plan_limits`: `feature` → `resource_key`, `enabled` → `limit_value` (1/0) |
| 3 | `DROP TABLE IF EXISTS plan_features` |

**Idempotent:** Uses `IF EXISTS`, `ON CONFLICT DO NOTHING`, `DROP TABLE IF EXISTS`.

**Run order:** After `pricing_plans.sql`, before `plan_limits_governance_seed.sql` and `plan_duration_limits.sql`.

---

## 3. Tables Removed

| Table | Status |
|-------|--------|
| `plan_features` | Dropped by `plan_limits_feature_unification.sql` |

**Deprecated schema file:** `database/plan_features.sql` — marked deprecated; do not run in new environments.

---

## 4. Services Updated

| Service | Changes |
|---------|---------|
| `intelligenceGovernanceService.ts` | Removed `PlanFeature`, `getPlanFeatures`, `setPlanFeature`, `listPlansWithFeatures`; added `PlanLimit`, `getPlanLimits`, `setPlanLimit`, `listPlansWithLimits` |
| `companyIntelligenceConfigService.ts` | `getPlanLimit()` now selects `limit_value` instead of `monthly_limit` |
| `planResolutionService.ts` | Reads `limit_value` instead of `monthly_limit` from `plan_limits` |

**Governance service API:**

| Function | Responsibility |
|----------|----------------|
| `listPlansWithLimits()` | List all plans with their limits (numeric + feature flags as 0/1) |
| `getPlanLimits(planId)` | Get all limits for a plan |
| `setPlanLimit(planId, resourceKey, value)` | Upsert plan limit (numeric or feature flag 0/1) |

---

## 5. APIs Updated

| Endpoint | Changes |
|----------|---------|
| `/api/admin/intelligence/plans` | GET returns plans with limits; PUT/PATCH updates `plan_id`, `resource_key`, `limit_value` |
| `/api/super-admin/plans/create` | Upserts use `limit_value`; RESOURCE_KEYS expanded to include `max_topics`, `max_competitors`, `max_regions`, `max_products`, `max_keywords`, `enable_api_presets`, `enable_custom_templates` |
| `/api/super-admin/plans/list` | Selects `limit_value` instead of `monthly_limit` |

**Admin plans API body (PUT/PATCH):**

```json
{
  "plan_id": "uuid",
  "resource_key": "max_topics",
  "limit_value": 10
}
```

---

## 6. Code Cleanup Summary

| Area | Action |
|------|--------|
| TypeScript/TSX | No remaining `plan_features`, `planFeatures`, or `PlanFeature` references |
| `intelligenceGovernanceService.ts` | All plan feature logic replaced with plan limits |
| `plan_features.sql` | Deprecation notice added |
| `docs/PHASE2-GOVERNANCE-COMPLETION-REPORT.md` | Updated: plan_features → plan_limits |
| `docs/PHASE2-GOVERNANCE-UPDATED_AT-REPORT.md` | Updated: plan_features conditional |
| `docs/PHASE3-COMPANY-INTELLIGENCE-CONFIG-COMPLETION-REPORT.md` | Updated: plan_features removed |

---

## 7. Verification: Ingestion Pipeline Unchanged

| Component | Status |
|-----------|--------|
| `intelligencePollingWorker.ts` | Not modified |
| `intelligenceIngestionModule.ts` | Not modified |
| `intelligenceQueryBuilder.ts` | Not modified |
| `externalApiService.ts` | Not modified |
| `signalRelevanceEngine.ts` | Not modified |
| `intelligenceSignalStore.ts` | Not modified |
| `schedulerService.ts` | Not modified |

**Scope of refactor:** Governance layer, company configuration, and plan control only. No ingestion pipeline files touched.

---

## 8. Final Plan Governance Model

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         PLAN GOVERNANCE MODEL                            │
├─────────────────────────────────────────────────────────────────────────┤
│  pricing_plans                                                           │
│  ├── id, plan_key, name, description, monthly_price, is_active, ...     │
│                                                                          │
│  plan_limits                                                             │
│  ├── plan_id (FK → pricing_plans)                                        │
│  ├── resource_key (e.g. max_topics, enable_api_presets)                  │
│  └── limit_value (numeric limit or 0/1 for feature flags)                │
└─────────────────────────────────────────────────────────────────────────┘
```

**All feature flags and numeric limits** are represented in `plan_limits.resource_key` with `plan_limits.limit_value`:

- **Numeric limits:** `max_topics`, `max_competitors`, `max_regions`, `max_products`, `max_keywords`, `llm_tokens`, `external_api_calls`, `automation_executions`, `max_campaign_duration_weeks`
- **Feature flags:** `enable_api_presets`, `enable_custom_templates` (1 = enabled, 0 = disabled)

**Governance features now use plan_limits:**

- Intelligence categories — unchanged (separate table)
- Query templates — unchanged (separate table)
- API presets — unchanged (external_api_sources)
- Company configuration limits — enforced via `plan_limits` (max_topics, max_competitors, etc.)

---

## Migration Run Order (Post-Refactor)

1. `pricing_plans.sql`
2. `plan_limits_feature_unification.sql`
3. `plan_limits_governance_seed.sql`
4. `plan_duration_limits.sql` (if used)
5. `intelligence_categories.sql`
6. `governance_add_updated_at.sql`
7. Other governance migrations
