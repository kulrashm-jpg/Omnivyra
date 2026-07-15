import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * POST /api/domain/verify
 *
 * Confirms domain ownership via dns OR http per domainVerificationService.
 *
 * Auth & authorization:
 *   - Requires a valid Supabase session.
 *   - Requesting user must hold an active user_company_roles row in the
 *     company that owns the domain (any role is acceptable for self-service
 *     verification).
 *   - SUPER_ADMIN can pass `{ force: true }` to mark the row 'admin_override'
 *     without performing DNS / HTTP checks.
 *
 * Rate limit: 5 verifications per IP per minute.
 *
 * Response shape:
 *   200  { status: 'verified', method: 'dns' | 'http' | 'admin_override' }
 *   400  { status: 'failed',   code:   'VERIFICATION_FAILED', details, attempted? }
 *   401  { status: 'failed',   code:   'UNAUTHENTICATED' }
 *   403  { status: 'failed',   code:   'NOT_DOMAIN_OWNER' }
 *   404  { status: 'failed',   code:   'DOMAIN_NOT_FOUND' }
 *   429  { status: 'failed',   code:   'RATE_LIMITED' }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { resolveAuthenticatedUser } from '../../../backend/services/authResolver';
import { logger } from '../../../backend/services/logger';
import { checkRateLimit } from '../../../lib/auth/rateLimit';
import { normalizeDomain } from '../../../backend/services/domainCanonicalService';
import { verifyDomain } from '../../../backend/services/domainVerificationService';
import { logDomainEvent } from '../../../backend/services/domainEventLogger';
import { trackEvent } from '../../../backend/services/telemetry/telemetryDispatcher';

const VERIFY_RATE_LIMIT = {
  keyPrefix: 'rl:domain_verify',
  limit: 5,
  windowSecs: 60,
};

type VerifyMethod = 'dns' | 'http' | 'admin_override';
type SuccessResponse = { status: 'verified'; method: VerifyMethod };
type ErrorResponse = {
  status: 'failed';
  code: string;
  details?: string;
  attempted?: unknown;
};

