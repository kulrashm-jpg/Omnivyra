import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../backend/services/userContextService';
import { buildDecisionIntelligence, getDecisionIntelligencePresentation, getDecisionIntelligenceHtml } from '../../backend/services/decisionIntelligence/decisionIntelligencePlugin';
import { createCompositionContext } from '../../backend/services/platformIntelligence/registry';
import '../../backend/services/platformIntelligence/plugins'; // auto-register every plugin (incl. website)

/**
 * GET /api/decision-intelligence — the executive surface. Repository-backed: the Decision
 * Intelligence plugin aggregates every registered Platform plugin (registry-only) and the
 * platform engines build the executive summary, scores, dependency graph, roadmap,
 * recommendations, presentation model and HTML projection. No UI logic here.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const user = await resolveUserContext(req);
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });
  const companyId = String(req.query.company_id || '').trim();
  if (!companyId) return res.status(400).json({ error: 'company_id required' });
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  try {
    // One request-scoped context + timestamp shared across all three surfaces — every plugin
    // composes once for the whole request (decision/unified/domains deduped).
    const ctx = createCompositionContext(); const nowMs = Date.now();
    const [decision, presentation, html] = await Promise.all([
      buildDecisionIntelligence(companyId, nowMs, ctx),
      getDecisionIntelligencePresentation(companyId, nowMs, ctx),
      getDecisionIntelligenceHtml(companyId, nowMs, ctx),
    ]);
    return res.status(200).json({ decision, presentation, html });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load decision intelligence' });
  }
}
