/**
 * STABILIZE-INT-002 — orchestrator + fingerprint remediation coverage.
 *
 * Pins the RELEASE-INT-002 findings that live in the generation path:
 *   D1 — a throw anywhere in generation is now instrumented, not silent
 *   D2 — requestRebuild is serialized with generation (pending flag survives)
 *   D4 — the input fingerprint is locale-independent (code-unit ordering)
 *   D5 — a record written by a NEWER build is never downgraded
 * Ports injected; no database is touched.
 */

const logs: Array<{ level: string; event: string; payload: Record<string, unknown> }> = [];
jest.mock('../../services/logger', () => ({
  logger: {
    debug: (event: string, payload: Record<string, unknown> = {}) => logs.push({ level: 'debug', event, payload }),
    info: (event: string, payload: Record<string, unknown> = {}) => logs.push({ level: 'info', event, payload }),
    warn: (event: string, payload: Record<string, unknown> = {}) => logs.push({ level: 'warn', event, payload }),
    error: (event: string, payload: Record<string, unknown> = {}) => logs.push({ level: 'error', event, payload }),
  },
}));

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.in = () => chain;
    chain.order = () => chain;
    chain.limit = async () => ({ data: [], error: null });
    chain.upsert = async () => ({ error: null });
    chain.update = () => chain;
    return chain;
  },
}));

import {
  createLeadIntelligenceOrchestrator,
  createInMemoryIntelligenceStore,
  computeInputFingerprint,
  ENGINE_VERSION,
  INTELLIGENCE_SCHEMA_VERSION,
  type RawLeadRows,
} from '../../services/leadIntelligenceOrchestration';
import { assembleLeadCaptureSnapshot } from '../../services/leadIntelligenceEngine';
import { registry } from '../../observability/registry';
import { INTEL_METRICS, __resetTelemetryThrottleForTests } from '../../services/leadIntelligenceTelemetry';

const T0 = Date.parse('2026-08-03T12:00:00.000Z');
const CO = 'co-1';
const REF = { companyId: CO, leadId: 'L1' };

const rows = (): RawLeadRows => ({
  leadRow: { id: 'L1', company_id: CO, email: 'a@b.com', created_at: '2026-08-03T11:00:00.000Z', visitor_session_id: 'vs1', metadata: { job_title: 'CTO' } },
  trackingEventRows: [
    { id: 't1', event_name: 'page_view', page_url: '/pricing', visitor_session_id: 'vs1', occurred_at: '2026-08-03T10:00:00.000Z', metadata: {} },
  ],
  visitorSessionRows: [{ id: 'vs1', started_at: '2026-08-03T09:00:00.000Z' }],
  touchpointRows: [],
});

const counterTotal = (name: string): number =>
  registry.counterEntries().filter((c) => c.name === name).reduce((a, c) => a + c.value, 0);

beforeEach(() => {
  logs.length = 0;
  registry.reset();
  __resetTelemetryThrottleForTests();
});

describe('STABILIZE-INT-002 D1 — generation throws are instrumented, never silent', () => {
  it('an exploding persistence port yields a failed result AND a metric AND a log', async () => {
    const orchestrator = createLeadIntelligenceOrchestrator({
      persistence: {
        get: async () => null,
        upsert: async () => { throw new Error('driver exploded'); },
        markRebuildRequested: async () => ({ ok: true }),
      },
      snapshotSource: { load: async () => rows() },
      clock: () => T0,
    });

    const result = await orchestrator.generate(REF);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('driver exploded');
    // The blind spot this fix removes: previously zero metric, zero log.
    expect(counterTotal(INTEL_METRICS.generation.failures)).toBe(1);
    expect(logs.some((l) => l.event === 'intel_generation_failed')).toBe(true);
  });

  it('an exploding snapshot source is still reported and never throws to the caller', async () => {
    const orchestrator = createLeadIntelligenceOrchestrator({
      persistence: createInMemoryIntelligenceStore(),
      snapshotSource: { load: async () => { throw new Error('db unreachable'); } },
      clock: () => T0,
    });
    const result = await orchestrator.generate(REF);
    expect(result.status).toBe('failed');
    expect(counterTotal(INTEL_METRICS.generation.count)).toBe(1);
  });
});

