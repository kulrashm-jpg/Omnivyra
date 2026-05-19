import {
  INTELLIGENCE_OBJECTIVE_LABELS,
  TARGET_METRIC_LABELS,
  TIME_HORIZON_LABELS,
  GOAL_LABELS,
  HEALTH_CFG,
  KNOWLEDGE_GRAPH_LABELS,
  REPORT_READINESS_LABELS,
} from './constants';
import {
  toSentenceCase,
  parseTargetNumber,
  formatPlatformLabel,
  formatContentTypeLabel,
  formatCampaignPathLabel,
  formatReportTypeLabel,
} from './hooks/viewModel.helpers';
import { deriveSystemActionLines } from './actionLines';
import type { Snapshot, DerivedInsight, NextAction } from './types';

export function getIntelligenceObjectiveLabel(snapshot: Snapshot) {
  const objective = snapshot.intelligence_settings?.objective;
  if (!objective) return 'Operating intelligence';
  return INTELLIGENCE_OBJECTIVE_LABELS[objective] ?? toSentenceCase(objective) ?? 'Operating intelligence';
}

export function getTargetMetricLabel(snapshot: Snapshot) {
  const targetMetric = snapshot.intelligence_settings?.target_metric;
  if (!targetMetric) return null;
  return TARGET_METRIC_LABELS[targetMetric] ?? targetMetric.replace(/_/g, ' ');
}

export function toneClasses(tone: DerivedInsight['tone']) {
  if (tone === 'strong') {
    return {
      badge: 'bg-emerald-100 text-emerald-800 border-emerald-300',
      text: 'text-emerald-700',
    };
  }
  if (tone === 'watch') {
    return {
      badge: 'bg-amber-100 text-amber-800 border-amber-300',
      text: 'text-amber-700',
    };
  }
  return {
    badge: 'bg-blue-100 text-blue-800 border-blue-300',
    text: 'text-blue-700',
  };
}

export function deriveTargetTracking(snapshot: Snapshot) {
  const { intelligence_settings, lead_summary, system_snapshot, content_summary } = snapshot;
  const targetNumber = parseTargetNumber(intelligence_settings?.target_value);
  const metricLabel = getTargetMetricLabel(snapshot);
  const horizonLabel = intelligence_settings?.time_horizon
    ? TIME_HORIZON_LABELS[intelligence_settings.time_horizon]
    : null;

  const currentValue =
    intelligence_settings?.target_metric === 'qualified_leads'
      ? lead_summary.qualified_active_leads
      : intelligence_settings?.target_metric === 'active_leads'
        ? lead_summary.active_leads
        : intelligence_settings?.target_metric === 'campaigns_ready_to_scale'
          ? system_snapshot.campaigns_ready_to_scale
          : intelligence_settings?.target_metric === 'content_velocity'
            ? content_summary.recent_blogs
            : null;

  const progressRatio =
    targetNumber && currentValue != null && targetNumber > 0 ? currentValue / targetNumber : null;

  return {
    targetNumber,
    currentValue,
    progressRatio,
    metricLabel,
    horizonLabel,
  };
}

export function deriveTargetPotential(snapshot: Snapshot) {
  const { system_snapshot: ss, strategic_intelligence, audience_response, lead_summary, intelligence_settings, timing_summary } = snapshot;
  const topMetric = audience_response.metric_rankings[0];
  const weakestMetric = audience_response.metric_rankings[audience_response.metric_rankings.length - 1];
  const objectiveLabel = getIntelligenceObjectiveLabel(snapshot);
  const metricLabel = getTargetMetricLabel(snapshot);
  const targetValue = intelligence_settings?.target_value ?? null;
  const targetNumber = parseTargetNumber(targetValue);
  const currentValue =
    intelligence_settings?.target_metric === 'qualified_leads'
      ? lead_summary.qualified_active_leads
      : intelligence_settings?.target_metric === 'active_leads'
        ? lead_summary.active_leads
        : intelligence_settings?.target_metric === 'campaigns_ready_to_scale'
          ? ss.campaigns_ready_to_scale
          : intelligence_settings?.target_metric === 'content_velocity'
            ? snapshot.content_summary.recent_blogs
            : null;
  const progressRatio =
    targetNumber && currentValue != null && targetNumber > 0 ? currentValue / targetNumber : null;
  const targetGap =
    targetNumber && currentValue != null && targetNumber > 0
      ? Math.max(targetNumber - currentValue, 0)
      : null;
  const upsideDriver =
    ss.campaigns_ready_to_scale > 0
      ? `${ss.campaigns_ready_to_scale} high-performing campaign${ss.campaigns_ready_to_scale === 1 ? '' : 's'} can be scaled harder`
      : strategic_intelligence.best_performing_goal
        ? `${GOAL_LABELS[strategic_intelligence.best_performing_goal] ?? strategic_intelligence.best_performing_goal} is the strongest goal pattern so far`
        : 'The current system still needs more evidence before pushing harder';
  const hasUpsideSignal =
    ss.campaigns_ready_to_scale > 0 || lead_summary.qualified_active_leads > 0 || (topMetric && topMetric.avg_pct_of_target >= 95);
  const targetState =
    !intelligence_settings?.target_metric && !targetValue
      ? 'missing'
      : targetNumber == null
        ? 'soft'
        : progressRatio != null && progressRatio >= 1 && hasUpsideSignal
          ? 'under_ambitious'
          : 'hard';
  const targetStateLabel =
    targetState === 'missing'
      ? 'No explicit target'
      : targetState === 'soft'
        ? 'Soft target'
        : targetState === 'under_ambitious'
          ? 'Target likely too low'
          : 'Hard target';
  const targetStateDetail =
    targetState === 'missing'
      ? 'The company has not set a measurable operating target yet, so the page can judge direction but not true attainment.'
      : targetState === 'soft'
        ? 'The company has declared an objective and metric, but the target is still too loose to measure real attainment cleanly.'
        : targetState === 'under_ambitious'
          ? 'The declared target is already being met, and current signal quality suggests the real ceiling is higher if the next motion is activated now.'
          : 'The target is specific enough for the page to judge present attainment, shortfall, and upside against a real benchmark.';

  return {
    objectiveLabel,
    targetState,
    targetStateLabel,
    targetStateDetail,
    targetLabel: metricLabel && targetValue
      ? `${targetValue} ${metricLabel} ${intelligence_settings?.time_horizon ? `this ${TIME_HORIZON_LABELS[intelligence_settings.time_horizon]}` : ''}`.trim()
      : metricLabel
        ? `${metricLabel} ${intelligence_settings?.time_horizon ? `this ${TIME_HORIZON_LABELS[intelligence_settings.time_horizon]}` : ''}`.trim()
        : null,
    currentPace: progressRatio != null
      ? progressRatio >= 1
        ? 'Ahead of target'
        : progressRatio >= 0.6
          ? 'On track'
          : 'Behind target'
      : ss.health === 'strong'
        ? 'Above baseline'
        : ss.health === 'moderate'
          ? 'On baseline'
          : 'Below baseline',
    currentProgress: progressRatio != null && currentValue != null && targetValue
      ? `${Math.round(progressRatio * 100)}% of target reached`
      : null,
    currentDetail:
      progressRatio != null && currentValue != null && metricLabel
        ? `Current delivery is at ${currentValue} of ${targetValue} ${metricLabel}, which is the clearest present-state read for ${objectiveLabel.toLowerCase()}.`
        : ss.health === 'strong'
          ? 'Current activity is creating enough signal to support stronger commercial moves.'
          : ss.health === 'moderate'
            ? 'The system is moving, but it still needs tighter execution to create consistent upside.'
            : 'Current momentum is not strong enough yet to justify aggressive scaling.',
    potential:
      targetState === 'under_ambitious'
        ? 'Target can be surpassed'
        : hasUpsideSignal
          ? 'Upside available'
          : 'Limited upside',
    potentialDetail: lead_summary.qualified_active_leads > 0
      ? `${lead_summary.qualified_active_leads} qualified lead${lead_summary.qualified_active_leads === 1 ? '' : 's'} can be moved into a stronger conversion motion now`
      : upsideDriver,
    targetNote: intelligence_settings?.target_note ?? null,
    targetGap,
    upsideProjection:
      targetState === 'missing'
        ? 'Set a measurable target so the page can judge whether current momentum is enough for the declared objective.'
        : targetState === 'soft'
          ? 'Tighten the target value so the page can tell the difference between healthy momentum and true attainment.'
        : targetNumber && currentValue != null && metricLabel
        ? progressRatio != null && progressRatio >= 1 && (ss.campaigns_ready_to_scale > 0 || lead_summary.qualified_active_leads > 0)
          ? `Current signals suggest the team can exceed the declared target if the next motion is activated quickly.`
          : progressRatio != null && progressRatio >= 0.6 && targetGap != null
            ? `${targetGap} more ${metricLabel} would close the current target, and current upside suggests the ceiling may be higher than that.`
            : progressRatio != null && targetGap != null
              ? `${targetGap} more ${metricLabel} are still needed, so execution has to tighten before upside becomes realistic.`
              : null
        : null,
    delayCost:
      targetState === 'under_ambitious'
        ? 'If the target is not revised upward soon, the team may under-activate a bigger opportunity that is already visible.'
        : progressRatio != null && progressRatio >= 0.6 && (ss.campaigns_ready_to_scale > 0 || lead_summary.qualified_active_leads > 0)
        ? 'If the next motion is delayed, warm demand may cool off and the current upside window will narrow.'
        : timing_summary.rhythm_state === 'thin'
          ? 'If the operating rhythm stays thin, even good ideas will keep arriving too slowly to compound into reliable traction.'
        : weakestMetric && weakestMetric.avg_pct_of_target < 85
          ? `If ${weakestMetric.label.toLowerCase()} is not fixed soon, the system will keep creating activity without converting enough of it into the target outcome.`
          : 'If nothing changes, the system is likely to plateau before it captures the full upside available.',
    risk:
      timing_summary.rhythm_state === 'thin'
        ? `The current rhythm is too light for ${objectiveLabel.toLowerCase()} and will likely delay target attainment even if individual signals look promising.`
        : weakestMetric && weakestMetric.avg_pct_of_target < 85
        ? `${weakestMetric.label} remains the main drag. If it is not corrected, growth will flatten even if top signals look healthy.`
        : ss.status_distribution.underperformed > 0
          ? `${ss.status_distribution.underperformed} campaign${ss.status_distribution.underperformed === 1 ? '' : 's'} are dragging the portfolio and could slow overall progress if left unchanged.`
          : 'No major drag is visible yet, but the portfolio still needs more operating depth to avoid plateauing.',
  };
}

