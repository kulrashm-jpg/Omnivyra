import { deriveSystemMemory } from '@/features/marketing-intel/derives';
import type { MarketingIntelData } from '@/features/marketing-intel/types';

type Props = {
  d: MarketingIntelData;
};

export default function SystemMemorySection({ d }: Props) {
  const snapshot = d.snapshot;
  if (!snapshot) return null;

  const items = deriveSystemMemory(snapshot);
  if (items.length === 0) return null;

  const indicatorTone = {
    up: 'text-emerald-600',
    flat: 'text-slate-500',
    down: 'text-amber-600',
  } as const;

  const indicatorGlyph = {
    up: '↑',
    flat: '→',
    down: '↓',
  } as const;

  return (
    <div className="px-1">
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Since last check</p>
      <ul className="mt-2 space-y-1 text-sm text-gray-600">
        {items.map((item) => (
          <li key={`${item.direction}-${item.text}`} className="flex items-start gap-2">
            <span className={indicatorTone[item.direction]}>{indicatorGlyph[item.direction]}</span>
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
