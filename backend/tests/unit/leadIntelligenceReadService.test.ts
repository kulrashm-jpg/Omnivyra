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
/**
 * P0 — the database's own read instant, as PostgREST serves it on every row of
 * one response (the `read_at` computed field over `transaction_timestamp()`).
 * PostgreSQL's rendering, not JS's: `T` separated, explicit `+00:00`, never `Z`.
 *
 * The export no longer takes a clock of its own, so this value IS the instant
 * every governance verdict below is judged at. A row served without it is
 * INDETERMINATE rather than permissive, and redacts.
 */
const DB_READ_AT = '2026-06-01T00:00:00.000000+00:00';
/** Set to drive the fail-closed path: an unreadable store must redact. */
let governanceError: { message: string } | null = null;
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.is = () => chain;
    chain.in = () => chain;
    chain.limit = async () => ({ data: [], error: null });
    (chain as { then?: unknown }).then = (resolve: (v: unknown) => void) =>
      resolve(
        table === 'contact_governance_records' && governanceError !== null
          ? { data: null, error: governanceError }
          : {
            data: table === 'contact_governance_records'
              ? governance.map((r) => ({ read_at: DB_READ_AT, ...r }))
              : [],
            error: null,
          },
      );
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
  const calls = { durable: 0, leads: 0, canonicalLeads: 0 };
  const r: LeadSourceReaders = {
    durable: async (c) => { calls.durable += 1; return over.durable ? over.durable(c) : []; },
    leads: async (c) => { calls.leads += 1; return over.leads ? over.leads(c) : []; },
    canonicalLeads: async (c) => { calls.canonicalLeads += 1; return over.canonicalLeads ? over.canonicalLeads(c) : []; },
  };
  return { r, calls };
}

