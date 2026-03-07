# External API Intelligence Configuration — Implementation Summary

## 1. Database migrations

### Created

- **`database/company_api_configs.sql`**
  - Table `company_api_configs`: `id`, `company_id` (FK companies), `api_source_id` (FK external_api_sources), `enabled`, `polling_frequency`, `priority`, `daily_limit`, `signal_limit`, `purposes` (jsonb), `include_filters` (jsonb), `exclude_filters` (jsonb), `created_at`, `updated_at`.
  - Unique on `(company_id, api_source_id)`.
  - Check constraints: `polling_frequency` in `('realtime','2h','6h','daily','weekly')`, `priority` in `('HIGH','MEDIUM','LOW')`.
  - Indexes: `company_id`, `api_source_id`, `(company_id, enabled)` where `enabled = true`.

### Extended

- **`database/external_api_requests_workflow.sql`**
  - `external_api_source_requests`: added `company_id` (FK companies), `approved_by_admin_at`, `sent_to_super_admin_at`.
  - Default `status` set to `'pending_admin_review'`.
  - Optional CHECK: `status` in `pending_admin_review`, `approved_by_admin`, `sent_to_super_admin`, `approved`, `rejected`, `pending` (keeps existing `pending` valid).
  - New columns for Request New API form: `provider`, `connection_type`, `documentation_url`, `sample_response`.
  - Index on `company_id`.

**Apply order:** run `external-api-sources.sql` and `external-api-requests.sql` first, then `company_api_configs.sql`, then `external_api_requests_workflow.sql`.

---

## 2. Updated API endpoints

### New

- **`pages/api/external-apis/company-config.ts`**
  - **GET** `?companyId=&api_source_id=` (optional): returns one config and `allowed_polling`; without `api_source_id` returns all configs for the company and `allowed_polling`.
  - **PUT** body: `companyId`, `api_source_id`, `enabled`, `purposes`, `include_filters`, `exclude_filters`, `polling_frequency`, `daily_limit`, `signal_limit`, `priority`. Validates polling against company plan (via `companyApiConfigService`). Upserts into `company_api_configs`.

### Modified

- **`pages/api/external-apis/requests.ts`**
  - POST create: `status` set to `'pending_admin_review'` (was `'pending'`).
  - POST body accepts and persists: `provider`, `connection_type`, `documentation_url`, `sample_response`.

- **`pages/api/external-apis/requests/[id].ts`**
  - PUT body accepts `action` (or `status`): `approve_by_admin`, `send_to_super_admin`, `approve`, `reject` (and legacy `approved`/`rejected`).
  - `approve_by_admin`: sets `status = 'approved_by_admin'`, `approved_by_admin_at = now()` (company admin).
  - `send_to_super_admin`: sets `status = 'sent_to_super_admin'`, `sent_to_super_admin_at = now()` (company admin).
  - `approve`: creates source via `saveTenantPlatformConfig`, sets `status = 'approved'`, `approved_at`, `approved_by_user_id` (super admin).
  - `reject`: sets `status = 'rejected'`, `rejection_reason`, `rejected_at`.

---

## 3. UI components added

- **Tabs** on External API Access page: Global Preset APIs | Request New API | Approval Queue | Usage Analytics.
- **Company API configuration modal** (when enabling or editing a preset):
  - Purpose (multi-select): trend_campaign_detection, market_pulse_signals, competitor_intelligence, market_news, influencer_signals, technology_signals, keyword_intelligence.
  - Include filters / Exclude filters (JSON textareas).
  - Polling frequency (dropdown; options restricted by plan via `allowed_polling`).
  - Daily limit, Signal limit (optional numbers).
  - Priority: HIGH / MEDIUM / LOW.
  - Save: PUT company-config then POST access with `is_enabled: true`.
- **Global Presets section** (Presets tab): list of presets with **Enable** and **View / Edit config** opening the config modal; enabled state from `companyDefaultApis`.
- **Approval Queue tab**: list of requests with status badges (pending_admin_review, approved_by_admin, sent_to_super_admin, approved, rejected). Company admin actions: **Approve** (`approve_by_admin`), **Send to Super Admin** (`send_to_super_admin`), **Reject** (with optional reason).
- **Usage Analytics tab**: per-API metrics from `external_api_usage`: total requests, success, failed, success rate, usage over time (last 14 days).

---

## 4. Files modified

| File | Changes |
|------|--------|
| `database/company_api_configs.sql` | New table and indexes. |
| `database/external_api_requests_workflow.sql` | New migration: request workflow columns + request form columns. |
| `backend/services/companyApiConfigService.ts` | New: `getAllowedPollingForCompany`, `isPollingAllowedForCompany` (plan-based polling rules: basic → daily/weekly, pro → 6h/daily/weekly, enterprise → realtime/2h/6h/daily). |
| `pages/api/external-apis/company-config.ts` | New GET/PUT handler for company API config. |
| `pages/api/external-apis/requests.ts` | POST status `pending_admin_review`; accept and store provider, connection_type, documentation_url, sample_response. |
| `pages/api/external-apis/requests/[id].ts` | PUT accepts `action`; implements approve_by_admin, send_to_super_admin, approve, reject with timestamps. |
| `pages/external-apis-access.tsx` | Tabs; config modal state and save; Global Presets Enable/Configure; Request form (provider, connection_type, documentation_url, sample_response); Approval Queue with actions; Usage Analytics tab; `pending_admin_review` in pending set. |

---

## 5. Conflicts and notes

- **Existing `external_api_source_requests.status`:** Values may still be `'pending'`. Migration CHECK allows `'pending'` so existing rows remain valid; new submissions use `'pending_admin_review'`. UI and API support both.
- **Plan resolution:** Polling validation uses `resolveOrganizationPlanLimits(companyId)` (company ID used as organization ID). If your `organization_plan_assignments` table uses a different organization key, adjust `companyApiConfigService` or pass the correct ID.
- **Access POST in config save:** Saving the company config modal also calls the existing access API to set `is_enabled: true` for that API so the rest of the app (and default APIs list) stays in sync. No change to intelligence polling worker or signal pipeline.
- **Not modified (as requested):** `intelligencePollingWorker`, `trendProcessingService`, `signalClusterEngine`, strategic theme generation, campaign generation. Configuration only affects which sources are available; it does not change the signal pipeline logic.

---

## Quick test checklist

1. Run migrations in order; confirm `company_api_configs` and new/updated columns on `external_api_source_requests`.
2. Company page: open Global Preset APIs → Enable or Configure a preset → set purpose, filters, polling, limits, priority → Save; confirm config in `company_api_configs` and API in company defaults.
3. Request New API: submit with Provider, Connection type, Documentation URL, Sample response; confirm row with `status = 'pending_admin_review'`.
4. Approval Queue: as company admin, Approve / Send to Super Admin / Reject; confirm status and timestamps. As super admin, Approve or Reject; confirm `approved_at` or `rejected_at`.
5. Usage Analytics: confirm metrics and 14-day usage for configured APIs.
6. Polling: set a frequency not allowed for the company plan and try Save; expect 400 and `allowed_polling` in response.
