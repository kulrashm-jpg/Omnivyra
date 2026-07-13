/**
 * CKRE-001 §3/§4 — deterministic website fingerprints.
 */
import {
  computeWebsiteFingerprint,
  hasFingerprintSignal,
  WEBSITE_FINGERPRINT_VERSION,
  WEBSITE_FINGERPRINT_ALGORITHM,
  WEBSITE_FINGERPRINT_SOURCE,
  type FingerprintInput,
} from '../../services/crawl/websiteFingerprintService';
import type { DiscoveredWebsiteMetadata } from '../../services/companyProfile/websiteMetadataExtractor';

const META: DiscoveredWebsiteMetadata = {
  title: 'Acme Inc', description: 'We build widgets', siteName: 'Acme Inc',
  faviconUrl: 'https://acme.com/favicon.ico', logoUrl: 'https://acme.com/logo.png',
  language: 'en', country: 'US', brandColor: '#0A66C2',
  keywords: ['widgets'], openGraph: { title: 'Acme', site_name: 'Acme Inc' },
};

const HTML = `
  <html lang="en"><head>
    <title>Acme Inc</title>
    <script>var t=Date.now();</script>
    <script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>
  </head><body>
    <nav><a href="/about">About</a><a href="/pricing">Pricing</a></nav>
    <a href="/signup" class="cta">Get started</a>
    <a href="mailto:hi@acme.com">Email us</a>
  </body></html>`;

const INPUT: FingerprintInput = {
  url: 'https://acme.com',
  html: HTML,
  headers: { etag: 'W/"abc"', lastModified: 'Mon, 01 Jul 2026 00:00:00 GMT', contentLength: '1234' },
  metadata: META,
  socialLinks: ['https://linkedin.com/company/acme', 'https://x.com/acme'],
};

describe('CKRE-001 §4 — bundle shape & provenance', () => {
  test('carries algorithm, source, version, timestamp', () => {
    const fp = computeWebsiteFingerprint(INPUT, '2026-07-14T00:00:00.000Z');
    expect(fp.version).toBe(WEBSITE_FINGERPRINT_VERSION);
    expect(fp.algorithm).toBe(WEBSITE_FINGERPRINT_ALGORITHM);
    expect(fp.source).toBe(WEBSITE_FINGERPRINT_SOURCE);
    expect(fp.computedAt).toBe('2026-07-14T00:00:00.000Z');
    expect(fp.url).toBe('https://acme.com');
  });

  test('populates all three levels', () => {
    const fp = computeWebsiteFingerprint(INPUT);
    expect(fp.level0).toEqual({ etag: 'W/"abc"', lastModified: 'Mon, 01 Jul 2026 00:00:00 GMT', contentLength: '1234' });
    expect(fp.level1.htmlHash).toMatch(/^[0-9a-f]{64}$/);
    expect(fp.level1.navHash).toMatch(/^[0-9a-f]{64}$/);
    expect(fp.level1.faviconHash).toMatch(/^[0-9a-f]{64}$/);
    expect(fp.level1.logoHash).toMatch(/^[0-9a-f]{64}$/);
    expect(fp.level1.ogHash).toMatch(/^[0-9a-f]{64}$/);
    expect(fp.level2.companyName).toMatch(/^[0-9a-f]{64}$/);
    expect(fp.level2.socialLinks).toMatch(/^[0-9a-f]{64}$/);
    expect(fp.level2.brandColors).toMatch(/^[0-9a-f]{64}$/);
    expect(fp.level2.structuredData).toMatch(/^[0-9a-f]{64}$/);
    expect(fp.level2.primaryCta).toMatch(/^[0-9a-f]{64}$/); // "Get started"
    expect(fp.level2.contact).toMatch(/^[0-9a-f]{64}$/);    // mailto:
    expect(hasFingerprintSignal(fp)).toBe(true);
  });
});

describe('CKRE-001 §3 — determinism', () => {
  test('same input → identical hashes (timestamp aside)', () => {
    const a = computeWebsiteFingerprint(INPUT, 't1');
    const b = computeWebsiteFingerprint(INPUT, 't2');
    expect(a.level1).toEqual(b.level1);
    expect(a.level2).toEqual(b.level2);
    expect(a.level0).toEqual(b.level0);
  });

  test('dynamic script tokens do NOT change the structural html hash', () => {
    const a = computeWebsiteFingerprint({ ...INPUT, html: HTML.replace('Date.now()', 'Date.now()/*x*/') });
    const b = computeWebsiteFingerprint(INPUT);
    expect(a.level1.htmlHash).toBe(b.level1.htmlHash); // <script> stripped before hashing
  });

  test('a real business change flips the relevant hash', () => {
    const changed = computeWebsiteFingerprint({ ...INPUT, metadata: { ...META, siteName: 'Globex Corp', title: 'Globex Corp' } });
    const base = computeWebsiteFingerprint(INPUT);
    expect(changed.level2.companyName).not.toBe(base.level2.companyName);
    expect(changed.level2.brandColors).toBe(base.level2.brandColors); // unchanged
  });

  test('empty html yields no signal', () => {
    const fp = computeWebsiteFingerprint({ url: 'https://x.com', html: '', metadata: null });
    expect(fp.level1.htmlHash).toBeNull();
    expect(hasFingerprintSignal(fp)).toBe(false);
  });

  test('optional sitemap/robots hashes computed only when supplied', () => {
    const without = computeWebsiteFingerprint(INPUT);
    expect(without.level1.sitemapHash).toBeNull();
    const withFiles = computeWebsiteFingerprint({ ...INPUT, sitemapXml: '<urlset><url><loc>/a</loc></url></urlset>', robotsTxt: 'User-agent: *' });
    expect(withFiles.level1.sitemapHash).toMatch(/^[0-9a-f]{64}$/);
    expect(withFiles.level1.robotsHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
