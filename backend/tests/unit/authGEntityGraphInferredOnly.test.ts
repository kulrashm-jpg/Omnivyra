/**
 * AUTH-G-004 — ON-PAGE TOKEN REPETITION IS NOT KNOWLEDGE-GRAPH STRENGTH.
 *
 * THE DEFECT. `dimEntityGraphStrength` took its state from
 * `axis_states.entity_clarity_score`, and `geoAeoSummaryHelpers.axisStateFromValue`
 * returns `'measured'` for ANY numeric value. The value itself is
 * `publicDomainAuditService.entity_clarity_score`, computed from `titleTokenCounts` as
 * the mean over candidate tokens of
 *
 *     ((count / max(2, headings)) × 140) × 0.6  +  ((pagesContaining / pages) × 100) × 0.4
 *
 * — i.e. how often the site repeats its own title tokens across its own headings and
 * pages. It was published as a MEASURED "Entity Graph Strength" inside the Authority
 * pillar, under a rationale claiming "sameAs linkage". A site that repeats its brand
 * name in every H1 scored as a well-linked knowledge-graph entity. Nothing external
 * was consulted.
 *
 * THE CONTRACT UNDER TEST. This is the D1 pattern already corrected for
 * `ai_surface_presence` in the same file: on-page structure PREDICTS entity clarity, it
 * never WITNESSES an entity graph, so `inferred` is the ceiling. No value changes —
 * `inferred` aggregates exactly like `measured` under `isMeasured` — so this is a
 * labelling correction, not a suppression.
 *
 * SECRETS: all synthetic. No network, no credential, no real property.
 */

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

import {
  DIMENSION_BUILDERS,
  groupDimensionsByPillar,
  isMeasured,
} from '../../services/canonicalReport/canonicalReportBuilderInputs';

/** Build the Entity Graph Strength dimension from a given entity-clarity reading. */
const entityDimension = (value: number | null, axisState?: string) =>
  DIMENSION_BUILDERS.entity_graph_strength({
    snapshot: {
      geo_aeo_visuals: {
        ai_answer_presence_radar: {
          entity_clarity_score: value,
          axis_states: axisState ? { entity_clarity_score: axisState } : undefined,
        },
      },
      visual_intelligence: { seo_capability_radar: {} },
    },
  } as never);

// ── 1. THE CAP ──────────────────────────────────────────────────────────────

describe('AUTH-G-004 — an on-page entity heuristic is never `measured`', () => {
  it('a numeric entity_clarity_score is INFERRED, not measured', () => {
    const dim = entityDimension(74);
    // THE DEFECT, as it was: 'measured' — an external-authority claim from title tokens.
    expect(dim.score.state).not.toBe('measured');
    expect(dim.score.state).toBe('inferred');
  });

  it('a `measured` axis hint does not override the cap', () => {
    // `axisStateFromValue` returns 'measured' for any number, which is exactly how the
    // false claim arrived. The cap is applied here rather than trusting the hint.
    expect(entityDimension(74, 'measured').score.state).toBe('inferred');
    expect(entityDimension(92, 'measured').score.state).toBe('inferred');
  });

  it('no reading at all is still insufficient_signal', () => {
    const dim = entityDimension(null);
    expect(dim.score.value).toBeNull();
    expect(dim.score.state).toBe('insufficient_signal');
  });

  it('stops claiming sameAs linkage it never observed', () => {
    const dim = entityDimension(74);
    expect(dim.rationale).not.toMatch(/sameAs linkage, topical entity coverage/i);
    expect(dim.rationale).toMatch(/not a measurement of knowledge-graph presence/i);
    expect(dim.rationale).toMatch(/unlock/i);
  });

  it('still declares its evidence as crawl-derived, because that is what it is', () => {
    const dim = entityDimension(74);
    expect(dim.score.evidence.sources).toContain('crawler');
    expect(dim.score.evidence.sources).not.toContain('wikidata');
  });
});

// ── 2. NON-VACUITY — THE VALUE AND THE PILLAR SURVIVE ───────────────────────

describe('AUTH-G-004 non-vacuity — a labelling correction, not a suppression', () => {
  it('the value is unchanged and still counts toward the Authority pillar', () => {
    const dim = entityDimension(74);
    expect(dim.score.value).toBe(74);
    // `aggregatePillarScore` filters on `isMeasured`, which admits `inferred`. The axis
    // still contributes; it simply no longer claims to be an external measurement.
    expect(isMeasured(dim.score.value, dim.score.state)).toBe(true);
  });

  it('the Authority pillar still aggregates the reading', () => {
    const dim = entityDimension(74);
    const authority = groupDimensionsByPillar([dim]).find((p) => p.pillar === 'authority');
    expect(authority?.score.value).toBe(74);
    expect(authority?.score.state).toBe('measured');
    expect(authority?.dimensions).toHaveLength(1);
  });

  it('a strong reading still reads strong and a weak one still reads weak', () => {
    expect(entityDimension(91).score.value).toBe(91);
    expect(entityDimension(12).score.value).toBe(12);
    expect(entityDimension(91).score.state).toBe('inferred');
    expect(entityDimension(12).score.state).toBe('inferred');
  });

  it('it stays in the authority pillar under its own label', () => {
    const dim = entityDimension(74);
    expect(dim.key).toBe('entity_graph_strength');
    expect(dim.pillar).toBe('authority');
    expect(dim.label).toBe('Entity Graph Strength');
  });
});
