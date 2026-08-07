/**
 * WS1-E6-T003 — API → queue → worker trace continuity gate.
 *
 * The incident class: an enqueued job carried no link back to the request that
 * created it, so a worker log line could not be correlated to the API call that
 * caused the work. Both halves are required and neither is sufficient alone:
 *
 *   ENQUEUE half — `withTraceMeta` stamps `_trace` onto the payload.
 *                  Delivered centrally by WS1-E6-T002: `safeEnqueue` is the
 *                  only sanctioned enqueue path, so every non-exempt job is
 *                  stamped without per-call-site adoption.
 *   WORKER half  — `runWithJobTraceContext` restores that `_trace` into the
 *                  RequestContext ALS so the processor's logs carry the
 *                  originating request/correlation id.
 *
 * A job stamped but never restored looks identical to an untraced one in the
 * logs, which is why this gate asserts EVERY worker registration, not just the
 * factory.
 *
 * Behaviour is asserted directly against traceKit (it is pure and importable).
 * Worker registration is asserted from SOURCE, because those processors are
 * closures built during bootstrap — the same technique workerTopologyParity
 * uses. No database, no network, no Redis.
 */
import fs from 'fs';
import path from 'path';
import {
  TRACE_JOB_FIELD,
  withTraceMeta,
  runWithJobTraceContext,
} from '../../observability/traceKit';
import { runWithRequestContext, getRequestContext } from '../../services/requestContext';

const ROOT = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('trace stamping (enqueue half)', () => {
  it('stamps _trace when a request context is active', () => {
    runWithRequestContext({ requestId: 'req-1', correlationId: 'corr-1', traceId: 'trace-1' }, () => {
      const stamped = withTraceMeta({ leadId: 'L1' }) as Record<string, unknown>;
      expect(stamped[TRACE_JOB_FIELD]).toBeDefined();
      expect(stamped.leadId).toBe('L1');
    });
  });

  it('returns the payload UNCHANGED outside any context', () => {
    // Must be identity, not a copy: enqueue payload shape is a contract.
    const data = { leadId: 'L2' };
    expect(withTraceMeta(data)).toBe(data);
  });

  it('is reached through safeEnqueue, the only sanctioned enqueue path', () => {
    expect(read('middleware/queueBackpressure.ts')).toMatch(
      /queue\.add\(jobName,\s*withTraceMeta\(payload\),\s*jobOptions\)/,
    );
  });
});

describe('trace restoration (worker half)', () => {
  it('restores the enqueuer correlation id onto the processor', () => {
    const stamped = runWithRequestContext(
      { requestId: 'req-9', correlationId: 'corr-9', traceId: 'trace-9' },
      () => withTraceMeta({ x: 1 }),
    );
    let seen: string | undefined;
    runWithJobTraceContext({ id: 'j1', queueName: 'engine-jobs', data: stamped }, () => {
      seen = getRequestContext().correlationId;
    });
    expect(seen).toBe('corr-9');
  });

  it('falls back to job identity when the job was never stamped', () => {
    let seen: string | undefined;
    runWithJobTraceContext({ id: 'j2', queueName: 'publish', data: {} }, () => {
      seen = getRequestContext().correlationId;
    });
    expect(seen).toBe('job:publish:j2');
  });

  it('never throws — a malformed _trace degrades to running unscoped', () => {
    let ran = false;
    runWithJobTraceContext({ id: 'j3', data: { [TRACE_JOB_FIELD]: 'not-an-object' } }, () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});

describe('every worker registration restores trace context', () => {
  // file → the worker registrations it owns. A worker that does not restore
  // context breaks the API→worker link for its whole queue, even though the
  // job payload carries `_trace`.
  const WORKER_FILES: Record<string, string> = {
    'queue/bullmqClient.ts': 'getWorker + getEngagementPollingWorker + createWorker',
    'queue/contentGenerationQueues.ts': 'content x2, bolt-content-jobs, whatsapp-broadcast, whatsapp-webhook, analytics-ingestion',
    'workers/main.ts': 'engine-jobs, ai-heavy, lead-thread-recompute, conversation-memory-rebuild',
    'workers/campaignPlanningWorker.ts': 'ai-heavy (standalone entry)',
    'workers/intelligencePollingWorker.ts': 'intelligence-polling',
    'services/creatorRenderDurableQueue.ts': 'creator-render',
  };

  it.each(Object.keys(WORKER_FILES))('%s restores trace context', (rel) => {
    expect({ file: rel, restores: read(rel).includes('runWithJobTraceContext(') }).toEqual({
      file: rel,
      restores: true,
    });
  });

  it('no `new Worker(` exists outside the files that restore context', () => {
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const child = dir === '.' ? e.name : `${dir}/${e.name}`;
        if (e.isDirectory()) {
          if (['tests', 'node_modules'].includes(e.name)) continue;
          walk(child, out);
        } else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) out.push(child);
      }
      return out;
    };
    const offenders = walk('.').filter((rel) => {
      const src = read(rel);
      // Line-based, skipping comments: queueObservability.ts documents the
      // "raw `new Worker(...)` sites" in prose and must not be flagged for it.
      const constructs = src.split('\n').some((line) => {
        const code = line.trim();
        if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return false;
        return /new Worker[<(]/.test(line);
      });
      if (!constructs) return false;
      return !src.includes('runWithJobTraceContext(');
    });
    expect(offenders).toEqual([]);
  });
});
