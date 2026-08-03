/**
 * INT-003 Wave 1 — read-endpoint characterization.
 *
 * GET /api/leads/[id]/intelligence and GET /api/leads/intelligence expose the
 * persisted INT-002 envelope, read-only. Fixtures are REAL v2 rows produced by
 * the actual Phase 4 orchestrator + durable serializer (captured through the
 * mocked DB seam), plus hand-built legacy/malformed rows. Auth is the SEC-001
 * resolveCompanyAccess seam, mocked per scenario. No randomness, fixed clock,
 * deterministic assertions. The endpoints must never write: every DB op the
 * routes perform is recorded and asserted read-only.
 */

type Row = Record<string, unknown>;

const mockState = {
  rowsByLead: new Map<string, Row>(),
  upserts: [] as Row[],
  updates: 0,
  reads: 0,
  failReads: false,
  ignoreTenantFilter: false,
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.order = () => chain;
    chain.eq = (k: string, v: unknown) => {
      filters.push([k, v]);
      return chain;
    };
    chain.limit = async () => {
      mockState.reads += 1;
      if (mockState.failReads) throw new Error('db unreachable');
      if (table !== 'lead_intelligence_profiles') return { data: [], error: null };
      const leadId = filters.find(([k]) => k === 'lead_id')?.[1] as string | undefined;
      const companyId = filters.find(([k]) => k === 'company_id')?.[1] as string | undefined;
      const row = leadId ? mockState.rowsByLead.get(leadId) : undefined;
      if (!row) return { data: [], error: null };
      if (!mockState.ignoreTenantFilter && row.company_id !== companyId) return { data: [], error: null };
      return { data: [row], error: null };
    };
    chain.upsert = async (row: Row) => {
      mockState.upserts.push(row);
      return { error: null };
    };
    chain.update = () => {
      mockState.updates += 1;
      return chain;
    };
    return chain;
  },
}));

type Access = { userId: string; role: string } | null;
const mockAuth = {
  impl: async (_req: unknown, _res: unknown, _companyId?: string | null): Promise<Access> => null,
  calls: [] as Array<string | null | undefined>,
};

jest.mock('../../services/contentArchitectService', () => ({
  resolveCompanyAccess: (req: unknown, res: unknown, companyId?: string | null) => {
    mockAuth.calls.push(companyId);
    return mockAuth.impl(req, res, companyId);
  },
}));

import singleHandler from '../../../pages/api/leads/[id]/intelligence';
import listHandler from '../../../pages/api/leads/intelligence';
import { createMockRes } from '../utils/setupApiTest';
import {
  createLeadIntelligenceOrchestrator,
  createInMemoryIntelligenceStore,
  durableIntelligencePersistence,
  ENGINE_VERSION,
  type RawLeadRows,
} from '../../services/leadIntelligenceOrchestration';

const T0 = Date.parse('2026-08-03T12:00:00.000Z');
const NOW_ISO = '2026-08-03T12:00:00.000Z';
const CO = 'co-1';

const req = (over: Record<string, unknown> = {}) =>
  ({ method: 'GET', headers: {}, query: {}, body: {}, cookies: {}, ...over }) as never;

const authorized = async (_r: unknown, res: unknown, companyId?: string | null): Promise<Access> => {
  if (!companyId) {
    (res as ReturnType<typeof createMockRes>).status(400).json({ error: 'companyId required' });
    return null;
  }
  return { userId: 'user-1', role: 'admin' };
};

const rowsFor = (leadId: string, pages: string[]): RawLeadRows => ({
  leadRow: {
    id: leadId,
    company_id: CO,
    email: 'cto@bigcorp.com',
    name: 'Sam',
    source: 'website',
    created_at: '2026-08-03T11:00:00.000Z',
    visitor_session_id: `vs-${leadId}`,
    metadata: { job_title: 'CTO', company_name: 'BigCorp', company_size: '1000+', industry: 'Finance' },
  },
  trackingEventRows: pages.map((p, i) => ({
    id: `${leadId}-t${i}`,
    event_name: 'page_view',
    page_url: p,
    visitor_session_id: `vs-${leadId}`,
    occurred_at: `2026-08-03T10:0${i}:00.000Z`,
    metadata: {},
  })),
  visitorSessionRows: [{ id: `vs-${leadId}`, started_at: '2026-08-03T09:59:00.000Z' }],
  touchpointRows: [],
});

