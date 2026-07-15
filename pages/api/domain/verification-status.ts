import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/domain/verification-status
 *
 * Returns the current verification state for the requesting user's company
 * domain. Used by the onboarding UI to render the DNS/HTTP instructions.
 *
 * Auth & authorization:
 *   - Requires a valid Supabase session.
 *   - Caller must hold an active COMPANY_ADMIN or SUPER_ADMIN role in the
 *     company that owns the domain.
 *
 * Query params:
 *   - company_id (optional) — when omitted, the endpoint uses the caller's
 *     active_company_id from users.active_company_id.
 *
 * Response (200):
 *   {
 *     final_domain: string,
 *     verification_status: 'unverified' | 'pending' | 'verified' | 'admin_override',
 *     verification_method: 'dns' | 'http' | 'admin_override' | null,
 *     verified_at: string | null,
 *     token: null,                    // raw token is never returned (HMAC'd at storage)
 *     token_issued: boolean,          // true if a token exists in the DB
 *     instructions: {
 *       dns:  'omnivira-verification=<your-token>',
 *       http: '/.well-known/omnivira.txt'
 *     }
 *   }
 *
 * IMPORTANT: the raw verification token is shown ONCE at signup
 * (sync-supabase-user response.domain_verification.token). The DB stores only
 * HMAC(token, VERIFICATION_SECRET); the server cannot recover the raw value.
 * If the user lost it, they must regenerate via a future admin-tier endpoint
 * (out of scope for this step).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { resolveAuthenticatedUser } from '../../../backend/services/authResolver';
import { logger } from '../../../backend/services/logger';
import { checkRateLimit } from '../../../lib/auth/rateLimit';

const STATUS_RATE_LIMIT = {
  keyPrefix: 'rl:domain_verification_status',
  limit: 30,
  windowSecs: 60,
};

type SuccessResponse = {
  final_domain: string;
  verification_status: string;
  verification_method: string | null;
  verified_at: string | null;
  token: null;
  token_issued: boolean;
  instructions: {
    dns:  string;
    http: string;
  };
};
type ErrorResponse = { error: string; code?: string; details?: string };

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const ip = String(
    req.headers['x-forwarded-for']
    ?? (req.socket as any)?.remoteAddress
    ?? 'unknown',
  ).split(',')[0].trim();
  const rl = await checkRateLimit(ip, STATUS_RATE_LIMIT);
  if (!rl.allowed) return res.status(429).json({ error: 'RATE_LIMITED' });

  const authResult = await resolveAuthenticatedUser(req);
  if (authResult.error || !authResult.user) {
    return res.status(401).json({ error: 'UNAUTHENTICATED' });
  }
  const supabaseUid: string = authResult.user.supabaseUid;

  const { data: userRow } = await supabase
    .from('users')
    .select('id, active_company_id')
    .eq('supabase_uid', supabaseUid)
    .maybeSingle();
  if (!userRow) return res.status(401).json({ error: 'UNAUTHENTICATED' });
  const internalUserId = (userRow as any).id as string;
  const activeCompanyId = (userRow as any).active_company_id as string | null;

  const queryCompanyId = (req.query.company_id as string | undefined)?.trim();
  const companyId = queryCompanyId && queryCompanyId.length > 0
    ? queryCompanyId
    : activeCompanyId;
  if (!companyId) {
    return res.status(400).json({
      error: 'NO_COMPANY_CONTEXT',
      details: 'No active company on the user; pass ?company_id=<id>',
    });
  }

  // Authorization — COMPANY_ADMIN or SUPER_ADMIN in the target company.
  const { data: roleRow } = await supabase
    .from('user_company_roles')
    .select('role')
    .eq('user_id', internalUserId)
    .eq('company_id', companyId)
    .eq('status', 'active')
    .in('role', ['COMPANY_ADMIN', 'SUPER_ADMIN'])
    .limit(1)
    .maybeSingle();
  if (!roleRow) {
    return res.status(403).json({
      error: 'INSUFFICIENT_PERMISSIONS',
      details: 'Only COMPANY_ADMIN or SUPER_ADMIN may read domain verification status.',
    });
  }

  const { data: domainRow, error: domainErr } = await supabase
    .from('company_domains')
    .select('final_domain, verification_status, verification_method, verified_at, verification_token, is_primary')
    .eq('company_id', companyId)
    .order('is_primary', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (domainErr) {
    logger.error('domain_verification_status_lookup_failed', {
      company_id: companyId,
      message: domainErr.message,
    });
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
  if (!domainRow) {
    return res.status(404).json({ error: 'DOMAIN_NOT_FOUND' });
  }

  return res.status(200).json({
    final_domain:        (domainRow as any).final_domain,
    verification_status: (domainRow as any).verification_status,
    verification_method: (domainRow as any).verification_method ?? null,
    verified_at:         (domainRow as any).verified_at ?? null,
    // Raw token is unrecoverable post-creation (HMAC'd at storage). UIs
    // should rely on the token surfaced at signup; if lost, the user must
    // regenerate via a future admin-tier endpoint.
    token: null,
    token_issued: !!(domainRow as any).verification_token,
    instructions: {
      dns:  'omnivira-verification=<your-token>',
      http: '/.well-known/omnivira.txt',
    },
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/domain/verification-status' });
