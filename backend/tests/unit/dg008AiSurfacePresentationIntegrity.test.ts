/**
 * DG-008 — the customer-facing half of D1.
 *
 * D1 stopped the STRUCTURAL crawl proxy from *speaking*: `dimAiSurfacePresence`
 * caps `ai_surface_presence` at `inferred`, and `buildAIVisibilityState` returns
 * `unmeasured` unless a grounded AI cell was actually observed, so the AI section's
 * words became honest. It did not touch the export renderer, and the renderer
 * still printed the FIGURES beside those honest words:
 *
 *   • "AI surface 62/100" in the Identification chip, whose value read
 *     "Not Yet Measured" — the exact artefact D1's commit message names;
 *   • a marker planted at 62% on an Absent → Retrievable → Cited spectrum,
 *     under the heading "Can AI systems reliably identify the brand?";
 *   • "AI visibility is operationally visible" in the Executive Reality Snapshot,
 *     because `isMeasuredScore` admits `inferred`.
 *
 * All three came from `answer_coverage_score` — a crawl heuristic counting how
 * answer-shaped the company's OWN pages look, which witnessed no AI system.
 *
 * These tests hold the renderer to the provenance gate D1 already owns. They
 * assert the FIGURES, not only the words, because the words were already correct
 * and the report was still false.
 */
import {
  renderAiDiscoverability,
  renderExecutiveRealitySnapshot,
} from '../../services/intelligence/exportRendererAssembly';
import { buildAIVisibilityState } from '../../services/intelligence/dossier/intelligenceSurfacesCompetitive';

// ── Fixtures ────────────────────────────────────────────────────────────────
//
// The structural score exactly as `dimAiSurfacePresence` emits it after D1:
// a real number, state `inferred`, band derived from the value. Nothing about
// the score itself is wrong — only presenting it as an AI observation is.

const STRUCTURAL_AI_SCORE = {
  value: 62,
  state: 'inferred' as const,
  confidence: 'medium' as const,
  band: 'operational' as const,
  evidence: { count: 1, sources: ['crawler'], freshness: 'fresh', observations: [] },
  benchmark: { value: null, label: null },
};

const score = (value: number | null, state: string, band: string) => ({
  value,
  state,
  confidence: 'medium',
  band,
  evidence: { count: 1, sources: ['crawler'], freshness: 'fresh', observations: [] },
  benchmark: { value: null, label: null },
});

/** The AI-visibility surface as D1 produces it when no answer engine answered. */
const UNMEASURED_VISIBILITY_STATE = {
  state: 'unmeasured' as const,
  state_label: 'Not Yet Measured',
  entity_state: 'unmeasured' as const,
  entity_label: 'Not Yet Measured',
  entity_detail: null,
  retrieval_consistency_pct: null,
  citation_density_label: null,
  reading: 'AI visibility is not yet measurable.',
};

/** The same surface when a grounded answer engine DID return a cited observation. */
const OBSERVED_VISIBILITY_STATE = {
  ...UNMEASURED_VISIBILITY_STATE,
  state: 'identified' as const,
  state_label: 'Identified',
  reading: 'AI systems reliably identify the brand.',
};

const aiSection = (surfaceScore: unknown) =>
  ({
    id: 'ai_discoverability',
    meta: { title: 'AI Discoverability', dominant_question: 'Q?' },
    surface_score: surfaceScore,
    rationale: { text: 'How surfaceable the site is for AI answers.' },
    citation_matrix: null,
    entity_score: score(null, 'unavailable', 'insufficient'),
    entity_summary: null,
    positioning_paragraph: 'p',
    framing_sentence: 'f',
    constraint_narrative: null,
  }) as never;

const aiSurfaces = (visibilityState: unknown) =>
  ({
    channel_leverage: { state: 'unavailable', top_leverage_cells: [], read: '' },
    ai_retrieval_reliability: { state: 'unavailable', entries: [], read: '' },
    ai_trajectory: { state: 'insufficient_history', delta: null, direction: null },
    competitive_ai: { state: 'unavailable', reading: '' },
    ai_visibility_state: visibilityState,
    ai_trust_coherence: {
      state: 'unavailable',
      kind: 'unmeasured',
      kind_label: 'Not Yet Measurable',
      reinforcement_signals: [],
      reading: '',
    },
    ai_absence_risk: { state: 'unavailable', reading: '', retrieval_examples: [] },
    ai_strategic_unlock: { concept_label: 'c', headline: 'h', body: 'b', move: 'm' },
  }) as never;

