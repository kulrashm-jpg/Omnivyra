# SEC91-W2E — trusted client IP outside the auth routes (STEP 3AH-91)

**Base:** `sec/3ah91-integration @ b286744` · **Branch:** `sec/3ah91-w2e-clientip` · **Worktree:** `C:/tmp/sec91-w2e` · not pushed, not merged.

**Scope:** the residual of SEC-E E2b, SEC-D §6.1 and SEC-W2B proposal 3. No production system was contacted. No network call was made, and no environment variable or secret was changed. Test fixtures use RFC 5737 documentation addresses and `fake-…` values.

**Production constraint:** production runs on Vercel. The edge sets `x-real-ip` and overwrites `x-forwarded-for` / `x-vercel-forwarded-for` with the connecting client's address, so production was not spoofable. The code relied on that without saying so. Off Vercel (a local or self-hosted deployment, or any proxy that appends to the header), the first hop is whatever the client wrote.

## 1. Inventory

| ID | Sev | Finding | Current status on base (evidence file:line) | Classification | Files | Fix | Tests |
|---|---|---|---|---|---|---|---|
| W2E-1 | P3 | Server code outside `pages/api/auth/**` takes the client IP from the FIRST `x-forwarded-for` hop, which the client writes. It is used for rate-limit keys (access requests, domain verification, the admin limiter on 60 call sites, the env-credential bootstrap limiter, the public tracking and capture limiters), stored IP hashes, and audit fields | 21 direct reads in 19 files (18 fixed here, plus TenantGuard). **Rate-limit keys:** `pages/api/access/request.ts:35`, `pages/api/domain/regenerate-token.ts:59`, `track-event.ts:52`, `verification-status.ts:73`, `verify.ts:72`, `pages/api/website-events/track.ts:59`, `pages/api/website/lead-capture.ts:35`, `backend/services/requestAccessService.ts:20`, `backend/services/signupEventService.ts:310` (`requestIp`, also the IP key of `onboarding/setup-company`), `pages/api/admin/bootstrap-super-admin.ts:559` (env-credential failure limiter). **Stored or hashed IP:** `pages/api/tracking/link-click.ts:42`, `website-events/track.ts:59` (`tracking_events.ip_hash`), `pages/api/super-admin/community-ai-policy.ts:164`, `content-architect-login.ts:74,90` (`super_admin_audit_logs.ip_address`, the raw header, unsplit). **Audit and session-row fields:** `backend/security/legacyCookieSuperAdminBridge.ts:122`, `backend/security/requireCapability.ts:249`, `backend/services/superAdminSession.ts:86`, `pages/api/admin/platform-oauth-configs/index.ts:30`, `pages/api/super-admin/login.ts:72`, `content-architect-login.ts:43` (`auth_sessions.ip`, `capability_audit_log.ip`). **Not owned here:** `backend/security/TenantGuard.ts:532` | **FIX** (TenantGuard: patch for the orchestrator, §5) | `lib/security/clientIp.ts` (+ `getTrustedClientIpOrNull`) and the 18 site files listed in §2 | Every site now uses `lib/security/clientIp`. `getTrustedClientIp` is used where the old contract defaulted to `'unknown'`, and `getTrustedClientIpOrNull` where it was `string \| null`. Each site's null / `'unknown'` / `''` contract is kept (§2) | `sec91W2EClientIpAdoption` (35) |

## 2. Before and after, per site

"Old" is the value produced when both XFF and the socket peer are present; "absent" is the value when nothing parses.

