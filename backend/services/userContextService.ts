import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../db/supabaseClient';
import { resolveUserContext as resolveFromLib, type UserContext, type MembershipType } from '../lib/userContext';
import { getSupabaseUserFromRequest } from './supabaseAuthService';
import { getCompanyRoleIncludingInvited, normalizePermissionRole, Role } from './rbacPrimitives';
import { assertTenantAccess } from '../security/TenantGuard';
import { checkCampaignOwnership } from './campaignOwnershipService';
import { attributeAuthenticatedPrincipal } from './requestContextPrincipal';
import { companyOperationalState } from './companyOperationalState';
import { config } from '@/config';

export type { UserContext, MembershipType };

const DEFAULT_MEMBERSHIP: MembershipType = 'INTERNAL';

function normalizeMembershipType(value: string | null | undefined): MembershipType {
  const v = (value || '').trim().toUpperCase();
  return v === 'EXTERNAL' ? 'EXTERNAL' : 'INTERNAL';
}

/**
 * AUTH-CTX-001 — the context for a request that did NOT authenticate.
 *
 * Explicitly empty: no id, no admin role, no company. The previous behaviour
 * substituted the synthetic dev identity here — `DEV_USER_ID || 'dev-user'`
 * with `role: 'admin'` and, worst of all, `companyIds: [the most recently
 * updated company_profiles row]`, i.e. an arbitrary real tenant. It was
 * harmless only because 'dev-user' is a member of nothing, so every guard
 * answered NOT_A_MEMBER — turning "you are not signed in" into "you are not
 * allowed", on every route in the app.
 */
function unauthenticatedContext(authError: string | null): UserContext {
  return {
    userId: '',
    role: 'user',
    companyIds: [],
    defaultCompanyId: '',
    authenticated: false,
    authError,
  };
}

/**
 * The synthetic dev identity is available ONLY as a deliberate local opt-in:
 * `DEV_USER_ID` explicitly set AND a non-production build. No DEV_* variable
 * exists in Vercel production, and nothing in the repo depends on this
 * fallback (zero no-arg callers, zero tests), so production behaviour is
 * unchanged apart from the failure it stops masking.
 */
function devIdentityOptIn(): boolean {
  return Boolean(config.DEV_USER_ID) && config.NODE_ENV !== 'production';
}

export const resolveUserContext = async (req?: NextApiRequest): Promise<UserContext> => {
  if (!req) return resolveFromLib();

  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user?.id) {
    // The auth layer already distinguishes MISSING_AUTH / INVALID_AUTH /
    // SESSION_REVOKED / ACCOUNT_DELETED / ACCOUNT_SUSPENDED. Discarding that
    // and fabricating an identity is what produced the masking.
    if (devIdentityOptIn()) return resolveFromLib();
    return unauthenticatedContext(error ?? 'INVALID_AUTH');
  }

  // SEC-91 W2-A (W2A-4) — the identity is proven: record it in the request
  // context (observe-only unless the ai-guard-principal flag is in enforce).
  attributeAuthenticatedPrincipal({ userId: user.id, source: 'resolveUserContext' });

  const { data: roleRows, error: roleError } = await supabase
    .from('user_company_roles')
    .select('company_id, role, status')
    .eq('user_id', user.id);

  if (roleError) {
    // The IDENTITY is proven; only the membership read failed. Keep it
    // authenticated so the failure surfaces as a tenancy problem (403/503),
    // never as "you are not signed in".
    return {
      userId: user.id,
      role: 'user',
      companyIds: [],
      defaultCompanyId: '',
      authenticated: true,
      authError: null,
    };
  }

  const activeRoles = (roleRows || []).filter((row) => row.status === 'active');
  const companyIds = Array.from(
    new Set(activeRoles.map((row) => row.company_id).filter(Boolean))
  ) as string[];
  const isAdmin = activeRoles.some((row) => {
    const normalized = normalizePermissionRole(row.role || '');
    return normalized === Role.COMPANY_ADMIN || normalized === Role.SUPER_ADMIN;
  });

  const membershipByCompany: Record<string, MembershipType> = {};
  for (const row of activeRoles) {
    if (row.company_id) {
      membershipByCompany[row.company_id] = DEFAULT_MEMBERSHIP;
    }
  }
  const defaultCompanyId = companyIds[0] || '';
  const membershipType = DEFAULT_MEMBERSHIP;

  return {
    userId: user.id,
    role: isAdmin ? 'admin' : 'user',
    companyIds,
    defaultCompanyId,
    membershipType,
    membershipByCompany: Object.keys(membershipByCompany).length ? membershipByCompany : undefined,
    authenticated: true,
    authError: null,
  };
};

