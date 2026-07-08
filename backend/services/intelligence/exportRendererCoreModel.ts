/** Part 1/2 of exportRendererCore.ts — verbatim split (barrel preserved; importers unchanged). */
/** Part 1/4 of exportRenderer.ts — verbatim split (barrel preserved; importers unchanged). */
// PDF-first executive dossier renderer.
//
// Replaces the Phase 7 dashboard-style HTML export with a premium executive
// dossier optimized for static HTML rendering and PDF conversion. Reading
// behaviour: top-to-bottom, narrative-driven, boardroom-grade.
//
// Architecture:
//   - 8 canonical sections, each answering one dominant executive question
//   - Boardroom-grade executive summary brief at the top
//   - High-signal insight cards in 4-part structure
//   - Strategic action playbook grouped into 4 horizons
//   - Print-safe typography, page-break controls, A4 margins
//
// canonical.* only — no legacy field consumption anywhere.

import type { CanonicalExportPayload } from './canonicalExport';
import type {
  CanonicalPillarScore,
  CanonicalScore,
  PillarKey,
} from '../canonicalReport/canonicalReportTypes';
import type {
  AiDiscoverabilitySection,
  AuthorityPositionSection,
  ExecutiveDossier,
  MarketPositionSection,
  MomentumMaturitySection,
  StrategicActionPlanSection,
  StrategicConstraintsSection,
  TrustConsistencySection,
} from './dossier/executiveDossier';
import { composeExecutiveDossier } from './dossier/executiveDossier';
import type { GroupedAction } from './dossier/actionGrouping';
import type { ConstraintNarrative } from './dossier/constraintNarrative';
import type { MaturityPattern } from './dossier/maturityPatterns';
import type { AuthorityShape } from './dossier/authorityShape';
import type { MaturityEvolution } from './dossier/maturityEvolution';
import type { MomentumShape } from './dossier/momentumShape';
import type { ClosingInterpretation } from './dossier/closingInterpretation';
import {
  renderAuthorityBar,
  renderPillarBalanceStrip,
  renderMaturityContinuum,
  renderAISurfaceSpectrum,
  renderBottleneckBar,
  renderPositioningBand,
  renderTrajectorySpark,
  renderConfidenceMatrix,
  renderDimensionRow,
  renderPillarDeltasStrip,
  renderEvidenceAnchorRow,
  type EvidenceAnchorItem,
} from './dossier/visualPrimitives';
import {
  buildDimensionBreakdown,
  buildScoreDrivers,
  buildComparativePositioning,
  buildTrajectoryMovement,
  buildDataConfidence,
  buildChannelLeverage,
  buildExecutionWindow,
  buildMarketContext,
  buildAIRetrievalReliability,
  buildAITrajectory,
  buildCompetitiveAIVisibility,
  buildBrandBrief,
  buildStrategicPosture,
  buildAIVisibilityState,
  buildAITrustCoherence,
  buildAIAbsenceRisk,
  buildAIStrategicUnlock,
  buildCompetitorMatrix,
  buildStrongestPeerGap,
  buildCompetitorBenchmark,
  buildLimitingDimensions,
  buildFastestLever,
  buildGrowthPathDirectives,
  buildStrategicPositionFourState,
  buildDataSourceStatusPanels,
  buildExecutionChannelMix,
  buildCompetitorPressure,
  type DimensionBreakdown,
  type ScoreDrivers,
  type ComparativePositioning,
  type TrajectoryMovement,
  type DataConfidence,
  type ChannelLeverage,
  type ExecutionWindow,
  type MarketContext,
  type AIRetrievalReliability,
  type AITrajectory,
  type CompetitiveAIVisibility,
  type BrandBrief,
  type StrategicPosture,
  type AIVisibilityState,
  type AITrustCoherence,
  type AIAbsenceRisk,
  type AIStrategicUnlock,
  type CompetitorMatrix,
  type StrongestPeerGap,
  type CompetitorBenchmark,
  type LimitingDimensions,
  type FastestLever,
  type GrowthPathDirectives,
  type StrategicPositionFourState,
  type DataSourceStatusPanels,
  type CompetitorPressure,
} from './dossier/intelligenceSurfaces';
import type { CanonicalReport } from '../canonicalReport/canonicalReportTypes';

/** Optional brand-presence inputs threaded from the canonical pipeline. */


export type ReportBranding = {
  brandName?: string | null;
  domain?: string | null;
  logoUrl?: string | null;
  /** Small mark used in the cover meta line and the running footer. */
  faviconUrl?: string | null;
  /** Canonical company context fields used to build the Brand Brief + Strategic Posture surfaces on the snapshot. */
  companyContext?: {
    primaryOffering?: string | null;
    marketContext?: string | null;
    positioning?: string | null;
    tagline?: string | null;
    homepageHeadline?: string | null;
    positioningStrength?: string | null;
    positioningNarrative?: string | null;
    positioningGap?: string | null;
    marketType?: string | null;
    marketPosition?: string | null;
    marketPositionStatement?: string | null;
    executionRisk?: string | null;
    resilienceGuidance?: string | null;
  } | null;
};

export const PILLAR_LABEL: Record<PillarKey, string> = {
  foundation: 'Foundation',
  authority: 'Authority',
  discoverability: 'Discoverability',
  trust: 'Trust',
  momentum: 'Momentum',
};

export const PILLAR_ACCENT: Record<PillarKey, string> = {
  foundation: '#0369a1',
  authority: '#4f46e5',
  discoverability: '#047857',
  trust: '#b45309',
  momentum: '#be123c',
};

// ── Escape + format helpers ──────────────────────────────────────────────────

