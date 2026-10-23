/**
 * Unified read service — merge (durable ∪ legacy), dedupe, filter/search/paginate,
 * anti-N+1 (each source read once), tenant isolation, large dataset, export,
 * backward compatibility (durable empty → legacy serves). Custom readers injected
 * so no DB is touched; server deps mocked for safe module load.
 */
// W0-B — `exportLeads` now reads `contact_governance_records` once per export,
// so the double serves the `select → eq → is → in` chain that read uses as well
// as the pre-existing `select → eq → limit`. `governance` is the seed the
// governed-egress cases below manipulate; empty means "no restrictions".
const governance: Array<Record<string, unknown>> = [];
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.is = () => chain;
    chain.in = () => chain;
    chain.limit = async () => ({ data: [], error: null });
    (chain as { then?: unknown }).then = (resolve: (v: unknown) => void) =>
      resolve({ data: table === 'contact_governance_records' ? governance : [], error: null });
    return chain;
  },
}));
jest.mock('../../services/leadIntelligence/leadIntelligenceRepository', () => ({ listCanonicalLeads: jest.fn(async () => []) }));

import { searchLeads, exportLeads, type LeadSourceReaders } from '../../services/leadIntelligence/leadIntelligenceReadService';
import type { CanonicalLeadView } from '../../../lib/leadIntelligence';

const durableView = (id: string): CanonicalLeadView => ({
  organizationId: 'co1', source: 'website', sourceLabel: 'Website', unifiedPersonId: `up_${id}`,
  identity: { email: `${id}@b.com` }, scores: { intent: 0.9 }, status: 'new', campaign: 'q3', content: null, referrer: null,
  utm: { source: null, medium: null, campaign: null, content: null, term: null }, occurredAt: '2026-03-01T00:00:00Z',
  sourceRef: { table: 'lead_intelligence', id }, attribution: { originalSource: null, originalChannel: null, campaign: 'q3', content: null, session: null, journey: null, referrer: null, utm: { source: null, medium: null, campaign: null, content: null, term: null }, identity: {}, sourceMetadata: {} },
});

function readers(over: Partial<LeadSourceReaders> = {}): { r: LeadSourceReaders; calls: Record<string, number> } {
  const calls = { durable: 0, activeLeads: 0, leads: 0, canonicalLeads: 0 };
  const r: LeadSourceReaders = {
    durable: async (c) => { calls.durable += 1; return over.durable ? over.durable(c) : []; },
    activeLeads: async (c) => { calls.activeLeads += 1; return over.activeLeads ? over.activeLeads(c) : []; },
    leads: async (c) => { calls.leads += 1; return over.leads ? over.leads(c) : []; },
    canonicalLeads: async (c) => { calls.canonicalLeads += 1; return over.canonicalLeads ? over.canonicalLeads(c) : []; },
  };
  return { r, calls };
}

