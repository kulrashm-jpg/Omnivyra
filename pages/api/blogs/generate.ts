/**
 * POST /api/blogs/generate
 *
 * Company Admin blog generation via unified content engine.
 *
 * Routes to blogContentAdapter which:
 *   1. Auth: enforceCompanyAccess + COMPANY_ADMIN role only
 *   2. Company context injection (writing style, audience, brand voice)
 *   3. Queue job to content-blog queue for processing
 *   4. Returns jobId and polling URL
 *
 * Super Admin uses /api/admin/blog/generate (public_blogs, SA role only).
 *
 * Body:
 * {
 *   company_id:       string,
 *   topic:            string,
 *   audience?:        string,
 *   angle_preference?: 'analytical' | 'contrarian' | 'strategic',
 * }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { generateBlogContent } from '../../../backend/adapters/commandCenter/blogContentAdapter';
import { getProfile } from '../../../backend/services/companyProfileService';
import { buildFormattedStyleInstructions } from '../../../lib/content/writingStyleEngine';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    company_id,
    topic,
    audience,
    angle_preference,
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
  let writingStyleInstructions: string | undefined;
  let companyProfile: Record<string, unknown> | undefined;

  try {
    const profile = await getProfile(company_id, { autoRefine: false, languageRefine: true });
    if (profile) {
      companyProfile = profile as Record<string, unknown>;
      writingStyleInstructions = buildFormattedStyleInstructions(profile);
    }
  } catch (err) {
    // Profile enrichment is best-effort and shouldn't block generation
    console.warn('[blogs/generate] profile enrichment failed:', err);
  }

  // ── 3. Queue to unified content generation ──────────────────────────────────
  try {
    const { getContentQueue } = await import('../../../backend/queue/contentGenerationQueues');
    const contentGenerationQueue = getContentQueue('content-blog');

    const result = await generateBlogContent(company_id, contentGenerationQueue, {
      topic: String(topic).trim(),
      audience: typeof audience === 'string' ? audience.trim() : undefined,
      angle_preference: typeof angle_preference === 'string' && angle_preference ?
        angle_preference as 'analytical' | 'contrarian' | 'strategic' : null,
    }, {
      writing_style_instructions: writingStyleInstructions,
      company_profile: companyProfile,
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('[blogs/generate]', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate blog',
    });
  }
}