export function computeEnhancedPriority(action: NextAction): {
  priority: 'high' | 'medium' | 'low';
  label: string;
  dot: string;
  text: string;
} {
  let urgency = 0;

  // Action base (pivot = most urgent, continue = least)
  if (action.action === 'pivot')    urgency += 3;
  else if (action.action === 'optimize') urgency += 2;
  else urgency += 1;

  // Stability risk (volatile decision = more urgent)
  if (action.stability_signal === 'volatile')  urgency += 2;
  else if (action.stability_signal === 'sensitive') urgency += 1;

  // Low confidence = more urgent to resolve
  if (action.decision_confidence_level === 'low') urgency += 1;

  // Performance gap
  const score = action.evaluation_score ?? 70;
  if (score < 45) urgency += 2;
  else if (score < 60) urgency += 1;

  if (urgency >= 6) return { priority: 'high',   label: 'High priority', dot: 'bg-red-400',     text: 'text-red-600'     };
  if (urgency >= 3) return { priority: 'medium',  label: 'Watch',         dot: 'bg-amber-400',   text: 'text-amber-600'   };
  return               { priority: 'low',    label: 'Opportunity',   dot: 'bg-emerald-400', text: 'text-emerald-600' };
}

export function deriveOperatingOverview(snapshot: Snapshot): Array<{ label: string; value: string; helper: string; tone: DerivedInsight['tone'] }> {
  const { system_snapshot: ss, audience_response, strategic_memory, knowledge_graph_summary, lead_summary, reports_summary, intelligence_settings, timing_summary } = snapshot;
  const objectiveLabel = getIntelligenceObjectiveLabel(snapshot);
  const horizonLabel = intelligence_settings?.time_horizon ? TIME_HORIZON_LABELS[intelligence_settings.time_horizon] : 'monthly';
  const momentumTone: DerivedInsight['tone'] =
    ss.trend_signal === 'improving' ? 'strong' :
    ss.trend_signal === 'declining' ? 'watch' : 'moderate';
  const readinessTone: DerivedInsight['tone'] =
    ss.campaigns_ready_to_scale > 0 ? 'strong' :
    ss.status_distribution.underperformed > 0 ? 'watch' : 'moderate';
  const confidenceTone: DerivedInsight['tone'] =
    ss.evaluated_campaigns >= 6 ? 'strong' :
    ss.evaluated_campaigns >= 3 ? 'moderate' : 'watch';
  const graphTone: DerivedInsight['tone'] =
    strategic_memory.campaigns_analyzed >= 5 && strategic_memory.dominant_topic_cluster ? 'strong' :
    strategic_memory.campaigns_analyzed >= 2 ? 'moderate' : 'watch';
  const rhythmTone: DerivedInsight['tone'] =
    timing_summary.rhythm_state === 'strong' ? 'strong' :
    timing_summary.rhythm_state === 'steady' ? 'moderate' : 'watch';

  return [
    {
      label: 'Current state',
      value: HEALTH_CFG[ss.health].label,
      helper: `${ss.avg_score}/100 average across evaluated activity for ${objectiveLabel.toLowerCase()}`,
      tone: ss.health === 'strong' ? 'strong' : ss.health === 'weak' ? 'watch' : 'moderate',
    },
    {
      label: 'Momentum',
      value: ss.trend_signal ? ss.trend_signal[0].toUpperCase() + ss.trend_signal.slice(1) : 'Stable',
      helper: audience_response.engagement_trend ?? `No clear ${horizonLabel} shift is visible yet`,
      tone: momentumTone,
    },
    {
      label: 'Commercial readiness',
      value: lead_summary.qualified_active_leads > 0 || ss.campaigns_ready_to_scale > 0 ? 'Ready' : lead_summary.active_leads > 0 || ss.status_distribution.met > 0 ? 'Emerging' : 'Early',
      helper: lead_summary.qualified_active_leads > 0
        ? `${lead_summary.qualified_active_leads} qualified lead${lead_summary.qualified_active_leads === 1 ? '' : 's'} already support a stronger next motion`
        : ss.campaigns_ready_to_scale > 0
          ? `${ss.campaigns_ready_to_scale} campaign${ss.campaigns_ready_to_scale === 1 ? '' : 's'} can support a stronger next motion`
          : 'Signals still need stronger proof before full escalation',
      tone: readinessTone,
    },
    {
      label: 'Operating rhythm',
      value: timing_summary.rhythm_state === 'strong' ? 'Strong' : timing_summary.rhythm_state === 'steady' ? 'Steady' : 'Thin',
      helper: timing_summary.active_days > 0
        ? `${timing_summary.active_days} active day${timing_summary.active_days === 1 ? '' : 's'} in the last ${snapshot.time_range_days} days${timing_summary.avg_gap_days != null ? ` with an average ${timing_summary.avg_gap_days}-day gap between visible content or distribution events` : ''}`
        : `No meaningful content or distribution rhythm is visible in the last ${snapshot.time_range_days} days`,
      tone: rhythmTone,
    },
    {
      label: 'Evidence confidence',
      value: ss.evaluated_campaigns >= 6 ? 'Strong' : ss.evaluated_campaigns >= 3 ? 'Moderate' : 'Early',
      helper: reports_summary.total_reports > 0
        ? `Built from ${ss.evaluated_campaigns} evaluated campaign${ss.evaluated_campaigns === 1 ? '' : 's'} plus ${reports_summary.total_reports} report${reports_summary.total_reports === 1 ? '' : 's'} in the last ${snapshot.time_range_days} days`
        : `Built from ${ss.evaluated_campaigns} evaluated campaign${ss.evaluated_campaigns === 1 ? '' : 's'} in the last ${snapshot.time_range_days} days`,
      tone: confidenceTone,
    },
    {
      label: 'Knowledge graph',
      value: KNOWLEDGE_GRAPH_LABELS[knowledge_graph_summary.status],
      helper: knowledge_graph_summary.dominant_cluster
        ? `${knowledge_graph_summary.dominant_cluster} is the strongest cluster, with ${knowledge_graph_summary.supporting_cluster_count} supporting cluster${knowledge_graph_summary.supporting_cluster_count === 1 ? '' : 's'} and ${knowledge_graph_summary.format_diversity} active format${knowledge_graph_summary.format_diversity === 1 ? '' : 's'} in the graph`
        : 'Topic depth is still too thin to show a meaningful authority graph yet',
      tone: graphTone,
    },
  ];
}