describe('Lead Intelligence read service', () => {
  it('merges durable ∪ legacy into one unified result', async () => {
    const { r } = readers({
      durable: async () => [durableView('d1')],
      activeLeads: async () => [{ id: 'o1', organization_id: 'co1', opportunity_type: 'buying_intent', contact_id: 'c1', total_score: 0.5, status: 'new' }],
      leads: async () => [{ id: 'l1', company_id: 'co1', email: 'x@b.com', source: 'form_embed' }],
      canonicalLeads: async () => [{ id: 'cl1', company_id: 'co1', email: 'y@b.com', source: 'hubspot', unified_source: { category: 'crm' } }],
    });
    const res = await searchLeads({ companyId: 'co1' }, r);
    expect(res.total).toBe(4);
    expect(res.rows.map((v) => v.source).sort()).toEqual(['community', 'crm', 'website', 'website']);
  });

  it('anti-N+1: each source is read exactly once per query', async () => {
    const { r, calls } = readers({ leads: async () => Array.from({ length: 100 }, (_, i) => ({ id: `l${i}`, company_id: 'co1', email: `${i}@b.com`, source: 'form_embed' })) });
    await searchLeads({ companyId: 'co1' }, r);
    expect(calls).toEqual({ durable: 1, activeLeads: 1, leads: 1, canonicalLeads: 1 });
  });

  it('dedupes durable vs legacy (durable wins)', async () => {
    const { r } = readers({
      durable: async () => [{ ...durableView('1'), sourceRef: { table: 'leads', id: '1' }, status: 'durable' }],
      leads: async () => [{ id: '1', company_id: 'co1', email: 'a@b.com', source: 'form_embed' }],
    });
    const res = await searchLeads({ companyId: 'co1' }, r);
    expect(res.total).toBe(1);
    expect(res.rows[0].status).toBe('durable');
  });

  it('applies filters + pagination through the service', async () => {
    const { r } = readers({ leads: async () => Array.from({ length: 10 }, (_, i) => ({ id: `l${i}`, company_id: 'co1', email: `${i}@b.com`, source: 'form_embed' })) });
    const page = await searchLeads({ companyId: 'co1', page: { limit: 3, offset: 0 } }, r);
    expect(page.rows).toHaveLength(3);
    expect(page.total).toBe(10);
  });

  it('tenant isolation (no leakage) + missing company short-circuits', async () => {
    const { r } = readers({ leads: async () => [{ id: 'l1', company_id: 'co2', email: 'x@b.com', source: 'form_embed' }] });
    expect((await searchLeads({ companyId: 'co1' }, r)).total).toBe(0);
    expect((await searchLeads({ companyId: '' }, r)).total).toBe(0);
  });

  it('backward compatible: durable empty → legacy serves the data', async () => {
    const { r } = readers({ durable: async () => [], leads: async () => [{ id: 'l1', company_id: 'co1', email: 'x@b.com', source: 'form_embed' }] });
    expect((await searchLeads({ companyId: 'co1' }, r)).total).toBe(1);
  });

  it('handles a large dataset within the service cap', async () => {
    const { r } = readers({ leads: async () => Array.from({ length: 3000 }, (_, i) => ({ id: `l${i}`, company_id: 'co1', email: `${i}@b.com`, source: 'form_embed' })) });
    const res = await searchLeads({ companyId: 'co1', page: { limit: 500, offset: 0 } }, r);
    expect(res.total).toBe(3000);
    expect(res.rows).toHaveLength(500);
  });

  it('exports CSV + Excel over the unified set', async () => {
    const { r } = readers({ leads: async () => [{ id: 'l1', company_id: 'co1', email: 'a@b.com', source: 'form_embed' }] });
    const csv = await exportLeads({ companyId: 'co1' }, 'csv', r);
    expect(csv.contentType).toContain('text/csv');
    expect(csv.body).toContain('identity,company,source');
    expect(csv.body).toContain('a@b.com');
    const xls = await exportLeads({ companyId: 'co1' }, 'excel', r);
    expect(xls.contentType).toContain('ms-excel');
    expect(xls.body).toContain('Excel.Sheet');
  });
});

