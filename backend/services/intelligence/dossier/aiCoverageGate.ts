/**
 * GAP-12 — the measured-coverage gate for AI surface-presence language.
 *
 * THE DEFECT
 * Report 1 measured ONE of twenty provider × query-class cells — one of five providers, with
 * `gemini`, `claude`, `perplexity` and `copilot` never queried because no adapter is configured —
 * and then told the customer, as fact:
 *
 *     "AI surfaces do not yet retrieve the brand."
 *     "AI systems do not reliably retrieve the brand."
 *     "The brand is largely absent here."
 *
 * Those sentences are about AI systems in general. The report had asked exactly one of them. A
 * provider that was never queried cannot be evidence that the brand is absent from it — that is
 * absence of evidence rendered as evidence of absence, the defect class GAP-02 and GAP-04 closed
 * elsewhere in this report.
 *
 * WHAT THIS IS NOT
 * This is not a scoring change. The score, its `ScoreState`, its band and the coverage percentage
 * are all read here and none is modified: `aiCitationMatrixService` already derives the aggregate
 * from measured cells only, so the NUMBER was never the problem. Only the language that
 * generalises it is gated. Nor is it a suppression switch — a report with partial coverage still
 * states its measured result and now says plainly how much was measured and who did not answer.
 *
 * WHY PROVIDERS, NOT CELLS, DECIDE
 * The claims quantify over AI systems ("AI surfaces", "AI systems"), so the gate quantifies over
 * providers: a general statement is supported only when every provider in the matrix actually
 * answered. Uneven results ACROSS query classes within answering providers are a real finding and
 * still read as one; silence from a provider that was never asked is not.
 */
import type { CanonicalReport } from '../../canonicalReport/canonicalReportTypes';

type Matrix = NonNullable<CanonicalReport['ai_surface_presence']['citation_matrix']>;
type ProviderName = Matrix['by_provider'][number]['provider'];

export type AiCoverageGate = {
  measuredCells: number;
  totalCells: number;
  measuredProviders: ProviderName[];
  /** Enumerated in the matrix but never returned a measurement. */
  unmeasuredProviders: ProviderName[];
  /**
   * True only when every provider the matrix enumerates actually answered. Statements about AI
   * systems in general may be made only when this holds.
   */
  supportsGeneralClaim: boolean;
  /** True when at least one cell was measured, so a measured result exists to report. */
  hasAnyMeasurement: boolean;
  /** "1 of 20 provider × query-class cells measured" — the vocabulary the insight cards already use. */
  coverageLabel: string | null;
  /** "gemini, claude, perplexity and copilot were not queried" — null when everything answered. */
  unqueriedLabel: string | null;
};

function list(names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function aiCoverageGate(report: CanonicalReport): AiCoverageGate {
  const matrix = report.ai_surface_presence.citation_matrix;
  const measuredCells = matrix?.coverage.measured_cells ?? 0;
  const totalCells = matrix?.coverage.total_cells ?? 0;
  const providers = matrix?.by_provider ?? [];

  const measuredProviders = providers.filter((p) => p.state === 'measured').map((p) => p.provider);
  const unmeasuredProviders = providers.filter((p) => p.state !== 'measured').map((p) => p.provider);

  // No matrix at all ⇒ nothing was measured, so nothing may be generalised either.
  const supportsGeneralClaim = providers.length > 0 && unmeasuredProviders.length === 0;

  return {
    measuredCells,
    totalCells,
    measuredProviders,
    unmeasuredProviders,
    supportsGeneralClaim,
    hasAnyMeasurement: measuredCells > 0,
    coverageLabel: totalCells > 0
      ? `${measuredCells} of ${totalCells} provider × query-class cells measured`
      : null,
    unqueriedLabel: unmeasuredProviders.length > 0
      ? `${list(unmeasuredProviders)} ${unmeasuredProviders.length === 1 ? 'was' : 'were'} not queried`
      : null,
  };
}

/**
 * The sentence fragment that keeps a partial-coverage reading honest: what was measured, and who
 * did not answer. Returns '' when coverage supports speaking generally, so full-coverage output is
 * byte-identical to before.
 */
export function aiCoverageQualifier(gate: AiCoverageGate): string {
  if (gate.supportsGeneralClaim) return '';
  const parts = [gate.coverageLabel, gate.unqueriedLabel].filter(Boolean);
  return parts.length > 0 ? ` Measured coverage: ${parts.join('; ')}.` : '';
}
