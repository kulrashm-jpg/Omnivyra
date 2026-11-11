import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * /api/super-admin/message-retention — N-4. The only way stored message content is cleared.
 *
 * GET  — preview: how many rows an approval would clear. Reads only.
 *   Query: store, organizationId (not for dead_letters), cutoff (ISO instant)
 * POST — approve and clear. Records the approval (who, which tenant, which store, cutoff)
 *   and then clears; audited. Body: { store, organizationId?, cutoff, reason }
 *
 * OWNER RULE (2026-11-06): nothing is cleared without an admin's approval, and nothing
 * younger than 3 days (MIN_RETENTION_DAYS; also a CHECK on message_retention_approvals).
 * Nothing calls this on a schedule.
 *
 * Auth: SUPER_ADMIN_DASHBOARD_VIEW; POST also needs platform write authority, as the
 * dead-letter re-drive does.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminRateLimit } from '../../../backend/services/requestAccessService';
import { requireCapability } from '../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../shared/contracts/security';
import { recordAdminAudit } from '../../../backend/services/adminAuditService';
import {
  approveAndClear,
  isRetentionStore,
  previewClearing,
  RetentionRefusal,
  RETENTION_STORES,
  MIN_RETENTION_DAYS,
} from '../../../backend/services/retention/messageContentRetention';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

function readRequest(src: Record<string, unknown>) {
  const store = src.store;
  if (!isRetentionStore(store)) return { error: { error: 'unsupported_store', allowed: [...RETENTION_STORES] } } as const;
  const cutoff = str(src.cutoff);
  if (!cutoff) return { error: { error: 'cutoff_required', minimumAgeDays: MIN_RETENTION_DAYS } } as const;
  return { request: { store, organizationId: str(src.organizationId), cutoff } } as const;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const bucket = req.method === 'POST' ? 'rl:super-admin:retention-clear' : 'rl:super-admin:retention';
  if (!(await requireAdminRateLimit(req, res, bucket, 10, 60))) return;

  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: req.method === 'POST' ? 'super-admin message content clearing' : 'super-admin message retention preview',
    requirePlatformAuthority: req.method === 'POST',
  });
  if (guard.ok !== true) return;

  const src = (req.method === 'GET' ? req.query : (req.body ?? {})) as Record<string, unknown>;
  const parsed = readRequest(src);
  if ('error' in parsed) return res.status(400).json({ ok: false, ...parsed.error });

  try {
    if (req.method === 'GET') {
      const rows = await previewClearing(parsed.request);
      return res.status(200).json({ ok: true, ...parsed.request, rows });
    }

    const actorUserId = (guard.principal as { userId?: string }).userId;
    if (!actorUserId) return res.status(403).json({ ok: false, error: 'approver_unidentified' });
    const reason = str(src.reason);
    if (!reason) return res.status(400).json({ ok: false, error: 'reason_required' });

    const result = await approveAndClear({ ...parsed.request, approvedBy: actorUserId, reason });
    await recordAdminAudit({
      actorUserId,
      action: 'retention.clear',
      targetType: parsed.request.store,
      targetId: result.approvalId,
      metadata: { organizationId: parsed.request.organizationId, cutoff: parsed.request.cutoff, rowsCleared: result.rowsCleared, reason },
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof RetentionRefusal) return res.status(400).json({ ok: false, error: err.code, message: err.message });
    return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

export default __createApiRoute(handler, { route: '/api/super-admin/message-retention' });
