/** Part 3/4 of exportRenderer.ts — verbatim split (barrel preserved; importers unchanged). */
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
import { PILLAR_LABEL, PILLAR_ACCENT, escape, scoreNumber, scoreBand, isMeasuredScore, sentence, formatReportDate, bandLanguage, buildStrategicDirection, evidenceSufficiency, providerCoverage } from './exportRendererCore';
import { renderSectionHeader, renderFraming, renderConstraintNarrative, renderDimensionBreakdown, renderScoreDrivers, renderBrandBrief, renderStrategicPosture, renderCompetitiveAI, renderStrategicPositionFourState, renderDataSourceStatusPanels, renderCompetitorPressure, renderCompetitorMatrix, renderStrongestPeerGap, renderCompetitorBenchmark, renderLimitingDimensions, renderFastestLever } from './exportRendererSections';

export function renderClosingInterpretation(closing: ClosingInterpretation): string {
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

export function renderExecutiveRealitySnapshot(
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

export function renderAuthorityPosition(
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

export function renderScoreDriversAndLimitersSection(
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

export function renderCompetitiveLandscapeSection(
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

export function renderDataConfidenceCoverageSection(
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

export function renderChannelStrategySection(
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

export function renderAiDiscoverability(
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

