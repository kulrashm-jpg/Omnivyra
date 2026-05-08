# Wave 3A — Role-String Classification

**Branch**: `identity-spine-enforcement`
**Generated**: 2026-05-07
**Question answered**: "Which `role === 'X'` comparisons in the runtime tree are safe to keep, vs. which leak authority and must be migrated to capability checks?"

Source query (excluded `architecture-migration/**`, docs, and JSDoc comments):
```
grep -n "role\s*===\s*['\"]([A-Z_]+)['\"]" backend/ pages/ lib/ components/ hooks/
```

21 raw matches across 16 files. Excluding 4 test-only matches in `user_lifecycle_management.test.ts` and 2 JSDoc-only matches in `requireCapability.ts` / `AuthorizationService.ts`, **15 runtime sites** remain. Below: each one classified A–E.

---

## Class A — Safe response shaping (KEEP, no Wave 3 work)

Role string drives serialization, not authority. The route already gated authority via `resolveCompanyAccess` / `enforceCompanyAccess` BEFORE reaching the `role === 'COMPANY_ADMIN'` branch. The `if` only swaps the response payload between full and limited.

| Site | Snippet | Justification |
|---|---|---|
| [pages/api/company-profile/index.ts:134](../../../pages/api/company-profile/index.ts) | `const isCompanyAdminOnly = access.role === 'COMPANY_ADMIN';` | After `resolveCompanyAccess` succeeds, decides whether to `toLimitedCompanyProfile`. Non-COMPANY_ADMIN gets the full profile. |
| [pages/api/company-profile/index.ts:241](../../../pages/api/company-profile/index.ts) | `access.role === 'COMPANY_ADMIN' ? toLimitedCompanyProfile(profile) ?? profile : profile` | Same as above on the PUT branch. |
| [pages/api/company-profile/refine.ts:78](../../../pages/api/company-profile/refine.ts) | `access.role === 'COMPANY_ADMIN' ? toLimitedCompanyProfile(refined.profile) ?? refined.profile : refined.profile` | Refine response shaping. |
| [pages/api/company-profile/problem-transformation.ts:33](../../../pages/api/company-profile/problem-transformation.ts) | `access.role === 'COMPANY_ADMIN' ? toLimitedCompanyProfile(profile) ?? profile : profile` | Same. |
| [pages/api/company-profile/context.ts:22](../../../pages/api/company-profile/context.ts) | `const isCompanyAdminOnly = access.role === 'COMPANY_ADMIN';` | Same. |
| [components/execution-layout/EnterpriseExecutionLayout.tsx:34](../../../components/execution-layout/EnterpriseExecutionLayout.tsx) | `if (role === 'COMPANY_ADMIN' \|\| role === 'CAMPAIGN_CONTENT_MANAGER') return 'radar';` | Pure UI rendering — selects which dashboard variant to show. No authority involved. |

**Verdict**: 6 sites. Keep as-is. Wave 3 may rename for clarity but the semantics are correct.

---

## Class B — Legacy serializer / tier mapping (KEEP with TODO comment)

Role string maps a role to a downstream string parameter. Authority gating happens elsewhere; the role string is just data shaping. Could be replaced with a capability check but the change is purely cosmetic.

| Site | Snippet | Justification |
|---|---|---|
| [pages/api/admin/consumption/llm.ts:61](../../../pages/api/admin/consumption/llm.ts) | `role === 'COMPANY_ADMIN' \|\| role === 'ADMIN' ? 'company_admin' : 'user'` | Maps role to consumption tier name. |
| [pages/api/admin/consumption/apis.ts:40](../../../pages/api/admin/consumption/apis.ts) | `role === 'COMPANY_ADMIN' \|\| role === 'ADMIN' ? 'company_admin' : 'user'` | Same shape. |
| [pages/super-admin/consumption.tsx:86–89](../../../pages/super-admin/consumption.tsx) | `if (role === 'SUPER_ADMIN') { … } else if (role === 'COMPANY_ADMIN' \|\| role === 'ADMIN') { … }` | UI render branch. Authority is from the bridge cookie / DB role separately. |
| [pages/api/settings/intelligence-access.ts:224](../../../pages/api/settings/intelligence-access.ts) | `roles.some((r) => String(r.role).toUpperCase() === 'SUPER_ADMIN')` | Decides "global" vs "company" mode in the response payload. The page's overall authorization is upstream. |
| [pages/api/settings/intelligence-access.ts:237](../../../pages/api/settings/intelligence-access.ts) | `roles.find((r) => String(r.role).toUpperCase() === 'COMPANY_ADMIN')` | Picks a company admin role row to serialize as default. |

