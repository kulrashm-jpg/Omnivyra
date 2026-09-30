/**
 * REPORT-1-COMPETITIVE-BASELINE-INTEGRITY-REMEDIATION-003 — a gap needs two observed sides.
 *
 * THE DEFECT
 * `computeCompanyMetrics` synthesized all seven company-side dimensions as
 * `constant ± penalty ± presence-bonus`, where the penalties counted OUR OWN audit decisions
 * and the bonuses were booleans for whether the tenant had filled in a business type, a
 * geography, a domain or a social link. Five gap narratives then computed
 * `observed competitor average − invented company baseline` and published the difference as a
 * competitive finding, so a customer could be told a named competitor was ahead by a margin
 * that was a function of how many decisions our audit happened to emit.
 *
 * A second path republished the same fabrication as a COMPETITOR's number:
 * `resolveCompetitorMetrics` mirrored the company's `publishing_frequency`, `engagement_score`
 * and `geo_presence` onto every competitor, and the competitor radar weighted
 * `publishing_frequency` at 0.3.
 *
 * WHY THE PROVENANCE BOUNDARY DID NOT CATCH IT
 * These values never enter the evidence system: no `EvidenceObservation`, no source kind, so
 * nothing classifies them. Relabelling was not available either — there is no observation to
 * classify as PUBLIC_OBSERVED, COMPANY_CONFIRMED, INFERRED or ESTIMATED.
 *
 * NOTE ON ENFORCEMENT
 * This project compiles with `"strict": false`, so `null` in arithmetic is NOT a type error
 * and `null - 5` silently evaluates to -5. The nullable contract therefore buys no
 * compile-time protection; these tests are the enforcement.
 */
import {
  computeCompanyMetrics,
  subtractMetrics,
  averageCompetitorMetrics,
} from '../../services/reportCompetitorIntelligenceServiceHelpers';
import { buildGapDefinitions } from '../../services/reportCompetitorIntelligenceServiceEngine';
import { resolveCompetitorMetrics } from '../../services/competitor/competitorMetricsEvidence';
import type { ComparisonMetrics, DomainCrawlSignals } from '../../services/competitor/competitorMetricsTypes';

const observedCompetitor: ComparisonMetrics = {
  content_depth: 88,
  authority_score: 84,
  publishing_frequency: null,
  engagement_score: null,
  seo_coverage: 86,
  geo_presence: null,
  aeo_readiness: 82,
};

const entry = (metrics: ComparisonMetrics | null) => ({
  competitor: { name: 'Acme', domain: 'acme.test' },
  metrics,
  deltas_vs_company: null,
  metrics_state: metrics ? ('inferred' as const) : ('unavailable' as const),
  metrics_basis: 'test fixture',
  crawl_outcome: metrics ? ('success' as const) : ('not_attempted' as const),
}) as never;

const gaps = (entries: unknown[], companyMetrics: ComparisonMetrics | null) =>
  buildGapDefinitions({
    domain: 'subject.test',
    businessContext: 'testing',
    entries: entries as never,
    companyMetrics,
  });

const SIGNALS: DomainCrawlSignals = {
  contentScore: 88, keywordCoverageScore: 86, authorityProxy: 84,
  technicalScore: 70, aiAnswerPresenceScore: 82,
  extractedKeywords: ['a'], answerTopics: ['b'],
};

