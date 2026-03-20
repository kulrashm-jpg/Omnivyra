/**
 * Global Pattern Service — Step 1
 *
 * Aggregates high-signal content patterns across all accounts into
 * `global_campaign_patterns`. Used to inject cross-account intelligence
 * into planning prompts via `injectGlobalPatternsIntoPrompt()`.
 *
 * Privacy model: no company_id stored in global patterns — all contributions
 * are anonymised. Only the pattern text, platform, and aggregate stats.
 *
 * Contribution pipeline:
 *   After each campaign cycle, `contributeToGlobalPatterns()` is called.
 *   Patterns with engagement_rate above the CONTRIBUTION_THRESHOLD are eligible.
 */

import { supabase } from '../db/supabaseClient';

// Only contribute patterns with engagement ≥ 2%
const CONTRIBUTION_THRESHOLD = 0.02;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type PatternType = 'hook' | 'cta' | 'structure' | 'format' | 'timing';

export type GlobalPattern = {
  id?: string;
  platform: string;
  content_type: string;
  pattern_type: PatternType;
  pattern: string;
  avg_engagement_rate: number;
  sample_count: number;
  confidence: number;
  industry_tags: string[];
};

// ── Industry benchmark engagement rates (fallback when insufficient data) ─────
const INDUSTRY_BENCHMARKS: Record<string, Record<string, number>> = {
  linkedin:  { avg: 0.035, strong: 0.06, weak: 0.01 },
  instagram: { avg: 0.045, strong: 0.07, weak: 0.01 },
  twitter:   { avg: 0.015, strong: 0.03, weak: 0.005 },
  x:         { avg: 0.015, strong: 0.03, weak: 0.005 },
  tiktok:    { avg: 0.060, strong: 0.10, weak: 0.02 },
  facebook:  { avg: 0.025, strong: 0.05, weak: 0.008 },
  youtube:   { avg: 0.040, strong: 0.08, weak: 0.015 },
  pinterest: { avg: 0.030, strong: 0.06, weak: 0.01 },
  reddit:    { avg: 0.020, strong: 0.04, weak: 0.008 },
};

// ── Known high-performing hook patterns (seeded knowledge) ────────────────────
const SEEDED_HOOK_PATTERNS: Omit<GlobalPattern, 'id'>[] = [
  { platform: 'linkedin', content_type: 'post', pattern_type: 'hook', pattern: 'Start with a counter-intuitive statement ("Most people do X wrong")', avg_engagement_rate: 0.065, sample_count: 100, confidence: 0.85, industry_tags: ['b2b', 'saas'] },
  { platform: 'linkedin', content_type: 'post', pattern_type: 'hook', pattern: 'Open with a personal story failure → lesson structure', avg_engagement_rate: 0.072, sample_count: 80, confidence: 0.82, industry_tags: ['b2b', 'personal_brand'] },
  { platform: 'instagram', content_type: 'reel', pattern_type: 'hook', pattern: 'First 3 seconds: bold text overlay on action footage', avg_engagement_rate: 0.095, sample_count: 150, confidence: 0.88, industry_tags: ['ecommerce', 'd2c'] },
  { platform: 'twitter', content_type: 'thread', pattern_type: 'hook', pattern: 'Thread opens with a specific number claim ("After 100 experiments...")', avg_engagement_rate: 0.038, sample_count: 200, confidence: 0.79, industry_tags: ['tech', 'growth'] },
  { platform: 'tiktok', content_type: 'video', pattern_type: 'hook', pattern: 'Pattern interrupt: unexpected question in first 2 words', avg_engagement_rate: 0.110, sample_count: 300, confidence: 0.91, industry_tags: ['consumer', 'entertainment'] },
  { platform: 'linkedin', content_type: 'carousel', pattern_type: 'structure', pattern: 'Slide 1: bold claim → slides 2-6: evidence → last slide: actionable CTA', avg_engagement_rate: 0.058, sample_count: 120, confidence: 0.84, industry_tags: ['b2b'] },
  { platform: 'linkedin', content_type: 'post', pattern_type: 'cta', pattern: 'End with a specific low-friction question ("Which of these resonates with you?")', avg_engagement_rate: 0.061, sample_count: 90, confidence: 0.80, industry_tags: ['b2b', 'agency'] },
  { platform: 'instagram', content_type: 'post', pattern_type: 'format', pattern: 'First 125 chars complete a thought — rest expands', avg_engagement_rate: 0.048, sample_count: 200, confidence: 0.85, industry_tags: ['ecommerce', 'lifestyle'] },
];

// ─────────────────────────────────────────────────────────────────────────────
// Read
// ─────────────────────────────────────────────────────────────────────────────

