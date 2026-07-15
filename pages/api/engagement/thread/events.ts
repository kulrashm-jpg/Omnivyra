import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * GET /api/engagement/thread/events?thread_id=&organization_id=
 * Collaboration activity timeline for a single engagement thread.
 * Returns chronological events (assigned / unassigned / replied / resolved /
 * ignored) with the acting user's display name resolved.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { resolveUserContext, enforceCompanyAccess } from '../../../../backend/services/userContextService';
import { supabase } from '../../../../backend/db/supabaseClient';

const MAX_EVENTS = 50;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const threadId = (req.query.thread_id as string | undefined)?.trim();
    const organizationId =
      (req.query.organization_id as string | undefined) ||
      (req.query.organizationId as string | undefined) ||
      user?.defaultCompanyId;

    if (!threadId) return res.status(400).json({ error: 'thread_id required' });
    if (!organizationId) return res.status(400).json({ error: 'organization_id required' });

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const { data: rows, error } = await supabase
      .from('engagement_thread_events')
      .select('id, event_type, actor_user_id, detail, created_at')
      .eq('organization_id', organizationId)
      .eq('thread_id', threadId)
      .order('created_at', { ascending: false })
      .limit(MAX_EVENTS);

    if (error) {
      console.warn('[engagement/thread/events]', error.message);
      return res.status(200).json({ events: [] });
    }

    const events = (rows ?? []) as Array<{
      id: string;
      event_type: string;
      actor_user_id: string | null;
      detail: Record<string, unknown> | null;
      created_at: string;
    }>;

    // Resolve actor display names (org members + email fallback). Best-effort.
    const actorIds = Array.from(
      new Set(
        events
          .flatMap((e) => [e.actor_user_id, (e.detail as { assignee_user_id?: string } | null)?.assignee_user_id])
          .filter((v): v is string => typeof v === 'string' && v.length > 0)
      )
    );
    const nameById = new Map<string, string>();
    if (actorIds.length > 0) {
      const { data: roles } = await supabase
        .from('user_company_roles')
        .select('user_id, name')
        .eq('company_id', organizationId)
        .in('user_id', actorIds);
      for (const r of (roles ?? []) as Array<{ user_id: string; name: string | null }>) {
        if (r.name) nameById.set(r.user_id, r.name);
      }
      const missing = actorIds.filter((id) => !nameById.has(id));
      if (missing.length > 0) {
        const { data: users } = await supabase.from('users').select('id, email').in('id', missing);
        for (const u of (users ?? []) as Array<{ id: string; email: string | null }>) {
          if (u.email) nameById.set(u.id, u.email);
        }
      }
    }

    const enriched = events.map((e) => {
      const assigneeId = (e.detail as { assignee_user_id?: string } | null)?.assignee_user_id ?? null;
      return {
        id: e.id,
        event_type: e.event_type,
        actor_user_id: e.actor_user_id,
        actor_name: e.actor_user_id ? nameById.get(e.actor_user_id) ?? null : null,
        assignee_user_id: assigneeId,
        assignee_name: assigneeId ? nameById.get(assigneeId) ?? null : null,
        created_at: e.created_at,
      };
    });

    return res.status(200).json({ events: enriched });
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Failed';
    console.error('[engagement/thread/events]', msg);
    return res.status(500).json({ error: msg });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/engagement/thread/events' });
