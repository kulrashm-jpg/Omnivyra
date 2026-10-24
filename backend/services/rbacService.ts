import type { NextApiRequest, NextApiResponse } from 'next';
import {

  getCompanyRoleIncludingInvited,
  normalizePermissionRole,
  normalizeRole,
  Role,
} from './rbacPrimitives';
import { ownedDbTable } from '../db/writeOwner';
import { supabase } from '../db/supabaseClient';
import { logger } from './logger';

export { getCompanyRoleIncludingInvited, normalizePermissionRole, Role };

type RbacPermissions = Record<string, string[]>;
type RbacConfig = {
  roles: Role[];
  permissions: RbacPermissions;
};

export const ALL_ROLES: Role[] = [
  Role.SUPER_ADMIN,
  Role.COMPANY_ADMIN,
  Role.CONTENT_REVIEWER,
  Role.CONTENT_PUBLISHER,
  Role.CONTENT_CREATOR,
  Role.VIEW_ONLY,
];

export const PERMISSIONS: RbacPermissions = {
  VIEW_DASHBOARD: [
    Role.COMPANY_ADMIN,
    Role.CONTENT_CREATOR,
    Role.CONTENT_REVIEWER,
    Role.CONTENT_PUBLISHER,
    Role.VIEW_ONLY,
    Role.SUPER_ADMIN,
  ],
  VIEW_TEAM: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  VIEW_ANALYTICS: [
    Role.COMPANY_ADMIN,
    Role.CONTENT_CREATOR,
    Role.CONTENT_REVIEWER,
    Role.CONTENT_PUBLISHER,
    Role.VIEW_ONLY,
    Role.SUPER_ADMIN,
  ],
  CREATE_USER: [Role.SUPER_ADMIN, Role.COMPANY_ADMIN],
  ASSIGN_ROLE: [Role.SUPER_ADMIN, Role.COMPANY_ADMIN],
  APPROVE_CONTENT: [Role.CONTENT_REVIEWER, Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  PUBLISH_CONTENT: [Role.CONTENT_PUBLISHER, Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  CREATE_CAMPAIGN: [
    Role.COMPANY_ADMIN,
    Role.CONTENT_CREATOR,
    Role.CONTENT_REVIEWER,
    Role.CONTENT_PUBLISHER,
    Role.SUPER_ADMIN,
  ],
  VIEW_CAMPAIGNS: [
    Role.COMPANY_ADMIN,
    Role.CONTENT_CREATOR,
    Role.CONTENT_REVIEWER,
    Role.CONTENT_PUBLISHER,
    Role.SUPER_ADMIN,
  ],
  MANAGE_EXTERNAL_APIS: [Role.COMPANY_ADMIN, Role.SUPER_ADMIN],
  VIEW_CONTENT: ['*'],
};

const RBAC_CACHE_TTL_MS = 30000;
let rbacCache: { value: RbacConfig; fetchedAt: number } | null = null;

async function resolvePermissionUserContext(req: NextApiRequest) {
  const { resolveUserContext } = await import('./userContextService');
  return resolveUserContext(req);
}

const normalizePermissionKey = (value: string) =>
  value.trim().toUpperCase().replace(/\s+/g, '_');

const normalizeRoles = (roles: unknown): Role[] => {
  if (!Array.isArray(roles)) return ALL_ROLES;
  const normalized = Array.from(
    new Set(
      roles
        .map((role) => String(role || '').trim().toUpperCase())
        .filter((role) => (ALL_ROLES as string[]).includes(role))
    )
  ) as Role[];
  if (!normalized.includes(Role.SUPER_ADMIN)) {
    normalized.unshift(Role.SUPER_ADMIN);
  }
  return normalized.length ? normalized : ALL_ROLES;
};

/**
 * Closure-015I (H-4) — the tenant role-management permissions. They decide who
 * may create members and assign roles (/api/company/users), so a wildcard here
 * would hand role management to every role, VIEW_ONLY included. A wildcard is
 * refused when a config is SAVED (RbacConfigValidationError → 400) and dropped
 * when a stored config is READ (fail closed: only the explicitly listed roles
 * keep the permission). Every other permission keeps '*' support.
 */
export const ROLE_MANAGEMENT_PERMISSIONS: ReadonlyArray<string> = ['CREATE_USER', 'ASSIGN_ROLE'];

export type RbacConfigValidationCode =
  | 'RBAC_WILDCARD_NOT_ALLOWED'
  | 'RBAC_ROLES_REQUIRED'
  | 'RBAC_ROLE_UNKNOWN'
  | 'RBAC_PERMISSIONS_REQUIRED'
  | 'RBAC_PERMISSION_KEY_INVALID'
  | 'RBAC_PERMISSION_KEY_DUPLICATE'
  | 'RBAC_PERMISSION_VALUE_INVALID'
  | 'RBAC_PERMISSION_ROLE_NOT_DECLARED'
  | 'RBAC_EXPECTED_VERSION_INVALID';

export class RbacConfigValidationError extends Error {
  constructor(
    public readonly code: RbacConfigValidationCode,
    public readonly permission: string = '',
    public readonly detail?: string,
  ) {
    super(`${code}:${permission}${detail ? `:${detail}` : ''}`);
  }
}

const rawRoleList = (value: unknown): string[] =>
  (Array.isArray(value) ? value : value ? [value] : []).map((item) => String(item || '').trim().toUpperCase());

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Closure-015J (R-11) — the write contract of POST /api/super-admin/rbac is a FULL
 * REPLACEMENT (the UI always sends the declared roles and every permission it
 * shows; there is no partial-update contract). A missing or malformed part is
 * therefore refused BEFORE any write instead of being normalized away: an omitted
 * `roles` used to collapse to ['SUPER_ADMIN'], silently dropping every tenant role
 * from every permission. Rules:
 *   - roles: a non-empty array of known role names (no unknown entries);
 *   - permissions: a non-empty object; keys non-empty and unique after
 *     normalization; each value an array of strings;
 *   - every role a permission names is a declared role ('*' allowed except on the
 *     role-management permissions — Closure-015I H-4, checked first).
 * An explicitly empty value ([]) is accepted: it grants that permission to nobody.
 */
export const validateRbacConfigInput = (input: { roles: unknown; permissions: unknown }): void => {
  if (isPlainObject(input.permissions)) {
    for (const [key, value] of Object.entries(input.permissions)) {
      const permissionKey = normalizePermissionKey(key);
      if (ROLE_MANAGEMENT_PERMISSIONS.includes(permissionKey) && rawRoleList(value).includes('*')) {
        throw new RbacConfigValidationError('RBAC_WILDCARD_NOT_ALLOWED', permissionKey);
      }
    }
  }
  if (!Array.isArray(input.roles) || input.roles.length === 0) {
    throw new RbacConfigValidationError('RBAC_ROLES_REQUIRED');
  }
  const declared = new Set<string>();
  for (const role of input.roles) {
    const name = typeof role === 'string' ? role.trim().toUpperCase() : '';
    if (!(ALL_ROLES as string[]).includes(name)) {
      throw new RbacConfigValidationError('RBAC_ROLE_UNKNOWN', '', String(role).slice(0, 64));
    }
    declared.add(name);
  }
  if (!isPlainObject(input.permissions) || Object.keys(input.permissions).length === 0) {
    throw new RbacConfigValidationError('RBAC_PERMISSIONS_REQUIRED');
  }
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(input.permissions)) {
    const permissionKey = normalizePermissionKey(key);
    if (!permissionKey) throw new RbacConfigValidationError('RBAC_PERMISSION_KEY_INVALID', key.slice(0, 64));
    if (seen.has(permissionKey)) throw new RbacConfigValidationError('RBAC_PERMISSION_KEY_DUPLICATE', permissionKey);
    seen.add(permissionKey);
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      throw new RbacConfigValidationError('RBAC_PERMISSION_VALUE_INVALID', permissionKey);
    }
    for (const item of value as string[]) {
      const role = item.trim().toUpperCase();
      if (role !== '*' && !declared.has(role)) {
        throw new RbacConfigValidationError('RBAC_PERMISSION_ROLE_NOT_DECLARED', permissionKey, role.slice(0, 64));
      }
    }
  }
};

