import { getAuthToken } from '../../utils/getAuthToken';

export const fetchWithAuth = async (input: RequestInfo, init?: RequestInit) => {
  const token = await getAuthToken();

  if (!token) {
    // Content Architect uses cookie auth (content_architect_session); send request with credentials only
    return fetch(input, {
      ...init,
      credentials: 'include',
      headers: init?.headers || {},
    });
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
