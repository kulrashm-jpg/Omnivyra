import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * GET /api/creator-intelligence/recommended-purpose-options
 *
 * Creator Company-Context Strategy Bridge — Phase 3.
 *
 * Returns the existing PURPOSE_OPTIONS reordered per content type
 * based on the company's persisted profile signals. Read-only. No
 * generation logic changes. Falls back to native PURPOSE_OPTIONS
 * order when the company has no profile or no signal matches.
 *
 * Query:
 *   ?company_id=…   (required)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import { getProfile } from '../../../backend/services/companyProfileService';
import {
  analyzeIndustryContributions,
  getRecommendedPurposeOptions,
} from '../../../backend/services/creator/companyStrategyRecommendationEngine';
import { resolveStrategyGovernancePolicy } from '../../../backend/services/creator/strategyGovernancePolicyRegistry';
import { applyStrategyGovernanceAllTypes } from '../../../backend/services/creator/strategyGovernanceApplier';
import { computeLearningPriors } from '../../../backend/services/creator/strategyLearningEngine';
import { blendLearningPriorsAllTypes } from '../../../backend/services/creator/strategyLearningBlender';
import { mergeGovernanceWithLearningAllTypes } from '../../../backend/services/creator/strategyGovernanceLearningMerger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }
  const companyId = String(req.query.company_id || '').trim();
  if (!companyId) {
    return res.status(400).json({ success: false, error: 'company_id required', code: 'COMPANY_ID_REQUIRED' });
  }
  const user = await resolveUserContext(req);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }
  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  try {
    const profile = await getProfile(companyId, { autoRefine: false });
    // Pull the recommendation-engine-recognized fields straight from
    // the profile shape. Anything missing is harmless — the engine
    // is null-safe.
    const recommended = getRecommendedPurposeOptions(profile ? {
      industry: profile.industry ?? null,
      industry_list: profile.industry_list ?? null,
      category: profile.category ?? null,
      category_list: profile.category_list ?? null,
      target_audience: profile.target_audience ?? null,
      target_audience_list: profile.target_audience_list ?? null,
      products_services: profile.products_services ?? null,
      products_services_list: profile.products_services_list ?? null,
      content_themes: profile.content_themes ?? null,
      content_themes_list: profile.content_themes_list ?? null,
      campaign_focus: (profile as any).campaign_focus ?? null,
      pain_symptoms: (profile as any).pain_symptoms ?? null,
      desired_transformation: (profile as any).desired_transformation ?? null,
      core_problem_statement: (profile as any).core_problem_statement ?? null,
      company_name: profile.name ?? null,
    } : null);
    // Creator Compliance-Aware Strategy Governance — Phase 3.
    // Apply the governance policy on top of the recommendation engine
    // output. Recommendation engine is NOT modified; this is a strict
    // post-processing layer that produces (recommended / allowed /
    // restricted) classifications consumed by the picker.
    const policy = resolveStrategyGovernancePolicy(profile ? {
      industry: profile.industry ?? null,
      industry_list: profile.industry_list ?? null,
      category: profile.category ?? null,
      category_list: profile.category_list ?? null,
    } : null);
    const governed = applyStrategyGovernanceAllTypes({
      recommendedByType: recommended,
      policy,
    });
    // Creator Performance Learning Engine — Phase 4. Compute learning
    // priors per lane and blend them ADDITIVELY on top of the
    // recommendation engine output. Governance + cold-start safety:
    // the blender never overrides governance restrictions; in cold
    // start the blender is a no-op and preserves the context engine's
    // order.
    const learningContext = profile ? {
      industry: profile.industry ?? null,
      industry_list: profile.industry_list ?? null,
      target_audience: profile.target_audience ?? null,
      target_audience_list: profile.target_audience_list ?? null,
      products_services: profile.products_services ?? null,
    } : null;
    const learning = {
      image: computeLearningPriors({ companyId, contentType: 'image', companyContext: learningContext }),
      carousel: computeLearningPriors({ companyId, contentType: 'carousel', companyContext: learningContext }),
      infographic: computeLearningPriors({ companyId, contentType: 'infographic', companyContext: learningContext }),
    };
    const blended = blendLearningPriorsAllTypes({
      recommendedByType: recommended,
      learningByType: learning,
    });
    // Creator Validation P1 Remediation — Phase 3. Merge the governance
    // classification with the learning-blended order so the picker can
    // consume ONE shape that has both. Within each governance bucket
    // (recommended / allowed) options are re-sorted by blended score;
    // the restricted bucket is preserved verbatim so a learning-boosted
    // restricted strategy never floats above non-restricted ones.
    const merged = mergeGovernanceWithLearningAllTypes({
      governanceByType: governed,
      blendedByType: blended,
    });
    // Creator Validation P2 Hardening — Phase 2 + 4. Multi-industry
    // analysis surface. Returned alongside `recommended` so the
    // explainability panel can render "Healthcare (+18) · SaaS (+18)
    // → Final +36" without re-running the engine client-side.
    const industryAnalysis = analyzeIndustryContributions(profile ? {
      industry: profile.industry ?? null,
      industry_list: profile.industry_list ?? null,
      category: profile.category ?? null,
      category_list: profile.category_list ?? null,
      target_audience: profile.target_audience ?? null,
      target_audience_list: profile.target_audience_list ?? null,
      products_services: profile.products_services ?? null,
      products_services_list: profile.products_services_list ?? null,
      content_themes: profile.content_themes ?? null,
      content_themes_list: profile.content_themes_list ?? null,
      campaign_focus: (profile as any).campaign_focus ?? null,
      pain_symptoms: (profile as any).pain_symptoms ?? null,
      desired_transformation: (profile as any).desired_transformation ?? null,
      core_problem_statement: (profile as any).core_problem_statement ?? null,
      company_name: profile.name ?? null,
    } : null);
    return res.status(200).json({
      success: true,
      company_id: companyId,
      has_profile: profile !== null,
      recommended,
      industry_analysis: industryAnalysis,
      // Phase 4 — blended recommendations per lane. Backward
      // compatible: callers that read only `recommended` see no
      // change. Picker should prefer `blended` when it's present so
      // operators see the learning-augmented order.
      blended: {
        image: blended.image,
        carousel: blended.carousel,
        infographic: blended.infographic,
      },
      // Phase 5+8 — raw learning summary per lane, exposed so
      // dashboards + admin tools can render the contribution breakdown.
      learning,
      governance: {
        industry: policy.industry,
        risk_level: policy.riskLevel,
        required_warnings: policy.requiredWarnings,
        // Picker now reads the merged per_content_type — every option
        // carries BOTH governance classification AND learning fields,
        // and within each bucket the order is blended-score-sorted.
        per_content_type: {
          image: merged.image,
          carousel: merged.carousel,
          infographic: merged.infographic,
        },
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: 'Failed to compute recommended purpose options',
      code: 'RECOMMENDED_OPTIONS_FAILED',
      message: err?.message || String(err),
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/creator-intelligence/recommended-purpose-options' });