const normalizePermissions = (permissions: unknown, roles: Role[], emptyAsDefaults = true): RbacPermissions => {
  if (!permissions || typeof permissions !== 'object') return { ...PERMISSIONS };
  const allowedRoles = new Set(roles);
  const entries = Object.entries(permissions as Record<string, unknown>);
  const normalized = entries.reduce<RbacPermissions>((acc, [key, value]) => {
    const permissionKey = normalizePermissionKey(key);
    if (!permissionKey) return acc;
    const wildcardAllowed = !ROLE_MANAGEMENT_PERMISSIONS.includes(permissionKey);
    // Closure-015J (R-11): a stored value that is not an array of strings grants
    // NOBODY (fail closed) — it is no longer coerced (a scalar used to be wrapped).
    const listed = Array.isArray(value) && value.every((item) => typeof item === 'string')
      ? rawRoleList(value)
      : [];
    const cleaned = Array.from(
      new Set(
        listed
          .filter((role) => (role === '*' ? wildcardAllowed : allowedRoles.has(role as Role)))
      )
    );
    acc[permissionKey] = cleaned;
    return acc;
  }, {});
  // Closure-015K (C): the stored-config read passes emptyAsDefaults=false — no
  // usable key is an untrusted document there (deny-all), never the defaults.
  if (Object.keys(normalized).length) return normalized;
  return emptyAsDefaults ? { ...PERMISSIONS } : {};
};

