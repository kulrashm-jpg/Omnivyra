/**
 * 05 follow-up (050): the canonical-domain CHECK violation is reported INSIDE the governed writer, so every caller of
 * createCompanyIdentity / updateCompanyIdentity - including a future one - inherits it structurally. The writer's
 * DEFAULT insert/update also keep the PostgREST code + details now (they used to throw a bare Error(message), so the
 * reporter could never have fired for a caller on the defaults).
 */
const errorLog = jest.fn();
jest.mock('../../services/logger', () => ({ logger: { error: (...a: unknown[]) => errorLog(...a), warn: jest.fn(), info: jest.fn() } }));
const dbResult: { error: unknown } = { error: null };
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: () => {
      const q: any = {};
      q.insert = () => q; q.select = () => q; q.update = () => q;
      q.single = async () => ({ data: dbResult.error ? null : { id: 'co_1' }, error: dbResult.error });
      q.eq = async () => ({ error: dbResult.error });
      return q;
    },
  },
}));

import { createCompanyIdentity, updateCompanyIdentity } from '../../services/companyIdentityWriter';

const CHECK_VIOLATION = { code: '23514', message: 'new row for relation "companies" violates check constraint "companies_website_domain_canonical"' };
const rec = () => ({ id: 'co_1', name: 'X', website: 'https://x.example', websiteDomain: 'x.example', adminEmailDomain: 'x.example' });

beforeEach(() => { errorLog.mockReset(); dbResult.error = null; });

it('createCompanyIdentity reports a canonical-domain CHECK violation itself, naming the caller-supplied writer', async () => {
  const err = Object.assign(new Error(CHECK_VIOLATION.message), { code: '23514' });
  await expect(createCompanyIdentity(rec(), { insertCompany: async () => { throw err; }, writer: 'some/future-caller' })).rejects.toBe(err);
  expect(errorLog).toHaveBeenCalledWith('company_domain_not_canonical_write',
    expect.objectContaining({ writer: 'some/future-caller', constraint: 'companies_website_domain_canonical' }));
});

it('the DEFAULT insert keeps code + details, so the report fires for a caller that passes no deps', async () => {
  dbResult.error = CHECK_VIOLATION;
  await expect(createCompanyIdentity(rec())).rejects.toMatchObject({ code: '23514' });
  expect(errorLog).toHaveBeenCalledWith('company_domain_not_canonical_write', expect.objectContaining({ writer: 'companyIdentityWriter' }));
});

it('updateCompanyIdentity (default update) reports too', async () => {
  dbResult.error = CHECK_VIOLATION;
  await expect(updateCompanyIdentity('co_1', { website: 'https://x.example', websiteDomain: 'x.example', adminEmailDomain: 'x.example' }))
    .rejects.toMatchObject({ code: '23514' });
  expect(errorLog).toHaveBeenCalledWith('company_domain_not_canonical_write', expect.anything());
});

it('control: any other error propagates WITHOUT the canonical-domain log', async () => {
  const err = Object.assign(new Error('duplicate key'), { code: '23505' });
  await expect(createCompanyIdentity(rec(), { insertCompany: async () => { throw err; } })).rejects.toBe(err);
  expect(errorLog).not.toHaveBeenCalledWith('company_domain_not_canonical_write', expect.anything());
});
