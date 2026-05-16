/**
 * Phase 5 — Source performance intelligence reader.
 *
 *   GET /api/active-leads/source-performance?companyId=...
 *     Returns per-source performance profiles.
 *
 *   GET /api/active-leads/source-performance?companyId=...&listeningSourceId=...
 *     Returns one source profile.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import {
  getSourcePerformanceProfile,
  listSourcePerformanceForOrg,
} from '../../../backend/services/sourcePerformanceService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const companyId = String(req.query.companyId ?? '');
  if (!companyId) return res.status(400).json({ error: 'companyId required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  try {
    if (req.query.listeningSourceId) {
      const profile = await getSourcePerformanceProfile(companyId, String(req.query.listeningSourceId));
      if (!profile) return res.status(404).json({ error: 'source_not_found' });
      return res.status(200).json({ profile });
    }
    const items = await listSourcePerformanceForOrg(companyId);
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[source-performance GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load source performance' });
  }
}
