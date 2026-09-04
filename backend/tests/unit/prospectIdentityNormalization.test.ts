/**
 * W1 — identity normalization contract lock.
 *
 * Normalization is the highest-consequence code in the identity foundation: it
 * decides which strings are "the same identifier", and therefore which humans
 * become one canonical person. Over-normalizing fuses distinct people, and that
 * is close to unrecoverable once claims accumulate. Under-normalizing merely
 * misses a match, which is recoverable.
 *
 * So these tests lock the rule in BOTH directions — what must collapse together,
 * and just as importantly what must stay apart.
 */

import {
  normalizeClaimValue,
  normalizeDomainClaim,
  normalizeExternalIdentity,
  normalizePlatform,
  isPlatformFree,
  isClaimType,
  CLAIM_TYPES,
} from '../../services/prospectIdentity/normalization';

describe('claim vocabulary', () => {
  it('exposes exactly the five types the CHECK constraint allows', () => {
    expect([...CLAIM_TYPES].sort()).toEqual(
      ['domain', 'email', 'external_id', 'external_profile', 'phone'].sort(),
    );
  });

  it('treats email/phone/domain as platform-free and external_* as platform-bound', () => {
    expect(isPlatformFree('email')).toBe(true);
    expect(isPlatformFree('phone')).toBe(true);
    expect(isPlatformFree('domain')).toBe(true);
    expect(isPlatformFree('external_profile')).toBe(false);
    expect(isPlatformFree('external_id')).toBe(false);
  });

  it('rejects values outside the vocabulary', () => {
    expect(isClaimType('linkedin')).toBe(false);
    expect(isClaimType('')).toBe(false);
    expect(isClaimType(null)).toBe(false);
  });
});

describe('email normalization (delegated to identityResolutionService)', () => {
  it('lowercases and trims', () => {
    expect(normalizeClaimValue('email', '  Jane.Doe@Acme.COM ')).toBe('jane.doe@acme.com');
  });

  it('returns null for blank input rather than an empty claim', () => {
    expect(normalizeClaimValue('email', '   ')).toBeNull();
    expect(normalizeClaimValue('email', null)).toBeNull();
  });

  it('does NOT strip plus-addressing — a+b@ and a@ are different mailboxes', () => {
    expect(normalizeClaimValue('email', 'jane+news@acme.com')).toBe('jane+news@acme.com');
    expect(normalizeClaimValue('email', 'jane+news@acme.com'))
      .not.toBe(normalizeClaimValue('email', 'jane@acme.com'));
  });

  it('does NOT strip dots — provider-dependent, and assuming Gmail rules merges strangers', () => {
    expect(normalizeClaimValue('email', 'jane.doe@acme.com'))
      .not.toBe(normalizeClaimValue('email', 'janedoe@acme.com'));
  });
});

describe('phone normalization (delegated to identityResolutionService)', () => {
  it('keeps a leading + and strips formatting', () => {
    expect(normalizeClaimValue('phone', '+1 (415) 555-0100')).toBe('+14155550100');
  });

  it('strips formatting from a national number without inventing a country code', () => {
    expect(normalizeClaimValue('phone', '(415) 555-0100')).toBe('4155550100');
  });

  it('keeps national and E.164 forms DISTINCT — guessing a country code merges strangers', () => {
    expect(normalizeClaimValue('phone', '4155550100'))
      .not.toBe(normalizeClaimValue('phone', '+14155550100'));
  });

  it('returns null for blank', () => {
    expect(normalizeClaimValue('phone', '  ')).toBeNull();
  });
});