describe('REMEDIATION-003 — competitive baseline integrity', () => {
  // ── A. the fabricated baseline is gone ──────────────────────────────────
  describe('A. the synthesized company baseline no longer exists', () => {
    it('returns null for the inputs that previously produced seven numbers', () => {
      // These are exactly the inputs the old implementation keyed on: decision counts and
      // the four presence booleans. None of them observed the company.
      expect(computeCompanyMetrics({ decisions: [], resolvedInput: null })).toBeNull();
      expect(computeCompanyMetrics({
        decisions: [{ issue_type: 'content_gap' }, { issue_type: 'authority_gap' }] as never,
        resolvedInput: {
          resolved: {
            socialLinks: ['https://x.test/a'], geography: 'India',
            businessType: 'SaaS', websiteDomain: 'subject.test',
          },
        } as never,
      })).toBeNull();
    });

    it('emits no numeric baseline under any input — the constants are unreachable', () => {
      for (const count of [0, 1, 5, 20]) {
        const decisions = Array.from({ length: count }, () => ({ issue_type: 'content_gap' })) as never;
        expect(computeCompanyMetrics({ decisions, resolvedInput: null })).toBeNull();
      }
    });
  });

  // ── B. competitor observations survive ──────────────────────────────────
  describe('B. genuine competitor observation is preserved', () => {
    it('keeps the four crawl-derived dimensions when the company baseline is absent', () => {
      const res = resolveCompetitorMetrics({
        signals: SIGNALS, crawlOutcome: 'success', companyMetrics: null,
      });
      expect(res.state).toBe('inferred');
      expect(res.metrics).not.toBeNull();
      expect(res.metrics!.content_depth).toBe(88);
      expect(res.metrics!.authority_score).toBe(84);
      expect(res.metrics!.seo_coverage).toBe(86);
      expect(res.metrics!.aeo_readiness).toBe(82);
    });

    it('no longer mirrors the company baseline onto a competitor', () => {
      const res = resolveCompetitorMetrics({
        signals: SIGNALS, crawlOutcome: 'success', companyMetrics: null,
      });
      // The three a page crawl cannot establish are reported as unavailable, not borrowed.
      expect(res.metrics!.publishing_frequency).toBeNull();
      expect(res.metrics!.engagement_score).toBeNull();
      expect(res.metrics!.geo_presence).toBeNull();
    });

    it('an unobserved competitor still yields null metrics and keeps its outcome', () => {
      const res = resolveCompetitorMetrics({
        signals: null, crawlOutcome: 'client_error', companyMetrics: null,
      });
      expect(res.state).toBe('unavailable');
      expect(res.metrics).toBeNull();
      expect(res.crawl_outcome).toBe('client_error');
    });
  });

  // ── C. missing company baseline ⇒ no gap ────────────────────────────────
  describe('C. competitor observed, company unavailable', () => {
    it('emits NO gaps rather than treating the competitor value as the gap', () => {
      expect(gaps([entry(observedCompetitor)], null)).toEqual([]);
    });

    it('does not substitute zero, a constant or a floor', () => {
      // A competitor at 88 against an absent baseline must not surface as an 88-point,
      // 38-point (vs 50) or any other gap. Absence of output is the assertion.
      const produced = gaps([entry(observedCompetitor)], null);
      expect(produced).toHaveLength(0);
      expect(JSON.stringify(produced)).not.toMatch(/\d/);
    });
  });

  // ── D. both sides present ⇒ legitimate arithmetic still works ───────────
  describe('D. both sides supported', () => {
    const company: ComparisonMetrics = {
      content_depth: 60, authority_score: 55, publishing_frequency: null,
      engagement_score: null, seo_coverage: 58, geo_presence: null, aeo_readiness: 54,
    };

    it('still produces a gap when the comparison is mathematically meaningful', () => {
      const produced = gaps([entry(observedCompetitor)], company);
      expect(produced.length).toBeGreaterThan(0);
      expect(produced.map((g) => g.gap_type)).toContain('content_gap');
    });

    it('subtractMetrics computes real deltas and nulls the unsupported dimensions', () => {
      const d = subtractMetrics(observedCompetitor, company);
      expect(d.content_depth).toBe(28);
      expect(d.seo_coverage).toBe(28);
      // Neither side has these — the delta is unavailable, never 0.
      expect(d.publishing_frequency).toBeNull();
      expect(d.engagement_score).toBeNull();
      expect(d.geo_presence).toBeNull();
    });
  });

  // ── E. missing competitor metric ⇒ no fabricated comparison ─────────────
  describe('E. company supported, competitor unavailable', () => {
    const company: ComparisonMetrics = {
      content_depth: 60, authority_score: 55, publishing_frequency: null,
      engagement_score: null, seo_coverage: 58, geo_presence: null, aeo_readiness: 54,
    };

    it('emits no gap from an unobserved competitor', () => {
      expect(gaps([entry(null)], company)).toEqual([]);
    });

    it('averaging an all-unobserved set is null, never zeroes', () => {
      expect(averageCompetitorMetrics([entry(null), entry(null)] as never)).toBeNull();
    });

    it('both sides unavailable yields no gap', () => {
      expect(gaps([entry(null)], null)).toEqual([]);
    });
  });

  // ── the null-as-zero trap this project's compiler cannot catch ──────────
  it('never lets a null coerce to zero in a delta — strict is false, so this is runtime-enforced', () => {
    const halfObserved: ComparisonMetrics = { ...observedCompetitor, publishing_frequency: 40 };
    const company: ComparisonMetrics = {
      content_depth: 60, authority_score: 55, publishing_frequency: null,
      engagement_score: null, seo_coverage: 58, geo_presence: null, aeo_readiness: 54,
    };
    // 40 - null would be 40 under non-strict arithmetic. It must be null.
    expect(subtractMetrics(halfObserved, company).publishing_frequency).toBeNull();
  });
});
