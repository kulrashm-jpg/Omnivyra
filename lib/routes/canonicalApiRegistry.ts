/**
 * Canonical API registry — single source of truth for primary API endpoints
 * consumed by the frontend.
 *
 * Coverage scope: PRIMARY API endpoints per domain. Out of scope:
 *   - Server-internal endpoints (called only by other server processes)
 *   - One-off webhooks
 *   - Admin endpoints not consumed by the SPA
 *
 * Goal: every frontend `fetch()` should target a canonical-classified entry.
 * Compatibility / deprecated entries are listed so audits can flag them.
 *
 * Adding a new canonical API:
 *   1. Create the route under `pages/api/...`
 *   2. Add a `RouteRegistryEntry` here with `domain` + `lifecycle: 'canonical'`
 *   3. Update frontend consumers to import the constant
 *   4. If superseding an older endpoint, mark the older entry
 *      `lifecycle: 'compatibility'` + `canonicalKey: '<new-key>'`
 *
 * RULE: every frontend `fetch('/api/...')` should target a path enumerated
 * here OR be deliberately marked as out-of-scope (admin tooling, debug
 * surfaces, etc.). Drift is a defect.
 */

import type { RouteRegistryEntry } from './routeLifecycle';

export const CANONICAL_API_ROUTES: ReadonlyArray<RouteRegistryEntry> = [
  // ── Auth + session canonical surface ──────────────────────────────────
  { key: 'api.auth.session',           path: '/api/auth/session',                  domain: 'auth', lifecycle: 'canonical', description: 'Canonical session/principal snapshot. JSON only.' },
  { key: 'api.auth.capabilities',      path: '/api/auth/capabilities',             domain: 'auth', lifecycle: 'canonical', description: 'Canonical capability projection. JSON only.' },
  { key: 'api.auth.logout',            path: '/api/auth/logout',                   domain: 'auth', lifecycle: 'canonical', description: 'Canonical logout (revokes auth_session, clears cookie).' },
  { key: 'api.auth.refresh',           path: '/api/auth/refresh',                  domain: 'auth', lifecycle: 'canonical', description: 'Session rotation.' },
  { key: 'api.auth.sync_supabase',     path: '/api/auth/sync-supabase-user',       domain: 'auth', lifecycle: 'canonical', description: 'Mints canonical auth_session after Supabase login.' },

  // MFA / passkey / TOTP surface (consumed by /settings/security)
  { key: 'api.auth.passkeys.list',     path: '/api/auth/passkeys',                 domain: 'auth', lifecycle: 'canonical', description: 'List + revoke passkeys.' },
  { key: 'api.auth.passkeys.begin_reg', path: '/api/auth/passkeys/begin-registration', domain: 'auth', lifecycle: 'canonical', description: 'Begin WebAuthn registration ceremony.' },
  { key: 'api.auth.passkeys.verify_reg', path: '/api/auth/passkeys/verify-registration', domain: 'auth', lifecycle: 'canonical', description: 'Verify WebAuthn registration ceremony.' },
  { key: 'api.auth.passkeys.begin_auth', path: '/api/auth/passkeys/begin-authentication', domain: 'auth', lifecycle: 'canonical', description: 'Begin WebAuthn authentication.' },
  { key: 'api.auth.passkeys.verify_auth', path: '/api/auth/passkeys/verify-authentication', domain: 'auth', lifecycle: 'canonical', description: 'Verify WebAuthn authentication.' },
  { key: 'api.auth.totp.begin_enroll', path: '/api/auth/totp/begin-enrollment',    domain: 'auth', lifecycle: 'canonical', description: 'Begin TOTP enrollment.' },
  { key: 'api.auth.totp.verify_enroll', path: '/api/auth/totp/verify-enrollment',  domain: 'auth', lifecycle: 'canonical', description: 'Verify TOTP enrollment.' },
  { key: 'api.auth.totp.recovery',     path: '/api/auth/totp/recovery',            domain: 'auth', lifecycle: 'canonical', description: 'TOTP recovery flow.' },
  { key: 'api.auth.totp.recovery_regenerate', path: '/api/auth/totp/recovery/regenerate', domain: 'auth', lifecycle: 'canonical', description: 'Regenerate recovery codes.' },
  { key: 'api.auth.totp.revoke',       path: '/api/auth/totp/revoke',              domain: 'auth', lifecycle: 'canonical', description: 'Revoke TOTP factor.' },

  // Step-up + sessions + devices
  { key: 'api.auth.step_up.status',    path: '/api/auth/step-up/status',           domain: 'auth', lifecycle: 'canonical', description: 'Read step-up state.' },
  { key: 'api.auth.step_up.verify',    path: '/api/auth/step-up/verify',           domain: 'auth', lifecycle: 'canonical', description: 'Verify step-up factor.' },
  { key: 'api.auth.devices.list',      path: '/api/auth/devices',                  domain: 'auth', lifecycle: 'canonical', description: 'List trusted devices.' },
  { key: 'api.auth.devices.trust',     path: '/api/auth/devices/trust',            domain: 'auth', lifecycle: 'canonical', description: 'Trust current device.' },
  { key: 'api.auth.devices.revoke',    path: '/api/auth/devices/revoke',           domain: 'auth', lifecycle: 'canonical', description: 'Revoke a trusted device.' },
  { key: 'api.auth.sessions.list',     path: '/api/auth/sessions/list',            domain: 'auth', lifecycle: 'canonical', description: 'List active auth_sessions.' },
  { key: 'api.auth.sessions.revoke',   path: '/api/auth/sessions/revoke',          domain: 'auth', lifecycle: 'canonical', description: 'Revoke an auth_session.' },

  // ── Settings APIs ─────────────────────────────────────────────────────
  { key: 'api.settings.intelligence_access', path: '/api/settings/intelligence-access', domain: 'settings', lifecycle: 'canonical', description: 'Per-org intelligence-access flags + activity tier overrides.' },

  // ── Admin platform-OAuth (Phase 1 canonical) ──────────────────────────
  { key: 'api.super_admin.platform_oauth_configs', path: '/api/super-admin/platform-oauth-configs', domain: 'super_admin', lifecycle: 'canonical', description: 'Platform-level OAuth credential CRUD; gated on INTEGRATION_PLATFORM_OAUTH_MANAGE.' },
  { key: 'api.admin.platform_oauth_configs', path: '/api/admin/platform-oauth-configs', domain: 'admin', lifecycle: 'compatibility', canonicalKey: 'api.super_admin.platform_oauth_configs', notes: 'Admin-tier alias surface; Phase 3 collapse target.' },

  // ── Admin: Wave 3A bootstrap ──────────────────────────────────────────
  { key: 'api.admin.bootstrap_super_admin', path: '/api/admin/bootstrap-super-admin', domain: 'admin', lifecycle: 'canonical', description: 'Wave 3A canonical SUPER_ADMIN bootstrap (mode=promote / mode=bootstrap).' },
  { key: 'api.admin.revoke_super_admin', path: '/api/admin/revoke-super-admin',     domain: 'admin', lifecycle: 'canonical', description: 'Revoke SUPER_ADMIN role assignment.' },

  // ── Super-admin canonical dashboards ──────────────────────────────────
  { key: 'api.super_admin.session',    path: '/api/super-admin/session',           domain: 'super_admin', lifecycle: 'canonical', description: 'Super-admin probe; canonical-resolver shim.' },
  { key: 'api.super_admin.companies',  path: '/api/super-admin/companies',         domain: 'super_admin', lifecycle: 'canonical', description: 'Companies list/admin.' },
  { key: 'api.super_admin.users',      path: '/api/super-admin/users',             domain: 'super_admin', lifecycle: 'canonical', description: 'Users management.' },
  { key: 'api.super_admin.audit_logs', path: '/api/super-admin/audit-logs',        domain: 'super_admin', lifecycle: 'canonical', description: 'Platform audit log read.' },

  // ── Super-admin compatibility (env-credential mint) ───────────────────
  { key: 'api.super_admin.login',      path: '/api/super-admin/login',             domain: 'super_admin', lifecycle: 'compatibility', canonicalKey: 'api.auth.sync_supabase', notes: 'Env-credential bridge mint. Wave 3 deletes once canonical bootstrap exercised.' },
  { key: 'api.super_admin.logout',     path: '/api/super-admin/logout',            domain: 'super_admin', lifecycle: 'compatibility', canonicalKey: 'api.auth.logout',         notes: 'Bridge cookie clear + canonical session revoke.' },
  { key: 'api.super_admin.content_architect_login', path: '/api/super-admin/content-architect-login', domain: 'super_admin', lifecycle: 'compatibility', canonicalKey: 'api.auth.sync_supabase', notes: 'Same compatibility status as super-admin/login.' },

  // ── Health / public ───────────────────────────────────────────────────
  { key: 'api.health',                 path: '/api/health',                        domain: 'public', lifecycle: 'canonical', description: 'Liveness + readiness probe.' },
];

export function getCanonicalApiRoute(key: string): RouteRegistryEntry {
  const entry = CANONICAL_API_ROUTES.find((r) => r.key === key);
  if (!entry) {
    throw new Error(`Unknown canonical API key: ${key}`);
  }
  return entry;
}

export function getApiRoutesByDomain(domain: string): ReadonlyArray<RouteRegistryEntry> {
  return CANONICAL_API_ROUTES.filter((r) => r.domain === domain);
}

export function getDeprecatedApiPaths(): ReadonlyArray<string> {
  return CANONICAL_API_ROUTES
    .filter((r) => r.lifecycle === 'deprecated' || r.lifecycle === 'quarantined' || r.lifecycle === 'dead')
    .map((r) => r.path);
}