export function shouldRefreshCurrentReport(snapshot: Snapshot) {
  const latestReportAgeDays = snapshot.reports_summary.latest_report_age_days;
  if (latestReportAgeDays == null || latestReportAgeDays < 90) return false;

  const tracking = deriveTargetTracking(snapshot);
  const weakestMetric = snapshot.audience_response.metric_rankings[snapshot.audience_response.metric_rankings.length - 1];
  const performanceIsWeak =
    snapshot.system_snapshot.health === 'weak' ||
    snapshot.system_snapshot.trend_signal === 'declining' ||
    snapshot.system_snapshot.status_distribution.underperformed > 0 ||
    (tracking.progressRatio != null && tracking.progressRatio < 0.6) ||
    (weakestMetric?.avg_pct_of_target ?? 100) < 85;

  return performanceIsWeak;
}

export function derivePrimaryBottleneck(snapshot: Snapshot): DerivedInsight {
  const { system_snapshot: ss, strategic_intelligence, audience_response, knowledge_graph_summary, timing_summary } = snapshot;
  const volatility = strategic_intelligence.patterns.find((p) => p.type === 'volatility');
  const weakestMetric = audience_response.metric_rankings[audience_response.metric_rankings.length - 1];

  if (timing_summary.rhythm_state === 'thin') {
    return {
      title: 'Operating rhythm is inconsistent',
      detail: 'Without steady publishing and steady distribution, performance stays noisy, channels cannot be evaluated, and scaling decisions remain weak. Fix rhythm first and everything else becomes measurable.',
      tone: 'watch',
    };
  }

  if (knowledge_graph_summary.status === 'imbalanced' && knowledge_graph_summary.weakest_stage) {
    return {
      title: `${knowledge_graph_summary.weakest_stage[0].toUpperCase() + knowledge_graph_summary.weakest_stage.slice(1)}-stage depth is the primary bottleneck`,
      detail: `The authority system is still over-weighted toward one part of the journey. Until the ${knowledge_graph_summary.weakest_stage} stage is strengthened, the graph will not carry attention forward cleanly into stronger commercial outcomes.`,
      tone: 'watch',
    };
  }

  if (volatility) {
    return {
      title: 'Strategic consistency is the primary bottleneck',
      detail: 'Campaign execution is generating activity, but the variance across results suggests the system does not yet have a repeatable playbook. Tightening the message, topic, and campaign mix is the fastest way to make scaling more dependable.',
      tone: 'watch',
    };
  }

  if (weakestMetric && weakestMetric.avg_pct_of_target < 85) {
    return {
      title: `${weakestMetric.label} is the main limiting factor right now`,
      detail: `Topline activity is not converting strongly enough through ${weakestMetric.label.toLowerCase()}. Until that link improves, adding more content or more campaigns will create more motion, but not enough additional outcome.`,
      tone: 'watch',
    };
  }

  if (ss.evaluated_campaigns < 3) {
    return {
      title: 'Evidence depth is still too thin',
      detail: 'The system needs more evaluated activity before it can make stronger future-facing recommendations. Right now, the operating job is to build cleaner signal, not force a larger commercial move too early.',
      tone: 'moderate',
    };
  }

  return {
    title: 'Portfolio depth is now the main bottleneck',
    detail: 'The system has enough signal to guide the next move, but it still depends on too few successful patterns. Broadening what is already working into adjacent formats, audiences, or campaign types is the next unlock.',
    tone: 'moderate',
  };
}
export function classifyInsightBucket(title: string): string {
  const normalized = title.toLowerCase();
  if (normalized.includes('report')) return 'report';
  if (normalized.includes('knowledge graph') || normalized.includes('authority-graph') || normalized.includes('authority cluster')) return 'knowledge_graph';
  if (normalized.includes('distribution')) return 'distribution';
  if (normalized.includes('rhythm') || normalized.includes('timing')) return 'timing';
  if (normalized.includes('commercial') || normalized.includes('lead') || normalized.includes('pipeline')) return 'commercial';
  if (normalized.includes('campaign')) return 'campaign';
  if (normalized.includes('content')) return 'content';
  if (normalized.includes('engagement')) return 'engagement';
  if (normalized.includes('audience')) return 'audience';
  if (normalized.includes('growth maturity') || normalized.includes('commercial-system')) return 'growth_maturity';
  return normalized;
}

export function insightWeight(insight: DerivedInsight): number {
  const toneWeight = insight.tone === 'strong' ? 3 : insight.tone === 'watch' ? 2 : 1;
  const bucket = classifyInsightBucket(insight.title);
  const bucketWeight =
    bucket === 'report' ? 5 :
    bucket === 'knowledge_graph' ? 4 :
    bucket === 'commercial' ? 4 :
    bucket === 'distribution' ? 3 :
    bucket === 'timing' ? 3 :
    bucket === 'content' ? 3 :
    bucket === 'campaign' ? 3 :
    bucket === 'engagement' ? 2 :
    bucket === 'audience' ? 2 :
    bucket === 'growth_maturity' ? 2 : 1;
  return bucketWeight * 10 + toneWeight;
}

