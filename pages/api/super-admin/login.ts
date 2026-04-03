
/**
 * POST /api/super-admin/login
 *
 * Super Admin authentication using environment variables
 * (same pattern as Content Architect).
 *
 * Validates username and password against SUPER_ADMIN_USERNAME and SUPER_ADMIN_PASSWORD env vars.
 * On success, sets a session cookie and returns 200.
 * 
 * Body: { username: string, password: string }
 * Response: { success: true } on success, or { error: string } on failure
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username, password } = req.body || {};
  const u = String(username ?? '').trim();
  const p = String(password ?? '').trim();
  const expectedUser = (process.env.SUPER_ADMIN_USERNAME || '').trim();
  const expectedPass = (process.env.SUPER_ADMIN_PASSWORD || '').trim();

  if (!expectedUser || !expectedPass) {
    return res.status(500).json({
      error: 'SUPER_ADMIN_USERNAME and SUPER_ADMIN_PASSWORD must be set in env',
    });
  }

  if (u !== expectedUser || p !== expectedPass) {
    try {
      await supabase.from('super_admin_audit_logs').insert({
        username: u || 'unknown',
        action: 'super_admin_failed_login',
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
      action: 'super_admin_login',
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
    'super_admin_session=1',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=86400',
  ].join('; ');
  const clearContentArchitect = [
    'content_architect_session=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ].join('; ');
  res.setHeader('Set-Cookie', [sessionCookie, clearContentArchitect]);
  return res.status(200).json({ success: true });
}
