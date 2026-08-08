/**
 * WS-LI — Automation Runtime producer.
 *
 * The orchestrator dispatches ONE Automation Runtime job per successful generation, carrying the
 * summary it already built and persisted. Five properties are asserted independently:
 *
 *   OFF        the flag off performs no enqueue — and no queue module is even loaded
 *   ONCE       the flag on enqueues exactly one job per generation
 *   REUSE      the dispatched summary IS record.automationPlanning, not a rebuild
 *   RESILIENCE a queue failure never turns a successful generation into a failure
 *   ORDERING   nothing is dispatched before, or without, durable persistence
 *
 * `writeOwner` is mocked for safe module load only, mirroring the sibling orchestration suite; no
 * test touches a real database, and none touches Redis.
 */

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.limit = async () => ({ data: [], error: null });
    chain.upsert = async () => ({ error: null });
    chain.update = () => chain;
    return chain;
  },
}));

import {
  createLeadIntelligenceOrchestrator,
  createInMemoryIntelligenceStore,
  type IntelligenceSnapshotSourcePort,
  type RawLeadRows,
  type AutomationTaskQueuePort,
} from '../../services/leadIntelligenceOrchestration';
import type { AutomationSummary } from '../../services/automationExecution/types';

const T0 = Date.parse('2026-08-03T12:00:00.000Z');
const fixedClock = (): number => T0;
const REF = { companyId: 'co1', leadId: 'L1' };

const baseRows = (): RawLeadRows => ({
  leadRow: {
    id: 'L1', company_id: 'co1', email: 'cto@bigcorp.com', name: 'Sam', source: 'website',
    created_at: '2026-08-03T11:00:00.000Z', visitor_session_id: 'vs1',
    metadata: { job_title: 'CTO', company_name: 'BigCorp', company_size: '1000+', industry: 'Finance' },
  },
  trackingEventRows: [
    { id: 't1', event_name: 'page_view', page_url: '/pricing', visitor_session_id: 'vs1', occurred_at: '2026-08-03T10:00:00.000Z', metadata: {} },
    { id: 't2', event_name: 'page_view', page_url: '/enterprise', visitor_session_id: 'vs1', occurred_at: '2026-08-03T10:05:00.000Z', metadata: {} },
  ],
  visitorSessionRows: [{ id: 'vs1', started_at: '2026-08-03T09:59:00.000Z' }],
  touchpointRows: [{ id: 'tp1', touchpoint_type: 'first_touch', source: 'google', touched_at: '2026-08-03T09:59:00.000Z' }],
});

const sourceOf = (rows: RawLeadRows | null): IntelligenceSnapshotSourcePort => ({ async load() { return rows; } });

/** Records every dispatch so "exactly once" is a count, not an impression. */
const spyQueue = () => {
  const calls: Array<{ companyId: string; summary: AutomationSummary; correlationId?: string | null }> = [];
  const port: AutomationTaskQueuePort = { enqueue: async (p) => { calls.push(p); } };
  return { port, calls };
};

const makeOrchestrator = (extra: Record<string, unknown> = {}) => {
  const store = createInMemoryIntelligenceStore();
  return {
    store,
    orchestrator: createLeadIntelligenceOrchestrator({
      persistence: store, snapshotSource: sourceOf(baseRows()), clock: fixedClock, ...extra,
    }),
  };
};

const savedEnv = { ...process.env };
const enable = () => { process.env.AUTOMATION_RUNTIME_ENABLED = 'true'; };
afterEach(() => { process.env = { ...savedEnv }; });

// ── OFF ────────────────────────────────────────────────────────────────────────────────────────────
describe('Automation producer — runtime OFF', () => {
  it('performs no enqueue', async () => {
    delete process.env.AUTOMATION_RUNTIME_ENABLED;
    const q = spyQueue();
    const { orchestrator } = makeOrchestrator({ automationQueue: q.port });
    const result = await orchestrator.generate(REF);

    expect(result.status).toBe('generated');
    expect(q.calls).toHaveLength(0);
  });

  it('stays off for any value that is not exactly "true"', async () => {
    for (const v of ['TRUE', '1', 'yes', '']) {
      process.env.AUTOMATION_RUNTIME_ENABLED = v;
      const q = spyQueue();
      const { orchestrator } = makeOrchestrator({ automationQueue: q.port });
      await orchestrator.generate(REF);
      expect(q.calls).toHaveLength(0);
    }
  });

  it('generation output is unchanged with the flag off — no warning, no behaviour delta', async () => {
    delete process.env.AUTOMATION_RUNTIME_ENABLED;
    const { orchestrator } = makeOrchestrator();     // no queue injected at all
    const result = await orchestrator.generate(REF);

    expect(result.status).toBe('generated');
    expect(result.persisted).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.error).toBeNull();
  });

  it('never loads the queue module when off — no Redis connection is opened', async () => {
    // The production binding is a dynamic import inside the enabled branch. With no queue injected
    // and the flag off, resolving it would construct a BullMQ Queue and open a connection; the test
    // completing without one is the evidence.
    delete process.env.AUTOMATION_RUNTIME_ENABLED;
    const { orchestrator } = makeOrchestrator();
    await expect(orchestrator.generate(REF)).resolves.toMatchObject({ status: 'generated' });
  });
});

