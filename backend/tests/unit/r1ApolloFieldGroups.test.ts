/**
 * R1: tenant-chosen Apollo field groups, and preview-before-run.
 */
type Res = { data?: unknown; error?: unknown; status?: number };
let flagRead: Res = { data: [], error: null, status: 200 };
const upserts: unknown[] = [];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq']) chain[m] = () => chain;
    chain.limit = async () => flagRead;
    return chain;
  },
}));
jest.mock('../../services/featureFlagService', () => ({
  upsertFeatureFlag: async (input: unknown) => { upserts.push(input); return {}; },
}));

import {
  APOLLO_FIELD_GROUPS,
  CONTACT_DATA_LAWFUL_BASIS_RECORDED,
  DEFAULT_APOLLO_FIELD_GROUPS,
  allowedAttributesFor,
  readTenantFieldGroups,
  validateFieldGroups,
  writeTenantFieldGroups,
} from '../../services/enrichment/apolloFieldGroups';
import { selectBatchFields } from '../../apiHandlers/prospects/prospectIntelligenceRead';

const ORG = '00000000-0000-4000-8000-0000000000aa';
beforeEach(() => { flagRead = { data: [], error: null, status: 200 }; upserts.length = 0; });

describe('the groups', () => {
  it('contact data is a group, default OFF, and REFUSES until the owner records a lawful basis (L1); phone is deferred', () => {
    expect(CONTACT_DATA_LAWFUL_BASIS_RECORDED).toBe(false);
    const email = APOLLO_FIELD_GROUPS.find((g) => g.id === 'contact_email')!;
    const phone = APOLLO_FIELD_GROUPS.find((g) => g.id === 'contact_phone')!;
    expect(email.contact && phone.contact).toBe(true);
    expect(email.availability.available).toBe(false);
    expect(phone.availability.available).toBe(false);
    expect(DEFAULT_APOLLO_FIELD_GROUPS).toEqual(['job_role', 'company_firmographics']);
  });

  it('validation refuses unknown and unavailable groups, never drops them silently', () => {
    expect(() => validateFieldGroups(['job_role', 'contact_email'])).toThrow(/group_unavailable/);
    expect(() => validateFieldGroups(['job_role', 'everything'])).toThrow(/unknown_group/);
    expect(() => validateFieldGroups([])).toThrow(/empty_selection/);
    expect(validateFieldGroups(['technologies', 'job_role', 'job_role'])).toEqual(['technologies', 'job_role']);
  });

  it('a group only NARROWS: attributes are intersected with what the adapter claims', () => {
    expect(allowedAttributesFor(['job_role', 'company_firmographics', 'technologies']))
      .toEqual({ person: [], account: ['employee_count'] }); // today's claims: employee_count only
    expect(allowedAttributesFor(['job_role', 'technologies'], ['job_title', 'seniority', 'technologies', 'employee_count']))
      .toEqual({ person: ['job_title', 'seniority'], account: ['technologies'] });
    expect(allowedAttributesFor(['company_firmographics'], ['employee_count', 'job_title']))
      .toEqual({ person: [], account: ['employee_count'] });
  });
});

describe('the tenant setting', () => {
  it('no setting means the owner default', async () => {
    expect(await readTenantFieldGroups(ORG)).toEqual(['job_role', 'company_firmographics']);
  });

  it('a stored selection is honoured; a stored group that is no longer available is dropped at read', async () => {
    flagRead = { data: [{ enabled: true, metadata: { groups: ['technologies', 'contact_email', 'bogus'] } }], error: null, status: 200 };
    expect(await readTenantFieldGroups(ORG)).toEqual(['technologies']);
  });

  it('an UNREADABLE setting throws (a guessed selection could fetch data the tenant turned off)', async () => {
    flagRead = { data: null, error: null, status: 204 };
    await expect(readTenantFieldGroups(ORG)).rejects.toThrow('could not be read');
    flagRead = { data: null, error: { message: 'x' }, status: 500 };
    await expect(readTenantFieldGroups(ORG)).rejects.toThrow('could not be read');
  });

  it('writing validates first and stores via the existing feature-flag policy store', async () => {
    await expect(writeTenantFieldGroups(ORG, ['contact_email'], 'u1')).rejects.toThrow(/group_unavailable/);
    expect(upserts).toEqual([]);
    await writeTenantFieldGroups(ORG, ['technologies'], 'u1');
    expect(upserts).toEqual([expect.objectContaining({
      organizationId: ORG, flagKey: 'apollo_field_groups', enabled: true, metadata: { groups: ['technologies'] }, createdBy: 'u1',
    })]);
  });
});

describe('selectBatchFields: the one selection shared by preview and run', () => {
  const f = (attribute: string, subject: 'person' | 'account', over: Record<string, unknown> = {}) =>
    ({ attribute, subject, action: 'enrich', source: 'apollo', ...over }) as never;
  const plan = { fields: [
    f('employee_count', 'account'), f('industry', 'account'), f('job_title', 'person'),
    f('founded_year', 'account', { action: 'skip' }), f('city', 'person', { source: 'clearbit' }),
  ] };

  it('no narrowing: every planned enrich field from the source', () => {
    expect(selectBatchFields(plan, 'account', 'apollo').map((x: any) => x.attribute)).toEqual(['employee_count', 'industry']);
  });

  it('narrowed by allowedAttributes; it never adds a field the planner did not mark enrich', () => {
    expect(selectBatchFields(plan, 'account', 'apollo', { account: ['industry', 'founded_year'] }).map((x: any) => x.attribute)).toEqual(['industry']);
    expect(selectBatchFields(plan, 'person', 'apollo', { account: ['industry'] })).toEqual([]);
  });
});
