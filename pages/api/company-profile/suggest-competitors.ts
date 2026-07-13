import { NextApiRequest, NextApiResponse } from 'next';
import { runCompletion } from '../../../backend/services/aiGateway';
import { resolveCompanyAccess } from '../../../backend/services/contentArchitectService';
import { getCanonicalProfile as getProfile } from '@/backend/services/context/canonicalProfileAdapter';

/**
 * Competitive-intelligence chat.
 *   Turn 0 (no user message): share a grounded UNDERSTANDING of the company and
 *   invite the user to confirm/refine.
 *   Turn 1+ (user replied): produce a FINAL TAKE plus 4-6 direct, same-category
 *   competitors WITH their web domain and what they offer.
 * Product-first throughout: hard-excludes newsletters, creators, agencies,
 * communities, and off-category (e.g. wellness) noise.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const companyId =
    (req.query.companyId as string | undefined) ||
    (req.body?.companyId as string | undefined) ||
    (req.body?.company_id as string | undefined);
  if (!companyId) return res.status(400).json({ error: 'companyId required' });
  const conversation = Array.isArray(req.body?.conversation) ? req.body.conversation : [];

  const access = await resolveCompanyAccess(req, res, companyId);
  if (!access) return;

  try {
    const profile = await getProfile(companyId, { autoRefine: false, languageRefine: false });
    if (!profile) return res.status(404).json({ error: 'Company profile not found' });

    const p = profile as unknown as Record<string, unknown>;
    const str = (v: unknown) => String(v ?? '').trim();
    const website = str(p.website) || str(p.canonical_website) || str(p.domain);

    // Cumulative memory: seed from what we already established last time — the persisted
    // "company understanding" and the competitors already tracked — so this session builds
    // on prior work instead of restarting from scratch.
    const guidance = (p.report_settings as { user_guidance?: {
      competitor_understanding?: { statement?: string } | null;
      competitors?: Array<{ name?: unknown; state?: unknown }> | null;
    } } | undefined)?.user_guidance;
    const priorUnderstanding = str(guidance?.competitor_understanding?.statement);
    const savedCompetitors = (Array.isArray(p.competitors_list) ? (p.competitors_list as unknown[]) : [])
      .map((c) => str(c)).filter(Boolean);
    const guidedNames = (guidance?.competitors ?? [])
      .filter((c) => c && c.state !== 'rejected' && c.state !== 'removed')
      .map((c) => str(c?.name)).filter(Boolean);
    const trackedCompetitors = Array.from(new Set([...savedCompetitors, ...guidedNames]));

    const grounding = [
      `Company: ${str(p.name) || companyId}`,
      website ? `Website: ${website}` : '',
      `Industry/Category: ${[str(p.industry), str(p.category)].filter(Boolean).join(' / ') || 'Not set'}`,
      `What it sells (products/services): ${str(p.products_services) || 'Not set'}`,
      `Unique value: ${str(p.unique_value) || 'Not set'}`,
      `Target customer: ${str(p.target_audience) || str(p.ideal_customer_profile) || 'Not set'}`,
      `Content themes: ${str(p.content_themes) || 'Not set'}`,
      priorUnderstanding ? `Established understanding (refine with the user's input, do NOT discard): ${priorUnderstanding}` : '',
      trackedCompetitors.length ? `Competitors already confirmed by the user (keep unless the user removes them): ${trackedCompetitors.join(', ')}` : '',
    ].filter(Boolean).join('\n');

    const userMessages = conversation.filter((m: { role?: string }) => m.role === 'user');

    // ── Turn 0: resume from the persisted understanding when we have one ───────
    if (userMessages.length === 0 && priorUnderstanding) {
      const listLine = trackedCompetitors.length
        ? `\n\nCompetitors we're already tracking: ${trackedCompetitors.join(', ')}.`
        : '';
      return res.status(200).json({
        understanding: priorUnderstanding,
        nextQuestion:
          `Here's what we established about your company last time:\n\n${priorUnderstanding}${listLine}\n\n` +
          `Want to refine anything — a sharper product category, add or remove rivals, or correct the industry/domain — or reply "looks good" to keep it and map competitors?`,
      });
    }

    // ── Turn 0 (first time): share understanding, invite confirmation ─────────
    if (userMessages.length === 0) {
      const completion = await runCompletion({
        companyId,
        operation: 'suggestCompetitorsUnderstanding',
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are a sharp competitive-intelligence analyst. In 3–4 confident, specific sentences, state your understanding of THIS company: the exact product CATEGORY it competes in, what it actually sells, who it serves, and the competitive arena — grounded strictly in the profile (never invent). ' +
              'Return JSON ONLY: { "understanding": string }.',
          },
          { role: 'user', content: `Company profile:\n${grounding}` },
        ],
      });
      let understanding = '';
      try {
        understanding = str((JSON.parse((completion.output ?? '').trim() || '{}') as { understanding?: unknown }).understanding);
      } catch { understanding = ''; }
      if (!understanding) {
        understanding = `Here's my read: ${str(p.name) || 'your company'} competes in ${[str(p.industry), str(p.category)].filter(Boolean).join(' / ') || 'its category'}, selling ${str(p.products_services) || 'its products'} to ${str(p.target_audience) || 'its market'}.`;
      }
      return res.status(200).json({
        understanding,
        nextQuestion:
          `${understanding}\n\nDoes this capture your business? Add any nuance I'm missing — a sharper product category, specific rivals you already know, or markets to focus on — or just reply "looks good" and I'll map your direct competitors.`,
      });
    }

    // ── Turn 1+: final take + competitors with domains ────────────────────────
    const userNotes = userMessages.map((m: { content?: string }) => str(m.content)).filter(Boolean).join('\n');
    const completion = await runCompletion({
      companyId,
      operation: 'suggestCompetitors',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a competitive-intelligence analyst. Using the company profile and the user\'s confirmation/corrections, produce:\n' +
            '1) final_take: one crisp paragraph on where this company sits competitively and how to win.\n' +
            '2) competitors: 4–6 DIRECT competitors — real, named companies selling a SAME-CATEGORY product a buyer would evaluate instead. For each give: name, its primary web domain (e.g. "hubspot.com", no protocol), and a ≤10-word note on what it offers.\n' +
            'HARD RULES: same product category only, grounded in what this company sells. NEVER return newsletters, media, individual creators/influencers, agencies/consultancies, communities, or any off-category company (e.g. wellness for a marketing product). Only real companies — omit any name or domain you are unsure is real. Most-substitutable first.\n' +
            'Return JSON ONLY: { "final_take": string, "competitors": [ { "name": string, "domain": string, "offering": string } ] }.',
        },
        { role: 'user', content: `Company profile:\n${grounding}\n\nUser confirmation / corrections:\n${userNotes || '(confirmed as-is)'}` },
      ],
    });

    let finalTake = '';
    let competitors: Array<{ name: string; domain?: string; offering?: string }> = [];
    try {
      const parsed = JSON.parse((completion.output ?? '').trim() || '{}') as {
        final_take?: unknown;
        competitors?: Array<{ name?: unknown; domain?: unknown; offering?: unknown }>;
      };
      finalTake = str(parsed.final_take);
      competitors = (Array.isArray(parsed.competitors) ? parsed.competitors : [])
        .map((c) => ({
          name: str(c?.name),
          domain: str(c?.domain).replace(/^https?:\/\//, '').replace(/\/$/, '') || undefined,
          offering: str(c?.offering) || undefined,
        }))
        .filter((c) => c.name)
        .slice(0, 6);
    } catch {
      return res.status(500).json({ error: 'Invalid AI response' });
    }

    return res.status(200).json({ done: true, final_take: finalTake, competitors });
  } catch (err: unknown) {
    console.error('Competitor intelligence chat failed:', err);
    return res.status(500).json({
      error: 'Failed to run competitor intelligence',
      details: err instanceof Error ? err.message : null,
    });
  }
}
