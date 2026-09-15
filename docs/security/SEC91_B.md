# SEC91-B — Secrets / OAuth / credential security (STEP 3AH-91)

**Base:** `main @ f44b13875a8ce60da575197c516fa75bca946d4b` · **Branch:** `sec/3ah91-b-secrets-oauth` (worktree `C:/tmp/sec91-b`)
**Scope:** findings B1–B13 of the SEC-B registry. No production access, no network use, no env or secret changes, nothing rotated.

**Production constraint honoured.** Every fix works with the environment exactly as it stands:
- Vercel has `AUTH_SECRET`, `INVITATION_TOKEN_SECRET`, `ENCRYPTION_KEY`, `SESSION_COOKIE_SECRET`, `SUPABASE_SECRET_KEY` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. It does not have `EXTENSION_SESSION_SECRET`, `RPA_AUTH_SECRET`, `NEXTAUTH_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `OAUTH_STATE_HMAC_KEY`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN` or `STRIPE_WEBHOOK_SECRET`.
- Railway has `AUTH_SECRET`, `ENCRYPTION_KEY`, `INVITATION_TOKEN_SECRET`, `SUPABASE_SECRET_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.
- No fix requires a variable that is absent.

## 1. Inventory

| ID | Sev | Finding | Current status on base (evidence) | Classification | Files | Fix | Tests | Conflict risk |
|---|---|---|---|---|---|---|---|---|
| B1 | P1 | Signing-secret fallback chains ending in the public anon key, the service-role key or literals | `extensionSessionService.ts:12-27` (…→`SUPABASE_SERVICE_ROLE_KEY`→`NEXT_PUBLIC_SUPABASE_ANON_KEY`→literal; also used by `deriveExtensionHmacSecret`); `extensionClaimCodeService.ts:42-49` (literal); `rpaAuthTokens.ts:20-34` (service-role→literal); `invitationService.ts:23`; `super-admin/invitations/[invitationId]/resend.ts:42-54` (service-role→literal) | FIX | new `backend/auth/signingSecrets.ts`; the 5 files above; `supabaseApiKeyMigration.test.ts` | Dedicated secret → `AUTH_SECRET` (invitations: `INVITATION_TOKEN_SECRET` only). Otherwise `SigningSecretUnavailableError`: issuing throws, verifiers reject. Resend shares `getInvitationSigningSecret()` and answers 503 before touching email jobs. | `sec91BSigningSecrets` (23) | Low. SEC-B-owned files only. |
| B2 | P1 | External-API env-name exfiltration | `internalHelpers.ts:184` and `requestValidation.ts:51` resolve `process.env[name]` for any name; `execution.ts:285/311/334-357` apply it to `api_key_env_name` and every `{{ENV}}` header/query template sent to `base_url`; `[id].ts` PUT keeps `is_whitelisted` after a tenant edits `base_url`/env names/templates; ad-hoc `test.ts` gated `api_key_env_name` but not templates; `testEnvAllowlist` counted tenant-registered names | FIX | new `externalApi/envResolutionPolicy.ts` and `externalApi/infrastructureSecretNames.ts`; `execution.ts`, `internalHelpers.ts`, `requestValidation.ts`, `testEnvAllowlist.ts`, `providerAccountService.ts`, `pages/api/external-apis/[id].ts`, `pages/api/external-apis/test.ts` | A per-source env policy (see §2). A tenant edit of security-relevant fields revokes `is_whitelisted`. Infrastructure secrets are never resolvable anywhere. | `sec91BExternalApiEnvExfil` (14), `sec91BExternalApiWhitelistReset` (9) | Low. SEC-B-owned files. `indexMutations.ts` needed no change (tenant rows are already created with `is_whitelisted=false`). |
| B3 | P1 | Historically leaked credentials (public repo history) | Per the brief and the 2026-09-14 P0 audit record | MANUAL OPERATION REQUIRED | `docs/security/SEC91_B_CREDENTIAL_ROTATION.md` | Runbook: 13 credential classes, where to rotate, why, verification — no values | — | None |
| B4 | P2 | OAuth open redirect | `oauthState.ts:121` accepts any `returnTo` starting with `/` (`//evil`, `/\evil`); `:130` returns `returnTo` on an invalid signature; start routes sign `?returnTo=` verbatim; community-AI callbacks redirect to `statePayload.redirect` | FIX | new `backend/auth/safeRedirect.ts`; `oauthState.ts`; connector callbacks (B5) | One validator (single leading `/`, no `\`, no control characters, same origin after URL resolution), applied at encode and decode. Only a correctly signed state yields `returnTo`. All social, analytics and connector callbacks inherit this because they read `returnTo` from `decodeOAuthState`. | `sec91BOAuthRedirect` (44), `sec91BConnectorState` | Low |
| B5 | P2 | Unsigned community-AI OAuth state | `connectors/{meta,reddit}/auth.ts` `buildState` = base64 JSON; `{meta,reddit,linkedin}/callback.ts` trusted it (account-linking CSRF + redirect) | FIX | `connectors/utils.ts` (`mintConnectorOAuthState`, `readConnectorOAuthState`, `withQuery`); `meta/auth.ts`, `reddit/auth.ts`, `meta/callback.ts`, `reddit/callback.ts`, `linkedin/callback.ts` | Shared HMAC `oauthState` (company, tenant, session user, flow, provider, 10-min TTL, validated `returnTo`). Callbacks require a valid community-ai state, keep `requireManageConnectors`, and require the session user to be the starting user. | `sec91BConnectorState` (24) | Low. `status.ts` (SEC-A) untouched. |
| B6 | P2 | Secrets in logs | `x/callback.ts:307` logs the whole AxiosError (Basic client credentials); `tokenRefreshCore.ts:652` logs the whole AxiosError (`client_secret` + `fb_exchange_token` params); `:108/606/728` and `tokenRefreshFlows.ts:88/156/229/301` log raw provider bodies; `{linkedin,pinterest,spotify,tiktok}/callback.ts` log raw `errorText` (LinkedIn also re-throws it into `?error=`); `connectors/meta/callback.ts:137`; `metaDerivedAccountsService.ts:57` dumps the Graph body | FIX | new `backend/auth/safeErrorLog.ts`; `tokenRefreshCore.ts`, `tokenRefreshFlows.ts`, 8 `pages/api/auth/*/callback.ts`, `connectors/meta/callback.ts`, `metaDerivedAccountsService.ts` | `describeProviderError` / `summarizeProviderBody` / `redactSecrets`: flat, truncated output with no request config, headers or raw bodies; known-value and pattern redaction | `sec91BSecretLogRedaction` (17) | Low. `analyticsIntegrationServiceProviders.ts` (SEC-E) is not edited — proposal in §6. |
| B7 | P3 | OAuth-state HMAC key reuse, non-constant-time compare | `oauthState.ts:56-61` uses the raw `ENCRYPTION_KEY`; `:127` compares with `===` | FIX | `oauthState.ts` | Without `OAUTH_STATE_HMAC_KEY`, the key is `HMAC(ENCRYPTION_KEY,'omnivyra/oauth-state/v1')`; the compare uses `timingSafeEqual`. A dedicated key is still used verbatim. | `sec91BOAuthRedirect` (B7 block) | Low. In-flight states invalidate at deploy (§7). |
| B8 | P3 | Legacy plaintext `api_key_value` accepted | `providerAccountService.ts:252-254`. New writes are already encrypted (`buildCredentialEnvelope`, used by `provider-accounts/index.ts` and `[id].ts`). | FIX (visibility) + MANUAL (data) | `providerAccountService.ts` | Still resolves (no outage); now emits `PROVIDER_ACCOUNT_LEGACY_PLAINTEXT_KEY` once per account (account id only). | `sec91BMiscHardening` B8 | Low |
| B9 | P3 | In-memory replay / attempt state | `extensionSessionService.ts:99-155` nonce `Map`; `MfaAttemptLimiter.ts:56` `Map` (sync API used by 5 call sites, 2 of them in `backend/security/totp/**`) | INTENTIONALLY ACCEPTED (documented) | — | Design in §6 | — | — |
| B10 | P3 | WhatsApp verify-token empty echo | `whatsapp/webhook/index.ts:20,55`: `VERIFY_TOKEN = env ?? ''` and `token === VERIFY_TOKEN` | FIX | `pages/api/whatsapp/webhook/index.ts` | Unset or empty token → 403. Constant-time compare. Only a plain-token challenge is echoed, as `text/plain`. | `sec91BMiscHardening` B10 | None. The allowlist entry (webhook-signature) still passes. |
| B11 | P3 | (a) Password-reset gate bypassable; (b) sessionless passkey credential-id disclosure | (a) `auth/reset.ts` is only a rate-limit/captcha gate; `pages/login.tsx:359` calls `resetPasswordForEmail` directly; (b) `passkeys/begin-authentication.ts:32-40` honours a body `userId` without a session | (a) MANUAL OPERATION REQUIRED / accepted in code; (b) FIX | (b) `begin-authentication.ts`; `route-auth-allowlist.json` (reason text of this route's entry only) | (b) User-scoped ceremony only for the authenticated principal; body `userId` ignored. Every in-repo caller already sends `{}`. | `sec91BMiscHardening` B11 | Low |
| B12 | P3 | Encryption-key parsing inconsistency | `credentialEncryption.ts:15-30` guesses hex or base64 while `tokenStore.ts:41-60` is strict hex; `whatsappBroadcastService.ts:66,75` uses `ENCRYPTION_KEY ?? ''` | FIX (alignment) | `credentialEncryption.ts` (exports `requireEncryptionKey`), `whatsappBroadcastService.ts` | Strict 64-hex everywhere. Production is already hex (`tokenStore` and the schema refuse anything else), so key bytes are unchanged. | `sec91BMiscHardening` B12 | `whatsappBroadcastService.ts` is outside the listed ownership but was assigned to B12 (§5) |
| B13 | P2 | Payment webhook secret falls back to the API key secret | `payments/orchestrator/providerConfig.ts:45` `process.env[webhook] ?? process.env[secret]` | MANUAL OPERATION REQUIRED | none | Not changed: whether production has `RAZORPAY_WEBHOOK_SECRET` / `RAZORPAY_LIVE_WEBHOOK_SECRET` cannot be verified. For Cashfree, the fallback matches the provider's design (webhooks are signed with the client secret). See §7. | — | — |

## 2. What changed, per fix (before → after)

**B1.** Before: with `EXTENSION_SESSION_SECRET`/`AUTH_SECRET` unset, extension session tokens (and the derived request-signing secret), claim codes and RPA tokens were signed with the browser-public anon key, the service-role key or a literal from the repo; invitation tokens with the service-role key or `'local-dev-invite-secret'`. After: `resolveSigningSecret()` returns only the named variables (dedicated, then `AUTH_SECRET`), otherwise it throws `SigningSecretUnavailableError`. `verifyExtensionSessionToken` returns `null`, `verifyExtensionRequestSignature` returns `{ok:false,'SIGNING_SECRET_UNAVAILABLE'}`, and `verifyRpaAuthToken` returns `{ok:false,…}`. Invitations use `INVITATION_TOKEN_SECRET` (trimmed, as before) or fail. Production resolves `AUTH_SECRET` / `INVITATION_TOKEN_SECRET` byte-for-byte as before, so issued tokens keep verifying (the COMPAT tests pin the exact HMAC). `NEXTAUTH_SECRET` was dropped from the extension/RPA chains; it is not set in production. The migration test's four allowlist entries were removed because the files no longer name a Supabase key, and its "no stale entries" check would otherwise fail. That is the behaviour change the test pins, and the reason is recorded inline in the test.
Tests: `sec91BSigningSecrets.test.ts` — 17/23 failed on base, 23/23 pass. Mutation (re-add `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the chain) → 3 fail.

**B2.** Before: `process.env[anyName]` could be delivered to any `base_url`. After (`envResolutionPolicy.ts`), a name resolves only if all three hold:
- (1) it is a valid env name and not a platform infrastructure secret (Supabase/DB/Redis/Upstash/payment/Vercel/Railway/E2E prefixes; signing, webhook, worker, JWT, password, private-key and service-role suffixes; `ENCRYPTION_KEY`, `AUTH_SECRET`, …);
- (2) it is declared: a canonical `PROVIDER_CREDENTIALS` env name, a code-preset key or template, the row's own `api_key_env_name`/`api_key_name`, the provider account's env ref, or a name the ad-hoc gate approved;
- (3) the destination is approved: a platform row (`company_id IS NULL`); a tenant row with `is_whitelisted === true`; or a tenant row whose `base_url` origin equals the origin of the code preset declaring that key. This keeps company-installed presets working.

A refused name resolves to `undefined`, is reported in `missingEnv`, and its template stays literal. Also:
- tenant PUT changes to `base_url`, `method`, `auth_type`, env names, `headers` or `query_params` on a whitelisted row set `is_whitelisted=false` in the same UPDATE (response `whitelist_reset: true`, log `EXTERNAL_API_WHITELIST_RESET`);
- a tenant PUT for a row it does not own → 404 (was 500 with no write);
- the ad-hoc test route pre-approves only the allowlisted `api_key_env_name`;
- `testEnvAllowlist` ignores tenant-owned rows and refuses infrastructure secrets;
- the generic `resolveEnvValue` helpers and the provider-account env ref refuse infrastructure secrets.

Tests: `sec91BExternalApiEnvExfil` — 10/14 failed on base (the 4 that passed are the LEGITIMATE/compat cases), 14 pass. `sec91BExternalApiWhitelistReset` — 6/9 failed on base, 9 pass. Existing `externalApiTestEnvIsolation`, `externalApiSec001PlatformScope` and `providerCredentialResolution` stay green. Mutations: tenant treated as platform → 2 fail; denylist removed → 2 fail.

**B4.** Before: `decodeOAuthState('x.bad|//evil.example')` → `returnTo:'//evil.example'` (invalid signature), and the callbacks redirected there on the error path; `?returnTo=//evil` was signed at start. After: `safeRelativeRedirectPath()` rejects `//host`, `/\host`, `\\host`, absolute/scheme URLs, control or whitespace-control characters and more than 2048 characters. Encode drops unsafe values; decode returns `returnTo` only for a valid signature and re-validates it. Tests: `sec91BOAuthRedirect` — 36/44 failed on base, 44 pass. Mutations: validator accepts any `/…` → 14 fail; `returnTo` returned on a bad signature → 11 fail.

**B5.** Before: an attacker's authorization code plus a hand-written `state={tenant_id,organization_id,redirect}` completed a connection into any org the victim can manage, and redirected anywhere. After: signed state, user binding and validated redirect. Tests: `sec91BConnectorState` — 16/24 failed on base, 24 pass. Mutation (drop the user-binding check) → 1 fails.

**B6.** Before: logs contained Basic client credentials, `client_secret`, `fb_exchange_token` and `refresh_token`; the LinkedIn redirect carried the provider body. After: redacted summaries only. Tests: `sec91BSecretLogRedaction` — 14/17 failed on base, 17 pass. Mutation (X catch logs the raw error again) → 1 fails.

**B7.** Before: the HMAC key was the raw `ENCRYPTION_KEY`, compared with `===`. After: domain-separated derivation and `timingSafeEqual`. A dedicated `OAUTH_STATE_HMAC_KEY` is unchanged (COMPAT test). Mutation (raw key) → 2 fail.

**B8.** Before: silent. After: one `PROVIDER_ACCOUNT_LEGACY_PLAINTEXT_KEY` warning per account per process, without the value; resolution unchanged. **B10**, **B11 (b)** and **B12** are described in the inventory. `sec91BMiscHardening` — 8/12 failed on base, 12 pass.

## 3. Commands run and results

The jest command follows the brief (hermetic env, `--cacheDirectory …/jestcache91-b`):
- New suites: 7 files, **143 tests, all pass** (B1 23, B4/B7 44, B5 24, B6 17, B2 14 + 9, misc 12).
- Affected existing and new suites together (41 suites: all 7 `sec91B*` plus the 34 existing unit suites that import a changed module): **760 passed, 2 failed**. Both failures are in `recommendationFallbackSignal.test.ts`, which is pre-existing and non-hermetic: it performs a live OpenAI call through `aiGatewayCore` → `companyProfileService` and gets a 401 on the placeholder key. That path touches no SEC-B file, and I did not re-run it, to avoid further outbound calls.
- Related integration suites, run with `SUPABASE_URL=http://127.0.0.1:54321` (`community_ai_action_connectors`, `community_ai_rbac`, `external_api_{alignment,company_scope,health,presets,service}`, `social_platform_config`): 36/41 pass. The failures are not from SEC-B:
  - `external_api_service` fails the same 3 tests (403-vs-405, validate 403, fetch count) with SEC-B's source files reverted to base.
  - `external_api_alignment` and `external_api_company_scope` hit the 30 s jest timeout in one test each while run under heavy concurrent load; each makes live OpenAI attempts that end in 401 on the placeholder key. `external_api_alignment` passed when re-run alone on HEAD. `company_scope` "recommendation engine falls back" took 34.9 s on HEAD against 28 s total on base. That test mocks the whole `externalApiService`, so no SEC-B external-API code is on its path. It was not re-run, to avoid more outbound calls.
- `extensionDispatchLeaseRenewal.test.ts` fails to load on this machine because it reads `C:/Users/Admin/OneDrive/…/commandProcessor.js`, which does not exist here. That is pre-existing and environmental.
- Earlier targeted runs, all green: `sec91BSigningSecrets` + `supabaseApiKeyMigration` + `adminInviteUserAuthz` + `crossOrganizationIdentityAdminBinding` (45 tests); `sec91BOAuthRedirect` + `routeAuth001SocialOAuth` + `facebookInstagramSyncVisibility` (133); `sec91BConnectorState` + `routeAuth001SocialOAuth` (106); the external-API set (128).

Gates, all PASS:

| Gate | Result |
|---|---|
| `node scripts/check-route-auth.js` | PASS (1,322 routes) |
| `node scripts/check-tenant-authz.js` | PASS |
| `npm run -s check:ssrf` | PASS |
| `node scripts/check-migration-quality.js` | OK |
| `node scripts/check-withrbac-binding.js` | PASS (81 safe) |
| `node scripts/check-orgaccess-binding.js` | PASS (19 safe) |

TypeScript:
- A scoped `tsc` project over all changed or new source and test files (root compiler options, jest and node types; the transitive import graph is checked too) → **0 errors, exit 0**.
- The full `node node_modules/typescript/bin/tsc -p tsconfig.backend-tests.json --noEmit --incremental false` first reported 23 errors from SEC-B:
  - 22 in `sec91BExternalApiWhitelistReset.test.ts`, which lacked `import`/`export` and so collided as a global script (`type Row`);
  - 1 induced by that collision in `report2BaselineRead.test.ts`.

  Fixed by adding `export {}`. Every other error in that run is in test files SEC-B did not touch, with shapes unrelated to SEC-B APIs (pre-existing type debt; the certification baseline was not edited). The re-run result is in §3a.

### 3a. Full backend-tests `tsc` re-run (after `778518a`)

`node node_modules/typescript/bin/tsc -p tsconfig.backend-tests.json --noEmit --incremental false` → exit 2 with **260 errors in 79 files**, **0 of them in any file changed by SEC-B**. The `report2BaselineRead` collision is gone (it had 283 errors before the fix). The remainder is pre-existing test type debt in untouched suites; no certification baseline was edited.

Final re-run after the last commit: all 7 `sec91B*` suites plus `supabaseApiKeyMigration`, `externalApiTestEnvIsolation`, `externalApiSec001PlatformScope`, `routeAuth001SocialOAuth`, `providerCredentialResolution` and `credentialRemediation` → 13 suites, **323/323 pass**. All six gates PASS.

## 4. Commits (branch `sec/3ah91-b-secrets-oauth`)

| SHA | Subject |
|---|---|
| `93e550a` | fix(security): fail closed on missing HMAC signing secrets (SEC91-B1) |
| `9cde4e2` | fix(security): close OAuth returnTo open redirect; domain-separate state key (SEC91-B4, B7) |
| `e01156d` | fix(security): sign community-AI connector OAuth state and bind it to the user (SEC91-B5, B4) |
| `3740033` | fix(security): stop logging OAuth client secrets and tokens (SEC91-B6) |
| `4c7f29b` | fix(security): stop external-API sources exfiltrating server env vars (SEC91-B2) |
| `ce5827f` | fix(security): webhook verify fail-closed, passkey id disclosure, key parsing, plaintext visibility (SEC91-B8, B10, B11, B12) |
| `778518a` | test(security): make the SEC91-B2 whitelist-reset suite a module |
| (next) | docs(security): SEC91-B report and credential rotation runbook |

## 5. Files changed

**New:**
- `backend/auth/{signingSecrets,safeRedirect,safeErrorLog}.ts`
- `backend/services/externalApi/{envResolutionPolicy,infrastructureSecretNames}.ts`
- 7 test files `backend/tests/unit/sec91B*.test.ts`
- `docs/security/SEC91_B.md`, `docs/security/SEC91_B_CREDENTIAL_ROTATION.md`

**Modified, owned by SEC-B:**
- `backend/auth/{oauthState,credentialEncryption,tokenRefreshCore,tokenRefreshFlows}.ts`
- `backend/services/{extensionSessionService,extensionClaimCodeService,invitationService,providerAccountService,metaDerivedAccountsService}.ts`
- `backend/services/rpaWorker/rpaAuthTokens.ts`
- `backend/services/externalApi/{execution,internalHelpers,requestValidation,testEnvAllowlist}.ts`
- `pages/api/auth/{facebook,instagram,linkedin,pinterest,spotify,tiktok,x,youtube}/callback.ts`, `pages/api/auth/passkeys/begin-authentication.ts`
- `pages/api/community-ai/connectors/{utils,meta/auth,meta/callback,reddit/auth,reddit/callback,linkedin/callback}.ts`
- `pages/api/external-apis/{[id],test}.ts`
- `pages/api/super-admin/invitations/[invitationId]/resend.ts`
- `pages/api/whatsapp/webhook/index.ts`

**Flagged — outside the listed ownership:**
- `backend/services/whatsappBroadcastService.ts` — named in finding B12 and owned by no workstream; two lines now call the shared key parser.
- `scripts/route-auth-allowlist.json` (SEC-F) — only the `reason` text of the entry for `pages/api/auth/passkeys/begin-authentication.ts`, a route SEC-B owns, as the brief permits. The entry's kind and evidence are unchanged.
- `backend/tests/unit/supabaseApiKeyMigration.test.ts` — an existing test; its four entries became stale because of B1 (explained inline).

## 6. Cross-workstream proposals (not applied)

1. **SEC-E — `backend/services/analyticsIntegrationServiceProviders.ts:434-438, 471-476, 602`:** raw Google token and Admin/Sites API error bodies are logged and interpolated into thrown messages. The token-exchange body is what Google returns, and it is rendered into the GA/GSC callback's `?error=`. Proposed patch: `import { summarizeProviderBody } from '../auth/safeErrorLog'`, then log `body: summarizeProviderBody(body)` and throw `` `GA4 token exchange failed (${response.status}): ${summarizeProviderBody(body, { max: 160 }) || 'unknown error'}` `` (and the same at the other two sites).
2. **Unowned — `pages/api/extension/{bootstrap,redeem,session}.ts`, `pages/api/rpa/auth/start.ts`:** these routes already fail closed when no signing secret is configured, but answer **500** with the error message, which names variables and never values. Proposal: `if (isSigningSecretUnavailable(e)) return res.status(503).json({ error: 'SIGNING_SECRET_UNAVAILABLE' })`.
3. **Unowned — `pages/api/analytics/connect/google/callback.ts:11`:** `buildRedirectUrl` still checks `startsWith('/')`. It is already safe, because `returnTo` comes only from `decodeOAuthState`, which now validates it. For defence in depth, replace the check with `safeRelativeRedirectPath(returnTo, '/integrations?focus=data')`.
4. **Config — `config/env.schema.ts:221-228`:** the `OAUTH_STATE_HMAC_KEY` description says "falls back to ENCRYPTION_KEY". Suggested wording: "falls back to a key derived from ENCRYPTION_KEY (HMAC label omnivyra/oauth-state/v1)".
5. **B9 design (backend/security/totp/** is not SEC-B's; the Redis layer belongs to SEC-C):** a shared replay/attempt store would be `SET key 1 EX ttl NX` via `lib/redis/canonicalClient` (extension request nonces, 10-min TTL) and `INCR`+`EXPIRE` buckets (MFA). Both call chains are synchronous today — `verifyExtensionRequestSignature` and `MfaAttemptLimiter.check/recordFailure`, called from `TotpVerificationService`, `RecoveryCodeService`, `mfa-verify`, `recovery-login` and `passkeys/verify-authentication` — so the change has to be made async across two workstreams. Fail-closed semantics would also couple MFA sign-in and every extension request to Redis availability, and the platform's own Redis daily cap is a known trip-wire. The in-process state is therefore **accepted for now**, for these reasons:
   - an extension request replay also needs the per-session HMAC secret and a timestamp within ±5 min;
   - a TOTP brute force is bounded per instance and by the TOTP code space;
   - recovery codes are single-use in the DB.

   Recommended as a planned SEC-C/SEC-A item, with a fail-closed-with-circuit-breaker policy.

## 7. MANUAL OPERATION REQUIRED

1. **B3 — credential rotation:** execute `docs/security/SEC91_B_CREDENTIAL_ROTATION.md` in the order given: Railway tokens and DB password first, then the old OpenAI key, Meta, LinkedIn, Google, NewsAPI, SerpAPI and Anthropic, then the repository surface (visibility, ngrok webhook).
2. **B13 — payment webhook secrets (Razorpay):** in Vercel (and Railway if the worker verifies webhooks), set `RAZORPAY_WEBHOOK_SECRET` (test) / `RAZORPAY_LIVE_WEBHOOK_SECRET` (live) to the webhook secret configured in Razorpay Dashboard → Settings → Webhooks. It must be different from the API key secret; generate a new one there if needed. Once set everywhere, a follow-up change can make `providerConfig.getProviderCredentials` fail closed for Razorpay when the webhook variable is missing. Keep the Cashfree behaviour: Cashfree signs webhooks with the client secret. Why not now: nothing shows whether production relies on the fallback today; removing it blind could break payment webhooks. Verification: `vercel env ls production` lists the variable names; a Razorpay test-mode webhook delivery is accepted, and a delivery signed with the key secret is rejected.
3. **B8 — legacy plaintext provider-account keys:** watch for `PROVIDER_ACCOUNT_LEGACY_PLAINTEXT_KEY` in Vercel and Railway logs (or run `describeAccountCredentialState` over `api_provider_accounts` in a read-only operator session). For each account listed, re-enter the key in Super Admin → provider accounts; `buildCredentialEnvelope` encrypts it. Verification: `keyState === 'encrypted'` for every row, and the warning stops.
4. **B11 (a) — password reset:** the server gate cannot bind the browser's direct `supabase.auth.resetPasswordForEmail` call. In Supabase Dashboard → Authentication, enable **CAPTCHA protection** (hCaptcha or Turnstile, matching `CAPTCHA_PROVIDER`) and set the **rate limit for recovery emails**. Alternatively, a later code change can move reset-email sending server-side (admin `generateLink` + transactional email), after which the client call is removed. Verification: a `/auth/v1/recover` request without a captcha token is rejected by Supabase.
5. **Deploy notes, no action needed:**
   - B7 — OAuth states minted in the 10 minutes before the deploy fail as `invalid_oauth_state`; the user restarts the connect.
   - B5 — the same for community-AI Meta/Reddit connector flows in flight.
   - B10 — WhatsApp GET verification returns 403 while `WHATSAPP_WEBHOOK_VERIFY_TOKEN` is unset, which is also true today for any real Meta token. Set it before (re)subscribing the webhook.

## 8. Remaining limitations

- **B2:**
  - Provider-account literal keys (`api_key_value`, decrypted) attached to a tenant-owned source are not destination-checked; accounts are Super-Admin-managed and attached to platform rows in practice.
  - A Super Admin can still register an arbitrary non-infrastructure env name on a platform row — a trust decision; infrastructure secrets remain blocked.
  - Platform-row templates naming an env var that is neither the row's own key nor a declared provider/preset key now resolve as missing. The 2026-09-14 inventory recorded 14 platform rows; their templates were not re-read.
- **B6:** start routes (`pages/api/auth/*.ts`) still log raw local errors; they make no provider HTTP call. Pattern redaction is best effort (known values plus common parameter names).
- **B9:** accepted as in-process (§6).
- **B11 (a), B13, B3:** manual.
- **Full-suite `tsc` coverage:** the scoped project type-checks every changed file and its import graph, but not unrelated files. See the final report for the full backend-tests `tsc` re-run.