| Site | Use of the IP | Old | New | Absent: old → new |
|---|---|---|---|---|
| `pages/api/access/request.ts:35` | `sha256(ip+salt)` → `access_request_rate_limit.ip_hash` (3 per 24 h) | first XFF hop | `getTrustedClientIp(req)` | `'unknown'` → `'unknown'` |
| `pages/api/domain/{verify,regenerate-token,track-event,verification-status}.ts` | `checkRateLimit(ip, …)` (runs before auth) | first XFF hop | `getTrustedClientIp(req)` | `'unknown'` → `'unknown'` |
| `backend/services/requestAccessService.ts:20` `requireAdminRateLimit` | `checkRateLimit(ip, …)` and a log field (60 call sites) | first XFF hop | `getTrustedClientIp(req)` | `'unknown'` → `'unknown'` |
| `backend/services/signupEventService.ts:310` `requestIp` | signup audit `ip`; `onboarding/setup-company` IP rate-limit key; `auth/verify-email`, `onboarding/profile` audit | first XFF hop | `getTrustedClientIp(req)`. The `Record<string, unknown>` parameter type is kept, with a narrowing cast | `'unknown'` → `'unknown'` |
| `pages/api/website-events/track.ts:59` | in-memory limiter key `${websiteId}:${ip \|\| anonymousId}`; `tracking_events.ip_hash = hashIp(ip)` | first XFF hop | `getTrustedClientIpOrNull(req) ?? ''` | `''` → `''` (key falls back to `anonymous_id`; `ip_hash` null) |
| `pages/api/website/lead-capture.ts:35` | `evaluateCaptureProtection({ ip })` | first XFF hop | `getTrustedClientIpOrNull(req)` | `null` → `null` |
| `pages/api/tracking/link-click.ts:42` | `audit_logs.metadata.ip_hash = sha256(ip)` | first XFF hop (or `[0]` of an array) | `getTrustedClientIpOrNull(req)` | `null` → `null` (`ip_hash` null) |
| `pages/api/admin/bootstrap-super-admin.ts:559` | env-credential failure limiter (5 per 60 s, key `ip ?? '<unknown>'`); audit `ip` | first XFF hop | `getTrustedClientIpOrNull(req)` | `null` → `null` (key `'<unknown>'`) |
| `pages/api/super-admin/community-ai-policy.ts:164` | `super_admin_audit_logs.ip_address` (TEXT) | the **whole** raw XFF header, unsplit | `getTrustedClientIpOrNull(req)` | `null` → `null` |
| `pages/api/super-admin/content-architect-login.ts:43,74,90` | two `super_admin_audit_logs.ip_address` inserts (raw header, unsplit) now go through the file's existing `clientIp()`; `clientIp()` feeds `auth_sessions.ip` and the audit | raw header / first hop | `getTrustedClientIpOrNull(req)` | `null` → `null` |
| `pages/api/super-admin/login.ts:72` | `createSession({ ip })` → `auth_sessions.ip` (`inet`); audit | first XFF hop | `getTrustedClientIpOrNull(req)` | `null` → `null` |
| `pages/api/admin/platform-oauth-configs/index.ts:30` | audit `ip` (410 tombstone route) | first XFF hop | `getTrustedClientIpOrNull(req)` | `null` → `null` |
| `backend/security/requireCapability.ts:249` | audit `ip`; `decideCapabilityWithStepUp` context (audit only, `AuthorizationService.ts:72-199`) | first XFF hop | `getTrustedClientIpOrNull(req)` | `null` → `null` |
| `backend/services/superAdminSession.ts:86` | audit / log `ip` in `getLegacySuperAdminSession` | first XFF hop (or `[0]`) | `getTrustedClientIpOrNull(req)` | `null` → `null` |
| `backend/security/legacyCookieSuperAdminBridge.ts:122` | audit / log `ip` in `resolveLegacyCookieSuperAdminPrincipal` | first XFF hop (or `[0]`) | `getTrustedClientIpOrNull(req)` | `null` → `null` |

**Session binding — none.** No site compares the IP against a stored value.
- `superAdminSession`, the legacy bridge, `requireCapability` and `platform-oauth-configs` pass it only to `logSecurityEvent` / `logCookieSuperAdminUsage` / `logger`.
- `super-admin/login` and `content-architect-login` write it once into `auth_sessions.ip` at creation. `SessionAuthorityService.ts:407` copies it forward on rotation; it is never compared.
- `AuthorizationService` puts the step-up context `ip` only into audit rows.

No live session can be invalidated, and on Vercel the value is identical anyway: `x-real-ip` equals the edge-set first XFF hop.

**Small tightenings (intentional):**
- Values are now validated with `net.isIP` and normalised (port and `::ffff:` stripped).
- `community-ai-policy` and `content-architect-login` used to store the whole unsplit XFF list, which the client can inflate. They now store one address.
- `auth_sessions.ip` is `inet`, so a malformed value could previously fail the insert; that can no longer happen.

