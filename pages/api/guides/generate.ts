import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * POST /api/guides/generate
 *
 * Company Admin guide / pillar content generation.
 * Routed through the guide-owned generation module.
 *
 * Body: same shape as /api/blogs/generate + content_type: 'guide'
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { buildContentContext } from '../../../lib/content/buildContentContext';
import {
  runGuideGeneration,
  type GuideGenerationRequest,
} from '../../../lib/guide/runGuideGeneration';
import type { BlogAngle } from '../../../lib/blog/blogGenerationEngine';
import { isValidGuideFormat } from '../../../lib/blog/blogStructureTemplates';

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
    allowedRoles: [Role.COMPANY_ADMIN, Role.CONTENT_CREATOR, Role.CONTENT_REVIEWER, Role.CONTENT_PUBLISHER, Role.SUPER_ADMIN],
  });
  if (!roleGate) return;

  // ── 2. Enrich with company context ──────────────────────────────────────────
  let builtContext: Awaited<ReturnType<typeof buildContentContext>> | undefined;

  try {
    builtContext = await buildContentContext(company_id);
  } catch (err) {
    console.warn('[guides/generate] profile enrichment failed:', err);
  }

  // ── 3. Route based on mode ────────────────────────────────────────────────
  const resolvedMode = mode === 'angles' || mode === 'full' ? mode : undefined;

  if (resolvedMode) {
    try {
      const generationRequest: GuideGenerationRequest = {
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
        formatType:       isValidGuideFormat(format_type) ? format_type : 'comprehensive',
        template_blocks:  Array.isArray(template_blocks) ? template_blocks : undefined,
        template_name:    typeof template_name === 'string' ? template_name : undefined,
        cache_version:    typeof cache_version === 'string' ? cache_version : undefined,
        companyContext: builtContext?.companyContext,
      };

      const result = await runGuideGeneration(generationRequest);
      return res.status(200).json(result);
    } catch (error) {
      console.error('[guides/generate] runGuideGeneration error:', error);
      return res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to generate guide',
      });
    }
  }

  // No mode — guides always use the modal flow
  return res.status(400).json({ error: 'mode required (angles or full)' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/guides/generate' });
