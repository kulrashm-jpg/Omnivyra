import { SectionCard } from '@/features/marketing-intel/components/SectionCard';
import { deriveOperatingOverview, toneClasses } from '@/features/marketing-intel/derives';
import { useMarketingIntel } from '@/hooks/useMarketingIntel';

type Props = {
  d: ReturnType<typeof useMarketingIntel>;
};

export default function OperatingOverviewSection({ d }: Props) {
  const snapshot = d.snapshot;
  if (!snapshot) return null;

  const cards = deriveOperatingOverview(snapshot);

  return (
    <SectionCard title="Operating Overview" badge="Current system" className="h-full">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        {cards.map((card) => {
          const tone = toneClasses(card.tone);
          return (
            <div key={card.label} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{card.label}</p>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tone.badge}`}>{card.value}</span>
              </div>
              <p className={`mt-3 text-sm font-semibold ${tone.text}`}>{card.value}</p>
              <p className="mt-1 text-xs leading-relaxed text-gray-500">{card.helper}</p>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
