import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username, password } = req.body || {};
  const expectedUser = process.env.CONTENT_ARCHITECT_USERNAME || '';
  const expectedPass = process.env.CONTENT_ARCHITECT_PASSWORD || '';

  if (!expectedUser || !expectedPass) {
    return res.status(500).json({
      error: 'CONTENT_ARCHITECT_USERNAME and CONTENT_ARCHITECT_PASSWORD must be set in env',
    });
  }

  if (username !== expectedUser || password !== expectedPass) {
    try {
      await supabase.from('super_admin_audit_logs').insert({
        username: String(username || 'unknown'),
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
      username: String(username || expectedUser),
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
  res.setHeader('Set-Cookie', sessionCookie);
  return res.status(200).json({ success: true });
}
