import type { PdfReportPayload } from './reportPdfRenderer';
import type { SnapshotSectionStatus } from './reportHtmlNarrativeFlows';
import { renderGeoAeoFlow, renderSocialPlatformFlow, renderTrajectoryFlow, renderConfidenceFlow, renderNextLevelCtaFlow } from './reportHtmlNarrativeFlows';
import { collectMasterActions, deriveDataSources, inferMasterActionTrack, renderInlineDisclaimer, renderMasterActionCard, scoreMetricCard, toUpperStrength, type DerivedDataSource, type MasterAction } from './reportHtmlActionDataHelpers';
import { sectionHeaderBar } from './html/htmlHelpers';
import { displayScore, formatSignedGap, getStateBadgeClass, getStateBarClass, getStateTone, renderBarSvg, renderBeforeAfter, renderCalloutBox, renderCompactBulletLine, renderComparisonBar, renderExecutiveInsights, renderFillQuote, renderInlineSummary, renderMetricGrid, renderMetricRowCard, renderMiniMetrics, renderNarrativeGroup, renderPagePrintHeader, renderPerformanceScoreRow, renderRadarSvg, renderReportBlock, renderScoreComparison, renderScoreDonut, renderTrendSvg, renderVisualMetricBlock, stripLeadingSectionHeader } from './reportHtmlVisualPrimitives';
import { clampPercent, escapeHtml, getOverallScore, hasContent, hasNonEmptyList, hasRealAiVisibilityData, safeText, stripRepeatedSentences, stripTimelinePrefix } from './reportHtmlCoreUtils';

export type SnapshotSectionSpec = {
  id: string;
  title: string;
  status: SnapshotSectionStatus;
  html: string;
};

function renderSubsection(content: string, options?: { flow?: boolean; tight?: boolean; id?: string }): string {
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
  if (source === 'inferred_keyword_peer') return 'Market benchmark';
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
  const contextCompetitors = competitorContext?.competitors ?? [];
  const strongestGap = competitorContext?.strongestGaps?.[0];
  const hasCompetitorContext = Boolean(
    safeText(competitorContext?.summary, 2)
    || contextCompetitors.length > 0
    || strongestGap,
  );

  if (!hasCompetitorContext && (!radar || !competitorEligible || !visuals)) {
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
      rationale: item.rationale,
      standing: item.standing,
      radarItem: radarByName.get(normalizeNameKey(item.name)) ?? null,
    });
  }

  for (const item of radar?.competitors ?? []) {
    const key = normalizeNameKey(item.name);
    if (unifiedCompetitors.has(key)) continue;
    const allScores = [
      item.keyword_coverage_score,
      item.content_score,
      item.authority_score,
      item.technical_score,
      item.ai_answer_presence_score,
    ].filter((value) => Number.isFinite(value));
    const averageScore = allScores.length
      ? Math.round(allScores.reduce((sum, value) => sum + Number(value), 0) / allScores.length)
      : null;
    unifiedCompetitors.set(key, {
      name: item.name,
      domain: null,
      classification: 'seo_competitor',
      source: 'radar',
      relevanceScore: averageScore,
      rationale: `${item.name} is appearing as a measurable market peer in the current benchmark data.`,
      standing: averageScore != null && averageScore >= 67 ? 'Ahead' : averageScore != null && averageScore >= 34 ? 'At Par' : 'Behind',
      radarItem: item,
    });
  }

  const competitorRows = [...unifiedCompetitors.values()]
    .sort((a, b) => {
      const aScore = a.relevanceScore ?? -1;
      const bScore = b.relevanceScore ?? -1;
      if (bScore !== aScore) return bScore - aScore;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 5);

  const contextCards = competitorRows.length
    ? `<div class="grid-3" style="margin-top:12px;">${competitorRows.slice(0, 3).map((item) => `<article class="card no-break"><div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;"><h3 style="margin:0;">${escapeHtml(item.name)}</h3><span class="badge badge-blue">${escapeHtml(getCompetitorBadgeLabel(item.classification, item.source))}</span><span class="badge ${getCompetitorStandingTone(item.standing)}">${escapeHtml(getCompetitorStandingLabel(item.standing))}</span></div>${item.domain ? `<div class="label" style="margin-top:8px;">${escapeHtml(item.domain)}</div>` : ''}<p style="margin-top:8px;">${escapeHtml(item.rationale)}</p></article>`).join('')}</div>`
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
  const headingMarkup = `${sectionHeaderBar(vars.company_name, vars.report_date, { logoUrl: vars.company_logo_url, faviconUrl: vars.company_favicon_url })}<div class="label">Competitive Landscape</div><h2>Competitive Landscape</h2><p style="margin-bottom:12px;">This view shows who is shaping buyer expectations in the market right now, where their pressure is strongest, and how ${escapeHtml(vars.company_name)} is currently stacking up.</p>`;
  const summaryCardMarkup = summaryText
    ? `<div class="card no-break"><h3>How you compare to your market</h3><p>${escapeHtml(summaryText)}</p></div>`
    : '';

  const subsections = [
    renderSubsection(headingMarkup),
    summaryCardMarkup ? renderSubsection(summaryCardMarkup) : '',
    competitorMatrix ? renderSubsection(competitorMatrix, { flow: true }) : '',
    contextCards ? renderSubsection(contextCards) : '',
    influenceCards ? renderSubsection(influenceCards) : '',
    strongestGapCard ? renderSubsection(strongestGapCard) : '',
    movementCard ? renderSubsection(movementCard, { flow: true }) : '',
    radarCard ? renderSubsection(radarCard) : '',
    keywordGapCard ? renderSubsection(keywordGapCard) : '',
  ].filter(Boolean);

  return `<div class="report-section" id="section-4">${subsections.join('')}</div>`;
}