/** True if the resolved context is an external (agency) member. No permission change; for future visibility filtering. */
export function isExternalMember(userContext: UserContext): boolean {
  return userContext.membershipType === 'EXTERNAL';
}

/** True if user is external for the given company. Use when filtering by company. */
export function isExternalMemberForCompany(
  userContext: UserContext,
  companyId: string
): boolean {
  return userContext.membershipByCompany?.[companyId] === 'EXTERNAL';
}

/**
 * SHIM: tenant authorization for legacy callers. The canonical decision
 * runs through `TenantGuard.assertTenantAccess`; this helper preserves
 * two pre-existing fallbacks for behavior parity:
 *
 *   1. content-architect cookie principal — admin-tier global access
 *      established by /api/super-admin/content-architect-login. This
 *      principal has userId='content_architect', is NOT in user_company_roles,
 *      and would otherwise be rejected by the canonical guard.
 *
 *   2. invited admin — formerly a user with role IN (COMPANY_ADMIN, ADMIN,
 *      SUPER_ADMIN) and status='invited' could administer the company before
 *      accepting the invite. Closure-015D removed SUPER_ADMIN; Closure-015E
 *      removed the invited fallback (getCompanyRoleIncludingInvited resolves
 *      ACTIVE memberships only): invited memberships confer nothing before
 *      acceptance.
 *
 * Tightenings inherited from the canonical guard:
 *   - soft-deleted / suspended companies are now rejected even for
 *     invited admins (ORG_NOT_FOUND / ORG_INACTIVE override the fallback;
 *     for the invited fallback itself the company is read explicitly —
 *     SEC-91 W2G-4 — because the canonical guard stops at STALE_MEMBERSHIP
 *     before it reads the company)
 *   - bridge principals (legacyCookieSuperAdmin) cannot satisfy tenant
 *     access — they have no tenant identity
 *
 * ROUTE-AUTH-001 (STEP 3AH-85) — when a `campaignId` is supplied it is now
 * BOUND: every allow branch additionally requires that the campaign belongs to
 * `companyId` (campaignOwnershipService). Before this, the guard only checked
 * that a campaignId was present, so a member of company A could pass company
 * B's campaign id and the route acted on B's campaign. A campaign owned by
 * another company (or by nobody) answers 404; a campaign that does not exist
 * yet is allowed, because creation flows authorize the id of the campaign they
 * are about to create and a non-existent campaign cannot belong to another
 * tenant; a transient lookup failure answers a retryable 503, never an allow.
 *
 * New code should call `requireTenantAccess` directly. This helper is
 * retained to avoid churn in 30+ existing callsites.
 */
