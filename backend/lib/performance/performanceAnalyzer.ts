/**
 * Performance Analyzer — deterministic, rule-based, no AI, no async, no external deps.
 *
 * Answers: How is this campaign performing vs expectations? What should change?
 * What should the NEXT campaign learn from this one?
 *
 * Data sources (all derived from daily_content_plans rows):
 *   - actual_metrics JSONB:  impressions, reach, engagement_rate, clicks, leads
 *   - status field:          published, scheduled, overdue, planned, draft
 *
 * Decision hierarchy:
 *   1. Execution health  — are we actually publishing?
 *   2. Reach trend       — are people seeing the content?
 *   3. Engagement trend  — are people responding?
 *   4. Conversion trend  — are people clicking / converting?
 *   5. Platform signals  — which channels over/underperform?
 *   6. Opportunities     — what's working that we should amplify?
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TrendLabel = 'LOW' | 'EXPECTED' | 'HIGH';

/** Per-slot input derived from a daily_content_plans row. */
export interface SlotMetrics {
  platform: string;
  status: string; // 'planned' | 'draft' | 'ready' | 'scheduled' | 'published' | 'overdue'
  week_number: number;
  content_type?: string | null;
  actual_metrics?: {
    impressions?: number | null;
    reach?: number | null;
    /** As decimal, e.g. 0.025 = 2.5% */
    engagement_rate?: number | null;
    clicks?: number | null;
    likes?: number | null;
    comments?: number | null;
    shares?: number | null;
    saves?: number | null;
    leads?: number | null;
  } | null;
}

/** Per-platform baseline from AccountContext (passed when available). */
export interface PlatformBaseline {
  platform: string;
  avgReach: number;
  engagementRate: number; // as percentage, e.g. 2.5
}

export interface PerformanceExpectation {
  /** From CampaignValidation.expectedOutcome */
  reachEstimate?: string | null;
  engagementEstimate?: string | null;
  leadsEstimate?: string | null;
  /** Per-platform baselines from AccountContext */
  platformBaselines?: PlatformBaseline[];
}

export interface PlatformPerformance {
  platform: string;
  totalSlots: number;
  publishedSlots: number;
  avgImpressionsPerPost: number;
  avgEngagementRate: number; // as percentage
  totalClicks: number;
  totalLeads: number;
  reachTrend: TrendLabel;
  engagementTrend: TrendLabel;
}

export interface CampaignPerformance {
  campaignId: string;
  totalSlots: number;
  publishedSlots: number;
  overdueSlots: number;
  /** Slots that should be published by now (past date, not published) */
  publishedRatio: number;
  platformMetrics: PlatformPerformance[];
  summary: {
    reachTrend: TrendLabel;
    engagementTrend: TrendLabel;
    conversionTrend?: TrendLabel;
    executionHealth: 'HEALTHY' | 'AT_RISK' | 'CRITICAL';
  };
  lastUpdated: Date;
}

export interface PerformanceInsight {
  /** Problems requiring action. */
  issues: string[];
  /** Positive signals worth amplifying. */
  opportunities: string[];
  /** Concrete next steps. */
  recommendations: string[];
  /** Compact text for AI prompt injection — next campaign learns from this. */
  plannerFeedback: string;
}

export interface AnalyzeCampaignPerformanceInput {
  campaignId: string;
  slots: SlotMetrics[];
  expectation?: PerformanceExpectation | null;
  /** ISO date string — used to classify overdue slots. Defaults to today. */
  asOfDate?: string;
}

// ---------------------------------------------------------------------------
// Engagement rate thresholds by platform (as %)
// Sources: industry benchmarks 2024
// LOW < low_threshold, HIGH >= high_threshold, else EXPECTED
// ---------------------------------------------------------------------------

const ENGAGEMENT_THRESHOLDS: Record<string, { low: number; high: number }> = {
  linkedin:  { low: 0.5,  high: 1.8 },
  instagram: { low: 1.0,  high: 3.5 },
  facebook:  { low: 0.5,  high: 1.5 },
  twitter:   { low: 0.3,  high: 1.0 },
  x:         { low: 0.3,  high: 1.0 },
  youtube:   { low: 2.0,  high: 6.0 },
  tiktok:    { low: 3.0,  high: 9.0 },
  pinterest: { low: 0.2,  high: 0.8 },
  _default:  { low: 0.5,  high: 2.0 },
};

