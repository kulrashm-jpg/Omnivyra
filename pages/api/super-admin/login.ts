import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username, password } = req.body || {};
  const expectedUser = process.env.SUPER_ADMIN_USERNAME || 'superadmin';
  const expectedPass = process.env.SUPER_ADMIN_PASSWORD ;

  // 🔍 TEMP DEBUG LOGS (add these)
console.log("EXPECTED USER:", expectedUser);
console.log("EXPECTED PASS EXISTS:", !!expectedPass);
console.log("INPUT USER:", username);
console.log("INPUT PASS:", password);

  const ipAddress =
    (req.headers['x-forwarded-for'] as string | undefined) ||
    req.socket?.remoteAddress ||
    null;
  const userAgent = req.headers['user-agent'] || null;

  if (!expectedPass) {
    return res.status(500).json({ error: 'SUPER_ADMIN_PASSWORD not set' });
  }

  if (username !== expectedUser || password !== expectedPass) {
    await supabase.from('super_admin_audit_logs').insert({
      username: String(username || 'unknown'),
      action: 'failed_login',
      ip_address: ipAddress,
      user_agent: userAgent,
    });
    return res.status(403).json({ error: 'INVALID_CREDENTIALS' });
  }

  await supabase.from('super_admin_audit_logs').insert({
    username: String(username || expectedUser),
    action: 'login',
    ip_address: ipAddress,
    user_agent: userAgent,
  });

  const cookie = [
    'super_admin_session=1',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=86400',
  ].join('; ');
  res.setHeader('Set-Cookie', cookie);
  return res.status(200).json({ success: true });
}
