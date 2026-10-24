# Closure-013 — D-3 privileged-write authorization

Branch: `integration/closure-013-d3`, child of `integration/closure-013-security` @ `46eb9e96`, which is itself a child of
`integration/closure-012-resume` @ `e04f8708`. Local only, with no push, PR, merge, deploy, migration or production
access.

## 1. Root cause

Platform-tier capabilities (`backend/security/platformCapabilities.ts`) are confined to the SUPER_ADMIN *role* by a
boot-time invariant. They are not confined when granted **directly**:
- `CapabilityService.resolveUserCapabilities` merges every non-revoked `capability_assignments` row into
  `principal.capabilities`.
- `AuthorizationService.holdsCapabilityInOrganization` returns `true` for any platform-tier capability without an
  organisation binding.

So a VIEW_ONLY tenant user (or a deactivated SUPER_ADMIN) holding a direct grant passed `requireCapability` on platform
writes. Every route that relied on the capability alone, without `requirePlatformWriteAuthority`, was exposed.
Closure-012 proved this on real infrastructure for `platform-oauth-configs` and `analytics-provider-config`.

`capability_assignments` has no application writer, so grants come only from out-of-band database inserts. No
product-supported delegation depends on platform-tier write grants.

## 2. Changes

| Layer | Change | Commit |
|---|---|---|
| 9 OAuth/integration route/method pairs | Route-level `enforcePlatformWriteAuthority` after `requireCapability` | `46eb9e96` (pre-existing, kept as defence in depth) |
| `requireCapability` (central) | A principal that **holds** a platform-tier **write** capability is refused with 403 `PLATFORM_SUPER_ADMIN_REQUIRED` unless it has platform write authority (active `SUPER_ADMIN` membership, non-bridge). This applies to any method other than GET/HEAD/OPTIONS, including a missing method. The check runs **before** the capability/step-up decision, so a refusal records exactly one `elevated_route_denied` row and never `allowed` or `elevated_route_accessed`. | this branch |

What the central guard deliberately leaves unchanged:
- **Read-only platform capabilities** (`super_admin.dashboard.view`, `consumption.view.aggregate`) are excluded. They never authorize writes, and Closure-009 kept POST reads such as planner-control `evaluate` open to grantees.
- **Non-holders** keep the established `CAPABILITY_NOT_HELD` denial and audit shape.
- **Step-up policies** are unchanged. An active SUPER_ADMIN without step-up still gets 401 `STEP_UP_REQUIRED` wherever a policy is registered.
- **Reads, input validation and success response contracts** are unchanged. No grants were broadened.

## 3. Routes and methods now refused for a non-authority holder

**OAuth / integration management** (policy: dedicated capability `integration.platform.oauth.manage` + phishing-resistant
step-up on a trusted device + active platform SUPER_ADMIN). Rate limiting is unchanged:
- `curated-industry-sources` and `linkedin-media-smoke-test` were already rate-limited;
- `platform-oauth-configs`, `analytics-provider-config` and `provider-accounts` are not rate-limited.

| Route | Methods |
|---|---|
| `super-admin/platform-oauth-configs` | POST, DELETE |
| `super-admin/analytics-provider-config` | POST |
| `provider-accounts` | POST |
| `provider-accounts/[id]` | PUT, DELETE |
| `super-admin/curated-industry-sources` | POST, PATCH, DELETE |
| `super-admin/linkedin-media-smoke-test` | POST |

GA/GSC connect, select-property and sync already required platform authority (`requireSuperAdminGaWriteAccess`,
Closure-009). Closure-012's A9 run confirmed this on real infrastructure.

**Statically discovered siblings: 54 routes, 65 route/method pairs** (policy: the platform-tier capability + its
registered step-up + active platform SUPER_ADMIN, now enforced centrally).

| Area | Routes (methods) |
|---|---|
| Access requests | `admin/access-requests/approve` (POST), `delete` (DELETE), `reject` (POST) |
| Billing | `admin/billing/allocate`, `admin/billing/reconcile`, `super-admin/billing-catalog` (POST, PATCH), `super-admin/credit-cost-config/update`, `super-admin/monetization/operations`, `super-admin/payment-providers` (PATCH), `super-admin/purchases/complete`, `super-admin/razorpay/create-staging-order`, `super-admin/razorpay/verify-staging-payment` |
| Credits and plans | `super-admin/credits/grant`, `super-admin/free-credits/grant`, `free-credits/requests`, `free-credits/revoke`, `super-admin/plans/assign`, `plans/create`, `plans/override`, `plans/toggle`, `super-admin/pricing`, `super-admin/usage/grant-access`, `usage/revoke-access` (POST, DELETE) |
| Identity | `admin/bootstrap-super-admin` (promote mode), `admin/revoke-super-admin`, `super-admin/rbac`, `super-admin/users` (POST, PATCH, DELETE), `super-admin/users/create`, `users/[id]/force-logout`, `users/[id]/resume`, `users/[id]/suspend`, `super-admin/invitations/[invitationId]/resend`, `super-admin/companies` (DELETE, POST, PATCH), `companies/archive-abandoned`, `companies/promote-admin`, `companies/transfer-ownership` |
| Content / intelligence / ops | `admin/blog` (POST), `admin/blog/[id]` (PATCH, DELETE), `admin/blog/relationships` (POST, DELETE), `admin/blog/series` (POST), `admin/blog/series/[id]` (PATCH, DELETE), `admin/config/[type]`, `admin/cron-config`, `admin/queue-config`, `admin/experiment/toggle`, `admin/intelligence/scheduler-boost`, `scheduler-config` (PUT), `scheduler-overrides` (POST, DELETE), `throttle-status` (PUT), `admin/knowledge-graph/canonical-topic` (POST, DELETE), `embed-topic`, `topic` (POST, PATCH), `super-admin/community-ai-policy` |
| Tombstone | `admin/platform-oauth-configs/index` (410 `ENDPOINT_GONE` for everyone, unchanged) |