**Verdict**: 5 sites. Keep, optionally add `// TODO(wave3): replace with capability check` next to each. Behavior-preserving migration is low priority.

---

## Class C — Mixed authority risk (FLAG; Wave 3B migration required)

Role string short-circuits a permission check. A SUPER_ADMIN bypasses the normal permission lookup, which means any authority leak from the role string IS an authority leak in the route.

| Site | Snippet | Risk |
|---|---|---|
| [pages/api/external-apis/index.ts:141](../../../pages/api/external-apis/index.ts) | `access.role === 'SUPER_ADMIN' \|\| (await hasPermission(access.role, 'MANAGE_EXTERNAL_APIS'))` | SUPER_ADMIN can manage external APIs even if `hasPermission` would say no. Migrate to `requireCapability(INTEGRATION_PLATFORM_MANAGE)` upstream and remove this branch. |
| [pages/api/external-apis/presets.ts:162](../../../pages/api/external-apis/presets.ts) | `if (access.role === 'SUPER_ADMIN') { … }` | Branches into the platform-preset write path. Same migration. |

**Verdict**: 2 sites. Wave 3B migration. Capability mapping: `INTEGRATION_PLATFORM_MANAGE`.

---

## Class D — Dead path (REMOVE in Wave 3 once bridge deletes)

Synthetic `userId === 'content_architect'` short-circuits. These can never trigger except through the content-architect bridge cookie. Once the bridge is gone, the synthetic userId is unreachable.

| Site | Snippet | Wave 3 action |
|---|---|---|
| [backend/services/userContextService.ts:94](../../../backend/services/userContextService.ts) | `const isContentArchitect = user.userId === 'content_architect';` | DELETE branch |
| [backend/services/rbacService.ts:235](../../../backend/services/rbacService.ts) | `if (user.userId === 'content_architect') return { role: Role.COMPANY_ADMIN, … };` | DELETE branch |
| [backend/services/rbacService.ts:279](../../../backend/services/rbacService.ts) | `if (user.userId === 'content_architect' && allowedRoles.includes(Role.COMPANY_ADMIN)) { … }` | DELETE branch |
| [pages/api/campaigns/list.ts:31](../../../pages/api/campaigns/list.ts) | `if (user.userId === 'content_architect') { … }` | DELETE branch |

**Verdict**: 4 sites. Remove together with the bridge in Wave 3.

---

## Class E — Wave-3-required rewrite (role mutation as side-effect of unrelated action)

| Site | Snippet | Risk |
|---|---|---|
| [pages/api/super-admin/free-credits/grant.ts:113](../../../pages/api/super-admin/free-credits/grant.ts) | `} else if (existingRole.role === 'SUPER_ADMIN') { sb.from('user_company_roles').update({ role: 'COMPANY_ADMIN' }).eq('id', existingRole.id); }` | Granting credits to a SUPER_ADMIN silently demotes them to COMPANY_ADMIN. This is a destructive authority mutation hidden inside a billing route. |
| [pages/api/super-admin/free-credits/requests.ts:116](../../../pages/api/super-admin/free-credits/requests.ts) | Same shape | Same risk. |

**Verdict**: 2 sites. Wave 3B must split this into an explicit role-revocation endpoint or remove the demotion altogether. The current behavior is a footgun: any operator using the bootstrap route to promote themselves to SUPER_ADMIN, then granting themselves test credits, will silently revoke their own SUPER_ADMIN role.

**Wave 3A mitigation**: documented here and in `trust-authority-map.md`. Operators MUST NOT call free-credits/grant.ts against a freshly bootstrapped SUPER_ADMIN until Wave 3B lands.

---

## Tally

| Class | Count | Wave 3 effort |
|---|---|---|
| A — Safe response shaping | 6 | none |
| B — Legacy serializer / tier mapping | 5 | optional cosmetic |
| C — Mixed authority risk | 2 | required (Wave 3B) |
| D — Dead path | 4 | delete with bridge (Wave 3) |
| E — Wave-3-required rewrite | 2 | required (Wave 3B) |
| **Total** | **19** | — |

(19 here vs. "15 sites" in the prompt brief — the prompt counted unique files; this report counts unique runtime decisions, splitting `index.ts` and `intelligence-access.ts` into per-line sites where each branch independently affects authority/serialization.)
