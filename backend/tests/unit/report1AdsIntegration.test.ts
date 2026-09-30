/**
 * REPORT-1-ADS-INTELLIGENCE-INTEGRATION-REMEDIATION-006 — the read seam.
 *
 * THE DEFECT
 * PO-3 built the acquisition plane (Railway/Playwright → advertiser identity resolution →
 * `report_evidence_history`) and the composition plane (`buildAdvertisingSurface` →
 * `SnapshotAdvertising` → `renderPublicAdvertising`). Both ends were complete and verified, and
 * nothing joined them: `loadLatestAdsObservation` had exactly ONE occurrence in the repository —
 * its own definition. Every acquired observation was write-only, the Public Advertising section
 * was absent from every Report 1 ever produced, and enabling the acquisition flag populated the
 * database while changing nothing a customer could read.
 *
 * WHAT THIS SUITE ADDS, AND WHAT IT DELIBERATELY DOES NOT
 * `po3AdvertisingSurface.test.ts` already holds the identity matrix, the partition and the
 * renderer wording to a high bar. This suite does not restate any of that. It covers the one
 * thing that was missing — that the loader is actually CALLED from the report-generation path,
 * scoped correctly, and that its result survives to the customer with its provenance and its
 * observation boundary intact.
 *
 * The first test is a tripwire in the same spirit as D8's "liftMetrics is gone, not merely
 * unused": a unit test of the seam would have passed throughout the entire period the seam had
 * no caller.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildAdvertisingSurface, mayStateNoVerifiedCompanyAdvertising } from '../../services/ads/advertisingSurface';
import { renderPublicAdvertising } from '../../services/intelligence/exportRendererReport1';
import type { AdsObservationResult } from '../../services/ads/adsTransparencyObservation';

const REPO = join(__dirname, '..', '..', '..');
const source = (rel: string) => readFileSync(join(REPO, rel), 'utf8');

const advertiser = (over: Record<string, unknown> = {}) => ({
  observation: {
    advertiserId: 'AR01', legalName: 'ACME ANALYTICS LTD', basedIn: 'IN',
    verified: true, ambiguityFlagged: false, adCountLabel: '~40 ads',
    creativeIds: ['CR1'], profileUrl: 'https://adstransparency.google.com/advertiser/AR01',
  },
  resolution: { state: 'MATCHED', basis: 'declared legal name matched a verified advertiser', eligibleForCompanyClaim: true },
  discoveredVia: 'name',
  ...over,
});

const observation = (over: Partial<AdsObservationResult> = {}): AdsObservationResult => ({
  accessState: 'observed',
  reason: null,
  vantage: 'railway/in',
  observedAt: '2026-09-27T08:09:59.384Z',
  advertisers: [advertiser()],
  counts: { domainAdCountLabel: '~120 ads', advertiserAccountsDiscovered: 3 },
  ...over,
} as AdsObservationResult);

const surfaceFor = (obs: AdsObservationResult, legalName: string | null = 'ACME ANALYTICS LTD') =>
  buildAdvertisingSurface({ observation: obs, subjectLegalNameUsed: legalName });

const render = (obs: AdsObservationResult | null, legalName: string | null = 'ACME ANALYTICS LTD') =>
  renderPublicAdvertising(
    { report1: { advertising: obs ? surfaceFor(obs, legalName) : null } } as never,
    'Evidence',
  );

const decode = (html: string) =>
  html.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');

describe('REMEDIATION-006 — the ads read seam', () => {
  // ── The regression that made every other ads test insufficient ──────────
  describe('the loader has a production caller', () => {
    const assembly = () => source('backend/services/reportCardServiceAssembly.ts');

    it('reportCardServiceAssembly imports and calls loadLatestAdsObservation', () => {
      const src = assembly();
      expect(src).toContain('loadLatestAdsObservation');
      expect(src).toMatch(/await loadLatestAdsObservation\(/);
    });

    it('passes the result into the composer as advertisingObservation', () => {
      expect(assembly()).toMatch(/advertisingObservation,/);
    });

    it('scopes the read by company AND domain, never company alone', () => {
      const src = assembly();
      expect(src).toMatch(/companyId: report\.company_id/);
      expect(src).toMatch(/domainId: domainScope\?\.domainId \?\? null/);
    });

    it('Report 1 never fetches Ads Transparency itself — one acquisition path only', () => {
      const src = assembly();
      // The composition plane reads what Railway persisted. No browser, no provider call.
      expect(src).not.toMatch(/adsTransparencyBrowserClient|observePublicAdvertising|chromium/);
    });

    it('is snapshot-only — growth and performance carry no advertising surface', () => {
      const src = assembly();
      const at = src.indexOf('loadLatestAdsObservation');
      const growthAt = src.indexOf("composeGrowthReport");
      const perfAt = src.indexOf('composePerformanceIntelligenceReport');
      // The call sits after both alternative branches, inside the else.
      expect(at).toBeGreaterThan(growthAt);
      expect(at).toBeGreaterThan(perfAt);
    });
  });

  // ── Provenance (§6, §J) ─────────────────────────────────────────────────
  describe('provenance', () => {
    it('a qualifying ads observation is PUBLIC_OBSERVED', () => {
      const s = surfaceFor(observation());
      expect(s.provenance).toBe('PUBLIC_OBSERVED');
      expect(s.source).toBe('ads_transparency');
    });

    it('carries no company-declared or platform-activity origin', () => {
      const s = surfaceFor(observation());
      expect(JSON.stringify(s)).not.toMatch(/company_declared|platform_activity|COMPANY_CONFIRMED|OMNIVYRA_OBSERVED/);
    });
  });

  // ── Freshness (§13) ─────────────────────────────────────────────────────
  describe('observation recency', () => {
    it('the observation timestamp survives to the surface', () => {
      expect(surfaceFor(observation()).observedAt).toBe('2026-09-27T08:09:59.384Z');
    });

    it('an older observation keeps its own timestamp — none is invented', () => {
      const old = observation({ observedAt: '2026-01-01T00:00:00.000Z' });
      expect(surfaceFor(old).observedAt).toBe('2026-01-01T00:00:00.000Z');
    });
  });

  // ── "No observation" is not "no ads" (§5) ───────────────────────────────
  describe('absence semantics', () => {
    it('a null observation renders nothing rather than asserting no advertising', () => {
      const html = decode(render(null));
      expect(html).toBe('');
    });

    it('a failed access state states the boundary explicitly rather than implying absence', () => {
      const html = decode(render(observation({ accessState: 'blocked', reason: 'provider blocked the vantage', advertisers: [] })));
      // The renderer carries the disclaimer verbatim. Asserting its PRESENCE is the right test:
      // a naive `not.toMatch(/does not advertise/)` fails against the very sentence that proves
      // the guard works, because the guard is phrased as a negation of that claim.
      expect(html).toContain('This is not a finding that the company does not advertise.');
      expect(html).toContain('provider blocked the vantage');
      // What must NOT appear is an affirmative claim of absence.
      expect(html).not.toMatch(/\bno ads are being run\b|\bthe company is not advertising\b|\bruns no advertising\b/i);
    });

    it('"no verified company advertising" requires a declared legal name to have been used', () => {
      const none = observation({ advertisers: [] });
      expect(mayStateNoVerifiedCompanyAdvertising(surfaceFor(none, 'ACME ANALYTICS LTD'))).toBe(true);
      // Without one, MATCHED was structurally unreachable, so absence proves nothing.
      expect(mayStateNoVerifiedCompanyAdvertising(surfaceFor(none, null))).toBe(false);
    });
  });

  // ── Ambiguous identity is never silently owned (§3, §4) ─────────────────
  describe('identity safety through the integration', () => {
    const ambiguous = (state: string) => observation({
      advertisers: [advertiser({
        resolution: { state, basis: `resolution ended as ${state}`, eligibleForCompanyClaim: false },
      })],
    } as Partial<AdsObservationResult>);

    it.each(['PROBABLE_MATCH', 'NOT_MATCHED', 'UNRESOLVED', 'INSUFFICIENT_EVIDENCE'])(
      '%s never lands in companyAdvertisers',
      (state) => {
        const s = surfaceFor(ambiguous(state));
        expect(s.companyAdvertisers).toHaveLength(0);
        expect(s.counts.matchedAdvertiserAccounts).toBe(0);
        expect(s.otherAdvertisers).toHaveLength(1);
      },
    );

    it('only MATCHED is eligible for a company claim', () => {
      expect(surfaceFor(observation()).companyAdvertisers).toHaveLength(1);
    });
  });

  // ── No performance claims (§10, §M) ─────────────────────────────────────
  describe('no performance metrics are introduced', () => {
    it('neither the surface nor the rendered output claims spend, CTR, ROAS, CAC or revenue', () => {
      const s = JSON.stringify(surfaceFor(observation()));
      const html = decode(render(observation()));
      for (const blob of [s, html]) {
        expect(blob).not.toMatch(/\bCTR\b|\bROAS\b|\bCAC\b|impressions|click-through|conversion rate|ad spend|revenue/i);
      }
    });

    it('the provider ad-count label is carried verbatim, never re-derived into a number', () => {
      // `~40 ads` is the provider's own rounded statement. It must not become 40.
      expect(surfaceFor(observation()).companyAdvertisers[0].adCountLabel).toBe('~40 ads');
    });
  });

  // ── The observation actually reaches the customer ───────────────────────
  describe('rendered output', () => {
    it('renders the advertising section for a matched observation', () => {
      const html = decode(render(observation()));
      expect(html.length).toBeGreaterThan(0);
      expect(html).toMatch(/ACME ANALYTICS LTD/);
    });

    it('does not expose internal resolution enum names to the customer', () => {
      const html = decode(render(observation()));
      expect(html).not.toMatch(/PROBABLE_MATCH|INSUFFICIENT_EVIDENCE|eligibleForCompanyClaim/);
    });
  });
});
