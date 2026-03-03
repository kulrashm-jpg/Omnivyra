# Campaign-Level RBAC — Architecture Preparation

**Goal:** Add layered access with **Level 1 (company roles)** and **Level 2 (campaign roles)** without implementing full migration, changing UI, or changing business logic.

**Naming (senior-level recommendation):** Do **not** call the campaign-level “manager” role **Content Manager** internally. Use **CAMPAIGN_OPERATOR** so that later: managers, reviewers, schedulers can all merge into this role naturally.

**Reference:** [AUTH-AND-ACCESS-ANALYSIS.md](./AUTH-AND-ACCESS-ANALYSIS.md), [AUTH-IMPLEMENTATION-PLAN.md](./AUTH-IMPLEMENTATION-PLAN.md)

---

## 1. Current Structure Analysis

### 1.1 user_company_roles Usage

| Location | Usage |
|----------|--------|
| **Schema** | `database/user-company-roles.sql`: `(user_id, company_id, role, status, name, invited_at, accepted_at, deactivated_at, updated_at)`. No `campaign_id`. |
| **Backend** | `rbacService.getUserRole(userId, companyId)` and `getUserCompanyRole(req, companyId)` read from `user_company_roles` filtered by `user_id`, `company_id`, `status = 'active'`. |
| **Backend** | `userContextService.resolveUserContext(req)` loads all active rows for the user and builds `companyIds`, binary `role: 'admin'|'user'`. |
| **Backend** | `userManagementService` and `pages/api/company/users*.ts` CRUD on `user_company_roles` for invite/role update/remove. |
| **Frontend** | `CompanyContext.tsx` loads `user_company_roles` (active) and builds `companies`, `userRole` per selected company, `rolesByCompany`. |
| **APIs** | All campaign and content APIs that need “who can do what” use **company only**: they take or resolve `companyId`, then call `getUserRole(userId, companyId)` or `enforceCompanyAccess(req, res, companyId)` and optionally `hasPermission(companyRole, action)`. |

**Conclusion:** Today every permission is **company-scoped**. There is no campaign-scoped role table or check.

### 1.2 Campaign Ownership Model

| Entity | Table(s) | Ownership / scope |
|--------|----------|--------------------|
| **Campaign** | `campaigns` | `id`, `user_id` (creator), no `company_id` on core tables in most schemas. |
| **Company scope of a campaign** | `campaign_versions` | `campaign_id`, `company_id` — the **company** that “owns” a campaign is defined by the version. So campaign → company is **campaign_versions.company_id** for that campaign_id. |
| **Resolving company from campaign** | API pattern | `resolveCampaignCompanyId(campaignId)` or `getCompanyId(campaignId)` queries `campaign_versions` where `campaign_id = campaignId`, returns `company_id`. |

**Conclusion:** Campaigns are tied to a company only via `campaign_versions`. Access today is “user has a company role in the company that owns the campaign” — no notion of “user has a role on this specific campaign.”

### 1.3 How Campaign APIs Currently Resolve Permissions

Two patterns:

1. **Request carries companyId**  
   - Example: `campaigns/list`, `campaigns/index`, `scheduler-payload`, `content/generate-day`.  
   - Flow: Read `companyId` from query/body → `enforceCompanyAccess(req, res, companyId)` and/or `requireCompanyRole(req, res, companyId, userId, allowedRoles)` or `withRBAC(handler, allowedRoles)` (which requires companyId).  
   - Permission = **company role only** (from `user_company_roles`).

2. **Request carries campaignId; company resolved from DB**  
   - Example: `campaigns/[id]`, `campaigns/[id]/commit-plan`, `campaigns/[id]/progress`, `campaigns/[id]/approve-strategy`, etc.  
   - Flow: Get `companyId = await getCompanyId(campaignId)` (from `campaign_versions`) → `getUserRole(user.id, companyId)` or `enforceCompanyAccess(..., companyId)`.  
   - Permission = **company role only**; campaign is only used to find company.

No API currently checks a “role on this campaign.” All assume “if you have the right company role, you have the same access to every campaign in that company.”

---

## 2. Where Campaign-Level Access Is Assumed from Company Roles

### 2.1 Assumptions Today

- **Any user with a company role** (e.g. CONTENT_CREATOR, CONTENT_REVIEWER, COMPANY_ADMIN) that grants VIEW_CAMPAIGNS or CREATE_CAMPAIGN **can access all campaigns** under that company.
- **CONTENT_MANAGER** (company-level in `user_company_roles`) is normalized to CONTENT_CREATOR in `rbacService`; it is treated as a **company-wide** content role, not campaign-scoped.
- Content and scheduling APIs (e.g. `content/generate-day`, `content/approve`, `content/reject`, `campaigns/scheduler-payload`, `campaigns/optimize-week`) take `companyId` + `campaignId` but only enforce **company membership and company role**. So a company Content Creator can operate on every campaign in the company.