Unlisted methods are POST.

**Exposure proven by mutation.** With the central guard disabled:
- 65 of 66 sibling pairs authorize a VIEW_ONLY direct-grant holder; the 66th is the tombstone.
- 57 pairs authorize a deactivated SUPER_ADMIN holding direct grants.
- 52 pairs authorize a worst-case bridge principal. The real bridge is hard-expired (Closure-012 A10), so this is defence in depth.

## 4. Regression coverage

**`closure013OauthIntegrationWriteAuthorization.test.ts`** (from `46eb9e96`, extended) covers the 10 OAuth surfaces.
It drives the real `requireCapability` → `resolvePrincipal` → capability-resolution chain. Each surface is called by:
- a direct-grant VIEW_ONLY user;
- a tenant admin;
- no principal;
- plain and all-caps bridge principals;
- a deactivated SUPER_ADMIN;
- a SUPER_ADMIN with no step-up, TOTP step-up, or an untrusted device;
- an authorized SUPER_ADMIN, which reaches the effect;
- an authorized SUPER_ADMIN with invalid input, which keeps the established validation response.

It also covers rate limiting. New in this branch: a refused grantee leaves no `allowed` or `elevated_route_accessed` row.

**`closure013PlatformTierWriteSiblings.test.ts`** (new) covers all 65 sibling pairs through the real route handlers,
including `withIdempotency` and the rate-limit wrappers. Each pair is called by:
- a direct grant of every platform-tier capability (expects 403 `PLATFORM_SUPER_ADMIN_REQUIRED` and an `elevated_route_denied` row naming the actor and session);
- read-only grants;
- a tenant admin;
- a deactivated SUPER_ADMIN with grants;
- a worst-case bridge;
- no principal.

On every refusal the test requires zero business writes, zero RPCs, zero business-table reads and zero outbound
`fetch` (global fetch is a refusing spy), plus no `allowed` or `elevated_route_accessed` row for a write capability.

Guard-level tests through the real `requireCapability` check:
- classification of all 15 write-tier capabilities × methods;
- a refusal that happens before the decision;
- a missing method treated as a write;
- an authorized SUPER_ADMIN passing;
- step-up still enforced for the 12 capabilities that register a policy;
- `CAPABILITY_NOT_HELD` preserved for non-holders;
- GET unchanged;
- read-only capabilities not guarded.

A static completeness test fails if any file under `pages/api` or `backend/apiHandlers` names a platform-tier write
capability without going through `requireCapability` or a platform-authority helper.

**Not exercised end to end:** the authorized SUPER_ADMIN path and invalid-input responses of the 54 sibling routes.
Their effects include real providers (Razorpay, email, GoTrue admin) and credit/billing writes. The guard-level tests
prove an authorized SUPER_ADMIN passes the guard unchanged, and the routes' code below `requireCapability` is
untouched.

## 5. Gates (final tree)

| Gate | Result |
|---|---|
| Focused authorization suites (36) | 36/36, 1264/1264 |
| Closure-013 suites (final tree) | OAuth suite 141/141; sibling suite 491/491 |
| Mutants | 11/11 KILLED. M1 guard never fires; M2 fires for non-holders; M3 guards read caps; M4 GET as write; M5 missing method as read; M6 denial code; M7 audit decision; M8 audit actor; M9 bridge as authority; M10 deactivated SUPER_ADMIN as authority; M11 audit-only, no refusal. |
| Gate regression (124-suite set + all authorization suites = 153) | 153/153; 3905 passed, 0 failed, 2 skipped; vs `e04f8708`: 0 new failures, 0 missing tests |
| `node scripts/typecheck-certification.js` | PASS, 259/259, 0 uncovered |
| `npm run typecheck` | 3/3 projects clean |
| `node scripts/check-migration-quality.js` | OK (no migrations added) |
| Whole-repo `jest` (1977 suites, informational) | 29 suites / 106 tests fail — the IDENTICAL failing-suite set as `e04f8708` (0 new, 0 fixed); the known whole-repo baseline, CI is not a whole-repo job |

## 6. Remaining items (not changed here)

1. **Production data check (owner):** list `capability_assignments` rows that grant a platform-tier write capability to a
   user without an active SUPER_ADMIN role. Those users lose platform write access with this change, which is the intended effect. The agent cannot query production.
2. **Rate limiting** is absent on many sibling platform-wide controls (billing, plans, credits, access requests, blog,
   intelligence) and on `platform-oauth-configs` / `provider-accounts`. Limits are per-route decisions.
3. **No step-up policy** is registered for `intelligence.override.manage`, `cron.config.manage` or
   `blog.publish.manage`, so those platform writes need no step-up.
4. **Pre-authorization ordering:** `withIdempotency` reserves an `api_idempotency_keys` row before the handler
   authorizes. Several routes validate the body before authorizing, with no data access.
5. **Root-cause hardening option:** ignore platform-tier direct grants in `resolveUserCapabilities` for non-SUPER_ADMIN
   principals. That would also affect reads; it is an owner decision.

In-memory tests prove ordering and decisions, not Postgres RLS or production behaviour.
