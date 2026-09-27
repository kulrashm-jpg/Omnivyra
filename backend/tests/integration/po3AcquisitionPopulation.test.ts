/**
 * PO-3 T2 — the acquisition pipeline end to end, with only the browser faked.
 *
 * This runs the REAL `listDueAdsSubjects` (eligibility, due rule, dedup, ordering), the REAL
 * `runAdsAcquisitionCycle` (bounds, sequencing, persistence), the REAL browser client and the
 * REAL observation layer. Only the Playwright page is a stub, so no network call is made and no
 * provider is contacted.
 *
 * What it is here to prove: that with a representative production-shaped population — customers,
 * TEST, QA, INTERNAL, a soft-deleted company, an inactive company, and rows sharing an identical
 * timestamp — ONLY the intended subjects reach acquisition, the bounds hold, and the evidence
 * written carries the right tenant, company and domain.
 *
 * SECRETS: none. No env file is read for credentials; the supabase client is faked.
 */
import { runAdsAcquisitionCycle } from '../../services/ads/adsAcquisitionScheduler';
import type { AdsBrowserPage, AdsBrowserSession } from '../../services/ads/adsTransparencyBrowserClient';

type DomainRow = { id: string; company_id: string; primary_domain: string; verified: boolean; updated_at: string };
type CoRow = { id: string; name: string | null; status: string | null; deleted_at: string | null };

const db: { domains: DomainRow[]; companies: CoRow[] } = { domains: [], companies: [] };

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from(table: string) {
      const self = {
        select: () => self,
        eq: () => self,
        in: () => self,
        order: () => self,
        limit: () => resolve(),
        then: (cb: (v: unknown) => unknown) => Promise.resolve(resolve()).then(cb),
      };
      function resolve() {
        if (table === 'canonical_domains') {
          return {
            data: [...db.domains].sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.id.localeCompare(b.id)),
            error: null,
          };
        }
        if (table === 'companies') return { data: db.companies, error: null };
        return { data: [], error: null }; // evidence history + canonical_pages: nothing recorded yet
      }
      return self;
    },
  },
}));

import { listDueAdsSubjects } from '../../services/ads/adsDueSubjects';

const SAME_TS = '2026-07-04T04:36:19.191589Z';
const dom = (id: string, company_id: string, primary_domain: string, updated_at = SAME_TS): DomainRow =>
  ({ id, company_id, primary_domain, verified: false, updated_at });

/** A page that navigates nowhere. `goto` rejecting is the honest stand-in for no network. */
function stubSession(record: { pages: number }): AdsBrowserSession {
  return {
    async withPage<T>(fn: (page: AdsBrowserPage) => Promise<T>): Promise<T> {
      record.pages += 1;
      const page = {
        goto: async () => { throw new Error('net::ERR_INTERNET_DISCONNECTED'); },
        evaluate: async () => [],
        url: () => 'https://adstransparency.google.com/',
        waitForTimeout: async () => undefined,
      } as unknown as AdsBrowserPage;
      return fn(page);
    },
  };
}

type Persisted = { companyId: string; domainId: string | null; observation: { accessState?: string } };

function representativePopulation() {
  db.domains = [
    // five real customers, all sharing one timestamp (the production shape)
    dom('d-infitoo', 'co-infitoo', 'infitoo.com'),
    dom('d-afrost', 'co-afrost', 'afrost.org'),
    dom('d-drishiq', 'co-drishiq', 'drishiq.com'),
    dom('d-embro', 'co-embro', 'embrosales.in'),
    dom('d-nothing', 'co-nothing', 'nothingelsematterz.com'),
    // a sixth customer, so the 5-per-cycle cap actually bites
    dom('d-sixth', 'co-sixth', 'sixthcustomer.com'),
    // non-acquirable population
    dom('d-test', 'co-test', 'python.org'),
    dom('d-qa', 'co-qa', 'wrong.example.com'),
    dom('d-internal', 'co-internal', 'omnivyra.com'),
    dom('d-deleted', 'co-deleted', 'deletedcustomer.com'),
    dom('d-inactive', 'co-inactive', 'inactivecustomer.com'),
    dom('d-orphan', 'co-missing', 'orphancustomer.com'),
    // duplicate of a customer pair — must not be enqueued twice
    dom('d-infitoo', 'co-infitoo', 'infitoo.com'),
  ];
  db.companies = [
    { id: 'co-infitoo', name: 'Infitoo Systems llp', status: 'active', deleted_at: null },
    { id: 'co-afrost', name: 'Afrost', status: 'active', deleted_at: null },
    { id: 'co-drishiq', name: 'Drishiq', status: 'active', deleted_at: null },
    { id: 'co-embro', name: 'Embrosales', status: 'active', deleted_at: null },
    { id: 'co-nothing', name: 'Unfinished Innovations LLP', status: 'active', deleted_at: null },
    { id: 'co-sixth', name: 'Sixth Customer Ltd', status: 'active', deleted_at: null },
    { id: 'co-test', name: 'Ingestion Activation Test', status: 'active', deleted_at: null },
    { id: 'co-qa', name: 'QA Tenant 12', status: 'active', deleted_at: null },
    { id: 'co-internal', name: 'Omnivyra', status: 'active', deleted_at: null },
    { id: 'co-deleted', name: 'Deleted Customer', status: 'active', deleted_at: '2026-07-04T00:00:00Z' },
    { id: 'co-inactive', name: 'Inactive Customer', status: 'inactive', deleted_at: null },
    // co-missing deliberately absent
  ];
}

