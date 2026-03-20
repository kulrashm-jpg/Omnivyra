/**
 * Campaign Learnings Store
 *
 * Reads and writes structured learnings from the `campaign_learnings` table.
 * Learnings are distilled from performance data after each campaign cycle
 * and injected into future campaign generation as context.
 *
 * Learning types:
 *   success        — patterns that drove high engagement
 *   failure        — patterns that hurt engagement
 *   platform       — platform-specific insights
 *   content_pattern— content structure / format learnings
 *   timing         — day/time posting insights
 *   hook           — hook phrasing patterns
 */

import { supabase } from '../db/supabaseClient';
import { generatePerformanceInsights } from './performanceInsightGenerator';
import { rankPlatformsByPerformance } from './platformPerformanceRanker';
import { logDecision } from './autonomousDecisionLogger';

export type LearningType = 'success' | 'failure' | 'platform' | 'content_pattern' | 'timing' | 'hook';

export type CampaignLearning = {
  id?: string;
  company_id: string;
  campaign_id?: string | null;
  learning_type: LearningType;
  platform?: string | null;
  content_type?: string | null;
  pattern: string;
  engagement_impact: number;   // positive = boosts, negative = hurts
  confidence: number;          // 0–1
  sample_size: number;
  metadata?: Record<string, unknown>;
};

/** Upsert a learning — if same company+type+pattern exists, update the running average. */
export async function upsertLearning(learning: CampaignLearning): Promise<void> {
  try {
    // Check for existing matching learning
    let query = supabase
      .from('campaign_learnings')
      .select('id, engagement_impact, confidence, sample_size')
      .eq('company_id', learning.company_id)
      .eq('learning_type', learning.learning_type)
      .eq('pattern', learning.pattern);

    if (learning.platform)     query = query.eq('platform', learning.platform);
    if (learning.content_type) query = query.eq('content_type', learning.content_type);

    const { data: existing } = await query.maybeSingle();

    if (existing) {
      // Running weighted average update
      const n = existing.sample_size + learning.sample_size;
      const newImpact  = (existing.engagement_impact * existing.sample_size + learning.engagement_impact * learning.sample_size) / n;
      const newConf    = (existing.confidence * existing.sample_size + learning.confidence * learning.sample_size) / n;

      await supabase.from('campaign_learnings')
        .update({
          engagement_impact: parseFloat(newImpact.toFixed(4)),
          confidence:        parseFloat(newConf.toFixed(3)),
          sample_size:       n,
          updated_at:        new Date().toISOString(),
          metadata:          { ...((existing as any).metadata ?? {}), ...((learning.metadata ?? {})) },
        })
        .eq('id', (existing as any).id);
    } else {
      await supabase.from('campaign_learnings').insert({
        company_id:       learning.company_id,
        campaign_id:      learning.campaign_id ?? null,
        learning_type:    learning.learning_type,
        platform:         learning.platform ?? null,
        content_type:     learning.content_type ?? null,
        pattern:          learning.pattern,
        engagement_impact: learning.engagement_impact,
        confidence:       learning.confidence,
        sample_size:      learning.sample_size,
        metadata:         learning.metadata ?? {},
        created_at:       new Date().toISOString(),
        updated_at:       new Date().toISOString(),
      });
    }
  } catch (err) {
    console.warn('[campaignLearningsStore] upsertLearning failed', err);
  }
}

/** Retrieve top learnings for a company, ordered by confidence × |impact|. */
export async function getTopLearnings(
  companyId: string,
  options: { limit?: number; learning_type?: LearningType; platform?: string } = {}
): Promise<CampaignLearning[]> {
  let query = supabase
    .from('campaign_learnings')
    .select('*')
    .eq('company_id', companyId)
    .gte('confidence', 0.3)
    .order('confidence', { ascending: false })
    .limit(options.limit ?? 20);

  if (options.learning_type) query = query.eq('learning_type', options.learning_type);
  if (options.platform)      query = query.eq('platform', options.platform);

  const { data } = await query;
  return (data ?? []) as CampaignLearning[];
}

/**
 * Distil learnings from a completed campaign and persist them.
 * Called after each campaign cycle by the autonomous scheduler.
 */
export async function distilCampaignLearnings(
  companyId: string,
  campaignId: string,
): Promise<number> {
  let count = 0;
  try {
    const [insights, platformRanks] = await Promise.all([
      generatePerformanceInsights(campaignId),
      rankPlatformsByPerformance(campaignId),
    ]);

    if (!insights) return 0;

    // ── Platform learnings ────────────────────────────────────────────────────
    for (const rank of platformRanks) {
      const impact = rank.avg_engagement_rate - insights.avg_engagement_rate;
      const learningType: LearningType = impact > 0 ? 'success' : 'failure';
      await upsertLearning({
        company_id:       companyId,
        campaign_id:      campaignId,
        learning_type:    'platform',
        platform:         rank.platform,
        pattern:          `${rank.platform} engagement ${impact > 0 ? 'outperforms' : 'underperforms'} campaign average`,
        engagement_impact: parseFloat(impact.toFixed(4)),
        confidence:       Math.min(1, rank.post_count / 10),
        sample_size:      rank.post_count,
        metadata:         { avg_engagement_rate: rank.avg_engagement_rate },
      });
      count++;
    }

    // ── Content type learnings from insights ─────────────────────────────────
    for (const strength of insights.strengths) {
      await upsertLearning({
        company_id:    companyId,
        campaign_id:   campaignId,
        learning_type: 'content_pattern',
        pattern:       strength,
        engagement_impact: 0.05,  // positive impact
        confidence:    0.7,
        sample_size:   1,
      });
      count++;
    }

    for (const weakness of insights.weaknesses) {
      await upsertLearning({
        company_id:    companyId,
        campaign_id:   campaignId,
        learning_type: 'content_pattern',
        pattern:       weakness,
        engagement_impact: -0.03,  // negative impact
        confidence:    0.6,
        sample_size:   1,
      });
      count++;
    }

    await logDecision({
      company_id:  companyId,
      campaign_id: campaignId,
      decision_type: 'learn',
      reason:      `Distilled ${count} learnings from campaign performance`,
      metrics_used: { avg_engagement_rate: insights.avg_engagement_rate, platform_bias: insights.platform_bias },
    });
  } catch (err) {
    console.warn('[campaignLearningsStore] distilCampaignLearnings failed', err);
  }

  return count;
}

/** Format top learnings as a concise prompt-injectable string. */
export function formatLearningsForPrompt(learnings: CampaignLearning[]): string {
  if (learnings.length === 0) return '';
  const successes = learnings.filter(l => l.engagement_impact > 0).slice(0, 5);
  const failures  = learnings.filter(l => l.engagement_impact < 0).slice(0, 3);

  const lines: string[] = ['HISTORICAL LEARNINGS FROM PAST CAMPAIGNS:'];
  if (successes.length) {
    lines.push('✓ What worked:');
    successes.forEach(l => lines.push(`  - ${l.pattern} (confidence: ${(l.confidence * 100).toFixed(0)}%)`));
  }
  if (failures.length) {
    lines.push('✗ What to avoid:');
    failures.forEach(l => lines.push(`  - ${l.pattern} (confidence: ${(l.confidence * 100).toFixed(0)}%)`));
  }
  return lines.join('\n');
}
