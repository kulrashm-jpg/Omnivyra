/**
 * WS-2 follow-up — the enrichment orchestration seam.
 *
 * These test the SEAM, not the planner: every case goes through
 * `planProspectEnrichment` / `applyEnrichmentResult` with a stub port, so what
 * is proven is the contract WS-4 will consume — context assembly, tenant
 * scoping, and the normalize → persist → re-stamp sequence.
 *
 * PROVIDER NOTE. `crm` and `csv` are marked connected in these fixtures to
 * exercise the abstraction. Production remains AUTHORIZED = none,
 * OPERATIONAL = none for every people/firmographic provider.
 */

import {
  planProspectEnrichment,
  applyEnrichmentResult,
  type EnrichmentPorts,
  type ProspectSnapshot,
  type ConflictedAttribute,
} from '../../services/enrichment/service';
import { UNKNOWN_COST } from '../../services/enrichment/planner';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const PROSPECT = '00000000-0000-4000-8000-0000000000c1';
const NOW = '2026-09-03T00:00:00.000Z';
const FRESH = '2026-08-25T00:00:00.000Z';
const OLD = '2025-01-01T00:00:00.000Z';

const snapshot = (over: Partial<ProspectSnapshot> = {}): ProspectSnapshot => ({
  personId: 'person-1',
  accountId: 'account-1',
  person: { job_title: 'Head of Engines', attributes_updated_at: FRESH },
  account: { industry: 'Software', attributes_updated_at: FRESH },
  ...over,
});

type Calls = {
  snapshots: Array<[string, string]>;
  integrations: string[];
  conflicts: string[];
  persists: Array<Record<string, unknown>>;
};

const makePorts = (over: Partial<EnrichmentPorts> & {
  snap?: ProspectSnapshot | null;
  rows?: Array<{ id: string; type: string; status: string | null }>;
  conflicts?: ConflictedAttribute[];
  withheld?: Array<{ attribute: string; reason: string }>;
} = {}): { ports: EnrichmentPorts; calls: Calls } => {
  const calls: Calls = { snapshots: [], integrations: [], conflicts: [], persists: [] };
  const ports: EnrichmentPorts = {
    async loadSnapshot(org, prospect) {
      calls.snapshots.push([org, prospect]);
      // A tenant that does not own the Prospect sees nothing — the stub models
      // the tenant-scoped read the default port performs.
      if (org !== ORG_A) return null;
      return over.snap === undefined ? snapshot() : over.snap;
    },
    async loadIntegrations(org) { calls.integrations.push(org); return over.rows ?? []; },
    async loadConflicts(org) { calls.conflicts.push(org); return over.conflicts ?? []; },
    async persist(input) {
      calls.persists.push(input as unknown as Record<string, unknown>);
      return { canonicalWithheld: over.withheld ?? [] };
    },
    ...over,
  };
  return { ports, calls };
};

const plan = (input: Record<string, unknown> = {}, ports?: EnrichmentPorts) => {
  const p = ports ?? makePorts().ports;
  return planProspectEnrichment(
    { organizationId: ORG_A, prospectId: PROSPECT, now: NOW, ...input } as never, p,
  );
};
const field = (r: Awaited<ReturnType<typeof plan>>, a: string) =>
  r.plan.fields.find((f) => f.attribute === a)!;

// ════════════════════════════════════════════════════════════════════════════
describe('WS-2 seam — a tenant-scoped context reaches the planner', () => {
  it('1. every port is called with the tenant, explicitly', async () => {
    const { ports, calls } = makePorts();
    await plan({}, ports);
    expect(calls.snapshots).toEqual([[ORG_A, PROSPECT]]);
    expect(calls.integrations).toEqual([ORG_A]);
    expect(calls.conflicts).toEqual([ORG_A]);
  });

  it('1b. the plan covers both subjects, and excludes provenance columns', async () => {
    const r = await plan();
    expect(field(r, 'job_title').subject).toBe('person');
    expect(field(r, 'industry').subject).toBe('account');
    expect(r.plan.fields.some((f) => f.attribute === 'attributes_updated_at')).toBe(false);
    expect(r.plan.fields.some((f) => f.attribute === 'attributes_source')).toBe(false);
  });

  it('1c. it returns the snapshot it planned from, so a caller needs no second read', async () => {
    const r = await plan();
    expect(r.snapshot.personId).toBe('person-1');
    expect(r.snapshot.accountId).toBe('account-1');
  });
});

