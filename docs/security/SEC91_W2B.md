# SEC91-W2B — Wave-2 secrets / OAuth (STEP 3AH-91)

**Base:** `sec/3ah91-integration @ cc39f85` (wave 1, SEC-A…F merged) · **Branch:** `sec/3ah91-w2b-secrets` · **Worktree:** `C:/tmp/sec91-w2b`

**Scope:** registry W2B-1 … W2B-6. There was no production access and no network use, and no environment variable or secret was changed.

**Production constraints honoured:**
- Vercel production has no `OAUTH_STATE_HMAC_KEY`, `EXTENSION_SESSION_SECRET` or `RPA_AUTH_SECRET`. Every fix works with that environment as it stands; no fix needs a new variable.
- Production runs on Vercel, where the edge overwrites `x-forwarded-for` and sets `x-real-ip` / `x-vercel-forwarded-for`.

## 1. Inventory

| ID | Sev | Finding | Current status on base (evidence file:line) | Classification | Files | Fix | Tests | Conflict risk |
|---|---|---|---|---|---|---|---|---|
| W2B-1 | P2 | `requireManageConnectors` cookie fallback skips the account-state checks | `pages/api/community-ai/connectors/utils.ts:46-75` (base). The canonical `getSupabaseUserFromRequest` is called first. On **any** error (`ACCOUNT_DELETED`, `ACCOUNT_SUSPENDED`, `SESSION_REVOKED`, `ACCOUNT_INVITED`…) it fell back to its own `@supabase/ssr` `createServerClient(...).auth.getUser()` plus a bare `users.select('id').eq('supabase_uid', …)`. GoTrue still accepts the tokens of these accounts, because deletion, suspension and revocation are application-level. The fallback therefore re-admitted every account the resolver had rejected, to start and finish connector OAuth (writing provider tokens for the org). `getUserRole` (`rbacService.ts:176-195`) does not check the user's state. Reproduced for 5 account states. | **FIX** | `connectors/utils.ts` | Fallback removed; the canonical resolver is the only identity path. It already reads the Supabase auth cookie that browser navigation carries (`authResolver.ts:271-311`; `sb-<ref>-auth-token`, chunked `@supabase/ssr` envelopes). Legitimate cookie sessions keep working. | `sec91W2BConnectorAuth` (13) | Low |
| W2B-2 | P2/P3 | OAuth `redirect_uri` builders trust `X-Forwarded-Host` / `Host` | See the list below the table. | **FIX** | new `backend/auth/oauthRedirectBase.ts`; `getBaseUrl.ts`, `connectors/utils.ts`, `connectors/x/auth.ts`, `connectors/linkedin/auth.ts`, `auth/x.ts`, `auth/x/callback.ts` | In production (`NODE_ENV=production`, every Vercel deployment), only the configured canonical app URL is used: `NEXT_PUBLIC_APP_URL`, lower-cased with the trailing slash stripped, exactly as `getBaseUrl` normalised it. In development and test the request origin is used, with each provider's loopback spelling (`localhost` for connectors, `127.0.0.1` for X). The LinkedIn connector start now uses `getCanonicalOAuthRedirectUri('linkedin')`, the same builder its shared callback uses for the exchange. | `sec91W2BRedirectOrigin` (22) | Low |
| W2B-3 | P3 | Auth routes key rate limits on the first `X-Forwarded-For` hop | Two patterns on base (details below the table); `check-user.ts:46` config had no `sensitive`. | **FIX** | new `backend/auth/requestClientIp.ts`; 29 files under `pages/api/auth/**` | `authRequestIp(req)` / `authRequestIpOrNull(req)` are thin adapters over SEC-E's `lib/security/clientIp.getTrustedClientIp`. `check-user` now has `sensitive: true`. On Vercel the key is the same client address as before. | `sec91W2BAuthClientIp` (25) | Medium-low: one to three lines in each of 29 route files |
| W2B-4a | P3 | Raw token-exchange error body logged in the Meta connector callback | `connectors/meta/callback.ts:139` already logs `summarizeProviderBody(errText, { secrets: [client_secret, code] })` (SEC91-B6, commit `3740033`). The other log lines in the connector callbacks log status codes or `err.message` only. | **ALREADY FIXED** | — | — | `sec91BSecretLogRedaction` "community-AI meta connector…" (passes on this branch) | — |
| W2B-4b | P3 | GA/GSC callback redirect does not use `safeRelativeRedirectPath` | `analytics/connect/google/callback.ts:10-14`: `returnTo.startsWith('/')` accepts `//host`, `/\host` and `/\t/host`. Today every `returnTo` comes from `decodeOAuthState` (validated since B4), directly or through `handleGoogleOAuthCallback` (`analyticsIntegrationServiceSync.ts:86,133`), so this is defence in depth. | **FIX** | `analytics/connect/google/callback.ts` | `buildRedirectUrl` calls `safeRelativeRedirectPath(returnTo, '/integrations?focus=data')` | `sec91W2BCallbackRedirect` (7) | Low |
| W2B-5 | P3 | Extension and RPA routes answer 500 with the env-var names | `extension/bootstrap.ts:45`, `redeem.ts:86`, `session.ts:47-49` and `rpa/auth/start.ts:65` return `error.message`, i.e. `SIGNING_SECRET_UNAVAILABLE: … (set EXTENSION_SESSION_SECRET or AUTH_SECRET)`. Reproduced. | **FIX** | the 4 routes | `isSigningSecretUnavailable(e)` → **503** `{ error: 'SIGNING_SECRET_UNAVAILABLE' }`. Any other failure → 500 with the route's generic message, never `error.message`. The error is still logged server-side (names only, no values). | `sec91W2BSigningSecret503` (9) | Low |
| W2B-6 | P3 | `OAUTH_STATE_HMAC_KEY` description says it falls back to `ENCRYPTION_KEY` | `config/env.schema.ts:220-228`. The real fallback is `HMAC-SHA256(ENCRYPTION_KEY,'omnivyra/oauth-state/v1')` (`oauthState.ts:48-63`). | **FIX** (text) | `config/env.schema.ts` (comment + `.describe` only) | Wording names the derived, domain-separated key and its label. Validation is unchanged. | `sec91W2BEnvSchemaText` (4) | None |