export const enforceCompanyAccess = async (input: {
  req: NextApiRequest;
  res: NextApiResponse;
  companyId?: string | null;
  campaignId?: string | null;
  requireCampaignId?: boolean;
}): Promise<UserContext | null> => {
  const user = await resolveUserContext(input.req);

  // SEC-91 W2-A (W2A-4) — every ALLOW branch records the authorized principal
  // (user + the company just authorized) in the request context. Observe-only
  // by default; see requestContextPrincipal.ts.
  const allow = (): UserContext => {
    attributeAuthenticatedPrincipal({
      userId: user.userId,
      orgId: input.companyId ?? null,
      source: 'enforceCompanyAccess',
    });
    return user;
  };

  const campaignBound = async (): Promise<boolean> => {
    if (!input.campaignId) return true;
    const ownership = await checkCampaignOwnership(String(input.campaignId), String(input.companyId));
    if (ownership === 'owned' || ownership === 'not_found') return true;
    if (ownership === 'lookup_error') {
      input.res.status(503).json({
        error: 'Campaign ownership check is temporarily unavailable. Please try again.',
        code: 'CAMPAIGN_LOOKUP_ERROR',
        retryable: true,
      });
      return false;
    }
    console.warn('CAMPAIGN_TENANT_MISMATCH', {
      path: input.req.url,
      companyId: input.companyId,
      campaignId: input.campaignId,
      userId: user.userId,
      ownership,
    });
    input.res.status(404).json({ error: 'Campaign not found', code: 'CAMPAIGN_NOT_FOUND' });
    return false;
  };

  // AUTH-CTX-001 — authentication is answered FIRST, and separately.
  //
  // A caller who never authenticated is not a non-member; saying "Access
  // denied to company" told them (and us) that the problem was tenancy. It
  // ran before this gate existed because the fabricated identity looked like
  // a real principal that simply belonged to nothing.
  //
  // Only an EXPLICIT false triggers this, so no other producer of a
  // UserContext is affected, and authorization below is untouched: a genuine
  // authenticated non-member still receives 403.
  if (user.authenticated === false) {
    console.warn('UNAUTHENTICATED', { path: input.req.url, reason: user.authError });
    input.res.status(401).json({
      error: 'Authentication required. Please sign in again.',
      code: 'UNAUTHENTICATED',
      reason: user.authError ?? 'INVALID_AUTH',
    });
    return null;
  }

  if (!input.companyId) {
    console.warn('MISSING_COMPANY_ID', { path: input.req.url });
    input.res.status(400).json({ error: 'companyId required' });
    return null;
  }

  // Canonical fast path: principal is an active member of an active org.
  // Soft-delete + bridge-principal rejection happen inside assertTenantAccess.
  const canonical = await assertTenantAccess({
    userId:         user.userId,
    organizationId: input.companyId,
  });

  if (canonical.ok === true) {
    if (input.requireCampaignId && !input.campaignId) {
      console.warn('MISSING_CAMPAIGN_ID', { path: input.req.url, companyId: input.companyId });
      input.res.status(400).json({ error: 'campaignId required' });
      return null;
    }
    if (!(await campaignBound())) return null;
    return allow();
  }

  // Transient membership/org read failure (DB/network blip): do NOT report as
  // a denial. A legitimate member must never be locked out by a temporary
  // lookup error — return a retryable 503 so the client retries instead of
  // surfacing a misleading "Access denied to company".
  if (canonical.reason === 'TENANT_LOOKUP_ERROR') {
    console.warn('TENANT_LOOKUP_ERROR', {
      path: input.req.url,
      companyId: input.companyId,
      userId: user.userId,
    });
    input.res.status(503).json({
      error: 'Membership check is temporarily unavailable. Please try again.',
      code: 'TENANT_LOOKUP_ERROR',
      retryable: true,
    });
    return null;
  }

  // Soft-deleted / missing companies: deny. Don't apply legacy fallbacks
  // — a deleted org must remain locked, and an unknown id has no fallback
  // to apply.
  if (canonical.reason === 'ORG_NOT_FOUND' || canonical.reason === 'ORG_INACTIVE') {
    console.warn('ACCESS_DENIED', {
      path: input.req.url,
      companyId: input.companyId,
      userId: user.userId,
      role: user.role,
      reason: canonical.reason,
    });
    input.res.status(403).json({ error: 'Access denied to company' });
    return null;
  }

  // Legacy fallback (a): content-architect cookie principal.
  if (user.userId === 'content_architect') {
    if (input.requireCampaignId && !input.campaignId) {
      input.res.status(400).json({ error: 'campaignId required' });
      return null;
    }
    if (!(await campaignBound())) return null;
    return allow();
  }

  // Legacy fallback (b): invited admin role.
  const fallbackRole = await getCompanyRoleIncludingInvited(user.userId, input.companyId);
  // Closure-015D removed SUPER_ADMIN here; Closure-015E: getCompanyRoleIncludingInvited
  // now resolves ACTIVE memberships only, so an INVITED membership of any role no
  // longer reaches this branch — invited memberships confer nothing before acceptance.
  const allowedViaInvited =
    fallbackRole === Role.COMPANY_ADMIN ||
    fallbackRole === Role.ADMIN;
  if (allowedViaInvited) {
    // SEC-91 W2-G (STEP 3AH-91, W2G-4) — the invited fallback must honour the
    // company's state. The header promises "suspended companies are rejected
    // even for invited admins", but assertTenantAccess answers
    // STALE_MEMBERSHIP for a non-active row BEFORE it reads the company, so the
    // ORG_INACTIVE / ORG_NOT_FOUND branch above never fired for this principal
    // and an invited admin was admitted into a suspended / inactive / deleted
    // company. Same org decision as TenantGuard: missing or non-active ⇒ 403;
    // a transient lookup failure ⇒ retryable 503, never an allow. (Platform
    // super admins never reach this branch — TenantGuard bypasses them first.)
    const orgState = await companyOperationalState(input.companyId);
    if (orgState === 'lookup_error') {
      console.warn('TENANT_LOOKUP_ERROR', {
        path: input.req.url,
        companyId: input.companyId,
        userId: user.userId,
      });
      input.res.status(503).json({
        error: 'Membership check is temporarily unavailable. Please try again.',
        code: 'TENANT_LOOKUP_ERROR',
        retryable: true,
      });
      return null;
    }
    if (orgState === 'not_operational') {
      console.warn('ACCESS_DENIED', {
        path: input.req.url,
        companyId: input.companyId,
        userId: user.userId,
        role: user.role,
        reason: 'ORG_INACTIVE',
      });
      input.res.status(403).json({ error: 'Access denied to company' });
      return null;
    }
    if (input.requireCampaignId && !input.campaignId) {
      console.warn('MISSING_CAMPAIGN_ID', { path: input.req.url, companyId: input.companyId });
      input.res.status(400).json({ error: 'campaignId required' });
      return null;
    }
    if (!(await campaignBound())) return null;
    return allow();
  }

  console.warn('ACCESS_DENIED', {
    path: input.req.url,
    companyId: input.companyId,
    userId: user.userId,
    role: user.role,
    reason: canonical.reason,
  });
  // HARDEN-007: observe tenant-access denials (fail-safe; no behavior change).
  try {
    const { recordRawCounter } = require('../observability');
    recordRawCounter('authz.tenant.denied', 1, { reason: String(canonical.reason ?? 'denied') });
  } catch { /* fail-safe */ }
  input.res.status(403).json({ error: 'Access denied to company' });
  return null;
};

