import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import {
  generateContentSuggestion,
  type ContentSuggestion,
} from '../../../backend/services/content/contentSuggestionService';

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
    });

    return res.status(200).json({ suggestion });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate suggestion';
    return res.status(500).json({ error: message });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/content/suggest' });
