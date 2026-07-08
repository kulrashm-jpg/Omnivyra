/** Part 4/4 of exportRenderer.ts — verbatim split (barrel preserved; importers unchanged). */
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
import { type ReportBranding, PILLAR_LABEL, escape, scoreNumber, scoreBand, sentence, formatReportDate, buildCoverThesis, STYLESHEET } from './exportRendererCore';
import { renderSectionHeader, renderFraming, renderConstraintNarrative, renderMaturityEvolution, renderMomentumShape, renderComparativePositioning, renderTrajectoryMovement, renderExecutionWindow, renderMarketContext, renderGrowthPathDirectives, renderExecutiveReadinessSummary, renderDeclaredEvidence, renderReportDisclosures, renderMethodology } from './exportRendererSections';
import { renderClosingInterpretation, renderExecutiveRealitySnapshot, renderAuthorityPosition, renderScoreDriversAndLimitersSection, renderCompetitiveLandscapeSection, renderDataConfidenceCoverageSection, renderChannelStrategySection, renderAiDiscoverability } from './exportRendererAssembly';

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

// ── Quantified improvement plan ───────────────────────────────────────────────
//
// Score-anchored to-dos: one per measurably weak dimension, each with WHAT to do,
// HOW to do it, and the exact projected point gain (recomputed from the report's own
// aggregation, so the number is the real lift — never an inflated estimate).

function renderImprovementPlan(
  todos: CanonicalExportPayload['improvement_todos'],
  sectionNumber: string,
): string {
  if (!todos || todos.length === 0) return '';
  const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
  return `
    <section class="ds-section">
      ${renderSectionHeader(
        'Quantified Improvement Plan',
        'For each weak score: what to do, how to do it, and how much it lifts the number.',
        sectionNumber,
      )}
      <p class="ds-framing">Each item targets a dimension that is measurably below a healthy level. The projected gain is recomputed from the report's own scoring formula — the weak dimension is raised to its target, then the pillar average and the overall geometric mean are re-run — so the points reflect the true lift, not an approximation. Items are ordered by overall impact.</p>
      ${todos
        .map(
          (todo, index) => `
            <div class="ds-playbook-group">
              <div class="ds-playbook-group-header">
                <p class="ds-playbook-group-label">${escape(`${index + 1}. ${todo.dimension_label}`)} <span class="ds-pill">${escape(todo.pillar_label)}</span></p>
                <p class="ds-playbook-group-desc">${escape(todo.what)}</p>
              </div>
              <div style="display:flex; gap:5mm; flex-wrap:wrap; margin:0 0 3mm; font-family:'Inter',system-ui,sans-serif; font-size:9pt; color:#334155;">
                <span><strong style="color:#0f172a;">Now</strong> ${todo.current_score}/100</span>
                <span><strong style="color:#0f172a;">Target</strong> ${todo.target_score}/100</span>
                <span><strong style="color:#0f4c6b;">Overall +${todo.projected_overall_gain} pts</strong></span>
                <span><strong style="color:#0f172a;">${escape(todo.pillar_label)} +${todo.projected_pillar_gain} pts</strong></span>
                <span class="ds-pill">${escape(titleCase(todo.effort))} effort</span>
              </div>
              <ol style="margin:0; padding-left:6mm; font-size:10.5pt; line-height:1.6; color:#1a2332;">
                ${todo.how.map((step) => `<li style="margin:0 0 1.5mm;">${escape(step)}</li>`).join('')}
              </ol>
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
      improvement_todos: payload.improvement_todos,
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
          ${renderImprovementPlan(payload.improvement_todos, '12')}
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

