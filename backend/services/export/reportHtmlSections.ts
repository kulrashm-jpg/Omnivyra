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
  return `<div class="report-section" id="section-1">${sectionHeaderBar(vars.company_name, vars.report_date)}<div class="cover-grid cover-grid-top"><div class="card no-break cover-score">${coverDonut}</div><div class="cover-identity"><h1>${escapeHtml(vars.company_name)}</h1><div class="cover-url">${escapeHtml(vars.website_url)}</div><div class="tags cover-tags"><span class="badge badge-amber">${escapeHtml(vars.stage_label || '--')}</span><span class="badge badge-green">${escapeHtml(vars.confidence_label || '--')}</span><span class="badge badge-blue">${escapeHtml(movement || '--')}</span></div>${summaryCard}</div></div>${showStatsRow ? `<hr class="divider" /><div class="stats-4"><div><div class="label">Overall Score</div><div class="score-med">${escapeHtml(displayScore(getOverallScore(payload), 'AVAILABLE'))}</div></div><div><div class="label">Stage</div><div class="score-med">${escapeHtml(vars.stage_label || '--')}</div></div><div><div class="label">Confidence</div><div class="score-med">${escapeHtml(vars.confidence_label || '--')}</div></div><div><div class="label">Movement</div><div class="score-med">${escapeHtml(movement || '--')}</div></div></div>` : ''}</div>`;
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
  return `<div class="report-section section-continue" id="section-2">${showHeaderBar ? sectionHeaderBar(vars.company_name, vars.report_date) : ''}<div class="label">Strategic Position</div><h2>Strategic Position</h2><div class="grid-4">${cards.map((item) => `<article class="card ${item.tone === 'good' ? 'card-accent-green' : item.tone === 'warn' ? 'card-accent-amber' : item.tone === 'bad' ? 'card-accent-red' : 'card-accent-blue'} no-break"><h3>${escapeHtml(item.title)}</h3>${item.body ? `<p>${escapeHtml(item.body)}</p>` : renderFillQuote(item.title, 'More evidence in this area will turn the strategy into a sharper execution brief.')}</article>`).join('')}</div><hr class="divider" /><h3>Strategic Strength</h3><div class="grid-4">${strengths.map((item) => `<div class="card no-break"><div class="label">${escapeHtml(item.label)}</div><div class="${item.score == null ? 'score-missing' : 'score-med'}">${escapeHtml(displayScore(item.score, item.score == null ? 'MISSING' : 'AVAILABLE'))}</div><div class="bar-track"><div class="bar-fill ${item.score != null && item.score < 30 ? 'bar-fill-red' : item.score != null && item.score < 50 ? 'bar-fill-amber' : 'bar-fill-green'}" style="width:${item.score == null ? 0 : clampPercent(item.score)}%"></div></div>${item.value ? `<p style="margin-top:8px;">${escapeHtml(item.value)}</p>` : '<div class="pending-note">Strategic scoring will become more precise as more context is connected.</div>'}</div>`).join('')}</div></div>`;
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
  const nextScore = Math.min(100, currentScore + Math.max(3, actions.filter((item) => item.priority === 'HIGH').length * 2));
  const futureScore = Math.min(100, nextScore + Math.max(4, actions.length * 2));
  const maxScore = Math.max(currentScore, nextScore, futureScore, 1);
  const points = [
    { label: 'Current', value: currentScore },
    { label: 'Next', value: nextScore },
    { label: 'Future', value: futureScore },
  ];
  return `<div class="report-section section-continue" id="growth-trajectory"><div class="label">Growth Trajectory</div><h2>Growth Trajectory Simulation</h2><div class="trajectory-graph">${points.map((point) => `<div class="trajectory-col"><div class="trajectory-bar-wrap"><div class="trajectory-bar ${getStateTone(point.value)}" style="height:${Math.max(14, Math.round((point.value / maxScore) * 120))}px;"></div></div><div class="score-med">${escapeHtml(displayScore(point.value, 'AVAILABLE'))}</div><div class="label">${escapeHtml(point.label)}</div></div>`).join('')}</div><div class="pending-note" style="margin-top:10px;">This simulation is based on the current action stack and improves as more systems are connected.</div></div>`;
}

