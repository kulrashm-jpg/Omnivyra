/**
 * GAP-20 — the trust-coherence sentence must name the evidence that produced the number.
 *
 * THE DEFECT (wording only)
 * The Trust & Reputation data-source panel rendered:
 *
 *     "Trust coherence reads 65/100 across consistency, review, and expertise signals."
 *
 * naming REVIEW as a contributing signal. In production `trust_coherence` is measured from the
 * Brand Intelligence engine's on-site brand-health proxy — a single `brand_health` observation with
 * `sources: ["crawler"]` — while `review_sources` holds zero rows. No review evidence contributed.
 *
 * WHAT THIS IS NOT
 * The score was never challenged and is not touched: value, state, band, confidence, source
 * attribution and the `brand_health` observation are all unchanged. Nor is the "Connected" status
 * label touched — a prior audit established it derives from `statusFromScore` (score state), not
 * from connector status, and is NOT an evidence-integrity defect. This is one sentence.
 */
import { buildDataSourceStatusPanels } from '../../services/intelligence/dossier/intelligenceSurfacesBenchmarks';
import type { CanonicalReport } from '../../services/canonicalReport/canonicalReportTypes';

type ScoreState = 'measured' | 'inferred' | 'insufficient_signal' | 'unavailable';

/** A report whose trust_coherence mirrors production: brand-health only, no review evidence. */
function report(trust: { value: number | null; state: ScoreState }): CanonicalReport {
  const score = (value: number | null, state: ScoreState) => ({
    value, state, band: 'operational', confidence: 'low',
    evidence: {
      count: value == null ? 0 : 1,
      sources: value == null ? [] : ['crawler'],
      observations: value == null ? [] : [{ signal: 'brand_health', source: 'crawler', observed_at: null }],
      freshness: { age_hours: null, last_observed_at: null },
      provenance: { classes: ['PUBLIC_OBSERVED'], excluded: [], excludedSources: [], report1Clean: true },
    },
    benchmark: { value: null, label: null },
  });
  return {
    pillars: [{
      key: 'trust', label: 'Trust', score: score(trust.value, trust.state),
      dimensions: [{ key: 'trust_coherence', label: 'Trust Coherence', score: score(trust.value, trust.state) }],
    }],
    ai_surface_presence: { score: score(0, 'inferred'), citation_matrix: null },
    knowledge_graph: { score: score(null, 'insufficient_signal'), entity: null },
    authority_inflow: { score: score(null, 'insufficient_signal'), profile: null },
    trust_coherence: { score: score(trust.value, trust.state), signals: null },
    scan_metadata: { persisted_at: null },
  } as unknown as CanonicalReport;
}

const trustPanel = (r: CanonicalReport) =>
  buildDataSourceStatusPanels(r).panels.find((p) => p.source_label === 'Trust & Reputation')!;

