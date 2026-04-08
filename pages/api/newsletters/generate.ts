/**
 * POST /api/newsletters/generate
 *
 * Company Admin newsletter generation.
 * Reuses the blog generation pipeline with contentType='newsletter'
 * for audience-focused, engagement-driven newsletter content.
 *
 * Body: same shape as /api/blogs/generate + content_type: 'newsletter'
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { getProfile } from '../../../backend/services/companyProfileService';
import { buildFormattedStyleInstructions } from '../../../lib/content/writingStyleEngine';
import {
  runNewsletterGeneration,
  type NewsletterGenerationRequest,
} from '../../../lib/newsletter/runNewsletterGeneration';
import type { BlogAngle } from '../../../lib/blog/blogGenerationEngine';
import { isValidNewsletterFormat } from '../../../lib/blog/blogStructureTemplates';

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
    format_type,
    template_blocks,
    template_name,
    target_word_count,
  } = req.body ?? {};

  if (!company_id || typeof company_id !== 'string')
    return res.status(400).json({ error: 'company_id required' });
  if (!topic || typeof topic !== 'string' || !topic.trim())
    return res.status(400).json({ error: 'topic required' });

  // ── 1. Auth ─────────────────────────────────────────────────────────────────
  const access = await enforceCompanyAccess({ req, res, companyId: company_id });
  if (!access) return;

  const roleGate = await enforceRole({
    req, res, companyId: company_id,
    allowedRoles: [Role.COMPANY_ADMIN, Role.CONTENT_CREATOR, Role.CONTENT_REVIEWER, Role.CONTENT_PUBLISHER, Role.SUPER_ADMIN],
  });
  if (!roleGate) return;

  // ── 2. Enrich with company context ──────────────────────────────────────────
  let writingStyleInstructions: string | undefined;
  let companyProfile: Record<string, unknown> | undefined;

  try {
    const profile = await getProfile(company_id, { autoRefine: false, languageRefine: true });
    if (profile) {
      companyProfile = profile as Record<string, unknown>;
      writingStyleInstructions = buildFormattedStyleInstructions(profile);
    }
  } catch (err) {
    console.warn('[newsletters/generate] profile enrichment failed:', err);
  }

  // ── 3. Route based on mode ────────────────────────────────────────────────
  const resolvedMode = mode === 'angles' || mode === 'full' ? mode : undefined;

  if (resolvedMode) {
    try {
      const profileAny = (companyProfile || {}) as Record<string, unknown>;
      const str = (key: string): string | undefined => {
        const v = profileAny[key];
        return typeof v === 'string' && v.trim() ? v.trim() : undefined;
      };
      const strArr = (key: string): string[] | undefined => {
        const v = profileAny[key];
        return Array.isArray(v) && v.length > 0 ? v.filter((s: unknown) => typeof s === 'string') as string[] : undefined;
      };

      const generationRequest: NewsletterGenerationRequest = {
        company_id,
        mode:             resolvedMode,
        topic:            String(topic).trim(),
        cluster:          typeof cluster === 'string' ? cluster.trim() : undefined,
        intent:           typeof intent === 'string' ? intent.trim() : undefined,
        related_blogs:    Array.isArray(related_blogs)
          ? related_blogs.filter((b: unknown) => typeof b === 'string')
          : undefined,
        series_blog_ids:  Array.isArray(series_blog_ids)
          ? series_blog_ids.filter((id: unknown) => typeof id === 'string')
          : undefined,
        answers:          (() => {
          const a = answers && typeof answers === 'object' ? answers as Record<string, string> : {};
          if (target_word_count && !a.target_word_count) a.target_word_count = String(target_word_count);
          return Object.keys(a).length > 0 ? a : undefined;
        })(),
        selected_angle:   selected_angle as BlogAngle | undefined,
        tone:             typeof tone === 'string' ? tone.trim() : undefined,
        blogTable:        'blogs',
        formatType:       isValidNewsletterFormat(format_type) ? format_type : 'weekly-brief',
        template_blocks:  Array.isArray(template_blocks) ? template_blocks : undefined,
        template_name:    typeof template_name === 'string' ? template_name : undefined,
        companyContext: {
          audience:                 str('target_audience') || str('audience'),
          brand_voice:              str('brand_voice') || str('writing_style'),
          industry:                 str('industry'),
          writingStyleInstructions,
          companyName:              str('name'),
          uniqueValue:              str('unique_value'),
          competitiveAdvantages:    str('competitive_advantages'),
          productsServices:         str('products_services'),
          contentThemes:            str('content_themes'),
          campaignFocus:            str('campaign_focus'),
          growthPriorities:         str('growth_priorities'),
          coreProblemStatement:     str('core_problem_statement'),
          painSymptoms:             strArr('pain_symptoms'),
          authorityDomains:         strArr('authority_domains'),
          desiredTransformation:    str('desired_transformation'),
          keyMessages:              str('key_messages'),
          goals:                    str('goals'),
          geography:                str('geography'),
        },
      };

      const result = await runNewsletterGeneration(generationRequest);
      return res.status(200).json(result);
    } catch (error) {
      console.error('[newsletters/generate] runNewsletterGeneration error:', error);
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to generate newsletter',
      });
    }
  }

  // No mode — newsletters always use the modal flow
  return res.status(400).json({ error: 'mode required (angles or full)' });
}