/**
 * Closure-015J (R-12) — ordering and cache coherence.
 *   - A load that was in flight while a save cleared the cache must not re-cache
 *     the pre-save row (the stale-load race): every clear bumps a generation, and
 *     a load only caches its result if the generation is unchanged.
 *   - Saves are issued strictly increasing `updated_at` values: after the newest
 *     stored row and after the last value this process issued (two saves in the
 *     same millisecond used to tie, and the newest-by-updated_at read could return
 *     the older row).
 *   - A remaining tie (concurrent saves on different instances in the same
 *     millisecond) is resolved deterministically — the same row on every
 *     instance — instead of by database row order. Ordering by save ISSUE time
 *     needs no migration; a strict database-assigned order would (a sequence /
 *     unique version column — not added, see the Closure-015J report).
 */
let rbacCacheGeneration = 0;
let lastIssuedUpdatedAtMs = 0;

type StoredRbacRow = { roles?: unknown; permissions?: unknown; updated_at?: unknown };

const rowTimeMs = (row: StoredRbacRow): number => {
  const t = Date.parse(String(row.updated_at ?? ''));
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
};

const canonicalRowKey = (row: StoredRbacRow): string =>
  JSON.stringify([row.roles ?? null, row.permissions ?? null]);

const pickDeterministic = (rows: StoredRbacRow[]): StoredRbacRow =>
  rows.reduce((best, row) => (canonicalRowKey(row) > canonicalRowKey(best) ? row : best));

/**
 * Closure-015K (C) — explicit fail-closed reading of the stored configuration.
 *   - table missing (PostgREST PGRST205 / Postgres 42P01) → built-in defaults:
 *     nothing narrower can have been stored;
 *   - no row → built-in defaults (never configured);
 *   - untrusted document (roles not a non-empty array of strings, permissions not
 *     a non-empty object, or no usable permission key) → DENY-ALL;
 *   - other read failure → last trusted config of this process, else DENY-ALL
 *     (not cached);
 *   - entry-level problems keep their narrowing behaviour: unknown role names are
 *     dropped, a malformed permission value grants nobody (Closure-015J), a
 *     stored wildcard on a role-management permission is dropped (015I).
 * Deny-all never touches the governed recovery path: POST /api/super-admin/rbac is
 * gated by requireCapability(identity.admin), not by hasPermission.
 */
