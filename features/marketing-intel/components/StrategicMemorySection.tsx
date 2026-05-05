import { Activity } from 'lucide-react';
import { SectionCard, SectionCta } from '@/features/marketing-intel/components/SectionCard';
import { ACTION_CFG, GOAL_LABELS } from '@/features/marketing-intel/constants';
import type { MarketingIntelData } from '@/features/marketing-intel/types';

type Props = {
  d: MarketingIntelData;
};

export default function StrategicMemorySection({ d }: Props) {
  const data = d.snapshot?.strategic_memory;
  if (!data) return null;

  const totalDecisions = Object.values(data.decision_summary).reduce((a, b) => a + b, 0);
  const bestGoalHref   = data.best_performing_goal
    ? `/recommendations?goal=${encodeURIComponent(data.best_performing_goal)}`
    : '/recommendations';
  const sourceMemory   = data.patterns?.find((p) => p.type === 'source_pattern');

  return (
    <SectionCard
      sectionKey="strategic_memory"
      title="Strategic Memory"
      badge={`${data.campaigns_analyzed} in memory`}
      footer={<SectionCta href={bestGoalHref} label="Apply winning strategy" />}
    >
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="rounded-xl bg-gray-50 p-3 text-center">
          <p className="text-lg font-bold text-gray-800">{data.portfolio_avg_score || '—'}</p>
          <p className="text-[10px] text-gray-400">Avg score</p>
        </div>
        <div className="rounded-xl bg-gray-50 p-3 text-center">
          <p className="text-sm font-semibold text-gray-700 capitalize truncate">{data.dominant_topic_cluster ?? '—'}</p>
          <p className="text-[10px] text-gray-400">Top cluster</p>
        </div>
        <div className="rounded-xl bg-gray-50 p-3 text-center">
          <p className="text-sm font-semibold text-gray-700 capitalize">{data.best_performing_goal ? (GOAL_LABELS[data.best_performing_goal] ?? data.best_performing_goal) : '—'}</p>
          <p className="text-[10px] text-gray-400">Best goal</p>
        </div>
      </div>

      {sourceMemory && (
        <div className="mb-5 rounded-xl border border-[#0A66C2]/20 bg-blue-50 px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#0A66C2] mb-1">Content Source Insight</p>
          <p className="text-xs text-blue-800 leading-relaxed">{sourceMemory.pattern}</p>
        </div>
      )}

      {totalDecisions > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Decision history</p>
          <div className="space-y-1.5">
            {Object.entries(data.decision_summary).filter(([, n]) => n > 0).map(([action, count]) => {
              const cfg  = ACTION_CFG[action as keyof typeof ACTION_CFG];
              const Icon = cfg?.icon ?? Activity;
              return (
                <div key={action} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${cfg?.bg ?? 'bg-gray-50 border-gray-100'}`}>
                  <Icon className={`h-3.5 w-3.5 ${cfg?.colour ?? 'text-gray-400'}`} />
                  <span className={`text-xs font-semibold ${cfg?.colour ?? 'text-gray-600'}`}>{cfg?.label ?? action}</span>
                  <span className="ml-auto text-xs text-gray-500">{count}×</span>
                  <div className="w-16 h-1 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full rounded-full bg-current opacity-25" style={{ width: `${(count / totalDecisions) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