describe('GAP-20 — trust-coherence wording names the evidence that produced it', () => {
  // ── 1. The misleading enumeration is gone ─────────────────────────────────
  describe('1. the old phrase is no longer emitted', () => {
    it('does not claim review or expertise signals contributed', () => {
      const state = trustPanel(report({ value: 65, state: 'measured' })).current_state;
      expect(state).not.toContain('across consistency, review, and expertise signals');
      expect(state).not.toMatch(/\breview\b/i);
      expect(state).not.toMatch(/\bexpertise\b/i);
      expect(state).not.toMatch(/\bconsistency\b/i);
    });
  });

  // ── 2. The new wording describes the real evidence ────────────────────────
  describe('2. it names the evidence that actually produced the number', () => {
    it('attributes the reading to on-site brand-health evidence', () => {
      expect(trustPanel(report({ value: 65, state: 'measured' })).current_state)
        .toBe('Trust coherence reads 65/100 from on-site brand-health evidence.');
    });

    it('reuses the canonical contract vocabulary rather than inventing a second one', () => {
      // canonicalReportTypes describes this dimension as "Measured from on-site brand-health evidence".
      expect(trustPanel(report({ value: 65, state: 'measured' })).current_state)
        .toContain('on-site brand-health evidence');
    });
  });

  // ── 3. Still dynamic ──────────────────────────────────────────────────────
  describe('3. the sentence remains valid for any measured value', () => {
    it.each([0, 12, 65, 88, 100])('renders correctly for %i', (value) => {
      expect(trustPanel(report({ value, state: 'measured' })).current_state)
        .toBe(`Trust coherence reads ${value}/100 from on-site brand-health evidence.`);
    });

    it('does not hard-code 65', () => {
      expect(trustPanel(report({ value: 42, state: 'measured' })).current_state).toContain('42/100');
      expect(trustPanel(report({ value: 42, state: 'measured' })).current_state).not.toContain('65');
    });
  });

  // ── 4. No review contribution implied ─────────────────────────────────────
  describe('4. no review/reputation contribution is implied', () => {
    it('implies no review contribution while review_sources is empty', () => {
      // The fixture carries exactly what production carries: one brand_health crawler observation.
      const r = report({ value: 65, state: 'measured' });
      const dim = r.pillars[0].dimensions[0];
      expect(dim.score.evidence.sources).toEqual(['crawler']);
      expect(dim.score.evidence.observations.map((o) => o.signal)).toEqual(['brand_health']);
      expect(trustPanel(r).current_state).not.toMatch(/review/i);
    });

    it('still names review parity as something NOT yet contributing', () => {
      // `what_unlocks` is a forward-looking field and is deliberately unchanged.
      expect(trustPanel(report({ value: 65, state: 'measured' })).what_unlocks)
        .toBe('Review parity · NAP consistency · expertise extraction');
    });
  });

  // ── 5-6. Score and status behaviour untouched ─────────────────────────────
  describe('5-6. score and status semantics are unchanged', () => {
    it('leaves value, state, band, confidence and sources alone', () => {
      const r = report({ value: 65, state: 'measured' });
      trustPanel(r);
      const s = r.pillars[0].dimensions[0].score;
      expect(s.value).toBe(65);
      expect(s.state).toBe('measured');
      expect(s.band).toBe('operational');
      expect(s.confidence).toBe('low');
      expect(s.evidence.sources).toEqual(['crawler']);
    });

    it('keeps "Connected" derived from score state, not connector status', () => {
      // Prior audit: NOT an evidence-integrity defect. Must remain exactly as-is.
      expect(trustPanel(report({ value: 65, state: 'measured' })).status).toBe('connected');
      expect(trustPanel(report({ value: 65, state: 'measured' })).status_label).toBe('Connected');
      expect(trustPanel(report({ value: 40, state: 'inferred' })).status).toBe('partial');
      expect(trustPanel(report({ value: null, state: 'unavailable' })).status).toBe('disabled');
    });

    it('keeps the impact line unchanged', () => {
      expect(trustPanel(report({ value: 65, state: 'measured' })).impact)
        .toBe('Trust & Consistency section reads measured signals.');
    });
  });

  // ── 7. Unmeasured / insufficient behaviour unchanged ──────────────────────
  describe('7. non-measured states are untouched', () => {
    it('keeps the inferred wording', () => {
      expect(trustPanel(report({ value: 40, state: 'inferred' })).current_state)
        .toBe('Trust signals are inferred from public-facing surfaces only.');
    });

    it('keeps the not-connected wording, which correctly mentions review sources', () => {
      // Saying no review source is connected is TRUE and is the honest abstention — unchanged.
      expect(trustPanel(report({ value: null, state: 'insufficient_signal' })).current_state)
        .toBe('No review or reputation source is connected yet.');
      expect(trustPanel(report({ value: null, state: 'unavailable' })).current_state)
        .toBe('No review or reputation source is connected yet.');
    });
  });
});