export function getStrategicStrengthCards(payload: PdfReportPayload): Array<{ label: string; value: string; score: number | null }> {
  return [
    { label: 'Position', value: safeText(payload.companyContext?.marketPosition || payload.companyContext?.marketPositionStatement, 1), score: /ahead|strong/i.test(payload.companyContext?.marketPosition || payload.companyContext?.marketPositionStatement || '') ? 78 : /parity|moderate/i.test(payload.companyContext?.marketPosition || payload.companyContext?.marketPositionStatement || '') ? 54 : /below|weak/i.test(payload.companyContext?.marketPosition || payload.companyContext?.marketPositionStatement || '') ? 28 : null },
    { label: 'Growth', value: safeText(payload.unifiedIntelligenceSummary?.growthDirection.shortTermFocus, 1), score: hasContent(payload.unifiedIntelligenceSummary?.growthDirection.shortTermFocus) ? 68 : null },
    { label: 'Risk', value: safeText(payload.companyContext?.executionRisk, 1), score: hasContent(payload.companyContext?.executionRisk) ? 36 : null },
    { label: 'Positioning', value: safeText(payload.companyContext?.positioningStrength || payload.companyContext?.positioningGap, 1), score: /strong/i.test(payload.companyContext?.positioningStrength || '') ? 76 : /moderate/i.test(payload.companyContext?.positioningStrength || '') ? 52 : /weak/i.test(payload.companyContext?.positioningStrength || '') ? 30 : hasContent(payload.companyContext?.positioningGap) ? 34 : null },
  ];
}

export function renderSectionOverview(
  payload: PdfReportPayload,
  vars: Record<string, string>,
  sectionStatuses: Record<string, SnapshotSectionStatus>,
  keywordGapEligible: boolean,
): string {
  const strengths = getStrategicStrengthCards(payload);
  const progressItems = [
    { label: 'Unified', score: payload.unifiedIntelligenceSummary?.unifiedScore ?? getOverallScore(payload) },
    { label: 'SEO', score: payload.seoExecutiveSummary?.overallHealthScore ?? null },
    { label: 'AI Visibility', score: hasRealAiVisibilityData(payload) ? (payload.geoAeoExecutiveSummary?.overallAiVisibilityScore ?? null) : null },
    { label: 'Authority', score: payload.seoVisuals?.seoCapabilityRadar.backlinks_score ?? null },
  ];
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

  return `<div class="report-section" id="overview-section">${sectionHeaderBar(vars.company_name, vars.report_date)}<div class="label">Brand & Progress</div><h2>Brand Context And Performance Progress</h2><div class="grid-2"><article class="card no-break"><h3>Brand Context</h3>${brandContextLines.length ? brandContextLines.map((line) => `<p>${escapeHtml(line)}</p>`).join('') : renderFillQuote('Brand Context', 'Stronger company context here will make future recommendations read less inferred and more market-specific.')}${unifiedNarrative ? `<hr class="divider" /><h3>Unified Direction</h3><p>${escapeHtml(unifiedNarrative)}</p>` : ''}${growthDirection.length ? `<div style="margin-top:10px;">${growthDirection.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}</div>` : ''}${executionSequence.length || decisionTimeline.length ? `<hr class="divider" /><h3>Execution Timeline</h3>${executionSequence.length ? `<div class="label">Sequence</div>${executionSequence.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}` : ''}${decisionTimeline.length ? `<div class="label" style="margin-top:10px;">Expected Impact</div>${decisionTimeline.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}` : ''}` : ''}</article><article class="card no-break"><h3>Performance Progress</h3>${progressItems.map((item) => `<div style="margin-bottom:10px;"><div class="label">${escapeHtml(item.label)}</div><div class="${item.score == null ? 'score-missing' : 'score-med'}">${escapeHtml(displayScore(item.score, item.score == null ? 'MISSING' : 'AVAILABLE'))}</div><div class="bar-track"><div class="bar-fill ${item.score != null && item.score < 30 ? 'bar-fill-red' : item.score != null && item.score < 50 ? 'bar-fill-amber' : 'bar-fill-green'}" style="width:${item.score == null ? 0 : clampPercent(item.score)}%"></div></div></div>`).join('')}<hr class="divider" /><h3>SEO Readiness</h3>${seoSummaryCards.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}${sectionStatuses['section-5'] === 'complete' ? '<div class="pending-note">Full SEO section is expanded below on this page.</div>' : '<div class="pending-note">This summary stays visible even when deeper SEO data is still partial.</div>'}${keywordGapEligible && sectionStatuses['section-4'] !== 'complete' && keywordGapSummary ? `<hr class="divider" /><h3>Keyword Gap Analysis</h3>${keywordGapSummary.missing_keywords.length ? `<p><strong>Missing:</strong> ${escapeHtml(keywordGapSummary.missing_keywords.slice(0, 4).join(', '))}</p>` : ''}${keywordGapSummary.weak_keywords.length ? `<p><strong>Weak:</strong> ${escapeHtml(keywordGapSummary.weak_keywords.slice(0, 4).join(', '))}</p>` : ''}${keywordGapSummary.strong_keywords.length ? `<p><strong>Strong:</strong> ${escapeHtml(keywordGapSummary.strong_keywords.slice(0, 4).join(', '))}</p>` : ''}` : ''}</article></div></div>`;
}

