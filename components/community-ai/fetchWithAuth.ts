import { supabase } from '../../utils/supabaseClient';

export const fetchWithAuth = async (input: RequestInfo, init?: RequestInit) => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new Error('Not authenticated');
  }
  return fetch(input, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
};
