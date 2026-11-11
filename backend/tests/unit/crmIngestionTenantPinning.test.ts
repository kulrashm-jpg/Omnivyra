/**
 * Legacy CRM importer: an imported record can never choose the tenant whose
 * lead intelligence receives it (closed 2026-11-11, while the CRM source is
 * still fenced, so it cannot reopen when the fence lifts).
 *
 * The lead-intelligence adapter reads `organization_id ?? company_id`, and the
 * importer used to spread the record AFTER `company_id`. The input that would
 * have crossed tenants: a rows-array record carrying
 * { organization_id: OTHER } (or company_id: OTHER).
 */
import { crmAdoptionRow, loadRows } from '../../services/crmIngestionService';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const OTHER = '00000000-0000-4000-8000-0000000000bb';
const fixed = { id: 'lead-1', companyId: ORG, source: 'crm', unifiedSource: null, qualificationScore: 10, unifiedPersonId: 'p1' };

describe('crmAdoptionRow pins the tenant to the importing company', () => {
  it('a record naming ANOTHER tenant in organization_id / company_id / camelCase keys cannot choose it', () => {
    const hostile = { email: 'a@b.co', organization_id: OTHER, company_id: OTHER, organizationId: OTHER, companyId: OTHER } as never;
    const out = crmAdoptionRow(hostile, fixed);
    expect(out.company_id).toBe(ORG);
    expect(out).not.toHaveProperty('organization_id');
    expect(out).not.toHaveProperty('organizationId');
    expect(out).not.toHaveProperty('companyId');
    // What the adapter would read (`organization_id ?? company_id`) is this tenant.
    expect(String(out.organization_id ?? out.company_id)).toBe(ORG);
  });

  it('NEGATIVE CONTROL: the record\'s ordinary fields still pass through', () => {
    const out = crmAdoptionRow({ email: 'a@b.co', name: 'Asha', status: 'open' } as never, fixed);
    expect(out).toMatchObject({ id: 'lead-1', company_id: ORG, email: 'a@b.co', name: 'Asha', status: 'open', unified_person_id: 'p1' });
  });
});

describe('loadRows normalises a caller-supplied rows array like the CSV path', () => {
  it('extra keys (a tenant id among them) do not survive normalisation', async () => {
    const rows = await loadRows({ companyId: ORG, rows: [{ email: 'a@b.co', organization_id: OTHER, company_id: OTHER } as never] });
    expect(rows[0]).not.toHaveProperty('organization_id');
    expect(rows[0]).not.toHaveProperty('company_id');
    expect(rows[0].email).toBe('a@b.co');
  });

  it('camelCase records map exactly as before (externalId, createdAt, campaignId, currencyCode)', async () => {
    const [r] = await loadRows({ companyId: ORG, rows: [{ externalId: 'x1', createdAt: '2026-11-01', campaignId: 'c1', currencyCode: 'EUR', name: 'N' }] });
    expect(r).toMatchObject({ externalId: 'x1', createdAt: '2026-11-01', campaignId: 'c1', currencyCode: 'EUR', name: 'N' });
  });
});
