import { SectionCard } from '@/features/marketing-intel/components/SectionCard';
import { deriveDiagnosis, toneClasses } from '@/features/marketing-intel/derives';
import type { MarketingIntelData } from '@/features/marketing-intel/types';

type Props = {
  d: MarketingIntelData;
};

export default function SystemDiagnosisSection({ d }: Props) {
  const snapshot = d.snapshot;
  if (!snapshot) return null;

  const diagnosis = deriveDiagnosis(snapshot);

  return (
    <SectionCard title="Why This Is Happening" badge="Diagnosis">
      <div className="mb-4 rounded-xl border border-gray-100 bg-gray-50 p-4">
        <p className="text-sm leading-relaxed text-gray-700">
          The system is active, but not consistent enough to generate reliable learning. Content, distribution, and evidence are fragmented, so patterns appear, but cannot be trusted.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {diagnosis.map((item) => {
          const tone = toneClasses(item.tone);
          const accent =
            item.label === 'Evidence strength'
              ? 'border-l-blue-400'
              : 'border-l-amber-400';
          return (
            <div key={item.label} className={`rounded-xl border border-gray-100 border-l-4 bg-gray-50 p-4 ${accent}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{item.label}</p>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tone.badge}`}>
                  {item.tone === 'strong' ? 'Healthy' : item.tone === 'moderate' ? 'Mixed' : 'Weak'}
                </span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-gray-700">{item.explanation}</p>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
