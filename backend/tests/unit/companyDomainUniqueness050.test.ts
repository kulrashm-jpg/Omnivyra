/**
 * 20270217000050 (e1 2026-11-13): a 23505 means "another company holds this domain" ONLY when it names one of the two
 * partial domain indexes - companies has other unique rules, so a bare 23505 is ambiguous (05).
 */
import {
  classifyCompanyDomainConflict, WEBSITE_DOMAIN_UNIQUE_INDEX, ADMIN_EMAIL_DOMAIN_UNIQUE_INDEX,
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
