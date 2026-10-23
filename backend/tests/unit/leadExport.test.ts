import { EXPORT_WITHHELD, DISCLOSE_NOTHING, toExportRow, toCsv, toExcelXml, type CanonicalLeadView } from '../../../lib/leadIntelligence';

/** W0-B test convenience: the fully-permitted disclosure. */
const DISCLOSE_ALL = { email: true, phone: true, action: true } as const;

const view = (over: Partial<CanonicalLeadView> = {}): CanonicalLeadView => ({
  organizationId: 'co1', source: 'crm', sourceLabel: 'CRM', unifiedPersonId: 'up1',
  identity: { email: 'a@b.com' }, scores: { intent: 0.8, total: 0.8 }, status: 'qualified', campaign: 'q3', content: 'pricing',
  referrer: null, utm: { source: null, medium: null, campaign: null, content: null, term: null }, occurredAt: '2026-01-01T00:00:00Z',
  sourceRef: { table: 'canonical_leads', id: '3' },
  attribution: { originalSource: 'hubspot', originalChannel: 'crm', campaign: 'q3', content: 'pricing', session: null, journey: null, referrer: null, utm: { source: null, medium: null, campaign: null, content: null, term: null }, identity: {}, sourceMetadata: { company_name: 'Acme', deal_value: 9000 } },
  ...over,
});

describe('Lead export', () => {
  it('builds a unified export row with all required columns', () => {
    // W0-B — the disclosure argument is explicit because its DEFAULT is deny.
    // This case tests the column surface for a PERMITTED contact; the redaction
    // behaviour has its own cases below.
    const row = toExportRow(view(), undefined, DISCLOSE_ALL);
    expect(row.identity).toBe('a@b.com');
    expect(row.company).toBe('Acme');
    expect(row.source).toBe('CRM');
    expect(row.campaign).toBe('q3');
    expect(row.buying_intent).toBe('80%');
    expect(row.recommended_next_action).toContain('sales');
    expect(row.ai_summary).toContain('CRM');
    expect(row.status).toBe('qualified');
    expect(JSON.parse(row.metadata).deal_value).toBe(9000);
  });

  it('CSV has a header + escapes commas/quotes', () => {
    const csv = toCsv([toExportRow(view({ attribution: { ...view().attribution, sourceMetadata: { company_name: 'Acme, Inc "HQ"' } } }))]);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('identity,company,source');
    expect(lines[1]).toContain('"Acme, Inc ""HQ"""');
  });

  it('Excel XML is a SpreadsheetML workbook with rows', () => {
    // Permitted disclosure: this case tests the SERIALIZER, and uses the email
    // only as a sample cell value.
    const xml = toExcelXml([toExportRow(view(), undefined, DISCLOSE_ALL)]);
    expect(xml).toContain('<?mso-application progid="Excel.Sheet"?>');
    expect(xml).toContain('Worksheet ss:Name="Leads"');
    expect(xml).toContain('a@b.com');
  });
});

// ── W0-B. Governed egress at the row level ─────────────────────────────────
describe('W0-B — an export row discloses only what governance permits', () => {
  it('withholds the endpoint when neither channel is permitted', () => {
    const row = toExportRow(view(), undefined, { email: false, phone: false, action: false });
    expect(row.identity).toBe(EXPORT_WITHHELD);
  });

  it('withholds the recommended action when no channel permits contact', () => {
    const row = toExportRow(view(), undefined, { email: false, phone: false, action: false });
    expect(row.recommended_next_action).toBe(EXPORT_WITHHELD);
  });

  it('DEFAULTS to withholding when the caller passes no disclosure at all', () => {
    // The whole point of the default: a caller that forgets governance leaks
    // nothing. Before W0-B this returned the live email and a next action.
    const row = toExportRow(view());
    expect(row.identity).toBe(EXPORT_WITHHELD);
    expect(row.recommended_next_action).toBe(EXPORT_WITHHELD);
    expect(DISCLOSE_NOTHING).toEqual({ email: false, phone: false, action: false });
  });

  it('keeps the non-contact business fields, but NOT the raw payload', () => {
    const row = toExportRow(view(), undefined, DISCLOSE_NOTHING);
    // Genuinely non-contact, so still exportable.
    expect(row.company).toBe('Acme');
    expect(row.source).toBe('CRM');
    expect(row.campaign).toBe('q3');
    expect(row.buying_intent).toBe('80%');
    expect(row.status).toBe('qualified');
    // `metadata` is the RAW source payload and `ai_summary` is generated from
    // the view: both were found to carry the endpoint verbatim, so neither is
    // a safe "non-contact" field once the endpoint is withheld.
    expect(row.metadata).toBe(EXPORT_WITHHELD);
    expect(row.ai_summary).toBe(EXPORT_WITHHELD);
  });

  it('a lead with NO endpoint keeps its summary and payload — nothing to leak', () => {
    const anon = { ...view(), identity: {} } as ReturnType<typeof view>;
    const row = toExportRow(anon, undefined, DISCLOSE_NOTHING);
    expect(row.ai_summary).not.toBe(EXPORT_WITHHELD);
    expect(JSON.parse(row.metadata).deal_value).toBe(9000);
  });

  it('a permitted email is disclosed; a permitted phone is used when email is not', () => {
    expect(toExportRow(view(), undefined, { email: true, phone: false, action: true }).identity).toBe('a@b.com');
    const phoneOnly = { ...view(), identity: { phone: '+15550100' } } as ReturnType<typeof view>;
    expect(toExportRow(phoneOnly, undefined, { email: false, phone: true, action: true }).identity).toBe('+15550100');
    // ...and a withheld email does NOT fall through to the phone.
    const both = { ...view(), identity: { email: 'a@b.com', phone: '+15550100' } } as ReturnType<typeof view>;
    expect(toExportRow(both, undefined, { email: false, phone: false, action: false }).identity).toBe(EXPORT_WITHHELD);
  });
});
