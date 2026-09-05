/** Part 2/2 of exportRendererSections.ts — verbatim split (barrel preserved; importers unchanged). */
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
import { PILLAR_LABEL, escape, formatReportDate, sentence } from './exportRendererCore';


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

export function renderStrategicPositionFourState(four: StrategicPositionFourState): string {
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

export function renderDataSourceStatusPanels(panels: DataSourceStatusPanels): string {
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

export function renderCompetitorPressure(pressure: CompetitorPressure): string {
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

export function renderCompetitorMatrix(matrix: CompetitorMatrix): string {
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

export function renderStrongestPeerGap(gap: StrongestPeerGap): string {
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

export function renderCompetitorBenchmark(bench: CompetitorBenchmark): string {
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

export function renderLimitingDimensions(limiting: LimitingDimensions): string {
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

export function renderFastestLever(lever: FastestLever): string {
  if (lever.state === 'insufficient_signal') return '';
  return `
    <div class="ds-vlever">
      <p class="ds-vlever-eyebrow">Fastest Improvement Lever</p>
      <p class="ds-vlever-text"><strong>${escape(lever.dimension_label ?? '')}</strong> — ${escape(lever.reading.replace(/^[^—]+— /, ''))}</p>
    </div>
  `;
}

export function renderGrowthPathDirectives(growth: GrowthPathDirectives): string {
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

export function renderExecutiveReadinessSummary(payload: CanonicalExportPayload): string {
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

  // ── GAP-09 · evidence acquisition ──────────────────────────────────────────
  //
  // The report previously disclosed what it CONCLUDED but never what it FETCHED. A document whose
  // sections all abstain is only interpretable if the reader can tell the two causes apart: a site
  // that was crawled and found healthy, and a site that was never crawled at all. These rows state
  // the acquisition record for the run — counts and reasons produced by the acquisition services
  // themselves, never re-derived here, and rendered only when the producer supplied them.

  const crawl = payload.report1?.evidence_acquisition?.crawl;
  if (crawl) {
    // `pagesAfter` is the denominator under every crawl-derived percentage in this report, so it is
    // stated plainly. A zero-page outcome is reported as a zero-page outcome — the composition
    // completing is not evidence that anything was fetched.
    const fetchedNow = crawl.pagesAfter > crawl.pagesBefore;
    const outcome = crawl.pagesAfter === 0
      ? 'No pages were obtained'
      : `${crawl.pagesAfter} page${crawl.pagesAfter === 1 ? '' : 's'} available${fetchedNow ? ` (${crawl.pagesAfter - crawl.pagesBefore} fetched for this report)` : ' (reused from a recent scan)'}`;
    const observed = crawl.lastCrawledAt ? ` Last observed ${formatReportDate(crawl.lastCrawledAt)}.` : '';
    const why = crawl.pagesAfter === 0 || crawl.error
      ? ` ${crawl.error ? `The crawl failed: ${crawl.error}` : crawl.reason}`
      : '';
    rows.push([
      'Website crawl',
      `${outcome}. Outcome: ${crawl.action.replace(/_/g, ' ')}.${observed}${why}`,
    ]);
  }

  const matrixCoverage = payload.ai_surface_presence?.citation_matrix?.coverage;
  if (matrixCoverage && matrixCoverage.total_cells > 0) {
    // Stated as a fraction, not a percentage alone — "1 of 20" is harder to misread as broad
    // coverage than "5%", and the unqueried providers are named so absence is attributable.
    const unqueried = (payload.ai_surface_presence?.citation_matrix?.by_provider ?? [])
      .filter((p) => p.state !== 'measured')
      .map((p) => p.provider);
    rows.push([
      'AI answer-engine coverage',
      `${matrixCoverage.measured_cells} of ${matrixCoverage.total_cells} provider × question-type checks returned data.`
        + `${unqueried.length > 0 ? ` No result from: ${unqueried.join(', ')}.` : ''}`
        + `${matrixCoverage.measured_cells === 0 ? ' No AI visibility conclusion is drawn from this run.' : ''}`,
    ]);
  }

  const serp = payload.report1?.evidence_acquisition?.serp;
  if (serp) {
    const serpBody = serp.status === 'live'
      ? `Live search results were retrieved${serp.keywordCount != null ? ` across ${serp.keywordCount} quer${serp.keywordCount === 1 ? 'y' : 'ies'}` : ''}${serp.domainsFound != null ? `, returning ${serp.domainsFound} distinct domain${serp.domainsFound === 1 ? '' : 's'}` : ''}.`
      : serp.status === 'fallback'
        ? `Search queries ran${serp.keywordCount != null ? ` (${serp.keywordCount})` : ''} but returned no usable competitor domains, so competitive findings rest on other evidence.`
        : 'No search-result acquisition ran for this report.';
    rows.push(['Search-result acquisition', serpBody]);
  }

  // Sources the evidence model expects but could not read. Each reason is the producer's own
  // string — the report says why a source is missing rather than leaving a silent hole.
  const unavailable: Array<[string, string | null | undefined]> = [
    ['Page performance', payload.report1?.performance?.reasonUnavailable],
    ['Backlink authority', payload.authority_inflow?.profile?.reason_unavailable],
    ['Reputation / reviews', payload.trust_coherence?.signals?.reason_unavailable],
    ['Knowledge graph', payload.knowledge_graph?.entity?.reason_unavailable],
    ['Peer benchmark', payload.benchmark?.overlay?.reason_unavailable],
  ];
  for (const [label, reason] of unavailable) {
    if (typeof reason === 'string' && reason.trim()) rows.push([`${label} — unavailable`, reason.trim()]);
  }

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

export function renderMethodology(): string {
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


