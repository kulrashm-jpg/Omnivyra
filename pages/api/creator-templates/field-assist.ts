import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import {
  validateFieldAssistRequest,
  loadTemplateForAssist,
  runCreatorFieldAssist,
  type AssistLlm,
} from '../../../backend/services/creator/creatorFieldAssistService';
import { resolveCreatorCopyContext } from '../../../backend/services/creator/creatorCopyContextResolver';

/**
 * POST /api/creator-templates/field-assist
 *
 * User-invoked, field-scoped AI assist. Returns ONLY the updated field values
 * for the requested target(s) — never a regenerated asset. AI never runs
 * without an explicit request, and manual content is untouched unless its
 * field was targeted.
 *
 * Request body:
 *   { asset_family, template_id, action, targets:[{scope,field_key,index?,current_value?}], context? }
 * Response:
 *   { updates:[{scope,field_key,index?,value}], used_fallback }
 *
 * The LLM call is billed via the existing content_rewrite action. Any LLM /
 * billing failure degrades gracefully to a deterministic transform so the
 * endpoint always returns updated values (no broken UX).
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const validation = validateFieldAssistRequest(req.body);
  if (!validation.ok || !validation.request) {
    return res.status(400).json({ error: 'Invalid field-assist request', details: validation.errors });
  }
  const request = validation.request;

  const user = await resolveUserContext(req);
  const companyId = String((req.body?.company_id ?? user?.defaultCompanyId) || '').trim();
  if (!companyId) return res.status(400).json({ error: 'company_id required' });
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  const template = await loadTemplateForAssist(request);
  if (!template) {
    return res.status(404).json({ error: `Template "${request.templateId}" not found for ${request.assetFamily}` });
  }

  // Company-aware grounding — resolve the CANONICAL company context + brand
  // voice server-side and inject them. Company facts come from the canonical
  // source, never from the client (no stage independently guesses company
  // information). Best-effort: a failure leaves prior context-only behavior.
  const copyContext = await resolveCreatorCopyContext(companyId);
  request.context = { ...(request.context ?? {}), company: copyContext.company, brandVoice: copyContext.brandVoice };

  // Output budget scales with the batch size so "Generate all slides/sections"
  // (up to MAX_TARGETS fields) is never truncated mid-JSON — a truncated
  // response drops later slides to weak deterministic placeholders. Each target
  // returns one short field (title ≤70 / body ≤220 chars) plus JSON overhead
  // ≈ ~150 tokens; we budget generously and clamp so a single-field rewrite
  // stays cheap while a 10-slide deck (20 fields) gets ~2400 tokens of headroom.
  const outputTokenBudget = Math.min(2600, Math.max(700, 260 + request.targets.length * 150));

  // Billed LLM injector — graceful: errors are caught inside runCreatorFieldAssist
  // and fall back to a deterministic transform.
  const llm: AssistLlm = async (messages) => {
    const { runBilledAiCompletion } = await import('../../../backend/services/billing/runBilledAiCompletion');
    const result = await runBilledAiCompletion({
      module: 'http:creator_field_assist',
      userId: user.userId as string,
      orgId: companyId,
      action: 'content_rewrite',
      referenceType: 'creator_field_assist',
      referenceId: `${request.templateId}:${request.action}`,
      llmPricing: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        // Input budget must hold the capped source_content (≤6000 chars ≈ 1500 tokens) PLUS
        // company/brand grounding + field/sibling lines. All client strings are length-capped
        // in validateFieldAssistRequest, so 4000 is a true ceiling, not an open door.
        maxInputTokens: 4000,
        maxOutputTokens: outputTokenBudget,
        actionKey: 'content_rewrite',
      },
      idempotency: {
        kind: 'http',
        actorUserId: user.userId as string,
        action: 'content_rewrite',
        referenceId: `${request.templateId}:${request.action}:${request.targets.map((t) => `${t.scope}${t.index ?? ''}${t.fieldKey}`).join(',')}`,
        requestBody: req.body,
      },
      completion: {
        model: 'gpt-4o-mini',
        temperature: 0.7,
        messages,
        max_tokens: outputTokenBudget,
        operation: 'creatorFieldAssist',
        response_format: { type: 'json_object' },
        companyId,
      },
    });
    return result.text;
  };

  try {
    const { updates, usedFallback, invalidTargets, violations, fallbackReason } = await runCreatorFieldAssist({ template, request, llm });
    // Surface WHY the AI degraded to the deterministic transform so a silent
    // fallback (shallow/duplicate copy) is diagnosable in logs + the response.
    if (usedFallback && fallbackReason) {
      try {
        const { logger } = await import('../../../backend/services/logger');
        logger.warn('creator_field_assist_fallback', { operation: request.templateId, action: request.action, reason: fallbackReason });
      } catch { /* fail-safe */ }
    }
    return res.status(200).json({
      updates: updates.map((u) => ({ scope: u.scope, field_key: u.fieldKey, index: u.index, value: u.value })),
      used_fallback: usedFallback,
      ...(fallbackReason ? { fallback_reason: fallbackReason } : {}),
      ...(violations.length > 0 ? { violations } : {}),
      ...(invalidTargets.length > 0 ? { skipped_targets: invalidTargets } : {}),
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'field assist failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/creator-templates/field-assist' });
