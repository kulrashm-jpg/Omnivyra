/**
 * Client-side hooks for the variant execution + experiment + operator
 * control + strategy-analytics APIs.
 *
 * All hooks use `apiFetch` so the Supabase Bearer token is added
 * automatically. Failures are surfaced via `error` + the synthetic 503
 * response that `apiFetch` returns on network failure — no exception
 * bubbles into the rendering tree.
 *
 * Pure UI glue. No business logic. No backend changes.
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/apiFetch';

/* ── Shared types (mirror backend; not imported to avoid pulling
 *    server-only modules into the bundle) ──────────────────────── */

export type VariantExecutionMode =
  | 'single_variant'
  | 'best_variant'
  | 'top_3_variants'
  | 'experiment';

export type VariantFamily = 'v1' | 'v2' | 'v3';

export type VariantDefinition = {
  variant_id: string;
  variant_family: VariantFamily;
  strategy_id: string;
  content_type: 'image' | 'carousel' | 'infographic';
  display_name: string;
  description: string;
  exploration_dimensions: ReadonlyArray<string>;
};

export type VariantSelectionDecision = {
  rank: number;
  variant: VariantDefinition;
  reasoning: string;
  source:
    | 'caller_pinned'
    | 'winner_engine'
    | 'baseline_fallback'
    | 'experiment_fan_out'
    | 'operator_forced';
};

export type VariantExecutionResult = {
  resolvedMode: VariantExecutionMode;
  strategyId: string;
  decisions: VariantSelectionDecision[];
  experimentId: string | null;
  appliedOverrides: ReadonlyArray<
    | 'experiment_disabled'
    | 'variant_exploration_disabled'
    | 'forced_baseline_v1'
    | 'forced_winning_variant'
  >;
  modeRationale: string;
};

export type OperatorControls = {
  experimentModeDisabled: boolean;
  variantExplorationDisabled: boolean;
  forceBaselineV1: boolean;
  forceWinningVariant: boolean;
};