export function selectTopInsights(insights: DerivedInsight[], limit: number): DerivedInsight[] {
  const chosen: DerivedInsight[] = [];
  const usedBuckets = new Set<string>();

  const sorted = [...insights].sort((left, right) => insightWeight(right) - insightWeight(left));
  for (const insight of sorted) {
    const bucket = classifyInsightBucket(insight.title);
    if (!usedBuckets.has(bucket)) {
      chosen.push(insight);
      usedBuckets.add(bucket);
    }
    if (chosen.length >= limit) return chosen;
  }

  for (const insight of sorted) {
    if (!chosen.includes(insight)) {
      chosen.push(insight);
    }
    if (chosen.length >= limit) return chosen;
  }

  return chosen;
}

export function deriveLearnedSignals(snapshot: Snapshot): DerivedInsight[] {
  const {
    strategic_intelligence,
    content_performance,
    audience_response,
    strategic_memory,
    knowledge_graph_summary,
    reports_summary,
    content_summary,
    campaign_mix_summary,
    distribution_summary,
    timing_summary,
    engagement_summary,
    lead_summary,
    market_pulse_summary,
  } = snapshot;
  const learned: DerivedInsight[] = [];
  const topicStrength = strategic_intelligence.patterns.find((p) => p.type === 'topic_strength');
  const goalAffinity = strategic_intelligence.patterns.find((p) => p.type === 'goal_affinity');
  const volatility = strategic_intelligence.patterns.find((p) => p.type === 'volatility');
  const topContent = content_performance.top[0];
  const weakestMetric = audience_response.metric_rankings[audience_response.metric_rankings.length - 1];
  const topContentType = content_summary.content_type_mix[0];
  const secondContentType = content_summary.content_type_mix[1];
  const topReportType = reports_summary.report_type_mix[0];
  const secondReportType = reports_summary.report_type_mix[1];
  const topPlatform = distribution_summary.platform_mix[0];
  const secondPlatform = distribution_summary.platform_mix[1];
  const shouldRefreshReport = shouldRefreshCurrentReport(snapshot);
  const maturityStageLabel = snapshot.report_readiness_summary.maturity_stage.replace(/_/g, ' ');
  const growthIntegrationSummary = snapshot.report_readiness_summary.growth_integration_summary;
  const growthSystemCount = Object.values(growthIntegrationSummary).filter(Boolean).length;
  const dominantCampaignPath = formatCampaignPathLabel(campaign_mix_summary.dominant_path);
  const campaignPathCounts = [
    { key: 'bolt_text', count: campaign_mix_summary.bolt_text },
    { key: 'bolt_creator', count: campaign_mix_summary.bolt_creator },
    { key: 'intelligent_mix', count: campaign_mix_summary.intelligent_mix },
    { key: 'strategy_mix', count: campaign_mix_summary.strategy_mix },
  ].filter((item) => item.count > 0).sort((left, right) => right.count - left.count);
  const secondCampaignPath = campaignPathCounts[1];

  if (topicStrength) {
    learned.push({
      title: 'Reports and campaign signals are pointing to a winning topic cluster',
      detail: topicStrength.pattern,
      tone: topicStrength.confidence === 'high' ? 'strong' : 'moderate',
    });
  }
  if (reports_summary.total_reports > 0) {
    learned.push({
      title: shouldRefreshReport ? 'The current report layer is becoming stale for present decisions' : 'Report activity is starting to shape operating clarity',
      detail: topReportType
        ? `${reports_summary.total_reports} report${reports_summary.total_reports === 1 ? '' : 's'} have been generated so far${reports_summary.latest_report_at ? `, most recently at ${new Date(reports_summary.latest_report_at).toLocaleDateString()}` : ''}. ${formatReportTypeLabel(topReportType.type)} is currently the most-used report path${secondReportType ? `, followed by ${formatReportTypeLabel(secondReportType.type)}` : ''}, which gives the system a clearer base for deciding what diagnostic depth is still missing.`
        : shouldRefreshReport && reports_summary.latest_report_age_days != null && reports_summary.latest_report_type
          ? `The latest ${formatReportTypeLabel(reports_summary.latest_report_type)} is already ${reports_summary.latest_report_age_days} days old, and current signals are not moving strongly enough to rely on it as the main diagnostic lens.`
        : `${reports_summary.total_reports} report${reports_summary.total_reports === 1 ? '' : 's'} have been generated so far${reports_summary.latest_report_at ? `, most recently at ${new Date(reports_summary.latest_report_at).toLocaleDateString()}` : ''}. That means the system has enough diagnostic input to recommend deeper execution shifts instead of generic guesses.`,
      tone: shouldRefreshReport ? 'watch' : reports_summary.total_reports >= 2 ? 'strong' : 'moderate',
    });
  }
  learned.push({
    title: 'Report readiness now depends on maturity, not only on connected tools',
    detail: `The company is currently in the ${maturityStageLabel} stage. ${REPORT_READINESS_LABELS[snapshot.report_readiness_summary.performance.state]} for Performance Intelligence and ${REPORT_READINESS_LABELS[snapshot.report_readiness_summary.growth.state]} for Market & Growth Intelligence means the next report suggestion should follow readiness and data depth, not just ambition.`,
    tone:
      snapshot.report_readiness_summary.growth.state === 'ready_now' || snapshot.report_readiness_summary.performance.state === 'ready_now'
        ? 'moderate'
        : 'watch',
  });
  if (growthSystemCount > 0) {
    learned.push({
      title: 'Growth maturity is now checking broader commercial systems too',
      detail: `${growthSystemCount} broader growth system${growthSystemCount === 1 ? '' : 's'} are currently connected across CRM, email/outreach, commerce, or event signal inputs. Market & Growth Intelligence should only become a serious next step when those systems are broad enough and have enough history behind them.`,
      tone: growthSystemCount >= 2 ? 'moderate' : 'watch',
    });
  }
  if (topContent) {
    learned.push({
      title: 'One campaign is clearly leading current content performance',
      detail: `${topContent.name} is setting the current pace with a score of ${topContent.evaluation_score ?? '—'}/100${topContent.topic_seed ? ` around ${topContent.topic_seed}` : ''}.`,
      tone: (topContent.evaluation_score ?? 0) >= 70 ? 'strong' : 'moderate',
    });
  }
  if (goalAffinity) {
    learned.push({
      title: 'The current mix is showing an objective bias',
      detail: goalAffinity.pattern,
      tone: goalAffinity.confidence === 'high' ? 'strong' : 'moderate',
    });
  }
  if (content_summary.total_blogs > 0) {
    learned.push({
      title: 'Content production is contributing real operating signal',
      detail: `${content_summary.total_blogs} blog or long-form content asset${content_summary.total_blogs === 1 ? '' : 's'} exist in the system, with ${content_summary.recent_blogs} added in the current window. That gives the page a better base for deciding whether to deepen or diversify the mix.`,
      tone: content_summary.recent_blogs > 0 ? 'strong' : 'moderate',
    });
  }
  if (topContentType) {
    learned.push({
      title: 'One content type is currently dominating the system mix',
      detail: secondContentType
        ? `${formatContentTypeLabel(topContentType.type)} leads the current content mix with ${topContentType.count} asset${topContentType.count === 1 ? '' : 's'}, followed by ${formatContentTypeLabel(secondContentType.type)} with ${secondContentType.count}. This is useful if intentional, but risky if the company needs a broader authority or demand mix.`
        : `${formatContentTypeLabel(topContentType.type)} is carrying nearly the entire content system right now. That gives clarity, but it also means the page should watch for over-dependence on one editorial shape.`,
      tone: content_summary.content_type_mix.length >= 3 ? 'moderate' : 'watch',
    });
  }
  if (campaign_mix_summary.total_versions > 0 && dominantCampaignPath) {
    learned.push({
      title: 'Campaign execution is clustering around one path',
      detail: secondCampaignPath
        ? `${dominantCampaignPath} is the most-used campaign path so far with ${campaignPathCounts[0]?.count ?? 0} run${(campaignPathCounts[0]?.count ?? 0) === 1 ? '' : 's'}, followed by ${formatCampaignPathLabel(secondCampaignPath.key)} with ${secondCampaignPath.count}. This is useful if deliberate, but it can hide upside in other execution paths.`
        : `${dominantCampaignPath} is carrying nearly the whole campaign system right now. That creates focus, but it also means the page should watch for over-reliance on one execution path.`,
      tone: campaignPathCounts.length >= 3 ? 'moderate' : 'watch',
    });
  }
  if (distribution_summary.connected_platforms > 0) {
    learned.push({
      title: 'Distribution quality is now visible, not just content output',
      detail: distribution_summary.active_platforms > 0
        ? topPlatform
          ? `${distribution_summary.published_posts} post${distribution_summary.published_posts === 1 ? '' : 's'} have been published across ${distribution_summary.active_platforms} active platform${distribution_summary.active_platforms === 1 ? '' : 's'} in the current window. ${formatPlatformLabel(topPlatform.platform)} currently carries ${topPlatform.share_pct}% of visible distribution${secondPlatform ? `, followed by ${formatPlatformLabel(secondPlatform.platform)} at ${secondPlatform.share_pct}%` : ''}, which helps the page separate weak traction caused by content from weak traction caused by channel concentration.`
          : `${distribution_summary.published_posts} post${distribution_summary.published_posts === 1 ? '' : 's'} have been published across ${distribution_summary.active_platforms} active platform${distribution_summary.active_platforms === 1 ? '' : 's'} in the current window. This helps the page separate weak traction caused by content from weak traction caused by thin distribution.`
        : `${distribution_summary.connected_platforms} social platform${distribution_summary.connected_platforms === 1 ? '' : 's'} are connected, but no meaningful active publishing breadth is visible yet. That means timing and distribution may still be too thin to support compounding traction.`,
      tone:
        distribution_summary.active_platforms >= 2 && distribution_summary.publish_success_rate >= 80
          ? 'moderate'
          : 'watch',
    });
  }
  learned.push({
    title: 'Operating rhythm is now part of the intelligence picture',
    detail: timing_summary.active_days > 0
      ? `The system has been visibly active on ${timing_summary.active_days} day${timing_summary.active_days === 1 ? '' : 's'} in the last ${snapshot.time_range_days} days, with ${timing_summary.recent_content_events} content event${timing_summary.recent_content_events === 1 ? '' : 's'} and ${timing_summary.recent_distribution_events} distribution event${timing_summary.recent_distribution_events === 1 ? '' : 's'}. ${timing_summary.avg_gap_days != null ? `The average ${timing_summary.avg_gap_days}-day gap between visible events is now shaping whether momentum can compound.` : 'This now gives the page a better read on whether the operating rhythm is actually compounding.'}`
      : `No meaningful recent rhythm is visible across content or distribution in the last ${snapshot.time_range_days} days, which means the system is still learning from isolated activity instead of a repeatable cadence.`,
    tone: timing_summary.rhythm_state === 'strong' ? 'moderate' : 'watch',
  });
  if (weakestMetric) {
    learned.push({
      title: 'Audience response shows one weak point that is holding performance back',
      detail: `${weakestMetric.label} is the softest audience signal at ${weakestMetric.avg_pct_of_target}% of benchmark, which means resonance is not yet converting cleanly into stronger momentum.`,
      tone: weakestMetric.avg_pct_of_target < 85 ? 'watch' : 'moderate',
    });
  }
  if (volatility) {
    learned.push({
      title: 'Execution quality is moving faster than strategic consistency',
      detail: volatility.pattern,
      tone: 'watch',
    });
  }
  if (engagement_summary.threads > 0 || lead_summary.active_leads > 0) {
    learned.push({
      title: 'Engagement is now feeding commercial signal, not just surface activity',
      detail: `${engagement_summary.threads} thread${engagement_summary.threads === 1 ? '' : 's'} and ${lead_summary.active_leads} active lead${lead_summary.active_leads === 1 ? '' : 's'} have been captured so far, including ${lead_summary.prospect_active_leads} prospect${lead_summary.prospect_active_leads === 1 ? '' : 's'} and ${lead_summary.qualified_active_leads} qualified lead${lead_summary.qualified_active_leads === 1 ? '' : 's'}. That means the system can start recommending stronger follow-up motions when the quality is high enough.`,
      tone: lead_summary.qualified_active_leads > 0 ? 'strong' : 'moderate',
    });
  }
  if (strategic_memory.dominant_topic_cluster) {
    learned.push({
      title: 'The broader ecosystem is starting to show authority-graph shape',
      detail: `${strategic_memory.dominant_topic_cluster} is becoming the anchor for strategic memory. The current graph is ${KNOWLEDGE_GRAPH_LABELS[knowledge_graph_summary.status].toLowerCase()}, with ${knowledge_graph_summary.topic_cluster_count} topic cluster${knowledge_graph_summary.topic_cluster_count === 1 ? '' : 's'} and ${knowledge_graph_summary.format_diversity} active format${knowledge_graph_summary.format_diversity === 1 ? '' : 's'} contributing to that shape.`,
      tone: knowledge_graph_summary.status === 'maturing' ? 'strong' : 'moderate',
    });
  }
  if (market_pulse_summary.completed_runs > 0) {
    learned.push({
      title: 'External market signal is available for context, not just internal performance',
      detail: `${market_pulse_summary.completed_runs} Market Pulse run${market_pulse_summary.completed_runs === 1 ? '' : 's'} have been completed, with ${market_pulse_summary.latest_findings} finding${market_pulse_summary.latest_findings === 1 ? '' : 's'} in the latest cycle. That gives future recommendations more context about whether to push, hold, or redirect.`,
      tone: 'moderate',
    });
  }
  if (snapshot.intelligence_settings.target_note) {
    learned.push({
      title: 'The operating target is now explicit instead of implied',
      detail: snapshot.intelligence_settings.target_note,
      tone: 'moderate',
    });
  }

  return selectTopInsights(learned, 6);
}