/** Absolute impressions-per-post thresholds when no account baseline is available. */
const REACH_THRESHOLDS: Record<string, { low: number; high: number }> = {
  linkedin:  { low: 200,   high: 1500  },
  instagram: { low: 300,   high: 2000  },
  facebook:  { low: 150,   high: 1000  },
  twitter:   { low: 100,   high: 800   },
  x:         { low: 100,   high: 800   },
  youtube:   { low: 500,   high: 5000  },
  tiktok:    { low: 1000,  high: 10000 },
  _default:  { low: 100,   high: 1000  },
};

// ---------------------------------------------------------------------------
// Thresholding helpers
// ---------------------------------------------------------------------------

function classifyEngagement(platform: string, ratePercent: number): TrendLabel {
  const t = ENGAGEMENT_THRESHOLDS[platform.toLowerCase()] ?? ENGAGEMENT_THRESHOLDS['_default'];
  if (ratePercent < t.low) return 'LOW';
  if (ratePercent >= t.high) return 'HIGH';
  return 'EXPECTED';
}

function classifyReach(
  platform: string,
  avgImpressions: number,
  baseline?: PlatformBaseline
): TrendLabel {
  if (avgImpressions === 0) return 'LOW';

  // Prefer account baseline (actual historical reach) over generic thresholds
  if (baseline && baseline.avgReach > 0) {
    const ratio = avgImpressions / baseline.avgReach;
    if (ratio < 0.6) return 'LOW';
    if (ratio > 1.4) return 'HIGH';
    return 'EXPECTED';
  }

  // Fall back to absolute thresholds
  const t = REACH_THRESHOLDS[platform.toLowerCase()] ?? REACH_THRESHOLDS['_default'];
  if (avgImpressions < t.low) return 'LOW';
  if (avgImpressions >= t.high) return 'HIGH';
  return 'EXPECTED';
}

function classifyConversion(totalClicks: number, publishedSlots: number): TrendLabel | undefined {
  if (publishedSlots === 0 || totalClicks === 0) return undefined;
  const ctr = (totalClicks / publishedSlots) * 100; // clicks per post as %
  if (ctr < 0.5) return 'LOW';
  if (ctr >= 2.0) return 'HIGH';
  return 'EXPECTED';
}

function classifyExecutionHealth(
  publishedRatio: number,
  overdueSlots: number
): CampaignPerformance['summary']['executionHealth'] {
  if (publishedRatio >= 0.8 && overdueSlots === 0) return 'HEALTHY';
  if (publishedRatio < 0.4 || overdueSlots > 5) return 'CRITICAL';
  return 'AT_RISK';
}

// ---------------------------------------------------------------------------
// Per-platform aggregation
// ---------------------------------------------------------------------------

