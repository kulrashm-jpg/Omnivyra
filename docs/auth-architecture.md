# Auth Architecture

Canonical pattern for Omnivyra auth. **One** browser client. **One** server client. **One** validator. **One** fetch wrapper. Anything else fails CI lint.

## Canonical files

| Concern | File | Used by |
|---|---|---|
| Browser Supabase client | `lib/supabaseBrowser.ts` | All client-side code (pages, components, hooks) |
| Server Supabase client | `backend/db/supabaseClient.ts` | All server-side code (API routes, services, workers) |
| Server auth validator | `backend/services/authResolver.ts` | All API routes that authenticate a user |
| Client fetch wrapper | `lib/apiFetch.ts` | All authenticated `/api/*` calls from the browser |

## Server validator — which to use

| Function | When | Returns |
|---|---|---|
| `resolveAuthenticatedUser(req)` | Default. Route requires a pre-existing `public.users` row and lifecycle enforcement (deleted / suspended / session-revoked). | `{ user: { id, supabaseUid, email, emailVerified, status }, error }` |
| `extractAccessToken(req)` + `validateAuthToken(token)` | Route may receive a valid token for a user whose `public.users` row does not yet exist (e.g. `sync-supabase-user`, `verify-email`). | `{ supabaseUid, email, emailVerified } \| null` |

Both accept **Bearer header OR Supabase auth cookie**. No other auth sources.

## Token sources accepted

1. `Authorization: Bearer <supabase_jwt>` — primary, attached automatically by `lib/apiFetch.ts`.
2. Supabase auth cookie (`sb-<ref>-auth-token` and the legacy `auth-token` / `supabase-auth` names; chunked variants `.0`, `.1`, … are reconstructed).

No localStorage scraping. No JWT-claims fallback. No dev-mode bypass.

## Client fetch — required pattern

```ts
import { apiFetch } from '@/lib/apiFetch';

const res = await apiFetch('/api/whatever', { method: 'POST', body: JSON.stringify(payload) });
```

`apiFetch` does the following on every call:

1. Read access token via `getAuthToken()` (canonical browser singleton).
2. If null, **one** force-refresh via `auth.refreshSession()` then re-read.
3. Attach `Authorization: Bearer <token>` if present.
4. Always include `credentials: 'include'` for cookie-backed routes.
5. Synthesize a 503 Response on network failure (no thrown errors leak to call sites).

## Prohibited patterns

| Pattern | Why | Replace with |
|---|---|---|
| `import { supabase } from '@/utils/supabaseClient'` | File was deleted (duplicate browser singleton). | `getSupabaseBrowser()` from `@/lib/supabaseBrowser` |
| `import { verifySupabaseAuthHeader } from '@/lib/auth/serverValidation'` | Bearer-only validator; deleted. | `resolveAuthenticatedUser` (or `extractAccessToken` + `validateAuthToken`) |
| Inline `Authorization: \`Bearer ${token}\`` in client code | Stale-closure / refresh-race risk. | `apiFetch()` |
| Manual `req.headers.authorization?.replace('Bearer ', '')` in API routes | Skips cookie path; skips lifecycle enforcement. | `extractAccessToken(req)` from the canonical resolver |
| `createClient(...)` from `@supabase/supabase-js` anywhere except the two canonical files | Each call instantiates a fresh `GoTrueClient` that races with the singleton. | The two canonical files only. |
| `.or(\`supabase_uid.eq.${uid},email.eq.${email}\`)` for user lookup | Unsafe with values containing `@` / `.` / commas; resolver already does this. | `.eq('id', userId)` after `resolveAuthenticatedUser` returns. |

## Allowed carve-outs

- **Cron endpoints** (`pages/api/cron/**`) compare a `CRON_SECRET` Bearer token. This is NOT a Supabase JWT — it's out-of-band auth and exempt from these rules.
- **Third-party webhook handlers** (`pages/api/wordpress-plugin/**`, `pages/api/auth/*/callback.ts`, `pages/api/community-ai/connectors/**`) accept plugin / OAuth-provider tokens, not Supabase JWTs.
- **Server-side calls to external APIs** (`backend/services/**`, `backend/adapters/**`) construct `Bearer ${third_party_token}` headers when calling LinkedIn, OpenAI, etc. These are not Omnivyra auth.

## Required env vars

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_COOKIE_SECRET` (≥32 chars). Hard-validated at boot by `backend/utils/validateEnv.ts::assertAuthEnvOrThrow`. No fallback to `NEXT_PUBLIC_SUPABASE_URL`.

## Enforcement

`eslint.config.js` enforces:

- `no-restricted-imports` — bans `utils/supabaseClient`, `verifySupabaseAuthHeader`.
- `no-restricted-syntax` — bans inline `\`Bearer ${...}\`` template literals in client code.

Carve-out files are listed at the bottom of the same config.

