/**
 * INT-002 Final Activation — production-readiness characterization.
 *
 * Pins the generation lifecycle contract at the orchestrator boundary:
 * regeneration happens on EXACTLY four triggers (input fingerprint change,
 * engine-version change, envelope-schema change, rebuild requested) plus an
 * explicit force — and never otherwise. Also pins the hardening fix: the skip
 * decision and resolveIntelligenceFreshness() are the SAME predicate, so an
 * unsupported-schema record can no longer be skipped forever while freshness
 * reports it stale. Pure ports; no DB, no network, injected clock.
 */

import { createLeadIntelligenceOrchestrator } from '../../services/leadIntelligenceOrchestration';
import {
  ENGINE_VERSION,
  INTELLIGENCE_SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  isSupportedSchemaVersion,
} from '../../services/leadIntelligenceOrchestration/engineVersion';
import { resolveIntelligenceFreshness } from '../../services/leadIntelligenceOrchestration/freshness';
import type {
  LeadIntelligenceRecord,
  RawLeadRows,
  IntelligencePersistencePort,
  IntelligenceSnapshotSourcePort,
} from '../../services/leadIntelligenceOrchestration';

const T0 = Date.parse('2026-08-03T12:00:00.000Z');

function rows(over: Partial<RawLeadRows> = {}): RawLeadRows {
  return {
    leadRow: { id: 'L1', company_id: 'co-1', email: 'a@b.co', name: 'A', source: 'website', created_at: '2026-08-03T11:00:00.000Z', metadata: {} },
    trackingEventRows: [],
    visitorSessionRows: [],
    touchpointRows: [],
    ...over,
  } as RawLeadRows;
}

function harness(initial: RawLeadRows | null = rows()) {
  const store = new Map<string, LeadIntelligenceRecord>();
  let current = initial;
  const persistence: IntelligencePersistencePort = {
    get: async (c: string, l: string) => store.get(`${c}:${l}`) ?? null,
    upsert: async (record: LeadIntelligenceRecord) => { store.set(`${record.companyId}:${record.leadId}`, record); return { ok: true }; },
    markRebuildRequested: async (c: string, l: string) => {
      const key = `${c}:${l}`;
      const existing = store.get(key);
      if (!existing) return { ok: false, error: 'not found' };
      store.set(key, { ...existing, rebuildRequestedAt: new Date(T0).toISOString() });
      return { ok: true };
    },
  } as IntelligencePersistencePort;
  const snapshotSource: IntelligenceSnapshotSourcePort = { load: async () => current };
  const orchestrator = createLeadIntelligenceOrchestrator({ persistence, snapshotSource, clock: () => T0 });
  return {
    orchestrator,
    store,
    setRows: (r: RawLeadRows | null) => { current = r; },
    record: () => store.get('co-1:L1') ?? null,
    poke: (patch: Partial<LeadIntelligenceRecord>) => {
      const existing = store.get('co-1:L1')!;
      store.set('co-1:L1', { ...existing, ...patch } as LeadIntelligenceRecord);
    },
  };
}

const REF = { companyId: 'co-1', leadId: 'L1' };

describe('INT-002 final — generation lifecycle triggers', () => {
  test('baseline: first generation persists a record at generation 1 with current versions', async () => {
    const h = harness();
    const result = await h.orchestrator.generate(REF);
    expect(result.status).toBe('generated');
    expect(h.record()).toMatchObject({
      generationVersion: 1,
      engineVersion: ENGINE_VERSION,
      schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
      rebuildRequestedAt: null,
    });
  });

  test('NO duplicate generation: unchanged inputs skip, repeatedly, without touching the record', async () => {
    const h = harness();
    await h.orchestrator.generate(REF);
    const first = h.record()!;
    for (let i = 0; i < 3; i += 1) {
      const skip = await h.orchestrator.generate(REF);
      expect(skip.status).toBe('skipped_unchanged');
      expect(skip.persisted).toBe(false);
      expect(skip.freshness).toBe('fresh');
    }
    expect(h.record()).toEqual(first); // byte-identical, generation not bumped
  });

  test('TRIGGER 1 — input fingerprint change regenerates and bumps the generation', async () => {
    const h = harness();
    await h.orchestrator.generate(REF);
    h.setRows(rows({ trackingEventRows: [{ id: 'e1', event_name: 'page_view', page_url: '/pricing', created_at: '2026-08-03T11:30:00.000Z', metadata: {} } as never] }));
    const result = await h.orchestrator.generate(REF);
    expect(result.status).toBe('generated');
    expect(h.record()!.generationVersion).toBe(2);
  });

  test('TRIGGER 2 — engine-version change regenerates with an identical fingerprint', async () => {
    const h = harness();
    await h.orchestrator.generate(REF);
    h.poke({ engineVersion: 'lie-0.0.1' });
    const result = await h.orchestrator.generate(REF);
    expect(result.status).toBe('generated');
    expect(h.record()).toMatchObject({ engineVersion: ENGINE_VERSION, generationVersion: 2 });
  });

  test('TRIGGER 3 — an unsupported OLDER envelope schema regenerates (hardening: previously skipped forever)', async () => {
    const h = harness();
    await h.orchestrator.generate(REF);
    const unsupportedOlder = Math.min(...SUPPORTED_SCHEMA_VERSIONS) - 1; // below the range, i.e. a dropped legacy schema
    expect(isSupportedSchemaVersion(unsupportedOlder)).toBe(false);
    expect(unsupportedOlder).toBeLessThan(INTELLIGENCE_SCHEMA_VERSION);
    h.poke({ schemaVersion: unsupportedOlder }); // engine version + fingerprint still match
    const result = await h.orchestrator.generate(REF);
    expect(result.status).toBe('generated'); // was 'skipped_unchanged' before the fix
    expect(h.record()).toMatchObject({ schemaVersion: INTELLIGENCE_SCHEMA_VERSION, generationVersion: 2 });
  });

  test('DOWN-GRADE PROTECTION — a record written by a NEWER build is skipped and left untouched', async () => {
    // Rolling deploys run mixed builds. An older instance must never overwrite
    // an envelope a newer instance wrote, so schema > current is a skip, not a
    // regeneration — the opposite of the unsupported-older case above.
    const h = harness();
    await h.orchestrator.generate(REF);
    const newer = INTELLIGENCE_SCHEMA_VERSION + 1;
    h.poke({ schemaVersion: newer });
    const result = await h.orchestrator.generate(REF);
    expect(result.status).toBe('skipped_unchanged');
    expect(result.warnings.join(' ')).toContain('newer build');
    expect(h.record()).toMatchObject({ schemaVersion: newer, generationVersion: 1 }); // untouched
  });

  test('TRIGGER 4 — rebuild requested regenerates and clears the pending flag', async () => {
    const h = harness();
    await h.orchestrator.generate(REF);
    await h.orchestrator.requestRebuild(REF);
    expect(h.record()!.rebuildRequestedAt).not.toBeNull();
    const result = await h.orchestrator.generate(REF);
    expect(result.status).toBe('generated');
    expect(h.record()).toMatchObject({ rebuildRequestedAt: null, generationVersion: 2 });
  });

  test('FORCE — an explicit rebuild regenerates even when nothing changed', async () => {
    const h = harness();
    await h.orchestrator.generate(REF);
    const result = await h.orchestrator.rebuild(REF);
    expect(result.status).toBe('generated');
    expect(h.record()!.generationVersion).toBe(2);
  });

  test('skip decision and freshness resolver agree on every supported-schema record', async () => {
    for (const schemaVersion of SUPPORTED_SCHEMA_VERSIONS) {
      const h = harness();
      await h.orchestrator.generate(REF);
      h.poke({ schemaVersion });
      const before = h.record()!;
      const result = await h.orchestrator.generate(REF);
      // resolver says fresh ⇒ orchestrator skips; anything else ⇒ it regenerates
      const freshness = resolveIntelligenceFreshness(before, before.inputFingerprint);
      expect(result.status).toBe(freshness === 'fresh' ? 'skipped_unchanged' : 'generated');
    }
  });
});

