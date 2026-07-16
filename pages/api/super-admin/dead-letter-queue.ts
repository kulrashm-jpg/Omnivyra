import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * /api/super-admin/dead-letter-queue — the single canonical DLQ operational
 * surface. GET inspects; POST re-drives. Same auth, same operational workflow.
 *
 * GET — operator inspection of the worker dead-letter queue.
 *   Query parameters:
 *     workerName  — filter by job name
 *     tenantId    — filter to entries written by the canonical jobRunner
 *                   with this tenant lineage
 *     before      — ISO timestamp cursor for pagination
 *     limit       — page size (default 50, max 500)
 *     summary=1   — return aggregate counts by worker name instead of rows
 *     queues=1    — return the queue names a re-drive can target
 *
 * POST — controlled operator re-drive of one or more DLQ entries. Re-enqueues
 *   the original payload onto the canonical BullMQ queue the worker consumes
 *   (via jobInspection.replayDeadLetterEntry) and clears the DLQ row. This is
 *   an EXPLICIT, authenticated, audited action — never a GET side effect.
 *   Body:
 *     { id: string, queueName?: string, jobName?: string, reason?: string }
 *     { ids: string[], queueName?: string, jobName?: string, reason?: string }
 *   `queueName` defaults to each entry's worker_name; override when the
 *   worker's queue name differs. Each entry is re-driven and audited
 *   independently; the response reports per-entry outcomes.
 *
 * Auth: SUPER_ADMIN_DASHBOARD_VIEW (platform-tier capability), both methods.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdminRateLimit } from '../../../backend/services/requestAccessService';
import { requireCapability } from '../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../shared/contracts/security';
import { recordAdminAudit } from '../../../backend/services/adminAuditService';
import {
  listDeadLetters,
  summarizeDeadLetters,
  getDeadLetter,
  replayDeadLetterEntry,
  replayableQueueNames,
} from '../../../backend/services/jobInspection';

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  if (req.query.queues === '1' || req.query.queues === 'true') {
    return res.status(200).json({ ok: true, queues: await replayableQueueNames() });
  }
  if (req.query.summary === '1' || req.query.summary === 'true') {
    const since = typeof req.query.since === 'string' ? req.query.since : undefined;
    const counts = await summarizeDeadLetters({ since });
    return res.status(200).json({ ok: true, summary: counts });
  }
  const result = await listDeadLetters({
    workerName: typeof req.query.workerName === 'string' ? req.query.workerName : undefined,
    tenantId:   typeof req.query.tenantId   === 'string' ? req.query.tenantId   : undefined,
    before:     typeof req.query.before     === 'string' ? req.query.before     : undefined,
    limit:      typeof req.query.limit      === 'string' ? Number(req.query.limit) : undefined,
  });
  return res.status(200).json({ ok: true, ...result });
}

async function handlePost(req: NextApiRequest, res: NextApiResponse, actorUserId: string) {
  const body = (req.body ?? {}) as { id?: string; ids?: string[]; queueName?: string; jobName?: string; reason?: string };
  const ids = Array.isArray(body.ids) ? body.ids : (body.id ? [body.id] : []);
  const cleanIds = ids.map((i) => String(i).trim()).filter(Boolean);
  if (cleanIds.length === 0) return res.status(400).json({ ok: false, error: 'id or ids[] required' });
  if (cleanIds.length > 100) return res.status(400).json({ ok: false, error: 'at most 100 entries per re-drive' });

  const queueName = typeof body.queueName === 'string' && body.queueName.trim() ? body.queueName.trim() : undefined;
  const jobName = typeof body.jobName === 'string' && body.jobName.trim() ? body.jobName.trim() : undefined;

  const results: Array<Record<string, unknown>> = [];
  for (const id of cleanIds) {
    // Snapshot the previous state for the audit trail before we mutate.
    const before = await getDeadLetter(id).catch(() => null);
    try {
      const r = await replayDeadLetterEntry(id, { queueName, jobName });
      await recordAdminAudit({
        actorUserId,
        action: 'dlq.redrive',
        targetType: 'worker_dead_letter_queue',
        targetId: id,
        metadata: {
          queue: r.targetQueue,
          jobName: r.jobName,
          jobId: r.jobId,
          previous: before ? { workerName: before.workerName, failureReason: before.failureReason, attemptCount: before.attemptCount } : null,
          result: 'redriven',
          reason: body.reason ?? null,
        },
      });
      results.push({ id, ok: true, ...r });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await recordAdminAudit({
        actorUserId,
        action: 'dlq.redrive',
        targetType: 'worker_dead_letter_queue',
        targetId: id,
        metadata: { result: 'failed', error: msg, queue: queueName ?? null, reason: body.reason ?? null },
      });
      results.push({ id, ok: false, error: msg });
    }
  }
  const anyOk = results.some((r) => r.ok);
  return res.status(anyOk ? 200 : 422).json({ ok: anyOk, results });
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const bucket = req.method === 'POST' ? 'rl:super-admin:dlq-redrive' : 'rl:super-admin:dlq';
  if (!(await requireAdminRateLimit(req, res, bucket, 30, 60))) return;

  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: req.method === 'POST' ? 'super-admin dead-letter-queue re-drive' : 'super-admin dead-letter-queue inspection',
  });
  if (guard.ok !== true) return;

  try {
    if (req.method === 'POST') {
      const actorUserId =
        (guard.principal as { userId?: string }).userId ??
        (guard.principal as { id?: string }).id ??
        'super-admin';
      return await handlePost(req, res, actorUserId);
    }
    return await handleGet(req, res);
  } catch (err) {
    return res.status(500).json({
      ok:    false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/dead-letter-queue' });