### 2.2 APIs That Need Campaign-Context Permission Checks (Later)

These APIs are **candidate for campaign-role checks** once `campaign_user_roles` exists. Today they use only company role.

| API path | Current check | Campaign context |
|----------|----------------|-------------------|
| `GET/PUT/DELETE /api/campaigns/[id]` | withRBAC(ALL_ROLES) + company from campaign | Yes — single campaign |
| `POST /api/campaigns/commit-daily-plan` | enforceCompanyAccess + body campaignId | Yes |
| `GET /api/campaigns/[id]/progress` | enforceCompanyAccess + companyId | Yes |
| `POST /api/campaigns/scheduler-payload` | enforceCompanyAccess(companyId) | Yes — campaignId in body |
| `POST /api/campaigns/optimize-week` | enforceCompanyAccess | Yes — campaignId |
| `POST /api/campaigns/[id]/approve-strategy` | getUserRole(companyId) | Yes |
| `POST /api/campaigns/[id]/reject-frequency-rebalance` | getUserRole(companyId) | Yes |
| `POST /api/campaigns/[id]/approve-frequency-rebalance` | getUserRole(companyId) | Yes |
| `POST /api/campaigns/[id]/propose-frequency-rebalance` | getUserRole(companyId) | Yes |
| `POST /api/campaigns/[id]/commit-plan` | enforceCompanyAccess | Yes |
| `GET /api/campaigns/[id]/strategy-status` | getUserRole(companyId) | Yes |
| `GET /api/campaigns/[id]/reapproval-status` | getUserRole(companyId) | Yes |
| `GET/POST /api/campaigns/[id]/ai-improvements` | getUserRole(companyId) | Yes |
| `GET /api/campaigns/[id]/viral-topic-memory` | getUserRole(companyId) | Yes |
| `GET /api/campaigns/[id]/platform-allocation-advice` | getUserRole(companyId) | Yes |
| `GET /api/campaigns/[id]/momentum-amplifier` | getUserRole(companyId) | Yes |
| `GET /api/campaigns/[id]/lead-conversion-intelligence` | getUserRole(companyId) | Yes |
| `GET /api/campaigns/[id]/forecast-vs-actual` | getUserRole(companyId) | Yes |
| `GET /api/campaigns/[id]/optimization-advice` | getUserRole(companyId) | Yes |
| `GET /api/campaigns/[id]/revise-strategy` | getUserRole(companyId) | Yes |
| `POST /api/campaigns/[id]/merge-recommendations` | enforceCompanyAccess | Yes |
| `GET /api/campaigns/[id]/recommendations` | enforceCompanyAccess | Yes |
| `POST /api/campaigns/regenerate-blueprint` | enforceCompanyAccess | Yes |
| `POST /api/campaigns/run-preplanning` | enforceCompanyAccess | Yes |
| `POST /api/campaigns/execute-preemption` | enforceCompanyAccess | Yes |
| `POST /api/campaigns/approve-preemption` | enforceCompanyAccess | Yes |
| `POST /api/campaigns/reject-preemption` | enforceCompanyAccess | Yes |
| `POST /api/campaigns/negotiate-duration` | enforceCompanyAccess | Yes |
| `POST /api/campaigns/suggest-duration` | enforceCompanyAccess | Yes |
| `POST /api/campaigns/update-duration` | enforceCompanyAccess | Yes |
| `POST /api/content/generate-day` | enforceCompanyAccess + companyId, campaignId in body | Yes |
| `GET /api/content/list` | enforceCompanyAccess + campaignId in query | Yes |
| `POST /api/content/approve` | withRBAC (company) | Could be campaign-scoped |
| `POST /api/content/reject` | withRBAC (company) | Could be campaign-scoped |
| `POST /api/content/regenerate` | withRBAC (company) | Could be campaign-scoped |
| `GET /api/campaigns/list` | requireCompanyRole(companyId) | List filtered by company; items could later be filtered by campaign role |
| `POST /api/campaigns/index` (create) | requireCompanyRole + hasPermission(CREATE_CAMPAIGN) | Company-level create; who can be assigned to campaign is separate |

### 2.3 Where CONTENT_MANAGER Behaves Like a Company-Wide Role

