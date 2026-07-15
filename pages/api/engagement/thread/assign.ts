import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/engagement/thread/assign
 * Assign or unassign an engagement thread to a teammate.
 * Body: { thread_id, organization_id, assignee_user_id }  (assignee_user_id=null → unassign)
 *
 * assigned_by / assigned_at are server-derived. The assignee must be an active
 * member of the organization (prevents cross-tenant assignment).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { supabase } from '../../../../backend/db/supabaseClient';
import { recordThreadEvent } from '../../../../backend/services/engagementThreadEventService';

type Body = {
  thread_id?: string;
  organization_id?: string;
  assignee_user_id?: string | null;
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const body = (req.body || {}) as Body;
    const threadId = body.thread_id?.trim();
    const organizationId = body.organization_id ?? user?.defaultCompanyId;
    const assigneeUserId = body.assignee_user_id ? String(body.assignee_user_id).trim() : null;

    if (!threadId) return res.status(400).json({ error: 'thread_id required' });
    if (!organizationId) return res.status(400).json({ error: 'organization_id required' });

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const { data: thread } = await supabase
      .from('engagement_threads')
      .select('id, organization_id')
      .eq('id', threadId)
      .maybeSingle();

    if (!thread || (thread as { organization_id: string | null }).organization_id !== organizationId) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    // Assigning to a teammate: confirm they belong to this org.
    if (assigneeUserId) {
      const { data: membership } = await supabase
        .from('user_company_roles')
        .select('user_id')
        .eq('company_id', organizationId)
        .eq('user_id', assigneeUserId)
        .maybeSingle();
      if (!membership) {
        return res.status(400).json({ error: 'Assignee is not a member of this organization' });
      }
    }

    const nowIso = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('engagement_threads')
      .update({
        assigned_to: assigneeUserId,
        assigned_by: assigneeUserId ? access.userId : null,
        assigned_at: assigneeUserId ? nowIso : null,
        updated_at: nowIso,
      })
      .eq('id', threadId)
      .eq('organization_id', organizationId);

    if (updateError) {
      console.warn('[engagement/thread/assign]', updateError.message);
      return res.status(500).json({ error: 'Failed to update assignment' });
    }

    try {
      await recordThreadEvent({
        organizationId,
        threadId,
        actorUserId: access.userId,
        eventType: assigneeUserId ? 'assigned' : 'unassigned',
        detail: assigneeUserId ? { assignee_user_id: assigneeUserId } : {},
      });
    } catch (eventErr) {
      console.warn('[engagement/thread/assign] thread-event log failed:', (eventErr as Error)?.message);
    }

    return res.status(200).json({ success: true, assigned_to: assigneeUserId });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed';
    console.error('[engagement/thread/assign]', msg);
    return res.status(500).json({ error: msg });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/engagement/thread/assign' });
