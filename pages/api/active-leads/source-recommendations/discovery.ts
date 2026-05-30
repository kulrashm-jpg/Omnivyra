/**
 * PR-CAR-3 — Tiered source-recommendation discovery endpoint.
 *
 *   POST /api/active-leads/source-recommendations/discovery
 *     Body: { companyId }
 *     Response: { ok, generated_at, items: RecommendedSourceDiscoveryItem[],
 *                 context: { confidence, missing_fields } }
 *
 * Loads CompanyContext from the database (PR-CAR-1), runs discovery
 * over the curated seed dataset, scores every candidate with the
 * source-recommendation engine (PR-CAR-2 / 2.1 / 2.2), and returns
 * the result via the shared serializer (PR-CAR-3).
 *
 * This endpoint replaces the manual-input pattern of
 * /api/active-leads/discovery. The old endpoint is unchanged; PR-CAR-4
 * (the UI) will switch the panel over.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { getUserRole } from '../../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../../backend/services/rbac/communityAiCapabilities';
import { getCachedCapabilityAggregate } from '../../../../backend/services/capabilityCacheService';
import {
  discoverCommunityCandidates,
  type DiscoveryCandidate,
} from '../../../../backend/services/communityDiscoveryService';
import {
  loadCompanyContext,
  toDiscoveryProfileInput,
} from '../../../../backend/services/activeLeadsCompanyContext';
import {
  scoreSourcesForOpportunities,
  type AbstractSource,
} from '../../../../backend/services/sourceRecommendationEngine';
import {
  toDiscoveryItem,
  compositeSourceId,
} from '../../../../backend/services/sourceRecommendationContract';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = (req.body ?? {}) as { companyId?: string };
  const companyId = body.companyId || '';
  if (!companyId) return res.status(400).json({ error: 'companyId required' });

  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;

  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }

  let redditListeningReady = false;
  try {
    const aggregate = await getCachedCapabilityAggregate(companyId);
    redditListeningReady = aggregate.platforms.some(
      (p) => p.platform === 'reddit' && p.monitoring_ready,
    );
  } catch {
    // best-effort; rank without it
  }

  try {
    const companyContext = await loadCompanyContext(companyId);

    const discoveryProfile = {
      organizationId: companyId,
      ...toDiscoveryProfileInput(companyContext),
      icp: toDiscoveryProfileInput(companyContext).icp || null,
      industryCategory: toDiscoveryProfileInput(companyContext).industryCategory || null,
      description: toDiscoveryProfileInput(companyContext).description || null,
      redditListeningReady,
    };

    const discovery = discoverCommunityCandidates(discoveryProfile);

    // Map DiscoveryCandidate -> AbstractSource, preserving the existing
    // discovery-engine signal so the scorer doesn't re-do work.
    const abstractSources: AbstractSource[] = discovery.candidates.map(
      (candidate): AbstractSource => ({
        source_type: candidate.source_type,
        source_identifier: candidate.source_identifier,
        display_name: candidate.display_name,
        strategic_relevance: candidate.strategic_relevance,
        matched_verticals: (candidate.source_metadata as { matched_verticals?: string[] })?.matched_verticals,
        matched_keywords: (candidate.source_metadata as { matched_keywords?: string[] })?.matched_keywords,
        matched_competitors: candidate.related_competitors,
        estimated_signal_quality: candidate.estimated_signal_quality,
        estimated_volume: candidate.estimated_volume,
      }),
    );

    const scored = scoreSourcesForOpportunities(companyContext, abstractSources);

    const candidatesByKey = new Map<string, DiscoveryCandidate>();
    for (const candidate of discovery.candidates) {
      candidatesByKey.set(
        compositeSourceId(candidate.source_type, candidate.source_identifier),
        candidate,
      );
    }

    const items = scored.map((source) => {
      const sourceId = compositeSourceId(source.source_type, source.source_identifier);
      const candidate = candidatesByKey.get(sourceId);
      return toDiscoveryItem(source, companyContext, sourceId, candidate?.recommendation_reason);
    });

    return res.status(200).json({
      ok: true,
      generated_at: discovery.generated_at,
      items,
      context: {
        confidence: companyContext.confidence,
        missing_fields: companyContext.missingFields,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Discovery failed';
    console.error('[source-recommendations/discovery POST] failed:', message);
    return res.status(500).json({ error: message });
  }
}
