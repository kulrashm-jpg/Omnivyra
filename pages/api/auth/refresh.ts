import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * POST /api/auth/refresh
 *
 * Touches (extends the freshness of) the principal's auth_session if
 * it's still valid. Used by long-lived clients (e.g. SPA tabs idle for
 * minutes) to confirm the session remains active without performing a
 * full sync.
 *
 * Returns 401 if the session is missing / revoked / expired so the
 * caller can re-trigger the login flow. Bridge principals get 401 too
 * (the bridge does not produce auth_sessions rows).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  resolveSessionFromRequest,
  touchSession,
} from '../../../backend/security/SessionAuthorityService';
import { resolvePrincipal } from '../../../backend/security/IdentityResolver';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const principalResult = await resolvePrincipal(req);
  if (principalResult.ok !== true) {
    return res.status(401).json({ error: 'Not authenticated', code: principalResult.reason });
  }
  const p = principalResult.principal;
  if (p.legacyCookieSuperAdmin) {
    return res.status(401).json({ error: 'Bridge principals cannot refresh auth sessions', code: 'BRIDGE_FACTOR_INSUFFICIENT' });
  }
  if (!p.sessionId) {
    return res.status(401).json({ error: 'No DB-backed auth session', code: 'NO_AUTH_SESSION' });
  }

  // Re-resolve the session to surface revocation/expiry to the caller.
  const lookup = await resolveSessionFromRequest(req);
  if (lookup.ok !== true) {
    return res.status(401).json({ error: 'Session no longer valid', code: lookup.reason });
  }

  await touchSession(lookup.session.id);

  return res.status(200).json({
    sessionId: lookup.session.id,
    expiresAt: lookup.session.expires_at,
    refreshedAt: new Date().toISOString(),
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/auth/refresh' });
