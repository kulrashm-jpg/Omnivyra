import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * POST /api/intelligence/context
 *
 * Returns contextual intelligence for an engagement decision point:
 * insight line, up to two hints, confidence, and an optional
 * recommendation CTA. Consumed by the engagement inbox UI when the
 * user selects a signal or generates a suggestion.
 *
 * Body:
 *   {
 *     platform:    string,
 *     action_type: string,            // reply | like | dm
 *     target_id:   string,
 *     organization_id?: string        // resolved from user context if omitted
 *   }
 *
 * Response: IntelligenceResponse (see intelligenceService.ts).
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getContextualIntelligence } from '../../../backend/services/intelligence/intelligenceService';
import { recordRecommendationShown } from '../../../backend/services/intelligence/intelligenceRecommendationService';
import { trackEvent } from '../../../backend/services/telemetry/telemetryDispatcher';

type Body = {
  organization_id?: string;
  platform?: string;
  action_type?: string;
  target_id?: string;
};

function normalizePlatform(p: string): string {
  const v = (p || '').toString().trim().toLowerCase();
  return v === 'x' ? 'twitter' : v;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const body = (req.body || {}) as Body;

    const organizationId = (body.organization_id ?? user?.defaultCompanyId) as string | undefined;
    const platform = normalizePlatform(body.platform ?? '');
    const actionType = (body.action_type ?? '').toString().trim().toLowerCase();
    const targetId = (body.target_id ?? '').toString().trim();

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }
    if (!platform) {
      return res.status(400).json({ error: 'platform required' });
    }
    if (!actionType) {
      return res.status(400).json({ error: 'action_type required' });
    }
    if (!targetId) {
      return res.status(400).json({ error: 'target_id required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const response = await getContextualIntelligence({
      organization_id: organizationId,
      platform,
      action_type: actionType,
      target_id: targetId,
    });

    // Track recommendation-shown the moment we emit one. Deterministic
    // shown-id keys prevent row spam when the UI polls repeatedly.
    if (response.recommendation && !response.cache_hit) {
      const patternType =
        response.comparisons.find(
          (c) => c.winner === `has_${response.recommendation?.type?.replace(/^(use_|avoid_)/, '')}`,
        )?.winner
        ?? response.comparisons[0]?.winner
        ?? response.recommendation.type;

      void recordRecommendationShown({
        organization_id: organizationId,
        platform,
        action_type: actionType,
        target_id: targetId,
        pattern_type: patternType,
        label: response.recommendation.label,
        confidence_score: response.confidence?.score ?? null,
      })
        .then((r) => {
          // Canonical telemetry (append-only, fail-soft): emit only when a NEW
          // shown row was recorded (idempotent per day) → no duplicate impressions.
          if (r?.recorded) {
            trackEvent({
              type: 'recommendations.shown',
              organizationId,
              actorId: user?.userId ?? null,
              entityId: r.shown_id,
              metadata: { recommendationType: patternType },
            });
          }
        })
        .catch(() => {});
    }

    return res.status(200).json({ success: true, ...response });
  } catch (err) {
    console.error('[intelligence/context]', err);
    return res.status(500).json({ error: (err as Error)?.message || 'intelligence lookup failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/intelligence/context' });
