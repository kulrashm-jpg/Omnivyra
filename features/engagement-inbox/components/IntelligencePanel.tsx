import { Lightbulb, ShieldCheck, Zap } from 'lucide-react';
import type { IntelligenceState } from '../types';

export interface IntelligencePanelProps {
  intelligence: IntelligenceState;
  intelligenceBusy: boolean;
  onTryRecommendation: () => void;
}

export default function IntelligencePanel({
  intelligence,
  intelligenceBusy,
  onTryRecommendation,
}: IntelligencePanelProps) {
  return (
    <>
      {/*
        Intelligence block.
        · Insight line (max 1) under the suggestion panel.
        · Confidence badge always shown when intelligence loaded.
        · Recommendation CTA only when confidence === 'high'.
        Hidden entirely if no useful data arrived.
      */}
      {intelligence && (intelligence.insight || intelligence.confidence) && (
        <div className="space-y-1.5 pt-1">
          {intelligence.insight && (
            <div className="flex items-start gap-1.5 text-xs text-gray-700">
              <Lightbulb className="h-3.5 w-3.5 mt-0.5 text-amber-500 shrink-0" />
              <span>{intelligence.insight}</span>
            </div>
          )}
          {intelligence.confidence && (
            <div className="flex items-center gap-1.5 text-xs">
              <ShieldCheck
                className={`h-3.5 w-3.5 ${
                  intelligence.confidence.level === 'high'
                    ? 'text-green-600'
                    : intelligence.confidence.level === 'medium'
                    ? 'text-yellow-600'
                    : 'text-gray-400'
                }`}
              />
              <span className="text-gray-600">
                Execution Confidence:{' '}
                <span className="font-medium capitalize">
                  {intelligence.confidence.level}
                </span>{' '}
                ({intelligence.confidence.score}%)
              </span>
            </div>
          )}
          {intelligence.confidence?.level === 'high' &&
            intelligence.recommendation && (
              <div className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs flex items-center justify-between gap-2">
                <div className="flex items-start gap-1.5 min-w-0">
                  <Zap className="h-3.5 w-3.5 text-emerald-600 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium text-emerald-900">
                      Suggested Action
                    </div>
                    <div className="text-emerald-800 truncate">
                      {intelligence.recommendation.label}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onTryRecommendation}
                  className="px-2 py-1 rounded bg-emerald-600 text-white text-[11px] hover:bg-emerald-700 shrink-0"
                >
                  Try This
                </button>
              </div>
            )}
        </div>
      )}
      {intelligenceBusy && !intelligence && (
        <p className="text-[11px] text-gray-400">Analyzing context…</p>
      )}
    </>
  );
}
