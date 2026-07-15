import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * GET /api/campaigns/[id]/orchestration-events
 * Phase-2 Step-23 SSE channel · Step-24 distributed transport ·
 * Step-25 durable Last-Event-ID replay + reconnect/cold-start recovery.
 *
 * On (re)connect the browser sends `Last-Event-ID` (native auto-reconnect)
 * or `?lastEventId=` (client-persisted cold-start resume). We subscribe to
 * the live feed FIRST (buffering), replay everything strictly after the
 * cursor from the durable stream, flush the buffer with id-dedupe, then go
 * live — so no event is missed across the replay→live seam and none is
 * delivered twice.
 *
 * READ-ONLY, fail-soft: durable replay is best-effort (empty on failure →
 * Step-22 reconcile remains the safety net); any write error closes the
 * connection cleanly.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCampaignAccess } from '../../../../backend/services/campaignAccessService';
import {
  subscribeOrchestrationEvents,
  orchestrationEventDiagnostics,
  ensureDistributedOrchestrationTransport,
  getDurableOrchestrationEventStream,
} from '../../../../backend/services/orchestration';
import type { OrchestrationEvent } from '../../../../backend/services/orchestration/events';

export const config = { api: { bodyParser: false, externalResolver: true } };

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { id, lastEventId: qLast } = req.query;
  const campaignId = typeof id === 'string' ? id : Array.isArray(id) ? id[0] : '';
  const access = await requireCampaignAccess(req, res, campaignId);
  if (!access) return;

  // Step-24: promote to the distributed transport when configured
  // (idempotent, fail-soft → in-process otherwise).
  ensureDistributedOrchestrationTransport();

  const headerLast = req.headers['last-event-id'];
  const lastEventId =
    (typeof headerLast === 'string' && headerLast) ||
    (typeof qLast === 'string' && qLast) ||
    (Array.isArray(qLast) ? qLast[0] : '') ||
    null;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const write = (payload: string): boolean => {
    try { res.write(payload); return true; } catch { return false; }
  };

  // Bounded server-side dedupe across the replay→live seam.
  const seen = new Set<string>();
  const remember = (eid: string | null | undefined) => {
    if (!eid) return false;
    if (seen.has(eid)) return true;
    seen.add(eid);
    if (seen.size > 1000) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    return false;
  };

  const writeEvent = (event: OrchestrationEvent, source: 'replay' | 'live'): void => {
    if (event.event_id && remember(event.event_id)) {
      orchestrationEventDiagnostics.push({
        campaign_id: access.campaignId, event_type: event.type,
        event_id: event.event_id, duplicate_suppressed: true, delivery: source,
      });
      return;
    }
    const idLine = event.event_id ? `id: ${event.event_id}\n` : '';
    const ok = write(`${idLine}event: orchestration\ndata: ${JSON.stringify(event)}\n\n`);
    if (!ok) { cleanup(); return; }
    orchestrationEventDiagnostics.push({
      campaign_id: access.campaignId,
      execution_id: event.execution_id,
      event_type: event.type,
      event_id: event.event_id ?? null,
      delivery: source,
    });
  };

  write(`retry: 5000\n\n`);

  // ── Phase 1: subscribe live but BUFFER until replay completes ──────────
  let phase: 'replaying' | 'live' = 'replaying';
  const buffer: OrchestrationEvent[] = [];
  const sub = subscribeOrchestrationEvents(access.campaignId, (event) => {
    if (phase === 'replaying') buffer.push(event);
    else writeEvent(event, 'live');
  });

  let closed = false;
  function cleanup() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    try { sub.unsubscribe(); } catch { /* noop */ }
    try { res.end(); } catch { /* noop */ }
  }
  const heartbeat = setInterval(() => {
    if (!write(`: ping ${Date.now()}\n\n`)) cleanup();
  }, 25_000);
  req.on('close', cleanup);
  req.on('error', cleanup);

  // ── Phase 2: durable replay strictly AFTER the cursor ─────────────────
  try {
    const replayed = await getDurableOrchestrationEventStream().replay(
      access.campaignId,
      lastEventId,
    );
    for (const ev of replayed) {
      if (closed) return;
      writeEvent(ev, 'replay');
    }
  } catch {
    orchestrationEventDiagnostics.fail({
      campaign_id: access.campaignId,
      reconnect_source: lastEventId ? 'last_event_id' : 'fresh',
      recovery_success: false,
    });
  }
  if (closed) return;

  // ── Phase 3: flush buffered live events (id-deduped vs replay) → live ──
  write(`event: ready\ndata: ${JSON.stringify({
    campaign_id: access.campaignId,
    resumed_from: lastEventId,
    replayed: true,
  })}\n\n`);
  const drained = buffer.splice(0, buffer.length);
  phase = 'live';
  for (const ev of drained) {
    if (closed) return;
    writeEvent(ev, 'live');
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/campaigns/:id/orchestration-events' });
