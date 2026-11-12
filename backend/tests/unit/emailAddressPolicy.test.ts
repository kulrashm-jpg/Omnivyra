/**
 * e1 2026-11-12 (e9 ruling, defence in depth): a conservative address policy where an email first enters
 * (signup, magic-link, team/invite, admin/invite-user, super-admin user create) - so a filter-syntax address like the
 * onboarding .or() takeover payload is refused by us, whatever the auth provider would have verified.
 */
export {};
/* eslint-disable @typescript-eslint/no-var-requires */
const { isAcceptableEmailAddress } = require('../../../lib/auth/emailAddressPolicy');
/* eslint-enable @typescript-eslint/no-var-requires */

it('refuses the crafted takeover payload and every quoted / comma / space / control form', () => {
  const refused = [
    'a,supabase_uid.eq.sb-victim,email.eq.z@acme.com',
    '"a,b"@acme.com',
    '"john doe"@acme.com',
    'john doe@acme.com',
    'john\u0000@acme.com',
    'john\n@acme.com',
    'jo%hn@acme.com',
    'john(x)@acme.com',
    'john@[127.0.0.1]',
    'john@localhost',
    'john@acme',
    'john@acme.c',
    'john@-acme.com',
    'john@acme-.com',
    'john..doe@acme.com',
    '.john@acme.com',
    'john.@acme.com',
    'jo@hn@acme.com',
    '@acme.com',
    'john@',
    'jöhn@acme.com',
    `${'a'.repeat(65)}@acme.com`,
    `a@${'b'.repeat(250)}.com`,
    '',
    null,
    42,
  ];
  for (const v of refused) expect([v, isAcceptableEmailAddress(v)]).toEqual([v, false]);
});

it('accepts ordinary addresses (incl. plus-tags, dots, hyphens, sub-domains, surrounding whitespace)', () => {
  const accepted = [
    'john@acme.com',
    'john.doe+tag@mail.acme.co.uk',
    'j_doe-1@acme-corp.io',
    'JOHN@ACME.COM',
    '  john@acme.com  ',
  ];
  for (const v of accepted) expect([v, isAcceptableEmailAddress(v)]).toEqual([v, true]);
});
