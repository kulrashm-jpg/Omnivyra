/**
 * AUTH-VERIFY-001 rec #1/#2 — coverage for the invite work-email gate shared by
 * all three invite routes (company/users, team/invite, admin/invite-user).
 *
 * Only the STATIC/personal cases are asserted here: personal providers
 * short-circuit to `true` BEFORE any DB lookup, and empty/malformed inputs
 * return `false` before any DB lookup — so these are hermetic (no network). The
 * DB-augmentation layer (disposable_domains / public_email_providers) is
 * best-effort and fail-open by design and is not exercised here.
 */
import { isNonWorkEmailDomain } from '../../services/domainEligibilityService';

describe('isNonWorkEmailDomain — invite work-email gate (personal blocklist)', () => {
  it.each([
    'gmail.com',
    'googlemail.com',
    'outlook.com',
    'hotmail.com',
    'live.com',
    'yahoo.com',
    'yahoo.co.in',
    'icloud.com',
    'proton.me',
    'protonmail.com',
    'aol.com',
    'rediffmail.com',
  ])('blocks personal/free provider %s', async (domain) => {
    expect(await isNonWorkEmailDomain(domain)).toBe(true);
  });

  it('is case-insensitive', async () => {
    expect(await isNonWorkEmailDomain('GmAiL.CoM')).toBe(true);
  });

  it('returns false for empty / whitespace (format handled by the caller)', async () => {
    expect(await isNonWorkEmailDomain('')).toBe(false);
    expect(await isNonWorkEmailDomain('   ')).toBe(false);
  });
});
