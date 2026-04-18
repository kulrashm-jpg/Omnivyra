/**
 * UsageLimitBanner — Shows progress toward usage limits.
 *
 * Appears as a slim banner below the header or inline within a section.
 * Non-intrusive: informs without blocking.
 */
import React from 'react';
import { Zap, ArrowRight } from 'lucide-react';

interface UsageLimitBannerProps {
  /** Current usage count */
  used: number;
  /** Maximum allowed on current plan */
  limit: number;
  /** What's being counted (e.g. "blogs", "campaigns", "AI generations") */
  label: string;
  /** Message shown when approaching limit (>80%) */
  warningMessage?: string;
  /** Message shown when at limit (100%) */
  limitMessage?: string;
  /** Called when user clicks the upgrade action */
  onUpgrade?: () => void;
  /** Completely hide when usage is below 50% */
  hideWhenLow?: boolean;
  className?: string;
}

export default function UsageLimitBanner({
  used,
  limit,
  label,
  warningMessage,
  limitMessage,
  onUpgrade,
  hideWhenLow = true,
  className = '',
}: UsageLimitBannerProps) {
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const remaining = Math.max(0, limit - used);
  const isAtLimit = used >= limit;
  const isWarning = percent >= 80;
  const isLow = percent < 50;

  // Don't show when usage is low (below 50%) — no need to nag
  if (hideWhenLow && isLow) return null;

  const bgColor = isAtLimit ? 'bg-red-50 border-red-200' : isWarning ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200';
  const textColor = isAtLimit ? 'text-red-800' : isWarning ? 'text-amber-800' : 'text-gray-700';
  const barColor = isAtLimit ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-indigo-500';
  const message = isAtLimit
    ? (limitMessage || `You've used all ${limit} ${label}. Upgrade for more.`)
    : isWarning
      ? (warningMessage || `${remaining} ${label} remaining this month.`)
      : `${used} of ${limit} ${label} used`;

  return (
    <div className={`rounded-lg border ${bgColor} px-4 py-2.5 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Zap className={`h-4 w-4 flex-shrink-0 ${isAtLimit ? 'text-red-500' : isWarning ? 'text-amber-500' : 'text-gray-400'}`} />
          <span className={`text-xs font-medium ${textColor} truncate`}>{message}</span>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Compact progress bar */}
          <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden hidden sm:block">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barColor}`}
              style={{ width: `${percent}%` }}
            />
          </div>
          {(isWarning || isAtLimit) && onUpgrade && (
            <button
              onClick={onUpgrade}
              className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors whitespace-nowrap"
            >
              {isAtLimit ? 'Get more' : 'Upgrade'}
              <ArrowRight className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
