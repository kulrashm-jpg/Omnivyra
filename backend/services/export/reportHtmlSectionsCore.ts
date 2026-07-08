/** Report HTML sections — snapshot spec, subsections, foundational sections — split from reportHtmlSections.ts (barrel preserved; importers unchanged). */
import type { PdfReportPayload } from './reportPdfRenderer';
import type { SnapshotSectionStatus } from './reportHtmlNarrativeFlows';
import { renderGeoAeoFlow, renderSocialPlatformFlow, renderTrajectoryFlow, renderConfidenceFlow, renderNextLevelCtaFlow } from './reportHtmlNarrativeFlows';
import { collectMasterActions, deriveDataSources, inferMasterActionTrack, renderInlineDisclaimer, renderMasterActionCard, scoreMetricCard, toUpperStrength, type DerivedDataSource, type MasterAction } from './reportHtmlActionDataHelpers';
import { sectionHeaderBar } from './html/htmlHelpers';
import { displayScore, formatSignedGap, getStateBadgeClass, getStateBarClass, getStateTone, renderBarSvg, renderBeforeAfter, renderCalloutBox, renderCompactBulletLine, renderComparisonBar, renderExecutiveInsights, renderFillQuote, renderInlineSummary, renderMetricGrid, renderMetricRowCard, renderMiniMetrics, renderNarrativeGroup, renderPagePrintHeader, renderPerformanceScoreRow, renderRadarSvg, renderReportBlock, renderScoreComparison, renderScoreDonut, renderTrendSvg, renderVisualMetricBlock, stripLeadingSectionHeader } from './reportHtmlVisualPrimitives';
import { clampPercent, escapeHtml, getOverallScore, hasContent, hasNonEmptyList, hasRealAiVisibilityData, safeText, stripRepeatedSentences, stripTimelinePrefix } from './reportHtmlCoreUtils';
import { hasPassedFinalCompetitorGate } from '../competitorEngineService';


export type SnapshotSectionSpec = {
  id: string;
  title: string;
  status: SnapshotSectionStatus;
  html: string;
};

export function renderSubsection(content: string, options?: { flow?: boolean; tight?: boolean; id?: string }): string {
  if (!content) return '';
  const classes = [
    'report-subsection',
    options?.flow ? 'flow' : '',
    options?.tight ? 'tight' : '',
  ].filter(Boolean).join(' ');
  const idAttr = options?.id ? ` id="${escapeHtml(options.id)}"` : '';
  return `<div class="${classes}"${idAttr}>${content}</div>`;
}

function getCompetitorBadgeLabel(classification: string, source: string): string {
  if (classification === 'authority_leader') return 'Authority';
  if (classification === 'seo_competitor') return 'SEO';
  return 'Direct';
}

function getCompetitorStandingTone(standing: 'Behind' | 'At Par' | 'Ahead'): string {
  if (standing === 'Ahead') return 'badge-green';
  if (standing === 'At Par') return 'badge-gray';
  return 'badge-amber';
}

function getCompetitorStandingLabel(standing: 'Behind' | 'At Par' | 'Ahead'): string {
  if (standing === 'Ahead') return 'Leading';
  if (standing === 'At Par') return 'Competitive';
  return 'Behind';
}

function getInfluenceLabel(score: number | null | undefined): 'High' | 'Medium' | 'Low' | 'Not measured' {
  if (!Number.isFinite(score)) return 'Not measured';
  const numeric = Number(score);
  if (numeric >= 67) return 'High';
  if (numeric >= 34) return 'Medium';
  return 'Low';
}

function getInfluenceBadgeClass(label: ReturnType<typeof getInfluenceLabel>): string {
  if (label === 'High') return 'badge-red';
  if (label === 'Medium') return 'badge-amber';
  if (label === 'Low') return 'badge-green';
  return 'badge-gray';
}

function getDominantCompetitorPressure(radarItem: {
  content_score?: number;
  keyword_coverage_score?: number;
  authority_score?: number;
  technical_score?: number;
  ai_answer_presence_score?: number;
} | null | undefined): string {
  if (!radarItem) return 'Positioning pressure';
  const areas = [
    { label: 'Feature / message pressure', score: radarItem.content_score ?? null },
    { label: 'Market pressure', score: radarItem.keyword_coverage_score ?? null },
    { label: 'Authority pressure', score: radarItem.authority_score ?? null },
    { label: 'Technical pressure', score: radarItem.technical_score ?? null },
    { label: 'AI answer pressure', score: radarItem.ai_answer_presence_score ?? null },
  ].filter((item) => Number.isFinite(item.score));

  if (!areas.length) return 'Positioning pressure';
  areas.sort((a, b) => Number(b.score) - Number(a.score));
  return areas[0]?.label ?? 'Positioning pressure';
}

