/**
 * POST /api/admin/blog/generate
 *
 * Super Admin blog generation (public_blogs table).
 *
 * This route is responsible for:
 *   1. Auth: SUPER_ADMIN role only
 *   2. Calling runBlogGeneration()
 *   3. Returning the result
 *
 * ALL generation logic lives in lib/blog/runBlogGeneration.ts.
 * Zero generation logic is permitted in this file.
 *
 * Company Admin uses /api/blogs/generate (blogs table, COMPANY_ADMIN role).
 *
 * Body:
 * {
 *   company_id:       string,
 *   mode?:            'angles' | 'full',
 *   topic:            string,
 *   cluster?:         string,
 *   intent?:          string,
 *   related_blogs?:   string[],
 *   series_blog_ids?: string[],
 *   series_context?:  string,
 *   answers?:         Record<string, string>,
 *   selected_angle?:  BlogAngle,
 *   tone?:            string,
 *   goal_type?:       string,
 * }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../../backend/services/rbacService';
import {
  runBlogGeneration,
  type BlogGenerationRequest,
} from '../../../../lib/blog/runBlogGeneration';
import type { BlogAngle } from '../../../../lib/blog/blogGenerationEngine';
import { getProfile } from '../../../../backend/services/companyProfileService';
import { buildFormattedStyleInstructions } from '../../../../lib/content/writingStyleEngine';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    company_id,
    mode,
    topic,
    cluster,
    intent,
    related_blogs,
    series_blog_ids,
    series_context,
    answers,
    selected_angle,
    tone,
    goal_type,
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
    allowedRoles: [Role.SUPER_ADMIN],
    // Company Admin uses /api/blogs/generate — not this route.
  });
  if (!roleGate) return;

  const generationRequest: BlogGenerationRequest = {
    company_id,
    mode:             mode === 'angles' ? 'angles' : 'full',
    topic:            String(topic).trim(),
    cluster:          typeof cluster        === 'string' ? cluster.trim()        : undefined,
    intent:           typeof intent         === 'string' ? intent.trim()         : undefined,
    related_blogs:    Array.isArray(related_blogs)
      ? related_blogs.filter((b: unknown) => typeof b === 'string')
      : undefined,
    series_blog_ids:  Array.isArray(series_blog_ids)
      ? series_blog_ids.filter((id: unknown) => typeof id === 'string')
      : undefined,
    series_context:   typeof series_context === 'string' ? series_context.trim() : undefined,
    answers:          answers && typeof answers === 'object' ? answers as Record<string, string> : undefined,
    selected_angle:   selected_angle as BlogAngle | undefined,
    tone:             typeof tone      === 'string' ? tone.trim()      : undefined,
    goal_type:        typeof goal_type === 'string' ? goal_type.trim() : undefined,
    blogTable:        'public_blogs',  // Super Admin always uses public_blogs
  };

  try {
    const profile = await getProfile(company_id, { autoRefine: false, languageRefine: true });
    const profileAny = (profile || {}) as Record<string, unknown>;
    const audience = typeof profileAny.target_audience === 'string'
      ? profileAny.target_audience
      : (typeof profileAny.audience === 'string' ? profileAny.audience : undefined);
    const brandVoice = typeof profileAny.brand_voice === 'string'
      ? profileAny.brand_voice
      : (typeof profileAny.writing_style === 'string' ? profileAny.writing_style : undefined);
    const industry = typeof profileAny.industry === 'string' ? profileAny.industry : undefined;

    // Build writing style instructions from the full company profile
    const writingStyleInstructions = profile ? buildFormattedStyleInstructions(profile) : undefined;

    generationRequest.companyContext = {
      audience,
      brand_voice: brandVoice,
      industry,
      writingStyleInstructions,
    };
  } catch {
    // Profile context enrichment is best-effort and must not block generation.
  }

  // ── 2. Generate ──────────────────────────────────────────────────────────────
  const result = await runBlogGeneration(generationRequest);

  return res.status(200).json(result);
}
