/**
 * OPT-005 Phase 1 — SWR cache purge watcher.
 *
 * Mounted INSIDE CompanyProvider (it consumes the context) and under the
 * app-level SWRConfig. Implements the approved invalidation matrix exactly:
 *
 *   PURGE on any CompanyContext user.userId change — the canonical trigger,
 *         because cookie-authenticated principals (legacy super-admin,
 *         content architect) never fire a Supabase auth event.
 *   PURGE on Supabase SIGNED_OUT — belt: the event can precede the context
 *         update.
 *   NO purge on TOKEN_REFRESHED (same principal).
 *   NO purge on selectedCompanyId change — org-scoped keys are distinct URLs,
 *         and cached-then-revalidate on switch-back is desired.
 */

import { useEffect, useRef } from 'react';
import { useSWRConfig } from 'swr';
import { useCompanyContext } from '../CompanyContext';
import { getSupabaseBrowser } from '../../lib/supabaseBrowser';
import { clearSwrCache } from '../../lib/swr/swrClient';

export function SwrCachePurgeWatcher(): null {
  const { user } = useCompanyContext();
  const { mutate } = useSWRConfig();
  const userId = user?.userId ?? null;
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    // First observation establishes the baseline — no purge on initial mount.
    if (prevUserIdRef.current === undefined) {
      prevUserIdRef.current = userId;
      return;
    }
    if (prevUserIdRef.current !== userId) {
      prevUserIdRef.current = userId;
      void clearSwrCache(mutate);
    }
  }, [userId, mutate]);

  useEffect(() => {
    try {
      const { data } = getSupabaseBrowser().auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') void clearSwrCache(mutate);
      });
      return () => data.subscription.unsubscribe();
    } catch {
      // Fail-safe: without the listener, the userId watcher above still purges
      // once the context reflects the sign-out.
      return undefined;
    }
  }, [mutate]);

  return null;
}
