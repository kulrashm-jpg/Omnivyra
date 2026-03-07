import React from 'react';

const TOOLTIP_TEXT =
  'AI Credits are used when running scans, generating content, and analyzing campaigns.';

type CreditMeterProps = {
  /** Total credits allocated */
  totalCredits?: number;
  /** Credits remaining */
  remainingCredits?: number;
  /** Compact variant for navbar: progress bar only + number */
  variant?: 'full' | 'compact';
  className?: string;
};

function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function CreditMeter({
  totalCredits = 25000,
  remainingCredits = 18420,
  variant = 'full',
  className = '',
}: CreditMeterProps) {
  const percentage = totalCredits > 0 ? (remainingCredits / totalCredits) * 100 : 0;

  if (variant === 'compact') {
    return (
      <div
        className={`flex items-center gap-2 shrink-0 ${className}`}
        title={TOOLTIP_TEXT}
      >
        <div
          className="h-1.5 w-16 rounded-full overflow-hidden"
          style={{ backgroundColor: '#E5E7EB' }}
          aria-hidden
        >
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(100, Math.max(0, percentage))}%`,
              background: 'linear-gradient(90deg, #0B5ED7 0%, #1EA7FF 100%)',
            }}
          />
        </div>
        <span className="text-sm font-semibold text-gray-700 whitespace-nowrap">
          {formatNumber(remainingCredits)} credits
        </span>
      </div>
    );
  }

  return (
    <div
      className={`rounded-[12px] border border-gray-200/80 bg-gray-50/80 min-w-[200px] ${className}`}
      style={{ padding: '12px 16px' }}
      title={TOOLTIP_TEXT}
    >
      <p className="text-xs font-medium text-gray-600 mb-2">AI Credits</p>
      <div
        className="h-2 w-full rounded-full overflow-hidden mb-2"
        style={{ height: '8px', backgroundColor: '#E5E7EB' }}
        role="progressbar"
        aria-valuenow={remainingCredits}
        aria-valuemin={0}
        aria-valuemax={totalCredits}
        aria-label={`AI credits: ${formatNumber(remainingCredits)} of ${formatNumber(totalCredits)} remaining`}
      >
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${Math.min(100, Math.max(0, percentage))}%`,
            background: 'linear-gradient(90deg, #0B5ED7 0%, #1EA7FF 100%)',
          }}
        />
      </div>
      <p className="text-sm">
        <span className="font-bold text-gray-900">
          {formatNumber(remainingCredits)} / {formatNumber(totalCredits)}
        </span>
        <span className="text-gray-600 ml-1">remaining</span>
      </p>
    </div>
  );
}