function normalizeNameKey(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function hasFinalCompetitorProof(item: any): boolean {
  return hasPassedFinalCompetitorGate({
    name: item?.name,
    domain: item?.domain,
    source: item?.source,
    category: item?.category,
    relevance_score: item?.relevanceScore,
    final_score: item?.finalScore,
    authority_score: item?.authorityScore,
    authority_signals: item?.authoritySignals,
    positioning: item?.positioning,
    enrichment: item?.enrichment,
    enrichment_confidence_score: item?.enrichmentConfidenceScore,
  } as any);
}

type PerformanceMetricView = {
  shownScore: number | null;
  displayValue: string;
  statusLabel: string;
  note: string;
  isConfigured: boolean;
  tone: 'green' | 'amber' | 'red' | 'gray';
};

function getPerformanceMetricView(input: {
  metric: 'content_quality' | 'publishing_frequency' | 'reach' | 'engagement' | 'authority' | 'conversion' | 'coverage' | 'platforms' | 'aeo_readiness';
  score: number | null;
  dataStrength: string;
  note: string;
  payload: PdfReportPayload;
}): PerformanceMetricView {
  const normalizedStrength = String(input.dataStrength || 'MISSING').toUpperCase();
  const isReliableStrength = normalizedStrength === 'STRONG' || normalizedStrength === 'AVAILABLE';

  switch (input.metric) {
    case 'content_quality':
    case 'authority':
      if (isReliableStrength && input.score != null) {
        return {
          shownScore: input.score,
          displayValue: displayScore(input.score, 'AVAILABLE'),
          statusLabel: 'Measured',
          note: input.note,
          isConfigured: true,
          tone: Number(input.score) >= 50 ? 'green' : Number(input.score) >= 30 ? 'amber' : 'red',
        };
      }
      return {
        shownScore: null,
        displayValue: input.metric === 'content_quality' ? 'Website foundation observed' : 'Trust signal under review',
        statusLabel: 'Monitoring signal quality',
        note: input.metric === 'content_quality'
          ? `${input.note} Website pages and content structure are being reviewed, but the score stays gated until source confidence is consistently strong enough.`
          : `${input.note} Domain trust and authority signals are being reviewed against the market, but the score stays gated until source confidence is consistently strong enough.`,
        isConfigured: true,
        tone: input.metric === 'content_quality' ? 'amber' : 'red',
      };
    case 'aeo_readiness':
      if (input.score != null && hasRealAiVisibilityData(input.payload)) {
        return {
          shownScore: input.score,
          displayValue: displayScore(input.score, 'AVAILABLE'),
          statusLabel: 'Measured',
          note: input.note,
          isConfigured: true,
          tone: Number(input.score) >= 50 ? 'green' : Number(input.score) >= 30 ? 'amber' : 'red',
        };
      }
      return {
        shownScore: null,
        displayValue: 'Answer structure being checked',
        statusLabel: 'Watching answer-engine presence',
        note: `${input.note} Website answer structure, entity clarity, and citation readiness are being monitored, and a score will appear once answer-engine signals become dependable.`,
        isConfigured: true,
        tone: 'amber',
      };
    case 'engagement':
      if (input.score != null && input.score >= 5) {
        return {
          shownScore: input.score,
          displayValue: displayScore(input.score, 'AVAILABLE'),
          statusLabel: 'Measured',
          note: input.note,
          isConfigured: true,
          tone: Number(input.score) >= 50 ? 'green' : Number(input.score) >= 30 ? 'amber' : 'red',
        };
      }
      return {
        shownScore: null,
        displayValue: 'Low active engagement',
        statusLabel: 'Light engagement signal',
        note: `${input.note} Early visit and click behaviour is being observed, but usage is still too light to publish a stable engagement score.`,
        isConfigured: true,
        tone: 'amber',
      };
    case 'reach':
      if (input.score != null) {
        return {
          shownScore: null,
          displayValue: 'Early search visibility seen',
          statusLabel: 'Search reach under review',
          note: `${input.note} Search visibility is being monitored from the available site/search footprint, but this tile will only show a number once reach signals are broad enough to normalize reliably.`,
          isConfigured: true,
          tone: 'amber',
        };
      }
      return {
        shownScore: null,
        displayValue: 'Not Available',
        statusLabel: 'Search reach under review',
        note: `${input.note} A direct search integration is still required before Omnivyra can show a defensible reach number here.`,
        isConfigured: false,
        tone: 'gray',
      };
    case 'conversion':
      return {
        shownScore: null,
        displayValue: 'Conversion path under review',
        statusLabel: 'Conversion instrumentation light',
        note: `${input.note} The framework is ready, and the system is watching commercial journeys, but it will only publish a number once direct conversion evidence is connected.`,
        isConfigured: true,
        tone: 'amber',
      };
    case 'coverage':
      return {
        shownScore: null,
        displayValue: input.score != null ? 'Coverage footprint emerging' : 'Not Available',
        statusLabel: 'Coverage map building',
        note: `${input.note} Demand coverage is being assembled across tracked themes and queries, and the score will appear once the map is broad enough to trust.`,
        isConfigured: input.score != null,
        tone: input.score != null ? 'amber' : 'gray',
      };
    case 'publishing_frequency':
      return {
        shownScore: null,
        displayValue: 'Workflow ready, cadence light',
        statusLabel: 'Publishing workflow observed',
        note: `${input.note} Content, campaign, and publishing workflows are present, but the report will only show a score once posting cadence is measured consistently across live channels.`,
        isConfigured: true,
        tone: 'amber',
      };
    case 'platforms':
      return {
        shownScore: null,
        displayValue: 'Connected, low active usage',
        statusLabel: 'Connected, low active usage',
        note: `${input.note} Multiple platforms may already be connected, but this score stays hidden until active distribution and usage signals are strong enough to benchmark.`,
        isConfigured: true,
        tone: 'amber',
      };
    default:
      return {
        shownScore: null,
        displayValue: 'Not Available',
        statusLabel: 'Not available',
        note: input.note,
        isConfigured: false,
        tone: 'gray',
      };
  }
}

export function renderSection1Cover(payload: PdfReportPayload, vars: Record<string, string>, options?: { showStatsRow?: boolean }): string {
  const showStatsRow = options?.showStatsRow ?? true;
  const movement = safeText(
    payload.competitorMovementComparison?.summary.overall_trend
    || payload.unifiedIntelligenceSummary?.dominantGrowthChannel
    || 'stable',
    1,
  );
  const summaryCard = hasContent(vars.decision_banner)
    ? `<div class="cover-statement">${escapeHtml(vars.decision_banner)}</div>`
    : renderFillQuote('Snapshot Note', 'Clearer strategic evidence here will sharpen the first recommendation stack.');
  const coverDonut = renderScoreDonut(getOverallScore(payload), { size: 'lg', label: 'Overall Score' });
  // Show the brand identity once: logo when available, otherwise the
  // company-name H1. The URL is wrapped together with the brand element
  // in an inline-flex column (.cover-brand-block) so the URL stays
  // horizontally centered relative to whichever element is shown above.
  const identityMarkup = vars.company_logo_url
    ? `<img class="cover-logo" src="${escapeHtml(vars.company_logo_url)}" alt="${escapeHtml(vars.company_name)} logo" />`
    : `<h1>${escapeHtml(vars.company_name)}</h1>`;
  return `<div class="report-section" id="section-1">${sectionHeaderBar(vars.company_name, vars.report_date, { logoUrl: vars.company_logo_url, faviconUrl: vars.company_favicon_url })}<div class="cover-grid cover-grid-top"><div class="card no-break cover-score">${coverDonut}</div><div class="cover-identity"><div class="cover-brand-block">${identityMarkup}<div class="cover-url">${escapeHtml(vars.website_url)}</div></div><div class="tags cover-tags"><span class="badge badge-amber">${escapeHtml(vars.stage_label || '--')}</span><span class="badge badge-green">${escapeHtml(vars.confidence_label || '--')}</span><span class="badge badge-blue">${escapeHtml(movement || '--')}</span></div>${summaryCard}</div></div>${showStatsRow ? `<hr class="divider" /><div class="stats-4"><div><div class="label">Overall Score</div><div class="score-med">${escapeHtml(displayScore(getOverallScore(payload), 'AVAILABLE'))}</div></div><div><div class="label">Stage</div><div class="score-med">${escapeHtml(vars.stage_label || '--')}</div></div><div><div class="label">Confidence</div><div class="score-med">${escapeHtml(vars.confidence_label || '--')}</div></div><div><div class="label">Movement</div><div class="score-med">${escapeHtml(movement || '--')}</div></div></div>` : ''}</div>`;
}

export function renderSection2StrategicPosition(payload: PdfReportPayload, vars: Record<string, string>, options?: { showHeaderBar?: boolean }): string {
  const showHeaderBar = options?.showHeaderBar ?? true;
  const cards = [
    { title: "What's Broken", body: vars.decision_broken, tone: 'neutral' },
    { title: 'What To Fix First', body: vars.decision_fix_first, tone: 'good' },
    { title: 'What To Delay', body: vars.decision_delay, tone: 'warn' },
    { title: 'If Ignored', body: vars.decision_ignored, tone: 'bad' },
  ];
  const strengths = getStrategicStrengthCards(payload);
  const headingMarkup = `${showHeaderBar ? sectionHeaderBar(vars.company_name, vars.report_date, { logoUrl: vars.company_logo_url, faviconUrl: vars.company_favicon_url }) : ''}<div class="label">Strategic Position</div><h2>Strategic Position</h2><p style="margin-bottom:12px;">This section translates the current signal picture into an execution stance: what is hurting momentum now, what deserves focus first, and where patience matters more than reaction.</p>`;
  const decisionGrid = `<div class="grid-4">${cards.map((item) => `<article class="card ${item.tone === 'good' ? 'card-accent-green' : item.tone === 'warn' ? 'card-accent-amber' : item.tone === 'bad' ? 'card-accent-red' : 'card-accent-blue'} no-break"><h3>${escapeHtml(item.title)}</h3>${item.body ? `<p>${escapeHtml(item.body)}</p>` : renderFillQuote(item.title, 'More evidence in this area will turn the strategy into a sharper execution brief.')}</article>`).join('')}</div>`;
  const signalsGrid = `<h3>Strategic Signals</h3><div class="grid-4">${strengths.map((item) => `<div class="card no-break"><div class="label">${escapeHtml(item.label)}</div><div class="tags" style="margin:6px 0 4px;"><span class="badge ${item.tone === 'strong' ? 'badge-green' : item.tone === 'developing' ? 'badge-amber' : item.tone === 'constraint' ? 'badge-red' : 'badge-gray'}">${escapeHtml(item.tone === 'strong' ? 'Strong signal' : item.tone === 'developing' ? 'Developing signal' : item.tone === 'constraint' ? 'Constraint signal' : 'Signal pending')}</span></div>${item.value ? `<p style="margin-top:8px;">${escapeHtml(item.value)}</p>` : '<div class="pending-note">Strategic evidence in this area is still limited.</div>'}</div>`).join('')}</div>`;
  return `<div class="report-section section-continue" id="section-2">${renderSubsection(`${headingMarkup}${decisionGrid}`)}${renderSubsection(signalsGrid)}</div>`;
}

export function renderSectionBrandIntro(payload: PdfReportPayload, vars: Record<string, string>): string {
  const seenValues = new Set<string>();
  const uniqueText = (value: string): string => {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seenValues.has(normalized)) return '';
    seenValues.add(normalized);
    return value;
  };
  const facts = [
    { label: 'Products / Services', value: uniqueText(safeText(payload.companyContext?.primaryOffering, 1)) },
    { label: 'Focus', value: uniqueText(safeText(payload.companyContext?.marketContext, 1)) },
    { label: 'Positioning', value: uniqueText(safeText(payload.companyContext?.positioning || payload.companyContext?.tagline || payload.companyContext?.homepageHeadline, 1)) },
    { label: 'Differentiation', value: uniqueText(safeText(payload.companyContext?.positioningNarrative || payload.companyContext?.strategyAlignment || payload.companyContext?.positioningGap, 1)) },
  ].filter((item) => item.value);
  const marketLine = uniqueText(safeText(payload.companyContext?.marketPositionStatement || payload.companyContext?.marketNarrative, 1));
  const implicationLine = uniqueText(safeText(payload.companyContext?.positionImplication, 1));

  return `<div class="report-section section-continue" id="intro-section"><div class="label">Company Intro</div><h2>${escapeHtml(vars.company_name)} Intro</h2><div class="grid-2"><article class="card card-accent-blue no-break"><h3>${escapeHtml(vars.company_name)} At A Glance</h3>${facts.length ? `<div class="stack-10">${facts.map((item) => `<div><div class="label">${escapeHtml(item.label)}</div><p>${escapeHtml(item.value)}</p></div>`).join('')}</div>` : renderFillQuote('Company Intro', 'As more company context is connected, this intro becomes more specific and differentiated.')}</article><article class="card no-break"><h3>Market Position</h3>${marketLine ? `<p>${escapeHtml(marketLine)}</p>` : '<div class="pending-note">Market position will sharpen as more competitive evidence is connected.</div>'}${implicationLine ? `<div style="margin-top:10px;"><div class="label">What This Means</div><p>${escapeHtml(implicationLine)}</p></div>` : ''}</article></div></div>`;
}

