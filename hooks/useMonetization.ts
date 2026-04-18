/**
 * useMonetization — Centralized monetization logic.
 *
 * Determines when to show upgrade prompts, tracks conversion events,
 * and provides credit-aware decision helpers.
 *
 * Principle: "Pay because of value" — triggers only AFTER value is delivered.
 */
import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import { useCredits } from './useCredits';
import type { UpgradeContext } from '../components/monetization/UpgradePrompt';

interface MonetizationState {
  /** Current credit balance */
  credits: { remaining: number; total: number; loading: boolean };
  /** Whether the user should see an upgrade prompt */
  shouldPrompt: boolean;
  /** The recommended upgrade context to show */
  promptContext: UpgradeContext | null;
  /** Check if user can afford an action */
  canAfford: (cost: number) => boolean;
  /** Navigate to pricing/upgrade page */
  goToUpgrade: (context?: UpgradeContext) => void;
  /** Navigate to earn free credits page */
  goToEarnCredits: () => void;
  /** Track a monetization event */
  trackEvent: (event: string, metadata?: Record<string, unknown>) => void;
  /** Get the credit cost for a specific action */
  getCostForAction: (action: string) => number | undefined;
}

/** Default credit costs (fallback if API unavailable) */
const CREDIT_COSTS: Record<string, number> = {
  ai_reply: 1,
  content_rewrite: 2,
  blog_generation: 15,
  campaign_creation: 40,
  full_strategy: 80,
  report_generation: 20,
  content_generation: 5,
  daily_plan_generation: 10,
  weekly_structure: 25,
};

export function useMonetization(companyId?: string | null): MonetizationState {
  const router = useRouter();
  const { remainingCredits, totalCredits, loading } = useCredits(companyId || '');

  const remaining = remainingCredits ?? 0;
  const total = totalCredits ?? 0;

  const canAfford = useCallback(
    (cost: number) => remaining >= cost,
    [remaining]
  );

  // Determine if and what kind of upgrade prompt to show
  const { shouldPrompt, promptContext } = useMemo(() => {
    if (loading) return { shouldPrompt: false, promptContext: null };

    // Depleted — most urgent
    if (remaining <= 0) {
      return { shouldPrompt: true, promptContext: 'credits_depleted' as UpgradeContext };
    }

    // Low credits — warn at 20%
    if (total > 0 && remaining / total < 0.2) {
      return { shouldPrompt: true, promptContext: 'credits_low' as UpgradeContext };
    }

    // No prompt needed
    return { shouldPrompt: false, promptContext: null };
  }, [remaining, total, loading]);

  const trackEvent = useCallback(
    (event: string, metadata?: Record<string, unknown>) => {
      if (typeof window === 'undefined') return;
      try {
        fetch('/api/analytics/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventName: event,
            companyId,
            metadata: { ...metadata, credits_remaining: remaining },
          }),
        }).catch(() => {});
      } catch {}
    },
    [companyId, remaining]
  );

  const goToUpgrade = useCallback(
    (context?: UpgradeContext) => {
      trackEvent('upgrade_clicked', { context });
      router.push('/pricing');
    },
    [router, trackEvent]
  );

  const goToEarnCredits = useCallback(() => {
    trackEvent('earn_credits_clicked');
    router.push('/get-free-credits');
  }, [router, trackEvent]);

  const getCostForAction = useCallback(
    (action: string) => CREDIT_COSTS[action],
    []
  );

  return {
    credits: { remaining, total, loading },
    shouldPrompt,
    promptContext,
    canAfford,
    goToUpgrade,
    goToEarnCredits,
    trackEvent,
    getCostForAction,
  };
}
