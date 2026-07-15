import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 5 — Opportunity graph reader.
 *
 *   GET /api/active-leads/graph?companyId=...
 *     Returns node counts per type.
 *
 *   GET /api/active-leads/graph?companyId=...&opportunityId=...
 *     Returns the one-hop view around a single opportunity.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import {
  getOpportunityGraphForOpportunity,
  listGraphNodeCountsByType,
} from '../../../backend/services/opportunityGraphService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const companyId = String(req.query.companyId ?? '');
  if (!companyId) return res.status(400).json({ error: 'companyId required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  try {
    if (req.query.opportunityId) {
      const view = await getOpportunityGraphForOpportunity(companyId, String(req.query.opportunityId));
      return res.status(200).json(view);
    }
    const counts = await listGraphNodeCountsByType(companyId);
    return res.status(200).json({ node_counts: counts });
  } catch (err: any) {
    console.error('[graph GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load graph' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/graph' });
