/**
 * PHASE 2 — GEO abstention + decision.
 *
 * Production report 3a0c23b3-2648-4159-a399-6b83b2a24aaf told a real customer:
 *
 *   "Answer coverage is measured at 0/100."      confidence: high, severity: critical
 *   "Citation readiness is measured at 0/100."
 *
 * while the SAME report's evidence_coverage said "AI answer-engine coverage is limited
 * (0% of checks measured)" and score.dimensions.aeo correctly carried
 * { state: 'insufficient_signal', value: null, evidence_count: 0 }.
 *
 * Nothing in this section ever observed an answer engine. The axes rate the WEBSITE --
 * heading structure, citation-shaped phrasing, entity mentions. Calling that "measured"
 * reads to a CMO as "AI engines were checked and you appear nowhere", which is a claim
 * no evidence in this report supports.
 *
 * These tests lock three things: the word is gone, the evidence basis is stated, and the
 * customer still gets a decision rather than a blank section.
 */
import { buildGeoAeoExecutiveSummary } from '../../services/snapshotReport/geoAeoSummaryHelpers';
import type { SnapshotReport } from '../../services/snapshotReportTypes';

type Visuals = SnapshotReport['geo_aeo_visuals'];

/** Structural readiness present (the Drishiq shape): axes scored, zero AI retrieval. */
function visualsWithStructure(scores: {
  answer?: number | null; entity?: number | null; authority?: number | null;
  citation?: number | null; structure?: number | null;
} = {}): Visuals {
  return {
    ai_answer_presence_radar: {
      answer_coverage_score: scores.answer ?? 0,
      entity_clarity_score: scores.entity ?? 40,
      topical_authority_score: scores.authority ?? 30,
      citation_readiness_score: scores.citation ?? 0,
      content_structure_score: scores.structure ?? 20,
      freshness_score: 50,
      confidence: 'high',
      state: 'inferred',
      source_tags: ['crawler', 'content', 'structure'],
      axis_states: {},
    },
    answer_extraction_funnel: {
      drop_off_reason_distribution: { answer_gap_pct: 80, structure_gap_pct: 60, citation_gap_pct: 70 },
    },
    entity_authority_map: { entities: [{ name: 'Drishiq', mentions: 3 }] },
    query_answer_coverage_map: {
      queries: [
        { query: 'structured thinking tool', coverage: 'missing', answer_quality_score: 10 },
        { query: 'decision support app', coverage: 'partial', answer_quality_score: 30 },
      ],
    },
  } as unknown as Visuals;
}

/** No structural evidence at all. */
function visualsWithNothing(): Visuals {
  return {
    ai_answer_presence_radar: {
      answer_coverage_score: null, entity_clarity_score: null, topical_authority_score: null,
      citation_readiness_score: null, content_structure_score: null, freshness_score: null,
      confidence: 'low', state: 'insufficient_signal', source_tags: null, axis_states: {},
    },
    answer_extraction_funnel: {
      drop_off_reason_distribution: { answer_gap_pct: null, structure_gap_pct: null, citation_gap_pct: null },
    },
    entity_authority_map: { entities: [] },
    query_answer_coverage_map: { queries: [] },
  } as unknown as Visuals;
}

