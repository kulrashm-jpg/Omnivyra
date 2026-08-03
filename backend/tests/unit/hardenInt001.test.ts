/**
 * HARDEN-INT-001 — final engineering hardening.
 *
 * Pins the fixes for the verified defects:
 *  (2) per-lead generation serialization — concurrent generations of the same
 *      lead no longer duplicate engine work or lose the generationVersion
 *      increment; different leads still run concurrently; force is preserved.
 *  (3) additive touchpoint indexes — the migration matches the loader's exact
 *      query shapes and alters nothing.
 *  (4) batched bulk read — one query instead of N for a page of leads, with
 *      identical results, order and fail-open behaviour; ports without the
 *      optional capability keep working through the fallback.
 *  (5) snapshot cap semantics documented, not changed.
 */

import { createLeadIntelligenceOrchestrator } from '../../services/leadIntelligenceOrchestration';
import { createLeadIntelligenceReadApi } from '../../services/leadIntelligenceReadApi';
import type {
  LeadIntelligenceRecord,
  RawLeadRows,
  IntelligencePersistencePort,
  IntelligenceSnapshotSourcePort,
} from '../../services/leadIntelligenceOrchestration';

const T0 = Date.parse('2026-08-03T12:00:00.000Z');

const rowsFor = (leadId: string): RawLeadRows => ({
  leadRow: { id: leadId, company_id: 'co-1', email: `${leadId}@b.co`, name: 'A', source: 'website', created_at: '2026-08-03T11:00:00.000Z', metadata: {} },
  trackingEventRows: [],
  visitorSessionRows: [],
  touchpointRows: [],
} as unknown as RawLeadRows);

/** Store with instrumented counters and an injectable per-call delay. */
function instrumentedStore(delayMs = 0) {
  const records = new Map<string, LeadIntelligenceRecord>();
  const counts = { get: 0, upsert: 0 };
  const wait = () => (delayMs > 0 ? new Promise((r) => setTimeout(r, delayMs)) : Promise.resolve());
  const port: IntelligencePersistencePort = {
    async get(companyId: string, leadId: string) {
      counts.get += 1;
      await wait();
      return records.get(`${companyId}::${leadId}`) ?? null;
    },
    async upsert(record: LeadIntelligenceRecord) {
      counts.upsert += 1;
      await wait();
      records.set(`${record.companyId}::${record.leadId}`, record);
      return { ok: true };
    },
    async markRebuildRequested() { return { ok: true }; },
  };
  return { port, records, counts };
}

function orchestratorFor(store: { port: IntelligencePersistencePort }, engineCalls?: { n: number }) {
  const snapshotSource: IntelligenceSnapshotSourcePort = {
    load: async (_c: string, leadId: string) => {
      if (engineCalls) engineCalls.n += 1;
      return rowsFor(leadId);
    },
  };
  return createLeadIntelligenceOrchestrator({ persistence: store.port, snapshotSource, clock: () => T0 });
}

