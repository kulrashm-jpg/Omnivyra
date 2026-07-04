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

const PILLAR_LABEL: Record<PillarKey, string> = {
  foundation: 'Foundation',
  authority: 'Authority',
  discoverability: 'Discoverability',
  trust: 'Trust',
  momentum: 'Momentum',
};

const PILLAR_ACCENT: Record<PillarKey, string> = {
  foundation: '#0369a1',
  authority: '#4f46e5',
  discoverability: '#047857',
  trust: '#b45309',
  momentum: '#be123c',
};

// ── Escape + format helpers ──────────────────────────────────────────────────

function escape(text: string | null | undefined): string {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function scoreNumber(score: CanonicalScore): string {
  if (score.value == null) return '—';
  return String(score.value);
}

function scoreBand(score: CanonicalScore): string {
  if (score.value == null) return 'Insufficient signal';
  return score.band.charAt(0).toUpperCase() + score.band.slice(1);
}

function confidenceBadge(confidence: 'high' | 'medium' | 'low'): string {
  return `<span class="ds-pill ds-pill-confidence-${confidence}">${confidence} confidence</span>`;
}

function isMeasuredScore(score: CanonicalScore): boolean {
  return typeof score.value === 'number' && score.state !== 'insufficient_signal' && score.state !== 'unavailable';
}

function sentence(text: string | null | undefined, fallback: string, max = 150): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return fallback;
  const first = clean.match(/^[^.!?]+[.!?]/)?.[0] ?? clean;
  if (first.length <= max) return first;
  return `${first.slice(0, max - 1).trim()}...`;
}

function formatReportDate(value: string | null | undefined): string {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(date);
}

function bandLanguage(score: CanonicalScore): string {
  if (!isMeasuredScore(score)) return 'not yet sufficiently measured';
  if (score.band === 'leading') return 'strongly reinforced';
  if (score.band === 'operational') return 'operationally visible';
  if (score.band === 'developing') return 'partially reinforced';
  if (score.band === 'foundational') return 'early and fragile';
  return 'not yet sufficiently measured';
}

