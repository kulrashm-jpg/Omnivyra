/**
 * DEFECT #11 — an UNMEASURED AI retrieval cell is published as "Citation rate 0%".
 *
 * `buildChannelLeverage` (dossier/intelligenceSurfacesFoundations.ts) is called by
 * `renderExportHtml`, which is the single canonical export pipeline behind
 * `GET /api/reports/[reportId]?format=html|pdf`. It partitioned the citation matrix
 * with
 *
 *   const cells = matrix.cells.filter((c) => c.state !== 'unavailable');
 *   const gaps  = cells.filter((c) => (c.citation_rate ?? 0) < 0.3);
 *
 * and then published, per gap cell:
 *
 *   "Citation rate 0% — the brand is largely absent. Closing this cell extends
 *    retrieval where it currently does not reach."
 *
 * `insufficient_signal` is not `unavailable`, so it survived the first filter — and
 * `citation_rate` is null for EVERY cell whose state is not `measured`
 * (`llmAdapterBase` / `openaiAdapter`: `citation_rate: measured ? ... : null`). That is
 * not a rare path: `resolveProbeOutcome` returns `insufficient_signal` for any provider
 * with `retrieval_grounded === false`, which is four of the five
 * (`openaiAdapter` 147, `llmAdapterBase` 83, `providerRegistry` 36; only
 * `perplexityAdapter` 312 is grounded). So a run with a working ChatGPT key publishes
 * four cells the provider could never measure as four cells where the brand is absent.
 *
 * Both sibling surfaces built from the same matrix already exclude the state:
 * `buildAIAbsenceRisk` (intelligenceSurfacesCompetitive.ts) and
 * `buildAIRetrievalReliability` (same file as the defect, 613) each filter
 * `state !== 'unavailable' && state !== 'insufficient_signal'`. Only this one does not.
 *
 * ZERO IS NOT THE TEST. A genuinely measured 0 is a real observation — the answer
 * engine retrieved, cited sources, and did not name the brand — and must still be
 * published as a gap. C1/C2 pin that, so a "fix" by `=== 0` cannot pass.
 */
import { buildChannelLeverage } from '../../services/intelligence/dossier/intelligenceSurfacesFoundations';
import { renderAiDiscoverability } from '../../services/intelligence/exportRendererAssembly';

// ── Fixtures ────────────────────────────────────────────────────────────────

const evidence = { count: 1, sources: ['answer_engine'], freshness: { last_observed_at: null, age_hours: null }, observations: [] };

type CellInput = {
  provider: string;
  query_class: string;
  state: string;
  citation_rate: number | null;
};

const cell = (input: CellInput) => ({
  provider: input.provider,
  query_class: input.query_class,
  state: input.state,
  citation_rate: input.citation_rate,
  mean_prominence: input.citation_rate == null ? null : 0.5,
  observed_count: input.citation_rate == null ? 0 : 2,
  evidence,
  reason_unavailable:
    input.state === 'insufficient_signal'
      ? 'Provider is not retrieval-grounded: its answer reflects model recall, not observed AI visibility.'
      : input.state === 'unavailable'
        ? 'adapter not configured'
        : null,
});

const reportWithCells = (cells: ReturnType<typeof cell>[]) =>
  ({
    ai_surface_presence: {
      citation_matrix: {
        cells,
        coverage: {
          measured_cells: cells.filter((c) => c.state === 'measured').length,
          unavailable_cells: cells.filter((c) => c.state !== 'measured').length,
          total_cells: cells.length,
        },
      },
    },
  }) as never;

/**
 * The production steady state: Perplexity (the one retrieval-grounded adapter) returns a
 * real measurement; the ungrounded adapters answer but cite nothing, so their cells are
 * `insufficient_signal` with a null rate; an unconfigured provider is `unavailable`.
 */
const PRODUCTION_SHAPED_MATRIX = [
  cell({ provider: 'perplexity', query_class: 'branded', state: 'measured', citation_rate: 0.82 }),
  cell({ provider: 'chatgpt', query_class: 'branded', state: 'insufficient_signal', citation_rate: null }),
  cell({ provider: 'gemini', query_class: 'category', state: 'insufficient_signal', citation_rate: null }),
  cell({ provider: 'copilot', query_class: 'expertise', state: 'unavailable', citation_rate: null }),
];

// ── Rendered-output harness ─────────────────────────────────────────────────
//
// The same renderer entry point the canonical pipeline calls, with every OTHER
// surface held inert so only the channel-leverage block can speak.

const score = (value: number | null, state: string, band: string) => ({
  value,
  state,
  confidence: 'medium',
  band,
  evidence,
  benchmark: { value: null, label: null },
});

const aiSection = () =>
  ({
    id: 'ai_discoverability',
    meta: { title: 'AI Discoverability', dominant_question: 'Q?' },
    surface_score: score(null, 'insufficient_signal', 'insufficient'),
    rationale: { text: 'How surfaceable the site is for AI answers.' },
    citation_matrix: null,
    entity_score: score(null, 'unavailable', 'insufficient'),
    entity_summary: null,
    positioning_paragraph: 'p',
    framing_sentence: 'f',
    constraint_narrative: null,
  }) as never;

