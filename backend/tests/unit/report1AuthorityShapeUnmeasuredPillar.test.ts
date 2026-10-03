/**
 * DEFECT #12 — an UNMEASURED authority pillar satisfies "authority is below 50".
 *
 * `classifyAuthorityShape` (dossier/authorityShape.ts) names the shape printed on the
 * dossier COVER (`exportRendererOutput.ts` 557) and in the hero head
 * (`exportRendererAssembly.ts` 266), on the canonical export path behind
 * `GET /api/reports/[reportId]?format=html|pdf`.
 *
 * `pillarMap` deliberately OMITS any pillar whose score is `insufficient_signal` or
 * `unavailable`, so `m.<pillar> === undefined` is this module's "not observed" signal,
 * and each predicate picks the default that makes absence FAIL the test:
 *
 *   (m.foundation ?? 0)  >= 65      // absent -> 0  -> fails a `>=` test
 *   (m.authority ?? 100) <  40      // absent -> 100 -> fails a `<`  test
 *   (m.trust ?? 100)     <  40      // absent -> 100 -> fails a `<`  test
 *
 * One predicate broke the convention:
 *
 *   if ((m.foundation ?? 0) >= 50 && (m.authority ?? 0) < 50 && overall < 50)
 *
 * `?? 0` on a `<` test makes absence SATISFY it. An unmeasured authority pillar was
 * therefore read as an authority pillar scoring under 50, and the dossier cover named
 * the company an "Emerging Authority with Strong Foundations" — a shape whose whole
 * claim is the contrast between a measured foundation and a weak authority signal
 * ("the corroborating signals are still building") — on no authority evidence at all.
 *
 * ZERO IS NOT THE TEST. A pillar genuinely measured below 50 must still select this
 * shape; C1 pins that, so a "fix" by `=== 0` cannot pass.
 */
import { classifyAuthorityShape } from '../../services/intelligence/dossier/authorityShape';

const evidence = { count: 2, sources: ['crawler'], freshness: { last_observed_at: null, age_hours: null }, observations: [] };

const score = (value: number | null, state: string) => ({
  value,
  state,
  confidence: 'medium',
  band: value == null ? 'insufficient' : value >= 50 ? 'operational' : 'developing',
  evidence,
  benchmark: { value: null, label: null },
});

const pillar = (key: string, value: number | null, state: string) => ({
  pillar: key,
  score: score(value, state),
  dimensions: [],
});

/**
 * A realistic snapshot: foundation and the two behavioural pillars measured, the
 * authority pillar `insufficient_signal` (the documented steady state when no
 * corroboration source resolved), overall index measured below 50.
 */
const reportWithAuthority = (authorityValue: number | null, authorityState: string) =>
  ({
    pillars: [
      pillar('foundation', 55, 'measured'),
      pillar('authority', authorityValue, authorityState),
      pillar('discoverability', 42, 'measured'),
      pillar('trust', 44, 'measured'),
    ],
    authority_overview: { overall_score: score(46, 'measured') },
    ai_surface_presence: { score: score(null, 'insufficient_signal'), citation_matrix: null },
    change_intelligence: { state: 'unavailable' },
  }) as never;

describe('#12 — an unobserved authority pillar is not a low authority pillar', () => {
  it('A1: an insufficient_signal authority pillar does not select the emerging-authority shape', () => {
    const shape = classifyAuthorityShape(reportWithAuthority(null, 'insufficient_signal'));
    expect(shape.kind).not.toBe('emerging_authority_with_strong_foundations');
    expect(shape.name).not.toBe('Emerging Authority with Strong Foundations');
  });

  it('A2: an unavailable authority pillar does not select it either', () => {
    const shape = classifyAuthorityShape(reportWithAuthority(null, 'unavailable'));
    expect(shape.kind).not.toBe('emerging_authority_with_strong_foundations');
  });

  it('A3: the shape rationale never prints an em-dash where an authority score belongs', () => {
    const shape = classifyAuthorityShape(reportWithAuthority(null, 'insufficient_signal'));
    expect(shape.why_this_shape).not.toContain('authority reads —/100');
  });

  it('C1: a pillar genuinely MEASURED below 50 still selects the emerging-authority shape', () => {
    const shape = classifyAuthorityShape(reportWithAuthority(45, 'measured'));
    expect(shape.kind).toBe('emerging_authority_with_strong_foundations');
    expect(shape.why_this_shape).toContain('authority reads 45/100');
  });

  it('C2: a measured authority of exactly 0 is a measurement, and still selects it', () => {
    const shape = classifyAuthorityShape(reportWithAuthority(0, 'measured'));
    expect(shape.kind).toBe('emerging_authority_with_strong_foundations');
    expect(shape.why_this_shape).toContain('authority reads 0/100');
  });

  it('D1: with authority unmeasured the dossier falls back to an honest shape', () => {
    const shape = classifyAuthorityShape(reportWithAuthority(null, 'insufficient_signal'));
    expect(['Mixed Authority Profile', 'Fragmented Authority Presence', 'Insufficiently Measured System'])
      .toContain(shape.name);
  });

  it('non-vacuity: the fixture reaches the classifier and it reads the pillar list', () => {
    expect(typeof classifyAuthorityShape).toBe('function');
    const shape = classifyAuthorityShape(reportWithAuthority(45, 'measured'));
    expect(shape.why_this_shape).toContain('Foundation reads 55/100');
  });
});
