import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Phase 4 — Community discovery endpoint.
 *
 *   POST /api/active-leads/discovery
 *     Body: { companyId, industryCategory?, description?, icp?, keywords?[],
 *             competitors?[] }
 *     Returns discovery candidates AND persists them as 'suggested'
 *     recommendations (idempotent on (org, source_type, source_identifier)).
 *
 * Discovery is read-only over the org profile + the curated seed dataset.
 * No external API calls. No AI generation. Recommendations remain advisory
 * until explicitly transitioned by the user via /recommendations.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getUserRole } from '../../../backend/services/rbacService';
import { hasCommunityAiCapability } from '../../../backend/services/rbac/communityAiCapabilities';
import { discoverCommunityCandidates } from '../../../backend/services/communityDiscoveryService';
import { persistDiscoveryResult } from '../../../backend/services/communityRecommendationService';
import { getCachedCapabilityAggregate } from '../../../backend/services/capabilityCacheService';
import { loadCuratedDiscoveryCandidatesForProfile } from '../../../backend/services/curatedIndustrySourceService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = (req.body ?? {}) as {
    companyId?: string;
    industryCategory?: string | null;
    description?: string | null;
    icp?: string | null;
    keywords?: string[];
    competitors?: string[];
  };

  const companyId = body.companyId || '';
  if (!companyId) return res.status(400).json({ error: 'companyId required' });

  const ctx = await enforceCompanyAccess({ req, res, companyId });
  if (!ctx) return;

  const { role, error: roleError } = await getUserRole(ctx.userId, companyId);
  if (roleError || !role) return res.status(403).json({ error: roleError ?? 'FORBIDDEN_ROLE' });
  if (!hasCommunityAiCapability(role, 'MANAGE_LISTENING_CAPABILITIES')) {
    return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }

  // Detect Reddit listening readiness so the discovery service can rank
  // accordingly.
  let redditListeningReady = false;
  try {
    const aggregate = await getCachedCapabilityAggregate(companyId);
    redditListeningReady = aggregate.platforms.some(
      (p) => p.platform === 'reddit' && p.monitoring_ready,
    );
  } catch {
    // best-effort
  }

  const profile = {
    organizationId: companyId,
    industryCategory: body.industryCategory ?? null,
    description: body.description ?? null,
    icp: body.icp ?? null,
    keywords: Array.isArray(body.keywords) ? body.keywords.filter((k) => typeof k === 'string') : [],
    competitors: Array.isArray(body.competitors) ? body.competitors.filter((c) => typeof c === 'string') : [],
    redditListeningReady,
  };

  try {
    const discovery = discoverCommunityCandidates(profile);
    const curatedCandidates = await loadCuratedDiscoveryCandidatesForProfile(profile);
    const existingKeys = new Set(
      discovery.candidates.map((candidate) => `${candidate.source_type}:${candidate.source_identifier}`),
    );
    for (const candidate of curatedCandidates) {
      const key = `${candidate.source_type}:${candidate.source_identifier}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      discovery.candidates.push(candidate);
    }
    const persisted = await persistDiscoveryResult({
      organizationId: companyId,
      candidates: discovery.candidates,
    });
    return res.status(200).json({
      ok: true,
      generated_at: discovery.generated_at,
      candidates: discovery.candidates,
      persistence: {
        inserted: persisted.inserted,
        unchanged: persisted.unchanged,
        total: persisted.total,
      },
    });
  } catch (err: any) {
    console.error('[discovery POST] failed:', err?.message);
    return res.status(500).json({ error: err?.message ?? 'Discovery failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/active-leads/discovery' });
