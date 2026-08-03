/**
 * INT-003 Wave 1 — GET /api/leads/intelligence
 *
 * Authenticated, tenant-scoped, STRICTLY READ-ONLY bulk read of persisted
 * Lead Intelligence list items (INT-002 envelopes via the Phase 6 read
 * service). Callers supply the lead ids; the endpoint supports filtering
 * (status / freshness / band / minScore), sorting (score | generatedAt |
 * confidence | leadId, deterministic leadId tiebreak) and offset pagination —
 * all pure selection over already-persisted DTO fields. No generation, no
 * orchestration, no recomputation, no writes.
 */

import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';
import {
  createLeadIntelligenceReadApi,
  type LeadIntelligenceListItemDTO,
} from '../../../backend/services/leadIntelligenceReadApi';

const MAX_IDS = 200;
const MAX_ID_LENGTH = 128;
const SORT_FIELDS = ['score', 'generatedAt', 'confidence', 'leadId'] as const;
type SortField = (typeof SORT_FIELDS)[number];

/** Parse `ids` (comma-separated and/or repeated param) into a bounded, deduped list. */
function parseIds(raw: string | string[] | undefined): string[] | null {
  const parts = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter((v) => v !== '');
  if (parts.length === 0) return null;
  if (parts.some((v) => v.length > MAX_ID_LENGTH)) return null;
  return [...new Set(parts)].slice(0, MAX_IDS);
}

const csv = (raw: string | string[] | undefined): string[] | null => {
  const parts = (Array.isArray(raw) ? raw : raw ? [raw] : []).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
  return parts.length > 0 ? parts : null;
};

function sortValue(item: LeadIntelligenceListItemDTO, field: SortField): number | string {
  switch (field) {
    case 'score':
      return item.overallScore ?? -1;
    case 'confidence':
      return item.confidence ?? -1;
    case 'generatedAt':
      return item.generatedAt ?? '';
    case 'leadId':
      return item.leadId;
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ids = parseIds(req.query.ids as string | string[] | undefined);
  if (!ids) {
    return res.status(400).json({ error: 'ids required (comma-separated lead ids)' });
  }

  if (Array.isArray(req.query.company_id)) {
    return res.status(400).json({ error: 'company_id must be a single value' });
  }
  const companyId = req.query.company_id as string | undefined;
  const access = await resolveCompanyAccess(req, res, companyId ?? null);
  if (!access) return;

  const sort: SortField = SORT_FIELDS.includes(req.query.sort as SortField) ? (req.query.sort as SortField) : 'score';
  const order = req.query.order === 'asc' ? 'asc' : 'desc';
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.trunc(limitRaw), 100)) : 50;
  const offsetRaw = Number(req.query.offset);
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.trunc(offsetRaw)) : 0;
  const statusFilter = csv(req.query.status as string | string[] | undefined);
  const freshnessFilter = csv(req.query.freshness as string | string[] | undefined);
  const bandFilter = csv(req.query.band as string | string[] | undefined);
  const minScoreRaw = Number(req.query.min_score);
  const minScore = Number.isFinite(minScoreRaw) ? minScoreRaw : null;

  try {
    const readApi = createLeadIntelligenceReadApi();
    const items = await readApi.getLeadIntelligenceListItems(companyId as string, ids);

    const filtered = items.filter((item) => {
      if (statusFilter && !statusFilter.includes(item.status)) return false;
      if (freshnessFilter && !freshnessFilter.includes(item.freshness)) return false;
      if (bandFilter && (item.qualificationBand === null || !bandFilter.includes(item.qualificationBand))) return false;
      if (minScore !== null && (item.overallScore === null || item.overallScore < minScore)) return false;
      return true;
    });

    // Code-unit string compare: deterministic across Node/ICU builds (audit LOW).
    const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
    const direction = order === 'asc' ? 1 : -1;
    const sorted = [...filtered].sort((a, b) => {
      const av = sortValue(a, sort);
      const bv = sortValue(b, sort);
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : cmpStr(String(av), String(bv));
      if (cmp !== 0) return cmp * direction;
      return cmpStr(a.leadId, b.leadId); // deterministic tiebreak
    });

    return res.status(200).json({
      items: sorted.slice(offset, offset + limit),
      total: sorted.length,
      limit,
      offset,
      sort,
      order,
    });
  } catch {
    return res.status(500).json({ error: 'Internal error' });
  }
}

export default __createApiRoute(handler, {
  route: '/api/leads/intelligence',
  policy: { v: 1, category: 'company-scoped', companyIdFrom: 'query.company_id' },
});
