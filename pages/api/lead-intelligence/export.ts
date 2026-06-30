import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import { exportLeads } from '../../../backend/services/leadIntelligence/leadIntelligenceReadService';
import type { CanonicalLeadSource } from '../../../lib/leadIntelligence';

/**
 * GET /api/lead-intelligence/export?format=csv|excel — repository-backed unified
 * export. Never queries fragmented sources directly. Additive endpoint.
 */
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const user = await resolveUserContext(req);
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });
  const companyId = String(req.query.company_id || '').trim();
  if (!companyId) return res.status(400).json({ error: 'company_id required' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const q = req.query;
  const format: 'csv' | 'excel' = q.format === 'excel' ? 'excel' : 'csv';
  const sourceParam = str(q.source);
  const result = await exportLeads({
    companyId,
    search: str(q.q),
    filters: {
      source: sourceParam ? (sourceParam.split(',').filter(Boolean) as CanonicalLeadSource[]) : undefined,
      campaign: str(q.campaign),
      status: str(q.status),
      dateFrom: str(q.from),
      dateTo: str(q.to),
      buyingIntentMin: q.intent_min != null && !Number.isNaN(Number(q.intent_min)) ? Number(q.intent_min) : undefined,
    },
  }, format);

  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  return res.status(200).send(result.body);
}