| Location | Behavior |
|----------|----------|
| **rbacService** | `CONTENT_MANAGER` → normalized to `CONTENT_CREATOR` in `normalizePermissionRole` and `normalizeRole`. So any permission that allows CONTENT_CREATOR also allows CONTENT_MANAGER. |
| **user_company_roles** | Role value stored as string (e.g. `CONTENT_MANAGER`). So CONTENT_MANAGER is a **company-level** role today. |
| **Frontend** | `CompanyContext` normalizes CONTENT_MANAGER → CONTENT_CREATOR. `recommendations.tsx` and `admin/users.tsx` list CONTENT_MANAGER as an option. |
| **APIs** | content/approve, content/reject, content/generate-day, content/regenerate, campaigns/list use Role.CONTENT_MANAGER in allowedRoles; backend treats it as CONTENT_CREATOR for permissions. |

**Conclusion:** CONTENT_MANAGER is today a company-wide alias for CONTENT_CREATOR. For **campaign-level** roles we do **not** introduce “Content Manager” as a name internally; we use **CAMPAIGN_OPERATOR** so one campaign-scoped role can later subsume “manager,” “reviewer,” “scheduler” semantics.

---

## 3. Minimal Extension: campaign_user_roles

### 3.1 New Table Concept (No Implementation in This Doc)

```text
campaign_user_roles
  - user_id       UUID NOT NULL   (references auth.users(id) or app users)
  - campaign_id   UUID NOT NULL   (references campaigns(id))
  - role          TEXT NOT NULL   (e.g. 'CAMPAIGN_OPERATOR', 'CONTENT_CREATOR')
  - created_at    TIMESTAMPTZ
  - updated_at    TIMESTAMPTZ
  - (optional) granted_by UUID, status TEXT)
  - UNIQUE(user_id, campaign_id)  — one role per user per campaign
```

- **Level 2 (campaign) roles** stored here: e.g. **CAMPAIGN_OPERATOR**, **CONTENT_CREATOR** (campaign-scoped).
- **Level 1 (company) roles** stay in **user_company_roles**: SUPER_ADMIN, CAMPAIGN_ARCHITECT, COMPANY_ADMIN (and any legacy company-level content roles during transition).

Design principles:

- No change to existing `user_company_roles` schema or to existing auth flows.
- New table is **additive**. If a route does not yet check `campaign_user_roles`, behavior stays “company role only.”
- Backward compatibility: when campaign roles are introduced, “effective” campaign role can fall back to company role when no row exists in `campaign_user_roles` (see §4).

### 3.2 Role Naming (Internal)

| Display / future use | Internal constant | Scope |
|----------------------|--------------------|--------|
| (e.g. “Content Manager” / “Campaign Manager”) | **CAMPAIGN_OPERATOR** | Campaign |
| Content Creator | **CONTENT_CREATOR** | Campaign (when used in campaign_user_roles) |
| Super Admin | SUPER_ADMIN | Company (user_company_roles) |
| Campaign Architect | CAMPAIGN_ARCHITECT | Company |
| Company Admin | COMPANY_ADMIN | Company |

Do **not** use “Content Manager” as an internal role name for campaign scope; use **CAMPAIGN_OPERATOR** so reviewers/schedulers/managers can merge into it later.

---

## 4. Permission Resolution Flow (Proposed)

### 4.1 Flow: Company Role → Campaign Role → Action

```text
1. Resolve identity
   - Legacy super_admin_session cookie → treat as SUPER_ADMIN (company-level bypass).
   - Else Supabase token → userId.

2. Resolve company (when request is company-scoped or campaign-scoped)
   - From query/body companyId, or from campaign: companyId = getCompanyId(campaignId).

3. Company-level access (required for any company/campaign access)
   - getUserRole(userId, companyId) → companyRole from user_company_roles.
   - If no company access → 403 COMPANY_ACCESS_DENIED.
   - Super Admin (cookie or DB) can bypass company scope for governance; for “acting in a company” they still need company context.

4. Campaign-level access (when the action is campaign-scoped)
   - If campaignId is present and the action is intended to be campaign-scoped:
     - Option A (strict): getCampaignRole(userId, campaignId) from campaign_user_roles.
         - If row exists → use campaignRole for permission.
         - If no row → fall back to companyRole for this campaign (backward compat).
     - Option B (lazy): use companyRole only until campaign_user_roles is populated; then introduce getCampaignRole and same fallback.
   - Map campaignRole (e.g. CAMPAIGN_OPERATOR, CONTENT_CREATOR) to allowed actions for that campaign.
   - Company-level roles that imply “full company access” (e.g. COMPANY_ADMIN, CAMPAIGN_ARCHITECT) can be defined to imply “all campaign roles” for campaigns in that company, so no campaign_user_roles row required for them.

5. Action allowed?
   - Define permissions per action: e.g. “approve strategy” requires COMPANY_ADMIN or CAMPAIGN_ARCHITECT (company) or CAMPAIGN_OPERATOR (campaign).
   - hasPermission(companyRole, action) OR (for campaign actions) hasCampaignPermission(campaignRole, action), with fallback to company role when campaign role is missing.
```