describe('domain normalization (delegated to lib/shared/domain/companyDomain)', () => {
  it('collapses scheme, www, path and case to the registrable root', () => {
    for (const input of ['acme.com', 'www.acme.com', 'https://www.acme.com/pricing?x=1', 'ACME.com']) {
      expect(normalizeDomainClaim(input)).toBe('acme.com');
    }
  });

  it('extracts the domain from an email address', () => {
    expect(normalizeDomainClaim('john@mail.acme.com')).toBe('acme.com');
  });

  it('honours multi-part TLDs', () => {
    expect(normalizeDomainClaim('https://shop.acme.co.uk')).toBe('acme.co.uk');
  });

  it('keeps different TLDs apart — acme.com and acme.in are different companies', () => {
    expect(normalizeDomainClaim('acme.com')).not.toBe(normalizeDomainClaim('acme.in'));
  });

  it('returns null when no host can be extracted', () => {
    expect(normalizeDomainClaim('not-a-domain')).toBeNull();
    expect(normalizeDomainClaim('')).toBeNull();
  });
});

describe('external identity normalization', () => {
  it('reduces a profile URL to host + path, dropping query, fragment and trailing slash', () => {
    const expected = 'linkedin.com/in/jane-doe';
    for (const input of [
      'https://www.linkedin.com/in/jane-doe/',
      'https://linkedin.com/in/Jane-Doe?trk=x',
      'linkedin.com/in/jane-doe#about',
    ]) {
      expect(normalizeExternalIdentity(input)).toBe(expected);
    }
  });

  it('keeps the host — the same path on two platforms is two identities', () => {
    expect(normalizeExternalIdentity('linkedin.com/in/jane'))
      .not.toBe(normalizeExternalIdentity('facebook.com/in/jane'));
  });

  it('strips a single leading @ from a bare handle', () => {
    expect(normalizeExternalIdentity('@janedoe')).toBe('janedoe');
    expect(normalizeExternalIdentity('JaneDoe')).toBe('janedoe');
  });

  it('does NOT unify separators — jane.doe, jane-doe and janedoe are different accounts', () => {
    const forms = ['jane.doe', 'jane-doe', 'janedoe'].map(v => normalizeExternalIdentity(v));
    expect(new Set(forms).size).toBe(3);
  });

  it('returns null for blank', () => {
    expect(normalizeExternalIdentity('  ')).toBeNull();
    expect(normalizeExternalIdentity('@')).toBeNull();
  });
});

describe('platform normalization', () => {
  it('forces NULL for platform-free types so the DB CHECK is always satisfied', () => {
    expect(normalizePlatform('email', 'linkedin')).toBeNull();
    expect(normalizePlatform('phone', 'whatsapp')).toBeNull();
    expect(normalizePlatform('domain', 'anything')).toBeNull();
  });

  it('lowercases and trims a real platform', () => {
    expect(normalizePlatform('external_profile', '  LinkedIn ')).toBe('linkedin');
  });

  it('returns null when an external type has no platform, so the caller can reject it', () => {
    expect(normalizePlatform('external_id', '  ')).toBeNull();
  });
});

describe('determinism', () => {
  it('is total and stable — same input, same output, every time', () => {
    const samples: Array<[Parameters<typeof normalizeClaimValue>[0], string]> = [
      ['email', 'Jane@Acme.com'], ['phone', '+1 415 555 0100'],
      ['domain', 'https://WWW.Acme.co.uk/x'], ['external_profile', 'https://linkedin.com/in/Jane/'],
      ['external_id', '@Jane'],
    ];
    for (const [type, value] of samples) {
      const runs = new Set(Array.from({ length: 5 }, () => normalizeClaimValue(type, value)));
      expect(runs.size).toBe(1);
    }
  });

  it('never returns a value that would violate identity_claims_value_is_normalized', () => {
    const inputs = ['Jane@ACME.com', '+1 (415) 555-0100', 'HTTPS://WWW.ACME.COM', '@JaneDoe'];
    const types = ['email', 'phone', 'domain', 'external_id'] as const;
    types.forEach((t, i) => {
      const v = normalizeClaimValue(t, inputs[i]);
      if (v !== null) expect(v).toBe(v.toLowerCase());
    });
  });
});