export function deriveCommercialReadiness(snapshot: Snapshot): DerivedInsight[] {
  const { system_snapshot: ss, audience_response, next_actions, strategic_intelligence, campaign_mix_summary, distribution_summary, timing_summary, lead_summary, engagement_summary, intelligence_settings } = snapshot;
  const strongestMetric = audience_response.metric_rankings[0];
  const pivotCount = next_actions.filter((action) => action.action === 'pivot').length;
  const continueCount = next_actions.filter((action) => action.action === 'continue').length;
  const insights: DerivedInsight[] = [];
  const objectiveLabel = getIntelligenceObjectiveLabel(snapshot);
  const refreshCurrentReport = shouldRefreshCurrentReport(snapshot);
  const topPlatform = distribution_summary.platform_mix[0];

  insights.push({
    title: lead_summary.qualified_active_leads > 0 || ss.campaigns_ready_to_scale > 0 ? 'The system is approaching a stronger activation point' : 'The system still needs more proof before a hard commercial push',
    detail: lead_summary.qualified_active_leads > 0
      ? `Qualified lead evidence already exists, which means the next motion can move beyond content and campaign learning into sharper conversion action for ${objectiveLabel.toLowerCase()}.`
      : lead_summary.prospect_active_leads > 0
      ? `Prospect-stage demand already exists, which means the next motion should focus on qualification and routing rather than treating all activity as equal.`
      : ss.campaigns_ready_to_scale > 0
      ? `There is enough evidence to justify a stronger next motion, especially if you extend what is already working into follow-up outreach, email, or a tighter conversion path.`
      : 'Right now the better move is to improve signal quality, not rush into a broader outreach motion too early.',
    tone: lead_summary.qualified_active_leads > 0 || ss.campaigns_ready_to_scale > 0 ? 'strong' : lead_summary.prospect_active_leads > 0 ? 'moderate' : 'moderate',
  });

  if (distribution_summary.connected_platforms > 0) {
    insights.push({
      title: 'Commercial readiness depends on distribution reliability too',
      detail: distribution_summary.active_platforms > 0
        ? `Current publishing breadth spans ${distribution_summary.active_platforms} active platform${distribution_summary.active_platforms === 1 ? '' : 's'} with a ${distribution_summary.publish_success_rate}% publish success rate${topPlatform ? `, and ${formatPlatformLabel(topPlatform.platform)} is carrying ${topPlatform.share_pct}% of that visible load` : ''}. Commercial escalation should stay realistic if delivery reliability or channel balance is still weak.`
        : 'Platforms are connected, but live publishing breadth is still too thin to assume the current signal is fully representative.',
      tone:
        distribution_summary.active_platforms >= 2 && distribution_summary.publish_success_rate >= 85
          ? 'moderate'
          : 'watch',
    });
  }

  insights.push({
    title: 'Commercial timing depends on operating rhythm too',
    detail: timing_summary.active_days > 0
      ? `The system has been visibly active on ${timing_summary.active_days} day${timing_summary.active_days === 1 ? '' : 's'} in the last ${snapshot.time_range_days} days${timing_summary.avg_gap_days != null ? `, with an average ${timing_summary.avg_gap_days}-day gap between visible events` : ''}. That rhythm affects whether current demand can compound into stronger commercial readiness.`
      : 'There is still too little recent operating rhythm to assume that current commercial signals are representative.',
    tone: timing_summary.rhythm_state === 'strong' ? 'moderate' : 'watch',
  });

  if (strongestMetric) {
    insights.push({
      title: `${strongestMetric.label} is the strongest commercial signal in the current cycle`,
      detail: `That makes it the best candidate for deciding whether to scale distribution, add a follow-up campaign layer, or move promising engagement into more direct lead handling.`,
      tone: strongestMetric.avg_pct_of_target >= 95 ? 'strong' : 'moderate',
    });
  }

  insights.push({
    title: continueCount > pivotCount ? 'Scale and refine should come before a full reset' : 'A stronger directional correction is likely needed before scaling',
    detail: continueCount > pivotCount
      ? 'The balance of current recommendations suggests there is enough value in the existing system to improve and extend it, rather than abandoning the current path.'
      : 'Too many current signals are asking for change, which means aggressive scaling now would probably magnify the wrong pattern.',
    tone: continueCount > pivotCount ? 'moderate' : 'watch',
  });

  if (engagement_summary.opportunities > 0 || lead_summary.engagement_signals > 0) {
    insights.push({
      title: 'Engagement is mature enough to inform the next commercial step',
      detail: `${engagement_summary.opportunities} engagement opportunit${engagement_summary.opportunities === 1 ? 'y' : 'ies'} and ${lead_summary.engagement_signals} lead signal${lead_summary.engagement_signals === 1 ? '' : 's'} mean the system can start judging whether the next move should be nurture, direct outreach, or a stronger campaign layer. The stage mix currently sits at ${lead_summary.suspect_active_leads} suspect, ${lead_summary.prospect_active_leads} prospect, and ${lead_summary.qualified_active_leads} qualified lead${lead_summary.qualified_active_leads === 1 ? '' : 's'}.`,
      tone: engagement_summary.opportunities > 0 ? 'moderate' : 'watch',
    });
  }

  if (strategic_intelligence.best_performing_goal) {
    insights.push({
      title: 'Future commercial moves should follow the strongest goal pattern',
      detail: `${GOAL_LABELS[strategic_intelligence.best_performing_goal] ?? strategic_intelligence.best_performing_goal} is currently the best-performing objective, so future campaigns and outreach should be anchored there first.`,
      tone: 'moderate',
    });
  }

  if (intelligence_settings.sales_motion || intelligence_settings.avg_deal_size || intelligence_settings.target_customer_segment) {
    insights.push({
      title: 'Commercial recommendations should follow the actual sales motion',
      detail: [
        intelligence_settings.sales_motion ? `Sales motion: ${intelligence_settings.sales_motion}.` : null,
        intelligence_settings.avg_deal_size ? `Avg deal size: ${intelligence_settings.avg_deal_size}.` : null,
        intelligence_settings.target_customer_segment ? `Target segment: ${intelligence_settings.target_customer_segment}.` : null,
      ].filter(Boolean).join(' '),
      tone: 'moderate',
    });
  }

  if (intelligence_settings.target_customer_segment) {
    insights.push({
      title: 'The next commercial move should stay segment-specific',
      detail: `Current signals should be judged against the target segment "${intelligence_settings.target_customer_segment}" so the team does not overreact to activity from the wrong audience cluster.`,
      tone: 'moderate',
    });
  }

  if (snapshot.reports_summary.latest_report_type) {
    insights.push({
      title: refreshCurrentReport ? 'Commercial guidance needs a fresher report lens' : 'Commercial guidance should respect the latest report lens',
      detail: refreshCurrentReport && snapshot.reports_summary.latest_report_age_days != null
        ? `${formatReportTypeLabel(snapshot.reports_summary.latest_report_type)} is already ${snapshot.reports_summary.latest_report_age_days} days old, and current performance signals suggest it should be refreshed before the team overcommits to the next report level or commercial motion.`
        : `${formatReportTypeLabel(snapshot.reports_summary.latest_report_type)} is the latest structured report in the system, so the next recommendation should build on that diagnostic lens instead of pretending all report contexts are interchangeable.`,
      tone: refreshCurrentReport ? 'watch' : 'moderate',
    });
  }

  insights.push({
    title: 'Report progression should follow maturity, not just appetite',
    detail: `Current report maturity is ${snapshot.report_readiness_summary.maturity_stage.replace(/_/g, ' ')}. Performance Intelligence is ${REPORT_READINESS_LABELS[snapshot.report_readiness_summary.performance.state].toLowerCase()}, and Market & Growth Intelligence is ${REPORT_READINESS_LABELS[snapshot.report_readiness_summary.growth.state].toLowerCase()}.`,
    tone:
      snapshot.report_readiness_summary.growth.state === 'ready_now' || snapshot.report_readiness_summary.performance.state === 'ready_now'
        ? 'moderate'
        : 'watch',
  });

  const connectedGrowthSystems = [
    snapshot.report_readiness_summary.growth_integration_summary.crm_connected ? 'CRM' : null,
    snapshot.report_readiness_summary.growth_integration_summary.email_connected ? 'email' : null,
    snapshot.report_readiness_summary.growth_integration_summary.outreach_connected ? 'outreach' : null,
    snapshot.report_readiness_summary.growth_integration_summary.commerce_connected ? 'commerce' : null,
    snapshot.report_readiness_summary.growth_integration_summary.event_signal_connected ? 'event/webinar' : null,
  ].filter(Boolean) as string[];
  insights.push({
    title: 'Growth maturity should be judged against commercial-system coverage',
    detail: connectedGrowthSystems.length > 0
      ? `Current broader growth-system coverage includes ${connectedGrowthSystems.join(', ')}. That is useful, but Market & Growth Intelligence should still wait until both coverage and baseline data depth are strong enough.`
      : 'No meaningful broader commercial-system coverage is visible yet, so Market & Growth Intelligence would still be premature even if top-of-funnel signals look active.',
    tone: connectedGrowthSystems.length >= 2 ? 'moderate' : 'watch',
  });

  if (campaign_mix_summary.total_versions > 0 && campaign_mix_summary.dominant_path) {
    insights.push({
      title: 'Commercial guidance should respect the dominant campaign path',
      detail: `${formatCampaignPathLabel(campaign_mix_summary.dominant_path)} is currently the strongest execution habit in the system. The next commercial move should either exploit that strength deliberately or test one adjacent path with a clear reason, not switch blindly.`,
      tone: campaign_mix_summary.total_versions >= 2 ? 'moderate' : 'watch',
    });
  }

  return selectTopInsights(insights, 5);
}

