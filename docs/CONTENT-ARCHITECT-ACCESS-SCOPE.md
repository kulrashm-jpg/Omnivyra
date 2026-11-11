# Content Architect — Access Scope

**Role:** Content Architect is a platform role that authenticates with a **canonical session** (`auth_session`, the same mechanism as every other user). Authorization comes from the principal's capabilities (`CONTENT_ARCHITECT_WRITE`, which includes `CONTENT_ARCHITECT_READ`) and from its **active** `CONTENT_ARCHITECT` memberships in `user_company_roles`.

**View level:** Content Architect has **full view** of the companies it holds an active membership in (company profile, campaigns, weekly plans, daily plans). Company Admin and other roles have a **limited view** that will be customized per role.

> **REMOVED 2026-11-11 - the cookie path.** Earlier versions of this document described two cookies, `content_architect_session` and `content_architect_company_id`, and an env var `CONTENT_ARCHITECT_COMPANY_ID`. All three are gone, and they must not be revived:
> - `content_architect_session` was an unsigned `=1` until SEC-001A, then a signed bridge cookie that hard-expired on 2026-08-05 (`LEGACY_BRIDGE_HARD_EXPIRY_AT`). It has granted nothing since August; its readers were deleted in e9 (C).
> - `content_architect_company_id` was never signed, session-bound or expiring, and `/api/company-profile?mode=list` answered from it **before authentication** - an unauthenticated cross-tenant read (fixed in `fix/company-profile-architect-cookie-20261111`). SEC-001A hardened the first cookie and missed this sibling.
> - `CONTENT_ARCHITECT_COMPANY_ID` only fed that cookie. It does nothing now; remove it from env files.
>
> The login endpoint still CLEARS both cookies, so a browser holding an old (or attacker-set) value is cleaned up on the next login. If the feature looks broken, fix the canonical path below - do not reintroduce a cookie reader.

---

## 1. How Content Architect logs in

Same entry page as Super Admin (`/super-admin/login`, Content Architect mode), endpoint `POST /api/super-admin/content-architect-login`.

- **Env vars:**
  - `CONTENT_ARCHITECT_USERNAME`, `CONTENT_ARCHITECT_PASSWORD` - the login credentials (compared in constant time).
  - `CONTENT_ARCHITECT_PRIMARY_USER_ID` - the canonical `users.id` of the architect. That user must exist, not be deleted, and hold an **active** `CONTENT_ARCHITECT` row in `user_company_roles`.
- **Login flow:**
  1. Credentials match, so the endpoint looks up the primary user and mints a canonical `auth_session` for it (`SessionAuthorityService.createSession`).
  2. It clears `content_architect_session`, `content_architect_company_id` and `super_admin_session`.
  3. **If no canonical session can be minted** (no primary user id, user missing or deleted, no active CONTENT_ARCHITECT membership), the login **fails closed with 503 `CANONICAL_SESSION_UNAVAILABLE`**. There is no cookie fallback.
- **Super Admin** works the same way (`POST /api/super-admin/login`, `SUPER_ADMIN_PRIMARY_USER_ID` with an active `SUPER_ADMIN` membership); without a canonical session it also returns 503.

### Which companies a Content Architect reaches

- **Company-scoped routes** (company profile, campaigns, activity workspace, market pulse, ...) authorize through the normal company check (`resolveCompanyAccess` / `enforceCompanyAccess`): the architect reaches a company only through an **active membership** in it.
- **Cross-company search** (`GET /api/content-architect/search`) requires `CONTENT_ARCHITECT_READ` on the canonical principal.
- There is **no** "all companies by cookie" access any more. To give an architect a company, grant an active `CONTENT_ARCHITECT` membership in it.

### Summary

| Who | Login endpoint | Env vars | Session | Without a canonical session |
|-----|----------------|----------|---------|----------------------------|
| Super Admin | `POST /api/super-admin/login` | `SUPER_ADMIN_USERNAME`, `SUPER_ADMIN_PASSWORD`, `SUPER_ADMIN_PRIMARY_USER_ID` | canonical `auth_session` | 503, no cookie |
| Content Architect | `POST /api/super-admin/content-architect-login` | `CONTENT_ARCHITECT_USERNAME`, `CONTENT_ARCHITECT_PASSWORD`, `CONTENT_ARCHITECT_PRIMARY_USER_ID` | canonical `auth_session` | 503, no cookie |

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

**Full view vs limited view:** Content Architect sees **all details** (company profile, campaigns, weekly/daily plans, activity workspace) for every company they hold an active membership in. Company Admin and other roles see a **limited view** (to be customized per role) so that only relevant sections and actions are visible.

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

- **View a company:** Content Architect can select any company it is a member of from the list on the company profile page (search/filter by name) and view or refine that company’s profile.
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

This document defines the **scope** of Content Architect access and the **login flow** (same page as Super Admin, env credentials, canonical session; see §1). Content Architect reaches the companies it holds an **active** CONTENT_ARCHITECT membership in, plus cross-company search via CONTENT_ARCHITECT_READ.