function buildCoverThesis(dossier: ExecutiveDossier): string {
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

function buildStrategicDirection(dossier: ExecutiveDossier): string {
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

function evidenceSufficiency(payload: CanonicalExportPayload): string {
  const trace = payload.evidence_appendix?.overall ?? payload.authority_overview.overall_score.evidence;
  const count = trace?.count ?? 0;
  if (count >= 12) return `Strong evidence base (${count} observations)`;
  if (count >= 5) return `Moderate evidence base (${count} observations)`;
  if (count > 0) return `Limited evidence base (${count} observations)`;
  return 'Evidence base not yet sufficient';
}

function providerCoverage(payload: CanonicalExportPayload): string {
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

const STYLESHEET = `
  /* Print-luxury margins. Slightly more generous on the outer edge so
     pages handle elegantly when bound or held; restrained enough that
     the body measure stays comfortable for a serif at 10.5pt. */
  @page {
    size: A4;
    margin: 26mm 24mm 22mm 24mm;
  }
  /* Cover page intentionally drops the running footer; the cover meta
     row carries its own date treatment. Interior pages run the page
     number + brand mark in the bottom margin. */
  @page :first { margin: 24mm 22mm 22mm 22mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #fff;
    color: #1a2332;
    font-family: "Source Serif 4", "Georgia", "Times New Roman", serif;
    font-size: 10.5pt;
    line-height: 1.65;
    text-rendering: optimizeLegibility;
    font-feature-settings: "kern", "liga", "calt";
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1, h2, h3, h4, h5, .ds-section-question, .ds-pill, .ds-eyebrow {
    font-family: "Inter", "Segoe UI", system-ui, -apple-system, sans-serif;
    font-weight: 580;
  }
  p { orphans: 3; widows: 3; }
  /* Tabular numerals on every quantitative element so scores align
     vertically across bars, pillars, and matrix cells. */
  .ds-vbar-value, .ds-vstrip-value, .ds-vbottleneck-value, .ds-vspectrum-meta,
  .ds-pillar-score, .ds-hero-score-value, .ds-ai-card-score, .ds-matrix td,
  .ds-weak-dim strong { font-variant-numeric: tabular-nums; }
  .ds-page { padding: 0; max-width: 720px; margin: 0 auto; }

  /* ── Cover ─────────────────────────────────────────────────────────────── */
  /* The cover is the one full-bleed surface that legitimately uses tint;
     everything inside the document body afterwards is composed in pure
     typography. */
  .ds-cover {
    padding: 18mm 0 14mm;
    page-break-after: always;
    break-after: page;
    display: block;
    position: relative;
  }
  .ds-cover:before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      linear-gradient(115deg, rgba(2, 132, 199, 0.04), rgba(255,255,255,0) 42%),
      linear-gradient(180deg, rgba(15, 23, 42, 0.025), rgba(255,255,255,0) 34%);
  }
  .ds-cover-mark {
    width: 25mm;
    height: 0.6mm;
    border-radius: 999px;
    background: linear-gradient(90deg, #0f4c6b, rgba(15, 76, 107, 0.25));
    margin: 0 0 14mm;
  }
  .ds-cover-content { position: relative; z-index: 1; max-width: 150mm; }
  /* Identity cluster — logo (or H1 wordmark) + domain are tightly
     coupled so the eye reads them as one unit. The dossier title
     appears AFTER a larger break, signalling a hierarchy step. */
  .ds-cover-identity { margin: 0 0 12mm; }
  .ds-cover-company { font-size: 28pt; line-height: 1.06; margin: 0 0 3.5mm; color: #0f172a; font-weight: 600; letter-spacing: -0.018em; }
  .ds-cover-domain { font-size: 9pt; letter-spacing: 0.18em; text-transform: uppercase; color: #94a3b8; margin: 0; font-family: "Inter", system-ui, sans-serif; font-weight: 540; }
  .ds-cover-title { font-size: 11.5pt; letter-spacing: 0.2em; text-transform: uppercase; color: #475569; margin: 0 0 7mm; font-family: "Inter", system-ui, sans-serif; font-weight: 560; }

  /* Authority Shape cover identity block — the dominant strategic
     statement on the cover. Sits between the dossier title and the
     thesis. Sized to share weight with the company name rather than
     compete with it; the eye lands on company → shape → thesis in a
     calm vertical rhythm. */
  .ds-cover-shape { margin: 14mm 0 0; max-width: 150mm; }
  .ds-cover-shape-eyebrow { font-size: 7.6pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 2.5mm; font-family: "Inter", system-ui, sans-serif; font-weight: 600; }
  .ds-cover-shape-name { font-size: 19pt; line-height: 1.22; margin: 0; color: #0f172a; font-weight: 580; letter-spacing: -0.014em; font-family: "Inter", system-ui, sans-serif; }

  .ds-cover-thesis { font-size: 14.5pt; line-height: 1.55; color: #1a2332; margin: 13mm 0 0; max-width: 138mm; font-family: "Inter", system-ui, sans-serif; font-weight: 400; }
  /* Meta row sits with intentional proximity to the thesis (16mm)
     rather than floating to the bottom of the cover via flex
     space-between. This eliminates the dead-zone the previous layout
     produced and matches the proximity rhythm of the identity cluster. */
  .ds-cover-meta-row {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8mm;
    margin-top: 16mm;
    padding-top: 6mm;
    border-top: 0.2mm solid #e8edf2;
    color: #64748b;
    font-size: 9pt;
    font-family: "Inter", system-ui, sans-serif;
  }
  .ds-cover-stage {
    display: inline-flex;
    align-items: baseline;
    gap: 2.5mm;
    color: #1a2332;
    font-size: 8.5pt;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    font-weight: 650;
  }
  .ds-cover-stage:before {
    content: "·";
    color: #64748b;
    font-weight: 400;
  }

  /* ── Snapshot (page 2) ─────────────────────────────────────────────────── */
  /* Every panel border/background here has been removed. Grouping is carried
     entirely by typographic eyebrow labels + vertical rhythm. */
  .ds-snapshot {
    min-height: 249mm;
    padding: 13mm 0 10mm;
    page-break-after: always;
    break-after: page;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .ds-snapshot-header { margin: 0 0 11mm; }
  .ds-snapshot-kicker { font-size: 8pt; letter-spacing: 0.24em; text-transform: uppercase; color: #64748b; margin: 0 0 4.5mm; font-family: "Inter", system-ui, sans-serif; font-weight: 600; }
  .ds-snapshot-title { font-size: 21pt; line-height: 1.18; margin: 0 0 5mm; color: #0f172a; font-weight: 620; letter-spacing: -0.014em; }
  .ds-authority-shape { font-size: 13.5pt; line-height: 1.55; margin: 0; color: #1a2332; font-family: "Inter", system-ui, sans-serif; font-weight: 420; max-width: 150mm; }

  /* Signal grid: borderless. Vertical rhythm + a faint typographic separator
     instead of a top rule. */
  .ds-signal-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 9mm 9mm; margin: 10mm 0 11mm; }
  .ds-signal { min-height: 30mm; padding: 0; page-break-inside: avoid; }
  .ds-signal-label { font-size: 7.2pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; margin: 0 0 2.5mm; font-family: "Inter", system-ui, sans-serif; font-weight: 580; }
  .ds-signal-value { font-size: 10.8pt; line-height: 1.32; color: #0f172a; margin: 0 0 2.2mm; font-family: "Inter", system-ui, sans-serif; font-weight: 540; letter-spacing: -0.005em; }
  .ds-signal-detail { font-size: 9pt; line-height: 1.6; color: #475569; margin: 0; }

  .ds-direction { margin: 0 0 9mm; padding: 9mm 0 0; page-break-inside: avoid; }
  .ds-direction-label { font-size: 7.4pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 3.2mm; font-family: "Inter", system-ui, sans-serif; font-weight: 580; }
  .ds-direction-text { font-size: 11pt; line-height: 1.72; color: #1a2332; margin: 0; max-width: 152mm; }

  /* Evidence bar at the bottom of the snapshot — single thin hairline only,
     not a bordered footer. */
  .ds-evidence-bar {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 7mm;
    padding-top: 7mm;
    color: #64748b;
    font-family: "Inter", system-ui, sans-serif;
    page-break-inside: avoid;
    border-top: 0.2mm solid #eef1f5;
  }
  .ds-evidence-label { display: block; font-size: 6.8pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; font-weight: 580; margin-bottom: 1.4mm; }
  .ds-evidence-value { font-size: 8.4pt; line-height: 1.45; color: #475569; }

  /* ── Section frame ─────────────────────────────────────────────────────── */
  /* Sections separated by whitespace alone. The previous solid hairline
     between sections is removed; a generous top padding carries the rhythm. */
  .ds-section { padding: 16mm 0 6mm; page-break-inside: auto; }
  .ds-section + .ds-section { padding-top: 16mm; }
  .ds-section-eyebrow {
    font-size: 7.6pt;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: #94a3b8;
    margin: 0 0 4mm;
    font-weight: 600;
  }
  .ds-section-title { font-size: 17pt; line-height: 1.24; margin: 0 0 2.5mm; font-weight: 600; color: #0f172a; letter-spacing: -0.012em; }
  .ds-section-question {
    font-size: 10.6pt;
    color: #64748b;
    margin: 0 0 10mm;
    font-style: italic;
    font-weight: 400;
  }

  /* ── Hero score row (Executive Reality + Trust) ─────────────────────────
     Borderless. Typography is the focal point — the number is the visual
     hero, not a bordered card around the number. */
  .ds-hero-score-row { display: grid; grid-template-columns: 1fr 2fr; gap: 10mm; align-items: baseline; margin: 6mm 0 4mm; }
  .ds-hero-score { padding: 0; }
  .ds-hero-score-value { font-size: 48pt; line-height: 1; font-weight: 680; color: #0f172a; font-family: "Inter", system-ui, sans-serif; letter-spacing: -0.025em; }
  .ds-hero-score-of { font-size: 13pt; color: #cbd5e1; margin-left: 2.5mm; font-weight: 400; }
  .ds-hero-score-band { font-size: 8.5pt; letter-spacing: 0.22em; text-transform: uppercase; color: #64748b; margin: 3mm 0 0; font-family: "Inter", system-ui, sans-serif; font-weight: 600; }
  .ds-hero-priority { padding: 0; }
  .ds-hero-priority-label { font-size: 8pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; margin: 0 0 2.5mm; font-weight: 650; }
  .ds-hero-priority-text { font-size: 11pt; line-height: 1.65; color: #1a2332; margin: 0; }

  /* ── Insight cards ─────────────────────────────────────────────────────
     Page-break wrapper preserved. Card border / background / radius removed.
     Tone is communicated by a single thin left rail (0.6mm) — quiet by
     comparison to a full panel. Internal blocks group through eyebrow
     labels alone, no shaded sub-panels. */
  .ds-insights { margin: 5mm 0 0; }
  .ds-insight {
    page-break-inside: avoid;
    padding: 3mm 0 4mm 5.5mm;
    margin: 0 0 9mm;
    border-left: 0.4mm solid #cbd5e1;
    background: transparent;
    border-radius: 0;
  }
  .ds-insight-tone-risk { border-left-color: #c2410c; }
  .ds-insight-tone-opportunity { border-left-color: #047857; }
  .ds-insight-tone-momentum { border-left-color: #1d4ed8; }
  .ds-insight-tone-context { border-left-color: #cbd5e1; }
  .ds-insight-eyebrow { font-size: 7.2pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 3.5mm; font-weight: 600; }
  .ds-insight-block + .ds-insight-block { margin-top: 4.5mm; }
  .ds-insight-block-label { font-size: 7pt; letter-spacing: 0.22em; text-transform: uppercase; color: #cbd5e1; margin: 0 0 1.4mm; font-weight: 600; }
  .ds-insight-block-text { font-size: 10pt; line-height: 1.65; color: #1a2332; margin: 0; }
  .ds-insight-block-text.is-observation { font-weight: 540; color: #0f172a; font-size: 10.4pt; letter-spacing: -0.002em; }

  /* ── Pillar grid ───────────────────────────────────────────────────────
     Dashed bottom border between rows replaced with whitespace. Each row
     now reads as a typographic pair (number + name) rather than a row
     between separator lines. */
  .ds-pillar-grid { margin: 7mm 0 0; }
  .ds-pillar { display: grid; grid-template-columns: 22mm 1fr; gap: 7mm; padding: 5.5mm 0; page-break-inside: avoid; }
  .ds-pillar-rail { padding-left: 0; border-left: 0; }
  .ds-pillar-score { font-size: 26pt; line-height: 1; font-weight: 620; color: #0f172a; font-family: "Inter", system-ui, sans-serif; letter-spacing: -0.024em; font-variant-numeric: tabular-nums; }
  .ds-pillar-score-of { font-size: 9pt; color: #cbd5e1; font-weight: 400; }
  .ds-pillar-band { font-size: 7.2pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; margin-top: 2.2mm; font-family: "Inter", system-ui, sans-serif; font-weight: 580; }
  .ds-pillar-name { font-size: 11.5pt; font-weight: 540; margin: 0 0 1mm; font-family: "Inter", system-ui, sans-serif; color: #0f172a; letter-spacing: -0.005em; }
  .ds-pillar-purpose { font-size: 8.8pt; color: #64748b; margin: 0 0 2.8mm; font-style: italic; }
  /* Inline score bar — adds analytical instrumentation to every pillar
     row so the page reads as evidence-rich within seconds, not just a
     stack of numbers + prose. */
  .ds-pillar-bar { width: 100%; height: 1.4mm; background: #f1f5f9; border-radius: 0.7mm; overflow: hidden; margin: 0 0 2.2mm; }
  .ds-pillar-bar-fill { height: 100%; border-radius: inherit; }
  .ds-pillar-signal { font-size: 9.6pt; color: #1a2332; margin: 1mm 0 0; line-height: 1.6; }

  /* ── AI hero ──────────────────────────────────────────────────────────
     The colored gradient panel is removed. The two AI sub-cards lose their
     borders + backgrounds — they're now typographic columns separated by
     whitespace. The matrix itself gains a single subtle top rule, which is
     the only "framing" element that survives. */
  .ds-ai-hero { padding: 0; background: transparent; border-radius: 0; margin: 4mm 0 0; }
  .ds-ai-positioning { font-size: 11.5pt; line-height: 1.7; color: #1a2332; margin: 0 0 9mm; font-style: italic; max-width: 155mm; }
  .ds-ai-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12mm; margin: 0 0 9mm; }
  .ds-ai-card { padding: 0; background: transparent; border: 0; border-radius: 0; }
  .ds-ai-card-label { font-size: 7.8pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; font-weight: 650; margin: 0 0 3mm; }
  .ds-ai-card-score { font-size: 26pt; line-height: 1; font-weight: 680; color: #0f172a; font-family: "Inter", system-ui, sans-serif; letter-spacing: -0.02em; }
  .ds-ai-card-detail { font-size: 9.5pt; color: #475569; margin: 3mm 0 0; line-height: 1.55; }

  /* ── Citation matrix ──────────────────────────────────────────────────
     The matrix is genuinely tabular data and stays gridded — but the grid
     lines are reduced to 0.2mm at low contrast, headers lose their fill,
     and only "strong cell" still uses tint to communicate the data. */
  .ds-matrix { width: 100%; border-collapse: collapse; margin: 6mm 0 0; font-size: 8pt; font-family: "Inter", system-ui, sans-serif; }
  .ds-matrix th, .ds-matrix td { border: 0.2mm solid #e8edf2; padding: 1.8mm 2mm; text-align: center; }
  .ds-matrix th { background: transparent; font-weight: 600; color: #94a3b8; letter-spacing: 0.06em; text-transform: uppercase; font-size: 7pt; }
  .ds-matrix td.label { text-align: left; background: transparent; font-weight: 600; color: #1a2332; }
  .ds-matrix-cell-measured { color: #1a2332; }
  .ds-matrix-cell-empty { color: #cbd5e1; }
  .ds-matrix-cell-strong { background: #ecfdf5; color: #047857; font-weight: 600; }
  .ds-matrix-cell-moderate { background: transparent; color: #b45309; }
  .ds-matrix-cell-weak { background: transparent; color: #b91c1c; }

  /* ── Maturity storyline ────────────────────────────────────────────────
     The bordered "card" containing the storyline is removed. Stage label
     becomes a heading; phases become typographic pairs separated by
     whitespace, not dashed rules. */
  .ds-maturity { margin: 6mm 0 0; padding: 0; border: 0; border-radius: 0; page-break-inside: avoid; }
  .ds-maturity-stage { font-size: 16pt; font-weight: 660; margin: 0 0 1.5mm; font-family: "Inter", system-ui, sans-serif; color: #0f172a; letter-spacing: -0.005em; }
  .ds-maturity-next { font-size: 9.5pt; color: #64748b; margin: 0 0 7mm; font-style: italic; }
  .ds-storyline { list-style: none; margin: 5mm 0 0; padding: 0; }
  .ds-storyline-item { padding: 4mm 0; border: 0; page-break-inside: avoid; }
  .ds-storyline-item:last-child { padding-bottom: 0; }
  .ds-storyline-phase { font-size: 7.6pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; font-weight: 650; margin: 0 0 1.8mm; }
  .ds-storyline-text { font-size: 10.2pt; line-height: 1.65; color: #1a2332; margin: 0; max-width: 155mm; }

  /* ── Action playbook ──────────────────────────────────────────────────
     Action card borders + backgrounds removed. Each action becomes a
     typographic block with a left rail tone (severity-driven) and an
     eyebrow row of pills. Group containers lose all framing. */
  .ds-playbook-group { margin: 9mm 0 0; page-break-inside: avoid; }
  .ds-playbook-group-header { padding: 0; margin: 0 0 5mm; }
  .ds-playbook-group-label { font-size: 11pt; font-weight: 600; margin: 0 0 1.5mm; font-family: "Inter", system-ui, sans-serif; color: #0f172a; letter-spacing: -0.005em; }
  .ds-playbook-group-desc { font-size: 9.5pt; line-height: 1.6; color: #64748b; margin: 0; max-width: 155mm; font-style: italic; }
  .ds-action {
    page-break-inside: avoid;
    border: 0;
    border-left: 0.4mm solid #e8edf2;
    border-radius: 0;
    background: transparent;
    padding: 2mm 0 4mm 5.5mm;
    margin: 0 0 7mm;
  }
  .ds-action-title { font-size: 10.6pt; font-weight: 560; margin: 0 0 2.2mm; font-family: "Inter", system-ui, sans-serif; color: #0f172a; letter-spacing: -0.005em; }
  .ds-action-rationale { font-size: 9pt; color: #94a3b8; line-height: 1.55; margin: 0 0 2.5mm; font-style: italic; }
  .ds-action-meta { display: flex; flex-wrap: wrap; gap: 2.2mm; margin-top: 3.5mm; }
  .ds-action-impacts { font-size: 9pt; color: #1a2332; margin: 2mm 0 0; }
  .ds-action-impacts dt { display: inline; font-weight: 600; color: #475569; }
  .ds-action-impacts dd { display: inline; margin: 0 4mm 0 0; }

  /* ── Pills ─────────────────────────────────────────────────────────────
     Flattened palette. Pillar pills retain their muted accent for
     wayfinding inside long action lists; everything else collapses to a
     single restrained grey so colour competition disappears. */
  .ds-pill {
    display: inline-block;
    padding: 0.7mm 2.2mm;
    font-size: 6.8pt;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    border-radius: 99px;
    background: #f5f7fa;
    color: #475569;
    font-weight: 540;
  }
  .ds-pill-pillar-foundation { background: #eff6ff; color: #1e40af; }
  .ds-pill-pillar-authority { background: #f5f3ff; color: #5b21b6; }
  .ds-pill-pillar-discoverability { background: #ecfdf5; color: #047857; }
  .ds-pill-pillar-trust { background: #fffbeb; color: #b45309; }
  .ds-pill-pillar-momentum { background: #fff1f2; color: #be123c; }
  .ds-pill-confidence-high { background: #ecfdf5; color: #047857; }
  .ds-pill-confidence-medium { background: #f1f5f9; color: #475569; }
  .ds-pill-confidence-low { background: #f8fafc; color: #94a3b8; }
  .ds-pill-severity-critical { background: #fee2e2; color: #b91c1c; }
  .ds-pill-severity-moderate { background: #f1f5f9; color: #475569; }
  .ds-pill-severity-low { background: #f8fafc; color: #94a3b8; }

  /* Sever the action's left rail tone with severity (so eye reads severity
     without needing the pill). */
  .ds-action.ds-action-severity-critical { border-left-color: #c2410c; border-left-width: 0.6mm; }
  .ds-action.ds-action-severity-moderate { border-left-color: #cbd5e1; }
  .ds-action.ds-action-severity-low { border-left-color: #e8edf2; }

  /* ── Framing sentence (section opener) ────────────────────────────────
     A single memorable sentence that opens each major section. The
     premium framing pairs a serif italic with a comfortable measure
     and generous lead-in space; the line carries by typography alone,
     never a panel or pull-quote widget. */
  .ds-framing { font-size: 13pt; line-height: 1.6; color: #0f172a; margin: 0 0 10mm; max-width: 148mm; font-style: italic; font-family: "Source Serif 4", Georgia, serif; font-weight: 420; letter-spacing: -0.002em; }

  /* ── Constraint narrative (4-part interpretive block) ─────────────────
     Strategic interpretation, NOT a recommendation card. Eyebrow + body
     pairs separated by whitespace. Page-break wrapper preserved. */
  .ds-constraint-narrative { margin: 4mm 0 7mm; padding: 0; page-break-inside: avoid; }
  .ds-constraint-narrative-row { margin: 0 0 4.5mm; max-width: 152mm; }
  .ds-constraint-narrative-row:last-child { margin-bottom: 0; }
  .ds-constraint-narrative-label { font-size: 7.2pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 1.8mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-constraint-narrative-text { font-size: 10.2pt; line-height: 1.7; color: #1a2332; margin: 0; }

  /* ── Maturity pattern ("What leaders typically do") ───────────────────
     Pattern observation paired with the storyline. No tint, no card. */
  .ds-pattern { margin: 7mm 0 0; padding: 0; page-break-inside: avoid; max-width: 155mm; }
  .ds-pattern-eyebrow { font-size: 7.6pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; margin: 0 0 2.5mm; font-weight: 650; font-family: "Inter", system-ui, sans-serif; }
  .ds-pattern-row { margin: 0 0 3.5mm; }
  .ds-pattern-row:last-child { margin-bottom: 0; }
  .ds-pattern-row-label { font-size: 7.2pt; letter-spacing: 0.2em; text-transform: uppercase; color: #cbd5e1; margin: 0 0 1mm; font-weight: 650; font-family: "Inter", system-ui, sans-serif; }
  .ds-pattern-row-text { font-size: 10pt; line-height: 1.6; color: #1a2332; margin: 0; }

  /* ── Authority Shape (signature interpretation primitive) ─────────────
     Same typographic rhythm as constraint narrative — the shape is named
     as a sub-heading, then a single calm paragraph explains it. No tint,
     no rule, no panel. The shape's memorability comes from repetition
     across the cover, snapshot, authority position, and closing — not
     from visual weight. */
  .ds-authority-shape-block { margin: 9mm 0 0; padding: 0; page-break-inside: avoid; max-width: 152mm; }
  .ds-authority-shape-eyebrow { font-size: 7.2pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 2.2mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-authority-shape-name { font-size: 12.8pt; line-height: 1.32; color: #0f172a; margin: 0 0 3mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; letter-spacing: -0.012em; }
  .ds-authority-shape-why { font-size: 9.4pt; line-height: 1.6; color: #64748b; margin: 0 0 3.2mm; font-style: italic; }
  .ds-authority-shape-body { font-size: 10.2pt; line-height: 1.7; color: #1a2332; margin: 0; }

  /* ── Maturity evolution (developmental story) ────────────────────────
     5-row eyebrow + body block. Replaces the older numbered-storyline
     visualisation. */
  .ds-maturity-evolution { margin: 8mm 0 0; padding: 0; page-break-inside: avoid; max-width: 152mm; }
  .ds-maturity-evolution-eyebrow { font-size: 7.2pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 4.5mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-maturity-evolution-row { margin: 0 0 4.5mm; }
  .ds-maturity-evolution-row:last-child { margin-bottom: 0; }
  .ds-maturity-evolution-row-label { font-size: 7pt; letter-spacing: 0.22em; text-transform: uppercase; color: #cbd5e1; margin: 0 0 0.6mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-maturity-evolution-row-caption { font-size: 8.4pt; line-height: 1.45; color: #94a3b8; margin: 0 0 1.8mm; font-style: italic; font-family: "Source Serif 4", Georgia, serif; }
  .ds-maturity-evolution-row-text { font-size: 10.2pt; line-height: 1.7; color: #1a2332; margin: 0; }

  /* ── Momentum shape ──────────────────────────────────────────────────
     Single short label + reading + interpretation, typographic only. */
  .ds-momentum-shape { margin: 7mm 0 0; padding: 0; page-break-inside: avoid; max-width: 155mm; }
  .ds-momentum-shape-eyebrow { font-size: 7.6pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; margin: 0 0 2mm; font-weight: 650; font-family: "Inter", system-ui, sans-serif; }
  .ds-momentum-shape-label { font-size: 12pt; line-height: 1.4; color: #0f172a; margin: 0 0 2mm; font-weight: 620; font-family: "Inter", system-ui, sans-serif; letter-spacing: -0.005em; }
  .ds-momentum-shape-reading { font-size: 9.5pt; line-height: 1.55; color: #64748b; margin: 0 0 3mm; font-style: italic; }
  .ds-momentum-shape-body { font-size: 10.2pt; line-height: 1.65; color: #1a2332; margin: 0; }

  /* ── Methodology page (How These Numbers Are Calculated) ──────────────
     Final transparency block. Editorial dl-list, no card chrome.
     Renders before the closing interpretation so readers can see the
     derivation logic. */
  .ds-methodology { padding: 24mm 0 6mm; page-break-inside: avoid; }
  .ds-methodology-eyebrow { font-size: 7.6pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 4mm; font-weight: 600; font-family: "Inter", system-ui, sans-serif; }
  .ds-methodology-title { font-size: 17pt; line-height: 1.24; margin: 0 0 6mm; color: #0f172a; font-weight: 600; letter-spacing: -0.012em; max-width: 148mm; }
  .ds-methodology-lead { font-size: 10.6pt; line-height: 1.7; color: #1a2332; margin: 0 0 8mm; max-width: 152mm; font-style: italic; }
  .ds-methodology-list { margin: 0 0 8mm; padding: 0; }
  .ds-methodology-row { padding: 4mm 0; border-bottom: 0.15mm solid #f1f5f9; page-break-inside: avoid; display: grid; grid-template-columns: 42mm 1fr; gap: 6mm; }
  .ds-methodology-row:last-child { border-bottom: 0; }
  .ds-methodology-label { font-size: 9.4pt; color: #0f172a; font-family: "Inter", system-ui, sans-serif; font-weight: 580; letter-spacing: -0.005em; margin: 0; padding-top: 0.5mm; }
  .ds-methodology-body { font-size: 9.6pt; color: #1a2332; line-height: 1.65; margin: 0; }
  .ds-methodology-foot { font-size: 9.4pt; color: #64748b; line-height: 1.65; max-width: 152mm; font-style: italic; margin: 0; padding-top: 5mm; border-top: 0.2mm solid #e8edf2; }

  /* ── Closing strategic interpretation ────────────────────────────────
     The dossier's final block. A restrained, executive-grade summary —
     four eyebrow + body pairs and a serif headline above. Composed
     entirely in typography; sits on the final page after the action
     plan. No card, no rule, no tint. */
  .ds-closing { padding: 26mm 0 0; page-break-inside: avoid; }
  .ds-closing-eyebrow { font-size: 7.4pt; letter-spacing: 0.26em; text-transform: uppercase; color: #94a3b8; margin: 0 0 4.5mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-closing-title { font-size: 17pt; line-height: 1.24; margin: 0 0 11mm; color: #0f172a; font-weight: 600; letter-spacing: -0.014em; max-width: 144mm; }
  .ds-closing-row { margin: 0 0 7mm; max-width: 152mm; }
  .ds-closing-row:last-child { margin-bottom: 0; }
  .ds-closing-row-label { font-size: 7.2pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 0.8mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-closing-row-caption { font-size: 8.6pt; line-height: 1.45; color: #94a3b8; margin: 0 0 2.4mm; font-style: italic; font-family: "Source Serif 4", Georgia, serif; }
  .ds-closing-row-text { font-size: 10.4pt; line-height: 1.72; color: #1a2332; margin: 0; }

  /* ── Constraints ──────────────────────────────────────────────────────
     The two "warning" panels (yellow + red full-bleed) are eliminated.
     Each constraint is now an editorial block: small-caps eyebrow in tone
     colour, body in serif, hairline left rail. No background tint. */
  .ds-constraint {
    padding: 1mm 0 4mm 5mm;
    border-radius: 0;
    margin: 6mm 0 0;
    page-break-inside: avoid;
    background: transparent;
    border-left: 0.6mm solid #cbd5e1;
  }
  .ds-constraint-primary { border-left-color: #b45309; }
  .ds-constraint-risk { border-left-color: #b91c1c; }
  .ds-constraint-label { font-size: 7.6pt; letter-spacing: 0.22em; text-transform: uppercase; font-weight: 650; margin: 0 0 2.5mm; color: #94a3b8; }
  .ds-constraint-text { font-size: 10.5pt; line-height: 1.65; margin: 0; color: #1a2332; }

  .ds-weak-dims { margin: 7mm 0 0; padding: 0; list-style: none; }
  .ds-weak-dim {
    padding: 3mm 0;
    border: 0;
    display: flex;
    justify-content: space-between;
    gap: 6mm;
    font-size: 9.8pt;
    color: #1a2332;
  }
  .ds-weak-dim:last-child { padding-bottom: 0; }
  .ds-weak-dim strong { font-family: "Inter", system-ui, sans-serif; font-weight: 600; color: #0f172a; }

  /* ── Footer ───────────────────────────────────────────────────────────
     Single thin hairline, restrained body, no shouted brand colour. */
  .ds-footer { padding: 7mm 0 0; margin-top: 22mm; color: #94a3b8; font-size: 7.4pt; border-top: 0.2mm solid #eef1f5; font-family: "Inter", system-ui, sans-serif; letter-spacing: 0.06em; font-weight: 500; display: flex; align-items: center; gap: 3mm; }
  .ds-footer-mark { width: 4mm; height: 4mm; border-radius: 0.6mm; opacity: 0.8; flex-shrink: 0; object-fit: contain; }
  .ds-footer-text { flex: 1; }

  /* ── Executive visualisation primitives ───────────────────────────────
     Print-safe HTML visualisation set. Each block uses the existing
     restrained palette (slate, ink, soft accents). Emphasis is reserved
     for state-meaningful colour (amber for bottleneck; pillar accents
     for pillar identity). All bars are pure HTML/CSS — no SVG, no
     canvas, no JS. */

  /* Polish rule: every primitive thins its track, softens its markers,
     and reduces numerical bolding. The visuals now read as fine
     editorial bands rather than dashboard widgets. */

  /* Generic horizontal authority bar. Standard variant is hairline-thin
     for inline use; emphasis variant carries the cover/snapshot hero. */
  .ds-vbar { margin: 5mm 0 0; page-break-inside: avoid; }
  .ds-vbar-track { width: 100%; height: 2.4mm; background: #f1f5f9; border-radius: 1.2mm; overflow: hidden; }
  .ds-vbar-emphasis .ds-vbar-track { height: 3mm; border-radius: 1.5mm; }
  .ds-vbar-fill { height: 100%; border-radius: inherit; }
  .ds-vbar-value { font-size: 10.5pt; line-height: 1.2; color: #0f172a; margin: 2.8mm 0 0; font-family: "Inter", system-ui, sans-serif; font-weight: 580; letter-spacing: -0.008em; }
  .ds-vbar-of { font-size: 7.8pt; color: #cbd5e1; font-weight: 400; margin-left: 1mm; letter-spacing: 0; }
  .ds-vbar-label { font-size: 7.4pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 1.8mm 0 0; font-family: "Inter", system-ui, sans-serif; font-weight: 600; }

  /* Pillar balance strip — finer rows; label and value both read as
     editorial type, not dashboard chips. */
  .ds-vstrip { margin: 6mm 0 0; page-break-inside: avoid; max-width: 152mm; }
  .ds-vstrip-row { display: grid; grid-template-columns: 30mm 1fr 11mm; align-items: center; gap: 5mm; padding: 1.6mm 0; }
  .ds-vstrip-label { font-size: 8.6pt; font-family: "Inter", system-ui, sans-serif; font-weight: 540; letter-spacing: -0.002em; }
  .ds-vstrip-track { height: 1.6mm; background: #f1f5f9; border-radius: 0.8mm; overflow: hidden; }
  .ds-vstrip-fill { height: 100%; border-radius: inherit; }
  .ds-vstrip-value { font-size: 8.6pt; color: #0f172a; font-family: "Inter", system-ui, sans-serif; font-weight: 540; text-align: right; letter-spacing: -0.002em; }

  /* Maturity continuum — track halved, marker reduced; the stage
     labels now read as a typographic rhythm rather than chip badges. */
  .ds-vcontinuum { margin: 6mm 0 0; page-break-inside: avoid; max-width: 158mm; }
  .ds-vcontinuum-track { position: relative; height: 0.8mm; background: #e8edf2; border-radius: 0.4mm; overflow: visible; }
  .ds-vcontinuum-progress { height: 100%; background: #0f4c6b; border-radius: inherit; }
  .ds-vcontinuum-marker { position: absolute; top: 50%; transform: translate(-50%, -50%); width: 2.4mm; height: 2.4mm; background: #0f172a; border-radius: 50%; box-shadow: 0 0 0 1mm #fff; }
  .ds-vcontinuum-stages { display: grid; grid-template-columns: repeat(6, 1fr); gap: 1mm; margin: 4mm 0 0; }
  .ds-vcontinuum-stage { font-size: 6.8pt; letter-spacing: 0.08em; text-transform: uppercase; color: #cbd5e1; font-family: "Inter", system-ui, sans-serif; font-weight: 540; text-align: center; }
  .ds-vcontinuum-stage.is-passed { color: #94a3b8; }
  .ds-vcontinuum-stage.is-current { color: #0f172a; font-weight: 620; }

  /* AI surface spectrum — flatter band; the marker is a hair-thin rule
     rather than a heavy bar so the visual feels editorial. */
  .ds-vspectrum { margin: 5mm 0 6mm; page-break-inside: avoid; max-width: 158mm; }
  .ds-vspectrum-track { position: relative; display: grid; grid-template-columns: 1fr 1fr 1fr; height: 5.4mm; border-radius: 1mm; overflow: hidden; }
  .ds-vspectrum-zone { display: flex; align-items: center; justify-content: center; font-size: 6.8pt; letter-spacing: 0.18em; text-transform: uppercase; color: #475569; font-family: "Inter", system-ui, sans-serif; font-weight: 580; }
  .ds-vspectrum-zone.is-absent { background: #f5f7fa; }
  .ds-vspectrum-zone.is-retrievable { background: #e6edf3; }
  .ds-vspectrum-zone.is-cited { background: #dbe9dd; color: #047857; }
  .ds-vspectrum-marker { position: absolute; top: -1.2mm; bottom: -1.2mm; width: 0.5mm; background: #0f172a; transform: translateX(-50%); border-radius: 0.25mm; }
  .ds-vspectrum-meta { display: flex; justify-content: space-between; align-items: baseline; margin: 3mm 0 0; font-family: "Inter", system-ui, sans-serif; }
  .ds-vspectrum-meta span:first-child { font-size: 10.5pt; color: #0f172a; font-weight: 580; letter-spacing: -0.008em; }
  .ds-vspectrum-of { font-size: 7.8pt; color: #cbd5e1; font-weight: 400; margin-left: 1mm; }
  .ds-vspectrum-meta span:last-child { font-size: 7pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; font-weight: 600; }

  /* Bottleneck bar — emphasis preserved through the amber rate-limiter
     accent, but track height + score weight reduced so the block reads
     as editorial emphasis rather than alert UI. */
  .ds-vbottleneck { margin: 6mm 0 0; page-break-inside: avoid; max-width: 156mm; }
  .ds-vbottleneck-row { display: grid; grid-template-columns: 52mm 1fr 18mm; align-items: center; gap: 5mm; }
  .ds-vbottleneck-label { display: flex; flex-direction: column; gap: 0.8mm; }
  .ds-vbottleneck-eyebrow { font-size: 6.8pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; font-family: "Inter", system-ui, sans-serif; font-weight: 600; }
  .ds-vbottleneck-pillar { font-size: 10.8pt; color: #0f172a; font-family: "Inter", system-ui, sans-serif; font-weight: 580; letter-spacing: -0.008em; }
  .ds-vbottleneck-track { height: 3.2mm; background: #fdf6e3; border-radius: 1.6mm; overflow: hidden; }
  .ds-vbottleneck-fill { height: 100%; background: #b45309; border-radius: inherit; }
  .ds-vbottleneck-value { font-size: 12pt; color: #0f172a; font-family: "Inter", system-ui, sans-serif; font-weight: 600; text-align: right; letter-spacing: -0.012em; }
  .ds-vbottleneck-of { font-size: 7.6pt; color: #cbd5e1; font-weight: 400; margin-left: 0.8mm; }
  .ds-vbottleneck-note { font-size: 8.8pt; line-height: 1.55; color: #64748b; margin: 4mm 0 0; font-style: italic; max-width: 150mm; }

  /* Insufficient-signal hint — used when a visual primitive cannot resolve. */
  .ds-vinsufficient { font-size: 9pt; line-height: 1.55; color: #94a3b8; margin: 3mm 0 0; font-style: italic; }

  /* Evidence Anchor Row — compact horizontal strip used at the top of
     analytical sections so the reader registers density within seconds.
     Editorial: small eyebrow + tabular-num value pairs separated by
     intentional gutter, framed by hairline rules. */
  .ds-vanchor { display: flex; flex-wrap: wrap; gap: 4mm 8mm; margin: 4mm 0 0; padding: 3mm 0; border-top: 0.2mm solid #eef1f5; border-bottom: 0.2mm solid #eef1f5; page-break-inside: avoid; }
  .ds-vanchor-cell { display: flex; flex-direction: column; gap: 0.8mm; min-width: 22mm; font-family: "Inter", system-ui, sans-serif; }
  .ds-vanchor-label { font-size: 6.6pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; font-weight: 580; }
  .ds-vanchor-value { font-size: 11.5pt; color: #0f172a; font-weight: 580; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
  .ds-vanchor-cell.is-positive .ds-vanchor-value { color: #047857; }
  .ds-vanchor-cell.is-warn .ds-vanchor-value { color: #b45309; }
  .ds-vanchor-cell.is-risk .ds-vanchor-value { color: #b91c1c; }
  .ds-vanchor-cell.is-neutral .ds-vanchor-value { color: #475569; }

  /* Pillar deltas strip — compact movement row with directional arrows.
     Variation between sections: this strip introduces directional visual
     vocabulary that the editorial cadence otherwise lacks. */
  .ds-vdeltas { margin: 5mm 0 0; page-break-inside: avoid; max-width: 156mm; }
  .ds-vdeltas-eyebrow { font-size: 7pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 3mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-vdeltas-row { display: flex; flex-wrap: wrap; gap: 6mm 8mm; }
  .ds-vdeltas-pillar { display: flex; align-items: baseline; gap: 1.5mm; font-family: "Inter", system-ui, sans-serif; }
  .ds-vdeltas-name { font-size: 7.4pt; letter-spacing: 0.18em; text-transform: uppercase; font-weight: 600; }
  .ds-vdeltas-arrow { font-size: 11pt; line-height: 1; }
  .ds-vdeltas-pillar.is-up .ds-vdeltas-arrow { color: #047857; }
  .ds-vdeltas-pillar.is-down .ds-vdeltas-arrow { color: #b91c1c; }
  .ds-vdeltas-pillar.is-flat .ds-vdeltas-arrow { color: #94a3b8; }
  .ds-vdeltas-delta { font-size: 9pt; color: #0f172a; font-weight: 540; font-variant-numeric: tabular-nums; letter-spacing: -0.005em; }

  /* Editorial transition micro-line — used between Diagnosis and
     Execution. A single sentence in italics, centred-ish on the
     measure, framed by generous vertical breath. Replaces the visual
     gap between sections with a felt narrative beat. */
  .ds-transition { margin: 14mm 0 6mm; max-width: 138mm; padding: 0; page-break-inside: avoid; }
  .ds-transition-text { font-size: 11pt; line-height: 1.6; color: #475569; font-style: italic; margin: 0; font-family: "Source Serif 4", Georgia, serif; font-weight: 420; letter-spacing: -0.002em; }

  /* ── Brand Brief (snapshot identity texture) ──────────────────────────
     Surfaces canonical company-context fields: Offering / Positioning /
     Market / Differentiation. Editorial dl-list — labels in eyebrow
     style, values in serif body. No card chrome. */
  .ds-brandbrief { margin: 8mm 0 0; page-break-inside: avoid; max-width: 158mm; }
  .ds-brandbrief-eyebrow { font-size: 7.4pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 4mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-brandbrief-list { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm 8mm; margin: 0; padding: 0; }
  .ds-brandbrief-row { display: flex; flex-direction: column; gap: 1.2mm; min-width: 0; }
  .ds-brandbrief-label { font-size: 6.8pt; letter-spacing: 0.24em; text-transform: uppercase; color: #cbd5e1; font-weight: 580; font-family: "Inter", system-ui, sans-serif; margin: 0; }
  .ds-brandbrief-value { font-size: 9.6pt; line-height: 1.55; color: #1a2332; margin: 0; font-family: "Source Serif 4", Georgia, serif; }

  /* Strategic Posture — single-row labelled cells. */
  .ds-posture { margin: 6mm 0 0; page-break-inside: avoid; max-width: 158mm; }
  .ds-posture-eyebrow { font-size: 7.4pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 3mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-posture-row { display: flex; flex-wrap: wrap; gap: 5mm 9mm; }
  .ds-posture-cell { display: flex; flex-direction: column; gap: 0.8mm; min-width: 30mm; }
  .ds-posture-label { font-size: 6.8pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-posture-value { font-size: 9.4pt; line-height: 1.5; color: #0f172a; font-family: "Inter", system-ui, sans-serif; font-weight: 540; letter-spacing: -0.002em; }

  /* ── Strategic Position 4-State Cards (recovered from legacy) ─────────
     Four colored cards in a row carrying the strategic stance:
     What's Broken / Fix First / Delay / If Ignored. Visually punchy +
     state-meaningful colour without restoring SaaS dashboard chrome. */
  .ds-fourstate { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; margin: 6mm 0 0; page-break-inside: avoid; }
  .ds-fourstate-card { padding: 4mm 4mm 5mm 4mm; border-radius: 1mm; border-left: 0.6mm solid; min-height: 38mm; page-break-inside: avoid; }
  .ds-fourstate-card.is-broken { background: #eef4fb; border-left-color: #1e40af; }
  .ds-fourstate-card.is-fix { background: #ecf6ee; border-left-color: #047857; }
  .ds-fourstate-card.is-delay { background: #fdf6e3; border-left-color: #b45309; }
  .ds-fourstate-card.is-ignored { background: #fbeeee; border-left-color: #b91c1c; }
  .ds-fourstate-label { font-size: 7.4pt; letter-spacing: 0.22em; text-transform: uppercase; font-weight: 600; margin: 0 0 2.5mm; font-family: "Inter", system-ui, sans-serif; }
  .ds-fourstate-card.is-broken .ds-fourstate-label { color: #1e40af; }
  .ds-fourstate-card.is-fix .ds-fourstate-label { color: #047857; }
  .ds-fourstate-card.is-delay .ds-fourstate-label { color: #92400e; }
  .ds-fourstate-card.is-ignored .ds-fourstate-label { color: #991b1b; }
  .ds-fourstate-text { font-size: 9.4pt; line-height: 1.55; color: #1a2332; margin: 0; }

  /* ── Data Source Status Panels (6-panel grid, recovered from legacy) ───
     Replaces the thin 4-cell confidence matrix with rich per-source
     panels — each carrying state + current state + impact + what
     unlocks. State-tinted backgrounds keep it visual without becoming
     dashboard. */
  .ds-dsource-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin: 5mm 0 0; }
  .ds-dsource-panel { padding: 4mm 4mm 4.5mm 4mm; border-radius: 1mm; border-left: 0.5mm solid #cbd5e1; background: #f8fafc; page-break-inside: avoid; min-height: 36mm; }
  .ds-dsource-panel.is-connected { background: #ecf6ee; border-left-color: #047857; }
  .ds-dsource-panel.is-partial { background: #fdf6e3; border-left-color: #b45309; }
  .ds-dsource-panel.is-missing { background: #fbeeee; border-left-color: #b91c1c; }
  .ds-dsource-panel.is-disabled { background: #f5f7fa; border-left-color: #94a3b8; }
  .ds-dsource-header { display: flex; justify-content: space-between; align-items: baseline; margin: 0 0 2.5mm; gap: 3mm; }
  .ds-dsource-label { font-size: 7.4pt; letter-spacing: 0.22em; text-transform: uppercase; color: #475569; font-weight: 580; font-family: "Inter", system-ui, sans-serif; flex: 1; }
  .ds-dsource-status { font-size: 6.8pt; letter-spacing: 0.2em; text-transform: uppercase; padding: 0.6mm 2mm; border-radius: 99px; font-weight: 600; font-family: "Inter", system-ui, sans-serif; background: #fff; }
  .ds-dsource-panel.is-connected .ds-dsource-status { color: #047857; }
  .ds-dsource-panel.is-partial .ds-dsource-status { color: #92400e; }
  .ds-dsource-panel.is-missing .ds-dsource-status { color: #991b1b; }
  .ds-dsource-panel.is-disabled .ds-dsource-status { color: #475569; }
  .ds-dsource-row { margin: 1.6mm 0 0; }
  .ds-dsource-row-label { font-size: 6.4pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; font-weight: 580; margin: 0 0 0.6mm; font-family: "Inter", system-ui, sans-serif; }
  .ds-dsource-row-text { font-size: 8.6pt; line-height: 1.5; color: #1a2332; margin: 0; }
  .ds-dsource-summary { margin: 4mm 0 0; padding: 3mm 0 0; font-size: 8.4pt; color: #64748b; font-style: italic; border-top: 0.2mm solid #e8edf2; font-family: "Inter", system-ui, sans-serif; }

  /* ── Action Tactics list (recovered from legacy Action Plan) ──────────
     Each action card now carries a 2–3 bullet TACTICS list derived from
     the canonical action.timeline.short / .mid fields. Real data, more
     visual presence per action. */
  .ds-action-tactics { margin: 3mm 0 0; padding: 0; }
  .ds-action-tactics-label { font-size: 6.6pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; font-weight: 580; margin: 0 0 1.4mm; font-family: "Inter", system-ui, sans-serif; }
  .ds-action-tactics-list { list-style: none; margin: 0; padding: 0; }
  .ds-action-tactics-item { padding: 1.2mm 0 1.2mm 5mm; font-size: 8.8pt; line-height: 1.55; color: #475569; position: relative; }
  .ds-action-tactics-item:before { content: counter(tactic); counter-increment: tactic; position: absolute; left: 0; font-family: "Inter", system-ui, sans-serif; font-size: 7.4pt; color: #94a3b8; font-weight: 600; }
  .ds-action-tactics { counter-reset: tactic; }

  /* ── Competitor Matrix (recovered from legacy Digital Snapshot) ────────
     Editorial table — restrained hairlines, tabular numerals, peer/user
     row distinction via subtle weight, no SaaS admin chrome. */
  .ds-cmatrix { margin: 5mm 0 0; page-break-inside: avoid; max-width: 158mm; }
  .ds-cmatrix-table { width: 100%; border-collapse: collapse; font-family: "Inter", system-ui, sans-serif; }
  .ds-cmatrix-table th { font-size: 6.8pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; font-weight: 580; padding: 2.5mm 2mm; border-bottom: 0.2mm solid #e8edf2; text-align: right; }
  .ds-cmatrix-table th:first-child { text-align: left; }
  .ds-cmatrix-table td { font-size: 9pt; color: #1a2332; padding: 2.8mm 2mm; border-bottom: 0.15mm solid #f1f5f9; text-align: right; font-variant-numeric: tabular-nums; }
  .ds-cmatrix-table td:first-child { text-align: left; font-weight: 540; }
  .ds-cmatrix-table tr.is-user td { color: #0f4c6b; font-weight: 580; }
  .ds-cmatrix-table tr:last-child td { border-bottom: 0; }
  .ds-cmatrix-na { color: #cbd5e1; }

  /* Strongest Peer Gap callout — boxed strategic gap with Impact +
     Confidence chips, framed by amber left rail when peers ahead. */
  .ds-cgap { margin: 6mm 0 0; padding: 4mm 0 4mm 5mm; border-left: 0.6mm solid #b45309; page-break-inside: avoid; max-width: 156mm; }
  .ds-cgap.is-leading { border-left-color: #047857; }
  .ds-cgap-eyebrow { font-size: 7pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 2.5mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-cgap-headline { font-size: 11.5pt; line-height: 1.4; color: #0f172a; margin: 0 0 3mm; font-weight: 580; letter-spacing: -0.005em; font-family: "Inter", system-ui, sans-serif; }
  .ds-cgap-why { font-size: 9.6pt; line-height: 1.65; color: #1a2332; margin: 0 0 3.5mm; }
  .ds-cgap-meta { display: flex; flex-wrap: wrap; gap: 2.5mm; align-items: baseline; font-family: "Inter", system-ui, sans-serif; }
  .ds-cgap-chip { display: inline-flex; gap: 1.2mm; align-items: baseline; font-size: 7.4pt; letter-spacing: 0.18em; text-transform: uppercase; padding: 0.8mm 2.2mm; border-radius: 99px; background: #f5f7fa; color: #475569; font-weight: 580; }
  .ds-cgap-chip strong { color: #0f172a; font-weight: 600; font-variant-numeric: tabular-nums; }
  .ds-cgap-led { font-size: 8.4pt; color: #64748b; margin-left: 2mm; }

  /* Competitor Benchmark bars — per-competitor average score row. */
  .ds-cbench { margin: 5mm 0 0; page-break-inside: avoid; max-width: 158mm; }
  .ds-cbench-row { display: grid; grid-template-columns: 30mm 1fr 12mm; align-items: center; gap: 4mm; padding: 2mm 0; border-bottom: 0.15mm solid #f1f5f9; }
  .ds-cbench-row:last-child { border-bottom: 0; }
  .ds-cbench-row.is-user { color: #0f4c6b; }
  .ds-cbench-name { font-size: 9pt; font-family: "Inter", system-ui, sans-serif; font-weight: 540; letter-spacing: -0.002em; }
  .ds-cbench-track { height: 1.6mm; background: #f1f5f9; border-radius: 0.8mm; overflow: hidden; }
  .ds-cbench-fill { height: 100%; background: #94a3b8; border-radius: inherit; }
  .ds-cbench-row.is-user .ds-cbench-fill { background: #0f4c6b; }
  .ds-cbench-value { font-size: 9pt; font-family: "Inter", system-ui, sans-serif; font-weight: 580; text-align: right; font-variant-numeric: tabular-nums; }

  /* Limiting Dimensions list — top-3 lowest dimensions with why. */
  .ds-vlimiting { margin: 6mm 0 0; page-break-inside: avoid; max-width: 156mm; }
  .ds-vlimiting-eyebrow { font-size: 7pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 3mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-vlimiting-row { display: grid; grid-template-columns: 50mm 1fr 14mm; align-items: baseline; gap: 4mm; padding: 2.4mm 0; border-bottom: 0.15mm solid #f1f5f9; }
  .ds-vlimiting-row:last-child { border-bottom: 0; }
  .ds-vlimiting-key { font-family: "Inter", system-ui, sans-serif; font-size: 9pt; color: #0f172a; font-weight: 540; }
  .ds-vlimiting-key small { font-size: 6.6pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; font-weight: 580; display: block; margin-bottom: 0.6mm; }
  .ds-vlimiting-why { font-size: 9pt; color: #475569; line-height: 1.55; }
  .ds-vlimiting-value { font-family: "Inter", system-ui, sans-serif; font-size: 11pt; color: #b45309; font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; letter-spacing: -0.008em; }

  /* Fastest Lever callout — single editorial highlight. */
  .ds-vlever { margin: 7mm 0 0; padding: 4mm 5mm; background: #f0f8ff; border-left: 0.6mm solid #0f4c6b; page-break-inside: avoid; max-width: 156mm; }
  .ds-vlever-eyebrow { font-size: 7pt; letter-spacing: 0.24em; text-transform: uppercase; color: #0f4c6b; margin: 0 0 1.8mm; font-weight: 600; font-family: "Inter", system-ui, sans-serif; }
  .ds-vlever-text { font-size: 10pt; line-height: 1.65; color: #0f172a; margin: 0; font-family: "Inter", system-ui, sans-serif; font-weight: 460; }
  .ds-vlever-text strong { color: #0f4c6b; font-weight: 580; }

  /* Growth Path Directives — 3-line improvement map at maturity. */
  .ds-vgrowth { margin: 6mm 0 0; page-break-inside: avoid; max-width: 156mm; }
  .ds-vgrowth-eyebrow { font-size: 7pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 2.5mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-vgrowth-bridge { font-size: 9.4pt; color: #475569; font-style: italic; margin: 0 0 3mm; font-family: "Inter", system-ui, sans-serif; }
  .ds-vgrowth-bridge strong { color: #0f172a; font-style: normal; font-weight: 580; }
  .ds-vgrowth-list { list-style: none; padding: 0; margin: 0; }
  .ds-vgrowth-item { padding: 2.2mm 0 2.2mm 5mm; border-left: 0.4mm solid #e8edf2; margin: 0 0 2mm; font-size: 9.6pt; line-height: 1.6; color: #1a2332; }
  .ds-vgrowth-item:last-child { margin-bottom: 0; }

  /* ── Execution Channel Mix (per-owner-area cards) ─────────────────────
     Restrained 2-column grid showing which canonical owner area carries
     which actions. Pillar pills retain their existing palette so the
     mix reads consistently with the rest of the dossier. */
  .ds-channelmix-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin: 6mm 0 0; }
  .ds-channelmix-card { padding: 4mm 4mm 5mm 4mm; border-radius: 1mm; background: #f8fafc; border-left: 0.5mm solid #cbd5e1; page-break-inside: avoid; min-height: 36mm; }
  .ds-channelmix-card.is-critical { border-left-color: #b45309; background: #fdf6e3; }
  .ds-channelmix-header { display: flex; justify-content: space-between; align-items: baseline; margin: 0 0 2.5mm; gap: 3mm; }
  .ds-channelmix-label { font-size: 9.6pt; color: #0f172a; font-weight: 580; letter-spacing: -0.005em; font-family: "Inter", system-ui, sans-serif; }
  .ds-channelmix-count { font-size: 7pt; letter-spacing: 0.22em; text-transform: uppercase; color: #64748b; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-channelmix-leading { font-size: 9pt; line-height: 1.55; color: #1a2332; margin: 0 0 2.5mm; font-family: "Inter", system-ui, sans-serif; font-weight: 540; }
  .ds-channelmix-unlocks { font-size: 8.6pt; line-height: 1.55; color: #475569; margin: 0 0 3mm; font-style: italic; }
  .ds-channelmix-pillars { display: flex; flex-wrap: wrap; gap: 1.5mm; }

  /* ── Snapshot Hero Score (recovered from legacy donut) ────────────────
     Big bold Authority Index number paired with stage / confidence /
     movement chips — gives the snapshot the visual anchor the legacy
     report carried. Editorial typography, no donut chrome. */
  .ds-herohead { display: grid; grid-template-columns: 60mm 1fr; gap: 8mm; align-items: center; margin: 4mm 0 9mm; padding: 6mm 0 7mm; border-top: 0.2mm solid #e8edf2; border-bottom: 0.2mm solid #e8edf2; page-break-inside: avoid; }
  .ds-herohead-score { display: flex; flex-direction: column; gap: 1mm; }
  .ds-herohead-value { font-size: 56pt; line-height: 1; color: #0f172a; font-family: "Inter", system-ui, sans-serif; font-weight: 660; letter-spacing: -0.032em; font-variant-numeric: tabular-nums; }
  .ds-herohead-of { font-size: 14pt; color: #cbd5e1; font-weight: 400; margin-left: 1.5mm; }
  .ds-herohead-label { font-size: 7.6pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; font-weight: 580; font-family: "Inter", system-ui, sans-serif; margin-top: 2mm; }
  .ds-herohead-meta { display: flex; flex-wrap: wrap; gap: 5mm 8mm; align-items: baseline; }
  .ds-herohead-cell { display: flex; flex-direction: column; gap: 0.6mm; font-family: "Inter", system-ui, sans-serif; min-width: 30mm; }
  .ds-herohead-cell-label { font-size: 6.6pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; font-weight: 580; }
  .ds-herohead-cell-value { font-size: 11pt; color: #0f172a; font-weight: 580; letter-spacing: -0.005em; }

  /* Competitor Pressure cards — recovered from legacy. Per-competitor
     pressure type with influence mix chips. */
  .ds-cpressure-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4mm; margin: 5mm 0 0; }
  .ds-cpressure-card { padding: 4mm 4mm 5mm 4mm; border-radius: 1mm; background: #f8fafc; border-left: 0.5mm solid #cbd5e1; page-break-inside: avoid; min-height: 50mm; }
  .ds-cpressure-card.is-authority { border-left-color: #4f46e5; background: #f5f3ff; }
  .ds-cpressure-card.is-discoverability { border-left-color: #047857; background: #ecfdf5; }
  .ds-cpressure-card.is-trust { border-left-color: #b45309; background: #fffbeb; }
  .ds-cpressure-card.is-foundation { border-left-color: #0369a1; background: #eff6ff; }
  .ds-cpressure-card.is-momentum { border-left-color: #be123c; background: #fff1f2; }
  .ds-cpressure-card.is-parity { border-left-color: #94a3b8; background: #f5f7fa; }
  .ds-cpressure-name { font-size: 11pt; color: #0f172a; font-weight: 600; letter-spacing: -0.008em; font-family: "Inter", system-ui, sans-serif; margin: 0 0 1.5mm; }
  .ds-cpressure-kind { font-size: 7pt; letter-spacing: 0.22em; text-transform: uppercase; font-weight: 600; margin: 0 0 3mm; font-family: "Inter", system-ui, sans-serif; }
  .ds-cpressure-card.is-authority .ds-cpressure-kind { color: #4f46e5; }
  .ds-cpressure-card.is-discoverability .ds-cpressure-kind { color: #047857; }
  .ds-cpressure-card.is-trust .ds-cpressure-kind { color: #b45309; }
  .ds-cpressure-card.is-foundation .ds-cpressure-kind { color: #0369a1; }
  .ds-cpressure-card.is-momentum .ds-cpressure-kind { color: #be123c; }
  .ds-cpressure-card.is-parity .ds-cpressure-kind { color: #475569; }
  .ds-cpressure-reading { font-size: 8.6pt; line-height: 1.55; color: #1a2332; margin: 0 0 3mm; }
  .ds-cpressure-mix { display: flex; flex-wrap: wrap; gap: 1.5mm; }
  .ds-cpressure-chip { font-size: 6.4pt; letter-spacing: 0.18em; text-transform: uppercase; padding: 0.5mm 1.8mm; border-radius: 99px; font-weight: 600; font-family: "Inter", system-ui, sans-serif; }
  .ds-cpressure-chip.is-high { background: #fff; color: #0f172a; }
  .ds-cpressure-chip.is-moderate { background: #f5f7fa; color: #475569; }
  .ds-cpressure-chip.is-low { background: #f8fafc; color: #94a3b8; }

  /* AI Trajectory directional headline. */
  .ds-aitrajectory { display: flex; align-items: baseline; gap: 3mm; font-family: "Inter", system-ui, sans-serif; margin: 4mm 0 0; }
  .ds-aitrajectory-arrow { font-size: 18pt; line-height: 1; }
  .ds-aitrajectory-delta { font-size: 16pt; color: #0f172a; font-weight: 600; letter-spacing: -0.018em; font-variant-numeric: tabular-nums; }
  .ds-aitrajectory-from { font-size: 8.6pt; color: #94a3b8; letter-spacing: 0.04em; }
  .ds-aitrajectory.is-up .ds-aitrajectory-arrow { color: #047857; }
  .ds-aitrajectory.is-down .ds-aitrajectory-arrow { color: #b91c1c; }
  .ds-aitrajectory.is-flat .ds-aitrajectory-arrow { color: #94a3b8; }

  /* ── AI Discoverability — 7-block narrative architecture ─────────────
     Block-level wrapper used to compose the rebuilt AI section into a
     felt narrative system rather than stacked sub-cards. Each block
     opens with a small block-number + block-title eyebrow line; the
     visualisations remain editorial (no dashboard chrome). */
  .ds-aiblock { margin: 11mm 0 0; page-break-inside: avoid; max-width: 158mm; }
  .ds-aiblock-eyebrow { font-size: 7.4pt; letter-spacing: 0.26em; text-transform: uppercase; color: #94a3b8; margin: 0 0 2mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-aiblock-title { font-size: 12.5pt; line-height: 1.3; color: #0f172a; margin: 0 0 4mm; font-weight: 580; letter-spacing: -0.012em; font-family: "Inter", system-ui, sans-serif; }
  .ds-aiblock-read { font-size: 10.4pt; line-height: 1.7; color: #1a2332; margin: 0; max-width: 152mm; }

  /* AI Visibility State diagnostic chips — three short readings inline. */
  .ds-aistate-chips { display: flex; flex-wrap: wrap; gap: 3mm 6mm; margin: 4mm 0 5mm; font-family: "Inter", system-ui, sans-serif; }
  .ds-aistate-chip { display: flex; flex-direction: column; gap: 1mm; min-width: 30mm; }
  .ds-aistate-chip-label { font-size: 6.8pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; font-weight: 580; }
  .ds-aistate-chip-value { font-size: 10.4pt; color: #0f172a; font-weight: 580; letter-spacing: -0.005em; }
  .ds-aistate-chip-detail { font-size: 8pt; color: #64748b; letter-spacing: 0; line-height: 1.3; }
  .ds-aistate-chip.is-on .ds-aistate-chip-value { color: #047857; }
  .ds-aistate-chip.is-warn .ds-aistate-chip-value { color: #b45309; }
  .ds-aistate-chip.is-off .ds-aistate-chip-value { color: #b91c1c; }

  /* AI Trust Coherence kind chip — single inline status word. */
  .ds-aitrust-row { display: flex; align-items: baseline; gap: 4mm; flex-wrap: wrap; margin: 3mm 0 4mm; font-family: "Inter", system-ui, sans-serif; }
  .ds-aitrust-kind { font-size: 11.5pt; color: #0f172a; font-weight: 600; letter-spacing: -0.008em; }
  .ds-aitrust-kind.is-consistent { color: #047857; }
  .ds-aitrust-kind.is-fragmented { color: #b91c1c; }
  .ds-aitrust-kind.is-sparse { color: #94a3b8; }
  .ds-aitrust-kind.is-weak { color: #b45309; }
  .ds-aitrust-signals { font-size: 8.6pt; color: #64748b; letter-spacing: 0.04em; }

  /* AI Retrieval Examples — compact provider × query class anchors with
     status indicators. Editorial list, not a table. */
  .ds-aiexamples { margin: 4mm 0 0; }
  .ds-aiexample { display: grid; grid-template-columns: 38mm 1fr 12mm; align-items: baseline; gap: 4mm; padding: 2.4mm 0; border-bottom: 0.15mm solid #f1f5f9; }
  .ds-aiexample:last-child { border-bottom: 0; }
  .ds-aiexample-key { font-family: "Inter", system-ui, sans-serif; font-size: 8.8pt; color: #0f172a; font-weight: 540; letter-spacing: -0.002em; }
  .ds-aiexample-key small { font-size: 6.6pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; font-weight: 580; display: block; margin-bottom: 0.6mm; }
  .ds-aiexample-note { font-size: 9pt; color: #1a2332; line-height: 1.55; }
  .ds-aiexample-rate { font-family: "Inter", system-ui, sans-serif; font-size: 9pt; color: #0f172a; font-weight: 580; text-align: right; font-variant-numeric: tabular-nums; }
  .ds-aiexample.is-cited .ds-aiexample-rate { color: #047857; }
  .ds-aiexample.is-absent .ds-aiexample-rate { color: #b91c1c; }
  .ds-aiexample.is-partial .ds-aiexample-rate { color: #b45309; }

  /* AI Strategic Unlock — the closing block of the AI section. Carries
     extra editorial weight via larger eyebrow + concept-named headline,
     anchoring one memorable sentence in the reader's mind. */
  .ds-aiunlock { margin: 14mm 0 0; padding: 8mm 0 0; border-top: 0.2mm solid #e8edf2; page-break-inside: avoid; max-width: 158mm; }
  .ds-aiunlock-eyebrow { font-size: 7.4pt; letter-spacing: 0.28em; text-transform: uppercase; color: #94a3b8; margin: 0 0 3mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-aiunlock-concept { font-size: 8pt; letter-spacing: 0.22em; text-transform: uppercase; color: #0f4c6b; margin: 0 0 3mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-aiunlock-headline { font-size: 14.5pt; line-height: 1.35; color: #0f172a; margin: 0 0 4mm; font-weight: 540; letter-spacing: -0.014em; font-family: "Source Serif 4", Georgia, serif; max-width: 148mm; }
  .ds-aiunlock-why { font-size: 9.8pt; line-height: 1.65; color: #475569; margin: 0; max-width: 148mm; }

  /* Positioning band — peer-comparison strip. Two ticks (median +
     top-quartile) and a brand marker on a single horizontal track. */
  .ds-vposition { margin: 5mm 0 0; page-break-inside: avoid; max-width: 156mm; }
  .ds-vposition-track { position: relative; height: 2mm; background: linear-gradient(90deg, #f1f5f9 0%, #e8edf2 50%, #dbe5ee 100%); border-radius: 1mm; overflow: visible; }
  .ds-vposition-tick { position: absolute; top: -1.5mm; bottom: -1.5mm; width: 0.4mm; background: #94a3b8; transform: translateX(-50%); border-radius: 0.2mm; }
  .ds-vposition-tick.is-top { background: #cbd5e1; }
  .ds-vposition-marker { position: absolute; top: 50%; transform: translate(-50%, -50%); width: 2.4mm; height: 2.4mm; background: #0f4c6b; border-radius: 50%; box-shadow: 0 0 0 0.8mm #fff; }
  .ds-vposition-meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: 1.5mm; margin: 4mm 0 0; font-family: "Inter", system-ui, sans-serif; }
  .ds-vposition-meta-label { font-size: 6.8pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; font-weight: 580; }
  .ds-vposition-meta-value { font-size: 9.5pt; color: #0f172a; font-weight: 580; letter-spacing: -0.005em; font-variant-numeric: tabular-nums; }
  .ds-vposition-meta-divider { color: #cbd5e1; font-size: 9pt; }
  .ds-vposition-note { font-size: 9pt; line-height: 1.6; color: #475569; margin: 4mm 0 0; max-width: 152mm; }

  /* Trajectory spark — vertical bars showing historical authority. */
  .ds-vspark { margin: 5mm 0 0; page-break-inside: avoid; max-width: 156mm; }
  .ds-vspark-track { display: flex; align-items: flex-end; gap: 1.2mm; height: 18mm; padding: 0; }
  .ds-vspark-bar { flex: 1; min-width: 0; max-width: 4mm; background: #cbd5e1; border-radius: 0.4mm 0.4mm 0 0; }
  .ds-vspark-bar.is-current { background: #0f4c6b; }
  .ds-vspark-note { font-size: 9pt; line-height: 1.55; color: #475569; margin: 3.5mm 0 0; font-style: italic; max-width: 150mm; }

  /* Confidence matrix — 4-cell summary of evidence states. Restrained
     palette; no heavy backgrounds; cell numbers carry the weight. */
  .ds-vconfidence { margin: 5mm 0 0; page-break-inside: avoid; max-width: 156mm; }
  .ds-vconfidence-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; }
  .ds-vconfidence-cell { padding: 4mm 4mm 4mm 0; border-left: 0.4mm solid #e8edf2; padding-left: 5mm; display: flex; flex-direction: column; gap: 1.5mm; }
  .ds-vconfidence-cell:first-child { border-left: 0; padding-left: 0; }
  .ds-vconfidence-value { font-size: 18pt; line-height: 1; color: #0f172a; font-family: "Inter", system-ui, sans-serif; font-weight: 580; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .ds-vconfidence-label { font-size: 7.2pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; font-family: "Inter", system-ui, sans-serif; font-weight: 580; }
  .ds-vconfidence-measured .ds-vconfidence-value { color: #0f172a; }
  .ds-vconfidence-inferred .ds-vconfidence-value { color: #475569; }
  .ds-vconfidence-insufficient .ds-vconfidence-value { color: #94a3b8; }
  .ds-vconfidence-unavailable .ds-vconfidence-value { color: #cbd5e1; }
  .ds-vconfidence-note { font-size: 8.6pt; line-height: 1.55; color: #64748b; margin: 4mm 0 0; font-style: italic; }

  /* Dimension row — pillar-tagged compact dimension bar. Used in the
     Dimension Breakdown grouped under each pillar header. */
  .ds-vdim-row { display: grid; grid-template-columns: 26mm 1fr 30mm 9mm; align-items: center; gap: 4mm; padding: 1.5mm 0; }
  .ds-vdim-tag { font-size: 6.6pt; letter-spacing: 0.22em; text-transform: uppercase; font-family: "Inter", system-ui, sans-serif; font-weight: 580; }
  .ds-vdim-label { font-size: 9pt; color: #1a2332; font-family: "Inter", system-ui, sans-serif; font-weight: 480; letter-spacing: -0.002em; }
  .ds-vdim-track { height: 1.4mm; background: #f1f5f9; border-radius: 0.7mm; overflow: hidden; }
  .ds-vdim-fill { height: 100%; border-radius: inherit; }
  .ds-vdim-value { font-size: 8.6pt; color: #0f172a; font-family: "Inter", system-ui, sans-serif; font-weight: 540; text-align: right; font-variant-numeric: tabular-nums; }

  /* Intelligence surface block — section sub-header + body group used
     for Score Drivers, Channel Leverage, Execution Window. */
  .ds-isurface { margin: 9mm 0 0; page-break-inside: avoid; max-width: 156mm; }
  .ds-isurface-eyebrow { font-size: 7.2pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 3.5mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-isurface-read { font-size: 10.4pt; line-height: 1.7; color: #1a2332; margin: 0 0 5mm; max-width: 152mm; }
  .ds-isurface-rows { margin: 0; padding: 0; list-style: none; }
  .ds-isurface-row { padding: 3mm 0; border-bottom: 0.15mm solid #f1f5f9; display: grid; grid-template-columns: 38mm 1fr; gap: 5mm; align-items: baseline; }
  .ds-isurface-row:last-child { border-bottom: 0; }
  .ds-isurface-row-key { font-size: 9pt; color: #0f172a; font-family: "Inter", system-ui, sans-serif; font-weight: 540; letter-spacing: -0.002em; }
  .ds-isurface-row-key small { font-size: 7pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; font-weight: 580; display: block; margin-bottom: 1mm; }
  .ds-isurface-row-text { font-size: 9.6pt; line-height: 1.6; color: #1a2332; }

  /* Pillar group header inside Dimension Breakdown. */
  .ds-vdim-group { margin: 6mm 0 0; page-break-inside: avoid; }
  .ds-vdim-group-header { margin: 0 0 2mm; }
  .ds-vdim-group-name { font-size: 9.6pt; color: #0f172a; font-family: "Inter", system-ui, sans-serif; font-weight: 580; letter-spacing: -0.005em; margin: 0 0 1mm; }
  .ds-vdim-group-read { font-size: 8.8pt; color: #64748b; font-style: italic; margin: 0 0 3mm; max-width: 150mm; }

  /* Execution window — horizon row treatment. */
  .ds-execwin-horizon { margin: 5mm 0 4mm; }
  .ds-execwin-horizon-label { font-size: 7.4pt; letter-spacing: 0.24em; text-transform: uppercase; color: #94a3b8; margin: 0 0 2mm; font-weight: 580; font-family: "Inter", system-ui, sans-serif; }
  .ds-execwin-action { padding: 2.5mm 0 2.5mm 5mm; border-left: 0.4mm solid #e8edf2; margin: 0 0 3mm; page-break-inside: avoid; }
  .ds-execwin-action.is-critical { border-left-color: #b45309; }
  .ds-execwin-action-title { font-size: 9.6pt; color: #0f172a; font-family: "Inter", system-ui, sans-serif; font-weight: 540; margin: 0 0 1.2mm; letter-spacing: -0.002em; }
  .ds-execwin-action-meta { font-size: 7.4pt; letter-spacing: 0.22em; text-transform: uppercase; color: #94a3b8; font-family: "Inter", system-ui, sans-serif; font-weight: 580; }
  .ds-execwin-action-outcome { font-size: 8.8pt; line-height: 1.55; color: #475569; margin: 1.5mm 0 0; }

  /* ── Brand presence ───────────────────────────────────────────────────
     Restrained company-aware identity. The logo (when present) sits as a
     subtle mark above the company name on the cover. The footer carries
     the company name across every interior page so the dossier reads as
     written for this brand specifically. */
  .ds-cover-logo { margin: 0 0 4mm; max-height: 14mm; max-width: 50mm; display: block; }
  .ds-cover-logo[data-fallback="true"] { display: none; }
  .ds-cover-accent { width: 60mm; height: 0.4mm; background: linear-gradient(90deg, #0f4c6b, rgba(15, 76, 107, 0)); margin: 6mm 0 0; }

  /* ── Print rules (unchanged) ───────────────────────────────────────── */
  @media print {
    .ds-section { page-break-inside: auto; }
    .ds-insight, .ds-pillar, .ds-action, .ds-storyline-item, .ds-playbook-group, .ds-constraint, .ds-maturity, .ds-ai-hero, .ds-hero-score-row, .ds-signal, .ds-direction, .ds-evidence-bar, .ds-constraint-narrative, .ds-pattern, .ds-authority-shape-block, .ds-maturity-evolution, .ds-momentum-shape, .ds-closing, .ds-vbar, .ds-vstrip, .ds-vcontinuum, .ds-vspectrum, .ds-vbottleneck, .ds-vposition, .ds-vspark, .ds-vconfidence, .ds-vdim-group, .ds-isurface, .ds-execwin-action, .ds-brandbrief, .ds-posture, .ds-aitrajectory, .ds-aiblock, .ds-aiunlock, .ds-aiexample, .ds-vanchor, .ds-cmatrix, .ds-cgap, .ds-cbench, .ds-vlimiting, .ds-vlever, .ds-vgrowth, .ds-methodology-row, .ds-fourstate-card, .ds-dsource-panel, .ds-channelmix-card, .ds-herohead, .ds-cpressure-card { page-break-inside: avoid; }
    .ds-cover { page-break-after: always; }
    .ds-snapshot { page-break-after: always; }
    .ds-section { page-break-before: auto; }
    h1, h2, h3 { page-break-after: avoid; }
  }
`;

// ── Section renderers ────────────────────────────────────────────────────────

function renderSectionHeader(title: string, dominant_question: string, sectionNumber?: string): string {
  // Editorial variation: replace the redundant "title-as-eyebrow"
  // pattern with a section number when provided. The number anchors
  // the reader to a chaptered document instead of stacked exports.
  const eyebrow = sectionNumber ? sectionNumber : title;
  return `
    <header>
      <p class="ds-section-eyebrow">${escape(eyebrow)}</p>
      <h2 class="ds-section-title">${escape(title)}</h2>
      <p class="ds-section-question">${escape(dominant_question)}</p>
    </header>
  `;
}

function renderFraming(framing: string | null | undefined): string {
  const text = (framing ?? '').trim();
  if (!text) return '';
  return `<p class="ds-framing">${escape(text)}</p>`;
}

function renderConstraintNarrative(narrative: ConstraintNarrative | null): string {
  if (!narrative) return '';
  // Compressed labels — short scan anchors. Full strategic substance
  // stays in the body text; the labels exist only to thread the eye.
  const rows: Array<[string, string]> = [
    ['Constraint', narrative.constraint],
    ['Why It Matters', narrative.why_matters],
    ['If Unresolved', narrative.if_unresolved],
    ['Unlock', narrative.unlock],
  ];
  return `
    <div class="ds-constraint-narrative">
      ${rows
        .map(
          ([label, text]) => `
            <div class="ds-constraint-narrative-row">
              <p class="ds-constraint-narrative-label">${escape(label)}</p>
              <p class="ds-constraint-narrative-text">${escape(text)}</p>
            </div>
          `,
        )
        .join('')}
    </div>
  `;
}

function renderMaturityPattern(pattern: MaturityPattern | null): string {
  if (!pattern) return '';
  const rows: Array<[string, string]> = [
    ['Leaders Focus On', pattern.leaders_focus_on],
    ['Leaders Avoid', pattern.leaders_avoid],
    ['What Advances', pattern.what_advances],
  ];
  return `
    <div class="ds-pattern">
      <p class="ds-pattern-eyebrow">What leaders typically do at this stage</p>
      ${rows
        .map(
          ([label, text]) => `
            <div class="ds-pattern-row">
              <p class="ds-pattern-row-label">${escape(label)}</p>
              <p class="ds-pattern-row-text">${escape(text)}</p>
            </div>
          `,
        )
        .join('')}
    </div>
  `;
}

// renderAuthorityShapeBlock removed — the Authority Shape now lives only
// on the cover. Section-level repetition was the dossier's biggest
// composition failure; the shape is named once strongly, then advanced
// (not restated) by every subsequent section.

function renderMaturityEvolution(evolution: MaturityEvolution | null): string {
  if (!evolution) return '';
  // Plain-English caption pairs: each label keeps its short scan-anchor
  // form, paired with a one-line plain caption so any reader can parse
  // the row without prior platform knowledge.
  const rows: Array<[string, string, string]> = [
    ['Why This Stage', 'Why the brand sits at this maturity level', evolution.why_this_stage],
    ['Stage Progression', 'What this stage looks like, and what the next one looks like', evolution.stage_progression],
    ['What’s Blocking Advancement', 'The single signal preventing the move to the next stage', evolution.transition_friction],
    ['Path Forward', 'What changes the trajectory most', evolution.unlock_path],
  ];
  return `
    <div class="ds-maturity-evolution">
      <p class="ds-maturity-evolution-eyebrow">Maturity Evolution</p>
      ${rows
        .map(
          ([label, caption, text]) => `
            <div class="ds-maturity-evolution-row">
              <p class="ds-maturity-evolution-row-label">${escape(label)}</p>
              <p class="ds-maturity-evolution-row-caption">${escape(caption)}</p>
              <p class="ds-maturity-evolution-row-text">${escape(text)}</p>
            </div>
          `,
        )
        .join('')}
    </div>
  `;
}

function renderMomentumShape(shape: MomentumShape): string {
  return `
    <div class="ds-momentum-shape">
      <p class="ds-momentum-shape-eyebrow">Authority Momentum Shape</p>
      <p class="ds-momentum-shape-label">${escape(shape.label)}</p>
      <p class="ds-momentum-shape-reading">${escape(shape.reading)}</p>
      <p class="ds-momentum-shape-body">${escape(shape.interpretation)}</p>
    </div>
  `;
}

function renderDimensionBreakdown(breakdown: DimensionBreakdown): string {
  if (breakdown.state === 'insufficient_signal' && breakdown.groups.length === 0) {
    return `<p class="ds-vinsufficient">This breakdown will appear as more measurement accumulates for this brand.</p>`;
  }
  return `
    <div class="ds-isurface">
      <p class="ds-isurface-eyebrow">Dimension Breakdown</p>
      ${breakdown.groups
        .map(
          (g) => `
            <div class="ds-vdim-group">
              <header class="ds-vdim-group-header">
                <p class="ds-vdim-group-name">${escape(g.pillar_label)}</p>
                <p class="ds-vdim-group-read">${escape(g.interpretation)}</p>
              </header>
              ${g.rows
                .map((r) =>
                  renderDimensionRow({
                    pillar: r.pillar,
                    label: r.label,
                    value: r.value,
                    state: r.state,
                  }),
                )
                .join('')}
            </div>
          `,
        )
        .join('')}
    </div>
  `;
}

function renderScoreDrivers(drivers: ScoreDrivers): string {
  if (drivers.state === 'insufficient_signal') {
    return `<p class="ds-vinsufficient">${escape(drivers.read)}</p>`;
  }
  const block = (label: string, entries: ScoreDrivers['drivers']): string => {
    if (entries.length === 0) return '';
    return `
      <div class="ds-isurface-row">
        <div class="ds-isurface-row-key"><small>${escape(label)}</small>${entries.map((e) => escape(e.label)).join(' · ')}</div>
        <div class="ds-isurface-row-text">${entries.map((e) => escape(e.why)).join(' ')}</div>
      </div>
    `;
  };
  return `
    <div class="ds-isurface">
      <p class="ds-isurface-eyebrow">Score Drivers</p>
      <p class="ds-isurface-read">${escape(drivers.read)}</p>
      <div class="ds-isurface-rows">
        ${block('Driving', drivers.drivers)}
        ${block('Rate-limiting', drivers.rate_limiters)}
        ${block('Compounding', drivers.compounders)}
      </div>
    </div>
  `;
}

function renderComparativePositioning(pos: ComparativePositioning): string {
  if (pos.state === 'unavailable') {
    return `
      <div class="ds-isurface">
        <p class="ds-isurface-eyebrow">Comparative Positioning</p>
        <p class="ds-isurface-read">${escape(pos.read)}</p>
      </div>
    `;
  }
  return `
    <div class="ds-isurface">
      <p class="ds-isurface-eyebrow">Comparative Positioning${pos.vertical ? ` · ${escape(pos.vertical)}` : ''}</p>
      ${renderPositioningBand({
        brandValue: pos.brand_value,
        peerMedian: pos.peer_median,
        topQuartile: pos.top_quartile,
        percentile: pos.percentile,
        peerCount: pos.peer_count,
        vertical: pos.vertical,
      })}
      <p class="ds-isurface-read" style="margin-top: 5mm;">${escape(pos.read)}</p>
    </div>
  `;
}

function renderTrajectoryMovement(traj: TrajectoryMovement): string {
  if (traj.state === 'insufficient_history') {
    return `
      <div class="ds-isurface">
        <p class="ds-isurface-eyebrow">Trajectory & Movement</p>
        <p class="ds-isurface-read">${escape(traj.read)}</p>
      </div>
    `;
  }
  const notable = traj.notable_changes.slice(0, 3);
  return `
    <div class="ds-isurface">
      <p class="ds-isurface-eyebrow">Trajectory & Movement</p>
      ${renderTrajectorySpark({ snapshots: traj.snapshots })}
      <p class="ds-isurface-read" style="margin-top: 5mm;">${escape(traj.read)}</p>
      ${
        notable.length > 0
          ? `<ul style="list-style:none;padding:0;margin:5mm 0 0;">${notable
              .map(
                (n) =>
                  `<li style="font-size:9pt;line-height:1.6;color:#1a2332;padding:1.5mm 0;border-top:0.15mm solid #f1f5f9;">${escape(n)}</li>`,
              )
              .join('')}</ul>`
          : ''
      }
    </div>
  `;
}

function renderDataConfidence(conf: DataConfidence): string {
  return `
    <div class="ds-isurface">
      <p class="ds-isurface-eyebrow">Data Confidence & Coverage</p>
      ${renderConfidenceMatrix({
        measured: conf.measured_count,
        inferred: conf.inferred_count,
        insufficient: conf.insufficient_count,
        unavailable: conf.unavailable_count,
        totalProviders: conf.total_providers,
        healthyProviders: conf.healthy_providers,
      })}
      <p class="ds-isurface-read" style="margin-top: 5mm;">${escape(conf.read)} ${escape(conf.freshness_label)}.${conf.total_observations > 0 ? ` Evidence base: ${conf.total_observations} canonical observation${conf.total_observations === 1 ? '' : 's'}.` : ''}</p>
    </div>
  `;
}

function renderChannelLeverage(channel: ChannelLeverage): string {
  if (channel.state === 'unavailable') {
    return `
      <div class="ds-isurface">
        <p class="ds-isurface-eyebrow">Channel Leverage</p>
        <p class="ds-isurface-read">${escape(channel.read)}</p>
      </div>
    `;
  }
  if (channel.top_leverage_cells.length === 0) return '';
  return `
    <div class="ds-isurface">
      <p class="ds-isurface-eyebrow">Channel Leverage</p>
      <p class="ds-isurface-read">${escape(channel.read)}</p>
      <div class="ds-isurface-rows">
        ${channel.top_leverage_cells
          .map(
            (c) => `
              <div class="ds-isurface-row">
                <div class="ds-isurface-row-key"><small>${escape(c.status === 'leverage' ? 'Defend' : 'Extend')}</small>${escape(c.provider)} · ${escape(c.query_class)}</div>
                <div class="ds-isurface-row-text">${escape(c.why)}</div>
              </div>
            `,
          )
          .join('')}
      </div>
    </div>
  `;
}

function renderExecutionWindow(win: ExecutionWindow): string {
  if (win.state === 'insufficient_signal' || win.entries.length === 0) {
    return '';
  }
  const horizons: Array<'immediate' | 'medium' | 'long'> = ['immediate', 'medium', 'long'];
  return `
    <div class="ds-isurface">
      <p class="ds-isurface-eyebrow">Execution Window</p>
      <p class="ds-isurface-read">${escape(win.read)}</p>
      ${horizons
        .map((h) => {
          const list = win.entries.filter((e) => e.horizon === h);
          if (list.length === 0) return '';
          const label = list[0].horizon_label;
          return `
            <div class="ds-execwin-horizon">
              <p class="ds-execwin-horizon-label">${escape(label)}</p>
              ${list
                .slice(0, 3)
                .map(
                  (e) => `
                    <article class="ds-execwin-action ${e.is_critical_path ? 'is-critical' : ''}">
                      <h4 class="ds-execwin-action-title">${escape(e.title)}</h4>
                      <p class="ds-execwin-action-meta">${escape(PILLAR_LABEL[e.pillar])}${e.is_critical_path ? ' · Critical Path' : ''}</p>
                      ${e.outcome ? `<p class="ds-execwin-action-outcome">${escape(sentence(e.outcome, '', 160))}</p>` : ''}
                    </article>
                  `,
                )
                .join('')}
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}

function renderBrandBrief(brief: BrandBrief): string {
  if (brief.state === 'unavailable') return '';
  return `
    <div class="ds-brandbrief">
      <p class="ds-brandbrief-eyebrow">Brand Brief</p>
      <dl class="ds-brandbrief-list">
        ${brief.fields
          .map(
            (f) => `
              <div class="ds-brandbrief-row">
                <dt class="ds-brandbrief-label">${escape(f.label)}</dt>
                <dd class="ds-brandbrief-value">${escape(f.value)}</dd>
              </div>
            `,
          )
          .join('')}
      </dl>
    </div>
  `;
}

function renderStrategicPosture(posture: StrategicPosture): string {
  if (posture.state === 'unavailable') return '';
  return `
    <div class="ds-posture">
      <p class="ds-posture-eyebrow">Strategic Posture</p>
      <div class="ds-posture-row">
        ${posture.entries
          .map(
            (e) => `
              <div class="ds-posture-cell">
                <span class="ds-posture-label">${escape(e.label)}</span>
                <span class="ds-posture-value">${escape(e.value)}</span>
              </div>
            `,
          )
          .join('')}
      </div>
    </div>
  `;
}

function renderAITrajectory(traj: AITrajectory): string {
  if (traj.state === 'insufficient_history') {
    return `
      <div class="ds-isurface">
        <p class="ds-isurface-eyebrow">AI Visibility Trajectory</p>
        <p class="ds-isurface-read">${escape(traj.reading)}</p>
      </div>
    `;
  }
  const directionClass =
    traj.direction === 'improved' ? 'is-up' : traj.direction === 'regressed' ? 'is-down' : 'is-flat';
  const arrow = traj.direction === 'improved' ? '↑' : traj.direction === 'regressed' ? '↓' : '→';
  const sign = (traj.delta ?? 0) > 0 ? '+' : '';
  return `
    <div class="ds-isurface">
      <p class="ds-isurface-eyebrow">AI Visibility Trajectory</p>
      <div class="ds-aitrajectory ${directionClass}">
        <span class="ds-aitrajectory-arrow">${arrow}</span>
        <span class="ds-aitrajectory-delta">${traj.delta != null ? `${sign}${traj.delta}` : '—'}</span>
        <span class="ds-aitrajectory-from">${traj.previous != null ? `from ${traj.previous}/100` : ''} ${traj.current != null ? `· now ${traj.current}/100` : ''}</span>
      </div>
      <p class="ds-isurface-read" style="margin-top: 4mm;">${escape(traj.reading)}</p>
    </div>
  `;
}

function renderCompetitiveAI(comp: CompetitiveAIVisibility): string {
  if (comp.state === 'unavailable') {
    return `
      <div class="ds-isurface">
        <p class="ds-isurface-eyebrow">Competitive AI Visibility</p>
        <p class="ds-isurface-read">${escape(comp.reading)}</p>
      </div>
    `;
  }
  return `
    <div class="ds-isurface">
      <p class="ds-isurface-eyebrow">Competitive AI Visibility</p>
      <p class="ds-isurface-read">${escape(comp.reading)}</p>
    </div>
  `;
}

function renderMarketContext(ctx: MarketContext): string {
  if (ctx.state === 'unavailable') {
    return `
      <div class="ds-isurface">
        <p class="ds-isurface-eyebrow">Market Context</p>
        <p class="ds-isurface-read">${escape(ctx.read)}</p>
      </div>
    `;
  }
  return `
    <div class="ds-isurface">
      <p class="ds-isurface-eyebrow">Market Context${ctx.vertical ? ` · ${escape(ctx.vertical)}` : ''}${ctx.peer_count ? ` · ${ctx.peer_count} peers` : ''}</p>
      <p class="ds-isurface-read">${escape(ctx.read)}</p>
      <div class="ds-isurface-rows">
        ${ctx.entries
          .map(
            (e) => `
              <div class="ds-isurface-row">
                <div class="ds-isurface-row-key">${escape(e.label)}</div>
                <div class="ds-isurface-row-text">${escape(e.reading)}</div>
              </div>
            `,
          )
          .join('')}
      </div>
    </div>
  `;
}

function renderAIRetrievalReliability(rel: AIRetrievalReliability): string {
  if (rel.state === 'unavailable') {
    return `
      <div class="ds-isurface">
        <p class="ds-isurface-eyebrow">AI Retrieval Reliability</p>
        <p class="ds-isurface-read">${escape(rel.read)}</p>
      </div>
    `;
  }
  return `
    <div class="ds-isurface">
      <p class="ds-isurface-eyebrow">AI Retrieval Reliability</p>
      <p class="ds-isurface-read">${escape(rel.read)}</p>
      <div class="ds-isurface-rows">
        ${rel.entries
          .map(
            (e) => `
              <div class="ds-isurface-row">
                <div class="ds-isurface-row-key">${escape(e.label)}</div>
                <div class="ds-isurface-row-text">${escape(e.reading)}</div>
              </div>
            `,
          )
          .join('')}
      </div>
    </div>
  `;
}

function renderStrategicPositionFourState(four: StrategicPositionFourState): string {
  const cards: Array<[string, string, string]> = [
    ['is-broken', "What's Broken", four.whats_broken],
    ['is-fix', 'What To Fix First', four.fix_first],
    ['is-delay', 'What To Delay', four.delay],
    ['is-ignored', 'If Ignored', four.if_ignored],
  ];
  return `
    <div class="ds-fourstate">
      ${cards
        .map(
          ([cls, label, text]) => `
            <article class="ds-fourstate-card ${cls}">
              <p class="ds-fourstate-label">${escape(label)}</p>
              <p class="ds-fourstate-text">${escape(text)}</p>
            </article>
          `,
        )
        .join('')}
    </div>
  `;
}

function renderDataSourceStatusPanels(panels: DataSourceStatusPanels): string {
  return `
    <div class="ds-isurface">
      <p class="ds-isurface-eyebrow">Data Source Status · ${panels.connected_count} of ${panels.total} connected</p>
      <p class="ds-isurface-read">Each panel below shows how a signal currently feeds this report. Connected sources increase precision; missing or partial sources flag where insights remain directional.</p>
      <div class="ds-dsource-grid">
        ${panels.panels
          .map(
            (p) => `
              <div class="ds-dsource-panel is-${escape(p.status)}">
                <div class="ds-dsource-header">
                  <span class="ds-dsource-label">${escape(p.source_label)}</span>
                  <span class="ds-dsource-status">${escape(p.status_label)}</span>
                </div>
                <div class="ds-dsource-row">
                  <p class="ds-dsource-row-label">Current State</p>
                  <p class="ds-dsource-row-text">${escape(p.current_state)}</p>
                </div>
                <div class="ds-dsource-row">
                  <p class="ds-dsource-row-label">Impact On Report</p>
                  <p class="ds-dsource-row-text">${escape(p.impact)}</p>
                </div>
                <div class="ds-dsource-row">
                  <p class="ds-dsource-row-label">What Unlocks</p>
                  <p class="ds-dsource-row-text">${escape(p.what_unlocks)}</p>
                </div>
              </div>
            `,
          )
          .join('')}
      </div>
      <p class="ds-dsource-summary">Insights are directional where data is partial or missing. Connecting more sources improves precision automatically — it does not change how scores are calculated.</p>
    </div>
  `;
}

function renderCompetitorPressure(pressure: CompetitorPressure): string {
  if (pressure.state === 'unavailable' || pressure.cards.length === 0) return '';
  return `
    <div class="ds-isurface">
      <p class="ds-isurface-eyebrow">Competitor Pressure</p>
      <p class="ds-isurface-read">Each competitor creates a different shape of pressure depending on where they outscore the brand. The cards below identify the dominant pressure type per competitor.</p>
      <div class="ds-cpressure-grid">
        ${pressure.cards
          .map(
            (c) => `
              <div class="ds-cpressure-card is-${escape(c.pressure_kind)}">
                <p class="ds-cpressure-name">${escape(c.name)}</p>
                <p class="ds-cpressure-kind">${escape(c.pressure_label)}</p>
                <p class="ds-cpressure-reading">${escape(c.reading)}</p>
                <div class="ds-cpressure-mix">
                  ${c.influence_mix
                    .map(
                      (m) => `<span class="ds-cpressure-chip is-${escape(m.level)}">${escape(PILLAR_LABEL[m.pillar])} ${escape(m.level)}</span>`,
                    )
                    .join('')}
                </div>
              </div>
            `,
          )
          .join('')}
      </div>
    </div>
  `;
}

function renderCompetitorMatrix(matrix: CompetitorMatrix): string {
  if (matrix.state === 'unavailable' || matrix.competitor_rows.length === 0) {
    return '';
  }
  const fmt = (v: number | null) => (v != null ? String(v) : '<span class="ds-cmatrix-na">—</span>');
  return `
    <div class="ds-cmatrix">
      <p class="ds-isurface-eyebrow">Competitor Matrix</p>
      <p class="ds-isurface-read">${escape(matrix.read)}</p>
      <table class="ds-cmatrix-table">
        <thead>
          <tr>
            <th>Competitor</th>
            ${matrix.columns.map((c) => `<th>${escape(c.label)}</th>`).join('')}
            <th>Overall</th>
          </tr>
        </thead>
        <tbody>
          ${
            matrix.user_row
              ? `<tr class="is-user">
                  <td>${escape(matrix.user_row.name)}</td>
                  ${matrix.user_row.scores.map((s) => `<td>${fmt(s.value)}</td>`).join('')}
                  <td>${fmt(matrix.user_row.overall)}</td>
                </tr>`
              : ''
          }
          ${matrix.competitor_rows
            .map(
              (r) => `
                <tr>
                  <td>${escape(r.name)}</td>
                  ${r.scores.map((s) => `<td>${fmt(s.value)}</td>`).join('')}
                  <td>${fmt(r.overall)}</td>
                </tr>
              `,
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderStrongestPeerGap(gap: StrongestPeerGap): string {
  if (gap.state === 'unavailable') return '';
  const ahead = gap.gap_points != null && gap.gap_points < 0;
  // Every chip below carries a real value: the gap in points is real
  // arithmetic (peer average minus brand value); the confidence band
  // comes straight from the canonical competitive scan output. No
  // synthetic impact score.
  return `
    <div class="ds-cgap ${ahead ? 'is-leading' : ''}">
      <p class="ds-cgap-eyebrow">Strongest Peer Gap</p>
      <h4 class="ds-cgap-headline">${escape(gap.headline)}</h4>
      <p class="ds-cgap-why">${escape(gap.why)}</p>
      <div class="ds-cgap-meta">
        ${gap.gap_points != null ? `<span class="ds-cgap-chip">${ahead ? 'Lead' : 'Gap'} <strong>${Math.abs(gap.gap_points)} pts</strong></span>` : ''}
        <span class="ds-cgap-chip">Confidence <strong>${escape(gap.confidence_band)}</strong></span>
        ${gap.led_by.length > 0 ? `<span class="ds-cgap-led">Led by ${escape(gap.led_by.join(', '))}</span>` : ''}
      </div>
    </div>
  `;
}

function renderCompetitorBenchmark(bench: CompetitorBenchmark): string {
  if (bench.state === 'unavailable' || bench.entries.length === 0) {
    return '';
  }
  const max = Math.max(
    ...bench.entries.filter((e) => e.overall != null).map((e) => e.overall as number),
    bench.user_overall ?? 0,
    50,
  );
  const pct = (v: number | null) => (v != null ? Math.round((v / max) * 100) : 0);
  return `
    <div class="ds-cbench">
      <p class="ds-isurface-eyebrow">Competitor Benchmark</p>
      <p class="ds-isurface-read">${escape(bench.reading)}</p>
      ${
        bench.user_overall != null
          ? `<div class="ds-cbench-row is-user">
              <div class="ds-cbench-name">Brand</div>
              <div class="ds-cbench-track"><div class="ds-cbench-fill" style="width: ${pct(bench.user_overall)}%;"></div></div>
              <div class="ds-cbench-value">${bench.user_overall}</div>
            </div>`
          : ''
      }
      ${bench.entries
        .map(
          (e) => `
            <div class="ds-cbench-row">
              <div class="ds-cbench-name">${escape(e.name)}</div>
              <div class="ds-cbench-track"><div class="ds-cbench-fill" style="width: ${pct(e.overall)}%;"></div></div>
              <div class="ds-cbench-value">${e.overall != null ? e.overall : '—'}</div>
            </div>
          `,
        )
        .join('')}
    </div>
  `;
}

function renderLimitingDimensions(limiting: LimitingDimensions): string {
  if (limiting.state === 'insufficient_signal' || limiting.entries.length === 0) {
    return '';
  }
  return `
    <div class="ds-vlimiting">
      <p class="ds-vlimiting-eyebrow">What Is Limiting The Score</p>
      ${limiting.entries
        .map(
          (e) => `
            <div class="ds-vlimiting-row">
              <div class="ds-vlimiting-key"><small>${escape(PILLAR_LABEL[e.pillar])}</small>${escape(e.label)}</div>
              <div class="ds-vlimiting-why">${escape(e.why)}</div>
              <div class="ds-vlimiting-value">${e.value}</div>
            </div>
          `,
        )
        .join('')}
    </div>
  `;
}

function renderFastestLever(lever: FastestLever): string {
  if (lever.state === 'insufficient_signal') return '';
  return `
    <div class="ds-vlever">
      <p class="ds-vlever-eyebrow">Fastest Improvement Lever</p>
      <p class="ds-vlever-text"><strong>${escape(lever.dimension_label ?? '')}</strong> — ${escape(lever.reading.replace(/^[^—]+— /, ''))}</p>
    </div>
  `;
}

function renderGrowthPathDirectives(growth: GrowthPathDirectives): string {
  if (growth.state === 'insufficient_signal' || growth.directives.length === 0) {
    return '';
  }
  return `
    <div class="ds-vgrowth">
      <p class="ds-vgrowth-eyebrow">Growth Path</p>
      <p class="ds-vgrowth-bridge">Current: <strong>${escape(growth.current_level)}</strong> → Next: <strong>${escape(growth.next_level)}</strong></p>
      <ul class="ds-vgrowth-list">
        ${growth.directives
          .map((d) => `<li class="ds-vgrowth-item">${escape(d.text)}</li>`)
          .join('')}
      </ul>
    </div>
  `;
}

function renderExecutiveReadinessSummary(payload: CanonicalExportPayload): string {
  // BETA-EVIDENCE-EXEC-002: governance readiness ("have we measured enough?") — presented BEFORE the authority
  // read and explicitly framed as report completeness, NOT authority. Reads payload.evidence_readiness only.
  const r = payload.evidence_readiness;
  if (!r) return '';
  const STATE_LABEL: Record<string, string> = {
    not_started: 'Not started', discovering: 'Discovering', partially_measured: 'Partially measured',
    measurement_ready: 'Measurement ready', fully_measured: 'Fully measured',
  };
  const gapRows = r.gaps
    .map((g) => `
      <div class="ds-methodology-row">
        <dt class="ds-methodology-label">${escape(g.area)}</dt>
        <dd class="ds-methodology-body"><strong>Why:</strong> ${escape(g.why)} <strong>Impact:</strong> ${escape(g.impact)} <strong>Next step:</strong> ${escape(g.next_step)} <strong>Benefit:</strong> ${escape(g.expected_benefit)}</dd>
      </div>`)
    .join('');
  const aiPart = r.ai_coverage_percentage != null ? ` · AI coverage ${r.ai_coverage_percentage}%` : '';
  return `
    <section class="ds-methodology no-break">
      <p class="ds-methodology-eyebrow">Report Readiness — Before You Read the Scores</p>
      <h2 class="ds-methodology-title">How much of your digital presence we have measured so far</h2>
      <p class="ds-methodology-lead">${escape(r.headline)} This is a measure of report completeness, not of your authority — a low reading here means "not yet measured", not "weak".</p>
      <dl class="ds-methodology-list">
        <div class="ds-methodology-row">
          <dt class="ds-methodology-label">Measurement readiness</dt>
          <dd class="ds-methodology-body">${escape(STATE_LABEL[r.state] ?? r.state)} · ${r.connected_sources} of ${r.total_sources} evidence sources connected · ${r.coverage_percentage}% of measures resolved${escape(aiPart)}</dd>
        </div>
        ${gapRows}
      </dl>
      ${r.next_moves.length ? `<p class="ds-methodology-foot">To make this report more complete: ${escape(r.next_moves.join('; '))}.</p>` : ''}
    </section>
  `;
}

export function renderDeclaredEvidence(payload: CanonicalExportPayload): string {
  // BETA-PHASE0-EXEC-001: render the non-scored Declared Evidence (EVIDENCE-EXEC-003) faithfully into the
  // export — declared by the organization, NOT independently verified, and never scored. Renders only when
  // present + material; empty ⇒ nothing. Reuses the existing ds-methodology section styling (no new pipeline).
  const de = payload.declared_evidence;
  if (!de) return '';
  const rows: Array<[string, string]> = [];

  if (de.same_as.count > 0) {
    const types = Object.entries(de.same_as.destination_types).map(([t, n]) => `${t}: ${n}`).join(', ');
    const domains = de.same_as.domains.slice(0, 8).join(', ');
    rows.push(['Declared identity links', `${de.same_as.count} sameAs link${de.same_as.count === 1 ? '' : 's'}${types ? ` (${types})` : ''}${domains ? `. ${domains}` : ''}.`]);
  }
  if (de.declared_certifications.count > 0) {
    rows.push(['Declared certifications', `${de.declared_certifications.count} declared (not independently verified): ${de.declared_certifications.items.slice(0, 8).join(', ')}.`]);
  }
  const legalPresent = de.legal_transparency.items.filter((i) => i.present).map((i) => i.label);
  const legalMissing = de.legal_transparency.items.filter((i) => !i.present).map((i) => i.label);
  if (de.legal_transparency.items.length > 0) {
    rows.push(['Legal transparency', `${de.legal_transparency.present_count}/${de.legal_transparency.items.length} present.${legalPresent.length ? ` Present: ${legalPresent.join(', ')}.` : ''}${legalMissing.length ? ` Missing: ${legalMissing.join(', ')}.` : ''}`]);
  }

  if (rows.length === 0) return ''; // nothing material → render nothing

  return `
    <section class="ds-methodology no-break">
      <p class="ds-methodology-eyebrow">Declared Evidence</p>
      <h2 class="ds-methodology-title">What the site declares about itself</h2>
      <p class="ds-methodology-lead">Measured on-site evidence, declared by the organization and not independently verified. This section carries no score and does not affect any pillar or the Authority Index.</p>
      <dl class="ds-methodology-list">
        ${rows
          .map(
            ([label, body]) => `
              <div class="ds-methodology-row">
                <dt class="ds-methodology-label">${escape(label)}</dt>
                <dd class="ds-methodology-body">${escape(body)}</dd>
              </div>
            `,
          )
          .join('')}
      </dl>
    </section>
  `;
}

export function renderReportDisclosures(payload: CanonicalExportPayload): string {
  // BETA-REPORT-EXEC-010: render the payload truth (EXEC-005/007/008/009) faithfully — no recompute, no
  // derivation. Executive language only; renders ONLY elements that are present/material; empty ⇒ nothing.
  const rows: Array<[string, string]> = [];

  const roi = payload.commercial_roi;
  if (roi) {
    rows.push(['Commercial ROI', `${roi.label}. ${roi.basis}${roi.unlock ? ` ${roi.unlock}` : ''}`]);
  }

  const traj = payload.authority_trajectory?.provenance;
  if (traj) {
    const hist = traj.history === 'measured' ? 'Measured history'
      : traj.history === 'insufficient' ? 'Insufficient history' : 'History unavailable';
    const projected = traj.forecast === 'projected'
      ? ' The forward value is a projection, not measured future performance.' : '';
    rows.push(['Authority trajectory', `${hist}. ${traj.basis}${projected}`]);
  }

  const comp = payload.competitive_surface_share?.provenance;
  if (comp) {
    rows.push(['Competitor comparison', `${comp.measured ? 'Public-web analysis' : 'No observations'}. ${comp.basis}`]);
  }

  for (const d of payload.override_disclosure?.disclosures ?? []) {
    rows.push([d.override_type, `${d.affected} Reason: ${d.reason}`]);
  }

  if (rows.length === 0) return ''; // nothing material to disclose → render nothing

  return `
    <section class="ds-methodology no-break">
      <p class="ds-methodology-eyebrow">How To Read This Report</p>
      <h2 class="ds-methodology-title">Disclosures — what is measured, estimated, projected, or adjusted</h2>
      <p class="ds-methodology-lead">These notes make explicit which parts of this report are directly measured, which are estimated or projected, which are unavailable, and whether any analyst or governance adjustment was applied to what you see.</p>
      <dl class="ds-methodology-list">
        ${rows
          .map(
            ([label, body]) => `
              <div class="ds-methodology-row">
                <dt class="ds-methodology-label">${escape(label)}</dt>
                <dd class="ds-methodology-body">${escape(body)}</dd>
              </div>
            `,
          )
          .join('')}
      </dl>
    </section>
  `;
}

function renderMethodology(): string {
  // Methodology block — a final transparency page that explains, in
  // plain language, where every number on the dossier comes from. The
  // goal is to let any reader (technical or not) understand that no
  // value is fabricated — each is derived from the brand's own
  // canonical scan or from the universal scoring rules that apply to
  // every brand the same way.
  const rows: Array<[string, string]> = [
    [
      'Authority Index',
      'A composite of the five pillar scores. Computed as a geometric mean so that one weak pillar drags the overall down — preventing any single high score from masking a foundation gap.',
    ],
    [
      'Pillar scores',
      'Each pillar is scored from the dimensions that compose it (Foundation = Index Integrity + Extraction Readiness, Authority = Authority Inflow + Entity Graph Strength, etc.). Those dimensions come from the brand’s own site scan, structured-data check, AI citation check, backlink data source, and reputation data sources — only what is actually measured for this brand. Where data is unavailable, the area is honestly marked unmeasured rather than estimated.',
    ],
    [
      'Maturity stage',
      'Determined by the same band thresholds that define every score (foundational 0–24, developing 25–49, operational 50–74, leading 75+). Same rules apply to every brand worldwide; no industry or geography weighting.',
    ],
    [
      'AI Visibility',
      'Derived from a real AI citation check: each cell of the AI-engine × query-type grid is the live citation rate for the brand on that combination. Cells that were not measured in this scan show "—" rather than an estimate.',
    ],
    [
      'Competitor scores',
      'Sourced directly from the competitor scan output for each named peer. The brand row uses the brand\'s own scores. The peer average is a straight arithmetic mean of the measured competitors. No synthetic peers, no industry-default benchmarks.',
    ],
    [
      'Strongest Peer Gap',
      'Computed as the largest arithmetic difference between the brand\'s value and the peer average on the same dimension. The "gap in points" chip is exact subtraction. Confidence is the evidence-coverage band of the competitive scan.',
    ],
    [
      'Movement / Trajectory',
      'Calculated by comparing the current snapshot to the previous comparable snapshot for the same brand. When fewer than two comparable observations exist, the dossier honestly says "trajectory cannot yet be classified" rather than projecting.',
    ],
    [
      'Action sequencing',
      'Actions are ordered by their dependency map: foundational blockers clear first because their resolution unlocks every downstream pillar. The horizon labels (Within 90 days, etc.) come from each action\'s own timeline.',
    ],
    [
      'Data confidence',
      'A measure of how much evidence was available for this brand — how many report areas resolved as measured, inferred, insufficient, or unavailable. It reflects evidence coverage, not a statistical confidence level or a guarantee of accuracy. The freshness label is the actual age of the most recent observation.',
    ],
  ];

  return `
    <section class="ds-methodology">
      <p class="ds-methodology-eyebrow">How These Numbers Are Calculated</p>
      <h2 class="ds-methodology-title">Where every value in this report comes from</h2>
      <p class="ds-methodology-lead">Every number here is computed from this brand\'s own scan — the site scan, the structured-data check, the AI citation check, the backlink data source, the reputation data source, and the competitor scan. The rules that turn those signals into scores and stages are the same for every brand, regardless of industry, market, or region.</p>
      <dl class="ds-methodology-list">
        ${rows
          .map(
            ([label, body]) => `
              <div class="ds-methodology-row">
                <dt class="ds-methodology-label">${escape(label)}</dt>
                <dd class="ds-methodology-body">${escape(body)}</dd>
              </div>
            `,
          )
          .join('')}
      </dl>
      <p class="ds-methodology-foot">Where a signal is genuinely unavailable, the dossier says so explicitly. Nothing is estimated, projected, or industry-defaulted. Adding a missing data source improves the depth of these numbers automatically; it does not change how they are calculated.</p>
    </section>
  `;
}

function renderClosingInterpretation(closing: ClosingInterpretation): string {
  // Plain-English captions paired with each anchor. Same data, paired
  // with a one-line caption so any reader can parse the row.
  const rows: Array<[string, string, string]> = [
    ['System Today', 'What kind of authority system the brand currently is', closing.authority_system_today],
    ['Evolution Constraint', 'What is most limiting the brand\'s ability to advance', closing.evolution_constraint],
    ['Trajectory', 'What happens if momentum continues unchanged', closing.momentum_implication],
    ['Unlock', 'What changes the next stage trajectory most', closing.next_unlock],
  ];
  return `
    <section class="ds-closing">
      <p class="ds-closing-eyebrow">Final Strategic Interpretation</p>
      <h2 class="ds-closing-title">The single executive takeaway</h2>
      ${rows
        .map(
          ([label, caption, text]) => `
            <div class="ds-closing-row">
              <p class="ds-closing-row-label">${escape(label)}</p>
              <p class="ds-closing-row-caption">${escape(caption)}</p>
              <p class="ds-closing-row-text">${escape(text)}</p>
            </div>
          `,
        )
        .join('')}
    </section>
  `;
}

function renderExecutiveRealitySnapshot(
  dossier: ExecutiveDossier,
  payload: CanonicalExportPayload,
  surfaces: {
    brand_brief: BrandBrief;
    strategic_posture: StrategicPosture;
    strategic_position_4: StrategicPositionFourState;
  },
): string {
  const sections = dossier.sections;
  const brief = dossier.summary_brief;
  const strongest = sections.authority_position.dominant_strength;
  const weakest = sections.authority_position.dominant_weakness;
  const aiScore = sections.ai_discoverability.surface_score;
  const confidence = payload.authority_overview.overall_score.confidence;
  // VD-01: never present "high confidence" when the overall authority is unmeasured. The confidence band is
  // unchanged; the presentation is reconciled with the overall score state (evidence coverage, not certainty).
  const overallMeasured =
    payload.authority_overview.overall_score.value != null &&
    payload.authority_overview.overall_score.state !== 'insufficient_signal' &&
    payload.authority_overview.overall_score.state !== 'unavailable';
  const heroConfidence = overallMeasured ? confidence : 'Insufficient evidence';
  const barConfidence = overallMeasured ? `${confidence} · evidence coverage` : 'Insufficient evidence';
  const generated = payload.snapshot_observed_at ?? payload.generated_at;

  const strongestLabel = strongest ? PILLAR_LABEL[strongest.pillar] : 'Not yet measured';
  const strongestDetail = strongest
    ? sentence(strongest.signal, `${PILLAR_LABEL[strongest.pillar]} is currently the clearest reinforcement signal.`, 120)
    : 'No canonical pillar has enough evidence to carry the authority story yet.';

  const weakestLabel = weakest ? PILLAR_LABEL[weakest.pillar] : 'Not yet measured';
  const weakestDetail = weakest
    ? sentence(weakest.signal, `${PILLAR_LABEL[weakest.pillar]} is the largest visible constraint.`, 120)
    : 'The evidence base does not yet isolate one dominant constraint.';

  const aiVisibility = isMeasuredScore(aiScore)
    ? `AI visibility is ${bandLanguage(aiScore)}`
    : 'AI visibility is not yet sufficiently measured';

  const signals = [
    {
      label: 'Maturity Stage',
      value: sections.executive_reality.current_maturity_label,
      detail: sentence(payload.maturity_stage.why_this_stage, 'Current authority evolution stage.', 120),
    },
    {
      label: 'Strongest Pillar',
      value: strongestLabel,
      detail: strongestDetail,
    },
    {
      label: 'Weakest Pillar',
      value: weakestLabel,
      detail: weakestDetail,
    },
    {
      label: 'AI Visibility',
      value: aiVisibility,
      detail: sentence(sections.ai_discoverability.rationale.text, 'AI retrieval and citation evidence is still forming.', 120),
    },
    {
      label: 'Biggest Opportunity',
      value: brief.biggest_opportunity.label,
      detail: sentence(brief.biggest_opportunity.detail, 'Highest leverage opportunity surfaced by canonical intelligence.', 120),
    },
    {
      label: 'Primary Risk',
      value: brief.biggest_risk.label,
      detail: sentence(brief.biggest_risk.detail, 'Most dangerous weakness surfaced by canonical intelligence.', 120),
    },
  ];

  // Snapshot avoids re-stating the Authority Shape — the cover already
  // names it. Kicker, title, and body advance the read instead of
  // looping on the same wording. The shape's *strategic implication*
  // travels into the Strategic Direction paragraph below.
  return `
    <section class="ds-snapshot">
      <div>
        <header class="ds-snapshot-header">
          <p class="ds-snapshot-kicker">Executive Reality Snapshot</p>
          <h2 class="ds-snapshot-title">Current Authority State</h2>
        </header>

        ${renderBrandBrief(surfaces.brand_brief)}
        ${renderStrategicPosture(surfaces.strategic_posture)}

        <!-- Hero Authority Index — big bold number paired with stage / confidence / movement chips, recovered from legacy snapshot's score donut -->
        <div class="ds-herohead">
          <div class="ds-herohead-score">
            <span class="ds-herohead-value">${
              isMeasuredScore(payload.authority_overview.overall_score)
                ? String(payload.authority_overview.overall_score.value)
                : '—'
            }<span class="ds-herohead-of">/100</span></span>
            <span class="ds-herohead-label">Authority Index</span>
          </div>
          <div class="ds-herohead-meta">
            <div class="ds-herohead-cell">
              <span class="ds-herohead-cell-label">Stage</span>
              <span class="ds-herohead-cell-value">${escape(payload.maturity_stage.label)}</span>
            </div>
            <div class="ds-herohead-cell">
              <span class="ds-herohead-cell-label">Confidence</span>
              <span class="ds-herohead-cell-value">${escape(heroConfidence)}</span>
            </div>
            <div class="ds-herohead-cell">
              <span class="ds-herohead-cell-label">Authority Shape</span>
              <span class="ds-herohead-cell-value">${escape(dossier.authority_shape.name)}</span>
            </div>
          </div>
        </div>

        ${renderAuthorityBar({
          value: payload.authority_overview.overall_score.value,
          state: payload.authority_overview.overall_score.state,
          label: 'Authority Index',
          variant: 'emphasis',
        })}
        ${renderMaturityContinuum(payload.maturity_stage.stage)}
        ${renderPillarBalanceStrip(payload.pillars)}

        <div class="ds-signal-grid">
          ${signals
            .map(
              (signal) => `
                <article class="ds-signal">
                  <p class="ds-signal-label">${escape(signal.label)}</p>
                  <p class="ds-signal-value">${escape(signal.value)}</p>
                  <p class="ds-signal-detail">${escape(signal.detail)}</p>
                </article>
              `,
            )
            .join('')}
        </div>

        ${renderStrategicPositionFourState(surfaces.strategic_position_4)}

        <div class="ds-direction">
          <p class="ds-direction-label">Strategic Direction</p>
          <p class="ds-direction-text">${escape(buildStrategicDirection(dossier))}</p>
        </div>
      </div>

      <footer class="ds-evidence-bar">
        <div>
          <span class="ds-evidence-label">Confidence</span>
          <span class="ds-evidence-value">${escape(barConfidence)}</span>
        </div>
        <div>
          <span class="ds-evidence-label">Evidence</span>
          <span class="ds-evidence-value">${escape(evidenceSufficiency(payload))}</span>
        </div>
        <div>
          <span class="ds-evidence-label">Freshness</span>
          <span class="ds-evidence-value">${escape(formatReportDate(generated))}</span>
        </div>
        <div>
          <span class="ds-evidence-label">Coverage</span>
          <span class="ds-evidence-value">${escape(providerCoverage(payload))}</span>
        </div>
      </footer>
    </section>
  `;
}

function renderPillar(pillar: CanonicalPillarScore): string {
  const accent = PILLAR_ACCENT[pillar.pillar];
  const measured =
    typeof pillar.score.value === 'number' &&
    pillar.score.state !== 'insufficient_signal' &&
    pillar.score.state !== 'unavailable';
  const pct = measured ? Math.max(0, Math.min(100, Math.round(pillar.score.value as number))) : 0;
  return `
    <div class="ds-pillar">
      <div class="ds-pillar-rail" style="border-left-color: ${accent};">
        <div class="ds-pillar-score">${scoreNumber(pillar.score)}<span class="ds-pillar-score-of">/100</span></div>
        <div class="ds-pillar-band">${escape(scoreBand(pillar.score))}</div>
      </div>
      <div>
        <p class="ds-pillar-name">${escape(pillar.label)}</p>
        <p class="ds-pillar-purpose">${escape(pillar.purpose)}</p>
        <div class="ds-pillar-bar"><div class="ds-pillar-bar-fill" style="width: ${pct}%; background: ${accent};"></div></div>
        ${pillar.primary_signal ? `<p class="ds-pillar-signal">${escape(pillar.primary_signal)}</p>` : ''}
      </div>
    </div>
  `;
}

function renderAuthorityPosition(
  section: AuthorityPositionSection,
  _authority_shape: AuthorityShape,
  surfaces: {
    pillar_deltas: import('./dossier/visualPrimitives').PillarDelta[];
  },
  sectionNumber: string,
): string {
  // Authority Position is now the system-level diagnostic — pillar
  // grid + movement deltas + constraint narrative. The analytical
  // breakdown (Score Drivers + Dimension Breakdown + Limiting +
  // Fastest Lever) lives in dedicated Section 02 so each chapter
  // carries its own analytical role.
  const measured = section.pillars.filter(
    (p) =>
      typeof p.score.value === 'number' &&
      p.score.state !== 'insufficient_signal' &&
      p.score.state !== 'unavailable',
  );
  const anchorItems: EvidenceAnchorItem[] = [];
  if (section.dominant_strength) {
    anchorItems.push({
      label: 'Strongest Pillar',
      value: `${section.dominant_strength.score}/100 ${PILLAR_LABEL[section.dominant_strength.pillar]}`,
      tone: 'positive',
    });
  }
  if (section.dominant_weakness) {
    anchorItems.push({
      label: 'Weakest Pillar',
      value: `${section.dominant_weakness.score}/100 ${PILLAR_LABEL[section.dominant_weakness.pillar]}`,
      tone: 'risk',
    });
  }
  if (measured.length >= 2 && section.dominant_strength && section.dominant_weakness) {
    const spread = section.dominant_strength.score - section.dominant_weakness.score;
    anchorItems.push({
      label: 'Pillar Spread',
      value: `${spread} pts`,
      tone: spread >= 25 ? 'warn' : 'neutral',
    });
  }
  anchorItems.push({
    label: 'Measured',
    value: `${measured.length} of ${section.pillars.length}`,
    tone: 'neutral',
  });

  return `
    <section class="ds-section">
      ${renderSectionHeader(section.meta.title, section.meta.dominant_question, sectionNumber)}
      ${renderFraming(section.framing_sentence)}
      ${renderEvidenceAnchorRow(anchorItems)}
      ${renderPillarDeltasStrip(surfaces.pillar_deltas)}
      <div class="ds-pillar-grid">
        ${section.pillars.map(renderPillar).join('')}
      </div>
      ${renderConstraintNarrative(section.constraint_narrative)}
    </section>
  `;
}

function renderScoreDriversAndLimitersSection(
  surfaces: {
    score_drivers: ScoreDrivers;
    dimension_breakdown: DimensionBreakdown;
    limiting_dimensions: LimitingDimensions;
    fastest_lever: FastestLever;
  },
  sectionNumber: string,
): string {
  return `
    <section class="ds-section">
      ${renderSectionHeader('Score Drivers & Limiters', 'Which dimensions are pulling the score forward — and which are holding it back?', sectionNumber)}
      ${renderFraming('A score is the average of its parts. The ones moving forward are the assets to defend; the ones stuck below are where investment compounds fastest.')}
      ${renderScoreDrivers(surfaces.score_drivers)}
      ${renderLimitingDimensions(surfaces.limiting_dimensions)}
      ${renderFastestLever(surfaces.fastest_lever)}
      ${renderDimensionBreakdown(surfaces.dimension_breakdown)}
    </section>
  `;
}

function renderCompetitiveLandscapeSection(
  surfaces: {
    competitor_matrix: CompetitorMatrix;
    strongest_peer_gap: StrongestPeerGap;
    competitor_benchmark: CompetitorBenchmark;
    competitive_ai: CompetitiveAIVisibility;
    competitor_pressure: CompetitorPressure;
  },
  sectionNumber: string,
): string {
  return `
    <section class="ds-section">
      ${renderSectionHeader('Competitive Landscape', 'Who is shaping buyer expectations, and where is their pressure strongest?', sectionNumber)}
      ${renderFraming('Buyers and AI systems both evaluate brands relative to alternatives. The shape of the comparison set — not the absolute score — is what decides evaluation.')}
      ${renderCompetitorMatrix(surfaces.competitor_matrix)}
      ${renderStrongestPeerGap(surfaces.strongest_peer_gap)}
      ${renderCompetitorBenchmark(surfaces.competitor_benchmark)}
      ${renderCompetitorPressure(surfaces.competitor_pressure)}
      ${renderCompetitiveAI(surfaces.competitive_ai)}
    </section>
  `;
}

function renderDataConfidenceCoverageSection(
  surfaces: { data_source_panels: DataSourceStatusPanels; data_confidence: DataConfidence },
  sectionNumber: string,
): string {
  return `
    <section class="ds-section">
      ${renderSectionHeader('Data Confidence & Coverage', 'Which signals are connected, and what does that mean for the precision of this report?', sectionNumber)}
      ${renderFraming('Connected sources increase precision. Missing or partial sources flag where insights remain directional rather than exact.')}
      ${renderConfidenceMatrix({
        measured: surfaces.data_confidence.measured_count,
        inferred: surfaces.data_confidence.inferred_count,
        insufficient: surfaces.data_confidence.insufficient_count,
        unavailable: surfaces.data_confidence.unavailable_count,
        totalProviders: surfaces.data_confidence.total_providers,
        healthyProviders: surfaces.data_confidence.healthy_providers,
      })}
      ${renderDataSourceStatusPanels(surfaces.data_source_panels)}
    </section>
  `;
}

function renderChannelStrategySection(
  surfaces: { execution_channel_mix: import('./dossier/intelligenceSurfaces').ExecutionChannelMix },
  sectionNumber: string,
): string {
  const mix = surfaces.execution_channel_mix;
  if (mix.state === 'insufficient_signal') {
    return `
      <section class="ds-section">
        ${renderSectionHeader('Execution Channel Mix', 'Which teams own the moves that change the trajectory?', sectionNumber)}
        ${renderFraming('Execution capacity needs to be staffed before the playbook can land.')}
        <p class="ds-isurface-read">${escape(mix.read)}</p>
      </section>
    `;
  }
  return `
    <section class="ds-section">
      ${renderSectionHeader('Execution Channel Mix', 'Which teams own the moves that change the trajectory?', sectionNumber)}
      ${renderFraming('A strategy without an owner does not land. The mix below names which team carries which moves so the playbook can be staffed without ambiguity.')}
      <p class="ds-isurface-read">${escape(mix.read)}</p>
      <div class="ds-channelmix-grid">
        ${mix.areas
          .map(
            (a) => `
              <div class="ds-channelmix-card ${a.has_critical_path ? 'is-critical' : ''}">
                <div class="ds-channelmix-header">
                  <span class="ds-channelmix-label">${escape(a.label)}</span>
                  <span class="ds-channelmix-count">${a.action_count} action${a.action_count === 1 ? '' : 's'}</span>
                </div>
                ${a.leading_action_title ? `<p class="ds-channelmix-leading">${escape(a.leading_action_title)}</p>` : ''}
                <p class="ds-channelmix-unlocks">${escape(a.what_unlocks)}</p>
                ${a.pillars_touched.length > 0 ? `<div class="ds-channelmix-pillars">${a.pillars_touched.map((p) => `<span class="ds-pill ds-pill-pillar-${p}">${escape(PILLAR_LABEL[p])}</span>`).join('')}</div>` : ''}
              </div>
            `,
          )
          .join('')}
      </div>
    </section>
  `;
}

function renderAiDiscoverability(
  section: AiDiscoverabilitySection,
  surfaces: {
    channel_leverage: ChannelLeverage;
    ai_retrieval_reliability: AIRetrievalReliability;
    ai_trajectory: AITrajectory;
    competitive_ai: CompetitiveAIVisibility;
    ai_visibility_state: AIVisibilityState;
    ai_trust_coherence: AITrustCoherence;
    ai_absence_risk: AIAbsenceRisk;
    ai_strategic_unlock: AIStrategicUnlock;
  },
  sectionNumber: string,
): string {
  const matrix = section.citation_matrix;
  const surfaceValue = scoreNumber(section.surface_score);
  const entityValue = scoreNumber(section.entity_score);

  let matrixHtml = '';
  if (matrix && matrix.cells.length > 0) {
    const providers = ['chatgpt', 'claude', 'gemini', 'perplexity', 'copilot'] as const;
    const queryClasses = ['branded', 'category', 'competitive', 'expertise'] as const;
    const cellByKey = new Map(matrix.cells.map((c) => [`${c.provider}|${c.query_class}`, c]));
    matrixHtml = `
      <table class="ds-matrix">
        <thead>
          <tr>
            <th></th>
            ${queryClasses.map((qc) => `<th>${escape(qc)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${providers
            .map((provider) => `
              <tr>
                <td class="label">${escape(provider)}</td>
                ${queryClasses
                  .map((qc) => {
                    const cell = cellByKey.get(`${provider}|${qc}`);
                    if (!cell || cell.state === 'unavailable' || cell.state === 'insufficient_signal') {
                      return `<td class="ds-matrix-cell-empty">—</td>`;
                    }
                    const rate = cell.citation_rate ?? 0;
                    const klass = rate >= 0.6 ? 'ds-matrix-cell-strong' : rate >= 0.3 ? 'ds-matrix-cell-moderate' : 'ds-matrix-cell-weak';
                    return `<td class="${klass}">${Math.round(rate * 100)}%</td>`;
                  })
                  .join('')}
              </tr>
            `)
            .join('')}
        </tbody>
      </table>
    `;
  }

  // AI Discoverability — rebuilt into a 7-block narrative system.
  // Each block evolves the executive understanding of how AI systems
  // perceive the brand:
  //   1. AI Visibility State        (can AI identify the brand?)
  //   2. Retrieval Confidence       (how confidently retrieved?)
  //   3. Citation & Mention Presence(where does it appear?)
  //   4. Trust & Corroboration      (do signals reinforce?)
  //   5. AI Market Pressure         (how crowded is the category?)
  //   6. Absence & Risk             (what's missing, with examples)
  //   7. Strategic Unlock           (one dominant move + trajectory)

  const visibilityState = surfaces.ai_visibility_state;
  const stateChipClass = (state: string) =>
    state === 'identified' || state === 'present' ? 'is-on'
    : state === 'partial' ? 'is-warn'
    : state === 'absent' ? 'is-off'
    : '';

  const trustClass =
    surfaces.ai_trust_coherence.kind === 'consistent' ? 'is-consistent'
    : surfaces.ai_trust_coherence.kind === 'fragmented' ? 'is-fragmented'
    : surfaces.ai_trust_coherence.kind === 'sparse' ? 'is-sparse'
    : surfaces.ai_trust_coherence.kind === 'weak' ? 'is-weak'
    : '';

  // Trajectory note (folded into block 7) — directional headline only.
  const trajectoryNote = (() => {
    const t = surfaces.ai_trajectory;
    if (t.state === 'insufficient_history') {
      return 'AI visibility trajectory needs repeated observation; the present state is held as the baseline.';
    }
    const sign = (t.delta ?? 0) > 0 ? '+' : '';
    const dir = t.direction === 'improved' ? 'improving' : t.direction === 'regressed' ? 'receding' : t.direction === 'stagnated' ? 'flat' : 'forming';
    return `Trajectory ${dir}${t.delta != null ? ` (${sign}${t.delta} since last snapshot)` : ''}.`;
  })();

  return `
    <section class="ds-section">
      ${renderSectionHeader(section.meta.title, section.meta.dominant_question, sectionNumber)}
      ${renderFraming(section.framing_sentence)}
      <p class="ds-ai-positioning">${escape(section.positioning_paragraph)}</p>

      <!-- BLOCK 1 — AI Visibility State -->
      <div class="ds-aiblock">
        <p class="ds-aiblock-eyebrow">01 · AI Visibility State</p>
        <h3 class="ds-aiblock-title">Can AI systems reliably identify the brand?</h3>
        ${renderAISurfaceSpectrum(section.surface_score.value, section.surface_score.state)}
        <div class="ds-aistate-chips">
          <div class="ds-aistate-chip ${stateChipClass(visibilityState.state)}">
            <span class="ds-aistate-chip-label">Identification</span>
            <span class="ds-aistate-chip-value">${escape(visibilityState.state_label)}</span>
            <span class="ds-aistate-chip-detail">${escape(`AI surface ${surfaceValue}/100`)}</span>
          </div>
          <div class="ds-aistate-chip ${stateChipClass(visibilityState.entity_state)}">
            <span class="ds-aistate-chip-label">Entity Record</span>
            <span class="ds-aistate-chip-value">${escape(visibilityState.entity_label)}</span>
            <span class="ds-aistate-chip-detail">${escape(visibilityState.entity_detail ?? `Entity score ${entityValue}/100`)}</span>
          </div>
          ${visibilityState.retrieval_consistency_pct != null ? `
          <div class="ds-aistate-chip">
            <span class="ds-aistate-chip-label">Coverage</span>
            <span class="ds-aistate-chip-value">${visibilityState.retrieval_consistency_pct}%</span>
            <span class="ds-aistate-chip-detail">${escape(visibilityState.citation_density_label ?? '')}</span>
          </div>` : ''}
        </div>
        <p class="ds-aiblock-read">${escape(visibilityState.reading)}</p>
      </div>

      <!-- BLOCK 2 — Retrieval Confidence -->
      ${matrixHtml ? `
      <div class="ds-aiblock">
        <p class="ds-aiblock-eyebrow">02 · Retrieval Confidence</p>
        <h3 class="ds-aiblock-title">How confidently can AI systems retrieve usable authority signals?</h3>
        ${matrixHtml}
        ${surfaces.ai_retrieval_reliability.state === 'measured'
          ? `<div class="ds-isurface-rows">
              ${surfaces.ai_retrieval_reliability.entries
                .map(
                  (e) => `
                    <div class="ds-isurface-row">
                      <div class="ds-isurface-row-key">${escape(e.label)}</div>
                      <div class="ds-isurface-row-text">${escape(e.reading)}</div>
                    </div>
                  `,
                )
                .join('')}
            </div>`
          : `<p class="ds-aiblock-read">${escape(surfaces.ai_retrieval_reliability.read)}</p>`
        }
      </div>` : ''}

      <!-- BLOCK 3 — Citation & Mention Presence (Channel Leverage rebadged) -->
      ${surfaces.channel_leverage.state === 'measured' && surfaces.channel_leverage.top_leverage_cells.length > 0 ? `
      <div class="ds-aiblock">
        <p class="ds-aiblock-eyebrow">03 · Citation &amp; Mention Presence</p>
        <h3 class="ds-aiblock-title">Where does the brand appear across answer ecosystems?</h3>
        <p class="ds-aiblock-read">${escape(surfaces.channel_leverage.read)}</p>
        <div class="ds-isurface-rows">
          ${surfaces.channel_leverage.top_leverage_cells
            .map(
              (c) => `
                <div class="ds-isurface-row">
                  <div class="ds-isurface-row-key"><small>${escape(c.status === 'leverage' ? 'Defend' : 'Extend')}</small>${escape(c.provider)} · ${escape(c.query_class)}</div>
                  <div class="ds-isurface-row-text">${escape(c.why)}</div>
                </div>
              `,
            )
            .join('')}
        </div>
      </div>` : ''}

      <!-- BLOCK 4 — Trust & Corroboration -->
      <div class="ds-aiblock">
        <p class="ds-aiblock-eyebrow">04 · Trust &amp; Corroboration</p>
        <h3 class="ds-aiblock-title">Do AI systems encounter consistent or fragmented authority signals?</h3>
        <div class="ds-aitrust-row">
          <span class="ds-aitrust-kind ${trustClass}">${escape(surfaces.ai_trust_coherence.kind_label)}</span>
          ${surfaces.ai_trust_coherence.reinforcement_signals.length > 0
            ? `<span class="ds-aitrust-signals">${escape(surfaces.ai_trust_coherence.reinforcement_signals.join(' · '))}</span>`
            : ''}
        </div>
        <p class="ds-aiblock-read">${escape(surfaces.ai_trust_coherence.reading)}</p>
      </div>

      <!-- BLOCK 5 — AI Market Pressure -->
      ${surfaces.competitive_ai.state === 'measured' ? `
      <div class="ds-aiblock">
        <p class="ds-aiblock-eyebrow">05 · AI Market Pressure</p>
        <h3 class="ds-aiblock-title">How crowded is category visibility in AI ecosystems?</h3>
        <p class="ds-aiblock-read">${escape(surfaces.competitive_ai.reading)}</p>
      </div>` : ''}

      <!-- BLOCK 6 — Absence & Risk (with retrieval examples) -->
      ${surfaces.ai_absence_risk.state === 'measured' ? `
      <div class="ds-aiblock">
        <p class="ds-aiblock-eyebrow">06 · Absence &amp; Risk</p>
        <h3 class="ds-aiblock-title">What does AI fail to see, and what does that cost?</h3>
        <p class="ds-aiblock-read">${escape(surfaces.ai_absence_risk.reading)}</p>
        ${surfaces.ai_absence_risk.retrieval_examples.length > 0 ? `
        <div class="ds-aiexamples">
          ${surfaces.ai_absence_risk.retrieval_examples
            .map(
              (e) => `
                <div class="ds-aiexample is-${escape(e.status)}">
                  <div class="ds-aiexample-key"><small>${escape(e.status === 'cited' ? 'Cited' : e.status === 'absent' ? 'Absent' : 'Partial')}</small>${escape(e.provider)} · ${escape(e.query_class)}</div>
                  <div class="ds-aiexample-note">${escape(e.note)}</div>
                  <div class="ds-aiexample-rate">${e.citation_rate != null ? `${Math.round(e.citation_rate * 100)}%` : '—'}</div>
                </div>
              `,
            )
            .join('')}
        </div>` : ''}
      </div>` : ''}

      <!-- BLOCK 7 — Strategic Unlock -->
      <div class="ds-aiunlock">
        <p class="ds-aiunlock-eyebrow">07 · The AI Strategic Unlock</p>
        <p class="ds-aiunlock-concept">${escape(surfaces.ai_strategic_unlock.concept_label)}</p>
        <h3 class="ds-aiunlock-headline">${escape(surfaces.ai_strategic_unlock.headline)}</h3>
        <p class="ds-aiunlock-why">${escape(surfaces.ai_strategic_unlock.why)} ${escape(trajectoryNote)}</p>
      </div>
    </section>
  `;
}

function renderTrustConsistency(section: TrustConsistencySection, sectionNumber: string): string {
  // Compression rule: small section, single canonical rationale.
  // Editorial rhythm: this is the dossier's calm beat between the
  // analytical AI section and the diagnostic Strategic Constraints
  // section. Density stays low deliberately — the page breathes.
  const value = scoreNumber(section.trust_score);
  return `
    <section class="ds-section">
      ${renderSectionHeader(section.meta.title, section.meta.dominant_question, sectionNumber)}
      ${renderFraming(section.framing_sentence)}
      <div class="ds-hero-score-row">
        <div class="ds-hero-score">
          <p class="ds-hero-score-value">${value}<span class="ds-hero-score-of">/100</span></p>
          <p class="ds-hero-score-band">${escape(scoreBand(section.trust_score))}</p>
        </div>
        <div class="ds-hero-priority">
          <p class="ds-hero-priority-label">Coherence Read</p>
          <p class="ds-hero-priority-text">${escape(section.rationale.text)}</p>
        </div>
      </div>
    </section>
  `;
}

function renderStrategicConstraints(
  section: StrategicConstraintsSection,
  payload: CanonicalExportPayload,
  _surfaces: {
    data_confidence: DataConfidence;
    limiting_dimensions: LimitingDimensions;
    fastest_lever: FastestLever;
    data_source_panels: DataSourceStatusPanels;
  },
  sectionNumber: string,
): string {
  // Compression rule + visualisation: the bottleneck bar names the
  // dominant constraint visually before the structured narrative rows
  // explain it. The legacy standalone primary_constraint +
  // authority_risk paragraphs were dropped earlier; the structured
  // constraint_narrative already synthesises both.
  return `
    <section class="ds-section">
      ${renderSectionHeader(section.meta.title, section.meta.dominant_question, sectionNumber)}
      ${renderFraming(section.framing_sentence)}
      ${renderBottleneckBar(payload.pillars)}
      ${renderConstraintNarrative(section.constraint_narrative)}
      ${
        section.weak_dimensions.length > 0
          ? `<ul class="ds-weak-dims">
              ${section.weak_dimensions
                .map(
                  (d) => `
                    <li class="ds-weak-dim">
                      <span><span class="ds-pill ds-pill-pillar-${d.pillar}">${escape(PILLAR_LABEL[d.pillar])}</span> ${escape(d.label)}</span>
                      <strong>${d.value}/100</strong>
                    </li>
                  `,
                )
                .join('')}
            </ul>`
          : ''
      }
    </section>
  `;
}

function renderMarketPosition(
  section: MarketPositionSection,
  surfaces: {
    comparative_positioning: ComparativePositioning;
    market_context: MarketContext;
  },
  sectionNumber: string,
): string {
  // Market Position carries external intelligence: peer band, market
  // context (category pressure, authority distance, discoverability
  // pressure, competitor texture), and benchmark + competitive
  // narrative. The dossier shifts from internal diagnosis to external
  // awareness here — the editorial pivot of the document.
  return `
    <section class="ds-section">
      ${renderSectionHeader(section.meta.title, section.meta.dominant_question, sectionNumber)}
      ${renderFraming(section.framing_sentence)}
      <p style="font-size: 11pt; line-height: 1.6; margin: 0 0 4mm;">${escape(sentence(section.benchmark_rationale.text, '', 280))}</p>
      <p style="font-size: 10.5pt; line-height: 1.6; color: #475569; margin: 0;">${escape(sentence(section.competitive_summary.text, '', 240))}</p>
      ${renderComparativePositioning(surfaces.comparative_positioning)}
      ${renderMarketContext(surfaces.market_context)}
    </section>
  `;
}

function renderMomentumMaturity(
  section: MomentumMaturitySection,
  surfaces: { trajectory_movement: TrajectoryMovement; growth_path: GrowthPathDirectives },
  sectionNumber: string,
): string {
  // Compression rule: maturity_evolution + momentum_shape now own the
  // developmental narrative. The maturity_pattern block (leaders focus
  // on / avoid / what advances) and the constraint_narrative (transition
  // friction restated) are dropped because they overlap with
  // maturity_evolution.transition_friction + unlock_path.
  return `
    <section class="ds-section">
      ${renderSectionHeader(section.meta.title, section.meta.dominant_question, sectionNumber)}
      ${renderFraming(section.framing_sentence)}
      <p style="font-size: 11pt; line-height: 1.6; margin: 0 0 4mm;">${escape(section.momentum_narrative.text)}</p>
      <div class="ds-maturity">
        <p class="ds-maturity-stage">${escape(section.current_stage.label)}</p>
        ${
          section.current_stage.next_stage
            ? `<p class="ds-maturity-next">Next stage: <strong>${escape(section.current_stage.next_stage)}</strong></p>`
            : section.current_stage.stage === 'leading'
              ? `<p class="ds-maturity-next">At the leading stage — the strategic challenge inverts to defence.</p>`
              : `<p class="ds-maturity-next">The maturity stage cannot yet be classified — measurement is still forming.</p>`
        }
      </div>
      ${renderMaturityEvolution(section.maturity_evolution)}
      ${renderGrowthPathDirectives(surfaces.growth_path)}
      ${renderMomentumShape(section.momentum_shape)}
      ${renderTrajectoryMovement(surfaces.trajectory_movement)}
    </section>
  `;
}

function renderAction(action: GroupedAction): string {
  // Executive action card. Carries enough metadata to communicate
  // strategic urgency + execution sequencing without becoming an
  // operational checklist:
  //
  //   - Title: the action
  //   - Why-now: one sentence on what makes this the move now
  //   - Pillar + Severity pills: identity + weight at a glance
  //   - Time-to-impact: short canonical horizon ('within 90 days', etc.)
  //   - Unlocks: the strategic outcome the action opens
  //
  // Confidence, impact-band, and effort-level remain on the canonical
  // action object for downstream consumers (working teams use them
  // through the canonical API) but no longer compete for executive
  // attention here.
  const horizon = action.timeline?.short ? sentence(action.timeline.short, '', 60) : null;
  // Tactics list — derived from canonical action.timeline.{short, mid}.
  // These are the real near-term and mid-term steps the canonical
  // engine emits for each action; surfacing them as a numbered list
  // matches the legacy snapshot's TACTICS pattern.
  const tactics: string[] = [];
  if (action.timeline?.short) {
    const t = sentence(action.timeline.short, '', 200);
    if (t) tactics.push(t);
  }
  if (action.timeline?.mid) {
    const t = sentence(action.timeline.mid, '', 200);
    if (t && t !== tactics[0]) tactics.push(t);
  }
  return `
    <article class="ds-action ds-action-severity-${action.severity}">
      <h4 class="ds-action-title">${escape(action.title)}</h4>
      <p style="font-size:10pt;line-height:1.6;color:#0f172a;margin:0 0 2mm;"><strong style="color:#475569;font-weight:580;">Why now —</strong> ${escape(sentence(action.reasoning, 'This action belongs at this priority tier.', 180))}</p>
      <div class="ds-action-meta">
        <span class="ds-pill ds-pill-pillar-${action.pillar}">${escape(PILLAR_LABEL[action.pillar])}</span>
        <span class="ds-pill ds-pill-severity-${action.severity}">${escape(action.severity)}</span>
        ${horizon ? `<span class="ds-pill">${escape(horizon)}</span>` : ''}
      </div>
      ${tactics.length > 0
        ? `<div class="ds-action-tactics">
            <p class="ds-action-tactics-label">Tactics</p>
            <ol class="ds-action-tactics-list">
              ${tactics.map((t) => `<li class="ds-action-tactics-item">${escape(t)}</li>`).join('')}
            </ol>
          </div>`
        : ''
      }
      ${action.expected_outcome
        ? `<p style="font-size:9.5pt;color:#475569;margin:3mm 0 0;line-height:1.55;"><strong style="color:#0f172a;font-weight:580;">Unlocks —</strong> ${escape(sentence(action.expected_outcome, '', 160))}</p>`
        : ''
      }
    </article>
  `;
}

function renderStrategicActionPlan(
  section: StrategicActionPlanSection,
  surfaces: { execution_window: ExecutionWindow },
  sectionNumber: string,
): string {
  // Editorial transition: the dossier pivots from diagnosis to
  // execution. A single italic sentence carries the beat — no new
  // section type, just a felt change in voice from observer to
  // operator before the action playbook begins.
  return `
    <div class="ds-transition">
      <p class="ds-transition-text">Diagnosis closes here. Execution begins — sequence-aware, concentration-led, paced across horizons rather than parallelised across them.</p>
    </div>
    <section class="ds-section">
      ${renderSectionHeader(section.meta.title, section.meta.dominant_question, sectionNumber)}
      ${renderFraming(section.framing_sentence)}
      ${renderExecutionWindow(surfaces.execution_window)}
      <p style="font-size: 11pt; line-height: 1.6; margin: 0 0 4mm;">${escape(section.sequence_narrative)}</p>
      ${section.groups
        .filter((g) => g.actions.length > 0)
        .map(
          (group) => `
            <div class="ds-playbook-group">
              <div class="ds-playbook-group-header">
                <p class="ds-playbook-group-label">${escape(group.label)}</p>
                <p class="ds-playbook-group-desc">${escape(group.description)}</p>
              </div>
              ${group.actions.map(renderAction).join('')}
            </div>
          `,
        )
        .join('')}
    </section>
  `;
}

// ── Top-level renderer ───────────────────────────────────────────────────────

export function renderExportHtml(payload: CanonicalExportPayload, branding?: ReportBranding): string {
  // Synthesise a CanonicalReport view from the export payload. This
  // synthesised report feeds both the dossier composer AND the
  // intelligence-surface builders so the dossier always renders from
  // a single source of truth.
  const synthesisedReport: CanonicalReport = {
      authority_overview: payload.authority_overview,
      maturity_stage: payload.maturity_stage,
      pillars: payload.pillars,
      executive_insights: payload.executive_insights,
      action_playbook: payload.action_playbook,
      strategic_playbook: payload.strategic_playbook,
      ai_surface_presence: payload.ai_surface_presence,
      knowledge_graph: payload.knowledge_graph,
      authority_inflow: payload.authority_inflow,
      trust_coherence: payload.trust_coherence,
      benchmark: payload.benchmark,
      competitive_surface_share: payload.competitive_surface_share,
      change_intelligence: payload.change_intelligence,
      forecast: payload.forecast,
      // BETA-REPORT-EXEC-010: the export payload now carries authority_trajectory (with provenance) — render
      // it faithfully; fall back to an empty trajectory only for legacy payloads that omit it.
      authority_trajectory: payload.authority_trajectory ?? { snapshots: [], forecast: null, available: false },
      // The dossier composer reads the fields below from the payload too,
      // so they're spread through.
      discoverability_authority_radar: { axes: [], overall_confidence: 'low', benchmark_label: null, competitor_overlay: [] },
      provider_observability: { observed_at: '', window_hours: 0, providers: [] },
      scan_metadata: payload.scan_metadata,
      governance: { tenant_id: payload.tenant_id, plan_tier: 'standard', policy_revision: 'export', enabled_providers: [], excluded_providers: [], external_calls_forbidden: false, allowed_scan_profiles: [] },
      active_overrides: [],
      explanations: payload.explanations as any,
      comparison: payload.comparison as any,
      collaboration: { annotations: [], assignments: [], pinned_findings: [], recommendation_statuses: [] },
      evidence_trace: payload.evidence_appendix
        ? { by_dimension: payload.evidence_appendix.by_dimension, by_pillar: payload.evidence_appendix.by_pillar, overall: payload.evidence_appendix.overall }
        : { by_dimension: {}, by_pillar: {}, overall: { count: 0, sources: [], freshness: { last_observed_at: null, age_hours: null }, observations: [] } },
  };

  const dossier: ExecutiveDossier = composeExecutiveDossier({
    report: synthesisedReport,
    brand: { tenant_id: payload.tenant_id, company_id: payload.company_id, brand_name: null, domain: null },
  });

  const sections = dossier.sections;

  // Intelligence surfaces — derived once from the synthesised report so
  // the renderer threads consistent analytical data into each section.
  const surfaces = {
    dimension_breakdown: buildDimensionBreakdown(synthesisedReport),
    score_drivers: buildScoreDrivers(synthesisedReport),
    comparative_positioning: buildComparativePositioning(synthesisedReport),
    trajectory_movement: buildTrajectoryMovement(synthesisedReport),
    data_confidence: buildDataConfidence(synthesisedReport),
    channel_leverage: buildChannelLeverage(synthesisedReport),
    execution_window: buildExecutionWindow(synthesisedReport),
    market_context: buildMarketContext(synthesisedReport),
    ai_retrieval_reliability: buildAIRetrievalReliability(synthesisedReport),
    ai_trajectory: buildAITrajectory(synthesisedReport),
    competitive_ai: buildCompetitiveAIVisibility(synthesisedReport),
    ai_visibility_state: buildAIVisibilityState(synthesisedReport),
    ai_trust_coherence: buildAITrustCoherence(synthesisedReport),
    ai_absence_risk: buildAIAbsenceRisk(synthesisedReport),
    ai_strategic_unlock: buildAIStrategicUnlock(synthesisedReport),
    competitor_matrix: buildCompetitorMatrix(synthesisedReport),
    strongest_peer_gap: buildStrongestPeerGap(synthesisedReport),
    competitor_benchmark: buildCompetitorBenchmark(synthesisedReport),
    limiting_dimensions: buildLimitingDimensions(synthesisedReport),
    fastest_lever: buildFastestLever(synthesisedReport),
    growth_path: buildGrowthPathDirectives(synthesisedReport),
    strategic_position_4: buildStrategicPositionFourState(synthesisedReport),
    data_source_panels: buildDataSourceStatusPanels(synthesisedReport),
    execution_channel_mix: buildExecutionChannelMix(synthesisedReport),
    competitor_pressure: buildCompetitorPressure(synthesisedReport),
    brand_brief: buildBrandBrief(branding?.companyContext ?? null),
    strategic_posture: buildStrategicPosture(branding?.companyContext ?? null),
    pillar_deltas: synthesisedReport.change_intelligence.state === 'measured'
      ? synthesisedReport.change_intelligence.pillar_deltas.map((pd) => ({
          pillar: pd.pillar,
          delta_value: pd.delta.delta,
          direction: pd.delta.direction,
          significant: pd.delta.significant,
        }))
      : [],
  };

  // Brand presence: prefer the explicit brand inputs threaded in by the
  // canonical pipeline; fall back to the export payload's company_id.
  const brandName = (branding?.brandName ?? payload.company_id ?? '').trim() || payload.company_id;
  const brandDomain = (branding?.domain ?? '').trim();
  const logoUrl = branding?.logoUrl?.trim() || null;
  const faviconUrl = branding?.faviconUrl?.trim() || null;

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Authority Intelligence Dossier — ${escape(brandName)}</title>
        ${faviconUrl ? `<link rel="icon" href="${escape(faviconUrl)}" />` : ''}
        <style>${STYLESHEET}</style>
      </head>
      <body>
        <div class="ds-page">
          <header class="ds-cover">
            <div class="ds-cover-content">
              <div class="ds-cover-mark"></div>
              <div class="ds-cover-identity">
                ${
                  logoUrl
                    ? `<img src="${escape(logoUrl)}" alt="${escape(brandName)} logo" class="ds-cover-logo" onerror="this.setAttribute('data-fallback','true')" />`
                    : `<h1 class="ds-cover-company">${escape(brandName)}</h1>`
                }
                ${brandDomain ? `<p class="ds-cover-domain">${escape(brandDomain)}</p>` : ''}
              </div>
              <p class="ds-cover-title">Authority Intelligence Dossier</p>
              <div class="ds-cover-shape">
                <p class="ds-cover-shape-eyebrow">Authority Shape · How the brand reads today</p>
                <p class="ds-cover-shape-name">${escape(dossier.authority_shape.name)}</p>
              </div>
              <p class="ds-cover-thesis">${escape(buildCoverThesis(dossier))}</p>
              <div class="ds-cover-accent"></div>
              <div class="ds-cover-meta-row">
                <span class="ds-cover-stage">${escape(payload.maturity_stage.label)} stage</span>
                <span>Generated ${escape(formatReportDate(payload.snapshot_observed_at ?? payload.generated_at))}</span>
              </div>
            </div>
          </header>

          ${renderExecutiveReadinessSummary(payload)}
          ${renderExecutiveRealitySnapshot(dossier, payload, surfaces)}
          ${renderAuthorityPosition(sections.authority_position, dossier.authority_shape, surfaces, '01')}
          ${renderScoreDriversAndLimitersSection(surfaces, '02')}
          ${renderAiDiscoverability(sections.ai_discoverability, surfaces, '03')}
          ${renderTrustConsistency(sections.trust_consistency, '04')}
          ${renderStrategicConstraints(sections.strategic_constraints, payload, surfaces, '05')}
          ${renderMarketPosition(sections.market_position, surfaces, '06')}
          ${renderCompetitiveLandscapeSection(surfaces, '07')}
          ${renderMomentumMaturity(sections.momentum_maturity, surfaces, '08')}
          ${renderDataConfidenceCoverageSection(surfaces, '09')}
          ${renderChannelStrategySection(surfaces, '10')}
          ${renderStrategicActionPlan(sections.strategic_action_plan, surfaces, '11')}
          ${renderDeclaredEvidence(payload)}
          ${renderReportDisclosures(payload)}
          ${renderMethodology()}
          ${renderClosingInterpretation(dossier.closing_interpretation)}

          <footer class="ds-footer">
            ${faviconUrl ? `<img src="${escape(faviconUrl)}" alt="" class="ds-footer-mark" onerror="this.style.display='none'" />` : ''}
            <span class="ds-footer-text">${escape(brandName)}${brandDomain ? ` · ${escape(brandDomain)}` : ''} · Authority Intelligence Dossier · Generated ${escape(formatReportDate(payload.generated_at))}</span>
          </footer>
        </div>
      </body>
    </html>
  `;
}
