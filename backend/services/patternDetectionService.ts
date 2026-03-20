/**
 * Pattern Detection Engine — Step 2
 *
 * Detects winning and losing content patterns for a company by mining
 * performance_feedback, community_ai_actions, and campaign_learnings.
 *
 * Outputs structured pattern clusters for:
 *   - Hook patterns (first-line effectiveness)
 *   - CTA patterns (call-to-action conversion signals)
 *   - Content-type success clusters
 *
 * These patterns are fed back into:
 *   - globalPatternService (contributePattern)
 *   - autonomousCampaignAgent (via getTopLearnings)
 *   - UI insight surfacing
 */

import { supabase } from '../db/supabaseClient';
import { contributePattern } from './globalPatternService';
import { upsertLearning } from './campaignLearningsStore';
import { logDecision } from './autonomousDecisionLogger';
import { scoreHookQuality } from './contentValidationService';
import { deductCreditsIfValueAwaited } from './creditExecutionService';

export type PatternCluster = {
  pattern: string;
  pattern_type: 'hook' | 'cta' | 'structure' | 'format';
  platform: string;
  content_type: string;
  avg_engagement_rate: number;
  occurrence_count: number;
  confidence: number;
  examples: string[];
};

export type DetectedPatterns = {
  company_id: string;
  winning_patterns: PatternCluster[];
  losing_patterns: PatternCluster[];
  hook_quality_distribution: { strong: number; weak: number; neutral: number };
  top_cta_signals: string[];
  content_type_clusters: Array<{ content_type: string; avg_engagement: number; volume: number }>;
  detected_at: string;
};

// ── CTA keywords for pattern extraction ───────────────────────────────────────
const CTA_SIGNALS = [
  'comment below', 'drop a comment', 'share this', 'save this', 'follow for',
  'dm me', 'link in bio', 'click the link', 'sign up', 'book a call',
  'schedule a demo', 'learn more', 'read the full', 'swipe to see',
];

