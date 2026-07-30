import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import {
  validateContentAssistRequest,
  runCampaignContentAssist,
  type ContentAssistLlm,
} from '../../../backend/services/campaign/campaignContentAssistService';
import { resolveCompanyGroundingGuard } from '../../../backend/services/context/canonicalContentContextResolver';

/**
 * POST /api/campaign-content/assist
 *
 * Strategic Mix R3-P1 — explicit, user-invoked assist over ONE campaign
 * content body (improve / shorten / expand / tone shifts / alternatives /
 * platform + audience adaptation / CTA + hook + image-prompt improvement).
 *
 * Contract (SPEC-001 §4, field-assist template): proposal → apply. The
 * response carries candidate copy only; nothing is persisted here — the
 * client applies a proposal into planner_state as a distinct user act.
 *
 * Billed via the existing content_rewrite action (same as field-assist).
 * LLM/billing failures degrade to a deterministic transform where honest
 * (shorten/expand) or an explicit empty-proposal response — never a fake
 * improvement, never a 500 for a degradation.
 *
 * Request:  { company_id, action, content, platform?, content_type?,
 *             audience?, instruction?, count? }
 * Response: { proposals: string[], used_fallback, fallback_reason? }
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const validation = validateContentAssistRequest(req.body);
  if (!validation.ok || !validation.request) {
    return res.status(400).json({ error: 'Invalid content-assist request', details: validation.errors });
  }
  const request = validation.request;

  const user = await resolveUserContext(req);
  const companyId = String((req.body?.company_id ?? user?.defaultCompanyId) || '').trim();
  if (!companyId) return res.status(400).json({ error: 'company_id required' });
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  // Deterministic company grounding: the assist output stays in the active
  // company's voice and may not name any other company (leak prevention).
  const grounding = await resolveCompanyGroundingGuard(companyId);
  request.grounding = grounding.directive;

  // Output budget: one proposal ≈ the content length; alternatives scale it.
  // Content is capped at 8000 chars (~2000 tokens) in validation, so this is
  // a true ceiling, mirroring field-assist's budget discipline.
  const proposalCount = request.action === 'alternatives' ? (request.count ?? 3) : 1;
  const outputTokenBudget = Math.min(4000, Math.max(600, Math.ceil(request.content.length / 3) * proposalCount + 200));

  const llm: ContentAssistLlm = async (messages) => {
    const { runBilledAiCompletion } = await import('../../../backend/services/billing/runBilledAiCompletion');
    const result = await runBilledAiCompletion({
      module: 'http:campaign_content_assist',
      userId: user.userId as string,
      orgId: companyId,
      action: 'content_rewrite',
      referenceType: 'campaign_content_assist',
      referenceId: `${request.action}:${request.platform ?? 'any'}`,
      llmPricing: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        maxInputTokens: 4000,
        maxOutputTokens: outputTokenBudget,
        actionKey: 'content_rewrite',
      },
      idempotency: {
        kind: 'http',
        actorUserId: user.userId as string,
        action: 'content_rewrite',
        referenceId: `campaign-content:${request.action}:${request.platform ?? 'any'}`,
        requestBody: req.body,
      },
      completion: {
        model: 'gpt-4o-mini',
        temperature: 0.7,
        messages,
        max_tokens: outputTokenBudget,
        operation: 'campaignContentAssist',
        response_format: { type: 'json_object' },
        companyId,
      },
    });
    return result.text;
  };

  try {
    const { proposals, usedFallback, fallbackReason } = await runCampaignContentAssist({ request, llm });
    if (usedFallback && fallbackReason) {
      try {
        const { logger } = await import('../../../backend/services/logger');
        logger.warn('campaign_content_assist_fallback', { action: request.action, reason: fallbackReason });
      } catch { /* fail-safe */ }
    }
    return res.status(200).json({
      proposals,
      used_fallback: usedFallback,
      ...(fallbackReason ? { fallback_reason: fallbackReason } : {}),
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'content assist failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaign-content/assist' });
