/**
 * WS-4 → WS-2 — intake reaching the enrichment seam.
 *
 * The WS-2 seam is NOT mocked here. It runs for real over a stub port, so what
 * is proven is the actual boundary: the context WS-4 hands over, the coverage
 * it offers, and the honesty of the result when nothing is available. Mocking
 * `planProspectEnrichment` would pass even if WS-4 never called it.
 *
 * PROVIDER NOTE. Nothing here makes any provider operational. The central
 * assertion is the opposite: with no available enrichment source, every gap is
 * reported as `no_available_source`.
 */

type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  insertErrors: {} as Record<string, { code: string; message: string } | undefined>,
  writes: [] as Array<{ table: string; payload: Row }>,
  nextId: 1,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let op: 'select' | 'insert' = 'select';
    let payload: Row = {};
    const rows = (): Row[] => (db.tables[table] ??= []);
    const exec = async (): Promise<{ data: unknown; error: unknown }> => {
      await Promise.resolve();
      if (op === 'insert') {
        db.writes.push({ table, payload });
        const err = db.insertErrors[table];
        if (err) return { data: null, error: err };
        const created = { id: `${table}-${db.nextId++}`, ...payload };
        rows().push(created);
        return { data: created, error: null };
      }
      return { data: rows().filter((r) => filters.every(([c, v]) => r[c] === v)), error: null };
    };
    const api: Record<string, unknown> = {
      select: () => api,
      insert: (p: Row) => { op = 'insert'; payload = p; return api; },
      update: (p: Row) => { op = 'insert'; payload = p; return api; },
      eq: (c: string, v: unknown) => { filters.push([c, v]); return api; },
      is: (c: string, v: unknown) => { filters.push([c, v]); return api; },
      limit: () => api,
      single: () => exec().then((r) => ({
        data: Array.isArray(r.data) ? ((r.data as Row[])[0] ?? null) : r.data, error: r.error,
      })),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return api;
  },
}));

jest.mock('../../services/identityResolutionService', () => ({
  resolveUnifiedPerson: jest.fn(async () => ({ unifiedPersonId: 'person-1' })),
  normalizeEmail: (v: string) => v,
  normalizePhone: (v: string) => v,
}));
jest.mock('../../services/prospectIdentity/accountResolution', () => ({
  resolveOrCreateAccount: jest.fn(async () => ({ accountId: 'account-1', outcome: 'created' })),
  attachPersonToAccount: jest.fn(async () => ({ attached: true, reason: 'ok' })),
}));
jest.mock('../../services/prospectIdentity/ingestionBoundary', () => ({
  ingestSourceRecord: jest.fn(async () => ({
    sourceRecordId: 'src-1', outcome: 'created', canonicalApplied: [], canonicalWithheld: [],
  })),
}));
jest.mock('../../services/prospectIdentity/personDuplicates', () => ({
  detectAndParkDuplicates: jest.fn(async () => ({ detected: [], parked: 0, alreadyOpen: 0 })),
}));

import { ingestNormalizedRecord } from '../../services/leadIngestion/orchestrator';
import {
  availableEnrichmentSources,
  ingestionEnrichmentCoverage,
} from '../../services/leadIngestion/enrichmentCoverage';
import { applyEnrichmentResult, type EnrichmentPorts } from '../../services/enrichment/service';
import { listDataSourcesByGroup } from '../../services/integrations/dataSourceCatalogue';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const NOW = '2026-09-03T00:00:00.000Z';

type Calls = { snapshots: Array<[string, string]>; integrations: string[]; persists: Row[] };

const makePorts = (over: { withheld?: Array<{ attribute: string; reason: string }> } = {}) => {
  const calls: Calls = { snapshots: [], integrations: [], persists: [] };
  const ports: EnrichmentPorts = {
    async loadSnapshot(org, prospect) {
      calls.snapshots.push([org, prospect]);
      if (org !== ORG_A) return null;   // the port is tenant-scoped, as the real one is
      return { personId: 'person-1', accountId: 'account-1', person: {}, account: {} };
    },
    async loadIntegrations(org) { calls.integrations.push(org); return []; },
    async loadConflicts() { return []; },
    async persist(input) { calls.persists.push(input as unknown as Row); return { canonicalWithheld: over.withheld ?? [] }; },
  };
  return { ports, calls };
};

const record = (over: Record<string, unknown> = {}) => ({
  raw: {},
  normalized: {
    organizationId: ORG_A, source: 'crm', entityType: 'person' as const,
    externalId: 'CRM-1', person: { email: 'a@b.test' }, ...over,
  },
});

