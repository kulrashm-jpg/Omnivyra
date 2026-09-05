/**
 * GAP-12 — Report 1 must not present unmeasured AI surfaces as observed absence.
 *
 * THE DEFECT
 * Production measured ONE of twenty provider × query-class cells — one of five providers, with
 * `gemini`, `claude`, `perplexity` and `copilot` never queried because no adapter is configured —
 * and rendered, as fact:
 *
 *     "AI surfaces do not yet retrieve the brand."
 *     "AI systems do not reliably retrieve the brand."
 *     "The brand is largely absent here."
 *     Identification: Not Identified
 *
 * Every one of those quantifies over AI systems the report never asked. A provider that was not
 * queried is silent, not negative.
 *
 * WHAT IS ASSERTED
 * The score, its ScoreState, its band and the coverage percentage are untouched — this is a
 * language gate, not a scoring change. Nor is it suppression: partial coverage still reports the
 * measured result, states how much was measured, and names who did not answer.
 */
import { aiCoverageGate, aiCoverageQualifier } from '../../services/intelligence/dossier/aiCoverageGate';
import { aiDiscoverabilityFraming } from '../../services/intelligence/dossier/executivePhrasing';
import { aiDiscoverabilityConstraint } from '../../services/intelligence/dossier/constraintNarrative';
import { buildAIVisibilityState } from '../../services/intelligence/dossier/intelligenceSurfacesCompetitive';
import type { CanonicalReport } from '../../services/canonicalReport/canonicalReportTypes';

type Provider = 'chatgpt' | 'gemini' | 'claude' | 'perplexity' | 'copilot';
type QueryClass = 'branded' | 'category' | 'competitive' | 'expertise';
const PROVIDERS: Provider[] = ['chatgpt', 'gemini', 'claude', 'perplexity', 'copilot'];
const CLASSES: QueryClass[] = ['branded', 'category', 'competitive', 'expertise'];

/** A report whose matrix has `measuredProviders` answering and the rest never queried. */
function report(opts: {
  value: number | null;
  state?: 'measured' | 'inferred' | 'insufficient_signal' | 'unavailable';
  measuredProviders: Provider[];
  matrix?: boolean;
}): CanonicalReport {
  const { value, measuredProviders } = opts;
  const state = opts.state ?? (value == null ? 'insufficient_signal' : 'inferred');
  const cells = PROVIDERS.flatMap((provider) => CLASSES.map((query_class) => {
    const measured = measuredProviders.includes(provider);
    return {
      provider, query_class,
      state: measured ? 'measured' : 'unavailable',
      citation_rate: measured ? 0 : null,
      mean_prominence: null,
      observed_count: measured ? 3 : 0,
      reason_unavailable: measured ? null : `${provider} adapter not configured`,
    };
  }));
  const measured_cells = cells.filter((c) => c.state === 'measured').length;
  const score = {
    value, state, band: 'foundational', confidence: 'low',
    evidence: { count: measured_cells, sources: ['llm_probe'], observations: [], freshness: { age_hours: null, last_observed_at: null } },
    benchmark: { value: null, label: null },
  };
  return {
    ai_surface_presence: {
      score,
      citation_matrix: opts.matrix === false ? null : {
        state, overall_score: score, cells,
        by_provider: PROVIDERS.map((provider) => ({
          provider,
          state: measuredProviders.includes(provider) ? 'measured' : 'unavailable',
          citation_rate: measuredProviders.includes(provider) ? 0 : null,
          mean_prominence: null,
        })),
        by_query_class: CLASSES.map((query_class) => ({ query_class, state, citation_rate: 0, mean_prominence: null })),
        coverage: { measured_cells, unavailable_cells: cells.length - measured_cells, total_cells: cells.length },
      },
    },
    knowledge_graph: { entity: null },
  } as unknown as CanonicalReport;
}

const GLOBAL_CLAIMS = [
  /AI surfaces do not yet retrieve the brand/i,
  /AI systems do not reliably retrieve the brand/i,
  /largely absent/i,
];
const assertNoGlobalClaim = (text: string) =>
  GLOBAL_CLAIMS.forEach((re) => expect(text).not.toMatch(re));