export function renderRealityLayer(payload: PdfReportPayload): string {
  const constraints = [
    { label: 'Content quality', score: payload.seoVisuals?.seoCapabilityRadar.content_quality_score ?? null, why: 'Thin buyer-stage coverage reduces trust and discoverability.' },
    { label: 'Authority', score: payload.seoVisuals?.seoCapabilityRadar.backlinks_score ?? null, why: 'Weak authority signals limit competitive visibility.' },
    { label: 'AI visibility', score: hasRealAiVisibilityData(payload) ? (payload.geoAeoExecutiveSummary?.overallAiVisibilityScore ?? null) : null, why: 'Answer-engine readiness is still low or unverified.' },
    { label: 'Keyword research', score: payload.seoVisuals?.seoCapabilityRadar.keyword_research_score ?? null, why: 'Missing search-system data reduces confidence in demand capture planning.' },
  ]
    .filter((item) => item.score == null || item.score < 50)
    .slice(0, 3);
  const decomposition = [
    { label: 'SEO', score: payload.seoExecutiveSummary?.overallHealthScore ?? null },
    { label: 'Authority', score: payload.seoVisuals?.seoCapabilityRadar.backlinks_score ?? null },
    { label: 'AI', score: hasRealAiVisibilityData(payload) ? (payload.geoAeoExecutiveSummary?.overallAiVisibilityScore ?? null) : null },
    { label: 'Conversion', score: payload.seoVisuals?.opportunityCoverageMatrix.opportunities?.[0]?.coverage_score ?? null },
  ];

  return `<div class="report-section section-continue" id="reality-layer"><div class="label">Reality Layer</div><h2>Reality Layer</h2><div class="grid-2"><article class="card no-break"><h3>Score Decomposition</h3><div class="decomposition-stack">${decomposition.map((item) => `<div class="decomposition-row"><div class="decomposition-head"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(displayScore(item.score, item.score == null ? 'MISSING' : 'AVAILABLE'))}</strong></div><div class="bar-track"><div class="bar-fill ${getStateBarClass(item.score)}" style="width:${item.score == null ? 0 : clampPercent(item.score)}%"></div></div></div>`).join('')}</div></article><article class="card card-accent-amber no-break"><h3>Score Constraints</h3>${constraints.length ? constraints.map((item) => renderVisualMetricBlock(item.label, item.score, item.why, 50)).join('') : '<p>No major score constraint is currently isolated.</p>'}</article></div></div>`;
}

export function renderWhyThisMattersBlock(payload: PdfReportPayload): string {
  const position = safeText(payload.companyContext?.marketPositionStatement || payload.companyContext?.positioningNarrative, 2);
  const authorityGap = safeText(payload.companyContext?.positionImplication || payload.companyContext?.marketNarrative, 2);
  const contentGap = safeText(payload.decisionSnapshot?.whatsBroken || payload.diagnosis, 2);
  const competitorRadar = payload.competitorVisuals?.competitorPositioningRadar;
  const userAuthority = competitorRadar?.user?.authority_score ?? null;
  const competitorAuthorityBenchmark = competitorRadar?.competitors?.length
    ? Math.round(competitorRadar.competitors.reduce((sum, item) => sum + Number(item.authority_score ?? 0), 0) / competitorRadar.competitors.length)
    : null;
  const userContent = payload.seoVisuals?.seoCapabilityRadar.content_quality_score ?? null;
  const competitorContentBenchmark = competitorRadar?.competitors?.length
    ? Math.round(competitorRadar.competitors.reduce((sum, item) => sum + Number(item.content_score ?? 0), 0) / competitorRadar.competitors.length)
    : null;
  return `<div class="report-section section-continue" id="why-this-matters"><div class="label">Why This Matters</div><h2>Why This Matters</h2><div class="grid-3"><article class="card no-break"><h3>Position</h3>${position ? `<p>${escapeHtml(position)}</p>` : '<div class="pending-note">Position clarity is still being inferred.</div>'}</article>${renderVisualMetricBlock('Authority Gap', userAuthority, authorityGap || 'Authority impact becomes clearer with stronger external signals.', competitorAuthorityBenchmark)}${renderVisualMetricBlock('Content Gap', userContent, contentGap || 'Content gap commentary is still limited.', competitorContentBenchmark)}</div></div>`;
}

export function renderSearchFunnelBlock(payload: PdfReportPayload): string {
  const funnel = payload.seoVisuals?.searchVisibilityFunnel;
  const opportunities = payload.seoVisuals?.opportunityCoverageMatrix.opportunities ?? [];
  const conversion = opportunities.length ? Math.round(opportunities.reduce((sum, item) => sum + Number(item.coverage_score ?? 0), 0) / opportunities.length) : null;
  const missing = [
    funnel?.impressions == null ? 'Demand signals' : '',
    funnel?.clicks == null ? 'Click signals' : '',
    funnel?.ctr == null ? 'CTR signal' : '',
    conversion == null ? 'Conversion signal' : '',
  ].filter(Boolean);
  const stages = [
    { label: 'Demand', value: funnel?.impressions ?? null, note: 'Search demand entering the funnel.' },
    { label: 'Visibility', value: funnel?.impressions ?? null, note: 'How much of demand is currently visible.' },
    { label: 'Clicks', value: funnel?.clicks ?? null, note: 'Visits captured from visible demand.' },
    { label: 'Conversion', value: conversion, note: 'Commercial page readiness inferred from coverage.' },
  ];
  const analyticsDisclaimer = renderInlineDisclaimer('missing', 'Conversion and behavioral data are not available.', 'Missing analytics');
  return `<div class="report-section section-continue" id="search-funnel"><div class="label">Search Funnel</div><h2>Search Funnel</h2>${analyticsDisclaimer}<div class="funnel-row">${stages.map((stage, index) => `<div class="funnel-stage ${stage.value == null ? 'funnel-stage-missing' : ''}"><div class="label">${escapeHtml(stage.label)}</div><div class="${stage.value == null ? 'score-missing' : 'score-med'}">${escapeHtml(displayScore(stage.value, stage.value == null ? 'MISSING' : 'AVAILABLE'))}</div><p>${escapeHtml(stage.note)}</p></div>${index < stages.length - 1 ? '<div class="funnel-arrow">→</div>' : ''}`).join('')}</div>${missing.length ? `<div class="pending-note" style="margin-top:10px;">Missing signals: ${escapeHtml(missing.join(' • '))}</div>` : ''}</div>`;
}

export function renderDiagnosticBreakdownBlock(payload: PdfReportPayload): string {
  const radar = payload.seoVisuals?.seoCapabilityRadar;
  const crawl = payload.seoVisuals?.crawlHealthBreakdown;
  const cards = [
    { title: 'Technical SEO', value: radar?.technical_seo_score ?? null, note: 'Core technical readiness from crawl evidence.' },
    { title: 'Content Depth', value: radar?.content_quality_score ?? null, note: 'Depth and usefulness of key pages.' },
    { title: 'Internal Linking', value: crawl?.internal_link_issues ?? null, note: 'Internal link quality and distribution.' },
    { title: 'Crawl Health', value: crawl ? Math.max(0, 100 - ((crawl.metadata_issues ?? 0) + (crawl.structure_issues ?? 0) + (crawl.crawl_depth_issues ?? 0) + (crawl.internal_link_issues ?? 0)) * 5) : null, note: 'Combined health view from crawl diagnostics.' },
  ];
  return `<div class="report-section section-continue" id="diagnostic-breakdown"><div class="label">Diagnostic Breakdown</div><h2>Diagnostic Breakdown Cards</h2><div class="grid-4">${cards.map((card) => `<article class="card no-break"><div class="label">${escapeHtml(card.title)}</div><div class="${card.value == null ? 'score-missing' : 'score-med'}">${escapeHtml(displayScore(card.value, card.value == null ? 'MISSING' : 'AVAILABLE'))}</div><div class="bar-track"><div class="bar-fill ${card.value != null && card.value < 30 ? 'bar-fill-red' : card.value != null && card.value < 50 ? 'bar-fill-amber' : 'bar-fill-green'}" style="width:${card.value == null ? 0 : clampPercent(card.value)}%"></div></div><p style="margin-top:8px;">${escapeHtml(card.note)}</p></article>`).join('')}</div></div>`;
}

export function renderOpportunityMatrixBlock(payload: PdfReportPayload): string {
  const matrix = payload.seoVisuals?.opportunityCoverageMatrix.opportunities ?? [];
  const gap = payload.competitorVisuals?.keywordGapAnalysis;
  return `<div class="report-section section-continue" id="opportunity-matrix"><div class="label">Opportunity Matrix</div><h2>Opportunity Matrix</h2><div class="grid-3"><article class="card card-accent-green no-break"><h3>Growth Exists</h3>${matrix.length ? matrix.slice(0, 4).map((item) => `<p>${escapeHtml(item.keyword)} (${escapeHtml(displayScore(item.opportunity_score, 'AVAILABLE'))})</p>`).join('') : '<div class="pending-note">Opportunity scoring is still limited.</div>'}</article><article class="card card-accent-amber no-break"><h3>Missing Coverage</h3>${gap?.missing_keywords?.length ? gap.missing_keywords.slice(0, 5).map((item) => `<p>${escapeHtml(item)}</p>`).join('') : '<div class="pending-note">No explicit missing-keyword set available yet.</div>'}</article><article class="card no-break"><h3>Where To Push First</h3><p>${escapeHtml(matrix[0]?.keyword ? `Prioritize ${matrix[0].keyword} first because demand exists while coverage remains incomplete.` : 'Prioritize the highest-opportunity keyword clusters once stronger search data is connected.')}</p></article></div></div>`;
}

export function renderGrowthTrajectoryBlock(payload: PdfReportPayload, actions: ReturnType<typeof collectMasterActions>): string {
  const currentScore = getOverallScore(payload);
  const actionCount = actions.length;
  const highPriorityCount = actions.filter((item) => item.priority === 'HIGH').length;
  const sequence = [
    { label: 'Current baseline', detail: `Current overall score ${displayScore(currentScore, 'AVAILABLE')}` },
    { label: 'Next 30 days', detail: highPriorityCount > 0 ? `${highPriorityCount} high-priority move${highPriorityCount === 1 ? '' : 's'} ready to execute` : 'Focus first on defining the highest-leverage move' },
    { label: '60-90 day path', detail: actionCount > 0 ? `${actionCount} action${actionCount === 1 ? '' : 's'} in the current roadmap` : 'Roadmap detail expands once more action evidence is available' },
  ];
  return `<div class="report-section section-continue" id="growth-trajectory"><div class="label">Growth Trajectory</div><h2>Growth Trajectory Sequence</h2><div class="grid-3">${sequence.map((point) => `<article class="card no-break"><div class="label">${escapeHtml(point.label)}</div>${point.label === 'Current baseline' ? `<div class="score-med">${escapeHtml(displayScore(currentScore, 'AVAILABLE'))}</div>` : ''}<p style="margin-top:${point.label === 'Current baseline' ? '8px' : '0'};">${escapeHtml(point.detail)}</p></article>`).join('')}</div><div class="pending-note" style="margin-top:10px;">We only show numeric values here when they come directly from the report payload. Forward-looking stages stay narrative until there is measured progress.</div></div>`;
}

