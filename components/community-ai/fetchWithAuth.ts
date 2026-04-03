import { getAuthToken } from '../../utils/getAuthToken';
import { getSupabaseBrowser } from '../../lib/supabaseBrowser';

export const fetchWithAuth = async (input: RequestInfo, init?: RequestInit & { forceRefresh?: boolean }) => {
  // Try to get a token first
  let token = await getAuthToken();
  console.log('📍 fetchWithAuth - initial token check:', token ? '✅ yes' : '❌ no');

  console.log('📤 Sending request with cookies + token:', token ? 'Bearer' : 'none');
  
  const mergedHeaders: Record<string, string> = {};
  const initHeaders = init?.headers;
  if (initHeaders) {
    if (initHeaders instanceof Headers) {
      initHeaders.forEach((v, k) => { mergedHeaders[k] = v; });
    } else if (typeof initHeaders === 'object') {
      Object.assign(mergedHeaders, initHeaders);
    }
  }
  
  if (token) {
    mergedHeaders.Authorization = `Bearer ${token}`;
  }
  
  return fetch(input, {
    ...init,
    credentials: 'include',
    headers: mergedHeaders,
  });
};