const snapshotDossier = (surfaceScore: unknown) =>
  ({
    authority_shape: { kind: 'x', name: 'Shape', what_it_means: 'means' },
    momentum_shape: { kind: 'insufficient_history' },
    summary_brief: {
      biggest_opportunity: { label: 'opp', detail: 'od' },
      biggest_risk: { label: 'risk', detail: 'rd' },
      strategic_priority: { label: 'sp', detail: 'spd' },
    },
    sections: {
      executive_reality: { current_maturity_label: 'Developing', strategic_priority: 'sp' },
      authority_position: { dominant_strength: null, dominant_weakness: null },
      ai_discoverability: { surface_score: surfaceScore, rationale: { text: 'r' } },
    },
  }) as never;

const evidence = { count: 1, sources: ['crawler'], freshness: 'fresh', observations: [] };

const snapshotPayload = (surfaceScore: unknown) =>
  ({
    authority_overview: { overall_score: score(50, 'measured', 'operational') },
    maturity_stage: { label: 'Developing', stage: 'developing', why_this_stage: 'w', evidence },
    pillars: [],
    ai_surface_presence: { citation_matrix: null, score: surfaceScore },
    knowledge_graph: { score: score(null, 'unavailable', 'insufficient') },
    authority_inflow: { score: score(null, 'unavailable', 'insufficient') },
    trust_coherence: { score: score(null, 'unavailable', 'insufficient') },
    evidence_appendix: { overall: evidence },
    snapshot_observed_at: '2026-01-01T00:00:00Z',
    generated_at: '2026-01-01T00:00:00Z',
  }) as never;

const snapshotSurfaces = (visibilityState: unknown) =>
  ({
    brand_brief: { state: 'unavailable', entries: [] },
    strategic_posture: { state: 'unavailable', entries: [] },
    strategic_position_4: { state: 'unavailable', quadrants: [], entries: [] },
    ai_visibility_state: visibilityState,
  }) as never;

const signalValue = (html: string, label: string): string | null =>
  html.match(new RegExp(`${label}</p>\\s*<p class="ds-signal-value">([^<]*)<`))?.[1] ?? null;

// ── The AI Discoverability block ────────────────────────────────────────────

