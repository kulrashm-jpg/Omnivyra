/**
 * GET /api/debug/linkedin-test
 *
 * Diagnoses LinkedIn integration:
 *  1. Checks if a social account exists and is active
 *  2. Verifies the token is readable
 *  3. Calls LinkedIn /v2/userinfo to confirm the token is valid
 *  4. Shows recent scheduled_posts for this user + their status/errors
 *  5. Optionally posts a test message (add ?post=1)
 *
 * REMOVE BEFORE PRODUCTION.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getToken } from '../../../backend/auth/tokenStore';
import { resolveUserContext } from '../../../backend/services/userContextService';
import { publishToLinkedIn } from '../../../backend/adapters/linkedinAdapter';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  let userId: string;
  try {
    const ctx = await resolveUserContext(req);
    userId = ctx.userId;
    if (!userId || userId === 'anon') return res.status(401).json({ error: 'Not authenticated' });
  } catch {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const result: Record<string, any> = { userId };

  // 1. Find LinkedIn social account
  const { data: accounts } = await supabase
    .from('social_accounts')
    .select('id, platform_user_id, account_name, username, is_active, token_expires_at, access_token')
    .eq('user_id', userId)
    .eq('platform', 'linkedin')
    .eq('is_active', true)
    .not('platform_user_id', 'like', 'planning_%')
    .limit(1);

  const account = accounts?.[0] ?? null;
  result.account = account
    ? { id: account.id, platform_user_id: account.platform_user_id, account_name: account.account_name, token_expires_at: account.token_expires_at }
    : null;

  if (!account) {
    return res.status(200).json({ ...result, diagnosis: 'No active LinkedIn account found. Connect LinkedIn first.' });
  }

  // 2. Read token from tokenStore
  let tokenObj: any = null;
  try {
    tokenObj = await getToken(account.id);
    result.token = tokenObj
      ? { has_access_token: !!tokenObj.access_token, token_length: tokenObj.access_token?.length, expires_at: tokenObj.expires_at }
      : null;
  } catch (e: any) {
    result.token_error = e?.message;
  }

  if (!tokenObj?.access_token) {
    return res.status(200).json({ ...result, diagnosis: 'Token missing or unreadable. Reconnect LinkedIn.' });
  }

  // 3. Verify token via LinkedIn userinfo
  try {
    const userinfoRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenObj.access_token}` },
    });
    const userinfoText = await userinfoRes.text();
    result.linkedin_userinfo = { status: userinfoRes.status, body: userinfoText.slice(0, 500) };
  } catch (e: any) {
    result.linkedin_userinfo_error = e?.message;
  }

  // 4. Recent scheduled posts
  const { data: posts } = await supabase
    .from('scheduled_posts')
    .select('id, platform, status, scheduled_for, error_code, error_message, platform_post_id, content')
    .eq('user_id', userId)
    .eq('platform', 'linkedin')
    .order('created_at', { ascending: false })
    .limit(5);

  result.recent_posts = (posts || []).map((p) => ({
    id: p.id,
    status: p.status,
    scheduled_for: p.scheduled_for,
    error_code: p.error_code,
    error_message: p.error_message,
    platform_post_id: p.platform_post_id,
    content_preview: String(p.content || '').slice(0, 60),
  }));

  // 5. Optional: trigger a real test post (?post=1)
  if (req.query.post === '1') {
    const testPost = {
      id: 'debug-test',
      platform: 'linkedin',
      content: `[Virality test post] ${new Date().toISOString()}`,
      scheduled_for: new Date().toISOString(),
    };
    const testAccount = { id: account.id, platform: 'linkedin', platform_user_id: account.platform_user_id, username: account.username };
    const publishResult = await publishToLinkedIn(testPost, testAccount, tokenObj);
    result.test_publish = publishResult;
  }

  return res.status(200).json(result);
}
