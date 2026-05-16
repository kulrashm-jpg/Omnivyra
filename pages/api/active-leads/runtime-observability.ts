/**
 * Phase 9 — Runtime observability endpoint.
 *
 *   GET ?companyId=...
 *     Returns the synchronous RuntimeHealthSnapshot — queue depths,
 *     recent failure counts, congestion flags.
 *
 * Auth: enforceCompanyAccess. Read-only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getRuntimeHealthSnapshot } from '../../../backend/services/runtimeObservabilityService';

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
    const snapshot = await getRuntimeHealthSnapshot(companyId);
    return res.status(200).json({ snapshot });
  } catch (err: any) {
    console.error('[runtime-observability GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load runtime snapshot' });
  }
}
