import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useMarketingIntel } from '@/hooks/useMarketingIntel';
import type { Snapshot, NextAction } from '@/features/marketing-intel/types';
import {
  deriveTargetTracking,
  deriveTargetPotential,
  derivePrimaryBottleneck,
  toneClasses,
  getIntelligenceObjectiveLabel,
  computeEnhancedPriority,
} from '@/features/marketing-intel/derives';
import { SectionCta } from '@/features/marketing-intel/components/SectionCard';
import { deriveExecutiveSummaryCta } from '@/components/MarketingIntelView';

function generateExecutiveSummary(snapshot: Snapshot): string | null {
  const { system_snapshot: ss, strategic_intelligence, next_actions, audience_response } = snapshot;
  if (ss.evaluated_campaigns === 0) return null;

  const sentences: string[] = [];

  // Sentence 1: Portfolio state + trend + score
  const trendPhrase =
    ss.trend_signal === 'improving' ? 'trending upward' :
    ss.trend_signal === 'declining' ? 'showing a downward trend' : 'holding steady';
  const healthPhrase =
    ss.health === 'strong'   ? 'performing strongly' :
    ss.health === 'moderate' ? 'performing at a moderate level' : 'underperforming against targets';
  sentences.push(
    `Marketing performance is ${trendPhrase}, with the portfolio ${healthPhrase} at an average score of ${ss.avg_score}/100 across ${ss.evaluated_campaigns} evaluated campaign${ss.evaluated_campaigns !== 1 ? 's' : ''}.`
  );

  // Sentence 2: Strongest performing area
  const topicStrength = strategic_intelligence.patterns.find((p) => p.type === 'topic_strength' && p.confidence !== 'low');
  const goalAffinity  = strategic_intelligence.patterns.find((p) => p.type === 'goal_affinity'  && p.confidence !== 'low');
  const topMetric     = audience_response.metric_rankings[0];

  if (topicStrength) {
    sentences.push(topicStrength.pattern);
  } else if (goalAffinity) {
    sentences.push(goalAffinity.pattern);
  } else if (topMetric && topMetric.avg_pct_of_target >= 90) {
    sentences.push(
      `Audience response is strongest in ${topMetric.label.toLowerCase()} at ${topMetric.avg_pct_of_target}% of benchmark, indicating strong content-to-audience fit in this area.`
    );
  } else if (ss.campaigns_ready_to_scale > 0) {
    sentences.push(
      `${ss.campaigns_ready_to_scale} campaign${ss.campaigns_ready_to_scale !== 1 ? 's are' : ' is'} exceeding targets and ready to scale.`
    );
  }

  // Sentence 3: Weak signal or gap
  const volatility    = strategic_intelligence.patterns.find((p) => p.type === 'volatility');
  const bottomMetric  = audience_response.metric_rankings[audience_response.metric_rankings.length - 1];
  const underperformed = ss.status_distribution.underperformed;

  if (volatility) {
    sentences.push(
      'Strategy consistency is flagged — high variance across campaigns suggests execution is outpacing strategic clarity.'
    );
  } else if (bottomMetric && bottomMetric.avg_pct_of_target < 85 && audience_response.metric_rankings.length > 1) {
    sentences.push(
      `${bottomMetric.label} consistently sits below benchmark at ${bottomMetric.avg_pct_of_target}% — a focused effort here could lift overall portfolio performance.`
    );
  } else if (underperformed > 0) {
    sentences.push(
      `${underperformed} campaign${underperformed !== 1 ? 's' : ''} ${underperformed !== 1 ? 'are' : 'is'} underperforming and warrant strategic review before the next planning cycle.`
    );
  }

  // Sentence 4: Directional recommendation
  const highPriority = next_actions.filter((a) => computeEnhancedPriority(a).priority === 'high');
  const pivots       = next_actions.filter((a) => a.action === 'pivot');
  const scales       = next_actions.filter((a) => a.action === 'continue');

  if (highPriority.length > 0) {
    sentences.push(
      `Immediate priority: ${highPriority.length} action${highPriority.length !== 1 ? 's' : ''} require${highPriority.length === 1 ? 's' : ''} urgent attention — ${pivots.length > 0 ? 'direction changes cannot be delayed without further performance loss' : 'low-confidence decisions should be validated with additional data before committing resources'}.`
    );
  } else if (scales.length > 0 && scales.length >= pivots.length) {
    sentences.push(
      'Strategic direction is clear: scale what is working while making incremental refinements to campaigns in optimisation mode.'
    );
  } else if (pivots.length > 0) {
    sentences.push(
      `Direction changes are recommended for ${pivots.length} campaign${pivots.length !== 1 ? 's' : ''} — fresh topic angles should be explored before the next content cycle.`
    );
  } else {
    sentences.push(
      'Record additional performance data to sharpen these signals and unlock campaign-specific recommendations.'
    );
  }

  return sentences.join(' ');
}