/** Retrieve top global patterns for a platform and content type. */
export async function getGlobalPatterns(
  platform: string,
  contentType?: string,
  options: { pattern_type?: PatternType; limit?: number } = {}
): Promise<GlobalPattern[]> {
  let query = supabase
    .from('global_campaign_patterns')
    .select('*')
    .eq('platform', platform.toLowerCase())
    .gte('confidence', 0.5)
    .order('avg_engagement_rate', { ascending: false })
    .limit(options.limit ?? 10);

  if (contentType)          query = query.eq('content_type', contentType.toLowerCase());
  if (options.pattern_type) query = query.eq('pattern_type', options.pattern_type);

  const { data } = await query;
  return (data ?? []) as GlobalPattern[];
}

/** Get industry benchmark for a platform. */
export function getPlatformBenchmark(platform: string): { avg: number; strong: number; weak: number } {
  const b = INDUSTRY_BENCHMARKS[platform.toLowerCase()];
  if (b) return b as { avg: number; strong: number; weak: number };
  return { avg: 0.03, strong: 0.06, weak: 0.01 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Write
// ─────────────────────────────────────────────────────────────────────────────

/** Upsert a global pattern — running average update on collision. */
export async function contributePattern(pattern: Omit<GlobalPattern, 'id'>): Promise<void> {
  if (pattern.avg_engagement_rate < CONTRIBUTION_THRESHOLD) return;

  try {
    const { data: existing } = await supabase
      .from('global_campaign_patterns')
      .select('id, avg_engagement_rate, sample_count, confidence')
      .eq('platform', pattern.platform)
      .eq('content_type', pattern.content_type)
      .eq('pattern_type', pattern.pattern_type)
      .eq('pattern', pattern.pattern)
      .maybeSingle();

    if (existing) {
      const n    = (existing as any).sample_count + pattern.sample_count;
      const newRate = ((existing as any).avg_engagement_rate * (existing as any).sample_count + pattern.avg_engagement_rate * pattern.sample_count) / n;
      const newConf = Math.min(1, ((existing as any).confidence * (existing as any).sample_count + pattern.confidence * pattern.sample_count) / n);

      await supabase.from('global_campaign_patterns').update({
        avg_engagement_rate: parseFloat(newRate.toFixed(4)),
        confidence:          parseFloat(newConf.toFixed(3)),
        sample_count:        n,
        last_seen_at:        new Date().toISOString(),
      }).eq('id', (existing as any).id);
    } else {
      await supabase.from('global_campaign_patterns').insert({
        ...pattern,
        platform:     pattern.platform.toLowerCase(),
        content_type: pattern.content_type.toLowerCase(),
        created_at:   new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.warn('[globalPatternService] contributePattern failed', err);
  }
}

/** Seed global patterns with known high-performers on first run. */
export async function seedGlobalPatterns(): Promise<number> {
  let seeded = 0;
  for (const p of SEEDED_HOOK_PATTERNS) {
    const { data: existing } = await supabase
      .from('global_campaign_patterns')
      .select('id')
      .eq('platform', p.platform)
      .eq('pattern', p.pattern)
      .maybeSingle();
    if (!existing) {
      await contributePattern(p);
      seeded++;
    }
  }
  return seeded;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt injection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a prompt-injectable string summarising the highest-confidence
 * global patterns for the given platforms.
 */
export async function injectGlobalPatternsIntoPrompt(
  platforms: string[],
  contentTypes: string[] = [],
): Promise<string> {
  const patternSets = await Promise.all(
    platforms.map(p => getGlobalPatterns(p, contentTypes[0], { limit: 5 }))
  );

  const allPatterns = patternSets.flat().sort((a, b) => b.avg_engagement_rate - a.avg_engagement_rate);

  if (allPatterns.length === 0) return '';

  const lines: string[] = ['GLOBAL HIGH-PERFORMANCE PATTERNS (cross-account intelligence):'];

  const byType: Record<string, GlobalPattern[]> = {};
  for (const p of allPatterns) {
    if (!byType[p.pattern_type]) byType[p.pattern_type] = [];
    byType[p.pattern_type].push(p);
  }

  for (const [type, patterns] of Object.entries(byType)) {
    lines.push(`\n${type.toUpperCase()} patterns:`);
    patterns.slice(0, 3).forEach(p => {
      lines.push(`  • [${p.platform}] ${p.pattern} (avg engagement: ${(p.avg_engagement_rate * 100).toFixed(1)}%)`);
    });
  }

  // Add industry benchmarks
  const benchmarkLines: string[] = [];
  for (const platform of platforms) {
    const b = getPlatformBenchmark(platform);
    benchmarkLines.push(`${platform}: avg ${(b.avg * 100).toFixed(1)}%, strong >${(b.strong * 100).toFixed(1)}%, weak <${(b.weak * 100).toFixed(1)}%`);
  }
  if (benchmarkLines.length > 0) {
    lines.push('\nINDUSTRY BENCHMARKS:');
    benchmarkLines.forEach(l => lines.push(`  • ${l}`));
  }

  return lines.join('\n');
}
