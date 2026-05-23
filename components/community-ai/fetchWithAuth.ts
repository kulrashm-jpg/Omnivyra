/**
 * fetchWithAuth — community-ai connector legacy wrapper.
 *
 * Public signature preserved for the dozens of legacy importers. Internals
 * now delegate to lib/apiFetch.ts so all authenticated client traffic flows
 * through the canonical fetch layer (Phase 3/4 standardization). The
 * `forceRefresh` field on init is accepted for back-compat — apiFetch
 * already performs a one-shot refresh recovery when getAuthToken returns
 * null, so the flag is now a no-op.
 */
import { apiFetch } from '../../lib/apiFetch';

export const fetchWithAuth = async (
  input: RequestInfo,
  init?: RequestInit & { forceRefresh?: boolean },
): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
  return apiFetch(url, init);
};
