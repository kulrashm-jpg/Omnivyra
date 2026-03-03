import { supabase } from '../../utils/supabaseClient';

export const fetchWithAuth = async (input: RequestInfo, init?: RequestInit) => {
  const { data } = await supabase.auth.getSession();
  let token = data.session?.access_token;
  if (!token) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    token = refreshed.session?.access_token;
  }
  if (!token) {
    // Content Architect uses cookie auth (content_architect_session); send request with credentials only
    return fetch(input, {
      ...init,
      credentials: 'include',
      headers: init?.headers || {},
    });
  }
  if (typeof document !== 'undefined') {
    document.cookie = `sb-access-token=${encodeURIComponent(token)}; path=/; max-age=3600; samesite=lax`;
  }
  const mergedHeaders: Record<string, string> = {};
  const initHeaders = init?.headers;
  if (initHeaders) {
    if (initHeaders instanceof Headers) {
      initHeaders.forEach((v, k) => { mergedHeaders[k] = v; });
    } else if (typeof initHeaders === 'object') {
      Object.assign(mergedHeaders, initHeaders);
    }
  }
  mergedHeaders.Authorization = `Bearer ${token}`;
  return fetch(input, {
    ...init,
    credentials: 'include',
    headers: mergedHeaders,
  });
};
