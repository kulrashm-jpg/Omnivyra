import { SectionCard } from '@/features/marketing-intel/components/SectionCard';
import { deriveBottomLine } from '@/features/marketing-intel/derives';
import type { MarketingIntelData } from '@/features/marketing-intel/types';

type Props = {
  d: MarketingIntelData;
};

export default function BottomLineSection({ d }: Props) {
  const snapshot = d.snapshot;
  if (!snapshot) return null;

  const bottomLine = deriveBottomLine(snapshot);

  return (
    <SectionCard
      title="Bottom Line"
      badge="Decision"
    >
      <div className="rounded-xl border border-slate-300 bg-slate-100 p-6 shadow-md">
        <p className="text-lg font-bold text-slate-950">Do not scale noise. Build signal first.</p>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">{bottomLine.text}</p>
      </div>
    </SectionCard>
  );
}
