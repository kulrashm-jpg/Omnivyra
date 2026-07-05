import { READINESS_REGISTRY, type ReadinessSignals } from '../../../config/readinessRegistry';
import { buildReadinessSignals } from '../../../lib/readiness/buildReadinessSignals';
import { evaluateCapabilityRegistry, type EvaluatedCategory } from '../../../lib/shared/capabilityRegistry';

const flag = (configured: boolean) => ({ available: true, reason: null, configured });
const cnt = (count: number) => ({ available: true, reason: null, count });

function baseSignals(): ReadinessSignals {
  return {
    features: {},
    profile: { companyProfileComplete: true, industry: true, regions: true, targetAudience: true, websiteUrl: 'https://example.com' },
    channels: { available: true, reason: null, connectedCount: 0, totalCount: 0, expiredCount: 0, publishReadyCount: 0, permissionIssueCount: 0 },
    foundation: { available: true, reason: null, domainVerified: false, analyticsConnected: false, trackingActive: false },
    content: { library: cnt(0), templates: cnt(0), media: cnt(0) },
    automation: { blog: flag(false), leadCapture: flag(false), crm: flag(false), workflows: flag(false) },
  };
}

function evalReadiness(categoryId: string, signals: ReadinessSignals): EvaluatedCategory {
  const def = READINESS_REGISTRY.find((c) => c.id === categoryId);
  if (!def) throw new Error(`category ${categoryId} missing`);
  return evaluateCapabilityRegistry([def], signals).categories[0];
}

describe('Readiness registry — capability + latch rules', () => {
  it('Distribution is fully credited on one connected channel — expired others do not drag it', () => {
    const s = baseSignals();
    s.channels = { available: true, reason: null, connectedCount: 6, totalCount: 9, expiredCount: 2, publishReadyCount: 4, permissionIssueCount: 2 };
    const cat = evalReadiness('distribution', s);
    expect(cat.percent).toBe(100); // health/permissions are weight-0, non-penalizing
    // …but the warnings still render as (non-scored) factor rows.
    expect(cat.factors.some((f) => f.id === 'distribution.channel_health')).toBe(true);
    expect(cat.factors.some((f) => f.id === 'distribution.publishing_permissions')).toBe(true);
  });

  it('Distribution stays credited via the latched feature when nothing is live now', () => {
    const s = baseSignals();
    s.channels.connectedCount = 0;
    s.features['social_accounts_connected'] = 1; // ever connected (latched)
    expect(evalReadiness('distribution', s).percent).toBe(100);
  });

  it('Distribution reads incomplete only when never connected', () => {
    expect(evalReadiness('distribution', baseSignals()).percent).toBe(0);
  });

  it('Languages reads satisfied (English is the supported language)', () => {
    const cat = evalReadiness('audience', baseSignals());
    const lang = cat.factors.find((f) => f.id === 'audience.languages');
    expect(lang?.status).toBe('done');
  });

  it('Automation surfaces a blog/website integration factor', () => {
    const s = baseSignals();
    s.automation.blog = flag(true);
    const cat = evalReadiness('automation', s);
    const blog = cat.factors.find((f) => f.id === 'automation.blog');
    expect(blog?.status).toBe('done');
    expect(cat.factors.some((f) => f.id === 'automation.notifications')).toBe(false); // dead no-signal removed
  });
});

describe('buildReadinessSignals — domain latch + blog integration', () => {
  const rawBase = {
    profile: { website_url: 'https://example.com' },
    features: [],
    socialAccounts: null,
    blogsCount: 0,
    templatesCount: 0,
    mediaCount: 0,
    automation: null,
  };

  it('latches domain verification on verifiedAt (ever verified = forever)', () => {
    const sig = buildReadinessSignals({
      ...rawBase,
      websiteSnapshot: { domain: { verified: false, verifiedAt: '2026-01-01T00:00:00Z' }, readiness: { checks: [] } },
    } as any);
    expect(sig.foundation.domainVerified).toBe(true);
  });

  it('does not mark domain verified when never verified', () => {
    const sig = buildReadinessSignals({
      ...rawBase,
      websiteSnapshot: { domain: { verified: false, verifiedAt: null }, readiness: { checks: [] } },
    } as any);
    expect(sig.foundation.domainVerified).toBe(false);
  });

  it('reads a blog integration from the CMS readiness check', () => {
    const sig = buildReadinessSignals({
      ...rawBase,
      websiteSnapshot: { domain: { verified: true }, readiness: { checks: [{ id: 'cms', done: true }] } },
    } as any);
    expect(sig.automation.blog.configured).toBe(true);
  });
});
