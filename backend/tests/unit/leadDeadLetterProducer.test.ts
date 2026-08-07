/**
 * WS1-E6-T001 — dead-letter producer gates.
 *
 * The incident class: every BullMQ `failed` handler in the fleet ended at a
 * `console.error`. A job that burned all its attempts left a log line and
 * nothing durable, so both dead-letter sinks stayed empty for queue work —
 * and an empty DLQ is indistinguishable from a healthy one.
 *
 * Two sinks are involved, deliberately:
 *   • `lead-jobs-dlq` (BullMQ)            — LEAD-specific, counted by
 *     getLeadQueueObservabilitySnapshot().dead_letter.
 *   • `worker_dead_letter_queue` (Postgres) — fleet-wide, read by
 *     /api/system/dead-letters and /api/super-admin/dead-letter-queue.
 *
 * isExhausted() is tested behaviourally. The wiring is asserted from SOURCE
 * because the handlers are closures created during worker bootstrap and cannot
 * be imported in isolation — the same string-literal evidence technique
 * workerTopologyParity.test.ts uses for consumer wiring. Neither executes
 * BullMQ; that is the runtime-validation step recorded against this package.
 *
 * No database, no network, no Redis.
 */
import fs from 'fs';
import path from 'path';
import { isExhausted } from '../../queue/deadLetterOnExhaustion';

const ROOT = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const job = (attemptsMade: number, attempts?: number) =>
  ({ id: '1', name: 'n', data: {}, attemptsMade, opts: { attempts } }) as never;

describe('isExhausted', () => {
  it('is false while attempts remain', () => {
    expect(isExhausted(job(1, 5))).toBe(false);
    expect(isExhausted(job(4, 5))).toBe(false);
  });

  it('is true on the final attempt', () => {
    expect(isExhausted(job(5, 5))).toBe(true);
  });

  it('is true beyond the allowance (defensive)', () => {
    expect(isExhausted(job(6, 5))).toBe(true);
  });

  it('treats a job with no attempts option as single-attempt', () => {
    // BullMQ defaults to 1 attempt; such a job is exhausted the first time.
    expect(isExhausted(job(1, undefined))).toBe(true);
  });

  it('is false for an undefined job', () => {
    expect(isExhausted(undefined)).toBe(false);
  });
});

describe('lead dead-letter producer (lead-jobs-dlq)', () => {
  const src = () => read('queue/leadQueueHardening.ts');

  it('exposes the shared handler both bootstraps attach', () => {
    expect(src()).toMatch(/export function attachLeadJobFailureHandler/);
  });

  it('republishes ONLY when attempts are exhausted', () => {
    // Without this guard every intermediate retry would dead-letter a job that
    // BullMQ is still going to retry, reporting live jobs as dead.
    expect(src()).toMatch(/if\s*\(\s*meta\.attempts_made\s*<\s*meta\.attempts_allowed\s*\)\s*return;/);
  });

  it('publishes to the dead-letter queue with a deterministic jobId', () => {
    expect(src()).toMatch(/getLeadDeadLetterQueue\(\)\.add\(/);
    expect(src()).toMatch(/jobId:\s*`dlq:\$\{meta\.job_id\}`/);
  });

  it('is fail-safe against BOTH synchronous throw and async rejection', () => {
    // Runs inside an event-emitter callback: a rejection becomes an unhandled
    // rejection, and a synchronous throw escapes the handler entirely.
    expect(src()).toMatch(/\.catch\(onLeadFailureHandlerError\(meta\.job_id\)\)/);
    expect(src()).toMatch(/catch\s*\(e\)\s*\{[\s\S]{0,200}onLeadFailureHandlerError/);
  });

  it('preserves the per-attempt failure log', () => {
    expect(src()).toContain('[lead-job-failed]');
  });

  it('no longer advertises itself as producer-less', () => {
    expect(src()).not.toContain('no DLQ producer');
    expect(src()).toMatch(/ACTIVATION STATUS/);
  });
});

describe('prod ↔ dev parity for LEAD failure handling', () => {
  it('BOTH bootstraps attach the shared handler', () => {
    // Production (workers/main.ts) previously had NO 'failed' handler on
    // engineWorker at all, so the dev-only handler created exactly the
    // divergence class workerTopologyParity.test.ts exists to prevent.
    expect(read('queue/startWorkers.ts')).toMatch(/attachLeadJobFailureHandler\(engineWorker\)/);
    expect(read('workers/main.ts')).toMatch(/attachLeadJobFailureHandler\(engineWorker\)/);
  });

  it('leadQueue.ts remains deleted — activation landed on engine-jobs', () => {
    expect(fs.existsSync(path.join(ROOT, 'queue', 'leadQueue.ts'))).toBe(false);
  });
});

describe('fleet dead-letter coverage (worker_dead_letter_queue)', () => {
  // Files whose `failed` handlers are NOT dead-letter sites, each for a
  // documented reason. Anything else with a failed handler must dead-letter.
  const EXEMPT: Record<string, string> = {
    'observability/queueObservability.ts': 'metrics instrumentation only',
    'queue/queueInstrumentation.ts': 'metrics instrumentation only',
    'queue/deadLetterOnExhaustion.ts': 'the helper itself',
    'queue/leadQueueHardening.ts': 'owns the lead-jobs-dlq path',
    'queue/workerTopology.ts': 'workers built via getWorker() — covered by the factory',
    'queue/startWorkers.ts': 'creator-render has its own DLQ (creatorRenderDurableQueue)',
    'workers/main.ts': 'creator-render exempt; every other handler covered (asserted below)',
  };

  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = dir === '.' ? e.name : `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === 'tests' || e.name === 'node_modules') continue;
        walk(rel, out);
      } else if (e.name.endsWith('.ts')) out.push(rel);
    }
    return out;
  };

  it('every non-exempt failed handler dead-letters on exhaustion', () => {
    // Walks ALL of backend/ — not just queue/workers/observability — so a
    // worker introduced in any other subtree (services/, jobs/, scheduler/…)
    // cannot silently reopen the "exhausted jobs vanish" gap.
    const offenders: string[] = [];
    for (const rel of walk('.')) {
      const src = read(rel);
      if (!src.includes(".on('failed'")) continue;
      if (EXEMPT[rel]) continue;
      if (!src.includes('deadLetterOnExhaustion(')) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('the getWorker factory dead-letters, covering every queue built through it', () => {
    // One wiring point covers publish, bolt-execution, engagement-polling,
    // engine-jobs, planner-refinement, listening/semantic/replay partitions.
    const src = read('queue/bullmqClient.ts');
    expect(src).toMatch(/deadLetterOnExhaustion\(queueName, job, err\)/);
    expect(src).toMatch(/deadLetterOnExhaustion\('engagement-polling', job, err\)/);
    expect(src).toMatch(/deadLetterOnExhaustion\(name, job, err\)/);
  });

  it('reuses the platform sink rather than introducing a new one', () => {
    // moveToDeadLetter is the pre-existing writer for worker_dead_letter_queue.
    expect(read('queue/deadLetterOnExhaustion.ts')).toMatch(
      /import\('\.\.\/services\/workerRetryService'\)/,
    );
  });
});
