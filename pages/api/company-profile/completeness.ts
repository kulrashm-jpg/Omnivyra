import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import {
  getProfile,
  calculateCompanyProfileCompleteness,
} from '../../../backend/services/companyProfileService';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';
import {
  calculateIntelligenceReadiness,
  getCompanyContextIntelligence,
} from '../../../backend/services/companyContextIntelligenceService';
import {
  buildCompanyKnowledgeGraph,
  profileKnowledgeReadiness,
} from '../../../backend/services/companyProfile/companyKnowledgeGraph';
import { defineRolloutFlag, resolveRolloutSync } from '../../../lib/platform/rollout';

/**
 * CONVERSATION-INTELLIGENCE-001 Phase B — canonical profile readiness.
 *
 * The ONE canonical readiness signal is `profileKnowledgeReadiness` (knowledge-
 * completeness, value-weighted, monotonic — enoughToProceed = core-6 satisfied),
 * distinct from the field-count `calculateCompanyProfileCompleteness` (kept as a
 * per-section DISPLAY/progress helper) and from `calculateIntelligenceReadiness`
 * (a separate firmographic-intel signal, left untouched).
 *
 * It is surfaced here ADDITIVELY and behind a rollout flag defaulting OFF: with
 * the flag off the response is byte-identical to before this change (the legacy
 * fields are never altered or rerouted); when the flag is shadow/enforce the
 * canonical `knowledge_readiness` field appears alongside them. Nothing on this
 * endpoint makes a readiness *decision* from the field-count today (it is display
 * only), so no live decision is rerouted — the canonical signal is simply made
 * available for downstream (Phase C/E) consumption under the flag.
 */
const PROFILE_KNOWLEDGE_READINESS_FLAG = defineRolloutFlag({
  key: 'profile-knowledge-readiness',
  description:
    'Surface the canonical knowledge-completeness readiness (profileKnowledgeReadiness) on the company-profile completeness endpoint. Additive; default off.',
  defaultMode: 'off',
});

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const companyId = req.query.companyId as string;
  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return;

  const profile = await getProfile(companyId, { autoRefine: false });
  const completeness = calculateCompanyProfileCompleteness(profile);
  const intelligence = await getCompanyContextIntelligence(companyId);
  const intelligenceReadiness = calculateIntelligenceReadiness({ intelligence, profile });

  // Legacy response shape — unchanged. Every existing consumer keeps working.
  const body: Record<string, unknown> = {
    problem_transformation_completion: completeness.section_scores.problem_transformation,
    overall_profile_completion: completeness.score,
    profile_completeness: completeness,
    intelligence_readiness: intelligenceReadiness,
    ...completeness,
  };

  // Canonical knowledge readiness — additive, flag-gated (default OFF ⇒ field
  // absent ⇒ response byte-identical to today). Derived from the SAME persisted
  // profile already loaded above; no new I/O. Skipped when the profile is null.
  const { mode } = resolveRolloutSync(PROFILE_KNOWLEDGE_READINESS_FLAG, { tenantId: companyId });
  if (mode !== 'off' && profile) {
    const graph = buildCompanyKnowledgeGraph(profile);
    body.knowledge_readiness = profileKnowledgeReadiness(graph);
  }

  return res.status(200).json(body);
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/company-profile/completeness' });
