/**
 * HARDEN-INT-002 — operations hardening characterization.
 *
 * Pins the observable operational contract: every fail-open path now emits a
 * metric AND a structured log; logs are throttled and carry no sensitive data;
 * health indicators diagnose the documented failure modes; the serverless
 * detach uses waitUntil when the platform provides it. Ports injected, DB
 * mocked, registry reset per test — nothing here touches a real database.
 */

type Row = Record<string, unknown>;
const dbState = {
  rows: {} as Record<string, Row[]>,
  errors: {} as Record<string, string>,
  counts: {} as Record<string, number>,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const chain: Record<string, unknown> = {};
    const settle = async () => {
      if (dbState.errors[table]) return { data: null, error: { message: dbState.errors[table] }, count: null };
      return { data: dbState.rows[table] ?? [], error: null, count: dbState.counts[table] ?? 0 };
    };
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.neq = () => chain;
    chain.not = () => chain;
    chain.in = () => chain;
    chain.order = () => chain;
    chain.limit = settle;
    chain.upsert = async () => (dbState.errors[table] ? { error: { message: dbState.errors[table] } } : { error: null });
    chain.update = () => chain;
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => settle().then(res, rej);
    return chain;
  },
}));

const logs: Array<{ level: string; event: string; payload: Record<string, unknown> }> = [];
jest.mock('../../services/logger', () => ({
  logger: {
    debug: (event: string, payload: Record<string, unknown> = {}) => logs.push({ level: 'debug', event, payload }),
    info: (event: string, payload: Record<string, unknown> = {}) => logs.push({ level: 'info', event, payload }),
    warn: (event: string, payload: Record<string, unknown> = {}) => logs.push({ level: 'warn', event, payload }),
    error: (event: string, payload: Record<string, unknown> = {}) => logs.push({ level: 'error', event, payload }),
  },
}));

import {
  INTEL_METRICS,
  recordGenerationOutcome,
  recordSnapshotReadFailure,
  recordPersistenceFailure,
  recordTenantMismatch,
  recordActivationDecision,
  recordRead,
  __resetTelemetryThrottleForTests,
} from '../../services/leadIntelligenceTelemetry';
import { registry } from '../../observability/registry';
import { getIntelligenceHealth, checkMigrationHealth, checkGenerationHealth } from '../../services/leadIntelligenceHealth';
import { durableIntelligencePersistence } from '../../services/leadIntelligenceOrchestration/persistence';
import { durableSnapshotSource } from '../../services/leadIntelligenceOrchestration/snapshotSource';
import { toLeadIntelligenceView } from '../../services/leadIntelligenceReadApi';
import { detachBackgroundWork } from '../../services/leadIntelligenceActivation';
import { ENGINE_VERSION, INTELLIGENCE_SCHEMA_VERSION, type LeadIntelligenceRecord } from '../../services/leadIntelligenceOrchestration';

/** Series keys carry the label set, so they prove what did (and did not) become a label. */
const counterSeries = (): string[] => registry.counterEntries().map((c) => c.series);
const counterTotal = (name: string): number =>
  registry.counterEntries().filter((c) => c.name === name).reduce((a, c) => a + c.value, 0);

const recordFixture = (over: Partial<LeadIntelligenceRecord> = {}): LeadIntelligenceRecord =>
  ({
    companyId: 'co-1',
    leadId: 'L1',
    intelligence: { confidence: 0.5, timeline: [] },
    qualificationPlanning: null,
    automationPlanning: null,
    diagnostics: { durationMs: 1, engineVersion: ENGINE_VERSION, enginesExecuted: [], warnings: [], missingEnrichment: [], confidenceBreakdown: { overall: 0.5, persona: 0, intentBand: 'none', qualificationBand: 'cold' }, inputCounts: { events: 1, sessions: 0, touchpoints: 0 } },
    inputFingerprint: 'f'.repeat(64),
    engineVersion: ENGINE_VERSION,
    generationVersion: 1,
    schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
    generatedAt: '2026-08-03T12:00:00.000Z',
    rebuildRequestedAt: null,
    ...over,
  }) as LeadIntelligenceRecord;