/** The ONE body a caller gets when a resource does not exist OR belongs to a company it may not access. */
export const UNIFORM_NOT_FOUND = Object.freeze({ error: 'Not found', code: 'NOT_FOUND' });

/**
 * enforceCompanyAccess for a resource LOOKED UP BY ID (2026-11-12, plan-status authz fix): a DENIAL
 * (403, or 404 from campaign binding) is answered with the same 404 a missing resource gets, so the
 * answer never tells an outsider that the id exists in another company (no existence oracle).
 * Every other outcome passes through unchanged: 401 unauthenticated, 503 lookup error, 400. The
 * decision itself is enforceCompanyAccess's, with all of its principals and rules; only the denial's
 * wording changes.
 * Callers answer a missing or company-unresolvable resource with UNIFORM_NOT_FOUND themselves, so
 * all three cases are byte-identical.
 */
/** The access check used a response method the capturing probe does not implement (05, 2026-11-12). */
export class AccessProbeUnsupportedError extends Error {
  constructor(readonly member: string) {
    super(`enforceCompanyAccessUniform: the access check touched res.${member}, which its capturing probe does not implement. Add it to the probe (and replay it) before relying on it.`);
    this.name = 'AccessProbeUnsupportedError';
  }
}

/**
 * The capturing response the access check writes to. Its correctness is an UNSTATED CONTRACT with
 * enforceCompanyAccess (and what it calls), so the contract is stated HERE: the check may only use
 * status / json / send / setHeader / getHeader / end. Anything else throws AccessProbeUnsupportedError
 * (a NAMED failure), never "x is not a function" in an authorization path. Headers are recorded and
 * replayed on the pass-through path, so a future Retry-After on a 503 is not silently lost.
 * Exported for the contract test.
 */
export function createAccessProbe() {
  const captured: { status: number | null; body: unknown; headers: Record<string, unknown> } = { status: null, body: undefined, headers: {} };
  const impl: Record<string, unknown> = {
    status(code: number) { captured.status = code; return proxy; },
    json(body: unknown) { captured.body = body; return proxy; },
    send(body: unknown) { captured.body = body; return proxy; },
    setHeader(name: string, value: unknown) { captured.headers[String(name).toLowerCase()] = value; return proxy; },
    getHeader(name: string) { return captured.headers[String(name).toLowerCase()]; },
    end() { return proxy; },
  };
  const proxy: NextApiResponse = new Proxy(impl, {
    get(target, prop) {
      if (typeof prop === 'symbol' || prop === 'then') return undefined; // not a thenable; inspection-safe
      if (prop in target) return target[prop as string];
      throw new AccessProbeUnsupportedError(prop);
    },
    // `res.statusCode = 503` is the one idiom that bypasses the getter. Captured as a status (so a
    // 503 is never silently answered as "not found"); any other assignment is a named failure.
    set(_target, prop, value) {
      if (prop === 'statusCode') { captured.status = Number(value); return true; }
      throw new AccessProbeUnsupportedError(`${String(prop)} (assignment)`);
    },
  }) as unknown as NextApiResponse;
  return { res: proxy, captured };
}

export const enforceCompanyAccessUniform = async (input: {
  req: NextApiRequest;
  res: NextApiResponse;
  companyId: string;
  campaignId?: string | null;
}): Promise<UserContext | null> => {
  const probe = createAccessProbe();
  const access = await enforceCompanyAccess({ req: input.req, res: probe.res, companyId: input.companyId, campaignId: input.campaignId ?? null });
  if (access) return access;
  const status = probe.captured.status ?? 403;
  if (status === 403 || status === 404) {
    input.res.status(404).json(UNIFORM_NOT_FOUND);
    return null;
  }
  // Pass-through (401 / 503 / 400): replay what the check said, headers included.
  for (const [name, value] of Object.entries(probe.captured.headers)) input.res.setHeader(name, value as string);
  input.res.status(status).json(probe.captured.body ?? { error: 'Access check failed' });
  return null;
};