describe('WS-2 seam — field states arrive correctly classified', () => {
  it('2. a known, fresh field is skipped', async () => {
    expect(field(await plan(), 'industry').state).toBe('known');
    expect(field(await plan(), 'industry').action).toBe('skip');
  });

  it('3. an absent field is missing', async () => {
    expect(field(await plan(), 'employee_count').state).toBe('missing');
  });

  it('4. an old row makes its fields stale', async () => {
    const { ports } = makePorts({ snap: snapshot({ account: { industry: 'Software', attributes_updated_at: OLD } }) });
    expect(field(await plan({}, ports), 'industry').state).toBe('stale');
  });

  it('4b. a row with no freshness stamp is stale, not fresh', async () => {
    const { ports } = makePorts({ snap: snapshot({ account: { industry: 'Software' } }) });
    expect(field(await plan({}, ports), 'industry').state).toBe('stale');
  });

  it('5. LI-2s conflict verdict is carried through, and needs resolution', async () => {
    const { ports } = makePorts({ conflicts: [{ attribute: 'industry', subject: 'account' }] });
    const f = field(await plan({}, ports), 'industry');
    expect(f.state).toBe('conflicting');
    expect(f.action).toBe('needs_resolution');
    expect(f.source).toBeNull();
  });

  it('5b. a conflict on one subject does not leak to the same-named field on the other', async () => {
    const { ports } = makePorts({
      snap: snapshot({ person: { city: 'London', attributes_updated_at: FRESH }, account: { city: 'London', attributes_updated_at: FRESH } }),
      conflicts: [{ attribute: 'city', subject: 'person' }],
    });
    const r = await plan({}, ports);
    expect(r.plan.fields.filter((f) => f.attribute === 'city' && f.subject === 'person')[0].state).toBe('conflicting');
    expect(r.plan.fields.filter((f) => f.attribute === 'city' && f.subject === 'account')[0].state).toBe('known');
  });

  it('6. required-for-next-action is prioritised', async () => {
    const { ports } = makePorts({ rows: [{ id: 'i', type: 'crm', status: 'connected' }] });
    const r = await plan({
      requiredForNextAction: ['employee_count'],
      coverage: { external: { crm: ['employee_count', 'region'] } },
    }, ports);
    expect(r.plan.toEnrich[0].attribute).toBe('employee_count');
    expect(field(r, 'employee_count').requiredForNextAction).toBe(true);
  });

  it('a Prospect with no employer yet reports every account field as missing', async () => {
    const { ports } = makePorts({ snap: snapshot({ accountId: null, account: null }) });
    const r = await plan({}, ports);
    expect(field(r, 'industry').state).toBe('missing');
  });
});