function generateExecutiveSummaryV2(snapshot: Snapshot): string | null {
  const { system_snapshot: ss, strategic_intelligence, next_actions, audience_response, intelligence_settings, lead_summary, timing_summary, knowledge_graph_summary } = snapshot;
  if (ss.evaluated_campaigns === 0) return null;

  const sentences: string[] = [];
  const objectiveLabel = getIntelligenceObjectiveLabel(snapshot);
  const tracking = deriveTargetTracking(snapshot);
  const topMetric = audience_response.metric_rankings[0];
  const bottomMetric = audience_response.metric_rankings[audience_response.metric_rankings.length - 1];
  const volatility = strategic_intelligence.patterns.find((p) => p.type === 'volatility');
  const highPriority = next_actions.filter((a) => computeEnhancedPriority(a).priority === 'high');
  const pivots = next_actions.filter((a) => a.action === 'pivot');
  const scales = next_actions.filter((a) => a.action === 'continue');

  if (tracking.progressRatio != null && tracking.currentValue != null && tracking.metricLabel && intelligence_settings.target_value) {
    const pacePhrase =
      tracking.progressRatio >= 1 ? 'already ahead of target' :
      tracking.progressRatio >= 0.6 ? 'currently on track' :
      'currently behind target';
    sentences.push(
      `${objectiveLabel} is ${pacePhrase}, with ${tracking.currentValue} of ${intelligence_settings.target_value} ${tracking.metricLabel} achieved${tracking.horizonLabel ? ` in the current ${tracking.horizonLabel} window` : ''}.`
    );
  } else {
    const trendPhrase =
      ss.trend_signal === 'improving' ? 'trending upward' :
      ss.trend_signal === 'declining' ? 'showing a downward trend' : 'holding steady';
    const healthPhrase =
      ss.health === 'strong' ? 'performing strongly' :
      ss.health === 'moderate' ? 'performing at a moderate level' : 'underperforming against targets';
    sentences.push(
      `${objectiveLabel} is ${trendPhrase}, with the portfolio ${healthPhrase} at an average score of ${ss.avg_score}/100 across ${ss.evaluated_campaigns} evaluated campaign${ss.evaluated_campaigns !== 1 ? 's' : ''}.`
    );
  }

  if (timing_summary.rhythm_state === 'thin') {
    sentences.push(
      'The operating rhythm is still too thin, so promising signals are not compounding into a dependable system yet.'
    );
  } else if (knowledge_graph_summary.status === 'imbalanced' && knowledge_graph_summary.weakest_stage) {
    sentences.push(
      `The authority graph is still imbalanced because the ${knowledge_graph_summary.weakest_stage} stage remains underweight, which is limiting smoother progression into stronger outcomes.`
    );
  } else if (lead_summary.qualified_active_leads > 0 && tracking.metricLabel?.includes('lead')) {
    sentences.push(
      `${lead_summary.qualified_active_leads} qualified lead${lead_summary.qualified_active_leads === 1 ? '' : 's'} already give the system real commercial proof, not just engagement noise.`
    );
  } else if (topMetric && topMetric.avg_pct_of_target >= 90) {
    sentences.push(
      `Audience response is strongest in ${topMetric.label.toLowerCase()} at ${topMetric.avg_pct_of_target}% of benchmark, indicating strong content-to-audience fit in this area.`
    );
  } else if (ss.campaigns_ready_to_scale > 0) {
    sentences.push(
      `${ss.campaigns_ready_to_scale} campaign${ss.campaigns_ready_to_scale !== 1 ? 's are' : ' is'} exceeding targets and ready to scale.`
    );
  }

  if (volatility) {
    sentences.push(
      'Strategy consistency is flagged — high variance across campaigns suggests execution is outpacing strategic clarity.'
    );
  } else if (bottomMetric && bottomMetric.avg_pct_of_target < 85) {
    sentences.push(
      `${bottomMetric.label} remains the weakest link, so fixing that drag is more important than simply increasing activity volume.`
    );
  } else if (ss.status_distribution.underperformed > 0) {
    sentences.push(
      `${ss.status_distribution.underperformed} campaign${ss.status_distribution.underperformed !== 1 ? 's' : ''} are still underperforming and need correction before scaling the whole system harder.`
    );
  }

  if (tracking.progressRatio != null && tracking.progressRatio >= 0.6 && (ss.campaigns_ready_to_scale > 0 || lead_summary.qualified_active_leads > 0)) {
    sentences.push(
      'The operating call now is not only to hit the target, but to push beyond it by activating the next commercial motion while signal quality is favorable.'
    );
  } else if (highPriority.length > 0) {
    sentences.push(
      `Immediate operating priority: ${highPriority.length} action${highPriority.length !== 1 ? 's' : ''} require${highPriority.length === 1 ? 's' : ''} urgent attention${pivots.length > 0 ? ', especially where direction changes are already clear.' : '.'}`
    );
  } else if (scales.length > 0 && scales.length >= pivots.length) {
    sentences.push(
      'The system is ready for controlled acceleration: scale what is working while tightening the weaker parts of execution.'
    );
  } else {
    sentences.push(
      'The next operating step is to deepen signal quality so future recommendations can move from guidance into stronger commercial action.'
    );
  }

  return sentences.join(' ');
}

