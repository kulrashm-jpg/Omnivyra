/**
 * usePlannerControl — data hook for the planner control-panel page.
 *
 * Mirrors the auth-gate + polling pattern from `useSysHealth`. Holds the
 * full `/inspect` snapshot in state, refreshes on an interval, exposes
 * imperative `mutate*` helpers for rollout / feature / force-mode actions.
 *
 * Optimistic-UI safety:
 *   - mutate helpers set a per-action `pendingAction` flag so the UI can
 *     disable the button. After the response lands they immediately call
 *     `refetch()` so the new state is read from the server — no client-
 *     side state guessing.
 *   - on failure, the pendingAction flag is cleared and an `error` is set
 *     so the UI can surface a banner.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../components/CompanyContext';

export type RolloutMode =
  | 'legacy'
  | 'distributed_pools_only'
  | 'streaming_only'
  | 'async_refinement'
  | 'full_progressive'
  | 'full_production';

export type RolloutStatus = 'idle' | 'promoting' | 'in_canary' | 'paused' | 'rolled_back';

export interface RolloutState {
  active_mode: RolloutMode;
  target_mode: RolloutMode;
  rollback_mode: RolloutMode;
  status: RolloutStatus;
  canary_started_at: number | null;
  canary_soak_ms: number;
  last_reason: string;
  last_operator_id: string | null;
  updated_at: number;
}

export interface OpsSnapshot {
  taken_at_ms: number;
  cluster_overload: { mode: string; pressure_score: number; source: string } | null;
  semaphore_pools: Array<{
    pool: string; local_active: number; local_pending: number; max_allowed: number;
    distributed_active: number | null; recent_avg_wait_ms: number; fallback_in_use: boolean;
  }>;
  provider_buckets: Array<{
    provider: string; local_tokens: number; distributed_tokens: number | null;
    qps: number; burst: number; distributed_enabled: boolean; distributed_healthy: boolean;
  }>;
  alert_counters: Array<{
    counter: string; recent_local: number; recent_cluster: number | null;
    threshold: number; window_ms: number; total_since_boot: number;
  }>;
  stream_lag: Array<{
    stream: string; length: number; pending: number; oldest_pending_age_ms: number | null;
  }> | null;
  bullmq_pressure: {
    waiting: number; delayed: number; active: number; failed: number;
    pressure_high: boolean; reasons: string[];
  } | null;
}

export interface CanaryGateEvaluation {
  metric: string;
  observed: number | null;
  unhealthy: boolean;
  consecutiveUnhealthy: number;
  consecutiveHealthy: number;
  triggered: boolean;
  cleared: boolean;
  label: string;
}

export interface FeatureRule {
  id: string;
  scopeType: 'global' | 'org' | 'env' | 'instance' | 'percent';
  scopeValue?: string;
  percent?: number;
  effect: 'on' | 'off' | 'default';
  note?: string;
  created_at: number;
  created_by: string | null;
}

export interface FeatureEntry {
  key: string;
  description: string;
  default: boolean;
  rules: FeatureRule[];
  updated_at: number;
}

export interface SplitBrainReport {
  pool: string;
  localActive: number;
  distributedActive: number | null;
  drift: number;
  driftHigh: boolean;
}

export interface OrphanRefinement {
  count: number;
  healthy: boolean;
}

export interface InspectPayload {
  ops_snapshot: OpsSnapshot;
  rollout_state: RolloutState;
  rollout_audit_recent: Array<Record<string, string>>;
  canary_gates: CanaryGateEvaluation[];
  feature_registry: FeatureEntry[];
  split_brain_report: SplitBrainReport[];
  orphan_refinement: OrphanRefinement | null;
  active_sse_connections: number | null;
}

export type RolloutAction = 'promote' | 'rollback' | 'pause' | 'resume' | 'reset';
export type ForceModeAction = 'force_degradation' | 'force_recovery' | 'force_lease_reclamation';
export type ForceDegradationMode = 'elevated' | 'degraded' | 'critical';

/** Auto-refresh interval. 5s by default — control-plane data is cheap. */
const POLL_INTERVAL_MS = 5_000;

