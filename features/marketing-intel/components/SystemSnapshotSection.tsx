import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { SectionCard } from '@/features/marketing-intel/components/SectionCard';
import { ACTION_CFG, HEALTH_CFG } from '@/features/marketing-intel/constants';
import { useMarketingIntel } from '@/hooks/useMarketingIntel';

type Props = {
  d: ReturnType<typeof useMarketingIntel>;
};

export default function SystemSnapshotSection({ d }: Props) {
  const data = d.snapshot?.system_snapshot;
  if (!data) return null;

  const health = HEALTH_CFG[data.health];
  const TrendIcon =
    data.trend_signal === 'improving' ? TrendingUp :
    data.trend_signal === 'declining' ? TrendingDown : Minus;
  const trendColour =
    data.trend_signal === 'improving' ? 'text-emerald-600' :
    data.trend_signal === 'declining' ? 'text-amber-600' : 'text-gray-400';

  return (
    <SectionCard sectionKey="system_snapshot" title="System Snapshot">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className={`rounded-xl p-4 ${health.bg}`}>
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Health</p>
          <p className={`text-xl font-bold ${health.colour}`}>{health.label}</p>
          <p className="text-[11px] text-gray-500 mt-0.5">{data.avg_score}/100 avg</p>
        </div>
        <div className="rounded-xl p-4 bg-gray-50">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Trend</p>
          <div className={`flex items-center gap-1.5 ${trendColour}`}>
            <TrendIcon className="h-5 w-5" />
            <span className="text-xl font-bold capitalize">{data.trend_signal ?? '—'}</span>
          </div>
          <p className="text-[11px] text-gray-500 mt-0.5">{data.evaluated_campaigns} evaluated</p>
        </div>
        <div className="rounded-xl p-4 bg-gray-50">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Campaigns</p>
          <p className="text-xl font-bold text-gray-800">{data.total_campaigns}</p>
          <p className="text-[11px] text-gray-500 mt-0.5">{data.campaigns_ready_to_scale} scaling-ready</p>
        </div>
        <div className="rounded-xl p-4 bg-gray-50">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1.5">Actions</p>
          <div className="space-y-1">
            {Object.entries(data.action_distribution).map(([action, count]) => count > 0 ? (
              <span key={action} className={`block text-[10px] font-semibold ${ACTION_CFG[action as keyof typeof ACTION_CFG]?.colour ?? 'text-gray-600'}`}>
                {count} {action}
              </span>
            ) : null)}
          </div>
        </div>
      </div>

      {data.evaluated_campaigns > 0 && (
        <div className="mt-4">
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-gray-100">
            {data.status_distribution.exceeded > 0 && (
              <div className="bg-emerald-400" style={{ width: `${(data.status_distribution.exceeded / data.evaluated_campaigns) * 100}%` }} />
            )}
            {data.status_distribution.met > 0 && (
              <div className="bg-blue-400" style={{ width: `${(data.status_distribution.met / data.evaluated_campaigns) * 100}%` }} />
            )}
            {data.status_distribution.underperformed > 0 && (
              <div className="bg-amber-400" style={{ width: `${(data.status_distribution.underperformed / data.evaluated_campaigns) * 100}%` }} />
            )}
          </div>
          <div className="mt-2 flex items-center gap-4 text-[10px] text-gray-500">
            {data.status_distribution.exceeded > 0 && <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400" />{data.status_distribution.exceeded} exceeded</span>}
            {data.status_distribution.met > 0 && <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-400" />{data.status_distribution.met} met</span>}
            {data.status_distribution.underperformed > 0 && <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" />{data.status_distribution.underperformed} underperformed</span>}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
