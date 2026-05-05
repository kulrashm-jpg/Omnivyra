import Link from 'next/link';
import { SectionCard, SectionCta } from '@/features/marketing-intel/components/SectionCard';
import { ACTION_CFG, STABILITY_CFG } from '@/features/marketing-intel/constants';
import { computeEnhancedPriority } from '@/features/marketing-intel/derives';
import { scoreColour } from '@/features/marketing-intel/hooks/viewModel.helpers';
import { useMarketingIntel } from '@/hooks/useMarketingIntel';

type Props = {
  d: ReturnType<typeof useMarketingIntel>;
};

export default function NextActionsSection({ d }: Props) {
  const actions = d.snapshot?.next_actions ?? [];

  // Re-sort by enhanced priority (overrides API ordering)
  const sorted = [...actions].sort((a, b) => {
    const ord = { high: 0, medium: 1, low: 2 };
    return ord[computeEnhancedPriority(a).priority] - ord[computeEnhancedPriority(b).priority];
  });

  const topPivot = sorted.find((a) => a.action === 'pivot' && a.next_topic);
  const topCta   = topPivot
    ? `/recommendations?initialTopic=${encodeURIComponent(topPivot.next_topic!)}`
    : '/recommendations';

  if (sorted.length === 0) {
    return (
      <SectionCard sectionKey="next_actions" title="Next Actions">
        <p className="text-sm text-gray-400">No pending actions — record campaign performance to generate recommendations.</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      sectionKey="next_actions"
      title="Next Actions"
      badge={`${sorted.length}`}
      footer={<SectionCta href={topCta} label="Build campaign from top insight" />}
    >
      <div className="space-y-2.5">
        {sorted.map((a) => {
          const actionCfg  = ACTION_CFG[a.action];
          const { priority, label: priorityLabel, dot, text: priorityText } = computeEnhancedPriority(a);
          void priority;
          const ActionIcon = actionCfg.icon;

          return (
            <div key={a.campaign_id} className={`flex items-start gap-3 rounded-xl border p-3.5 ${actionCfg.bg}`}>
              {/* Part 2: Priority indicator */}
              <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
                <span className={`h-2 w-2 rounded-full ${dot}`} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Part 2: Priority badge */}
                  <span className={`text-[10px] font-bold ${priorityText}`}>{priorityLabel}</span>
                  <span className="text-gray-300 text-[10px]">·</span>
                  <Link href={`/recommendations?campaign=${a.campaign_id}`} className={`text-xs font-semibold hover:underline ${actionCfg.colour}`}>
                    {a.campaign_name}
                  </Link>
                  <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-semibold ${actionCfg.bg} ${actionCfg.colour}`}>
                    <ActionIcon className="h-3 w-3" />
                    {actionCfg.label}
                  </span>
                </div>
                {a.next_topic && (
                  <p className="mt-0.5 text-[11px] text-gray-500 truncate">→ "{a.next_topic}"</p>
                )}
              </div>

              <div className="shrink-0 flex flex-col items-end gap-1">
                {a.evaluation_score != null && (
                  <span className={`text-xs font-bold ${scoreColour(a.evaluation_score)}`}>{a.evaluation_score}/100</span>
                )}
                {a.stability_signal && STABILITY_CFG[a.stability_signal as keyof typeof STABILITY_CFG] && (
                  <span className={`text-[10px] ${STABILITY_CFG[a.stability_signal as keyof typeof STABILITY_CFG].text}`}>
                    {STABILITY_CFG[a.stability_signal as keyof typeof STABILITY_CFG].label}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
