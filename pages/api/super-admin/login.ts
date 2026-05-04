import type { NextApiRequest, NextApiResponse } from 'next';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username, password } = req.body || {};
  const providedUser = String(username ?? '').trim();
  const providedPass = String(password ?? '').trim();
  const expectedUser = String(process.env.SUPER_ADMIN_USERNAME ?? '').trim();
  const expectedPass = String(process.env.SUPER_ADMIN_PASSWORD ?? '').trim();

  if (!expectedUser || !expectedPass) {
    return res.status(500).json({
      error: 'SUPER_ADMIN_USERNAME and SUPER_ADMIN_PASSWORD must be set in env',
    });
  }

  if (providedUser !== expectedUser || providedPass !== expectedPass) {
    return res.status(403).json({ error: 'INVALID_CREDENTIALS' });
  }

  const superAdminCookie = [
    'super_admin_session=1',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=86400',
  ].join('; ');
  const clearContentArchitectCookie = [
    'content_architect_session=',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ].join('; ');

  res.setHeader('Set-Cookie', [superAdminCookie, clearContentArchitectCookie]);
  return res.status(200).json({ success: true });
}

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(handler);
