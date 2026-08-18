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
 *
 * OPT-005 Phase 2A: backed by SWR — all mounted consumers (up to three chrome
 * components at once) share ONE cache entry and ONE request per org, and the
 * realtime subscription is a per-org tab-lifetime singleton
 * (lib/swr/creditsRealtime.ts) triggering a cache revalidation on INSERT —
 * exactly what each per-mount channel did before, minus the duplicates.
 * Revalidation owners are unchanged: the 5-minute poll (now SWR
 * refreshInterval) + realtime. Focus/reconnect revalidation is disabled so no
 * new trigger is introduced. Public signature and the status state machine
 * are identical.
 */

import { useCallback, useEffect } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import type { CategoryUsage } from '@/components/ui/CreditMeter';
import { getFeatureDisplayGroup } from '@/shared/monetization/featureRegistry';
import { apiFetch } from '@/lib/apiFetch';
import { ApiFetchError } from '@/lib/swr/swrClient';
import { creditsBalanceKey, ensureCreditsRealtime } from '@/lib/swr/creditsRealtime';

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

/** 5-minute fallback poll — unchanged cadence, now expressed as refreshInterval. */
export const CREDITS_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

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

type CreditsData =
  | { kind: 'ready'; total: number; remaining: number; categories: CategoryUsage[] }
  | { kind: 'unavailable' };

/**
 * Credits fetcher — goes through apiFetch (Bearer + OPT-004 memo) and maps
 * the response through the SAME state machine as the previous implementation:
 * non-200 → thrown error (auth-specific message, via ApiFetchError.status);
 * malformed → thrown error; wallet null → 'unavailable'; parsed → 'ready'.
 * Errors are thrown so SWR never caches them as data.
 */
async function fetchCreditsState(url: string): Promise<CreditsData> {
  const res = await apiFetch(url);

  if (!res.ok) {
    const isAuth = res.status === 401 || res.status === 403;
    diag(isAuth ? 'auth_failure' : 'non_200_response', { httpStatus: res.status });
    throw new ApiFetchError(url, res.status, {
      error: isAuth ? `Not authorized (HTTP ${res.status})` : `Request failed (HTTP ${res.status})`,
    });
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    diag('malformed_payload', { reason: 'json_parse_failed' });
    throw new ApiFetchError(url, res.status, { error: 'Malformed credits payload' });
  }
  if (!json || typeof json !== 'object') {
    diag('malformed_payload', { reason: 'non_object_response' });
    throw new ApiFetchError(url, res.status, { error: 'Malformed credits payload' });
  }

  const credits = (json as Record<string, unknown>).credits;
  if (credits == null) {
    diag('missing_wallet', { url });
    return { kind: 'unavailable' };
  }

  const parsed = parseWallet(credits);
  if (!parsed) {
    diag('malformed_payload', { reason: 'invalid_wallet_shape' });
    throw new ApiFetchError(url, res.status, { error: 'Malformed credits payload' });
  }

  return { kind: 'ready', total: parsed.total, remaining: parsed.remaining, categories: parsed.categories };
}

export function useCredits(companyId: string | null | undefined): CreditsState & { refetch: () => void } {
  const key = companyId ? creditsBalanceKey(companyId) : null;
  const { mutate: globalMutate } = useSWRConfig();

  const { data, error, isValidating, mutate } = useSWR<CreditsData>(key, fetchCreditsState, {
    refreshInterval: CREDITS_REFRESH_INTERVAL_MS,
    // Revalidation owners unchanged from the previous implementation:
    // the 5-minute poll above + the realtime INSERT below. No new triggers.
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    // Parity with the old runSharedPoll minIntervalMs: 1000.
    dedupingInterval: 1000,
  });

  // ONE realtime channel per org (tab-lifetime singleton). Revalidates via
  // the GLOBAL mutate so the callback stays valid across mounts/unmounts.
  useEffect(() => {
    if (!companyId) return;
    ensureCreditsRealtime(companyId, () => {
      void globalMutate(creditsBalanceKey(companyId));
    });
  }, [companyId, globalMutate]);

  const refetch = useCallback(() => {
    void mutate();
  }, [mutate]);

  // ── State mapping — identical machine to the previous implementation ─────
  // Old behavior: every poll tick set status 'loading' while keeping the
  // previous totals; error branches also kept previous totals. SWR retains
  // last-good `data` across revalidations and errors, so the same holds.
  let totalCredits = 0;
  let remainingCredits = 0;
  let categories: CategoryUsage[] = [];
  if (data?.kind === 'ready') {
    totalCredits = data.total;
    remainingCredits = data.remaining;
    categories = data.categories;
  }

  let status: CreditsStatus;
  if (!companyId || (!data && !error)) {
    status = 'loading';
  } else if (error) {
    status = 'error';
  } else if (data!.kind === 'unavailable') {
    status = 'unavailable';
  } else {
    status = 'ready';
  }

  const errorMessage =
    status === 'error'
      ? error instanceof Error && error.message
        ? error.message
        : 'Failed to load credits'
      : null;

  return {
    status,
    totalCredits,
    remainingCredits,
    categories,
    loading: status === 'loading',
    error: errorMessage,
    refetch,
  };
}