let lastTrustedConfig: RbacConfig | null = null;

const denyAllConfig = (): RbacConfig => ({ roles: [...ALL_ROLES], permissions: {} });

const isMissingRelationError = (error: unknown): boolean => {
  const e = (error ?? {}) as { code?: unknown; message?: unknown };
  return e.code === 'PGRST205' || e.code === '42P01';
};

const isTrustedStoredRow = (row: StoredRbacRow): boolean =>
  Array.isArray(row.roles)
  && row.roles.length > 0
  && row.roles.every((r) => typeof r === 'string')
  && isPlainObject(row.permissions)
  && Object.keys(row.permissions).length > 0;

export const clearRbacCache = () => {
  rbacCache = null;
  rbacCacheGeneration += 1;
};

/** Test seam: forget the last trusted config (a fresh process). */
export const resetRbacTrustState = () => {
  lastTrustedConfig = null;
};

export const getRbacConfig = async (): Promise<RbacConfig> => {
  const now = Date.now();
  if (rbacCache && now - rbacCache.fetchedAt < RBAC_CACHE_TTL_MS) {
    return rbacCache.value;
  }
  const generation = rbacCacheGeneration;
  const remember = (value: RbacConfig): RbacConfig => {
    if (generation === rbacCacheGeneration) rbacCache = { value, fetchedAt: now };
    return value;
  };
  const fallback: RbacConfig = { roles: ALL_ROLES, permissions: { ...PERMISSIONS } };
  const { data, error } = await ownedDbTable('rbac_config')
    .select('roles, permissions, updated_at')
    .order('updated_at', { ascending: false })
    .limit(2);
  if (error) {
    // Closure-015K (C): the table does not exist → no configuration can ever have
    // been stored, so the built-in defaults ARE the configuration (unchanged).
    if (isMissingRelationError(error)) {
      lastTrustedConfig = fallback;
      return remember(fallback);
    }
    // Any other read failure: the stored configuration is unknown. It used to be
    // replaced by the built-in defaults for 30 s, which can WIDEN a narrowed
    // config. Now: the last configuration this process trusted, else deny-all —
    // and the failure is never cached, so the next check reads again.
    logger.error('rbac_config_read_failed', { message: (error as { message?: string }).message });
    return lastTrustedConfig ?? denyAllConfig();
  }
  if (!data || data.length === 0) {
    lastTrustedConfig = fallback;
    return remember(fallback);
  }
  let row = (data[0] || {}) as StoredRbacRow;
  const second = data[1] as StoredRbacRow | undefined;
  // Closure-015L: a tie is an EXACT updated_at match. With the proposed schema
  // (save_rbac_config) updated_at is strictly increasing at microsecond
  // precision, so the database order is the version order; a millisecond-level
  // comparison would have treated distinct rows as tied.
  if (second && String(second.updated_at ?? '') === String(row.updated_at ?? '')) {
    const { data: tied, error: tiedError } = await ownedDbTable('rbac_config')
      .select('roles, permissions, updated_at')
      .eq('updated_at', String(row.updated_at ?? ''));
    const candidates = !tiedError && Array.isArray(tied) && tied.length > 0
      ? (tied as StoredRbacRow[])
      : [row, second];
    row = pickDeterministic(candidates);
  }
  // Closure-015K (C): an untrusted stored DOCUMENT (roles / permissions not of
  // the shape every save writes) is not interpreted and not replaced by the
  // built-in defaults (which may be wider than what was stored): every
  // configurable permission is denied until a valid config is saved through the
  // governed POST /api/super-admin/rbac (identity.admin + step-up — it does not
  // go through hasPermission, so recovery is never locked out).
  // Closure-015L: the deny-all answer is NOT cached and never replaces the last
  // trusted config, so a repair saved by another instance is seen on the very
  // next check (malformed reads do not poison the cache).
  if (!isTrustedStoredRow(row)) {
    logger.error('rbac_config_untrusted_document', { reason: 'shape' });
    return denyAllConfig();
  }
  const roles = normalizeRoles(row.roles);
  const permissions = normalizePermissions(row.permissions, roles, false);
  if (Object.keys(permissions).length === 0) {
    logger.error('rbac_config_untrusted_document', { reason: 'no_usable_permission_keys' });
    return denyAllConfig();
  }
  const value = { roles, permissions };
  lastTrustedConfig = value;
  return remember(value);
};

