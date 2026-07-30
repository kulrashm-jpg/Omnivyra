import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
import type { NextApiRequest, NextApiResponse } from 'next';
import { createHash } from 'crypto';
import { resolveCompanyGroundingGuard } from '../../../backend/services/context/canonicalContentContextResolver';
import { enforceCompanyAccess, resolveUserContext } from '../../../backend/services/userContextService';
import { resolveCreatorCopyContext } from '../../../backend/services/creator/creatorCopyContextResolver';

/**
 * POST /api/creator-templates/chat-brief
 *
 * Conversational brief builder for "Create with AI". The user chats to work out
 * their brief; every turn the assistant replies AND returns a running structured
 * draft (freeText / audience / tone / cta / offer) that the UI can push into the
 * same fields "Suggest with AI" fills. Company facts + brand voice are grounded
 * server-side from the canonical source (never trusted from the client).
 *
 * Request:  { asset_family, goal?, messages:[{role,content}], current_brief?, company_id? }
 * Response: { reply: string, brief: { freeText, audience, tone, cta, offer } }
 *
 * Billed via the existing content_rewrite action, mirroring field-assist.
 */

type Role = 'user' | 'assistant';
interface ChatMessage { role: Role; content: string }
interface BriefDraft { freeText: string; audience: string; tone: string; cta: string; offer: string }

const EMPTY_BRIEF: BriefDraft = { freeText: '', audience: '', tone: '', cta: '', offer: '' };
const MAX_MESSAGES = 24;
const MAX_LEN = 4000;

function clampMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is ChatMessage => !!m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, MAX_LEN) }));
}

function cleanBrief(raw: unknown): BriefDraft {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, MAX_LEN) : '');
  return {
    freeText: s(o.freeText),
    audience: s(o.audience),
    tone: s(o.tone),
    cta: s(o.cta),
    offer: s(o.offer),
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const assetFamily = String(req.body?.asset_family || 'carousel').toLowerCase().trim();
  const goal = String(req.body?.goal || '').slice(0, 500);
  const messages = clampMessages(req.body?.messages);
  const currentBrief = cleanBrief(req.body?.current_brief);
  if (messages.length === 0) return res.status(400).json({ error: 'messages required' });

  const user = await resolveUserContext(req);
  const companyId = String((req.body?.company_id ?? user?.defaultCompanyId) || '').trim();
  if (!companyId) return res.status(400).json({ error: 'company_id required' });
  if (!user?.userId) return res.status(401).json({ error: 'authentication required' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;

  // Canonical company grounding (best-effort — a failure just drops the block).
  let companyBlock = '';
  try {
    const ctx = await resolveCreatorCopyContext(companyId);
    const parts: string[] = [];
    if (ctx.company) parts.push(`Company context: ${JSON.stringify(ctx.company).slice(0, 1500)}`);
    if (ctx.brandVoice) parts.push(`Brand voice: ${JSON.stringify(ctx.brandVoice).slice(0, 600)}`);
    companyBlock = parts.join('\n');
  } catch { /* non-fatal */ }

  const system = `You are a friendly, sharp marketing assistant helping the user create a ${assetFamily} through a short conversation. Your job is to work WITH them to shape a complete, on-brand brief.

${goal ? `The user's goal: ${goal}\n` : ''}${companyBlock ? `${companyBlock}\n` : ''}
Rules:
- Ground everything in the company context above (never generic filler); reflect the brand voice.
- Keep replies short and conversational: confirm what you heard, then ask ONE focused question at a time to fill gaps (audience, tone, call-to-action, the offer/product). When the brief is solid, say so and invite them to use it.
- EVERY turn, also return a running best-draft brief reflecting the whole conversation so far — the user may push it to their fields at any point.

Respond with STRICT JSON only:
{"reply":"<your short conversational message>","brief":{"freeText":"<a concise 1-3 sentence brief paragraph>","audience":"<who it's for>","tone":"<the tone>","cta":"<the call to action>","offer":"<the offer or product>"}}
Fill every brief field with your best inference so far; keep each concise. No markdown, no text outside the JSON.`;

  const llmMessages = [
    { role: 'system' as const, content: system + '\n\n' + (await resolveCompanyGroundingGuard(companyId)).directive },
    {
      role: 'user' as const,
      content: `Current draft brief (may be empty): ${JSON.stringify(currentBrief)}`,
    },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  try {
    const { runBilledAiCompletion } = await import('../../../backend/services/billing/runBilledAiCompletion');
    const convoHash = createHash('sha1').update(JSON.stringify(messages)).digest('hex').slice(0, 16);
    const result = await runBilledAiCompletion({
      module: 'http:creator_chat_brief',
      userId: user.userId as string,
      orgId: companyId,
      action: 'content_rewrite',
      referenceType: 'creator_chat_brief',
      referenceId: `${assetFamily}:${convoHash}`,
      llmPricing: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        maxInputTokens: 4000,
        maxOutputTokens: 700,
        actionKey: 'content_rewrite',
      },
      idempotency: {
        kind: 'http',
        actorUserId: user.userId as string,
        action: 'content_rewrite',
        referenceId: `${assetFamily}:${convoHash}`,
        requestBody: req.body,
      },
      completion: {
        model: 'gpt-4o-mini',
        temperature: 0.7,
        messages: llmMessages,
        max_tokens: 700,
        operation: 'creatorChatBrief',
        response_format: { type: 'json_object' },
        companyId,
      },
    });

    let reply = '';
    let brief = currentBrief;
    try {
      const parsed = JSON.parse(String(result.text || '{}'));
      reply = typeof parsed?.reply === 'string' ? parsed.reply.trim() : '';
      brief = cleanBrief(parsed?.brief);
      // Never regress a filled field to empty across turns.
      brief = {
        freeText: brief.freeText || currentBrief.freeText,
        audience: brief.audience || currentBrief.audience,
        tone: brief.tone || currentBrief.tone,
        cta: brief.cta || currentBrief.cta,
        offer: brief.offer || currentBrief.offer,
      };
    } catch {
      reply = String(result.text || '').slice(0, 800);
      brief = currentBrief;
    }
    if (!reply) reply = 'Here’s an updated draft — tell me what to adjust, or use it.';

    return res.status(200).json({ reply, brief });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : 'chat brief failed' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/creator-templates/chat-brief' });
