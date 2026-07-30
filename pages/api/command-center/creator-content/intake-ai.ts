import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../../backend/services/userContextService';

/**
 * POST /api/command-center/creator-content/intake-ai
 *   { company_id, brief, asset_family } → { content: <structured text> }
 *
 * CREATOR-008 — AI Content path of the unified intake. REUSES the existing Writer
 * AI (aiGateway) to produce STRUCTURED TEXT (not a rendered asset). The text then
 * flows through the SAME canonical intake → Content Architecture pipeline as every
 * other source. No new generator, no rendering.
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
  if (companyId) { const access = await enforceCompanyAccess({ req, res, companyId }); if (!access) return; }

  const brief = (body.brief && typeof body.brief === 'object' ? body.brief : {}) as Record<string, unknown>;
  const description = typeof brief.description === 'string' ? brief.description.trim() : '';
  if (!description) return res.status(400).json({ error: 'brief.description required' });
  const assetFamily = typeof body.asset_family === 'string' ? body.asset_family : 'image';

  const line = (k: string, v: unknown) => (typeof v === 'string' && v.trim() ? `${k}: ${v.trim()}` : '');
  const briefLines = [
    line('Goal', brief.communicationGoal ?? brief.campaignObjective),
    line('Audience', brief.audience), line('Platform', brief.platform), line('Industry', brief.industry),
    line('Tone', brief.tone), line('Call-to-action', brief.callToAction), line('Keywords', brief.keywords),
    line('Length', brief.lengthPreference),
  ].filter(Boolean).join('\n');

  try {
    const { runCompletionWithOperation } = await import('../../../../backend/services/aiGateway');
    const { resolveCompanyGroundingGuard } = await import('../../../../backend/services/context/canonicalContentContextResolver');
    const { config } = await import('@/config');
    // Deterministic company grounding: content is for the active company only
    // and may not name any other company absent from the brief.
    const grounding = await resolveCompanyGroundingGuard(companyId || null);
    const resp = await runCompletionWithOperation({
      operation: 'creator_intake_ai_content',
      companyId,
      model: (config as Record<string, unknown>).OPENAI_MODEL as string || 'gpt-4o-mini',
      temperature: 0.6,
      max_tokens: 900,
      messages: [
        { role: 'system', content: `You write STRUCTURED marketing content for a ${assetFamily} asset. Output plain text only — a clear headline on the first line, then supporting paragraphs, any key statistics (e.g. "92% faster"), and a closing call-to-action. Do NOT output JSON, markdown fences, slide markup, or rendering instructions — just readable content the downstream engine will structure.\n\n${grounding.directive}` },
        { role: 'user', content: [description, briefLines].filter(Boolean).join('\n\n') },
      ],
    });
    const content = typeof resp.output === 'string' && resp.output.trim() ? resp.output.trim() : description;
    return res.status(200).json({ content });
  } catch {
    // Best-effort: the client also falls back to the brief description.
    return res.status(200).json({ content: description });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/command-center/creator-content/intake-ai' });
