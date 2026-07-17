/**
 * Competitor self/platform-domain filter — used at both write (refine) and read
 * (company-profile GET) time so a company's own domain and the platform's own
 * domain (omnivyra.com) never appear as "competitors".
 */
import {
  normalizeCompetitorDomain,
  ownDomainHostFromWebsite,
  isSelfOrPlatformDomain,
  scrubCompetitorDetails,
} from '../../services/companyProfile/competitorDomainFilter';

describe('competitorDomainFilter', () => {
  test('normalizeCompetitorDomain strips protocol/www/path', () => {
    expect(normalizeCompetitorDomain('https://www.HubSpot.com/pricing')).toBe('hubspot.com');
    expect(normalizeCompetitorDomain('acme.com')).toBe('acme.com');
    expect(normalizeCompetitorDomain('')).toBe('');
  });

  test('ownDomainHostFromWebsite extracts the bare host', () => {
    expect(ownDomainHostFromWebsite('https://www.acme.com')).toBe('acme.com');
    expect(ownDomainHostFromWebsite('acme.com')).toBe('acme.com');
    expect(ownDomainHostFromWebsite('')).toBe('');
  });

  test('flags the platform domain (omnivyra.com) always', () => {
    expect(isSelfOrPlatformDomain('omnivyra.com')).toBe(true);
    expect(isSelfOrPlatformDomain('https://www.omnivyra.com')).toBe(true);
    expect(isSelfOrPlatformDomain('app.omnivyra.com')).toBe(true);
  });

  test('flags the profiled company own domain (incl. subdomains)', () => {
    expect(isSelfOrPlatformDomain('acme.com', 'https://acme.com')).toBe(true);
    expect(isSelfOrPlatformDomain('blog.acme.com', 'acme.com')).toBe(true);
    expect(isSelfOrPlatformDomain('hubspot.com', 'acme.com')).toBe(false);
  });

  test('blank/unknown domain is not flagged (kept)', () => {
    expect(isSelfOrPlatformDomain('', 'acme.com')).toBe(false);
    expect(isSelfOrPlatformDomain(null, 'acme.com')).toBe(false);
  });

  test('scrubCompetitorDetails removes self + platform, keeps real competitors', () => {
    const rows = [
      { name: 'Self', domain: 'acme.com' },
      { name: 'Omnivyra', domain: 'omnivyra.com' },
      { name: 'HubSpot', domain: 'hubspot.com' },
      { name: 'Unknown', domain: '' },
    ];
    const out = scrubCompetitorDetails(rows, 'https://www.acme.com');
    expect(out.map((r) => r.name)).toEqual(['HubSpot', 'Unknown']);
  });

  test('scrubCompetitorDetails tolerates non-array input', () => {
    expect(scrubCompetitorDetails(null, 'acme.com')).toEqual([]);
    expect(scrubCompetitorDetails(undefined, 'acme.com')).toEqual([]);
  });
});
