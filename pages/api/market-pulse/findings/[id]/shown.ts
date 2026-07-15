import { createApiRoute as __createApiRoute } from '../../../../../lib/platform/routeFactory';
/**
 * POST /api/market-pulse/findings/[id]/shown
 *
 * Phase 2: records a "shown" event for a Market Pulse finding so the
 * existing intelligence-recommendations lifecycle (and downstream weight
 * optimizer) sees the engagement.
 *
 * Idempotent per UTC day per (org, pattern, finding) via
 * `intelligenceRecommendationService.recordRecommendationShown`. Multiple
 * mounts of the same card on the same day collapse to one row.
 *
 * Called by `MarketPulseTabV2` when finding cards mount in the feed.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveCompanyAccess } from '../../../../../backend/services/contentArchitectService';
import { ownedDbTable } from '../../../../../backend/db/writeOwner';
import { recordFindingShown } from '../../../../../backend/services/marketPulse/learningFeedbackService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const findingId = typeof req.query.id === 'string' ? req.query.id : '';
  if (!findingId) return res.status(400).json({ error: 'finding id is required' });

  const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
  const companyId = typeof body.companyId === 'string' ? body.companyId : '';
  if (!companyId) return res.status(400).json({ error: 'companyId is required' });

  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return;

  // Verify ownership before recording.
  const { data: finding } = await ownedDbTable('market_pulse_findings')
    .select('id, category, priority_tier, confidence_score, alert_class')
    .eq('id', findingId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!finding) return res.status(404).json({ error: 'finding not found' });

  const result = await recordFindingShown({
    finding_id: findingId,
    company_id: companyId,
    category: (finding as { category: string }).category,
    priority_tier: ((finding as { priority_tier: string | null }).priority_tier as 'P0' | 'P1' | 'P2' | null) ?? null,
    confidence_score: (finding as { confidence_score: number | null }).confidence_score ?? null,
    alert_class: (finding as { alert_class: string | null }).alert_class ?? null,
  });

  return res.status(200).json({ ok: true, shown_id: result.shown_id, recorded: result.recorded });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/market-pulse/findings/:id/shown' });
