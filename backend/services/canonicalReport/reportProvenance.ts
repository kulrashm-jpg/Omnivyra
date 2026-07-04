/**
 * Report Provenance  (BETA-REPORT-EXEC-007 — BR-H-002 + BR-H-003)
 *
 * Truthful, deterministic provenance labels for the authority trajectory and the competitor comparison. It
 * REUSES existing state/confidence/source vocabulary (ScoreState, ConfidenceBand, EvidenceSourceKind) and the
 * provider's already-computed outputs — it invents NO trajectory, growth, projection, or competitor evidence.
 * Its only job is to make explicit what the data already is: MEASURED history vs PROJECTED forecast vs
 * UNAVAILABLE; and crawl-derived competitor observations vs unavailable ones.
 */
import type { ConfidenceBand, EvidenceSourceKind, ScoreState } from './canonicalReportTypes';

export type TrajectoryHistoryState = 'measured' | 'insufficient' | 'unavailable';

export interface TrajectoryProvenance {
  /** Provenance of the historical series: measured (≥2 real snapshots) / insufficient (1) / unavailable (0). */
  history: TrajectoryHistoryState;
  history_count: number;
  /** The provider's velocity classification (reused verbatim; not recomputed). */
  classification: string;
  /** Whether a forward projection exists — a model projection, explicitly NOT measured history. */
  forecast: 'projected' | 'unavailable';
  basis: string;
  limitations: string[];
  reason_unavailable: string | null;
}

export interface CompetitorProvenance {
  /** Where competitor observations come from (crawl / positioning analysis) — never a market-data panel. */
  source: EvidenceSourceKind;
  /** Whether any competitor observation was actually made. */
  measured: boolean;
  confidence: ConfidenceBand;
  basis: string;
  limitations: string[];
}

export interface TrajectoryProvenanceInput {
  state: ScoreState;
  snapshotCount: number;
  classification: string;
  forecastPresent: boolean;
  reasonUnavailable: string | null;
}

/** Resolve honest trajectory provenance from the provider's own outputs. Deterministic; no invention. */
export function resolveTrajectoryProvenance(input: TrajectoryProvenanceInput): TrajectoryProvenance {
  const history: TrajectoryHistoryState =
    input.state === 'measured' && input.snapshotCount >= 2
      ? 'measured'
      : input.snapshotCount >= 1
        ? 'insufficient'
        : 'unavailable';

  const forecast: TrajectoryProvenance['forecast'] = input.forecastPresent ? 'projected' : 'unavailable';

  const limitations: string[] = [];
  if (history !== 'measured') {
    limitations.push('Authority history is not yet measured — at least two persisted snapshots are required to establish a real trend.');
  }
  if (forecast === 'projected') {
    limitations.push('The projected value is a deterministic model projection from observed history, NOT measured future performance.');
  }

  const CLASSIFICATION_LABEL: Record<string, string> = {
    sustained_growth: 'sustained growth', decay: 'decline', stagnation: 'holding steady',
    temporary_spike: 'a temporary spike', insufficient_history: 'not yet established',
  };
  const basis =
    history === 'measured'
      ? `Trend established from ${input.snapshotCount} measured readings (${CLASSIFICATION_LABEL[input.classification] ?? 'observed'}).`
      : history === 'insufficient'
        ? 'Only one snapshot is recorded — a trend cannot yet be measured; the series will populate as more reports are generated.'
        : 'No authority history has been persisted yet, so no measured trend or projection exists.';

  return {
    history,
    history_count: input.snapshotCount,
    classification: input.classification,
    forecast,
    basis,
    limitations,
    reason_unavailable: input.reasonUnavailable,
  };
}

export interface CompetitorProvenanceInput {
  confidence: ConfidenceBand;
  competitorCount: number;
}

/** Resolve honest competitor provenance. Surfaces the crawl origin + that blanks are unavailable, not zero. */
export function resolveCompetitorProvenance(input: CompetitorProvenanceInput): CompetitorProvenance {
  return {
    source: 'competitor_intelligence',
    measured: input.competitorCount > 0,
    confidence: input.confidence,
    basis:
      input.competitorCount > 0
        ? 'Competitor values are derived from public-web analysis and positioning signals — not a licensed market-data panel.'
        : 'No competitor observations were available from public-web analysis for this snapshot.',
    limitations: [
      'Competitor observations reflect publicly available signals, not internal competitor analytics.',
      'A blank competitor value means that area was not observable from public data (unavailable), not zero.',
    ],
  };
}