describe('INT-002 final — failure modes remain fail-open', () => {
  test('missing lead → failed result, nothing persisted, no throw', async () => {
    const h = harness(null);
    const result = await h.orchestrator.generate(REF);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('lead not found');
    expect(h.store.size).toBe(0);
  });

  test('persistence failure (e.g. missing lead_intelligence_profiles table) still returns computed intelligence', async () => {
    const persistence: IntelligencePersistencePort = {
      get: async () => null,
      upsert: async () => ({ ok: false, error: 'relation "lead_intelligence_profiles" does not exist' }),
      markRebuildRequested: async () => ({ ok: false, error: 'relation "lead_intelligence_profiles" does not exist' }),
    } as IntelligencePersistencePort;
    const orchestrator = createLeadIntelligenceOrchestrator({
      persistence,
      snapshotSource: { load: async () => rows() },
      clock: () => T0,
    });
    const result = await orchestrator.generate(REF);
    expect(result.status).toBe('generated');
    expect(result.persisted).toBe(false);
    expect(result.record).not.toBeNull();
    expect(result.warnings.join(' ')).toContain('lead_intelligence_profiles');
  });

  test('snapshot source failure → failed result, no throw, nothing persisted', async () => {
    const store = new Map<string, LeadIntelligenceRecord>();
    const orchestrator = createLeadIntelligenceOrchestrator({
      persistence: {
        get: async () => null,
        upsert: async (r: LeadIntelligenceRecord) => { store.set('x', r); return { ok: true }; },
        markRebuildRequested: async () => ({ ok: true }),
      } as IntelligencePersistencePort,
      snapshotSource: { load: async () => { throw new Error('db unreachable'); } },
      clock: () => T0,
    });
    const result = await orchestrator.generate(REF);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('snapshot load failed');
    expect(store.size).toBe(0);
  });
});

describe('INT-002 final — tenant isolation at the generation boundary', () => {
  test('generation is scoped to the requested tenant; a foreign record is never read or overwritten', async () => {
    const seen: Array<[string, string]> = [];
    const store = new Map<string, LeadIntelligenceRecord>();
    const orchestrator = createLeadIntelligenceOrchestrator({
      persistence: {
        get: async (c: string, l: string) => { seen.push([c, l]); return store.get(`${c}:${l}`) ?? null; },
        upsert: async (r: LeadIntelligenceRecord) => { store.set(`${r.companyId}:${r.leadId}`, r); return { ok: true }; },
        markRebuildRequested: async () => ({ ok: true }),
      } as IntelligencePersistencePort,
      snapshotSource: { load: async (c: string, l: string) => { seen.push([c, l]); return rows(); } },
      clock: () => T0,
    });
    await orchestrator.generate({ companyId: 'co-A', leadId: 'L1' });
    await orchestrator.generate({ companyId: 'co-B', leadId: 'L1' });
    expect(seen.every(([c]) => c === 'co-A' || c === 'co-B')).toBe(true);
    expect(store.has('co-A:L1')).toBe(true);
    expect(store.has('co-B:L1')).toBe(true);
    expect(store.get('co-A:L1')!.companyId).toBe('co-A');
    expect(store.get('co-B:L1')!.companyId).toBe('co-B');
  });
});
