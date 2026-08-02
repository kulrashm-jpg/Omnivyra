/**
 * OPT-005 Phase 2A — shared credits realtime owner.
 *
 * Exactly ONE realtime channel per organization, regardless of how many
 * components mount useCredits (previously each mount opened its own
 * `credit_balance_<org>` channel — up to 3 simultaneously from the chrome).
 *
 * Lifecycle: tab-lifetime singleton, matching the SWR cache lifetime — the
 * channel stays armed once created (no reference counting; the repo has no
 * precedent requiring it, and channels are bounded by orgs visited per tab).
 * On INSERT the owner triggers the provided revalidate callback (SWR global
 * mutate of the credits key) — a refetch, never an optimistic update, exactly
 * like the previous per-mount handler.
 */

import { getSupabaseBrowser } from '../supabaseBrowser';

const armedOrgs = new Set<string>();

/** Canonical SWR cache key for an org's credit balance (org-specific, never global). */
export function creditsBalanceKey(companyId: string): string {
  return `/api/admin/credits?companyId=${encodeURIComponent(companyId)}`;
}

export function ensureCreditsRealtime(companyId: string, revalidate: () => void): void {
  if (!companyId || typeof window === 'undefined') return;
  if (armedOrgs.has(companyId)) return;
  armedOrgs.add(companyId);
  try {
    getSupabaseBrowser()
      .channel(`credit_balance_${companyId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'credit_transactions',
          filter: `organization_id=eq.${companyId}`,
        },
        () => {
          revalidate();
        },
      )
      .subscribe((channelStatus) => {
        // Observability only — same semantics as the previous per-mount
        // subscription: a failed channel just means the poll carries it.
        const s = String(channelStatus);
        if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
          console.warn('[useCredits]', 'realtime_sync_failure', JSON.stringify({ channelStatus: s }));
        }
      });
  } catch {
    // Fail-safe: allow a later mount to retry arming.
    armedOrgs.delete(companyId);
  }
}
