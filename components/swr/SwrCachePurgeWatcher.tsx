/**
 * OPT-005 Phase 1 — SWR cache purge watcher.
 *
 * Mounted INSIDE CompanyProvider (it consumes the context) and under the
 * app-level SWRConfig. Implements the approved invalidation matrix exactly:
 *
 *   PURGE on a CompanyContext user.userId change BETWEEN PRINCIPALS (A → B,
 *         A → signed out) — the canonical trigger, because cookie-
 *         authenticated principals (legacy super-admin, content architect)
 *         never fire a Supabase auth event.
 *   NO purge on anonymous → principal: that is first-load auth RESOLUTION, not
 *         a principal change. Purging there discards in-flight first-load
 *         responses and, being revalidate:false, never refetches them.
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
      // Anonymous → principal is auth RESOLUTION, not a principal change, and it
      // lands mid-flight on a cold load: the first requests are already in
      // flight when the context finally reports who the user is. Purging there
      // makes SWR discard those resolved responses as stale, and because the
      // purge is revalidate:false nothing refetches — the credit pill (and any
      // other key racing that window) stays 'loading' forever after a single
      // HTTP 200. Nothing needs purging in that direction anyway: a cold-load
      // cache holds only responses fetched under this same principal (Bearer/
      // cookie travels with every request), so there is no cross-principal
      // bleed to clear. Real principal changes — A → B and A → signed out —
      // still purge, as does SIGNED_OUT below.
      const wasAnonymous = !prevUserIdRef.current;
      prevUserIdRef.current = userId;
      if (!wasAnonymous) void clearSwrCache(mutate);
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
