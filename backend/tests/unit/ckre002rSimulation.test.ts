/**
 * CKRE-002R §6/§7 — deterministic refresh simulation (no AI, no crawl).
 */
import { simulateRefresh } from '../../services/crawl/refreshSimulation';
import { computeWebsiteFingerprint, type FingerprintInput } from '../../services/crawl/websiteFingerprintService';
import type { RefreshPolicyConfig } from '../../services/crawl/refreshPolicyConfig';
import type { DiscoveredWebsiteMetadata } from '../../services/companyProfile/websiteMetadataExtractor';

const CONFIG: RefreshPolicyConfig = {
  aiGatingEnabled: true, enrichmentCacheEnabled: false,
  cooldownMsByTier: { enterprise: 86_400_000, pro: 259_200_000, free: 604_800_000 }, historyLimit: 20,
};
const META: DiscoveredWebsiteMetadata = {
  title: 'Acme', description: 'd', siteName: 'Acme', faviconUrl: 'https://acme.com/f.ico',
  logoUrl: 'https://acme.com/l.png', language: 'en', country: 'US', brandColor: '#000', keywords: [], openGraph: {},
};
const fp = (over: Partial<FingerprintInput> = {}) => computeWebsiteFingerprint({
  url: 'https://acme.com', html: '<html><body><a href="/a">a</a><h1>Acme</h1></body></html>',
  headers: { etag: 'v1', lastModified: 'A', contentLength: '100' }, metadata: META, socialLinks: ['https://linkedin.com/company/acme'],
  ...over,
});

describe('CKRE-002R §6 — simulation predicts without executing', () => {
  test('unchanged (with baseline) → SKIP, no AI, savings estimated', () => {
    const prev = fp();
    const next = fp();
    const sim = simulateRefresh(prev, next, CONFIG, { hasPriorKnowledgeVersion: true });
    expect(sim.changeVerdict).toBe('UNCHANGED');
    expect(sim.predictedDecision.action).toBe('SKIP_REFRESH');
    expect(sim.estimatedAiExecution).toBe(false);
    expect(sim.estimatedNetworkRequests).toBe(0);
    expect(sim.estimatedTokenSavings).toBeGreaterThan(0);
    expect(sim.estimatedScope).toBe('none');
  });

  test('cosmetic change → metadata scope, no AI, savings', () => {
    const prev = fp({ headers: { etag: 'v1' } });
    const next = fp({ headers: { etag: 'v2' }, html: '<html><body><a href="/a">a</a><a href="/b">b</a><h1>Acme</h1></body></html>' });
    const sim = simulateRefresh(prev, next, CONFIG, { hasPriorKnowledgeVersion: true });
    expect(sim.predictedDecision.action).toBe('REFRESH_METADATA_ONLY');
    expect(sim.estimatedScope).toBe('metadata');
    expect(sim.estimatedAiExecution).toBe(false);
    expect(sim.affectedSections.length).toBeGreaterThan(0);
  });

  test('major change → full scope, AI executes, no savings', () => {
    const prev = fp({ headers: { etag: 'v1' } });
    const next = fp({ headers: { etag: 'v2' }, metadata: { ...META, siteName: 'Globex', title: 'Globex' } });
    const sim = simulateRefresh(prev, next, CONFIG, { hasPriorKnowledgeVersion: true });
    expect(sim.changeVerdict).toBe('MAJOR_CHANGE');
    expect(sim.predictedDecision.action).toBe('REFRESH_FULL');
    expect(sim.estimatedAiExecution).toBe(true);
    expect(sim.estimatedNetworkRequests).toBe(1);
    expect(sim.estimatedTokenSavings).toBe(0);
    expect(sim.estimatedScope).toBe('full');
  });

  test('no prior fingerprint → UNKNOWN verdict → first full refresh', () => {
    const sim = simulateRefresh(null, fp(), CONFIG, { hasPriorKnowledgeVersion: false });
    expect(sim.changeVerdict).toBe('UNKNOWN');
    expect(sim.estimatedAiExecution).toBe(true);
  });

  test('simulation matches the live engine decision for the same inputs', () => {
    const prev = fp({ headers: { etag: 'v1' } });
    const next = fp({ headers: { etag: 'v2' }, metadata: { ...META, brandColor: '#FFF' } });
    const sim = simulateRefresh(prev, next, CONFIG, { hasPriorKnowledgeVersion: true });
    expect(sim.predictedDecision.action).toBe('REFRESH_BUSINESS_ONLY');
  });
});

describe('CKRE-002R §7 — simulation determinism', () => {
  test('identical inputs → identical simulation', () => {
    const prev = fp({ headers: { etag: 'v1' } });
    const next = fp({ headers: { etag: 'v2' }, metadata: { ...META, brandColor: '#ABC' } });
    const a = simulateRefresh(prev, next, CONFIG, { hasPriorKnowledgeVersion: true, now: 1000 });
    const b = simulateRefresh(prev, next, CONFIG, { hasPriorKnowledgeVersion: true, now: 1000 });
    expect(a).toEqual(b);
  });
});
