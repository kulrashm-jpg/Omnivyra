/**
 * TenantGuard — canonical organization authorization for every
 * tenant-scoped runtime path.
 *
 * Replaces the patchwork of:
 *   - assertOrgAccess (HTTP-only)
 *   - assertOrgMembership (service-only)
 *   - inline `user_company_roles` reads
 *   - body/query-only trust
 *
 * One authority, two surfaces:
 *   • HTTP routes use `requireTenantAccess(req, res, organizationId, …)`,
 *     which writes the standard 4xx error + emits an audit row on denial.
 *   • Background jobs / queue processors / schedulers use
 *     `assertTenantAccess({ userId, organizationId, … })` for the same
 *     decision without HTTP plumbing.
 *
 * Authority chain (no shortcuts):
 *   1. Authenticated principal — IdentityResolver (token/cookie validated).
 *   2. Active membership — user_company_roles row, status='active'.
 *   3. Organization existence + state — companies row, status='active', not soft-deleted.
 *   4. Platform bypass — ONLY through is_platform_super_admin; bridge
 *      principals NEVER bypass (legacyCookieSuperAdmin is rejected here).
 *   5. Optional capability gate — when the route requires more than membership.
 *
 * Soft-delete enforcement: a request to a company with `status != 'active'`
 * OR with `deleted_at IS NOT NULL` is rejected as ORG_INACTIVE — even if
 * the membership row still exists. This matches the spec invariant that
 * a removed/suspended company is never accessible to users, including
 * its admins.
 *
 * No fallback resolution: if the caller does not provide organizationId,
 * the guard rejects. There is no "active_company_id" inference. The
 * caller must pass the exact tenant they intend to act on.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolvePrincipal } from './IdentityResolver';
import { supabase } from '../db/supabaseClient';
import { isPlatformSuperAdmin } from '../services/rbacService';
import { logger } from '../services/logger';
import { logSecurityEvent } from './audit/SecurityAuditService';
import { seedRequestContextFromRequest } from '../services/requestContext';
// W2-1 (Foundation primitives): rollout lifecycle + request-scoped memo.
import { defineRolloutFlag, resolveRolloutSync, runWithRollout } from '../../lib/platform/rollout';
import { memoRequest } from '../services/requestScopedMemo';

// ── Public types ─────────────────────────────────────────────────────────────

export type TenantAccessFailureReason =
  | 'NO_AUTH'             // No principal / unauthenticated
  | 'BRIDGE_NOT_TENANT'   // Legacy cookie super-admin — never satisfies tenant access
  | 'NO_ORG_ID'           // Caller didn't supply an organizationId
  | 'NOT_A_MEMBER'        // No active user_company_roles row for this user+org
  | 'STALE_MEMBERSHIP'    // Member row exists but status != 'active'
  | 'ORG_NOT_FOUND'       // companies row missing
  | 'ORG_INACTIVE'        // companies.status != 'active' (suspended / soft-deleted)
  | 'INSUFFICIENT_ROLE'   // Membership exists but role is below required
  | 'TENANT_LOOKUP_ERROR'; // Transient DB error reading membership/org — retryable, NOT a denial

export interface TenantAccessGranted {
  userId: string;
  supabaseUid: string;
  organizationId: string;
  /** Membership role for this org. Null when bypass=true (platform super-admin). */
  role: string | null;
  /** True when access is granted via platform-super-admin bypass instead of membership. */
  bypass: boolean;
  /** True when the requesting principal is a platform super admin (regardless of bypass). */
  isPlatformSuperAdmin: boolean;
}

export type TenantAccessResult =
  | { ok: true; access: TenantAccessGranted }
  | { ok: false; reason: TenantAccessFailureReason; userId: string | null };

export interface TenantAccessOptions {
  /**
   * Optional minimum role. If provided, the membership's role MUST be in
   * this set. Platform super-admin bypass still applies.
   */
  requireRoleIn?: ReadonlyArray<string>;
  /**
   * When true, the platform-super-admin bypass is disallowed. Use for
   * tenant-scoped operations that should NEVER be performed cross-tenant
   * by an admin (e.g. an end-user's own data export).
   */
  noPlatformBypass?: boolean;
}

// ── Service-layer entry point ────────────────────────────────────────────────

