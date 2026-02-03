import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ipAddress =
    (req.headers['x-forwarded-for'] as string | undefined) ||
    req.socket?.remoteAddress ||
    null;
  const userAgent = req.headers['user-agent'] || null;
  const username = (req.headers['x-super-admin-username'] as string | undefined) || 'superadmin';

  await supabase.from('super_admin_audit_logs').insert({
    username,
    action: 'logout',
    ip_address: ipAddress,
    user_agent: userAgent,
  });

  const cookie = [
    'super_admin_session=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ].join('; ');
  res.setHeader('Set-Cookie', cookie);
  return res.status(200).json({ success: true });
}
