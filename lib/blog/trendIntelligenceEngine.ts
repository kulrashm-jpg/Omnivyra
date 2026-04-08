/**
 * Trend Intelligence Engine
 *
 * Lightweight trend-awareness layer that enriches blog generation with current
 * market signals from the existing dashboard intelligence data (trend_snapshots table).
 *
 * Constraints:
 *   - No external APIs — reads from existing trend_snapshots table only
 *   - Must not block generation if it fails (caller wraps in try/catch)
 *   - Graceful fallback: no trends → skip, API fail → skip
 *   - Reuses word-overlap similarity from SEO engine pattern
 */

import { getTrendSnapshots } from '../../backend/db/campaignVersionStore';

// ── Stopwords (shared set with seoIntelligenceEngine / runBlogGeneration) ────

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her',
  'was', 'one', 'our', 'out', 'has', 'have', 'from', 'with', 'they',
  'been', 'this', 'that', 'will', 'each', 'make', 'like', 'into',
  'them', 'than', 'its', 'over', 'such', 'what', 'how', 'why', 'most',
  'about', 'which', 'when', 'your', 'does', 'more', 'just', 'also',
  'very', 'some', 'only', 'many', 'much', 'best', 'good', 'way',
  'use', 'using', 'used', 'get', 'got', 'new', 'know',
]);

// ── Types ────────────────────────────────────────────────────────────────────

export interface TrendSignal {
  topic:             string;
  signal_strength:   number;  // 0–1
  discussion_growth: number;  // 0–1
}

export interface RelevantTrend extends TrendSignal {
  relevance: number;  // 0–1, word-overlap similarity to the blog topic
}

export interface TrendIntelligenceResult {
  /** Top 3 relevant trends sorted by signal_strength */
  relevant_trends:      RelevantTrend[];
  /** Pre-formatted prompt fragment for injection into generation prompt */
  trend_context_prompt: string;
  /** Freshness directive for prompt injection */
  freshness_directive:  string;
}

export interface TrendIntelligenceInput {
  companyId:     string;
  topic:         string;
  /** Pre-aggregated trend signals. If provided, skips DB fetch. */
  trendSignals?: TrendSignal[];
  /** Injectable data-access override for testing. Defaults to getTrendSnapshots. */
  fetchTrendSnapshots?: FetchTrendSnapshotsFn;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FetchTrendSnapshotsFn = (companyId: string) => Promise<any[]>;

// ── Word-overlap similarity (consistent with seoIntelligenceEngine) ──────────

function wordOverlapSimilarity(a: string, b: string): number {
  const wordsA = new Set(
    a.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length >= 3 && !STOP_WORDS.has(w))
  );
  const wordsB = new Set(
    b.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length >= 3 && !STOP_WORDS.has(w))
  );

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }

  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? overlap / union : 0;
}

// ── Aggregate snapshots into trend signals ───────────────────────────────────
// Mirrors the logic in pages/api/dashboard/intelligence.ts (lines 139-164)

function aggregateSnapshots(snapshots: unknown[]): TrendSignal[] {
  const topicMap = new Map<string, { signal_strength: number; discussion_growth: number; count: number }>();

  for (const snap of snapshots) {
    const s = (snap as Record<string, unknown>)?.snapshot as Record<string, unknown> | undefined;
    const emerging = Array.isArray(s?.emerging_trends) ? s.emerging_trends : [];
    const ranked   = Array.isArray(s?.ranked_trends)   ? s.ranked_trends   : [];

    for (const t of [...emerging, ...ranked]) {
      const entry = t as { topic?: string; name?: string; strength?: number; growth?: number };
      const topic = entry?.topic ?? entry?.name ?? '';
      const strength = typeof entry?.strength === 'number' ? entry.strength : 0.7;
      const growth   = typeof entry?.growth   === 'number' ? entry.growth   : 0.5;

      if (topic) {
        const key = String(topic).toLowerCase();
        const cur = topicMap.get(key) ?? { signal_strength: 0, discussion_growth: 0, count: 0 };
        topicMap.set(key, {
          signal_strength:   cur.signal_strength + strength,
          discussion_growth: cur.discussion_growth + growth,
          count:             cur.count + 1,
        });
      }
    }
  }

  return [...topicMap.entries()]
    .map(([topic, v]) => ({
      topic,
      signal_strength:   Math.min(1, v.signal_strength / Math.max(1, v.count)),
      discussion_growth: Math.min(1, v.discussion_growth / Math.max(1, v.count)),
    }))
    .sort((a, b) => b.signal_strength - a.signal_strength);
}

// ── Build prompt fragments ───────────────────────────────────────────────────

function buildTrendContextPrompt(trends: RelevantTrend[]): string {
  if (trends.length === 0) return '';

  const lines: string[] = [
    '## TREND SIGNALS (from market intelligence)',
    'The following trends are currently active in this company\'s market.',
    'Only incorporate a trend if it is directly relevant to the topic. Do not force trend inclusion — if none connect naturally, ignore them entirely.',
  ];

  for (const t of trends) {
    const growthPct = Math.round(t.discussion_growth * 100);
    const strengthLabel = t.signal_strength >= 0.8 ? 'strong' : t.signal_strength >= 0.5 ? 'moderate' : 'emerging';
    lines.push(`- "${t.topic}" (signal: ${strengthLabel}, discussion growth: ${growthPct}%)`);
  }

  lines.push('');
  lines.push('Reference current market direction where relevant — do not force-fit trends that don\'t naturally connect to the topic.');

  return lines.join('\n');
}

const FRESHNESS_DIRECTIVE = [
  '## FRESHNESS DIRECTIVE',
  '- Prioritize insights from the last 6–12 months where applicable.',
  '- Avoid outdated or generic statements — be specific about current market reality.',
  '- If referencing data or studies, prefer recent sources (last 12-18 months).',
  '- Frame insights as forward-looking — what practitioners should do NOW.',
].join('\n');

// ── Main function ────────────────────────────────────────────────────────────

export async function getTrendIntelligence(
  input: TrendIntelligenceInput,
): Promise<TrendIntelligenceResult> {
  const {
    companyId,
    topic,
    trendSignals: preAggregated,
    fetchTrendSnapshots = getTrendSnapshots,
  } = input;

  // 1. Get trend signals — use pre-aggregated if available, else fetch + aggregate
  let signals: TrendSignal[];
  if (preAggregated && preAggregated.length > 0) {
    signals = preAggregated;
  } else {
    const snapshots = await fetchTrendSnapshots(companyId);
    signals = aggregateSnapshots(snapshots);
  }

  // 2. Match relevance to the blog topic
  const relevant_trends: RelevantTrend[] = signals
    .map(t => ({
      ...t,
      relevance: wordOverlapSimilarity(t.topic, topic),
    }))
    .filter(t => t.relevance > 0.4)
    .sort((a, b) => b.signal_strength - a.signal_strength)
    .slice(0, 3);

  // 3. Build context prompt
  const trend_context_prompt = buildTrendContextPrompt(relevant_trends);

  // 4. Freshness directive (always available, even without trends)
  const freshness_directive = FRESHNESS_DIRECTIVE;

  return {
    relevant_trends,
    trend_context_prompt,
    freshness_directive,
  };
}
