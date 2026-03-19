/**
 * POST /api/planner/chat-themes
 * AI chat to modify strategic theme cards.
 * Takes current themes + user message, returns updated themes + assistant reply.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { runCompletionWithOperation } from '../../../backend/services/aiGateway';

interface ThemeEntry { week: number; title: string; }
interface ChatMessage { role: 'user' | 'assistant'; text: string; }

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, message, current_themes, history, strategy_context, idea_spine, selected_week } = req.body || {};

    if (!companyId || typeof companyId !== 'string') {
      return res.status(400).json({ error: 'companyId is required' });
    }
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: companyId.trim(), requireCampaignId: false });
    if (!access) return;

    const themes: ThemeEntry[] = Array.isArray(current_themes) ? current_themes : [];
    const chatHistory: ChatMessage[] = Array.isArray(history) ? history : [];

    // Build context lines
    const contextParts: string[] = [];
    const spine = idea_spine as Record<string, string> | null | undefined;
    const campaignTitle = spine?.refined_title ?? spine?.title ?? null;
    const campaignDesc = spine?.refined_description ?? spine?.description ?? null;
    if (campaignTitle) contextParts.push(`Campaign: ${campaignTitle}`);
    if (campaignDesc) contextParts.push(`Description: ${campaignDesc}`);

    const strat = strategy_context as Record<string, unknown> | null | undefined;
    if (strat?.campaign_goal) contextParts.push(`Goal: ${strat.campaign_goal}`);
    if (strat?.duration_weeks) contextParts.push(`Duration: ${strat.duration_weeks} weeks`);
    if (strat?.target_audience) {
      const aud = Array.isArray(strat.target_audience)
        ? strat.target_audience.join(', ')
        : String(strat.target_audience);
      if (aud.trim()) contextParts.push(`Target audience: ${aud}`);
    }

    const selectedWeekNum = typeof selected_week === 'number' ? selected_week : null;
    const targetedTheme = selectedWeekNum != null ? themes.find((t) => t.week === selectedWeekNum) : null;

    const themesJson = JSON.stringify(themes, null, 2);

    const targetingNote = targetedTheme
      ? `\nThe user has selected Week ${targetedTheme.week} ("${targetedTheme.title}") for editing. Apply the instruction specifically to this week unless told otherwise. Keep all other weeks unchanged.`
      : '';

    const systemPrompt = `You are a strategic campaign planning assistant. You help users refine their weekly strategic theme cards for a marketing campaign.${targetingNote}

You receive:
- The current list of strategic themes (week number + title)
- The user's instruction for how to change them
- Campaign context (goal, duration, audience)

Your response MUST be a valid JSON object with exactly two fields:
{
  "themes": [ { "week": 1, "title": "..." }, ... ],
  "reply": "A short explanation of what you changed (1-3 sentences)"
}

Rules for themes:
- Keep the same number of weeks unless user explicitly asks to add/remove weeks
- Each title should follow the pattern: "Stage — Specific Angle" (e.g. "Awareness — Why AI Matters for SaaS Teams")
- Maintain logical narrative progression across weeks (Awareness → Education → Problem → Solution → Proof → Conversion or similar)
- If user asks to change a specific week, change only that week
- If user asks for a complete rethink, regenerate all themes while keeping week count
- Theme titles should be concise (5-10 words max) but specific to the campaign topic

Return ONLY the JSON object. No markdown, no explanation outside the JSON.`;

    // Build conversation history for multi-turn context
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    // Add context as first user/assistant turn if we have it
    const contextBlock = contextParts.length > 0 ? `\nCampaign context:\n${contextParts.join('\n')}` : '';
    const currentThemesBlock = themes.length > 0
      ? `\nCurrent strategic themes:\n${themesJson}`
      : '\nNo themes set yet — generate a fresh set.';

    // Include prior turns (exclude the system-level context block from history)
    for (const turn of chatHistory.slice(-6)) {
      messages.push({ role: turn.role, content: turn.text });
    }

    // Current user message with embedded context
    messages.push({
      role: 'user',
      content: `${contextBlock}${currentThemesBlock}\n\nUser instruction: ${message.trim()}`,
    });

    const result = await runCompletionWithOperation({
      companyId,
      model: 'gpt-4o',
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages,
      operation: 'generatePlatformVariants', // reuse existing operation for billing tracking
    });

    let parsed: { themes?: ThemeEntry[]; reply?: string } = {};
    try {
      const raw = typeof result.output === 'string'
        ? result.output
        : JSON.stringify(result.output ?? {});
      parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
    } catch {
      return res.status(500).json({ error: 'AI returned malformed JSON' });
    }

    const updatedThemes: ThemeEntry[] = Array.isArray(parsed.themes)
      ? parsed.themes
          .filter((t) => typeof t?.week === 'number' && typeof t?.title === 'string')
          .map((t) => ({ week: Number(t.week), title: String(t.title).trim() }))
      : themes;

    const reply = typeof parsed.reply === 'string' && parsed.reply.trim()
      ? parsed.reply.trim()
      : 'Themes updated.';

    return res.status(200).json({ themes: updatedThemes, reply });
  } catch (err: unknown) {
    console.error('[planner/chat-themes]', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to process request' });
  }
}

export default handler;
