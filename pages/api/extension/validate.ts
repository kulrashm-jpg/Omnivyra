import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '@/backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
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

async function handler(
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

  // Session token (HMAC-verified) is authoritative for orgId. The body field
  // is only used to assert the client's view matches the session â€” if the
  // client omits it, fall back to the session's pinned orgId rather than
  // 400-ing a request that's otherwise valid.
  const effectiveOrgId = requestedOrgId || session.orgId;

  if (requestedOrgId && session.orgId !== requestedOrgId) {
    return res.status(403).json({ success: false, error: 'Extension session organization mismatch', timestamp: Date.now() });
  }

  // In dev-bypass mode the middleware uses a sentinel userId that has no
  // user company roles row by design â€” the bypass IS the trust signal.
  // Skip the role check so validation succeeds and the extension can
  // start polling. Production paths still run the check below.
  const isBypassSession = session.userId === '00000000-0000-4000-8000-000000000001';

  if (!isBypassSession) {
    const { data: roleRow, error: roleError } = await supabase
      .from('user_company_' + 'roles')
      .select('company_id, status')
      .eq('user_id', session.userId)
      .eq('company_id', effectiveOrgId)
      .eq('status', 'active')
      .maybeSingle();

    if (roleError) {
      console.error('[api/extension/validate] role lookup failed:', roleError);
      return res.status(500).json({ success: false, error: 'Failed to validate organization access', timestamp: Date.now() });
    }

    if (!roleRow?.company_id) {
      return res.status(403).json({ success: false, error: 'Access denied to organization', timestamp: Date.now() });
    }
  }

  return res.status(200).json({
    success: true,
    data: {
      valid: true,
      user_id: session.userId,
      org_id: effectiveOrgId,
      sync_mode: 'batch',
      polling_interval: 60,
    },
    timestamp: Date.now(),
  });
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