/**
 * Service-layer tenant access decision. Used by background jobs, queue
 * processors, schedulers, and any non-HTTP runtime that needs to gate
 * work on a user/org pair.
 *
 * Pure decision: does NOT mutate any res / NotFound side-channels. The
 * caller is responsible for translating the result into the right
 * domain-level error.
 */
type ReadError = { code?: string | null; message?: string | null } | null;

/**
 * A DETERMINISTIC identity/query error — the query can never succeed for this
 * input no matter how many times it runs (e.g. a synthetic, non-uuid principal
 * such as 'content_architect' compared against a uuid column). This is NOT a
 * transient/infra failure: it must be treated as "no membership" so the
 * existing content-architect / invited-admin fallbacks run, and it must NOT be
 * retried.
 *
 * Postgres SQLSTATE: 22P02 invalid_text_representation (invalid uuid/int
 * syntax), 22023 invalid_parameter_value. Message regex is a defensive
 * fallback when a code is absent.
 */
export function isDeterministicIdentityError(error: ReadError): boolean {
  if (!error) return false;
  const code = String(error.code ?? '');
  if (code === '22P02' || code === '22023') return true;
  const msg = String(error.message ?? '').toLowerCase();
  return /invalid input syntax for type (uuid|integer|bigint|numeric|smallint)/.test(msg)
    || /invalid uuid/.test(msg);
}

/**
 * Read a single Supabase row with a bounded retry on TRANSIENT errors only.
 * A genuine "no row" result is NOT an error and returns immediately. A
 * DETERMINISTIC identity/query error also returns immediately (retrying cannot
 * help). Only transient/transport errors are retried — preventing a momentary
 * Supabase/network blip from being misclassified, while never masking a
 * deterministic input error as an infra failure.
 */
async function readSingleWithRetry<T>(
  label: string,
  run: () => PromiseLike<{ data: T | null; error: ReadError }>,
): Promise<{ data: T | null; error: ReadError }> {
  let last: { data: T | null; error: ReadError } = { data: null, error: null };
  for (let attempt = 0; attempt < 3; attempt++) {
    last = await run();
    if (!last.error) return last;
    if (isDeterministicIdentityError(last.error)) return last; // won't change on retry
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 60 * (attempt + 1)));
  }
  logger.error('tenant_guard_read_retry_exhausted', { label, message: last.error?.message });
  return last;
}

/**
 * W2-1 (Guard Consolidation) rollout flag. Modes:
 *   off (default) — the sequential path below runs exactly as always.
 *   shadow        — sequential stays AUTHORITATIVE; the batched candidate runs
 *                   alongside and decisions are compared (rollout.shadow
 *                   metrics: match / divergence / candidate_error).
 *   enforce       — batched path decides (per-tenant promotable). DO NOT set
 *                   before a zero-divergence shadow soak (Gate C).
 * Kill switches: ROLLOUT_KILL_SWITCH / ROLLOUT_TENANT_GUARD_BATCH_KILL.
 */
const TENANT_GUARD_BATCH_FLAG = defineRolloutFlag({
  key: 'tenant-guard-batch',
  description: 'W2-1: batched + request-memoized tenant guard (audit B-03)',
});

type TenantAccessInput = {
  userId: string | null;
  supabaseUid?: string | null;
  organizationId: string | null | undefined;
  options?: TenantAccessOptions;
  /** When true, platform-super-admin status is ALSO confirmed. Defaults true. */
  consultPlatformSuperAdmin?: boolean;
};

export async function assertTenantAccess(input: TenantAccessInput): Promise<TenantAccessResult> {
  // Fast path: flag fully off (the overwhelming default) → zero new work.
  const mode = resolveRolloutSync(TENANT_GUARD_BATCH_FLAG, {
    tenantId: input.organizationId ?? undefined,
  }).mode;
  if (mode === 'off') return assertTenantAccessSequential(input);
  return runWithRollout(TENANT_GUARD_BATCH_FLAG, {
    tenantId: input.organizationId ?? undefined,
    legacy: () => assertTenantAccessSequential(input),
    candidate: () => assertTenantAccessBatched(input),
    onDivergence: ({ legacy: l, candidate: c }) => {
      try {
        logger.warn('tenant_guard_shadow_divergence', {
          userId: input.userId,
          organizationId: input.organizationId,
          legacy: { ok: l.ok, reason: (l as { reason?: string }).reason ?? null },
          candidate: { ok: c.ok, reason: (c as { reason?: string }).reason ?? null },
        });
      } catch { /* diagnostics never throw */ }
    },
  });
}