/**
 * Closure-015L — stale-edit detection. Thrown when the config the caller edited
 * (expectedVersion) is no longer the newest stored version: another
 * administrator saved in between. Nothing was written.
 */
export class RbacConfigStaleError extends Error {
  constructor(public readonly currentVersion: number | null) {
    super(`RBAC_CONFIG_STALE:${currentVersion ?? 'none'}`);
  }
}

export type SavedRbacConfig = RbacConfig & { version: number | null };

const isMissingFunctionError = (error: unknown): boolean => {
  const e = (error ?? {}) as { code?: unknown };
  return e.code === 'PGRST202' || e.code === '42883';
};

const parseExpectedVersion = (value: unknown): number | null => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  throw new RbacConfigValidationError('RBAC_EXPECTED_VERSION_INVALID');
};

/**
 * Closure-015L — the stored version the GET route hands to the editor as its
 * stale-edit token. Only the proposed schema (supabase/proposals/closure015l/
 * 03_rbac_config.sql) has a `version` column; until it is deployed — or when the
 * table is absent, or the read fails — this is null ("editing the defaults / the
 * legacy row"), which the legacy save path ignores.
 */
export const getRbacConfigVersion = async (): Promise<number | null> => {
  const { data, error } = await ownedDbTable('rbac_config')
    .select('version')
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const v = (data[0] as { version?: unknown }).version;
  return typeof v === 'number' && Number.isSafeInteger(v) ? v : (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);
};

export const saveRbacConfig = async (input: {
  roles: unknown;
  permissions: unknown;
  updatedBy?: string | null;
  /** Closure-015L: the stored version the caller edited (null/absent = the defaults). */
  expectedVersion?: unknown;
}): Promise<SavedRbacConfig> => {
  // Closure-015I (H-4) + Closure-015J (R-11): refuse — never silently normalize —
  // a missing / malformed config, before any read or write.
  validateRbacConfigInput(input);
  const expectedVersion = parseExpectedVersion(input.expectedVersion);
  const roles = normalizeRoles(input.roles);
  const permissions = normalizePermissions(input.permissions, roles);

  // Closure-015L: the governed save function (proposal 03_rbac_config.sql). It
  // serializes every save across all application instances (transaction
  // advisory lock), refuses a stale expectedVersion, assigns the version and a
  // strictly increasing updated_at in the database.
  const rpc = await supabase.rpc('save_rbac_config', {
    p_roles: roles,
    p_permissions: permissions,
    p_updated_by: input.updatedBy || null,
    p_expected_version: expectedVersion,
  });
  if (!rpc.error) {
    const row = (Array.isArray(rpc.data) ? rpc.data[0] : rpc.data) as
      | { version?: unknown; roles?: unknown; permissions?: unknown }
      | null
      | undefined;
    if (!row) throw new Error('RBAC_SAVE_NO_RESULT');
    clearRbacCache();
    const storedRoles = normalizeRoles(row.roles);
    return {
      roles: storedRoles,
      permissions: normalizePermissions(row.permissions, storedRoles),
      version: typeof row.version === 'number' ? row.version : Number(row.version ?? NaN) || null,
    };
  }
  const rpcMessage = String((rpc.error as { message?: unknown }).message ?? '');
  if (rpcMessage.includes('RBAC_CONFIG_STALE')) {
    const detail = String((rpc.error as { details?: unknown }).details ?? '');
    throw new RbacConfigStaleError(/^\d+$/.test(detail) ? Number(detail) : null);
  }
  if (!isMissingFunctionError(rpc.error)) {
    throw new Error(rpcMessage || 'RBAC_SAVE_FAILED');
  }

  // Function not deployed: the legacy append (Closure-015J), which cannot detect
  // a stale edit — there is no stored version to compare against.
  // Closure-015J (R-12): issue an updated_at strictly after the newest stored row
  // and after this process's last save. A failed read fails the save (no write).
  const { data: latest, error: latestError } = await ownedDbTable('rbac_config')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1);
  if (latestError) {
    throw new Error(latestError.message);
  }
  const latestMs = latest && latest[0] ? rowTimeMs(latest[0] as StoredRbacRow) : Number.NEGATIVE_INFINITY;
  const issuedMs = Math.max(
    Date.now(),
    Number.isFinite(latestMs) ? latestMs + 1 : 0,
    lastIssuedUpdatedAtMs + 1,
  );
  lastIssuedUpdatedAtMs = issuedMs;
  const payload = {
    roles,
    permissions,
    updated_by: input.updatedBy || null,
    updated_at: new Date(issuedMs).toISOString(),
  };
  const { data, error } = await ownedDbTable('rbac_config')
    .insert(payload)
    .select('roles, permissions')
    .single();
  if (error) {
    throw new Error(error.message);
  }
  clearRbacCache();
  const storedRoles = normalizeRoles(data?.roles);
  const storedPermissions = normalizePermissions(data?.permissions, storedRoles);
  return { roles: storedRoles, permissions: storedPermissions, version: null };
};

