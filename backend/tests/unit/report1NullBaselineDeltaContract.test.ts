/**
 * WP-14 (Track M) — the null-baseline delta contract.
 *
 * ─── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * REMEDIATION-003 made `computeCompanyMetrics` return `null` unconditionally: there is no
 * observed company baseline, so none is synthesized. That was correct.
 *
 * What it left behind is a PRECONDITION that nothing enforced. `subtractMetrics(left, right)`
 * dereferences BOTH operands, and at the deployed SHA 3d643f5c both delta call sites in
 * `reportCompetitorIntelligenceServiceEngine` guarded only the competitor side:
 *
 *     deltas_vs_company: resolution.metrics ? subtractMetrics(resolution.metrics, companyMetrics) : null
 *                        ^^^^^^^^^^^^^^^^^^ competitor guarded          ^^^^^^^^^^^^^^ company NOT guarded
 *
 * Since `companyMetrics` is now ALWAYS null, every competitor whose crawl SUCCEEDED — and only
 * those, because a failed crawl yields `resolution.metrics === null` and short-circuits — reached
 * `subtractMetrics(metrics, null)`.
 *
 * WP-12 has since fixed both call sites. This suite deliberately does NOT assert the shape of
 * either call site, so it stays green across that fix. It pins the two facts the fix rests on,
 * which are the facts that will still be true afterwards:
 *
 *   1. the company baseline is null for every input (slice 003's contract), and
 *   2. `subtractMetrics` cannot accept a null baseline,
 *
 * so any present or future call site MUST guard both operands. A future edit that reintroduces a
 * one-sided guard reintroduces the defect, and these are the facts that make that a defect.
 *
 * Everything below runs the REAL production functions. Nothing is stubbed.
 */
import {
  computeCompanyMetrics,
  subtractMetrics,
} from '../../services/reportCompetitorIntelligenceServiceHelpers';
import { resolveCompetitorMetrics } from '../../services/competitor/competitorMetricsEvidence';
import type { DomainCrawlSignals } from '../../services/competitor/competitorMetricsTypes';

/** What a SUCCESSFUL crawl of one competitor's public pages observes. */
const OBSERVED_SIGNALS: DomainCrawlSignals = {
  contentScore: 88,
  keywordCoverageScore: 86,
  authorityProxy: 84,
  technicalScore: 70,
  aiAnswerPresenceScore: 82,
  extractedKeywords: ['analytics'],
  answerTopics: ['reporting'],
};

describe('WP-14 — the null company baseline is a precondition on every delta', () => {
  describe('fact 1 — the company baseline is null for every input', () => {
    it('returns null with no decisions and no resolved input', () => {
      expect(computeCompanyMetrics({ decisions: [], resolvedInput: null })).toBeNull();
    });

    it('returns null even with the richest input the old implementation keyed on', () => {
      expect(computeCompanyMetrics({
        decisions: [{ issue_type: 'content_gap' }, { issue_type: 'authority_gap' }] as never,
        resolvedInput: {
          resolved: {
            socialLinks: ['https://x.test/a'],
            geography: 'India',
            businessType: 'SaaS',
            websiteDomain: 'subject.test',
          },
        } as never,
      })).toBeNull();
    });
  });

  describe('fact 2 — a successful competitor crawl DOES produce metrics', () => {
    it('a success outcome yields a non-null metrics object even with a null baseline', () => {
      const resolution = resolveCompetitorMetrics({
        signals: OBSERVED_SIGNALS,
        crawlOutcome: 'success',
        companyMetrics: null,
      });
      expect(resolution.state).toBe('inferred');
      expect(resolution.metrics).not.toBeNull();
      expect(resolution.metrics!.content_depth).toBe(88);
    });

    it('a FAILED crawl yields null metrics, which is why only successful crawls were affected', () => {
      const resolution = resolveCompetitorMetrics({
        signals: null,
        crawlOutcome: 'client_error',
        companyMetrics: null,
      });
      expect(resolution.metrics).toBeNull();
    });
  });

  describe('fact 3 — subtractMetrics cannot accept a null baseline', () => {
    it('throws a TypeError when the company side is null', () => {
      const resolution = resolveCompetitorMetrics({
        signals: OBSERVED_SIGNALS,
        crawlOutcome: 'success',
        companyMetrics: null,
      });
      // This is the precondition. It is NOT a call-site assertion: it says only that a caller
      // reaching here with a null baseline fails, which is why both operands must be guarded.
      expect(() => subtractMetrics(resolution.metrics!, null as never)).toThrow(TypeError);
    });

    it('succeeds, and computes real deltas, once both sides are supported', () => {
      const resolution = resolveCompetitorMetrics({
        signals: OBSERVED_SIGNALS,
        crawlOutcome: 'success',
        companyMetrics: null,
      });
      const supportedCompany = {
        content_depth: 60, authority_score: 55, publishing_frequency: null,
        engagement_score: null, seo_coverage: 58, geo_presence: null, aeo_readiness: 54,
      };
      const deltas = subtractMetrics(resolution.metrics!, supportedCompany);
      expect(deltas.content_depth).toBe(28);
      expect(deltas.seo_coverage).toBe(28);
      // Neither side observed these — the delta is unavailable, never 0.
      expect(deltas.publishing_frequency).toBeNull();
      expect(deltas.engagement_score).toBeNull();
      expect(deltas.geo_presence).toBeNull();
    });
  });

  describe('the composition that matters — a two-sided guard is required', () => {
    /**
     * The correct expression: guard BOTH operands. This is what a call site must do, expressed
     * without naming any particular call site, so the suite survives WP-12's fix and any later
     * refactor of where the expression lives.
     */
    const safeDelta = (
      competitorMetrics: ReturnType<typeof resolveCompetitorMetrics>['metrics'],
      companyMetrics: Parameters<typeof subtractMetrics>[1] | null,
    ) => (competitorMetrics && companyMetrics ? subtractMetrics(competitorMetrics, companyMetrics) : null);

    it('a successful crawl against the real (null) baseline yields null, not a throw', () => {
      const companyMetrics = computeCompanyMetrics({ decisions: [], resolvedInput: null });
      const resolution = resolveCompetitorMetrics({
        signals: OBSERVED_SIGNALS,
        crawlOutcome: 'success',
        companyMetrics,
      });
      // Both real functions, composed as a correct call site must compose them.
      expect(companyMetrics).toBeNull();
      expect(resolution.metrics).not.toBeNull();
      expect(safeDelta(resolution.metrics, companyMetrics)).toBeNull();
    });

    it('a one-sided guard throws on exactly the same inputs — the defect, reproduced', () => {
      const companyMetrics = computeCompanyMetrics({ decisions: [], resolvedInput: null });
      const resolution = resolveCompetitorMetrics({
        signals: OBSERVED_SIGNALS,
        crawlOutcome: 'success',
        companyMetrics,
      });
      const oneSidedGuard = () =>
        (resolution.metrics ? subtractMetrics(resolution.metrics, companyMetrics as never) : null);
      expect(oneSidedGuard).toThrow(TypeError);
    });
  });
});
