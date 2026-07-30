import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess, resolveUserContext } from '../../../../backend/services/userContextService';

/**
 * POST /api/command-center/creator-content/package-ai
 *   { company_id, op, text, instruction? } → { content }
 *
 * CREATOR-009 — AI Collaboration on the Content Package. REUSES the AI Gateway to
 * transform the package's TEXT (improve / rewrite / expand / extract / summarize /
 * repurpose …). It NEVER renders an asset and never touches the template — the
 * client applies the result to the package via `applyAiResult`. No new pipeline.
 */
const OP_PROMPT: Record<string, string> = {
  create_draft: 'Write a clear marketing draft from the input.',
  rewrite: 'Rewrite the input, preserving meaning, with stronger clarity.',
  improve: 'Improve the input — tighter, clearer, more persuasive — same facts.',
  expand: 'Expand the input with relevant supporting detail. Do not invent statistics.',
  condense: 'Condense the input to its essential points.',
  merge_sources: 'Merge the input passages into one coherent piece; remove redundancy.',
  extract_insights: 'Extract the key insights as a short bulleted list.',
  extract_statistics: 'Extract every statistic/number with its context, one per line.',
  extract_quotes: 'Extract notable quotes verbatim, one per line.',
  extract_ctas: 'Extract or propose calls-to-action, one per line.',
  generate_faqs: 'Generate a concise FAQ (Q and A) from the input.',
  generate_outline: 'Produce a structured outline (headings + sub-points).',
  generate_summary: 'Write a 2–3 sentence summary.',
  repurpose: 'Repurpose the input for a social audience while keeping the core message.',
  convert_tone: 'Rewrite the input in the requested tone, keeping the facts.',
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const user = await resolveUserContext(req);
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });

  const body = (req.body || {}) as Record<string, unknown>;
  const companyId = String((body.company_id ?? user.defaultCompanyId) || '').trim();
  if (companyId) { const access = await enforceCompanyAccess({ req, res, companyId }); if (!access) return; }

  const op = String(body.op || '');
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
  if (!OP_PROMPT[op]) return res.status(400).json({ error: 'unknown op' });
  if (!text) return res.status(400).json({ error: 'text required' });

  try {
    const { runCompletionWithOperation } = await import('../../../../backend/services/aiGateway');
    const { resolveCompanyGroundingGuard } = await import('../../../../backend/services/context/canonicalContentContextResolver');
    const { config } = await import('@/config');
    // Deterministic company grounding: transforms stay in the active company's
    // voice and never name a company absent from the provided text.
    const grounding = await resolveCompanyGroundingGuard(companyId || null);
    const resp = await runCompletionWithOperation({
      operation: 'creator_package_ai',
      companyId,
      model: (config as Record<string, unknown>).OPENAI_MODEL as string || 'gpt-4o-mini',
      temperature: 0.5,
      max_tokens: 1200,
      messages: [
        { role: 'system', content: `${OP_PROMPT[op]} Output plain text only — no JSON, no markdown fences, no rendering markup.\n\n${grounding.directive}` },
        { role: 'user', content: [instruction, text].filter(Boolean).join('\n\n') },
      ],
    });
    const content = typeof resp.output === 'string' && resp.output.trim() ? resp.output.trim() : text;
    return res.status(200).json({ content });
  } catch {
    return res.status(200).json({ content: text });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/command-center/creator-content/package-ai' });
