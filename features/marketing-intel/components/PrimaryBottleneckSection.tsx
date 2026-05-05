import React from 'react';
import { AlertCircle } from 'lucide-react';
import { SectionCard } from '@/features/marketing-intel/components/SectionCard';
import { derivePrimaryBottleneck } from '@/features/marketing-intel/derives';
import {
  type ConfidenceDirection,
  MARKETING_INTEL_OUTCOME_STORAGE_KEY,
  countImprovingOutcomes,
  deriveConstraintConfidence,
  deriveConstraintConfidenceDirection,
  normalizeOutcomeBaselines,
} from '@/features/marketing-intel/outcomeTracking';
import type { MarketingIntelData } from '@/features/marketing-intel/types';

type Props = {
  d: MarketingIntelData;
};

export default function PrimaryBottleneckSection({ d }: Props) {
  const snapshot = d.snapshot;
  if (!snapshot) return null;

  const bottleneck = derivePrimaryBottleneck(snapshot);
  const confidence = deriveConstraintConfidence(snapshot);
  const [confidenceDirection, setConfidenceDirection] = React.useState<ConfidenceDirection>('flat');
  const [confidenceReason, setConfidenceReason] = React.useState<string | null>(null);

  React.useEffect(() => {
    setConfidenceDirection(deriveConstraintConfidenceDirection(snapshot));
    if (typeof window === 'undefined') {
      setConfidenceReason(null);
      return;
    }

    try {
      const saved = window.localStorage.getItem(MARKETING_INTEL_OUTCOME_STORAGE_KEY);
      if (!saved) {
        setConfidenceReason(null);
        return;
      }

      const improvingOutcomes = countImprovingOutcomes(snapshot, normalizeOutcomeBaselines(JSON.parse(saved)));
      setConfidenceReason(improvingOutcomes > 0 ? 'Improving signal after recent actions' : null);
    } catch {
      setConfidenceReason(null);
    }
  }, [snapshot]);

  const confidenceTone =
    confidence === 'High'
      ? 'bg-emerald-50 text-emerald-700'
      : confidence === 'Medium'
          ? 'bg-blue-50 text-blue-700'
          : 'bg-gray-100 text-gray-600';
  const confidenceGlyph = confidenceDirection === 'up' ? '↑' : confidenceDirection === 'down' ? '↓' : '→';

  return (
    <SectionCard
      title="Primary Constraint"
      badge="Main blocker"
      className="h-full"
    >
      <div className="rounded-2xl border border-amber-300 bg-amber-50 py-7 px-6 shadow-md">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full bg-amber-200 p-2.5">
            <AlertCircle className="h-5 w-5 text-amber-800" />
          </div>
            <div className="border-l-[6px] border-amber-500 pl-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <p className="text-lg font-bold text-slate-950">{bottleneck.title}</p>
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${confidenceTone}`}>
                  Confidence: {confidence} {confidenceGlyph}
                </span>
              </div>
            {confidenceReason && (
              <p className="mb-2 text-[11px] font-medium text-slate-500">{confidenceReason}</p>
            )}
            <p className="mt-2 max-w-4xl text-sm leading-[1.6] text-slate-600">{bottleneck.detail}</p>
            <p className="mt-3 text-xs font-medium text-amber-800/90">
              If this is not fixed, the team will keep making scaling decisions on unreliable signal.
            </p>
            <p className="mt-2 text-xs font-semibold text-amber-800">
              Fix rhythm. Then measure. Then scale.
            </p>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