export type ExperimentRecord = {
  experiment_id: string;
  company_id: string;
  campaign_id: string | null;
  strategy_id: string;
  mode: VariantExecutionMode;
  assets: Array<{
    variant_id: string;
    variant_family: string;
    asset_id: string | null;
    scheduled_post_id: string | null;
    state: 'created' | 'generated' | 'published' | 'engaged' | 'completed';
  }>;
  state: 'created' | 'generated' | 'published' | 'engaged' | 'completed';
  correlation_id: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VariantWinner = {
  strategy_id: string;
  strategy_family: string | null;
  content_type: string | null;
  winner: { variant_id: string; variant_family: string; metrics: any } | null;
  runner_up: { variant_id: string; variant_family: string; metrics: any } | null;
  metric: string;
  delta: number | null;
  confidence: 'low' | 'medium' | 'high';
  sampleSize: number;
  insufficientData: boolean;
  insufficientReason: string | null;
};

/* ── Hook: plan a variant execution ─────────────────────────── */

export type PlanVariantInput = {
  companyId: string;
  strategyId: string;
  mode: VariantExecutionMode;
  variantFamily?: VariantFamily | null;
  variantId?: string | null;
  campaignId?: string | null;
  platform?: string | null;
  window?: '7d' | '30d' | '90d' | 'all_time';
  contentType?: 'image' | 'carousel' | 'infographic';
  correlationId?: string | null;
};

export type UseVariantPlannerState = {
  loading: boolean;
  error: string | null;
  result: VariantExecutionResult | null;
  operatorControls: OperatorControls | null;
};

export function useVariantPlanner(): UseVariantPlannerState & {
  plan: (input: PlanVariantInput) => Promise<VariantExecutionResult | null>;
  reset: () => void;
} {
  const [state, setState] = useState<UseVariantPlannerState>({
    loading: false,
    error: null,
    result: null,
    operatorControls: null,
  });

  const plan = useCallback(async (input: PlanVariantInput): Promise<VariantExecutionResult | null> => {
    if (!input.companyId || !input.strategyId) {
      setState((s) => ({ ...s, error: 'companyId and strategyId required', result: null }));
      return null;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const response = await apiFetch('/api/creator-intelligence/variant-execution-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: input.companyId,
          strategy_id: input.strategyId,
          mode: input.mode,
          variant_family: input.variantFamily ?? null,
          variant_id: input.variantId ?? null,
          campaign_id: input.campaignId ?? null,
          platform: input.platform ?? null,
          window: input.window ?? null,
          content_type: input.contentType ?? null,
          correlation_id: input.correlationId ?? null,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data?.success) {
        const message = data?.error || `Request failed (${response.status})`;
        setState({ loading: false, error: message, result: null, operatorControls: null });
        return null;
      }
      setState({
        loading: false,
        error: null,
        result: data.plan as VariantExecutionResult,
        operatorControls: data.operator_controls as OperatorControls,
      });
      return data.plan as VariantExecutionResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setState({ loading: false, error: message, result: null, operatorControls: null });
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setState({ loading: false, error: null, result: null, operatorControls: null });
  }, []);

  return { ...state, plan, reset };
}

/* ── Hook: strategy analytics + experiment dashboard ────────── */

export type StrategyAnalyticsPayload = {
  scope: { companyId: string; campaignId: string | null; platform: string | null; creatorId: string | null; window: string };
  leaderboards: any;
  comparisons: any[];
  insights: any[];
  signals: any[];
  trends: any[];
  explainability: any[];
  dimensions: Array<{
    content_type: 'image' | 'carousel' | 'infographic';
    strategy_id: string;
    strategy_family: string;
    layout_type: string;
    render_strategy_id: string;
    purpose_family: string;
  }>;
  variants: {
    catalog: VariantDefinition[];
    leaderboards: Array<{ strategy_id: string; leaderboard: any[] }>;
    winners: VariantWinner[];
    insights: any[];
    signals: any[];
    trends: any[];
  };
  execution: {
    active_experiments: ExperimentRecord[];
    completed_experiments: ExperimentRecord[];
    winner_recommendations: VariantWinner[];
    operator_controls: OperatorControls;
    summary: {
      total_experiments_in_scope: number;
      strategies_with_declared_winner: number;
      strategies_without_winner: number;
    };
  };
};

export function useStrategyAnalytics(input: {
  companyId: string;
  campaignId?: string | null;
  platform?: string | null;
  window?: '7d' | '30d' | '90d' | 'all_time';
  refreshKey?: number;
}): {
  loading: boolean;
  error: string | null;
  data: StrategyAnalyticsPayload | null;
  refetch: () => void;
} {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<StrategyAnalyticsPayload | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!input.companyId) return;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set('company_id', input.companyId);
        if (input.campaignId) params.set('campaign_id', input.campaignId);
        if (input.platform) params.set('platform', input.platform);
        if (input.window) params.set('window', input.window);
        const response = await apiFetch(`/api/creator-intelligence/strategy-analytics?${params.toString()}`);
        const payload = await response.json();
        if (cancelled) return;
        if (!response.ok || !payload?.success) {
          setError(payload?.error || `Request failed (${response.status})`);
          setData(null);
        } else {
          setData(payload as StrategyAnalyticsPayload);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Unknown error');
        setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [input.companyId, input.campaignId, input.platform, input.window, input.refreshKey, tick]);

  return {
    loading,
    error,
    data,
    refetch: useCallback(() => setTick((t) => t + 1), []),
  };
}

/* ── Hook: operator controls (read + write) ─────────────────── */

/* ── P3-4 — localStorage persistence for operator controls ──────
 * The server keeps its bounded in-memory store. The browser persists
 * the last-saved patch so reloads + restarts surface the operator's
 * preference even after the server-side bounded LRU evicts. On GET
 * the hook merges localStorage on top of the server response; on
 * update both are written.
 */
const OPERATOR_CONTROLS_LS_PREFIX = 'variantOperatorControls:';

function readOperatorControlsLS(companyId: string): Partial<OperatorControls> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(OPERATOR_CONTROLS_LS_PREFIX + companyId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Partial<OperatorControls>;
  } catch {
    return null;
  }
}

function writeOperatorControlsLS(companyId: string, controls: OperatorControls): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(OPERATOR_CONTROLS_LS_PREFIX + companyId, JSON.stringify(controls));
  } catch {
    // Quota / privacy mode — non-fatal.
  }
}

