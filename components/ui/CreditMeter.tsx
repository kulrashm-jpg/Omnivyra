import React, { useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CategoryUsage {
  label: string;
  percent: number;   // 0–100
  credits: number;
  color: string;     // tailwind bg- class
}

type CreditMeterProps = {
  totalCredits?: number;
  remainingCredits?: number;
  /** Category breakdown for the detailed view */
  categories?: CategoryUsage[];
  /** Called when user toggles Smart Mode */
  onSmartModeChange?: (enabled: boolean) => void;
  smartModeEnabled?: boolean;
  /** 'full' = card, 'compact' = navbar bar, 'inline' = summary only */
  variant?: 'full' | 'compact' | 'inline';
  className?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString();
}

function usageColor(pctUsed: number): string {
  if (pctUsed >= 95) return 'from-red-500 to-red-600';
  if (pctUsed >= 80) return 'from-amber-400 to-orange-500';
  return 'from-[#0A66C2] to-[#3FA9F5]';
}

function alertLevel(pctUsed: number): null | 'warning' | 'critical' {
  if (pctUsed >= 95) return 'critical';
  if (pctUsed >= 80) return 'warning';
  return null;
}

// ── Compact variant (navbar) ──────────────────────────────────────────────────

function CompactMeter({ totalCredits, remainingCredits, className }: CreditMeterProps) {
  const pctUsed = totalCredits! > 0 ? ((totalCredits! - remainingCredits!) / totalCredits!) * 100 : 0;
  const pctLeft = 100 - pctUsed;
  const alert = alertLevel(pctUsed);

  return (
    <div
      className={`flex items-center gap-2 shrink-0 ${className}`}
      title="AI Credits remaining"
    >
      <div className="h-1.5 w-16 rounded-full overflow-hidden bg-gray-200" aria-hidden>
        <div
          className={`h-full rounded-full transition-all bg-gradient-to-r ${usageColor(pctUsed)}`}
          style={{ width: `${Math.min(100, Math.max(0, pctLeft))}%` }}
        />
      </div>
      <span className={`text-sm font-semibold whitespace-nowrap ${alert === 'critical' ? 'text-red-600' : alert === 'warning' ? 'text-amber-600' : 'text-gray-700'}`}>
        {fmt(remainingCredits!)} credits
      </span>
    </div>
  );
}

// ── Full variant ──────────────────────────────────────────────────────────────

export function CreditMeter({
  totalCredits = 25000,
  remainingCredits = 18420,
  categories,
  onSmartModeChange,
  smartModeEnabled = true,
  variant = 'full',
  className = '',
}: CreditMeterProps) {
  const [expanded, setExpanded] = useState(false);

  const used = totalCredits - remainingCredits;
  const pctUsed = totalCredits > 0 ? (used / totalCredits) * 100 : 0;
  const pctLeft = 100 - pctUsed;
  const alert = alertLevel(pctUsed);

  if (variant === 'compact') {
    return (
      <CompactMeter
        totalCredits={totalCredits}
        remainingCredits={remainingCredits}
        className={className}
      />
    );
  }

  if (variant === 'inline') {
    return (
      <div className={`flex items-center gap-3 ${className}`}>
        <div className="flex-1 h-2 rounded-full overflow-hidden bg-gray-100">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${usageColor(pctUsed)} transition-all`}
            style={{ width: `${Math.min(100, pctLeft)}%` }}
          />
        </div>
        <span className="text-xs font-semibold text-gray-700 whitespace-nowrap">
          {fmt(remainingCredits)} / {fmt(totalCredits)}
        </span>
      </div>
    );
  }

  // Default: 'full' card
  const savingsSuggestion = getSavingsSuggestion(categories);

  return (
    <div className={`rounded-2xl border border-gray-200 bg-white shadow-sm ${className}`}>
      {/* Header */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-gray-800">Credits</p>
          {onSmartModeChange && (
            <button
              onClick={() => onSmartModeChange(!smartModeEnabled)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all ${
                smartModeEnabled
                  ? 'bg-[#0A66C2]/10 text-[#0A66C2]'
                  : 'bg-gray-100 text-gray-500'
              }`}
              title="Smart Mode batches operations and avoids redundant scans to save credits"
            >
              <span className={`h-1.5 w-1.5 rounded-full ${smartModeEnabled ? 'bg-[#0A66C2]' : 'bg-gray-400'}`} />
              Smart Mode {smartModeEnabled ? 'ON' : 'OFF'}
            </button>
          )}
        </div>

        {/* Progress bar */}
        <div
          className="h-2 w-full rounded-full overflow-hidden bg-gray-100"
          role="progressbar"
          aria-valuenow={remainingCredits}
          aria-valuemin={0}
          aria-valuemax={totalCredits}
          aria-label={`${fmt(remainingCredits)} of ${fmt(totalCredits)} credits remaining`}
        >
          <div
            className={`h-full rounded-full transition-all duration-300 bg-gradient-to-r ${usageColor(pctUsed)}`}
            style={{ width: `${Math.min(100, Math.max(0, pctLeft))}%` }}
          />
        </div>

        {/* Numbers */}
        <div className="mt-2 flex items-baseline justify-between">
          <p className="text-sm">
            <span className="font-bold text-gray-900">{fmt(used)}</span>
            <span className="text-gray-500 text-xs ml-1">used</span>
          </p>
          <p className="text-sm">
            <span className={`font-bold ${alert === 'critical' ? 'text-red-600' : alert === 'warning' ? 'text-amber-600' : 'text-gray-900'}`}>
              {fmt(remainingCredits)}
            </span>
            <span className="text-gray-500 text-xs ml-1">remaining</span>
          </p>
        </div>

        {/* Alert banner */}
        {alert === 'critical' && (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2">
            <span className="text-sm">🔴</span>
            <p className="text-xs font-medium text-red-700">
              You&apos;ve used {Math.round(pctUsed)}% of your credits. Top up to avoid interruptions.
            </p>
          </div>
        )}
        {alert === 'warning' && (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2">
            <span className="text-sm">⚠️</span>
            <p className="text-xs font-medium text-amber-700">
              Approaching limit ({Math.round(pctUsed)}% used). Consider topping up soon.
            </p>
          </div>
        )}
      </div>

      {/* Category breakdown */}
      {categories && categories.length > 0 && (
        <div className="border-t border-gray-100 px-5 py-4">
          <button
            className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3"
            onClick={() => setExpanded(e => !e)}
          >
            Top usage
            <span className="text-gray-400">{expanded ? '▲' : '▼'}</span>
          </button>

          <div className="space-y-2">
            {(expanded ? categories : categories.slice(0, 3)).map(cat => (
              <div key={cat.label}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs text-gray-600">{cat.label}</span>
                  <span className="text-xs font-medium text-gray-800">{cat.percent}% · {fmt(cat.credits)} cr</span>
                </div>
                <div className="h-1.5 w-full rounded-full overflow-hidden bg-gray-100">
                  <div
                    className={`h-full rounded-full ${cat.color}`}
                    style={{ width: `${cat.percent}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Savings suggestion */}
      {savingsSuggestion && (
        <div className="border-t border-gray-100 px-5 py-3">
          <div className="flex items-start gap-2">
            <span className="text-sm mt-0.5">💡</span>
            <p className="text-xs leading-relaxed text-gray-600">{savingsSuggestion}</p>
          </div>
        </div>
      )}

      {/* Top up link */}
      <div className="border-t border-gray-100 px-5 py-3">
        <a
          href="/pricing#addons"
          className="text-xs font-medium text-[#0A66C2] hover:underline"
        >
          Buy more credits →
        </a>
      </div>
    </div>
  );
}

// ── Savings suggestion logic ──────────────────────────────────────────────────

function getSavingsSuggestion(categories?: CategoryUsage[]): string | null {
  if (!categories || categories.length === 0) return null;
  const top = [...categories].sort((a, b) => b.percent - a.percent)[0];
  if (!top) return null;

  if (top.label.toLowerCase().includes('content') && top.percent > 30) {
    return `You can save ~15% credits by batching content generation — run all posts for the week in one session.`;
  }
  if (top.label.toLowerCase().includes('insight') && top.percent > 35) {
    return `Smart Mode is consolidating your daily scans. You're already saving credits on redundant insight runs.`;
  }
  if (top.label.toLowerCase().includes('campaign') && top.percent > 40) {
    return `Run campaign optimisation scans weekly instead of daily to reduce credit spend by up to 20%.`;
  }
  return `Smart Mode is active — redundant scans are being skipped automatically.`;
}

// ── Default export (backward compat) ─────────────────────────────────────────

export default CreditMeter;
