import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import {
  generateContentSuggestion,
  type ContentSuggestion,
  type ContentSuggestionLlm,
} from '../../../backend/services/content/contentSuggestionService';
import { runBilledAiCompletion } from '../../../backend/services/billing/runBilledAiCompletion';
import { billedAiHttpError } from '../../../backend/services/billing/billedAiHttpError';

/**
 * POST /api/content/suggest
 *   { company_id, content_type, format_label?, platform?, objective?, audience?,
 *     campaign_context?, user_input?, revision_instruction?, previous_suggestion? }
 *     → { suggestion: ContentSuggestion }
 *
 * P1.6 "Suggest with AI". Returns ONE actionable recommendation/brief — never
 * final content, and never a clarifying question. The accepted suggestion is
 * fed into the EXISTING generation flow by the client; this route does not
 * generate content and has no second generation pipeline behind it.
 *
 * Tenant isolation: company_id is resolved from the body or the caller's
 * default company and then passed through `enforceCompanyAccess`, so a caller
 * can only ever obtain suggestions for a company they hold access to. Every
 * signal the service reads is scoped by that same id.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await resolveUserContext(req);
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });

  const body = (req.body || {}) as Record<string, unknown>;
  const companyId = String((body.company_id ?? user.defaultCompanyId) || '').trim();
  if (!companyId) return res.status(400).json({ error: 'company_id required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const contentType = String(body.content_type || '').trim();
  if (!contentType) return res.status(400).json({ error: 'content_type required' });

  const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
  const previous =
    body.previous_suggestion && typeof body.previous_suggestion === 'object'
      ? (body.previous_suggestion as ContentSuggestion)
      : null;
  const revisionIndex =
    typeof body.revision_index === 'number' && Number.isFinite(body.revision_index)
      ? Math.max(1, Math.floor(body.revision_index))
      : 1;

  // C75 (BLOCKING money): the model call is billed as content_rewrite (featureRegistry creatorFieldAssist), the same
  // wrapper and fields as its charged twin /api/creator-templates/field-assist. Insufficient credits => no model call
  // (402). A non-JSON answer fails inside the hold (released, not charged). The same request body from the same user
  // is one charge; a repeat falls back to the free deterministic suggestion.
  const userId = String(user.userId);
  const complete: ContentSuggestionLlm = async (request) => {
    const billed = await runBilledAiCompletion({
      module:        'http:content_suggest',
      userId,
      orgId:         companyId,
      action:        'content_rewrite',
      referenceType: 'content_suggestion',
      referenceId:   `content-suggest:${companyId}:${contentType}`,
      llmPricing: {
        provider:        'openai',
        model:           request.model,
        maxInputTokens:  4000,
        maxOutputTokens: request.max_tokens,
        actionKey:       'content_rewrite',
      },
      idempotency: {
        kind:        'http',
        actorUserId: userId,
        action:      'content_rewrite',
        referenceId: `content-suggest:${companyId}:${contentType}`,
        requestBody: body,
        requestHeaderIdempotency: typeof req.headers['idempotency-key'] === 'string'
          ? (req.headers['idempotency-key'] as string)
          : undefined,
      },
      validateOutput: (text) => { JSON.parse((text ?? '').trim()); },
      completion: {
        companyId,
        operation:       request.operation,
        model:           request.model,
        temperature:     request.temperature,
        max_tokens:      request.max_tokens,
        response_format: { type: 'json_object' },
        messages:        request.messages,
      },
    });
    return billed.text;
  };

  try {
    const suggestion = await generateContentSuggestion({
      companyId,
      contentType,
      formatLabel: str(body.format_label),
      platform: str(body.platform),
      objective: str(body.objective),
      audience: str(body.audience),
      campaignContext: str(body.campaign_context),
      userInput: str(body.user_input),
      revisionInstruction: str(body.revision_instruction),
      previousSuggestion: previous,
      revisionIndex,
    }, { complete });

    return res.status(200).json({ suggestion });
  } catch (error) {
    const refusal = billedAiHttpError(error);
    if (refusal) return res.status(refusal.status).json(refusal.body);
    const message = error instanceof Error ? error.message : 'Failed to generate suggestion';
    return res.status(500).json({ error: message });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/content/suggest' });