describe('Lead Intelligence read service', () => {
  it('merges durable ∪ legacy into one unified result', async () => {
    const { r } = readers({
      durable: async () => [durableView('d1')],
      leads: async () => [{ id: 'l1', company_id: 'co1', email: 'x@b.com', source: 'form_embed' }],
      // A canonical prospect whose persisted source is `community` (the legacy
      // `active_leads` reader that used to supply community rows is removed).
      canonicalLeads: async () => [
        { id: 'cl1', company_id: 'co1', email: 'y@b.com', source: 'hubspot', unified_source: { category: 'crm' } },
        { id: 'cl2', company_id: 'co1', contact_id: 'c1', source: 'community', qualification_score: 50 },
      ],
    });
    const res = await searchLeads({ companyId: 'co1' }, r);
    expect(res.total).toBe(4);
    expect(res.rows.map((v) => v.source).sort()).toEqual(['community', 'crm', 'website', 'website']);
  });

  it('anti-N+1: each source is read exactly once per query', async () => {
    const { r, calls } = readers({ leads: async () => Array.from({ length: 100 }, (_, i) => ({ id: `l${i}`, company_id: 'co1', email: `${i}@b.com`, source: 'form_embed' })) });
    await searchLeads({ companyId: 'co1' }, r);
    expect(calls).toEqual({ durable: 1, leads: 1, canonicalLeads: 1 });
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


// ════════════════════════════════════════════════════════════════════════════
// P0 — the export judges governance at the DATABASE instant, never at a clock
//
// `exportLeads` used to take `new Date().toISOString()` once per export and
// compare every database-stamped `effective_from` / `effective_until` against
// it. These drive the real export path and pin WHICH clock decided, in both
// directions, by putting the database instant and the host clock on OPPOSITE
// sides of a restriction's window.
//
// `DB_READ_AT` is 2026-06-01. The host clock, whenever this suite runs, is
// later. So a window that CLOSES between them is in force at the database
// instant and lapsed at the host clock, and a window that OPENS between them is
// the reverse. One assertion each way, and neither can pass by accident.
// ════════════════════════════════════════════════════════════════════════════
describe('P0 — exportLeads judges each governance read at its own database instant', () => {
  const emailLead = { id: 'p0-l1', company_id: 'co1', email: 'p0@b.com', source: 'form_embed' };
  const rs = () => readers({ leads: async () => [emailLead] }).r;
  const restrict = (over: Record<string, unknown> = {}) => {
    governance.push({
      id: 'p0-g1', organization_id: 'co1', person_id: null, target_normalized: 'p0@b.com',
      channel: 'email', governance_type: 'unsubscribe',
      effective_from: '2020-01-01T00:00:00.000Z', effective_until: null, revoked_at: null, ...over,
    });
  };
  const exported = async (r = rs()): Promise<boolean> =>
    (await exportLeads({ companyId: 'co1' }, 'csv', r)).body.includes('p0@b.com');

  beforeEach(() => { governance.length = 0; governanceError = null; });

  it('a restriction in force at the DATABASE instant redacts, although it is lapsed at the host clock', async () => {
    // 2026-05-31 → 2026-06-02 brackets DB_READ_AT (2026-06-01) and closed long
    // before this suite runs. Judged at the host clock it is LAPSED and the
    // address is exported; judged at the database instant it is IN FORCE.
    restrict({
      effective_from: '2026-05-31T00:00:00+00:00',
      effective_until: '2026-06-02T00:00:00+00:00',
    });
    expect(await exported()).toBe(false);
  });

  it('a restriction not yet started at the DATABASE instant does NOT redact, although it is in force at the host clock', async () => {
    // The other direction, so the test above cannot pass just because something
    // redacts everything. 2026-07-01 is after DB_READ_AT and before any run of
    // this suite: not yet started on the database clock, in force on the host's.
    restrict({ effective_from: '2026-07-01T00:00:00+00:00' });
    expect(await exported()).toBe(true);
  });

  it('no caller instant is reachable: the module holds no clock and cannot call the authority directly', async () => {
    // There is no parameter through which a caller could supply an instant, so a
    // restriction in force at the database instant cannot be dodged by any value
    // a caller chooses — there is nowhere to put one.
    //
    // COMMENTS ARE STRIPPED FIRST. The explanation beside the change quotes the
    // removed `new Date().toISOString()` call, and an unstripped search finds
    // the prose rather than the code. `contactGovernance.ts` carries a note
    // about the same trap for the same reason.
    const raw = require('fs').readFileSync(
      require('path').join(__dirname, '../../services/leadIntelligence/leadIntelligenceReadService.ts'),
      'utf8',
    ) as string;
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    expect(code).toContain('evaluateGovernanceReads');
    // No clock of any kind, anywhere in the module's executable code.
    expect(code).not.toContain('new Date(');
    expect(code).not.toContain('Date.now(');
    // The authority is reached only through the seam that supplies the instant.
    expect(code).not.toContain('mayContact(');
    expect(code).not.toContain('import { mayContact }');
  });

  it('an unrelated producer with no applicable restriction is exported unchanged', async () => {
    restrict();                                     // restricts p0@b.com only
    const other = readers({
      leads: async () => [{ ...emailLead, id: 'p0-l2', email: 'unrelated@b.com' }],
    }).r;
    const body = (await exportLeads({ companyId: 'co1' }, 'csv', other)).body;
    expect(body).toContain('unrelated@b.com');
    expect(body).not.toContain('withheld: contact governance');
  });

  it('rows that arrive with NO read instant redact — indeterminate is not permissive', async () => {
    restrict({ read_at: undefined });
    expect(await exported()).toBe(false);
  });

  it('rows whose read instants DISAGREE redact — one response cannot have two transaction times', async () => {
    restrict({ id: 'p0-a', read_at: '2026-06-01T00:00:00.000000+00:00' });
    restrict({ id: 'p0-b', read_at: '2026-06-01T00:00:02.000000+00:00', target_normalized: 'other@b.com' });
    expect(await exported()).toBe(false);
  });

  it('a FAILED read redacts', async () => {
    governanceError = { message: 'connection reset' };
    expect(await exported()).toBe(false);
  });

  it('an EMPTY successful read stays neutral — nothing is governed, so nothing is withheld', async () => {
    expect(await exported()).toBe(true);
  });

  it('the PROVENANCE-URL decision uses the database instant too, not a second clock', async () => {
    // The export asks governance twice per row: once per endpoint, and once on a
    // probe channel that only a `*` record can match, which gates the evidence
    // URL. Both must move together. A `*` record in force only at the database
    // instant must withhold the actionable recommendation as well.
    restrict({
      person_id: 'up_p0', target_normalized: null, channel: '*', governance_type: 'dnc_permanent',
      effective_from: '2026-05-31T00:00:00+00:00',
      effective_until: '2026-06-02T00:00:00+00:00',
    });
    const withPerson = readers({
      durable: async () => [{ ...durableView('p0'), identity: { email: 'p0@b.com' } }],
    }).r;
    const body = (await exportLeads({ companyId: 'co1' }, 'csv', withPerson)).body;
    expect(body).not.toContain('p0@b.com');
    expect(body).toContain('withheld');
  });
});
