/**
 * PO-3 F2 — acquisition subject eligibility.
 *
 * WHY THIS SUITE EXISTS. Measured against production, a `canonical_domains` row on its own was
 * enough to be acquired for. That admitted 43 subjects of which 5 were real customers: 33
 * belonged to SOFT-DELETED companies and the rest were QA/TEST tenants, so a first live cycle
 * would have spent its whole 5-subject budget asking a third-party provider about
 * `wrong-*.example.com` and `python.org`.
 *
 * The rule under test is therefore: a domain row is acquirable only if its COMPANY is live,
 * active, and classifies as CUSTOMER. Each way that can go wrong is pinned below.
 *
 * SECRETS: none. `decideAcquirability` is pure; the selection tests use an in-memory fake.
 */
import { decideAcquirability, listDueAdsSubjects } from '../../services/ads/adsDueSubjects';

const live = { status: 'active', deletedAt: null };

describe('decideAcquirability — company liveness gates before classification', () => {
  it('admits a live, active CUSTOMER tenant', () => {
    const d = decideAcquirability({ companyId: 'c1', name: 'Infitoo Systems llp', domain: 'infitoo.com', ...live });
    expect(d.acquirable).toBe(true);
    expect(d.tenantClass).toBe('CUSTOMER');
  });

  it('refuses a soft-deleted company even when it would classify as CUSTOMER', () => {
    const d = decideAcquirability({ companyId: 'c1', name: 'Infitoo Systems llp', domain: 'infitoo.com', status: 'active', deletedAt: '2026-07-04T00:00:00Z' });
    expect(d.acquirable).toBe(false);
    // Liveness is reported as liveness, not disguised as a classification outcome.
    expect(d.tenantClass).toBeNull();
    expect(d.reason).toMatch(/soft-deleted/);
  });

  it.each(['inactive', 'suspended', 'pending', null])('refuses a company whose status is %s', (status) => {
    const d = decideAcquirability({ companyId: 'c1', name: 'Infitoo Systems llp', domain: 'infitoo.com', status, deletedAt: null });
    expect(d.acquirable).toBe(false);
  });

  it('refuses a row whose company does not resolve at all', () => {
    // An orphan domain row is excluded by the same rule as an inactive one — no special case.
    const d = decideAcquirability({ companyId: 'c1', name: null, domain: 'infitoo.com', status: null, deletedAt: null });
    expect(d.acquirable).toBe(false);
  });

  it('refuses a row with no company id', () => {
    expect(decideAcquirability({ companyId: '', name: 'x', domain: 'infitoo.com', ...live }).acquirable).toBe(false);
  });
});