/**
 * W2-1 candidate: identical decision tree, but the three independent reads
 * (platform-super-admin, membership, org status) run in ONE parallel batch
 * and are request-memoized (identical re-reads within one request — the
 * audit's 3×-membership pattern — hit the memo instead of the database).
 * Guard latency becomes max(reads) instead of sum(reads).
 */
async function assertTenantAccessBatched(input: TenantAccessInput): Promise<TenantAccessResult> {
  const userId = input.userId;
  const organizationId = input.organizationId;

  if (!userId) return { ok: false, reason: 'NO_AUTH', userId: null };
  if (!organizationId) return { ok: false, reason: 'NO_ORG_ID', userId };

  const [platformSuperAdmin, membership, org] = await Promise.all([
    input.consultPlatformSuperAdmin !== false
      ? memoRequest(`guard:superadmin:${userId}`, () => isPlatformSuperAdmin(userId))
      : Promise.resolve(false),
    memoRequest(`guard:membership:${userId}:${organizationId}`, () =>
      readSingleWithRetry<{ role?: string | null; status?: string | null }>(
        'user_company_roles',
        () => supabase
          .from('user_company_roles')
          .select('role, status')
          .eq('user_id', userId)
          .eq('company_id', organizationId)
          .limit(1)
          .maybeSingle(),
      )),
    memoRequest(`guard:org:${organizationId}`, () =>
      readSingleWithRetry<{ id?: string; status?: string | null }>(
        'companies',
        () => supabase
          .from('companies')
          .select('id, status')
          .eq('id', organizationId)
          .maybeSingle(),
      )),
  ]);

  // Decision tree below is a line-for-line mirror of the sequential path.
  if (platformSuperAdmin && !input.options?.noPlatformBypass) {
    return {
      ok: true,
      access: {
        userId,
        supabaseUid: input.supabaseUid ?? '',
        organizationId,
        role: null,
        bypass: true,
        isPlatformSuperAdmin: true,
      },
    };
  }

  const { data: roleRow, error: roleErr } = membership;
  if (roleErr) {
    if (isDeterministicIdentityError(roleErr)) {
      logger.warn('tenant_guard_identity_mismatch', {
        userId, organizationId, code: roleErr.code ?? null,
      });
      return { ok: false, reason: 'NOT_A_MEMBER', userId };
    }
    logger.error('tenant_guard_db_error', { userId, organizationId, message: roleErr.message });
    return { ok: false, reason: 'TENANT_LOOKUP_ERROR', userId };
  }
  if (!roleRow) return { ok: false, reason: 'NOT_A_MEMBER', userId };

  const status = (roleRow as { status?: string | null }).status ?? null;
  const role   = (roleRow as { role?: string | null }).role ?? null;
  if (status !== 'active') return { ok: false, reason: 'STALE_MEMBERSHIP', userId };

  if (input.options?.requireRoleIn && input.options.requireRoleIn.length > 0) {
    const allowed = role && input.options.requireRoleIn.includes(role);
    if (!allowed) return { ok: false, reason: 'INSUFFICIENT_ROLE', userId };
  }

  const { data: orgRow, error: orgErr } = org;
  if (orgErr) {
    if (isDeterministicIdentityError(orgErr)) return { ok: false, reason: 'ORG_NOT_FOUND', userId };
    return { ok: false, reason: 'TENANT_LOOKUP_ERROR', userId };
  }
  if (!orgRow) return { ok: false, reason: 'ORG_NOT_FOUND', userId };
  if ((orgRow as { status?: string | null }).status !== 'active') {
    return { ok: false, reason: 'ORG_INACTIVE', userId };
  }

  return {
    ok: true,
    access: {
      userId,
      supabaseUid: input.supabaseUid ?? '',
      organizationId,
      role,
      bypass: false,
      isPlatformSuperAdmin: platformSuperAdmin,
    },
  };
}

