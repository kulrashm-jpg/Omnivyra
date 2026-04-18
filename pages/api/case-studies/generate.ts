/**
 * POST /api/case-studies/generate
 *
 * Company Admin case-study generation.
 * Routed through the case-study-owned generation module.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { getProfile } from '../../../backend/services/companyProfileService';
import { buildFormattedStyleInstructions } from '../../../lib/content/writingStyleEngine';
import {
  runCaseStudyGeneration,
  type CaseStudyGenerationRequest,
} from '../../../lib/case-study/runCaseStudyGeneration';
import type { BlogAngle } from '../../../lib/blog/blogGenerationEngine';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    company_id,
    topic,
    mode,
    cluster,
    intent,
    answers,
    selected_angle,
    tone,
    related_blogs,
    series_blog_ids,
    template_blocks,
    template_name,
    target_word_count,
    cache_version,
  } = req.body ?? {};

  if (!company_id || typeof company_id !== 'string') {
    return res.status(400).json({ error: 'company_id required' });
  }
  if (!topic || typeof topic !== 'string' || !topic.trim()) {
    return res.status(400).json({ error: 'topic required' });
  }

  const access = await enforceCompanyAccess({ req, res, companyId: company_id });
  if (!access) return;

  const roleGate = await enforceRole({
    req,
    res,
    companyId: company_id,
    allowedRoles: [
      Role.COMPANY_ADMIN,
      Role.CONTENT_CREATOR,
      Role.CONTENT_REVIEWER,
      Role.CONTENT_PUBLISHER,
      Role.SUPER_ADMIN,
    ],
  });
  if (!roleGate) return;

  let writingStyleInstructions: string | undefined;
  let companyProfile: Record<string, unknown> | undefined;

  try {
    const profile = await getProfile(company_id, { autoRefine: false, languageRefine: true });
    if (profile) {
      companyProfile = profile as Record<string, unknown>;
      writingStyleInstructions = buildFormattedStyleInstructions(profile);
    }
  } catch (err) {
    console.warn('[case-studies/generate] profile enrichment failed:', err);
  }

  const resolvedMode = mode === 'angles' || mode === 'full' ? mode : undefined;
  if (!resolvedMode) {
    return res.status(400).json({ error: 'mode required (angles or full)' });
  }

  try {
    const profileAny = (companyProfile || {}) as Record<string, unknown>;
    const str = (key: string): string | undefined => {
      const value = profileAny[key];
      return typeof value === 'string' && value.trim() ? value.trim() : undefined;
    };
    const strArr = (key: string): string[] | undefined => {
      const value = profileAny[key];
      return Array.isArray(value) && value.length > 0
        ? value.filter((entry: unknown) => typeof entry === 'string') as string[]
        : undefined;
    };

    const generationRequest: CaseStudyGenerationRequest = {
      company_id,
      mode: resolvedMode,
      topic: String(topic).trim(),
      cluster: typeof cluster === 'string' ? cluster.trim() : undefined,
      intent: typeof intent === 'string' ? intent.trim() : undefined,
      related_blogs: Array.isArray(related_blogs)
        ? related_blogs.filter((entry: unknown) => typeof entry === 'string')
        : undefined,
      series_blog_ids: Array.isArray(series_blog_ids)
        ? series_blog_ids.filter((entry: unknown) => typeof entry === 'string')
        : undefined,
      answers: (() => {
        const payload = answers && typeof answers === 'object'
          ? answers as Record<string, string>
          : {};
        if (target_word_count && !payload.target_word_count) {
          payload.target_word_count = String(target_word_count);
        }
        return Object.keys(payload).length > 0 ? payload : undefined;
      })(),
      selected_angle: selected_angle as BlogAngle | undefined,
      tone: typeof tone === 'string' ? tone.trim() : undefined,
      blogTable: 'blogs',
      formatType: 'case-study',
      template_blocks: Array.isArray(template_blocks) ? template_blocks : undefined,
      template_name: typeof template_name === 'string' ? template_name : undefined,
      cache_version: typeof cache_version === 'string' ? cache_version : undefined,
      companyContext: {
        audience: str('target_audience') || str('audience'),
        brand_voice: str('brand_voice') || str('writing_style'),
        industry: str('industry'),
        writingStyleInstructions,
        companyName: str('name'),
        uniqueValue: str('unique_value'),
        competitiveAdvantages: str('competitive_advantages'),
        productsServices: str('products_services'),
        contentThemes: str('content_themes'),
        campaignFocus: str('campaign_focus'),
        growthPriorities: str('growth_priorities'),
        coreProblemStatement: str('core_problem_statement'),
        painSymptoms: strArr('pain_symptoms'),
        authorityDomains: strArr('authority_domains'),
        desiredTransformation: str('desired_transformation'),
        keyMessages: str('key_messages'),
        goals: str('goals'),
        geography: str('geography'),
      },
    };

    const result = await runCaseStudyGeneration(generationRequest);
    return res.status(200).json(result);
  } catch (error) {
    console.error('[case-studies/generate] runCaseStudyGeneration error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate case study',
    });
  }
}
