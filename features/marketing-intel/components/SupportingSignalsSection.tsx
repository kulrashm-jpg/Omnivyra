import { SectionCard, SectionCta } from '@/features/marketing-intel/components/SectionCard';
import { deriveSupportingSignals } from '@/features/marketing-intel/derives';
import { useMarketingIntel } from '@/hooks/useMarketingIntel';

type Props = {
  d: ReturnType<typeof useMarketingIntel>;
};

export default function SupportingSignalsSection({ d }: Props) {
  const snapshot = d.snapshot;
  if (!snapshot) return null;

  const cards = deriveSupportingSignals(snapshot);

  return (
    <SectionCard title="Supporting Signals" badge="Optional drill-down">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.title} className="rounded-xl border border-gray-200 bg-gray-50 p-4 shadow-sm transition-all duration-150 ease-out hover:-translate-y-0.5 hover:shadow-md">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{card.title}</p>
            <p className="mt-3 text-sm leading-relaxed text-gray-700">{card.summary}</p>
            <div className="mt-3">
              <SectionCta href={card.href} label={card.label} />
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
