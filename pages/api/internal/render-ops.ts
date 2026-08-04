import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * Internal Render Ops — Step-R7 operations console API (super-admin).
 *
 *   GET  → console snapshot (queue / workers / providers / governance /
 *          analytics / moderation events / failed-recovery). READ-FIRST.
 *   POST → operator actions: governance.set | provider.disable |
 *          provider.maintenance | provider.priority | queue.retry |
 *          queue.cancel. Each writes an IMMUTABLE audit row.
 *
 * SAFETY
 *   - Internal-only, super-admin. Fail-closed → 403 otherwise. The gate is
 *     the same two-step every /api/super-admin endpoint uses: the audited
 *     legacy bridge session, else a canonical DB-backed platform super admin.
 *     SEC-001C added the canonical arm — this route previously accepted ONLY
 *     the bridge, so it would have become permanently unreachable at the
 *     bridge hard expiry (2026-08-05T00:00:00Z) with no way back in.
 *   - Fail-closed actions via pure builders; NO immutable-lineage
 *     mutation (only governance/provider config + mutable queue state).
 *   - Scheduler-isolated; R3–R6 cores untouched; image-only preserved.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { ownedDbTable } from '@/backend/db/writeOwner';
import {
  aggregateRenderAnalytics,
  buildGovernancePatch, buildProviderPatch, classifyQueueAction, buildOpsAuditRow,
  GLOBAL_GOVERNANCE_SENTINEL,
} from '@/backend/services/creator/rendering';
import { getLegacySuperAdminSession } from '@/backend/services/superAdminSession';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '@/backend/services/rbacService';

const ACTIVE = ['claimed', 'rendering', 'processing', 'moderation'];

/**
 * SEC-001C: identical to the gate used by the /api/super-admin/* routes.
 * The canonical DB-backed arm is NOT a bypass — `isPlatformSuperAdmin` is the
 * migration TARGET the bridge exists to be replaced by, and it is strictly
 * harder to satisfy than a cookie. Without it this route had a single
 * authorization source that is scheduled to die, which is an availability
 * defect, not a security property.
 */
