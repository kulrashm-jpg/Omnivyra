import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * /api/admin/platform-oauth-configs — REMOVED in Phase 2.
 *
 * This route was a parallel surface to /api/super-admin/platform-oauth-configs
 * that:
 *   - Accepted the legacy `super_admin_session=1` bridge cookie outside
 *     `requireCapability`.
 *   - Accepted CONTENT_ARCHITECT_SESSION cookie.
 *   - Accepted ANY user with a case-insensitive role string in
 *     ['COMPANY_ADMIN', 'SUPER_ADMIN', 'ADMIN', 'company_admin',
 *      'super_admin', 'admin'] — letting tenant COMPANY_ADMINs write
 *     platform-wide encrypted OAuth client secrets.
 *
 * The canonical route is /api/super-admin/platform-oauth-configs which
 * gates on `requireCapability(INTEGRATION_PLATFORM_OAUTH_MANAGE)` with
 * phishing-resistant + trusted-device step-up. All callers must move
 * to that route.
 *
 * Returns HTTP 410 Gone for every method. Audits any attempted call so
 * operators see if any client still depends on the old endpoint.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { logSecurityEvent } from '../../../../backend/security/audit/SecurityAuditService';
import { logger } from '../../../../backend/services/logger';

const CANONICAL_PATH = '/api/super-admin/platform-oauth-configs';

function clientIp(req: NextApiRequest): string | null {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0]?.trim() ?? null;
  return req.socket?.remoteAddress ?? null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ip = clientIp(req);
  const ua = (req.headers['user-agent'] as string | undefined) ?? null;

  // Audit every attempted call so we can grep for stragglers and drop
  // this whole file once usage is zero.
  logger.warn('removed_admin_oauth_route_called', {
    method: req.method,
    referer: req.headers.referer ?? null,
    ip,
    canonical: CANONICAL_PATH,
  });
  await logSecurityEvent({
    capability: 'integration.platform.oauth.manage',
    decision: 'denied',
    reason: `removed duplicate route /api/admin/platform-oauth-configs accessed (method=${req.method ?? 'UNKNOWN'}); canonical=${CANONICAL_PATH}`,
    ip,
    userAgent: ua,
  });

  res.setHeader('Deprecation', 'true');
  res.setHeader('Link', `<${CANONICAL_PATH}>; rel="successor-version"`);
  return res.status(410).json({
    error: 'This endpoint has been removed. Use the canonical super-admin route.',
    code: 'ENDPOINT_GONE',
    canonical: CANONICAL_PATH,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/admin/platform-oauth-configs' });
