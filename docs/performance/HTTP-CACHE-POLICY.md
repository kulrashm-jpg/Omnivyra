# HTTP Cache Policy — Canonical Reference

**Status:** ACTIVE — v1, 2026-08-02 (OPT-002 Phase 1 Browser Cache)
**Single source of truth in code:** `lib/platform/httpCache.ts`
**Related:** `PERFORMANCE_OPTIMIZATION_LEDGER.md` (OPT-002), `docs/security/AUTH-ENFORCEMENT-ARCHITECTURE.md` (INV-6)

Every API/page response maps to **exactly one** of the five policies below. Ad-hoc `Cache-Control` strings are prohibited — emit headers only through the helper. Routes that predate this policy (37 files as of 2026-08-02) are grandfathered until touched.

## Policy matrix

| Policy | Exact headers | Applies to | Never applies to |
|---|---|---|---|
| **P1 — Public immutable** | `Cache-Control: public, max-age=31536000, immutable` | Content-hashed static assets only (`/_next/static/*` — Next.js emits this itself; no helper exists on purpose) | Any API route, any HTML document |
| **P2 — Public SWR** (`setPublicSwr`) | `Cache-Control: public, s-maxage=<S>, stale-while-revalidate=<W>` (defaults 300/600) | Tenant-free, identity-free responses with a **written justification at the call site** (e.g. blog RSS/sitemap) | Anything that reads a tenant- or user-scoped table; anything served after auth resolution |
| **P3 — Private browser cache** (`setPrivateCache`) | `Cache-Control: private, max-age=<TTL>` + `Vary: Authorization, Cookie` | Guarded, read-only GET 200s classified SAFE / CONDITIONALLY SAFE. `private` bars every shared cache (CDN included); `Vary` keys entries by principal for Bearer **and** cookie auth | Side-effectful GETs; multi-principal routes not yet classified; error responses |
| **P4 — Private no-store** (`setPrivateNoStore`) | `Cache-Control: private, no-store` | Sensitive per-user reads that must never persist: sessions, billing instruments, admin/super-admin responses, in-progress onboarding journey | — |
| **P5 — Never cache** (`setNeverCache`) | `Cache-Control: no-store, no-cache, must-revalidate` + `Pragma: no-cache` | Machine/security endpoints: auth flows, webhooks, cron, internal/service, anything carrying secrets or signatures | — |

**P3 TTL tiers** (`CACHE_TTL`, the only valid values): `NEAR_LIVE` = 30 s (counts, notification lists, progress-adjacent lists) · `STANDARD` = 60 s (settings, stats, connection lists) · `STABLE` = 300 s (reference data, terminal-state payloads).

## Standing rules

1. **No `public` or `s-maxage` may ever co-occur with tenant data** (INV-6). `setPublicSwr` is the only shared-cache emitter and is reserved for explicitly public routes.
2. **`Vary: Authorization, Cookie` is non-negotiable on P3.** Legacy super-admin and SSR-cookie principals send no `Authorization` header; without `Cookie` in the Vary key, same-browser principal switches could collide.
3. **Headers go on the success (200 GET) path only.** Error responses (4xx/5xx) and mutation methods ship with no cache directives.
4. **Absence of a policy on a new read-only GET means "not yet classified" — never "cache it".** Classification requires per-route reading (auth mechanism, tenant scope, GET side effects, mutation invalidation), not grep.
5. **A GET with side effects must never be cached** (reference counter-example: `social-accounts/status` piggybacks proactive OAuth token refresh on GET).
6. **A plain refetch does not bypass the browser cache.** If a client refetches a GET after a mutation expecting to see the write, that route cannot use P3 (counter-examples: `engagement/platform-counts`, `engagement/work-queue`).
7. **Same-URI mutations auto-invalidate** (RFC 9111 §4.4): a successful POST/PUT/PATCH/DELETE to the exact URL of a cached GET invalidates that browser cache entry. Cross-URI mutations invalidate nothing.

## OPT-002 pilot inventory (the only cached routes as of v1)

| Route (GET 200) | Policy | Invalidation |
|---|---|---|
| `/api/notifications` | P3 · 30 s | Optimistic client update after PATCH; mark-all PATCH is same-URI (auto-invalidated) |
| `/api/accounts` | P3 · 60 s | TTL only — connect/disconnect are cross-URI with no refetch contract |
| `/api/reports` | P3 · 30 s | TTL only — duplicate generation guarded server-side in `reports/generate` |
| `/api/onboarding/journey` | P4 while in progress · P3 300 s when `platformReady` | State-dependent; stage POST is same-URI and returns the refreshed journey |
| `/api/engagement/integrations` | P3 · 60 s | TTL only — consumer never refetches after connect/disconnect |
| `/api/social-platforms/content-type-prefs` | P3 · 60 s | Optimistic update + same-URI PUT auto-invalidation |
| `/api/lead-intelligence/stats` | P3 · 60 s | TTL-bounded — since OPT-005 Phase 2C, lead operations trigger an SWR revalidation of stats/leads/overlay; the stats refetch may be answered by this 60 s browser cache, so post-operation stats freshness is bounded by the TTL (never worse than the pre-2C no-refetch behaviour) |

**Excluded (do not cache without a new classification):** `social-accounts/status` (side-effectful GET), `external-apis/company-config` (cookie-principal 200s + server-side cache invalidation on write), `company-profile` (multi-principal, UNKNOWN), `engagement/platform-counts` + `engagement/work-queue` (refetch-after-mutation contracts — revisit under OPT-005/SWR).

## Tests

- `backend/tests/unit/httpCache.test.ts` — byte-exact policy strings; the private helpers have no code path emitting `public`/`s-maxage`.
- `backend/tests/integration/opt002PilotRouteCacheHeaders.test.ts` — every pilot route: exact headers on 200; **no** cache header on 400/401/403/405/500 or on any mutation method.
