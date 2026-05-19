import { SectionCard, SectionCta } from '@/features/marketing-intel/components/SectionCard';
import {
  deriveCommercialReadiness,
  deriveCommercialReadinessCta,
  toneClasses,
} from '@/features/marketing-intel/derives';
import type { MarketingIntelData } from '@/features/marketing-intel/types';

type Props = {
  d: MarketingIntelData;
};

export default function CommercialReadinessSection({ d }: Props) {
  const snapshot = d.snapshot;
  if (!snapshot) return null;

  const insights = deriveCommercialReadiness(snapshot);
  const cta = deriveCommercialReadinessCta(snapshot);

  return (
    <SectionCard
      title="Commercial Readiness"
      badge="Next commercial move"
      className="h-full"
      footer={<SectionCta href={cta.href} label={cta.label} />}
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {insights.map((item) => {
          const tone = toneClasses(item.tone);
          return (
            <div key={item.title} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
              <p className={`text-sm font-semibold ${tone.text}`}>{item.title}</p>
              <p className="mt-2 text-xs leading-relaxed text-gray-600">{item.detail}</p>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
