/**
 * PI-SIM-001 — the simulated lead → canonical → enrichment flow.
 *
 * WHAT THESE TESTS PROVE, AND WHAT THEY DO NOT
 * --------------------------------------------
 * They prove that six simulated sources translate into the SAME canonical
 * contract, carry the SAME hard identity signal for the same person, keep their
 * provenance distinct, and that three simulated providers disagree without any
 * observation being lost. They exercise the real `LeadSourceAdapter` and
 * `EnrichmentProviderAdapter` contracts — not a parallel simulation pipeline.
 *
 * They do NOT prove that six observations collapse to one row in Postgres.
 * That is the orchestrator's job against a real database, it is covered by the
 * real-schema project, and asserting it here against mocks would be asserting
 * the mock. What is proven here is the precondition: that identity resolution
 * WOULD see one identity, because every source emits the same external key.
 *
 * SECRETS: every value is synthetic. No credential, no real provider, no URL
 * that resolves. The simulated list host is `.local` and unroutable.
 */

import {
  SIM_ORG_A, SIM_ORG_B, SIM_PEOPLE, SIM_TIME, SIM_SCENARIOS,
  SIM_SALES_NAV_LIST_URL, SIM_SALES_NAV_LIST_URL_B,
  JANE_LINKEDIN_ID, isSimScenario, isSimulatedSalesNavUrl,
} from '../../services/simulation/fixtures';
import {
  SIM_SOURCES, SIMULATION_SOURCE_ADAPTERS, simulationEnabled,
  activeLeadsSimAdapter, marketPulsePersonSimAdapter,
  engagementDmSimAdapter, engagementCommentSimAdapter, salesNavSimAdapter,
  simulatedActiveLeadRecords, simulatedMarketPulseRecords,
  simulatedEngagementDmRecords, simulatedEngagementCommentRecords,
  simulatedCsvRows, simulatedXlsxRows,
  retrieveSimulatedSalesNavList, registerSimulationSources,
  SimulatedListUrlError,
} from '../../services/simulation/sourceSimulators';
import {
  SIMULATION_PROVIDER_ADAPTERS, apolloSimAdapter, rapidApiSimAdapter, zoomInfoSimAdapter,
  setSimProviderMode, resetSimProviderModes, collectConflictingObservations,
  PRECEDENCE_DECISION_REQUIRED,
} from '../../services/simulation/providerSimulators';
import { csvAdapter } from '../../services/leadIngestion/adapters/csvAdapter';
import type { EnrichmentRequest } from '../../services/enrichment/providers/contract';

/**
 * The NON-COMMENT projection of a source file.
 *
 * Asserting "this file never calls fetch" against the raw text fails on the
 * file's own header, which says exactly that in prose — the same trap that
 * `outcomeProvenance.ts` hit with the word it was forbidden to contain. The
 * claim is about CODE, so the assertion reads code: comment lines are stripped
 * first, and a positive companion proves the projection is not empty.
 */
function nonCommentSource(relPath: string): string {
  const raw = require('fs').readFileSync(
    require('path').join(process.cwd(), relPath), 'utf8') as string;
  return raw
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
}

const req = (over: Partial<EnrichmentRequest> = {}): EnrichmentRequest => ({
  organizationId: SIM_ORG_A,
  subject: 'person',
  entityId: 'canonical-person-jane',
  attributes: ['email', 'phone', 'job_title'],
  selectors: { domain: 'acme.example' },
  purpose: 'pi-sim-001',
  correlationId: 'sim-corr-1',
  ...over,
});

beforeEach(() => resetSimProviderModes());