export function getStrategicStrengthCards(payload: PdfReportPayload): Array<{ label: string; value: string; tone: 'strong' | 'developing' | 'constraint' | 'unknown' }> {
  const positionValue = safeText(payload.companyContext?.marketPosition || payload.companyContext?.marketPositionStatement, 1);
  const growthValue = safeText(payload.unifiedIntelligenceSummary?.growthDirection.shortTermFocus, 1);
  const riskValue = safeText(payload.companyContext?.executionRisk, 1);
  const positioningValue = safeText(payload.companyContext?.positioningStrength || payload.companyContext?.positioningGap, 1);

  const inferTone = (value: string, options?: { inverse?: boolean }): 'strong' | 'developing' | 'constraint' | 'unknown' => {
    if (!value) return 'unknown';
    const normalized = value.toLowerCase();
    if (/(ahead|strong|clear|advantaged|leading)/i.test(normalized)) {
      return options?.inverse ? 'constraint' : 'strong';
    }
    if (/(parity|moderate|developing|emerging|improving)/i.test(normalized)) {
      return 'developing';
    }
    if (/(below|weak|risk|fragile|constrained|lagging|unclear)/i.test(normalized)) {
      return options?.inverse ? 'strong' : 'constraint';
    }
    return 'developing';
  };

  return [
    { label: 'Position', value: positionValue, tone: inferTone(positionValue) },
    { label: 'Growth', value: growthValue, tone: inferTone(growthValue) },
    { label: 'Risk', value: riskValue, tone: inferTone(riskValue, { inverse: true }) },
    { label: 'Positioning', value: positioningValue, tone: inferTone(positioningValue) },
  ];
}

export function renderSectionOverview(
  payload: PdfReportPayload,
  vars: Record<string, string>,
  sectionStatuses: Record<string, SnapshotSectionStatus>,
  keywordGapEligible: boolean,
): string {
  const strengths = getStrategicStrengthCards(payload);
  const overallScore = getOverallScore(payload);
  const rawProgressItems = [
    { label: 'Overall Snapshot', score: overallScore },
    { label: 'Unified', score: payload.unifiedIntelligenceSummary?.unifiedScore ?? null },
    { label: 'SEO', score: payload.seoExecutiveSummary?.overallHealthScore ?? null },
    { label: 'AI Visibility', score: hasRealAiVisibilityData(payload) ? (payload.geoAeoExecutiveSummary?.overallAiVisibilityScore ?? null) : null },
    { label: 'Authority', score: payload.seoVisuals?.seoCapabilityRadar.backlinks_score ?? null },
  ];
  const seenProgressScores = new Set<string>();
  const progressItems = rawProgressItems.filter((item) => {
    if (item.score == null) return true;
    const key = `${Math.round(item.score)}`;
    if (seenProgressScores.has(key)) return false;
    seenProgressScores.add(key);
    return true;
  });
  const brandContextLines = [
    safeText(payload.companyContext?.tagline || payload.companyContext?.homepageHeadline, 1),
    safeText(payload.companyContext?.primaryOffering, 1),
    safeText(payload.companyContext?.marketNarrative, 1),
    safeText(payload.companyContext?.strategyAlignment, 1),
  ].filter(Boolean);
  const seoSummaryCards = [
    payload.seoVisuals?.seoCapabilityRadar.technical_seo_score != null ? `Technical SEO ${displayScore(payload.seoVisuals.seoCapabilityRadar.technical_seo_score, 'AVAILABLE')}` : '',
    payload.seoVisuals?.seoCapabilityRadar.content_quality_score != null ? `Content Depth ${displayScore(payload.seoVisuals.seoCapabilityRadar.content_quality_score, 'AVAILABLE')}` : '',
    payload.seoVisuals?.seoCapabilityRadar.keyword_research_score != null ? `Keyword Research ${displayScore(payload.seoVisuals.seoCapabilityRadar.keyword_research_score, 'AVAILABLE')}` : 'Keyword Research pending',
    payload.seoVisuals?.seoCapabilityRadar.rank_tracking_score != null ? `Rank Tracking ${displayScore(payload.seoVisuals.seoCapabilityRadar.rank_tracking_score, 'AVAILABLE')}` : 'Rank Tracking pending',
  ].filter(Boolean);
  const keywordGapSummary = payload.competitorVisuals?.keywordGapAnalysis;
  const unifiedNarrative = safeText(
    payload.unifiedIntelligenceSummary?.marketContextSummary
    || payload.unifiedIntelligenceSummary?.primaryConstraint.reasoning,
    2,
  );
  const growthDirection = [
    safeText(payload.unifiedIntelligenceSummary?.growthDirection.shortTermFocus, 1),
    safeText(payload.unifiedIntelligenceSummary?.growthDirection.longTermFocus, 1),
  ].filter(Boolean);
  const decisionTimeline = payload.decisionSnapshot
    ? [
        safeText(payload.decisionSnapshot.whenToExpectImpact.shortTerm, 1),
        safeText(payload.decisionSnapshot.whenToExpectImpact.midTerm, 1),
        safeText(payload.decisionSnapshot.whenToExpectImpact.longTerm, 1),
      ].filter(Boolean)
    : [];
  const executionSequence = (payload.decisionSnapshot?.executionSequence ?? [])
    .map((step) => safeText(step, 1))
    .filter(Boolean)
    .slice(0, 3);

  const brandContextCard = `<article class="card no-break"><h3>Brand Context</h3>${brandContextLines.length ? brandContextLines.map((line) => `<p>${escapeHtml(line)}</p>`).join('') : renderFillQuote('Brand Context', 'Stronger company context here will make future recommendations read less inferred and more market-specific.')}</article>`;
  const unifiedDirectionCard = unifiedNarrative || growthDirection.length
    ? `<article class="card no-break"><h3>Unified Direction</h3>${unifiedNarrative ? `<p>${escapeHtml(unifiedNarrative)}</p>` : ''}${growthDirection.length ? growthDirection.map((line) => `<p>${escapeHtml(line)}</p>`).join('') : ''}</article>`
    : '';
  const executionTimelineCard = executionSequence.length || decisionTimeline.length
    ? `<article class="card no-break"><h3>Execution Timeline</h3>${executionSequence.length ? `<div class="label">Sequence</div>${executionSequence.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}` : ''}${decisionTimeline.length ? `<div class="label" style="margin-top:10px;">Expected Impact</div>${decisionTimeline.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}` : ''}</article>`
    : '';

  const scoreBreakdownCard = `<article class="card no-break"><h3>Current Score Breakdown</h3>${progressItems.map((item) => `<div style="margin-bottom:10px;"><div class="label">${escapeHtml(item.label)}</div><div class="${item.score == null ? 'score-missing' : 'score-med'}">${escapeHtml(displayScore(item.score, item.score == null ? 'MISSING' : 'AVAILABLE'))}</div><div class="bar-track"><div class="bar-fill ${item.score != null && item.score < 30 ? 'bar-fill-red' : item.score != null && item.score < 50 ? 'bar-fill-amber' : 'bar-fill-green'}" style="width:${item.score == null ? 0 : clampPercent(item.score)}%"></div></div></div>`).join('')}</article>`;
  const seoReadinessCard = `<article class="card no-break"><h3>SEO Readiness</h3>${seoSummaryCards.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}${sectionStatuses['section-5'] === 'complete' ? '<div class="pending-note">Full SEO section is expanded below on this page.</div>' : '<div class="pending-note">This summary stays visible even when deeper SEO data is still partial.</div>'}</article>`;
  const keywordGapCard = keywordGapEligible && sectionStatuses['section-4'] !== 'complete' && keywordGapSummary
    ? `<article class="card no-break"><h3>Keyword Gap Analysis</h3>${keywordGapSummary.missing_keywords.length ? `<p><strong>Missing:</strong> ${escapeHtml(keywordGapSummary.missing_keywords.slice(0, 4).join(', '))}</p>` : ''}${keywordGapSummary.weak_keywords.length ? `<p><strong>Weak:</strong> ${escapeHtml(keywordGapSummary.weak_keywords.slice(0, 4).join(', '))}</p>` : ''}${keywordGapSummary.strong_keywords.length ? `<p><strong>Strong:</strong> ${escapeHtml(keywordGapSummary.strong_keywords.slice(0, 4).join(', '))}</p>` : ''}</article>`
    : '';

  const headingSubsection = renderSubsection(
    `${sectionHeaderBar(vars.company_name, vars.report_date, { logoUrl: vars.company_logo_url, faviconUrl: vars.company_favicon_url })}<div class="label">Brand &amp; Score Context</div><h2>Brand Context And Current Score Breakdown</h2>`,
  );
  const brandColumnSubsection = renderSubsection(
    `<div class="grid-2"><div class="stack-12">${brandContextCard}</div><div class="stack-12">${scoreBreakdownCard}</div></div>`,
  );
  const supportingSubsections = [unifiedDirectionCard, executionTimelineCard, seoReadinessCard, keywordGapCard]
    .filter(Boolean)
    .map((card) => renderSubsection(card))
    .join('');

  return `<div class="report-section" id="overview-section">${headingSubsection}${brandColumnSubsection}${supportingSubsections}</div>`;
}

