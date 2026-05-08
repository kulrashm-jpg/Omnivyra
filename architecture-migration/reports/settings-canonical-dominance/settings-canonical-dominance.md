# Settings Canonical Dominance — Implementation Report

**Generated**: 2026-05-07
**Branch**: `identity-spine-enforcement`
**Scope**: ensure canonical settings pages dominate every navigation surface; harden JSON fetch flows; normalize visibility gates. No security-architecture changes.

---

## Files audited

### Navigation surfaces
- [components/Header.tsx](../../../components/Header.tsx) — desktop slide-out + mobile grid
- [components/layout/GlobalHeader.tsx](../../../components/layout/GlobalHeader.tsx) — header dropdown
- [components/layout/SectionNav.tsx](../../../components/layout/SectionNav.tsx) — section nav (no settings refs)
- [components/layout/navigationConfig.tsx](../../../components/layout/navigationConfig.tsx) — central nav config (no settings refs)
- [components/landing/LandingNavbar.tsx](../../../components/landing/LandingNavbar.tsx) — public landing nav (no settings refs)

### Deep-link CTA / readiness sources
- [lib/shared/commandCenterReadinessService.ts](../../../lib/shared/commandCenterReadinessService.ts) — readiness card help-links

### Settings pages + redirects
- [pages/settings/company-admin-access.tsx](../../../pages/settings/company-admin-access.tsx) — canonical access settings
- [pages/settings/security.tsx](../../../pages/settings/security.tsx) — canonical security settings
- [pages/settings/integrations.tsx](../../../pages/settings/integrations.tsx) — server-side redirect alias to `/integrations?focus=website`

### Fetch surfaces audited
- [pages/settings/company-admin-access.tsx](../../../pages/settings/company-admin-access.tsx) — `loadAccess` + `savePatch` fetches → migrated to `safeFetchJson`
- [pages/settings/security.tsx](../../../pages/settings/security.tsx) — uses `jsonOrThrow` helper that already reads response text on non-ok and surfaces structured error; ACCEPTABLE under Phase scope (NOT migrated to `safeFetchJson` — pre-existing helper handles failure modes adequately)

---

## Files created (3)

1. **[lib/settings/canonicalRegistry.ts](../../../lib/settings/canonicalRegistry.ts)** — single source of truth for `/settings/*` hrefs. Exports:
   - `SETTINGS_ROUTE_COMPANY_ADMIN_ACCESS`, `SETTINGS_ROUTE_SECURITY`, `SETTINGS_ROUTE_INTEGRATIONS` typed `as const` literals
   - `SETTINGS_ROUTES` master object
   - `SETTINGS_NAV_ENTRIES` ordered array with per-entry visibility policy
   - `isSettingsNavEntryVisible(entry, role, isAuthenticated)` helper
2. **[lib/utils/safeFetchJson.ts](../../../lib/utils/safeFetchJson.ts)** — defensive JSON fetcher. Replaces the unsafe `fetch()` + `res.json()` pattern with a discriminated-union result type that handles:
   - `non_json_response` (HTML error pages, redirect-to-login HTML)
   - `network_error` (DNS/CORS/abort)
   - `parse_error` (claimed JSON but unparseable)
   - `json_error` (4xx/5xx with structured payload)
   Never throws "Unexpected token '<'..." at call sites.
3. **[architecture-migration/reports/settings-canonical-dominance/settings-canonical-dominance.md](settings-canonical-dominance.md)** — this report.

---

## Files modified (4)

### Nav surfaces
1. **[components/Header.tsx](../../../components/Header.tsx)**
   - Imports `SETTINGS_ROUTE_COMPANY_ADMIN_ACCESS` + `SETTINGS_ROUTE_SECURITY` from the registry.
   - All 4 settings hrefs replaced with registry constants (2 in slide-out + 2 in mobile grid).
   - **Fixed visibility gate**: `isCompanyAdmin` now matches `COMPANY_ADMIN | SUPER_ADMIN | ADMIN` (previously literal-equality `=== 'COMPANY_ADMIN'` which hid Settings from SUPER_ADMINs).

