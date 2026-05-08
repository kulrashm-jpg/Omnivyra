# Canonical Route Governance

This directory holds the **single source of truth** for primary routes (pages and APIs) across the application. Every nav component, deep-link CTA, redirect alias, codemod, and enforcement check reads from these registries.

## Goals

1. **Prevent shadowing** — when a new canonical page is added, the registry guarantees it dominates UI navigation. Older entries are demoted to `compatibility` and explicitly point to the new canonical via `canonicalKey`.
2. **Prevent stale routes from re-becoming primary** — every entry carries an explicit `lifecycle` classification. Deprecated and quarantined entries CANNOT appear in nav.
3. **Make audits cheap** — instead of grepping the codebase for `/settings/*`, `/admin/*`, etc., audits enumerate the registry and verify every entry is reachable / correctly classified.
4. **Keep enforcement honest** — the enforcement test (planned: `scripts/route-governance-check.ts`) compares hardcoded hrefs against the registry and fails CI on drift.

## Files

- **[routeLifecycle.ts](routeLifecycle.ts)** — `RouteLifecycle` taxonomy (`canonical | compatibility | deprecated | quarantined | experimental | dead`), `RouteDomain` enum, `RouteRegistryEntry` interface, helpers (`isReachableFromRuntime`, `isPrimaryNavTarget`).
- **[canonicalRegistry.ts](canonicalRegistry.ts)** — pages registry. Primary user-facing routes only; not exhaustive over `pages/*`.
- **[canonicalApiRegistry.ts](canonicalApiRegistry.ts)** — API registry. Primary frontend-consumed APIs.
- **[../settings/canonicalRegistry.ts](../settings/canonicalRegistry.ts)** — domain-specific settings sub-registry (Phase 4 / settings-canonical-dominance).
- **[../utils/safeFetchJson.ts](../utils/safeFetchJson.ts)** — defensive fetch helper for JSON consumers (Phase 4).

## Lifecycle classifications

| Classification | In nav? | In runtime? | Notes |
|---|---|---|---|
| `canonical` | ✅ primary nav target | ✅ | Exactly ONE per feature. |
| `compatibility` | ⚠️ may be reachable but MUST NOT dominate primary nav | ✅ | Typically a redirect alias. Has `canonicalKey`. |
| `deprecated` | ❌ | ⚠️ resolves but warns | Has `scheduledRemoval`. New code MUST NOT consume. |
| `quarantined` | ❌ | ❌ | Holding pen for unsafe / partial routes. Audit before promoting. |
| `experimental` | ⚠️ may appear behind a flag | ✅ for flagged users | Becomes canonical / compatibility / dead based on outcome. |
| `dead` | ❌ | ❌ | Candidate for deletion. |

## Adding a new canonical route

```ts
// 1. Add the page file: pages/my-feature.tsx
// 2. Add registry entry in canonicalRegistry.ts:
{
  key: 'mydomain.my_feature',
  path: '/my-feature',
  domain: 'mydomain',          // pick from RouteDomain
  lifecycle: 'canonical',
  description: 'What this surface does',
}
// 3. If replacing an older route, mark the old one:
{
  key: 'mydomain.legacy',
  path: '/legacy-feature',
  domain: 'mydomain',
  lifecycle: 'compatibility',
  canonicalKey: 'mydomain.my_feature',
  notes: 'Wave N redirect alias; remove after MM/DD.',
}
// 4. Update consumers (Header.tsx, GlobalHeader.tsx, deep-link CTAs)
// 5. Run typecheck + the enforcement test (when added)
```

## How consumers read the registry

```ts
import { CANONICAL_ROUTES, getCanonicalRoute } from '@/lib/routes/canonicalRegistry';

// Direct constant import (preferred for nav components):
import { SETTINGS_ROUTE_SECURITY } from '@/lib/settings/canonicalRegistry';
<Link href={SETTINGS_ROUTE_SECURITY}>Security</Link>

// Iteration (preferred for dynamic menus):
for (const route of CANONICAL_ROUTES.filter(r => r.lifecycle === 'canonical')) { … }

// Lookup by key:
const route = getCanonicalRoute('settings.security');
```

## Enforcement (planned)

A future enforcement check (`scripts/route-governance-check.ts`) will:
1. Grep `pages/`, `components/`, `lib/` for hardcoded `/...` paths.
2. Cross-check each match against `CANONICAL_ROUTES` + per-domain registries.
3. Fail if a hardcoded path is `deprecated` / `quarantined` / `dead`.
4. Warn if a hardcoded path is missing from any registry.
5. Fail if a `compatibility` path appears in a primary-nav component (Header.tsx, GlobalHeader.tsx, navigationConfig.tsx).

Until that enforcement lands, drift is caught by audit phases (this report + future reports).

## What this registry is NOT

- It is NOT exhaustive over the 224 pages / 830 API routes. Sub-routes, modal-only views, debug surfaces, and cron-only endpoints are intentionally excluded.
- It is NOT the place for one-off external integrations (webhooks, callback URLs).
- It is NOT a routing table for the framework itself — Next.js still resolves files in `pages/`. The registry only governs how UI / deep links / docs reference those routes.
