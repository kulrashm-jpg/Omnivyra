/**
 * 20270217000050 (e1 2026-11-13): a 23505 means "another company holds this domain" ONLY when it names one of the two
 * partial domain indexes - companies has other unique rules, so a bare 23505 is ambiguous (05).
 */
import {
  classifyCompanyDomainConflict, WEBSITE_DOMAIN_UNIQUE_INDEX, ADMIN_EMAIL_DOMAIN_UNIQUE_INDEX,
  reportCanonicalDomainViolation, WEBSITE_DOMAIN_CANONICAL_CHECK,
} from '../../services/companyDomainUniqueness';

const pgMsg = (idx: string) => `duplicate key value violates unique constraint "${idx}"`;

it('a 23505 naming the website_domain index -> website_domain', () => {
  expect(classifyCompanyDomainConflict({ code: '23505', message: pgMsg(WEBSITE_DOMAIN_UNIQUE_INDEX) })).toBe('website_domain');
});
it('a 23505 naming the admin_email_domain index (in details) -> admin_email_domain', () => {
  expect(classifyCompanyDomainConflict({ code: '23505', message: 'conflict', details: `Key exists: ${ADMIN_EMAIL_DOMAIN_UNIQUE_INDEX}` })).toBe('admin_email_domain');
});
it('a 23505 from ANOTHER unique rule (e.g. the primary key) is NOT a domain conflict', () => {
  expect(classifyCompanyDomainConflict({ code: '23505', message: pgMsg('companies_pkey') })).toBeNull();
});
it('a non-23505 error mentioning the index name is NOT a domain conflict', () => {
  expect(classifyCompanyDomainConflict({ code: '42501', message: pgMsg(WEBSITE_DOMAIN_UNIQUE_INDEX) })).toBeNull();
  expect(classifyCompanyDomainConflict(null)).toBeNull();
});

describe('reportCanonicalDomainViolation (a missed writer is a programming error, logged distinctly)', () => {
  it('a 23514 naming a canonical CHECK is logged once with the constraint and the writer', () => {
    const log = { error: jest.fn() };
    const hit = reportCanonicalDomainViolation(
      { code: '23514', message: `new row violates check constraint "${WEBSITE_DOMAIN_CANONICAL_CHECK}"` }, 'admin/create-company', log);
    expect(hit).toBe(true);
    expect(log.error).toHaveBeenCalledWith('company_domain_not_canonical_write',
      expect.objectContaining({ writer: 'admin/create-company', constraint: WEBSITE_DOMAIN_CANONICAL_CHECK }));
  });
  it('any other 23514, or a 23505, is not reported', () => {
    const log = { error: jest.fn() };
    expect(reportCanonicalDomainViolation({ code: '23514', message: 'violates check constraint "other_chk"' }, 'w', log)).toBe(false);
    expect(reportCanonicalDomainViolation({ code: '23505', message: WEBSITE_DOMAIN_CANONICAL_CHECK }, 'w', log)).toBe(false);
    expect(log.error).not.toHaveBeenCalled();
  });
});