async function assertTenantAccessSequential(input: TenantAccessInput): Promise<TenantAccessResult> {
  const userId = input.userId;
  const organizationId = input.organizationId;

  if (!userId) return { ok: false, reason: 'NO_AUTH', userId: null };
  if (!organizationId) return { ok: false, reason: 'NO_ORG_ID', userId };

  // Platform super-admin bypass (unless opted-out) — must be first so
  // suspended-org / membership checks don't deny ops actions on broken
  // tenants. If `noPlatformBypass`, fall through to the membership chain.
  let platformSuperAdmin = false;
  if (input.consultPlatformSuperAdmin !== false) {
    platformSuperAdmin = await isPlatformSuperAdmin(userId);
  }
  if (platformSuperAdmin && !input.options?.noPlatformBypass) {
    return {
      ok: true,
      access: {
        userId,
        supabaseUid: input.supabaseUid ?? '',
        organizationId,
        role: null,
        bypass: true,
        isPlatformSuperAdmin: true,
      },
    };
  }

  // Membership: row must exist, status must be 'active'.
  const { data: roleRow, error: roleErr } = await readSingleWithRetry<{ role?: string | null; status?: string | null }>(
    'user_company_roles',
    () => supabase
      .from('user_company_roles')
      .select('role, status')
      .eq('user_id', userId)
      .eq('company_id', organizationId)
      .limit(1)
      .maybeSingle(),
  );

  if (roleErr) {
    if (isDeterministicIdentityError(roleErr)) {
      // Synthetic / non-uuid principal (e.g. 'content_architect', bridge ids)
      // compared against the uuid user_id column. The query can never match —
      // this is NOT an infra failure. Treat it as "no membership" so the
      // existing content-architect / invited-admin fallbacks run, exactly as
      // before the tenant-hardening change.
      logger.warn('tenant_guard_identity_mismatch', {
        userId,
        organizationId,
        code: roleErr.code ?? null,
      });
      return { ok: false, reason: 'NOT_A_MEMBER', userId };
    }
    // A transient/transport query error is NOT proof of non-membership — surface
    // it as a retryable failure so a real member is never locked out by a
    // DB/network blip (which previously became a hard NOT_A_MEMBER → 403).
    logger.error('tenant_guard_db_error', {
      userId,
      organizationId,
      message: roleErr.message,
    });
    return { ok: false, reason: 'TENANT_LOOKUP_ERROR', userId };
  }

  if (!roleRow) return { ok: false, reason: 'NOT_A_MEMBER', userId };

  const status = (roleRow as { status?: string | null }).status ?? null;
  const role   = (roleRow as { role?: string | null }).role ?? null;
  if (status !== 'active') {
    return { ok: false, reason: 'STALE_MEMBERSHIP', userId };
  }

  // Optional role gate.
  if (input.options?.requireRoleIn && input.options.requireRoleIn.length > 0) {
    const allowed = role && input.options.requireRoleIn.includes(role);
    if (!allowed) return { ok: false, reason: 'INSUFFICIENT_ROLE', userId };
  }

  // Organization existence + state. We require status='active' AND
  // deleted_at IS NULL. If the schema doesn't yet have deleted_at, the
  // status check still rejects suspended orgs.
  const { data: orgRow, error: orgErr } = await readSingleWithRetry<{ id?: string; status?: string | null }>(
    'companies',
    () => supabase
      .from('companies')
      .select('id, status')
      .eq('id', organizationId)
      .maybeSingle(),
  );

  if (orgErr) {
    // Deterministic (malformed org id) → not found, not transient. Transient/
    // transport failure → retryable lookup error.
    if (isDeterministicIdentityError(orgErr)) {
      return { ok: false, reason: 'ORG_NOT_FOUND', userId };
    }
    return { ok: false, reason: 'TENANT_LOOKUP_ERROR', userId };
  }
  if (!orgRow) {
    return { ok: false, reason: 'ORG_NOT_FOUND', userId };
  }
  if ((orgRow as { status?: string | null }).status !== 'active') {
    return { ok: false, reason: 'ORG_INACTIVE', userId };
  }

  return {
    ok: true,
    access: {
      userId,
      supabaseUid: input.supabaseUid ?? '',
      organizationId,
      role,
      bypass: false,
      isPlatformSuperAdmin: platformSuperAdmin,
    },
  };
}

// ── HTTP entry point ─────────────────────────────────────────────────────────

