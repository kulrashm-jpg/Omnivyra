/**
 * Phase 4 — Opportunity intelligence feed.
 *
 *   GET /api/active-leads/opportunities?companyId=...
 *     Query params: types (csv), platforms (csv), minConfidence,
 *                   minUrgency, since (ISO), cursor, pageSize
 *     Returns: { items, next_cursor, total, type_counts }
 *
 *   GET /api/active-leads/opportunities?companyId=...&counts_only=1
 *     Returns: { type_counts } only — cheap aggregate for filter chips.
 *
 * Read-only. Tenant-scoped. No activation paths.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import {
  getOpportunityFeedTypeCounts,
  queryOpportunityFeed,
} from '../../../backend/services/opportunityFeedService';
import { isOpportunityType, type OpportunityType } from '../../../backend/types/opportunityFeed';

function parseCsv(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string') return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

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
    if (req.query.counts_only === '1' || req.query.counts_only === 'true') {
      const counts = await getOpportunityFeedTypeCounts(companyId);
      return res.status(200).json({ type_counts: counts });
    }

    const types = parseCsv(req.query.types)
      .filter((t) => isOpportunityType(t)) as OpportunityType[];
    const platforms = parseCsv(req.query.platforms);
    const minConfidence = typeof req.query.minConfidence === 'string' ? Number(req.query.minConfidence) : undefined;
    const minUrgency = typeof req.query.minUrgency === 'string' ? Number(req.query.minUrgency) : undefined;
    const sinceIso = typeof req.query.since === 'string' ? req.query.since : undefined;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;
    const pageSize = typeof req.query.pageSize === 'string' ? Number(req.query.pageSize) : undefined;

    const page = await queryOpportunityFeed({
      organizationId: companyId,
      types: types.length > 0 ? types : undefined,
      platforms: platforms.length > 0 ? platforms : undefined,
      minConfidence: Number.isFinite(minConfidence as number) ? minConfidence : undefined,
      minUrgency: Number.isFinite(minUrgency as number) ? minUrgency : undefined,
      sinceIso,
      cursor,
      pageSize,
    });

    const counts = await getOpportunityFeedTypeCounts(companyId);
    return res.status(200).json({ ...page, type_counts: counts });
  } catch (err: any) {
    console.error('[opportunities GET] failed:', err?.message);
    return res.status(500).json({ error: 'Failed to load opportunities' });
  }
}
