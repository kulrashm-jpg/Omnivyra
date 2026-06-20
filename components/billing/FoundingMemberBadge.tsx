import React from 'react';
import { FOUNDING_MEMBER } from '@/lib/billing/commercialPlans';

/**
 * Founding Member badge + optional explanation. Pure presentation; reuse on the
 * pricing page and anywhere billing appears. No urgency / countdown / scarcity.
 */
export function FoundingMemberBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-700 ${className}`}
    >
      ★ {FOUNDING_MEMBER.badgeLabel}
    </span>
  );
}

export function FoundingMemberExplanation({ className = '' }: { className?: string }) {
  return (
    <div className={`rounded-2xl border border-amber-200 bg-amber-50/60 px-5 py-4 ${className}`}>
      <div className="flex items-center gap-2">
        <FoundingMemberBadge />
        <span className="text-sm font-black text-amber-800">{FOUNDING_MEMBER.heading}</span>
      </div>
      <p className="mt-2 text-sm leading-6 text-amber-900/80">{FOUNDING_MEMBER.explanation}</p>
    </div>
  );
}

export default FoundingMemberBadge;
