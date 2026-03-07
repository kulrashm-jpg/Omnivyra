import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username, password } = req.body || {};
  const u = String(username ?? '').trim();
  const p = String(password ?? '').trim();
  const expectedUser = (process.env.CONTENT_ARCHITECT_USERNAME || '').trim();
  const expectedPass = (process.env.CONTENT_ARCHITECT_PASSWORD || '').trim();

  if (!expectedUser || !expectedPass) {
    return res.status(500).json({
      error: 'CONTENT_ARCHITECT_USERNAME and CONTENT_ARCHITECT_PASSWORD must be set in env',
    });
  }

  if (u !== expectedUser || p !== expectedPass) {
    try {
      await supabase.from('super_admin_audit_logs').insert({
        username: u || 'unknown',
        action: 'content_architect_failed_login',
        ip_address:
          (req.headers['x-forwarded-for'] as string) ||
          req.socket?.remoteAddress ||
          null,
        user_agent: req.headers['user-agent'] || null,
      });
    } catch {
      // ignore audit failure
    }
    return res.status(403).json({ error: 'INVALID_CREDENTIALS' });
  }

  try {
    await supabase.from('super_admin_audit_logs').insert({
      username: u || expectedUser,
      action: 'content_architect_login',
      ip_address:
        (req.headers['x-forwarded-for'] as string) ||
        req.socket?.remoteAddress ||
        null,
      user_agent: req.headers['user-agent'] || null,
    });
  } catch {
    // ignore audit failure
  }

  const sessionCookie = [
    'content_architect_session=1',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=86400',
  ].join('; ');
  const clearSuperAdmin = [
    'super_admin_session=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ].join('; ');
  res.setHeader('Set-Cookie', [sessionCookie, clearSuperAdmin]);
  return res.status(200).json({ success: true });
}
