/**
 * Evidence Readiness Orchestrator  (BETA-EVIDENCE-EXEC-002)
 *
 * A GOVERNANCE layer that answers "have we measured enough to trust this report?" — distinct from the
 * Authority Index ("how strong is the business?"). It COMPOSES already-computed signals on the canonical
 * report (dimension states, AI citation coverage, scan metadata, maturity state, company context) into one
 * lifecycle state + completeness + executive gaps + a gating disposition. It RE-USES existing evidence and
 * RE-DERIVES nothing scored — NO new scoring, NO new evidence, NO provider/engine change. Deterministic.
 *
 * The six evidence sources + their status derivation mirror the existing data-source-status panels
 * (`intelligenceSurfaces.buildDataSourceStatusPanels`): connected = measured, partial = inferred,
 * unavailable/insufficient = missing. This module only reads those already-computed dimension states.
 */
import type { CanonicalReport, ScoreState } from './canonicalReportTypes';

export type EvidenceReadinessState =
  | 'not_started'
  | 'discovering'
  | 'partially_measured'
  | 'measurement_ready'
  | 'fully_measured';

export type ReadinessDisposition = 'preliminary' | 'partial' | 'ready';

export interface ReadinessGap {
  /** Executive-facing area name (never an internal key). */
  area: string;
  why: string;
  impact: string;
  next_step: string;
  expected_benefit: string;
}

export interface EvidenceReadiness {
  state: EvidenceReadinessState;
  /** Governance gating — the report is always generated (complement, not replace); this says how to frame it. */
  disposition: ReadinessDisposition;
  connected_sources: number;
  total_sources: number;
  coverage_percentage: number;        // measured+inferred canonical dimensions ÷ total
  ai_coverage_percentage: number | null;
  website_scanned: boolean;
  /** True when the overall Authority Index is measurable (state not insufficient/unavailable). */
  authority_measured: boolean;
  headline: string;                   // one-line executive read (readiness, NOT authority)
  gaps: ReadinessGap[];               // limiting factors, in executive language
  next_moves: string[];               // the highest-leverage next steps
}

type DimState = { value: number | null; state: ScoreState };

function sourceStatus(dim: DimState | undefined): 'connected' | 'partial' | 'missing' {
  if (!dim) return 'missing';
  if (dim.state === 'measured' && dim.value != null) return 'connected';
  if (dim.state === 'inferred') return 'partial';
  return 'missing'; // unavailable / insufficient_signal
}

/** Compose the evidence readiness from already-computed report signals. Deterministic; reads only. */
export function resolveEvidenceReadiness(report: CanonicalReport): EvidenceReadiness {
  const dimByKey = new Map<string, DimState>();
  for (const pillar of report.pillars ?? []) {
    for (const d of pillar.dimensions ?? []) dimByKey.set(d.key, { value: d.score.value, state: d.score.state });
  }
  const allDims = [...dimByKey.values()];
  const measuredOrInferred = allDims.filter((d) => d.value != null && d.state !== 'insufficient_signal' && d.state !== 'unavailable').length;
  const coverage_percentage = allDims.length ? Math.round((measuredOrInferred / allDims.length) * 100) : 0;

  const competitorCount = report.competitive_surface_share?.competitors?.length ?? 0;
  const aiCoverage = report.ai_surface_presence?.citation_matrix?.coverage ?? null;
  const ai_coverage_percentage = aiCoverage && aiCoverage.total_cells > 0
    ? Math.round((aiCoverage.measured_cells / aiCoverage.total_cells) * 100)
    : null;

  // The 6 canonical evidence sources (mirrors buildDataSourceStatusPanels).
  const sources = {
    crawl: sourceStatus(dimByKey.get('index_integrity')),
    content: sourceStatus(dimByKey.get('extraction_readiness')),
    backlink: sourceStatus(dimByKey.get('authority_inflow')),
    ai: sourceStatus(dimByKey.get('ai_surface_presence')),
    competitor: competitorCount > 0 ? 'connected' : 'missing',
    trust: sourceStatus(dimByKey.get('trust_coherence')),
  } as const;
  const statuses = Object.values(sources);
  const connected_sources = statuses.filter((s) => s === 'connected').length;
  const partial_sources = statuses.filter((s) => s === 'partial').length;
  const total_sources = statuses.length;

  const website_scanned =
    sources.crawl !== 'missing' || sources.content !== 'missing' || report.scan_metadata?.persisted_at != null;
  const overallState = report.authority_overview?.overall_score?.state;
  const authority_measured = overallState === 'measured' || overallState === 'inferred';

  // Lifecycle state — governance thresholds (NOT scores). Connected + partial both count as "some measurement".
  const anyMeasurement = connected_sources + partial_sources;
  const state: EvidenceReadinessState =
    anyMeasurement === 0 && !website_scanned ? 'not_started'
      : connected_sources >= 5 ? 'fully_measured'
        : anyMeasurement <= 2 ? 'discovering'
          : authority_measured ? 'measurement_ready'
            : 'partially_measured';

  const disposition: ReadinessDisposition =
    !authority_measured ? 'preliminary' : connected_sources >= 4 ? 'ready' : 'partial';

  // Executive gaps — reuse the source semantics; produce Why / Impact / Next step / Expected benefit.
  const gaps: ReadinessGap[] = [];
  if (!website_scanned || sources.crawl === 'missing' || sources.content === 'missing') {
    gaps.push({
      area: 'Website scan',
      why: 'The website has not yet been fully scanned for this report.',
      impact: 'Technical, content-structure, and accessibility measures cannot be computed, so several pillars read as unmeasured.',
      next_step: 'Run the website scan for this domain, then regenerate the report.',
      expected_benefit: 'Unlocks the Foundation pillar and richer content measurement.',
    });
  }
  if (sources.backlink !== 'connected') {
    gaps.push({
      area: 'Backlink authority',
      why: 'No backlink data source is connected, so authority is estimated from on-site signals only.',
      impact: 'External authority is inferred rather than measured, lowering confidence in the Authority pillar.',
      next_step: 'Connect a backlink data source.',
      expected_benefit: 'Replaces the on-site estimate with measured external authority.',
    });
  }
  if (ai_coverage_percentage != null && ai_coverage_percentage < 50) {
    gaps.push({
      area: 'AI visibility',
      why: `AI answer-engine coverage is limited (${ai_coverage_percentage}% of checks measured).`,
      impact: 'AI presence is based on a small number of observations.',
      next_step: 'Complete the business profile (brand name, competitors, products) and connect additional AI answer engines.',
      expected_benefit: 'Broader, higher-confidence AI visibility measurement.',
    });
  }
  if (sources.trust !== 'connected') {
    gaps.push({
      area: 'Trust & reputation',
      why: 'No review or reputation source is connected.',
      impact: 'Trust coherence cannot be measured, so the Trust pillar reads as unmeasured.',
      next_step: 'Connect a review or reputation source.',
      expected_benefit: 'Adds measured trust and reputation signals.',
    });
  }

  const headline = !authority_measured
    ? 'Measurement is still forming — this report is preliminary. It reflects how much of the digital presence has been measured so far, not a final view of authority.'
    : connected_sources >= 5
      ? 'Enough evidence has been measured to read this report with confidence.'
      : 'Some evidence is connected; connecting the sources below will make the reading more complete.';

  return {
    state,
    disposition,
    connected_sources,
    total_sources,
    coverage_percentage,
    ai_coverage_percentage,
    website_scanned,
    authority_measured,
    headline,
    gaps,
    next_moves: gaps.slice(0, 3).map((g) => g.next_step),
  };
}