async function isSuperAdmin(internalUserId: string): Promise<boolean> {
  const { data } = await supabase
    .from('user_company_roles')
    .select('id')
    .eq('user_id', internalUserId)
    .eq('role', 'SUPER_ADMIN')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  return !!data;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'failed', code: 'METHOD_NOT_ALLOWED' });
  }

  const ip = String(
    req.headers['x-forwarded-for']
    ?? (req.socket as any)?.remoteAddress
    ?? 'unknown',
  ).split(',')[0].trim();
  const rl = await checkRateLimit(ip, VERIFY_RATE_LIMIT);
  if (!rl.allowed) {
    return res.status(429).json({ status: 'failed', code: 'RATE_LIMITED' });
  }

  const authResult = await resolveAuthenticatedUser(req);
  if (authResult.error || !authResult.user) {
    return res.status(401).json({ status: 'failed', code: 'UNAUTHENTICATED' });
  }
  const supabaseUid: string = authResult.user.supabaseUid;

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const rawDomain = (body?.domain ?? '') as string;
  const force = body?.force === true;
  const domain = normalizeDomain(String(rawDomain));
  if (!domain) {
    return res.status(400).json({
      status: 'failed',
      code: 'INVALID_DOMAIN',
      details: 'domain is required',
    });
  }

  // Lookup + run DNS/HTTP checks via the shared service.
  const result = await verifyDomain(domain);
  if (result.ok === false) {
    if (result.error === 'NOT_FOUND') {
      return res.status(404).json({ status: 'failed', code: 'DOMAIN_NOT_FOUND' });
    }
    return res.status(500).json({
      status: 'failed',
      code: 'INTERNAL_ERROR',
      details: result.details,
    });
  }
  const { row, outcome } = result;

  // Resolve the requesting user's internal id for ownership / super-admin checks.
  const { data: userRow } = await supabase
    .from('users')
    .select('id')
    .eq('supabase_uid', supabaseUid)
    .maybeSingle();
  if (!userRow) {
    return res.status(401).json({ status: 'failed', code: 'UNAUTHENTICATED' });
  }
  const internalUserId = (userRow as any).id as string;

  // Force path — SUPER_ADMIN only. Stamps admin_override without DNS/HTTP.
  if (force) {
    if (!(await isSuperAdmin(internalUserId))) {
      return res.status(403).json({
        status: 'failed',
        code: 'FORCE_REQUIRES_SUPER_ADMIN',
      });
    }
    const verifiedAt = new Date().toISOString();
    const { error: updErr } = await supabase
      .from('company_domains')
      .update({
        verification_status: 'admin_override',
        verification_method: 'admin_override',
        verified_at:         verifiedAt,
        verified:            true,
      })
      .eq('id', row.id);
    if (updErr) {
      logger.error('domain_verify_force_update_failed', {
        domain, message: updErr.message,
      });
      return res.status(500).json({ status: 'failed', code: 'INTERNAL_ERROR' });
    }
    logger.info('domain_verification_forced', {
      company_id: row.company_id,
      domain,
      actor_user_id: internalUserId,
    });
    void logDomainEvent({
      event_type:   'DOMAIN_VERIFICATION_SUCCESS',
      company_id:   row.company_id,
      final_domain: domain,
      user_id:      internalUserId,
      metadata:     { method: 'admin_override', forced: true },
    });
    return res.status(200).json({
      status: 'verified',
      method:  'admin_override',
    });
  }

  // Non-force ownership check — caller must hold an active COMPANY_ADMIN or
  // SUPER_ADMIN role in the owning company. Other roles (CONTENT_CREATOR,
  // VIEW_ONLY, etc.) cannot prove ownership of company-wide identity.
  const { data: roleRow } = await supabase
    .from('user_company_roles')
    .select('role')
    .eq('user_id', internalUserId)
    .eq('company_id', row.company_id)
    .eq('status', 'active')
    .in('role', ['COMPANY_ADMIN', 'SUPER_ADMIN'])
    .limit(1)
    .maybeSingle();
  if (!roleRow) {
    return res.status(403).json({
      status: 'failed',
      code: 'INSUFFICIENT_PERMISSIONS',
      details: 'Only COMPANY_ADMIN or SUPER_ADMIN may verify a domain.',
    });
  }

  // Already-verified rows short-circuit cleanly.
  if (row.verification_status === 'admin_override') {
    return res.status(200).json({ status: 'verified', method: 'admin_override' });
  }

  if (!outcome.verified) {
    logger.info('domain_verification_failed', {
      company_id: row.company_id,
      domain,
      reason: outcome.failure_reason,
      attempted: outcome.attempted,
    });
    void logDomainEvent({
      event_type:   'DOMAIN_VERIFICATION_FAILED',
      company_id:   row.company_id,
      final_domain: domain,
      user_id:      internalUserId,
      metadata:     {
        reason:    outcome.failure_reason ?? null,
        dns:       outcome.attempted.dns.detail,
        http:      outcome.attempted.http.detail,
      },
    });
    return res.status(400).json({
      status: 'failed',
      code: 'VERIFICATION_FAILED',
      details: outcome.failure_reason,
      attempted: outcome.attempted,
    });
  }

  const verifiedAt = new Date().toISOString();
  const { error: updErr } = await supabase
    .from('company_domains')
    .update({
      verification_status: 'verified',
      verification_method: outcome.method,
      verified_at:         verifiedAt,
      verified:            true,
    })
    .eq('id', row.id);
  if (updErr) {
    logger.error('domain_verify_update_failed', {
      domain, message: updErr.message,
    });
    return res.status(500).json({ status: 'failed', code: 'INTERNAL_ERROR' });
  }

  logger.info('domain_verification_succeeded', {
    company_id: row.company_id,
    domain,
    method: outcome.method,
  });
  void logDomainEvent({
    event_type:   'DOMAIN_VERIFICATION_SUCCESS',
    company_id:   row.company_id,
    final_domain: domain,
    user_id:      internalUserId,
    metadata:     { method: outcome.method },
  });
  // Canonical telemetry (append-only, fail-soft): domain verification completed.
  // Deduped per domain row (verification is terminal/idempotent).
  trackEvent({
    type: 'website.verification_completed',
    organizationId: row.company_id,
    actorId: internalUserId,
    entityId: row.id,
    metadata: { method: outcome.method },
  });
  return res.status(200).json({
    status: 'verified',
    method:  outcome.method as VerifyMethod,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/domain/verify' });
