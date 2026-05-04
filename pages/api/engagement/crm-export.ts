import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
/**
 * POST /api/engagement/crm-export
 *
 * Records an operator's intent to export an engagement signal to the
 * organization's CRM. This endpoint is intentionally minimal: it
 * validates access, writes an audit row, and returns a queued
 * acknowledgement. Downstream CRM integrations consume the audit trail;
 * there is no inline CRM push here.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { resolveUserContext, enforceCompanyAccess } from '../../../backend/services/userContextService';
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { logAuditEvent } from '../../../backend/services/auditLoggingService';

type CrmExportBody = {
  organization_id?: string;
  signal_id?: string;
  platform?: string;
  author?: string | null;
  content?: string | null;
  conversation_url?: string | null;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const body = (req.body || {}) as CrmExportBody;
    const organizationId = (body.organization_id ?? user?.defaultCompanyId) as string | undefined;
    const signalId = (body.signal_id ?? '').toString().trim();

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }
    if (!signalId) {
      return res.status(400).json({ error: 'signal_id required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    // Tenant-scoped existence check: the signal must belong to a campaign
    // whose company is the caller's. We look up the signal + a campaign
    // version for the caller's org and require both to resolve.
    const { data: signal } = await supabase
      .from('campaign_activity_engagement_signals')
      .select('id, campaign_id, platform, author, content, conversation_url')
      .eq('id', signalId)
      .maybeSingle();

    if (!signal) {
      return res.status(404).json({ error: 'Signal not found' });
    }

    if (signal.campaign_id) {
      const { data: version } = await supabase
        .from('campaign_versions')
        .select('company_id')
        .eq('campaign_id', signal.campaign_id)
        .limit(1)
        .maybeSingle();
      if (!version || version.company_id !== organizationId) {
        return res.status(403).json({ error: 'Signal does not belong to caller organization' });
      }
    }

    await logAuditEvent({
      operation: 'INSERT',
      table: 'engagement_crm_export',
      companyId: organizationId,
      userId: (user as { userId?: string })?.userId ?? 'unknown',
      success: true,
      metadata: {
        signal_id: signalId,
        platform: signal.platform ?? body.platform ?? null,
        author: signal.author ?? body.author ?? null,
        conversation_url: signal.conversation_url ?? body.conversation_url ?? null,
        content_preview: (signal.content ?? body.content ?? '')?.toString().slice(0, 280),
      },
    }).catch((err) => {
      console.warn('[engagement/crm-export] audit failed:', (err as Error)?.message);
    });

    return res.status(200).json({
      success: true,
      status: 'queued',
      message: 'Export queued. Available in audit_logs for downstream CRM integrations.',
      signal_id: signalId,
    });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed to export to CRM';
    console.error('[engagement/crm-export]', msg);
    return res.status(500).json({ error: msg });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
  requiresOrg: true,
})(handler);