async function isSuperAdmin(req: NextApiRequest): Promise<boolean> {
  if (getLegacySuperAdminSession(req) !== null) return true;
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id && (await isPlatformSuperAdmin(user.id))) return true;
  return false;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await isSuperAdmin(req))) {
    return res.status(403).json({ error: 'Operator access required.', code: 'NOT_OPERATOR' });
  }
  const actor = String(req.cookies?.super_admin_actor || 'super_admin');
  const nowIso = new Date().toISOString();

  try {
    if (req.method === 'GET') {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const [
        { data: qRows }, { data: aRows }, { data: jsRows }, { data: stale },
        { data: providers }, { data: govRows }, { data: modEvents },
        { data: failed },
      ] = await Promise.all([
        supabase.from('creator_render_queue_job').select('id, queue_state, retry_count, provider_key, created_at, updated_at, last_error, render_job_id').gte('created_at', since).limit(2000),
        supabase.from('creator_render_attempt').select('status, provider_key').gte('created_at', since).limit(2000),
        supabase.from('creator_render_job_state').select('current_state').limit(2000),
        supabase.from('creator_render_queue_job').select('id').in('queue_state', ACTIVE).lt('lease_expires_at', nowIso).limit(500),
        supabase.from('creator_render_provider').select('provider_key, health_state, priority_weight, capability_matrix').limit(50),
        supabase.from('creator_render_governance_state').select('*').limit(500),
        supabase.from('creator_render_moderation_event').select('subject_type, moderation_phase, moderation_result, policy_version, moderator_source, created_at').order('created_at', { ascending: false }).limit(50),
        supabase.from('creator_render_queue_job').select('id, render_job_id, provider_key, retry_count, last_error, updated_at').eq('queue_state', 'failed').order('updated_at', { ascending: false }).limit(50),
      ]);
      const queue = (qRows as any[]) ?? [];
      const staleCount = Array.isArray(stale) ? stale.length : 0;
      const depth: Record<string, number> = {};
      const inflight: Record<string, number> = {};
      for (const r of queue) {
        depth[r.queue_state] = (depth[r.queue_state] || 0) + 1;
        if (ACTIVE.includes(r.queue_state)) inflight[String(r.provider_key)] = (inflight[String(r.provider_key)] || 0) + 1;
      }
      const analytics = aggregateRenderAnalytics({
        queueRows: queue, attemptRows: (aRows as any[]) ?? [], jobStateRows: (jsRows as any[]) ?? [],
        staleLeaseCount: staleCount, duplicateReuseCount: 0,
      });
      const stuck = queue.filter((r) => ACTIVE.includes(r.queue_state) &&
        Date.parse(r.updated_at || r.created_at) < Date.now() - 10 * 60_000);
      return res.status(200).json({
        ok: true, generated_at: nowIso,
        queue: { depth_by_state: depth, in_flight_by_provider: inflight, stale_leases: staleCount, stuck_jobs: stuck.slice(0, 50) },
        workers: { active_in_flight: Object.values(inflight).reduce((a, b) => a + b, 0), avg_render_duration_ms: analytics.avg_render_duration_ms },
        providers: (providers as any[]) ?? [],
        governance: (govRows as any[]) ?? [],
        analytics,
        moderation_events: (modEvents as any[]) ?? [],
        failed_recovery: (failed as any[]) ?? [],
      });
    }

    // ── POST operator action ──────────────────────────────────────────
    const body = (req.body || {}) as Record<string, unknown>;
    const action = String(body.action || '');

    const audit = async (target: string | null, outcome: 'applied' | 'rejected' | 'noop', payload: Record<string, unknown>) => {
      try {
        await ownedDbTable('creator_render_ops_audit').insert(
          buildOpsAuditRow(actor, action as any, target, outcome, payload));
      } catch { /* audit best-effort; never blocks the response */ }
    };

    if (action === 'governance.set') {
      const orgId = String(body.organization_id || '').trim() || GLOBAL_GOVERNANCE_SENTINEL;
      const d = buildGovernancePatch(body.patch);
      if (!d.ok) { await audit(orgId, 'rejected', { reason: d.reason }); return res.status(400).json({ ok: false, reason: d.reason }); }
      if (d.outcome === 'noop') { await audit(orgId, 'noop', {}); return res.status(200).json({ ok: true, outcome: 'noop' }); }
      await ownedDbTable('creator_render_governance_state').upsert(
        { organization_id: orgId, ...d.patch, updated_at: nowIso }, { onConflict: 'organization_id' });
      await audit(orgId, 'applied', d.patch as any);
      return res.status(200).json({ ok: true, outcome: 'applied', patch: d.patch });
    }

    if (action === 'provider.disable' || action === 'provider.maintenance' || action === 'provider.priority') {
      const provider = String(body.provider_key || '').trim();
      const d = buildProviderPatch(action, body);
      if (!d.ok) { await audit(provider || null, 'rejected', { reason: d.reason }); return res.status(400).json({ ok: false, reason: d.reason }); }
      const { error } = await ownedDbTable('creator_render_provider')
        .update({ ...d.patch, updated_at: nowIso }).eq('provider_key', provider);
      if (error) { await audit(provider, 'rejected', { reason: 'db_error' }); return res.status(500).json({ ok: false, reason: 'db_error' }); }
      await audit(provider, 'applied', d.patch as any);
      return res.status(200).json({ ok: true, outcome: 'applied', patch: d.patch });
    }

    if (action === 'queue.retry' || action === 'queue.cancel') {
      const qId = String(body.queue_job_id || '').trim();
      if (!qId) return res.status(400).json({ ok: false, reason: 'queue_job_id_required' });
      const { data: q } = await supabase.from('creator_render_queue_job')
        .select('id, queue_state').eq('id', qId).maybeSingle();
      if (!q) { await audit(qId, 'rejected', { reason: 'not_found' }); return res.status(404).json({ ok: false, reason: 'not_found' }); }
      const d = classifyQueueAction(action, (q as any).queue_state, nowIso);
      if (!d.ok) { await audit(qId, 'rejected', { reason: d.reason }); return res.status(409).json({ ok: false, reason: d.reason }); }
      const { error } = await ownedDbTable('creator_render_queue_job').update(d.patch as any).eq('id', qId);
      if (error) { await audit(qId, 'rejected', { reason: 'db_error' }); return res.status(500).json({ ok: false, reason: 'db_error' }); }
      await audit(qId, 'applied', { from: (q as any).queue_state, ...(d.patch as any) });
      return res.status(200).json({ ok: true, outcome: 'applied', patch: d.patch });
    }

    return res.status(400).json({ ok: false, reason: 'INVALID_ACTION' });
  } catch (e) {
    // Read/console probe + actions never 500 the operator console hard.
    return res.status(200).json({ ok: false, code: 'OPS_ERROR', error: e instanceof Error ? e.message : 'unexpected' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/internal/render-ops' });
