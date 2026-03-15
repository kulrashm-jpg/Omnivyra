/**
 * Insight Content Service
 * Generates content ideas from strategic insights using AI.
 */

import { runCompletionWithOperation } from './aiGateway';

export type ContentFormat = 'post' | 'article' | 'video' | 'thread';

export interface ContentIdea {
  title: string;
  format: ContentFormat;
  summary: string;
}

export interface InsightInput {
  title: string;
  summary: string;
  insight_type?: string;
  recommended_action?: string;
  supporting_signals?: string[];
}

const VALID_FORMATS: ContentFormat[] = ['post', 'article', 'video', 'thread'];

function normalizeFormat(v: unknown): ContentFormat {
  const s = String(v ?? '').trim().toLowerCase();
  if (VALID_FORMATS.includes(s as ContentFormat)) return s as ContentFormat;
  if (s === 'linkedin' || s === 'social') return 'post';
  if (s === 'blog') return 'article';
  return 'post';
}

/**
 * Generate content ideas from a strategic insight.
 * Returns an array of content ideas with title, format, and summary.
 */
export async function generateContentIdeas(insight: InsightInput): Promise<ContentIdea[]> {
  const title = (insight.title ?? '').trim();
  const summary = (insight.summary ?? '').trim();
  const recommendedAction = (insight.recommended_action ?? '').trim();

  if (!title && !summary) {
    return [];
  }

  const context = [
    title && `Title: ${title}`,
    summary && `Summary: ${summary}`,
    recommendedAction && `Recommended action: ${recommendedAction}`,
    insight.insight_type && `Insight type: ${insight.insight_type}`,
  ]
    .filter(Boolean)
    .join('\n');

  const systemPrompt = `You are a content strategist. Given a strategic insight, generate 4–6 concrete content ideas that leverage it.

CRITICAL: Each idea MUST have format exactly one of: post, article, video, thread

Return JSON only with this exact shape:
{"content_ideas": [{"title": "string", "format": "post"|"article"|"video"|"thread", "summary": "string"}, ...]}`;

  const userPrompt = `Strategic insight:\n${context}\n\nGenerate 4–6 content ideas (mix of formats: post, article, video, thread) that capitalize on this insight.`;

  const result = await runCompletionWithOperation({
    companyId: null,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0.5,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    operation: 'generateContentIdeas',
  });

  let parsed: Record<string, unknown>;
  try {
    const raw = (result.output || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    return [];
  }

  const rawIdeas = Array.isArray(parsed.content_ideas)
    ? parsed.content_ideas
    : Array.isArray(parsed.contentIdeas)
    ? parsed.contentIdeas
    : [];

  const ideas: ContentIdea[] = [];
  for (const item of rawIdeas) {
    if (!item || typeof item !== 'object') continue;
    const t = String((item as Record<string, unknown>).title ?? '').trim();
    const s = String((item as Record<string, unknown>).summary ?? '').trim();
    if (!t && !s) continue;
    ideas.push({
      title: t || 'Content idea',
      format: normalizeFormat((item as Record<string, unknown>).format),
      summary: s || t,
    });
  }

  return ideas;
}
