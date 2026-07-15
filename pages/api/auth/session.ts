import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/auth/session
 *
 * Returns the current principal's session-level summary. UI consumes this
 * to decide what to render BEFORE making capability-specific calls. It is
 * read-only and authoritative — frontends MUST NOT cache role data
 * locally; they MUST call this endpoint each session.
 *
 * Auth: Bearer token OR Supabase auth cookie.
 * Returns 401 (no session) for unauthenticated callers; 200 with a sparse
 *  body for legacy-bridge principals.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolvePrincipal } from '../../../backend/security/IdentityResolver';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const result = await resolvePrincipal(req);
  if (result.ok !== true) {
    return res.status(401).json({ error: 'Not authenticated', code: result.reason });
  }

  const p = result.principal;
  return res.status(200).json({
    authenticated: true,
    via: p.legacyCookieSuperAdmin ? 'legacy_cookie_bridge' : 'supabase',
    user: {
      id: p.userId,
      supabaseUid: p.supabaseUid,
      email: p.email,
      emailVerified: p.emailVerified,
    },
    session: {
      id: p.sessionId,
      ageSeconds: p.sessionAgeSeconds,
      staleSeconds: p.sessionStaleSeconds,
    },
    activeOrgId: p.activeOrgId,
    organizations: p.organizations.map((m) => ({
      organizationId: m.organizationId,
      role: m.role,
      status: m.status,
    })),
    mfa: {
      enrolled: p.mfa.enrolled,
      factors: p.mfa.factors,
      lastVerifiedAt: p.mfa.lastVerifiedAt?.toISOString() ?? null,
      phishingResistant: p.mfa.phishingResistant,
    },
    stepUp: {
      active: p.stepUp.active,
      expiresAt: p.stepUp.expiresAt?.toISOString() ?? null,
      factor: p.stepUp.factor,
    },
    device: {
      trusted: p.device.trusted,
    },
    legacyCookieSuperAdmin: p.legacyCookieSuperAdmin,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/auth/session' });