## AUTH-001 — signup & security hardening layer (2026-07-13)

### App-level email-verification gate

`emailVerified` (mirrors `auth.users.email_confirmed_at`) is enforced in **application code** — the Supabase dashboard "Confirm email" setting is a first line, not the only line:

| Enforcement point | Behavior when unverified |
|---|---|
| `pages/api/auth/post-login-route.ts` | routes to `/login?reason=verify_email` (amber banner on login) |
| `pages/api/auth/verify-email.ts` | 403 `EMAIL_NOT_VERIFIED` — a session can never self-verify; `is_email_verified` only ever mirrors the auth confirm state |
| `pages/api/onboarding/profile.ts`, `setup-company.ts`, `complete.ts`, `request-company-access.ts` | 403 `EMAIL_NOT_VERIFIED` — onboarding, company creation, and credit grants are all gated |
| `pages/api/auth/sync-supabase-user.ts` | writes `is_email_verified: identity.emailVerified` (previously an unconditional `true`) |

`getSupabaseUserFromRequest` (legacy facade) now returns `emailVerified` so legacy routes can gate without a second token round-trip.

### Canonical signup events + correlation IDs

`backend/services/signupEventService.ts` — the ONE signup event vocabulary
(`SignupAttempted`, `SignupValidated`, rejection events, `VerificationSent/Succeeded`,
`CompanyCreated`, `CompanyExists`, `CreditsGranted`, `OnboardingStarted/Completed`,
`SystemFailure`) emitted into the EXISTING immutable audit trail
(`capability_audit_log` via `SecurityAuditService`), capability = `signup.<Event>`.

- The journey **correlation ID** is minted in `/api/auth/signup`, persisted at
  `signup_intents.intent_data.correlation_id`, recovered by email at every later
  stage, and stored in `capability_audit_log.resource_id`. Replay one journey:
  `SELECT * FROM capability_audit_log WHERE resource_id = $1 ORDER BY occurred_at`.
- Emission is fire-and-forget and never blocks a response.

### CAPTCHA (config-gated, provider-agnostic)

`lib/auth/captcha.ts` (server) + `components/auth/CaptchaWidget.tsx` (client).
Providers: Turnstile / hCaptcha / reCAPTCHA — same verify contract, one URL per provider.
**Disabled until configured**: set `CAPTCHA_PROVIDER` + `CAPTCHA_SECRET_KEY` (server)
and `NEXT_PUBLIC_CAPTCHA_PROVIDER` + `NEXT_PUBLIC_CAPTCHA_SITE_KEY` (client) together.
Enforced on `signup`, `resend-verification`, `reset`. Fail-closed on bad/missing token;
fail-open on provider outage (same rationale as the rate-limiter SDR).

### Validation single sources of truth

| Concern | Canonical module | Notes |
|---|---|---|
| Public/free email providers | `lib/auth/publicEmailDomains.ts` | union of all prior lists + rediff; env extension `PUBLIC_EMAIL_EXTRA_DOMAINS`; DB layer (`public_email_providers`, `disposable_domains`) still applied by `domainEligibilityService` |
| Password policy | `lib/auth/passwordPolicy.ts` | 8–128 length-only (NIST 800-63B); client + server import it |
| Eligibility codes & copy | `lib/auth/domainEligibilityModel.ts` | added `PARKED_DOMAIN` (reviewable) |

### Parked/expired-domain detection

`backend/services/parkedDomainDetectionService.ts` — one bounded GET (256 KiB / 4 s,
via `safeFetch`) on the identity-validation success path only; high-specificity
markers; fail-open; positive match → `PARKED_DOMAIN` manual review with a
`diagnostics.parkedMarker`. WHOIS expiry checks were deliberately not added
(no client, blocked egress; DNS/MX gates already catch dropped domains).

### Rate limits added by AUTH-001

| Endpoint | Limit |
|---|---|
| `POST /api/auth/check-user` | 20 / 15 min / IP (endpoint also neutralized: constant response, fail-closed, single constant-work lookup, audited) |
| `POST /api/onboarding/setup-company` | 10 / h / IP + 5 / h / UID |
| `POST /api/onboarding/request-company-access` | 5 / h / UID |

### Database hardening

`supabase/migrations/20260713_auth001_signup_hardening.sql` —
`idx_signup_intents_email_pending_unique` (one pending intent per email; older
duplicates retired to `status='expired'`) and `idx_companies_website_domain_unique`
(guarded: skipped with a WARNING if live duplicates exist; no data loss).
`setup-company`'s 23505 race handler resolves winners by either domain key.

### Tests

`backend/tests/unit/auth001*.test.ts` (6 suites) + updated identity-validation
suites (deterministic `probeParked` stub) + refreshed stability contract
(`tests/stability/billing/signupCreditsContract.test.ts`).
