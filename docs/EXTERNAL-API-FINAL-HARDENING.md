# External API System — Final Hardening

## 1. SQL migration

**File:** `database/external_api_hardening.sql`

- **FIX 1 — Hard guardrail:** `ALTER TABLE external_api_user_access DROP COLUMN IF EXISTS is_enabled;` so enablement can only come from `company_api_configs.enabled`.
- **FIX 2 — Orphan protection:** Recreate FK on `company_api_configs.api_source_id` to `external_api_sources(id)` with `ON DELETE CASCADE` so configs are removed when an API source is deleted.
- **FIX 3 — Unique company config:** `CREATE UNIQUE INDEX IF NOT EXISTS company_api_configs_company_api_unique ON company_api_configs(company_id, api_source_id);`

**Run after:** `company_api_configs.sql`, `external-api-user-access.sql`.

---

## 2. Files modified

| File | Change |
|------|--------|
| `database/external_api_hardening.sql` | New migration (FIX 1–3). |
| `backend/services/externalApiService.ts` | `ExternalApiUserAccess` type: removed `is_enabled`. `getEnabledApiIdsFromCompanyConfig` now uses `getCompanyConfigRows` from cache. |
| `pages/api/external-apis/index.ts` | Replaced `external_api_user_access` + `is_enabled` with `company_api_configs` (enabled count and enabled companies by API). |
| `backend/services/companyApiConfigService.ts` | Added `FILTER_KEYS`, `MAX_VALUES_PER_FILTER_TYPE` (50), `normalizeFilterRecord()`, `validateFilterLimits()`. |
| `pages/api/external-apis/company-config.ts` | Normalize include/exclude filters before save; validate max 50 per type; call `invalidateCompanyConfigCache(companyId)` after successful PUT. |
| `backend/services/companyApiConfigCache.ts` | **New.** In-memory cache TTL 5 min, key `company_api_config:{companyId}`. `getCompanyConfigRows(companyId)`, `invalidateCompanyConfigCache(companyId)`. |
| `backend/services/companyTrendRelevanceEngine.ts` | `loadCompanyConfigFilters` uses `getCompanyConfigRows` (single load per request, cached). Comment: configs preloaded once, filter applied per theme. |
| `pages/api/external-apis/access.ts` | Import `invalidateCompanyConfigCache`; call after bulk update and after single-API enable. |

**Note:** `pages/api/external-apis/presets.ts` was already using `company_api_configs` for “hidden” presets (`enabled = false`). No change.

---

## 3. Config caching

- **Module:** `backend/services/companyApiConfigCache.ts`
- **Key:** `company_api_config:{companyId}`
- **TTL:** 5 minutes
- **Value:** Array of `CompanyConfigRow` (`api_source_id`, `company_id`, `enabled`, `include_filters`, `exclude_filters`) for that company.
- **Usage:**
  - `getCompanyConfigRows(companyId)`: returns cached rows or loads from `company_api_configs`, caches, returns.
  - `getEnabledApiIdsFromCompanyConfig` (externalApiService): uses `getCompanyConfigRows`, then filters to `enabled` and maps to `api_source_id`.
  - `loadCompanyConfigFilters` (companyTrendRelevanceEngine): uses `getCompanyConfigRows`, then merges include/exclude from enabled rows.
- **Invalidation:** `invalidateCompanyConfigCache(companyId)` is called:
  - After successful PUT in `pages/api/external-apis/company-config.ts`
  - After bulk update in `pages/api/external-apis/access.ts` (company_default_api_ids)
  - After single-API enable in `pages/api/external-apis/access.ts` (is_enabled true)

---

## 4. Validation and normalization

- **Filter normalization** (before store): trim, lowercase, dedupe. Implemented in `normalizeFilterRecord()` in `companyApiConfigService.ts`. Example: `[" OpenAI ", "openai", "Anthropic"]` → `["openai", "anthropic"]`.
- **Filter safety:** `validateFilterLimits(include, exclude)` in `companyApiConfigService.ts`. Max **50 values per filter type** (per key in include_filters and exclude_filters). Returns `{ ok: false, error }` if exceeded; company-config PUT returns 400 with that error.
- **Default config (FIX 4):** When enabling an API (access API bulk or single), `company_api_configs` is upserted with: `enabled = true`, `polling_frequency = 'daily'`, `priority = 'MEDIUM'`, `purposes = []`, `include_filters = {}`, `exclude_filters = {}`. So enabling without prior configuration still creates a snapshot.

---

## 5. Theme filter performance (FIX 7)

- `getThemesForCompany` loads config once per request via `loadCompanyConfigFilters(companyId)`, which uses `getCompanyConfigRows(companyId)` (cached).
- Then loops over themes and applies `themePassesConfigFilters(theme, include, exclude)`.
- No per-theme config query.

---

## Summary

- **FIX 1:** `is_enabled` dropped from `external_api_user_access`; all enablement from `company_api_configs`.
- **FIX 2:** FK on `api_source_id` has `ON DELETE CASCADE`.
- **FIX 3:** Unique index on `(company_id, api_source_id)`.
- **FIX 4:** Default config snapshot on enable (already in place via upsert).
- **FIX 5:** Filters normalized (trim, lowercase, dedupe) in company-config PUT.
- **FIX 6:** Max 50 values per filter type; 400 if exceeded.
- **FIX 7:** Config preloaded once in `getThemesForCompany`; filter applied per theme.
- **FIX 8:** 5-min in-memory cache for company config rows; invalidated on config change.