export function renderSection3PerformanceScores(payload: PdfReportPayload, vars: Record<string, string>): string {
  const visuals = payload.seoVisuals;
  const geo = payload.geoAeoExecutiveSummary;
  const aiReady = hasRealAiVisibilityData(payload);
  const dimensions = [
    ['content_quality', 'Content Quality', visuals?.seoCapabilityRadar.content_quality_score ?? null, toUpperStrength(visuals?.seoCapabilityRadar.data_source_strength?.content_quality_score), 'Measures whether core pages answer buyer questions with enough depth.'],
    ['publishing_frequency', 'Publishing Frequency', null, 'MISSING', 'Shows whether publishing depth is strong enough to sustain momentum.'],
    ['reach', 'Reach', visuals?.searchVisibilityFunnel.impressions ?? null, (visuals?.searchVisibilityFunnel.impressions ?? 0) > 0 ? 'AVAILABLE' : 'MISSING', 'Captures current search reach from available signals.'],
    ['engagement', 'Engagement', visuals?.searchVisibilityFunnel.ctr != null ? Math.round((visuals.searchVisibilityFunnel.ctr ?? 0) * 100) : null, visuals?.searchVisibilityFunnel.ctr != null ? 'AVAILABLE' : 'MISSING', 'Reflects whether impressions are converting into visits.'],
    ['authority', 'Authority', visuals?.seoCapabilityRadar.backlinks_score ?? null, toUpperStrength(visuals?.seoCapabilityRadar.data_source_strength?.backlinks_score), 'Indicates how established the domain appears relative to the market.'],
    ['conversion', 'Conversion', null, 'MISSING', 'Represents how clearly high-intent pages guide a buyer toward action.'],
    ['coverage', 'Coverage', visuals?.opportunityCoverageMatrix.opportunities?.length ? Math.round(visuals.opportunityCoverageMatrix.opportunities.reduce((sum, item) => sum + Number(item.coverage_score ?? 0), 0) / visuals.opportunityCoverageMatrix.opportunities.length) : null, visuals?.opportunityCoverageMatrix.opportunities?.length ? 'AVAILABLE' : 'MISSING', 'Shows how much of the demand landscape the report can measure.'],
    ['platforms', 'Platforms', null, 'MISSING', 'Platform strength needs wider distribution data to score accurately.'],
    ['aeo_readiness', 'AEO Readiness', aiReady ? (geo?.overallAiVisibilityScore ?? null) : null, aiReady ? 'AVAILABLE' : 'MISSING', 'Shows how ready the site is for answer engines and AI discovery.'],
  ] as const;
  const dimensionCards = dimensions.map((item) => {
    const metricView = getPerformanceMetricView({ metric: item[0], score: item[2], dataStrength: item[3], note: item[4], payload });
    const shown = metricView.displayValue;
    const barClass = metricView.shownScore == null ? '' : Number(metricView.shownScore) >= 50 ? 'bar-fill-green' : Number(metricView.shownScore) >= 30 ? 'bar-fill-amber' : 'bar-fill-red';
    const valueClass = `${metricView.shownScore != null || metricView.isConfigured ? 'score-med' : 'score-missing'} score-tone-${metricView.tone}`;
    return `<div class="card no-break"><div class="label">${escapeHtml(item[1])}</div><div class="${valueClass}">${escapeHtml(shown)}</div><div class="bar-track"><div class="bar-fill ${barClass}" style="width:${metricView.shownScore == null ? 0 : clampPercent(metricView.shownScore)}%"></div></div><div class="label" style="margin-top:8px;">${escapeHtml(metricView.statusLabel)}</div><div style="font-size:11px;color:#6B7280;margin-top:4px;">${escapeHtml(metricView.note)}</div></div>`;
  });

  // Group cards into 3-card row subsections. Cards inside the row are
  // individually no-break, but the row itself flows freely so a page
  // can fill with as many cards as fit; only the overflow card moves
  // to the next page instead of dragging its row-mates with it.
  const rowSubsections: string[] = [];
  for (let i = 0; i < dimensionCards.length; i += 3) {
    const row = dimensionCards.slice(i, i + 3).join('');
    rowSubsections.push(renderSubsection(`<div class="grid-3">${row}</div>`));
  }

  const headingMarkup = `${sectionHeaderBar(vars.company_name, vars.report_date, { logoUrl: vars.company_logo_url, faviconUrl: vars.company_favicon_url })}<div class="label">Performance Scores</div><h2>Performance Scores</h2><p style="margin-bottom:12px;">The framework below stays visible so the report shows the full operating model. Numbers appear only when the underlying signal is strong enough to defend.</p>`;
  return `<div class="report-section" id="section-3">${renderSubsection(headingMarkup)}${rowSubsections.join('')}</div>`;
}

export function renderSectionScoreDrivers(payload: PdfReportPayload, vars: Record<string, string>): string {
  const scoreExplanation = payload.scoreExplanation;
  if (!scoreExplanation) {
    return `<div class="report-section" id="section-score-drivers">${sectionHeaderBar(vars.company_name, vars.report_date, { logoUrl: vars.company_logo_url, faviconUrl: vars.company_favicon_url })}<div class="label">Score Drivers</div><h2>Score Drivers</h2><div class="card-pending no-break">Score-driver breakdown becomes available once enough scoring evidence is connected to explain what is lifting the score, what is constraining it, and what should improve next.</div></div>`;
  }

  const dimensionCards = (scoreExplanation.dimensions ?? [])
    .map((dimension) => {
      const value = Number(dimension.value ?? 0);
      const barClass = value >= 75 ? 'bar-fill-green' : value >= 45 ? 'bar-fill-amber' : 'bar-fill-red';
      return `<article class="card no-break"><div class="label">${escapeHtml(dimension.label)}</div><div class="score-med">${escapeHtml(displayScore(value, 'AVAILABLE'))}</div><div class="bar-track"><div class="bar-fill ${barClass}" style="width:${clampPercent(value)}%"></div></div><p style="margin-top:8px;">${escapeHtml(dimension.explanation)}</p></article>`;
    })
    .join('');

  const weakestDimensionBadges = scoreExplanation.weakestDimensions?.length
    ? `<div class="tags" style="margin-top:10px;">${scoreExplanation.weakestDimensions
      .map((dimension) => `<span class="badge badge-amber">${escapeHtml(`${dimension.label} ${displayScore(dimension.value, 'AVAILABLE')}`)}</span>`)
      .join('')}</div>`
    : '';

  const limitingFactors = scoreExplanation.limitingFactors?.length
    ? `<div class="stack-10" style="margin-top:10px;">${scoreExplanation.limitingFactors
      .slice(0, 4)
      .map((factor) => `<div class="card card-compact card-accent-amber">${escapeHtml(factor)}</div>`)
      .join('')}</div>`
    : '<div class="pending-note" style="margin-top:10px;">The system has not isolated explicit limiting factors yet.</div>';

  const growthPath = scoreExplanation.growthPath;
  const nextLevelLine = growthPath?.nextLevel
    ? `<p><strong>Next level:</strong> ${escapeHtml(growthPath.nextLevel)}</p>`
    : '';
  const growthFocus = growthPath?.focus?.length
    ? `<div class="stack-10" style="margin-top:10px;">${growthPath.focus
      .slice(0, 4)
      .map((item) => `<div class="card card-compact card-accent-green">${escapeHtml(item)}</div>`)
      .join('')}</div>`
    : '<div class="pending-note" style="margin-top:10px;">The next growth focus will appear once score leverage is clearer.</div>';

  const bestImprovement = growthPath?.projectedScoreImprovements?.[0];
  const improvementHint = bestImprovement
    ? `<div class="card card-compact no-break" style="margin-top:10px;"><div class="label">Fastest Improvement Lever</div><p><strong>${escapeHtml(bestImprovement.dimension.replace(/_/g, ' '))}</strong> is the clearest dimension to move next based on the current score model.</p></div>`
    : '';

  const headingMarkup = `${sectionHeaderBar(vars.company_name, vars.report_date, { logoUrl: vars.company_logo_url, faviconUrl: vars.company_favicon_url })}<div class="label">Score Drivers</div><h2>What Is Driving The Score</h2><p style="margin-bottom:12px;">This section keeps the most useful part of the deeper scoring model: which dimensions are strongest, which ones are dragging the score down, and where the next lift is most likely to come from.</p>`;

  // Dimension cards: each row of 2 cards is its own subsection. Cards
  // are individually no-break but the row flows so the page fills with
  // whatever fits and only the overflow card pushes to the next page.
  const dimensionRowMarkup = (() => {
    const cards = (scoreExplanation.dimensions ?? []).map((dimension) => {
      const value = Number(dimension.value ?? 0);
      const barClass = value >= 75 ? 'bar-fill-green' : value >= 45 ? 'bar-fill-amber' : 'bar-fill-red';
      return `<article class="card no-break"><div class="label">${escapeHtml(dimension.label)}</div><div class="score-med">${escapeHtml(displayScore(value, 'AVAILABLE'))}</div><div class="bar-track"><div class="bar-fill ${barClass}" style="width:${clampPercent(value)}%"></div></div><p style="margin-top:8px;">${escapeHtml(dimension.explanation)}</p></article>`;
    });
    if (!cards.length) {
      return renderSubsection('<div class="card no-break"><h3>Dimension Breakdown</h3><div class="pending-note" style="margin-top:10px;">Dimension-level scoring detail is still being assembled.</div></div>');
    }
    const headingPair = renderSubsection(`<h3>Dimension Breakdown</h3><div class="grid-2" style="margin-top:8px;">${cards.slice(0, 2).join('')}</div>`);
    const remainingPairs: string[] = [];
    for (let i = 2; i < cards.length; i += 2) {
      remainingPairs.push(renderSubsection(`<div class="grid-2" style="margin-top:12px;">${cards.slice(i, i + 2).join('')}</div>`));
    }
    return `${headingPair}${remainingPairs.join('')}`;
  })();

  const limitingSubsection = renderSubsection(`<article class="card no-break"><h3>What Is Limiting The Score</h3><p>The weakest dimensions are the main reason the overall score is not compounding faster yet.</p>${weakestDimensionBadges}${limitingFactors}</article>`);
  const growthSubsection = renderSubsection(`<article class="card no-break"><h3>Growth Path</h3><p><strong>Current level:</strong> ${escapeHtml(growthPath?.currentLevel || 'Early-stage')}</p>${nextLevelLine}${growthFocus}</article>`);
  const improveSubsection = renderSubsection(`<article class="card no-break"><h3>What To Improve Next</h3><p>The report only brings forward non-speculative improvement direction here, so this stays useful without inventing future scores.</p>${improvementHint || '<div class="pending-note" style="margin-top:10px;">The next score lever is still being inferred from the current evidence stack.</div>'}</article>`);

  return `<div class="report-section" id="section-score-drivers">${renderSubsection(headingMarkup)}${dimensionRowMarkup}${limitingSubsection}${growthSubsection}${improveSubsection}</div>`;
}

