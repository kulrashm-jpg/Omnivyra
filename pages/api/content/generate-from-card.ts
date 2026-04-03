/**
 * POST /api/content/generate-from-card
 *
 * Generates blog content directly from a Strategic Card or Theme Card.
 * Eliminates the manual re-entry of strategic intelligence — implements GAP-001.
 *
 * This route is responsible for:
 *   1. Auth: enforceCompanyAccess + COMPANY_ADMIN role only
 *   2. Parsing and validating the strategic card payload
 *   3. Calling cardToContentBridge() to map card → BlogGenerationRequest
 *   4. Injecting company profile context (same as /api/blogs/generate)
 *   5. Calling runBlogGeneration() and returning the result
 *
 * ALL generation logic lives in lib/blog/runBlogGeneration.ts.
 * ALL bridge logic lives in lib/content/cardToContentBridge.ts.
 * Zero generation logic is permitted in this file.
 *
 * Body:
 * {
 *   company_id:       string,          required
 *   strategic_card:   object,          required — RecommendationStrategicCard | PlannerStrategicCard
 *   theme_card?:      object | null,   optional — ThemeCardInput for hook/tone injection
 *   content_type?:    string,          optional — 'blog'|'article'|'whitepaper'|'post'|'narrative' (default 'blog')
 *   target_audience?: string,          optional — override audience extracted from card
 *   goal?:            string,          optional — 'awareness'|'authority'|'conversion'|'retention'
 *   mode?:            string,          optional — 'angles'|'full' (default 'full')
 *   override_angle_type?: string,      optional — force 'strategic'|'contrarian'|'analytical'
 * }
 *
 * Response: same shape as POST /api/blogs/generate
 * Additionally includes: bridge_validation (CardBridgeValidation) in the response body
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { enforceRole, Role } from '../../../backend/services/rbacService';
import { runBlogGeneration } from '../../../lib/blog/runBlogGeneration';
import { getProfile } from '../../../backend/services/companyProfileService';
import { buildFormattedStyleInstructions } from '../../../lib/content/writingStyleEngine';
import {
  cardToContentBridge,
  cardToBlogRequest,
  type CardBridgeInput,
  type ContentType,
  type ContentGoal,
} from '../../../lib/content/cardToContentBridge';
import type { AngleType } from '../../../lib/blog/blogGenerationEngine';
import { runContentDepthAndInsightEngine } from '../../../lib/content/contentDepthAndInsightEngine';
import { runContentQualityEnhancer } from '../../../lib/content/contentQualityEnhancer_v2_1';
import { getBlogs } from '../../../backend/services/blogService';

const VALID_CONTENT_TYPES: ContentType[] = ['blog', 'article', 'whitepaper', 'post', 'narrative'];
const VALID_GOALS: ContentGoal[] = ['awareness', 'authority', 'conversion', 'retention'];
const VALID_ANGLE_TYPES: AngleType[] = ['strategic', 'contrarian', 'analytical'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    company_id,
    strategic_card,
    theme_card,
    content_type,
    target_audience,
    goal,
    mode,
    override_angle_type,
  } = req.body ?? {};

  // ── Input validation ────────────────────────────────────────────────────────
  if (!company_id || typeof company_id !== 'string')
    return res.status(400).json({ error: 'company_id required' });

  if (!strategic_card || typeof strategic_card !== 'object' || Array.isArray(strategic_card))
    return res.status(400).json({ error: 'strategic_card required (object)' });

  // Verify the card has a minimum expected shape (sanity boundary check)
  if (!strategic_card.core || !strategic_card.intelligence || !strategic_card.execution)
    return res.status(400).json({ error: 'strategic_card must contain core, intelligence, and execution fields' });

  const resolvedContentType: ContentType =
    VALID_CONTENT_TYPES.includes(content_type) ? content_type : 'blog';

  const resolvedGoal: ContentGoal | undefined =
    VALID_GOALS.includes(goal) ? goal : undefined;

  const resolvedAngleType: AngleType | undefined =
    VALID_ANGLE_TYPES.includes(override_angle_type) ? override_angle_type : undefined;

  // ── 1. Auth ─────────────────────────────────────────────────────────────────
  const access = await enforceCompanyAccess({ req, res, companyId: company_id });
  if (!access) return;

  const roleGate = await enforceRole({
    req, res, companyId: company_id,
    allowedRoles: [Role.COMPANY_ADMIN],
  });
  if (!roleGate) return;

  // ── 2. Bridge: card → BlogGenerationRequest ──────────────────────────────────
  let bridgeInput: CardBridgeInput;
  try {
    bridgeInput = {
      strategic_card,
      theme_card: theme_card && typeof theme_card === 'object' ? theme_card : null,
      content_type: resolvedContentType,
      target_audience: typeof target_audience === 'string' ? target_audience.trim() : undefined,
      goal: resolvedGoal,
      override_angle_type: resolvedAngleType,
    };
  } catch (err) {
    return res.status(400).json({ error: 'Failed to parse card input', detail: String(err) });
  }

  let bridgeOutput;
  try {
    bridgeOutput = cardToContentBridge(bridgeInput);
  } catch (err) {
    return res.status(422).json({ error: 'Card-to-content bridge failed', detail: String(err) });
  }

  const generationRequest = cardToBlogRequest(
    bridgeOutput,
    company_id,
    mode === 'angles' ? 'angles' : 'full',
  );

  // ── 3. Company profile context injection (best-effort) ───────────────────────
  try {
    const profile = await getProfile(company_id, { autoRefine: false, languageRefine: true });
    const profileAny = (profile || {}) as Record<string, unknown>;
    const audience = typeof profileAny.target_audience === 'string'
      ? profileAny.target_audience
      : (typeof profileAny.audience === 'string' ? profileAny.audience : undefined);
    const brandVoice = typeof profileAny.brand_voice === 'string' ? profileAny.brand_voice : undefined;
    const industry = typeof profileAny.industry === 'string' ? profileAny.industry : undefined;
    const writingStyleInstructions = profile ? buildFormattedStyleInstructions(profile) : undefined;

    generationRequest.companyContext = {
      audience,
      brand_voice: brandVoice,
      industry,
      writingStyleInstructions,
    };
  } catch {
    // Profile enrichment is best-effort and must not block generation.
  }

  // ── 4. Generate ──────────────────────────────────────────────────────────────
  const result = await runBlogGeneration(generationRequest);

  // ── 5. Depth + insight correction (post-generation) ─────────────────────────
  // Runs only on full-mode successful generation — skips clarification + angles modes.
  if (result.needs_clarification === false && result.mode === 'full') {
    try {
      const engineOutput = runContentDepthAndInsightEngine({
        content_generation_input: bridgeOutput.content_generation_input,
        generated_content:        result.result,
      });
      const depth_insight_report = {
        depth_report:    engineOutput.depth_report,
        insight_report:  engineOutput.insight_report,
        decision_report: engineOutput.decision_report,
        generic_ratio:   engineOutput.generic_ratio,
        fixes_applied:   engineOutput.fixes_applied,
        validation:      engineOutput.validation,
      };

      // ── 5b. Quality enhancement v2.1 (depth ceiling + internal links + GEO) ──
      let v21Out = null;
      let finalContent = engineOutput.final_content;
      try {
        const catalog = await getBlogs(company_id, 'published').then(
          (blogs) => blogs.map((b) => ({
            slug:     b.slug || '',
            title:    b.title,
            excerpt:  b.excerpt || '',
            tags:     b.tags || [],
            category: b.category,
          })).filter((e) => e.slug.length > 0),
        ).catch(() => []);

        const enhancerOutput = runContentQualityEnhancer({
          content_generation_input: bridgeOutput.content_generation_input,
          final_content:            engineOutput.final_content,
          blog_catalog:             catalog,
        });
        v21Out       = enhancerOutput.validation_report;
        finalContent = enhancerOutput.enhanced_content;
      } catch {
        // v2.1 failures must not block delivery.
      }

      return res.status(200).json({
        ...result,
        result:              finalContent,
        bridge_validation:   bridgeOutput.validation,
        depth_insight_report,
        quality_report:      v21Out,
      });
    } catch {
      // Depth engine failures must not block content delivery — fall through.
    }
  }

  // ── 6. Return result with bridge validation metadata ─────────────────────────
  return res.status(200).json({
    ...result,
    bridge_validation:   bridgeOutput.validation,
    depth_insight_report: null,
  });
}
