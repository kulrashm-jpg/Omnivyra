/**
 * WS-2 (FR-07, FR-09, FR-10) — enrichment planning, cost and result.
 *
 * The properties these tests exist to hold, in order of how much damage their
 * absence would do:
 *
 *   1. A failure can never null a field we already knew. Enforced structurally
 *      (`apply` only ever contains returned values), and asserted for every
 *      failure shape.
 *   2. `no_available_source` is a correct, honest plan. There is no authorized
 *      people-data provider, so a planner that always found one would be lying.
 *   3. Unknown cost is not zero, and never outranks a known cost.
 *   4. Stale, missing and conflicting are three states with three actions.
 *      A conflict is never "resolved" by fetching again.
 *   5. Tenant isolation: availability comes from the tenant's own integration
 *      rows, so another tenant's connected provider is invisible.
 *
 * PROVIDER STATUS NOTE. The fixtures below connect `crm` and `csv` to exercise
 * the ABSTRACTION. They say nothing about production, where AUTHORIZED = none
 * and OPERATIONAL = none for every people/firmographic provider.
 */

import {
  planEnrichment,
  classifyField,
  FIELD_STATES,
  FIELD_ACTIONS,
  DEFAULT_STALENESS_DAYS,
  ENRICHMENT_PLANNER_VERSION,
  FREE,
  UNKNOWN_COST,
  type EnrichmentPlanInput,
} from '../../services/enrichment/planner';
import {
  normalizeEnrichmentResult,
  markConflicting,
  ENRICHMENT_STATUSES,
} from '../../services/enrichment/result';

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';
const PROSPECT = '00000000-0000-4000-8000-0000000000c1';
const NOW = '2026-09-03T00:00:00.000Z';
const FRESH = '2026-08-25T00:00:00.000Z';   // 9 days old
const OLD = '2025-01-01T00:00:00.000Z';     // ~610 days old

/** A tenant with `crm` genuinely connected. */
const connectedCrm = [{ id: 'int-1', type: 'crm', status: 'connected' }];

const plan = (over: Partial<EnrichmentPlanInput> = {}) => planEnrichment({
  organizationId: ORG_A, prospectId: PROSPECT, now: NOW, fields: [], ...over,
});
const field = (a: string, over: Record<string, unknown> = {}) =>
  ({ attribute: a, subject: 'account' as const, ...over });
const of = (p: ReturnType<typeof plan>, attribute: string) =>
  p.fields.find((f) => f.attribute === attribute)!;