/** Persist a REAL v2 row through the actual orchestrator + durable serializer. */
async function persistedRowFor(leadId: string, pages: string[]): Promise<Row> {
  const orchestrator = createLeadIntelligenceOrchestrator({
    persistence: createInMemoryIntelligenceStore(),
    snapshotSource: { load: async () => rowsFor(leadId, pages) },
    clock: () => T0,
  });
  const record = (await orchestrator.generate({ companyId: CO, leadId })).record!;
  const before = mockState.upserts.length;
  await durableIntelligencePersistence.upsert(record);
  return mockState.upserts[before];
}

let richRow: Row; // L1 — full v2 envelope
let sparseRow: Row; // L2 — v2, low engagement
let legacyRow: Row; // L3 — schema-1 (summary stored directly)
let malformedRow: Row; // L4 — v2 wrapper with junk summary

beforeAll(async () => {
  richRow = await persistedRowFor('L1', ['/pricing', '/enterprise', '/book-a-demo', '/security']);
  sparseRow = await persistedRowFor('L2', ['/blog/post']);
  legacyRow = {
    company_id: CO,
    lead_id: 'L3',
    intelligence: (richRow.intelligence as Row).summary, // v1 stored the summary DIRECTLY
    diagnostics: {},
    input_fingerprint: 'a'.repeat(64),
    engine_version: 'lie-1.0.0',
    generation_version: 2,
    schema_version: 1,
    generated_at: NOW_ISO,
    rebuild_requested_at: null,
  };
  malformedRow = {
    company_id: CO,
    lead_id: 'L4',
    intelligence: { summary: { confidence: 0.5, intent: 'garbage', qualification: 42 } },
    diagnostics: null,
    input_fingerprint: 'b'.repeat(64),
    engine_version: ENGINE_VERSION,
    generation_version: 1,
    schema_version: 2,
    generated_at: NOW_ISO,
    rebuild_requested_at: null,
  };
});

beforeEach(() => {
  mockState.rowsByLead.clear();
  mockState.rowsByLead.set('L1', richRow);
  mockState.rowsByLead.set('L2', sparseRow);
  mockState.rowsByLead.set('L3', legacyRow);
  mockState.rowsByLead.set('L4', malformedRow);
  mockState.upserts.length = 0;
  mockState.updates = 0;
  mockState.reads = 0;
  mockState.failReads = false;
  mockState.ignoreTenantFilter = false;
  mockAuth.calls.length = 0;
  mockAuth.impl = authorized;
});

