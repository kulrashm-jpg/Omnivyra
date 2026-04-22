import type { BehaviorReportData } from './performanceReportService';
import type { BehaviorRecommendation } from './behaviorRecommendationService';

export interface PerformanceCampaignItem {
  id: string;
  name: string;
  status: string;
  updated_at: string | null;
}

export interface PerformanceEngagementContext {
  marketpulse_usage_summary: string;
  recommendations_pending: number;
  recommendations_implemented: number;
  recommendations_ignored: number;
}

export interface PerformanceMapperContext {
  campaigns?: PerformanceCampaignItem[];
  engagement?: PerformanceEngagementContext | null;
}

export interface PerformanceReportMappedData {
  lead_summary: {
    total_leads: number;
    conversion_rate: number;
    best_channel: string;
    biggest_drop_off: string;
    diagnosis: string;
    decision_summary: string;
    why_this_matters: string;
  };
  leakage: {
    funnel_steps: BehaviorReportData['funnel']['steps'];
    top_drop_off_pages: Array<{
      page_url: string;
      drop_off_rate: number;
      entry_sessions: number;
      exit_sessions: number;
    }>;
    decision_summary: string;
    why_this_matters: string;
  };
  sources: Array<{
    channel: string;
    sessions: number;
    events: number;
    leads: number;
    conversion_rate: number;
    engagement_rate: number;
  }>;
  platform_fit: {
    best_platform: string;
    underutilized: string;
    waste_channel: string;
    decision_summary: string;
    why_this_matters: string;
    platforms: Array<{
      platform: string;
      decision: 'scale' | 'fix' | 'reduce';
      reason: string;
      sessions: number;
      leads: number;
      conversion_rate: number;
      engagement_rate: number;
    }>;
  };
  content: {
    top_converting_pages: Array<{
      page_url: string;
      conversions: number;
      visits: number;
      conversion_rate: number;
    }>;
    high_traffic_low_conversion_pages: Array<{
      page_url: string;
      visits: number;
      conversions: number;
      conversion_rate: number;
    }>;
    decision_summary: string;
    why_this_matters: string;
  };
  diagnosis: {
    friction_points: string[];
    messaging_issues: string[];
    cta_gaps: string[];
    decision_summary: string;
    why_this_matters: string;
  };
  actions: {
    quick_wins: BehaviorRecommendation[];
    growth_levers: BehaviorRecommendation[];
    strategic_bets: BehaviorRecommendation[];
    decision_summary: string;
    why_this_matters: string;
  };
  campaigns: {
    total_campaigns: number;
    effectiveness_summary: string;
    decision_summary: string;
    why_this_matters: string;
    items: Array<PerformanceCampaignItem & {
      classification: 'effective' | 'engaging_but_not_converting' | 'inactive_or_missing';
      reason: string;
    }>;
  };
  engagement: {
    marketpulse_usage: string;
    insights_consumed: number;
    insights_acted: number;
    stage: 'observing' | 'experimenting' | 'executing' | 'scaling';
    decision_summary: string;
    why_this_matters: string;
  };
  lead_activation: {
    leads_captured: number;
    leads_acted_upon: number;
    follow_up_gap: number;
    follow_up_rate: number;
    engagement_capture_gap: number;
    decision_summary: string;
    why_this_matters: string;
  };
  maturity: {
    stage: 'observing' | 'measuring' | 'optimizing' | 'scaling';
    readiness_signals: string[];
    decision_summary: string;
    why_this_matters: string;
  };
  next_moves: Array<{
    action: string;
    impact: string;
    effort: BehaviorRecommendation['effort_level'];
    source: string;
    priority: BehaviorRecommendation['priority'];
  }>;
  focus_this_week: Array<{
    action: string;
    impact: string;
    effort: BehaviorRecommendation['effort_level'];
    source: string;
  }>;
}

function safeDiv(num: number, den: number): number {
  return den > 0 ? num / den : 0;
}

