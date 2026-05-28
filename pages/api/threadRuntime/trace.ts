/**
 * Phase 1 — Central trace transport endpoint.
 *
 * Ingests a batch of `ThreadRuntimeTraceEvent`s from a client tab into the
 * server-side trace registry. The endpoint is:
 *   - authenticated (requires supabase user; rejects unauthenticated POSTs)
 *   - append-only (no update or delete semantics)
 *   - idempotent (per-event `eventId` deduplicated inside the registry)
 *   - retry-safe (clients can re-POST the same batch indefinitely)
 *   - batched (single request carries up to MAX_BATCH events)
 *   - bounded (single event capped at MAX_EVENT_BYTES; full batch at MAX_BATCH_BYTES)
 *   - graceful (validation errors return 200 with per-event accept/reject;
 *               only auth / shape errors return non-200)
 *
 * Goal: when the client tab refreshes / crashes / navigates away, the
 * already-flushed events live in the server registry. The next operator
 * introspection sees them.
 *
 * Does NOT touch publishing / scheduling logic.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { getDefaultThreadRuntimeTraceRegistry } from '@/backend/services/threadRuntime/threadRuntimeTraceRegistry';
import {
  validateAndNormalize,
  ReplayContractViolation,
} from '@/backend/services/threadRuntime/runtimeReplayContractValidator';

const MAX_BATCH = 200;
const MAX_EVENT_BYTES = 8 * 1024;          // 8 KB per event
const MAX_BATCH_BYTES = 256 * 1024;        // 256 KB per request

type IncomingEvent = {
  eventId: string;
  runtimeSessionId: string;
  threadId: string;
  companyId: string;
  transitionType: string;
  parentNodeId?: string | null;
  childNodeIds?: string[];
  nodeGenerationMode?: 'manual' | 'ai' | 'mixed';
  latencyMs?: number;
  detail?: string;
  payload?: Record<string, unknown>;
  timestamp?: string;
};

type PerEventResult = {
  eventId: string;
  status: 'accepted' | 'duplicate' | 'rejected';
  reason?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    return;
  }

  // Authentication — same supabase pattern used by the rest of the codebase.
  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user?.id) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return;
  }

  // Body shape gate.
  const body = req.body as { events?: unknown } | null;
  const events = Array.isArray(body?.events) ? body!.events as IncomingEvent[] : null;
  if (!events) {
    res.status(400).json({ error: 'BAD_REQUEST', reason: 'expected { events: [...] }' });
    return;
  }
  if (events.length === 0) {
    res.status(200).json({ accepted: 0, duplicate: 0, rejected: 0, results: [] });
    return;
  }
  if (events.length > MAX_BATCH) {
    res.status(413).json({ error: 'PAYLOAD_TOO_LARGE', reason: `batch >${MAX_BATCH} events` });
    return;
  }

  // Cheap bytes check on the JSON-stringified body — Node.js doesn't expose
  // request size directly; the JSON already parsed, so we re-stringify.
  // Bounded by MAX_BATCH so worst-case is cheap.
  let totalBytes = 0;
  for (const e of events) {
    let bytes = 0;
    try {
      bytes = JSON.stringify(e).length;
    } catch {
      bytes = MAX_EVENT_BYTES + 1; // treat unstringifiable as oversized
    }
    if (bytes > MAX_EVENT_BYTES) {
      res.status(413).json({ error: 'EVENT_TOO_LARGE', reason: `event >${MAX_EVENT_BYTES}B` });
      return;
    }
    totalBytes += bytes;
    if (totalBytes > MAX_BATCH_BYTES) {
      res.status(413).json({ error: 'BATCH_TOO_LARGE', reason: `batch >${MAX_BATCH_BYTES}B` });
      return;
    }
  }

  const registry = getDefaultThreadRuntimeTraceRegistry();
  const results: PerEventResult[] = [];
  let accepted = 0, duplicate = 0, rejected = 0;

  for (const e of events) {
    // Required field gate.
    if (!e || typeof e !== 'object' || !e.eventId || !e.runtimeSessionId || !e.threadId || !e.companyId || !e.transitionType) {
      results.push({ eventId: e?.eventId ?? '(missing)', status: 'rejected', reason: 'missing required fields' });
      rejected += 1;
      continue;
    }

    // Pre-record dedup check (avoids running validation on a known-duplicate).
    const existingTrace = registry.getTrace(e.runtimeSessionId);
    if (existingTrace?.events.some((x) => x.eventId === e.eventId)) {
      results.push({ eventId: e.eventId, status: 'duplicate' });
      duplicate += 1;
      continue;
    }

    // Run the replay contract validator. Failures are per-event soft rejects.
    try {
      const normalized = validateAndNormalize({
        runtimeSessionId: e.runtimeSessionId,
        threadId: e.threadId,
        companyId: e.companyId,
        transitionType: e.transitionType as IncomingEvent['transitionType'] as never, // refined by validator
        parentNodeId: e.parentNodeId ?? null,
        childNodeIds: e.childNodeIds,
        nodeGenerationMode: e.nodeGenerationMode === 'manual' || e.nodeGenerationMode === 'ai' ? e.nodeGenerationMode : undefined,
        latencyMs: e.latencyMs,
        detail: e.detail,
        payload: e.payload,
        timestamp: e.timestamp,
        eventId: e.eventId,
      });
      registry.recordEvent(normalized);
      results.push({ eventId: e.eventId, status: 'accepted' });
      accepted += 1;
    } catch (err) {
      if (err instanceof ReplayContractViolation) {
        results.push({ eventId: e.eventId, status: 'rejected', reason: err.message });
      } else {
        results.push({ eventId: e.eventId, status: 'rejected', reason: (err as Error).message });
      }
      rejected += 1;
    }
  }

  // Trace ingestion never returns 500 from partial validation failures —
  // those are reported per-event so the client can drop them from its queue.
  res.status(200).json({ accepted, duplicate, rejected, results });
}
