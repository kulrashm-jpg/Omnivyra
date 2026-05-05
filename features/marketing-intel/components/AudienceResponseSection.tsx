import { SectionCard, SectionCta } from '@/features/marketing-intel/components/SectionCard';
import { useMarketingIntel } from '@/hooks/useMarketingIntel';

type Props = {
  d: ReturnType<typeof useMarketingIntel>;
};

export default function AudienceResponseSection({ d }: Props) {
  const data = d.snapshot?.audience_response;
  if (!data) return null;

  if (data.metric_rankings.length === 0) {
    return <SectionCard sectionKey="audience_response" title="Audience Response"><p className="text-sm text-gray-400">No metric data yet — record performance metrics to see audience signals.</p></SectionCard>;
  }

  const maxRatio = Math.max(...data.metric_rankings.map((m) => m.avg_ratio));

  return (
    <SectionCard
      sectionKey="audience_response"
      title="Audience Response"
      footer={<SectionCta href="/recommendations" label="Adjust campaign strategy" />}
    >
      <div className="space-y-3">
        {data.metric_rankings.map((m) => {
          const pct = m.avg_pct_of_target;
          const barColour  = pct >= 100 ? 'bg-emerald-400' : pct >= 80 ? 'bg-blue-400' : 'bg-amber-400';
          const textColour = pct >= 100 ? 'text-emerald-600' : pct >= 80 ? 'text-blue-600' : 'text-amber-600';
          return (
            <div key={m.metric}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-600">{m.label}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400">{m.campaigns_tracked} campaigns</span>
                  <span className={`text-xs font-bold ${textColour}`}>{pct}%</span>
                </div>
              </div>
              <div className="h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
                <div className={`h-full rounded-full ${barColour}`} style={{ width: `${Math.min(100, (m.avg_ratio / Math.max(maxRatio, 1.5)) * 100)}%` }} />
              </div>
              <p className="mt-0.5 text-[10px] text-gray-400">
                {pct >= 100 ? 'Consistently exceeding benchmark' : pct >= 80 ? 'Near benchmark' : 'Below benchmark — growth area'}
              </p>
            </div>
          );
        })}
      </div>
      {data.weakest_metric && (
        <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50/50 px-4 py-3 text-xs text-amber-700">
          <span className="font-semibold">Growth area:</span> {data.weakest_metric} sits below benchmark across campaigns — worth targeting in the next planning cycle.
        </div>
      )}
    </SectionCard>
  );
}