describe('GAP-12 — AI absence claims are gated on measured coverage', () => {
  // ── 1. 1 of 20 cells, 1 of 5 providers (the production state) ────────────
  describe('1 & 2. partial coverage — the production case', () => {
    const partial = report({ value: 0, measuredProviders: ['chatgpt'] });

    it('reports the gate honestly', () => {
      const gate = aiCoverageGate(partial);
      expect(gate.measuredCells).toBe(4);       // chatgpt × 4 query classes
      expect(gate.totalCells).toBe(20);
      expect(gate.measuredProviders).toEqual(['chatgpt']);
      expect(gate.unmeasuredProviders).toEqual(['gemini', 'claude', 'perplexity', 'copilot']);
      expect(gate.supportsGeneralClaim).toBe(false);
    });

    it('emits no global AI-absence assertion in any producer', () => {
      assertNoGlobalClaim(aiDiscoverabilityFraming(partial));
      assertNoGlobalClaim(buildAIVisibilityState(partial).reading);
      assertNoGlobalClaim(aiDiscoverabilityConstraint(partial)?.constraint ?? '');
    });

    it('still reports the measured result — this is not suppression', () => {
      expect(aiDiscoverabilityFraming(partial)).toMatch(/not retrieved in the AI surfaces measured/i);
      expect(buildAIVisibilityState(partial).reading).toMatch(/not retrieved in the AI surfaces measured/i);
      // The numeric reading survives in the constraint line.
      expect(aiDiscoverabilityConstraint(partial)?.constraint).toMatch(/reads 0\/100/);
    });

    it('discloses coverage and names the providers that did not answer', () => {
      const text = aiDiscoverabilityFraming(partial);
      expect(text).toContain('4 of 20 provider × query-class cells measured');
      ['gemini', 'claude', 'perplexity', 'copilot'].forEach((p) => expect(text).toContain(p));
      expect(text).toMatch(/were not queried/);
    });

    it('says plainly that unqueried surfaces are unknown, not absent', () => {
      expect(buildAIVisibilityState(partial).reading).toMatch(/unknown, not absent/i);
    });
  });

  // ── 3. Full coverage keeps the existing narrative ────────────────────────
  describe('3. full coverage — existing absence narrative is preserved', () => {
    const full = report({ value: 0, measuredProviders: PROVIDERS });

    it('supports the general claim when every provider answered', () => {
      expect(aiCoverageGate(full).supportsGeneralClaim).toBe(true);
      expect(aiCoverageQualifier(aiCoverageGate(full))).toBe('');
    });

    it('emits the original wording unchanged', () => {
      expect(aiDiscoverabilityFraming(full)).toBe(
        'AI surfaces do not yet retrieve the brand. The cost of absence grows each quarter buyer research shifts.',
      );
      expect(buildAIVisibilityState(full).reading).toMatch(/AI systems do not reliably retrieve the brand/);
      expect(buildAIVisibilityState(full).state_label).toBe('Not Identified');
    });
  });

  // ── 4. Zero measurement ──────────────────────────────────────────────────
  describe('4. no measurement — no claim of measured absence', () => {
    it('abstains when the score itself is insufficient', () => {
      const none = report({ value: null, state: 'insufficient_signal', measuredProviders: [], matrix: false });
      assertNoGlobalClaim(aiDiscoverabilityFraming(none));
      expect(aiDiscoverabilityFraming(none)).toMatch(/measurement is the first move/i);
      // The constraint builder abstains entirely rather than asserting absence.
      expect(aiDiscoverabilityConstraint(none)).toBeNull();
    });

    it('renders the unmeasured state, not an absence verdict', () => {
      const none = report({ value: null, state: 'insufficient_signal', measuredProviders: [], matrix: false });
      const ai = buildAIVisibilityState(none);
      expect(ai.state).toBe('unmeasured');
      expect(ai.state_label).toBe('Not Yet Measured');
      assertNoGlobalClaim(ai.reading);
    });

    it('never supports a general claim with no matrix at all', () => {
      const none = report({ value: null, state: 'insufficient_signal', measuredProviders: [], matrix: false });
      expect(aiCoverageGate(none).supportsGeneralClaim).toBe(false);
      expect(aiCoverageGate(none).hasAnyMeasurement).toBe(false);
    });
  });

  // ── 5-7. Nothing about scoring changes ───────────────────────────────────
  describe('5-7. score, state and matrix semantics are untouched', () => {
    it('preserves value, ScoreState, band and confidence', () => {
      const partial = report({ value: 0, measuredProviders: ['chatgpt'] });
      buildAIVisibilityState(partial);
      aiDiscoverabilityFraming(partial);
      const s = partial.ai_surface_presence.score;
      expect(s.value).toBe(0);
      expect(s.state).toBe('inferred');
      expect(s.band).toBe('foundational');
      expect(s.confidence).toBe('low');
    });

    it('preserves the coverage percentage the report already reports', () => {
      const partial = report({ value: 0, measuredProviders: ['chatgpt'] });
      const ai = buildAIVisibilityState(partial);
      // 4 of 20 measured = 20%; derived exactly as before, not by the gate.
      expect(ai.retrieval_consistency_pct).toBe(20);
    });

    it('leaves matrix cell semantics intact', () => {
      const partial = report({ value: 0, measuredProviders: ['chatgpt'] });
      const matrix = partial.ai_surface_presence.citation_matrix!;
      expect(matrix.coverage).toEqual({ measured_cells: 4, unavailable_cells: 16, total_cells: 20 });
      expect(matrix.cells.filter((c) => c.state === 'measured')).toHaveLength(4);
    });

    it('does not alter the identified/partial readings', () => {
      const identified = report({ value: 70, state: 'measured', measuredProviders: ['chatgpt'] });
      expect(buildAIVisibilityState(identified).state_label).toBe('Identified');
      const partialScore = report({ value: 35, state: 'measured', measuredProviders: ['chatgpt'] });
      expect(buildAIVisibilityState(partialScore).state_label).toBe('Partially Identified');
    });
  });

  // ── 8-10. No adapter, network or scoring change ──────────────────────────
  describe('8-10. the gate is pure presentation', () => {
    it('is a pure function of the report — it issues no request', async () => {
      const raw = (await import('fs')).readFileSync(
        require.resolve('../../services/intelligence/dossier/aiCoverageGate.ts'), 'utf8',
      );
      // Scan CODE, not prose — the header comment legitimately discusses adapters and absence.
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code).not.toMatch(/fetch\(|axios|safeFetch|await /);
      expect(code).not.toMatch(/adapter|provider_credential|process\.env/i);
      // Only one import, and it is a type.
      expect(code.match(/^import .*/gm) ?? []).toEqual([
        "import type { CanonicalReport } from '../../canonicalReport/canonicalReportTypes';",
      ]);
    });

    it('derives everything from data already on the canonical report', () => {
      const partial = report({ value: 0, measuredProviders: ['chatgpt'] });
      const gate = aiCoverageGate(partial);
      const matrix = partial.ai_surface_presence.citation_matrix!;
      expect(gate.measuredCells).toBe(matrix.coverage.measured_cells);
      expect(gate.totalCells).toBe(matrix.coverage.total_cells);
    });
  });
});