export function renderSection4CompetitorIntelligence(payload: PdfReportPayload, vars: Record<string, string>, competitorEligible: boolean, keywordGapEligible: boolean): string {
  const competitorContext = payload.competitorContext;
  const competitor = payload.competitorIntelligenceSummary;
  const visuals = payload.competitorVisuals;
  const radar = visuals?.competitorPositioningRadar;
  const contextCompetitors = (competitorContext?.competitors ?? []).filter(hasFinalCompetitorProof);
  const strongestGap = competitorContext?.strongestGaps?.[0];
  const hasCompetitorContext = Boolean(
    safeText(competitorContext?.summary, 2)
    || contextCompetitors.length > 0
    || strongestGap,
  );
  const hasReportCompetitorStrategy = Boolean(
    payload.competitiveSnapshot?.competitors?.length
    || payload.competitivePressureAnalysis?.competitors?.length
    || payload.competitiveStrategyMap
    || payload.strategicPosition,
  );

  if (!hasReportCompetitorStrategy && (contextCompetitors.length === 0 || (!hasCompetitorContext && (!radar || !competitorEligible || !visuals)))) {
    return `<div class="report-section" id="section-4">${sectionHeaderBar(vars.company_name, vars.report_date, { logoUrl: vars.company_logo_url, faviconUrl: vars.company_favicon_url })}<div class="label">Competitive Landscape</div><h2>Competitive Landscape</h2><div class="card-pending no-break">No competitor data available yet. Add competitor domains or competitor profile context to unlock this section.</div></div>`;
  }

  const summaryText = safeText(
    competitorContext?.summary
    || strongestGap?.whyItMatters
    || competitor?.primaryGap.reasoning,
    2,
  );

  const radarByName = new Map(
    (radar?.competitors ?? []).map((item) => [normalizeNameKey(item.name), item]),
  );

  const unifiedCompetitors = new Map<string, {
    name: string;
    domain: string | null;
    classification: string;
    source: string;
    relevanceScore: number | null;
    category?: string | null;
    tags?: string[];
    tier?: 'Tier 1' | 'Tier 2' | 'Tier 3' | null;
    finalScore?: number | null;
    authorityScore?: number | null;
    positioning?: {
      strengths_vs_company: string[];
      weaknesses_vs_company: string[];
      differentiation: string;
      threat_level: 'low' | 'medium' | 'high';
    } | null;
    rationale: string;
    standing: 'Behind' | 'At Par' | 'Ahead';
    radarItem: typeof radar extends { competitors: Array<infer T> } ? T | null : null;
  }>();

  for (const item of contextCompetitors) {
    unifiedCompetitors.set(normalizeNameKey(item.name), {
      name: item.name,
      domain: item.domain,
      classification: item.classification,
      source: item.source,
      relevanceScore: Number.isFinite(item.relevanceScore) ? item.relevanceScore : null,
      category: item.category ?? null,
      tags: item.tags ?? [],
      tier: item.tier ?? null,
      finalScore: Number.isFinite(item.finalScore) ? item.finalScore : null,
      authorityScore: Number.isFinite(item.authorityScore) ? item.authorityScore : null,
      positioning: item.positioning ?? null,
      rationale: item.positioning?.differentiation ?? item.rationale,
      standing: item.standing,
      radarItem: radarByName.get(normalizeNameKey(item.name)) ?? null,
    });
  }

  const competitorRows = [...unifiedCompetitors.values()]
    .sort((a, b) => {
      const tierOrder = { 'Tier 1': 1, 'Tier 2': 2, 'Tier 3': 3 } as const;
      const aTier = a.tier ? tierOrder[a.tier] : 4;
      const bTier = b.tier ? tierOrder[b.tier] : 4;
      if (aTier !== bTier) return aTier - bTier;
      const aScore = a.relevanceScore ?? -1;
      const bScore = b.relevanceScore ?? -1;
      if (bScore !== aScore) return bScore - aScore;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 5);

  const tierLabels = {
    'Tier 1': 'Tier 1 - Direct competitors',
    'Tier 2': 'Tier 2 - Functional competitors',
    'Tier 3': 'Tier 3 - Substitute competitors',
  } as const;
  const groupedCompetitorCards = (['Tier 1', 'Tier 2', 'Tier 3'] as const)
    .map((tier) => {
      const rows = competitorRows.filter((item) => item.tier === tier);
      if (!rows.length) return '';
      return `<div class="card no-break" style="margin-top:12px;"><div class="label">${escapeHtml(tierLabels[tier])}</div><div class="grid-3" style="margin-top:10px;">${rows.map((item) => `<article class="card card-compact"><div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;"><h3 style="margin:0;">${escapeHtml(item.name)}</h3><span class="badge badge-blue">${escapeHtml(item.category ?? getCompetitorBadgeLabel(item.classification, item.source))}</span><span class="badge badge-gray">${escapeHtml(item.tags?.join(', ') || 'untagged')}</span></div>${item.finalScore != null ? `<div class="label" style="margin-top:8px;">Final score ${escapeHtml(item.finalScore.toFixed(2))}${item.authorityScore != null ? ` - Authority ${escapeHtml(item.authorityScore.toFixed(2))}` : ''}</div>` : ''}<p style="margin-top:8px;">${escapeHtml(item.rationale)}</p></article>`).join('')}</div></div>`;
    })
    .join('');

  const positioningSummary = competitorContext?.competitiveSummary
    ? `<div class="card no-break" style="margin-top:12px;"><div class="label">Competitive Positioning</div><h3>${escapeHtml(competitorContext.competitiveSummary.topThreats?.join(' and ') || 'Top threats')}</h3><p>${escapeHtml(competitorContext.competitiveSummary.positioningStatement || competitorContext.summary)}</p><div class="grid-2" style="margin-top:10px;"><div><div class="label">Key Advantage</div><p>${escapeHtml(competitorContext.competitiveSummary.keyAdvantage || 'Focused positioning is the strongest defensible advantage.')}</p></div><div><div class="label">Key Risk</div><p>${escapeHtml(competitorContext.competitiveSummary.keyRisk || 'Competitors may still lead on authority and reach.')}</p></div></div></div>`
    : '';

  const snapshotCards = payload.competitiveSnapshot
    ? `<div class="card no-break" style="margin-top:12px;"><div class="label">Competitive Snapshot Summary</div><h3>${escapeHtml(payload.competitiveSnapshot.summary.topThreat)}</h3><p>${escapeHtml(payload.competitiveSnapshot.summary.immediatePositioningAngle)}</p><p style="margin-top:8px;"><strong>Action:</strong> ${escapeHtml(payload.competitiveSnapshot.summary.action)}</p></div><div class="grid-3" style="margin-top:12px;">${payload.competitiveSnapshot.competitors.slice(0, 3).map((item) => `<article class="card card-compact"><div class="label">${escapeHtml(item.tier)}</div><h3>${escapeHtml(item.name)}</h3><div class="tags" style="margin-top:6px;"><span class="badge ${item.threatLevel === 'high' ? 'badge-red' : item.threatLevel === 'medium' ? 'badge-amber' : 'badge-green'}">${escapeHtml(item.threatLevel)} threat</span></div><p style="margin-top:8px;">${escapeHtml(item.differentiation)}</p></article>`).join('')}</div>`
    : '';

  const pressureCards = payload.competitivePressureAnalysis
    ? `<div class="card no-break" style="margin-top:12px;"><div class="label">Competitive Pressure Analysis</div><h3>${escapeHtml(payload.competitivePressureAnalysis.summary.highestPressure)}</h3><p>${escapeHtml(payload.competitivePressureAnalysis.summary.primaryRisk)}</p><p style="margin-top:8px;"><strong>Next action:</strong> ${escapeHtml(payload.competitivePressureAnalysis.summary.nextAction)}</p></div><div class="grid-3" style="margin-top:12px;">${payload.competitivePressureAnalysis.competitors.slice(0, 5).map((item) => `<article class="card card-compact"><div class="label">${escapeHtml(item.tier)} - Authority ${escapeHtml(item.authorityScore.toFixed(2))}</div><h3>${escapeHtml(item.name)}</h3><div class="tags" style="margin-top:6px;"><span class="badge ${item.threatLevel === 'high' ? 'badge-red' : item.threatLevel === 'medium' ? 'badge-amber' : 'badge-green'}">${escapeHtml(item.threatLevel)} threat</span>${item.pressureOn.map((area) => `<span class="badge badge-blue">${escapeHtml(area)}</span>`).join('')}</div><p style="margin-top:8px;">${escapeHtml(item.action)}</p></article>`).join('')}</div>`
    : '';

  const strategyCards = payload.competitiveStrategyMap && payload.strategicPosition
    ? (() => {
      const tierBlock = (label: string, items: Array<{ name: string; threatLevel: 'low' | 'medium' | 'high'; differentiation: string }>) =>
        `<article class="card card-compact"><div class="label">${escapeHtml(label)}</div>${items.length ? items.map((item) => `<div style="margin-top:8px;"><strong>${escapeHtml(item.name)}</strong> <span class="badge ${item.threatLevel === 'high' ? 'badge-red' : item.threatLevel === 'medium' ? 'badge-amber' : 'badge-green'}">${escapeHtml(item.threatLevel)} threat</span><p style="margin-top:4px;">${escapeHtml(item.differentiation)}</p></div>`).join('') : '<p>No final-gated competitors in this tier.</p>'}</article>`;
      const opportunities = [
        ...payload.competitiveStrategyMap.opportunityMap.whitespaceOpportunities,
        ...payload.competitiveStrategyMap.opportunityMap.underexploitedIcpSegments,
        ...payload.competitiveStrategyMap.opportunityMap.weakCompetitorAreas,
      ].slice(0, 6);
      return `<div class="card no-break" style="margin-top:12px;"><div class="label">Your Strategic Position</div><h3>${escapeHtml(payload.strategicPosition.primaryBattlefield)}</h3><p>${escapeHtml(payload.strategicPosition.positioningStatement)}</p><div class="grid-2" style="margin-top:10px;"><div><div class="label">Avoidance Zone</div><p>${escapeHtml(payload.strategicPosition.avoidanceZone)}</p></div><div><div class="label">Messaging Angle</div><p>${escapeHtml(payload.strategicPosition.messagingAngle)}</p></div></div></div><div class="grid-3" style="margin-top:12px;">${tierBlock('Tier 1 - Direct competitors', payload.competitiveStrategyMap.tierBreakdown.tier1)}${tierBlock('Tier 2 - Alternatives', payload.competitiveStrategyMap.tierBreakdown.tier2)}${tierBlock('Tier 3 - Substitutes', payload.competitiveStrategyMap.tierBreakdown.tier3)}</div><div class="card no-break" style="margin-top:12px;"><div class="label">Opportunity Map</div>${opportunities.length ? `<ul>${opportunities.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p>No opportunity map is available yet.</p>'}</div><div class="grid-3" style="margin-top:12px;"><article class="card card-compact"><h3>How to beat Tier 1</h3><p>${escapeHtml(payload.competitiveStrategyMap.strategicActions.howToBeatTier1)}</p></article><article class="card card-compact"><h3>How to differentiate from Tier 2</h3><p>${escapeHtml(payload.competitiveStrategyMap.strategicActions.howToDifferentiateFromTier2)}</p></article><article class="card card-compact"><h3>How to ignore Tier 3</h3><p>${escapeHtml(payload.competitiveStrategyMap.strategicActions.howToIgnoreTier3)}</p></article></div>`;
    })()
    : '';

  const contextCards = payload.reportType === 'snapshot'
    ? snapshotCards || (competitorRows.length ? `${positioningSummary}${groupedCompetitorCards}` : '')
    : payload.reportType === 'performance'
      ? pressureCards || (competitorRows.length ? `${positioningSummary}${groupedCompetitorCards}` : '')
      : payload.reportType === 'growth'
        ? strategyCards || (competitorRows.length ? `${positioningSummary}${groupedCompetitorCards}` : '')
        : competitorRows.length ? `${positioningSummary}${groupedCompetitorCards}` : '';

  const marketAlternativeRows = (competitorContext?.marketAlternatives ?? []).slice(0, 3);
  const marketAlternativeCards = marketAlternativeRows.length
    ? `<div class="card no-break" style="margin-top:12px;"><div class="label">Market Alternatives</div><h3>Other ways buyers solve this problem</h3><p>These are not direct competitors. They show adjacent solution paths worth watching for positioning and messaging.</p><div class="grid-3" style="margin-top:12px;">${marketAlternativeRows.map((item) => `<article class="card card-compact"><div class="label">${escapeHtml(item.tier ?? 'Alternative')}</div><h3>${escapeHtml(item.name)}</h3><div class="tags" style="margin-top:6px;"><span class="badge badge-blue">${escapeHtml(item.category ?? 'market alternative')}</span><span class="badge badge-gray">Score ${escapeHtml(item.finalScore.toFixed(2))}</span></div><p style="margin-top:8px;">${escapeHtml(item.rationale)}</p>${item.useCase ? `<p style="margin-top:6px;"><strong>Use case:</strong> ${escapeHtml(item.useCase)}</p>` : ''}</article>`).join('')}</div></div>`
    : '';

  const competitorMatrix = competitorRows.length
    ? `<div class="card no-break" style="margin-top:12px;"><h3>Competitor Comparison Matrix</h3><p>This matrix shows who shapes the market, what kind of business they represent, and where their pressure is strongest against ${escapeHtml(vars.company_name)}.</p><table class="competition-matrix"><thead><tr><th>Competitor</th><th>Nature</th><th>Standing</th><th>Market</th><th>Features</th><th>Authority</th><th>Technical</th><th>AI</th><th>Pricing</th></tr></thead><tbody>${competitorRows.map((item) => {
        const radarItem = item.radarItem;
        const marketInfluence = getInfluenceLabel(
          radarItem?.keyword_coverage_score ?? item.relevanceScore ?? null,
        );
        const featureInfluence = getInfluenceLabel(radarItem?.content_score ?? null);
        const authorityInfluence = getInfluenceLabel(radarItem?.authority_score ?? null);
        const technicalInfluence = getInfluenceLabel(radarItem?.technical_score ?? null);
        const answerInfluence = getInfluenceLabel(radarItem?.ai_answer_presence_score ?? null);
        const businessType = getCompetitorBadgeLabel(item.classification, item.source);
        // Rationale moves to its own full-width row so badges in other
        // columns are not pushed up by a tall first cell.
        const detailRow = item.rationale
          ? `<tr class="competition-matrix-detail"><td colspan="9">${escapeHtml(item.rationale)}</td></tr>`
          : '';
        return `<tr>
          <td><div class="competition-matrix-name">${escapeHtml(item.name)}</div>${item.domain ? `<div class="competition-matrix-sub">${escapeHtml(item.domain)}</div>` : ''}</td>
          <td><div class="competition-chip-row"><span class="badge badge-blue">${escapeHtml(businessType)}</span></div></td>
          <td><div class="competition-chip-row"><span class="badge ${getCompetitorStandingTone(item.standing)}">${escapeHtml(getCompetitorStandingLabel(item.standing))}</span></div></td>
          <td><div class="competition-chip-row"><span class="badge ${getInfluenceBadgeClass(marketInfluence)}">${escapeHtml(marketInfluence)}</span></div></td>
          <td><div class="competition-chip-row"><span class="badge ${getInfluenceBadgeClass(featureInfluence)}">${escapeHtml(featureInfluence)}</span></div></td>
          <td><div class="competition-chip-row"><span class="badge ${getInfluenceBadgeClass(authorityInfluence)}">${escapeHtml(authorityInfluence)}</span></div></td>
          <td><div class="competition-chip-row"><span class="badge ${getInfluenceBadgeClass(technicalInfluence)}">${escapeHtml(technicalInfluence)}</span></div></td>
          <td><div class="competition-chip-row"><span class="badge ${getInfluenceBadgeClass(answerInfluence)}">${escapeHtml(answerInfluence)}</span></div></td>
          <td><div class="competition-chip-row"><span class="badge badge-gray">Not measured</span></div></td>
        </tr>${detailRow}`;
      }).join('')}</tbody></table></div>`
    : '';

  const influenceCards = competitorRows.length
    ? `<div class="grid-3" style="margin-top:12px;">${competitorRows.slice(0, 3).map((item) => {
        const radarItem = item.radarItem;
        const marketInfluence = getInfluenceLabel(
          radarItem?.keyword_coverage_score ?? item.relevanceScore ?? null,
        );
        const featureInfluence = getInfluenceLabel(radarItem?.content_score ?? null);
        const authorityInfluence = getInfluenceLabel(radarItem?.authority_score ?? null);
        const technicalInfluence = getInfluenceLabel(radarItem?.technical_score ?? null);
        const answerInfluence = getInfluenceLabel(radarItem?.ai_answer_presence_score ?? null);
        return `<article class="card no-break">
          <div class="label">Competitor Pressure</div>
          <h3>${escapeHtml(item.name)}</h3>
          <p>${escapeHtml(`${item.name} creates its strongest pressure through ${getDominantCompetitorPressure(radarItem)} in this snapshot.`)}</p>
          <div class="stack-10" style="margin-top:10px;">
            <div><div class="label">Nature of business</div><div class="tags" style="margin-top:4px;"><span class="badge badge-blue">${escapeHtml(getCompetitorBadgeLabel(item.classification, item.source))}</span></div></div>
            <div><div class="label">Influence mix</div><div class="tags" style="margin-top:4px;"><span class="badge ${getInfluenceBadgeClass(marketInfluence)}">Market ${escapeHtml(marketInfluence)}</span><span class="badge ${getInfluenceBadgeClass(featureInfluence)}">Features ${escapeHtml(featureInfluence)}</span><span class="badge ${getInfluenceBadgeClass(authorityInfluence)}">Authority ${escapeHtml(authorityInfluence)}</span><span class="badge ${getInfluenceBadgeClass(technicalInfluence)}">Technical ${escapeHtml(technicalInfluence)}</span><span class="badge ${getInfluenceBadgeClass(answerInfluence)}">AI ${escapeHtml(answerInfluence)}</span></div></div>
          </div>
        </article>`;
      }).join('')}</div>`
    : '';

  const strongestGapCard = strongestGap
    ? `<div class="card card-accent-amber no-break" style="margin-top:12px;"><div class="label">Strongest Gap</div><h3>${escapeHtml(strongestGap.title)}</h3><p>${escapeHtml(strongestGap.whyItMatters)}</p><div class="tags" style="margin-top:10px;"><span class="badge badge-amber">Impact ${escapeHtml(displayScore(strongestGap.impactScore, 'AVAILABLE'))}</span><span class="badge badge-gray">Confidence ${escapeHtml(displayScore(Math.round((strongestGap.confidenceScore ?? 0) * 100), 'AVAILABLE'))}</span></div>${strongestGap.leadingCompetitors.length ? `<p style="margin-top:10px;"><strong>Led by:</strong> ${escapeHtml(strongestGap.leadingCompetitors.join(', '))}</p>` : ''}</div>`
    : '';

  const radarCard = radar && competitorEligible && visuals
    ? `<div class="card card-accent-blue no-break" style="margin-top:12px;"><h3>Competitor Benchmark</h3>${competitor?.primaryGap.reasoning ? `<p>${escapeHtml(competitor.primaryGap.reasoning)}</p>` : ''}<div style="margin-top:12px;">${visuals.competitorPositioningRadar.competitors.slice(0, 3).map((item) => `<div class="comp-row"><div class="comp-label">${escapeHtml(item.name)}</div><div class="comp-bars"><div class="comp-bar-user" style="width:${clampPercent(item.content_score)}%;"></div><div class="comp-bar-comp" style="width:${clampPercent(item.authority_score)}%;"></div></div><div class="comp-val">C ${escapeHtml(displayScore(item.content_score, 'AVAILABLE'))} / A ${escapeHtml(displayScore(item.authority_score, 'AVAILABLE'))}</div></div>`).join('')}</div></div>`
    : '';

  const keywordGapCard = keywordGapEligible && visuals
    ? `<div class="card card-accent-amber no-break" style="margin-top:12px;"><h3>Keyword Gap Analysis</h3>${visuals.keywordGapAnalysis.missing_keywords.length ? `<p><strong>Missing:</strong> ${escapeHtml(visuals.keywordGapAnalysis.missing_keywords.slice(0, 4).join(', '))}</p>` : ''}${visuals.keywordGapAnalysis.weak_keywords.length ? `<p><strong>Weak:</strong> ${escapeHtml(visuals.keywordGapAnalysis.weak_keywords.slice(0, 4).join(', '))}</p>` : ''}${visuals.keywordGapAnalysis.strong_keywords.length ? `<p><strong>Strong:</strong> ${escapeHtml(visuals.keywordGapAnalysis.strong_keywords.slice(0, 4).join(', '))}</p>` : ''}</div>`
    : '';

  const movementCard = payload.competitorMovementComparison
    ? (() => {
      const competitors = payload.competitorMovementComparison?.competitors?.slice(0, 3) ?? [];
      const movementRows = competitors.map((item) => {
        const currentAverage = Math.round((
          Number(item.current_scores.content_score ?? 0) +
          Number(item.current_scores.keyword_coverage_score ?? 0) +
          Number(item.current_scores.authority_score ?? 0) +
          Number(item.current_scores.technical_score ?? 0) +
          Number(item.current_scores.ai_answer_presence_score ?? 0)
        ) / 5);
        const previousAverage = Math.round((
          Number(item.previous_scores.content_score ?? 0) +
          Number(item.previous_scores.keyword_coverage_score ?? 0) +
          Number(item.previous_scores.authority_score ?? 0) +
          Number(item.previous_scores.technical_score ?? 0) +
          Number(item.previous_scores.ai_answer_presence_score ?? 0)
        ) / 5);
        const delta = currentAverage - previousAverage;
        const deltaClass = delta > 0 ? 'badge-green' : delta < 0 ? 'badge-red' : 'badge-gray';
        return `<article class="card no-break"><div class="label">Competitor movement</div><h3>${escapeHtml(item.domain)}</h3>${renderComparisonBar('Average pressure score', currentAverage, previousAverage, 'Previous snapshot')}<div class="tags" style="margin-top:8px;"><span class="badge ${item.movement === 'improving' ? 'badge-green' : item.movement === 'declining' ? 'badge-red' : 'badge-gray'}">${escapeHtml(item.movement)}</span><span class="badge ${deltaClass}">${escapeHtml(delta > 0 ? `+${delta}` : String(delta))} net change</span></div></article>`;
      }).join('');

      return `<div class="card no-break" style="margin-top:12px;"><div class="label">Competitor Movement</div><h3>How the competitive pressure is shifting</h3><p>${escapeHtml(payload.competitorMovementComparison.summary?.key_movement || 'Movement data is available but the narrative is still limited.')}</p><div class="tags" style="margin-top:10px;"><span class="badge badge-blue">${escapeHtml(payload.competitorMovementComparison.summary?.overall_trend || 'stable')}</span>${payload.competitorMovementComparison.user_vs_competitor_shift?.closest_competitor ? `<span class="badge badge-gray">Closest competitor: ${escapeHtml(payload.competitorMovementComparison.user_vs_competitor_shift.closest_competitor)}</span>` : ''}${payload.competitorMovementComparison.user_vs_competitor_shift?.direction ? `<span class="badge badge-amber">${escapeHtml(payload.competitorMovementComparison.user_vs_competitor_shift.direction.replace(/_/g, ' '))}</span>` : ''}${payload.competitorMovementComparison.user_vs_competitor_shift?.gap_change != null ? `<span class="badge ${payload.competitorMovementComparison.user_vs_competitor_shift.gap_change <= 0 ? 'badge-green' : 'badge-red'}">${escapeHtml(payload.competitorMovementComparison.user_vs_competitor_shift.gap_change <= 0 ? `${payload.competitorMovementComparison.user_vs_competitor_shift.gap_change}` : `+${payload.competitorMovementComparison.user_vs_competitor_shift.gap_change}`)} gap change</span>` : ''}</div>${movementRows ? `<div class="grid-3" style="margin-top:12px;">${movementRows}</div>` : ''}</div>`;
    })()
    : '';

  // Heading + intro live on their own row so the section can start
  // at the bottom of any page without forcing the summary card to
  // wait for the next page.
  const sectionLabel = payload.reportType === 'snapshot'
    ? 'Competitive Snapshot'
    : payload.reportType === 'performance'
      ? 'Competitive Pressure Analysis'
      : payload.reportType === 'growth'
        ? 'Competitive Strategy Map'
        : 'Competitive Landscape';
  const sectionIntro = payload.reportType === 'snapshot'
    ? 'This view keeps the competitor read executive-ready: top threats, their tier, and the immediate positioning angle.'
    : payload.reportType === 'performance'
      ? 'This view diagnoses where competitor authority, product depth, and ICP overlap are creating pressure.'
      : payload.reportType === 'growth'
        ? 'This view turns competitor tiers into whitespace, strategic actions, and the position to own.'
        : `This view shows who is shaping buyer expectations in the market right now, where their pressure is strongest, and how ${vars.company_name} is currently stacking up.`;
  const headingMarkup = `${sectionHeaderBar(vars.company_name, vars.report_date, { logoUrl: vars.company_logo_url, faviconUrl: vars.company_favicon_url })}<div class="label">${escapeHtml(sectionLabel)}</div><h2>${escapeHtml(sectionLabel)}</h2><p style="margin-bottom:12px;">${escapeHtml(sectionIntro)}</p>`;
  const summaryCardMarkup = summaryText
    ? `<div class="card no-break"><h3>How you compare to your market</h3><p>${escapeHtml(summaryText)}</p></div>`
    : '';

  const subsections = [
    renderSubsection(headingMarkup),
    summaryCardMarkup ? renderSubsection(summaryCardMarkup) : '',
    payload.reportType === 'snapshot' || payload.reportType === 'performance' || payload.reportType === 'growth'
      ? ''
      : competitorMatrix ? renderSubsection(competitorMatrix, { flow: true }) : '',
    contextCards ? renderSubsection(contextCards) : '',
    marketAlternativeCards ? renderSubsection(marketAlternativeCards) : '',
    payload.reportType === 'snapshot' || payload.competitivePressureAnalysis || payload.competitiveStrategyMap
      ? ''
      : influenceCards ? renderSubsection(influenceCards) : '',
    strongestGapCard ? renderSubsection(strongestGapCard) : '',
    movementCard ? renderSubsection(movementCard, { flow: true }) : '',
    radarCard ? renderSubsection(radarCard) : '',
    keywordGapCard ? renderSubsection(keywordGapCard) : '',
  ].filter(Boolean);

  return `<div class="report-section" id="section-4">${subsections.join('')}</div>`;
}