type Props = {
  d: ReturnType<typeof useMarketingIntel>;
};

export default function ExecutiveSummary({ d }: Props) {
  const snapshot = d.snapshot;
  if (!snapshot) return null;

  const text = generateExecutiveSummaryV2(snapshot) ?? generateExecutiveSummary(snapshot);
  if (!text) return null;

  const ss = snapshot.system_snapshot;
  const objectiveLabel = getIntelligenceObjectiveLabel(snapshot);
  const tracking = deriveTargetTracking(snapshot);
  const bottleneck = derivePrimaryBottleneck(snapshot);
  const cta = deriveExecutiveSummaryCta(snapshot);
  const target = deriveTargetPotential(snapshot);
  const healthTone = ss.health === 'strong' ? toneClasses('strong') : ss.health === 'moderate' ? toneClasses('moderate') : toneClasses('watch');
  const summaryCards = [
    {
      label: 'Health',
      value: ss.health === 'strong' ? 'Compounding' : ss.health === 'moderate' ? 'Not stable yet' : 'Not compounding',
      detail: ss.health === 'strong'
        ? 'Signal is consistent enough to support stronger moves.'
        : ss.health === 'moderate'
          ? 'Activity exists, but it is not stable enough to trust at scale.'
          : 'Current activity is not stable enough to create compounding signal.',
      tone: healthTone,
      badgeText: ss.health === 'strong' ? 'Strong' : ss.health === 'moderate' ? 'Moderate' : 'Weak',
    },
    {
      label: 'Primary constraint',
      value: 'Inconsistent publishing + distribution',
      detail: 'The system is too uneven to create repeatable learning.',
      tone: toneClasses(bottleneck.tone),
      badgeText: 'Constraint',
    },
    {
      label: 'Risk',
      value: 'False signals -> poor scaling decisions',
      detail: target.delayCost ?? 'If this continues, the team will scale on noise instead of reliable signal.',
      tone: toneClasses('watch'),
      badgeText: 'Risk',
    },
    {
      label: 'Immediate action',
      value: 'Increase cadence and expand distribution before scaling',
      detail: cta ? 'Fix rhythm first, then trust the next layer of campaign and commercial decisions.' : 'The next move is still being inferred from current operating signal.',
      tone: toneClasses('moderate'),
      badgeText: 'Action',
    },
  ];
  const TrendIcon =
    ss.trend_signal === 'improving' ? TrendingUp :
    ss.trend_signal === 'declining' ? TrendingDown : Minus;
  const trendColour =
    ss.trend_signal === 'improving' ? 'text-emerald-500' :
    ss.trend_signal === 'declining' ? 'text-amber-500' : 'text-gray-400';

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-8 py-6">
      <div className="flex items-start gap-4">
        <div className={`mt-0.5 shrink-0 ${trendColour}`}>
          <TrendIcon className="h-5 w-5" />
        </div>
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Marketing System Status</p>
            <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">{objectiveLabel}</span>
            {tracking.metricLabel && snapshot.intelligence_settings.target_value && (
              <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                {snapshot.intelligence_settings.target_value} {tracking.metricLabel}
              </span>
            )}
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
              Main constraint: {bottleneck.title}
            </span>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed max-w-4xl">
            {ss.health === 'weak'
              ? 'The system is active, but it is not yet producing reliable signal.'
              : ss.health === 'moderate'
                ? 'The system is moving, but signal quality is not stable enough to trust at scale.'
                : 'The system is producing stable enough signal to support stronger moves.'}
          </p>
          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-4">
            {summaryCards.map((card) => (
              <div key={card.label} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{card.label}</p>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${card.tone.badge}`}>{card.badgeText}</span>
                </div>
                <p className={`mt-3 text-sm font-semibold ${card.tone.text}`}>{card.value}</p>
                <p className="mt-2 text-xs leading-relaxed text-gray-600">{card.detail}</p>
              </div>
            ))}
          </div>
          {cta && (
            <div className="mt-3">
              <SectionCta href={cta.href} label={cta.label} />
            </div>
          )}
          <p className="mt-2 text-[10px] text-gray-400">
            Based on {ss.evaluated_campaigns} evaluated campaign{ss.evaluated_campaigns !== 1 ? 's' : ''} · last {snapshot.time_range_days} days
          </p>
        </div>
      </div>
    </div>
  );
}