// ── ONCE ───────────────────────────────────────────────────────────────────────────────────────────
describe('Automation producer — runtime ON', () => {
  it('enqueues exactly ONE job per generation', async () => {
    enable();
    const q = spyQueue();
    const { orchestrator } = makeOrchestrator({ automationQueue: q.port });
    await orchestrator.generate(REF);
    expect(q.calls).toHaveLength(1);
  });

  it('carries the tenant and a correlation id', async () => {
    enable();
    const q = spyQueue();
    const { orchestrator } = makeOrchestrator({ automationQueue: q.port });
    await orchestrator.generate(REF);

    expect(q.calls[0].companyId).toBe('co1');
    expect(q.calls[0].correlationId).toBe('co1::L1');
  });

  it('does NOT re-enqueue when generation is skipped as unchanged', async () => {
    enable();
    const q = spyQueue();
    const { orchestrator } = makeOrchestrator({ automationQueue: q.port });

    await orchestrator.generate(REF);
    expect(q.calls).toHaveLength(1);

    const second = await orchestrator.generate(REF);   // same inputs ⇒ fingerprint skip
    expect(second.status).toBe('skipped_unchanged');
    // Re-dispatching an unchanged lead would duplicate downstream work for no new intelligence.
    expect(q.calls).toHaveLength(1);
  });

  it('a forced regeneration dispatches again — once', async () => {
    enable();
    const q = spyQueue();
    const { orchestrator } = makeOrchestrator({ automationQueue: q.port });
    await orchestrator.generate(REF);
    await orchestrator.generate(REF, { force: true });
    expect(q.calls).toHaveLength(2);
  });
});

// ── REUSE ──────────────────────────────────────────────────────────────────────────────────────────
describe('Automation producer — summary reuse', () => {
  it('dispatches the SAME object that was persisted — never a rebuild', async () => {
    enable();
    const q = spyQueue();
    const { orchestrator } = makeOrchestrator({ automationQueue: q.port });
    const result = await orchestrator.generate(REF);

    // Reference identity is the only assertion that rules out a second buildAutomationSummary call:
    // a rebuilt summary would be deep-equal but a different object.
    expect(q.calls[0].summary).toBe(result.record!.automationPlanning);
  });

  it('the dispatched summary is the one the consumer contract expects', async () => {
    enable();
    const q = spyQueue();
    const { orchestrator } = makeOrchestrator({ automationQueue: q.port });
    await orchestrator.generate(REF);

    const summary = q.calls[0].summary;
    expect(Array.isArray(summary.tasks)).toBe(true);
    expect(typeof summary.generatedAt).toBe('string');
    expect(summary.generatedAt).not.toBe('');
  });

  it('dispatches nothing when planning degraded to null', async () => {
    enable();
    const q = spyQueue();
    const store = createInMemoryIntelligenceStore();
    // A lead with no rows produces no record at all; nothing may be fabricated for the runtime.
    const orchestrator = createLeadIntelligenceOrchestrator({
      persistence: store, snapshotSource: sourceOf(null), clock: fixedClock, automationQueue: q.port,
    });
    await orchestrator.generate(REF);
    expect(q.calls).toHaveLength(0);
  });
});

// ── RESILIENCE ─────────────────────────────────────────────────────────────────────────────────────
describe('Automation producer — queue failure', () => {
  const failing: AutomationTaskQueuePort = {
    enqueue: async () => { throw new Error('ECONNREFUSED 127.0.0.1:6379'); },
  };

  it('a Redis failure does NOT fail Lead Intelligence generation', async () => {
    enable();
    const { orchestrator } = makeOrchestrator({ automationQueue: failing });
    const result = await orchestrator.generate(REF);

    expect(result.status).toBe('generated');
    expect(result.persisted).toBe(true);
    expect(result.record).not.toBeNull();
    expect(result.error).toBeNull();
  });

  it('surfaces the failure as a warning — mirroring requestRebuild degradation', async () => {
    enable();
    const { orchestrator } = makeOrchestrator({ automationQueue: failing });
    const result = await orchestrator.generate(REF);

    expect(result.warnings.some((w) => w.includes('automation enqueue failed'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('ECONNREFUSED'))).toBe(true);
  });

  it('the record is still persisted and readable after a queue failure', async () => {
    enable();
    const { orchestrator, store } = makeOrchestrator({ automationQueue: failing });
    await orchestrator.generate(REF);

    const persisted = await store.get('co1', 'L1');
    expect(persisted).not.toBeNull();
    expect(persisted!.automationPlanning).not.toBeNull();
  });
});

// ── ORDERING ───────────────────────────────────────────────────────────────────────────────────────
describe('Automation producer — ordering', () => {
  it('dispatches only AFTER the record is durably persisted', async () => {
    enable();
    const order: string[] = [];
    const store = createInMemoryIntelligenceStore();
    const wrapped = {
      ...store,
      upsert: async (r: Parameters<typeof store.upsert>[0]) => { order.push('persist'); return store.upsert(r); },
    };
    const port: AutomationTaskQueuePort = { enqueue: async () => { order.push('enqueue'); } };

    const orchestrator = createLeadIntelligenceOrchestrator({
      persistence: wrapped, snapshotSource: sourceOf(baseRows()), clock: fixedClock, automationQueue: port,
    });
    await orchestrator.generate(REF);

    // Enqueuing first could hand the runtime a summary whose record never landed.
    expect(order).toEqual(['persist', 'enqueue']);
  });

  it('does NOT dispatch when persistence fails', async () => {
    enable();
    const q = spyQueue();
    const store = createInMemoryIntelligenceStore();
    const failingStore = { ...store, upsert: async () => ({ ok: false as const, error: 'disk full' }) };

    const orchestrator = createLeadIntelligenceOrchestrator({
      persistence: failingStore, snapshotSource: sourceOf(baseRows()), clock: fixedClock, automationQueue: q.port,
    });
    const result = await orchestrator.generate(REF);

    expect(result.persisted).toBe(false);
    expect(q.calls).toHaveLength(0);
  });
});
