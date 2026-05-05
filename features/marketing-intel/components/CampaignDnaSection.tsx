import { SectionCard, SectionCta } from '@/features/marketing-intel/components/SectionCard';
import { GOAL_LABELS, STABILITY_CFG } from '@/features/marketing-intel/constants';
import { scoreColour } from '@/features/marketing-intel/hooks/viewModel.helpers';
import type { MarketingIntelData } from '@/features/marketing-intel/types';

type Props = {
  d: MarketingIntelData;
};

export default function CampaignDnaSection({ d }: Props) {
  const data = d.snapshot?.campaign_dna;
  if (!data) return null;

  const totalGoals     = Object.values(data.goal_distribution).reduce((a, b) => a + b, 0);
  const totalStability = Object.values(data.stability_distribution).reduce((a, b) => a + b, 0);

  return (
    <SectionCard
      sectionKey="campaign_dna"
      title="Campaign DNA"
      footer={<SectionCta href="/campaigns" label="View all campaigns" />}
    >
      <div className="space-y-5">
        {totalGoals > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Goal distribution</p>
            <div className="space-y-1.5">
              {Object.entries(data.goal_distribution)
                .sort((a, b) => b[1] - a[1])
                .map(([goal, count]) => (
                  <div key={goal} className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-600 w-24 shrink-0">{GOAL_LABELS[goal] ?? goal}</span>
                    <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-[#0A66C2] rounded-full" style={{ width: `${(count / totalGoals) * 100}%` }} />
                    </div>
                    <span className="text-[11px] text-gray-400 w-4 text-right">{count}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
        {data.topic_clusters.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Topic clusters by performance</p>
            <div className="space-y-2">
              {data.topic_clusters.map((t, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2">
                  <span className="text-xs font-medium text-gray-700 flex-1 capitalize">{t.cluster}</span>
                  <span className="text-[11px] text-gray-400">{t.count} campaign{t.count !== 1 ? 's' : ''}</span>
                  <span className={`text-xs font-bold ml-2 ${scoreColour(t.avg_score)}`}>{t.avg_score}/100</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {totalStability > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Decision stability</p>
            <div className="flex gap-2 flex-wrap">
              {Object.entries(data.stability_distribution).filter(([, n]) => n > 0).map(([signal, count]) => {
                const cfg = STABILITY_CFG[signal as keyof typeof STABILITY_CFG];
                return (
                  <div key={signal} className="flex items-center gap-1.5 rounded-full border border-gray-100 bg-gray-50 px-3 py-1 text-[11px]">
                    <span className={`h-2 w-2 rounded-full ${cfg?.dot ?? 'bg-gray-400'}`} />
                    <span className="text-gray-600">{count} {cfg?.label ?? signal}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
