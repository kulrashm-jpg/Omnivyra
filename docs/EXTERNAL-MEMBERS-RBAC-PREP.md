# External Members (Agency) — RBAC Preparation

**Goal:** Add `membership_type` layer (INTERNAL / EXTERNAL) for future agency support. No permission or behavior changes. No enforcement yet.

---

## 1. Schema (Additive)

**File:** `database/user-company-roles-membership-type.sql`

- Added to `user_company_roles`:
  - **membership_type** TEXT DEFAULT `'INTERNAL'`
  - CHECK: `'INTERNAL'` | `'EXTERNAL'`
- No existing columns modified. **Run this migration before deploying** so that `membership_type` exists; otherwise role resolution selects may fail where they include this column.

---

## 2. Role Resolution Updates

### UserContext (backend/lib/userContext.ts, userContextService)

- **UserContext** now includes:
  - **membershipType:** `'INTERNAL' | 'EXTERNAL'` (default company’s membership)
  - **membershipByCompany:** `Record<string, 'INTERNAL' | 'EXTERNAL'>` (per company)
- **resolveUserContext** selects `membership_type` from `user_company_roles`, builds `membershipByCompany`, sets `membershipType` from default company (fallback `'INTERNAL'`).

### getUserRole (backend/services/rbacService.ts)

- **getUserRole(userId, companyId)** now returns **membershipType** for that company (`'INTERNAL' | 'EXTERNAL'`).
- Callers that only use `{ role, error }` are unchanged. Optional use: `const { role, error, membershipType } = await getUserRole(...)`.

### Helpers (backend/services/userContextService.ts)

- **isExternalMember(userContext):** `true` when `userContext.membershipType === 'EXTERNAL'`.
- **isExternalMemberForCompany(userContext, companyId):** `true` when `userContext.membershipByCompany?.[companyId] === 'EXTERNAL'`.

No permission logic was changed. Access checks still use only role and company membership.

---

## 3. Places Where Visibility Filtering Will Later Apply

When you introduce enforcement for external members, these are the areas that typically need visibility filtering (e.g. restrict EXTERNAL to certain campaigns, hide internal-only data). **No changes were made here in this phase.**

| Area | How context is resolved | Future use |
|------|--------------------------|------------|
| **resolveUserContext / enforceCompanyAccess** | Used by many APIs; returns UserContext (now with membershipType). | Filter lists (campaigns, content, users) by membership when acting in a company. |
| **getUserRole** | Used by campaign/company-profile/external-apis routes. Returns role + membershipType per company. | Per-company visibility (e.g. hide internal-only config for EXTERNAL). |
| **Campaign list** | `campaigns/list`, `campaigns/index` — companyId + getUserRole or requireCompanyRole. | Limit visible campaigns for EXTERNAL (e.g. only assigned campaigns). |
| **Content list / generate** | `content/list`, `content/generate-day` — enforceCompanyAccess + campaignId. | Restrict content visibility or generation scope for EXTERNAL. |
| **Company profile** | `company-profile/*` — getUserRole(companyId). | Restrict which profile sections or actions EXTERNAL can see or edit. |
| **Recommendations** | `recommendations/*`, `recommendations/[id]/*` — getUserRole or enforceCompanyAccess. | Limit recommendation visibility or actions for EXTERNAL. |
| **External APIs** | `external-apis/*` — getUserRole, hasPermission. | Restrict API config visibility or management for EXTERNAL. |
| **Company users / team** | `company/users`, `company/users/[userId]/role` — getUserRole, hasPermission(CREATE_USER). | Often internal-only (no EXTERNAL user management); filter list by membership. |
| **Campaign-scoped APIs** | All `campaigns/[id]/*` that use getUserRole or resolveEffectiveCampaignRole. | Combine with campaign_user_roles: EXTERNAL may only see campaigns they’re assigned to. |

---

## 4. Safety (This Phase)

| Check | Status |
|-------|--------|
| No API behavior changed | Yes — no branch uses membershipType or isExternalMember for access or response shape. |
| No permission denial introduced | Yes — permissions still depend only on role and company membership. |
| No UI changes | Yes. |
| Backward compatible | Yes — default `INTERNAL`; missing column handled via default in migration; existing callers ignore membershipType. |

**Infrastructure only.** Enforcement and visibility rules for EXTERNAL are for a later phase.