describe('HARDEN-INT-001 (2) — generation concurrency', () => {
  test('concurrent generations of the SAME lead serialize: one real generation, one skip, no lost counter', async () => {
    const store = instrumentedStore(5);
    const loads = { n: 0 };
    const orchestrator = orchestratorFor(store, loads);

    const [a, b] = await Promise.all([
      orchestrator.generate({ companyId: 'co-1', leadId: 'L1' }),
      orchestrator.generate({ companyId: 'co-1', leadId: 'L1' }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(['generated', 'skipped_unchanged']); // not two generations
    expect(store.counts.upsert).toBe(1); // no duplicate persistence
    const record = store.records.get('co-1::L1')!;
    expect(record.generationVersion).toBe(1); // counter not lost/duplicated
  });

  test('three concurrent calls still produce exactly one generation and a monotonic counter', async () => {
    const store = instrumentedStore(3);
    const orchestrator = orchestratorFor(store);
    const results = await Promise.all([
      orchestrator.generate({ companyId: 'co-1', leadId: 'L9' }),
      orchestrator.generate({ companyId: 'co-1', leadId: 'L9' }),
      orchestrator.generate({ companyId: 'co-1', leadId: 'L9' }),
    ]);
    expect(results.filter((r) => r.status === 'generated')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'skipped_unchanged')).toHaveLength(2);
    expect(store.records.get('co-1::L9')!.generationVersion).toBe(1);
  });

  test('DIFFERENT leads are not serialized against each other (no cross-lead head-of-line blocking)', async () => {
    const store = instrumentedStore(0);
    const orchestrator = orchestratorFor(store);
    const results = await Promise.all([
      orchestrator.generate({ companyId: 'co-1', leadId: 'L1' }),
      orchestrator.generate({ companyId: 'co-1', leadId: 'L2' }),
      orchestrator.generate({ companyId: 'co-2', leadId: 'L1' }), // same lead id, other tenant
    ]);
    expect(results.map((r) => r.status)).toEqual(['generated', 'generated', 'generated']);
    expect(store.records.size).toBe(3);
    expect(store.records.get('co-1::L1')!.companyId).toBe('co-1');
    expect(store.records.get('co-2::L1')!.companyId).toBe('co-2');
  });

  test('force is preserved under the lock: a queued rebuild still regenerates', async () => {
    const store = instrumentedStore(2);
    const orchestrator = orchestratorFor(store);
    const [first, forced] = await Promise.all([
      orchestrator.generate({ companyId: 'co-1', leadId: 'L1' }),
      orchestrator.rebuild({ companyId: 'co-1', leadId: 'L1' }),
    ]);
    expect([first.status, forced.status]).toEqual(expect.arrayContaining(['generated']));
    expect(store.records.get('co-1::L1')!.generationVersion).toBe(2); // both ran, counter advanced correctly
    expect(store.counts.upsert).toBe(2);
  });

  test('a failing generation releases the lock (no deadlock for the next caller)', async () => {
    const store = instrumentedStore(0);
    let fail = true;
    const orchestrator = createLeadIntelligenceOrchestrator({
      persistence: store.port,
      snapshotSource: {
        load: async (_c: string, leadId: string) => {
          if (fail) throw new Error('db unreachable');
          return rowsFor(leadId);
        },
      },
      clock: () => T0,
    });
    const failed = await orchestrator.generate({ companyId: 'co-1', leadId: 'L1' });
    expect(failed.status).toBe('failed');
    fail = false;
    const ok = await orchestrator.generate({ companyId: 'co-1', leadId: 'L1' });
    expect(ok.status).toBe('generated'); // lock was released
  });
});

describe('HARDEN-INT-001 (4) — batched bulk read', () => {
  const record = (leadId: string): LeadIntelligenceRecord => ({
    companyId: 'co-1', leadId,
    intelligence: { confidence: 0.5 },
    qualificationPlanning: null, automationPlanning: null,
    diagnostics: {}, inputFingerprint: 'f', engineVersion: 'lie-2.0.0',
    generationVersion: 1, schemaVersion: 2,
    generatedAt: '2026-08-03T12:00:00.000Z', rebuildRequestedAt: null,
  } as unknown as LeadIntelligenceRecord);

  test('ONE batched call replaces N per-lead reads; order and content are identical', async () => {
    const calls = { get: 0, getMany: 0 };
    const api = createLeadIntelligenceReadApi({
      persistence: {
        get: async () => { calls.get += 1; return null; },
        getMany: async (_c: string, ids: string[]) => {
          calls.getMany += 1;
          return new Map(ids.filter((id) => id !== 'L2').map((id) => [id, record(id)]));
        },
      } as never,
    });
    const views = await api.getLeadIntelligenceViews('co-1', ['L1', 'L2', 'L3']);
    expect(calls).toEqual({ get: 0, getMany: 1 }); // exactly one round trip, zero per-lead reads
    expect(views.map((v) => v.leadId)).toEqual(['L1', 'L2', 'L3']); // input order preserved
    expect(views.map((v) => v.status)).toEqual(['available', 'never_generated', 'available']);
  });

  test('fail-open: a throwing batch degrades every row to never_generated, never throws', async () => {
    const api = createLeadIntelligenceReadApi({
      persistence: {
        get: async () => null,
        getMany: async () => { throw new Error('db down'); },
      } as never,
    });
    const views = await api.getLeadIntelligenceViews('co-1', ['L1', 'L2']);
    expect(views.map((v) => v.status)).toEqual(['never_generated', 'never_generated']);
    expect(views.map((v) => v.companyId)).toEqual(['co-1', 'co-1']);
  });

  test('BACKWARD COMPATIBLE: a port exposing only get() still works through the per-lead fallback', async () => {
    const calls = { get: 0 };
    const api = createLeadIntelligenceReadApi({
      persistence: {
        get: async (_c: string, leadId: string) => { calls.get += 1; return leadId === 'L1' ? record('L1') : null; },
      } as never,
    });
    const views = await api.getLeadIntelligenceViews('co-1', ['L1', 'L2']);
    expect(calls.get).toBe(2); // fallback path
    expect(views.map((v) => v.status)).toEqual(['available', 'never_generated']);
  });

  test('list projections use the same batched path (dashboard + lead list)', async () => {
    const calls = { getMany: 0 };
    const api = createLeadIntelligenceReadApi({
      persistence: {
        get: async () => null,
        getMany: async (_c: string, ids: string[]) => { calls.getMany += 1; return new Map(ids.map((id) => [id, record(id)])); },
      } as never,
    });
    const items = await api.getLeadIntelligenceListItems('co-1', ['L1', 'L2', 'L3', 'L4']);
    expect(calls.getMany).toBe(1);
    expect(items.map((i) => i.leadId)).toEqual(['L1', 'L2', 'L3', 'L4']);
  });

  test('SAFETY: a batched read that cannot run degrades to the per-lead path, never to an empty page', async () => {
    // Reproduces the real hazard found in review: a chain without .in() made
    // the batch fail open to {} and blanked every row. It must fall back.
    jest.resetModules();
    const getCalls: string[] = [];
    jest.doMock('../../db/writeOwner', () => ({
      // Chainable .select().eq().eq().limit() — but deliberately NO .in().
      ownedDbTable: () => {
        let leadId = 'L1';
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = (col: string, v: string) => {
          if (col === 'lead_id') leadId = v;
          return chain;
        };
        chain.limit = () => Promise.resolve({
          data: [{
            company_id: 'co-1', lead_id: leadId,
            intelligence: { summary: { confidence: 0.5 } }, diagnostics: {},
            input_fingerprint: 'f', engine_version: 'lie-2.0.0',
            generation_version: 1, schema_version: 2,
            generated_at: '2026-08-03T12:00:00.000Z', rebuild_requested_at: null,
          }],
          error: null,
        });
        return chain;
      },
    }));
    const { durableIntelligencePersistence } = require('../../services/leadIntelligenceOrchestration/persistence') as
      typeof import('../../services/leadIntelligenceOrchestration/persistence');
    const originalGet = durableIntelligencePersistence.get.bind(durableIntelligencePersistence);
    durableIntelligencePersistence.get = async (c: string, l: string) => { getCalls.push(l); return originalGet(c, l); };

    const result = await durableIntelligencePersistence.getMany!('co-1', ['L1', 'L2']);
    expect(getCalls).toEqual(['L1', 'L2']); // fell back to per-lead reads
    expect(result.size).toBe(2); // rows still returned — page NOT blanked
    jest.dontMock('../../db/writeOwner');
    jest.resetModules();
  });

  test('tenant isolation holds in the batch: a foreign-tenant row is never surfaced', async () => {
    const api = createLeadIntelligenceReadApi({
      persistence: {
        get: async () => null,
        getMany: async () => new Map([['L1', { ...record('L1'), companyId: 'co-OTHER' } as LeadIntelligenceRecord]]),
      } as never,
    });
    const [view] = await api.getLeadIntelligenceViews('co-1', ['L1']);
    expect(view.status).toBe('never_generated'); // INT-001A F5 mapper guard still applies
    expect(JSON.stringify(view)).not.toContain('co-OTHER');
  });
});

describe('HARDEN-INT-001 (3) — touchpoint index migration', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const raw = fs.readFileSync(
    path.join(process.cwd(), 'supabase/migrations/20260908000000_lead_intelligence_touchpoint_indexes.sql'),
    'utf8',
  );
  // Assert against EXECUTABLE sql only — the header comment legitimately
  // discusses ALTER/CONCURRENTLY while explaining why they are not used.
  const sql = raw.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

  test('is ADDITIVE ONLY — creates indexes, never alters/drops/updates anything', () => {
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_campaign_touchpoints_company_lead_time');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_campaign_touchpoints_company_session_time');
    expect(sql).not.toMatch(/\bALTER TABLE\b/);
    expect(sql).not.toMatch(/\bDROP\b/);
    expect(sql).not.toMatch(/\bUPDATE\b/);
    expect(sql).not.toMatch(/\bDELETE\b/);
    expect(sql).not.toMatch(/\bCONCURRENTLY\b/); // migrations run in a transaction
  });

  test('index shapes match the loader queries exactly (company_id + lookup, ordered by touched_at)', () => {
    expect(sql).toMatch(/\(company_id, lead_id, touched_at DESC\)/);
    expect(sql).toMatch(/\(company_id, visitor_session_id, touched_at DESC\)/);
    expect(sql).toMatch(/WHERE lead_id IS NOT NULL/);
    expect(sql).toMatch(/WHERE visitor_session_id IS NOT NULL/);
  });
});

describe('HARDEN-INT-001 (5) — snapshot caps documented, not changed', () => {
  test('caps and ascending order are unchanged (semantics preserved)', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(path.join(process.cwd(), 'backend/services/leadIntelligenceOrchestration/snapshotSource.ts'), 'utf8');
    expect(src).toContain('{ events: 1000, touchpoints: 1000, sessions: 200 }');
    expect(src).toContain('ascending: true');
    expect(src).toContain('DOCUMENTED LIMITATION'); // the why is recorded in-module
  });
});
