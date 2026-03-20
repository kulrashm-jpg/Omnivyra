/**
 * Fail-Fast Service
 *
 * Monitors content type performance within a running campaign.
 * When a content type's engagement rate falls below the stop threshold:
 *   1. Logs to `fail_fast_log`
 *   2. Returns a stop directive for the campaign orchestrator
 *   3. Identifies the best-performing alternative to reallocate credits to
 *
 * Thresholds:
 *   reduce   — engagement_rate < 50% of platform avg
 *   stop     — engagement_rate < 25% of platform avg AND sample_count >= MIN_SAMPLES
 *
 * Credit reallocation: each stopped content type "donates" its remaining
 * estimated post credits to the winning type.
 */

import { supabase } from '../db/supabaseClient';
import { getPlatformBenchmark } from './globalPatternService';

const REDUCE_THRESHOLD_PCT = 0.50; // 50% of platform avg → reduce
const STOP_THRESHOLD_PCT   = 0.25; // 25% of platform avg → stop
const MIN_SAMPLES          = 3;    // don't stop on fewer than 3 posts
const CREDITS_PER_POST     = 7;    // auto_post (2) + content_basic (5)

export type ContentTypeDecision = {
  content_type: string;
  platform: string;
  engagement_rate: number;
  benchmark_avg: number;
  sample_count: number;
  decision: 'stop' | 'reduce' | 'maintain' | 'amplify';
  credits_reallocated: number;
  reallocated_to: string | null;
  reason: string;
};

export type FailFastResult = {
  campaign_id: string;
  company_id:  string;
  decisions:   ContentTypeDecision[];
  total_credits_reallocated: number;
  winning_type: string | null;
  prompt_directives: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getContentTypeStats(campaignId: string): Promise<Array<{
  content_type: string;
  platform: string;
  avg_rate: number;
  count: number;
}>> {
  const { data } = await supabase
    .from('performance_feedback')
    .select('content_type, platform, engagement_rate')
    .eq('campaign_id', campaignId)
    .not('content_type', 'is', null);

  const rows = (data ?? []) as Array<{ content_type: string; platform: string; engagement_rate: number }>;
  const groups: Record<string, { total: number; count: number; platform: string }> = {};

  for (const r of rows) {
    const key = `${r.content_type}::${r.platform}`;
    if (!groups[key]) groups[key] = { total: 0, count: 0, platform: r.platform };
    groups[key].total += r.engagement_rate ?? 0;
    groups[key].count++;
  }

  return Object.entries(groups).map(([key, g]) => ({
    content_type: key.split('::')[0],
    platform:     g.platform,
    avg_rate:     g.count > 0 ? g.total / g.count : 0,
    count:        g.count,
  }));
}

async function logFailFast(
  companyId: string,
  campaignId: string,
  decision: ContentTypeDecision,
): Promise<void> {
  void supabase.from('fail_fast_log').insert({
    company_id:           companyId,
    campaign_id:          campaignId,
    content_type:         decision.content_type,
    platform:             decision.platform,
    stopped_reason:       decision.reason,
    engagement_rate:      decision.engagement_rate,
    credits_reallocated:  decision.credits_reallocated,
    reallocated_to:       decision.reallocated_to,
    stopped_at:           new Date().toISOString(),
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function checkAndFailFast(
  campaignId: string,
  companyId: string,
): Promise<FailFastResult> {
  const stats = await getContentTypeStats(campaignId);

  if (!stats.length) {
    return {
      campaign_id: campaignId,
      company_id:  companyId,
      decisions:   [],
      total_credits_reallocated: 0,
      winning_type: null,
      prompt_directives: '',
    };
  }

  // Find winning type (highest engagement rate with enough samples)
  const withSamples = stats.filter(s => s.count >= MIN_SAMPLES);
  const winnerStat  = withSamples.sort((a, b) => b.avg_rate - a.avg_rate)[0] ?? null;
  const winningType = winnerStat?.content_type ?? null;

  const decisions: ContentTypeDecision[] = [];
  let totalReallocated = 0;

  for (const stat of stats) {
    const benchmark = getPlatformBenchmark(stat.platform);
    const stopThreshold   = benchmark.avg * STOP_THRESHOLD_PCT;
    const reduceThreshold = benchmark.avg * REDUCE_THRESHOLD_PCT;

    let decision: ContentTypeDecision['decision'] = 'maintain';
    let reason = '';
    let reallocated = 0;

    if (stat.avg_rate >= benchmark.avg * 1.5) {
      decision = 'amplify';
      reason   = `${stat.content_type} performing ${(stat.avg_rate / benchmark.avg).toFixed(1)}× above benchmark — amplify`;
    } else if (stat.count >= MIN_SAMPLES && stat.avg_rate < stopThreshold) {
      decision    = 'stop';
      reason      = `engagement ${(stat.avg_rate * 100).toFixed(2)}% < stop threshold ${(stopThreshold * 100).toFixed(2)}%`;
      reallocated = CREDITS_PER_POST * 4; // estimated 4 remaining posts
      totalReallocated += reallocated;
      await logFailFast(companyId, campaignId, {
        content_type: stat.content_type, platform: stat.platform,
        engagement_rate: stat.avg_rate, benchmark_avg: benchmark.avg,
        sample_count: stat.count, decision, credits_reallocated: reallocated,
        reallocated_to: winningType, reason,
      });
    } else if (stat.avg_rate < reduceThreshold) {
      decision = 'reduce';
      reason   = `engagement ${(stat.avg_rate * 100).toFixed(2)}% < reduce threshold ${(reduceThreshold * 100).toFixed(2)}%`;
    }

    decisions.push({
      content_type:        stat.content_type,
      platform:            stat.platform,
      engagement_rate:     stat.avg_rate,
      benchmark_avg:       benchmark.avg,
      sample_count:        stat.count,
      decision,
      credits_reallocated: reallocated,
      reallocated_to:      decision === 'stop' ? winningType : null,
      reason: reason || `maintaining current allocation (${(stat.avg_rate * 100).toFixed(2)}% engagement)`,
    });
  }

  const stopped  = decisions.filter(d => d.decision === 'stop').map(d => d.content_type);
  const amplified = decisions.filter(d => d.decision === 'amplify').map(d => d.content_type);
  const reduced  = decisions.filter(d => d.decision === 'reduce').map(d => d.content_type);

  const directives: string[] = ['FAIL-FAST DIRECTIVES:'];
  if (amplified.length) directives.push(`  AMPLIFY: ${amplified.join(', ')} (top performers)`);
  if (reduced.length)   directives.push(`  REDUCE: ${reduced.join(', ')} (low performers)`);
  if (stopped.length)   directives.push(`  STOP generating: ${stopped.join(', ')} — reallocate to ${winningType ?? 'top performer'}`);

  return {
    campaign_id:               campaignId,
    company_id:                companyId,
    decisions,
    total_credits_reallocated: totalReallocated,
    winning_type:              winningType,
    prompt_directives:         directives.join('\n'),
  };
}