describe('DG-008 — Block 1 prints no AI figure without a grounded observation', () => {
  it('does not print an "AI surface N/100" derived from the structural crawl proxy', () => {
    const html = renderAiDiscoverability(
      aiSection(STRUCTURAL_AI_SCORE),
      aiSurfaces(UNMEASURED_VISIBILITY_STATE),
      '03',
    );
    expect(html).not.toContain('AI surface 62/100');
    expect(html).not.toMatch(/AI surface \d+\/100/);
  });

  it('plants no marker on the Absent → Retrievable → Cited spectrum', () => {
    const html = renderAiDiscoverability(
      aiSection(STRUCTURAL_AI_SCORE),
      aiSurfaces(UNMEASURED_VISIBILITY_STATE),
      '03',
    );
    // The spectrum itself still renders — the reader should see the scale and that
    // nothing sits on it. What must not appear is a position on it.
    expect(html).toContain('ds-vspectrum');
    expect(html).not.toContain('ds-vspectrum-marker');
    expect(html).not.toContain('left: 62%');
  });

  it('states why the figure is absent rather than leaving a bare dash', () => {
    const html = renderAiDiscoverability(
      aiSection(STRUCTURAL_AI_SCORE),
      aiSurfaces(UNMEASURED_VISIBILITY_STATE),
      '03',
    );
    expect(html).toContain('No answer engine returned a grounded result for this run');
  });

  it('does not contradict its own chip: no number beside "Not Yet Measured"', () => {
    const html = renderAiDiscoverability(
      aiSection(STRUCTURAL_AI_SCORE),
      aiSurfaces(UNMEASURED_VISIBILITY_STATE),
      '03',
    );
    const chip = html.match(/ds-aistate-chip-label">Identification[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(chip).toContain('Not Yet Measured');
    expect(chip).not.toMatch(/\b62\b/);
  });

  it('a grounded observation is still shown in full — the gate withholds, it does not delete', () => {
    const html = renderAiDiscoverability(
      aiSection({ ...STRUCTURAL_AI_SCORE, state: 'measured' }),
      aiSurfaces(OBSERVED_VISIBILITY_STATE),
      '03',
    );
    expect(html).toContain('AI surface 62/100');
    expect(html).toContain('ds-vspectrum-marker');
    expect(html).not.toContain('No answer engine returned a grounded result');
  });

  it('withholds even a score whose own state says `measured`, when no AI cell was observed', () => {
    // The gate is provenance, not the score's self-description. This matters because
    // the score's state is set upstream (`dimAiSurfacePresence`) and D1's cap there is
    // one edit away from being lost. If the renderer trusted `state`, that single
    // upstream regression would reprint "AI surface 62/100" under "Can AI systems
    // reliably identify the brand?" — the whole defect, restored. Reading the observed
    // -cell decision instead means the renderer survives that regression on its own.
    const html = renderAiDiscoverability(
      aiSection({ ...STRUCTURAL_AI_SCORE, state: 'measured' }),
      aiSurfaces(UNMEASURED_VISIBILITY_STATE),
      '03',
    );
    expect(html).not.toMatch(/AI surface \d+\/100/);
    expect(html).not.toContain('ds-vspectrum-marker');
  });

  it('withholds on provenance, not on confidence: an `inferred` score with an observed cell still shows', () => {
    // A partially covered run (GAP-12) is a real observation of the providers that
    // answered. The gate must not silence it just because the aggregate is `inferred`.
    const html = renderAiDiscoverability(
      aiSection(STRUCTURAL_AI_SCORE),
      aiSurfaces(OBSERVED_VISIBILITY_STATE),
      '03',
    );
    expect(html).toContain('AI surface 62/100');
  });
});

// ── The Executive Reality Snapshot signal ───────────────────────────────────

describe('DG-008 — the snapshot AI Visibility signal follows the same gate', () => {
  it('does not band a structural score as visible AI performance', () => {
    const html = renderExecutiveRealitySnapshot(
      snapshotDossier(STRUCTURAL_AI_SCORE),
      snapshotPayload(STRUCTURAL_AI_SCORE),
      snapshotSurfaces(UNMEASURED_VISIBILITY_STATE),
    );
    const value = signalValue(html, 'AI Visibility');
    expect(value).toBe('AI visibility is not yet sufficiently measured');
    expect(value).not.toMatch(/operationally visible|strongly reinforced|partially reinforced|early and fragile/);
  });

  it('still bands AI visibility when a grounded observation exists', () => {
    const html = renderExecutiveRealitySnapshot(
      snapshotDossier(STRUCTURAL_AI_SCORE),
      snapshotPayload(STRUCTURAL_AI_SCORE),
      snapshotSurfaces(OBSERVED_VISIBILITY_STATE),
    );
    expect(signalValue(html, 'AI Visibility')).toBe('AI visibility is operationally visible');
  });

  it('agrees with the AI section in the same document', () => {
    // The defect was not that either surface was wrong in isolation — the snapshot
    // said "operationally visible" on page 2 and the section said "Not Yet Measured"
    // on page 6, from the same number. One document, one claim.
    const dossier = snapshotDossier(STRUCTURAL_AI_SCORE);
    const snapshotHtml = renderExecutiveRealitySnapshot(
      dossier,
      snapshotPayload(STRUCTURAL_AI_SCORE),
      snapshotSurfaces(UNMEASURED_VISIBILITY_STATE),
    );
    const sectionHtml = renderAiDiscoverability(
      aiSection(STRUCTURAL_AI_SCORE),
      aiSurfaces(UNMEASURED_VISIBILITY_STATE),
      '03',
    );
    expect(signalValue(snapshotHtml, 'AI Visibility')).toContain('not yet sufficiently measured');
    expect(sectionHtml).toContain('Not Yet Measured');
    expect(`${snapshotHtml}${sectionHtml}`).not.toMatch(/AI surface \d+\/100/);
  });
});

// ── The gate's owner is unchanged ───────────────────────────────────────────

describe('DG-008 — D1 remains the single owner of the decision', () => {
  const reportWith = (measuredCells: number, aiScore: unknown) =>
    ({
      ai_surface_presence: {
        score: aiScore,
        citation_matrix: {
          coverage: { measured_cells: measuredCells, total_cells: 20 },
          cells: [],
          by_provider: [],
        },
      },
      knowledge_graph: { entity: null },
    }) as never;

  it('a structural score with zero observed cells is `unmeasured` at the source', () => {
    expect(buildAIVisibilityState(reportWith(0, STRUCTURAL_AI_SCORE)).state).toBe('unmeasured');
  });

  it('the renderer reads that decision rather than re-deriving one from the score', () => {
    // Same score, same everything — only the D1 surface differs. If the renderer had
    // its own opinion about `inferred`, these two would not diverge.
    const withheld = renderAiDiscoverability(
      aiSection(STRUCTURAL_AI_SCORE),
      aiSurfaces(UNMEASURED_VISIBILITY_STATE),
      '03',
    );
    const shown = renderAiDiscoverability(
      aiSection(STRUCTURAL_AI_SCORE),
      aiSurfaces(OBSERVED_VISIBILITY_STATE),
      '03',
    );
    expect(withheld).not.toContain('AI surface 62/100');
    expect(shown).toContain('AI surface 62/100');
  });
});
