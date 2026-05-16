/**
 * Phase 8 — Ingestion throughput inspection.
 *
 *   GET ?companyId=...&scope=org|platform|source|connector&bucket=...
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import {
  listThroughputState,
  type EvaluateThroughputInput,
} from '../../../backend/services/ingestionThroughputService';
import { THROUGHPUT_SCOPES, type ThroughputScope } from '../../../backend/types/ingestionThroughput';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  void ({} as EvaluateThroughputInput); // silence unused import
  const companyId = String(req.query.companyId ?? '');
  if (!companyId) return res.status(400).json({ error: 'companyId required' });
  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;
  try {
    const scope = typeof req.query.scope === 'string' && THROUGHPUT_SCOPES.includes(req.query.scope as ThroughputScope)
      ? (req.query.scope as ThroughputScope)
      : undefined;
    const bucket = typeof req.query.bucket === 'string' ? req.query.bucket : undefined;
    const items = await listThroughputState(companyId, { scope, bucket });
    return res.status(200).json({ items, total: items.length });
  } catch (err: any) {
    console.error('[throughput GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load throughput' });
  }
}
