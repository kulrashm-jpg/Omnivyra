import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/admin/blog/generate
 *
 * Super Admin blog generation (public_blogs table).
 *
 * This route is responsible for:
 *   1. Auth: SUPER_ADMIN role only
 *   2. Calling runUnifiedLongFormGeneration()
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
import type { BlogGenerationRequest } from '../../../../lib/blog/runBlogGeneration';
import { runUnifiedLongFormGeneration } from '../../../../lib/content/unifiedLongFormEngine';
import type { BlogAngle } from '../../../../lib/blog/blogGenerationEngine';
import { buildContentContext } from '../../../../lib/content/buildContentContext';
import { isValidBlogFormat } from '../../../../lib/blog/blogStructureTemplates';
import { createHash } from 'crypto';
import { wirePhase2Route } from '../../../../backend/services/billing/phase2RouteWiring';
import { PaymentRequiredError } from '../../../../backend/services/billing/phase2EnforcementGate';
import { ThoughtLeadershipQualityGateError } from '../../../../backend/services/longForm/thoughtLeadershipQualityGate';

async function handler(req: NextApiRequest, res: NextApiResponse) {
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
    format_type,
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
    formatType:       isValidBlogFormat(format_type) ? format_type : 'standard',
  };

  try {
    generationRequest.companyContext = (await buildContentContext(company_id)).companyContext;
  } catch {
    // Profile context enrichment is best-effort and must not block generation.
  }

  // ── 2. Generate (Phase 2 Task 4: routed through the canary gate) ────────────
  // OFF (default/prod) → runs verbatim, ZERO behavior change. SHADOW → +
  // would-block telemetry. ENFORCE (canary orgs only) → HOLD-before-execute
  // with action_key 'blog_generation'. referenceId is deterministic per
  // request so retries reuse the same HOLD (no double-charge).
  const referenceId = createHash('sha256')
    .update([
      company_id,
      generationRequest.mode,
      generationRequest.topic,
      String(generationRequest.formatType ?? 'standard'),
    ].join('|'))
    .digest('hex')
    .slice(0, 40);

  try {
    const result = await wirePhase2Route({
      surface:        'admin.blog.generate',
      organizationId: company_id,
      action:         'blog_generation',
      referenceType:  'blog_generation',
      referenceId,
      run: () => runUnifiedLongFormGeneration({
        ...generationRequest,
        contentType: 'blog',
        formatType: typeof generationRequest.formatType === 'string' ? generationRequest.formatType : undefined,
        templateBlocks: generationRequest.template_blocks,
        targetWordCount: generationRequest.answers?.target_word_count
          ? Number.parseInt(String(generationRequest.answers.target_word_count), 10) || undefined
          : generationRequest.target_words,
        correlation: { referenceType: 'blog_generation', referenceId, parentActivityId: null },
      }),
    });
    return res.status(200).json(result);
  } catch (err) {
    if (err instanceof PaymentRequiredError) {
      return res.status(402).json({ error: err.message, code: err.code });
    }
    // Enterprise quality gate: failed blog drafts are blocked instead of
    // being returned as usable generation output.
    if (err instanceof ThoughtLeadershipQualityGateError) {
      return res.status(422).json({
        error: err.message,
        quality_passed: false,
        thought_leadership_quality: err.report,
      });
    }
    throw err;
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/admin/blog/generate' });
