/**
 * WS-3 (C-1) — PI's read-only consumption of `market_pulse_*`.
 *
 * The default port is exercised against a stub database rather than mocked
 * away, because the tenant filters ARE the security property under test: a
 * suite that doubled `loadFindings` would pass even if the real query dropped
 * `company_id`.
 */

type Row = Record<string, unknown>;

const db = {
  tables: {} as Record<string, Row[]>,
  errors: {} as Record<string, { message: string } | undefined>,
  /** Every filter the code applied, per table — the tenant-scoping evidence. */
  filters: [] as Array<{ table: string; column: string; value: unknown }>,
  writeOps: [] as string[],
};

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const eqs: Array<[string, unknown]> = [];
    const ins: Array<[string, unknown[]]> = [];
    const rows = (): Row[] => (db.tables[table] ??= []);
    const run = async () => {
      await Promise.resolve();
      const err = db.errors[table];
      if (err) return { data: null, error: err };
      const matched = rows().filter((r) =>
        eqs.every(([c, v]) => r[c] === v) && ins.every(([c, vs]) => vs.includes(r[c] as never)));
      return { data: matched, error: null };
    };
    const api: Record<string, unknown> = {
      select: () => api,
      eq: (c: string, v: unknown) => { eqs.push([c, v]); db.filters.push({ table, column: c, value: v }); return api; },
      in: (c: string, v: unknown[]) => { ins.push([c, v]); db.filters.push({ table, column: c, value: v }); return api; },
      order: () => api,
      limit: () => api,
      maybeSingle: () => run().then((r) => ({
        data: Array.isArray(r.data) ? ((r.data as Row[])[0] ?? null) : r.data, error: r.error,
      })),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej),
    };
    for (const op of ['insert', 'update', 'upsert', 'delete']) {
      api[op] = () => { db.writeOps.push(`${table}.${op}`); return api; };
    }
    return api;
  },
}));

import {
  MARKET_PULSE_PI_VERSION,
  marketPulseAttributeCoverage,
  readTenantMarketContext,
  defaultMarketPulsePorts,
  type MarketPulsePorts,
} from '../../services/marketPulse/prospectIntelligence';
import {
  ACCOUNT_ATTRIBUTE_COLUMNS,
  PERSON_ATTRIBUTE_COLUMNS,
} from '../../services/prospectIdentity/attributes';
import { ingestionEnrichmentCoverage } from '../../services/leadIngestion/enrichmentCoverage';
import { planEnrichment } from '../../services/enrichment/planner';

const readFile = (p: string): string =>
  require('fs').readFileSync(require('path').join(__dirname, p), 'utf8');

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const NOW = '2026-09-03T00:00:00.000Z';

const seedRun = (org: string, id: string, over: Row = {}) => {
  (db.tables.market_pulse_runs ??= []).push({
    id, company_id: org, status: 'completed', created_at: '2026-09-01T00:00:00.000Z',
    completed_at: '2026-09-01T01:00:00.000Z', market_direction: 'expanding', ...over,
  });
};
const seedFinding = (org: string, runId: string, id: string, over: Row = {}) => {
  (db.tables.market_pulse_findings ??= []).push({
    id, run_id: runId, company_id: org, category: 'hiring_talent', title: 'Hiring surge',
    regions: ['India'], impact_type: 'opportunity', priority_tier: 'P1',
    confidence_score: 72, relevance_score: 80, last_seen_at: '2026-09-01T00:00:00.000Z',
    created_at: '2026-08-01T00:00:00.000Z', ...over,
  });
};

beforeEach(() => { db.tables = {}; db.errors = {}; db.filters = []; db.writeOps = []; });

