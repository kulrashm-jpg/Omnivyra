/**
 * GET /api/bolt/progress-stream?run_id=<id>[&since_event_id=<id>]
 *
 * Server-Sent Events endpoint. Streams planner progress + progressive
 * hydration events for a single BOLT run.
 *
 * Event types:
 *   - `ready`       : connection established + initial state snapshot
 *   - `planner`     : planner event (drafting_completed / alignment_completed
 *                     / salvage_applied / refinement_completed /
 *                     overload_mode_activated / plan_created /
 *                     progressive_phase_completed)
 *   - `heartbeat`   : keep-alive every 15s so proxies don't close the
 *                     connection
 *   - `closed`      : final event before the server closes the stream
 *                     (status: completed / failed / abandoned)
 *
 * Backward-compatible polling fallback: clients that don't support SSE keep
 * using `/api/bolt/progress`. This endpoint is purely additive.
 *
 * Reconnect: clients pass `?since_event_id=<id>` from the last received
 * `planner` event; the server replays events with id > since via
 * `replayCampaignEvents` then resumes live streaming. Ordering is preserved
 * per-campaign by the Redis Streams entry-id ordering.
 *
 * Heartbeat: SSE `: comment` lines fire every 15s to prevent Vercel /
 * Cloudflare / nginx proxies from idling the connection.
 *
 * Lifecycle: the handler holds the response open until the run reaches a
 * terminal status OR the client disconnects. Cleanup detaches all event-
 * bus subscriptions on close.
 *
 * SAFETY: rate-limited at the platform layer (Vercel handles this); each
 * request opens one SSE connection per `run_id`.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { plannerEventBus, type PlannerEvent } from '../../../backend/services/plannerEventBus';
import { replayCampaignEvents } from '../../../backend/services/plannerEventStreams';
import { counter, gauge, timed } from '../../../backend/services/plannerTelemetry';
import { withSpan } from '../../../backend/services/plannerTracing';

const HEARTBEAT_INTERVAL_MS = 15_000;

// Per-instance counter of currently-open SSE connections. Surfaced via the
// `planner_sse_connections_active` gauge so the operator UI shows live
// concurrent-connection counts without needing a separate counter store.
let _openSseConnections = 0;
const TERMINAL_POLL_MS = 1_500;
const MAX_STREAM_DURATION_MS = 10 * 60_000; // 10 min hard cap

function writeSseEvent(
  res: NextApiResponse,
  eventName: string,
  data: unknown,
  id?: string,
): void {
  // SSE wire format: `id: ...\nevent: ...\ndata: ...\n\n`
  if (id) res.write(`id: ${id}\n`);
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function writeSseComment(res: NextApiResponse, comment: string): void {
  res.write(`: ${comment}\n\n`);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const runId = typeof req.query.run_id === 'string' ? req.query.run_id.trim() : null;
  const sinceEventId = typeof req.query.since_event_id === 'string' ? req.query.since_event_id : null;
  if (!runId) {
    return res.status(400).json({ error: 'run_id is required' });
  }

  // Initial DB lookup: validate access + grab campaign_id for event filtering.
  const { data: run, error } = await supabase
    .from('bolt_execution_runs')
    .select('id, company_id, current_stage, status, progress_percentage, result_campaign_id')
    .eq('id', runId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: 'Failed to fetch run' });
  if (!run) return res.status(404).json({ error: 'Run not found' });

  const access = await enforceCompanyAccess({
    req,
    res,
    companyId: (run as { company_id: string }).company_id,
  });
  if (!access) return;

  const campaignId = (run as { result_campaign_id: string | null }).result_campaign_id ?? '';

  // ── SSE handshake headers ──────────────────────────────────────────────
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable nginx buffering
  });
  // Flush headers immediately so clients see "ready".
  (res as any).flushHeaders?.();
  writeSseEvent(res, 'ready', {
    run_id: runId,
    status: (run as { status: string }).status,
    progress_percentage: (run as { progress_percentage: number }).progress_percentage,
    current_stage: (run as { current_stage: string }).current_stage,
  });

  // Telemetry: bump the active-connection gauge and start an SSE-lifetime
  // server span. The span ends when `cleanup()` runs.
  _openSseConnections += 1;
  gauge('planner_sse_connections_active', _openSseConnections);
  let sseSpanEnd: (() => void) | null = null;
  try {
    void withSpan('sse/lifetime', async (span) => {
      span.setAttribute('campaign_id', campaignId);
      span.setAttribute('run_id', runId);
      await new Promise<void>((resolve) => { sseSpanEnd = resolve; });
    }, { kind: 'server' });
  } catch { /* tracing-safe */ }

  // ── Replay catch-up via Redis Streams ──────────────────────────────────
  // When the client passes since_event_id, replay any events newer than that
  // entry. Ordering per-campaign is preserved by Redis Streams entry-id sort.
  if (campaignId) {
    try {
      // Parse the since_event_id ("<ms>-<seq>"). If invalid, replay last 50.
      const sinceMsParsed = sinceEventId ? Number(String(sinceEventId).split('-')[0]) : null;
      const sinceMs = Number.isFinite(sinceMsParsed) && sinceMsParsed! > 0 ? sinceMsParsed! : undefined;
      // Time the replay so dashboards plot reconnect catch-up latency.
      const replay = await timed('planner_sse_replay_latency_ms', () =>
        replayCampaignEvents(campaignId, { count: 50, sinceMs }),
      );
      counter('planner_stream_replay_total', replay.length, { stream: 'planner:events' });
      for (const item of replay) {
        writeSseEvent(res, 'planner', { ...item.event, __replayed: true }, item.entryId);
      }
    } catch {
      // Replay failure is non-fatal — client will get live events from here.
    }
  }

  // ── Subscribe to live events ───────────────────────────────────────────
  const unsubscribeAny = plannerEventBus.onAny((event: PlannerEvent) => {
    if (!campaignId) return;
    if (event.campaign_id !== campaignId) return;
    try {
      writeSseEvent(res, 'planner', event, event.id);
    } catch {
      // Write failure → connection broken; cleanup happens on 'close' below.
    }
  });

  // ── Heartbeat ──────────────────────────────────────────────────────────
  const heartbeat = setInterval(() => {
    try {
      writeSseComment(res, `heartbeat ${Date.now()}`);
    } catch { /* socket closed */ }
  }, HEARTBEAT_INTERVAL_MS);
  (heartbeat as any)?.unref?.();

  // ── Terminal-status poll ───────────────────────────────────────────────
  // SSE has no concept of "run finished"; we poll bolt_execution_runs every
  // TERMINAL_POLL_MS and close the stream when status changes to terminal.
  const terminalPoll = setInterval(async () => {
    try {
      const { data: row } = await supabase
        .from('bolt_execution_runs')
        .select('status, progress_percentage, result_campaign_id')
        .eq('id', runId)
        .maybeSingle();
      const status = (row as { status?: string } | null)?.status;
      if (status && ['completed', 'failed', 'abandoned'].includes(status)) {
        writeSseEvent(res, 'closed', {
          status,
          progress_percentage: (row as { progress_percentage?: number } | null)?.progress_percentage ?? 100,
          result_campaign_id: (row as { result_campaign_id?: string } | null)?.result_campaign_id ?? null,
        });
        cleanup();
      }
    } catch {
      // Transient DB error — try again next tick.
    }
  }, TERMINAL_POLL_MS);
  (terminalPoll as any)?.unref?.();

  // ── Hard cap: don't hold connections > MAX_STREAM_DURATION_MS ──────────
  const maxDuration = setTimeout(() => {
    writeSseEvent(res, 'closed', { status: 'timeout' });
    cleanup();
  }, MAX_STREAM_DURATION_MS);
  (maxDuration as any)?.unref?.();

  let cleaned = false;
  function cleanup(): void {
    if (cleaned) return;
    cleaned = true;
    clearInterval(heartbeat);
    clearInterval(terminalPoll);
    clearTimeout(maxDuration);
    try { unsubscribeAny(); } catch { /* noop */ }
    try { res.end(); } catch { /* noop */ }
    // Telemetry: decrement active gauge + record disconnect reason; end SSE span.
    _openSseConnections = Math.max(0, _openSseConnections - 1);
    try { gauge('planner_sse_connections_active', _openSseConnections); } catch { /* noop */ }
    try { counter('planner_sse_disconnect_rate', 1, { reason: 'client_close' }); } catch { /* noop */ }
    if (sseSpanEnd) { try { sseSpanEnd(); } catch { /* noop */ } sseSpanEnd = null; }
  }

  req.on('close', cleanup);
  req.on('aborted', cleanup);
  res.on('close', cleanup);
}

// Disable the default Next.js body parser; SSE is a long-lived response and
// we manage the stream directly.
export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};
