import { SectionCard, SectionCta } from '@/features/marketing-intel/components/SectionCard';
import { deriveTargetPotential, toneClasses } from '@/features/marketing-intel/derives';
import type { MarketingIntelData } from '@/features/marketing-intel/types';

type Props = {
  d: MarketingIntelData;
};

export default function TargetPotentialSection({ d }: Props) {
  const snapshot = d.snapshot;
  if (!snapshot) return null;

  const derived = deriveTargetPotential(snapshot);
  const targetStateTone =
    derived.targetState === 'missing'
      ? toneClasses('watch')
      : derived.targetState === 'soft'
        ? toneClasses('moderate')
        : derived.targetState === 'under_ambitious'
          ? toneClasses('strong')
          : toneClasses('moderate');
  const targetCta =
    derived.targetState === 'missing' || derived.targetState === 'soft'
      ? { href: '/company-profile', label: 'Tighten operating target' }
      : derived.targetState === 'under_ambitious'
        ? { href: '/company-profile', label: 'Review target ambition' }
        : null;

  return (
    <SectionCard
      title="Target vs Pace vs Potential"
      badge="Target + upside"
      className="h-full"
      footer={targetCta ? <SectionCta href={targetCta.href} label={targetCta.label} /> : undefined}
    >
      <div className="mb-4 rounded-xl border border-gray-100 bg-gray-50 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Operating target</p>
          <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">{derived.objectiveLabel}</span>
          {derived.targetLabel && (
            <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-600">{derived.targetLabel}</span>
          )}
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${targetStateTone.badge}`}>{derived.targetStateLabel}</span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-gray-600">{derived.targetStateDetail}</p>
        {derived.targetNote && (
          <p className="mt-2 text-xs leading-relaxed text-gray-600">{derived.targetNote}</p>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Current pace</p>
          <p className="mt-3 text-lg font-bold text-gray-900">{derived.currentPace}</p>
          {derived.currentProgress && (
            <p className="mt-1 text-[11px] font-semibold text-blue-600">{derived.currentProgress}</p>
          )}
          <p className="mt-2 text-xs leading-relaxed text-gray-500">{derived.currentDetail}</p>
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Potential upside</p>
          <p className="mt-3 text-lg font-bold text-emerald-700">{derived.potential}</p>
          <p className="mt-2 text-xs leading-relaxed text-emerald-800/80">{derived.potentialDetail}</p>
          {derived.upsideProjection && (
            <p className="mt-2 text-[11px] font-medium text-emerald-700/90">{derived.upsideProjection}</p>
          )}
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50/70 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600">Risk if unchanged</p>
          <p className="mt-3 text-sm font-semibold text-amber-700">Do not leave the weak link unattended</p>
          <p className="mt-2 text-xs leading-relaxed text-amber-800/80">{derived.risk}</p>
          {derived.delayCost && (
            <p className="mt-2 text-[11px] font-medium text-amber-700/90">{derived.delayCost}</p>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