export function renderSection5SeoDeepdive(payload: PdfReportPayload, vars: Record<string, string>): string {
  const visuals = payload.seoVisuals;
  const strongKeywords = payload.competitorVisuals?.keywordGapAnalysis?.strong_keywords ?? [];
  const gscSource = deriveDataSources(payload).find((item) => item.source === 'gsc');
  const gscDisclaimer = gscSource?.status === 'missing'
    ? renderInlineDisclaimer('missing', 'Keyword and ranking data not connected. Insights are inferred from crawl signals.', 'Missing keyword data')
    : gscSource?.status === 'partial'
      ? renderInlineDisclaimer('partial', 'Insights are directional due to limited keyword and ranking coverage. Full connection will improve accuracy.', 'Partial keyword data')
      : '';
  const subScores = [
    ['Technical SEO', visuals?.seoCapabilityRadar.technical_seo_score ?? null, toUpperStrength(visuals?.seoCapabilityRadar.data_source_strength?.technical_seo_score)],
    ['Keyword Research', visuals?.seoCapabilityRadar.keyword_research_score ?? null, toUpperStrength(visuals?.seoCapabilityRadar.data_source_strength?.keyword_research_score)],
    ['Rank Tracking', visuals?.seoCapabilityRadar.rank_tracking_score ?? null, toUpperStrength(visuals?.seoCapabilityRadar.data_source_strength?.rank_tracking_score)],
    ['Content Depth', visuals?.seoCapabilityRadar.content_quality_score ?? null, toUpperStrength(visuals?.seoCapabilityRadar.data_source_strength?.content_quality_score)],
  ] as const;
  const radarValues = visuals ? [
    { label: 'Technical', value: visuals.seoCapabilityRadar.technical_seo_score ?? 0 },
    { label: 'Research', value: visuals.seoCapabilityRadar.keyword_research_score ?? 0 },
    { label: 'Tracking', value: visuals.seoCapabilityRadar.rank_tracking_score ?? 0 },
    { label: 'Backlinks', value: visuals.seoCapabilityRadar.backlinks_score ?? 0 },
    { label: 'Competitor', value: visuals.seoCapabilityRadar.competitor_intelligence_score ?? 0 },
    { label: 'Content', value: visuals.seoCapabilityRadar.content_quality_score ?? 0 },
  ] : [];
  const radarMetrics = visuals ? [
    renderVisualMetricBlock(
      'Technical SEO',
      visuals.seoCapabilityRadar.technical_seo_score,
      visuals.seoCapabilityRadar.tooltips?.technical_seo_score || 'Technical crawl, rendering, and structure signals.',
    ),
    renderVisualMetricBlock(
      'Content Quality',
      visuals.seoCapabilityRadar.content_quality_score,
      visuals.seoCapabilityRadar.tooltips?.content_quality_score || 'How well current pages answer demand with enough depth.',
    ),
    renderVisualMetricBlock(
      'Competitor Intel',
      visuals.seoCapabilityRadar.competitor_intelligence_score,
      visuals.seoCapabilityRadar.tooltips?.competitor_intelligence_score || 'How clearly the market gap can be benchmarked from available signals.',
    ),
  ].join('') : '';

  const opportunities = visuals?.opportunityCoverageMatrix.opportunities ?? [];
  const topOpportunities = opportunities.slice(0, 4);
  const opportunityVisual = topOpportunities.length
    ? `<div class="grid-2" style="margin-top:12px;">${topOpportunities.map((item) => `<article class="card visual-metric no-break"><div class="label">${escapeHtml(item.priority_bucket ? item.priority_bucket.replace(/_/g, ' ') : 'Opportunity')}</div><h3>${escapeHtml(item.keyword)}</h3><div class="metric-meta" style="margin-bottom:8px;"><span>Opportunity ${escapeHtml(displayScore(item.opportunity_score, 'AVAILABLE'))}</span><span>Coverage ${escapeHtml(displayScore(item.coverage_score, 'AVAILABLE'))}</span></div>${renderComparisonBar('Coverage vs opportunity', item.coverage_score, item.opportunity_score, 'Opportunity score')}${typeof item.opportunity_value_score === 'number' ? `<div class="tags" style="margin-top:8px;"><span class="badge badge-blue">Value ${escapeHtml(displayScore(item.opportunity_value_score, 'AVAILABLE'))}</span><span class="badge badge-gray">${escapeHtml(item.confidence.toUpperCase())} confidence</span></div>` : `<div class="tags" style="margin-top:8px;"><span class="badge badge-gray">${escapeHtml(item.confidence.toUpperCase())} confidence</span></div>`}</article>`).join('')}</div>`
    : '<div class="card-pending no-break">Keyword opportunity mapping is still warming up. As tracked themes and queries deepen, this matrix will show where coverage is thin versus where upside is strongest.</div>';

  const funnel = visuals?.searchVisibilityFunnel;
  const funnelStages = [
    { label: 'Impressions', value: funnel?.impressions, active: typeof funnel?.impressions === 'number' },
    { label: 'Clicks', value: funnel?.clicks, active: typeof funnel?.clicks === 'number' },
    { label: 'Lost Clicks', value: funnel?.estimated_lost_clicks, active: typeof funnel?.estimated_lost_clicks === 'number' },
  ];
  const funnelVisual = funnelStages.some((item) => item.active)
    ? `<div class="card no-break"><div class="label">Search Visibility Funnel</div><h3>How discovery becomes traffic</h3><div class="funnel-row" style="margin-top:12px;">${funnelStages.map((item, index) => `${index > 0 ? '<div class="funnel-arrow">→</div>' : ''}<div class="funnel-stage ${item.active ? '' : 'funnel-stage-missing'}"><div class="label">${escapeHtml(item.label)}</div><div class="${item.active ? 'score-med' : 'score-missing'}" style="font-size:${item.label === 'Clicks' ? '18px' : '16px'};">${item.active ? escapeHtml(typeof item.value === 'number' ? Math.round(item.value).toLocaleString() : '--') : 'Watching'}</div></div>`).join('')}</div><div class="grid-3" style="margin-top:12px;"><article class="card card-compact"><div class="label">CTR</div><div class="${typeof funnel?.ctr === 'number' ? 'score-med score-tone-amber' : 'score-missing'}">${typeof funnel?.ctr === 'number' ? escapeHtml(`${(funnel.ctr * 100).toFixed(2)}%`) : 'Pending'}</div></article><article class="card card-compact"><div class="label">Ranking drag</div><div class="${typeof funnel?.drop_off_reason_distribution?.ranking_issue_pct === 'number' ? 'score-med score-tone-red' : 'score-missing'}">${typeof funnel?.drop_off_reason_distribution?.ranking_issue_pct === 'number' ? escapeHtml(`${Math.round(funnel.drop_off_reason_distribution.ranking_issue_pct)}%`) : 'Pending'}</div></article><article class="card card-compact"><div class="label">Intent mismatch</div><div class="${typeof funnel?.drop_off_reason_distribution?.intent_mismatch_pct === 'number' ? 'score-med score-tone-amber' : 'score-missing'}">${typeof funnel?.drop_off_reason_distribution?.intent_mismatch_pct === 'number' ? escapeHtml(`${Math.round(funnel.drop_off_reason_distribution.intent_mismatch_pct)}%`) : 'Pending'}</div></article></div><div class="pending-note" style="margin-top:10px;">${escapeHtml(funnel?.insightSentence || 'Search demand is being tracked so the report can show where visibility is leaking before traffic converts.')}</div></div>`
    : '<div class="card-pending no-break">Search funnel monitoring is ready, but direct search visibility inputs still need to accumulate before the traffic path can be benchmarked confidently.</div>';

  const crawl = visuals?.crawlHealthBreakdown;
  const crawlBars = crawl ? [
    { label: 'Metadata', value: Number(crawl.metadata_issues ?? 0), color: '#B45309' },
    { label: 'Structure', value: Number(crawl.structure_issues ?? 0), color: '#991B1B' },
    { label: 'Internal Links', value: Number(crawl.internal_link_issues ?? 0), color: '#0077B6' },
    { label: 'Crawl Depth', value: Number(crawl.crawl_depth_issues ?? 0), color: '#1B7340' },
  ] : [];
  const crawlVisual = crawlBars.some((item) => item.value > 0)
    ? `<div class="grid-2" style="margin-top:12px;"><article class="card card-accent-amber no-break"><div class="label">Crawl Health Breakdown</div><h3>Where crawl friction is concentrated</h3>${renderBarSvg(crawlBars)}<div class="pending-note" style="margin-top:10px;">${escapeHtml(crawl?.insightSentence || 'Crawl-derived issue volume shows where structure is most likely slowing discoverability.')}</div></article><article class="card no-break"><div class="label">Issue Severity Mix</div><h3>What needs fixing first</h3><div class="grid-3" style="margin-top:10px;"><article class="card card-compact"><div class="label">Critical</div><div class="${typeof crawl?.severity_split?.critical === 'number' ? 'score-med score-tone-red' : 'score-missing'}">${typeof crawl?.severity_split?.critical === 'number' ? escapeHtml(String(crawl.severity_split.critical)) : 'Pending'}</div></article><article class="card card-compact"><div class="label">Moderate</div><div class="${typeof crawl?.severity_split?.moderate === 'number' ? 'score-med score-tone-amber' : 'score-missing'}">${typeof crawl?.severity_split?.moderate === 'number' ? escapeHtml(String(crawl.severity_split.moderate)) : 'Pending'}</div></article><article class="card card-compact"><div class="label">Low</div><div class="${typeof crawl?.severity_split?.low === 'number' ? 'score-med score-tone-green' : 'score-missing'}">${typeof crawl?.severity_split?.low === 'number' ? escapeHtml(String(crawl.severity_split.low)) : 'Pending'}</div></article></div><div class="tags" style="margin-top:10px;"><span class="badge ${crawl?.severity_split?.classification === 'classified' ? 'badge-blue' : 'badge-gray'}">${escapeHtml(crawl?.severity_split?.classification || 'unclassified')}</span><span class="badge badge-gray">${escapeHtml((crawl?.confidence || 'medium').toUpperCase())} confidence</span></div></article></div>`
    : '<div class="card-pending no-break">Crawl diagnostics are active, but issue volumes are still too light to show a stable breakdown here.</div>';

  const strongKeywordsCard = `<article class="card no-break"><div class="label">Keyword Strength</div><h3>Where the site already has search traction</h3>${strongKeywords.length ? `<p>${escapeHtml(strongKeywords.slice(0, 6).join(', '))}</p>` : '<div class="pending-note">No strong keywords are standing out yet. That usually means the current footprint is still early or fragmented.</div>'}</article>`;

  const headingMarkup = `${sectionHeaderBar(vars.company_name, vars.report_date, { logoUrl: vars.company_logo_url, faviconUrl: vars.company_favicon_url })}<div class="label">SEO Deep Dive</div><h2>SEO Deep Dive</h2><p style="margin-bottom:12px;">This section breaks search readiness into the operating parts that most often change rankings: technical quality, content depth, research coverage, crawl integrity, and how much demand is turning into visits.</p>${gscDisclaimer}`;

  // Render the four sub-scores as 2-card row subsections (Technical
  // SEO + Keyword Research, then Rank Tracking + Content Depth) so
  // each row stays glued together across page breaks.
  const subScoreCardMarkups = subScores.map((item) => `<article class="card no-break"><div class="label">${escapeHtml(item[0])}</div><div class="${displayScore(item[1], item[2]) === '--' ? 'score-missing' : 'score-med'}">${escapeHtml(displayScore(item[1], item[2]))}</div><div class="bar-track"><div class="bar-fill ${displayScore(item[1], item[2]) === '--' ? '' : Number(item[1]) >= 50 ? 'bar-fill-green' : Number(item[1]) >= 30 ? 'bar-fill-amber' : 'bar-fill-red'}" style="width:${displayScore(item[1], item[2]) === '--' ? 0 : clampPercent(item[1])}%"></div></div><div style="font-size:11px;color:#6B7280;margin-top:4px;">${item[2] === 'MISSING' ? 'Pending - connect GSC' : escapeHtml(item[2])}</div></article>`);
  const subScoreRowSubsections: string[] = [];
  for (let i = 0; i < subScoreCardMarkups.length; i += 2) {
    const row = subScoreCardMarkups.slice(i, i + 2).join('');
    subScoreRowSubsections.push(renderSubsection(`<div class="grid-2">${row}</div>`));
  }

  const radarCard = visuals
    ? `<article class="card card-accent-blue no-break"><div class="label">SEO Capability Radar</div><h3>How the SEO system is balanced right now</h3>${renderRadarSvg(radarValues)}<div class="metric-grid-2" style="margin-top:12px;">${radarMetrics}</div><div class="pending-note" style="margin-top:10px;">${escapeHtml(visuals.seoCapabilityRadar.insightSentence || 'This radar shows which SEO capabilities are already active and which ones are still lagging behind the rest of the system.')}</div></article>`
    : '';
  const opportunityCard = visuals
    ? `<article class="card no-break"><div class="label">Opportunity Coverage Matrix</div><h3>Which search opportunities are open vs under-covered</h3><p>The strongest opportunities are the ones where upside is visible but current coverage is still thin. That is where new pages, comparisons, or deeper buyer content can move fastest.</p>${opportunityVisual}</article>`
    : '';

  const operatingReadout = `<article class="card no-break"><div class="label">Keyword Strength</div><h3>Where the site already has search traction</h3>${strongKeywords.length ? `<p>${escapeHtml(strongKeywords.slice(0, 6).join(', '))}</p>` : '<div class="pending-note">No strong keywords are standing out yet. That usually means the current footprint is still early or fragmented.</div>'}<hr class="divider" /><div class="label">SEO Operating Readout</div><h3>What the SEO system is telling you now</h3><p>${escapeHtml(visuals?.opportunityCoverageMatrix.insightSentence || visuals?.seoCapabilityRadar.insightSentence || 'The search layer is active enough to show direction, and the next gains will come from closing content gaps while improving technical and crawl discipline together.')}</p></article>`;

  const subsections = [
    renderSubsection(headingMarkup),
    ...subScoreRowSubsections,
    radarCard ? renderSubsection(radarCard) : '',
    opportunityCard ? renderSubsection(opportunityCard, { flow: true }) : '',
    renderSubsection(funnelVisual, { flow: true }),
    renderSubsection(crawlVisual, { flow: true }),
    renderSubsection(operatingReadout),
  ].filter(Boolean);

  return `<div class="report-section" id="section-5">${subsections.join('')}</div>`;
}

