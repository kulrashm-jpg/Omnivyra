/**
 * Phase 19 — deterministic business-impact / relationship graph. Pure, no DB.
 * Proves: known issues map to explicit cascades; UNKNOWN keys derive impact from their
 * module (extensibility — a future engine appears with no edits); ROI is deterministic.
 */
import { buildBusinessImpact, estimateROI, aggregateBusinessImpact } from '../../services/websiteIntelligence/businessImpactGraph';

describe('Business impact graph', () => {
  it('maps a known issue to its explicit cascade + dimensions', () => {
    const a = buildBusinessImpact('pricing_visibility', ['content_analysis'], 'high');
    expect(a.cascade).toContain('Lower revenue confidence');
    expect(a.dimensions.revenue).toBeGreaterThan(0);
    expect(a.dimensions.conversion).toBeGreaterThan(0);
    expect(a.score).toBeGreaterThan(0);
    // deterministic
    const b = buildBusinessImpact('pricing_visibility', ['content_analysis'], 'high');
    expect(b).toEqual(a);
  });

  it('derives impact for an UNKNOWN key from its module (extensible to future engines)', () => {
    const r = buildBusinessImpact('some_future_engine_finding', ['technical'], 'medium');
    expect(Object.keys(r.dimensions).length).toBeGreaterThan(0); // not empty — derived from module
    expect(r.dimensions.technical).toBeGreaterThan(0);
    expect(r.cascade.length).toBeGreaterThan(0);
  });

  it('scales by impact level and computes ROI vs effort deterministically', () => {
    const high = buildBusinessImpact('https', ['technical'], 'high');
    const low = buildBusinessImpact('https', ['technical'], 'low');
    expect(high.score).toBeGreaterThan(low.score);
    expect(estimateROI(80, 'low')).toBe('high');
    expect(estimateROI(80, 'high')).toBe('medium');
    expect(estimateROI(20, 'high')).toBe('low');
  });

  it('aggregates per-issue impacts into a website-level profile', () => {
    const agg = aggregateBusinessImpact([
      buildBusinessImpact('https', ['technical'], 'high'),
      buildBusinessImpact('cta_quality', ['content_analysis'], 'high'),
    ]);
    expect(agg.topDimensions.length).toBeGreaterThan(0);
    expect(typeof agg.summary).toBe('string');
  });
});
