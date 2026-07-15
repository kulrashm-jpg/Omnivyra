import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 6 — Decision intelligence overlays reader.
 *
 *   GET ?companyId=...&windowHours=168
 *
 * Pure derivation. Read-only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { computeDecisionInsights } from '../../../backend/services/decisionIntelligenceService';

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
    const items = await computeDecisionInsights(companyId, Number.isFinite(windowHours) ? Math.max(1, Math.min(24 * 90, Number(windowHours))) : undefined);
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[decision-intel GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to compute insights' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/decision-intel' });