describe('decideAcquirability — tenant classification, reusing the existing classifier', () => {
  // These are the real production tenants the audit inventoried.
  it.each([
    ['TEST  — name says test',        'Ingestion Activation Test', 'calendly.com'],
    ['TEST  — placeholder domain',    'Some Co',                   'python.org'],
    ['TEST  — placeholder subdomain', 'Some Co',                   'www.python.org'],
    ['TEST  — example.com fixture',   'Some Co',                   'wrong-mp4j1mws.example.com'],
    ['TEST  — example.com fixture',   'Some Co',                   'wrong.example.com'],
  ])('%s is not acquirable', (_label, name, domain) => {
    const d = decideAcquirability({ companyId: 'c1', name, domain, ...live });
    expect(d.acquirable).toBe(false);
    expect(d.tenantClass).toBe('TEST');
  });

  it('a QA tenant is not acquirable', () => {
    const d = decideAcquirability({ companyId: 'c1', name: 'QA Tenant 12', domain: 'acme.com', ...live });
    expect(d.acquirable).toBe(false);
    expect(d.tenantClass).toBe('QA');
  });

  it('a DEMO tenant is not acquirable', () => {
    const d = decideAcquirability({ companyId: 'c1', name: 'Demo Account', domain: 'acme.com', ...live });
    expect(d.acquirable).toBe(false);
    expect(d.tenantClass).toBe('DEMO');
  });

  /**
   * RECORDED PRODUCT DECISION: INTERNAL (the vendor's own domain) is NOT acquirable.
   * This mirrors the population-integrity gate already applied to customer interventions
   * ("only tenant_class CUSTOMER is eligible"). It was decided, not inferred — the repository
   * also contains a counter-precedent in /api/cron/serp-acquisition, which acquires FOR the
   * vendor company. If that decision is revisited, this test is the thing to change first.
   */
  it.each(['omnivyra.com', 'www.omnivyra.com', 'qa-mp4j3gu0.omnivyra.com'])(
    'INTERNAL vendor domain %s is not acquirable (recorded decision)',
    (domain) => {
      expect(decideAcquirability({ companyId: 'c1', name: 'Omnivyra', domain, ...live }).acquirable).toBe(false);
    },
  );

  it('a real customer domain is unaffected by the vendor and placeholder rules', () => {
    for (const domain of ['infitoo.com', 'afrost.org', 'drishiq.com', 'embrosales.in', 'nothingelsematterz.com']) {
      expect(decideAcquirability({ companyId: 'c1', name: 'Real Co', domain, ...live }).acquirable).toBe(true);
    }
  });

  it('does NOT gate on canonical_domains.verified', () => {
    // Every production row has verified=false and nothing writes it; gating on it would exclude
    // every real customer. It may only raise confidence, never grant or withhold eligibility.
    const unverified = decideAcquirability({ companyId: 'c1', name: 'Real Co', domain: 'infitoo.com', domainVerified: false, ...live });
    const verified = decideAcquirability({ companyId: 'c1', name: 'Real Co', domain: 'infitoo.com', domainVerified: true, ...live });
    expect(unverified.acquirable).toBe(true);
    expect(verified.acquirable).toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   Selection, through an in-memory supabase fake.
   ──────────────────────────────────────────────────────────────────────────── */

type DomainRow = { id: string; company_id: string; primary_domain: string; verified: boolean; updated_at: string };
type CoRow = { id: string; name: string | null; status: string | null; deleted_at: string | null };

const state: { domains: DomainRow[]; companies: CoRow[]; orderCalls: Array<[string, boolean]> } = {
  domains: [], companies: [], orderCalls: [],
};

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from(table: string) {
      const q: Record<string, unknown> = {};
      const self = {
        select: () => self,
        eq: () => self,
        in: (_c: string, _v: string[]) => self,
        limit: () => resolve(),
        order: (col: string, opts?: { ascending?: boolean }) => {
          // Scoped to the subject scan; other reads (evidence history) order too.
          if (table === 'canonical_domains') state.orderCalls.push([col, opts?.ascending !== false]);
          return self;
        },
        then: (cb: (v: unknown) => unknown) => Promise.resolve(resolve()).then(cb),
      };
      function resolve() {
        if (table === 'canonical_domains') {
          const sorted = [...state.domains].sort(
            (a, b) => a.updated_at.localeCompare(b.updated_at) || a.id.localeCompare(b.id),
          );
          return { data: sorted, error: null };
        }
        if (table === 'companies') return { data: state.companies, error: null };
        return { data: [], error: null }; // report_evidence_history / canonical_pages: empty
      }
      void q;
      return self;
    },
  },
}));

const domain = (id: string, company_id: string, primary_domain: string, updated_at = '2026-07-04T04:36:19.191589Z'): DomainRow =>
  ({ id, company_id, primary_domain, verified: false, updated_at });

