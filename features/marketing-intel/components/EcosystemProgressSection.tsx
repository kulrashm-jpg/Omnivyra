import { SectionCard, SectionCta } from '@/features/marketing-intel/components/SectionCard';
import { KNOWLEDGE_GRAPH_LABELS } from '@/features/marketing-intel/constants';
import { deriveEcosystemProgressCta, toneClasses } from '@/features/marketing-intel/derives';
import { formatPlatformLabel } from '@/features/marketing-intel/hooks/viewModel.helpers';
import type { MarketingIntelData } from '@/features/marketing-intel/types';

type Props = {
  d: MarketingIntelData;
};

export default function EcosystemProgressSection({ d }: Props) {
  const snapshot = d.snapshot;
  if (!snapshot) return null;

  const graph = snapshot.knowledge_graph_summary;
  const timing = snapshot.timing_summary;
  const distribution = snapshot.distribution_summary;
  const topPlatform = distribution.platform_mix[0];
  const cta = deriveEcosystemProgressCta(snapshot);

  const graphTone =
    graph.status === 'maturing' ? toneClasses('strong') :
    graph.status === 'imbalanced' ? toneClasses('watch') :
    toneClasses('moderate');
  const rhythmTone =
    timing.rhythm_state === 'strong' ? toneClasses('strong') :
    timing.rhythm_state === 'thin' ? toneClasses('watch') :
    toneClasses('moderate');
  const distributionTone =
    distribution.active_platforms >= 2 && distribution.publish_success_rate >= 85
      ? toneClasses('strong')
      : distribution.active_platforms === 0 || distribution.publish_success_rate < 80
        ? toneClasses('watch')
        : toneClasses('moderate');

  return (
    <SectionCard
      title="Ecosystem Progress"
      badge="Compounding health"
      footer={<SectionCta href={cta.href} label={cta.label} />}
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Knowledge graph</p>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${graphTone.badge}`}>{KNOWLEDGE_GRAPH_LABELS[graph.status]}</span>
          </div>
          <p className={`mt-3 text-sm font-semibold ${graphTone.text}`}>
            {graph.dominant_cluster ?? 'No dominant cluster yet'}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-gray-600">
            {graph.topic_cluster_count} topic cluster{graph.topic_cluster_count === 1 ? '' : 's'}, {graph.format_diversity} active format{graph.format_diversity === 1 ? '' : 's'}, and stage coverage of {graph.stage_coverage.awareness} awareness, {graph.stage_coverage.consideration} consideration, and {graph.stage_coverage.decision} decision assets.
          </p>
        </div>

        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Operating rhythm</p>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${rhythmTone.badge}`}>{timing.rhythm_state === 'strong' ? 'Strong' : timing.rhythm_state === 'steady' ? 'Steady' : 'Thin'}</span>
          </div>
          <p className={`mt-3 text-sm font-semibold ${rhythmTone.text}`}>
            {timing.active_days} active day{timing.active_days === 1 ? '' : 's'} in the current window
          </p>
          <p className="mt-2 text-xs leading-relaxed text-gray-600">
            {timing.latest_activity_at
              ? `The latest visible activity landed on ${new Date(timing.latest_activity_at).toLocaleDateString()}, and the average gap between visible events is ${timing.avg_gap_days ?? '—'} days.`
              : 'No recent content or distribution rhythm is visible yet, so momentum is still being inferred from isolated activity.'}
          </p>
        </div>

        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Distribution shape</p>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${distributionTone.badge}`}>{distribution.active_platforms === 0 ? 'Inactive' : distribution.active_platforms === 1 ? 'Narrow' : 'Broadening'}</span>
          </div>
          <p className={`mt-3 text-sm font-semibold ${distributionTone.text}`}>
            {distribution.active_platforms} active platform{distribution.active_platforms === 1 ? '' : 's'} with {distribution.publish_success_rate}% reliability
          </p>
          <p className="mt-2 text-xs leading-relaxed text-gray-600">
            {topPlatform
              ? `${formatPlatformLabel(topPlatform.platform)} is carrying ${topPlatform.share_pct}% of visible distribution right now${distribution.platform_mix[1] ? `, followed by ${formatPlatformLabel(distribution.platform_mix[1].platform)}.` : '.'}`
              : 'Connected publishing channels exist, but there is still too little live distribution data to describe channel concentration.'}
          </p>
        </div>
      </div>
    </SectionCard>
  );
}
