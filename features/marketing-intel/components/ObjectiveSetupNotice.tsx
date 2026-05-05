import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useMarketingIntel } from '@/hooks/useMarketingIntel';

type Props = {
  d: ReturnType<typeof useMarketingIntel>;
};

export default function ObjectiveSetupNotice({ d }: Props) {
  const snapshot = d.snapshot;
  if (!snapshot) return null;
  if (snapshot.intelligence_settings.objective && snapshot.intelligence_settings.target_metric && snapshot.intelligence_settings.target_value) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-amber-100 bg-amber-50/80 px-6 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700">Target not set</p>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-amber-900/75">
            No target is set yet, so pacing cannot be evaluated properly.
            Add the primary objective, target metric, target value, and time horizon so this page can judge whether the system is behind, on track, or capable of surpassing the goal.
          </p>
        </div>
        <Link
          href="/company-profile"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-amber-200 bg-white px-3.5 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-50"
        >
          Set target
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
