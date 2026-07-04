/**
 * BETA-REPORT-EXEC-009 — Analyst/governance override transparency (BR-H-005).
 *
 * Verifies deterministic, executive-language disclosure of MATERIAL overrides only: evidence suppression,
 * recommendation dismissal, provider/governance exclusion, and classification are disclosed with honest
 * changed-flags; non-material overrides (analyst notes) are NOT disclosed; no overrides → empty (display
 * nothing). Reuses the report's own active_overrides + governance; no internal terminology exposed.
 */
import { resolveOverrideTransparency } from '../../services/canonicalReport/reportOverrideTransparency';

const by = (kind: string, reason = 'analyst rationale', createdByKind = 'analyst') => ({
  id: `o-${kind}`, kind, target_summary: '{"internal":"json"}', reason,
  created_at: '2026-02-01T00:00:00.000Z', created_by: { id: 'a1', kind: createdByKind, label: 'Analyst' },
});
const gov = (excluded: string[] = []) => ({ excluded_providers: excluded });

describe('BETA-REPORT-EXEC-009 — override transparency (BR-H-005)', () => {
  it('displays nothing when no override exists', () => {
    const t = resolveOverrideTransparency([], gov());
    expect(t.material_override_count).toBe(0);
    expect(t.disclosures).toEqual([]);
    expect(t.note).toBe('');
  });

  it('discloses evidence suppression as a material score/evidence change (executive language)', () => {
    const t = resolveOverrideTransparency([by('evidence_suppression')], gov());
    expect(t.material_override_count).toBe(1);
    const d = t.disclosures[0];
    expect(d.override_type).toBe('Manual analyst review applied');
    expect(d.evidence_changed).toBe(true);
    expect(d.score_changed).toBe(true);
    expect(d.presentation_only).toBe(false);
    expect(d.reason).toBe('analyst rationale');
    expect(d.affected).not.toContain('json'); // never exposes the raw internal target
  });

  it('discloses a recommendation dismissal as a recommendation change', () => {
    const t = resolveOverrideTransparency([by('recommendation_dismissal')], gov());
    const d = t.disclosures[0];
    expect(d.recommendation_changed).toBe(true);
    expect(d.evidence_changed).toBe(false);
    expect(d.score_changed).toBe(false);
  });

  it('classification overrides are presentation-only (score not changed)', () => {
    const t = resolveOverrideTransparency([by('vertical_classification')], gov());
    const d = t.disclosures[0];
    expect(d.override_type).toBe('Analyst classification applied');
    expect(d.presentation_only).toBe(true);
    expect(d.score_changed).toBe(false);
  });

  it('does NOT disclose non-material overrides (analyst notes)', () => {
    const t = resolveOverrideTransparency([by('analyst_note')], gov());
    expect(t.material_override_count).toBe(0);
    expect(t.note).toBe('');
  });

  it('discloses governance provider exclusions when no explicit override covers them', () => {
    const t = resolveOverrideTransparency([], gov(['ahrefs', 'gsc']));
    expect(t.material_override_count).toBe(1);
    expect(t.disclosures[0].override_type).toBe('Governance rule applied');
    expect(t.disclosures[0].origin).toBe('Governance policy');
  });

  it('does not double-count governance exclusion when a provider_exclusion override exists', () => {
    const t = resolveOverrideTransparency([by('provider_exclusion')], gov(['ahrefs']));
    expect(t.disclosures.filter((d) => d.override_type === 'Governance rule applied').length).toBe(1);
  });

  it('is deterministic and order-stable', () => {
    const overrides = [by('recommendation_dismissal'), by('evidence_suppression')];
    const a = resolveOverrideTransparency(overrides, gov(['x']));
    const b = resolveOverrideTransparency(overrides, gov(['x']));
    expect(a).toEqual(b);
  });
});
