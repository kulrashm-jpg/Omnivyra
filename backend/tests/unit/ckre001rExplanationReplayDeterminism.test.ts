/**
 * CKRE-001R §3/§5/§6/§7 — decision explanation, provenance, replay, determinism.
 */
import {
  decideWebsiteChange,
  replayWebsiteChange,
} from '../../services/crawl/changeDetectionService';
import {
  computeWebsiteFingerprint,
  WEBSITE_FINGERPRINT_VERSION,
  type FingerprintInput,
  type WebsiteFingerprint,
} from '../../services/crawl/websiteFingerprintService';
import type { DiscoveredWebsiteMetadata } from '../../services/companyProfile/websiteMetadataExtractor';

const META: DiscoveredWebsiteMetadata = {
  title: 'Acme Inc', description: 'Widgets', siteName: 'Acme Inc',
  faviconUrl: 'https://acme.com/favicon.ico', logoUrl: 'https://acme.com/logo.png',
  language: 'en', country: 'US', brandColor: '#0A66C2', keywords: [], openGraph: { title: 'Acme' },
};
const input = (over: Partial<FingerprintInput> = {}): FingerprintInput => ({
  url: 'https://acme.com',
  html: '<html lang="en"><body><a href="/about">About</a><h1>Acme</h1></body></html>',
  headers: { etag: 'v1', lastModified: 'A', contentLength: '100' },
  metadata: META,
  socialLinks: ['https://linkedin.com/company/acme'],
  ...over,
});

describe('CKRE-001R §3 — change explanation', () => {
  test('major change surfaces changed fingerprints, sections, reason codes, action', () => {
    const a = computeWebsiteFingerprint(input({ headers: { etag: 'v1' } }));
    const b = computeWebsiteFingerprint(input({ headers: { etag: 'v2' }, metadata: { ...META, siteName: 'Globex', title: 'Globex' } }));
    const d = decideWebsiteChange(a, b);
    expect(d.verdict).toBe('MAJOR_CHANGE');
    expect(d.recommendedAction).toBe('REFRESH_ENRICHMENT');
    expect(d.changedSections).toContain('business');
    expect(d.changedFingerprints).toContain('BUSINESS');
    expect(d.reasonCodes).toContain('COMPANY_NAME_CHANGED');
    expect(d.affectedFingerprints).toContain('BUSINESS');
  });

  test('recommended action maps deterministically per verdict', () => {
    const same = computeWebsiteFingerprint(input());
    expect(decideWebsiteChange(same, computeWebsiteFingerprint(input())).recommendedAction).toBe('NO_ACTION');
    expect(decideWebsiteChange(null, same).recommendedAction).toBe('UNKNOWN');

    const cosmetic = computeWebsiteFingerprint(input({ headers: { etag: 'v2' }, html: '<html><body><a href="/x">x</a><a href="/y">y</a><h1>Acme</h1></body></html>' }));
    expect(decideWebsiteChange(computeWebsiteFingerprint(input({ headers: { etag: 'v1' } })), cosmetic).recommendedAction).toBe('REFRESH_METADATA');

    const business = computeWebsiteFingerprint(input({ headers: { etag: 'v2' }, metadata: { ...META, brandColor: '#FF0000' } }));
    expect(decideWebsiteChange(computeWebsiteFingerprint(input({ headers: { etag: 'v1' } })), business).recommendedAction).toBe('REFRESH_BUSINESS');
  });
});

describe('CKRE-001R §5 — provenance', () => {
  test('every bundle carries producer/schemaVersion/algorithm/generatedAt/sourceUrl/reason/workflow', () => {
    const fp = computeWebsiteFingerprint(input(), '2026-07-14T00:00:00.000Z', { generationReason: 'refresh', workflow: 'profile_refresh', producer: 'test' });
    expect(fp.provenance).toEqual({
      producer: 'test',
      schemaVersion: WEBSITE_FINGERPRINT_VERSION,
      algorithm: 'sha256',
      generatedAt: '2026-07-14T00:00:00.000Z',
      sourceUrl: 'https://acme.com',
      generationReason: 'refresh',
      workflow: 'profile_refresh',
    });
  });

  test('provenance defaults are sane when not supplied', () => {
    const fp = computeWebsiteFingerprint(input());
    expect(fp.provenance?.producer).toBe('website_crawl');
    expect(fp.provenance?.generationReason).toBe('crawl');
    expect(fp.provenance?.workflow).toBeNull();
  });
});