export function renderSection3PerformanceScores(payload: PdfReportPayload, vars: Record<string, string>): string {
  const visuals = payload.seoVisuals;
  const geo = payload.geoAeoExecutiveSummary;
  const aiReady = hasRealAiVisibilityData(payload);
  const dimensions = [
    ['Content Quality', visuals?.seoCapabilityRadar.content_quality_score ?? null, toUpperStrength(visuals?.seoCapabilityRadar.data_source_strength?.content_quality_score), 'Measures whether core pages answer buyer questions with enough depth.'],
    ['Publishing Frequency', visuals?.seoCapabilityRadar.rank_tracking_score ?? null, toUpperStrength(visuals?.seoCapabilityRadar.data_source_strength?.rank_tracking_score), 'Shows whether publishing depth is strong enough to sustain momentum.'],
    ['Reach', visuals?.searchVisibilityFunnel.impressions ?? null, (visuals?.searchVisibilityFunnel.impressions ?? 0) > 0 ? 'AVAILABLE' : 'MISSING', 'Captures current search reach from available signals.'],
    ['Engagement', visuals?.searchVisibilityFunnel.ctr != null ? Math.round((visuals.searchVisibilityFunnel.ctr ?? 0) * 100) : null, visuals?.searchVisibilityFunnel.ctr != null ? 'AVAILABLE' : 'MISSING', 'Reflects whether impressions are converting into visits.'],
    ['Authority', visuals?.seoCapabilityRadar.backlinks_score ?? null, toUpperStrength(visuals?.seoCapabilityRadar.data_source_strength?.backlinks_score), 'Indicates how established the domain appears relative to the market.'],
    ['Conversion', visuals?.opportunityCoverageMatrix.opportunities?.[0]?.coverage_score ?? null, visuals?.opportunityCoverageMatrix.opportunities?.length ? 'AVAILABLE' : 'MISSING', 'Represents how clearly high-intent pages guide a buyer toward action.'],
    ['Coverage', visuals?.opportunityCoverageMatrix.opportunities?.length ? Math.round(visuals.opportunityCoverageMatrix.opportunities.reduce((sum, item) => sum + Number(item.coverage_score ?? 0), 0) / visuals.opportunityCoverageMatrix.opportunities.length) : null, visuals?.opportunityCoverageMatrix.opportunities?.length ? 'AVAILABLE' : 'MISSING', 'Shows how much of the demand landscape the report can measure.'],
    ['Platforms', null, 'MISSING', 'Platform strength needs wider distribution data to score accurately.'],
    ['AEO Readiness', aiReady ? (geo?.overallAiVisibilityScore ?? null) : null, aiReady ? 'AVAILABLE' : 'MISSING', 'Shows how ready the site is for answer engines and AI discovery.'],
  ] as const;
  return `<div class="report-section" id="section-3">${sectionHeaderBar(vars.company_name, vars.report_date)}<div class="label">Performance Scores</div><h2>Performance Scores</h2><div class="grid-3">${dimensions.map((item) => { const shown = displayScore(item[1], item[2]); const barClass = shown === '--' ? '' : Number(item[1]) >= 50 ? 'bar-fill-green' : Number(item[1]) >= 30 ? 'bar-fill-amber' : 'bar-fill-red'; return `<div class="card"><div class="label">${escapeHtml(item[0])}</div><div class="${shown === '--' ? 'score-missing' : 'score-med'}">${escapeHtml(shown)}</div><div class="bar-track"><div class="bar-fill ${barClass}" style="width:${shown === '--' ? 0 : clampPercent(item[1])}%"></div></div><div style="font-size:11px;color:#6B7280;margin-top:4px;">${escapeHtml(item[3])}</div></div>`; }).join('')}</div></div>`;
}

