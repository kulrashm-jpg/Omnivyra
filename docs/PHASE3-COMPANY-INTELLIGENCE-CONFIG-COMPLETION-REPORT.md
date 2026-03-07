# Phase-3 Company Intelligence Configuration — Completion Report

---

## 1. System Architecture After Phase-3

```
┌─────────────────────────────────────────────────────────────────────────────┐
│              COMPANY INTELLIGENCE CONFIGURATION (Phase-3)                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  /api/company/intelligence/topics      company_intelligence_topics           │
│  /api/company/intelligence/competitors company_intelligence_competitors      │
│  /api/company/intelligence/products   company_intelligence_products         │
│  /api/company/intelligence/regions    company_intelligence_regions          │
│  /api/company/intelligence/keywords    company_intelligence_keywords          │
│                                                                              │
│  companyIntelligenceConfigService → Plan limit enforcement (plan_limits)     │
│  getRandomTopic, getRandomCompetitor, etc. (for placeholder resolution)     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Feeds placeholder values
                                    │ (Phase-4 will wire to query builder)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│              SUPER ADMIN GOVERNANCE (Phase-2) — Unchanged                     │
│  intelligence_categories, plan_limits, query_templates                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│              PHASE-1 INGESTION PIPELINE — Unchanged                         │
│  intelligencePollingWorker → intelligenceIngestionModule →                  │
│  intelligenceQueryBuilder → externalApiService → signalRelevanceEngine →     │
│  intelligenceSignalStore → intelligence_signals                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Database Migrations Created

| File | Purpose |
|------|---------|
| `database/company_intelligence_config.sql` | Creates 5 company config tables + indexes + updated_at triggers |

**Run order:** After `companies.sql` and `governance_add_updated_at.sql` (for `set_updated_at_timestamp`).

---

## 3. New Tables Introduced

| Table | Purpose |
|-------|---------|
| `company_intelligence_topics` | Topics for `{topic}` placeholder |
| `company_intelligence_competitors` | Competitors for `{competitor}` placeholder |
| `company_intelligence_products` | Products for `{product}` placeholder |
| `company_intelligence_regions` | Regions for `{region}` placeholder |
| `company_intelligence_keywords` | Keywords for `{keyword}` placeholder |

**Common schema per table:**
- `id`, `company_id` (FK companies), `enabled`, `created_at`, `updated_at`
- Value column: `topic`, `competitor_name`, `product_name`, `region`, `keyword`
- Index: `(company_id, enabled)`
- Trigger: `set_updated_at_timestamp()` on UPDATE

---

## 4. Services Created

| Service | Responsibility |
|---------|----------------|
| `companyIntelligenceConfigService.ts` | CRUD for topics, competitors, products, regions, keywords; plan limit enforcement; getRandom* helpers |

**Functions:**
- Topics: `getCompanyTopics`, `createTopic`, `updateTopic`, `setTopicEnabled`
- Competitors: `getCompanyCompetitors`, `createCompetitor`, `updateCompetitor`, `setCompetitorEnabled`
- Products: `getCompanyProducts`, `createProduct`, `updateProduct`, `setProductEnabled`
- Regions: `getCompanyRegions`, `createRegion`, `updateRegion`, `setRegionEnabled`
- Keywords: `getCompanyKeywords`, `createKeyword`, `updateKeyword`, `setKeywordEnabled`
- Helpers: `getRandomTopic`, `getRandomCompetitor`, `getRandomProduct`, `getRandomRegion`, `getRandomKeyword`

---

## 5. API Endpoints Added

| Endpoint | Methods | Auth |
|----------|---------|------|
| `/api/company/intelligence/topics` | GET, POST, PUT, PATCH | withRBAC (company roles) |
| `/api/company/intelligence/competitors` | GET, POST, PUT, PATCH | withRBAC (company roles) |
| `/api/company/intelligence/products` | GET, POST, PUT, PATCH | withRBAC (company roles) |
| `/api/company/intelligence/regions` | GET, POST, PUT, PATCH | withRBAC (company roles) |
| `/api/company/intelligence/keywords` | GET, POST, PUT, PATCH | withRBAC (company roles) |

**Required:** `companyId` in query (GET) or body (POST/PUT/PATCH).

**Allowed roles:** COMPANY_ADMIN, ADMIN, SUPER_ADMIN, CONTENT_CREATOR, CONTENT_PLANNER.

---

## 6. Plan Limit Enforcement Mechanism

| Step | Implementation |
|------|----------------|
| 1. Resolve plan | Query `organization_plan_assignments` where `organization_id = companyId` (company used as org) |
| 2. Load limits | Query `plan_limits` for `plan_id` and resource_key: max_topics, max_competitors, max_regions, max_products, max_keywords |
| 3. Count enabled | Count rows where `company_id` and `enabled = true` for the relevant table |
| 4. Reject if over | Before INSERT, if `current >= limit`, throw → API returns **403** with `error: PLAN_LIMIT_EXCEEDED` |

**Note:** `planResolutionService` and `usageEnforcementService` are not modified. Enforcement is implemented in `companyIntelligenceConfigService` via `getPlanLimit()` and `checkPlanLimit()`.

---

## 7. Verification: Ingestion Pipeline Unchanged

| Component | Status |
|-----------|--------|
| intelligencePollingWorker.ts | Not modified |
| intelligenceIngestionModule.ts | Not modified |
| intelligenceQueryBuilder.ts | Not modified |
| externalApiService.ts | Not modified |
| signalRelevanceEngine.ts | Not modified |
| intelligenceSignalStore.ts | Not modified |
| schedulerService.ts | Not modified |
| intelligence_signals | Not modified |
| external_api_sources | Not modified |
| intelligence_query_templates | Not modified |
| signal_topics, signal_companies, signal_keywords, signal_influencers | Not modified |

---

## 8. Verification: Governance Layer Compatibility

| Governance Table/Service | Compatibility |
|--------------------------|---------------|
| intelligence_categories | Unchanged; company config is separate |
| plan_limits | Extended via Phase-2 seed (max_topics, etc.); Phase-3 reads only |
| plan_features | Removed; feature flags now in plan_limits |
| intelligence_query_templates | Unchanged |
| external_api_sources | Unchanged |
| company_api_configs | Unchanged |

**Placeholder mapping:** Company config maps to query builder placeholders:
- `company_intelligence_topics.topic` → `{topic}`
- `company_intelligence_competitors.competitor_name` → `{competitor}`
- `company_intelligence_products.product_name` → `{product}`
- `company_intelligence_regions.region` → `{region}`
- `company_intelligence_keywords.keyword` → `{keyword}`

---

## Phase-4 Preparation

Phase-4 (Intelligence Signal Personalization and Relevance Scoring) can:
1. Use `getRandomTopic`, `getRandomCompetitor`, etc. when building query context for the existing `expand()` flow
2. Integrate company config with `buildProfileRuntimeValues` or a similar layer without changing the query builder
3. Apply company config to signal relevance scoring (e.g. in `signalRelevanceEngine` callers or a wrapper)