export const hasPermission = async (role: string | null, action: string): Promise<boolean> => {
  if (!role) return false;
  const { permissions } = await getRbacConfig();
  const allowed = permissions[action] || [];
  if (allowed.includes('*')) return true;
  const normalized = normalizePermissionRole(role);
  return allowed.includes(normalized);
};

export const getUserRole = async (
  userId: string,
  companyId: string
): Promise<{ role: Role | null; error: string | null; membershipType?: 'EXTERNAL' | 'INTERNAL' }> => {
  // Query company-specific role first (happy path: 1 DB round-trip)
  const { data, error } = await ownedDbTable('user_company_roles')
    .select('role, status')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .eq('status', 'active')
    .limit(1);
  if (error) {
    return { role: null, error: null, membershipType: undefined };
  }
  if (data && data.length > 0) {
    const row = data[0] as { role: string; status?: string };
    const rawRole = typeof row.role === 'string' ? row.role.trim() : '';
    const normalizedRole = normalizeRole(rawRole || row.role);
    return { role: normalizedRole, error: null, membershipType: 'INTERNAL' };
  }

  // Closure-015E — no invited-membership fallback. An invited membership (any
  // role, incl. COMPANY_ADMIN / ADMIN / SUPER_ADMIN) confers no authority before
  // acceptance; acceptance activates it. (Closure-015D removed SUPER_ADMIN from
  // this fallback; Closure-015E removes the fallback.)

  // No role for company: check if user has any role (distinguish COMPANY_ACCESS_DENIED vs null)
  const { data: anyRoleRows, error: anyRoleError } = await ownedDbTable('user_company_roles')
    .select('role')
    .eq('user_id', userId)
    .limit(1);
  if (anyRoleError) return { role: null, error: null, membershipType: undefined };
  if (anyRoleRows && anyRoleRows.length > 0) {
    return { role: null, error: 'COMPANY_ACCESS_DENIED', membershipType: undefined };
  }
  return { role: null, error: null, membershipType: undefined };
};

export const getUserCompanyRole = async (
  req: NextApiRequest,
  companyId: string
): Promise<{ role: Role | null; userId: string | null }> => {
  const user = await resolvePermissionUserContext(req);
  if (!user?.userId) {
    return { role: null, userId: null };
  }
  if (!companyId) {
    return { role: null, userId: user.userId };
  }
  if (user.userId === 'content_architect') {
    return { role: Role.COMPANY_ADMIN, userId: user.userId };
  }
  const superAdmin = await isSuperAdmin(user.userId);
  if (superAdmin) {
    return { role: Role.SUPER_ADMIN, userId: user.userId };
  }
  const { role } = await getUserRole(user.userId, companyId);
  return { role, userId: user.userId };
};

