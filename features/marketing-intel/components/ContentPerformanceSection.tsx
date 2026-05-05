import Link from 'next/link';
import { SectionCard } from '@/features/marketing-intel/components/SectionCard';
import { scoreColour } from '@/features/marketing-intel/hooks/viewModel.helpers';
import type { MarketingIntelData } from '@/features/marketing-intel/types';

type Props = {
  d: MarketingIntelData;
};

export default function ContentPerformanceSection({ d }: Props) {
  const data = d.snapshot?.content_performance ?? { top: [], bottom: [], all: [] };

  if (data.all.length === 0) {
    return <SectionCard sectionKey="content_performance" title="Content Performance"><p className="text-sm text-gray-400">No evaluated campaigns yet.</p></SectionCard>;
  }

  return (
    <SectionCard sectionKey="content_performance" title="Content Performance">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-500 mb-3">Top performing</p>
          <div className="space-y-2">
            {data.top.map((c, i) => (
              <div key={c.id} className="flex items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50/50 px-3 py-2.5">
                <span className="text-xs font-bold text-emerald-300 w-4 text-right">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <Link href={`/recommendations?campaign=${c.id}`} className="text-xs font-semibold text-gray-800 hover:text-[#0A66C2] truncate block">{c.name}</Link>
                  {c.topic_seed && <p className="text-[10px] text-gray-400 truncate">{c.topic_seed}</p>}
                </div>
                <span className={`text-sm font-bold ${scoreColour(c.evaluation_score)}`}>{c.evaluation_score}</span>
              </div>
            ))}
          </div>
        </div>
        {data.bottom.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-500 mb-3">Needs attention</p>
            <div className="space-y-2">
              {data.bottom.map((c) => (
                <div key={c.id} className="flex items-center gap-3 rounded-xl border border-amber-100 bg-amber-50/50 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <Link href={`/recommendations?campaign=${c.id}`} className="text-xs font-semibold text-gray-800 hover:text-[#0A66C2] truncate block">{c.name}</Link>
                    {c.topic_seed && <p className="text-[10px] text-gray-400 truncate">{c.topic_seed}</p>}
                  </div>
                  <span className={`text-sm font-bold ${scoreColour(c.evaluation_score)}`}>{c.evaluation_score}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