// ════════════════════════════════════════════════════════════════════════════
describe('FR-07 — field state: known, missing, stale, conflicting', () => {
  it('1. a known and fresh field is skipped, not re-bought', () => {
    const p = plan({ fields: [field('industry', { value: 'Software', observedAt: FRESH })] });
    expect(of(p, 'industry').state).toBe('known');
    expect(of(p, 'industry').action).toBe('skip');
    expect(p.empty).toBe(true);
    expect(of(p, 'industry').reason).toMatch(/re-enriching would re-buy/);
  });

  it('2. a missing field is planned for enrichment', () => {
    const p = plan({
      fields: [field('industry')],
      integrations: connectedCrm,
      coverage: { external: { crm: ['industry'] } },
    });
    expect(of(p, 'industry').state).toBe('missing');
    expect(of(p, 'industry').action).toBe('enrich');
  });

  it('2b. blank strings and empty arrays are MISSING, not known', () => {
    const p = plan({ fields: [
      field('industry', { value: '   ', observedAt: FRESH }),
      field('technologies', { value: [], observedAt: FRESH }),
    ] });
    expect(of(p, 'industry').state).toBe('missing');
    expect(of(p, 'technologies').state).toBe('missing');
  });

  it('3. a stale field is STALE, not missing — it needs re-observation', () => {
    const p = plan({ fields: [field('industry', { value: 'Software', observedAt: OLD })] });
    expect(of(p, 'industry').state).toBe('stale');
  });

  it('3b. a known value with NO usable timestamp is stale — currency is not assumed', () => {
    expect(classifyField(field('industry', { value: 'X' }), NOW, 90)).toBe('stale');
    expect(classifyField(field('industry', { value: 'X', observedAt: 'not-a-date' }), NOW, 90)).toBe('stale');
  });

  it('3c. the staleness horizon is injected, and the default is documented', () => {
    const at80 = field('industry', { value: 'X', observedAt: '2026-06-15T00:00:00.000Z' });
    expect(classifyField(at80, NOW, 365)).toBe('known');
    expect(classifyField(at80, NOW, 30)).toBe('stale');
    expect(DEFAULT_STALENESS_DAYS).toBe(90);
  });

  it('4. a conflicting field needs RESOLUTION and is never enriched over', () => {
    const p = plan({
      fields: [field('industry', { value: 'Software', observedAt: FRESH, sourcesDisagree: true })],
      integrations: connectedCrm,
      coverage: { external: { crm: ['industry'] } },
    });
    expect(of(p, 'industry').state).toBe('conflicting');
    expect(of(p, 'industry').action).toBe('needs_resolution');
    expect(of(p, 'industry').source).toBeNull();
    expect(of(p, 'industry').reason).toMatch(/RULE B|overwrite a conflict/);
  });

  it('4b. a conflict outranks a fresh value — it is not buried as "known"', () => {
    expect(classifyField(field('x', { value: 'v', observedAt: NOW, sourcesDisagree: true }), NOW, 90))
      .toBe('conflicting');
  });

  it('5. required-for-next-action is represented and ordered first', () => {
    const p = plan({
      fields: [field('industry'), field('employee_count')],
      requiredForNextAction: ['employee_count'],
      integrations: connectedCrm,
      coverage: { external: { crm: ['industry', 'employee_count'] } },
    });
    expect(of(p, 'employee_count').requiredForNextAction).toBe(true);
    expect(of(p, 'industry').requiredForNextAction).toBe(false);
    expect(p.toEnrich[0].attribute).toBe('employee_count');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('FR-07 — source preference, honestly', () => {
  it('6/7/8. prefers internal, then MarketPulse, then a connected external source', () => {
    const p = plan({
      fields: [field('a'), field('b'), field('c')],
      integrations: connectedCrm,
      coverage: { internal: ['a'], marketPulse: ['b'], external: { crm: ['c'] } },
    });
    expect(of(p, 'a').source).toBe('internal');
    expect(of(p, 'b').source).toBe('market_pulse');
    expect(of(p, 'c').source).toBe('crm');
    expect(of(p, 'a').cost).toEqual(FREE);
    expect(of(p, 'b').cost).toEqual(FREE);
  });

  it('6b. internal wins even when an external source also covers the field', () => {
    const p = plan({
      fields: [field('a')], integrations: connectedCrm,
      coverage: { internal: ['a'], external: { crm: ['a'] } },
      costs: { crm: { amount: 0.01, currency: 'USD' } },
    });
    expect(of(p, 'a').source).toBe('internal');
  });

  it('9. an UNAVAILABLE declared provider is never selected, and says why', () => {
    const p = plan({
      fields: [field('industry')],
      coverage: { external: { apollo: ['industry'] } },
    });
    expect(of(p, 'industry').action).toBe('no_available_source');
    expect(of(p, 'industry').source).toBeNull();
    expect(of(p, 'industry').reason).toMatch(/apollo:not_available/);
  });

  it('10. an available-but-UNCONNECTED source is not selected either', () => {
    const p = plan({
      fields: [field('industry')], integrations: [],
      coverage: { external: { crm: ['industry'] } },
    });
    expect(of(p, 'industry').action).toBe('no_available_source');
    expect(of(p, 'industry').reason).toMatch(/crm:not_connected/);
  });

  it('10b. a connected-but-ERRORED source is not selected', () => {
    const p = plan({
      fields: [field('industry')],
      integrations: [{ id: 'i', type: 'crm', status: 'failed' }],
      coverage: { external: { crm: ['industry'] } },
    });
    expect(of(p, 'industry').action).toBe('no_available_source');
    expect(of(p, 'industry').reason).toMatch(/crm:error/);
  });

  it('11. NO AVAILABLE SOURCE is a correct plan, not an error', () => {
    const p = plan({ fields: [field('industry')] });
    expect(of(p, 'industry').action).toBe('no_available_source');
    expect(of(p, 'industry').reason).toMatch(/no source declares coverage/);
    expect(p.empty).toBe(true);
    expect(p.counts.missing).toBe(1);
  });

  it('an unknown source key is refused rather than trusted', () => {
    const p = plan({
      fields: [field('industry')],
      integrations: [{ id: 'i', type: 'not_a_real_source', status: 'connected' }],
      coverage: { external: { not_a_real_source: ['industry'] } },
    });
    expect(of(p, 'industry').action).toBe('no_available_source');
    expect(of(p, 'industry').reason).toMatch(/unknown_source/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('FR-09 — cost awareness', () => {
  it('12. a known cost is carried with its currency', () => {
    const p = plan({
      fields: [field('industry')], integrations: connectedCrm,
      coverage: { external: { crm: ['industry'] } },
      costs: { crm: { amount: 0.25, currency: 'USD' } },
    });
    expect(of(p, 'industry').cost).toEqual({ kind: 'known', amount: 0.25, currency: 'USD' });
  });

  it('13. an unpriced source is UNKNOWN — never zero', () => {
    const p = plan({
      fields: [field('industry')], integrations: connectedCrm,
      coverage: { external: { crm: ['industry'] } },
    });
    expect(of(p, 'industry').cost).toEqual(UNKNOWN_COST);
    expect(of(p, 'industry').cost).not.toHaveProperty('amount');
    expect(of(p, 'industry').reason).toMatch(/UNKNOWN, which is not the same as free/);
  });

  it('13b. the cost type makes "unknown as zero" unrepresentable', () => {
    // There is no numeric field to read on an unknown cost, so a summation
    // cannot silently treat it as 0.
    expect(Object.keys(UNKNOWN_COST)).toEqual(['kind']);
    expect(Object.keys(FREE)).toEqual(['kind']);
  });

  it('prefers the cheaper KNOWN cost between two connected sources', () => {
    const p = plan({
      fields: [field('industry')],
      integrations: [
        { id: 'a', type: 'crm', status: 'connected' },
        { id: 'b', type: 'csv', status: 'connected' },
      ],
      coverage: { external: { crm: ['industry'], csv: ['industry'] } },
      costs: { crm: { amount: 0.90, currency: 'USD' }, csv: { amount: 0.10, currency: 'USD' } },
    });
    expect(of(p, 'industry').source).toBe('csv');
  });

  it('an UNPRICED source never outranks a priced one — unpriced is not cheap', () => {
    const p = plan({
      fields: [field('industry')],
      integrations: [
        { id: 'a', type: 'crm', status: 'connected' },
        { id: 'b', type: 'csv', status: 'connected' },
      ],
      coverage: { external: { crm: ['industry'], csv: ['industry'] } },
      costs: { crm: { amount: 5, currency: 'USD' } },   // csv unpriced
    });
    expect(of(p, 'industry').source).toBe('crm');
  });

  it('orders free before priced before unpriced in toEnrich', () => {
    const p = plan({
      fields: [field('free1'), field('priced'), field('unpriced')],
      integrations: [
        { id: 'a', type: 'crm', status: 'connected' },
        { id: 'b', type: 'csv', status: 'connected' },
      ],
      coverage: { internal: ['free1'], external: { crm: ['priced'], csv: ['unpriced'] } },
      costs: { crm: { amount: 1, currency: 'USD' } },
    });
    expect(p.toEnrich.map((f) => f.attribute)).toEqual(['free1', 'priced', 'unpriced']);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('FR-10 — result handling and failure preservation', () => {
  const attempt = (over: Record<string, unknown> = {}) => normalizeEnrichmentResult({
    organizationId: ORG_A, prospectId: PROSPECT, requested: ['industry'], source: 'crm', now: NOW, ...over,
  } as never);

  it('15. a full return is SUCCESS and hands LI-2 the payload', () => {
    const r = attempt({ returned: [{ attribute: 'industry', subject: 'account', value: 'Software', observedAt: FRESH, confidence: 0.9 }] });
    expect(r.status).toBe('success');
    expect(r.apply.account).toEqual({ industry: 'Software' });
    expect(r.notReturned).toEqual([]);
    expect(r.provenance[0]).toEqual({ attribute: 'industry', subject: 'account', observedAt: FRESH, confidence: 0.9 });
    expect(r.reason).toMatch(/LI-2 arbitrates/);
  });

  it('14. a partial return stays PARTIAL and applies only what came back', () => {
    const r = attempt({
      requested: ['industry', 'employee_count'],
      returned: [{ attribute: 'industry', subject: 'account', value: 'Software' }],
    });
    expect(r.status).toBe('partial');
    expect(r.apply.account).toEqual({ industry: 'Software' });
    expect(r.notReturned).toEqual(['employee_count']);
  });

  it('16/18. a FAILED provider applies NOTHING — prior values are untouched', () => {
    const r = attempt({
      returned: [{ attribute: 'industry', subject: 'account', value: 'Software' }],
      error: { kind: 'error', message: 'provider 500' },
    });
    expect(r.status).toBe('failed');
    expect(r.apply.account).toEqual({});
    expect(r.apply.person).toEqual({});
    expect(r.reason).toMatch(/prior values are untouched/);
  });

  it('17/18. a TIMEOUT applies nothing, and is distinct from unavailable', () => {
    const timeout = attempt({ error: { kind: 'timeout', message: 'deadline exceeded' } });
    expect(timeout.status).toBe('failed');
    expect(timeout.apply.account).toEqual({});

    const down = attempt({ error: { kind: 'unavailable', message: 'no route' } });
    expect(down.status).toBe('unavailable');
    expect(down.apply.account).toEqual({});
  });

  it('18b. a null or blank returned value can never null a stored field', () => {
    const r = attempt({
      requested: ['industry', 'region', 'city'],
      returned: [
        { attribute: 'industry', subject: 'account', value: null },
        { attribute: 'region', subject: 'account', value: '   ' },
        { attribute: 'city', subject: 'account', value: 'London' },
      ],
    });
    expect(r.apply.account).toEqual({ city: 'London' });
    expect(r.notReturned).toEqual(expect.arrayContaining(['industry', 'region']));
  });

  it('11b. no source means NO_AVAILABLE_SOURCE and nothing attempted', () => {
    const r = attempt({ source: null });
    expect(r.status).toBe('no_available_source');
    expect(r.apply.account).toEqual({});
    expect(r.reason).toMatch(/nothing was attempted and nothing changed/);
  });

  it('a source that returned nothing usable is partial, not success', () => {
    const r = attempt({ returned: [] });
    expect(r.status).toBe('partial');
    expect(r.apply.account).toEqual({});
  });

  it('a caller cannot declare success by fiat — status follows the evidence', () => {
    const r = attempt({ returned: [], status: 'success' } as never);
    expect(r.status).toBe('partial');
  });

  it('splits the payload by subject, because LI-2 is single-entity by design', () => {
    const r = attempt({
      requested: ['industry', 'job_title'],
      returned: [
        { attribute: 'industry', subject: 'account', value: 'Software' },
        { attribute: 'job_title', subject: 'person', value: 'Head of Engines' },
      ],
    });
    expect(r.apply.account).toEqual({ industry: 'Software' });
    expect(r.apply.person).toEqual({ job_title: 'Head of Engines' });
  });

  it('keeps an out-of-range confidence out rather than clamping it', () => {
    const r = attempt({ returned: [{ attribute: 'industry', subject: 'account', value: 'X', confidence: 4 }] });
    expect(r.provenance[0].confidence).toBeNull();
  });

  it('preserves unknown cost and the refresh flag on the record', () => {
    const r = attempt({ returned: [{ attribute: 'industry', subject: 'account', value: 'X' }], refresh: true });
    expect(r.cost).toEqual(UNKNOWN_COST);
    expect(r.refresh).toBe(true);
  });

  it('4c. CONFLICTING is LI-2 verdict, and re-stamping CLEARS the payload', () => {
    const r = attempt({ returned: [{ attribute: 'industry', subject: 'account', value: 'Software' }] });
    expect(r.status).toBe('success');

    const conflicted = markConflicting(r, [{ attribute: 'industry', reason: 'sources_disagree' }]);
    expect(conflicted.status).toBe('conflicting');
    expect(conflicted.apply.account).toEqual({});
    expect(conflicted.reason).toMatch(/no canonical value was overwritten/);
  });

  it('a RULE C withhold is not a conflict — the result stands', () => {
    const r = attempt({ returned: [{ attribute: 'industry', subject: 'account', value: 'Software' }] });
    expect(markConflicting(r, [{ attribute: 'industry', reason: 'canonical_value_already_set' }]).status)
      .toBe('success');
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-2 — tenant isolation and determinism', () => {
  it('19. availability comes from the TENANT\'s own rows — B cannot use A\'s connection', () => {
    const forA = plan({
      organizationId: ORG_A, integrations: connectedCrm,
      fields: [field('industry')], coverage: { external: { crm: ['industry'] } },
    });
    expect(of(forA, 'industry').source).toBe('crm');

    // Tenant B passes no integration rows of its own.
    const forB = plan({
      organizationId: ORG_B, integrations: [],
      fields: [field('industry')], coverage: { external: { crm: ['industry'] } },
    });
    expect(of(forB, 'industry').action).toBe('no_available_source');
  });

  it('19b. the plan is stamped with the tenant it was built for', () => {
    expect(plan({ organizationId: ORG_B }).organizationId).toBe(ORG_B);
  });

  it('19c. refuses to plan without a tenant or a prospect', () => {
    expect(() => plan({ organizationId: '' })).toThrow(/organizationId is required/);
    expect(() => plan({ prospectId: '' })).toThrow(/prospectId is required/);
    expect(() => normalizeEnrichmentResult({
      organizationId: '', prospectId: PROSPECT, requested: [], source: null, now: NOW,
    })).toThrow(/organizationId is required/);
  });

  it('20. planning the same unchanged fresh data twice yields no work, repeatably', () => {
    const input = {
      fields: [field('industry', { value: 'Software', observedAt: FRESH })],
      integrations: connectedCrm,
      coverage: { external: { crm: ['industry'] } },
    };
    const a = plan(input);
    const b = plan(input);
    expect(a.toEnrich).toHaveLength(0);
    expect(b.toEnrich).toHaveLength(0);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('20b. it has no clock of its own — the same inputs always plan the same', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/enrichment/planner.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/Date\.now\(\)|new Date\(\)/);
  });

  it('every field appears exactly once, with a legal state and action', () => {
    const p = plan({ fields: [field('a'), field('b'), field('c')] });
    expect(p.fields).toHaveLength(3);
    for (const f of p.fields) {
      expect(FIELD_STATES as readonly string[]).toContain(f.state);
      expect(FIELD_ACTIONS as readonly string[]).toContain(f.action);
      expect(typeof f.reason).toBe('string');
      expect(f.reason.length).toBeGreaterThan(0);
    }
  });

  it('carries its version so a plan traces to the rules that made it', () => {
    expect(plan().version).toBe(ENRICHMENT_PLANNER_VERSION);
    expect([...ENRICHMENT_STATUSES]).toEqual([
      'success', 'partial', 'no_available_source', 'unavailable', 'failed', 'conflicting',
    ]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe('WS-2 — it built no second architecture', () => {
  const read = (p: string) => require('fs').readFileSync(
    require('path').join(__dirname, '../../services/enrichment/', p), 'utf8');

  it('the planner performs no I/O and writes nothing', () => {
    const src = read('planner.ts');
    for (const forbidden of ['ownedDbTable', 'supabase', '.insert(', '.update(', 'fetch(']) {
      expect(src).not.toContain(forbidden);
    }
  });

  it('it creates no provider registry and no enrichment table', () => {
    for (const p of ['planner.ts', 'result.ts']) {
      const src = read(p);
      expect(src).not.toContain('registerProvider');
      expect(src).not.toContain('CREATE TABLE');
      expect(src).not.toMatch(/enrichment_results|enrichment_requests/);
    }
  });

  it('it reuses the existing availability registry rather than its own', () => {
    expect(read('planner.ts')).toContain("from '../integrations/dataSourceCatalogue'");
  });

  it('the result module owns no conflict rule — LI-2 does', () => {
    const src = read('result.ts');
    // It may REFERENCE LI-2's reason string, but must not implement arbitration.
    expect(src).toContain('sources_disagree');
    expect(src).not.toMatch(/function\s+decide|function\s+arbitrate|function\s+resolveConflict/);
  });
});