export function useOperatorControls(companyId: string): {
  loading: boolean;
  error: string | null;
  controls: OperatorControls | null;
  defaults: OperatorControls | null;
  refetch: () => void;
  update: (patch: Partial<OperatorControls>) => Promise<OperatorControls | null>;
} {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [controls, setControls] = useState<OperatorControls | null>(null);
  const [defaults, setDefaults] = useState<OperatorControls | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!companyId) return;
      setLoading(true);
      setError(null);
      try {
        const response = await apiFetch(`/api/creator-intelligence/variant-operator-controls?company_id=${encodeURIComponent(companyId)}`);
        const payload = await response.json();
        if (cancelled) return;
        if (!response.ok || !payload?.success) {
          setError(payload?.error || `Request failed (${response.status})`);
        } else {
          // P3-4 — overlay localStorage on the server response. If the
          // server's in-memory store was evicted (LRU) or restarted,
          // the operator's last persisted preference is restored.
          const serverControls = payload.controls as OperatorControls;
          const persistedPatch = readOperatorControlsLS(companyId);
          const effective: OperatorControls = persistedPatch
            ? {
                experimentModeDisabled: persistedPatch.experimentModeDisabled ?? serverControls.experimentModeDisabled,
                variantExplorationDisabled: persistedPatch.variantExplorationDisabled ?? serverControls.variantExplorationDisabled,
                forceBaselineV1: persistedPatch.forceBaselineV1 ?? serverControls.forceBaselineV1,
                forceWinningVariant: persistedPatch.forceWinningVariant ?? serverControls.forceWinningVariant,
              }
            : serverControls;
          setControls(effective);
          setDefaults(payload.defaults as OperatorControls);
          // If localStorage had a non-empty patch AND the server's
          // state differs, sync the server so subsequent fetches
          // see the persisted value without needing localStorage.
          if (persistedPatch && JSON.stringify(effective) !== JSON.stringify(serverControls)) {
            void apiFetch('/api/creator-intelligence/variant-operator-controls', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                company_id: companyId,
                experiment_mode_disabled: effective.experimentModeDisabled,
                variant_exploration_disabled: effective.variantExplorationDisabled,
                force_baseline_v1: effective.forceBaselineV1,
                force_winning_variant: effective.forceWinningVariant,
              }),
            });
          }
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [companyId, tick]);

  const update = useCallback(
    async (patch: Partial<OperatorControls>): Promise<OperatorControls | null> => {
      if (!companyId) return null;
      setLoading(true);
      setError(null);
      try {
        const body: Record<string, unknown> = { company_id: companyId };
        if (patch.experimentModeDisabled !== undefined) body.experiment_mode_disabled = patch.experimentModeDisabled;
        if (patch.variantExplorationDisabled !== undefined) body.variant_exploration_disabled = patch.variantExplorationDisabled;
        if (patch.forceBaselineV1 !== undefined) body.force_baseline_v1 = patch.forceBaselineV1;
        if (patch.forceWinningVariant !== undefined) body.force_winning_variant = patch.forceWinningVariant;
        const response = await apiFetch('/api/creator-intelligence/variant-operator-controls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const payload = await response.json();
        if (!response.ok || !payload?.success) {
          setError(payload?.error || `Request failed (${response.status})`);
          return null;
        }
        const nextControls = payload.controls as OperatorControls;
        setControls(nextControls);
        // P3-4 — mirror to localStorage so the operator's preference
        // survives server-side LRU eviction + restarts.
        writeOperatorControlsLS(companyId, nextControls);
        return nextControls;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        return null;
      } finally {
        setLoading(false);
      }
    },
    [companyId],
  );

  return {
    loading,
    error,
    controls,
    defaults,
    refetch: useCallback(() => setTick((t) => t + 1), []),
    update,
  };
}

/* ── Hook: experiment lifecycle ─────────────────────────────── */

export function useVariantExperiments(input: {
  companyId: string;
  state?: 'all' | 'active' | 'completed';
  refreshKey?: number;
}): {
  loading: boolean;
  error: string | null;
  experiments: ExperimentRecord[];
  refetch: () => void;
  transition: (input: {
    experimentId: string;
    variantId: string;
    state: 'created' | 'generated' | 'published' | 'engaged' | 'completed';
    assetId?: string;
    scheduledPostId?: string;
  }) => Promise<ExperimentRecord | null>;
  complete: (experimentId: string) => Promise<ExperimentRecord | null>;
} {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!input.companyId) return;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set('company_id', input.companyId);
        if (input.state) params.set('state', input.state);
        const response = await apiFetch(`/api/creator-intelligence/variant-experiment?${params.toString()}`);
        const payload = await response.json();
        if (cancelled) return;
        if (!response.ok || !payload?.success) {
          setError(payload?.error || `Request failed (${response.status})`);
          setExperiments([]);
        } else {
          setExperiments(payload.experiments as ExperimentRecord[]);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [input.companyId, input.state, input.refreshKey, tick]);

  const transition = useCallback(
    async (transitionInput: {
      experimentId: string;
      variantId: string;
      state: 'created' | 'generated' | 'published' | 'engaged' | 'completed';
      assetId?: string;
      scheduledPostId?: string;
    }) => {
      if (!input.companyId) return null;
      const response = await apiFetch('/api/creator-intelligence/variant-experiment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'transition',
          company_id: input.companyId,
          experiment_id: transitionInput.experimentId,
          variant_id: transitionInput.variantId,
          state: transitionInput.state,
          asset_id: transitionInput.assetId,
          scheduled_post_id: transitionInput.scheduledPostId,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.success) return null;
      return payload.experiment as ExperimentRecord;
    },
    [input.companyId],
  );

  const complete = useCallback(
    async (experimentId: string) => {
      if (!input.companyId) return null;
      const response = await apiFetch('/api/creator-intelligence/variant-experiment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'complete',
          company_id: input.companyId,
          experiment_id: experimentId,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload?.success) return null;
      return payload.experiment as ExperimentRecord;
    },
    [input.companyId],
  );

  return {
    loading,
    error,
    experiments,
    refetch: useCallback(() => setTick((t) => t + 1), []),
    transition,
    complete,
  };
}
