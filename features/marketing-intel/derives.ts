import {
  INTELLIGENCE_OBJECTIVE_LABELS,
  TARGET_METRIC_LABELS,
  TIME_HORIZON_LABELS,
  GOAL_LABELS,
} from './constants';
import { toSentenceCase, parseTargetNumber } from './hooks/viewModel.helpers';
import type { Snapshot, DerivedInsight } from './types';

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