export function renderSection4CompetitorIntelligence(payload: PdfReportPayload, vars: Record<string, string>, competitorEligible: boolean, keywordGapEligible: boolean): string {
  const competitor = payload.competitorIntelligenceSummary;
  const visuals = payload.competitorVisuals;
  const radar = visuals?.competitorPositioningRadar;
  if (!radar) {
    return `<div class="report-section" id="section-4">${sectionHeaderBar(vars.company_name, vars.report_date)}<div class="label">Competitor Intelligence</div><h2>Competitor Intelligence</h2><div class="card-pending no-break">No competitor data available yet. Add competitor domains in settings to unlock this section.</div></div>`;
  }
  if (!competitorEligible || !visuals) {
    return `<div class="report-section" id="section-4">${sectionHeaderBar(vars.company_name, vars.report_date)}<div class="label">Competitor Intelligence</div><h2>Competitor Intelligence</h2><div class="card-pending no-break">No competitor data available yet. Add competitor domains in settings to unlock this section.</div></div>`;
  }
  return `<div class="report-section" id="section-4">${sectionHeaderBar(vars.company_name, vars.report_date)}<div class="label">Competitor Intelligence</div><h2>Competitor Intelligence</h2><div class="card card-accent-blue no-break"><h3>Competitor Positioning Radar</h3>${competitor?.primaryGap.reasoning ? `<p>${escapeHtml(competitor.primaryGap.reasoning)}</p>` : ''}<div style="margin-top:12px;">${visuals.competitorPositioningRadar.competitors.slice(0, 3).map((item) => `<div class="comp-row"><div class="comp-label">${escapeHtml(item.name)}</div><div class="comp-bars"><div class="comp-bar-user" style="width:${clampPercent(item.content_score)}%;"></div><div class="comp-bar-comp" style="width:${clampPercent(item.authority_score)}%;"></div></div><div class="comp-val">C ${escapeHtml(displayScore(item.content_score, 'AVAILABLE'))} / A ${escapeHtml(displayScore(item.authority_score, 'AVAILABLE'))}</div></div>`).join('')}</div></div>${keywordGapEligible ? `<div class="card card-accent-amber no-break" style="margin-top:12px;"><h3>Keyword Gap Analysis</h3>${visuals.keywordGapAnalysis.missing_keywords.length ? `<p><strong>Missing:</strong> ${escapeHtml(visuals.keywordGapAnalysis.missing_keywords.slice(0, 4).join(', '))}</p>` : ''}${visuals.keywordGapAnalysis.weak_keywords.length ? `<p><strong>Weak:</strong> ${escapeHtml(visuals.keywordGapAnalysis.weak_keywords.slice(0, 4).join(', '))}</p>` : ''}${visuals.keywordGapAnalysis.strong_keywords.length ? `<p><strong>Strong:</strong> ${escapeHtml(visuals.keywordGapAnalysis.strong_keywords.slice(0, 4).join(', '))}</p>` : ''}</div>` : ''}</div>`;
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
  return `<div class="report-section" id="section-5">${sectionHeaderBar(vars.company_name, vars.report_date)}<div class="label">SEO Deep Dive</div><h2>SEO Deep Dive</h2>${gscDisclaimer}<div class="grid-2">${subScores.map((item) => `<article class="card no-break"><div class="label">${escapeHtml(item[0])}</div><div class="${displayScore(item[1], item[2]) === '--' ? 'score-missing' : 'score-med'}">${escapeHtml(displayScore(item[1], item[2]))}</div><div class="bar-track"><div class="bar-fill ${displayScore(item[1], item[2]) === '--' ? '' : Number(item[1]) >= 50 ? 'bar-fill-green' : Number(item[1]) >= 30 ? 'bar-fill-amber' : 'bar-fill-red'}" style="width:${displayScore(item[1], item[2]) === '--' ? 0 : clampPercent(item[1])}%"></div></div><div style="font-size:11px;color:#6B7280;margin-top:4px;">${item[2] === 'MISSING' ? 'Pending - connect GSC' : escapeHtml(item[2])}</div></article>`).join('')}</div><div class="grid-2" style="margin-top:12px;"><article class="card no-break"><h3>Strong Keywords</h3>${strongKeywords.length ? `<p>${escapeHtml(strongKeywords.slice(0, 6).join(', '))}</p>` : '<div class="pending-note">No strong keywords available yet.</div>'}</article><article class="card no-break"><h3>Crawl Health Breakdown</h3><p>Metadata ${escapeHtml(displayScore(visuals?.crawlHealthBreakdown.metadata_issues ?? null, visuals ? 'AVAILABLE' : 'MISSING'))}</p><p>Structure ${escapeHtml(displayScore(visuals?.crawlHealthBreakdown.structure_issues ?? null, visuals ? 'AVAILABLE' : 'MISSING'))}</p><p>Internal Links ${escapeHtml(displayScore(visuals?.crawlHealthBreakdown.internal_link_issues ?? null, visuals ? 'AVAILABLE' : 'MISSING'))}</p><p>Crawl Depth ${escapeHtml(displayScore(visuals?.crawlHealthBreakdown.crawl_depth_issues ?? null, visuals ? 'AVAILABLE' : 'MISSING'))}</p></article></div></div>`;
}

