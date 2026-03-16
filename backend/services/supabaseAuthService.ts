import type { NextApiRequest } from 'next';
import { supabase } from '../db/supabaseClient';

export const extractAccessToken = (req: NextApiRequest): string | null => {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token) return token;
  }
  const directToken = req.cookies?.['sb-access-token'];
  if (directToken) return String(directToken);

  const cookieEntries = Object.entries(req.cookies || {});

  // 1. Try unchunked Supabase cookie: sb-{ref}-auth-token
  for (const [name, value] of cookieEntries) {
    if (!name.startsWith('sb-') || !name.endsWith('-auth-token')) continue;
    try {
      const parsed = JSON.parse(value);
      if (parsed?.access_token) return String(parsed.access_token);
    } catch {
      // ignore malformed cookie
    }
  }

  // 2. Try chunked Supabase v2 cookies: sb-{ref}-auth-token.0, .1, ...
  //    Chunks are concatenated in ascending index order to form the full JSON.
  const chunkMap: Record<string, [number, string][]> = {};
  for (const [name, value] of cookieEntries) {
    const m = name.match(/^(sb-.+-auth-token)\.(\d+)$/);
    if (!m) continue;
    const base = m[1];
    const idx = parseInt(m[2], 10);
    if (!chunkMap[base]) chunkMap[base] = [];
    chunkMap[base].push([idx, value || '']);
  }
  for (const chunks of Object.values(chunkMap)) {
    const joined = chunks.sort((a, b) => a[0] - b[0]).map(([, v]) => v).join('');
    try {
      const parsed = JSON.parse(joined);
      if (parsed?.access_token) return String(parsed.access_token);
    } catch {
      // ignore malformed
    }
  }

  return null;
};

export const getSupabaseUserFromRequest = async (
  req: NextApiRequest
): Promise<{ user: { id: string; email?: string | null } | null; error: string | null }> => {
  const token = extractAccessToken(req);
  if (!token) {
    return { user: null, error: 'MISSING_AUTH' };
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return { user: null, error: 'INVALID_AUTH' };
  }
  return { user: { id: data.user.id, email: data.user.email }, error: null };
};
