/**
 * GET /api/cron/anomaly-sweep
 *
 * Cross-instance anomaly sweep — queries auth_audit_logs globally to detect
 * distributed attacks that are invisible to any single instance's in-process
 * counters.
 *
 * Schedule: every 2 minutes (configured in vercel.json).
 * Can also be triggered manually by a super admin.
 *
 * Auth:
 *   - Vercel cron calls: validated via CRON_SECRET header
 *   - Manual calls: super_admin_session cookie OR Supabase SUPER_ADMIN role
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '../../../backend/services/rbacService';
import { runAnomalySweep } from '../../../lib/anomaly/sweepDetector';

async function isAuthorized(req: NextApiRequest): Promise<boolean> {
  // Vercel cron secret (set CRON_SECRET env var, Vercel sends it automatically)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization === `Bearer ${cronSecret}`) return true;

  // Legacy super-admin cookie
  if (req.cookies?.super_admin_session === '1') return true;

  // Supabase SUPER_ADMIN role
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id && await isPlatformSuperAdmin(user.id)) return true;

  return false;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await isAuthorized(req))) return res.status(403).json({ error: 'NOT_AUTHORIZED' });

  try {
    const result = await runAnomalySweep();
    console.log(JSON.stringify({
      level: 'INFO',
      event: 'anomaly_sweep_complete',
      ...result,
      ts: new Date().toISOString(),
    }));
    return res.status(200).json({ ok: true, ...result });
  } catch (err: any) {
    console.error('[anomaly-sweep] error:', err?.message);
    return res.status(500).json({ error: 'Sweep failed', details: err?.message });
  }
}