export function deriveLearnedSignalsCta(snapshot: Snapshot): { href: string; label: string } {
  if (shouldRefreshCurrentReport(snapshot) && snapshot.reports_summary.latest_report_type) {
    return {
      href:
        snapshot.reports_summary.latest_report_type === 'performance'
          ? '/reports/performance-intelligence'
          : snapshot.reports_summary.latest_report_type === 'growth'
            ? '/reports/market-growth-intelligence'
            : '/reports/digital-authority-snapshot',
      label: 'Refresh report lens',
    };
  }

  if (snapshot.report_readiness_summary.performance.state === 'ready_now' && snapshot.reports_summary.report_type_mix[0]?.type === 'snapshot') {
    return { href: '/reports/performance-intelligence', label: 'Open next report' };
  }

  if (snapshot.report_readiness_summary.growth.state === 'ready_now' && snapshot.reports_summary.report_type_mix[0]?.type === 'performance') {
    return { href: '/reports/market-growth-intelligence', label: 'Open growth report' };
  }

  if (snapshot.knowledge_graph_summary.status === 'imbalanced' && snapshot.knowledge_graph_summary.weakest_stage) {
    return {
      href:
        snapshot.knowledge_graph_summary.weakest_stage === 'awareness'
          ? '/posts/create'
          : snapshot.knowledge_graph_summary.weakest_stage === 'decision'
            ? '/case-studies/create'
            : '/admin/content',
      label: 'Strengthen weak stage',
    };
  }

  if (snapshot.distribution_summary.active_platforms <= 1) {
    return { href: '/engagement', label: 'Improve distribution' };
  }

  return { href: '/command-center/content', label: 'Act on content insights' };
}

