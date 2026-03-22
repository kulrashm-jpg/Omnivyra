/**
 * POST /api/track/ai-insights
 *
 * AI-powered content strategy layer.
 * Accepts pre-aggregated analytics data and returns natural-language
 * strategic observations, patterns, and recommendations.
 *
 * Body: { account_id, metrics: AnalyticsSummary }
 * (Caller passes analytics data it already fetched — no double query)
 *
 * Response:
 * {
 *   observations:     string[],
 *   recommendations:  string[],
 *   strongest_hook:   string | null,
 *   weakest_pattern:  string | null,
 *   priority_action:  string | null,
 * }
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { runCompletionWithOperation } from '../../../backend/services/aiGateway';

// ── Types ──────────────────────────────────────────────────────────────────

export interface AiInsightInput {
  total_views:     number;
  avg_time:        number;
  avg_scroll:      number;
  delta:           { views_delta: number | null; time_delta: number | null; scroll_delta: number | null };
  top_pages:       Array<{ slug: string; views: number; avg_scroll: number; avg_time: number; content_score: number }>;
  clusters:        Array<{ name: string; type: string; total_views: number; avg_scroll: number; avg_time: number; intent_score: number }>;
  intent_counts:   { cta_click: number; link_click: number; copy: number; form_interaction: number };
  hot_slugs:       string[];
}

export interface AiInsightOutput {
  observations:    string[];
  recommendations: string[];
  strongest_hook:  string | null;
  weakest_pattern: string | null;
  priority_action: string | null;
}

// ── Prompt ────────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are a content strategy analyst for B2B marketing teams.

You receive blog analytics data and return sharp, actionable strategic insights.

RULES:
- Base ALL observations strictly on the provided data — no invented statistics
- Be specific: reference actual slugs, clusters, percentages from the data
- Be concise: each observation ≤ 25 words, each recommendation ≤ 30 words
- Prioritise the single highest-leverage action
- Return ONLY valid JSON matching this schema — no markdown, no prose:

{
  "observations":    ["string", "string", "string"],   // 2–4 observations
  "recommendations": ["string", "string", "string"],   // 2–3 recommendations
  "strongest_hook":  "string or null",                 // what content pattern works best
  "weakest_pattern": "string or null",                 // what pattern to stop or fix
  "priority_action": "string or null"                  // single most important next step
}`;
}

function buildUserPrompt(input: AiInsightInput): string {
  const topPagesStr = input.top_pages.slice(0, 5).map((p) =>
    `  - ${p.slug}: ${p.views} views, ${p.avg_scroll}% scroll, ${p.avg_time}s avg time, score ${p.content_score}/100`
  ).join('\n');

  const clustersStr = input.clusters.slice(0, 6).map((c) =>
    `  - "${c.name}" (${c.type}): ${c.total_views} views, ${c.avg_scroll}% scroll, ${c.avg_time}s time, intent score ${c.intent_score}/100`
  ).join('\n');

  const deltaStr = [
    input.delta.views_delta  !== null ? `Views: ${input.delta.views_delta > 0 ? '+' : ''}${input.delta.views_delta}%` : null,
    input.delta.time_delta   !== null ? `Time: ${input.delta.time_delta > 0 ? '+' : ''}${input.delta.time_delta}%` : null,
    input.delta.scroll_delta !== null ? `Scroll: ${input.delta.scroll_delta > 0 ? '+' : ''}${input.delta.scroll_delta}%` : null,
  ].filter(Boolean).join(', ') || 'No prior period data';

  const intentStr = [
    `CTA clicks: ${input.intent_counts.cta_click}`,
    `Outbound link clicks: ${input.intent_counts.link_click}`,
    `Copy events: ${input.intent_counts.copy}`,
    `Form interactions: ${input.intent_counts.form_interaction}`,
  ].join(', ');

  const hotStr = input.hot_slugs.length > 0 ? input.hot_slugs.join(', ') : 'none';

  return `Analyse this blog performance data and return strategic insights.

OVERVIEW (last 30 days):
  Total views: ${input.total_views}
  Avg time on page: ${input.avg_time}s
  Avg scroll depth: ${input.avg_scroll}%
  7-day trend vs previous 7 days: ${deltaStr}

TOP PAGES:
${topPagesStr || '  (no data)'}

CONTENT CLUSTERS (by tag/category):
${clustersStr || '  (no data)'}

INTENT SIGNALS (across all content):
  ${intentStr}

TRENDING RIGHT NOW:
  ${hotStr}

Based on this data, identify patterns and give actionable strategy advice.`;
}

// ── Fallback ──────────────────────────────────────────────────────────────

function buildFallback(input: AiInsightInput): AiInsightOutput {
  const obs: string[] = [];
  if (input.total_views < 10) obs.push('Early-stage data — baseline is forming.');
  if (input.avg_scroll > 70)  obs.push(`Strong scroll depth (${input.avg_scroll}%) — readers are engaged.`);
  if (input.avg_scroll < 30)  obs.push(`Low scroll depth (${input.avg_scroll}%) — intros may need work.`);
  if (input.intent_counts.cta_click > 0) obs.push(`${input.intent_counts.cta_click} CTA clicks recorded — high intent audience.`);

  const top = input.top_pages[0];
  return {
    observations:    obs.length > 0 ? obs : ['Collecting data — check back as traffic grows.'],
    recommendations: top ? [`Promote "${top.slug}" — it has the highest content score.`] : ['Publish consistently to build baseline data.'],
    strongest_hook:  input.clusters[0]?.name ?? null,
    weakest_pattern: null,
    priority_action: input.hot_slugs[0] ? `Boost "${input.hot_slugs[0]}" — it\'s trending now.` : null,
  };
}

// ── Handler ───────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { account_id, metrics } = req.body ?? {};
  if (!account_id) return res.status(400).json({ error: 'account_id required' });
  if (!metrics)    return res.status(400).json({ error: 'metrics required' });

  const access = await enforceCompanyAccess({ req, res, companyId: account_id });
  if (!access) return;

  const input = metrics as AiInsightInput;

  // Require at least some data before calling AI
  if ((input.total_views ?? 0) < 5) {
    return res.status(200).json(buildFallback(input));
  }

  try {
    const result = await runCompletionWithOperation({
      operation:       'blogAnalyticsInsight',
      companyId:       account_id,
      model:           'gpt-4o-mini',
      temperature:     0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user',   content: buildUserPrompt(input) },
      ],
    });

    const raw = result.output ? JSON.parse(result.output) : null;
    if (!raw) return res.status(200).json(buildFallback(input));

    const output: AiInsightOutput = {
      observations:    Array.isArray(raw.observations)    ? raw.observations.slice(0, 4)    : [],
      recommendations: Array.isArray(raw.recommendations) ? raw.recommendations.slice(0, 3) : [],
      strongest_hook:  typeof raw.strongest_hook  === 'string' ? raw.strongest_hook  : null,
      weakest_pattern: typeof raw.weakest_pattern === 'string' ? raw.weakest_pattern : null,
      priority_action: typeof raw.priority_action === 'string' ? raw.priority_action : null,
    };

    return res.status(200).json(output);
  } catch {
    return res.status(200).json(buildFallback(input));
  }
}
