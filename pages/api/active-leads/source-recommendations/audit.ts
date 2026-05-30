/**
 * PR-CAR-3 — Connected-source audit endpoint.
 *
 *   GET /api/active-leads/source-recommendations/audit?companyId=<id>
 *     Response: { ok, generated_at, items: RecommendedSourceAuditItem[],
 *                 context: { confidence, missing_fields } }
 *
 * Loads CompanyContext (PR-CAR-1), reads the company's existing
 * listening_sources, scores each one against the company context
 * with the recommendation engine, and returns the result via the
 * shared serializer.
 *
 * Read-only: the endpoint NEVER enables, pauses, or otherwise mutates
 * listening_sources state — the spec is explicit that user retains
 * control. The Audit action ("Keep" / "Monitor" / "Consider Pausing")
 * is a recommendation only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { listListeningSourcesForOrg } from '../../../../backend/services/listeningSourceService';
import type { ListeningSource } from '../../../../backend/types/listeningSource';
import {
  loadCompanyContext,
} from '../../../../backend/services/activeLeadsCompanyContext';
import {
  scoreSourcesForOpportunities,
  type AbstractSource,
} from '../../../../backend/services/sourceRecommendationEngine';
import {
  toAuditItem,
} from '../../../../backend/services/sourceRecommendationContract';

function toAbstractSource(row: ListeningSource): AbstractSource {
  const metadata = row.metadata ?? {};
  return {
    source_type: row.source_type,
    source_identifier: row.source_identifier,
    display_name: row.display_name,
    // Connected sources don't carry pre-computed strategic_relevance;
    // the engine synthesizes it from context match + opportunity priors.
    matched_competitors: Array.isArray((metadata as Record<string, unknown>).competitors)
      ? ((metadata as Record<string, unknown>).competitors as string[])
      : undefined,
  };
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
    const [companyContext, sources] = await Promise.all([
      loadCompanyContext(companyId),
      listListeningSourcesForOrg(companyId),
    ]);

    const abstractSources = sources.map(toAbstractSource);
    const scored = scoreSourcesForOpportunities(companyContext, abstractSources);

    const items = scored.map((scoredSource, index) => {
      const row = sources[index];
      return toAuditItem(scoredSource, companyContext, row.id);
    });

    return res.status(200).json({
      ok: true,
      generated_at: new Date().toISOString(),
      items,
      context: {
        confidence: companyContext.confidence,
        missing_fields: companyContext.missingFields,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Audit failed';
    console.error('[source-recommendations/audit GET] failed:', message);
    return res.status(500).json({ error: message });
  }
}