describe('listDueAdsSubjects — only the intended population reaches acquisition', () => {
  beforeEach(() => { state.domains = []; state.companies = []; state.orderCalls = []; });

  it('selects customers and excludes deleted, inactive, TEST, QA and INTERNAL', async () => {
    state.domains = [
      domain('d1', 'co-customer', 'infitoo.com'),
      domain('d2', 'co-deleted', 'afrost.org'),
      domain('d3', 'co-inactive', 'drishiq.com'),
      domain('d4', 'co-test', 'python.org'),
      domain('d5', 'co-qa', 'wrong.example.com'),
      domain('d6', 'co-internal', 'omnivyra.com'),
      domain('d7', 'co-orphan', 'embrosales.in'),
    ];
    state.companies = [
      { id: 'co-customer', name: 'Infitoo Systems llp', status: 'active', deleted_at: null },
      { id: 'co-deleted', name: 'Afrost', status: 'active', deleted_at: '2026-07-04T00:00:00Z' },
      { id: 'co-inactive', name: 'Drishiq', status: 'inactive', deleted_at: null },
      { id: 'co-test', name: 'Ingestion Activation Test', status: 'active', deleted_at: null },
      { id: 'co-qa', name: 'QA Tenant', status: 'active', deleted_at: null },
      { id: 'co-internal', name: 'Omnivyra', status: 'active', deleted_at: null },
      // co-orphan deliberately absent from companies
    ];

    const out = await listDueAdsSubjects(10);
    expect(out.map((s) => s.destinationDomain)).toEqual(['infitoo.com']);
  });

  it('still caps the cycle at the requested limit', async () => {
    state.domains = ['a.com', 'b.com', 'c.com', 'd.com', 'e.com', 'f.com', 'g.com']
      .map((d, i) => domain(`d${i}`, `co${i}`, d));
    state.companies = state.domains.map((d) => ({ id: d.company_id, name: 'Real Co', status: 'active', deleted_at: null }));

    expect(await listDueAdsSubjects(5)).toHaveLength(5);
  });

  it('does not enqueue the same company|domain pair twice', async () => {
    state.domains = [domain('d1', 'co1', 'infitoo.com'), domain('d1', 'co1', 'infitoo.com')];
    state.companies = [{ id: 'co1', name: 'Real Co', status: 'active', deleted_at: null }];

    expect(await listDueAdsSubjects(5)).toHaveLength(1);
  });

  it('preserves company and domain ownership on every selected subject', async () => {
    state.domains = [domain('dom-42', 'co-7', 'infitoo.com')];
    state.companies = [{ id: 'co-7', name: 'Infitoo Systems llp', status: 'active', deleted_at: null }];

    const [subject] = await listDueAdsSubjects(5);
    expect(subject.companyId).toBe('co-7');
    expect(subject.domainId).toBe('dom-42');
    expect(subject.destinationDomain).toBe('infitoo.com');
  });
});

describe('ordering is deterministic', () => {
  beforeEach(() => { state.domains = []; state.companies = []; state.orderCalls = []; });

  it('breaks identical updated_at ties on a stable key', async () => {
    // The five production customer rows share a byte-identical updated_at, so without a
    // tiebreaker the scan order — and therefore which subjects a capped cycle takes — was not
    // reproducible.
    const same = '2026-07-04T04:36:19.191589Z';
    state.domains = [
      domain('d-c', 'co-c', 'c.com', same),
      domain('d-a', 'co-a', 'a.com', same),
      domain('d-b', 'co-b', 'b.com', same),
    ];
    state.companies = state.domains.map((d) => ({ id: d.company_id, name: 'Real Co', status: 'active', deleted_at: null }));

    const first = (await listDueAdsSubjects(3)).map((s) => s.domainId);
    const second = (await listDueAdsSubjects(3)).map((s) => s.domainId);
    expect(first).toEqual(['d-a', 'd-b', 'd-c']);
    expect(second).toEqual(first);
  });

  it('asks the query layer for a total order, not just updated_at', async () => {
    state.domains = [domain('d1', 'co1', 'infitoo.com')];
    state.companies = [{ id: 'co1', name: 'Real Co', status: 'active', deleted_at: null }];
    await listDueAdsSubjects(1);
    expect(state.orderCalls).toEqual([['updated_at', true], ['id', true]]);
  });

  it('keeps stale-first as the PRIMARY key — the tiebreaker changes nothing else', async () => {
    // Adding `id` must not silently redefine the acquisition priority; `updated_at` still leads.
    // Whether stale-first is the RIGHT priority is an open product question this does not answer.
    state.domains = [
      domain('d-z', 'co-z', 'z.com', '2026-01-01T00:00:00Z'),
      domain('d-a', 'co-a', 'a.com', '2026-09-01T00:00:00Z'),
    ];
    state.companies = state.domains.map((d) => ({ id: d.company_id, name: 'Real Co', status: 'active', deleted_at: null }));
    expect((await listDueAdsSubjects(2)).map((s) => s.domainId)).toEqual(['d-z', 'd-a']);
  });
});
