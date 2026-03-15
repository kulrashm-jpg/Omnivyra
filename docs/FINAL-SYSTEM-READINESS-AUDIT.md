# Final System Readiness Audit

**Date:** 2026-03-07

---

## 1 — Multi-Company Support

### Schema Summary

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `company_intelligence_topics` | company_id, topic, enabled | Topics per company for filtering |
| `company_intelligence_keywords` | company_id, keyword, enabled | Keywords per company |
| `company_intelligence_competitors` | company_id, competitor_name, enabled | Competitors per company |
| `company_intelligence_products` | company_id, product_name, enabled | Products per company |
| `company_intelligence_regions` | company_id, region, enabled | Regions per company |

### Multi-Company Logic

- **fetchActiveCompanies()** — Iterates all 5 tables, returns `company_id` set where `enabled = true`. Supports any number of companies.
- **distributeSignalsToCompanies()** — For each `company_id` in active set, runs `processInsertedSignalsForCompany(companyId, signalIds)`. Each company gets its own filtered/ranked signals.
- **companySignalFilteringEngine** — Loads config per company via `loadCompanyIntelligenceConfiguration(companyId)` from `companyIntelligenceConfigService` (getCompanyTopics, getCompanyCompetitors, etc.).
- **company_intelligence_signals** — Has `company_id`; each row is company-scoped. UNIQUE (company_id, signal_id) prevents duplicates per company.

**Verdict:** ✓ Multi-company supported. Each company has isolated config and signal rows.

---

## 2 — Query Builder Customization

### Placeholders Supported

`intelligenceQueryBuilder.ts` defines:

```
PLACEHOLDERS = ['topic', 'competitor', 'product', 'region', 'keyword']
```

Template expansion: `{topic}`, `{competitor}`, `{product}`, `{region}`, `{keyword}`.

### Input Shape

```ts
QueryBuilderInput = {
  source, template?, companyId?, topic?, competitor?, product?, region?, keyword?
}
```

### Example Generated Queries

| Input | Expanded q/query |
|-------|-------------------|
| topic="AI", template="{topic} trends" | `q: "AI trends"` |
| topic="AI", competitor="OpenAI", template="{topic} {competitor}" | `q: "AI OpenAI"` |
| topic="marketing automation", keyword="SaaS" | `q: "marketing automation"` (keyword in runtimeValues) |

### Company Context

When `companyId` is set, `fetchSingleSourceWithQueryBuilder` calls `buildProfileRuntimeValues(companyId)` and passes:

- `topic` ← profile.category / industry
- `competitor` ← profile (if present)
- `product` ← profile (if present)
- `region` ← profile.geo
- `keyword` ← profile keywords (category_list, industry_list, etc.)

Templates from `intelligence_query_templates` (per api_source_id or global) are expanded with these values.

**Verdict:** ✓ Query builder supports topics, keywords, competitors, products, regions. Configurable via templates and company profile.

---

## 3 — Strategic Theme Generation

### Source

Themes generated from `signal_intelligence`:

```ts
loadEligibleIntelligence():
  .from('signal_intelligence')
  .gte('momentum_score', 0.6)
  .eq('trend_direction', 'UP')
  .order('momentum_score', { ascending: false })
```

### Filters (Noise Reduction)

- `momentum_score >= 0.6`
- `trend_direction = 'UP'`
- One theme per cluster (skip if cluster_id already has theme)

### Example Theme Object

```json
{
  "id": "uuid",
  "cluster_id": "uuid",
  "intelligence_id": "uuid",
  "theme_title": "How AI is Transforming Marketing Automation",
  "theme_description": "Organizations are rapidly adopting marketing automation to improve productivity...",
  "momentum_score": 0.85,
  "trend_direction": "UP",
  "companies": [],
  "keywords": [],
  "influencers": [],
  "created_at": "2026-03-07T..."
}
```

### Ranking

- Load order: `momentum_score DESC`
- `getStrategicThemesAsOpportunities()` orders by `momentum_score DESC`
- `companyTrendRelevanceEngine` scores themes per company (relevance_score)

**Verdict:** ✓ Themes from signal_intelligence, ranked by momentum_score and trend_direction. relevance_score used for company-specific ranking.

---

## 4 — Intelligence APIs

### Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/intelligence/themes` | GET | Themes for company. Params: companyId (required), windowHours, persist |
| `/api/company/intelligence/signals` | GET | Company dashboard signals. Params: companyId (required), windowHours (1–720) |

### Example Response — GET /api/intelligence/themes

```json
{
  "themes": [
    {
      "id": "uuid",
      "theme_title": "...",
      "theme_description": "...",
      "momentum_score": 0.85,
      "trend_direction": "UP"
    }
  ]
}
```

### Example Response — GET /api/company/intelligence/signals

```json
{
  "categories": [...],
  "signals": [
    {
      "topic": "...",
      "signal_score": 0.75,
      "priority_level": "high",
      "matched_topics": ["AI"],
      "matched_competitors": [],
      "matched_regions": []
    }
  ]
}
```

**Note:** `/api/intelligence/themes` requires `companyId` (query or user context). `/api/company/intelligence/signals` requires `companyId` and RBAC (COMPANY_ADMIN, ADMIN, etc.).

**Verdict:** ✓ APIs exist. Themes and signals are company-scoped.

---

## 5 — System Readiness Summary

### Idempotency

- `intelligence_signals.idempotency_key` — UNIQUE constraint.
- Key: `sha256(source_api_id + topic + detected_at [+ queryHash])`.
- Upsert with `onConflict: 'idempotency_key'`, `ignoreDuplicates: true`.
- **Verdict:** ✓ Duplicate signals prevented.

### Clustering Window

- `signalClusterEngine`: `WINDOW_HOURS = 6`.
- Fetches unclustered signals: `detected_at > now() - 6h`, `cluster_id IS NULL`.
- Recent clusters: `last_updated >= now() - 6h`.
- **Verdict:** ✓ Uses recent signals only.

### Theme Generation Filters

- `momentum_score >= 0.6`
- `trend_direction = 'UP'`
- One theme per cluster (no duplicates)
- **Verdict:** ✓ Noise filtered.

### Scalability

- Multi-company: ✓ Per-company config and signals.
- Query builder: ✓ Placeholders and templates.
- Distribution: ✓ Batched (50 signals), fire-and-forget.
- Plan limits: ✓ companyIntelligenceConfigService enforces max_topics, max_competitors, etc.

### Production Readiness

| Aspect | Status |
|--------|--------|
| Multi-company support | ✓ |
| Configurable inputs (topics, keywords, competitors, products, regions) | ✓ |
| Idempotency | ✓ |
| Clustering window (6h) | ✓ |
| Theme filters (momentum, direction) | ✓ |
| Intelligence APIs | ✓ |
| RBAC on company signals | ✓ |

**Verdict:** ✓ System is scalable, configurable, and production ready.
