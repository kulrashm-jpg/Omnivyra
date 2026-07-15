import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 7 — Operational resilience snapshot.
 *
 *   GET ?companyId=...&windowHours=168
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getOperationalHealthSnapshot } from '../../../backend/services/operationalResilienceService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const companyId = String(req.query.companyId ?? '');
  if (!companyId) return res.status(400).json({ error: 'companyId required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  const windowHours = typeof req.query.windowHours === 'string' ? Number(req.query.windowHours) : undefined;
  try {
    const snapshot = await getOperationalHealthSnapshot(
      companyId,
      Number.isFinite(windowHours) ? Math.max(1, Math.min(24 * 90, Number(windowHours))) : undefined,
    );
    return res.status(200).json(snapshot);
  } catch (err: any) {
    console.error('[op-health GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load operational health' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/op-health' });
