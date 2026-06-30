import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '@/backend/services/userContextService';
import { getLeadSignals } from '@/backend/services/leadIntelligence/legacySignalCompat';

function normalizeNumber(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeDateQuery(value: string | string[] | undefined, endOfDay = false): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const suffix = endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z';
  const parsed = new Date(raw.includes('T') ? raw : `${raw}${suffix}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const organizationId = (req.query.organization_id ?? req.query.organizationId ?? user?.defaultCompanyId) as
      | string
      | undefined;

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const sourceType = typeof req.query.source_type === 'string' ? req.query.source_type : undefined;
    const platform = typeof req.query.platform === 'string' ? req.query.platform : undefined;
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size ?? 20) || 20));
    const minScore = normalizeNumber(req.query.min_score);
    const maxScore = normalizeNumber(req.query.max_score);
    const dateFrom = normalizeDateQuery(req.query.date_from);
    const dateTo = normalizeDateQuery(req.query.date_to, true);
    const threadId = typeof req.query.thread_id === 'string' ? req.query.thread_id : undefined;
    const contactKey = typeof req.query.contact_key === 'string' ? req.query.contact_key : undefined;
    const sourceId = typeof req.query.source_id === 'string' ? req.query.source_id : undefined;

    const canonical = await getLeadSignals({
      organizationId,
      sourceType,
      platform,
      minScore,
      maxScore,
      dateFrom,
      dateTo,
      threadId,
      contactKey,
      sourceId,
      page,
      pageSize,
    });

    if (!canonical) {
      return res.status(503).json({ error: 'Canonical lead_signals table is unavailable' });
    }

    return res.status(200).json({
      items: canonical.items,
      total: canonical.total,
      page,
      page_size: pageSize,
      has_more: page * pageSize < canonical.total,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load lead signals';
    console.error('[api/leads/signals]', message);
    return res.status(500).json({ error: message });
  }
}
