# Content Architect — Access Scope

**Role:** Content Architect is a credential-based role (like Super Admin). They are **not** in the company team (`user_company_roles`). They log in from the Super Admin login page with env credentials and have **access to all companies** (view any company, create new company profiles, and access any company’s campaigns and weekly/daily plans via search and selection).

**View level:** Content Architect has **full view** of all details (company profile, campaigns, weekly plans, daily plans). Company Admin and other roles have a **limited view** that will be customized per role.

---

## 1. How Content Architect logs in

Content Architect uses the **same entry point** as Super Admin: the Super Admin login page (`/super-admin/login`), with **credentials stored in `.env.local`** (like `SUPER_ADMIN_USERNAME` / `SUPER_ADMIN_PASSWORD`).

### Option A — Single Content Architect (one company per env)

- **Env vars** (add to `.env.local`; same pattern as Super Admin):
  - `CONTENT_ARCHITECT_USERNAME` — e.g. `contentarchitect`
  - `CONTENT_ARCHITECT_PASSWORD` — password
  - `CONTENT_ARCHITECT_COMPANY_ID` — the single company this login is scoped to (UUID from `companies.id`)
- **Login flow:**
  1. User goes to `/super-admin/login`.
  2. Page has a **mode toggle**: “Sign in as **Super Admin**” vs “Sign in as **Content Architect**” (or a separate “Content Architect” link that goes to the same page with `?mode=content-architect`).
  3. They enter username and password. Frontend sends to either:
     - `POST /api/super-admin/login` (Super Admin), or  
     - `POST /api/super-admin/content-architect-login` (Content Architect).
  4. **Content Architect login API** (new):
     - Reads `CONTENT_ARCHITECT_USERNAME`, `CONTENT_ARCHITECT_PASSWORD`, `CONTENT_ARCHITECT_COMPANY_ID` from env.
     - If credentials match, sets **two cookies** (HttpOnly, SameSite=Lax, Path=/, e.g. Max-Age=86400):
       - `content_architect_session=1`
       - `content_architect_company_id=<CONTENT_ARCHITECT_COMPANY_ID>`
     - Returns 200; frontend redirects to Content Architect landing (e.g. `/company-profile?companyId=<id>` or a dedicated `/content-architect` hub that shows company profile + campaign health for that company).
  5. **Super Admin login** stays as today: same endpoint, `super_admin_session=1` only; redirect to `/super-admin/dashboard`.

So: **one** Content Architect login per env, tied to **one** company. To support multiple Content Architects (one per company), use Option B or multiple env sets (e.g. separate deploy per architect).

### Option B — Multiple Content Architects (e.g. one per company)

- Env could hold a **list** (e.g. JSON or repeated vars), e.g.  
  `CONTENT_ARCHITECT_CREDENTIALS='[{"username":"arch1","password":"...","companyId":"uuid1"},...]'`
- Login API checks username/password against that list; if found, sets the same two cookies with the matching `companyId`.
- Same cookie names; backend resolves “Content Architect for company X” from `content_architect_company_id`.

### What the frontend needs

- On `/super-admin/login`: **toggle or link** to choose “Super Admin” vs “Content Architect”.
- When “Content Architect” is selected, submit to the Content Architect login endpoint (e.g. `POST /api/super-admin/content-architect-login` with `{ username, password }`).
- On success, redirect to the Content Architect experience (company profile for their company, or a hub that links to company profile + campaign health), **not** to `/super-admin/dashboard`.

### Middleware / API recognition

- **Middleware** (`middleware.ts`): allow requests that have `content_architect_session=1` (and optionally `content_architect_company_id`) to hit **only** the APIs and routes that Content Architect is allowed to use (company-profile, content-architect campaign-health, campaigns for that company, recommendations, activity-workspace). Do **not** allow them to hit `/api/super-admin/*` (except the login endpoint used for Content Architect, if it lives under that path).
- **Backend** (company-profile, campaigns, etc.): in addition to Supabase user + company, treat request as “Content Architect for company X” when `req.cookies.content_architect_session === '1'` and `req.cookies.content_architect_company_id === '<companyId>'`; then allow the same read/write as Company Admin for that company (for the scoped APIs only).

