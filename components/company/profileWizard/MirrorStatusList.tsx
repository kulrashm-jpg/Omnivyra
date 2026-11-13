/**
 * Shows which items reach Market Pulse (UI step 6.4c; owner decision 6, 55's wording,
 * 05's disclosure point). Both reasons an item doesn't reach the AI are disclosed in one
 * place: the 8-item cap (still used for scoring) and the shape filter (not mirrored).
 */
import React from 'react';
import { MARKET_PULSE_AI_CAP, buildMirror, mirrorStatusFor, type MirrorStatus } from '../../../utils/profileMarketPulseMirror';

const BADGE: Record<MirrorStatus, { label: string; className: string }> = {
  sent_to_ai: { label: 'Sent to the AI', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  scoring_only: { label: 'Used for scoring (not sent to the AI)', className: 'bg-slate-50 text-slate-600 border-slate-200' },
  too_long: { label: 'Too long for Market Pulse: shorten it to include it', className: 'bg-amber-50 text-amber-800 border-amber-200' },
  paragraph: { label: 'Looks like a paragraph: use one short phrase to include it in Market Pulse', className: 'bg-amber-50 text-amber-800 border-amber-200' },
};

export function MirrorStatusList({
  items,
  existingMarketPulse,
}: {
  /** The profile items the user entered (one phrase each). */
  items: readonly string[];
  /** The Market Pulse entries already stored (they come first in the mirror). */
  existingMarketPulse: readonly string[] | null | undefined;
}) {
  if (items.length === 0) return null;
  const { mirror } = buildMirror(existingMarketPulse, items);
  const overCap = mirror.length > MARKET_PULSE_AI_CAP;
  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3" data-testid="mirror-status">
      <p className="text-xs text-slate-600">
        The first {MARKET_PULSE_AI_CAP} are sent to the AI; all items are used for relevance scoring.
      </p>
      {overCap && (
        <p className="mt-1 text-xs font-medium text-slate-700">
          You have more than {MARKET_PULSE_AI_CAP} items: the extra ones are not sent to the AI.
        </p>
      )}
      <ul className="mt-2 space-y-1">
        {items.map((item) => {
          const status = mirrorStatusFor(item, mirror);
          const badge = BADGE[status];
          return (
            <li key={item} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-800">{item}</span>
              <span className={`rounded-full border px-2 py-0.5 ${badge.className}`}>{badge.label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
