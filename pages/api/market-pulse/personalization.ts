import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';
import { saveMarketPulsePersonalizationControls } from '../../../backend/services/marketPulseIntelligenceService';
import { ownedDbTable } from '../../../backend/db/writeOwner';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || '')
    .split(/[,;/|]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
  const companyId = (req.query.companyId as string | undefined) || (body.companyId as string | undefined);
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });

  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return;

  if (req.method === 'GET') {
    const result = await ownedDbTable('marketpulse_personalization_controls')
      .select('*')
      .eq('company_id', companyId)
      .maybeSingle();
    if (result.error) return res.status(500).json({ error: result.error.message });
    return res.status(200).json({
      controls: result.data ?? {
        follow_topics: [],
        mute_topics: [],
        prioritize_categories: [],
        follow_competitors: [],
        follow_regions: [],
        reduce_operational_noise: false,
        increase_strategic_alerts: false,
      },
    });
  }

  if (req.method === 'POST') {
    const normalizedRole = String(access.role ?? '').toUpperCase();
    if (!['SUPER_ADMIN', 'CONTENT_ARCHITECT', 'CAMPAIGN_ARCHITECT', 'COMPANY_ADMIN', 'ADMIN'].includes(normalizedRole)) {
      return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
    }
    const controls = await saveMarketPulsePersonalizationControls(companyId, {
      follow_topics: list(body.follow_topics),
      mute_topics: list(body.mute_topics),
      prioritize_categories: list(body.prioritize_categories),
      follow_competitors: list(body.follow_competitors),
      follow_regions: list(body.follow_regions),
      reduce_operational_noise: Boolean(body.reduce_operational_noise),
      increase_strategic_alerts: Boolean(body.increase_strategic_alerts),
    }, UUID_RE.test(access.userId) ? access.userId : null);
    return res.status(200).json({ controls });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/market-pulse/personalization' });