// ── W0-B. Governed egress at the service level ─────────────────────────────
describe('W0-B — exportLeads applies contact governance before emitting', () => {
  const emailLead = { id: 'l1', company_id: 'co1', email: 'a@b.com', source: 'form_embed' };
  const rs = () => readers({ leads: async () => [emailLead] }).r;

  const suppress = (over: Record<string, unknown> = {}) => {
    governance.push({
      id: 'g1', organization_id: 'co1', person_id: null, target_normalized: 'a@b.com',
      channel: 'email', governance_type: 'unsubscribe',
      effective_from: '2020-01-01T00:00:00.000Z', effective_until: null, revoked_at: null, ...over,
    });
  };

  beforeEach(() => { governance.length = 0; });

  it('1. a permitted endpoint is exported', async () => {
    const csv = await exportLeads({ companyId: 'co1' }, 'csv', rs());
    expect(csv.body).toContain('a@b.com');
  });

  it('2. a SUPPRESSED endpoint is redacted', async () => {
    suppress();
    const csv = await exportLeads({ companyId: 'co1' }, 'csv', rs());
    expect(csv.body).not.toContain('a@b.com');
    expect(csv.body).toContain('withheld');
  });

  it('4. the recommended action is withheld when governance forbids contact', async () => {
    suppress();
    const csv = await exportLeads({ companyId: 'co1' }, 'csv', rs());
    // Exporting "call them" for a person who unsubscribed is the same breach as
    // exporting the number.
    const lines = csv.body.split(String.fromCharCode(10));
    expect(lines[1] ?? '').toContain('withheld');
  });

  it('5. the XLSX path cannot bypass the same enforcement', async () => {
    suppress();
    const xls = await exportLeads({ companyId: 'co1' }, 'excel', rs());
    expect(xls.body).not.toContain('a@b.com');
    expect(xls.body).toContain('withheld');
  });

  it("6. another tenant's restriction does not redact this tenant, and vice versa", async () => {
    suppress({ id: 'g-other', organization_id: 'co-other' });
    const csv = await exportLeads({ companyId: 'co1' }, 'csv', rs());
    // The defence-in-depth filter drops the foreign row, so co1 is unaffected.
    expect(csv.body).toContain('a@b.com');
  });

  it('a `*`-channel restriction redacts the endpoint too', async () => {
    suppress({ channel: '*', governance_type: 'dnc_permanent' });
    const csv = await exportLeads({ companyId: 'co1' }, 'csv', rs());
    expect(csv.body).not.toContain('a@b.com');
  });

  it('3. a lead with NO anchorable identity is redacted', async () => {
    const anon = readers({ leads: async () => [{ id: 'l9', company_id: 'co1', source: 'form_embed' }] }).r;
    const csv = await exportLeads({ companyId: 'co1' }, 'csv', anon);
    // No email, no phone: nothing a restriction could have matched, so the
    // actionable recommendation is withheld rather than assumed permitted.
    expect(csv.body).toContain('withheld');
  });

  // ── R1 (Phase 4C-4D) — the comparison boundary is normalised ─────────────
  //
  // 4C-4A/M2: this seam compared the view's RAW endpoint against
  // `record.target_normalized`, which the canonical writer had normalised. The
  // two agreed only because `resolveUnifiedPerson` normalises before writing the
  // person spine — an upstream coincidence, not a guarantee, since
  // `unified_persons` carries no normalisation constraint and none at all on
  // `primary_phone`. These drive the REAL export path, with the real normaliser
  // and the real evaluator.
  it('R1: a differently CASED email in the view cannot bypass an email restriction', async () => {
    suppress();                                           // stored as 'a@b.com'
    const cased = readers({ leads: async () => [{ ...emailLead, email: 'A@B.com' }] }).r;

    const csv = await exportLeads({ companyId: 'co1' }, 'csv', cased);

    expect(csv.body).not.toContain('A@B.com');
    expect(csv.body).toContain('withheld');
  });

  it('R1: an equivalently formatted PHONE cannot bypass a phone restriction', async () => {
    suppress({ id: 'g-phone', channel: 'phone', target_normalized: '+15550100000', governance_type: 'dnc_channel' });
    const phoneLead = readers({
      leads: async () => [{ id: 'l2', company_id: 'co1', phone: '+1 (555) 010-0000', source: 'form_embed' }],
    }).r;

    const csv = await exportLeads({ companyId: 'co1' }, 'csv', phoneLead);

    expect(csv.body).not.toContain('555');
    expect(csv.body).toContain('withheld');
  });

  it('R1: the phone rule is NOT applied to the email channel', async () => {
    // A phone-channel restriction must not redact an email, and the email rule
    // must not strip digits out of an address.
    suppress({ id: 'g-phone', channel: 'phone', target_normalized: '+15550100000' });
    const digits = readers({ leads: async () => [{ ...emailLead, email: 'a1555@b.com' }] }).r;

    const csv = await exportLeads({ companyId: 'co1' }, 'csv', digits);

    expect(csv.body).toContain('a1555@b.com');            // permitted, unchanged
  });

  it('R1: a PERSON-anchored restriction still redacts, whatever the endpoint spelling', async () => {
    // A legacy `leads` row carries no `unifiedPersonId`, so the DURABLE reader is
    // used here — it is the source that actually supplies a person anchor.
    suppress({ id: 'g-person', person_id: 'up_l1', target_normalized: null, channel: '*', governance_type: 'dnc_permanent' });
    const withPerson = readers({
      durable: async () => [{ ...durableView('l1'), identity: { email: 'A@B.com' } }],
    }).r;

    const csv = await exportLeads({ companyId: 'co1' }, 'csv', withPerson);

    expect(csv.body).not.toContain('A@B.com');
    expect(csv.body).toContain('withheld');
  });

  it('R1: an unrelated permitted endpoint is still exported unchanged', async () => {
    suppress();                                           // restricts a@b.com only
    const other = readers({ leads: async () => [{ ...emailLead, id: 'l3', email: 'someone.else@b.com' }] }).r;

    const csv = await exportLeads({ companyId: 'co1' }, 'csv', other);
    expect(csv.body).toContain('someone.else@b.com');
    expect(csv.body).not.toContain('withheld: contact governance');
  });

  it('R1: a cross-tenant restriction still cannot influence this tenant after normalisation', async () => {
    suppress({ id: 'g-other', organization_id: 'co-other', target_normalized: 'a@b.com' });
    const cased = readers({ leads: async () => [{ ...emailLead, email: 'A@B.com' }] }).r;

    const csv = await exportLeads({ companyId: 'co1' }, 'csv', cased);
    expect(csv.body).toContain('A@B.com');
  });
});
