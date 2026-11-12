import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * RETIRED (e1, 2026-11-12) - formerly POST /api/onboarding/validate-company-name, a PUBLIC
 * "is this company name taken" check. Nothing called it (no app page, component or hook, and no
 * extension code), and it had been an enumeration oracle for company names across all tenants
 * (pattern input to ILIKE; fixed in the previous commit). An unused public endpoint is pure attack
 * surface, so it now answers 410 Gone for every method and reads nothing.
 * Nothing else depends on it: onboarding/complete derives its own company name and never called this.
 */
async function handler(_req: NextApiRequest, res: NextApiResponse) {
  return res.status(410).json({ error: 'GONE', reason: 'This endpoint has been retired.' });
}

// W0-1 (Gate A): canonical route pipeline - pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/onboarding/validate-company-name' });