describe('CKRE-001R §6 — replay (no HTTP, no AI)', () => {
  test('replay re-evaluates the decision + graph closure from stored bundles', () => {
    const a = computeWebsiteFingerprint(input({ headers: { etag: 'v1' } }));
    const b = computeWebsiteFingerprint(input({ headers: { etag: 'v2' }, metadata: { ...META, brandColor: '#FF0000' } }));
    const r = replayWebsiteChange(a, b);
    expect(r.decision.verdict).toBe('BUSINESS_CHANGE');
    expect(r.wouldReEvaluate).toEqual(r.decision.affectedFingerprints);
    expect(r.prevVersion).toBe(WEBSITE_FINGERPRINT_VERSION);
    // Deterministic: replaying the same stored bundles yields the same result.
    expect(replayWebsiteChange(a, b)).toEqual(r);
  });
});

describe('CKRE-001R §7 — determinism', () => {
  test('identical inputs → identical hashes regardless of computedAt/order', () => {
    const a = computeWebsiteFingerprint(input(), 't1');
    const b = computeWebsiteFingerprint(input(), 't2');
    expect(a.level0).toEqual(b.level0);
    expect(a.level1).toEqual(b.level1);
    expect(a.level2).toEqual(b.level2);
  });

  test('URL canonicalization: trailing slash / case / default port do not change the hash', () => {
    const base = computeWebsiteFingerprint(input({ metadata: { ...META, logoUrl: 'https://Acme.com:443/logo.png' } }));
    const variant = computeWebsiteFingerprint(input({ metadata: { ...META, logoUrl: 'https://acme.com/logo.png' } }));
    expect(base.level1.logoHash).toBe(variant.level1.logoHash);
  });

  test('social link order does not change the SOCIAL hash', () => {
    const a = computeWebsiteFingerprint(input({ socialLinks: ['https://x.com/a', 'https://linkedin.com/company/acme'] }));
    const b = computeWebsiteFingerprint(input({ socialLinks: ['https://linkedin.com/company/acme', 'https://x.com/a'] }));
    expect(a.level2.socialLinks).toBe(b.level2.socialLinks);
  });

  test('schema-version mismatch → UNKNOWN (no fabricated change on a version bump)', () => {
    const current = computeWebsiteFingerprint(input());
    const stale: WebsiteFingerprint = { ...computeWebsiteFingerprint(input()), version: 'ckre-fp-v1' };
    const d = decideWebsiteChange(stale, current);
    expect(d.verdict).toBe('UNKNOWN');
    expect(d.reason).toBe('fingerprint_schema_version_mismatch');
  });
});

describe('CKRE-001R §4 — crawl session', () => {
  // Session import kept isolated (constructs randomUUID); no I/O.
  test('session aggregates identity, timings, metrics, fingerprint, decision', async () => {
    const { CrawlSession } = await import('../../services/crawl/crawlSession');
    const s = new CrawlSession({ companyId: 'org1', workflow: 'onboarding' }, 'crawl-123', 1000);
    s.mark('fetch', 1200);
    s.count('crawl.count');
    const fp = computeWebsiteFingerprint(input());
    s.recordFingerprint(fp);
    s.recordDecision(decideWebsiteChange(null, fp));
    const ctx = s.toContext();
    expect(ctx).toMatchObject({ companyId: 'org1', workflow: 'onboarding', crawlId: 'crawl-123' });
    const snap = s.snapshot();
    expect(snap.crawlId).toBe('crawl-123');
    expect(snap.timings.fetch).toBe(200);
    expect(snap.metrics['crawl.count']).toBe(1);
    expect(snap.fingerprint).toBe(fp);
    expect(snap.decision?.verdict).toBe('UNKNOWN');
  });
});