**New helper:** `lib/security/clientIp.ts` `getTrustedClientIpOrNull(req)` is `getTrustedClientIp` with `'unknown'` mapped to `null`. It is equivalent to `backend/auth/requestClientIp.authRequestIpOrNull`, but lives next to the resolver, so non-auth code does not import an auth-named module.

## 3. Tests

`backend/tests/unit/sec91W2EClientIpAdoption.test.ts` — 35 tests. The database is faked with `routeAuthHarness`. Limiters, audit sinks and the capture and tracking services are faked at their module boundary. Every other part of each route runs for real.

1. **Behavioural, off-platform** (`VERCEL` unset, no `TRUSTED_PROXY_HOPS`, `x-forwarded-for: 198.51.100.7, 203.0.113.10`, socket peer `203.0.113.10`): the key or recorded IP is the socket peer. Covered:
   - `domain/verify`, `regenerate-token`, `track-event`, `verification-status`;
   - `access/request` (the hashed bucket; the peer's full bucket cannot be escaped);
   - `website-events/track` (limiter key and the stored `ip_hash`);
   - `website/lead-capture` (protection IP);
   - `tracking/link-click` (`ip_hash`);
   - `admin/bootstrap-super-admin` (six wrong env-credential attempts, each with a different spoofed XFF: 5×401, then 429);
   - `content-architect-login` (the audit `ip_address`);
   - `requestIp`, `requireAdminRateLimit`, `requireCapability` (the unauthenticated audit row), `getLegacySuperAdminSession` and `resolveLegacyCookieSuperAdminPrincipal` (the rejected-cookie audit).
2. **COMPAT Vercel** (`VERCEL=1`, `x-real-ip` = XFF = `x-vercel-forwarded-for` = `203.0.113.20`): the recorded value equals the edge value, i.e. production behaviour is unchanged. Covered: the 4 domain routes, access/request, track, lead-capture, link-click, `requestIp`, `requireAdminRateLimit`, `requireCapability` and the bridge.
3. **Contract kept when nothing parses:** domain → `'unknown'`; track → key `websiteId:anonymous_id`, `ip_hash` null; lead-capture → `null`; link-click → `ip_hash` null; `requestIp` → `'unknown'`.
4. **Source pin:** no `.ts/.tsx/.js/.mjs/.cjs` file under `pages/api`, `backend` or `lib` reads `headers['x-forwarded-for']` or `headers.get('x-forwarded-for')`. Tests and `__tests__` are excluded. Allowed: `lib/security/clientIp.ts`, `backend/auth/requestClientIp.ts`, `backend/services/ai/trustedClientIp.ts`. The file has an explicit, commented **PENDING** list containing only `backend/security/TenantGuard.ts`. A companion test fails once the pending file is clean, which tells the orchestrator to remove the entry.

**Mutation check.** The 18 site files were reverted to `b286744`; the new `lib` helper and the tests were kept. Result: **21 failed / 14 passed of 35**.
- The 21 failures are every off-platform test, every "absent" test that saw the spoofed header, and the source pin.
- The 14 passes: the 11 COMPAT-Vercel tests (behaviour is the same on base, as intended), the helper test, the file-count test and the pending-list test.

The sources were then restored (`git status` clean).

## 4. Commands and results (from `C:/tmp/sec91-w2e`, hermetic env sourced for jest)

| Command | Result |
|---|---|
| jest `sec91W2EClientIpAdoption` | 35/35 pass |
| jest: the new suite + every suite under `backend/tests` referencing a changed module or route (grep) + `sec91EClientIp`, `sec91W2BAuthClientIp`, `sec91DAiRouteSpend`, `superAdminSessionGuardrails`, `routeAuth001Scanner` (70 unique files) | **70 suites, 1163 tests, all pass** (no suite matches `requireCapability*` by name; the 24 suites that reference `requireCapability` are included) |
| mutation (sites reverted) | 21 fail / 14 pass |
| `node scripts/check-route-auth.js` | PASS (2 pre-existing KNOWN OPEN, unchanged) |
| `node scripts/check-tenant-authz.js` | PASS (8 grandfathered = baseline) |
| `npm run -s check:ssrf` | PASS |
| `node scripts/check-secrets.js` | PASS (re-run after commit: 11364 tracked files) |
| `node scripts/check-constant-time-secrets.js` | PASS |
| `node scripts/check-withrbac-binding.js` | PASS (81 SAFE) |
| `node scripts/check-orgaccess-binding.js` | PASS (19 SAFE) |
| `node scripts/security/run-gate-tests.js` | 14 suites, 306 tests, all pass |
| `node scripts/typecheck-baseline.js` | PASS: baseline 0, actual 0 (3/3 projects clean) |
| `tsc -p tsconfig.worker.json --noEmit --incremental false` | exit 0 |
| `node scripts/typecheck-certification.js` | PASS: backend 0/0; backend-tests 260/260 (baseline), fingerprints net-new 0. The first run flagged 2 net-new TS2345 errors in the new test (the `requireCapability` options lacked the required `reason`); the test was fixed in a follow-up commit and the re-run passes |

## 5. For the orchestrator: `backend/security/TenantGuard.ts`

`TenantGuard.ts:531-535` has the same first-hop reader. It feeds only the `ip` field of the two `logSecurityEvent` audit rows (`:469`, `:504`) and is never a binding. The patch below was checked with `git apply --check` against this branch:

```diff
diff --git a/backend/security/TenantGuard.ts b/backend/security/TenantGuard.ts
--- a/backend/security/TenantGuard.ts
+++ b/backend/security/TenantGuard.ts
@@ -62,6 +62,7 @@ import { seedRequestContextFromRequest } from '../services/requestContext';
 import { defineRolloutFlag, resolveRolloutSync } from '../../lib/platform/rollout';
 import { runWithRollout } from '../../lib/platform/rolloutAdmin';
 import { memoRequest } from '../services/requestScopedMemo';
+import { getTrustedClientIpOrNull } from '../../lib/security/clientIp';
 
 // ── Public types ─────────────────────────────────────────────────────────────
 
@@ -528,10 +529,9 @@ function httpStatusForReason(reason: TenantAccessFailureReason): number {
   }
 }
 
+// SEC91-W2E: platform-trusted client IP (audit field only).
 function clientIp(req: NextApiRequest): string | null {
-  const xff = req.headers['x-forwarded-for'];
-  if (typeof xff === 'string') return xff.split(',')[0]?.trim() ?? null;
-  return req.socket?.remoteAddress ?? null;
+  return getTrustedClientIpOrNull(req);
 }
 
 function userAgent(req: NextApiRequest): string | null {
```

After applying it, the orchestrator must also remove `'backend/security/TenantGuard.ts'` from the `PENDING` set in `backend/tests/unit/sec91W2EClientIpAdoption.test.ts`; the "pending list is still accurate" test fails until that is done. The null contract is unchanged. The patch depends on `getTrustedClientIpOrNull`, which this branch adds.

## 6. Remaining limitations

- **Two resolvers still exist.** `backend/services/ai/trustedClientIp.ts` (SEC-D1: `TRUSTED_CLIENT_IP_HEADER`, never XFF, null result) and `lib/security/clientIp.ts` (SEC-E2) differ in inputs. Consolidating them is still open (see SEC91_W2B.md).
- **Deployments that are neither Vercel nor configured** see the socket peer. Behind an unconfigured reverse proxy that is the proxy's address, so every client shares one bucket (fail-closed, noisy). The operator must set `TRUSTED_PROXY_HOPS`. This is the SEC-E2 design and unchanged here.
- **The source pin matches only the literal header-read forms.** It would not catch a computed header name (`headers[name]`) or a non-`headers` alias. `x-real-ip` / `x-vercel-forwarded-for` reads are not pinned outside `pages/api/auth` (none exist today).
- **The new suite is not in the inventory-pinned CI runner** (`scripts/security/run-gate-tests.js`). It runs in the normal jest suite. Adding it to the runner is an option for the SEC-F owner, whose `sec91W2FCiWiring` pins that inventory.
