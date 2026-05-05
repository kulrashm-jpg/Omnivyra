import { SectionCard, SectionCta } from '@/features/marketing-intel/components/SectionCard';
import { deriveLearnedSignals, deriveLearnedSignalsCta, toneClasses } from '@/features/marketing-intel/derives';
import { useMarketingIntel } from '@/hooks/useMarketingIntel';

type Props = {
  d: ReturnType<typeof useMarketingIntel>;
};

export default function LearnedSignalsSection({ d }: Props) {
  const snapshot = d.snapshot;
  if (!snapshot) return null;

  const learned = deriveLearnedSignals(snapshot);
  const cta = deriveLearnedSignalsCta(snapshot);

  if (learned.length === 0) return null;

  return (
    <SectionCard
      title="What We Have Learned"
      badge="Top signals"
      footer={<SectionCta href={cta.href} label={cta.label} />}
    >
      <div className="space-y-3">
        {learned.map((item) => {
          const tone = toneClasses(item.tone);
          return (
            <div key={item.title} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${item.tone === 'strong' ? 'bg-emerald-400' : item.tone === 'watch' ? 'bg-amber-400' : 'bg-blue-400'}`} />
                <p className={`text-sm font-semibold ${tone.text}`}>{item.title}</p>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-gray-600">{item.detail}</p>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
