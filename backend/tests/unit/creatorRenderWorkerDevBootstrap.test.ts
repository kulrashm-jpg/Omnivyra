/**
 * Regression guard + simulation for the creator-render worker
 * bootstrap fix.
 *
 * Bug history: production booted workers via `backend/workers/main.ts`,
 * which DID register a worker on the `creator-render` BullMQ queue.
 * Local dev (`npm run dev:full`) booted workers via
 * `backend/queue/startWorkers.ts`, which did NOT register that worker.
 * Result: in dev, carousel/infographic jobs sat in the queue forever
 * at progress=0; the UI showed "no worker is consuming it" until a
 * 25s diagnostic banner fired.
 *
 * This test pins both halves of the contract so the regression cannot
 * silently return:
 *
 *   1. The dev bootstrap source registers the creator-render worker
 *      and wires the canonical processor.
 *   2. The worker factory (`createCreatorRenderWorker`) actually binds
 *      to the `creator-render` queue name with a callable processor —
 *      proven by mocking BullMQ Worker and capturing the constructor
 *      arguments at registration time.
 */

import fs from 'fs';
import path from 'path';

/* ── 1. Static-source guard ────────────────────────────────────── */

describe('creator-render worker — dev bootstrap registration', () => {
  it('startWorkers.ts imports the worker factory + processor', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'backend/queue/startWorkers.ts'),
      'utf8',
    );
    expect(source).toContain('createCreatorRenderWorker');
    expect(source).toContain('processCreatorRenderJob');
    expect(source).toContain('withHeavyJobSlot');
  });

  it('startWorkers.ts actually invokes createCreatorRenderWorker', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'backend/queue/startWorkers.ts'),
      'utf8',
    );
    // The call must appear (not just the import) so the worker is
    // actually instantiated at boot.
    expect(source).toMatch(/createCreatorRenderWorker\s*\(/);
  });

  it('startWorkers.ts attaches failed + error listeners on the worker', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'backend/queue/startWorkers.ts'),
      'utf8',
    );
    // Listeners are how the worker surfaces problems — registration
    // without them would silently swallow failures.
    expect(source).toMatch(/creatorRenderWorker\.on\(['"]failed['"]/);
    expect(source).toMatch(/creatorRenderWorker\.on\(['"]error['"]/);
  });

  it('startWorkers.ts closes the worker on shutdown', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'backend/queue/startWorkers.ts'),
      'utf8',
    );
    // Without this, the dev process would orphan an active worker on
    // SIGINT — exactly the kind of detail that gets forgotten.
    expect(source).toMatch(/creatorRenderWorker(\?\.)?\.close\(\)/);
  });
});

/* ── 2. Behavior simulation: the worker binds to the right queue ─ */

// Mock BullMQ Worker + Queue so we can import the factory without
// needing Redis. Capture the constructor arguments to prove the
// factory binds to the `creator-render` queue with a callable
// processor that delegates to the canonical job handler.

const capturedWorkerArgs: Array<{
  queueName: string;
  processor: ((job: unknown) => Promise<unknown>) | null;
  options: Record<string, unknown>;
}> = [];

const fakeWorkerHandlers: Record<string, Array<(...args: unknown[]) => void>> = {};

jest.mock('bullmq', () => {
  class FakeWorker {
    constructor(name: string, processor: (job: unknown) => Promise<unknown>, opts: Record<string, unknown>) {
      capturedWorkerArgs.push({ queueName: name, processor, options: opts });
    }
    on(event: string, fn: (...args: unknown[]) => void): this {
      (fakeWorkerHandlers[event] ??= []).push(fn);
      return this;
    }
    async close(): Promise<void> { /* noop */ }
  }
  class FakeQueue {
    constructor(_name: string, _opts: Record<string, unknown>) { /* noop */ }
    async add(_jobName: string, _data: unknown, _opts: Record<string, unknown>): Promise<{ id: string }> {
      return { id: 'fake-job-id' };
    }
    async getJob(_id: string): Promise<null> { return null; }
  }
  class FakeQueueEvents {
    constructor(_name: string, _opts: Record<string, unknown>) { /* noop */ }
    on(_event: string, _fn: unknown): this { return this; }
    async close(): Promise<void> { /* noop */ }
  }
  return { Worker: FakeWorker, Queue: FakeQueue, QueueEvents: FakeQueueEvents };
});

// The durable queue module reads `config.REDIS_URL` and the env vars
// when its `connection()` resolver runs. Stub the env so the connect
// branch is satisfied without touching real Redis.
const ORIGINAL_ENV = { ...process.env };
beforeAll(() => {
  process.env.REDIS_URL = 'redis://localhost:6379';
});
afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('creator-render worker — binds to the canonical queue', () => {
  it('createCreatorRenderWorker(processor) instantiates a Worker on the "creator-render" queue with a callable processor', async () => {
    // Reset captured args for a clean assertion window.
    capturedWorkerArgs.length = 0;

    // Import inside the test so the bullmq mock is applied first.
    const { createCreatorRenderWorker } = await import('../../services/creatorRenderDurableQueue');

    let processorInvoked = false;
    const fakeProcessor = async (_job: unknown): Promise<Record<string, unknown>> => {
      processorInvoked = true;
      return { ok: true };
    };

    createCreatorRenderWorker(fakeProcessor as any);

    expect(capturedWorkerArgs.length).toBeGreaterThan(0);
    const last = capturedWorkerArgs[capturedWorkerArgs.length - 1];
    expect(last.queueName).toBe('creator-render');
    expect(typeof last.processor).toBe('function');
    expect(typeof last.options.concurrency).toBe('number');
    expect((last.options.concurrency as number) >= 1).toBe(true);
    expect(last.options.stalledInterval).toBe(60_000);

    // Drive the captured processor with a stub job to prove our processor
    // is actually invoked when BullMQ delivers a job (we still bypass the
    // soak branch and timeout wrapper, which is fine — those are tested
    // elsewhere). A processor that's bound but never called would be the
    // exact silent failure mode that caused the original bug.
    const stubJob = {
      id: 'sim-job-1',
      data: { idempotencyKey: 'k', renderer: 'carousel', timeoutMs: 5_000, payload: {} },
      attemptsMade: 0,
      opts: { attempts: 1 },
      updateProgress: async (_n: number) => undefined,
      progress: 0,
      name: 'render',
    };

    await last.processor!(stubJob);
    expect(processorInvoked).toBe(true);
  });
});