function recommendationImpactWeight(item: BehaviorRecommendation): number {
  return Math.max(
    Number(item.context?.entry_sessions ?? 0),
    Number(item.context?.sessions ?? 0),
    Number(item.context?.visits ?? 0),
    Number(item.context?.users ?? 0),
  );
}

function rankRecommendations(items: BehaviorRecommendation[]): BehaviorRecommendation[] {
  const priorityRank = { high: 3, medium: 2, low: 1 };
  return [...items].sort((a, b) => {
    const priorityDelta = priorityRank[b.priority] - priorityRank[a.priority];
    if (priorityDelta !== 0) return priorityDelta;
    return recommendationImpactWeight(b) - recommendationImpactWeight(a);
  });
}

function impactEstimateRank(value: string): number {
  const normalized = value.replace(/–/g, '-');
  const numbers = normalized.match(/\d+/g)?.map((item) => Number(item)) ?? [];
  return Math.max(...numbers, 0);
}

function effortRank(value: BehaviorRecommendation['effort_level']): number {
  if (value === 'low') return 1;
  if (value === 'medium') return 2;
  return 3;
}

function bestChannelLabel(data: BehaviorReportData): string {
  if (data.traffic_sources.length === 0) return 'No channel data available';
  const ranked = [...data.traffic_sources]
    .map((item) => ({
      label: item.source_medium !== 'unknown' ? `${item.traffic_source} / ${item.source_medium}` : item.traffic_source,
      score: item.conversions * 1000 + item.sessions,
    }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.label ?? 'No channel data available';
}

function sectionSourceLabel(recommendation: BehaviorRecommendation): string {
  if (recommendation.linked_insight === 'drop_off') return 'Lead Leakage';
  if (recommendation.linked_insight === 'funnel') return 'Conversion Diagnosis';
  if (recommendation.linked_insight === 'traffic_quality') return 'Lead Sources';
  return 'Content Intelligence';
}

function recommendationExpectedImpact(recommendation: BehaviorRecommendation): string {
  if (recommendation.type === 'ux_fix' || recommendation.type === 'messaging_fix') {
    return 'increase early-stage engagement';
  }
  if (recommendation.type === 'conversion_optimization' || recommendation.type === 'cta_optimization') {
    return 'increase conversion rate';
  }
  if (recommendation.type === 'traffic_alignment') {
    return 'improve lead quality from existing channels';
  }
  return 'increase page engagement and intent';
}

function biggestDropOffLabel(data: BehaviorReportData): string {
  const topDrop = data.drop_off_pages[0];
  if (!topDrop) return 'No major drop-off identified';
  return `${topDrop.page_url} (${Math.round(topDrop.drop_off_rate * 100)}%)`;
}

function oneLineDiagnosis(data: BehaviorReportData): string {
  const highDrop = data.drop_off_pages[0];
  const funnelEngagementDrop = data.funnel.steps.find((step) => step.step === 'engagement')?.drop_pct ?? 0;
  const funnelConversionDrop = data.funnel.steps.find((step) => step.step === 'conversion')?.drop_pct ?? 0;

  if (highDrop && highDrop.drop_off_rate > 0.6) {
    return `Lead leakage is concentrated on ${highDrop.page_url}, where users leave before progressing.`;
  }
  if (funnelEngagementDrop > 0.4) {
    return 'Visitors are arriving, but too few are engaging after the first landing step.';
  }
  if (funnelConversionDrop > 0.7) {
    return 'Users engage with the experience, but conversion friction is blocking lead capture.';
  }
  return 'Lead generation has measurable traction, but there is still room to improve conversion efficiency.';
}

function inferPlatformFit(data: PerformanceReportMappedData['sources']) {
  if (data.length === 0) {
    return {
      best_platform: 'No platform data available',
      underutilized: 'No platform data available',
      waste_channel: 'No platform data available',
      decision_summary: 'Channel efficiency cannot be ranked yet because platform-level analytics are still sparse.',
      why_this_matters: 'Platform fit shows where lead generation scales efficiently and where spend or effort is being wasted.',
      platforms: [],
    };
  }

  const avgConversionRate = safeDiv(
    data.reduce((sum, item) => sum + item.conversion_rate, 0),
    data.length,
  );
  const avgEngagementRate = safeDiv(
    data.reduce((sum, item) => sum + item.engagement_rate, 0),
    data.length,
  );

  const byRate = [...data].sort((a, b) => b.conversion_rate - a.conversion_rate || b.leads - a.leads);
  const byVolume = [...data].sort((a, b) => b.sessions - a.sessions);
  const platforms = data.map((item) => {
    const highVolume = item.sessions >= (byVolume[0]?.sessions ?? 0) * 0.6;
    const strongConversion = item.conversion_rate >= Math.max(avgConversionRate, 0.04);
    const strongEngagement = item.engagement_rate >= Math.max(avgEngagementRate, 1);

    let decision: 'scale' | 'fix' | 'reduce' = 'fix';
    let reason = 'This channel has mixed performance and needs message-to-offer refinement.';

    if (strongConversion && strongEngagement) {
      decision = 'scale';
      reason = 'This channel shows strong engagement and converts efficiently relative to the rest of the mix.';
    } else if (highVolume && !strongConversion) {
      decision = 'reduce';
      reason = 'This channel brings volume, but conversion efficiency is weak and is likely diluting lead quality.';
    } else {
      decision = 'fix';
      reason = 'This channel is generating signal, but conversion or engagement still needs tuning before scaling.';
    }

    return {
      platform: item.channel,
      decision,
      reason,
      sessions: item.sessions,
      leads: item.leads,
      conversion_rate: item.conversion_rate,
      engagement_rate: item.engagement_rate,
    };
  }).sort((a, b) => {
    const rank = { scale: 3, fix: 2, reduce: 1 };
    return rank[b.decision] - rank[a.decision] || b.leads - a.leads || b.sessions - a.sessions;
  });

  const bestPlatform = byRate[0];
  const underutilized = byRate.find((item) => item.sessions < (byVolume[0]?.sessions ?? 0) && item.leads > 0) ?? byRate[0];
  const wasteChannel = [...data].sort((a, b) => {
    const aWaste = a.sessions - a.leads * 10;
    const bWaste = b.sessions - b.leads * 10;
    return bWaste - aWaste;
  })[0];

  return {
    best_platform: bestPlatform?.channel ?? 'No platform data available',
    underutilized: underutilized?.channel ?? 'No platform data available',
    waste_channel: wasteChannel?.channel ?? 'No platform data available',
    decision_summary: platforms.some((item) => item.decision === 'scale')
      ? `${platforms.find((item) => item.decision === 'scale')?.platform ?? 'One channel'} should be scaled, while weaker channels need tighter lead-quality control.`
      : 'No channel is clearly earning more budget yet, so the current mix needs optimization before scaling.',
    why_this_matters: 'Platform fit helps redirect budget and effort toward channels that produce engaged, convertible demand.',
    platforms,
  };
}

function inferMaturity(data: BehaviorReportData): PerformanceReportMappedData['maturity'] {
  const readinessSignals: string[] = [];
  if (data.traffic_sources.length > 0) readinessSignals.push('Traffic sources are measurable');
  if (data.funnel.steps.some((step) => step.users > 0)) readinessSignals.push('Funnel steps are visible');
  if (data.conversions.total_conversions > 0) readinessSignals.push('Conversion events are tracked');
  if (data.recommendations.length > 0) readinessSignals.push('Actionable recommendations are generated');

  let stage: PerformanceReportMappedData['maturity']['stage'] = 'observing';
  if (data.traffic_sources.length > 0 && data.funnel.steps.length > 0) stage = 'measuring';
  if (data.conversions.total_conversions > 0 && data.insights.length > 0) stage = 'optimizing';
  if (data.recommendations.filter((item) => item.priority === 'high').length >= 3 && data.conversions.total_conversions > 5) stage = 'scaling';

  return {
    stage,
    readiness_signals: readinessSignals,
    decision_summary: stage === 'scaling'
      ? 'The growth system is moving beyond observation and has enough signal to scale proven motions.'
      : `The growth system is currently in the ${stage} stage and still needs stronger operating discipline before scale.`,
    why_this_matters: 'Maturity determines whether the next move should be instrumentation, optimization, or acceleration.',
  };
}

function buildLeakageSummary(data: BehaviorReportData): {
  decision_summary: string;
  why_this_matters: string;
} {
  const topDrop = data.drop_off_pages[0];
  const engagementStep = data.funnel.steps.find((step) => step.step === 'engagement');

  if (topDrop && topDrop.drop_off_rate > 0.6) {
    return {
      decision_summary: `Most users are leaving on ${topDrop.page_url} before they move deeper into the journey.`,
      why_this_matters: 'Reducing early leakage preserves the demand you already paid or worked to acquire.',
    };
  }

  if ((engagementStep?.drop_pct ?? 0) > 0.4) {
    return {
      decision_summary: 'Top-of-funnel messaging is not carrying enough visitors into active engagement.',
      why_this_matters: 'Better early-stage relevance improves the number of sessions that become qualified opportunities.',
    };
  }

  return {
    decision_summary: 'The funnel is holding reasonably well at the top, with only localized leakage to address.',
    why_this_matters: 'Stable leakage means conversion effort can shift from patching exits to improving downstream efficiency.',
  };
}

function buildContentSummary(
  topConvertingPages: PerformanceReportMappedData['content']['top_converting_pages'],
  highTrafficLowConversionPages: PerformanceReportMappedData['content']['high_traffic_low_conversion_pages'],
): { decision_summary: string; why_this_matters: string } {
  if (highTrafficLowConversionPages.length > 0) {
    return {
      decision_summary: `Traffic is reaching ${highTrafficLowConversionPages[0]?.page_url ?? 'key pages'}, but the page experience is not turning enough of that attention into leads.`,
      why_this_matters: 'Improving converting content compounds value from existing traffic before more spend is added.',
    };
  }

  if (topConvertingPages.length > 0) {
    return {
      decision_summary: `Pages like ${topConvertingPages[0]?.page_url ?? 'your strongest assets'} are already proving what content converts, so similar patterns should be extended.`,
      why_this_matters: 'Knowing which pages convert best helps replicate winning message and CTA patterns across the site.',
    };
  }

  return {
    decision_summary: 'Content performance signal is still limited, so page-level lead intelligence is early.',
    why_this_matters: 'Without page-level winners and losers, it is hard to prioritize which content should be improved first.',
  };
}

function buildDiagnosisSummary(
  frictionPoints: string[],
  messagingIssues: string[],
  ctaGaps: string[],
): { decision_summary: string; why_this_matters: string } {
  if (ctaGaps.length > 0) {
    return {
      decision_summary: 'The strongest conversion blockers are appearing late in the journey, where users need a clearer or easier next step.',
      why_this_matters: 'Fixing CTA and form friction improves how many engaged visitors actually become leads.',
    };
  }

  if (messagingIssues.length > 0) {
    return {
      decision_summary: 'Message-to-intent alignment is weak, so visitors are not seeing enough relevance after they land.',
      why_this_matters: 'Sharper messaging reduces bounce risk and increases the share of traffic that becomes pipeline.',
    };
  }

  if (frictionPoints.length > 0) {
    return {
      decision_summary: 'Conversion friction is present, but concentrated enough that a few targeted fixes can move performance.',
      why_this_matters: 'Targeted diagnosis prevents teams from making broad changes when only a few points are actually leaking demand.',
    };
  }

  return {
    decision_summary: 'No major conversion blockers stand out yet, so improvement should focus on amplification rather than repair.',
    why_this_matters: 'When friction is low, the best gains usually come from scaling proven pages and channels.',
  };
}

function classifyCampaignItem(
  item: PerformanceCampaignItem,
  data: BehaviorReportData,
): PerformanceReportMappedData['campaigns']['items'][number] {
  const normalizedStatus = item.status.trim().toLowerCase();
  const updatedAt = item.updated_at ? new Date(item.updated_at).getTime() : 0;
  const daysSinceUpdate = updatedAt > 0 ? (Date.now() - updatedAt) / 86400000 : Number.POSITIVE_INFINITY;

  if (!item.name || normalizedStatus === 'draft' || normalizedStatus === 'paused' || daysSinceUpdate > 45) {
    return {
      ...item,
      classification: 'inactive_or_missing',
      reason: 'This campaign is inactive or stale, so it is unlikely to be contributing meaningfully to current lead flow.',
    };
  }

  if (data.conversions.total_conversions > 0 && data.session_metrics.conversion_rate >= 0.05) {
    return {
      ...item,
      classification: 'effective',
      reason: 'Campaign activity is present while the overall lead system is converting, so this campaign is likely supporting demand capture.',
    };
  }

  return {
    ...item,
    classification: 'engaging_but_not_converting',
    reason: 'Campaign activity exists, but conversion yield is weak, so traffic and landing experience are likely misaligned.',
  };
}

function buildCampaignSummary(
  items: PerformanceReportMappedData['campaigns']['items'],
): { decision_summary: string; why_this_matters: string; effectiveness_summary: string } {
  if (items.length === 0) {
    return {
      decision_summary: 'Campaign activity is missing or disconnected, so lead-generation performance cannot yet be tied back to active growth programs.',
      why_this_matters: 'Without campaign-to-outcome visibility, budget decisions stay reactive and hard to defend.',
      effectiveness_summary: 'Campaign effectiveness data is not connected yet.',
    };
  }

  const effective = items.filter((item) => item.classification === 'effective').length;
  const weak = items.filter((item) => item.classification === 'engaging_but_not_converting').length;

  if (weak > 0 && effective === 0) {
    return {
      decision_summary: 'Campaign activity exists but is not aligned with the pages and flows that convert.',
      why_this_matters: 'Campaign dollars create growth only when they reach traffic that progresses into lead capture.',
      effectiveness_summary: `${weak} active campaign${weak === 1 ? '' : 's'} need tighter conversion alignment.`,
    };
  }

  if (effective > 0) {
    return {
      decision_summary: 'Some campaign activity is supporting lead generation, but only a subset appears strong enough to scale confidently.',
      why_this_matters: 'Finding which campaigns truly support conversions helps reallocate effort toward productive demand creation.',
      effectiveness_summary: `${effective} campaign${effective === 1 ? '' : 's'} appear effective, with the rest needing refinement or reactivation.`,
    };
  }

  return {
    decision_summary: 'Campaign coverage exists, but most records are inactive or too stale to influence current lead growth.',
    why_this_matters: 'An inactive campaign layer leaves the business dependent on passive acquisition instead of directed demand generation.',
    effectiveness_summary: `${items.length} campaign record${items.length === 1 ? '' : 's'} found, but recent performance signal is limited.`,
  };
}

function classifyEngagement(
  consumed: number,
  acted: number,
  pending: number,
  marketpulseUsage: string,
): PerformanceReportMappedData['engagement'] {
  const followThroughRate = safeDiv(acted, consumed || 0);
  let stage: PerformanceReportMappedData['engagement']['stage'] = 'observing';

  if (acted >= 5 && followThroughRate >= 0.6) {
    stage = 'scaling';
  } else if (acted >= 2) {
    stage = 'executing';
  } else if (pending > 0 || consumed > 0) {
    stage = 'experimenting';
  }

  let decisionSummary = 'Insight consumption is limited, so the system is still mostly observing rather than improving behavior.';
  if (consumed > 0 && acted === 0) {
    decisionSummary = 'You are consuming insights but not acting on them yet.';
  } else if (acted > 0 && acted < consumed) {
    decisionSummary = 'You are starting to act on insights, but follow-through is not strong enough to compound results.';
  } else if (acted >= consumed && acted > 0) {
    decisionSummary = 'The team is consistently acting on intelligence, which strengthens the feedback loop from insight to execution.';
  }

  return {
    marketpulse_usage: marketpulseUsage,
    insights_consumed: consumed,
    insights_acted: acted,
    stage,
    decision_summary: decisionSummary,
    why_this_matters: 'Engagement intelligence only improves growth when insights turn into real changes in campaigns, pages, or follow-up.',
  };
}

function buildLeadActivation(
  leadsCaptured: number,
  leadsActedUpon: number,
): PerformanceReportMappedData['lead_activation'] {
  const followUpGap = Math.max(0, leadsCaptured - leadsActedUpon);
  const followUpRate = Number(safeDiv(leadsActedUpon, leadsCaptured).toFixed(4));

  let decisionSummary = 'Lead capture is modest, and follow-up activity is still too limited to validate activation efficiency.';
  if (leadsCaptured > 0 && leadsActedUpon === 0) {
    decisionSummary = 'Leads are being generated but not actively pursued after capture.';
  } else if (followUpGap > 0) {
    decisionSummary = 'Lead generation is outpacing follow-up, so captured demand is at risk of going cold.';
  } else if (leadsCaptured > 0) {
    decisionSummary = 'Lead capture and follow-up are moving in step, which supports faster conversion learning.';
  }

  return {
    leads_captured: leadsCaptured,
    leads_acted_upon: leadsActedUpon,
    follow_up_gap: followUpGap,
    follow_up_rate: followUpRate,
    engagement_capture_gap: followUpGap,
    decision_summary: decisionSummary,
    why_this_matters: 'Lead activation determines whether captured demand becomes pipeline or simply sits unworked.',
  };
}

export function mapPerformanceReportData(
  data: BehaviorReportData,
  context?: PerformanceMapperContext,
): PerformanceReportMappedData {
  const rankedRecommendations = rankRecommendations(data.recommendations);
  const sourceRows = data.traffic_sources.map((item) => ({
    channel: item.source_medium !== 'unknown' ? `${item.traffic_source} / ${item.source_medium}` : item.traffic_source,
    sessions: item.sessions,
    events: item.events,
    leads: item.conversions,
    conversion_rate: Number(safeDiv(item.conversions, item.sessions).toFixed(4)),
    engagement_rate: Number(safeDiv(item.events, item.sessions).toFixed(2)),
  })).sort((a, b) => b.leads - a.leads || b.sessions - a.sessions);

  const topConvertingPages = [...data.top_pages]
    .map((item) => ({
      page_url: item.page_url,
      conversions: item.conversions,
      visits: item.visits,
      conversion_rate: Number(safeDiv(item.conversions, item.visits).toFixed(4)),
    }))
    .sort((a, b) => b.conversions - a.conversions || b.conversion_rate - a.conversion_rate)
    .slice(0, 5);

  const highTrafficLowConversionPages = [...data.top_pages]
    .map((item) => ({
      page_url: item.page_url,
      visits: item.visits,
      conversions: item.conversions,
      conversion_rate: Number(safeDiv(item.conversions, item.visits).toFixed(4)),
    }))
    .filter((item) => item.visits >= 10)
    .sort((a, b) => (b.visits - a.visits) || (a.conversion_rate - b.conversion_rate))
    .slice(0, 5);

  const frictionPoints = data.insights
    .filter((item) => item.type === 'drop_off' || item.type === 'funnel')
    .map((item) => item.message);
  const messagingIssues = data.recommendations
    .filter((item) => item.type === 'messaging_fix' || item.type === 'content_optimization')
    .map((item) => item.reasoning);
  const ctaGaps = data.recommendations
    .filter((item) => item.type === 'cta_optimization' || item.type === 'conversion_optimization')
    .map((item) => item.reasoning);
  const leakageSummary = buildLeakageSummary(data);
  const contentSummary = buildContentSummary(topConvertingPages, highTrafficLowConversionPages);
  const diagnosisSummary = buildDiagnosisSummary(frictionPoints, messagingIssues, ctaGaps);
  const platformFit = inferPlatformFit(sourceRows);
  const campaignItems = (context?.campaigns ?? []).map((item) => classifyCampaignItem(item, data));
  const campaignSummary = buildCampaignSummary(campaignItems);
  const engagement = classifyEngagement(
    data.insights.length,
    context?.engagement?.recommendations_implemented ?? 0,
    context?.engagement?.recommendations_pending ?? 0,
    context?.engagement?.marketpulse_usage_summary ?? 'MarketPulse usage data is not connected yet.',
  );
  const leadActivation = buildLeadActivation(
    data.conversions.total_conversions,
    context?.engagement?.recommendations_implemented ?? 0,
  );
  const nextMoves = rankedRecommendations.slice(0, 5).map((item) => ({
    action: item.message,
    impact: recommendationExpectedImpact(item),
    effort: item.effort_level,
    source: sectionSourceLabel(item),
    priority: item.priority,
  }));
  const focusThisWeek = rankedRecommendations
    .filter((item) => item.priority === 'high')
    .sort((a, b) => {
      const impactDelta = impactEstimateRank(b.impact_estimate) - impactEstimateRank(a.impact_estimate);
      if (impactDelta !== 0) return impactDelta;
      const effortDelta = effortRank(a.effort_level) - effortRank(b.effort_level);
      if (effortDelta !== 0) return effortDelta;
      return recommendationImpactWeight(b) - recommendationImpactWeight(a);
    })
    .slice(0, 5)
    .map((item) => ({
      action: item.message,
      impact: item.impact_estimate,
      effort: item.effort_level,
      source: sectionSourceLabel(item),
    }));

  const mapped: PerformanceReportMappedData = {
    lead_summary: {
      total_leads: data.conversions.total_conversions,
      conversion_rate: data.session_metrics.conversion_rate,
      best_channel: bestChannelLabel(data),
      biggest_drop_off: biggestDropOffLabel(data),
      diagnosis: oneLineDiagnosis(data),
      decision_summary: oneLineDiagnosis(data),
      why_this_matters: 'This summary shows where lead generation is strongest and where the current journey is losing qualified demand.',
    },
    leakage: {
      funnel_steps: data.funnel.steps,
      top_drop_off_pages: data.drop_off_pages.slice(0, 5),
      ...leakageSummary,
    },
    sources: sourceRows,
    platform_fit: platformFit,
    content: {
      top_converting_pages: topConvertingPages,
      high_traffic_low_conversion_pages: highTrafficLowConversionPages,
      ...contentSummary,
    },
    diagnosis: {
      friction_points: frictionPoints,
      messaging_issues: messagingIssues,
      cta_gaps: ctaGaps,
      ...diagnosisSummary,
    },
    actions: {
      quick_wins: rankedRecommendations.filter((item) => item.priority === 'high').slice(0, 3),
      growth_levers: rankedRecommendations.filter((item) => item.priority === 'medium').slice(0, 3),
      strategic_bets: rankedRecommendations.filter((item) => item.priority === 'low').slice(0, 3),
      decision_summary: rankedRecommendations.length > 0
        ? 'The action plan is clear: fix immediate leakage first, then scale channels and pages that already show conversion signal.'
        : 'There are not enough prioritized actions yet to build a confident execution plan.',
      why_this_matters: 'A strong plan turns analytics into sequenced work instead of disconnected observations.',
    },
    campaigns: {
      total_campaigns: campaignItems.length,
      effectiveness_summary: campaignSummary.effectiveness_summary,
      decision_summary: campaignSummary.decision_summary,
      why_this_matters: campaignSummary.why_this_matters,
      items: campaignItems,
    },
    engagement,
    lead_activation: leadActivation,
    maturity: inferMaturity(data),
    next_moves: nextMoves,
    focus_this_week: focusThisWeek,
  };

  return mapped;
}
