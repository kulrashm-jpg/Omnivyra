# Recommendations / “Generate Strategic Themes” — Why 403 (Forbidden) & Inputs

## When does “Forbidden” (403) happen?

The **Generate Strategic Themes** flow calls **POST `/api/recommendations/generate`**. A 403 can come from three places, in order:

### 1. RBAC (runs first)

The handler is wrapped with `withRBAC(handler, [Role.COMPANY_ADMIN, Role.CONTENT_CREATOR])`.

- **403 `COMPANY_SCOPE_VIOLATION`**  
  User has no access to the **company** in the request (companyId from body or query).  
  So: wrong or inaccessible company, or user not in that company.

- **403 `FORBIDDEN_ROLE`**  
  - No authenticated user / no role for that company, or  
  - User’s role for that company is **not** COMPANY_ADMIN or CONTENT_CREATOR.  
  So: only COMPANY_ADMIN and CONTENT_CREATOR are allowed to generate recommendations.

**Files:** `backend/middleware/withRBAC.ts` → `backend/services/rbacService.ts` (`enforceRole`).

### 2. Company access

After RBAC, the handler calls `enforceCompanyAccess({ req, res, companyId, campaignId?, requireCampaignId: false })`.

- **403 `Access denied to company`**  
  User’s `companyIds` does not include the requested `companyId` (and not allowed via invited admin).  
  So: user is not a member of that company.

**File:** `backend/services/userContextService.ts` (`enforceCompanyAccess`).

### 3. Campaign–company link (only if `campaignId` is sent)

If the request body includes a non‑empty **`campaignId`**, the API checks that this campaign belongs to the company:

- It looks up **`campaign_versions`** for `company_id = companyId` and `campaign_id = resolvedCampaignId`.
- If there is **no** such row → **403 `CAMPAIGN_NOT_IN_COMPANY`**.

So: “Forbidden” here means the **campaign does not belong to the company** (wrong campaign, wrong company, or campaign not linked in `campaign_versions`).

**File:** `pages/api/recommendations/generate.ts` (lines 52–64).

The same error can be re‑thrown from inside `generateRecommendations` and caught in the handler (lines 397–398).

---

## Summary: what to check when you see 403

| Response body / meaning              | Likely cause |
|-------------------------------------|--------------|
| `FORBIDDEN_ROLE`                    | User not COMPANY_ADMIN or CONTENT_CREATOR for that company, or not logged in / no role. |
| `COMPANY_SCOPE_VIOLATION`           | User has no access to the company (companyId). |
| `Access denied to company`         | User not in that company (enforceCompanyAccess). |
| `CAMPAIGN_NOT_IN_COMPANY`          | A `campaignId` was sent and that campaign is not linked to the company in `campaign_versions`. |

**Note:** The **Trend** tab (“Generate Strategic Themes”) does **not** send `campaignId` in the request. So `CAMPAIGN_NOT_IN_COMPANY` only applies when the client **does** send `campaignId` (e.g. from the main recommendations page with a selected campaign).

---

## Inputs used to create theme options (recommendations)

### API: POST `/api/recommendations/generate`

**Request body:**

| Input               | Required | Description |
|---------------------|----------|-------------|
| **companyId**       | Yes      | Company for which to generate recommendations. |
| **regions**         | No       | Array of region codes or comma‑separated string. Empty = use profile geography. |
| **campaignId**      | No       | If set, must exist in `campaign_versions` for this company; used for context. |
| **enrichmentEnabled** | No    | Default true. If false, use only stored company profile (no website/social enrichment). |
| **objective**       | No       | Campaign objective (e.g. brand_awareness, lead_generation). |
| **durationWeeks**   | No       | Plan duration in weeks (e.g. 12). |
| **simulate**        | No       | Simulate scenarios. |
| **chat**            | No       | Enable chat/context callback. |
| **selected_api_ids**| No       | External API IDs to use. If omitted, company default APIs are used. |
| **manual_context** | No       | Object with manual context (e.g. opportunity). |
| **strategicPayload**| No       | Object with context mode, offerings, aspect, text, focus, etc. (see below). |

**Where it’s used:**  
- `companyId` → access check and engine.  
- `strategicPayload` → passed to `generateRecommendations` and used for context/prompts (not ranking).  
- Strategy history is loaded by **company** via `getStrategyHistoryForCompany(companyId)` and passed as `strategyMemory` (context only).

---

### Strategic payload (theme/strategy context)

Used when generating themes from the **Trend** tab and elsewhere when `strategicPayload` is sent.  
Built in `TrendCampaignsTab` in `buildStrategicPayload()` and sent as **`strategicPayload`** in the generate request.

| Field                     | Source / meaning |
|---------------------------|------------------|
| **context_mode**          | FULL / FOCUSED / NONE. |
| **company_context**       | From company profile when context_mode is FULL: brand_voice, ideal_customer_profile, brand_positioning, content_themes, geography. |
| **selected_offerings**    | Selected offering facet IDs. |
| **selected_aspect**       | Selected strategic aspect. |
| **strategic_text**        | Free‑text strategic direction. |
| **strategic_intents**     | Labels from campaign focus (primary + secondaries). |
| **regions**               | Resolved ISO region codes from region input. |
| **cluster_inputs**       | Optional cluster payload (e.g. from pulse/cluster flow). |
| **focused_modules**      | When context_mode is FOCUSED: chosen focus modules. |
| **additional_direction**  | Extra direction text. |
| **primary_campaign_type** | Primary campaign type (e.g. brand_awareness, third_party). |
| **secondary_campaign_types** | Secondary campaign type IDs. |
| **context**               | business / personal / third_party. |
| **mapped_core_types**     | Core types derived from primary + secondaries for the engine. |

**Objective** sent to the API is derived from the payload when possible (e.g. first `mapped_core_types`, or primary type, or `brand_awareness`).

---

### Engine input (internal)

`generateRecommendations()` in `backend/services/recommendationEngineService.ts` receives:

- **companyId**, **campaignId** (optional), **userId**
- **objective**, **durationWeeks**, **simulate**
- **selectedApiIds** (or company defaults), **regions**, **enrichmentEnabled**
- **strategicPayload** (optional) — context/prompts only
- **strategyMemory** (optional) — from `getStrategyHistoryForCompany(companyId)`; context only (e.g. continuation/expansion), no ranking change

Company profile, external APIs, strategy history, and campaign memory are all resolved server‑side from **companyId** (and **campaignId** when provided).

---

## Quick checklist if “Generate Strategic Themes” returns 403

1. User is logged in and has **COMPANY_ADMIN** or **CONTENT_CREATOR** for the selected company.
2. Selected **companyId** is one the user can access (user is member of that company).
3. If the client sends **campaignId**, that campaign must exist in **campaign_versions** for that **companyId** (Trend tab does not send campaignId).

Inspecting the API response body (`error` field) will show which of the above failed (`FORBIDDEN_ROLE`, `COMPANY_SCOPE_VIOLATION`, `Access denied to company`, or `CAMPAIGN_NOT_IN_COMPANY`).