describe('INT-003 Wave 1 — GET /api/leads/[id]/intelligence', () => {
  it('serves the full persisted envelope to an authorized member', async () => {
    const res = createMockRes();
    await singleHandler(req({ query: { id: 'L1', company_id: CO } }), res);

    expect(res.statusCode).toBe(200);
    const view = res.body;
    expect(view.status).toBe('available');
    expect(view.companyId).toBe(CO);
    expect(view.leadId).toBe('L1');
    expect(view.freshness).toBe('fresh');
    expect(view.version).toMatchObject({ engineVersion: ENGINE_VERSION, schemaVersion: 2, generation: 1, generatedAt: NOW_ISO });
    expect(view.version.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(view.intent.score).toBeGreaterThan(0);
    expect(view.persona.persona).toBe('CTO');
    expect(view.qualification.sections).toHaveLength(5);
    expect(view.recommendations).toHaveLength(10);
    expect(view.recommendations.some((r: { key: string }) => r.key === 'bestChannel')).toBe(true);
    expect(view.timeline.length).toBeGreaterThan(0);
    expect(view.qualificationPlanning.channels.length).toBeGreaterThan(0);
    expect(typeof view.overallConfidence).toBe('number');

    // read-only guarantee at the DB seam
    expect(mockState.upserts).toHaveLength(0);
    expect(mockState.updates).toBe(0);
  });

  it('missing intelligence → 200 never_generated (never regenerates)', async () => {
    const res = createMockRes();
    await singleHandler(req({ query: { id: 'absent', company_id: CO } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('never_generated');
    expect(res.body.freshness).toBe('never_generated');
    expect(res.body.version).toBeNull();
    expect(mockState.upserts).toHaveLength(0);
    expect(mockState.updates).toBe(0);
  });

  it('unauthenticated → 401 and no DB read', async () => {
    mockAuth.impl = async (_r, res) => {
      (res as ReturnType<typeof createMockRes>).status(401).json({ error: 'UNAUTHORIZED' });
      return null;
    };
    const res = createMockRes();
    await singleHandler(req({ query: { id: 'L1', company_id: CO } }), res);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'UNAUTHORIZED' });
    expect(mockState.reads).toBe(0);
  });

  it('foreign tenant membership → 403 and no DB read', async () => {
    mockAuth.impl = async (_r, res) => {
      (res as ReturnType<typeof createMockRes>).status(403).json({ error: 'FORBIDDEN_ROLE' });
      return null;
    };
    const res = createMockRes();
    await singleHandler(req({ query: { id: 'L1', company_id: 'co-OTHER' } }), res);
    expect(res.statusCode).toBe(403);
    expect(mockState.reads).toBe(0);
    expect(mockAuth.calls).toEqual(['co-OTHER']);
  });

  it('missing company_id → 400 via the auth seam', async () => {
    const res = createMockRes();
    await singleHandler(req({ query: { id: 'L1' } }), res);
    expect(res.statusCode).toBe(400);
  });

  it('malformed lead ids → 400 before auth', async () => {
    for (const id of ['', '   ', 'x'.repeat(129), ['a', 'b']]) {
      const res = createMockRes();
      await singleHandler(req({ query: { id, company_id: CO } }), res);
      expect(res.statusCode).toBe(400);
    }
    expect(mockAuth.calls).toHaveLength(0);
  });

  it('non-GET → 405', async () => {
    const res = createMockRes();
    await singleHandler(req({ method: 'POST', query: { id: 'L1', company_id: CO } }), res);
    expect(res.statusCode).toBe(405);
  });

  it('defense-in-depth: a foreign-tenant row leaking past the DB filter is served as never_generated', async () => {
    mockState.ignoreTenantFilter = true;
    mockState.rowsByLead.set('LX', { ...richRow, company_id: 'co-OTHER', lead_id: 'LX' });
    const res = createMockRes();
    await singleHandler(req({ query: { id: 'LX', company_id: CO } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('never_generated');
    expect(JSON.stringify(res.body)).not.toContain('co-OTHER');
  });

  it('legacy schema-1 rows serve with null planning layers and stale freshness', async () => {
    const res = createMockRes();
    await singleHandler(req({ query: { id: 'L3', company_id: CO } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('available');
    expect(res.body.freshness).toBe('stale');
    expect(res.body.version.engineVersion).toBe('lie-1.0.0');
    expect(res.body.qualificationPlanning).toBeNull();
    expect(res.body.automationPlanning).toBeNull();
    expect(res.body.intent.score).toBeGreaterThan(0); // v1 summary still fully served
  });

  it('malformed persisted payloads degrade section-by-section, never 500', async () => {
    const res = createMockRes();
    await singleHandler(req({ query: { id: 'L4', company_id: CO } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('available');
    expect(res.body.overallConfidence).toBe(0.5);
    expect(res.body.intent).toBeNull();
    expect(res.body.qualification).toBeNull();
  });

  it('a failing persistence read fails open to never_generated (200, not 500)', async () => {
    mockState.failReads = true;
    const res = createMockRes();
    await singleHandler(req({ query: { id: 'L1', company_id: CO } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('never_generated');
  });

  it('is deterministic — identical requests produce byte-identical bodies', async () => {
    const a = createMockRes();
    const b = createMockRes();
    await singleHandler(req({ query: { id: 'L1', company_id: CO } }), a);
    await singleHandler(req({ query: { id: 'L1', company_id: CO } }), b);
    expect(JSON.stringify(a.body)).toBe(JSON.stringify(b.body));
  });
});

describe('INT-003 Wave 1 — GET /api/leads/intelligence (bulk)', () => {
  it('bulk-reads list items for the requested ids (input set, deterministic)', async () => {
    const res = createMockRes();
    await listHandler(req({ query: { ids: 'L1,L2,absent', company_id: CO } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.items.map((i: { leadId: string }) => i.leadId)).toContain('L1');
    const absent = res.body.items.find((i: { leadId: string }) => i.leadId === 'absent');
    expect(absent.status).toBe('never_generated');
    expect(mockState.upserts).toHaveLength(0);
    expect(mockState.updates).toBe(0);
  });

  it('sorts by score with direction and deterministic leadId tiebreak', async () => {
    const desc = createMockRes();
    await listHandler(req({ query: { ids: 'L2,L1,L4', company_id: CO, sort: 'score', order: 'desc' } }), desc);
    const scores = desc.body.items.map((i: { overallScore: number | null }) => i.overallScore ?? -1);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(desc.body.items[0].leadId).toBe('L1'); // richest journey scores highest

    const asc = createMockRes();
    await listHandler(req({ query: { ids: 'L2,L1,L4', company_id: CO, sort: 'score', order: 'asc' } }), asc);
    expect(asc.body.items.map((i: { leadId: string }) => i.leadId)).toEqual(
      [...desc.body.items.map((i: { leadId: string }) => i.leadId)].reverse(),
    );
  });

  it('filters by status, freshness, band and min_score (selection only)', async () => {
    const byStatus = createMockRes();
    await listHandler(req({ query: { ids: 'L1,L2,L3,absent', company_id: CO, status: 'available' } }), byStatus);
    expect(byStatus.body.items.every((i: { status: string }) => i.status === 'available')).toBe(true);
    expect(byStatus.body.total).toBe(3);

    const byFreshness = createMockRes();
    await listHandler(req({ query: { ids: 'L1,L3,absent', company_id: CO, freshness: 'stale' } }), byFreshness);
    expect(byFreshness.body.items.map((i: { leadId: string }) => i.leadId)).toEqual(['L3']);

    const byScore = createMockRes();
    await listHandler(req({ query: { ids: 'L1,L2,absent', company_id: CO, min_score: '1' } }), byScore);
    expect(byScore.body.items.every((i: { overallScore: number }) => i.overallScore >= 1)).toBe(true);

    const byBand = createMockRes();
    await listHandler(req({ query: { ids: 'L1,L2', company_id: CO, band: 'hot,warm,cool,cold' } }), byBand);
    expect(byBand.body.total).toBe(2);
  });

  it('paginates over the sorted set without changing total', async () => {
    const res = createMockRes();
    await listHandler(req({ query: { ids: 'L1,L2,L3,L4', company_id: CO, sort: 'leadId', order: 'asc', limit: '2', offset: '1' } }), res);
    expect(res.body.total).toBe(4);
    expect(res.body.limit).toBe(2);
    expect(res.body.offset).toBe(1);
    expect(res.body.items.map((i: { leadId: string }) => i.leadId)).toEqual(['L2', 'L3']);
  });

  it('dedupes repeated ids', async () => {
    const res = createMockRes();
    await listHandler(req({ query: { ids: 'L1,L1,L1', company_id: CO } }), res);
    expect(res.body.total).toBe(1);
  });

  it('missing/invalid ids → 400 before auth; non-GET → 405', async () => {
    for (const query of [{ company_id: CO }, { ids: '', company_id: CO }, { ids: 'x'.repeat(200), company_id: CO }]) {
      const res = createMockRes();
      await listHandler(req({ query }), res);
      expect(res.statusCode).toBe(400);
    }
    expect(mockAuth.calls).toHaveLength(0);

    const res = createMockRes();
    await listHandler(req({ method: 'DELETE', query: { ids: 'L1', company_id: CO } }), res);
    expect(res.statusCode).toBe(405);
  });

  it('enforces auth: 401 unauthenticated, 403 forbidden, 400 missing company', async () => {
    mockAuth.impl = async (_r, res) => {
      (res as ReturnType<typeof createMockRes>).status(401).json({ error: 'UNAUTHORIZED' });
      return null;
    };
    const unauth = createMockRes();
    await listHandler(req({ query: { ids: 'L1', company_id: CO } }), unauth);
    expect(unauth.statusCode).toBe(401);
    expect(mockState.reads).toBe(0);

    mockAuth.impl = async (_r, res) => {
      (res as ReturnType<typeof createMockRes>).status(403).json({ error: 'FORBIDDEN_ROLE' });
      return null;
    };
    const forbidden = createMockRes();
    await listHandler(req({ query: { ids: 'L1', company_id: 'co-OTHER' } }), forbidden);
    expect(forbidden.statusCode).toBe(403);

    mockAuth.impl = authorized;
    const missing = createMockRes();
    await listHandler(req({ query: { ids: 'L1' } }), missing);
    expect(missing.statusCode).toBe(400);
  });

  it('tenant isolation: foreign-tenant rows never surface in bulk items', async () => {
    mockState.ignoreTenantFilter = true;
    mockState.rowsByLead.set('LX', { ...richRow, company_id: 'co-OTHER', lead_id: 'LX' });
    const res = createMockRes();
    await listHandler(req({ query: { ids: 'L1,LX', company_id: CO } }), res);
    expect(res.statusCode).toBe(200);
    const lx = res.body.items.find((i: { leadId: string }) => i.leadId === 'LX');
    expect(lx.status).toBe('never_generated');
    expect(JSON.stringify(res.body)).not.toContain('co-OTHER');
  });

  it('is deterministic — identical bulk requests produce byte-identical bodies', async () => {
    const a = createMockRes();
    const b = createMockRes();
    await listHandler(req({ query: { ids: 'L1,L2,L3,L4', company_id: CO, sort: 'score' } }), a);
    await listHandler(req({ query: { ids: 'L1,L2,L3,L4', company_id: CO, sort: 'score' } }), b);
    expect(JSON.stringify(a.body)).toBe(JSON.stringify(b.body));
  });
});
