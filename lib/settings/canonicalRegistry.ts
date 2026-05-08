/**
 * Canonical settings route registry.
 *
 * Single source of truth for every link to a /settings/* surface.
 * UI components, deep-link CTAs, readiness cards, breadcrumbs, command-palette
 * entries, and onboarding flows MUST import from this module instead of
 * hardcoding href strings.
 *
 * Adding a new settings page:
 *   1. Create the page under pages/settings/
 *   2. Add an entry to SETTINGS_ROUTES below
 *   3. Add a SettingsNavEntry to SETTINGS_NAV_ENTRIES
 *   4. Optionally, set capability or visibility predicate
 *
 * Removing a settings page:
 *   1. Mark its entry deprecated: true here
 *   2. Add a redirect alias page if needed
 *   3. Remove all consumers (typecheck enforces because the constant is gone)
 *
 * RULE: every settings href in the app must come from this registry. Drift is
 * a defect.
 */

// ── Canonical route paths ──────────────────────────────────────────────────

/**
 * Per-org canonical access settings. Used by company admins and super-admins
 * to manage intelligence access flags + activity tier overrides.
 */
export const SETTINGS_ROUTE_COMPANY_ADMIN_ACCESS = '/settings/company-admin-access' as const;

/**
 * Per-user canonical security settings: passkeys, TOTP, recovery codes,
 * trusted devices, active sessions. Visible to every authenticated user.
 *
 * Bridge-cookie principals see an informational message instructing them to
 * sign in with a Supabase user account; they cannot manage MFA from here.
 */
export const SETTINGS_ROUTE_SECURITY = '/settings/security' as const;

/**
 * Canonical integrations entry point. Older `/settings/integrations` URL
 * redirects (server-side 307) to this canonical destination — see
 * pages/settings/integrations.tsx.
 */
export const SETTINGS_ROUTE_INTEGRATIONS = '/integrations?focus=website' as const;

/**
 * Master object form (use the named constants above for type-narrowing imports).
 */
export const SETTINGS_ROUTES = {
  companyAdminAccess: SETTINGS_ROUTE_COMPANY_ADMIN_ACCESS,
  security:           SETTINGS_ROUTE_SECURITY,
  integrations:       SETTINGS_ROUTE_INTEGRATIONS,
} as const;

export type SettingsRouteKey = keyof typeof SETTINGS_ROUTES;

// ── Navigation registry (per-surface visibility) ──────────────────────────

/**
 * What a single entry in the user-menu / settings sub-navigation looks like.
 *
 * `visibility` is a coarse policy that maps to caller-side checks:
 *   - 'authenticated': any signed-in user
 *   - 'companyAdminOrAbove': COMPANY_ADMIN OR SUPER_ADMIN OR canonical
 *      principals with equivalent capability
 *
 * Capability gating is left to the caller (Header.tsx / GlobalHeader.tsx)
 * because frontend visibility is per-surface and per-role, not per-route.
 */
export interface SettingsNavEntry {
  key:        SettingsRouteKey;
  label:      string;
  href:       (typeof SETTINGS_ROUTES)[SettingsRouteKey];
  visibility: 'authenticated' | 'companyAdminOrAbove';
}

/**
 * The canonical navigation order. Components rendering settings menus iterate
 * this list. Adding a new settings entry: extend this array (after creating
 * the page + registering the route above).
 */
export const SETTINGS_NAV_ENTRIES: ReadonlyArray<SettingsNavEntry> = [
  {
    key:        'companyAdminAccess',
    label:      'Settings',
    href:       SETTINGS_ROUTE_COMPANY_ADMIN_ACCESS,
    visibility: 'companyAdminOrAbove',
  },
  {
    key:        'security',
    label:      'Security',
    href:       SETTINGS_ROUTE_SECURITY,
    visibility: 'authenticated',
  },
];

// ── Visibility helpers ────────────────────────────────────────────────────

const COMPANY_ADMIN_OR_ABOVE_ROLES: ReadonlyArray<string> = [
  'COMPANY_ADMIN',
  'SUPER_ADMIN',
  'ADMIN',          // legacy alias normalized in some auth layers
];

/**
 * Should this nav entry render for the given role?
 *
 * NOTE: this is a UI affordance check, NOT an authorization check. Server
 * routes still enforce capability checks via `requireCapability`. UI
 * visibility is intentionally permissive: showing a button that 403s on click
 * is acceptable; hiding a button a user IS allowed to click is a defect.
 */
export function isSettingsNavEntryVisible(
  entry: SettingsNavEntry,
  role: string | null | undefined,
  isAuthenticated: boolean,
): boolean {
  if (!isAuthenticated) return false;
  if (entry.visibility === 'authenticated') return true;
  const normalized = (role ?? '').toUpperCase().trim();
  return COMPANY_ADMIN_OR_ABOVE_ROLES.includes(normalized);
}
