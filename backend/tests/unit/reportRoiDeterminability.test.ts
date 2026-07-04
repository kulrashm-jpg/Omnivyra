/**
 * BETA-REPORT-EXEC-005 — Report ROI determinability (BR-H-004).
 *
 * Verifies the honest ROI-state resolution: `not_determinable` ("Not Quantifiable") when no commercial
 * evidence exists (the live state), `estimated` for a native-unit opportunity (never monetized), `measured`
 * only when real revenue evidence backs it. No currency is ever fabricated. Deterministic.
 */
import {
  resolveReportRoiDeterminability,
} from '../../services/canonicalReport/reportRoiDeterminability';

describe('BETA-REPORT-EXEC-005 — ROI determinability (BR-H-004)', () => {
  it('defaults to Not Quantifiable with no evidence (the current live state)', () => {
    const r = resolveReportRoiDeterminability();
    expect(r.status).toBe('not_determinable');
    expect(r.label).toBe('Not Quantifiable');
    expect(r.quantified).toBeNull();
    expect(r.unlock).toMatch(/connect a commercial data source/i);
    expect(r.confidence).toBe('none');
    expect(r.limitations.length).toBeGreaterThan(0);
  });

  it('never fabricates currency in the not-determinable state', () => {
    const r = resolveReportRoiDeterminability({ hasCommercialEvidence: false });
    const blob = JSON.stringify(r).toLowerCase();
    expect(blob).not.toContain('$');
    expect(blob).not.toMatch(/\busd\b/);
    expect(r.quantified).toBeNull();
  });

  it('reports Estimated (native units) for a deterministic opportunity — not monetized', () => {
    const r = resolveReportRoiDeterminability({ quantified: { value: 1200, unit: 'additional_clicks_per_period' } });
    expect(r.status).toBe('estimated');
    expect(r.label).toBe('Estimated (native units)');
    expect(r.quantified).toEqual({ value: 1200, unit: 'additional_clicks_per_period' });
    expect(r.status).not.toBe('measured'); // native units are never claimed as measured revenue
    expect(r.unlock).toMatch(/monetize/i);
  });

  it('reports Quantified only when measured revenue evidence backs the quantity', () => {
    const r = resolveReportRoiDeterminability({
      measuredRevenue: true, quantified: { value: 4200, unit: 'revenue_usd' },
    });
    expect(r.status).toBe('measured');
    expect(r.label).toBe('Quantified');
    expect(r.unlock).toBeNull();
    expect(r.confidence).toBe('high');
  });

  it('is deterministic', () => {
    const a = resolveReportRoiDeterminability({ quantified: { value: 10, unit: 'reviews' } });
    const b = resolveReportRoiDeterminability({ quantified: { value: 10, unit: 'reviews' } });
    expect(a).toEqual(b);
  });
});