/**
 * HTTP-route tenant guard. Resolves the principal from the request,
 * runs the canonical tenant-access decision, and on rejection writes
 * the standard 401/403/404 + emits an audit event. Returns the granted
 * access on success, or null when a response has already been written
 * (the caller must `return` immediately).
 *
 * `organizationId` MUST be supplied by the caller. There is no resolver
 * shortcut here — every call site is explicit about which tenant it
 * intends to act on.
 *
 * Bridge principals (legacy cookie super-admin) are REJECTED. They are
 * platform-tier-only and have no tenant identity.
 */
export async function requireTenantAccess(
  req: NextApiRequest,
  res: NextApiResponse,
  organizationId: string | null | undefined,
  options?: TenantAccessOptions,
): Promise<TenantAccessGranted | null> {
  const principalResult = await resolvePrincipal(req);
  if (principalResult.ok !== true) {
    res.status(401).json({ error: 'Not authenticated', code: principalResult.reason });
    return null;
  }
  const p = principalResult.principal;

  if (p.legacyCookieSuperAdmin) {
    void logSecurityEvent({
      capability: 'tenant.guard',
      decision: 'denied',
      actorUserId: p.userId,
      principalUserId: p.userId,
      principalSupabaseUid: p.supabaseUid,
      reason: 'BRIDGE_NOT_TENANT',
      ip: clientIp(req),
      userAgent: userAgent(req),
    });
    res.status(403).json({
      error: 'Tenant operations require a real user session',
      code: 'BRIDGE_NOT_TENANT',
    });
    return null;
  }

  const result = await assertTenantAccess({
    userId:        p.userId,
    supabaseUid:   p.supabaseUid,
    organizationId,
    options,
  });

  if (result.ok === true) {
    seedRequestContextFromRequest(req, {
      userId: p.userId,
      orgId:  result.access.organizationId,
    });
    return result.access;
  }

  // Reject — translate reason to HTTP code + audit.
  const status = httpStatusForReason(result.reason);
  void logSecurityEvent({
    capability: 'tenant.guard',
    decision: 'denied',
    actorUserId: p.userId,
    principalUserId: p.userId,
    principalSupabaseUid: p.supabaseUid,
    resourceId: typeof organizationId === 'string' ? organizationId : null,
    reason: result.reason,
    ip: clientIp(req),
    userAgent: userAgent(req),
  });

  // Don't leak which reason it was for cross-tenant probes — keep the
  // message generic. The audit row carries the precise reason.
  res.status(status).json({
    error: status === 404 ? 'Organization not found' : 'Tenant access denied',
    code: result.reason,
  });
  return null;
}

function httpStatusForReason(reason: TenantAccessFailureReason): number {
  switch (reason) {
    case 'NO_AUTH':            return 401;
    case 'NO_ORG_ID':          return 400;
    case 'BRIDGE_NOT_TENANT':  return 403;
    case 'NOT_A_MEMBER':       return 403;
    case 'STALE_MEMBERSHIP':   return 403;
    case 'INSUFFICIENT_ROLE':  return 403;
    case 'ORG_NOT_FOUND':      return 404;
    case 'ORG_INACTIVE':       return 403;
    case 'TENANT_LOOKUP_ERROR': return 503; // transient — client should retry, not a denial
  }
}

function clientIp(req: NextApiRequest): string | null {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0]?.trim() ?? null;
  return req.socket?.remoteAddress ?? null;
}

function userAgent(req: NextApiRequest): string | null {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua : null;
}

// ── Identifier extraction helper ─────────────────────────────────────────────

/**
 * Read a tenant identifier from a request body or query under any of
 * the canonical naming variants. Returns null when none match.
 *
 * Why: every route at the boundary calls this so the identifier surface
 * is uniform. The variants supported are exactly the ones found in the
 * codebase as of cross-tenant hardening; new variants must be added here
 * (the union is intentionally narrow).
 */
