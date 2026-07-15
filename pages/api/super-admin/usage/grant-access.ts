import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../../backend/db/supabaseClient';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { BILLING_GRANT_FREE_CREDITS } from '../../../../shared/contracts/security';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Phase 2 mutation gate. Granting usage-report access touches a
  // billing-adjacent surface; gate on BILLING_GRANT_FREE_CREDITS which
  // is in STEP_UP_REQUIRED_CAPABILITIES (phishing-resistant + trusted-
  // device step-up). Bridge principals are explicitly rejected.
  const guard = await requireCapability(req, res, {
    capability: BILLING_GRANT_FREE_CREDITS,
    reason: 'super-admin grants usage-report access',
  });
  if (guard.ok !== true) return;
  const grantedBy = guard.principal.userId;

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const organizationId = body.organization_id ?? body.organizationId;
  const userId = body.user_id ?? body.userId;

  if (!organizationId || !userId) {
    return res.status(400).json({ error: 'organization_id and user_id are required' });
  }

  try {
    const { error } = await supabase.from('usage_report_access').insert({
      organization_id: organizationId,
      user_id: userId,
      granted_by: grantedBy,
      created_at: new Date().toISOString(),
    });

    if (error) {
      if (error.code === '23505') {
        return res.status(200).json({ success: true, message: 'Access already granted' });
      }
      return res.status(500).json({ error: error.message });
    }
    return res.status(200).json({ success: true, message: 'Access granted' });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/usage/grant-access' });
