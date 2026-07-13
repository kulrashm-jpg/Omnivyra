/**
 * AUTH-001 §5 — canonical public-email blocklist.
 *
 * Locks: (1) the canonical set is the union of every pre-consolidation list
 * plus the audit-flagged missing providers; (2) all consumers (client
 * validator, server validator, company-match) agree because they share the
 * single module; (3) env extension works and never throws.
 */
import {
  PUBLIC_EMAIL_DOMAINS,
  isPublicEmailDomain,
  getConfiguredExtraPublicEmailDomains,
} from '../../../lib/auth/publicEmailDomains';
import { isPersonalEmailDomain } from '../../../lib/auth/serverValidation';
import { validateEmailDomain } from '../../../lib/auth/domainValidation';
import { isFreeEmailDomain } from '../../../backend/services/companyMatchService';

describe('AUTH-001 §5 — canonical public-email domain list', () => {
  const UNION_SAMPLES = [
    // from the old client/server 19-domain list
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', '163.com', 'qq.com', 'mail.ru', 'mailbox.org',
    // from the old companyMatchService-only list (previous drift)
    'googlemail.com', 'live.com', 'msn.com', 'me.com', 'mac.com', 'proton.me', 'zoho.com', 'gmx.net',
    'yahoo.co.uk', 'yahoo.co.in',
    // audit finding: absent from EVERY prior list
    'rediff.com', 'rediffmail.com',
  ];

  test('canonical set contains the full union plus rediff', () => {
    for (const domain of UNION_SAMPLES) {
      expect(PUBLIC_EMAIL_DOMAINS.has(domain)).toBe(true);
    }
  });

  test('work domains are not blocked', () => {
    for (const domain of ['omnivyra.com', 'acme.io', 'example.co.uk']) {
      expect(isPublicEmailDomain(domain)).toBe(false);
      expect(isPersonalEmailDomain(domain)).toBe(false);
      expect(isFreeEmailDomain(domain)).toBe(false);
    }
  });

  test('all consumers agree (single source of truth, no drift)', () => {
    for (const domain of UNION_SAMPLES) {
      expect(isPersonalEmailDomain(domain)).toBe(true);
      expect(isFreeEmailDomain(domain)).toBe(true);
      const clientCheck = validateEmailDomain(`user@${domain}`);
      expect(clientCheck.valid).toBe(false);
    }
  });

  test('normalization: case and whitespace are tolerated', () => {
    expect(isPublicEmailDomain('  GMAIL.COM ')).toBe(true);
    expect(isPersonalEmailDomain('Rediffmail.Com')).toBe(true);
  });

  test('env extension adds domains at call time and ignores junk', () => {
    const prev = process.env.PUBLIC_EMAIL_EXTRA_DOMAINS;
    try {
      process.env.PUBLIC_EMAIL_EXTRA_DOMAINS = 'corp-freemail.example, not-a-domain , ';
      expect(getConfiguredExtraPublicEmailDomains().has('corp-freemail.example')).toBe(true);
      expect(getConfiguredExtraPublicEmailDomains().has('not-a-domain')).toBe(false);
      expect(isPublicEmailDomain('corp-freemail.example')).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.PUBLIC_EMAIL_EXTRA_DOMAINS;
      else process.env.PUBLIC_EMAIL_EXTRA_DOMAINS = prev;
    }
  });

  test('client error copy uses provider names, not naive capitalization', () => {
    const check = validateEmailDomain('someone@gmail.com');
    expect(check.valid).toBe(false);
    if (!check.valid) {
      expect(check.reason).toContain('Gmail');
      expect(check.reason).not.toContain('Gmail.Com');
    }
  });
});