export function usePlannerControl() {
  const router = useRouter();
  const { isLoading: ctxLoading, isAuthenticated, userRole } = useCompanyContext();

  // Auth gate — same pattern as useSysHealth.
  const [authResolved, setAuthResolved] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [cookieChecked, setCookieChecked] = useState(false);

  useEffect(() => {
    fetch('/api/admin/check-super-admin', { credentials: 'include' })
      .then((r) => r.json())
      .then((json: { isSuperAdmin?: boolean }) => {
        if (json.isSuperAdmin) {
          setIsSuperAdmin(true);
          setAuthResolved(true);
        }
      })
      .catch(() => {})
      .finally(() => setCookieChecked(true));
  }, []);

  useEffect(() => {
    if (!cookieChecked) return;
    if (authResolved) return;
    if (ctxLoading) return;
    if (!isAuthenticated) { router.replace('/login'); return; }
    if (userRole === 'SUPER_ADMIN') {
      setIsSuperAdmin(true);
      setAuthResolved(true);
    } else {
      router.replace('/login');
    }
  }, [cookieChecked, authResolved, ctxLoading, isAuthenticated, userRole, router]);

  // Data.
  const [data, setData] = useState<InspectPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [lastActionResult, setLastActionResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/super-admin/planner-control/inspect', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as InspectPayload;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + polling.
  useEffect(() => {
    if (!isSuperAdmin) return;
    void fetchData();
  }, [isSuperAdmin, fetchData]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    if (!autoRefresh) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => { void fetchData(); }, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, [autoRefresh, isSuperAdmin, fetchData]);

  // ── Mutations ───────────────────────────────────────────────────────────
  // Each mutation sets pendingAction, awaits the API, refetches, then clears.
  const callRollout = useCallback(async (body: {
    action: RolloutAction;
    reason?: string;
    targetMode?: RolloutMode;
    canarySoakMs?: number;
    force?: boolean;
  }) => {
    const actionKey = `rollout:${body.action}`;
    setPendingAction(actionKey);
    setLastActionResult(null);
    try {
      const res = await fetch('/api/super-admin/planner-control/rollout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (json && (json as { error?: string }).error) || `HTTP ${res.status}`;
        setLastActionResult({ ok: false, message: msg });
      } else {
        const state = (json as { state?: RolloutState }).state;
        setLastActionResult({
          ok: true,
          message: state ? `Rollout: ${state.status} → ${state.active_mode} (${state.last_reason})` : 'OK',
        });
      }
      await fetchData();
    } catch (e) {
      setLastActionResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setPendingAction(null);
    }
  }, [fetchData]);

  const callFeature = useCallback(async (body: Record<string, unknown>) => {
    const actionKey = `feature:${String(body.action)}`;
    setPendingAction(actionKey);
    setLastActionResult(null);
    try {
      const res = await fetch('/api/super-admin/planner-control/features', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (json && (json as { error?: string }).error) || `HTTP ${res.status}`;
        setLastActionResult({ ok: false, message: msg });
      } else {
        setLastActionResult({ ok: true, message: `Feature: ${body.action} OK` });
      }
      await fetchData();
    } catch (e) {
      setLastActionResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setPendingAction(null);
    }
  }, [fetchData]);

  const callForceMode = useCallback(async (body: {
    action: ForceModeAction;
    mode?: ForceDegradationMode;
    reason?: string;
  }) => {
    const actionKey = `force:${body.action}`;
    setPendingAction(actionKey);
    setLastActionResult(null);
    try {
      const res = await fetch('/api/super-admin/planner-control/force-mode', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (json && (json as { error?: string }).error) || `HTTP ${res.status}`;
        setLastActionResult({ ok: false, message: msg });
      } else {
        setLastActionResult({ ok: true, message: `Force: ${body.action} OK` });
      }
      await fetchData();
    } catch (e) {
      setLastActionResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setPendingAction(null);
    }
  }, [fetchData]);

  return {
    // auth
    isSuperAdmin,
    authResolved,
    // data
    data,
    loading,
    error,
    refetch: fetchData,
    autoRefresh,
    setAutoRefresh,
    // mutations
    pendingAction,
    lastActionResult,
    callRollout,
    callFeature,
    callForceMode,
  };
}