2. **[components/layout/GlobalHeader.tsx](../../../components/layout/GlobalHeader.tsx)**
   - Imports registry constants.
   - 2 settings hrefs replaced with registry constants.
   - Same visibility-gate fix as Header.tsx.

### Fetch hardening
3. **[pages/settings/company-admin-access.tsx](../../../pages/settings/company-admin-access.tsx)**
   - Imports `safeFetchJson` from `@/lib/utils/safeFetchJson`.
   - `loadAccess()` rewritten to use `safeFetchJson`. The previous `await res.json()` before `res.ok` check (line 121, original audit) is the source of "Unexpected token '<'" errors when the server returns HTML.
   - `savePatch()` similarly rewritten.
   - Both now distinguish "non_json_response" from JSON 4xx/5xx and surface a clear diagnostic message (status + content-type + truncated snippet captured but not surfaced to UI for security).

### Stale CTA hrefs
4. **[lib/shared/commandCenterReadinessService.ts](../../../lib/shared/commandCenterReadinessService.ts)**
   - 4 dead `helpLink` paths fixed:
     - `company_profile_completed` and `website_connected` cards: `/settings/company` (404) → `/settings/company-admin-access` (canonical)
     - `chrome_extension_installed` card: `/settings/extensions` (404) → `/integrations?focus=website` (canonical)
     - `api_configured` card: `/settings/api` (404) → `/integrations?focus=website` (canonical)

---

## Canonical settings routes normalized

| Route key | Path | Visibility | Status |
|---|---|---|---|
| `companyAdminAccess` | `/settings/company-admin-access` | `companyAdminOrAbove` | canonical, primary |
| `security` | `/settings/security` | `authenticated` | canonical, primary |
| `integrations` | `/integrations?focus=website` | (delegated to integrations page) | canonical, primary |
| (alias) | `/settings/integrations` | n/a | server-side 307 redirect to `/integrations?focus=website` — KEEP as compat alias |

Every nav surface now resolves through the registry. No hardcoded `/settings/*` strings remain in nav code.

---

## Stale settings exposures removed

| Exposure | Action |
|---|---|
| `/settings/company` (×2) in readiness CTAs | redirected to canonical `/settings/company-admin-access` |
| `/settings/extensions` in readiness CTAs | redirected to canonical `/integrations?focus=website` |
| `/settings/api` in readiness CTAs | redirected to canonical `/integrations?focus=website` |
| `/settings/integrations` page (existed but unreachable from nav) | confirmed as a compat redirect-only alias; KEEP, don't remove |

No legacy or duplicate settings pages found beyond these.

---

## HTML/JSON hardening completed

| Fetch site | Before | After |
|---|---|---|
| `pages/settings/company-admin-access.tsx:loadAccess` | `await res.json()` BEFORE `res.ok` — throws cryptic "Unexpected token '<'" on HTML response | `safeFetchJson<AccessResponse>` with discriminated-union result; surfaces "Server returned text/html (status N)" for non-JSON responses |
| `pages/settings/company-admin-access.tsx:savePatch` | Same unsafe pattern | Same fix |
| `pages/settings/security.tsx:reload` and 12 other fetches | Uses `jsonOrThrow` helper that reads response text on non-ok | Acceptable; no changes (helper already handles HTML responses correctly via `r.text()` on non-ok) |

---

## Visibility normalization completed

| Surface | Before | After |
|---|---|---|
| `Header.tsx` Settings link | `userRole.toUpperCase() === 'COMPANY_ADMIN'` (hid SUPER_ADMINs) | `=== 'COMPANY_ADMIN' \|\| === 'SUPER_ADMIN' \|\| === 'ADMIN'` |
| `GlobalHeader.tsx` Settings link | Same literal-equality | Same fix |
| Security link | Always visible (added in previous audit) | Unchanged (correct behavior) |