function aggregatePlatformMetrics(
  slots: SlotMetrics[],
  platformBaselines: PlatformBaseline[]
): PlatformPerformance[] {
  const byPlatform = new Map<string, SlotMetrics[]>();
  for (const slot of slots) {
    const p = (slot.platform || 'unknown').toLowerCase();
    if (!byPlatform.has(p)) byPlatform.set(p, []);
    byPlatform.get(p)!.push(slot);
  }

  const results: PlatformPerformance[] = [];

  for (const [platform, platformSlots] of byPlatform) {
    const published = platformSlots.filter((s) => s.status === 'published');
    const totalSlots = platformSlots.length;
    const publishedSlots = published.length;

    let totalImpressions = 0;
    let totalEngagementRateSum = 0;
    let engagementDataPoints = 0;
    let totalClicks = 0;
    let totalLeads = 0;

    for (const slot of published) {
      const m = slot.actual_metrics;
      if (!m) continue;
      if (typeof m.impressions === 'number' && m.impressions > 0) {
        totalImpressions += m.impressions;
      } else if (typeof m.reach === 'number' && m.reach > 0) {
        // reach as proxy for impressions when impressions not available
        totalImpressions += m.reach;
      }
      if (typeof m.engagement_rate === 'number' && m.engagement_rate > 0) {
        // stored as decimal (0.025) or percentage (2.5) — normalize to %
        const rateAsPercent = m.engagement_rate > 1 ? m.engagement_rate : m.engagement_rate * 100;
        totalEngagementRateSum += rateAsPercent;
        engagementDataPoints += 1;
      }
      if (typeof m.clicks === 'number') totalClicks += m.clicks;
      if (typeof m.leads === 'number') totalLeads += m.leads;
    }

    const avgImpressionsPerPost = publishedSlots > 0 ? totalImpressions / publishedSlots : 0;
    const avgEngagementRate = engagementDataPoints > 0
      ? totalEngagementRateSum / engagementDataPoints
      : 0;

    const baseline = platformBaselines.find((b) => b.platform.toLowerCase() === platform);

    results.push({
      platform,
      totalSlots,
      publishedSlots,
      avgImpressionsPerPost: Math.round(avgImpressionsPerPost),
      avgEngagementRate: Math.round(avgEngagementRate * 100) / 100,
      totalClicks,
      totalLeads,
      reachTrend: classifyReach(platform, avgImpressionsPerPost, baseline),
      engagementTrend: classifyEngagement(platform, avgEngagementRate),
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Core: derive CampaignPerformance from raw slots
// ---------------------------------------------------------------------------

export function derivePerformanceFromSlots(
  campaignId: string,
  slots: SlotMetrics[],
  platformBaselines: PlatformBaseline[] = []
): CampaignPerformance {
  // Guard: empty slot list — return minimal safe object
  if (!Array.isArray(slots) || slots.length === 0) {
    return {
      campaignId,
      totalSlots: 0,
      publishedSlots: 0,
      overdueSlots: 0,
      publishedRatio: 0,
      platformMetrics: [],
      summary: { reachTrend: 'LOW', engagementTrend: 'LOW', executionHealth: 'CRITICAL' },
      lastUpdated: new Date(),
    };
  }

  const totalSlots = slots.length;
  const publishedSlots = slots.filter((s) => s.status === 'published').length;
  const overdueSlots = slots.filter((s) => s.status === 'overdue').length;

  // Guard: prevent division by zero
  const publishedRatio = totalSlots > 0 ? publishedSlots / totalSlots : 0;

  const platformMetrics = aggregatePlatformMetrics(slots, platformBaselines);

  // Roll up platform trends to campaign-level summary
  const reachTrends = platformMetrics.map((p) => p.reachTrend);
  const engagementTrends = platformMetrics.map((p) => p.engagementTrend);

  const campaignReachTrend = rollUpTrend(reachTrends);
  const campaignEngagementTrend = rollUpTrend(engagementTrends);

  const totalClicks = platformMetrics.reduce((s, p) => s + p.totalClicks, 0);
  const conversionTrend = classifyConversion(totalClicks, publishedSlots);
  const executionHealth = classifyExecutionHealth(publishedRatio, overdueSlots);

  return {
    campaignId,
    totalSlots,
    publishedSlots,
    overdueSlots,
    publishedRatio: Math.round(publishedRatio * 100) / 100,
    platformMetrics,
    summary: {
      reachTrend: campaignReachTrend,
      engagementTrend: campaignEngagementTrend,
      conversionTrend,
      executionHealth,
    },
    lastUpdated: new Date(),
  };
}

/** When multiple platforms have data, conservative rollup: LOW if any LOW, else HIGH if any HIGH, else EXPECTED. */
function rollUpTrend(trends: TrendLabel[]): TrendLabel {
  if (trends.length === 0) return 'EXPECTED';
  if (trends.includes('LOW')) return 'LOW';
  if (trends.every((t) => t === 'HIGH')) return 'HIGH';
  return 'EXPECTED';
}

// ---------------------------------------------------------------------------
// Core: comparePerformance — rule engine that builds PerformanceInsight
// ---------------------------------------------------------------------------

export function comparePerformance(
  performance: CampaignPerformance,
  expectation?: PerformanceExpectation | null
): PerformanceInsight {
  const issues: string[] = [];
  const opportunities: string[] = [];
  const recommendations: string[] = [];

  const { summary, platformMetrics, publishedRatio, overdueSlots, publishedSlots, totalSlots } = performance;

  // ── Rule 1: Execution health ─────────────────────────────────────────────

  if (summary.executionHealth === 'CRITICAL') {
    const pct = Math.round(publishedRatio * 100);
    issues.push(
      `Execution severely behind: only ${pct}% of content published${overdueSlots > 0 ? ` (${overdueSlots} overdue slots)` : ''}.`
    );
    recommendations.push(
      'Prioritize clearing overdue slots before creating new content — audience continuity is at risk.'
    );
    recommendations.push(
      'Review publishing capacity: consider reducing posting frequency or batching content creation.'
    );
  } else if (summary.executionHealth === 'AT_RISK') {
    const pct = Math.round(publishedRatio * 100);
    issues.push(`Execution slightly behind: ${pct}% published. ${overdueSlots} overdue slot(s) need attention.`);
    recommendations.push('Catch up on overdue slots this week to avoid compounding delays.');
  }

  // ── Rule 2: Reach trend ──────────────────────────────────────────────────

  if (summary.reachTrend === 'LOW') {
    issues.push('Reach is below expectations — content distribution is underperforming.');

    const qualExpected = expectation?.reachEstimate ?? '';
    if (qualExpected) {
      issues.push(`Expected reach was "${qualExpected}" — actual impressions are tracking well below this.`);
    }

    const lowReachPlatforms = platformMetrics.filter((p) => p.reachTrend === 'LOW').map((p) => p.platform);
    if (lowReachPlatforms.length > 0) {
      recommendations.push(
        `Low reach on: ${lowReachPlatforms.join(', ')}. Consider paid boosting to supplement organic distribution.`
      );
    }
    recommendations.push(
      'Experiment with posting times — off-peak schedules often suppress algorithmic reach significantly.'
    );
  } else if (summary.reachTrend === 'HIGH') {
    opportunities.push('Reach is significantly above expectations — distribution is working well.');
    recommendations.push(
      'Document what content format and timing drove this reach spike and replicate in future weeks.'
    );
  }

  // ── Rule 3: Engagement trend ─────────────────────────────────────────────

  if (summary.engagementTrend === 'LOW') {
    issues.push('Engagement is below platform benchmarks — content is not resonating with the audience.');
    recommendations.push(
      'Audit the last 5 published pieces: if they are promotional rather than value-led, adjust the content mix.'
    );
    recommendations.push(
      'Add stronger hooks in the first line — most platforms truncate after 2–3 lines without a "see more" click.'
    );

    // Cross-signal: low engagement + high reach = visibility without resonance
    if (summary.reachTrend === 'HIGH') {
      issues.push(
        'High reach with low engagement indicates a messaging or format mismatch — people see but don\'t interact.'
      );
      recommendations.push(
        'Test a different content angle: ask questions, share opinions, or use data-driven posts to prompt interaction.'
      );
    }
  } else if (summary.engagementTrend === 'HIGH') {
    opportunities.push('Engagement is above benchmarks — audience is actively responding to this content.');

    // Cross-signal: high engagement + low reach = great content not being distributed
    if (summary.reachTrend === 'LOW') {
      opportunities.push(
        'Strong engagement on limited reach means this content has high amplification potential.'
      );
      recommendations.push(
        'Boost top-performing posts with paid promotion — proven engagement signals predict strong paid performance.'
      );
    }
  }

  // ── Rule 4: Conversion trend ─────────────────────────────────────────────

  if (summary.conversionTrend === 'LOW') {
    issues.push('Click-through rate is below 0.5% per post — CTAs are not driving action.');
    recommendations.push(
      'Rewrite CTAs to be specific and benefit-led (e.g., "Get the free guide" not "Click here").'
    );
    recommendations.push(
      'Check landing page alignment: if the CTA promise and landing page message differ, conversion drops sharply.'
    );
  } else if (summary.conversionTrend === 'HIGH') {
    opportunities.push('Conversion rate is strong — CTAs and landing pages are aligned effectively.');
    recommendations.push(
      'Scale content in the highest-converting funnel stages and reduce effort in stages with low conversion.'
    );
  }

  // ── Rule 5: Platform-level signals ───────────────────────────────────────

  const strongPlatforms = platformMetrics.filter(
    (p) => p.engagementTrend === 'HIGH' && p.reachTrend !== 'LOW'
  );
  const weakPlatforms = platformMetrics.filter(
    (p) => p.engagementTrend === 'LOW' && p.reachTrend === 'LOW'
  );

  if (strongPlatforms.length > 0) {
    const names = strongPlatforms.map((p) => p.platform).join(', ');
    opportunities.push(`Best-performing channel(s): ${names} — highest engagement and reach ratios.`);
    recommendations.push(
      `Shift 20–30% more content creation effort toward ${names} in the next campaign sprint.`
    );
  }

  if (weakPlatforms.length > 0) {
    const names = weakPlatforms.map((p) => p.platform).join(', ');
    issues.push(`Underperforming channel(s): ${names} — both reach and engagement are below expectations.`);
    recommendations.push(
      `Evaluate whether ${names} is the right channel for this audience. Consider pausing or reducing frequency.`
    );
  }

  // ── Rule 6: Content execution volume signal ───────────────────────────────

  if (totalSlots > 0 && publishedSlots === 0) {
    issues.push('No content has been published yet — performance data will populate as content goes live.');
    recommendations.push('Check the publishing queue and ensure scheduled posts are set up correctly.');
  } else if (publishedSlots < 3) {
    // Too few data points — add a caveat
    issues.push(
      `Only ${publishedSlots} post(s) published — insights are preliminary. Trends will stabilize with more data.`
    );
  }

  // ── Fallback: if nothing flagged ─────────────────────────────────────────

  if (issues.length === 0 && opportunities.length === 0) {
    opportunities.push('Campaign is performing within expected range — execution and engagement are on track.');
    recommendations.push('Continue current cadence and monitor for shifts in engagement after week 3.');
  }

  return {
    issues,
    opportunities,
    recommendations,
    plannerFeedback: buildPlannerFeedback(performance, issues, opportunities, recommendations),
  };
}

// ---------------------------------------------------------------------------
// Planner feedback builder — formats insights for AI prompt injection
// ---------------------------------------------------------------------------

export function buildPlannerFeedback(
  performance: CampaignPerformance,
  issues: string[],
  opportunities: string[],
  recommendations: string[]
): string {
  const lines: string[] = [
    'PREVIOUS CAMPAIGN PERFORMANCE LEARNINGS (apply to this new campaign):',
  ];

  const { summary, platformMetrics } = performance;

  lines.push(`  Execution health: ${summary.executionHealth}`);
  lines.push(`  Published: ${performance.publishedSlots}/${performance.totalSlots} slots`);
  lines.push(`  Reach trend: ${summary.reachTrend}`);
  lines.push(`  Engagement trend: ${summary.engagementTrend}`);
  if (summary.conversionTrend) {
    lines.push(`  Conversion trend: ${summary.conversionTrend}`);
  }

  if (platformMetrics.length > 0) {
    const sorted = [...platformMetrics].sort((a, b) => b.avgEngagementRate - a.avgEngagementRate);
    const top = sorted[0];
    if (top && top.avgEngagementRate > 0) {
      lines.push(`  Best platform: ${top.platform} (avg ${top.avgEngagementRate}% engagement)`);
    }
    if (sorted.length > 1) {
      const bottom = sorted[sorted.length - 1];
      lines.push(`  Lowest platform: ${bottom.platform} (avg ${bottom.avgEngagementRate}% engagement)`);
    }
  }

  if (issues.length > 0) {
    lines.push('  Key issues to avoid repeating:');
    issues.slice(0, 3).forEach((i) => lines.push(`    - ${i}`));
  }

  if (opportunities.length > 0) {
    lines.push('  Patterns to amplify:');
    opportunities.slice(0, 2).forEach((o) => lines.push(`    + ${o}`));
  }

  if (recommendations.length > 0) {
    lines.push('  Actionable adjustments for this campaign:');
    recommendations.slice(0, 3).forEach((r) => lines.push(`    → ${r}`));
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main export — full analysis pipeline
// ---------------------------------------------------------------------------

export function analyzeCampaignPerformance(
  input: AnalyzeCampaignPerformanceInput
): PerformanceInsight {
  // Guard: malformed input
  if (!input || typeof input.campaignId !== 'string') {
    console.warn('[PLANNER][PERFORMANCE][WARN] analyzeCampaignPerformance received invalid input');
    return {
      issues: ['Performance analysis could not run — input data is incomplete.'],
      opportunities: [],
      recommendations: ['Ensure campaign data is loaded before requesting performance insights.'],
      plannerFeedback: '',
    };
  }

  const slots = Array.isArray(input.slots) ? input.slots.filter((s) => s != null) : [];
  const baselines = input.expectation?.platformBaselines ?? [];

  const performance = derivePerformanceFromSlots(input.campaignId, slots, baselines);
  return comparePerformance(performance, input.expectation ?? null);
}
