/**
 * CKRE-001 §5 — deterministic change decision engine.
 */
import { decideWebsiteChange, changeMetricFor } from '../../services/crawl/changeDetectionService';
import { computeWebsiteFingerprint, type FingerprintInput } from '../../services/crawl/websiteFingerprintService';
import type { DiscoveredWebsiteMetadata } from '../../services/companyProfile/websiteMetadataExtractor';

const META: DiscoveredWebsiteMetadata = {
  title: 'Acme Inc', description: 'Widgets', siteName: 'Acme Inc',
  faviconUrl: 'https://acme.com/favicon.ico', logoUrl: 'https://acme.com/logo.png',
  language: 'en', country: 'US', brandColor: '#0A66C2', keywords: [], openGraph: {},
};
const baseInput = (over: Partial<FingerprintInput> = {}): FingerprintInput => ({
  url: 'https://acme.com',
  html: '<html><body><a href="/about">About</a><h1>Acme</h1></body></html>',
  headers: { etag: 'v1', lastModified: 'Mon, 01 Jul 2026 00:00:00 GMT', contentLength: '100' },
  metadata: META,
  socialLinks: ['https://linkedin.com/company/acme'],
  ...over,
});

describe('CKRE-001 §5 — verdicts', () => {
  test('no prior → UNKNOWN', () => {
    const next = computeWebsiteFingerprint(baseInput());
    const d = decideWebsiteChange(null, next);
    expect(d.verdict).toBe('UNKNOWN');
    expect(d.score).toBe(0);
  });

  test('identical fingerprints → UNCHANGED', () => {
    const a = computeWebsiteFingerprint(baseInput());
    const b = computeWebsiteFingerprint(baseInput());
    const d = decideWebsiteChange(a, b);
    expect(d.verdict).toBe('UNCHANGED');
    expect(d.score).toBe(0);
  });

  test('matching etag short-circuits to UNCHANGED even if unrelated header differs', () => {
    const a = computeWebsiteFingerprint(baseInput({ headers: { etag: 'same', lastModified: 'A', contentLength: '1' } }));
    const b = computeWebsiteFingerprint(baseInput({ headers: { etag: 'same', lastModified: 'B', contentLength: '2' } }));
    expect(decideWebsiteChange(a, b).verdict).toBe('UNCHANGED');
  });

  test('structural-only change (nav) → COSMETIC_CHANGE', () => {
    const a = computeWebsiteFingerprint(baseInput({ headers: { etag: 'v1' } }));
    const b = computeWebsiteFingerprint(baseInput({
      headers: { etag: 'v2' },
      html: '<html><body><a href="/about">About</a><a href="/blog">Blog</a><h1>Acme</h1></body></html>',
    }));
    const d = decideWebsiteChange(a, b);
    expect(d.verdict).toBe('COSMETIC_CHANGE');
    expect(d.changedLevels).toContain('level1');
    expect(d.score).toBeGreaterThan(0);
  });

  test('one business field (brand colour) → BUSINESS_CHANGE', () => {
    const a = computeWebsiteFingerprint(baseInput({ headers: { etag: 'v1' } }));
    const b = computeWebsiteFingerprint(baseInput({ headers: { etag: 'v2' }, metadata: { ...META, brandColor: '#FF0000' } }));
    const d = decideWebsiteChange(a, b);
    expect(d.verdict).toBe('BUSINESS_CHANGE');
    expect(d.changedFields).toContain('level2.brandColors');
  });

  test('company name change → MAJOR_CHANGE', () => {
    const a = computeWebsiteFingerprint(baseInput({ headers: { etag: 'v1' } }));
    const b = computeWebsiteFingerprint(baseInput({ headers: { etag: 'v2' }, metadata: { ...META, siteName: 'Globex', title: 'Globex' } }));
    const d = decideWebsiteChange(a, b);
    expect(d.verdict).toBe('MAJOR_CHANGE');
    expect(d.reason).toBe('company_name_changed');
    expect(d.score).toBeGreaterThanOrEqual(30);
  });

  test('≥3 business fields changed → MAJOR_CHANGE', () => {
    // Change 4 Level-2 fields: brandColors, socialLinks, primaryCta, contact.
    const a = computeWebsiteFingerprint(baseInput({ headers: { etag: 'v1' } }));
    const b = computeWebsiteFingerprint(baseInput({
      headers: { etag: 'v2' },
      metadata: { ...META, brandColor: '#111111' },
      socialLinks: ['https://linkedin.com/company/acme', 'https://x.com/acme2'],
      html: '<html><body><a href="/about">About</a><h1>Acme</h1><a class="cta">Get started</a><a href="mailto:hi@acme.com">Email</a></body></html>',
    }));
    const d = decideWebsiteChange(a, b);
    expect(d.verdict).toBe('MAJOR_CHANGE');
    expect(d.changedFields.filter((f) => f.startsWith('level2.')).length).toBeGreaterThanOrEqual(3);
  });
});

describe('CKRE-001 §5 — determinism & retry-safety', () => {
  test('same inputs → identical decision (pure)', () => {
    const a = computeWebsiteFingerprint(baseInput({ headers: { etag: 'v1' } }));
    const b = computeWebsiteFingerprint(baseInput({ headers: { etag: 'v2' }, metadata: { ...META, brandColor: '#FF0000' } }));
    expect(decideWebsiteChange(a, b)).toEqual(decideWebsiteChange(a, b));
  });
});

describe('CKRE-001 §6 — verdict → metric', () => {
  test('mapping', () => {
    expect(changeMetricFor('COSMETIC_CHANGE')).toBe('change_detected');
    expect(changeMetricFor('BUSINESS_CHANGE')).toBe('business_change');
    expect(changeMetricFor('MAJOR_CHANGE')).toBe('major_change');
    expect(changeMetricFor('UNCHANGED')).toBeNull();
    expect(changeMetricFor('UNKNOWN')).toBeNull();
  });
});
