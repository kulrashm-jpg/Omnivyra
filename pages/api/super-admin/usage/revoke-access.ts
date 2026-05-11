import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { BILLING_GRANT_FREE_CREDITS } from '../../../../shared/contracts/security';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Phase 2 mutation gate. Revoking usage-report access mirrors the
  // grant capability for symmetry — both touch the same billing surface.
  const guard = await requireCapability(req, res, {
    capability: BILLING_GRANT_FREE_CREDITS,
    reason: 'super-admin revokes usage-report access',
  });
  if (guard.ok !== true) return;

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const organizationId = body.organization_id ?? body.organizationId;
  const userId = body.user_id ?? body.userId;

  if (!organizationId || !userId) {
    return res.status(400).json({ error: 'organization_id and user_id are required' });
  }

  try {
    const { error } = await supabase
      .from('usage_report_access')
      .delete()
      .eq('organization_id', organizationId)
      .eq('user_id', userId);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true, message: 'Access revoked' });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
}
