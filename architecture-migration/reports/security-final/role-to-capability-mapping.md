# Role → Capability Mapping (Wave 2A)

**Branch:** `identity-spine-consolidation`
**Wave:** 2A of 3
**Date:** 2026-05-07
**Source-grounded.** Generated from [backend/security/capabilityRegistry.ts](backend/security/capabilityRegistry.ts) and [shared/contracts/security/SecurityCapabilities.ts](shared/contracts/security/SecurityCapabilities.ts).

This document is the canonical migration aid for converting role checks (`if (role === 'SUPER_ADMIN')`) to capability checks (`hasCapability(p, 'identity.admin')`). Wave 2C uses this table to do the conversion.

---

## Mapping (post-hierarchy expansion)

| Role | Capabilities granted (after hierarchy expansion) |
|---|---|
| **SUPER_ADMIN** | `identity.admin`, `identity.admin.assign`, `identity.admin.revoke`, `identity.admin.delete`, `organization.manage`, `organization.transfer`, `organization.delete`, `billing.manage`, `billing.view`, `billing.purchase`, `integration.manage`, `integration.secrets.read`, `apiKey.manage`, `apiKey.generate`, `automation.execute.production`, `automation.execute`, `automation.transfer`, `mfa.enroll`, `mfa.revoke`, `mfa.view_factors`, `campaign.execute`, `campaign.view`, `campaign.delete`, `content.publish`, `content.review`, `content.create`, `content.delete` |
| **COMPANY_ADMIN** | `organization.manage`, `organization.transfer`, `billing.manage`, `billing.view`, `billing.purchase`, `integration.manage`, `integration.secrets.read`, `apiKey.manage`, `apiKey.generate`, `automation.execute`, `mfa.enroll`, `mfa.view_factors`, `campaign.execute`, `campaign.view`, `campaign.delete`, `content.publish`, `content.review`, `content.create`, `content.delete` |
| **CONTENT_PUBLISHER** | `campaign.view`, `content.publish`, `content.review`, `content.create`, `mfa.enroll`, `mfa.view_factors` |
| **CONTENT_REVIEWER** | `campaign.view`, `content.review`, `content.create`, `mfa.enroll`, `mfa.view_factors` |
| **CONTENT_CREATOR** | `campaign.view`, `content.create`, `mfa.enroll`, `mfa.view_factors` |
| **VIEW_ONLY** | `campaign.view`, `mfa.enroll`, `mfa.view_factors` |
| **(legacy cookie super-admin bridge)** | `super_admin.legacy`, `campaign.view`, `billing.view`, `mfa.view_factors` (NEVER satisfies step-up) |

Notes:
- `SUPER_ADMIN` excludes nothing — the role grants the broadest capability set, but every step-up-required capability still requires an elevated session.
- `COMPANY_ADMIN` does NOT include `organization.delete` (org deletion is platform-admin territory; if needed for a customer admin, grant via `capability_assignments`).
- `COMPANY_ADMIN` does NOT include `automation.execute.production` (the prod variant requires step-up + role escalation by design).
- `automation.transfer` is SUPER_ADMIN-only by design — transfer of automation ownership is platform escalation territory.

---

## Step-up-required capabilities

Granted-but-elevated. Holding the capability is not enough — every action also runs through StepUpAuthorizationService.

```
identity.admin
identity.admin.assign
identity.admin.revoke
identity.admin.delete
organization.delete
organization.transfer
billing.manage
billing.purchase
apiKey.manage
apiKey.generate
integration.secrets.read
automation.transfer
mfa.revoke
```

These are listed in `STEP_UP_REQUIRED_CAPABILITIES` in [shared/contracts/security/SecurityCapabilities.ts](shared/contracts/security/SecurityCapabilities.ts). Every Wave 2C migration of a route that performs one of these actions must:
1. Use `decideCapabilityWithStepUp` from `AuthorizationService` (NOT `decideCapability`).
2. Map back HTTP 401 with `code: STEP_UP_REQUIRED` to launch the UI step-up challenge.

---

## Sites still using direct role checks (Wave 2C migration targets)

Counted via `git grep -E "role *=== *'(SUPER_ADMIN|COMPANY_ADMIN|...)'"` in production code. **21 sites remain** post-Wave-2A (Wave 1 cleared all `users.role` reads; these are post-resolver role string comparisons that need to migrate to capability checks).

Highest-leverage targets:

| Site | Current check | Suggested capability |
|---|---|---|
| pages/api/admin/consumption/apis.ts:40 | `role === 'COMPANY_ADMIN' \|\| role === 'ADMIN'` | `hasCapability(p, 'organization.manage')` |
| pages/api/admin/consumption/llm.ts:61 | same | same |
| pages/api/external-apis/index.ts:136,456 | `role === 'SUPER_ADMIN'` | `hasCapability(p, 'integration.manage')` (step-up: `integration.secrets.read`) |
| pages/api/external-apis/presets.ts:162 | `role === 'SUPER_ADMIN'` | `hasCapability(p, 'integration.manage')` |
| pages/api/team/self-joined.ts:44 | `role?.role === 'COMPANY_ADMIN'` | `hasCapability(p, 'organization.manage', { organizationId })` |
| pages/api/virality/playbooks/[id].ts:12, index.ts:45 | `role === 'SUPER_ADMIN' \|\| role === Role.COMPANY_ADMIN` | `hasCapability(p, 'organization.manage')` |
| pages/api/super-admin/free-credits/grant.ts:112 | `existingRole.role === 'SUPER_ADMIN'` (downgrade-to-admin logic) | leave as data check — NOT an authorization gate (it's a state-machine decision) |
| pages/api/super-admin/free-credits/requests.ts:119 | same | same — data, not authorization |
| pages/api/company-profile/* (4 sites) | `access.role === 'COMPANY_ADMIN'` for response shaping | `hasCapability(p, 'organization.manage', { organizationId })` |
| pages/super-admin/consumption.tsx:86,89 | UI role-string check | UI calls `/api/auth/capabilities` and reads the list |
| backend/tests/integration/user_lifecycle_management.test.ts | test fixture role checks | test-only; no migration needed |

---

## Orphan capabilities (not granted by any role)

Generated by `orphanCapabilities()` in `capabilityRegistry.ts`. These capabilities exist in the vocabulary but are unreachable until a `capability_assignments` row is created.

For Wave 2A, the orphan list is **empty** — every declared capability is reachable through some role or through the legacy bridge.

(Re-run `orphanCapabilities()` after each registry change to keep this guarantee.)

---

## How to migrate a role check (Wave 2C playbook)

**Before (current):**
```ts
if (access.role === 'COMPANY_ADMIN') {
  // do thing
}
```

**After (Wave 2C):**
```ts
import { decideCapability } from '../../backend/security/AuthorizationService';
import { resolvePrincipal } from '../../backend/security/IdentityResolver';

const principalResult = await resolvePrincipal(req);
if (!principalResult.ok) return res.status(401).json({ error: 'unauthenticated' });

const decision = await decideCapability(
  principalResult.principal,
  {
    capability: 'organization.manage',
    organizationId: companyId,
    reason: 'admin updates company profile',
  },
  { ip: clientIp(req), userAgent: req.headers['user-agent'] as string ?? null },
);

if (!decision.allowed) {
  return respondDenied(res, decision);
}
```

For step-up-protected capabilities, use `decideCapabilityWithStepUp` instead (passes both the AuthorizationRequirement and a StepUpRequirement).

Wave 2C will provide a codemod for the simple cases; the response-shape ones (e.g., the company-profile family) need handwritten conversions.