### 4.2 Backward Compatibility (Existing Users Still Work)

- **No row in campaign_user_roles:** Treat effective campaign role as the user’s **company role** for that company (current behavior). So all existing users keep the same access.
- **Company-level “full” roles:** COMPANY_ADMIN, CAMPAIGN_ARCHITECT, SUPER_ADMIN can be defined so they **always** have access to every campaign in companies they belong to, without requiring any `campaign_user_roles` row.
- **Optional “strict” mode later:** Once campaign_user_roles is in use, you can add a policy or flag so that for certain actions “must have campaign role” (no fallback). That would be a later, explicit change.
- **CONTENT_MANAGER (company) unchanged:** Keep current normalization CONTENT_MANAGER → CONTENT_CREATOR in company scope. Campaign-scoped CONTENT_CREATOR and new CAMPAIGN_OPERATOR live only in campaign_user_roles; no need to rename company CONTENT_MANAGER in this step.

---

## 5. Campaign RBAC Flow Diagram (Text)

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│  REQUEST (e.g. campaign-scoped API: campaignId in path/body)                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  IDENTITY                                                                     │
│  • super_admin_session cookie → SUPER_ADMIN (company-level bypass)            │
│  • Else: Supabase token → getSupabaseUserFromRequest(req) → userId            │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  COMPANY SCOPE                                                                │
│  • companyId = from query/body OR getCompanyId(campaignId) from               │
│    campaign_versions(company_id) where campaign_id = campaignId               │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  LEVEL 1 — COMPANY ROLE (user_company_roles)                                  │
│  • getUserRole(userId, companyId) → companyRole                               │
│  • If no active row → 403 COMPANY_ACCESS_DENIED                              │
│  • SUPER_ADMIN / CAMPAIGN_ARCHITECT / COMPANY_ADMIN → can imply full          │
│    access to company’s campaigns (no campaign row required)                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                          ┌─────────────┴─────────────┐
                          ▼                           ▼
              ┌───────────────────────┐   ┌───────────────────────┐
              │ Company-only action   │   │ Campaign-scoped action│
              │ (e.g. list campaigns, │   │ (e.g. approve strategy,│
              │  invite user)         │   │  commit plan, content)│
              └───────────────────────┘   └───────────────────────┘
                          │                           │
                          ▼                           ▼
              ┌───────────────────────┐   ┌───────────────────────┐
              │ hasPermission(         │   │ LEVEL 2 — CAMPAIGN ROLE│
              │   companyRole, action) │   │ (campaign_user_roles)   │
              │ → 403 if false         │   │ • getCampaignRole(     │
              └───────────────────────┘   │     userId, campaignId)│
                                          │ • If row: campaignRole  │
                                          │ • Else: fallback =     │
                                          │   companyRole          │
                                          └───────────────────────┘
                                                          │
                                                          ▼
                                          ┌───────────────────────┐
                                          │ hasCampaignPermission( │
                                          │   campaignRole, action) │
                                          │ OR hasPermission(      │
                                          │   companyRole, action) │
                                          │ (for company “full”)   │
                                          │ → 403 if false         │
                                          └───────────────────────┘
                                                          │
                                                          ▼
                                          ┌───────────────────────┐
                                          │ ALLOW → run handler    │
                                          └───────────────────────┘
