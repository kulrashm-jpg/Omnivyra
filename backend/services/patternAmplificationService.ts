/**
 * Pattern Amplification Service
 *
 * When a content pattern's success_rate crosses a threshold:
 *   1. Persists a reuse directive to `campaign_autonomous_learnings` with high confidence
 *   2. Boosts its weight in `global_campaign_patterns` (increases sample_count + avg_rate)
 *   3. Returns an injectable amplification context for the next campaign prompt
 *
 * Thresholds:
 *   amplify  — avg_engagement_rate > AMPLIFY_THRESHOLD (2× platform average)
 *   boost    — avg_engagement_rate > BOOST_THRESHOLD  (1.5× platform average)
 *
 * Phase A correction: previously this service SELECTed
 *   `avg_engagement_rate, sample_count`
 * from campaign_learnings, but those columns belong to
 * `global_campaign_patterns`, NOT the autonomous-feature learnings
 * table. The autonomous-feature schema (per
 * `20260320_autonomous_system.sql`) is `engagement_impact, sample_size`.
 * The SELECT below now uses the actual autonomous schema columns and
 * maps them to the AmplifiedPattern's semantic field names.
 */

import { supabase } from '../db/supabaseClient';
import { getPlatformBenchmark, contributePattern, type GlobalPattern } from './globalPatternService';
import { upsertLearning } from './campaignLearningsStore';

const AMPLIFY_MULTIPLIER = 2.0;   // 2× platform avg → amplify
const BOOST_MULTIPLIER   = 1.5;   // 1.5× platform avg → boost global weight

export type AmplifiedPattern = {
  platform: string;
  content_type: string;
  pattern: string;
  avg_engagement_rate: number;
  success_rate: number;
  action: 'amplify' | 'boost' | 'maintain';
  reuse_directive: string;
};

export type AmplificationResult = {
  company_id: string;
  amplified:  AmplifiedPattern[];
  boosted:    AmplifiedPattern[];
  prompt_context: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getWinningPatterns(companyId: string): Promise<Array<{
  platform: string;
  content_type: string;
  pattern: string;
  avg_engagement_rate: number;
  sample_count: number;
  confidence: number;
}>> {
  // Phase A: SELECT the actual autonomous-feature columns
  // (engagement_impact, sample_size) from campaign_autonomous_learnings,
  // then map them to AmplifiedPattern's semantic field names downstream.
  const { data } = await supabase
    .from('campaign_autonomous_learnings')
    .select('platform, content_type, pattern, engagement_impact, sample_size, confidence')
    .eq('company_id', companyId)
    .gte('confidence', 0.5)
    .not('platform', 'is', null)
    .not('pattern', 'is', null)
    .order('engagement_impact', { ascending: false })
    .limit(30);

  return ((data ?? []) as Array<{
    platform: string;
    content_type: string;
    pattern: string;
    engagement_impact: number;
    sample_size: number;
    confidence: number;
  }>).map((row) => ({
    platform:            row.platform,
    content_type:        row.content_type,
    pattern:             row.pattern,
    // engagement_impact in the autonomous-feature schema is a positive-
    // or-negative delta vs the campaign average. Surfacing it as
    // `avg_engagement_rate` preserves the downstream amplification
    // logic; the threshold comparison still works because patterns with
    // negative impact are filtered by the `confidence >= 0.5 + ratio
    // >= BOOST_MULTIPLIER` chain in amplifyWinningPatterns.
    avg_engagement_rate: row.engagement_impact,
    sample_count:        row.sample_size,
    confidence:          row.confidence,
  }));
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function amplifyWinningPatterns(companyId: string): Promise<AmplificationResult> {
  const patterns = await getWinningPatterns(companyId);
  const amplified: AmplifiedPattern[] = [];
  const boosted:   AmplifiedPattern[] = [];

  for (const p of patterns) {
    const benchmark = getPlatformBenchmark(p.platform);
    const ratio = benchmark.avg > 0 ? p.avg_engagement_rate / benchmark.avg : 0;

    if (ratio < BOOST_MULTIPLIER) continue;

    const action: AmplifiedPattern['action'] = ratio >= AMPLIFY_MULTIPLIER ? 'amplify' : 'boost';
    const reuseDirective = action === 'amplify'
      ? `PRIORITISE this pattern — proven ${ratio.toFixed(1)}× above platform average: "${p.pattern}"`
      : `PREFER this pattern — ${ratio.toFixed(1)}× above platform average: "${p.pattern}"`;

    const entry: AmplifiedPattern = {
      platform:            p.platform,
      content_type:        p.content_type,
      pattern:             p.pattern,
      avg_engagement_rate: p.avg_engagement_rate,
      success_rate:        ratio,
      action,
      reuse_directive:     reuseDirective,
    };

    // 1. Boost global pattern weight
    const globalContribution: Omit<GlobalPattern, 'id'> = {
      platform:            p.platform,
      content_type:        p.content_type ?? 'post',
      pattern_type:        'hook',
      pattern:             p.pattern,
      avg_engagement_rate: p.avg_engagement_rate,
      sample_count:        Math.ceil(p.sample_count * 1.5), // amplify weight
      confidence:          Math.min(1, p.confidence + 0.1),
      industry_tags:       [],
    };
    void contributePattern(globalContribution);

    // 2. Upsert to company learnings with elevated confidence
    void upsertLearning({
      company_id:        companyId,
      campaign_id:       null,
      learning_type:     'content_pattern',
      platform:          p.platform,
      content_type:      p.content_type,
      pattern:           p.pattern,
      engagement_impact: p.avg_engagement_rate,
      confidence:        Math.min(1, p.confidence + 0.15),
      sample_size:       p.sample_count,
    });

    if (action === 'amplify') amplified.push(entry);
    else                       boosted.push(entry);
  }

  // ── Build prompt context ───────────────────────────────────────────────────

  const lines: string[] = [];

  if (amplified.length > 0) {
    lines.push('WINNING PATTERNS — AMPLIFY (proven 2×+ above benchmark):');
    amplified.forEach(p => lines.push(`  ★ [${p.platform}] ${p.reuse_directive}`));
  }

  if (boosted.length > 0) {
    lines.push('\nHIGH-PERFORMING PATTERNS — PREFER (1.5×+ above benchmark):');
    boosted.forEach(p => lines.push(`  • [${p.platform}] ${p.reuse_directive}`));
  }

  return {
    company_id:     companyId,
    amplified,
    boosted,
    prompt_context: lines.join('\n'),
  };
}
