# EXTERNAL API SYSTEM — FINAL HARDENING FIX — Implementation Report

**Goal:** Stabilize the External API system after the enablement refactor. Signal ingestion, workers, and campaign generation were not modified.

---

## 1. SQL migration files

**File:** `database/external_api_hardening.sql`  
**Run after:** `company_api_configs.sql`, `external-api-user-access.sql`

| Fix | Migration |
|-----|-----------|
| **FIX 1 — Hard database guardrail** | `ALTER TABLE external_api_user_access DROP COLUMN IF EXISTS is_enabled;` — Enablement can only come from `company_api_configs.enabled`. |
| **FIX 2 — Orphan protection** | `ALTER TABLE company_api_configs DROP CONSTRAINT IF EXISTS company_api_configs_api_source_id_fkey;` then `ADD CONSTRAINT company_api_configs_api_source_id_fkey FOREIGN KEY (api_source_id) REFERENCES external_api_sources(id) ON DELETE CASCADE;` — Configs are deleted when an API source is removed. |
| **FIX 3 — Unique company config** | `CREATE UNIQUE INDEX IF NOT EXISTS company_api_configs_company_api_unique ON company_api_configs(company_id, api_source_id);` — Prevents duplicate (company_id, api_source_id) rows. |

---

## 2. Files modified

| File | Change |
|------|--------|
| `database/external_api_hardening.sql` | **New.** Single migration implementing FIX 1–3. |
| `backend/services/externalApiService.ts` | Removed `is_enabled` from `ExternalApiUserAccess`. `getEnabledApiIdsFromCompanyConfig` now uses cached `getCompanyConfigRows()` instead of querying DB directly. |
| `pages/api/external-apis/index.ts` | Replaced `external_api_user_access` + `is_enabled` with `company_api_configs` for enabled-count and enabled-companies-by-API. |
| `backend/services/companyApiConfigService.ts` | Added `FILTER_KEYS`, `MAX_VALUES_PER_FILTER_TYPE` (50), `normalizeFilterRecord()`, `validateFilterLimits()`. |
| `pages/api/external-apis/company-config.ts` | Normalizes include/exclude filters before save; validates max 50 values per filter type; calls `invalidateCompanyConfigCache(companyId)` after successful PUT. |
| `backend/services/companyApiConfigCache.ts` | **New.** In-memory cache for company config rows; TTL 5 min; key `company_api_config:{companyId}`; `getCompanyConfigRows()`, `invalidateCompanyConfigCache()`. |
| `backend/services/companyTrendRelevanceEngine.ts` | `loadCompanyConfigFilters()` uses `getCompanyConfigRows()` (one load per request, cached). Configs preloaded once; `themePassesConfigFilters(theme, configs)` applied per theme. |
| `pages/api/external-apis/access.ts` | Calls `invalidateCompanyConfigCache(companyId)` after bulk update and after single-API enable. Ensures default config snapshot on enable (FIX 4) via upsert with defaults. |

---

## 3. Config caching implementation

- **Module:** `backend/services/companyApiConfigCache.ts`
- **Cache key:** `company_api_config:{companyId}`
- **TTL:** 5 minutes (`TTL_MS = 5 * 60 * 1000`)
- **Cached value:** Array of `CompanyConfigRow`: `api_source_id`, `company_id`, `enabled`, `include_filters`, `exclude_filters`

**API:**

- **`getCompanyConfigRows(companyId)`** — Returns cached rows if present and not expired; otherwise loads from `company_api_configs`, caches, and returns. Used by `getEnabledApiIdsFromCompanyConfig` and `loadCompanyConfigFilters`.
- **`invalidateCompanyConfigCache(companyId)`** — Removes the entry for that company. Called when configuration changes.

**Invalidation points:**

1. `pages/api/external-apis/company-config.ts` — After successful PUT (save config).
2. `pages/api/external-apis/access.ts` — After bulk update (`company_default_api_ids`).
3. `pages/api/external-apis/access.ts` — After single-API enable (when `is_enabled === true`).

**Consumers:**

- `externalApiService.getEnabledApiIdsFromCompanyConfig()` — Uses `getCompanyConfigRows()`, then filters to `enabled` and maps to `api_source_id`.
- `companyTrendRelevanceEngine.loadCompanyConfigFilters()` — Uses `getCompanyConfigRows()`, then merges include/exclude from enabled rows for theme filtering.

---

## 4. Validation additions

**Filter normalization (FIX 5)** — `companyApiConfigService.normalizeFilterRecord(obj)`:

- Applied to `include_filters` and `exclude_filters` before storing (company-config PUT).
- For each filter key (`keywords`, `topics`, `competitors`, `industries`, `companies`, `influencers`, `technologies`, `geography`): trim whitespace, lowercase, remove duplicates.
- Example: `[" OpenAI ", "openai", "Anthropic"]` → `["openai", "anthropic"]`.

**Filter safety check (FIX 6)** — `companyApiConfigService.validateFilterLimits(include, exclude)`:

- **Rule:** Maximum 50 values per filter type (per key in include_filters and exclude_filters).
- Returns `{ ok: true }` or `{ ok: false, error: string }` (e.g. `"include_filters.keywords exceeds maximum of 50 values"`).
- Company-config PUT calls it after normalization; if `ok === false`, returns **400** with `error` in the response body.

**Default config enforcement (FIX 4):**

- When a company enables an API and no row exists for `(company_id, api_source_id)`, the access API (bulk or single) upserts `company_api_configs` with: `enabled = true`, `polling_frequency = 'daily'`, `priority = 'MEDIUM'`, `purposes = []`, `include_filters = '{}'`, `exclude_filters = '{}'`.
- Implemented in `pages/api/external-apis/access.ts` (bulk `company_default_api_ids` and single-API `is_enabled` path).

---

## Summary checklist

| # | Requirement | Status |
|---|-------------|--------|
| FIX 1 | Drop `external_api_user_access.is_enabled` | ✅ Migration in `external_api_hardening.sql` |
| FIX 2 | FK `api_source_id` ON DELETE CASCADE | ✅ Migration in `external_api_hardening.sql` |
| FIX 3 | Unique index `(company_id, api_source_id)` | ✅ Migration in `external_api_hardening.sql` |
| FIX 4 | Default config when enabling without config | ✅ Upsert with defaults in access API |
| FIX 5 | Filter normalization (trim, lowercase, dedupe) | ✅ `normalizeFilterRecord()` in companyApiConfigService; used in company-config PUT |
| FIX 6 | Max 50 values per filter type | ✅ `validateFilterLimits()`; 400 if exceeded |
| FIX 7 | Preload config once in `getThemesForCompany` | ✅ `loadCompanyConfigFilters` uses `getCompanyConfigRows`; filter applied per theme |
| FIX 8 | 5-min cache, key `company_api_config:{companyId}`, invalidate on change | ✅ `companyApiConfigCache.ts`; invalidate in company-config PUT and access API |