describe('GEO never reports structural inference as a measured AI observation', () => {
  it('does not use the word "measured" in any action reasoning', () => {
    const summary = buildGeoAeoExecutiveSummary({ geoAeoVisuals: visualsWithStructure() });
    expect(summary.top_3_actions.length).toBeGreaterThan(0);
    for (const action of summary.top_3_actions) {
      expect(action.reasoning).not.toMatch(/is measured at/);
      expect(action.reasoning).not.toMatch(/\bmeasured\b/);
    }
  });

  it('never publishes the exact production string', () => {
    const summary = buildGeoAeoExecutiveSummary({ geoAeoVisuals: visualsWithStructure() });
    const blob = JSON.stringify(summary);
    expect(blob).not.toContain('Answer coverage is measured at 0/100');
    expect(blob).not.toContain('Citation readiness is measured at 0/100');
  });

  it('attributes each axis to the public crawl, not to an AI answer', () => {
    const summary = buildGeoAeoExecutiveSummary({ geoAeoVisuals: visualsWithStructure() });
    for (const action of summary.top_3_actions) {
      expect(action.reasoning).toContain('public crawl');
      expect(action.reasoning).toContain('not any observed AI answer');
    }
  });

  it('keeps the composite score at inferred, never measured', () => {
    const summary = buildGeoAeoExecutiveSummary({ geoAeoVisuals: visualsWithStructure() });
    expect(summary.overall_ai_visibility_score_state).toBe('inferred');
    expect(summary.overall_ai_visibility_score_state).not.toBe('measured');
  });

  it('carries a genuine structural zero through as a real value', () => {
    // A measured-zero axis is still a real reading OF THE SITE and must not be discarded.
    const summary = buildGeoAeoExecutiveSummary({ geoAeoVisuals: visualsWithStructure({ answer: 0 }) });
    const answerAction = summary.top_3_actions.find((a) => /direct-answer/i.test(a.action_title));
    expect(answerAction).toBeDefined();
    expect(answerAction?.reasoning).toContain('0/100');
  });
});

describe('GEO states what was available and what would unlock measurement', () => {
  it('reports AI retrieval as insufficient_signal, never measured', () => {
    const summary = buildGeoAeoExecutiveSummary({ geoAeoVisuals: visualsWithStructure() });
    expect(summary.ai_retrieval?.state).toBe('insufficient_signal');
  });

  it('names the evidence basis, the limit, and the unlock', () => {
    const summary = buildGeoAeoExecutiveSummary({ geoAeoVisuals: visualsWithStructure() });
    expect(summary.ai_retrieval?.basis).toContain('Public crawl');
    expect(summary.ai_retrieval?.not_measurable).toContain('No answer-engine retrieval was performed');
    expect(summary.ai_retrieval?.unlock).toContain('answer-engine provider');
  });

  it('says so explicitly when no structural evidence existed either', () => {
    const summary = buildGeoAeoExecutiveSummary({ geoAeoVisuals: visualsWithNothing() });
    expect(summary.ai_retrieval?.basis).toContain('No public structural evidence');
    expect(summary.overall_ai_visibility_score).toBeNull();
    expect(summary.overall_ai_visibility_score_state).toBe('insufficient_signal');
  });
});

describe('"Not measured" is never the final customer-facing answer', () => {
  it('returns a decision when readiness is assessable', () => {
    const summary = buildGeoAeoExecutiveSummary({ geoAeoVisuals: visualsWithStructure() });
    expect(summary.geo_decision?.relevance).toBe('relevant');
    expect(summary.geo_decision?.why).toBeTruthy();
    expect(summary.geo_decision?.do_now.length).toBeGreaterThan(0);
    expect(summary.geo_decision?.measurement).toBeTruthy();
  });

  it('forbids AI-share claims until a provider exists, even when relevant', () => {
    const summary = buildGeoAeoExecutiveSummary({ geoAeoVisuals: visualsWithStructure() });
    expect(summary.geo_decision?.defer.join(' ')).toContain('AI answer share');
  });

  it('still returns a decision when nothing could be assessed', () => {
    const summary = buildGeoAeoExecutiveSummary({ geoAeoVisuals: visualsWithNothing() });
    expect(summary.geo_decision?.relevance).toBe('conditional');
    expect(summary.geo_decision?.do_now).toEqual([]);
    expect(summary.geo_decision?.defer.length).toBeGreaterThan(0);
    expect(summary.geo_decision?.measurement).toBeTruthy();
    // Absence of evidence must not be narrated as absence from AI answers.
    expect(summary.geo_decision?.why).toContain('not a finding that the brand is absent');
  });

  it('emits no gap or actions when there is no evidence to support them', () => {
    const summary = buildGeoAeoExecutiveSummary({ geoAeoVisuals: visualsWithNothing() });
    expect(summary.primary_gap).toBeNull();
    expect(summary.top_3_actions).toEqual([]);
    expect(summary.visibility_opportunity).toBeNull();
  });
});