### Summary

| Who | Login page | Env vars | Cookie(s) | Redirect after login |
|-----|------------|----------|-----------|------------------------|
| Super Admin | `/super-admin/login` | `SUPER_ADMIN_USERNAME`, `SUPER_ADMIN_PASSWORD` | `super_admin_session=1` | `/super-admin/dashboard` |
| Content Architect | Same page, “Content Architect” mode | `CONTENT_ARCHITECT_USERNAME`, `CONTENT_ARCHITECT_PASSWORD`, `CONTENT_ARCHITECT_COMPANY_ID` | `content_architect_session=1`, `content_architect_company_id=<id>` | Company profile or Content Architect hub for that company |

---

## 2. Entry points (how they reach content)

| Area | Entry | Notes |
|------|--------|------|
| **Company profile** | Company page | Content Architect lands on or navigates to the company page for their assigned company; from there they access company profile (setup, details, completeness). |
| **Campaigns** | Campaign health | Access to campaigns is via a **campaign health** view scoped to their company (same data shape as Super Admin “Campaign Health” but filtered to their single company). From there they can open individual campaigns. |

So:
- **Company profile** → via **company page** (e.g. `/company-profile?companyId=<assigned>` or a dedicated Content Architect “company” landing that routes to company profile).
- **Campaigns** → via **campaign health** (company-scoped list/summary), then drill into campaign → recommendations, weekly plan, activity workspace.

---

## 3. Pages and routes — full details

Content Architect must see the following **with full details** (no redaction, same data as Company Admin for that company):

| # | Page / route | Purpose |
|---|----------------|--------|
| 1 | **Company page → Company profile** | `/company-profile` with `companyId` = assigned company. Full profile: target customer, campaign purpose, marketing intelligence, problem transformation, refinements, completeness, all company-profile APIs. |
| 2 | **Campaign health (company-scoped)** | A view equivalent to Super Admin “Campaign Health” but filtered to one company: campaign list, status, reapproval, strategy status, etc. Source: e.g. `/api/super-admin/campaign-health` scoped by company or a dedicated Content Architect campaign-health API. |
| 3 | **Detailed recommendation page** | `/campaigns/[id]/recommendations` for campaigns in their company. Full recommendation list, states, preview strategy, merge, etc. |
| 4 | **Weekly plan page** | `/campaign-daily-plan/[id]` for campaigns in their company. Full weekly/daily structure, themes, activities, regenerate, links to activity workspace. |
| 5 | **Activity workspace** | `/activity-workspace` with `workspaceKey` (e.g. from campaign daily plan or campaign details). Full activity content, threads, composer, all activity workspace APIs. |

All of the above must be **full detail** (same as COMPANY_ADMIN for that company): no reduced or “summary-only” views for Content Architect.

---

## 4. API coverage (backend)

APIs that must allow Content Architect when `companyId` matches their assigned company (and only then):

- **Company profile**
  - `GET/PATCH /api/company-profile` (and all sub-routes: refinements, define-target-customer, define-campaign-purpose, define-marketing-intelligence, problem-transformation, refine, generate-marketing-intelligence, completeness, etc.) — allow when request is Content Architect for that `companyId`.
- **Campaign health (company-scoped)**
  - Either allow Content Architect to call existing super-admin campaign-health API with a company filter, or add a dedicated endpoint (e.g. `/api/content-architect/campaign-health` or `/api/campaigns/health?companyId=`) that returns the same shape as super-admin campaign health for one company.
- **Campaigns**
  - All campaign read/strategy APIs used by the above pages, for campaigns whose `company_id` = Content Architect’s company: e.g. `/api/campaigns/[id]`, `/api/campaigns/[id]/recommendations`, `/api/campaigns/get-weekly-plans`, `/api/campaigns/[id]/strategy-status`, etc. Allow when request is Content Architect and campaign belongs to their company.
