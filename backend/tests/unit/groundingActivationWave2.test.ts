/**
 * WAVE-2-001 — canonical grounding activation tests (AI-CONTRACT-000 §C4).
 * Proves freshness enforcement (confidence degradation), the grounding floor,
 * stale surfacing, deterministic counts — over the existing transparency rollup.
 */
import {
  evaluateGrounding, enforceFreshness, freshnessFromDays,
  GROUNDING_FLOOR_THRESHOLD, recordGroundingDecision,
} from '../../services/ai/grounding';

describe('WAVE-2-001 §C4 — freshness enforcement', () => {
  it('derives status from age in days', () => {
    expect(freshnessFromDays(0)).toBe('today');
    expect(freshnessFromDays(5)).toBe('recent');
    expect(freshnessFromDays(12)).toBe('aging');
    expect(freshnessFromDays(40)).toBe('stale');
    expect(freshnessFromDays(null)).toBe('unknown');
  });
  it('degrades confidence for stale/aging data (never presents stale as current)', () => {
    expect(enforceFreshness(1.0, 'today')).toBe(1.0);
    expect(enforceFreshness(1.0, 'aging')).toBe(0.8);
    expect(enforceFreshness(1.0, 'stale')).toBe(0.5);
    expect(enforceFreshness(1.0, 'unknown')).toBe(0.7);
  });
  it('accepts 0..100 or 0..1 confidence', () => {
    const a = evaluateGrounding({ confidence: 80, freshestDays: 0, evidenceAvailable: true, groundedFrom: ['profile'], missingContext: [] });
    expect(a.rawConfidence).toBeCloseTo(0.8);
  });
});

describe('WAVE-2-001 §C4 — grounding floor + decision', () => {
  const good = { confidence: 90, freshestDays: 1, evidenceAvailable: true, groundedFrom: ['profile', 'website'], missingContext: [] };

  it('grounded when evidence present, fresh, above floor', () => {
    const d = evaluateGrounding(good, { requireGrounding: true });
    expect(d.grounded).toBe(true);
    expect(d.floorBreached).toBe(false);
    expect(d.sourceCount).toBe(2);
    expect(d.fallbackReason).toBeNull();
  });
  it('floor breached (missing_evidence) when required grounding but no evidence', () => {
    const d = evaluateGrounding({ confidence: 0, freshestDays: null, evidenceAvailable: false, groundedFrom: [], missingContext: ['profile'] }, { requireGrounding: true });
    expect(d.floorBreached).toBe(true);
    expect(d.grounded).toBe(false);
    expect(d.fallbackReason).toBe('missing_evidence');
  });
  it('floor breached (below_floor) when confidence too low', () => {
    const d = evaluateGrounding({ confidence: 5, freshestDays: 1, evidenceAvailable: true, groundedFrom: ['profile'], missingContext: [] }, { requireGrounding: true });
    expect(d.effectiveConfidence).toBeLessThan(GROUNDING_FLOOR_THRESHOLD);
    expect(d.floorBreached).toBe(true);
    expect(d.fallbackReason).toBe('below_floor');
  });
  it('optional grounding: absent evidence does NOT breach the floor', () => {
    const d = evaluateGrounding({ confidence: 0, freshestDays: null, evidenceAvailable: false, groundedFrom: [], missingContext: [] }, { requireGrounding: false });
    expect(d.floorBreached).toBe(false);
  });
  it('stale evidence surfaces isStale + fallbackReason stale (still grounded, lower confidence)', () => {
    const d = evaluateGrounding({ confidence: 90, freshestDays: 60, evidenceAvailable: true, groundedFrom: ['website'], missingContext: [] }, { requireGrounding: true });
    expect(d.isStale).toBe(true);
    expect(d.freshnessStatus).toBe('stale');
    expect(d.effectiveConfidence).toBeLessThan(d.rawConfidence);
    expect(d.fallbackReason).toBe('stale');
    expect(d.grounded).toBe(true); // stale but present — degraded, not fabricated
  });
  it('never fabricates: missing evidence → grounded=false, no invented sources', () => {
    const d = evaluateGrounding({ confidence: 75, freshestDays: null, evidenceAvailable: false, groundedFrom: [], missingContext: ['profile'] }, { requireGrounding: true });
    expect(d.sourceCount).toBe(0);
    expect(d.evidenceCount).toBe(0);
    expect(d.grounded).toBe(false);
  });
  it('observability is fail-safe (never throws)', () => {
    const d = evaluateGrounding(good);
    expect(() => recordGroundingDecision(d, { surface: 'test', retrievalLatencyMs: 5 })).not.toThrow();
  });
});