export function escape(text: string | null | undefined): string {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function scoreNumber(score: CanonicalScore): string {
  if (score.value == null) return '—';
  return String(score.value);
}

export function scoreBand(score: CanonicalScore): string {
  if (score.value == null) return 'Insufficient signal';
  return score.band.charAt(0).toUpperCase() + score.band.slice(1);
}

function confidenceBadge(confidence: 'high' | 'medium' | 'low'): string {
  return `<span class="ds-pill ds-pill-confidence-${confidence}">${confidence} confidence</span>`;
}

export function isMeasuredScore(score: CanonicalScore): boolean {
  return typeof score.value === 'number' && score.state !== 'insufficient_signal' && score.state !== 'unavailable';
}

export function sentence(text: string | null | undefined, fallback: string, max = 150): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return fallback;
  const first = clean.match(/^[^.!?]+[.!?]/)?.[0] ?? clean;
  if (first.length <= max) return first;
  return `${first.slice(0, max - 1).trim()}...`;
}

export function formatReportDate(value: string | null | undefined): string {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(date);
}

export function bandLanguage(score: CanonicalScore): string {
  if (!isMeasuredScore(score)) return 'not yet sufficiently measured';
  if (score.band === 'leading') return 'strongly reinforced';
  if (score.band === 'operational') return 'operationally visible';
  if (score.band === 'developing') return 'partially reinforced';
  if (score.band === 'foundational') return 'early and fragile';
  return 'not yet sufficiently measured';
}

export function buildCoverThesis(dossier: ExecutiveDossier): string {
  // The Authority Shape block above the thesis already names the shape
  // explicitly. The thesis must NOT restate the shape name — its job is
  // to deliver the strategic interpretation in one calm sentence so the
  // cover does not loop on the same wording.
  const shape = dossier.authority_shape;
  if (shape.kind === 'insufficiently_measured_system') {
    return 'Authority formation cannot yet be read with executive confidence — the dossier renders the architecture honestly until evidence accumulates.';
  }
  return shape.what_it_means;
}

export function buildStrategicDirection(dossier: ExecutiveDossier): string {
  // Snapshot Strategic Direction must NOT open with the Authority
  // Shape name — the cover already establishes the shape; the
  // snapshot's job is to advance the read into action. Open with the
  // constraint clause + momentum read + concentration imperative.
  const sections = dossier.sections;
  const weakest = sections.authority_position.dominant_weakness;
  const momentumKind = dossier.momentum_shape.kind;
  const priority = sentence(
    dossier.summary_brief.strategic_priority.detail,
    sections.executive_reality.strategic_priority,
    180,
  );

  // Concept ownership: "maturity transition friction" is owned by
  // Momentum & Maturity. The snapshot uses "dominant constraint" so
  // each section carries one term cleanly.
  const constraintClause = weakest
    ? `${PILLAR_LABEL[weakest.pillar]} is the dominant constraint the dossier identifies.`
    : 'No single dimension yet dominates as the constraint.';

  const momentumClause = (() => {
    switch (momentumKind) {
      case 'compounding': return 'Momentum is compounding — sustain the inputs that produced it.';
      case 'stable': return 'Momentum is stable — coherence first, depth next.';
      case 'fragile': return 'Momentum is fragile — close the pillar spread before pursuing further lift.';
      case 'stagnating': return 'Momentum is stagnating — pick one pillar and commit decisively.';
      case 'declining': return 'Momentum is declining — diagnose the regression source before adding new initiatives.';
      case 'insufficient_history':
      default: return 'Momentum shape is still forming.';
    }
  })();

  return `${constraintClause} ${momentumClause} The highest-leverage next move is concentration — direct effort where the system can shift, not where activity is easiest to add. ${priority}`;
}

export function evidenceSufficiency(payload: CanonicalExportPayload): string {
  const trace = payload.evidence_appendix?.overall ?? payload.authority_overview.overall_score.evidence;
  const count = trace?.count ?? 0;
  if (count >= 12) return `Strong evidence base (${count} observations)`;
  if (count >= 5) return `Moderate evidence base (${count} observations)`;
  if (count > 0) return `Limited evidence base (${count} observations)`;
  return 'Evidence base not yet sufficient';
}

export function providerCoverage(payload: CanonicalExportPayload): string {
  const matrix = payload.ai_surface_presence.citation_matrix;
  if (matrix?.coverage) {
    return `${matrix.coverage.measured_cells}/${matrix.coverage.total_cells} AI retrieval cells measured`;
  }

  const sources = new Set<string>();
  [
    payload.authority_overview.overall_score.evidence,
    payload.ai_surface_presence.score.evidence,
    payload.knowledge_graph.score.evidence,
    payload.authority_inflow.score.evidence,
    payload.trust_coherence.score.evidence,
    payload.maturity_stage.evidence,
  ].forEach((trace) => trace.sources.forEach((source) => sources.add(source)));

  if (sources.size === 0) return 'Provider coverage not yet measured';
  return `${sources.size} evidence source type${sources.size === 1 ? '' : 's'} observed`;
}

// ── PDF-first stylesheet (editorial composition, structural invisibility) ────
//
// Print-safe defaults preserved unchanged:
//   - 24mm A4 margins
//   - serif body / sans heading mix
//   - page-break-inside: avoid on every strategic unit
//   - widows / orphans = 3
//
// Visual scaffolding refinements (this revision):
//   - Borders, backgrounds, and rounded corners removed from every interior
//     "card" class — page-break wrappers stay structurally but become
//     visually invisible.
//   - Section transitions move from solid hairlines to wide whitespace.
//   - Surface tinting reduced to a single subtle accent per section.
//   - Pill palette flattened: only critical-severity retains tint; everything
//     else uses one neutral grey so colour competition is removed.
//   - Page-break + display + min-height rules from the original kept verbatim.