export function extractTenantId(source: unknown): string | null {
  if (!source || typeof source !== 'object') return null;
  const obj = source as Record<string, unknown>;
  for (const key of [
    'company_id',
    'companyId',
    'organization_id',
    'organizationId',
    'org_id',
    'orgId',
    'tenant_id',
    'tenantId',
  ]) {
    const v = obj[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

/**
 * Convenience: read the tenant id from EITHER the parsed body or the query.
 * The body wins so a route can override a stale URL parameter.
 */
export function extractTenantIdFromRequest(req: NextApiRequest): string | null {
  const body = typeof req.body === 'string'
    ? safeParse(req.body)
    : (req.body ?? null);
  return extractTenantId(body) ?? extractTenantId(req.query);
}

function safeParse(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s) as unknown;
    return (v && typeof v === 'object') ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ── Resource-keyed tenant resolution ─────────────────────────────────────────

/**
 * Resolve the owning organizationId for a campaign and run the canonical
 * tenant guard against it. Used by routes that accept `campaignId` in
 * the body — those routes were the largest cross-tenant attack surface
 * because the campaign id is a guessable UUID and the routes never
 * verified that the campaign belonged to the caller's org.
 *
 * The campaign's company_id IS the canonical owning tenant; we never
 * accept the caller's claim about which tenant they're acting on.
 */
export async function requireCampaignTenantAccess(
  req: NextApiRequest,
  res: NextApiResponse,
  campaignId: string | null | undefined,
  options?: TenantAccessOptions,
): Promise<TenantAccessGranted | null> {
  if (!campaignId) {
    res.status(400).json({ error: 'campaignId required', code: 'NO_RESOURCE_ID' });
    return null;
  }
  const { data, error } = await supabase
    .from('campaigns')
    .select('company_id')
    .eq('id', campaignId)
    .maybeSingle();
  if (error || !data || !(data as { company_id?: string | null }).company_id) {
    res.status(404).json({ error: 'Campaign not found', code: 'CAMPAIGN_NOT_FOUND' });
    return null;
  }
  const companyId = (data as { company_id: string }).company_id;
  return requireTenantAccess(req, res, companyId, options);
}

/**
 * Resolve the owning organizationId for a generated_content_drafts row
 * (or any content_drafts table whose canonical FK is `company_id`) and
 * run the canonical tenant guard against it.
 *
 * Pass `table` to override the default ('generated_content_drafts').
 */
export async function requireContentTenantAccess(
  req: NextApiRequest,
  res: NextApiResponse,
  contentId: string | null | undefined,
  options?: TenantAccessOptions & { table?: string },
): Promise<TenantAccessGranted | null> {
  if (!contentId) {
    res.status(400).json({ error: 'contentId required', code: 'NO_RESOURCE_ID' });
    return null;
  }
  const table = options?.table ?? 'generated_content_drafts';
  const { data, error } = await supabase
    .from(table)
    .select('company_id')
    .eq('id', contentId)
    .maybeSingle();
  if (error || !data || !(data as { company_id?: string | null }).company_id) {
    res.status(404).json({ error: 'Content not found', code: 'CONTENT_NOT_FOUND' });
    return null;
  }
  const companyId = (data as { company_id: string }).company_id;
  return requireTenantAccess(req, res, companyId, options);
}

// ── HTTP handler wrapper ─────────────────────────────────────────────────────

import type { NextApiHandler } from 'next';

/**
 * Wrap a Next.js handler so the canonical tenant guard runs before the
 * handler logic. The handler receives the granted `TenantAccess` via a
 * synthetic property on `req` named `tenantAccess` so it can use the
 * resolved userId/orgId/role without re-querying.
 *
 * Use this for new tenant-scoped routes. For existing routes that already
 * extract their tenant id manually, prefer calling `requireTenantAccess`
 * inline — the wrapper is sugar, not a replacement for the primitive.
 */
export interface TenantScopedRequest extends NextApiRequest {
  tenantAccess: TenantAccessGranted;
}

export function withTenantGuard(
  handler: (req: TenantScopedRequest, res: NextApiResponse) => unknown | Promise<unknown>,
  options?: TenantAccessOptions & {
    /** Override the default tenant-id extractor for routes that read from path params. */
    extractTenantId?: (req: NextApiRequest) => string | null;
  },
): NextApiHandler {
  return async (req, res) => {
    const orgId = options?.extractTenantId?.(req) ?? extractTenantIdFromRequest(req);
    const access = await requireTenantAccess(req, res, orgId, options);
    if (!access) return;
    (req as TenantScopedRequest).tenantAccess = access;
    await handler(req as TenantScopedRequest, res);
  };
}