export function deriveEcosystemProgressCta(snapshot: Snapshot): { href: string; label: string } {
  if (snapshot.knowledge_graph_summary.status === 'shallow') {
    return { href: '/command-center/content', label: 'Expand knowledge graph' };
  }
  if (snapshot.knowledge_graph_summary.status === 'imbalanced' && snapshot.knowledge_graph_summary.weakest_stage) {
    return {
      href:
        snapshot.knowledge_graph_summary.weakest_stage === 'awareness'
          ? '/posts/create'
          : snapshot.knowledge_graph_summary.weakest_stage === 'decision'
            ? '/case-studies/create'
            : '/admin/content',
      label: 'Fix graph imbalance',
    };
  }
  if (snapshot.timing_summary.rhythm_state === 'thin') {
    return { href: '/admin/content', label: 'Tighten operating rhythm' };
  }
  if (snapshot.distribution_summary.active_platforms <= 1 || snapshot.distribution_summary.publish_success_rate < 85) {
    return { href: '/engagement', label: 'Strengthen distribution' };
  }
  return { href: '/intelligence', label: 'Monitor ecosystem health' };
}

export function deriveCommercialReadinessCta(snapshot: Snapshot): { href: string; label: string } {
  if (snapshot.lead_summary.qualified_active_leads > 0) {
    return { href: '/dashboard/intelligence?intelTab=active-leads', label: 'Review qualified demand' };
  }
  if (snapshot.report_readiness_summary.growth.state === 'ready_now') {
    return { href: '/reports/market-growth-intelligence', label: 'Open growth intelligence' };
  }
  if (snapshot.distribution_summary.active_platforms <= 1 || snapshot.distribution_summary.publish_success_rate < 85) {
    return { href: '/engagement', label: 'Strengthen commercial distribution' };
  }
  if (snapshot.timing_summary.rhythm_state === 'thin') {
    return { href: '/command-center/campaigns', label: 'Increase operating cadence' };
  }
  if (snapshot.lead_summary.prospect_active_leads > 0 || snapshot.lead_summary.suspect_active_leads > 0) {
    return { href: '/dashboard/intelligence?intelTab=active-leads', label: 'Review lead progression' };
  }
  return { href: '/command-center/campaigns', label: 'Tighten commercial motion' };
}

export function deriveDiagnosis(snapshot: Snapshot): Array<{
  label: string;
  explanation: string;
  tone: DerivedInsight['tone'];
}> {
  const { timing_summary, distribution_summary, knowledge_graph_summary, content_summary, reports_summary, report_readiness_summary, lead_summary, engagement_summary } = snapshot;
  const topContentType = content_summary.content_type_mix[0];
  const topPlatform = distribution_summary.platform_mix[0];
  const evidenceInputs = [
    reports_summary.total_reports > 0 ? `${reports_summary.total_reports} report${reports_summary.total_reports === 1 ? '' : 's'}` : null,
    content_summary.total_blogs > 0 ? `${content_summary.total_blogs} content asset${content_summary.total_blogs === 1 ? '' : 's'}` : null,
    engagement_summary.threads > 0 ? `${engagement_summary.threads} thread${engagement_summary.threads === 1 ? '' : 's'}` : null,
    lead_summary.active_leads > 0 ? `${lead_summary.active_leads} active lead${lead_summary.active_leads === 1 ? '' : 's'}` : null,
  ].filter(Boolean) as string[];

  return [
    {
      label: 'Rhythm',
      explanation:
        timing_summary.rhythm_state === 'thin'
          ? 'Publishing too infrequent -> no compounding signal.'
        : timing_summary.rhythm_state === 'steady'
            ? 'Publishing is happening, but not steadily enough to compound.'
            : 'Publishing cadence is steady enough to support compounding.',
      tone: timing_summary.rhythm_state === 'strong' ? 'strong' : timing_summary.rhythm_state === 'steady' ? 'moderate' : 'watch',
    },
    {
      label: 'Distribution',
      explanation:
        distribution_summary.connected_platforms === 0
          ? 'Distribution not connected tightly enough -> weak traction may still be an access problem.'
          : distribution_summary.active_platforms === 0
            ? 'Distribution not active enough -> current performance cannot be trusted.'
            : distribution_summary.active_platforms === 1 && distribution_summary.connected_platforms > 1
              ? 'Distribution too narrow -> performance is biased, not reliable.'
              : topPlatform && topPlatform.share_pct >= 70
                ? `${formatPlatformLabel(topPlatform.platform)} is carrying ${topPlatform.share_pct}% of visible distribution -> reach is still too dependent on one channel.`
                : 'Distribution broad enough -> channel comparisons are now more reliable.',
      tone:
        distribution_summary.connected_platforms === 0 || distribution_summary.active_platforms === 0
          ? 'watch'
          : distribution_summary.active_platforms >= 2 && distribution_summary.publish_success_rate >= 85
            ? 'strong'
            : 'moderate',
    },
    {
      label: 'Content depth',
      explanation:
        knowledge_graph_summary.status === 'shallow'
          ? 'Content too shallow -> cannot move users across the journey.'
        : knowledge_graph_summary.status === 'imbalanced' && knowledge_graph_summary.weakest_stage
            ? `Content depth uneven -> ${knowledge_graph_summary.weakest_stage} stage is too weak.`
            : topContentType
              ? `${formatContentTypeLabel(topContentType.type)} dominates the mix -> the journey still lacks enough adjacent depth.`
              : 'Content depth is still emerging -> not enough range to trust the authority pattern fully.',
      tone:
        knowledge_graph_summary.status === 'maturing'
          ? 'strong'
          : knowledge_graph_summary.status === 'emerging'
            ? 'moderate'
            : 'watch',
    },
    {
      label: 'Evidence strength',
      explanation:
        evidenceInputs.length === 0
          ? 'Evidence too early -> not decision-grade yet.'
          : report_readiness_summary.performance.state === 'collecting_baseline'
            ? 'Evidence exists, but it is still too early to trust fully.'
          : report_readiness_summary.growth.state === 'ready_now'
              ? 'Evidence broad enough -> deeper commercial decisions are now justified.'
              : 'Signals exist, but they are not decision-grade yet.',
      tone:
        report_readiness_summary.growth.state === 'ready_now'
          ? 'strong'
          : report_readiness_summary.performance.state === 'ready_now' || report_readiness_summary.performance.state === 'ready_soon'
            ? 'moderate'
            : 'watch',
    },
  ];
}