// ── Hook opening patterns for classification ──────────────────────────────────
const HOOK_PATTERN_CLASSIFIERS: Array<{ pattern: string; regex: RegExp }> = [
  { pattern: 'Number-led claim',             regex: /^\d+\s/i },
  { pattern: 'Question hook',                regex: /^.{0,30}\?/i },
  { pattern: 'Contrarian opener',            regex: /\b(unpopular|hot take|controversial|wrong|myth|stop)\b/i },
  { pattern: 'Story opener',                 regex: /\b(i (was|am|used to)|last (week|year|month)|when i)\b/i },
  { pattern: 'Social proof hook',            regex: /\b(\d{1,3}[k+]? (followers|clients|customers|users|companies))\b/i },
  { pattern: 'Curiosity gap',                regex: /\b(here'?s what|the secret|nobody tells|most people don'?t)\b/i },
  { pattern: 'Warning or urgency',           regex: /\b(warning|urgent|don'?t|never|stop)\b/i },
  { pattern: 'Announcement',                 regex: /\b(excited to|pleased to|happy to|announcing|introducing)\b/i },
  { pattern: 'Corporate opener (weak)',      regex: /^(we are|our team|our company|as a company)/i },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function classifyHookPattern(text: string): string {
  const hook = text.split('\n')[0].trim();
  for (const { pattern, regex } of HOOK_PATTERN_CLASSIFIERS) {
    if (regex.test(hook)) return pattern;
  }
  return 'Other opener';
}

function extractCtaSignals(text: string): string[] {
  const lower = text.toLowerCase();
  return CTA_SIGNALS.filter(cta => lower.includes(cta));
}

// ─────────────────────────────────────────────────────────────────────────────
// Main detection
// ─────────────────────────────────────────────────────────────────────────────

export async function detectWinningPatterns(companyId: string): Promise<DetectedPatterns> {
  const detectedAt = new Date().toISOString();

  // Load performance feedback with content text
  const { data: rows } = await supabase
    .from('performance_feedback')
    .select('platform, content_type, engagement_rate, content_text')
    .eq('company_id', companyId)
    .not('content_text', 'is', null)
    .order('collected_at', { ascending: false })
    .limit(500);

  const feedback = (rows ?? []) as Array<{
    platform: string;
    content_type: string;
    engagement_rate: number;
    content_text: string;
  }>;

  if (feedback.length === 0) {
    return {
      company_id: companyId,
      winning_patterns: [],
      losing_patterns: [],
      hook_quality_distribution: { strong: 0, weak: 0, neutral: 0 },
      top_cta_signals: [],
      content_type_clusters: [],
      detected_at: detectedAt,
    };
  }

  const avgEngagement = feedback.reduce((s, r) => s + r.engagement_rate, 0) / feedback.length;

  // ── Hook pattern clustering ───────────────────────────────────────────────
  const hookPatternMap: Record<string, { rates: number[]; examples: string[]; platform: string; content_type: string }> = {};
  const hookQuality = { strong: 0, weak: 0, neutral: 0 };

  for (const row of feedback) {
    const hookPattern = classifyHookPattern(row.content_text);
    const key = `${hookPattern}::${row.platform}::${row.content_type}`;
    if (!hookPatternMap[key]) hookPatternMap[key] = { rates: [], examples: [], platform: row.platform, content_type: row.content_type };
    hookPatternMap[key].rates.push(row.engagement_rate);
    if (hookPatternMap[key].examples.length < 3) {
      hookPatternMap[key].examples.push(row.content_text.slice(0, 80));
    }

    // Hook quality distribution
    const hookScore = scoreHookQuality(row.content_text).score;
    if (hookScore >= 0.7) hookQuality.strong++;
    else if (hookScore < 0.3) hookQuality.weak++;
    else hookQuality.neutral++;
  }

  const hookClusters: PatternCluster[] = Object.entries(hookPatternMap).map(([key, data]) => {
    const [pattern] = key.split('::');
    const avgRate = data.rates.reduce((s, r) => s + r, 0) / data.rates.length;
    return {
      pattern,
      pattern_type: 'hook',
      platform:     data.platform,
      content_type: data.content_type,
      avg_engagement_rate: parseFloat(avgRate.toFixed(4)),
      occurrence_count:    data.rates.length,
      confidence:          Math.min(1, data.rates.length / 10),
      examples:            data.examples,
    };
  });

  // ── CTA pattern detection ─────────────────────────────────────────────────
  const ctaMap: Record<string, { rates: number[] }> = {};
  for (const row of feedback) {
    const signals = extractCtaSignals(row.content_text);
    for (const signal of signals) {
      if (!ctaMap[signal]) ctaMap[signal] = { rates: [] };
      ctaMap[signal].rates.push(row.engagement_rate);
    }
  }
  const topCtaSignals = Object.entries(ctaMap)
    .map(([cta, data]) => ({ cta, avg: data.rates.reduce((s, r) => s + r, 0) / data.rates.length }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 5)
    .map(x => x.cta);

  // ── Content-type clusters ─────────────────────────────────────────────────
  const ctMap: Record<string, { total: number; count: number }> = {};
  for (const row of feedback) {
    const ct = row.content_type || 'post';
    if (!ctMap[ct]) ctMap[ct] = { total: 0, count: 0 };
    ctMap[ct].total += row.engagement_rate;
    ctMap[ct].count++;
  }
  const contentTypeClusters = Object.entries(ctMap)
    .map(([ct, d]) => ({ content_type: ct, avg_engagement: parseFloat((d.total / d.count).toFixed(4)), volume: d.count }))
    .sort((a, b) => b.avg_engagement - a.avg_engagement);

  // ── Split winning vs losing ────────────────────────────────────────────────
  const winningPatterns = hookClusters
    .filter(c => c.avg_engagement_rate > avgEngagement * 1.2 && c.occurrence_count >= 3)
    .sort((a, b) => b.avg_engagement_rate - a.avg_engagement_rate)
    .slice(0, 10);

  const losingPatterns = hookClusters
    .filter(c => c.avg_engagement_rate < avgEngagement * 0.8 && c.occurrence_count >= 3)
    .sort((a, b) => a.avg_engagement_rate - b.avg_engagement_rate)
    .slice(0, 5);

  // ── Contribute winners to global patterns (non-blocking) ─────────────────
  for (const p of winningPatterns.slice(0, 5)) {
    contributePattern({
      platform:            p.platform,
      content_type:        p.content_type,
      pattern_type:        p.pattern_type,
      pattern:             p.pattern,
      avg_engagement_rate: p.avg_engagement_rate,
      sample_count:        p.occurrence_count,
      confidence:          p.confidence,
      industry_tags:       [],
    }).catch(() => {});
  }

  // ── Persist as company learnings ──────────────────────────────────────────
  for (const w of winningPatterns.slice(0, 5)) {
    await upsertLearning({
      company_id:       companyId,
      learning_type:    'hook',
      platform:         w.platform,
      content_type:     w.content_type,
      pattern:          w.pattern,
      engagement_impact: w.avg_engagement_rate - avgEngagement,
      confidence:       w.confidence,
      sample_size:      w.occurrence_count,
      metadata:         { examples: w.examples },
    }).catch(() => {});
  }

  await logDecision({
    company_id:    companyId,
    decision_type: 'learn',
    reason:        `Pattern detection: ${winningPatterns.length} winning, ${losingPatterns.length} losing patterns identified from ${feedback.length} posts`,
    metrics_used:  {
      avg_engagement:   avgEngagement,
      posts_analysed:   feedback.length,
      hook_strong_pct:  ((hookQuality.strong / feedback.length) * 100).toFixed(1),
    },
  });

  const patternsFound = winningPatterns.length + losingPatterns.length;
  await deductCreditsIfValueAwaited(companyId, 'pattern_detection', patternsFound > 0, { note: `Detected ${patternsFound} patterns` });

  return {
    company_id: companyId,
    winning_patterns: winningPatterns,
    losing_patterns:  losingPatterns,
    hook_quality_distribution: hookQuality,
    top_cta_signals:   topCtaSignals,
    content_type_clusters: contentTypeClusters,
    detected_at: detectedAt,
  };
}