```

---

## 6. APIs That Must Later Move to Campaign-Role Checks

Grouped by area. **Do not implement in this phase** — only prepare architecture; migration is a later step.

### 6.1 Campaign lifecycle and strategy (by campaign)

- `GET/PUT/DELETE /api/campaigns/[id]`
- `POST /api/campaigns/[id]/approve-strategy`
- `POST /api/campaigns/[id]/revise-strategy`
- `GET /api/campaigns/[id]/strategy-status`
- `GET /api/campaigns/[id]/reapproval-status`
- `POST /api/campaigns/[id]/propose-frequency-rebalance`
- `POST /api/campaigns/[id]/approve-frequency-rebalance`
- `POST /api/campaigns/[id]/reject-frequency-rebalance`
- `GET /api/campaigns/[id]/ai-improvements`
- `GET /api/campaigns/[id]/viral-topic-memory`
- `GET /api/campaigns/[id]/platform-allocation-advice`
- `GET /api/campaigns/[id]/momentum-amplifier`
- `GET /api/campaigns/[id]/lead-conversion-intelligence`
- `GET /api/campaigns/[id]/forecast-vs-actual`
- `GET /api/campaigns/[id]/optimization-advice`

### 6.2 Plans and scheduling (by campaign)

- `POST /api/campaigns/[id]/commit-plan`
- `POST /api/campaigns/commit-daily-plan`
- `GET /api/campaigns/[id]/progress`
- `POST /api/campaigns/scheduler-payload`
- `POST /api/campaigns/optimize-week`
- `POST /api/campaigns/regenerate-blueprint`
- `POST /api/campaigns/run-preplanning`
- `POST /api/campaigns/[id]/schedule-structured-plan` (and similar)

### 6.3 Preemption and recommendations (by campaign)

- `POST /api/campaigns/execute-preemption`
- `POST /api/campaigns/approve-preemption`
- `POST /api/campaigns/reject-preemption`
- `POST /api/campaigns/[id]/merge-recommendations`
- `GET /api/campaigns/[id]/recommendations`

### 6.4 Content (by campaign)

- `POST /api/content/generate-day` (companyId + campaignId in body)
- `GET /api/content/list` (campaignId in query)
- `POST /api/content/approve` (if scoped to campaign)
- `POST /api/content/reject` (if scoped to campaign)
- `POST /api/content/regenerate` (if scoped to campaign)

### 6.5 Duration and config (by campaign)

- `POST /api/campaigns/negotiate-duration`
- `POST /api/campaigns/suggest-duration`
- `POST /api/campaigns/update-duration`
- `POST /api/campaigns/[id]/suggest-themes`

### 6.6 List and create (company + optional campaign filter)

- `GET /api/campaigns/list` — keep company filter; **later** optionally filter visible campaigns by campaign role (e.g. only campaigns where user has CAMPAIGN_OPERATOR or CONTENT_CREATOR).
- `POST /api/campaigns/index` — create remains company-level; assignment of users to campaign (campaign_user_roles) is a separate feature.

---

## 7. Minimal Migration Strategy (Preparation Only)

No implementation in this doc. Suggested order when you do implement:

1. **Schema only**  
   Add `campaign_user_roles` table (user_id, campaign_id, role, timestamps, unique(user_id, campaign_id)). No application code changes.

2. **Resolve and fallback only**  
   Add `getCampaignRole(userId, campaignId)` that:  
   - Reads campaign_user_roles.  
   - Returns role if row exists.  
   - Returns `null` if no row (caller treats as “use company role”).  
   Do **not** change any API to require a campaign role yet; callers keep using company role only.

3. **Optional: seed or assign**  
   When you have a way to assign users to campaigns (e.g. UI or admin), insert into campaign_user_roles. Existing behavior unchanged because of fallback.

4. **Introduce campaign permission helper**  
   Add `hasCampaignPermission(campaignRole, action)` (and/or “effective role” = campaignRole ?? companyRole) and document which actions are “campaign-scoped” in the new model.

5. **Migrate APIs incrementally**  
   For each API in §6, optionally add a campaign-role check **in addition** to company check, with fallback: if campaign_role present use it for permission; else use company_role. Then (later) you can tighten to “require campaign role” where desired.

6. **Naming**  
   Use **CAMPAIGN_OPERATOR** (and CONTENT_CREATOR for campaign scope) in `campaign_user_roles` and in code. Do not introduce “Content Manager” as an internal campaign role name.

---

## 8. Summary

| Item | Outcome |
|------|--------|
| **Current structure** | user_company_roles only; campaign company from campaign_versions; all permission checks company-scoped. |
| **Campaign-level assumption** | Every campaign API infers access from company role only; CONTENT_MANAGER is company-wide and normalized to CONTENT_CREATOR. |
| **New table concept** | campaign_user_roles (user_id, campaign_id, role) — additive, no change to existing tables. |
| **Internal naming** | Use **CAMPAIGN_OPERATOR** for campaign-level “manager” role; do not use “Content Manager” internally. |
| **Resolution flow** | Identity → company → company role → (if campaign action) campaign role with fallback to company role → action check. |
| **Backward compatibility** | No row in campaign_user_roles ⇒ use company role (current behavior). Company “full” roles can imply access to all company campaigns. |
| **APIs for later migration** | Listed in §6; no changes in this preparation phase. |
| **Migration strategy** | Schema → getCampaignRole + fallback → optional seed → hasCampaignPermission → migrate APIs incrementally. |

**No implementation, UI, or business logic changes in this document** — architecture preparation only for campaign-scoped roles.
