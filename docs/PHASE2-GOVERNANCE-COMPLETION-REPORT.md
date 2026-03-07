# Phase-2 Super Admin Governance Layer — Completion Report

---

## 1. System Architecture After Phase-2

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     SUPER ADMIN GOVERNANCE LAYER (Phase-2)                │
├─────────────────────────────────────────────────────────────────────────┤
│  /api/admin/intelligence/categories     intelligence_categories          │
│  /api/admin/intelligence/plans          plan_limits, pricing_plans       │
│  /api/admin/intelligence/query-templates  intelligence_query_templates   │
│  /api/admin/intelligence/api-presets    external_api_sources             │
│                                                                          │
│  requireSuperAdmin middleware → intelligenceGovernanceService             │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ reads/updates (governance only)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     PHASE-1 INGESTION PIPELINE (UNCHANGED)               │
├─────────────────────────────────────────────────────────────────────────┤
│  intelligencePollingWorker                                               │
│       → intelligenceIngestionModule                                      │
│       → intelligenceQueryBuilder → intelligence_query_templates (read)   │
│       → externalApiService → external_api_sources (read)                 │
│       → normalization → signalRelevanceEngine (TAXONOMY_VALUES)         │
│       → intelligenceSignalStore → intelligence_signals                   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ schedulerService (unchanged)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  company_api_configs (enabled) + external_api_sources (is_active)       │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Database Migrations Created

| File | Purpose |
|------|---------|
| `database/intelligence_categories.sql` | Creates `intelligence_categories` table and seeds with TAXONOMY_VALUES |
| `database/plan_features.sql` | Creates `plan_features` table |
| `database/plan_limits_governance_seed.sql` | Seeds `plan_limits` with max_topics, max_competitors, max_regions, max_products, max_keywords |

**Migration order:**
1. `intelligence_categories.sql` — no dependencies
2. `plan_features.sql` — DEPRECATED. Use `plan_limits_feature_unification.sql` to unify into plan_limits
3. `plan_limits_governance_seed.sql` — run after `pricing_plans.sql`, `plan_limits` exists

---

## 3. New Tables Introduced

### intelligence_categories

| Column | Type | Constraints |
|--------|------|--------------|
| id | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() |
| name | TEXT | NOT NULL, UNIQUE |
| description | TEXT | NULL |
| enabled | BOOLEAN | NOT NULL, DEFAULT true |
| created_at | TIMESTAMPTZ | DEFAULT now() |

**Seed values:** TREND, COMPETITOR, PRODUCT, CUSTOMER, MARKETING, PARTNERSHIP, LEADERSHIP, REGULATION, EVENT

### plan_features (REMOVED)

**Deprecated.** Feature flags are now in `plan_limits` as `resource_key` with `limit_value` (1 = enabled, 0 = disabled). See `plan_limits_feature_unification.sql`.

---

## 4. Tables Extended

| Table | Change |
|-------|--------|
| plan_limits | New rows added via seed: resource_key ∈ {max_topics, max_competitors, max_regions, max_products, max_keywords}. No schema change. |

---

## 5. Files Created

| Path | Description |
|------|-------------|
| `database/intelligence_categories.sql` | Migration: intelligence_categories table + seed |
| `database/plan_features.sql` | DEPRECATED; plan_limits_feature_unification.sql unifies into plan_limits |
| `database/plan_limits_governance_seed.sql` | Seed: governance resource_keys in plan_limits |
| `backend/services/intelligenceGovernanceService.ts` | Governance service (categories, plan features, templates, presets) |
| `backend/middleware/requireSuperAdmin.ts` | Super admin auth helper |
| `pages/api/admin/intelligence/categories.ts` | Admin API: intelligence categories CRUD |
| `pages/api/admin/intelligence/plans.ts` | Admin API: plans with features, enable/disable feature |
| `pages/api/admin/intelligence/query-templates.ts` | Admin API: query templates CRUD |
| `pages/api/admin/intelligence/api-presets.ts` | Admin API: API presets CRUD |

---

## 6. Files Modified

**None.** All Phase-2 changes are additive. No modifications to Phase-1 services or tables.

---

## 7. Governance Service Implementation Summary

### intelligenceGovernanceService.ts

| Function | Responsibility |
|----------|----------------|
| `getCategories(enabledOnly?)` | List intelligence categories |
| `createCategory(params)` | Create category |
| `updateCategory(id, params)` | Update category name/description |
| `setCategoryEnabled(id, enabled)` | Enable/disable category |
| `listPlansWithLimits()` | List plans with their limits (numeric + feature flags as 0/1) |
| `getPlanLimits(planId)` | Get all limits for a plan |
| `setPlanLimit(planId, resourceKey, value)` | Upsert plan limit (numeric or feature flag 0/1) |
| `listQueryTemplates()` | List query templates |
| `createQueryTemplate(params)` | Create template |
| `updateQueryTemplate(id, params)` | Update template |
| `setQueryTemplateEnabled(id, enabled)` | Enable/disable template |
| `listApiPresets()` | List presets (is_preset = true) |
| `createApiPreset(params)` | Create custom preset |
| `updateApiPreset(id, params)` | Update preset |
| `setApiPresetEnabled(id, is_active)` | Enable/disable preset |

**Constraints:**
- Does NOT call external APIs
- Database interactions only
- Does not modify signalRelevanceEngine or TAXONOMY_VALUES

---

## 8. Admin API Endpoints Added

| Endpoint | Methods | Operations |
|----------|---------|------------|
| `/api/admin/intelligence/categories` | GET, POST, PUT, PATCH | List, create, update, enable/disable categories |
| `/api/admin/intelligence/plans` | GET, PUT, PATCH | List plans with limits; update limit values (including feature flags as 0/1) |
| `/api/admin/intelligence/query-templates` | GET, POST, PUT, PATCH | List, create, update, enable/disable query templates |
| `/api/admin/intelligence/api-presets` | GET, POST, PUT, PATCH | List, create, update, enable/disable API presets |

**Authentication:** All endpoints use `requireSuperAdmin` (legacy cookie or `isPlatformSuperAdmin`).

---

## 9. Verification: Ingestion Pipeline Unchanged

| Component | Status |
|-----------|--------|
| `intelligencePollingWorker.ts` | Not modified |
| `intelligenceIngestionModule.ts` | Not modified |
| `intelligenceQueryBuilder.ts` | Not modified — still reads `intelligence_query_templates` with `select('template, category')` |
| `externalApiService.ts` | Not modified |
| `signalRelevanceEngine.ts` | Not modified — still uses `TAXONOMY_VALUES` |
| `intelligenceSignalStore.ts` | Not modified |
| `schedulerService.ts` | Not modified — still uses `company_api_configs` + `external_api_sources` |
| `intelligence_signals` table | Schema unchanged |
| `external_api_sources` table | Schema unchanged |
| `intelligence_query_templates` table | Schema unchanged |
| `company_api_configs` table | Not modified |

**Governance layer:**
- Reads and writes `intelligence_query_templates` (admin CRUD) — does not alter schema
- Reads and writes `external_api_sources` where `is_preset = true` — does not alter schema
- Does not touch `intelligence_signals`, `company_api_configs`, or ingestion services

---

## Next Steps for Phase-3 (Company Intelligence Configuration)

1. Apply migrations: `intelligence_categories.sql`, `plan_limits_feature_unification.sql`, `plan_limits_governance_seed.sql`
2. Use governance APIs to configure categories, plan features, and presets
3. Phase-3 will enforce `plan_limits` (max_topics, etc.) during company configuration
4. Phase-3 may add company-scoped UI for query templates and API enablement