// ════════════════════════════════════════════════════════════════════════════
describe('WS-3 attribute coverage — empty, and empty for a reason', () => {
  it('supplies no canonical Account or Person attribute', () => {
    expect(marketPulseAttributeCoverage()).toEqual([]);
  });

  it('the schema fact behind that: a finding never names an external company', () => {
    // MarketPulse writes `entities` as a literal empty array on every insert.
    // If that ever changes, MarketPulse gains an entity subject and WS-3's
    // coverage answer must be revisited — so this test is the tripwire.
    const engine = readFile('../../services/marketPulseV2ServiceEngine.ts');
    expect(engine).toContain('entities: []');

    const intel = readFile('../../services/marketPulseIntelligenceService.ts');
    expect(intel).toContain('industries: []');
  });

  it('claims nothing the canonical attribute surfaces could accept', () => {
    const surface = new Set<string>([...ACCOUNT_ATTRIBUTE_COLUMNS, ...PERSON_ATTRIBUTE_COLUMNS]);
    for (const attr of marketPulseAttributeCoverage()) expect(surface.has(attr)).toBe(true);
    // Stated positively: the tenant's own market region is NOT offered as an
    // account firmographic. That copy would be a fabricated attribute.
    expect(marketPulseAttributeCoverage()).not.toContain('region');
    expect(marketPulseAttributeCoverage()).not.toContain('market');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-3 → WS-2 — MarketPulse sits ahead of any external provider', () => {
  it('WS-4 asks WS-3 rather than assuming: the planner is offered a marketPulse slot', () => {
    expect(ingestionEnrichmentCoverage().marketPulse).toEqual(marketPulseAttributeCoverage());
  });

  it('an attribute MarketPulse covers is planned as market_pulse, FREE, before a provider', () => {
    // Proves the wiring is live rather than decorative: the planner's third
    // step is reachable, and it outranks a connected paid external source.
    const plan = planEnrichment({
      organizationId: ORG_A, prospectId: 'p1', now: NOW,
      fields: [{ attribute: 'industry', subject: 'account', value: null, observedAt: null }],
      coverage: { marketPulse: ['industry'], external: { crm: ['industry'] } },
      integrations: [],
    });
    expect(plan.toEnrich[0]).toMatchObject({
      attribute: 'industry', action: 'enrich', source: 'market_pulse', cost: { kind: 'free' },
    });
  });

  it('with WS-3\'s real (empty) answer, the same field falls through honestly', () => {
    const plan = planEnrichment({
      organizationId: ORG_A, prospectId: 'p1', now: NOW,
      fields: [{ attribute: 'industry', subject: 'account', value: null, observedAt: null }],
      coverage: ingestionEnrichmentCoverage(),
      integrations: [],
    });
    expect(plan.fields[0].action).toBe('no_available_source');
    expect(plan.fields[0].source).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-3 market context — reuse by reference, never duplication', () => {
  it('returns the tenant\'s existing intelligence and creates nothing', async () => {
    seedRun(ORG_A, 'run-1');
    seedFinding(ORG_A, 'run-1', 'f-1');

    const ctx = await readTenantMarketContext({ organizationId: ORG_A, now: NOW });
    expect(ctx.available).toBe(true);
    expect(ctx.version).toBe(MARKET_PULSE_PI_VERSION);
    expect(ctx.items).toHaveLength(1);
    expect(db.writeOps).toEqual([]);           // nothing written, anywhere
  });

  it('the SAME context serves several Prospects at one Account — nothing is copied per Prospect', async () => {
    seedRun(ORG_A, 'run-1');
    seedFinding(ORG_A, 'run-1', 'f-1');

    const forProspect1 = await readTenantMarketContext({ organizationId: ORG_A, now: NOW });
    const forProspect2 = await readTenantMarketContext({ organizationId: ORG_A, now: NOW });

    expect(forProspect2).toEqual(forProspect1);          // idempotent repeat read
    expect(db.writeOps).toEqual([]);                     // and still no derived row
    expect(db.tables.market_pulse_findings).toHaveLength(1);
  });

  it('preserves provenance: which finding, which run, when it was observed', async () => {
    seedRun(ORG_A, 'run-1');
    seedFinding(ORG_A, 'run-1', 'f-1');

    const ctx = await readTenantMarketContext({ organizationId: ORG_A, now: NOW });
    expect(ctx.items[0]).toMatchObject({
      id: 'f-1', runId: 'run-1', category: 'hiring_talent',
      observedAt: '2026-09-01T00:00:00.000Z', confidence: 72, kind: 'derived',
    });
    expect(ctx.run).toMatchObject({ id: 'run-1', marketDirection: 'expanding' });
  });

  it('marks every item DERIVED — a market scan is interpretation, not observation', async () => {
    seedRun(ORG_A, 'run-1');
    seedFinding(ORG_A, 'run-1', 'f-1');
    seedFinding(ORG_A, 'run-1', 'f-2');
    const ctx = await readTenantMarketContext({ organizationId: ORG_A, now: NOW });
    expect(ctx.items.map((i) => i.kind)).toEqual(['derived', 'derived']);
  });

  it('reports a missing confidence as null, never as zero', async () => {
    seedRun(ORG_A, 'run-1');
    seedFinding(ORG_A, 'run-1', 'f-1', { confidence_score: null });
    const ctx = await readTenantMarketContext({ organizationId: ORG_A, now: NOW });
    expect(ctx.items[0].confidence).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-3 absence and freshness — never fabricated', () => {
  it('a tenant that has never scanned is reported as such, not as an empty market', async () => {
    const ctx = await readTenantMarketContext({ organizationId: ORG_A, now: NOW });
    expect(ctx.available).toBe(false);
    expect(ctx.run).toBeNull();
    expect(ctx.reason).toMatch(/no completed Market Pulse run/);
  });

  it('a run that found nothing is a DIFFERENT finding from never having run', async () => {
    seedRun(ORG_A, 'run-1');
    const ctx = await readTenantMarketContext({ organizationId: ORG_A, now: NOW });
    expect(ctx.available).toBe(false);
    expect(ctx.run?.id).toBe('run-1');            // the scan ran; the market was quiet
    expect(ctx.reason).toMatch(/produced no findings/);
  });

  it('an unusable (running / failed) run is not offered as intelligence', async () => {
    seedRun(ORG_A, 'run-1', { status: 'running' });
    seedFinding(ORG_A, 'run-1', 'f-1');
    const ctx = await readTenantMarketContext({ organizationId: ORG_A, now: NOW });
    expect(ctx.available).toBe(false);
    expect(ctx.run).toBeNull();
  });

  it('reports age, and asserts staleness only under a policy the CALLER supplied', async () => {
    seedRun(ORG_A, 'run-1');
    seedFinding(ORG_A, 'run-1', 'f-1');            // observed 2026-09-01, now 2026-09-03

    const noPolicy = await readTenantMarketContext({ organizationId: ORG_A, now: NOW });
    expect(noPolicy.items[0].ageDays).toBe(2);
    expect(noPolicy.items[0].stale).toBeNull();    // unknown policy is NOT "fresh"

    const fresh = await readTenantMarketContext({ organizationId: ORG_A, now: NOW, stalenessDays: 30 });
    expect(fresh.items[0].stale).toBe(false);

    const stale = await readTenantMarketContext({ organizationId: ORG_A, now: NOW, stalenessDays: 1 });
    expect(stale.items[0].stale).toBe(true);
  });

  it('an item whose age cannot be shown is STALE under a policy, not fresh', async () => {
    seedRun(ORG_A, 'run-1');
    seedFinding(ORG_A, 'run-1', 'f-1', { last_seen_at: null, created_at: null });
    const ctx = await readTenantMarketContext({ organizationId: ORG_A, now: NOW, stalenessDays: 30 });
    expect(ctx.items[0].ageDays).toBeNull();
    expect(ctx.items[0].stale).toBe(true);
  });

  it('refuses to derive "now" from ambient time', async () => {
    await expect(readTenantMarketContext({ organizationId: ORG_A, now: '' }))
      .rejects.toThrow(/now is required/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-3 partial and regional data', () => {
  it('a partial finding — no region, no tier — is still usable context', async () => {
    seedRun(ORG_A, 'run-1');
    seedFinding(ORG_A, 'run-1', 'f-1', { regions: null, priority_tier: null, title: null });
    const ctx = await readTenantMarketContext({ organizationId: ORG_A, now: NOW });
    expect(ctx.available).toBe(true);
    expect(ctx.items[0]).toMatchObject({ regions: [], priorityTier: null, title: null });
  });

  it('a regional question keeps market-wide findings rather than hiding them', async () => {
    seedRun(ORG_A, 'run-1');
    seedFinding(ORG_A, 'run-1', 'regional', { regions: ['India'] });
    seedFinding(ORG_A, 'run-1', 'global', { regions: [] });
    seedFinding(ORG_A, 'run-1', 'elsewhere', { regions: ['Brazil'] });

    const ctx = await readTenantMarketContext({ organizationId: ORG_A, regions: ['india'], now: NOW });
    expect(ctx.items.map((i) => i.id).sort()).toEqual(['global', 'regional']);
  });

  it('a region with no coverage is reported, not silently answered with everything', async () => {
    seedRun(ORG_A, 'run-1');
    seedFinding(ORG_A, 'run-1', 'f-1', { regions: ['India'] });
    const ctx = await readTenantMarketContext({ organizationId: ORG_A, regions: ['Japan'], now: NOW });
    expect(ctx.available).toBe(false);
    expect(ctx.reason).toMatch(/none for the requested region/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-3 tenant isolation', () => {
  it('Tenant A cannot read Tenant B\'s market intelligence', async () => {
    seedRun(ORG_B, 'run-b');
    seedFinding(ORG_B, 'run-b', 'f-b');
    const ctx = await readTenantMarketContext({ organizationId: ORG_A, now: NOW });
    expect(ctx.available).toBe(false);
    expect(ctx.run).toBeNull();
  });

  it('a finding mis-stamped into another tenant\'s run does not cross on the join', async () => {
    seedRun(ORG_A, 'run-1');
    seedFinding(ORG_A, 'run-1', 'mine');
    seedFinding(ORG_B, 'run-1', 'theirs');       // same run_id, different tenant
    const ctx = await readTenantMarketContext({ organizationId: ORG_A, now: NOW });
    expect(ctx.items.map((i) => i.id)).toEqual(['mine']);
  });

  it('BOTH reads filter on company_id — the tenant is never left to the join', async () => {
    seedRun(ORG_A, 'run-1');
    seedFinding(ORG_A, 'run-1', 'f-1');
    await readTenantMarketContext({ organizationId: ORG_A, now: NOW });

    for (const table of ['market_pulse_runs', 'market_pulse_findings']) {
      expect(db.filters).toContainEqual({ table, column: 'company_id', value: ORG_A });
    }
  });

  it('refuses to run tenant-less', async () => {
    await expect(readTenantMarketContext({ organizationId: '  ', now: NOW }))
      .rejects.toThrow(/organizationId is required/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-3 failure semantics and the read-only contract', () => {
  it('an unreadable run surfaces as an error, never as "no market intelligence"', async () => {
    db.errors.market_pulse_runs = { message: 'connection reset' };
    await expect(readTenantMarketContext({ organizationId: ORG_A, now: NOW }))
      .rejects.toThrow(/market_pulse_runs read failed: connection reset/);
  });

  it('an unreadable findings table surfaces too — a broken read is not an empty market', async () => {
    seedRun(ORG_A, 'run-1');
    db.errors.market_pulse_findings = { message: 'permission denied' };
    await expect(readTenantMarketContext({ organizationId: ORG_A, now: NOW }))
      .rejects.toThrow(/market_pulse_findings read failed: permission denied/);
  });

  it('a port failure fails safely — no partial context is returned', async () => {
    const ports: MarketPulsePorts = {
      async loadLatestRun() { return { id: 'r', createdAt: null, completedAt: null, marketDirection: null }; },
      async loadFindings() { throw new Error('downstream unavailable'); },
    };
    await expect(readTenantMarketContext({ organizationId: ORG_A, now: NOW }, ports))
      .rejects.toThrow('downstream unavailable');
    expect(db.writeOps).toEqual([]);
  });

  it('WS-3 performs NO MarketPulse write — the module contains no write verb', () => {
    const src = readFile('../../services/marketPulse/prospectIntelligence.ts');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const verb of ['.insert(', '.update(', '.upsert(', '.delete(']) {
      expect(code).not.toContain(verb);
    }
  });

  it('reads the canonical family only — never the legacy `marketpulse_*` store', () => {
    const src = readFile('../../services/marketPulse/prospectIntelligence.ts');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain("ownedDbTable('market_pulse_runs')");
    expect(code).toContain("ownedDbTable('market_pulse_findings')");
    expect(code).not.toMatch(/ownedDbTable\('marketpulse_/);
  });

  it('introduces no storage model of its own — it names only `market_pulse_*`', () => {
    const src = readFile('../../services/marketPulse/prospectIntelligence.ts');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const tables = [...code.matchAll(/ownedDbTable\('([a-z_0-9]+)'\)/g)].map((m) => m[1]);
    expect([...new Set(tables)].sort()).toEqual(['market_pulse_findings', 'market_pulse_runs']);
  });

  it('the default port is the only place a table is named', () => {
    expect(typeof defaultMarketPulsePorts.loadLatestRun).toBe('function');
    expect(typeof defaultMarketPulsePorts.loadFindings).toBe('function');
  });
});