const aiSurfaces = (channelLeverage: unknown) =>
  ({
    channel_leverage: channelLeverage,
    ai_retrieval_reliability: { state: 'unavailable', entries: [], read: '' },
    ai_trajectory: { state: 'insufficient_history', delta: null, direction: null },
    competitive_ai: { state: 'unavailable', reading: '' },
    ai_visibility_state: {
      state: 'unmeasured',
      state_label: 'Not Yet Measured',
      entity_state: 'unmeasured',
      entity_label: 'Not Yet Measured',
      entity_detail: null,
      retrieval_consistency_pct: null,
      citation_density_label: null,
      reading: 'AI visibility is not yet measurable.',
    },
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

const renderWith = (cells: ReturnType<typeof cell>[]): string =>
  renderAiDiscoverability(aiSection(), aiSurfaces(buildChannelLeverage(reportWithCells(cells))), '03');

const ABSENCE_CLAIM = 'the brand is largely absent';

// ── A — the defect ──────────────────────────────────────────────────────────

describe('#11 — a cell the provider could not measure is not a cell where the brand is absent', () => {
  it('A1: an insufficient_signal cell produces no channel-leverage entry at all', () => {
    const surface = buildChannelLeverage(reportWithCells(PRODUCTION_SHAPED_MATRIX));
    const providers = surface.top_leverage_cells.map((c) => c.provider);
    expect(providers).not.toContain('chatgpt');
    expect(providers).not.toContain('gemini');
  });

  it('A2: no entry carries a null citation_rate', () => {
    const surface = buildChannelLeverage(reportWithCells(PRODUCTION_SHAPED_MATRIX));
    surface.top_leverage_cells.forEach((entry) => {
      expect(typeof entry.citation_rate).toBe('number');
    });
  });

  it('A3: the rendered dossier makes no 0% absence claim about an unmeasured cell', () => {
    const html = renderWith(PRODUCTION_SHAPED_MATRIX);
    expect(html).not.toContain('Citation rate 0%');
    expect(html).not.toContain(ABSENCE_CLAIM);
  });

  it('B1: when NO cell was measured, the surface does not claim to be measured', () => {
    const surface = buildChannelLeverage(
      reportWithCells([
        cell({ provider: 'chatgpt', query_class: 'branded', state: 'insufficient_signal', citation_rate: null }),
        cell({ provider: 'gemini', query_class: 'category', state: 'insufficient_signal', citation_rate: null }),
      ]),
    );
    expect(surface.state).toBe('unavailable');
    expect(surface.top_leverage_cells).toEqual([]);
  });
});

// ── C — zero is a measurement, not an absence test ──────────────────────────

describe('#11 — a measured zero is still a real gap', () => {
  it('C1: a measured cell at 0.0 is published as a gap, with its real 0%', () => {
    const surface = buildChannelLeverage(
      reportWithCells([
        cell({ provider: 'perplexity', query_class: 'competitive', state: 'measured', citation_rate: 0 }),
      ]),
    );
    expect(surface.state).toBe('measured');
    expect(surface.top_leverage_cells).toHaveLength(1);
    expect(surface.top_leverage_cells[0].status).toBe('gap');
    expect(surface.top_leverage_cells[0].citation_rate).toBe(0);
    expect(surface.top_leverage_cells[0].why).toContain('Citation rate 0%');
    expect(surface.top_leverage_cells[0].why).toContain(ABSENCE_CLAIM);
  });

  it('C2: the rendered dossier still states the measured 0% absence', () => {
    const html = renderWith([
      cell({ provider: 'perplexity', query_class: 'competitive', state: 'measured', citation_rate: 0 }),
    ]);
    expect(html).toContain('Citation rate 0%');
    expect(html).toContain(ABSENCE_CLAIM);
  });

  it('D1: a measured high-rate cell is still published as leverage', () => {
    const surface = buildChannelLeverage(reportWithCells(PRODUCTION_SHAPED_MATRIX));
    const leverage = surface.top_leverage_cells.filter((c) => c.status === 'leverage');
    expect(leverage).toHaveLength(1);
    expect(leverage[0].provider).toBe('perplexity');
    expect(leverage[0].citation_rate).toBe(0.82);
  });

  it('D2: an absent matrix is still held open, not reported as absence', () => {
    const surface = buildChannelLeverage({ ai_surface_presence: { citation_matrix: null } } as never);
    expect(surface.state).toBe('unavailable');
    expect(surface.top_leverage_cells).toEqual([]);
  });
});

// ── Non-vacuity ─────────────────────────────────────────────────────────────

describe('#11 — the fixture reaches the production code', () => {
  it('the fixture shape is the one the surface reads, and it yields entries', () => {
    expect(typeof buildChannelLeverage).toBe('function');
    const surface = buildChannelLeverage(reportWithCells(PRODUCTION_SHAPED_MATRIX));
    expect(surface.top_leverage_cells.length).toBeGreaterThan(0);
  });

  it('the rendered harness reaches block 03, so A3 is not passing on an empty string', () => {
    const html = renderWith([
      cell({ provider: 'perplexity', query_class: 'competitive', state: 'measured', citation_rate: 0 }),
    ]);
    expect(html).toContain('Citation &amp; Mention Presence');
  });
});