export function renderSection6AiVisibility(payload: PdfReportPayload, vars: Record<string, string>, aiEligible: boolean): string {
  const geo = payload.geoAeoExecutiveSummary;
  const visuals = payload.geoAeoVisuals;
  const actions = (geo?.top3Actions ?? []).slice(0, 3);
  const aiDisclaimer = !aiEligible
    ? renderInlineDisclaimer('missing', 'AI answer visibility is based on structural signals only.', 'Limited AI visibility')
    : '';
  return `<div class="report-section" id="section-6">${sectionHeaderBar(vars.company_name, vars.report_date)}<div class="label">AI Visibility</div><h2>AI Visibility</h2>${aiDisclaimer}${aiEligible && visuals ? `<div class="grid-2"><article class="card card-accent-blue no-break"><h3>AI Answer Radar</h3>${renderRadarSvg([{ label: 'Coverage', value: visuals.aiAnswerPresenceRadar.answer_coverage_score ?? 0 },{ label: 'Entities', value: visuals.aiAnswerPresenceRadar.entity_clarity_score ?? 0 },{ label: 'Authority', value: visuals.aiAnswerPresenceRadar.topical_authority_score ?? 0 },{ label: 'Citations', value: visuals.aiAnswerPresenceRadar.citation_readiness_score ?? 0 },{ label: 'Structure', value: visuals.aiAnswerPresenceRadar.content_structure_score ?? 0 },{ label: 'Freshness', value: visuals.aiAnswerPresenceRadar.freshness_score ?? 0 }])}</article><article class="card no-break"><h3>AI Visibility Readout</h3>${geo?.primaryGap.reasoning ? `<p>${escapeHtml(geo.primaryGap.reasoning)}</p>` : '<div class="pending-note">No AI visibility narrative available.</div>'}</article></div>` : '<div class="card-pending no-break">AI visibility cannot be measured yet - add structured content and FAQ sections to your key pages.</div>'}<div class="grid-3" style="margin-top:12px;">${actions.map((action, index) => `<article class="card card-accent-green no-break"><h3>${escapeHtml(action.actionTitle || `GEO/AEO action ${index + 1}`)}</h3><p>${escapeHtml(action.reasoning)}</p><div class="tags"><span class="badge badge-gray">${escapeHtml(action.priority.toUpperCase())}</span><span class="badge badge-gray">${escapeHtml(action.expectedImpact.toUpperCase())}</span><span class="badge badge-gray">${escapeHtml(action.effort.toUpperCase())}</span></div></article>`).join('')}</div></div>`;
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
  const actionsMarkup = visibleActions.length ? `<div style="margin-top:12px;">${visibleActions.map((action, index) => renderMasterActionCard(action, index)).join('')}</div>` : '';
  return `<div class="report-section" id="section-7">${sectionHeaderBar(vars.company_name, vars.report_date)}<div class="label">Backlink & Authority</div><h2>Backlink & Authority</h2>${backlinkDisclaimer}${inferredNote}${backlinkStrength === 'STRONG' || backlinkStrength === 'INFERRED' ? `<div class="backlink-summary"><div class="backlink-meta">${backlinkScoreCard}${secondaryMetrics ? `<div>${secondaryMetrics}</div>` : ''}</div>${authorityProfileCard}</div>${actionsMarkup}` : `<div class="card-pending no-break">Backlink data pending. Backlinks show where external sites cite and trust your domain. They matter because authority supports search visibility, credibility, and commercial page performance.</div>${actionsMarkup}`}</div>`;
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
  const nextScore = Math.min(100, currentScore + Math.max(3, mergedActions.filter((item) => item.priority === 'HIGH').length * 2));
  const futureScore = Math.min(100, nextScore + Math.max(4, mergedActions.length * 2));
  return `<div class="report-section" id="section-8">${sectionHeaderBar(vars.company_name, vars.report_date)}<div class="label">Action Plan</div><h2>Action Plan</h2><div class="traj-row no-break"><div class="traj-step"><div class="lbl">Current</div><div class="num">${escapeHtml(displayScore(currentScore, 'AVAILABLE'))}</div></div><div class="traj-arrow">-></div><div class="traj-step"><div class="lbl">Next</div><div class="num">${escapeHtml(displayScore(nextScore, 'AVAILABLE'))}</div></div><div class="traj-arrow">-></div><div class="traj-step"><div class="lbl">Future</div><div class="num">${escapeHtml(displayScore(futureScore, 'AVAILABLE'))}</div></div></div><div style="margin-top:12px;">${mergedActions.map((action, index) => renderMasterActionCard(action, index)).join('')}</div><div class="grid-3" style="margin-top:12px;"><div class="card"><div class="label">0-30 days</div><div>${escapeHtml(mergedActions.slice(0, 2).map((item) => item.title).filter(Boolean).join(' / '))}</div></div><div class="card"><div class="label">31-60 days</div><div>${escapeHtml(mergedActions.slice(2, 4).map((item) => item.title).filter(Boolean).join(' / '))}</div></div><div class="card"><div class="label">61-90 days</div><div>${escapeHtml(mergedActions.slice(4).map((item) => item.title).filter(Boolean).join(' / '))}</div></div></div></div>`;
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

  return `<div class="report-section data-coverage-page" id="coverage-page"><div class="label">Data Confidence & Coverage</div><h2>Data Confidence & Coverage</h2><div class="section-intro"><p>This report combines available signals with intelligent inference. Some insights are directional due to limited connected data sources. As more systems are connected, accuracy, depth, and confidence improve automatically.</p></div><div class="coverage-summary-strip no-break"><div class="coverage-summary-item"><div class="label">Overall Confidence</div><div class="score-med">${escapeHtml(overallConfidence)}</div></div><div class="coverage-summary-item"><div class="label">Coverage Level</div><div class="score-med">${escapeHtml(coverageLevel)}</div></div><div class="coverage-summary-item"><div class="label">Data Sources Connected</div><div class="score-med">${connectedCount} / ${dataSources.length}</div></div></div><div class="data-source-grid">${dataSources.map((source) => `<article class="card no-break data-source-card"><div class="data-source-head"><div><div class="label">${escapeHtml(source.name)}</div><h3>${escapeHtml(source.status === 'connected' ? 'Connected' : source.status === 'partial' ? 'Partial' : 'Missing')}</h3></div><span class="badge ${source.status === 'connected' ? 'badge-green' : source.status === 'partial' ? 'badge-amber' : 'badge-red'}">${escapeHtml(source.confidence.toUpperCase())} confidence</span></div><div class="stack-10"><div><div class="label">Current State</div><p>${escapeHtml(source.currentState)}</p></div><div><div class="label">Impact On Report</div><p>${escapeHtml(source.impact)}</p></div><div><div class="label">What Unlocks</div><ul class="simple-list">${source.unlocks.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div></div></article>`).join('')}</div><div class="grid-2" style="margin-top:12px;"><article class="card card-accent-amber no-break"><h3>What This Means</h3><ul class="simple-list"><li>Insights are directional, not exhaustive.</li><li>Gaps identified are likely larger than what is currently visible.</li><li>Opportunities may deliver stronger results than estimated today.</li></ul></article><article class="card card-accent-blue no-break"><h3>What Improves Next</h3><ul class="simple-list"><li>Insights become more precise.</li><li>Recommendations become more personalized.</li><li>Competitive analysis becomes more complete.</li><li>AI visibility scoring becomes more accurate.</li><li>Growth projections become more reliable.</li></ul></article></div>${capabilityCards.length ? `<div class="pending-note" style="margin-top:12px;">${escapeHtml(capabilityCards.join(' '))}</div>` : ''}</div>`;
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
      id: 'section-4',
      title: 'Competitor Intelligence',
      status: competitorEligible && keywordGapEligible ? 'complete' : competitorEligible ? 'partial' : 'missing',
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

