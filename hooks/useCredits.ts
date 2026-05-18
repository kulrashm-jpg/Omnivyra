/**
 * useCredits — fetches live credit balance for the current org.
 *
 * Returns totalCredits (lifetime_purchased), remainingCredits (balance_credits),
 * and a category breakdown derived from recent transactions for use with CreditMeter.
 *
 * Lifecycle is expressed via the canonical `status` discriminator. The numeric
 * `totalCredits` / `remainingCredits` fields are AUTHORITATIVE ONLY when
 * `status === 'ready'`. A `0` in any other state is a placeholder, NOT a real
 * balance — consumers must branch on `status`, never infer from the number.
 * `loading` / `error` are kept as legacy mirrors for backward compatibility.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/utils/supabaseClient';
import type { CategoryUsage } from '@/components/ui/CreditMeter';
import { getFeatureDisplayGroup } from '@/shared/monetization/featureRegistry';
import { runSharedPoll } from '@/utils/pollingGuards';
import { getAuthToken } from '@/utils/getAuthToken';

/**
 * Explicit lifecycle states — each renders distinctly so a fetch failure can
 * never masquerade as a real zero balance.
 *   loading     — request in flight / not yet resolved for this org
 *   ready       — authenticated, wallet present, balances verified numeric
 *   error       — auth failure / non-200 / transient fetch error / malformed
 *   unavailable — authenticated but the org has no credit account yet
 */
export type CreditsStatus = 'loading' | 'ready' | 'error' | 'unavailable';

export interface CreditsState {
  status: CreditsStatus;
  /** Authoritative ONLY when status === 'ready'. */
  totalCredits: number;
  /** Authoritative ONLY when status === 'ready'. */
  remainingCredits: number;
  categories: CategoryUsage[];
  /** Legacy mirror of status === 'loading'. */
  loading: boolean;
  /** Human-readable message when status === 'error'; null otherwise. */
  error: string | null;
}

/**
 * Lightweight structured diagnostic. One line per discrete failure transition
 * (fetch runs at most every ~5 min, so this is not a hot loop). Never logs
 * tokens or response bodies.
 */
function diag(event: string, detail?: Record<string, unknown>): void {
  console.warn('[useCredits]', event, detail ? JSON.stringify(detail) : '');
}

// Map reference_type → display group
function buildCategories(
  recentTx: Array<{ credits_delta: number; reference_type: string | null }>,
  totalConsumed: number,
): CategoryUsage[] {
  if (!recentTx.length || totalConsumed <= 0) return [];

  // Aggregate credits consumed per group
  const groupTotals = new Map<string, { credits: number; color: string }>();
  for (const tx of recentTx) {
    if (tx.credits_delta >= 0) continue; // skip grants
    const ref = tx.reference_type ?? 'other';
    const group = getFeatureDisplayGroup(ref);
    const existing = groupTotals.get(group.label);
    if (existing) {
      existing.credits += Math.abs(tx.credits_delta);
    } else {
      groupTotals.set(group.label, { credits: Math.abs(tx.credits_delta), color: group.color });
    }
  }

  const total = Array.from(groupTotals.values()).reduce((s, v) => s + v.credits, 0) || 1;
  return Array.from(groupTotals.entries())
    .map(([label, { credits, color }]) => ({
      label,
      credits,
      color,
      percent: Math.round((credits / total) * 100),
    }))
    .sort((a, b) => b.credits - a.credits)
    .slice(0, 5);
}

/**
 * Explicit payload validation. Returns parsed numeric balances or `null` when
 * the wallet object is structurally invalid (so the caller maps it to an
 * 'error' state instead of silently coercing missing fields to 0).
 *
 * Note: `lifetime_consumed` keeps a guarded 0 default because it only gates
 * whether a category breakdown is shown — it never feeds a balance value, so
 * this is not a balance coercion.
 */
function parseWallet(
  credits: unknown,
): { total: number; remaining: number; categories: CategoryUsage[] } | null {
  if (!credits || typeof credits !== 'object') return null;
  const c = credits as Record<string, unknown>;
  const total = c.lifetime_purchased;
  const remaining = c.balance_credits;
  if (typeof total !== 'number' || !Number.isFinite(total)) return null;
  if (typeof remaining !== 'number' || !Number.isFinite(remaining)) return null;
  return {
    total,
    remaining,
    categories: buildCategories(
      Array.isArray(c.recent_transactions)
        ? (c.recent_transactions as Array<{ credits_delta: number; reference_type: string | null }>)
        : [],
      typeof c.lifetime_consumed === 'number' ? c.lifetime_consumed : 0,
    ),
  };
}

