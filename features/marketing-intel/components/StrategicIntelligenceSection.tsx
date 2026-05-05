import { TrendingUp, TrendingDown } from 'lucide-react';
import { SectionCard, SectionCta } from '@/features/marketing-intel/components/SectionCard';
import { PATTERN_TYPE_LABELS } from '@/features/marketing-intel/constants';
import { useMarketingIntel } from '@/hooks/useMarketingIntel';

type Props = {
  d: ReturnType<typeof useMarketingIntel>;
};

export default function StrategicIntelligenceSection({ d }: Props) {
  const data = d.snapshot?.strategic_intelligence;
  if (!data) return null;

  const nonMomentum    = data.patterns.filter((p) => p.type !== 'momentum' && p.type !== 'source_pattern');
  const momentum       = data.patterns.find((p) => p.type === 'momentum');
  const sourcePattern  = data.patterns.find((p) => p.type === 'source_pattern');
  const isUp           = momentum?.pattern.toLowerCase().includes('upward');
  const companyWins    = sourcePattern?.recommendation.toLowerCase().includes('proprietary');

  if (data.campaigns_analyzed === 0) {
    return <SectionCard sectionKey="strategic_intelligence" title="Strategic Intelligence"><p className="text-sm text-gray-400">Need at least 3 evaluated campaigns to surface patterns.</p></SectionCard>;
  }

  return (
    <SectionCard
      sectionKey="strategic_intelligence"
      title="Strategic Intelligence"
      badge={`${data.campaigns_analyzed} campaigns`}
      footer={
        data.dominant_topic_cluster
          ? <SectionCta href={`/recommendations?initialTopic=${encodeURIComponent(data.dominant_topic_cluster)}`} label="Explore related topics" />
          : undefined
      }
    >
      {momentum && (
        <div className={`mb-4 flex items-center gap-3 rounded-xl border px-4 py-3 ${isUp ? 'border-emerald-100 bg-emerald-50' : 'border-amber-100 bg-amber-50'}`}>
          {isUp ? <TrendingUp className="h-4 w-4 shrink-0 text-emerald-500" /> : <TrendingDown className="h-4 w-4 shrink-0 text-amber-500" />}
          <div>
            <p className={`text-xs font-semibold ${isUp ? 'text-emerald-700' : 'text-amber-700'}`}>{momentum.pattern}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">→ {momentum.recommendation}</p>
          </div>
        </div>
      )}
      {/* Content Source Performance micro-section */}
      {sourcePattern && (
        <div className={`mb-4 rounded-xl border px-4 py-3 ${companyWins ? 'border-blue-100 bg-blue-50' : 'border-purple-100 bg-purple-50'}`}>
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`text-[10px] font-bold uppercase tracking-widest ${companyWins ? 'text-blue-500' : 'text-purple-500'}`}>
              Content Source Performance
            </span>
            <span className={`ml-auto text-[10px] font-semibold ${sourcePattern.confidence === 'high' ? 'text-emerald-600' : 'text-blue-600'}`}>
              {sourcePattern.confidence} confidence · {sourcePattern.evidence_count} campaigns
            </span>
          </div>
          <p className={`text-xs font-medium leading-relaxed ${companyWins ? 'text-blue-800' : 'text-purple-800'}`}>{sourcePattern.pattern}</p>
          <p className="mt-1 text-[11px] text-gray-500">→ {sourcePattern.recommendation}</p>
        </div>
      )}

      <div className="space-y-3">
        {nonMomentum.map((p, i) => (
          <div key={i} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{PATTERN_TYPE_LABELS[p.type] ?? p.type}</span>
              <span className={`ml-auto text-[10px] font-semibold ${p.confidence === 'high' ? 'text-emerald-600' : p.confidence === 'medium' ? 'text-blue-600' : 'text-amber-600'}`}>
                {p.confidence} · {p.evidence_count} pts
              </span>
            </div>
            <p className="text-xs text-gray-700 leading-relaxed">{p.pattern}</p>
            <p className="mt-1 text-[11px] text-gray-500">→ {p.recommendation}</p>
          </div>
        ))}
        {nonMomentum.length === 0 && !momentum && !sourcePattern && (
          <p className="text-sm text-gray-400">No patterns detected — more campaign data required.</p>
        )}
      </div>
    </SectionCard>
  );
}