export function deriveSupportingSignals(snapshot: Snapshot): Array<{
  title: string;
  summary: string;
  href: string;
  label: string;
}> {
  const topMetric = snapshot.audience_response.metric_rankings[0];
  const weakestMetric = snapshot.audience_response.metric_rankings[snapshot.audience_response.metric_rankings.length - 1];
  const dominantCampaignPath = formatCampaignPathLabel(snapshot.campaign_mix_summary.dominant_path);

  return [
    {
      title: 'Campaigns',
      summary: dominantCampaignPath
        ? `${snapshot.system_snapshot.total_campaigns} campaigns are visible, with ${dominantCampaignPath} currently acting as the main execution path.`
        : `${snapshot.system_snapshot.total_campaigns} campaigns are visible, but the system still needs cleaner execution history before a dominant path is obvious.`,
      href: '/command-center/campaigns',
      label: 'Open campaigns',
    },
    {
      title: 'Knowledge graph',
      summary: `${KNOWLEDGE_GRAPH_LABELS[snapshot.knowledge_graph_summary.status]} graph with ${snapshot.knowledge_graph_summary.topic_cluster_count} topic cluster${snapshot.knowledge_graph_summary.topic_cluster_count === 1 ? '' : 's'}${snapshot.knowledge_graph_summary.weakest_stage ? `; weakest stage is ${snapshot.knowledge_graph_summary.weakest_stage}` : ''}.`,
      href: '/command-center/content',
      label: 'Open content system',
    },
    {
      title: 'Metrics',
      summary: topMetric
        ? `${topMetric.label} is strongest right now${weakestMetric ? `, while ${weakestMetric.label.toLowerCase()} remains the main drag` : ''}.`
        : 'The system does not have enough metric depth yet to separate the strongest and weakest signal cleanly.',
      href: '/engagement',
      label: 'Open engagement',
    },
    {
      title: 'History',
      summary: snapshot.reports_summary.total_reports > 0
        ? `${snapshot.reports_summary.total_reports} reports and ${snapshot.market_pulse_summary.completed_runs} Market Pulse run${snapshot.market_pulse_summary.completed_runs === 1 ? '' : 's'} are available as historical context for current decisions.`
        : 'Historical context is still light, so current recommendations depend more on live operating signal than long-term pattern memory.',
      href: '/reports',
      label: 'Open reports',
    },
  ];
}

export function deriveBottomLine(snapshot: Snapshot): { text: string; cta: { href: string; label: string } | null } {
  const bottleneck = derivePrimaryBottleneck(snapshot);
  const _actions = deriveSystemActionLines(snapshot);
  const action = _actions.doNow[0] ?? _actions.doNext[0] ?? _actions.monitor[0] ?? null;

  return {
    text:
      snapshot.system_snapshot.health === 'weak'
        ? 'Do not scale noise. Build signal first. Fix publishing rhythm and distribution. Scale only when signal is consistent.'
        : `Do not scale noise. Build signal first. Fix ${bottleneck.title.toLowerCase()}. Scale only when signal is consistent.`,
    cta: action ? { href: action.href, label: action.label } : null,
  };
}

export function deriveSystemMemory(snapshot: Snapshot): Array<{ direction: 'up' | 'flat' | 'down'; text: string }> {
  const items: Array<{ direction: 'up' | 'flat' | 'down'; text: string }> = [];

  if (snapshot.content_summary.recent_blogs > 0) {
    items.push({
      direction: 'up',
      text: `Publishing activity increased (+${snapshot.content_summary.recent_blogs} piece${snapshot.content_summary.recent_blogs === 1 ? '' : 's'})`,
    });
  } else {
    items.push({
      direction: 'down',
      text: 'No new content published (rhythm still weak)',
    });
  }

  if (snapshot.distribution_summary.active_platforms <= 1) {
    items.push({
      direction: 'flat',
      text: `Distribution unchanged (still limited to ${snapshot.distribution_summary.active_platforms || 1} channel)`,
    });
  } else {
    items.push({
      direction: 'up',
      text: `Distribution broader (${snapshot.distribution_summary.active_platforms} active channels)`,
    });
  }

  if (snapshot.lead_summary.engagement_signals > 0 || snapshot.engagement_summary.threads > 0) {
    items.push({
      direction: 'up',
      text: 'Evidence slightly stronger (more engagement signals)',
    });
  }

  if (snapshot.report_readiness_summary.performance.state === 'collecting_baseline') {
    items.push({
      direction: 'flat',
      text: 'Evidence still building (not decision-grade yet)',
    });
  }

  return items.slice(0, 4);
}

export function derivePrimaryBottleneckCta(snapshot: Snapshot): { href: string; label: string } | null {
  const bottleneck = derivePrimaryBottleneck(snapshot);
  const title = bottleneck.title.toLowerCase();

  if (title.includes('rhythm')) {
    return { href: '/admin/content', label: 'Tighten operating rhythm' };
  }
  if (title.includes('stage depth')) {
    const weakestStage = snapshot.knowledge_graph_summary.weakest_stage;
    return {
      href:
        weakestStage === 'awareness'
          ? '/posts/create'
          : weakestStage === 'decision'
            ? '/case-studies/create'
            : '/admin/content',
      label: 'Strengthen weak stage',
    };
  }
  if (title.includes('strategic consistency')) {
    return { href: '/command-center/campaigns', label: 'Tighten campaign strategy' };
  }
  if (title.includes('limiting factor')) {
    return { href: '/engagement', label: 'Fix conversion drag' };
  }
  if (title.includes('evidence depth')) {
    return { href: '/command-center/content', label: 'Build more signal' };
  }
  return { href: '/command-center/content', label: 'Broaden portfolio depth' };
}
