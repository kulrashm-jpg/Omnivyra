import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import type { NextApiRequest, NextApiResponse } from 'next';
import { ingestExtensionEvent } from '../../../backend/services/extensionEventIngestionService';
import { extractAccessToken, getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { verifyExtensionSessionToken } from '../../../backend/services/extensionSessionService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const organizationId =
    (req.body?.organization_id ?? req.body?.organizationId ?? req.body?.orgId ?? req.body?.companyId) as
      | string
      | undefined;
  const companyId = organizationId?.trim();

  if (!companyId) {
    return res.status(400).json({ error: 'organization_id, organizationId, orgId, or companyId is required' });
  }

  try {
    const { user, error } = await getSupabaseUserFromRequest(req);
    const extensionSession = verifyExtensionSessionToken(extractAccessToken(req));
    const effectiveUserId = extensionSession?.userId ?? user?.id ?? null;

    if ((!extensionSession && error) || !effectiveUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (extensionSession && extensionSession.orgId !== companyId) {
      return res.status(403).json({ error: 'Extension session organization mismatch' });
    }

    const { data: roleRow, error: roleError } = await supabase
      .from('user_company_' + 'roles')
      .select('company_id')
      .eq('user_id', effectiveUserId)
      .eq('company_id', companyId)
      .eq('status', 'active')
      .maybeSingle();

    if (roleError) {
      throw new Error(`Failed to validate extension event access: ${roleError.message}`);
    }

    if (!roleRow?.company_id) {
      return res.status(403).json({ error: 'Access denied to organization' });
    }

    const result = await ingestExtensionEvent({
      platform: req.body?.platform,
      event_type: req.body?.event_type,
      platform_message_id: req.body?.platform_message_id,
      data: req.body?.data || {},
      organization_id: companyId,
    });

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('[extension/events]', error);
    return res.status(500).json({
      error: (error as Error)?.message ?? 'Failed to ingest extension event',
    });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