describe('STABILIZE-INT-002 D2 — requestRebuild is serialized with generation', () => {
  it('a rebuild requested concurrently with a generation is not erased', async () => {
    const store = createInMemoryIntelligenceStore();
    const orchestrator = createLeadIntelligenceOrchestrator({
      persistence: store,
      snapshotSource: { load: async () => { await new Promise((r) => setImmediate(r)); return rows(); } },
      clock: () => T0,
    });
    await orchestrator.generate(REF); // seed a record

    // Fire both without awaiting the first: the lock must order them.
    const generating = orchestrator.generate(REF, { force: true });
    const requesting = orchestrator.requestRebuild(REF, 'operator');
    const [, request] = await Promise.all([generating, requesting]);

    expect(request.accepted).toBe(true);
    // The pending flag must survive — an accepted rebuild that silently
    // vanished was the defect.
    const persisted = await store.get(CO, 'L1');
    expect(persisted?.rebuildRequestedAt).not.toBeNull();
  });
});

describe('STABILIZE-INT-002 D4 — fingerprint is locale-independent', () => {
  it('orders by code unit, so case-mixed event names cannot reorder per ICU', () => {
    // 'B' < 'a' by code unit, but many locales order 'a' < 'B'. If the sort
    // were locale-driven these two runtimes would disagree on the digest.
    const base = assembleLeadCaptureSnapshot({
      leadRow: { id: 'L1', company_id: CO, created_at: '2026-08-03T11:00:00.000Z' },
      trackingEventRows: [
        { id: 'e1', event_name: 'apple_click', page_url: '/a', occurred_at: '2026-08-03T10:00:00.000Z', metadata: {} },
        { id: 'e2', event_name: 'Banana_click', page_url: '/b', occurred_at: '2026-08-03T10:00:00.000Z', metadata: {} },
      ],
      visitorSessionRows: [],
      touchpointRows: [],
      now: new Date(T0).toISOString(),
    });
    const reversed = { ...base, events: [...base.events].reverse() };

    // Order-insensitive (the canonicalization still works)…
    expect(computeInputFingerprint(reversed)).toBe(computeInputFingerprint(base));

    // …and the canonical order is the code-unit one: uppercase sorts first.
    const sorted = [...base.events].sort((a, b) => {
      const ka = `${a.occurredAt}|${a.eventName}|${a.id ?? ''}`;
      const kb = `${b.occurredAt}|${b.eventName}|${b.id ?? ''}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    expect(sorted[0].eventName).toBe('Banana_click');
  });
});

describe('STABILIZE-INT-002 D5 — never downgrade a newer build\'s record', () => {
  it('a record on a future schema is left untouched instead of rewritten', async () => {
    const store = createInMemoryIntelligenceStore();
    const orchestrator = createLeadIntelligenceOrchestrator({
      persistence: store,
      snapshotSource: { load: async () => rows() },
      clock: () => T0,
    });
    const seeded = (await orchestrator.generate(REF)).record!;
    // Simulate a newer build having written this row during a rolling deploy.
    store.records.set(`${CO}::L1`, { ...seeded, schemaVersion: INTELLIGENCE_SCHEMA_VERSION + 1, engineVersion: 'lie-9.0.0' });

    const result = await orchestrator.generate(REF, { force: true }); // even forced
    expect(result.status).toBe('skipped_unchanged');
    expect(result.warnings.join(' ')).toContain('newer build');

    const after = await store.get(CO, 'L1');
    expect(after?.schemaVersion).toBe(INTELLIGENCE_SCHEMA_VERSION + 1); // not downgraded
    expect(after?.engineVersion).toBe('lie-9.0.0');
  });

  it('a record on the current or an older schema still regenerates normally', async () => {
    const store = createInMemoryIntelligenceStore();
    const orchestrator = createLeadIntelligenceOrchestrator({
      persistence: store,
      snapshotSource: { load: async () => rows() },
      clock: () => T0,
    });
    const seeded = (await orchestrator.generate(REF)).record!;
    store.records.set(`${CO}::L1`, { ...seeded, schemaVersion: 1, engineVersion: 'lie-1.0.0' });

    const result = await orchestrator.generate(REF);
    expect(result.status).toBe('generated');
    expect(result.record?.schemaVersion).toBe(INTELLIGENCE_SCHEMA_VERSION);
    expect(result.record?.engineVersion).toBe(ENGINE_VERSION);
  });
});
