/**
 * BETA-REPORT-EXEC-010 — HTML/PDF truth rendering (renders EXEC-005/007/008/009 payload truth).
 *
 * Verifies (a) the export payload now CARRIES the payload-truth fields (no longer stripped at the boundary),
 * and (b) the live dossier renderer surfaces them in executive language — and renders NOTHING when there is
 * nothing material. No recompute, no derivation; pure pass-through + render.
 */
import { buildCanonicalExport, type CanonicalExportPayload } from '../../services/intelligence/canonicalExport';
import { renderReportDisclosures } from '../../services/intelligence/exportRenderer';

const P = (o: unknown): CanonicalExportPayload => o as CanonicalExportPayload;

describe('BETA-REPORT-EXEC-010 — export payload carries the truth fields', () => {
  it('buildCanonicalExport passes through commercial_roi, override_disclosure, authority_trajectory', () => {
    const report = {
      scan_metadata: { persisted_at: null },
      authority_overview: {}, maturity_stage: {}, pillars: [], executive_insights: {},
      action_playbook: {}, strategic_playbook: {}, ai_surface_presence: {}, knowledge_graph: {},
      authority_inflow: {}, trust_coherence: {}, benchmark: {},
      competitive_surface_share: { provenance: { measured: true, basis: 'crawl' } },
      change_intelligence: {}, forecast: {},
      commercial_roi: { status: 'not_determinable', label: 'Not Quantifiable', basis: 'No commercial evidence.', unlock: 'Connect a source.', quantified: null, confidence: 'none', limitations: [] },
      override_disclosure: { material_override_count: 0, disclosures: [], note: '' },
      authority_trajectory: { snapshots: [], forecast: null, available: false, provenance: { history: 'unavailable', history_count: 0, classification: 'insufficient_history', forecast: 'unavailable', basis: 'x', limitations: [], reason_unavailable: null } },
    } as never;
    const payload = buildCanonicalExport({ shape: 'executive', tenantId: 't', companyId: 'c', report });
    expect(payload.commercial_roi).toBe((report as { commercial_roi: unknown }).commercial_roi);
    expect(payload.override_disclosure).toBe((report as { override_disclosure: unknown }).override_disclosure);
    expect(payload.authority_trajectory).toBe((report as { authority_trajectory: unknown }).authority_trajectory);
  });
});

describe('BETA-REPORT-EXEC-010 — dossier renders the truth (executive language)', () => {
  it('renders NOTHING when no truth fields are present', () => {
    expect(renderReportDisclosures(P({}))).toBe('');
    expect(renderReportDisclosures(P({ override_disclosure: { disclosures: [] } }))).toBe('');
  });

  it('renders ROI determinability without exposing internal enums', () => {
    const html = renderReportDisclosures(P({ commercial_roi: { label: 'Not Quantifiable', basis: 'No commercial evidence.', unlock: 'Connect a source.' } }));
    expect(html).toContain('Commercial ROI');
    expect(html).toContain('Not Quantifiable');
    expect(html).toContain('Connect a source.');
    expect(html).not.toContain('not_determinable'); // never leak the enum
  });

  it('renders trajectory (measured + projected), competitor (crawl), and override disclosures', () => {
    const html = renderReportDisclosures(P({
      authority_trajectory: { provenance: { history: 'measured', forecast: 'projected', basis: 'Trend from 3 snapshots.' } },
      competitive_surface_share: { provenance: { measured: true, basis: 'Crawl-derived, not a licensed market-data panel.' } },
      override_disclosure: { disclosures: [{ override_type: 'Manual analyst review applied', affected: 'A recommendation was removed.', reason: 'analyst rationale' }] },
    }));
    expect(html).toContain('Measured history');
    expect(html).toContain('projection, not measured');
    expect(html).toContain('Public-web analysis');
    expect(html).toContain('Manual analyst review applied');
    expect(html).not.toContain('recommendation_dismissal'); // no internal kind leaked
  });

  it('labels an unavailable trajectory honestly', () => {
    const html = renderReportDisclosures(P({ authority_trajectory: { provenance: { history: 'unavailable', forecast: 'unavailable', basis: 'No history persisted.' } } }));
    expect(html).toContain('History unavailable');
  });
});