beforeEach(() => {
  logs.length = 0;
  dbState.rows = {};
  dbState.errors = {};
  dbState.counts = {};
  registry.reset();
  __resetTelemetryThrottleForTests();
});

describe('HARDEN-INT-002 — telemetry surface', () => {
  it('records generation outcomes with bounded labels and no sensitive data', () => {
    recordGenerationOutcome({
      outcome: 'generated', reason: 'trigger', durationMs: 12, companyId: 'co-1', leadId: 'L1',
      persisted: true, envelopeBytes: 24000, inputCounts: { events: 50, sessions: 3, touchpoints: 2 },
    });
    expect(counterTotal(INTEL_METRICS.generation.count)).toBe(1);
    const series = counterSeries();
    expect(series.some((n) => n.startsWith(INTEL_METRICS.generation.count))).toBe(true);
    // ids must never become metric labels (cardinality + privacy)
    expect(series.join('|')).not.toContain('L1');
    expect(series.join('|')).not.toContain('co-1');
  });

  it('generation success logs at debug (silent in prod) and failure at warn', () => {
    recordGenerationOutcome({ outcome: 'generated', reason: 'trigger', durationMs: 5, companyId: 'co-1', leadId: 'L1' });
    expect(logs.filter((l) => l.level === 'debug')).toHaveLength(1);
    expect(logs.filter((l) => l.level === 'warn')).toHaveLength(0);

    recordGenerationOutcome({ outcome: 'failed', reason: 'trigger', durationMs: 5, companyId: 'co-1', leadId: 'L1', stage: 'snapshot', error: 'boom' });
    const warn = logs.find((l) => l.level === 'warn');
    expect(warn?.event).toBe('intel_generation_failed');
    expect(warn?.payload).toMatchObject({ stage: 'snapshot', company_id: 'co-1', lead_id: 'L1' });
    expect(counterTotal(INTEL_METRICS.generation.failures)).toBe(1);
  });

  it('throttles repeated failure logs while keeping the counter exact', () => {
    for (let i = 0; i < 25; i += 1) recordPersistenceFailure('upsert', 'relation does not exist', 'co-1');
    expect(counterTotal(INTEL_METRICS.persistence.failures)).toBe(25); // metric exact
    expect(logs.filter((l) => l.event === 'intel_persistence_failed')).toHaveLength(1); // log quiet
    expect(logs[0].level).toBe('error');
    expect(logs[0].payload.impact).toContain('NOT saved');
  });

  it('logs carry no sensitive payload content', () => {
    recordSnapshotReadFailure('visitor_sessions', 'co-1', 'column does not exist');
    recordRead({ surface: 'detail', durationMs: 3, freshness: 'fresh' });
    const serialized = JSON.stringify(logs);
    for (const forbidden of ['@', 'password', 'http://', 'https://']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('tenant mismatch is always logged at error (never throttled away)', () => {
    recordTenantMismatch('co-1', 'co-OTHER', 'L1');
    recordTenantMismatch('co-1', 'co-OTHER', 'L2');
    const events = logs.filter((l) => l.event === 'intel_tenant_mismatch_blocked');
    expect(events).toHaveLength(2);
    expect(events[0].level).toBe('error');
    expect(counterTotal(INTEL_METRICS.read.tenantMismatch)).toBe(2);
  });

  it('activation decisions are counted per outcome', () => {
    recordActivationDecision('ran', 'lead_captured');
    recordActivationDecision('cooldown', 'tracking_events');
    recordActivationDecision('disabled', 'lead_captured');
    expect(counterTotal(INTEL_METRICS.activation.decision)).toBe(3);
  });
});

describe('HARDEN-INT-002 — fail-open paths now report', () => {
  it('a failing persistence upsert emits the migration signal', async () => {
    dbState.errors.lead_intelligence_profiles = 'relation "lead_intelligence_profiles" does not exist';
    const result = await durableIntelligencePersistence.upsert(recordFixture());
    expect(result.ok).toBe(false);
    expect(counterTotal(INTEL_METRICS.persistence.failures)).toBe(1);
    const log = logs.find((l) => l.event === 'intel_persistence_failed');
    expect(log?.level).toBe('error');
    expect(String(log?.payload.detail)).toContain('does not exist');
  });

  it('a failing snapshot collection read is reported instead of silently empty', async () => {
    dbState.rows.leads = [{ id: 'L1', company_id: 'co-1', visitor_session_id: 'vs-1', unified_person_id: 'up-1' }];
    dbState.errors.visitor_sessions = 'column visitor_sessions.created_at does not exist';
    const rows = await durableSnapshotSource.load('co-1', 'L1');
    expect(rows).not.toBeNull();
    expect(rows!.visitorSessionRows).toEqual([]); // still fails open
    expect(counterTotal(INTEL_METRICS.snapshot.failures)).toBe(1);
    const log = logs.find((l) => l.event === 'intel_snapshot_read_failed');
    expect(log?.payload).toMatchObject({ collection: 'visitor_sessions' });
    expect(String(log?.payload.impact)).toContain('partial inputs');
  });

  it('a persistence read error is distinguished from an empty result', async () => {
    dbState.rows.lead_intelligence_profiles = [];
    expect(await durableIntelligencePersistence.get('co-1', 'L1')).toBeNull();
    expect(counterTotal(INTEL_METRICS.persistence.failures)).toBe(0); // empty is normal

    dbState.errors.lead_intelligence_profiles = 'connection reset';
    expect(await durableIntelligencePersistence.get('co-1', 'L1')).toBeNull();
    expect(counterTotal(INTEL_METRICS.persistence.failures)).toBe(1); // error is reported
  });

  it('the read mapper reports a blocked cross-tenant record', () => {
    const view = toLeadIntelligenceView(recordFixture({ companyId: 'co-OTHER' }), { companyId: 'co-1', leadId: 'L1' });
    expect(view.status).toBe('never_generated'); // behaviour unchanged
    expect(logs.some((l) => l.event === 'intel_tenant_mismatch_blocked')).toBe(true);
  });
});

describe('HARDEN-INT-002 — health indicators', () => {
  it('diagnoses a missing migration as unhealthy with remediation', async () => {
    dbState.errors.lead_intelligence_profiles = 'relation "lead_intelligence_profiles" does not exist';
    const indicator = await checkMigrationHealth();
    expect(indicator.status).toBe('unhealthy');
    expect(indicator.detail).toContain('not applied');
    expect(String(indicator.data?.remediation)).toContain('20260907000000');
  });

  it('reports healthy migration when the table answers', async () => {
    dbState.rows.lead_intelligence_profiles = [];
    expect((await checkMigrationHealth()).status).toBe('healthy');
  });

  it('generation health is unknown when cold, degraded on failures', () => {
    expect(checkGenerationHealth().status).toBe('unknown');
    recordGenerationOutcome({ outcome: 'generated', reason: 'trigger', durationMs: 1, companyId: 'co-1', leadId: 'L1' });
    expect(checkGenerationHealth().status).toBe('healthy');
    recordGenerationOutcome({ outcome: 'failed', reason: 'trigger', durationMs: 1, companyId: 'co-1', leadId: 'L2', stage: 'engine', error: 'x' });
    expect(['degraded', 'unhealthy']).toContain(checkGenerationHealth().status);
  });

  it('the composed report is worst-of and skips freshness when the table is absent', async () => {
    dbState.errors.lead_intelligence_profiles = 'relation "lead_intelligence_profiles" does not exist';
    const report = await getIntelligenceHealth('co-1');
    expect(report.status).toBe('unhealthy');
    expect(report.engineVersion).toBe(ENGINE_VERSION);
    expect(report.processScoped).toBe(true);
    const freshness = report.indicators.find((i) => i.name === 'freshness');
    expect(freshness?.detail).toContain('skipped');
    // WS-2 M1A (3): sessionCapture joins the rollup — the capture-side session
    // write is upstream of every other indicator, so it belongs in one triage call.
    expect(report.indicators.map((i) => i.name).sort()).toEqual([
      'freshness',
      'generation',
      'migration',
      'persistence',
      'sessionCapture',
    ]);
  });

  it('never throws — an exploding probe degrades to unknown', async () => {
    dbState.errors.lead_intelligence_profiles = 'boom';
    await expect(getIntelligenceHealth()).resolves.toBeTruthy();
  });
});

describe('STABILIZE-INT-002 — audit remediations', () => {
  it('D11: no upgrade log when the version did not actually move', async () => {
    const { recordVersionUpgrade } = await import('../../services/leadIntelligenceTelemetry');
    recordVersionUpgrade({ fromEngine: ENGINE_VERSION, toEngine: ENGINE_VERSION, fromSchema: 2, toSchema: 2, companyId: 'co-1', leadId: 'L1' });
    expect(logs.filter((l) => l.event === 'intel_record_upgraded')).toHaveLength(0);

    recordVersionUpgrade({ fromEngine: 'lie-1.0.0', toEngine: ENGINE_VERSION, fromSchema: 1, toSchema: 2, companyId: 'co-1', leadId: 'L1' });
    expect(logs.filter((l) => l.event === 'intel_record_upgraded')).toHaveLength(1);
  });

  it('D12: a throwing logger cannot break a telemetry caller', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => { throw new Error('logger exploded'); });
    try {
      expect(() => recordPersistenceFailure('upsert', 'boom', 'co-1')).not.toThrow();
      expect(counterTotal(INTEL_METRICS.persistence.failures)).toBe(1); // metric still exact
    } finally {
      spy.mockRestore();
    }
  });

  it('D10: the batched read emits the same tenant-mismatch signal as the detail read', async () => {
    dbState.rows.lead_intelligence_profiles = [
      { company_id: 'co-OTHER', lead_id: 'L1', intelligence: { summary: { confidence: 0.5 } }, engine_version: ENGINE_VERSION, schema_version: 2, generation_version: 1, generated_at: '2026-08-03T12:00:00.000Z', input_fingerprint: 'f', diagnostics: {} },
    ];
    const out = await durableIntelligencePersistence.getMany!('co-1', ['L1']);
    expect(out.size).toBe(0); // still withheld
    expect(counterTotal(INTEL_METRICS.read.tenantMismatch)).toBe(1);
    expect(logs.some((l) => l.event === 'intel_tenant_mismatch_blocked')).toBe(true);
  });
});

describe('HARDEN-INT-002 — serverless detached execution', () => {
  it('delegates keep-alive to the canonical helper rather than resolving waitUntil itself', async () => {
    // STABILIZE-INT-002 (D7): the local Vercel detection was removed in favour
    // of lib/runtime/keepAlive, which owns the VERCEL gate and the bundler-safe
    // import. The contract to pin is therefore delegation — and that the caller
    // is never blocked, since the helper AWAITS the work off-platform.
    const seen: Array<Promise<void>> = [];
    jest.doMock('../../../lib/runtime/keepAlive', () => ({
      keepAliveAfterResponse: (p: Promise<void>) => {
        seen.push(p);
        return Promise.resolve();
      },
    }));
    jest.resetModules();
    const { detachBackgroundWork: detach } = await import('../../services/leadIntelligenceActivation');

    let released = false;
    const slow = new Promise<void>((resolve) => setTimeout(() => { released = true; resolve(); }, 20));
    detach(slow); // must return immediately
    expect(seen).toHaveLength(1);
    expect(released).toBe(false); // caller was not blocked

    jest.dontMock('../../../lib/runtime/keepAlive');
    jest.resetModules();
  });

  it('swallows rejections and logs them rather than throwing or leaving them unhandled', async () => {
    expect(() => detachBackgroundWork(Promise.reject(new Error('generation exploded')))).not.toThrow();
    await new Promise((r) => setImmediate(r));
    const log = logs.find((l) => l.event === 'intel_background_work_failed');
    expect(log?.level).toBe('warn');
    expect(String(log?.payload.detail)).toContain('generation exploded');
  });
});