describe('WS-2 seam — source coverage stays four distinct states', () => {
  it('7/8. a connected CRM or CSV source is selectable', async () => {
    const { ports } = makePorts({ rows: [
      { id: 'a', type: 'crm', status: 'connected' }, { id: 'b', type: 'csv', status: 'connected' },
    ] });
    const r = await plan({ coverage: { external: { crm: ['employee_count'], csv: ['region'] } } }, ports);
    expect(field(r, 'employee_count').source).toBe('crm');
    expect(field(r, 'region').source).toBe('csv');
  });

  it('9. a source that exists but is NOT connected is reported as such', async () => {
    const r = await plan({ coverage: { external: { crm: ['employee_count'] } } });
    expect(field(r, 'employee_count').action).toBe('no_available_source');
    expect(field(r, 'employee_count').reason).toMatch(/crm:not_connected/);
  });

  it('9b. a connected-but-errored source is distinguished from an unconnected one', async () => {
    const { ports } = makePorts({ rows: [{ id: 'a', type: 'crm', status: 'failed' }] });
    const r = await plan({ coverage: { external: { crm: ['employee_count'] } } }, ports);
    expect(field(r, 'employee_count').reason).toMatch(/crm:error/);
  });

  it('10. a DECLARED-only provider stays not_available — never operational', async () => {
    const { ports } = makePorts({ rows: [{ id: 'a', type: 'apollo', status: 'connected' }] });
    const r = await plan({ coverage: { external: { apollo: ['employee_count'] } } }, ports);
    // Even with a row claiming "connected", the catalogue refuses: the provider
    // is not implemented, so connecting it is not possible today.
    expect(field(r, 'employee_count').action).toBe('no_available_source');
    expect(field(r, 'employee_count').reason).toMatch(/apollo:not_available/);
  });

  it('11. with no coverage at all, every gap is an honest no_available_source', async () => {
    const r = await plan();
    expect(field(r, 'employee_count').action).toBe('no_available_source');
    expect(r.plan.empty).toBe(true);
  });

  it('12. an unpriced connected source keeps cost UNKNOWN, never zero', async () => {
    const { ports } = makePorts({ rows: [{ id: 'a', type: 'crm', status: 'connected' }] });
    const r = await plan({ coverage: { external: { crm: ['employee_count'] } } }, ports);
    expect(field(r, 'employee_count').cost).toEqual(UNKNOWN_COST);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-2 seam — results go through result.ts and LI-2', () => {
  const attempt = (over: Record<string, unknown> = {}) => ({
    organizationId: ORG_A, prospectId: PROSPECT, requested: ['industry'], source: 'crm', now: NOW, ...over,
  }) as never;

  it('13. a successful attempt is persisted through the LI-2 port', async () => {
    const { ports, calls } = makePorts();
    const r = await applyEnrichmentResult(
      attempt({ returned: [{ attribute: 'industry', subject: 'account', value: 'Fintech', observedAt: FRESH }] }),
      snapshot(), ports,
    );
    expect(r.status).toBe('success');
    expect(calls.persists).toHaveLength(1);
    expect(calls.persists[0].entityType).toBe('account');
    expect(calls.persists[0].attributes).toEqual({ industry: 'Fintech' });
    expect(calls.persists[0].organizationId).toBe(ORG_A);
    expect(calls.persists[0].observedAt).toBe(FRESH);
  });

  it('13b. person and account returns become two passes — LI-2 is single-entity', async () => {
    const { ports, calls } = makePorts();
    await applyEnrichmentResult(attempt({
      requested: ['industry', 'job_title'],
      returned: [
        { attribute: 'industry', subject: 'account', value: 'Fintech' },
        { attribute: 'job_title', subject: 'person', value: 'CTO' },
      ],
    }), snapshot(), ports);
    expect(calls.persists.map((p) => p.entityType).sort()).toEqual(['account', 'person']);
  });

  it('14. a FAILED attempt never reaches the port — existing evidence is untouched', async () => {
    const { ports, calls } = makePorts();
    const r = await applyEnrichmentResult(attempt({
      returned: [{ attribute: 'industry', subject: 'account', value: 'Fintech' }],
      error: { kind: 'error', message: 'provider 500' },
    }), snapshot(), ports);
    expect(r.status).toBe('failed');
    expect(calls.persists).toHaveLength(0);
  });

  it('14b. an unavailable source and a partial return also write nothing they did not get', async () => {
    const { ports, calls } = makePorts();
    await applyEnrichmentResult(attempt({ error: { kind: 'unavailable', message: 'no route' } }), snapshot(), ports);
    expect(calls.persists).toHaveLength(0);

    const partial = await applyEnrichmentResult(attempt({
      requested: ['industry', 'region'],
      returned: [{ attribute: 'industry', subject: 'account', value: 'Fintech' }],
    }), snapshot(), ports);
    expect(partial.status).toBe('partial');
    expect(calls.persists[0].attributes).toEqual({ industry: 'Fintech' });
  });

  it('14c. LI-2 withholding on disagreement re-stamps the result and clears the payload', async () => {
    const { ports } = makePorts({ withheld: [{ attribute: 'industry', reason: 'sources_disagree' }] });
    const r = await applyEnrichmentResult(
      attempt({ returned: [{ attribute: 'industry', subject: 'account', value: 'Fintech' }] }),
      snapshot(), ports,
    );
    expect(r.status).toBe('conflicting');
    expect(r.apply.account).toEqual({});
  });

  it('14d. a RULE C withhold leaves the result standing', async () => {
    const { ports } = makePorts({ withheld: [{ attribute: 'industry', reason: 'canonical_value_already_set' }] });
    const r = await applyEnrichmentResult(
      attempt({ returned: [{ attribute: 'industry', subject: 'account', value: 'Fintech' }] }),
      snapshot(), ports,
    );
    expect(r.status).toBe('success');
  });

  it('a returned account value with no resolved account is not written blind', async () => {
    const { ports, calls } = makePorts();
    await applyEnrichmentResult(
      attempt({ returned: [{ attribute: 'industry', subject: 'account', value: 'Fintech' }] }),
      snapshot({ accountId: null, account: null }), ports,
    );
    expect(calls.persists).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-2 seam — tenant safety and determinism', () => {
  it('15. tenant B cannot plan against tenant A\'s Prospect', async () => {
    const { ports, calls } = makePorts();
    await expect(planProspectEnrichment(
      { organizationId: ORG_B, prospectId: PROSPECT, now: NOW }, ports,
    )).rejects.toThrow(/not found in tenant/);
    // It failed at the read, before any coverage or conflict was consulted.
    expect(calls.integrations).toHaveLength(0);
    expect(calls.conflicts).toHaveLength(0);
  });

  it('15b. an unreadable Prospect is NOT reported as "nothing to enrich"', async () => {
    const { ports } = makePorts({ snap: null });
    await expect(plan({}, ports)).rejects.toThrow(/not found in tenant/);
  });

  it('16. missing tenant or prospect context fails before any port is touched', async () => {
    const { ports, calls } = makePorts();
    await expect(planProspectEnrichment({ organizationId: '', prospectId: PROSPECT, now: NOW }, ports))
      .rejects.toThrow(/organizationId is required/);
    await expect(planProspectEnrichment({ organizationId: ORG_A, prospectId: '  ', now: NOW }, ports))
      .rejects.toThrow(/prospectId is required/);
    expect(calls.snapshots).toHaveLength(0);
  });

  it('16b. applying a result without a tenant fails too', async () => {
    const { ports } = makePorts();
    await expect(applyEnrichmentResult(
      { organizationId: '', prospectId: PROSPECT, requested: [], source: null, now: NOW }, snapshot(), ports,
    )).rejects.toThrow(/organizationId is required/);
  });

  it('17. repeated planning of unchanged data is identical and produces no work', async () => {
    const a = await plan();
    const b = await plan();
    expect(JSON.stringify(a.plan)).toBe(JSON.stringify(b.plan));
    expect(a.plan.toEnrich).toHaveLength(0);
  });
});

describe('WS-2 seam — it added no second architecture', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../../services/enrichment/service.ts'), 'utf8');

  it('names no table and owns no data access — reads go through the port', () => {
    expect(src).not.toContain('ownedDbTable');
    expect(src).not.toContain('supabase');
  });

  it('reuses the one planner and the one result envelope', () => {
    expect(src).toContain("from './planner'");
    expect(src).toContain("from './result'");
    expect(src).not.toContain('function planEnrichment');
    expect(src).not.toContain('function normalizeEnrichmentResult');
  });

  it('does not touch WS-4\'s orchestrator', () => {
    expect(src).not.toContain('leadIngestion');
  });
});
