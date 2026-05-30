/**
 * Variant shared contexts (P2-1 + P2-2).
 *
 * Two thin React contexts that let downstream consumers SHARE one
 * `useStrategyAnalytics` + one `useOperatorControls` fetch instead of
 * each surface mounting its own.
 *
 * The accompanying hooks (`useSharedStrategyAnalytics`,
 * `useSharedOperatorControls`) read from context when a provider is
 * mounted upstream and FALL BACK to the original direct-fetch hooks
 * when no provider is present. Existing components that don't migrate
 * keep working exactly as before.
 *
 * Pure UI plumbing. No backend changes.
 */

import React, { createContext, useContext } from 'react';
import {
  type OperatorControls,
  type StrategyAnalyticsPayload,
  useOperatorControls as useOperatorControlsDirect,
  useStrategyAnalytics as useStrategyAnalyticsDirect,
} from './useVariantApi';

/* ── Analytics context (P2-1) ──────────────────────────────────── */

type AnalyticsValue = {
  loading: boolean;
  error: string | null;
  data: StrategyAnalyticsPayload | null;
  refetch: () => void;
};

const VariantAnalyticsContext = createContext<AnalyticsValue | null>(null);

/**
 * Provider that owns the analytics fetch for the subtree. Mount once
 * at app shell level. All `useSharedStrategyAnalytics` consumers
 * subscribe to the same fetch result.
 */
export const VariantAnalyticsProvider: React.FC<{
  companyId: string;
  window?: '7d' | '30d' | '90d' | 'all_time';
  campaignId?: string | null;
  platform?: string | null;
  children: React.ReactNode;
}> = ({ companyId, window, campaignId, platform, children }) => {
  const data = useStrategyAnalyticsDirect({ companyId, window, campaignId, platform });
  return (
    <VariantAnalyticsContext.Provider value={data}>
      {children}
    </VariantAnalyticsContext.Provider>
  );
};

/**
 * Subscribe to the shared analytics fetch when a provider is mounted
 * upstream. Falls back to a per-consumer direct fetch when no
 * provider is present so legacy callers continue working.
 *
 * `args` is honored ONLY in fallback mode (when no provider). With a
 * provider, the provider's args win.
 */
export function useSharedStrategyAnalytics(args: {
  companyId: string;
  window?: '7d' | '30d' | '90d' | 'all_time';
  campaignId?: string | null;
  platform?: string | null;
  /** P2-3 — when false, the hook short-circuits and returns the empty
   *  state without firing any fetch. Used by lazy panels. */
  enabled?: boolean;
}): AnalyticsValue {
  const ctx = useContext(VariantAnalyticsContext);
  // Always call the fallback hook (Rules of Hooks). When a provider is
  // present, the provider's data is returned instead.
  const fallback = useStrategyAnalyticsDirect({
    companyId: (args.enabled ?? true) ? args.companyId : '',
    window: args.window,
    campaignId: args.campaignId,
    platform: args.platform,
  });
  if (ctx) return ctx;
  return fallback;
}

/* ── Operator-controls context (P2-2) ──────────────────────────── */

type OperatorControlsValue = {
  loading: boolean;
  error: string | null;
  controls: OperatorControls | null;
  defaults: OperatorControls | null;
  refetch: () => void;
  update: (patch: Partial<OperatorControls>) => Promise<OperatorControls | null>;
};

const VariantOperatorControlsContext = createContext<OperatorControlsValue | null>(null);

export const VariantOperatorControlsProvider: React.FC<{
  companyId: string;
  children: React.ReactNode;
}> = ({ companyId, children }) => {
  const data = useOperatorControlsDirect(companyId);
  return (
    <VariantOperatorControlsContext.Provider value={data}>
      {children}
    </VariantOperatorControlsContext.Provider>
  );
};

export function useSharedOperatorControls(companyId: string): OperatorControlsValue {
  const ctx = useContext(VariantOperatorControlsContext);
  const fallback = useOperatorControlsDirect(companyId);
  if (ctx) return ctx;
  return fallback;
}

/* ── Combined provider — single mount for both ────────────────── */

/**
 * Convenience wrapper that mounts both providers. Embedders pass
 * `companyId` once and downstream consumers get shared fetches.
 */
export const VariantExperienceProvider: React.FC<{
  companyId: string;
  window?: '7d' | '30d' | '90d' | 'all_time';
  campaignId?: string | null;
  platform?: string | null;
  children: React.ReactNode;
}> = ({ companyId, window, campaignId, platform, children }) => (
  <VariantAnalyticsProvider companyId={companyId} window={window} campaignId={campaignId} platform={platform}>
    <VariantOperatorControlsProvider companyId={companyId}>
      {children}
    </VariantOperatorControlsProvider>
  </VariantAnalyticsProvider>
);
