/** Part 1/2 of exportRendererSections.ts — verbatim split (barrel preserved; importers unchanged). */
/** Part 2/4 of exportRenderer.ts — verbatim split (barrel preserved; importers unchanged). */
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
import { PILLAR_LABEL, escape, sentence } from './exportRendererCore';


export function renderSectionHeader(title: string, dominant_question: string, sectionNumber?: string): string {
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

export function renderFraming(framing: string | null | undefined): string {
  const text = (framing ?? '').trim();
  if (!text) return '';
  return `<p class="ds-framing">${escape(text)}</p>`;
}

export function renderConstraintNarrative(narrative: ConstraintNarrative | null): string {
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

export function renderMaturityEvolution(evolution: MaturityEvolution | null): string {
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

export function renderMomentumShape(shape: MomentumShape): string {
  return `
    <div class="ds-momentum-shape">
      <p class="ds-momentum-shape-eyebrow">Authority Momentum Shape</p>
      <p class="ds-momentum-shape-label">${escape(shape.label)}</p>
      <p class="ds-momentum-shape-reading">${escape(shape.reading)}</p>
      <p class="ds-momentum-shape-body">${escape(shape.interpretation)}</p>
    </div>
  `;
}

export function renderDimensionBreakdown(breakdown: DimensionBreakdown): string {
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

export function renderScoreDrivers(drivers: ScoreDrivers): string {
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

export function renderComparativePositioning(pos: ComparativePositioning): string {
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

export function renderTrajectoryMovement(traj: TrajectoryMovement): string {
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

export function renderExecutionWindow(win: ExecutionWindow): string {
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

export function renderBrandBrief(brief: BrandBrief): string {
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

export function renderStrategicPosture(posture: StrategicPosture): string {
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

export function renderCompetitiveAI(comp: CompetitiveAIVisibility): string {
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

export function renderMarketContext(ctx: MarketContext): string {
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

