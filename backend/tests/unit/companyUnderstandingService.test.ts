/**
 * Company Understanding — multi-source core-business read (competitor grounding).
 * Verifies source composition, revenue-range precedence, gated-provider state,
 * and fail-safe behaviour when external sources error/timeout. External calls
 * (Wikidata, Wikipedia via safeFetch) are mocked.
 */

const mockSafeFetch = jest.fn();
const mockWikidata = jest.fn();

jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
}));
jest.mock('../../services/intelligence/adapters/wikidataAdapter', () => ({
  lookupCompanyFirmographicsFromWikidata: (...args: unknown[]) => mockWikidata(...args),
}));

import { buildCompanyUnderstanding } from '../../services/context/companyUnderstandingService';

function wikipediaMock() {
  return (url: string) => {
    if (url.includes('list=search')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ query: { search: [{ title: 'Acme Corp' }] } }) });
    }
    if (url.includes('/page/summary/')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ extract: 'Acme Corp builds analytics software for retailers.', type: 'standard' }) });
    }
    return Promise.resolve({ ok: false });
  };
}

const baseProfile = {
  name: 'Acme Corp',
  website: 'acme.com',
  industry: 'Software',
  category: 'Analytics',
  products_services: 'Retail analytics dashboards',
  unique_value: 'Real-time shelf insights',
  target_audience: 'Retail chains',
};

describe('companyUnderstandingService.buildCompanyUnderstanding', () => {
  beforeEach(() => {
    mockSafeFetch.mockReset();
    mockWikidata.mockReset();
    delete process.env.CRUNCHBASE_API_KEY;
    delete process.env.BLOOMBERG_API_KEY;
  });

  test('composes profile + wikidata + wikipedia into grounding and tracks sources', async () => {
    mockSafeFetch.mockImplementation(wikipediaMock());
    mockWikidata.mockResolvedValue({ founded_year: '1990', team_size: '500', revenue_range: '$10M-$50M', matched_label: 'Acme Corporation' });

    const u = await buildCompanyUnderstanding('c1', baseProfile);

    expect(u.sources).toEqual(expect.arrayContaining(['profile', 'wikidata', 'wikipedia']));
    expect(u.signals.wikipediaSummary).toContain('analytics software');
    expect(u.signals.foundedYear).toBe('1990');
    expect(u.groundingText).toContain('Retail analytics dashboards');
    expect(u.groundingText).toContain('Public description (Wikipedia');
    expect(u.groundingText).toContain('Founded: 1990');
  });

  test('revenue range prefers the profile over Wikidata', async () => {
    mockSafeFetch.mockImplementation(() => Promise.resolve({ ok: false }));
    mockWikidata.mockResolvedValue({ founded_year: null, team_size: null, revenue_range: '$1B+', matched_label: 'Acme' });

    const u = await buildCompanyUnderstanding('c1', { ...baseProfile, revenue_range: '$5M-$10M' });
    expect(u.signals.revenueRange).toBe('$5M-$10M'); // profile wins
  });

  test('falls back to Wikidata revenue when the profile has none', async () => {
    mockSafeFetch.mockImplementation(() => Promise.resolve({ ok: false }));
    mockWikidata.mockResolvedValue({ founded_year: null, team_size: null, revenue_range: '$1B+', matched_label: 'Acme' });

    const u = await buildCompanyUnderstanding('c1', baseProfile);
    expect(u.signals.revenueRange).toBe('$1B+');
  });

  test('fail-safe: external sources erroring never throws; degrades to profile only', async () => {
    mockSafeFetch.mockRejectedValue(new Error('network down'));
    mockWikidata.mockRejectedValue(new Error('wikidata down'));

    const u = await buildCompanyUnderstanding('c1', baseProfile);
    expect(u.sources).toEqual(['profile']);
    expect(u.signals.wikipediaSummary).toBeNull();
    expect(u.signals.foundedYear).toBeNull();
    expect(u.groundingText).toContain('Sources consulted: profile.');
  });

  test('gated providers are dark (no_key) without API keys', async () => {
    mockSafeFetch.mockImplementation(() => Promise.resolve({ ok: false }));
    mockWikidata.mockResolvedValue({ founded_year: null, team_size: null, revenue_range: null, matched_label: null });

    const u = await buildCompanyUnderstanding('c1', baseProfile);
    expect(u.gatedProviders).toEqual({ crunchbase: 'no_key', bloomberg: 'no_key' });
    expect(u.sources).not.toContain('crunchbase');
    expect(u.sources).not.toContain('bloomberg');
  });
});