**W2B-2 evidence (base):**
- `backend/auth/getBaseUrl.ts:31-49` returned the request origin whenever the forwarded host merely *claimed* `localhost` / `127.0.0.1`, ahead of `NEXT_PUBLIC_APP_URL`, and fell back to the request host when no URL was configured.
- The following used `X-Forwarded-Host || Host` unconditionally:
  - `connectors/utils.ts:21-28` (`getCommunityAiConnectorCallbackUrl`; used by the meta and reddit start routes and callbacks);
  - `connectors/x/auth.ts:46-48`;
  - `connectors/linkedin/auth.ts:30-32`;
  - `auth/x.ts:16-20`;
  - `auth/x/callback.ts:16-20,127` (the token exchange).
- Reproduced: `X-Forwarded-Host: attacker.example` produced `redirect_uri=https://attacker.example/…`, and a production request claiming localhost got `http://localhost:3000`.

**W2B-3 evidence (base):**
- `String(req.headers['x-forwarded-for'] ?? socket).split(',')[0]` in `login.ts:29-31`, `reset.ts:28`, `signup.ts:70`, `check-domain.ts:30`, `check-user.ts:43-45`, `accept-invite.ts:35`, `resume-status.ts:34-36`, `resend-verification.ts:51-53`, `resend-invitation.ts:47-49` and `sync-supabase-user.ts:96-100`. `magic-link.ts:38-40` preferred `x-real-ip` but fell back to the first XFF hop.
- 19 identical `clientIp()` helpers returning the first XFF hop: `mfa-verify.ts:234`, `recovery-login.ts:188`, `passkeys/*`, `totp/*`, `step-up/verify.ts:185`, `sessions/revoke.ts:135`, `devices/*`, `logout.ts:70`, `set-password.ts:180`. They feed the `MfaAttemptLimiter` IP buckets (mfa-verify, recovery-login, passkey primary login) and the security-audit `ip` values.
- Reproduced for 10 rate-limited routes and for the recovery-login MFA bucket.

## 2. FIX details: before → after, tests, mutation check

"Base" means the branch start `cc39f85`. W2B-3 … W2B-6 suites were run before their source files were edited. For W2B-1 and W2B-2 the fixed source files were replaced with their `cc39f85` version, the suites were run, and the files were restored. Targeted mutations were applied the same way and reverted.

- **W2B-1**
  - Before: a soft-deleted, `status=deleted`, suspended, session-revoked (`iat < session_revoked_after`) or invited COMPANY_ADMIN with a browser cookie session got `{ userId, role }` back, i.e. access.
  - After: 401 `UNAUTHORIZED`. Active members keep access by cookie and by Bearer token; non-members still get 403.
  - Test `sec91W2BConnectorAuth.test.ts` runs the real `authResolver`, legacy facade and `rbacService`; only GoTrue and the DB are faked. The `@supabase/ssr` fake validates the same cookie the way GoTrue would.
  - Base: **6/13 fail** (the 5 bypasses and the source check). After: 13/13.
  - Mutation: restoring the fallback gives the same 6 failures.
