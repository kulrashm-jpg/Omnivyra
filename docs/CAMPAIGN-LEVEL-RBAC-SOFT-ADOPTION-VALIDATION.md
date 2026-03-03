# Campaign-Level RBAC — Soft Adoption Validation

**Phase:** Observational only. Campaign role is resolved and attached to request; no access denial based on campaign role. Company-based checks remain primary.

---

## STEP 3 — Validation Output (Per Route)

### 1. GET /api/campaigns/[id]/progress

| Check | Status |
|-------|--------|
| **Existing access unchanged** | Yes. Access is still determined only by `enforceCompanyAccess` + `withRBAC(ALL_ROLES)`. Campaign ownership (campaign_versions) and 403/200 responses are unchanged. |
| **Campaign role resolved successfully** | Yes. After company access and ownership checks, `resolveEffectiveCampaignRole(access.userId, id, companyId)` is called. Result is attached to `req.campaignAuth` and logged as `CAMPAIGN_AUTH_PROGRESS` (non-test). |
| **Fallback when no campaign row exists** | Yes. When there is no row in `campaign_user_roles`, `resolveEffectiveCampaignRole` returns `effectiveRole: companyRole`, `source: 'company'`. No denial; behavior matches pre–soft-adoption. |

### 2. GET /api/content/list

| Check | Status |
|-------|--------|
| **Existing access unchanged** | Yes. Access is still determined only by `enforceCompanyAccess` + `withRBAC(ALL_ROLES)`. Required `campaignId` and 200/4xx/5xx behavior are unchanged. |
| **Campaign role resolved successfully** | Yes. When `companyId` is present in query, `resolveEffectiveCampaignRole(access.userId, campaignId, companyIdStr)` is called. Result is attached to `req.campaignAuth` and logged as `CAMPAIGN_AUTH_CONTENT_LIST` (non-test). |
| **Fallback when no campaign row exists** | Yes. When there is no row in `campaign_user_roles`, effective role is company role, `source: 'company'`. No denial. |

### 3. GET /api/campaigns/[id]/strategy-status

| Check | Status |
|-------|--------|
| **Existing access unchanged** | Yes. Access is still determined only by `getSupabaseUserFromRequest` + campaign_versions company lookup + `getUserRole(user.id, companyId)`. 401/403/404/200 behavior is unchanged. |
| **Campaign role resolved successfully** | Yes. After the existing role check, `resolveEffectiveCampaignRole(user.id, id, companyId)` is called. Result is attached to `req.campaignAuth` and logged as `CAMPAIGN_AUTH_STRATEGY_STATUS` (non-test). |
| **Fallback when no campaign row exists** | Yes. When there is no row in `campaign_user_roles`, effective role is company role, `source: 'company'`. No denial. |

---

## STEP 4 — Safety Check

| Requirement | Status |
|-------------|--------|
| **No API behavior changed** | Yes. Response status codes, response bodies, and success/error conditions are unchanged. Only additive: resolve campaign role, set `req.campaignAuth`, and optional server log. |
| **No permission denial introduced** | Yes. No branch uses `campaignAuth` or campaign role to return 403 or restrict data. Denials remain only from existing company/ownership checks. |
| **No frontend dependency added** | Yes. No new response fields, headers, or contracts. `req.campaignAuth` is server-side only and not exposed to the client. |

---

## Request Context (STEP 2)

For each of the three routes, when campaign role resolution runs without error, the request is extended with:

```ts
req.campaignAuth = {
  companyRole,   // from user_company_roles
  campaignRole,  // from campaign_user_roles, or null
  effectiveRole, // company override or campaign role or fallback to company role
  source         // 'company' | 'campaign'
};
```

This is **observational only**. Handlers do not read `req.campaignAuth` for access control in this phase. It is available for logging, metrics, or a future enforcement phase.

---

## Summary

- **3 routes** updated: `campaigns/[id]/progress`, `content/list`, `campaigns/[id]/strategy-status`.
- **Company-based checks** remain primary and unchanged.
- **Campaign role** is resolved and attached for observation; fallback to company role when no campaign row exists.
- **No breaking access behavior;** no new denial; no frontend dependency.
