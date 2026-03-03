# Campaign-Level RBAC — Safety Validation (Infrastructure Phase)

**Phase:** Additive infrastructure only. No API migrations. No UI or business logic changes.

---

## STEP 5 — Safety Validation

### APIs unaffected

- **No route was modified.** All existing API handlers still use only:
  - `enforceCompanyAccess`, `withRBAC`, `getUserRole`, `getUserCompanyRole`, `hasPermission` (company-scoped).
- **No imports of campaignRoleService or campaign_user_roles** were added to any API file.
- **withRBAC** and **enforceRole** are unchanged.

### Existing access unchanged

- **user_company_roles** remains the only source of role used by all current permission checks.
- **campaign_user_roles** is a new, empty table. No rows ⇒ no behavior change.
- **resolveEffectiveCampaignRole** and **getCampaignRole** are not called by any API yet. When they are used later, fallback to company role preserves current behavior when no campaign row exists.

### Campaign roles optional

- **Campaign-level role is optional.** If a user has no row in `campaign_user_roles` for a campaign, `getCampaignRole` returns `null` and `resolveEffectiveCampaignRole` returns the **company role** (backward compatible).
- **Company override:** SUPER_ADMIN, CAMPAIGN_ARCHITECT, COMPANY_ADMIN always get company role as effective role for the campaign (full access without needing a campaign row).

### Summary

| Check | Status |
|-------|--------|
| New table only (no existing tables modified) | Yes — `campaign_user_roles` added in `database/campaign-user-roles.sql` |
| New service only (no RBAC rewrite) | Yes — `backend/services/campaignRoleService.ts`; rbacService untouched |
| No API migrations | Yes — no route uses campaignRoleService or campaign_user_roles |
| No UI changes | Yes |
| No business logic changes | Yes |
| Backward compatible | Yes — campaign role falls back to company role |

**This phase is infrastructure only.** Migrating APIs to use campaign roles is a later phase.
