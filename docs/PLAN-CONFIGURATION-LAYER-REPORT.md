# PLAN CONFIGURATION LAYER REPORT

## 1. Tables Created

| Table | Purpose |
|-------|--------|
| **pricing_plans** | Tier definitions: `id`, `plan_key` (unique), `name`, `description`, `monthly_price`, `currency`, `is_active`, `created_at`, `updated_at`. |
| **plan_limits** | Resource ceilings per plan: `plan_id`, `resource_key` (`llm_tokens`, `external_api_calls`, `automation_executions`), `monthly_limit` (null = unlimited). Unique `(plan_id, resource_key)`. |
| **organization_plan_assignments** | Org → plan: `organization_id` (unique), `plan_id`, `assigned_at`, `assigned_by`. Index on `organization_id`. |
| **organization_plan_overrides** | Per-org overrides: `organization_id`, `resource_key`, `monthly_limit`. Unique `(organization_id, resource_key)`. Index on `organization_id`. |

All in **`database/pricing_plans.sql`**. No foreign keys. Purely declarative.

## 2. Service Created

**`backend/services/planResolutionService.ts`**

- **`resolveOrganizationPlanLimits(organizationId)`**  
  Returns `{ plan_key: string | null, limits: { llm_tokens, external_api_calls, automation_executions } }`.
- **Steps:** (1) Load `organization_plan_assignments` for org → `plan_id`. (2) If none, return `plan_key: null`, all limits null. (3) Load `pricing_plans` for `plan_key`. (4) Load `plan_limits` for that `plan_id`. (5) Load `organization_plan_overrides` for org. (6) Merge: for each resource, use override if present, else plan limit, else null.
- No caching. No enforcement. Read-only resolution.

## 3. Resolution Merge Logic

- **Base:** Plan limits from `plan_limits` for the assigned `plan_id` → e.g. `llm_tokens: 2000000`, `external_api_calls: 5000`, `automation_executions: 2000`.
- **Overrides:** Rows in `organization_plan_overrides` for that `organization_id` keyed by `resource_key`.
- **Merge rule:** For each of `llm_tokens`, `external_api_calls`, `automation_executions`, effective limit = override value if an override row exists for that resource, else plan limit, else null (unlimited).
- Override wins over plan default. No override and no plan limit → null (treated as unlimited in a future enforcement phase).

## 4. Example Plan

**Growth plan**

- **pricing_plans:** `plan_key: 'growth'`, `name: 'Growth'`, `monthly_price: 99`, `currency: 'USD'`.
- **plan_limits:**  
  `(plan_id, llm_tokens, 2000000)`, `(plan_id, external_api_calls, 5000)`, `(plan_id, automation_executions, 2000)`.

Created via **POST /api/super-admin/plans/create** with body:

```json
{
  "plan_key": "growth",
  "name": "Growth",
  "description": "For scaling teams",
  "monthly_price": 99,
  "limits": {
    "llm_tokens": 2000000,
    "external_api_calls": 5000,
    "automation_executions": 2000
  }
}
```

## 5. Example Override

**Org-specific cap on LLM tokens**

- **organization_plan_overrides:** `(organization_id, 'llm_tokens', 500000)`.

Created via **POST /api/super-admin/plans/override** with body:

```json
{
  "organization_id": "org-uuid",
  "resource_key": "llm_tokens",
  "monthly_limit": 500000
}
```

Resolved limits for that org: `llm_tokens: 500000` (override), `external_api_calls` and `automation_executions` from plan (e.g. 5000, 2000).

## 6. Super-Admin Endpoints

| Endpoint | Method | Purpose |
|----------|--------|--------|
| **/api/super-admin/plans/create** | POST | Create or update plan: body `plan_key`, `name`, `description?`, `monthly_price?`, `limits?` (object with llm_tokens, external_api_calls, automation_executions). Upserts `pricing_plans` and `plan_limits`. |
| **/api/super-admin/plans/assign** | POST | Assign plan to org: body `organization_id`, `plan_key`. Upserts `organization_plan_assignments`. |
| **/api/super-admin/plans/override** | POST | Set org override: body `organization_id`, `resource_key`, `monthly_limit`. Upserts `organization_plan_overrides`. |
| **/api/super-admin/plans/get-organization-plan** | GET | Read resolved plan for org: query `organization_id`. Returns `{ plan_key, limits }`. Super admin only. |

All require super admin (cookie or `isPlatformSuperAdmin`).

## 7. Confirmation No Enforcement

- No code compares meter values to resolved limits. No blocking, no errors, no gating. Plan resolution and endpoints only read/write plan and assignment data. Meter, ledger, guardrails, and usage endpoints are unchanged.

## 8. Confirmation No Coupling to Execution

- No imports or calls from meter service, ledger service, guardrails, aiGateway, externalApiService, or communityAiActionExecutor. Execution paths are untouched. Plans define policy; a future phase can compare meter vs plan and enforce.

## 9. Example Resolved Output

For an organization assigned the **growth** plan with one override (`llm_tokens: 500000`):

**GET /api/super-admin/plans/get-organization-plan?organization_id=org-uuid**

```json
{
  "plan_key": "growth",
  "limits": {
    "llm_tokens": 500000,
    "external_api_calls": 5000,
    "automation_executions": 2000
  }
}
```

Same structure is returned by `resolveOrganizationPlanLimits(organizationId)` for use by future enforcement or UI.
