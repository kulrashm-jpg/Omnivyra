import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * POST /api/admin/revoke-super-admin
 *
 * Revokes platform super-admin status from a user by:
 *  1. Downgrading users.role from SUPER_ADMIN to COMPANY_ADMIN
 *  2. Downgrading any SUPER_ADMIN role in user_company_roles to COMPANY_ADMIN
 *
 * Authorization: capability `identity.admin.revoke` + step-up policy
 * (phishing-resistant + trusted device, 10-minute window). Bridge
 * principals cannot satisfy step-up and are rejected.
 *
 * Body: { userId: string }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { requireCapability } from '@/backend/security/requireCapability';
import { IDENTITY_ADMIN_REVOKE } from '@/shared/contracts/security';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const { userId } = body as { userId?: string };

  if (!userId) return res.status(400).json({ error: 'Missing required field: userId' });

  const guard = await requireCapability(req, res, {
    capability: IDENTITY_ADMIN_REVOKE,
    reason: 'super-admin revokes platform super-admin status from another user',
    resourceId: userId,
  });
  if (guard.ok !== true) return;

  try {
    const now = new Date().toISOString();

    // 1. Revoke platform-level super-admin role
    const { error: profileErr } = await supabase
      .from('users')
      .update({ role: 'COMPANY_ADMIN', updated_at: now })
      .eq('id', userId)
      .eq('role', 'SUPER_ADMIN');

    if (profileErr) {
      console.error('[revoke-super-admin] profile update failed:', profileErr.message);
      return res.status(500).json({ error: 'Internal server error' });
    }

    // 2. Downgrade any SUPER_ADMIN company roles to COMPANY_ADMIN
    await supabase
      .from('user_company_roles')
      .update({ role: 'COMPANY_ADMIN', updated_at: now })
      .eq('user_id', userId)
      .eq('role', 'SUPER_ADMIN');

    return res.status(200).json({
      success:    true,
      message:    'Super admin privileges revoked successfully',
      user_id:    userId,
      revoked_at: now,
    });
  } catch (err: any) {
    console.error('[revoke-super-admin]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/admin/revoke-super-admin' });