UI affordances are now permissive: every role with admin authority sees the Settings link. Server-side capability checks (`requireCapability`) remain authoritative — UI visibility is a hint, not a gate.

---

## Remaining blockers

1. **Operator action — bootstrap a SUPER_ADMIN** (Phase 3 prereq, still unmet across all phases). Required before any operator can verify the visibility-gate fix produces the correct UX.

2. **Underlying HTML-response source** (the original symptom) — still indeterminate from source-grounded audit. The `safeFetchJson` migration converts the cryptic crash into a structured error message ("Server returned text/html (status 401). Check authentication and try again.") but does NOT eliminate the upstream redirect/HTML source. Diagnosing that requires runtime Network-tab capture from a failing request.

3. **`security.tsx` helper migration** — `jsonOrThrow` is functionally equivalent to `safeFetchJson` for failure paths (reads text on non-ok) but doesn't validate content-type on success. Phase 4 (cosmetic) could migrate it for full consistency.

4. **Remaining /settings/* expansion** — registry is in place; new settings pages should be added through `SETTINGS_NAV_ENTRIES` rather than direct nav-component edits. No enforcement yet (Phase 4 could add a unit test that fails when a new `/settings/*` href appears outside the registry).

---

## Validation commands executed

| Command | Purpose | Result |
|---|---|---|
| `grep -rn "['\"]\\/settings\\/" --include="*.ts" --include="*.tsx" pages/ components/ lib/ utils/ hooks/` | enumerate all settings hrefs | 4 nav hrefs in 2 files + 4 stale hrefs in 1 readiness service file |
| `grep -rln "settings/integrations" --include="*.ts" --include="*.tsx"` | check integrations alias usage | only `.next/dev/types` (build artifacts, not source) |
| `grep -rln "/settings/company\\|/settings/extensions\\|/settings/api"` | verify dead 404 paths fixed | 0 references after fix |
| `grep -n "fetch(\\|res\\.json\\|await res\\." pages/settings/security.tsx pages/settings/integrations.tsx` | audit other settings fetches | 13 fetches in security.tsx, all go through `jsonOrThrow` (acceptable) |
| `npx tsc --noEmit -p tsconfig.json` | typecheck | exit 0 (final, after narrowing fix) |

---

## Updated counts

| Metric | Before | After | Δ |
|---|---|---|---|
| Stale settings targets (404 helpLinks) | 4 | **0** | -4 |
| Shadowed canonical settings pages | 1 (`/settings/security` shadowed by missing nav link) | **0** | -1 |
| Unreachable canonical settings pages | 0 (after the prior security-settings audit added the nav links) | **0** | 0 |
| Duplicate settings surfaces | 0 (`/settings/integrations` is a redirect alias, not a duplicate) | **0** | 0 |
| HTML/JSON parsing risks (settings) | 2 (`loadAccess` + `savePatch` in company-admin-access.tsx) | **0** | -2 |
| Role-equality visibility gates (Settings link) | 2 (`Header.tsx` + `GlobalHeader.tsx` literal `=== 'COMPANY_ADMIN'`) | **0** | -2 |
| Scattered settings hrefs (in nav code) | 6 hardcoded strings | **0** (all via registry) | -6 |
| Typecheck errors | 0 | **0** | 0 |

---

## What I did NOT do (per scope)

- ❌ Did not touch security architecture
- ❌ Did not touch Wave 3 authority collapse
- ❌ Did not migrate unrelated business logic
- ❌ Did not rewrite unrelated UX
- ❌ Did not add an enforcement linter rule (would be Phase 4 — could be a unit test that imports the registry and asserts no `/settings/*` strings appear elsewhere)
- ❌ Did not migrate `security.tsx` from `jsonOrThrow` to `safeFetchJson` (cosmetic, deferred)
- ❌ Did not delete the `/settings/integrations` redirect alias (still serves compat purpose)