- **W2B-2**
  - Before: production `getBaseUrl({x-forwarded-host: localhost:3000})` returned `http://localhost:3000`. `/api/auth/x`, the connector x/linkedin/meta/reddit starts and the `/api/auth/x/callback` token exchange all used `https://attacker.example/…` when that host was sent.
  - After: `https://www.omnivyra.com/…` in every case.
  - COMPAT tests pin that production strings for requests on the canonical host are byte-identical, including the lower-casing and trailing-slash normalisation. They also pin the development behaviour: localhost pinning, `127.0.0.1` for X, and `localhost` for connectors.
  - Base: **14/22 fail**. After: 22/22.
  - Mutation (`isRequestDerivedOriginAllowed()` always true): **9 fail**.
- **W2B-3**
  - Before (off-Vercel): `X-Forwarded-For: 6.6.6.6` chose the bucket on all 10 rate-limited auth routes and on the recovery-login MFA IP gate.
  - After: the socket peer is used. On Vercel, `x-real-ip` is used, which is the same client as before (COMPAT, 11 tests).
  - `check-user` limit now has `sensitive: true`. A repo assertion checks that no `pages/api/auth/**` file reads `headers['x-forwarded-for' | 'x-real-ip' | 'x-vercel-forwarded-for']` itself.
  - Base: **13/25 fail**. After: 25/25.
  - Mutation (the adapter returns the first XFF hop again): **11 fail**.
- **W2B-4b**
  - Before: `//evil.example/phish?error=…`, `/\evil.example/…` and `/\t/evil.example…` were used as redirect targets when handed to `buildRedirectUrl`.
  - After: `/integrations?focus=data&…`. A same-origin `returnTo` keeps its own query string.
  - Base: **5/7 fail**. After: 7/7 (a revert is the mutation).
- **W2B-5**
  - Before: 500 with `SIGNING_SECRET_UNAVAILABLE: no server-only signing secret is configured for … (set EXTENSION_SESSION_SECRET or AUTH_SECRET)`.
  - After: 503 `{ error: 'SIGNING_SECRET_UNAVAILABLE' }`, with no variable name in the body.
  - COMPAT: with `AUTH_SECRET` set (the production situation), all four routes return 200 with tokens as before. An anonymous caller still gets 401.
  - Base: **4/9 fail**. After: 9/9.
- **W2B-6**
  - Base: **2/4 fail**. After: 4/4. The validation tests (optional, 64 hex characters) pass on both.

## 3. Commands run and results

The jest command follows the brief: hermetic env, `--cacheDirectory …/jestcache91-w2b`, run from the worktree.

| Command | Result |
|---|---|
| 6 new suites `sec91W2B*` | 6/6 suites, **80/80 pass** (13 + 22 + 25 + 7 + 9 + 4) |
| Base reproduction (sources at `cc39f85`) | 44 of the 80 fail, as listed in §2 |
| All 50 `backend/tests/unit/sec91*` suites + `auth001EndpointContracts`, `invitedActivationFlip`, `onboard002Routing`, `onboard003Consolidation`, `recoveryCodeIdentityIsolation`, `routeAuth001Scanner`, `routeAuth001SocialOAuth`, `facebookInstagramSyncVisibility`, `supabaseApiKeyMigration`, `internalMetricsSecretNoDefault` | **60/60 suites, 954/954 tests pass** |
| Integration (`SUPABASE_URL=http://127.0.0.1:54321`): `community_ai_action_connectors`, `community_ai_rbac`, `community_ai_rpa` | 3/3 suites, 22/22 pass |
| `node scripts/check-route-auth.js` | PASS (0 reviewed method exemptions) |
| `node scripts/check-tenant-authz.js` | PASS (8 grandfathered, no new) |
| `npm run -s check:ssrf` | PASS (5,598 server files) |
| `node scripts/check-migration-quality.js` | OK (no migrations added) |
| `node scripts/check-withrbac-binding.js` | PASS (81 safe) |
| `node scripts/check-orgaccess-binding.js` | PASS (19 safe) |
| `node scripts/check-secrets.js` | PASS (11,352 tracked files, 15 patterns) |
| `node scripts/security/run-gate-tests.js` | 9/9 suites, 220/220 pass |
| `tsc -p tsconfig.backend-tests.json --noEmit --incremental false` | exit 2: **260 errors in 79 files, all pre-existing** (same totals as the SEC-B/SEC-E runs), **0 in any new test or changed source file**. All 6 new test files are modules (they import). |
| Scoped `tsc` over all 45 changed/new `.ts` files (root options, jest and node types; the import graph is checked too) | **exit 0, 0 errors** |

