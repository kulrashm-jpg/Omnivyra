import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { requireExtensionAuth } from '@/backend/middleware/extensionAuthMiddleware';

type SuccessResponse = {
  success: true;
  data: {
    valid: true;
    user_id: string;
    org_id: string;
    sync_mode: 'batch';
    polling_interval: number;
  };
  timestamp: number;
};

type ErrorResponse = {
  success: false;
  error: string;
  timestamp: number;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed', timestamp: Date.now() });
  }

  const auth = await requireExtensionAuth(req, res);
  if (!auth) return;
  const { session } = auth;

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
  const requestedOrgId = String(body.orgId || body.organization_id || body.organizationId || '').trim();

  if (!requestedOrgId) {
    return res.status(400).json({ success: false, error: 'orgId is required', timestamp: Date.now() });
  }

  if (session.orgId !== requestedOrgId) {
    return res.status(403).json({ success: false, error: 'Extension session organization mismatch', timestamp: Date.now() });
  }

  const { data: roleRow, error: roleError } = await supabase
    .from('user_company_roles')
    .select('company_id, status')
    .eq('user_id', session.userId)
    .eq('company_id', requestedOrgId)
    .eq('status', 'active')
    .maybeSingle();

  if (roleError) {
    console.error('[api/extension/validate] role lookup failed:', roleError);
    return res.status(500).json({ success: false, error: 'Failed to validate organization access', timestamp: Date.now() });
  }

  if (!roleRow?.company_id) {
    return res.status(403).json({ success: false, error: 'Access denied to organization', timestamp: Date.now() });
  }

  return res.status(200).json({
    success: true,
    data: {
      valid: true,
      user_id: session.userId,
      org_id: requestedOrgId,
      sync_mode: 'batch',
      polling_interval: 60,
    },
    timestamp: Date.now(),
  });
}