/**
 * SEC-91A (STEP 3AH-91, A2) — platform super-admin requires an ACTIVE
 * SUPER_ADMIN membership row.
 *
 * Both predicates used to match any row with role='SUPER_ADMIN' regardless of
 * `status`, so an invited-but-never-accepted SUPER_ADMIN row, or one that was
 * deactivated ('inactive' / 'deactivated' — the user-removal paths keep the role
 * and flip only the status), still granted the platform bypass that
 * TenantGuard.assertTenantAccess, enforceRole/withRBAC, requireSuperAdminUser
 * and getUserCompanyRole all consult: cross-tenant access to every company.
 *
 * Every other super-admin decision in the platform already requires
 * status='active' (authMiddleware.requireSuperAdmin,
 * platformCapabilities.isPlatformSuperAdminPrincipal, the capability layer), so
 * this aligns the two outliers with the canonical predicate. Fail-closed: a
 * lookup error answers false (no bypass), exactly as before.
 */
const hasActiveSuperAdminRow = async (userId: string): Promise<boolean> => {
  if (!userId) return false;
  const { data, error } = await ownedDbTable('user_company_roles')
    .select('id')
    .eq('user_id', userId)
    .eq('role', Role.SUPER_ADMIN)
    .eq('status', 'active')
    .limit(1);
  if (error) return false;
  return !!data && data.length > 0;
};

export const isSuperAdmin = async (userId: string): Promise<boolean> => hasActiveSuperAdminRow(userId);

export const isPlatformSuperAdmin = async (userId: string): Promise<boolean> => hasActiveSuperAdminRow(userId);

export const enforceRole = async (input: {
  req: NextApiRequest;
  res: NextApiResponse;
  companyId?: string | null;
  allowedRoles: Role[];
}): Promise<{ userId: string; role: Role } | null> => {
  const user = await resolvePermissionUserContext(input.req);

  // AUTH-CTX-001 — the RBAC seam shares `resolveUserContext`, so it inherited
  // the same masking: an unauthenticated caller was role-checked as the
  // synthetic identity and reported FORBIDDEN_ROLE (403) instead of 401.
  // Answer authentication first; role authorization below is unchanged.
  if (user.authenticated === false) {
    input.res.status(401).json({
      error: 'Authentication required. Please sign in again.',
      code: 'UNAUTHENTICATED',
      reason: user.authError ?? 'INVALID_AUTH',
    });
    return null;
  }

  const companyId = input.companyId;
  if (!companyId) {
    input.res.status(400).json({ error: 'companyId required' });
    return null;
  }
  // Content Architect: platform role with access to all companies (like Super Admin)
  if (user.userId === 'content_architect' && input.allowedRoles.includes(Role.COMPANY_ADMIN)) {
    return { userId: 'content_architect', role: Role.COMPANY_ADMIN };
  }

  // Run role checks in parallel to reduce latency
  const [superAdminResult, platformSuperAdminResult, userRoleResult] = await Promise.all([
    isSuperAdmin(user.userId),
    isPlatformSuperAdmin(user.userId),
    getUserRole(user.userId, companyId),
  ]);
  // Super admins (both isSuperAdmin and isPlatformSuperAdmin) bypass all role restrictions.
  // They are Omnivyra platform admins who control the whole app — they must be able to
  // call any route regardless of which roles that route explicitly lists.
  if (superAdminResult || platformSuperAdminResult) {
    return { userId: user.userId, role: Role.SUPER_ADMIN };
  }

  const { role, error } = userRoleResult;
  if (error === 'COMPANY_ACCESS_DENIED') {
    input.res.status(403).json({ error: 'COMPANY_SCOPE_VIOLATION' });
    return null;
  }
  // getUserRole now includes invited admin fallback internally; no extra getCompanyRoleIncludingInvited call
  if (error || !role) {
    input.res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    return null;
  }
  if (!input.allowedRoles.includes(role)) {
    input.res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    return null;
  }
  return { userId: user.userId, role };
};