beforeEach(() => {
  db.tables = {}; db.insertErrors = {}; db.writes = []; db.nextId = 1;
  process.env.ENABLE_LEAD_INGESTION = 'true';
});
afterEach(() => { delete process.env.ENABLE_LEAD_INGESTION; });

// ════════════════════════════════════════════════════════════════════════════
describe('WS-4 coverage policy is DERIVED, not declared', () => {
  it('5. offers only enrichment-group sources the catalogue marks available', () => {
    const group = listDataSourcesByGroup('enrichment');
    const expected = group.filter((d) => d.available).map((d) => d.key);
    expect(availableEnrichmentSources()).toEqual(expected);
    // Today that is empty — a consequence of the catalogue, not a literal.
    expect(expected).toEqual([]);
  });

  it('6. never offers an intake adapter as an enrichment source', () => {
    const cov = ingestionEnrichmentCoverage();
    for (const intake of ['manual', 'crm', 'csv']) {
      expect(Object.keys(cov.external ?? {})).not.toContain(intake);
    }
  });

  it('6b. never offers a DECLARED-only provider', () => {
    const keys = Object.keys(ingestionEnrichmentCoverage().external ?? {});
    for (const declared of ['apollo', 'apollo_enrichment', 'zoominfo', 'zoominfo_enrichment', 'rapidapi', 'linkedin_sales_navigator']) {
      expect(keys).not.toContain(declared);
    }
  });

  it('offers no internal or MarketPulse coverage — WS-3 owns that seam', () => {
    const cov = ingestionEnrichmentCoverage();
    expect(cov.internal).toBeUndefined();
    expect(cov.marketPulse).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-4 → WS-2 — the real seam is invoked', () => {
  it('1/2/3. the Prospect exists first, then the seam is called for it', async () => {
    const { ports, calls } = makePorts();
    const out = await ingestNormalizedRecord(record(), { enrichmentPorts: ports, now: NOW });
    expect(out.ok).toBe(true);
    expect(out.prospectId).toBeTruthy();
    // The seam was asked about the Prospect that ingestion just created.
    expect(calls.snapshots).toEqual([[ORG_A, out.prospectId]]);
  });

  it('4. every port receives the ingesting tenant explicitly', async () => {
    const { ports, calls } = makePorts();
    await ingestNormalizedRecord(record(), { enrichmentPorts: ports, now: NOW });
    expect(calls.snapshots[0][0]).toBe(ORG_A);
    expect(calls.integrations).toEqual([ORG_A]);
  });

  it('7. with no available source, every gap is honestly no_available_source', async () => {
    const { ports } = makePorts();
    const out = await ingestNormalizedRecord(record(), { enrichmentPorts: ports, now: NOW });
    expect(out.enrichmentPlan?.planned).toBe(0);
    expect(out.enrichmentPlan?.noAvailableSource).toBeGreaterThan(0);
    expect(out.enrichmentPlan?.error).toBeUndefined();
  });

  it('planning is OPT-IN — without ports nothing is planned and nothing is read', async () => {
    const out = await ingestNormalizedRecord(record(), { now: NOW });
    expect(out.ok).toBe(true);
    expect(out.enrichmentPlan).toBeUndefined();
  });

  it('15. a PARTIAL prospect — an email and nothing else — still reaches the seam', async () => {
    const { ports, calls } = makePorts();
    const out = await ingestNormalizedRecord(record({
      externalId: 'THIN-1', person: { email: 'thin@b.test' }, account: undefined,
    }), { enrichmentPorts: ports, now: NOW });
    expect(out.ok).toBe(true);
    expect(calls.snapshots).toHaveLength(1);
    // Missing is planned as a gap, not treated as an ingestion defect.
    expect(out.enrichmentPlan?.noAvailableSource).toBeGreaterThan(0);
  });

  it('no Prospect ⇒ no plan: the seam is never asked about a record it cannot own', async () => {
    const { ports, calls } = makePorts();
    // No externalId ⇒ rejected before a Prospect could exist (WS-1 refuses to
    // synthesise an identity key), so there is nothing to plan for.
    const out = await ingestNormalizedRecord(record({ externalId: null }), { enrichmentPorts: ports, now: NOW });
    expect(out.rejection).toBe('validation_failed');
    expect(calls.snapshots).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-4 → WS-2 — enrichment never endangers ingestion', () => {
  it('18. a planning failure does NOT fail the record — intake is still durable', async () => {
    const ports: EnrichmentPorts = {
      async loadSnapshot() { throw new Error('database unavailable'); },
      async loadIntegrations() { return []; },
      async loadConflicts() { return []; },
      async persist() { return { canonicalWithheld: [] }; },
    };
    const out = await ingestNormalizedRecord(record(), { enrichmentPorts: ports, now: NOW });
    expect(out.ok).toBe(true);
    expect(out.prospectId).toBeTruthy();
    // The failure is REPORTED, not swallowed and not escalated.
    expect(out.enrichmentPlan?.error).toMatch(/database unavailable/);
    expect(out.enrichmentPlan?.planned).toBe(0);
  });

  it('18b. a Prospect persistence failure is still prospect_resolution_failed', async () => {
    db.insertErrors.canonical_leads = { code: '23502', message: 'not-null violation' };
    const { ports } = makePorts();
    const out = await ingestNormalizedRecord(record(), { enrichmentPorts: ports, now: NOW });
    expect(out.rejection).toBe('prospect_resolution_failed');
  });

  it('13/14/16/19. company-first, person-first, replay and partial all still work with planning on', async () => {
    const { ports } = makePorts();
    const person = await ingestNormalizedRecord(record({ externalId: 'P-1' }), { enrichmentPorts: ports, now: NOW });
    const company = await ingestNormalizedRecord(record({
      externalId: 'C-1', entityType: 'account', person: undefined, account: { domain: 'acme.test' },
    }), { enrichmentPorts: ports, now: NOW });
    const replay = await ingestNormalizedRecord(record({ externalId: 'P-1' }), { enrichmentPorts: ports, now: NOW });

    expect(person.ok && company.ok && replay.ok).toBe(true);
    expect(replay.prospectId).toBe(person.prospectId);
    expect(db.writes.filter((w) => w.table === 'canonical_leads')).toHaveLength(2);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-4 → WS-2 — tenant isolation across the whole path', () => {
  it('17. the seam refuses a Prospect the tenant does not own', async () => {
    const { ports } = makePorts();
    const out = await ingestNormalizedRecord(record({ organizationId: ORG_B }), { enrichmentPorts: ports, now: NOW });
    // Ingestion succeeds for tenant B, but the seam cannot read B's Prospect
    // through a port scoped to A — reported, never silently "nothing to do".
    expect(out.ok).toBe(true);
    expect(out.enrichmentPlan?.error).toMatch(/not found in tenant/);
  });

  it('17b. identical source keys stay isolated per tenant', async () => {
    const { ports } = makePorts();
    await ingestNormalizedRecord(record({ organizationId: ORG_A, externalId: 'SHARED' }), { enrichmentPorts: ports, now: NOW });
    await ingestNormalizedRecord(record({ organizationId: ORG_B, externalId: 'SHARED' }), { enrichmentPorts: ports, now: NOW });
    const leads = db.writes.filter((w) => w.table === 'canonical_leads');
    expect(leads).toHaveLength(2);
    expect(leads.map((w) => w.payload.company_id).sort()).toEqual([ORG_A, ORG_B].sort());
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-4 → WS-2 — result application stays in the seam', () => {
  const attempt = (over: Record<string, unknown> = {}) => ({
    organizationId: ORG_A, prospectId: 'prospect-1', requested: ['industry'], source: 'crm', now: NOW, ...over,
  }) as never;
  const snap = { personId: 'person-1', accountId: 'account-1', person: {}, account: {} };

  it('9/11. a partial result is applied through the seam, and stays partial', async () => {
    const { ports, calls } = makePorts();
    const r = await applyEnrichmentResult(attempt({
      requested: ['industry', 'region'],
      returned: [{ attribute: 'industry', subject: 'account', value: 'Fintech' }],
    }), snap, ports);
    expect(r.status).toBe('partial');
    expect(calls.persists[0].attributes).toEqual({ industry: 'Fintech' });
  });

  it('10. a failed result writes nothing — existing evidence survives', async () => {
    const { ports, calls } = makePorts();
    const r = await applyEnrichmentResult(attempt({
      returned: [{ attribute: 'industry', subject: 'account', value: 'Fintech' }],
      error: { kind: 'error', message: 'provider 500' },
    }), snap, ports);
    expect(r.status).toBe('failed');
    expect(calls.persists).toHaveLength(0);
  });

  it('12. LI-2 disagreement leaves the result conflicting with an empty payload', async () => {
    const { ports } = makePorts({ withheld: [{ attribute: 'industry', reason: 'sources_disagree' }] });
    const r = await applyEnrichmentResult(attempt({
      returned: [{ attribute: 'industry', subject: 'account', value: 'Fintech' }],
    }), snap, ports);
    expect(r.status).toBe('conflicting');
    expect(r.apply.account).toEqual({});
  });

  it('8. WS-4 writes no enrichment value of its own', () => {
    const orch = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/leadIngestion/orchestrator.ts'), 'utf8');
    expect(orch).not.toContain('applyEnrichmentResult');
    expect(orch).not.toContain('normalizeEnrichmentResult');
    expect(orch).not.toContain('ownedDbTable');
  });
});
