/**
 * UpgradePrompt — Context-aware inline upgrade nudge.
 *
 * Design principles:
 * - Appears INLINE (never modal)
 * - Shows value BEFORE asking for payment
 * - Always allows partial access ("continue with limits")
 * - Feels like a continuation of value, not a paywall
 */
import React from 'react';
import { Sparkles, ArrowRight, Zap, TrendingUp, Crown } from 'lucide-react';

export type UpgradeContext =
  | 'report_generated'
  | 'content_limit'
  | 'campaign_limit'
  | 'export_locked'
  | 'advanced_feature'
  | 'credits_low'
  | 'credits_depleted'
  | 'scaling_usage';

interface UpgradePromptProps {
  context: UpgradeContext;
  /** What the user just accomplished (shown as proof of value) */
  achievement?: string;
  /** What they'll unlock by upgrading */
  unlockMessage?: string;
  /** Current usage count (e.g. "3 blogs created") */
  currentUsage?: number;
  /** Limit on the free tier */
  freeLimit?: number;
  /** Unit label (e.g. "blogs", "campaigns", "credits") */
  unitLabel?: string;
  /** Custom CTA text */
  ctaText?: string;
  /** Called when user clicks upgrade */
  onUpgrade?: () => void;
  /** Called when user chooses to continue with limits */
  onContinue?: () => void;
  /** Hide the "continue with limits" option */
  hideContinue?: boolean;
  /** Compact mode for sidebar/inline placement */
  compact?: boolean;
  className?: string;
}

const CONTEXT_CONFIG: Record<UpgradeContext, {
  icon: React.ElementType;
  iconColor: string;
  bgColor: string;
  borderColor: string;
  title: string;
  description: string;
  ctaDefault: string;
  continueLabel: string;
}> = {
  report_generated: {
    icon: TrendingUp,
    iconColor: 'text-emerald-600',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
    title: 'Your report is ready',
    description: 'Unlock full insights, competitive benchmarks, and export options.',
    ctaDefault: 'Unlock Full Report',
    continueLabel: 'View summary version',
  },
  content_limit: {
    icon: Sparkles,
    iconColor: 'text-indigo-600',
    bgColor: 'bg-indigo-50',
    borderColor: 'border-indigo-200',
    title: 'You\'re on a roll!',
    description: 'Upgrade to create unlimited content with AI assistance.',
    ctaDefault: 'Unlock Unlimited Content',
    continueLabel: 'Continue with free tier',
  },
  campaign_limit: {
    icon: Zap,
    iconColor: 'text-amber-600',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    title: 'Ready to scale your campaigns',
    description: 'Run multiple campaigns across channels simultaneously.',
    ctaDefault: 'Unlock Multi-Campaign',
    continueLabel: 'Keep current campaign',
  },
  export_locked: {
    icon: ArrowRight,
    iconColor: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    title: 'Export your work',
    description: 'Download reports, export content, and share with your team.',
    ctaDefault: 'Unlock Exports',
    continueLabel: 'View online only',
  },
  advanced_feature: {
    icon: Crown,
    iconColor: 'text-purple-600',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
    title: 'Advanced feature',
    description: 'This feature is available on Growth and Pro plans.',
    ctaDefault: 'See Plans',
    continueLabel: 'Continue without this',
  },
  credits_low: {
    icon: Zap,
    iconColor: 'text-amber-600',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    title: 'Credits running low',
    description: 'Top up to keep creating without interruption.',
    ctaDefault: 'Get More Credits',
    continueLabel: 'Use remaining credits',
  },
  credits_depleted: {
    icon: Zap,
    iconColor: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    title: 'Credits used up',
    description: 'You\'ve used all your credits. Upgrade or purchase more to continue.',
    ctaDefault: 'Get Credits',
    continueLabel: 'Earn free credits',
  },
  scaling_usage: {
    icon: TrendingUp,
    iconColor: 'text-indigo-600',
    bgColor: 'bg-indigo-50',
    borderColor: 'border-indigo-200',
    title: 'You\'re growing fast',
    description: 'Your usage shows you\'re ready for the next level.',
    ctaDefault: 'See Growth Plan',
    continueLabel: 'Stay on current plan',
  },
};

export default function UpgradePrompt({
  context,
  achievement,
  unlockMessage,
  currentUsage,
  freeLimit,
  unitLabel = 'items',
  ctaText,
  onUpgrade,
  onContinue,
  hideContinue = false,
  compact = false,
  className = '',
}: UpgradePromptProps) {
  const config = CONTEXT_CONFIG[context];
  const Icon = config.icon;
  const usagePercent = freeLimit && currentUsage ? Math.min(100, Math.round((currentUsage / freeLimit) * 100)) : null;

  const handleUpgrade = () => {
    // Track the upgrade intent
    if (typeof window !== 'undefined') {
      try {
        fetch('/api/analytics/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventName: 'upgrade_clicked',
            metadata: { context, currentUsage, freeLimit },
          }),
        }).catch(() => {});
      } catch {}
    }
    onUpgrade?.();
  };

  if (compact) {
    return (
      <div className={`rounded-lg border ${config.borderColor} ${config.bgColor} p-3 ${className}`}>
        <div className="flex items-center gap-2 mb-1.5">
          <Icon className={`h-4 w-4 ${config.iconColor}`} />
          <span className="text-xs font-semibold text-gray-900">{config.title}</span>
        </div>
        {achievement && (
          <p className="text-xs text-gray-600 mb-2">✓ {achievement}</p>
        )}
        <button
          onClick={handleUpgrade}
          className="w-full text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
        >
          {ctaText || config.ctaDefault}
        </button>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border ${config.borderColor} ${config.bgColor} p-5 ${className}`}>
      <div className="flex items-start gap-4">
        <div className={`p-2 rounded-lg bg-white/80 shadow-sm`}>
          <Icon className={`h-5 w-5 ${config.iconColor}`} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-gray-900">{config.title}</h3>

          {/* Achievement — proof of value */}
          {achievement && (
            <p className="text-sm text-gray-700 mt-1 flex items-center gap-1.5">
              <span className="text-emerald-500">✓</span> {achievement}
            </p>
          )}

          {/* Usage progress bar */}
          {usagePercent !== null && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                <span>{currentUsage} / {freeLimit} {unitLabel} used</span>
                <span className="font-medium">{usagePercent}%</span>
              </div>
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    usagePercent >= 90 ? 'bg-red-500' : usagePercent >= 70 ? 'bg-amber-500' : 'bg-indigo-500'
                  }`}
                  style={{ width: `${usagePercent}%` }}
                />
              </div>
            </div>
          )}

          {/* Description / unlock message */}
          <p className="text-sm text-gray-600 mt-2">
            {unlockMessage || config.description}
          </p>

          {/* CTA buttons */}
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <button
              onClick={handleUpgrade}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-sm"
            >
              {ctaText || config.ctaDefault}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
            {!hideContinue && onContinue && (
              <button
                onClick={onContinue}
                className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                {config.continueLabel}
              </button>
            )}
          </div>

          {/* Trust builders */}
          <p className="text-[11px] text-gray-400 mt-2">
            No credit card required · Cancel anytime
          </p>
        </div>
      </div>
    </div>
  );
}
