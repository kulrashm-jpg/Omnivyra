# External API System — Stability Fix Summary

## Single source of truth

- **Enablement** is determined only by `company_api_configs.enabled`.
- **`external_api_user_access`** is used only for user-level overrides: `api_key_env_name`, `headers_override`, `query_params_override`, `rate_limit_per_min`. The `is_enabled` column is no longer used for API availability.

## Code changes

### 1. Enablement logic (`backend/services/externalApiService.ts`)

- **`getEnabledApiIdsFromCompanyConfig(companyId)`** (new): returns `api_source_id[]` from `company_api_configs` where `company_id` and `enabled = true`.
- **`getCompanyDefaultApiIds(companyId)`**: now returns `getEnabledApiIdsFromCompanyConfig(companyId)` (no longer reads `external_api_user_access.is_enabled`).
- **`getEnabledApis(companyId)`**: builds the enabled list from `company_api_configs` (enabled IDs) instead of `external_api_user_access.is_enabled`.
- **`getExternalApiSourcesForUser()`**: no longer filters by `accessMap[source.id]?.is_enabled`; merges overrides for all enabled sources.
- **`getPlatformConfigs(companyId)`**: uses `getEnabledApiIdsFromCompanyConfig(companyId)` instead of `external_api_user_access` for which presets are selected.

### 2. Access API (`pages/api/external-apis/access.ts`)

- **Bulk update (`company_default_api_ids`)**:
  - Writes enablement to **`company_api_configs`** (upsert per API with `enabled = true/false` and safe defaults: `polling_frequency: 'daily'`, `priority: 'MEDIUM'`, `purposes: []`, `include_filters: {}`, `exclude_filters: {}`).
  - No longer writes `is_enabled` into `external_api_user_access`.
- **Single API update (`api_source_id` + overrides)**:
  - If `is_enabled === true`, upserts **`company_api_configs`** with `enabled: true` and the same safe defaults.
  - Upserts **`external_api_user_access`** with only override fields (`api_key_env_name`, `headers_override`, `query_params_override`, `rate_limit_per_min`); `is_enabled` is not set.

### 3. Filter UI (`pages/external-apis-access.tsx`)

- Replaced raw JSON textareas for include/exclude filters with **structured tag (chip) inputs**.
- One row per filter key: `keywords`, `topics`, `competitors`, `industries`, `companies`, `influencers`, `technologies`, `geography`.
- Stored format remains JSONB, e.g. `include_filters: { "keywords": ["AI developer tools"], "competitors": ["OpenAI","Anthropic"] }`, `exclude_filters: { "topics": ["crypto","gaming"] }`.

### 4. Filter execution (tenant filtering)

- **No filtering at ingestion.** Signals are stored in raw form.
- **Filtering at read time** in **`getThemesForCompany`** (`backend/services/companyTrendRelevanceEngine.ts`):
  - Loads `company_api_configs` (include_filters, exclude_filters) for the company.
  - `themePassesConfigFilters(theme, include, exclude)` excludes themes that match exclude (topic/keywords/competitors) and, when include is non-empty, requires at least one include match.
- Pipeline: External API → Signal ingestion → Signal storage → **Tenant filtering** (when serving themes) → Theme/opportunity usage.

### 5. Polling configuration

- **`companyApiConfigService.ts`**: Comment added that **polling_frequency is advisory** and will be used in a future adaptive polling scheduler; it controls priority and API execution ordering only. Worker intervals are unchanged.

### 6. Validation

- Company config save still validates `polling_frequency` against plan (basic → daily/weekly, pro → 6h/daily/weekly, enterprise → realtime/2h/6h/daily) and returns a validation error if disallowed.

### 7. Safe defaults

- When enabling an API (via access API bulk or single), **`company_api_configs`** is upserted with: `enabled: true`, `polling_frequency: 'daily'`, `priority: 'MEDIUM'`, `purposes: []`, `include_filters: {}`, `exclude_filters: {}`.

## Not modified

- Signal pipeline, workers, theme generation, and campaign generation logic are unchanged.
- `intelligencePollingWorker` and `trendProcessingService` are not modified.

---

## healthMap duplicate build error (fixed)

### Problem
`getPlatformConfigs` had a duplicate `let healthMap` declaration causing a Turbopack/ECMAScript build error: "the name `healthMap` is defined multiple times". This could recur if similar health-fetch blocks were copy-pasted into the same function.

### Fix
- **Extracted helper** `fetchHealthMapForApiIds(apiIds: string[])` in `externalApiService.ts` that fetches from `external_api_health` and returns `Record<string, ExternalApiHealth>`.
- `getPlatformConfigs` now calls this helper once and uses a single `const healthMap = await fetchHealthMapForApiIds(apiIds)`.
- Health-fetch logic lives in one place; no risk of duplicate variable scope.

### If build still shows the error
1. Stop the dev server (Ctrl+C).
2. Delete the `.next` folder: `Remove-Item -Recurse -Force .next` (or `rm -rf .next` on Unix).
3. Restart: `npm run dev`.
