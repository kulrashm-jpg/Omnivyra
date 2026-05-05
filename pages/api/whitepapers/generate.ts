import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
/**
 * POST /api/whitepapers/generate
 *
 * Company Admin whitepaper generation.
 * Routed through the whitepaper-owned generation module.
 *
 * Body: same shape as /api/blogs/generate + content_type: 'whitepaper'
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { buildContentContext } from '../../../lib/content/buildContentContext';
import {
  runWhitepaperGeneration,
  type WhitepaperGenerationRequest,
} from '../../../lib/whitepaper/runWhitepaperGeneration';
import type { BlogAngle } from '../../../content/engine/generator';
import { isValidWhitepaperFormat } from '../../../lib/blog/blogStructureTemplates';

async function handler(req: NextApiRequest, res: NextApiResponse) {
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
    allowedRoles: [Role.COMPANY_ADMIN],
  });
  if (!roleGate) return;

  // ── 2. Enrich with company context ──────────────────────────────────────────
  let builtContext: Awaited<ReturnType<typeof buildContentContext>> | undefined;

  try {
    builtContext = await buildContentContext(company_id);
  } catch (err) {
    console.warn('[whitepapers/generate] profile enrichment failed:', err);
  }

  // ── 3. Route based on mode ────────────────────────────────────────────────
  const resolvedMode = mode === 'angles' || mode === 'full' ? mode : undefined;
  const requestedTargetWords = typeof target_word_count === 'number'
    ? target_word_count
    : typeof target_word_count === 'string'
      ? Number.parseInt(target_word_count, 10)
      : undefined;
  const shouldClampLongTemplateDraft =
    resolvedMode === 'full'
    && Array.isArray(template_blocks)
    && template_blocks.length > 0
    && typeof requestedTargetWords === 'number'
    && Number.isFinite(requestedTargetWords)
    && requestedTargetWords > 3000;
  const effectiveTargetWords = shouldClampLongTemplateDraft ? 3000 : requestedTargetWords;

  if (resolvedMode) {
    try {
      const generationRequest: WhitepaperGenerationRequest = {
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
          if (effectiveTargetWords && !a.target_word_count) a.target_word_count = String(effectiveTargetWords);
          if (effectiveTargetWords && a.target_word_count) a.target_word_count = String(effectiveTargetWords);
          return Object.keys(a).length > 0 ? a : undefined;
        })(),
        selected_angle:   selected_angle as BlogAngle | undefined,
        tone:             typeof tone === 'string' ? tone.trim() : undefined,
        blogTable:        'blogs',
        formatType:       isValidWhitepaperFormat(format_type) ? format_type : 'research',
        template_blocks:  Array.isArray(template_blocks) ? template_blocks : undefined,
        template_name:    typeof template_name === 'string' ? template_name : undefined,
        cache_version:    typeof cache_version === 'string' ? cache_version : undefined,
        companyContext: builtContext?.companyContext,
      };

      const result = await runWhitepaperGeneration(generationRequest);
      if (!result.needs_clarification && 'mode' in result && result.mode === 'full') {
        const generated = result.result as unknown as Record<string, unknown>;
        const blocks = Array.isArray(generated.content_blocks) ? generated.content_blocks : [];
        const html = typeof generated.content_html === 'string' ? generated.content_html : '';
        const excerpt = typeof generated.excerpt === 'string' ? generated.excerpt : '';
        console.info('[whitepapers/generate] result-summary', {
          topic: String(topic).trim().slice(0, 120),
          formatType: generationRequest.formatType,
          templateName: generationRequest.template_name || null,
          usedTemplateBlocks: Array.isArray(generationRequest.template_blocks) ? generationRequest.template_blocks.length : 0,
          targetWords: effectiveTargetWords ?? null,
          blockCount: blocks.length,
          htmlLength: html.length,
          excerptLength: excerpt.length,
          titleLength: typeof generated.title === 'string' ? generated.title.length : 0,
        });
      }
      return res.status(200).json({
        ...result,
        ...(shouldClampLongTemplateDraft
          ? {
              generation_notice:
                'Whitepaper template generation was normalized to 3000 words for a stable first-pass draft. Expand the draft further in the editor if needed.',
              requested_target_word_count: requestedTargetWords,
              effective_target_word_count: effectiveTargetWords,
            }
          : {}),
      });
    } catch (error) {
      console.error('[whitepapers/generate] runWhitepaperGeneration error:', error);
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to generate whitepaper',
      });
    }
  }

  // No mode — whitepapers always use the modal flow
  return res.status(400).json({ error: 'mode required (angles or full)' });
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);