export function useCredits(companyId: string | null | undefined): CreditsState & { refetch: () => void } {
  const [state, setState] = useState<CreditsState>({
    status: 'loading',
    totalCredits: 0,
    remainingCredits: 0,
    categories: [],
    loading: true,
    error: null,
  });

  const fetch = useCallback(async () => {
    if (!companyId) return;
    await runSharedPoll(`credits:${companyId}`, async () => {
      setState(s => ({ ...s, status: 'loading', loading: true, error: null }));
      try {
        // Explicit auth propagation — identical to the app's other
        // authenticated API calls (see CompanyContext.refreshCompanies):
        // canonical Bearer token via getAuthToken() + credentials:'include'
        // so cookie-based sessions also work. Without this the request
        // authenticated as anonymous and the badge silently fell back to 0.
        const token = await getAuthToken();
        const res = await window.fetch(
          `/api/admin/credits?companyId=${encodeURIComponent(companyId)}`,
          {
            credentials: 'include',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          },
        );

        // ── Non-200 → explicit error state (auth vs other) ──────────────────
        if (!res.ok) {
          const isAuth = res.status === 401 || res.status === 403;
          diag(isAuth ? 'auth_failure' : 'non_200_response', { httpStatus: res.status });
          setState(s => ({
            ...s,
            status: 'error',
            loading: false,
            error: isAuth ? `Not authorized (HTTP ${res.status})` : `Request failed (HTTP ${res.status})`,
          }));
          return;
        }

        // ── Malformed envelope → explicit error state ───────────────────────
        let json: unknown;
        try {
          json = await res.json();
        } catch {
          diag('malformed_payload', { reason: 'json_parse_failed' });
          setState(s => ({ ...s, status: 'error', loading: false, error: 'Malformed credits payload' }));
          return;
        }
        if (!json || typeof json !== 'object') {
          diag('malformed_payload', { reason: 'non_object_response' });
          setState(s => ({ ...s, status: 'error', loading: false, error: 'Malformed credits payload' }));
          return;
        }

        // ── Authenticated but no credit account yet → unavailable ───────────
        const credits = (json as Record<string, unknown>).credits;
        if (credits == null) {
          diag('missing_wallet', { companyId });
          setState({
            status: 'unavailable',
            totalCredits: 0,
            remainingCredits: 0,
            categories: [],
            loading: false,
            error: null,
          });
          return;
        }

        // ── Wallet present but structurally invalid → error (no coercion) ───
        const parsed = parseWallet(credits);
        if (!parsed) {
          diag('malformed_payload', { reason: 'invalid_wallet_shape' });
          setState(s => ({ ...s, status: 'error', loading: false, error: 'Malformed credits payload' }));
          return;
        }

        // ── Verified numeric balance (0 here means a REAL zero) ─────────────
        setState({
          status: 'ready',
          totalCredits: parsed.total,
          remainingCredits: parsed.remaining,
          categories: parsed.categories,
          loading: false,
          error: null,
        });
      } catch (err: any) {
        // Transient fetch failure (network / abort). Distinct from the
        // handled non-200 / malformed branches above; surfaced as 'error'
        // and self-heals on the next poll / realtime tick.
        diag('fetch_exception', { message: err?.message ?? 'unknown' });
        setState(s => ({
          ...s,
          status: 'error',
          loading: false,
          error: err?.message ?? 'Failed to load credits',
        }));
      }
    }, { startupDelayMs: 3000, minIntervalMs: 1000 });
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    fetch();

    // Poll every 5 minutes as fallback
    const pollId = setInterval(fetch, 5 * 60 * 1000);

    // Realtime: refetch instantly whenever a credit transaction is inserted for this org
    const channel = supabase
      .channel(`credit_balance_${companyId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'credit_transactions',
          filter: `organization_id=eq.${companyId}`,
        },
        () => { void fetch(); },
      )
      .subscribe((channelStatus) => {
        // Observability only — subscription semantics unchanged. A failed
        // realtime channel just means we fall back to the 5-min poll.
        const s = String(channelStatus);
        if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
          diag('realtime_sync_failure', { channelStatus: s });
        }
      });

    return () => {
      clearInterval(pollId);
      void supabase.removeChannel(channel);
    };
  }, [companyId, fetch]);

  return { ...state, refetch: fetch };
}
