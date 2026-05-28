/**
 * POST /api/blogs/generate
 *
 * Company Admin blog generation.
 *
 * Supports the full BlogGenerateModal flow:
 *   mode: 'angles'  → synchronous angle generation via runBlogGeneration
 *   mode: 'full'    → synchronous full blog generation via runBlogGeneration
 *   (no mode)       → queue-based generation via blogContentAdapter (legacy)
 *
 * Super Admin uses /api/admin/blog/generate (public_blogs, SA role only).
 *
 * Body:
 * {
 *   company_id:       string,
 *   topic:            string,
 *   mode?:            'angles' | 'full',
 *   cluster?:         string,
 *   intent?:          string,
 *   answers?:         Record<string, string>,
 *   selected_angle?:  BlogAngle,
 *   tone?:            string,
 *   related_blogs?:   string[],
 *   series_blog_ids?: string[],
 *   audience?:        string,
 *   angle_preference?: 'analytical' | 'contrarian' | 'strategic',
 * }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { generateBlogContent } from '../../../backend/adapters/commandCenter/blogContentAdapter';
import { buildContentContext } from '../../../lib/content/buildContentContext';
import {
  type BlogGenerationRequest,
} from '../../../lib/blog/runBlogGeneration';
import { runUnifiedLongFormGeneration } from '../../../lib/content/unifiedLongFormEngine';
import type { BlogAngle } from '../../../lib/blog/blogGenerationEngine';
import { isValidBlogFormat } from '../../../lib/blog/blogStructureTemplates';

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
    audience,
    angle_preference,
    format_type,
    template_blocks,
    template_name,
    target_word_count,
    cache_version,
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
  let builtContext: Awaited<ReturnType<typeof buildContentContext>> | undefined;

  try {
    builtContext = await buildContentContext(company_id);
  } catch (err) {
    // Profile enrichment is best-effort and shouldn't block generation
    console.warn('[blogs/generate] profile enrichment failed:', err);
  }

  // ── 3. Route based on mode ────────────────────────────────────────────────
  const resolvedMode = mode === 'angles' || mode === 'full' ? mode : undefined;

  // Mode 'angles' or 'full': use runBlogGeneration (synchronous, supports the
  // BlogGenerateModal 4-step flow with clarification + angle picker)
  if (resolvedMode) {
    try {
      const generationRequest: BlogGenerationRequest = {
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
        blogTable:        'blogs',  // Company Admin always uses blogs table
        formatType:       isValidBlogFormat(format_type) ? format_type : 'standard',
        template_blocks:  Array.isArray(template_blocks) ? template_blocks : undefined,
        template_name:    typeof template_name === 'string' ? template_name : undefined,
        cache_version:    typeof cache_version === 'string' ? cache_version : undefined,
        companyContext: builtContext?.companyContext,
        // Phase 2.5 — Canonical identity extraction. Pass the typed profile
        // through so `runBlogGeneration` builds CompanyIdentity via
        // `extractCompanyIdentity(profile)` instead of the lossy
        // CompanyContext-only fallback that used to drop entityArchetype,
        // competitorIntelligence, and userGuidance.
        companyProfile: builtContext?.companyProfile as BlogGenerationRequest['companyProfile'],
      };

      const result = await runUnifiedLongFormGeneration({
        ...generationRequest,
        contentType: 'blog',
        formatType: typeof generationRequest.formatType === 'string' ? generationRequest.formatType : undefined,
        templateBlocks: generationRequest.template_blocks,
        targetWordCount: generationRequest.answers?.target_word_count
          ? Number.parseInt(String(generationRequest.answers.target_word_count), 10) || undefined
          : generationRequest.target_words,
      });
      return res.status(200).json(result);
    } catch (error) {
      console.error('[blogs/generate] runBlogGeneration error:', error);
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to generate blog',
      });
    }
  }

  // ── No mode: legacy queue-based generation ────────────────────────────────
  try {
    const { getContentQueue } = await import('../../../backend/queue/contentGenerationQueues');
    const contentGenerationQueue = getContentQueue('content-blog');

    const result = await generateBlogContent(company_id, contentGenerationQueue, {
      topic: String(topic).trim(),
      audience: typeof audience === 'string' ? audience.trim() : undefined,
      angle_preference: typeof angle_preference === 'string' && angle_preference ?
        angle_preference as 'analytical' | 'contrarian' | 'strategic' : null,
    }, {
      writing_style_instructions: builtContext?.writingStyleInstructions,
      company_profile: builtContext?.companyProfile,
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('[blogs/generate]', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate blog',
    });
  }
}