- **Recommendations**
  - `/api/recommendations/*` and `/api/campaigns/[id]/recommendations`, `/api/recommendations/[id]/preview-strategy`, etc. — allow for Content Architect when the recommendation/campaign is in their company.
- **Activity workspace**
  - `/api/activity-workspace/content` and any other activity workspace APIs — allow when the workspace’s campaign (derived from `workspaceKey` or context) belongs to Content Architect’s company.

Content Architect must **not** have access to:
- Super-admin-only APIs (RBAC config, platform-wide analytics, user management, audit logs, etc.) unless explicitly added later.

**Full view vs limited view:** Content Architect sees **all details** (company profile, campaigns, weekly/daily plans, activity workspace) for any company they select. Company Admin and other roles see a **limited view** (to be customized per role) so that only relevant sections and actions are visible.

---

## 5. Content Architect hub (search by ID)

A dedicated hub at **`/content-architect`** lets Content Architect search and open by **unique ID**:

- **Search:** Every company has a **company ID** and can be accessed by **ID**, **name**, or **website URL**. Search supports: **company ID**, **company name**, or **company URL**; **campaign ID** or **campaign name**; **recommendation ID** or trend topic (GET `/api/content-architect/search?q=`). Returns `companies`, `campaigns`, and `recommendations` (each recommendation has `id`, `campaign_id`, `company_id`, `trend_topic`).
- **Tabs** (after selecting a company, campaign, or recommendation):
  - **Company profile** — open company profile (unique key: `company_id`).
  - **Recommendation cards** — open campaign recommendations; when a recommendation was selected by ID, the link includes `recommendationId` for direct access. Unique key per card: `recommendation_snapshots.id` (UUID).
  - **Weekly plan** — open weekly/daily plan (unique key: `campaign_id`). Optional `?week=N` in the URL opens a specific week by ID.
  - **Activity workspace** — each daily activity (master content and repurpose content) has a unique ID. Open by:
    - **workspaceKey:** `activity-workspace-{campaignId}-{execution_id}` in the URL (`/activity-workspace?workspaceKey=...`), or
    - **campaignId + executionId:** `/activity-workspace?campaignId=...&executionId=...` (payload is resolved from the campaign plan via GET `/api/activity-workspace/resolve` when sessionStorage is empty).

**Unique IDs:** Companies use `company_id` (UUID), campaigns use `id` (UUID), recommendations use `id` (UUID, from `recommendation_snapshots`), weekly plan is identified by `campaign_id` (+ optional `week` number), and activity workspaces use `workspaceKey` or the pair `(campaignId, execution_id)`. All are generated and stored so Content Architect can search and open by ID.

## 6. Access via search and create (company profile page)

- **View any company:** Content Architect can select any company from the list on the company profile page (search/filter by name) and view or refine that company’s profile.
- **Create company profile:** Content Architect can create a new company (name, website, industry) from the company profile page; the new company is then available in the list and can be refined.
- **Access campaigns and plans:** From the company profile page, “View campaigns & weekly/daily plans” opens the campaigns list for the selected company; from there they can open campaign details, weekly plans, and daily plans (full view).

---

## 7. Summary table

| Area | Entry | Page / route | Full details |
|------|--------|----------------|--------------|
| Company profile | Company page | `/company-profile` + all company-profile APIs | Yes |
| Campaigns | Campaign health | Company-scoped campaign health → campaign list → campaign detail | Yes |
| Recommendations | From campaign | `/campaigns/[id]/recommendations` | Yes |
| Weekly plan | From campaign | `/campaign-daily-plan/[id]` | Yes |
| Activity workspace | From weekly plan / campaign | `/activity-workspace?workspaceKey=...` | Yes |

This document defines the **scope** of Content Architect access and the **login flow** (same page as Super Admin, env credentials, cookie session; see §1). Content Architect has **all companies** access (no single-company restriction).
