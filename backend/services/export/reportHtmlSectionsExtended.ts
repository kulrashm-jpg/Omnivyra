/** Report HTML sections — extended sections + spec assembly — split from reportHtmlSections.ts (barrel preserved; importers unchanged). */
import type { PdfReportPayload } from './reportPdfRenderer';
import type { SnapshotSectionStatus } from './reportHtmlNarrativeFlows';
import { renderGeoAeoFlow, renderSocialPlatformFlow, renderTrajectoryFlow, renderConfidenceFlow, renderNextLevelCtaFlow } from './reportHtmlNarrativeFlows';
import { collectMasterActions, deriveDataSources, inferMasterActionTrack, renderInlineDisclaimer, renderMasterActionCard, scoreMetricCard, toUpperStrength, type DerivedDataSource, type MasterAction } from './reportHtmlActionDataHelpers';
import { sectionHeaderBar } from './html/htmlHelpers';
import { displayScore, formatSignedGap, getStateBadgeClass, getStateBarClass, getStateTone, renderBarSvg, renderBeforeAfter, renderCalloutBox, renderCompactBulletLine, renderComparisonBar, renderExecutiveInsights, renderFillQuote, renderInlineSummary, renderMetricGrid, renderMetricRowCard, renderMiniMetrics, renderNarrativeGroup, renderPagePrintHeader, renderPerformanceScoreRow, renderRadarSvg, renderReportBlock, renderScoreComparison, renderScoreDonut, renderTrendSvg, renderVisualMetricBlock, stripLeadingSectionHeader } from './reportHtmlVisualPrimitives';
import { clampPercent, escapeHtml, getOverallScore, hasContent, hasNonEmptyList, hasRealAiVisibilityData, safeText, stripRepeatedSentences, stripTimelinePrefix } from './reportHtmlCoreUtils';
import { hasPassedFinalCompetitorGate } from '../competitorEngineService';

import { type SnapshotSectionSpec, renderSubsection, renderSection1Cover, renderSection2StrategicPosition, renderSectionOverview, renderSection3PerformanceScores, renderSectionScoreDrivers, renderSection4CompetitorIntelligence } from './reportHtmlSectionsCore';

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
    // Guarded: `primaryGap` is null when AI evidence could not name one, and the optional
    // chain stops at `geo`. Falling through to the pending note states the absence honestly.
    const readoutCard = `<article class="card no-break"><h3>AI Visibility Readout</h3>${geo?.primaryGap?.reasoning ? `<p>${escapeHtml(geo.primaryGap.reasoning)}</p>` : '<div class="pending-note">No AI visibility narrative available.</div>'}${geo?.visibilityOpportunity ? `<hr class="divider" /><div class="label">Visibility opportunity</div><p><strong>${escapeHtml(geo.visibilityOpportunity.title)}</strong></p><p>${escapeHtml(geo.visibilityOpportunity.estimatedAiExposure)}</p><p>${escapeHtml(geo.visibilityOpportunity.basedOn)}</p>` : ''}</article>`;
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

