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
