/**
 * POST /api/planner/chat-themes
 * AI chat to modify strategic theme cards.
 * Takes current themes + user message, returns updated rich themes + strategic card.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { runCompletionWithOperation } from '../../../backend/services/aiGateway';
import { buildPlannerStrategicCard, type PlannerStrategicSourceMode } from '../../../lib/plannerStrategicCard';

interface ThemeEntry {
  week: number;
  title: string;
  phase_label?: string;
  objective?: string;
  content_focus?: string;
  cta_focus?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      companyId,
      message,
      current_themes,
      history,
      strategy_context,
      idea_spine,
      selected_week,
      strategic_card,
    } = req.body || {};

    if (!companyId || typeof companyId !== 'string') {
      return res.status(400).json({ error: 'companyId is required' });
    }
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' });
    }

    const access = await enforceCompanyAccess({
      req,
      res,
      companyId: companyId.trim(),
      requireCampaignId: false,
    });
    if (!access) return;

    const themes: ThemeEntry[] = Array.isArray(current_themes) ? current_themes : [];
    const chatHistory: ChatMessage[] = Array.isArray(history) ? history : [];

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
      const audience = Array.isArray(strat.target_audience)
        ? strat.target_audience.join(', ')
        : String(strat.target_audience);
      if (audience.trim()) contextParts.push(`Target audience: ${audience}`);
    }
    if (strat?.key_message && typeof strat.key_message === 'string' && strat.key_message.trim()) {
      contextParts.push(`Key message: ${strat.key_message.trim()}`);
    }

    const selectedWeekNum = typeof selected_week === 'number' ? selected_week : null;
    const targetedTheme = selectedWeekNum != null ? themes.find((t) => t.week === selectedWeekNum) : null;
    const themesJson = JSON.stringify(themes, null, 2);

    const targetingNote = targetedTheme
      ? `The user selected week ${targetedTheme.week} for editing. Apply changes to that week unless they clearly ask to update the whole campaign.`
      : 'No single week is selected, so you may update the whole campaign arc if needed.';

    const systemPrompt = `You are a strategic campaign planning assistant.

You help users refine weekly strategic theme cards for a marketing campaign. The themes support one campaign-level strategic card, so your changes must preserve campaign coherence.

${targetingNote}

Return a valid JSON object with exactly this shape:
{
  "themes": [
    {
      "week": 1,
      "title": "Awareness - Specific angle",
      "phase_label": "Awareness",
      "objective": "What this week should achieve",
      "content_focus": "What kind of content this week should emphasize",
      "cta_focus": "What action or response this week should push"
    }
  ],
  "reply": "Short explanation of what changed."
}

Rules:
- Keep the same number of weeks unless the user explicitly asks to change duration.
- Preserve or improve phase_label, objective, content_focus, and cta_focus for every week.
- Keep a clear narrative flow across the weeks.
- If the user edits one week, keep all other weeks stable unless the request requires a broader rewrite.
- Titles should be concise, specific, and suitable for a campaign plan.

Return only JSON.`;

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    for (const turn of chatHistory.slice(-6)) {
      messages.push({ role: turn.role, content: turn.text });
    }

    const contextBlock = contextParts.length > 0 ? `Campaign context:\n${contextParts.join('\n')}\n\n` : '';
    const currentThemesBlock =
      themes.length > 0
        ? `Current strategic themes:\n${themesJson}`
        : 'No themes exist yet. Generate a fresh set.';

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
      operation: 'generatePlatformVariants',
    });

    let parsed: { themes?: ThemeEntry[]; reply?: string } = {};
    try {
      const raw =
        typeof result.output === 'string' ? result.output : JSON.stringify(result.output ?? {});
      parsed = JSON.parse(
        raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
      );
    } catch {
      return res.status(500).json({ error: 'AI returned malformed JSON' });
    }

    const updatedThemes: ThemeEntry[] = Array.isArray(parsed.themes)
      ? parsed.themes
          .filter((item) => typeof item?.week === 'number' && typeof item?.title === 'string')
          .map((item) => ({
            week: Number(item.week),
            title: String(item.title).trim(),
            ...(typeof item.phase_label === 'string' && item.phase_label.trim()
              ? { phase_label: item.phase_label.trim() }
              : {}),
            ...(typeof item.objective === 'string' && item.objective.trim()
              ? { objective: item.objective.trim() }
              : {}),
            ...(typeof item.content_focus === 'string' && item.content_focus.trim()
              ? { content_focus: item.content_focus.trim() }
              : {}),
            ...(typeof item.cta_focus === 'string' && item.cta_focus.trim()
              ? { cta_focus: item.cta_focus.trim() }
              : {}),
          }))
      : themes;

    const reply =
      typeof parsed.reply === 'string' && parsed.reply.trim()
        ? parsed.reply.trim()
        : 'Themes updated.';

    const sourceMode =
      strategic_card &&
      typeof strategic_card === 'object' &&
      typeof (strategic_card as { source_mode?: unknown }).source_mode === 'string'
        ? ((strategic_card as { source_mode: PlannerStrategicSourceMode }).source_mode ?? 'ai')
        : 'ai';

    return res.status(200).json({
      themes: updatedThemes,
      reply,
      strategic_card: buildPlannerStrategicCard({
        sourceMode,
        ideaSpine: idea_spine ?? null,
        strategyContext: strategy_context ?? null,
        themes: updatedThemes,
      }),
    });
  } catch (err: unknown) {
    console.error('[planner/chat-themes]', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to process request',
    });
  }
}

export default handler;
