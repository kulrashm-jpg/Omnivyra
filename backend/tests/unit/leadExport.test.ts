import { toExportRow, toCsv, toExcelXml, type CanonicalLeadView } from '../../../lib/leadIntelligence';

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
    const row = toExportRow(view());
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
    const xml = toExcelXml([toExportRow(view())]);
    expect(xml).toContain('<?mso-application progid="Excel.Sheet"?>');
    expect(xml).toContain('Worksheet ss:Name="Leads"');
    expect(xml).toContain('a@b.com');
  });
});