## 4. Commits (branch `sec/3ah91-w2b-secrets`)

| SHA | Subject |
|---|---|
| `229b5b6` | fix(security): connector auth via canonical resolver; pin OAuth redirect_uri origin in production (SEC91-W2B-1, W2B-2) |
| `bc6a8ee` | fix(security): auth routes key rate limits and MFA buckets on the trusted client IP (SEC91-W2B-3) |
| `44c8436` | fix(security): GA/GSC OAuth callback redirects through safeRelativeRedirectPath (SEC91-W2B-4) |
| `d4179f2` | fix(security): 503 with a plain code when extension/RPA signing secrets are absent (SEC91-W2B-5) |
| `3a3f6b6` | docs(config): OAUTH_STATE_HMAC_KEY description names the derived fallback key (SEC91-W2B-6) |
| (next) | docs(security): SEC91-W2B report |

## 5. Files changed

Every file is inside this wave's ownership. None was flagged: `scripts/route-auth-allowlist.json`, existing tests and harness files were not touched.

**New:**
- `backend/auth/oauthRedirectBase.ts`, `backend/auth/requestClientIp.ts`
- 6 test files `backend/tests/unit/sec91W2B{ConnectorAuth,RedirectOrigin,AuthClientIp,CallbackRedirect,SigningSecret503,EnvSchemaText}.test.ts`
- `docs/security/SEC91_W2B.md`

**Modified:**
- `backend/auth/getBaseUrl.ts`
- `config/env.schema.ts` (comment and description only)
- `pages/api/community-ai/connectors/{utils,x/auth,linkedin/auth}.ts`
- `pages/api/auth/{x,x/callback}.ts`
- `pages/api/analytics/connect/google/callback.ts`
- `pages/api/extension/{bootstrap,redeem,session}.ts`, `pages/api/rpa/auth/start.ts`
- 29 files under `pages/api/auth/**` for W2B-3: `accept-invite`, `check-domain`, `check-user`, `devices/{revoke,trust}`, `login`, `logout`, `magic-link`, `mfa-verify`, `passkeys/{begin-authentication,begin-registration,revoke,verify-authentication,verify-registration}`, `recovery-login`, `resend-invitation`, `resend-verification`, `reset`, `resume-status`, `sessions/revoke`, `set-password`, `signup`, `step-up/verify`, `sync-supabase-user`, `totp/{begin-enrollment,recovery,recovery/regenerate,revoke,verify-enrollment,verify}`.

## 6. Cross-workstream proposals (not applied)

1. **Two trusted-client-IP implementations (SEC-E + SEC-D) — consolidate.**
   - `lib/security/clientIp.ts` (SEC-E) and `backend/services/ai/trustedClientIp.ts` (SEC-D) differ in four ways:
     - SEC-E trusts `x-real-ip`, then `x-vercel-forwarded-for`, then the first XFF hop when `VERCEL` is truthy. SEC-D reads `x-real-ip` / `x-vercel-forwarded-for` only when `VERCEL === '1'` and never reads XFF.
     - Off-Vercel trust: SEC-E uses `TRUSTED_PROXY_HOPS` (n-th entry from the right); SEC-D uses `TRUSTED_CLIENT_IP_HEADER`, a single operator-named header.
     - Validation: SEC-E uses `net.isIP` with normalisation; SEC-D uses a character-class regex.
     - Result when nothing parses: SEC-E returns `'unknown'`; SEC-D returns `null`.
   - The auth routes use SEC-E's helper (through `backend/auth/requestClientIp.ts`), as the registry directs.
   - Proposal: keep one resolver in `lib/security/clientIp.ts` that supports both `TRUSTED_PROXY_HOPS` and `TRUSTED_CLIENT_IP_HEADER`. Make `resolveTrustedClientIp` a wrapper (`ip === 'unknown' ? null : ip`). Pin the Vercel behaviour with one shared test.