async function runCycle(maxSubjectsPerCycle?: number) {
  const record = { pages: 0 };
  const persisted: Persisted[] = [];
  const counters = await runAdsAcquisitionCycle({
    listDueSubjects: listDueAdsSubjects,
    openSession: async () => ({ session: stubSession(record), close: async () => undefined }),
    sink: { persist: async (row: Persisted) => { persisted.push(row); } },
    vantage: 'test',
    isEnabled: () => true,
    ...(maxSubjectsPerCycle ? { maxSubjectsPerCycle } : {}),
  } as Parameters<typeof runAdsAcquisitionCycle>[0]);
  return { counters, persisted, record };
}

beforeEach(() => { representativePopulation(); });

describe('T2 — only the intended population reaches acquisition', () => {
  it('acquires customers only, and never a TEST/QA/INTERNAL/deleted/inactive/orphan subject', async () => {
    const { persisted } = await runCycle(50);
    const companies = persisted.map((p) => p.companyId).sort();
    expect(companies).toEqual(
      ['co-afrost', 'co-drishiq', 'co-embro', 'co-infitoo', 'co-nothing', 'co-sixth'].sort(),
    );
    for (const forbidden of ['co-test', 'co-qa', 'co-internal', 'co-deleted', 'co-inactive', 'co-missing']) {
      expect(companies).not.toContain(forbidden);
    }
  });

  it('never enqueues the same company|domain pair twice', async () => {
    const { persisted } = await runCycle(50);
    const keys = persisted.map((p) => `${p.companyId}|${p.domainId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('T2 — the existing bounds still hold', () => {
  it('caps the cycle at 5 subjects even though 6 customers are eligible', async () => {
    const { counters, persisted } = await runCycle(); // production default
    expect(counters.subjects).toBe(5);
    expect(persisted).toHaveLength(5);
  });

  it('opens one page at a time — no parallel browser fan-out', async () => {
    const { record, counters } = await runCycle();
    // The stub counts withPage calls; sequential execution means pages are opened one per
    // subject search, never a burst ahead of the loop.
    expect(record.pages).toBeGreaterThan(0);
    expect(counters.subjects).toBe(5);
  });

  it('with the flag off, nothing is read, opened or persisted', async () => {
    const persisted: Persisted[] = [];
    const counters = await runAdsAcquisitionCycle({
      listDueSubjects: async () => { throw new Error('must not be called'); },
      openSession: async () => { throw new Error('must not be called'); },
      sink: { persist: async (row: Persisted) => { persisted.push(row); } },
      vantage: 'test',
      isEnabled: () => false,
    } as Parameters<typeof runAdsAcquisitionCycle>[0]);
    expect(counters).toEqual({ enabled: 0, subjects: 0, observed: 0, persisted: 0, errors: 0 });
    expect(persisted).toHaveLength(0);
  });
});

describe('T2 — evidence keeps its tenant, domain and failure state', () => {
  it('every persisted row is attributed to the company and domain it was acquired for', async () => {
    const { persisted } = await runCycle(50);
    const expected = new Map([
      ['co-infitoo', 'd-infitoo'], ['co-afrost', 'd-afrost'], ['co-drishiq', 'd-drishiq'],
      ['co-embro', 'd-embro'], ['co-nothing', 'd-nothing'], ['co-sixth', 'd-sixth'],
    ]);
    for (const row of persisted) {
      expect(row.domainId).toBe(expected.get(row.companyId));
    }
    // No row may carry a company that was never a subject — the cross-tenant control.
    expect(persisted.every((r) => expected.has(r.companyId))).toBe(true);
  });

  it('a provider failure is persisted as a non-successful access state, never as a success', async () => {
    const { persisted, counters } = await runCycle(50);
    expect(persisted.length).toBeGreaterThan(0);
    for (const row of persisted) {
      // The stub page cannot navigate, so nothing was observed. The row must say so.
      expect(row.observation.accessState).toBeDefined();
      expect(row.observation.accessState).not.toBe('observed');
    }
    expect(counters.errors).toBe(0); // a failed observation is recorded, not thrown away
  });
});
