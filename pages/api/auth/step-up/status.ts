/**
 * GET /api/auth/step-up/status
 *
 * Returns the principal's current step-up session (if any). Used by the
 * frontend to decide whether a confirmation challenge needs to launch
 * before initiating an elevated action.
 *
 * Server-authoritative: the frontend MUST not cache step-up state.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolvePrincipal } from '../../../../backend/security/IdentityResolver';
import { getActiveStatus } from '../../../../backend/security/stepup/StepUpSessionService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const principalResult = await resolvePrincipal(req);
  if (principalResult.ok !== true) {
    return res.status(401).json({ error: 'Not authenticated', code: principalResult.reason });
  }
  const p = principalResult.principal;
  if (p.legacyCookieSuperAdmin) {
    return res.status(200).json({
      active: false,
      reason: 'BRIDGE_PRINCIPAL_INELIGIBLE',
      legacyCookieSuperAdmin: true,
    });
  }
  if (!p.sessionId) {
    return res.status(200).json({ active: false, reason: 'NO_AUTH_SESSION' });
  }

  const status = await getActiveStatus(p.userId, p.sessionId);
  if (status.active === true) {
    return res.status(200).json({
      active: true,
      session: {
        id:               status.session.id,
        factor:           status.session.factor,
        scopedCapability: status.session.scopedCapability,
        startedAt:        status.session.startedAt.toISOString(),
        expiresAt:        status.session.expiresAt.toISOString(),
      },
    });
  }
  return res.status(200).json({ active: false, reason: status.reason });
}