export function renderSection6AiVisibility(payload: PdfReportPayload, vars: Record<string, string>, aiEligible: boolean): string {
  const geo = payload.geoAeoExecutiveSummary;
  const visuals = payload.geoAeoVisuals;
  const actions = (geo?.top3Actions ?? []).slice(0, 3);
  const aiDisclaimer = !aiEligible
    ? renderInlineDisclaimer('missing', 'AI answer visibility is based on structural signals only.', 'Limited AI visibility')
    : '';
  const aiRadar = visuals ? renderRadarSvg([
    { label: 'Coverage', value: visuals.aiAnswerPresenceRadar.answer_coverage_score ?? 0 },
    { label: 'Entities', value: visuals.aiAnswerPresenceRadar.entity_clarity_score ?? 0 },
    { label: 'Authority', value: visuals.aiAnswerPresenceRadar.topical_authority_score ?? 0 },
    { label: 'Citations', value: visuals.aiAnswerPresenceRadar.citation_readiness_score ?? 0 },
    { label: 'Structure', value: visuals.aiAnswerPresenceRadar.content_structure_score ?? 0 },
    { label: 'Freshness', value: visuals.aiAnswerPresenceRadar.freshness_score ?? 0 },
  ]) : '';
  const queryMap = visuals?.queryAnswerCoverageMap?.queries?.slice(0, 6) ?? [];
  const entityMap = visuals?.entityAuthorityMap?.entities?.slice(0, 4) ?? [];
  const extraction = visuals?.answerExtractionFunnel;

  const answerFunnel = extraction
    ? `<article class="card no-break"><div class="label">Answer Extraction Funnel</div><h3>How content becomes AI-usable answers</h3><div class="funnel-row" style="margin-top:12px;"><div class="funnel-stage ${typeof extraction.total_queries === 'number' ? '' : 'funnel-stage-missing'}"><div class="label">Tracked queries</div><div class="${typeof extraction.total_queries === 'number' ? 'score-med' : 'score-missing'}">${typeof extraction.total_queries === 'number' ? escapeHtml(String(extraction.total_queries)) : 'Watching'}</div></div><div class="funnel-arrow">→</div><div class="funnel-stage ${typeof extraction.answerable_content_pct === 'number' ? '' : 'funnel-stage-missing'}"><div class="label">Answerable</div><div class="${typeof extraction.answerable_content_pct === 'number' ? 'score-med score-tone-green' : 'score-missing'}">${typeof extraction.answerable_content_pct === 'number' ? escapeHtml(`${Math.round(extraction.answerable_content_pct)}%`) : 'Pending'}</div></div><div class="funnel-arrow">→</div><div class="funnel-stage ${typeof extraction.structured_content_pct === 'number' ? '' : 'funnel-stage-missing'}"><div class="label">Structured</div><div class="${typeof extraction.structured_content_pct === 'number' ? 'score-med score-tone-amber' : 'score-missing'}">${typeof extraction.structured_content_pct === 'number' ? escapeHtml(`${Math.round(extraction.structured_content_pct)}%`) : 'Pending'}</div></div><div class="funnel-arrow">→</div><div class="funnel-stage ${typeof extraction.citation_ready_pct === 'number' ? '' : 'funnel-stage-missing'}"><div class="${typeof extraction.citation_ready_pct === 'number' ? 'score-med score-tone-green' : 'score-missing'}">${typeof extraction.citation_ready_pct === 'number' ? escapeHtml(`${Math.round(extraction.citation_ready_pct)}%`) : 'Pending'}</div><div class="label">Citation-ready</div></div></div><div class="grid-3" style="margin-top:12px;"><article class="card card-compact"><div class="label">Answer gap</div><div class="${typeof extraction.drop_off_reason_distribution?.answer_gap_pct === 'number' ? 'score-med score-tone-red' : 'score-missing'}">${typeof extraction.drop_off_reason_distribution?.answer_gap_pct === 'number' ? escapeHtml(`${Math.round(extraction.drop_off_reason_distribution.answer_gap_pct)}%`) : 'Pending'}</div></article><article class="card card-compact"><div class="label">Structure gap</div><div class="${typeof extraction.drop_off_reason_distribution?.structure_gap_pct === 'number' ? 'score-med score-tone-amber' : 'score-missing'}">${typeof extraction.drop_off_reason_distribution?.structure_gap_pct === 'number' ? escapeHtml(`${Math.round(extraction.drop_off_reason_distribution.structure_gap_pct)}%`) : 'Pending'}</div></article><article class="card card-compact"><div class="label">Citation gap</div><div class="${typeof extraction.drop_off_reason_distribution?.citation_gap_pct === 'number' ? 'score-med score-tone-amber' : 'score-missing'}">${typeof extraction.drop_off_reason_distribution?.citation_gap_pct === 'number' ? escapeHtml(`${Math.round(extraction.drop_off_reason_distribution.citation_gap_pct)}%`) : 'Pending'}</div></article></div></article>`
    : '<article class="card-pending no-break">Answer extraction tracking is ready, but answerability and citation-readiness still need stronger structured evidence before the funnel can be fully benchmarked.</article>';

  const queryCoverageMap = queryMap.length
    ? `<article class="card no-break"><div class="label">Query Answer Coverage Map</div><h3>Which AI-answer queries are covered vs missing</h3><div class="stack-10" style="margin-top:12px;">${queryMap.map((item) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 10px;border:1px solid #D4DDE6;border-radius:4px;background:#F5F7FA;"><span style="font-size:12px;font-weight:600;color:#1A3A50;">${escapeHtml(item.query)}</span><div class="tags" style="margin-top:0;"><span class="badge ${item.coverage === 'full' ? 'badge-green' : item.coverage === 'partial' ? 'badge-amber' : 'badge-red'}">${escapeHtml(item.coverage)}</span><span class="badge badge-gray">${escapeHtml(displayScore(item.answer_quality_score, 'AVAILABLE'))}</span></div></div>`).join('')}</div></article>`
    : '<article class="card-pending no-break">AI query coverage is still being assembled. Once more query-answer pairs are observed, this map will show where answer quality is full, partial, or missing.</article>';

  const entityAuthority = entityMap.length
    ? `<article class="card no-break"><div class="label">Entity Authority Map</div><h3>How clearly the site reinforces important entities</h3><div class="grid-2" style="margin-top:12px;">${entityMap.map((item) => `<article class="card card-compact"><h4>${escapeHtml(item.entity)}</h4>${renderComparisonBar('Coverage vs relevance', item.coverage_score, item.relevance_score, 'Relevance score')}</article>`).join('')}</div></article>`
    : '<article class="card-pending no-break">Entity authority mapping needs more entity evidence before the report can show which concepts the site owns most clearly.</article>';

  const headingMarkup = `${sectionHeaderBar(vars.company_name, vars.report_date, { logoUrl: vars.company_logo_url, faviconUrl: vars.company_favicon_url })}<div class="label">AI Visibility</div><h2>AI Visibility</h2><p style="margin-bottom:12px;">This section tracks whether the site is becoming easier for answer engines to understand, extract, cite, and reuse in AI-generated responses.</p>${aiDisclaimer}`;

  let bodySubsections: string[] = [];
  if (aiEligible && visuals) {
    const radarCard = `<article class="card card-accent-blue no-break"><div class="label">AI Answer Presence Radar</div><h3>How reusable the site looks for AI answers</h3>${aiRadar}<div class="tags" style="margin-top:10px;"><span class="badge badge-gray">${escapeHtml((visuals.aiAnswerPresenceRadar.data_source_strength || 'missing').toUpperCase())}</span>${(visuals.aiAnswerPresenceRadar.source_tags ?? []).slice(0, 3).map((tag) => `<span class="badge badge-blue">${escapeHtml(tag)}</span>`).join('')}</div></article>`;
    const readoutCard = `<article class="card no-break"><h3>AI Visibility Readout</h3>${geo?.primaryGap.reasoning ? `<p>${escapeHtml(geo.primaryGap.reasoning)}</p>` : '<div class="pending-note">No AI visibility narrative available.</div>'}${geo?.visibilityOpportunity ? `<hr class="divider" /><div class="label">Visibility opportunity</div><p><strong>${escapeHtml(geo.visibilityOpportunity.title)}</strong></p><p>${escapeHtml(geo.visibilityOpportunity.estimatedAiExposure)}</p><p>${escapeHtml(geo.visibilityOpportunity.basedOn)}</p>` : ''}</article>`;
    bodySubsections = [
      renderSubsection(radarCard),
      renderSubsection(readoutCard),
      renderSubsection(answerFunnel, { flow: true }),
      renderSubsection(queryCoverageMap, { flow: true }),
      renderSubsection(entityAuthority),
    ];
  } else {
    bodySubsections = [renderSubsection('<div class="card-pending no-break">AI visibility cannot be measured yet - structured-answer readiness is still being monitored from page structure and content formatting.</div>')];
  }

  const actionGrid = actions.length
    ? `<div class="grid-3">${actions.map((action, index) => `<article class="card card-accent-green no-break"><h3>${escapeHtml(action.actionTitle || `GEO/AEO action ${index + 1}`)}</h3><p>${escapeHtml(action.reasoning)}</p><div class="tags"><span class="badge badge-gray">${escapeHtml(action.priority.toUpperCase())}</span><span class="badge badge-gray">${escapeHtml(action.expectedImpact.toUpperCase())}</span><span class="badge badge-gray">${escapeHtml(action.effort.toUpperCase())}</span></div></article>`).join('')}</div>`
    : '';

  return `<div class="report-section" id="section-6">${renderSubsection(headingMarkup)}${bodySubsections.join('')}${actionGrid ? renderSubsection(actionGrid) : ''}</div>`;
}

export function renderSection7BacklinkAuthority(payload: PdfReportPayload, vars: Record<string, string>, actions: ReturnType<typeof collectMasterActions>): string {
  const visuals = payload.seoVisuals;
  const backlinkStrength = toUpperStrength(visuals?.seoCapabilityRadar.data_source_strength?.backlinks_score);
  const seen = new Set<string>();
  const visibleActions = actions.filter((action) => {
    const key = action.title?.trim().toLowerCase().slice(0, 60);
    if (inferMasterActionTrack(action) !== 'authority') return false;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 3);
  const competitorVisuals = payload.competitorVisuals;
  const competitorRadar = competitorVisuals?.competitorPositioningRadar;
  const authorityGap = competitorRadar?.competitors?.length
    ? Math.round((competitorRadar.competitors.reduce((sum, item) => sum + Number(item.authority_score ?? 0), 0) / competitorRadar.competitors.length) - Number(competitorRadar.user.authority_score ?? 0))
    : null;
  const inferredNote = backlinkStrength === 'INFERRED'
    ? '<div class="pending-note">Backlink data is inferred from available signals. Connect a backlink data source for full accuracy.</div>'
    : '';
  const backlinkDisclaimer = backlinkStrength === 'INFERRED'
    ? renderInlineDisclaimer('partial', 'Backlink data is inferred. Connect a backlink source for full authority accuracy.', 'Partial authority signals')
    : backlinkStrength === 'MISSING'
      ? renderInlineDisclaimer('missing', 'This section is based on inferred signals. Connect a backlink source to unlock full accuracy.', 'Missing backlink data')
      : '';
  const signalSources = escapeHtml((visuals?.seoCapabilityRadar.source_tags?.backlinks_score ?? []).join(', ') || '--');
  const authorityProfileCard = `<article class="card no-break"><h3>Authority Profile</h3><div class="stack-10"><div><div class="label">Anchor Diversity</div><div class="score-missing">--</div></div><div><div class="label">Authority Gap Vs Competitors</div><div class="${authorityGap == null ? 'score-missing' : 'score-med'}">${escapeHtml(displayScore(authorityGap, authorityGap == null ? 'MISSING' : 'AVAILABLE'))}</div></div><div><div class="label">Signal Sources</div><p>${signalSources}</p></div></div></article>`;
  const backlinkScoreCard = scoreMetricCard('Backlink Score', visuals?.seoCapabilityRadar.backlinks_score ?? null, backlinkStrength, 'Authority benchmark from current backlink and domain trust signals.');
  const secondaryMetrics = backlinkStrength === 'STRONG'
    ? `<div class="grid-3" style="margin-top:12px;">${scoreMetricCard('Referring Domains', null, 'MISSING', 'Renderer is ready to show this once backlink profile counts are attached.')}${scoreMetricCard('Avg Authority', null, 'MISSING', `Average quality of the domains citing ${vars.company_name || payload.domain}.`)}${scoreMetricCard('Follow Ratio', null, 'MISSING', 'Share of follow links across the current backlink profile.')}</div>`
    : '';
  const actionSubsections = visibleActions.map((action, index) => renderSubsection(renderMasterActionCard(action, index))).join('');
  const headingMarkup = `${sectionHeaderBar(vars.company_name, vars.report_date, { logoUrl: vars.company_logo_url, faviconUrl: vars.company_favicon_url })}<div class="label">Backlink &amp; Authority</div><h2>Backlink &amp; Authority</h2><p style="margin-bottom:12px;">Authority is the trust layer behind discoverability. This section watches whether the market has enough external proof, citations, and domain strength to take the site seriously.</p>${backlinkDisclaimer}${inferredNote}`;
  const summaryBlock = backlinkStrength === 'STRONG' || backlinkStrength === 'INFERRED'
    ? `<div class="backlink-summary"><div class="backlink-meta">${backlinkScoreCard}${secondaryMetrics ? `<div>${secondaryMetrics}</div>` : ''}</div>${authorityProfileCard}</div>`
    : '<div class="card-pending no-break">Authority signals are still being monitored from available trust indicators. A fuller authority score will appear once a dedicated backlink source is connected.</div>';
  return `<div class="report-section" id="section-7">${renderSubsection(headingMarkup)}${renderSubsection(summaryBlock)}${actionSubsections}</div>`;
}

export function renderSection8ActionPlan(payload: PdfReportPayload, vars: Record<string, string>, actions: ReturnType<typeof collectMasterActions>): string {
  const seen = new Set<string>();
  const mergedActions = actions.filter((action) => {
    const key = action.title?.trim().toLowerCase().slice(0, 60);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
  const currentScore = getOverallScore(payload);
  const highPriorityCount = mergedActions.filter((item) => item.priority === 'HIGH').length;
  const headingMarkup = `${sectionHeaderBar(vars.company_name, vars.report_date, { logoUrl: vars.company_logo_url, faviconUrl: vars.company_favicon_url })}<div class="label">Action Plan</div><h2>Action Plan</h2><p style="margin-bottom:12px;">These are the next moves most likely to change the trajectory. The plan stays close to execution, so it is organized by action priority and operating window rather than abstract strategy themes.</p>`;
  const trajectoryRow = `<div class="traj-row no-break"><div class="traj-step"><div class="lbl">Current</div><div class="num">${escapeHtml(displayScore(currentScore, 'AVAILABLE'))}</div></div><div class="traj-arrow">-></div><div class="traj-step"><div class="lbl">Next</div><div class="num">${escapeHtml(String(highPriorityCount || mergedActions.length || 0))}</div><div class="lbl" style="margin-top:4px;">priority moves</div></div><div class="traj-arrow">-></div><div class="traj-step"><div class="lbl">Later</div><div class="num">${escapeHtml(String(mergedActions.length || 0))}</div><div class="lbl" style="margin-top:4px;">roadmap actions</div></div></div>`;
  const actionCardSubsections = mergedActions
    .map((action, index) => renderSubsection(renderMasterActionCard(action, index)))
    .join('');
  const timelineGrid = `<div class="grid-3"><div class="card no-break"><div class="label">0-30 days</div><div>${escapeHtml(mergedActions.slice(0, 2).map((item) => item.title).filter(Boolean).join(' / '))}</div></div><div class="card no-break"><div class="label">31-60 days</div><div>${escapeHtml(mergedActions.slice(2, 4).map((item) => item.title).filter(Boolean).join(' / '))}</div></div><div class="card no-break"><div class="label">61-90 days</div><div>${escapeHtml(mergedActions.slice(4).map((item) => item.title).filter(Boolean).join(' / '))}</div></div></div><div class="pending-note" style="margin-top:10px;">Only the current score is shown numerically here. Next and later stages describe action depth, not projected scores.</div>`;

  return `<div class="report-section" id="section-8">${renderSubsection(`${headingMarkup}${trajectoryRow}`)}${actionCardSubsections}${renderSubsection(timelineGrid)}</div>`;
}

export function renderSection9ProgressComparison(payload: PdfReportPayload, vars: Record<string, string>): string {
  const progress = payload.progressComparison;
  const hasSeoSystem = Boolean(
    (payload.seoExecutiveSummary?.overallHealthScore ?? 0) > 0
    || (payload.seoVisuals?.seoCapabilityRadar.content_quality_score ?? 0) > 0
    || (payload.seoVisuals?.seoCapabilityRadar.technical_seo_score ?? 0) > 0
    || safeText(payload.companyContext?.homepageHeadline, 1)
    || safeText(payload.companyContext?.primaryOffering, 1),
  );
  const hasAiSystem = Boolean(
    (payload.geoAeoExecutiveSummary?.overallAiVisibilityScore ?? 0) > 0
    || (payload.geoAeoVisuals?.aiAnswerPresenceRadar.content_structure_score ?? 0) > 0
    || (payload.geoAeoVisuals?.queryAnswerCoverageMap.queries?.length ?? 0) > 0
    || (payload.geoAeoVisuals?.answerExtractionFunnel.total_queries ?? 0) > 0,
  );
  const hasCompetitorSystem = Boolean(
    (payload.competitorContext?.competitors?.length ?? 0) > 0
    || (payload.competitorMovementComparison?.competitors?.length ?? 0) > 0
    || (payload.competitorVisuals?.competitorPositioningRadar.competitors?.length ?? 0) > 0,
  );
  const metrics = progress ? [
    { label: 'Unified score', value: progress.unified_score_change, digits: 1 },
    { label: 'SEO health', value: progress.seo_changes.health_score_delta, digits: 1 },
    { label: 'Impressions', value: progress.seo_changes.impressions_delta, digits: 0 },
    { label: 'Clicks', value: progress.seo_changes.clicks_delta, digits: 0 },
    { label: 'CTR', value: progress.seo_changes.ctr_delta, digits: 4 },
    { label: 'AI visibility', value: progress.geo_aeo_changes.ai_visibility_delta, digits: 1 },
    { label: 'Answer coverage', value: progress.geo_aeo_changes.answer_coverage_delta, digits: 1 },
    { label: 'Citation readiness', value: progress.geo_aeo_changes.citation_readiness_delta, digits: 1 },
    { label: 'Competitive position', value: progress.competitor_changes.position_change, digits: 1 },
    { label: 'Gap reduction', value: progress.competitor_changes.gap_reduction_score, digits: 1 },
  ] : [];

  const fmtDelta = (value: number | null | undefined, digits = 1): string => {
    if (value == null || !Number.isFinite(value)) return 'Signal pending';
    const rounded = Number(value.toFixed(digits));
    return `${rounded >= 0 ? '+' : ''}${rounded}`;
  };

  const getProgressState = (label: string, value: number | null | undefined): {
    title: string;
    toneClass: string;
    badgeClass: string;
    badgeLabel: string;
    cardClass: string;
  } => {
    if (value != null && Number.isFinite(value)) {
      if (value > 0) {
        return {
          title: `${value >= 0 ? '+' : ''}${Number(value.toFixed(label === 'CTR' ? 4 : 1))}`,
          toneClass: 'score-med score-tone-green',
          badgeClass: 'badge-green',
          badgeLabel: 'Improving',
          cardClass: 'card card-accent-green',
        };
      }
      if (value < 0) {
        return {
          title: `${Number(value.toFixed(label === 'CTR' ? 4 : 1))}`,
          toneClass: 'score-med score-tone-red',
          badgeClass: 'badge-red',
          badgeLabel: 'Declining',
          cardClass: 'card card-accent-red',
        };
      }
      return {
        title: '+0',
        toneClass: 'score-med score-tone-amber',
        badgeClass: 'badge-blue',
        badgeLabel: 'Observed',
        cardClass: 'card card-accent-blue',
      };
    }

    if (label === 'Impressions' || label === 'Clicks' || label === 'CTR') {
      return hasSeoSystem
        ? {
            title: 'Tracking warming up',
            toneClass: 'score-med score-tone-amber',
            badgeClass: 'badge-blue',
            badgeLabel: 'Observed',
            cardClass: 'card card-accent-blue',
          }
        : {
            title: 'Not available',
            toneClass: 'score-med score-tone-gray',
            badgeClass: 'badge-gray',
            badgeLabel: 'Missing',
            cardClass: 'card',
          };
    }

    if (label === 'AI visibility' || label === 'Answer coverage' || label === 'Citation readiness') {
      return hasAiSystem
        ? {
            title: 'Framework active',
            toneClass: 'score-med score-tone-amber',
            badgeClass: 'badge-blue',
            badgeLabel: 'Observed',
            cardClass: 'card card-accent-blue',
          }
        : {
            title: 'Not available',
            toneClass: 'score-med score-tone-gray',
            badgeClass: 'badge-gray',
            badgeLabel: 'Missing',
            cardClass: 'card',
          };
    }

    if (label === 'Competitive position' || label === 'Gap reduction') {
      return hasCompetitorSystem
        ? {
            title: 'Comparison active',
            toneClass: 'score-med score-tone-amber',
            badgeClass: 'badge-blue',
            badgeLabel: 'Observed',
            cardClass: 'card card-accent-blue',
          }
        : {
            title: 'Not available',
            toneClass: 'score-med score-tone-gray',
            badgeClass: 'badge-gray',
            badgeLabel: 'Missing',
            cardClass: 'card',
          };
    }

    return {
      title: 'Signal pending',
      toneClass: 'score-med score-tone-gray',
      badgeClass: 'badge-gray',
      badgeLabel: 'Watching',
      cardClass: 'card',
    };
  };

  const progressCards = metrics.length
    ? `<div class="grid-3">${metrics.map((metric) => {
      const state = getProgressState(metric.label, metric.value);
      return `<article class="${state.cardClass} no-break"><div class="label">${escapeHtml(metric.label)}</div><div class="${state.toneClass}">${escapeHtml(metric.value != null && Number.isFinite(metric.value) ? fmtDelta(metric.value, metric.digits) : state.title)}</div><div class="tags" style="margin-top:8px;"><span class="badge ${state.badgeClass}">${escapeHtml(state.badgeLabel)}</span>${state.badgeLabel === 'Missing' ? '<span class="badge badge-gray">Needs setup</span>' : '<span class="badge badge-blue">Active</span>'}</div></article>`;
    }).join('')}</div>`
    : '<div class="card-pending no-break">Progress comparison will appear once there is at least one earlier snapshot to compare against this report.</div>';

  const headingMarkup = `${sectionHeaderBar(vars.company_name, vars.report_date, { logoUrl: vars.company_logo_url, faviconUrl: vars.company_favicon_url })}<div class="label">Progress Comparison</div><h2>Progress Comparison</h2><p style="margin-bottom:12px;">This section compares the current snapshot with the previous one so the report shows what is improving, what is slipping, and where momentum is still flat.</p>`;
  const summaryCard = progress
    ? `<div class="card card-accent-blue no-break"><h3>How the system moved since the previous snapshot</h3><p>${escapeHtml(progress.data_status === 'insufficient' ? 'There is not enough previous history yet to compute a strong comparison trend.' : progress.summary.overall_trend === 'improving' ? `The system is improving, led by ${progress.summary.biggest_gain}.` : progress.summary.overall_trend === 'declining' ? `The system is losing ground, mainly from ${progress.summary.biggest_drop}.` : `The system is stable overall. Biggest gain: ${progress.summary.biggest_gain}. Biggest drop: ${progress.summary.biggest_drop}.`)}</p><div class="tags" style="margin-top:10px;"><span class="badge badge-blue">${escapeHtml(progress.summary.overall_trend)}</span><span class="badge badge-gray">${escapeHtml(progress.data_status)}</span></div></div>`
    : '';
  return `<div class="report-section" id="section-9">${renderSubsection(headingMarkup)}${summaryCard ? renderSubsection(summaryCard) : ''}${renderSubsection(progressCards, { flow: true })}</div>`;
}

export function renderSection10SearchGrowthTimeline(payload: PdfReportPayload, vars: Record<string, string>): string {
  const timeline = payload.timelineComparison;
  const rows = timeline?.snapshots ?? [];
  const usableRows = rows.filter((item) => item.unified_score != null);
  const userTrend = usableRows.map((item) => Number(item.unified_score ?? 0));
  const competitorTrend = rows.some((item) => item.competitor?.score != null)
    ? rows.map((item) => item.competitor?.score != null ? Number(item.competitor.score) : 0)
    : [];
  const competitorLabel = rows.find((item) => item.competitor?.domain)?.competitor?.domain ?? 'Closest competitor';

  const annotations = rows.slice(1).flatMap((item) => {
    const notes: string[] = [];
    if (item.delta_from_previous != null) {
      if (item.delta_from_previous >= 5) notes.push(`${new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}: meaningful upward move`);
      if (item.delta_from_previous <= -5) notes.push(`${new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}: material drop from the previous snapshot`);
    }
    return notes;
  }).slice(0, 4);

  const headingMarkup = `${sectionHeaderBar(vars.company_name, vars.report_date, { logoUrl: vars.company_logo_url, faviconUrl: vars.company_favicon_url })}<div class="label">Search Growth Timeline</div><h2>Search Growth Timeline</h2><p style="margin-bottom:12px;">This section shows how the unified score has moved across snapshots and whether the gap to the closest competitor is closing, widening, or staying flat.</p>`;
  const bodyMarkup = timeline && rows.length >= 2
    ? `<div class="grid-2"><article class="card card-accent-blue no-break"><h3>User vs competitor movement</h3>${renderTrendSvg(userTrend, competitorTrend.length ? competitorTrend : undefined)}<div class="tags" style="margin-top:10px;"><span class="badge badge-blue">${escapeHtml(timeline.meta.trend)}</span><span class="badge badge-gray">${escapeHtml(`${timeline.meta.data_points} points`)}</span>${timeline.meta.total_change != null ? `<span class="badge ${timeline.meta.total_change >= 0 ? 'badge-green' : 'badge-red'}">${escapeHtml(`${timeline.meta.total_change >= 0 ? '+' : ''}${timeline.meta.total_change}`)}</span>` : ''}</div><div class="pending-note" style="margin-top:10px;">Blue line: ${escapeHtml(vars.company_name)}. Gray line: ${escapeHtml(competitorLabel)}.</div></article><article class="card no-break"><h3>Timeline signals</h3>${annotations.length ? annotations.map((note) => `<p>${escapeHtml(note)}</p>`).join('') : '<div class="pending-note">The trend is visible, but no standout movement crosses the alert threshold yet.</div>'}<hr class="divider" /><div class="label">Data status</div><p>${escapeHtml(timeline.meta.data_status)}</p><p>${escapeHtml(timeline.meta.total_change == null ? 'Total change is still being established from limited history.' : `Total unified score change across the visible timeline is ${timeline.meta.total_change >= 0 ? '+' : ''}${timeline.meta.total_change}.`)}</p></article></div>`
    : '<div class="card-pending no-break">A growth timeline becomes useful after at least two completed snapshots. Once that history exists, this section will show momentum and competitor gap direction automatically.</div>';
  return `<div class="report-section" id="section-10">${renderSubsection(headingMarkup)}${renderSubsection(bodyMarkup)}</div>`;
}

export function renderDataCoveragePage(
  payload: PdfReportPayload,
  vars: Record<string, string>,
  sectionStatuses: Record<string, SnapshotSectionStatus>,
): string {
  const dataSources = deriveDataSources(payload);
  const connectedCount = dataSources.filter((item) => item.status === 'connected').length;
  const overallConfidence = dataSources.every((item) => item.status === 'connected')
    ? 'High'
    : dataSources.some((item) => item.status === 'missing')
      ? 'Medium'
      : 'High';
  const coverageLevel = dataSources.every((item) => item.status === 'connected')
    ? 'Connected'
    : dataSources.some((item) => item.status === 'missing')
      ? 'Partial'
      : 'Mostly Connected';
  const capabilityCards = [
    sectionStatuses['section-4'] !== 'complete' ? 'Competitor comparison remains directional until more market signals are connected.' : '',
    sectionStatuses['section-5'] !== 'complete' ? 'SEO opportunity sizing will sharpen once keyword and ranking systems are connected.' : '',
    sectionStatuses['section-6'] !== 'complete' ? 'AI visibility scoring will deepen as answer-engine evidence becomes available.' : '',
    sectionStatuses['section-7'] !== 'complete' ? 'Authority benchmarking will become more reliable with a backlink source connection.' : '',
  ].filter(Boolean);

  const headingMarkup = `<div class="label">Data Confidence &amp; Coverage</div><h2>Data Confidence &amp; Coverage</h2><div class="section-intro"><p>This report combines available signals with intelligent inference. Some insights are directional due to limited connected data sources. As more systems are connected, accuracy, depth, and confidence improve automatically.</p></div><div class="coverage-summary-strip no-break"><div class="coverage-summary-item"><div class="label">Overall Confidence</div><div class="score-med">${escapeHtml(overallConfidence)}</div></div><div class="coverage-summary-item"><div class="label">Coverage Level</div><div class="score-med">${escapeHtml(coverageLevel)}</div></div><div class="coverage-summary-item"><div class="label">Data Sources Connected</div><div class="score-med">${connectedCount} / ${dataSources.length}</div></div></div>`;

  // Pair data source cards into 2-card subsections so each pair stays
  // intact across pages without any whole row pushing onto the next page.
  const sourceCards = dataSources.map((source) => `<article class="card no-break data-source-card"><div class="data-source-head"><div><div class="label">${escapeHtml(source.name)}</div><h3>${escapeHtml(source.status === 'connected' ? 'Connected' : source.status === 'partial' ? 'Partial' : 'Missing')}</h3></div><span class="badge ${source.status === 'connected' ? 'badge-green' : source.status === 'partial' ? 'badge-amber' : 'badge-red'}">${escapeHtml(source.confidence.toUpperCase())} confidence</span></div><div class="stack-10"><div><div class="label">Current State</div><p>${escapeHtml(source.currentState)}</p></div><div><div class="label">Impact On Report</div><p>${escapeHtml(source.impact)}</p></div><div><div class="label">What Unlocks</div><ul class="simple-list">${source.unlocks.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div></div></article>`);
  const sourcePairSubsections: string[] = [];
  for (let i = 0; i < sourceCards.length; i += 2) {
    sourcePairSubsections.push(renderSubsection(`<div class="data-source-grid">${sourceCards.slice(i, i + 2).join('')}</div>`));
  }

  const closingPair = `<div class="grid-2"><article class="card card-accent-amber no-break"><h3>What This Means</h3><ul class="simple-list"><li>Insights are directional, not exhaustive.</li><li>Gaps identified are likely larger than what is currently visible.</li><li>Opportunities may deliver stronger results than estimated today.</li></ul></article><article class="card card-accent-blue no-break"><h3>What Improves Next</h3><ul class="simple-list"><li>Insights become more precise.</li><li>Recommendations become more personalized.</li><li>Competitive analysis becomes more complete.</li><li>AI visibility scoring becomes more accurate.</li><li>Growth projections become more reliable.</li></ul></article></div>${capabilityCards.length ? `<div class="pending-note" style="margin-top:12px;">${escapeHtml(capabilityCards.join(' '))}</div>` : ''}`;

  return `<div class="report-section data-coverage-page" id="coverage-page">${renderSubsection(headingMarkup)}${sourcePairSubsections.join('')}${renderSubsection(closingPair)}</div>`;
}

export function getBacklinkStrength(payload: PdfReportPayload): 'STRONG' | 'INFERRED' | 'WEAK' | 'MISSING' {
  return toUpperStrength(payload.seoVisuals?.seoCapabilityRadar.data_source_strength?.backlinks_score);
}

export function getSnapshotSectionSpecs(
  payload: PdfReportPayload,
  vars: Record<string, string>,
): SnapshotSectionSpec[] {
  const visuals = payload.seoVisuals;
  const competitorVisuals = payload.competitorVisuals;
  const radar = competitorVisuals?.competitorPositioningRadar;
  const competitorEligible = Boolean(radar?.competitors.some((item) => Number(item.content_score ?? 0) > 0 || Number(item.keyword_coverage_score ?? 0) > 0 || Number(item.authority_score ?? 0) > 0 || Number(item.technical_score ?? 0) > 0 || Number(item.ai_answer_presence_score ?? 0) > 0));
  const keywordGapEligible = Boolean(competitorVisuals?.keywordGapAnalysis && (hasNonEmptyList(competitorVisuals.keywordGapAnalysis.missing_keywords) || hasNonEmptyList(competitorVisuals.keywordGapAnalysis.weak_keywords) || hasNonEmptyList(competitorVisuals.keywordGapAnalysis.strong_keywords)));
  const competitorContextAvailable = Boolean(
    safeText(payload.competitorContext?.summary, 2)
    || payload.competitorContext?.competitors?.length
    || payload.competitorContext?.strongestGaps?.length,
  );
  const strongCompetitorContext = Boolean(
    payload.competitorContext?.competitors?.length
    && payload.competitorContext?.strongestGaps?.length,
  );
  const aiEligible = hasRealAiVisibilityData(payload);
  const actions = collectMasterActions(payload);
  const performanceDimensions = [
    visuals?.seoCapabilityRadar.content_quality_score ?? null,
    visuals?.seoCapabilityRadar.rank_tracking_score ?? null,
    visuals?.searchVisibilityFunnel.impressions ?? null,
    visuals?.searchVisibilityFunnel.ctr != null ? Math.round((visuals.searchVisibilityFunnel.ctr ?? 0) * 100) : null,
    visuals?.seoCapabilityRadar.backlinks_score ?? null,
    visuals?.opportunityCoverageMatrix.opportunities?.[0]?.coverage_score ?? null,
    visuals?.opportunityCoverageMatrix.opportunities?.length ? Math.round(visuals.opportunityCoverageMatrix.opportunities.reduce((sum, item) => sum + Number(item.coverage_score ?? 0), 0) / visuals.opportunityCoverageMatrix.opportunities.length) : null,
    null,
    aiEligible ? (payload.geoAeoExecutiveSummary?.overallAiVisibilityScore ?? null) : null,
  ];
  const availablePerformanceCount = performanceDimensions.filter((value) => value != null).length;
  const seoSubScores = [
    visuals?.seoCapabilityRadar.technical_seo_score ?? null,
    visuals?.seoCapabilityRadar.keyword_research_score ?? null,
    visuals?.seoCapabilityRadar.rank_tracking_score ?? null,
    visuals?.seoCapabilityRadar.content_quality_score ?? null,
  ];
  const availableSeoSubScores = seoSubScores.filter((value) => value != null).length;
  const backlinkStrength = getBacklinkStrength(payload);
  const sections: SnapshotSectionSpec[] = [
    {
      id: 'section-overview',
      title: 'Executive Overview',
      status: 'complete',
      html: '',
    },
    {
      id: 'section-1',
      title: 'Cover',
      status: 'complete',
      html: renderSection1Cover(payload, vars),
    },
    {
      id: 'section-2',
      title: 'Strategic Position',
      status: payload.decisionSnapshot ? 'complete' : 'partial',
      html: renderSection2StrategicPosition(payload, vars),
    },
    {
      id: 'section-3',
      title: 'Performance Scores',
      status: availablePerformanceCount >= 8 ? 'complete' : availablePerformanceCount > 0 ? 'partial' : 'missing',
      html: renderSection3PerformanceScores(payload, vars),
    },
    {
      id: 'section-score-drivers',
      title: 'Score Drivers',
      status: payload.scoreExplanation ? 'complete' : 'missing',
      html: renderSectionScoreDrivers(payload, vars),
    },
    {
      id: 'section-4',
      title: 'Competitive Landscape',
      status: (payload.competitorContext?.competitors?.length ?? 0) > 0 || competitorEligible ? 'complete' : competitorContextAvailable || keywordGapEligible ? 'partial' : 'missing',
      html: renderSection4CompetitorIntelligence(payload, vars, competitorEligible, keywordGapEligible),
    },
    {
      id: 'section-5',
      title: 'SEO Deep Dive',
      status: availableSeoSubScores === seoSubScores.length ? 'complete' : availableSeoSubScores > 0 ? 'partial' : 'missing',
      html: renderSection5SeoDeepdive(payload, vars),
    },
    {
      id: 'section-6',
      title: 'AI Visibility',
      status: aiEligible ? 'complete' : 'missing',
      html: renderSection6AiVisibility(payload, vars, aiEligible),
    },
    {
      id: 'section-7',
      title: 'Backlink & Authority',
      status: backlinkStrength === 'STRONG' ? 'complete' : backlinkStrength === 'INFERRED' ? 'partial' : 'missing',
      html: renderSection7BacklinkAuthority(payload, vars, actions),
    },
    {
      id: 'section-8',
      title: 'Action Plan',
      status: actions.length > 0 ? 'complete' : 'partial',
      html: renderSection8ActionPlan(payload, vars, actions),
    },
    {
      id: 'section-9',
      title: 'Progress Comparison',
      status: payload.progressComparison
        ? payload.progressComparison.data_status === 'complete'
          ? 'complete'
          : payload.progressComparison.data_status === 'partial'
            ? 'partial'
            : 'missing'
        : 'missing',
      html: renderSection9ProgressComparison(payload, vars),
    },
    {
      id: 'section-10',
      title: 'Search Growth Timeline',
      status: payload.timelineComparison
        ? payload.timelineComparison.meta.data_status === 'complete'
          ? 'complete'
          : payload.timelineComparison.meta.data_status === 'partial'
            ? 'partial'
            : 'missing'
        : 'missing',
      html: renderSection10SearchGrowthTimeline(payload, vars),
    },
    {
      id: 'section-geo',
      title: 'GEO / AEO Intelligence',
      status: aiEligible ? 'complete' : 'partial',
      html: renderGeoAeoFlow(payload),
    },
    {
      id: 'section-social',
      title: 'Social Platform Strategy',
      status: 'complete',
      html: renderSocialPlatformFlow(payload, vars),
    },
    {
      id: 'section-trajectory',
      title: 'Growth Trajectory',
      status: actions.length > 0 ? 'complete' : 'partial',
      html: renderTrajectoryFlow(payload, actions),
    },
    {
      id: 'section-cta',
      title: 'Next Steps',
      status: 'complete',
      html: renderNextLevelCtaFlow(payload, vars),
    },
  ];
  const sectionStatuses = Object.fromEntries(sections.filter((section) => section.id !== 'section-overview').map((section) => [section.id, section.status])) as Record<string, SnapshotSectionStatus>;
  // Insert Data Confidence before the CTA (which is the last section)
  const ctaIndex = sections.findIndex((s) => s.id === 'section-cta');
  if (ctaIndex !== -1) {
    sections.splice(ctaIndex, 0, {
      id: 'section-confidence',
      title: 'Data Confidence',
      status: 'complete',
      html: renderConfidenceFlow(payload, vars, sectionStatuses),
    });
  }
  sections[0] = {
    id: 'section-overview',
    title: 'Executive Overview',
    status: 'complete',
    html: renderSectionOverview(payload, vars, sectionStatuses, keywordGapEligible),
  };
  return sections;
}