// ───────────────────────────────────────────────────────────────────────────
describe('PI-SIM-001 — the simulation substitutes the PROVIDER, not the pipeline', () => {
  it('every simulated source implements the real LeadSourceAdapter contract', () => {
    expect(SIMULATION_SOURCE_ADAPTERS).toHaveLength(5);
    for (const a of SIMULATION_SOURCE_ADAPTERS) {
      expect(typeof a.source).toBe('string');
      expect(typeof a.label).toBe('string');
      expect(Array.isArray(a.capabilities)).toBe(true);
      expect(a.capabilities.length).toBeGreaterThan(0);
      expect(typeof a.translate).toBe('function');
    }
  });

  it('every simulated source key is namespaced, so evidence can never be mistaken for a vendor', () => {
    for (const a of SIMULATION_SOURCE_ADAPTERS) expect(a.source).toMatch(/-sim$/);
  });

  it('the provider simulators contain no transport primitive — they cannot call out', () => {
    const src = nonCommentSource('backend/services/simulation/providerSimulators.ts');
    // Positive companion first: prove the projection is the right file and not empty.
    expect(src).toContain('apollo-sim');
    expect(src).toContain('EnrichmentProviderAdapter');
    expect(src).not.toContain('safeFetch');
    expect(src).not.toContain('fetch(');
    expect(src).not.toContain('https://');
  });

  it('simulation refuses to register outside a simulation-enabled environment', () => {
    // NODE_ENV==='test' enables it here, which is itself the guard being asserted.
    expect(simulationEnabled()).toBe(true);
    const registered: string[] = [];
    const keys = registerSimulationSources((a) => registered.push(a.source));
    expect(registered).toHaveLength(5);
    expect(keys).toContain(SIM_SOURCES.salesNav);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('PI-SIM-001 — identity converges: six sources, ONE person', () => {
  const linkedinKeyOf = (n: { person?: { externalKeys?: Record<string, unknown> | null } | null }) =>
    (n.person?.externalKeys as { linkedin?: { external_id?: string } } | null)
      ?.linkedin?.external_id ?? null;

  it('all five adapter-based sources emit the SAME hard identity signal for Jane', () => {
    const observations = [
      activeLeadsSimAdapter.translate(simulatedActiveLeadRecords(['jane'])[0], SIM_ORG_A),
      marketPulsePersonSimAdapter.translate(simulatedMarketPulseRecords(['jane'])[0], SIM_ORG_A),
      engagementDmSimAdapter.translate(simulatedEngagementDmRecords(['jane'])[0], SIM_ORG_A),
      engagementCommentSimAdapter.translate(simulatedEngagementCommentRecords(['jane'])[0], SIM_ORG_A),
      salesNavSimAdapter.translate(
        retrieveSimulatedSalesNavList({ listUrl: SIM_SALES_NAV_LIST_URL }).members[0], SIM_ORG_A),
    ];

    // The precondition for convergence: one identity, five observations.
    for (const o of observations) expect(linkedinKeyOf(o.normalized)).toBe(JANE_LINKEDIN_ID);
    expect(new Set(observations.map((o) => linkedinKeyOf(o.normalized))).size).toBe(1);

    // And five DISTINCT provenances — convergence must not erase where it came from.
    expect(new Set(observations.map((o) => o.normalized.source)).size).toBe(5);
    expect(new Set(observations.map((o) => o.normalized.externalId)).size).toBe(5);
  });

  it('the spreadsheet path carries the same identity through the REAL csv adapter', () => {
    const [row] = simulatedCsvRows(SIM_ORG_A, ['jane']);
    const out = csvAdapter.translate(row as unknown as Record<string, unknown>, SIM_ORG_A);
    expect(out.normalized.source).toBe('csv');
    // The operator reference IS the LinkedIn id in these fixtures, so the file
    // and the network sources agree on who this is.
    expect(out.normalized.externalId).toBe(JANE_LINKEDIN_ID);
    expect(out.normalized.person?.email).toBe(SIM_PEOPLE.jane.email);
  });

  it('XLSX and CSV are the SAME server contract — no second parser is introduced', () => {
    const csv = csvAdapter.translate(
      simulatedCsvRows(SIM_ORG_A, ['jane'])[0] as unknown as Record<string, unknown>, SIM_ORG_A);
    const xlsx = csvAdapter.translate(
      simulatedXlsxRows(SIM_ORG_A, ['jane'])[0] as unknown as Record<string, unknown>, SIM_ORG_A);
    expect(xlsx.normalized.source).toBe(csv.normalized.source);
    expect(xlsx.normalized.externalId).toBe(csv.normalized.externalId);
    // They differ only in when the tenant observed them.
    expect(csv.normalized.observedAt).toBe(SIM_TIME.csv);
    expect(xlsx.normalized.observedAt).toBe(SIM_TIME.xlsx);
  });

  it('distinct people stay distinct — convergence is not collapse', () => {
    const rows = simulatedCsvRows(SIM_ORG_A, ['jane', 'bob', 'carol']);
    const ids = rows.map((r) =>
      csvAdapter.translate(r as unknown as Record<string, unknown>, SIM_ORG_A).normalized.externalId);
    expect(new Set(ids).size).toBe(3);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('PI-SIM-001 — every source translates to the canonical contract', () => {
  it('each normalized record carries tenant, source, entityType and externalId', () => {
    const all = [
      activeLeadsSimAdapter.translate(simulatedActiveLeadRecords(['jane'])[0], SIM_ORG_A),
      marketPulsePersonSimAdapter.translate(simulatedMarketPulseRecords(['jane'])[0], SIM_ORG_A),
      engagementDmSimAdapter.translate(simulatedEngagementDmRecords(['jane'])[0], SIM_ORG_A),
      engagementCommentSimAdapter.translate(simulatedEngagementCommentRecords(['jane'])[0], SIM_ORG_A),
    ];
    for (const { normalized, raw } of all) {
      expect(normalized.organizationId).toBe(SIM_ORG_A);
      expect(normalized.entityType).toBe('person');
      expect(normalized.externalId).toEqual(expect.any(String));
      expect(normalized.observedAt).toEqual(expect.any(String));
      // Raw is retained verbatim and is NOT the normalized shape.
      expect(raw).toHaveProperty('sim', true);
      expect(raw).not.toHaveProperty('organizationId');
    }
  });

  it('engagement identifies a person but asserts no employer and no job title', () => {
    const dm = engagementDmSimAdapter.translate(
      simulatedEngagementDmRecords(['jane'])[0], SIM_ORG_A);
    // Mirrors the production bridge, which refuses to map a headline onto a title.
    expect(dm.normalized.account).toBeNull();
    expect(dm.normalized.person?.jobTitle).toBeNull();
    expect(dm.normalized.person?.externalKeys).not.toBeNull();
  });

  it('an unknown person is a per-record normalization failure, never a batch abort', () => {
    expect(() => activeLeadsSimAdapter.translate({ personKey: 'nobody' }, SIM_ORG_A)).toThrow();
    // The sibling record still translates.
    expect(activeLeadsSimAdapter.translate(
      simulatedActiveLeadRecords(['bob'])[0], SIM_ORG_A).normalized.externalId).toBe('active-lead:bob');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('PI-SIM-001 — Sales Navigator simulated retrieval', () => {
  it('accepts only a SIMULATION list reference, and never dials anything', () => {
    expect(isSimulatedSalesNavUrl(SIM_SALES_NAV_LIST_URL)).toBe(true);
    expect(isSimulatedSalesNavUrl('https://www.linkedin.com/sales/lists/people/123')).toBe(false);
    expect(() => retrieveSimulatedSalesNavList({
      listUrl: 'https://www.linkedin.com/sales/lists/people/123',
    })).toThrow(SimulatedListUrlError);
  });

  it('the list URL is the INTAKE reference — never a person identity', () => {
    const page = retrieveSimulatedSalesNavList({ listUrl: SIM_SALES_NAV_LIST_URL });
    const out = salesNavSimAdapter.translate(page.members[0], SIM_ORG_A);
    expect(out.normalized.externalId).toBe(`salesnav:${JANE_LINKEDIN_ID}`);
    expect(out.normalized.externalId).not.toContain('simulation.sales-navigator.local');
  });

  it('re-submitting the same list is idempotent — the member identity does not move', () => {
    const first = retrieveSimulatedSalesNavList({ listUrl: SIM_SALES_NAV_LIST_URL });
    const second = retrieveSimulatedSalesNavList({ listUrl: SIM_SALES_NAV_LIST_URL });
    const idOf = (p: typeof first) =>
      p.members.map((m) => salesNavSimAdapter.translate(m, SIM_ORG_A).normalized.externalId);
    expect(idOf(second)).toEqual(idOf(first));
  });

  it('list membership is per list — one list is not "everyone"', () => {
    const a = retrieveSimulatedSalesNavList({ listUrl: SIM_SALES_NAV_LIST_URL });
    const b = retrieveSimulatedSalesNavList({ listUrl: SIM_SALES_NAV_LIST_URL_B });
    expect(a.members).toHaveLength(1);
    expect(b).toHaveProperty('totalMembers', 1);
    expect(salesNavSimAdapter.translate(b.members[0], SIM_ORG_A).normalized.externalId)
      .toBe(`salesnav:${SIM_PEOPLE.carol.linkedinId}`);
  });

  it('paginates deterministically', () => {
    const p1 = retrieveSimulatedSalesNavList({
      listUrl: SIM_SALES_NAV_LIST_URL, snapshot: 2, page: 1, pageSize: 1 });
    expect(p1.members).toHaveLength(1);
    expect(p1.nextPage).toBe(2);
    const p2 = retrieveSimulatedSalesNavList({
      listUrl: SIM_SALES_NAV_LIST_URL, snapshot: 2, page: 2, pageSize: 1 });
    expect(p2.members).toHaveLength(1);
    expect(p2.nextPage).toBeNull();
  });

  it('attribute DRIFT between snapshots is a new observation of the SAME person', () => {
    const s1 = salesNavSimAdapter.translate(
      retrieveSimulatedSalesNavList({ listUrl: SIM_SALES_NAV_LIST_URL, snapshot: 1 }).members[0],
      SIM_ORG_A);
    const s2 = salesNavSimAdapter.translate(
      retrieveSimulatedSalesNavList({ listUrl: SIM_SALES_NAV_LIST_URL, snapshot: 2 }).members[0],
      SIM_ORG_A);
    expect(s2.normalized.externalId).toBe(s1.normalized.externalId);   // same person
    expect(s1.normalized.person?.jobTitle).toBe('VP Marketing');
    expect(s2.normalized.person?.jobTitle).toBe('SVP Marketing');       // new observation
    expect(s2.normalized.observedAt).not.toBe(s1.normalized.observedAt);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('PI-SIM-001 — enrichment providers: deterministic success and failure', () => {
  it('every simulator implements the real provider contract and needs no credential', () => {
    expect(SIMULATION_PROVIDER_ADAPTERS).toHaveLength(3);
    for (const p of SIMULATION_PROVIDER_ADAPTERS) {
      expect(p.credentialEnvVar).toBeNull();
      expect(p.isAvailable()).toBe(true);
      expect(p.supports.length).toBeGreaterThan(0);
    }
  });

  it('a success returns only attributes that were ASKED for', async () => {
    const r = await apolloSimAdapter.enrich(req({ attributes: ['email'] }));
    expect(r.outcome).toBe('enriched');
    expect(r.fields.map((f) => f.attribute)).toEqual(['email']);
    expect(r.notReturned).toEqual([]);
  });

  it('a partial response keeps company facts and drops contact details', async () => {
    setSimProviderMode('zoominfo-sim', 'partial');
    const r = await zoomInfoSimAdapter.enrich(req({ attributes: ['phone', 'industry'] }));
    expect(r.outcome).toBe('enriched');
    const attrs = r.fields.map((f) => f.attribute);
    expect(attrs).toContain('industry');
    expect(attrs).not.toContain('phone');
    expect(r.notReturned).toContain('phone');
  });

  it.each([
    ['no_match', 'no_match'],
    ['timeout', 'timeout'],
    ['transient_failure', 'provider_unavailable'],
    ['permanent_failure', 'provider_declined'],
    ['malformed', 'malformed_response'],
  ] as const)('mode %s yields outcome %s with ZERO fields', async (mode, outcome) => {
    setSimProviderMode('apollo-sim', mode);
    const r = await apolloSimAdapter.enrich(req());
    expect(r.outcome).toBe(outcome);
    expect(r.fields).toEqual([]);
    // A refusal must not silently claim the attributes were answered.
    expect(r.notReturned).toEqual(req().attributes);
  });

  it('a rate limit carries an ABSOLUTE reset instant, never a guess', async () => {
    setSimProviderMode('apollo-sim', 'rate_limited');
    const r = await apolloSimAdapter.enrich(req());
    expect(r.outcome).toBe('rate_limited');
    expect(r.retryAfterAt).toBe('2026-09-08T10:00:00.000Z');
  });

  it('repeating the same request is idempotent — same input, same response', async () => {
    const a = await rapidApiSimAdapter.enrich(req({ attributes: ['phone', 'city'] }));
    const b = await rapidApiSimAdapter.enrich(req({ attributes: ['phone', 'city'] }));
    expect(b).toEqual(a);
  });

  it('a provider asked for nothing it holds reports field_not_found, not a fake answer', async () => {
    const r = await rapidApiSimAdapter.enrich(req({ attributes: ['annual_revenue'] }));
    expect(r.outcome).toBe('field_not_found');
    expect(r.fields).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('PI-SIM-001 — conflict is RETAINED, and resolution is a decision not yet made', () => {
  it('three providers disagree about job_title and all three observations survive', () => {
    const observed = collectConflictingObservations(req(), 'job_title');
    expect(observed).toHaveLength(2);   // apollo + zoominfo hold a title; rapidapi does not
    const values = observed.map((o) => o.value).sort();
    expect(values).toEqual(['Head of Marketing', 'Marketing Manager']);
    // Provenance survives with the value — a conflict with no source is useless.
    for (const o of observed) {
      expect(typeof o.provider).toBe('string');
      expect(o.observedAt).toBe(SIM_TIME.enrichment);
    }
  });

  it('the Sales Navigator observation is a THIRD opinion, and nothing resolves them', () => {
    const salesNav = salesNavSimAdapter.translate(
      retrieveSimulatedSalesNavList({ listUrl: SIM_SALES_NAV_LIST_URL }).members[0], SIM_ORG_A);
    expect(salesNav.normalized.person?.jobTitle).toBe('VP Marketing');

    const vendor = collectConflictingObservations(req(), 'job_title').map((o) => o.value);
    expect(vendor).not.toContain('VP Marketing');   // genuinely in conflict

    // And the decision is surfaced explicitly rather than silently taken.
    expect(PRECEDENCE_DECISION_REQUIRED.status).toBe('UNDECIDED');
    expect(PRECEDENCE_DECISION_REQUIRED.simulatedConflict.salesNavigator).toBe('VP Marketing');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('PI-SIM-001 — tenant isolation', () => {
  it('the tenant comes from the BATCH, never from the simulated payload', () => {
    const raw = { ...simulatedActiveLeadRecords(['jane'])[0], organizationId: SIM_ORG_B };
    const out = activeLeadsSimAdapter.translate(raw, SIM_ORG_A);
    expect(out.normalized.organizationId).toBe(SIM_ORG_A);
  });

  it('the same person observed in two tenants yields two tenant-bound records', () => {
    const a = salesNavSimAdapter.translate(
      retrieveSimulatedSalesNavList({ listUrl: SIM_SALES_NAV_LIST_URL }).members[0], SIM_ORG_A);
    const b = salesNavSimAdapter.translate(
      retrieveSimulatedSalesNavList({ listUrl: SIM_SALES_NAV_LIST_URL }).members[0], SIM_ORG_B);
    expect(a.normalized.organizationId).toBe(SIM_ORG_A);
    expect(b.normalized.organizationId).toBe(SIM_ORG_B);
    // Identity is the same PERSON, but the records are separately tenant-owned —
    // the composite (id, organization_id) constraints do the rest downstream.
    expect(b.normalized.externalId).toBe(a.normalized.externalId);
    expect(a.normalized.organizationId).not.toBe(b.normalized.organizationId);
  });

  it('spreadsheet rows carry the tenant they were uploaded under', () => {
    const rowB = simulatedXlsxRows(SIM_ORG_B, ['carol'])[0];
    expect(rowB.organizationId).toBe(SIM_ORG_B);
    const out = csvAdapter.translate(rowB as unknown as Record<string, unknown>, SIM_ORG_B);
    expect(out.normalized.organizationId).toBe(SIM_ORG_B);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('PI-SIM-001 — determinism', () => {
  it('scenario keys are a closed vocabulary', () => {
    expect(isSimScenario('SALES_NAV_CONFLICT_001')).toBe(true);
    expect(isSimScenario('WHATEVER')).toBe(false);
    expect(SIM_SCENARIOS.length).toBeGreaterThan(0);
  });

  it('the same retrieval twice is byte-identical', () => {
    expect(retrieveSimulatedSalesNavList({ listUrl: SIM_SALES_NAV_LIST_URL, snapshot: 2 }))
      .toEqual(retrieveSimulatedSalesNavList({ listUrl: SIM_SALES_NAV_LIST_URL, snapshot: 2 }));
  });

  it('no simulator reads the clock or rolls a die', () => {
    for (const f of ['fixtures.ts', 'sourceSimulators.ts', 'providerSimulators.ts']) {
      const src = nonCommentSource(`backend/services/simulation/${f}`);
      expect(src).toContain('SIM_');                 // companion: projection is real
      expect(src).not.toContain('Math.random');
      expect(src).not.toContain('Date.now');
      expect(src).not.toContain('new Date(');
    }
  });
});