2. **Unowned — `pages/api/notifications.ts:22-50`** has the same `@supabase/ssr` fallback as W2B-1 (`resolveUserId`: canonical resolver, then `createServerClient().auth.getUser()` plus a bare `users.supabase_uid` lookup). A deleted, suspended, revoked or invited account can read its own notifications with a cookie session. Proposed patch: make `resolveUserId` `return (await getSupabaseUserFromRequest(req)).user?.id ?? null;`, drop the `@supabase/ssr` and publishable-key imports, and reuse the `sec91W2BConnectorAuth` test pattern. (`feature-completion.ts` and `readiness-score.ts` already removed their fallback, per their comments.)
3. **SEC-E residual:** 19 non-auth server files (`pages/**`, `backend/**`, `lib/**`, tests excluded) still read `headers['x-forwarded-for']` directly (SEC-E §8). They should adopt `getTrustedClientIp` the same way.
4. **Telemetry only (this wave's files, not changed):** `request_origin` in the `logOAuthEvent` calls of the OAuth callbacks still records `X-Forwarded-Host || Host`. It is a logged string that never builds a URL. Optional: log `safeHost(getBaseUrl(req))` instead.

## 7. MANUAL OPERATION REQUIRED

1. **Confirm the canonical app URL and the registered callbacks (W2B-2).** These are read-only checks; the values are public URLs, not secrets.
   - Where: Vercel project `omnivyra` → production env `NEXT_PUBLIC_APP_URL`, and the X, LinkedIn, Meta and Reddit developer consoles.
   - What: confirm `NEXT_PUBLIC_APP_URL` is the canonical host users browse (expected `https://www.omnivyra.com`, which is also the schema default). Confirm these callbacks are registered, as Super Admin → Social Platforms lists them:
     - `${NEXT_PUBLIC_APP_URL}/auth/x/callback`;
     - `${NEXT_PUBLIC_APP_URL}/api/auth/linkedin/callback`;
     - `${NEXT_PUBLIC_APP_URL}/api/community-ai/connectors/{meta,reddit}/callback`.
   - Why: X and the community-AI connectors used to follow the request host in production. They now use `NEXT_PUBLIC_APP_URL`. For traffic on the canonical host the string is unchanged. The `getBaseUrl` providers (Facebook, Instagram, LinkedIn social, Pinterest, Spotify, TikTok, YouTube, Google) already used `NEXT_PUBLIC_APP_URL` in production, so nothing changes for them.
   - Also: remove any `http://localhost*` redirect URI registered on a production OAuth app (SEC-E §6.3). Production can no longer produce one.
   - Verification: after deploy, start an X connect and a community-AI Meta connect from the canonical host; both reach the provider consent screen without a `redirect_uri` mismatch.
2. **Optional hardening, no action required for these fixes:** set dedicated `OAUTH_STATE_HMAC_KEY`, `EXTENSION_SESSION_SECRET` and `RPA_AUTH_SECRET` (64-hex / high-entropy) in Vercel so that those token families no longer depend on `ENCRYPTION_KEY` / `AUTH_SECRET`. Setting one invalidates that family's in-flight tokens: OAuth states (10 min), extension sessions (12 h), RPA tokens. Only do it together with a planned re-login.
3. **Deploy notes (no action):**
   - Cookie sessions of deleted, suspended, session-revoked or not-yet-accepted invited accounts can no longer start or finish community-AI connector OAuth. This is intended; the canonical resolver already refuses them on every other route.
   - An X or connector OAuth flow started on a non-canonical host (for example a `*.vercel.app` alias or a preview) now returns to the canonical host. The user may need to restart it. Preview deployments now send X and connector OAuth to `NEXT_PUBLIC_APP_URL`, as the `getBaseUrl` providers already did.
   - A `next start` production build run on localhost now uses `NEXT_PUBLIC_APP_URL` for OAuth. `next dev` and the E2E dev server (`NODE_ENV=development`) keep using localhost.

## 8. Remaining limitations

- **W2B-2:** "production" means `NODE_ENV` other than `development` or `test`, and unset counts as production (fail-closed). A non-Vercel staging environment that wants request-derived callbacks must run with `NODE_ENV=development` or set `NEXT_PUBLIC_APP_URL` to its own host.
- **W2B-3:** off Vercel the key is the socket peer unless `TRUSTED_PROXY_HOPS` is set, so all clients behind an unconfigured reverse proxy share one bucket. That is the SEC-E design, documented there. The in-process `MfaAttemptLimiter` state remains accepted (SEC-B B9).
- **W2B-4b:** defence in depth only. No exploitable path existed on this base.
- **Observation, not in the registry and not changed:** `analytics/connect/google/callback.ts:53` logs `req.url`, which includes the single-use Google authorization `code` and the `state`. The code needs the client secret to redeem and is exchanged immediately, so the risk is low. Optional follow-up: log the path only.
- **W2B-5:** `/api/extension/redeem` marks the claim code redeemed before issuing. If the secret disappears between bootstrap and redeem (seconds apart), the user retries bootstrap. This behaviour is unchanged.
