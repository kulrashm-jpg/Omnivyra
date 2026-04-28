import type { PdfReportPayload } from './reportPdfRenderer';
import {
  collectMasterActions,
  deriveDataSources,
  renderMasterActionCard,
  type MasterAction,
} from './reportHtmlActionDataHelpers';
import {
  displayScore,
  renderBeforeAfter,
  renderComparisonBar,
  renderExecutiveInsights,
  renderNarrativeGroup,
  renderPerformanceScoreRow,
  renderReportBlock,
  renderScoreDonut,
  renderVisualMetricBlock,
} from './reportHtmlVisualPrimitives';
import {
  escapeHtml,
  getOverallScore,
  hasRealAiVisibilityData,
  safeText,
  stripTimelinePrefix,
} from './reportHtmlCoreUtils';

export type SnapshotSectionStatus = 'complete' | 'partial' | 'missing';

function estimateBlockUnits(text: string, base = 8): number {
  return base + Math.min(18, Math.ceil((text || '').length / 80));
}

export function renderHookFlow(payload: PdfReportPayload, vars: Record<string, string>): string {
  const overallScore = getOverallScore(payload);
  const movement = safeText(
    payload.competitorMovementComparison?.summary.overall_trend
    || payload.unifiedIntelligenceSummary?.dominantGrowthChannel
    || 'stable',
    1,
  );
  const actions = collectMasterActions(payload);
  const topConstraint = [
    payload.seoVisuals?.seoCapabilityRadar.content_quality_score != null ? { label: 'Content', score: payload.seoVisuals.seoCapabilityRadar.content_quality_score } : null,
    payload.seoVisuals?.seoCapabilityRadar.backlinks_score != null ? { label: 'Authority', score: payload.seoVisuals.seoCapabilityRadar.backlinks_score } : null,
    hasRealAiVisibilityData(payload) ? { label: 'AI', score: payload.geoAeoExecutiveSummary?.overallAiVisibilityScore ?? null } : null,
  ]
    .filter(Boolean)
    .sort((a, b) => Number(a?.score ?? 0) - Number(b?.score ?? 0))[0];
  const benchmark = 50;
  const constraintScore = Number(topConstraint?.score ?? 0);
  const missedDemandPct = Math.max(18, Math.min(72, benchmark - Math.min(constraintScore || benchmark, benchmark) + 18));
  const primaryAction =
    actions.find((action) => /comparison|decision|\/vs\/|alternative|competitor/i.test(`${action.title} ${action.reasoning} ${action.tactics.join(' ')}`))
    || actions.find((action) => /authority|backlink|proof/i.test(`${action.title} ${action.reasoning} ${action.tactics.join(' ')}`))
    || actions[0];
  const hookTitle = 'You Are Currently Losing High-Intent Demand';
  const hookStatement = `Based on available signals, a significant share of high-intent search demand in your category is going to competitors with stronger authority and decision-stage content.`;
  const businessList = [
    'Potential customers are finding competitors instead of you.',
    'Your visibility is not translating into qualified demand.',
    'Growth is being left to chance, not engineered.',
  ];
  let page1Insights = [
    { title: 'This report identifies 3 structural constraints', impact: 'Each is backed by evidence and sequenced for execution. See Core Growth Constraints below.', highImpact: true },
    { title: 'A prioritised execution roadmap is included', impact: 'Week-by-week actions with specific page templates, not generic advice.' },
    { title: 'Data limitations are clearly disclosed', impact: 'Confidence levels mark what is confirmed vs directional. See How This Analysis Is Built.' },
  ];
  let whatThisMeansItems = businessList.slice();
  let showReadThisFirst = true;
  let showScoreStory = true;
  let pageUnits = 0;
  pageUnits += estimateBlockUnits(hookTitle + hookStatement, 24);
  pageUnits += estimateBlockUnits(String(overallScore), 18);
  pageUnits += estimateBlockUnits(String(topConstraint?.label || 'Authority Gap'), 14);
  pageUnits += estimateBlockUnits(page1Insights.map((item) => `${item.title} ${item.impact}`).join(' '), 16);
  pageUnits += estimateBlockUnits(whatThisMeansItems.join(' '), 12);
  pageUnits += 10;
  pageUnits += 10;
  if (pageUnits > 100) {
    showReadThisFirst = false;
    pageUnits -= 10;
  }
  if (pageUnits > 100) {
    whatThisMeansItems = [businessList.join(' ')];
    pageUnits -= 6;
  }
  if (pageUnits > 100) {
    page1Insights = page1Insights.slice(0, 2);
  }
  if (pageUnits > 100) {
    showScoreStory = false;
  }
  const executiveInsights = page1Insights.length
    ? renderExecutiveInsights(page1Insights)
    : `<div class="executive-insights"><h3>What This Report Covers</h3><ul class="simple-list"><li>3 structural constraints identified with evidence and business impact.</li><li>A priority-tiered execution roadmap with specific page templates.</li><li>Data methodology and confidence levels clearly disclosed.</li></ul></div>`;
  const scoreStory = 'This score reflects the combined strength of content, authority, and discoverability signals measured from publicly available data. See Core Growth Constraints for the specific issues.';
  const growthReason = 'Your current performance is limited by structural gaps, not effort.';
  const scoreMeaning = [
    'This score reflects how ready your current digital presence is to compete for discovery, trust, and conversion.',
    'A lower score usually means competitors are easier to find, easier to trust, and easier to choose.',
    `A ${safeText(movement || 'stable', 1).toLowerCase()} movement means the current signal pattern is not yet shifting fast enough to change market position.`,
  ];
  const reportPurpose = ['Read below to see why growth is being suppressed, where the problems sit, and what to fix first to move forward with more confidence.'];
  const scoreDonut = renderScoreDonut(overallScore, { size: 'lg', label: 'Snapshot Score' });
  // Show the brand identity once: logo (when available) OR the company
  // name as text. The "name | website" line below drops the name when a
  // logo is shown so we don't double up.
  const heroLogoMarkup = vars.company_logo_url
    ? `<img class="cover-logo" src="${escapeHtml(vars.company_logo_url)}" alt="${escapeHtml(vars.company_name)} logo" />`
    : '';
  const heroIdentityLine = vars.company_logo_url
    ? `${escapeHtml(vars.website_url)}`
    : `${escapeHtml(vars.company_name)} | ${escapeHtml(vars.website_url)}`;
  return renderNarrativeGroup('section-1', 'Where You Stand', 'Snapshot Hook', [
    renderReportBlock('score-card', `<div class="page-hero-cover"><div class="page-hero-header"><div class="label">Digital Authority Snapshot, <span class="page-hero-date">${escapeHtml(vars.report_date)}</span></div></div><div class="grid-2 page-hero-grid"><div class="stack-12"><article class="card no-break cover-score-panel"><div class="label">Snapshot Score</div><div class="cover-score-circle">${scoreDonut}</div>${heroLogoMarkup}<div class="cover-url cover-url-strong">${heroIdentityLine}</div><div class="tags cover-tags cover-tags-strong"><span class="badge badge-amber">${escapeHtml(vars.stage_label || '--')}</span><span class="badge badge-green">${escapeHtml(vars.confidence_label || '--')}</span><span class="badge badge-blue">${escapeHtml(movement || '--')}</span></div></article><article class="card no-break"><h3>Why Your Score Is ${escapeHtml(displayScore(overallScore, 'AVAILABLE'))}</h3><p>${escapeHtml(scoreStory)}</p></article><article class="card no-break"><h3>Why You Are Not Growing</h3><p>${escapeHtml(growthReason)}</p></article><article class="card card-accent-amber no-break cover-action-panel"><h3>Core Constraint</h3><p><strong>${escapeHtml(topConstraint?.label || 'Authority Gap')}: ${escapeHtml(displayScore(topConstraint?.score ?? null, topConstraint ? 'AVAILABLE' : 'MISSING'))} vs ${benchmark}+</strong></p><p>This gap is large enough to suppress competitive visibility even if you publish more content.</p><hr class="divider" /><h3>The One Move That Changes Everything</h3><p><strong>${escapeHtml(primaryAction?.title || 'Build comparison and decision-stage pages')}</strong></p>${primaryAction?.timeline ? `<div class="timeline"><div class="timeline-item"><strong>2-4 weeks:</strong> ${escapeHtml(stripTimelinePrefix(primaryAction.timeline.short, '2-4 weeks') || 'Directional movement should appear on the target pages first.')}</div><div class="timeline-item"><strong>1-3 months:</strong> ${escapeHtml(stripTimelinePrefix(primaryAction.timeline.mid, '1-3 months') || 'Stronger click quality and page-level engagement should become visible.')}</div><div class="timeline-item"><strong>3-6 months:</strong> ${escapeHtml(stripTimelinePrefix(primaryAction.timeline.long, '3-6 months') || 'The change should compound into better qualified discovery and conversion readiness.')}</div></div>` : `<div class="timeline"><div class="timeline-item"><strong>2-4 weeks:</strong> Directional movement should appear on the target pages first.</div><div class="timeline-item"><strong>1-3 months:</strong> Stronger click quality and page-level engagement should become visible.</div><div class="timeline-item"><strong>3-6 months:</strong> The change should compound into better qualified discovery and conversion readiness.</div></div>`}</article></div><div class="stack-12"><article class="card card-accent-red no-break cover-context-panel"><h1>${escapeHtml(hookTitle)}</h1><p>${escapeHtml(hookStatement)}</p><div class="cover-explainer"><div class="cover-explainer-block meaning-block"><div class="label">What ${escapeHtml(displayScore(overallScore, 'AVAILABLE'))}, ${escapeHtml(vars.stage_label || '--')}, ${escapeHtml(vars.confidence_label || '--')}, And ${escapeHtml(movement || '--')} Mean</div>${scoreMeaning.map((item) => `<p>${escapeHtml(item)}</p>`).join('')}</div><div class="cover-explainer-block competition-block"><div class="label">What It Means Competitively</div><p>${escapeHtml(whatThisMeansItems.join(' '))}</p></div><div class="cover-explainer-block why-read-block">${reportPurpose.map((item) => `<p>${escapeHtml(item)}</p>`).join('')}</div></div></article><article class="card no-break">${executiveInsights}</article></div></div></div>`, { className: 'report-block-hero', group: 'section-1' }),
    ...(showReadThisFirst ? [renderReportBlock('insight', '<div class="card no-break intro-block"><strong>Read This First</strong><p>This report answers one question:</p><p><strong>What is the fastest way to turn your current presence into growth?</strong></p></div>', { group: 'section-1', fill: true })] : []),
  ], { hideHeading: true });
}

export function renderRealityFlow(payload: PdfReportPayload): string {
  const benchmark = 50;
  const seoScore = payload.seoExecutiveSummary?.overallHealthScore ?? null;
  const authorityScore = payload.seoVisuals?.seoCapabilityRadar.backlinks_score ?? null;
  const contentScore = payload.seoVisuals?.seoCapabilityRadar.content_quality_score ?? null;
  const aiScore = hasRealAiVisibilityData(payload) ? (payload.geoAeoExecutiveSummary?.overallAiVisibilityScore ?? null) : null;

  const performanceRow = renderPerformanceScoreRow([
    { label: 'SEO', score: seoScore, benchmark, note: undefined },
    { label: 'Authority', score: authorityScore, benchmark, note: undefined },
    { label: 'Content', score: contentScore, benchmark, note: undefined },
    { label: 'AI Visibility', score: aiScore, benchmark, note: undefined },
  ]);

  // Each constraint: unique insight + business impact + evidence + consequence
  const constraints = [
    {
      label: 'CONSTRAINT 1',
      color: '#991B1B', bg: '#FEF1EF',
      title: 'Authority signals are below competitive threshold',
      impact: `Domain authority at ${authorityScore ?? '--'} vs 50+ benchmark means search engines deprioritise your pages regardless of content quality.`,
      evidence: 'Inferred from backlink profile strength, domain trust signals, and competitor authority benchmarking.',
      ignored: 'Content investment will underperform until authority reaches competitive parity. Rankings stay suppressed.',
    },
    {
      label: 'CONSTRAINT 2',
      color: '#B45309', bg: '#FEF4E4',
      title: 'No decision-stage content exists for comparison searches',
      impact: 'Buyers searching "best [category] tools" or "[product] vs [competitor]" cannot find you. They find and choose competitors instead.',
      evidence: 'Page-level analysis shows no /vs/, comparison, or alternatives content. Coverage is limited to awareness-stage topics.',
      ignored: 'High-intent traffic — the most likely to convert — will continue going to competitors with comparison pages.',
    },
    {
      label: 'CONSTRAINT 3',
      color: '#0077B6', bg: '#E3F0FA',
      title: 'No connected keyword data means growth decisions are blind',
      impact: 'Without search demand data, content is created on assumption rather than evidence. Effort may target low-value topics.',
      evidence: 'Google Search Console is not connected. Keyword research and rank tracking scores are unavailable.',
      ignored: 'Content strategy stays reactive instead of data-driven. Difficult to measure what is working.',
    },
  ];

  // constraintCards rendered individually below as separate blocks for proper page flow

  const cascade = `<div style="display:flex;align-items:center;gap:8px;justify-content:center;padding:8px 0;font-size:12px;font-weight:600;color:#4A6274;">
    <span>Low Authority</span><span style="color:#8C9DAB;">&rarr;</span>
    <span>Weak Rankings</span><span style="color:#8C9DAB;">&rarr;</span>
    <span>Low Visibility</span><span style="color:#8C9DAB;">&rarr;</span>
    <span>Poor Conversions</span>
  </div>`;

  const individualConstraintBlocks = constraints.map((c) => renderReportBlock('insight', `<article class="card no-break" style="border-left:4px solid ${c.color};background:${c.bg};">
    <div class="label" style="color:${c.color};margin-bottom:4px;">${escapeHtml(c.label)}</div>
    <h3>${escapeHtml(c.title)}</h3>
    <p style="font-size:11px;margin-bottom:4px;"><strong>Business impact:</strong> ${escapeHtml(c.impact)}</p>
    <p style="font-size:11px;margin-bottom:4px;"><strong>Evidence:</strong> ${escapeHtml(c.evidence)}</p>
    <p style="font-size:11px;margin:0;"><strong>If ignored:</strong> ${escapeHtml(c.ignored)}</p>
  </article>`, { group: 'section-2' }));

  return renderNarrativeGroup('section-2', 'Core Growth Constraints', 'What Is Blocking Growth', [
    renderReportBlock('chart', `<h2>Core Growth Constraints</h2><p style="margin-bottom:6px;">This section identifies three structural issues that are currently suppressing growth regardless of how much content or effort is being invested. Each constraint must be addressed in the sequence shown below — later actions depend on earlier ones being resolved first.</p>`, { group: 'section-2' }),
    renderReportBlock('chart', `<div class="label" style="margin-bottom:4px;">Current Scores</div>${performanceRow}`, { group: 'section-2' }),
    ...individualConstraintBlocks,
    renderReportBlock('insight', cascade, { group: 'section-2' }),
  ]);
}

export function renderInsightsFlow(payload: PdfReportPayload): string {
  return renderNarrativeGroup('section-3', 'Methodology', 'How This Analysis Is Built', [
    renderReportBlock('insight', `<h2>How This Analysis Is Built</h2><p style="margin-bottom:8px;">Understanding what this report can and cannot tell you.</p>`, { group: 'section-3' }),
    renderReportBlock('insight', `<div class="grid-2">
      <article class="card no-break" style="border-left:4px solid #1B7340;background:#E6F4EC;">
        <h3>What This Report Uses</h3>
        <ul class="simple-list">
          <li>Public domain and crawl data (page structure, content, metadata)</li>
          <li>Authority signal inference (backlink heuristics, domain trust)</li>
          <li>Competitive positioning from publicly available competitor profiles</li>
          <li>AI visibility structural readiness (FAQ blocks, heading hierarchy, answer format)</li>
        </ul>
      </article>
      <article class="card no-break" style="border-left:4px solid #B45309;background:#FEF4E4;">
        <h3>What This Report Does Not Have</h3>
        <ul class="simple-list">
          <li>Google Search Console data (keyword rankings, impressions, clicks)</li>
          <li>Google Analytics or conversion tracking</li>
          <li>Backlink tool data (Ahrefs, Moz, Semrush) unless connected</li>
          <li>Internal business metrics (revenue, lead volume, pipeline)</li>
        </ul>
      </article>
    </div>`, { group: 'section-3' }),
    renderReportBlock('insight', `<div class="card no-break"><h3>What This Means For Accuracy</h3>
      <p style="font-size:11.5px;margin-bottom:4px;">Insights in this report are <strong>directional, not absolute</strong>. Gaps identified are likely <strong>underestimates</strong> — connecting more data sources will reveal a fuller picture.</p>
      <p style="font-size:11.5px;margin:0;">Confidence levels (High, Medium, Low) are marked throughout. Treat low-confidence sections as starting points for investigation, not definitive conclusions.</p>
    </div>`, { group: 'section-3' }),
  ]);
}

export function renderCompetitorFlow(payload: PdfReportPayload): string {
  const gapTitle = safeText(payload.competitorIntelligenceSummary?.primaryGap.title || 'Competitor pressure is higher than it should be.', 1);
  const gapReason = safeText(payload.competitorIntelligenceSummary?.primaryGap.reasoning || 'Competitors are easier to compare, trust, and choose.', 2);

  const radar = payload.competitorVisuals?.competitorPositioningRadar;
  const userAuthority = radar?.user?.authority_score ?? null;
  const userContent = payload.seoVisuals?.seoCapabilityRadar.content_quality_score ?? null;
  const competitorAvgAuthority = radar?.competitors?.length
    ? Math.round(radar.competitors.reduce((sum, c) => sum + Number(c.authority_score ?? 0), 0) / radar.competitors.length)
    : 85;
  const competitorAvgContent = radar?.competitors?.length
    ? Math.round(radar.competitors.reduce((sum, c) => sum + Number(c.content_score ?? 0), 0) / radar.competitors.length)
    : 80;

  const youVsCompetitors = `<div class="grid-2" style="margin-top:12px;">
    <article class="card no-break">
      <h3>You</h3>
      <p>Authority: ${userAuthority ?? '--'}</p>
      <p>Content Depth: ${userContent ?? '--'}</p>
      <p>Low decision-stage presence.</p>
    </article>
    <article class="card no-break">
      <h3>Competitors</h3>
      <p>Authority: ${competitorAvgAuthority}+</p>
      <p>Content Depth: ${competitorAvgContent}+</p>
      <p>Strong comparison capture.</p>
    </article>
  </div>`;

  const missedOpportunity = `<div class="card no-break" style="border:2px solid #B45309;background:#FEF4E4;padding:10px 14px;">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;"><span style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#B45309;">Missed Opportunity</span></div>
    <p style="font-size:11.5px;margin:0;">Every day without comparison content, high-intent searches like <strong>"best ${escapeHtml(safeText(payload.companyContext?.marketContext || 'marketing', 1).split('/')[0].trim().toLowerCase())} tools"</strong> or <strong>"${escapeHtml(safeText(payload.companyContext?.companyName || 'your product', 1))} vs [competitor]"</strong> send qualified buyers directly to competitors who have those pages.</p>
  </div>`;

  return renderNarrativeGroup('section-4', 'Competitive Pressure', 'Competitive Reality', [
    renderReportBlock('insight', `<h2>Where You Stand vs Competitors</h2><p style="margin-bottom:8px;">A side-by-side view of your digital signals against the competitive benchmark.</p>`, { group: 'section-4' }),
    renderReportBlock('insight', `<div class="card no-break"><h3>${escapeHtml(gapTitle)}</h3><p>${escapeHtml(gapReason)}</p></div>`, { group: 'section-4' }),
    renderReportBlock('insight', youVsCompetitors, { group: 'section-4' }),
    renderReportBlock('insight', missedOpportunity, { group: 'section-4' }),
  ]);
}

export function renderPositionFlow(payload: PdfReportPayload, vars: Record<string, string>): string {
  const offering = safeText(payload.companyContext?.primaryOffering, 1) || 'AI-driven digital marketing system';
  const market = safeText(payload.companyContext?.marketContext, 1) || `SaaS / Software in Global`;
  const differentiation = safeText(payload.companyContext?.positioningNarrative || payload.companyContext?.tagline, 1);
  const marketPosition = safeText(payload.companyContext?.marketPositionStatement || payload.companyContext?.marketNarrative, 1);

  const authorityScore = payload.seoVisuals?.seoCapabilityRadar.backlinks_score ?? null;
  const contentScore = payload.seoVisuals?.seoCapabilityRadar.content_quality_score ?? null;
  const aiScore = hasRealAiVisibilityData(payload) ? (payload.geoAeoExecutiveSummary?.overallAiVisibilityScore ?? null) : null;

  const marketNotice = `<div class="card card-accent-red no-break" style="margin-bottom:12px;"><h3>Where You Stand In The Market</h3><p>You are currently positioned below competitive visibility level in your category.</p><ul class="simple-list"><li>You are not consistently discovered in high-intent searches.</li><li>You are not part of comparison decisions often enough.</li><li>You are not competing where it matters most.</li></ul></div>`;

  const atAGlance = `<article class="card card-accent-blue no-break"><h3>${escapeHtml(vars.company_name)} At A Glance</h3><div class="stack-10"><div><div class="label">Products / Services</div><p>${escapeHtml(offering)}</p></div><div><div class="label">Focus</div><p>${escapeHtml(market)}</p></div>${differentiation ? `<div><div class="label">Differentiation</div><p>${escapeHtml(differentiation)}</p></div>` : ''}</div></article>`;

  const marketCard = `<article class="card no-break"><h3>Market Position</h3>${marketPosition ? `<p>${escapeHtml(marketPosition)}</p>` : '<p>Market position will sharpen as more competitive evidence is connected.</p>'}</article>`;

  const metricRow = `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:12px;">
    <div class="card no-break" style="text-align:center;"><div class="label">Authority</div><div class="score-med">${authorityScore ?? '--'}</div><p style="font-size:10px;">Market leaders: 85-90+</p></div>
    <div class="card no-break" style="text-align:center;"><div class="label">Content Depth</div><div class="score-med">${contentScore ?? '--'}</div><p style="font-size:10px;">Market leaders: 80+</p></div>
    <div class="card no-break" style="text-align:center;"><div class="label">Buying-Stage Coverage</div><div class="score-med" style="font-size:18px;">Low</div><p style="font-size:10px;">Market leaders: High</p></div>
    <div class="card no-break" style="text-align:center;"><div class="label">AI / Answer Presence</div><div class="score-missing">${aiScore ?? '--'}</div><p style="font-size:10px;">Market leaders: Strong</p></div>
  </div>`;

  const authorityComparison = renderComparisonBar('Your Authority vs Market', authorityScore, 85, 'Market Leader');

  return renderNarrativeGroup('section-5', 'Positioning Clarity', 'Strategic Position', [
    renderReportBlock('insight', marketNotice, { group: 'section-5' }),
    renderReportBlock('insight', `<div class="grid-2">${atAGlance}${marketCard}</div>`, { group: 'section-5' }),
    renderReportBlock('chart', metricRow, { group: 'section-5' }),
    renderReportBlock('chart', `<div style="margin-top:6px;">${authorityComparison}</div>`, { group: 'section-5' }),
  ]);
}

export function renderTransformationFlow(payload: PdfReportPayload): string {
  // Merged: Current vs Future + Opportunity + Quick Win — all answer "where is growth unlocked?"
  const authorityScore = payload.seoVisuals?.seoCapabilityRadar.backlinks_score ?? null;
  // Current items describe IMPACT (not restating the constraint — see Core Constraints for that)
  const currentItems = [
    'Search engines rank competitor pages above yours for buying-intent queries',
    'Buyers who search for your category find alternatives first',
    'Content effort produces traffic but not qualified leads',
  ];
  // Future items describe SPECIFIC outcomes, not generic improvements
  const futureItems = [
    'Your comparison pages appear when buyers evaluate alternatives',
    'Increased domain trust unlocks ranking potential for all existing pages',
    'Connected data reveals which content actually drives pipeline',
  ];

  const quickWin = `<div class="card no-break" style="border:2px solid #1B7340;background:#E6F4EC;padding:10px 14px;">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;"><span style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#1B7340;">Quick Win</span></div>
    <p style="font-size:11.5px;margin:0;">Create one comparison page targeting "[Your Product] vs [Top Competitor]". This single page can capture decision-stage traffic within 2-4 weeks and provides immediate evidence that the strategy works.</p>
  </div>`;

  return renderNarrativeGroup('section-6', 'Opportunity Surface', 'Where Growth Is Unlocked', [
    renderReportBlock('insight', `<h2>Where Growth Is Unlocked</h2><p style="margin-bottom:6px;">The gap between current state and available demand represents uncaptured opportunity.</p>`, { group: 'section-6' }),
    renderReportBlock('insight', `<div class="card no-break"><h3>${escapeHtml(safeText(payload.seoExecutiveSummary?.growthOpportunity?.title || 'The biggest growth upside is still available.', 1))}</h3><p>${escapeHtml(safeText(payload.seoExecutiveSummary?.growthOpportunity?.basedOn || payload.summary, 2))}</p></div>`, { group: 'section-6' }),
    renderReportBlock('chart', `<h3>Current vs After Execution</h3><div class="grid-2"><article class="card no-break" style="border-left:4px solid #991B1B;background:#FEF1EF;"><h4>Current State</h4><ul class="simple-list">${currentItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></article><article class="card no-break" style="border-left:4px solid #1B7340;background:#E6F4EC;"><h4>After Execution</h4><ul class="simple-list">${futureItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></article></div>`, { group: 'section-6' }),
    renderReportBlock('insight', quickWin, { group: 'section-6' }),
  ]);
}

// renderOpportunityFlow is now merged into renderTransformationFlow above
export function renderOpportunityFlow(_payload: PdfReportPayload): string {
  return ''; // content merged into Opportunity Surface (section-6)
}

export function renderDiagnosticsFlow(payload: PdfReportPayload, vars: Record<string, string>): string {
  const radar = payload.seoVisuals?.seoCapabilityRadar;
  const crawl = payload.seoVisuals?.crawlHealthBreakdown;
  const techSeo = radar?.technical_seo_score ?? null;
  const contentQuality = radar?.content_quality_score ?? null;
  const keywordResearch = radar?.keyword_research_score ?? null;
  const rankTracking = radar?.rank_tracking_score ?? null;

  const seoSummary = `Score summary: Technical SEO: ${techSeo ?? '--'} | Keyword Research: ${keywordResearch ?? '--'} | Rank Tracking: ${rankTracking ?? '--'} | Content Depth: ${contentQuality ?? '--'}`;

  const dimensionCards = `<div style="display:grid;grid-template-columns:30fr 70fr;gap:8px;margin-top:8px;">
    <article class="card no-break" style="text-align:center;padding:10px;">
      <div style="margin-bottom:8px;"><div class="label">Technical SEO</div><div class="score-med" style="margin-top:4px;">${techSeo ?? '--'}</div></div>
      <div><div class="label">Content Quality</div><div class="score-med" style="margin-top:4px;">${contentQuality ?? '--'}</div></div>
    </article>
    <div style="display:grid;gap:4px;">
      <article class="card no-break" style="padding:8px 12px;"><h3 style="margin-bottom:2px;">Why This Matters</h3><p style="font-size:11px;margin:0;">Technical SEO leads; weaker content, keyword, and authority dimensions constrain overall performance.</p></article>
      <article class="card no-break" style="padding:8px 12px;"><h3 style="margin-bottom:2px;">Opportunity Coverage</h3><p style="font-size:11px;margin:0;">Content: Medium gap &middot; Keywords: High gap &middot; Authority: High gap</p></article>
      <article class="card no-break" style="padding:8px 12px;"><h3 style="margin-bottom:2px;">Crawl Health</h3><p style="font-size:11px;margin:0;">Metadata: ${crawl?.metadata_issues ?? 0} | Internal Links: ${crawl?.internal_link_issues ?? 0} | Structure: Stable</p></article>
    </div>
  </div>`;

  return renderNarrativeGroup('section-8', 'Diagnostic Reality', 'SEO, Authority, And AI Visibility', [
    renderReportBlock('chart', `<h2>SEO Deep Dive</h2><p style="margin-bottom:6px;">Technical SEO is currently strongest, while weaker dimensions constrain performance.</p>`, { group: 'section-8' }),
    renderReportBlock('chart', `<div class="card no-break"><h3>SEO Summary</h3><p>${escapeHtml(seoSummary)}</p></div>`, { group: 'section-8' }),
    renderReportBlock('chart', dimensionCards, { group: 'section-8' }),
  ]);
}

export function renderAuthorityAiFlow(payload: PdfReportPayload): string {
  const authority = payload.seoVisuals?.seoCapabilityRadar.backlinks_score ?? null;
  const ai = hasRealAiVisibilityData(payload) ? (payload.geoAeoExecutiveSummary?.overallAiVisibilityScore ?? null) : null;

  const authorityDonut = renderScoreDonut(authority, { size: 'sm', label: 'Authority' });
  const hasAiData = ai != null && ai > 0;
  const aiDonut = hasAiData
    ? renderScoreDonut(ai, { size: 'sm', label: 'AI Visibility' })
    : `<div style="width:70px;height:70px;border-radius:50%;border:6px solid #E8EFF6;display:flex;align-items:center;justify-content:center;margin:0 auto;"><span style="font-size:14px;font-weight:700;color:#8C9DAB;">N/A</span></div><div class="label" style="text-align:center;margin-top:4px;">AI Visibility</div>`;

  const authorityDisclaimer = `<div class="inline-disclaimer inline-disclaimer-partial"><span class="badge badge-amber">Signal confidence: Medium (Partial authority signals)</span><p><strong>Directional signal detected.</strong> Backlink data is inferred. Connect a backlink source for full authority accuracy.</p></div>`;
  const aiDisclaimer = `<div class="inline-disclaimer inline-disclaimer-missing"><span class="badge badge-red">Signal confidence: Low (Limited AI visibility)</span><p><strong>Early-stage signal detected.</strong> AI answer visibility is based on structural signals only.</p></div>`;

  return renderNarrativeGroup('section-9', 'Authority + AI', 'Authority + AI Visibility', [
    renderReportBlock('chart', `<h2>Authority + AI Visibility</h2><p style="margin-bottom:8px;">Authority strength and answer-engine readiness determine whether your content can compete and convert.</p>`, { group: 'section-9' }),
    renderReportBlock('chart', `<div class="grid-2"><article class="card no-break" style="text-align:center;"><h3>Backlink &amp; Authority</h3><div style="margin:8px 0;">${authorityDonut}</div><p>Score: ${authority ?? '--'}</p>${authorityDisclaimer}</article><article class="card no-break" style="text-align:center;"><h3>AI Visibility</h3><div style="margin:8px 0;">${aiDonut}</div><p>${ai != null ? `Score: ${ai}` : 'AI visibility cannot be measured yet.'}</p>${aiDisclaimer}</article></div>`, { group: 'section-9' }),
  ]);
}

export function renderGeoAeoFlow(payload: PdfReportPayload): string {
  const geo = payload.geoAeoExecutiveSummary;
  const visuals = payload.geoAeoVisuals;
  const aiReady = hasRealAiVisibilityData(payload);
  const aiScore = geo?.overallAiVisibilityScore ?? null;
  const hasWebsiteContentSignal = Boolean(
    safeText(payload.companyContext?.homepageHeadline, 1)
    || safeText(payload.companyContext?.primaryOffering, 1)
    || safeText(payload.companyContext?.positioning, 1)
    || safeText(payload.companyContext?.tagline, 1)
    || ((payload.seoVisuals?.seoCapabilityRadar.content_quality_score ?? 0) > 0)
    || ((payload.seoExecutiveSummary?.overallHealthScore ?? 0) > 0),
  );

  const radarData = visuals?.aiAnswerPresenceRadar;
  const radarItems = radarData ? [
    { label: 'Answer Coverage', score: radarData.answer_coverage_score ?? 0 },
    { label: 'Entity Clarity', score: radarData.entity_clarity_score ?? 0 },
    { label: 'Topical Authority', score: radarData.topical_authority_score ?? 0 },
    { label: 'Citation Readiness', score: radarData.citation_readiness_score ?? 0 },
    { label: 'Content Structure', score: radarData.content_structure_score ?? 0 },
    { label: 'Freshness', score: radarData.freshness_score ?? 0 },
  ] : [];

  const getGeoStatus = (label: string, score: number): { title: string; note: string; tone: string } => {
    if (score > 0) {
      if (score >= 60) {
        return {
          title: `${score}/100`,
          note: 'A measurable answer-engine signal is already visible here.',
          tone: '#1B7340',
        };
      }
      if (score >= 30) {
        return {
          title: `${score}/100`,
          note: 'The structure is visible, but it still needs reinforcement to become dependable.',
          tone: '#B45309',
        };
      }
      return {
        title: `${score}/100`,
        note: 'A weak signal exists, but it is still too light to trust as stable answer-engine readiness.',
        tone: '#991B1B',
      };
    }

    if (!hasWebsiteContentSignal) {
      return {
        title: 'Not available',
        note: 'Content is not reachable enough yet to assess this area.',
        tone: '#8C9DAB',
      };
    }

    if (label === 'Answer Coverage') {
      return {
        title: 'Needs direct answers',
        note: 'Pages exist, but they do not yet provide extractable direct-answer sections for AI coverage.',
        tone: '#B45309',
      };
    }
    if (label === 'Entity Clarity') {
      return {
        title: 'Needs entity proof',
        note: 'The site is reachable, but core brand and service entities are not yet reinforced clearly enough.',
        tone: '#B45309',
      };
    }
    if (label === 'Topical Authority') {
      return {
        title: 'Authority still thin',
        note: 'Relevant content exists, but the topic cluster is not yet strong enough to signal authority.',
        tone: '#B45309',
      };
    }
    if (label === 'Citation Readiness') {
      return {
        title: 'Needs citations',
        note: 'Content exists, but proof, sourcing, and citation-friendly formatting are still limited.',
        tone: '#B45309',
      };
    }
    if (label === 'Content Structure') {
      return {
        title: 'Structure needs work',
        note: 'The site is crawlable, but summaries, FAQ patterns, and heading structure need improvement for extraction.',
        tone: '#B45309',
      };
    }
    return {
      title: 'Freshness needs lift',
      note: 'The content layer exists, but recency and update cadence are not yet strong enough for answer reuse.',
      tone: '#B45309',
    };
  };

  const allRadarZero = radarItems.every((item) => item.score === 0);
  const radarVisual = radarItems.length && !allRadarZero ? `<div class="card no-break" style="margin-top:12px;"><h3>AI Answer Readiness Radar</h3><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px;">${radarItems.map((item) => {
    return `<div style="text-align:center;"><div class="label">${escapeHtml(item.label)}</div>${renderScoreDonut(item.score, { size: 'sm' })}<div style="font-size:11px;color:#4A6274;margin-top:2px;">${item.score}/100</div></div>`;
  }).join('')}</div></div>` : radarItems.length ? `<div class="card no-break" style="margin-top:12px;border-left:4px solid #B45309;background:#FEF4E4;">
    <h3>AI Readiness Assessment</h3>
    <p style="font-size:11px;margin-bottom:6px;">${hasWebsiteContentSignal ? 'The site has reachable content, but AI-answer readiness is still mostly structural rather than measurable. These are the areas that need strengthening next:' : 'AI-answer readiness cannot be assessed yet because content reachability is still too limited. The framework below shows what will need to be in place once content signals deepen.'}</p>
    <div class="grid-3" style="margin-top:6px;">${radarItems.map((item) => {
      const state = getGeoStatus(item.label, item.score);
      return `<div style="padding:8px;background:#fff;border:1px solid #D4DDE6;border-radius:4px;"><div class="label" style="font-size:9px;">${escapeHtml(item.label)}</div><div style="font-size:13px;color:${state.tone};font-weight:700;margin-top:2px;">${escapeHtml(state.title)}</div><div style="font-size:11px;color:#6B7280;margin-top:6px;line-height:1.45;">${escapeHtml(state.note)}</div></div>`;
    }).join('')}</div>
  </div>` : '';

  const gapCard = geo ? `<div class="card card-accent-amber no-break" style="height:100%;"><h3>Primary AI Visibility Gap</h3><p><strong>${escapeHtml(safeText(geo.primaryGap.title, 1))}</strong></p><p>${escapeHtml(safeText(geo.primaryGap.reasoning, 2))}</p><div class="tags" style="margin-top:6px;"><span class="badge badge-${geo.primaryGap.severity === 'critical' ? 'red' : geo.primaryGap.severity === 'moderate' ? 'amber' : 'green'}">${escapeHtml(geo.primaryGap.severity.toUpperCase())}</span><span class="badge badge-gray">${escapeHtml(geo.primaryGap.type.replace(/_/g, ' ').toUpperCase())}</span></div></div>` : '';

  const queryMap = visuals?.queryAnswerCoverageMap;
  const querySection = queryMap?.queries?.length ? `<div class="card no-break" style="margin-top:12px;"><h3>Query Answer Coverage</h3><div style="margin-top:8px;">${queryMap.queries.slice(0, 6).map((q) => {
    const coverageColor = q.coverage === 'full' ? '#1B7340' : q.coverage === 'partial' ? '#B45309' : '#991B1B';
    const coverageBg = q.coverage === 'full' ? '#E6F4EC' : q.coverage === 'partial' ? '#FEF4E4' : '#FEF1EF';
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #D4DDE6;"><span style="font-size:12px;color:#1A3A50;font-weight:500;">${escapeHtml(q.query)}</span><span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:3px;background:${coverageBg};color:${coverageColor};">${escapeHtml(q.coverage.toUpperCase())}</span></div>`;
  }).join('')}</div></div>` : '';

  const extractionFunnel = visuals?.answerExtractionFunnel;
  const funnelHasData = extractionFunnel && (extractionFunnel.total_queries != null || extractionFunnel.answerable_content_pct != null);
  const funnelSection = funnelHasData ? `<div class="card no-break" style="margin-top:12px;"><h3>Answer Extraction Funnel</h3><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:10px;text-align:center;">
    <div><div class="label">Total Queries</div><div class="score-med">${extractionFunnel!.total_queries ?? '--'}</div></div>
    <div><div class="label">Answerable</div><div class="score-med">${extractionFunnel!.answerable_content_pct != null ? `${Math.round(extractionFunnel!.answerable_content_pct)}%` : '--'}</div></div>
    <div><div class="label">Structured</div><div class="score-med">${extractionFunnel!.structured_content_pct != null ? `${Math.round(extractionFunnel!.structured_content_pct)}%` : '--'}</div></div>
    <div><div class="label">Citation Ready</div><div class="score-med">${extractionFunnel!.citation_ready_pct != null ? `${Math.round(extractionFunnel!.citation_ready_pct)}%` : '--'}</div></div>
  </div></div>` : '';

  const actions = (geo?.top3Actions ?? []).slice(0, 3);
  const actionsSection = actions.length ? `<div style="margin-top:12px;"><h3>GEO/AEO Priority Actions</h3><div class="grid-3" style="margin-top:8px;">${actions.map((action, i) => `<article class="card card-accent-green no-break"><h3>${escapeHtml(action.actionTitle || `GEO/AEO action ${i + 1}`)}</h3><p>${escapeHtml(action.reasoning)}</p><div class="tags" style="margin-top:6px;"><span class="badge badge-gray">${escapeHtml(action.priority.toUpperCase())}</span><span class="badge badge-gray">${escapeHtml(action.expectedImpact.toUpperCase())} IMPACT</span><span class="badge badge-gray">${escapeHtml(action.effort.toUpperCase())} EFFORT</span></div></article>`).join('')}</div></div>` : '';

  const visibilityOpp = geo?.visibilityOpportunity;
  const oppSection = visibilityOpp ? `<div class="card card-accent-blue no-break" style="margin-top:12px;"><h3>AI Visibility Opportunity</h3><p><strong>${escapeHtml(safeText(visibilityOpp.title, 1))}</strong></p><p>Estimated AI exposure: ${escapeHtml(safeText(visibilityOpp.estimatedAiExposure, 1))}</p><p>${escapeHtml(safeText(visibilityOpp.basedOn, 2))}</p></div>` : '';

  if (!aiReady && !geo) {
    return renderNarrativeGroup('section-geo', 'AI Answer Visibility', 'GEO / AEO Intelligence', [
      renderReportBlock('insight', `<h2>GEO / AEO Intelligence</h2><p style="margin-bottom:8px;">How visible your brand is in AI answer engines (ChatGPT, Perplexity, Google AI Overview) and what to do about it.</p>`, { group: 'section-geo' }),
      renderReportBlock('insight', `<div class="inline-disclaimer inline-disclaimer-missing"><span class="badge badge-red">Signal confidence: Low (Insufficient data)</span><p><strong>AI visibility cannot be measured accurately with current data.</strong> The recommendations below are best-practice improvements that prepare your content for AI answer engines, not prescriptions based on measured gaps.</p></div>`, { group: 'section-geo' }),
      renderReportBlock('insight', `<div class="grid-2"><article class="card no-break"><h3>Why GEO/AEO Matters Now</h3><ul class="simple-list"><li>AI answer engines are supplementing traditional search for high-intent queries.</li><li>Brands with structured, answerable content get cited more frequently.</li><li>Preparing now creates advantage as adoption grows.</li></ul></article><article class="card no-break"><h3>Best-Practice Improvements</h3><ul class="simple-list"><li>Add FAQ blocks to your highest-value pages.</li><li>Create direct-answer sections for comparison queries.</li><li>Structure content with clear heading hierarchy for extraction.</li><li>Monitor which queries in your category trigger AI answers.</li></ul></article></div>`, { group: 'section-geo' }),
    ]);
  }

  const hasAiScore = aiScore != null && aiScore > 0;
  const scoreDonut = hasAiScore
    ? renderScoreDonut(aiScore, { size: 'sm' })
    : `<div style="width:70px;height:70px;border-radius:50%;border:6px solid #E8EFF6;display:flex;align-items:center;justify-content:center;margin:0 auto;"><span style="font-size:14px;font-weight:700;color:#8C9DAB;">N/A</span></div>`;
  const confLevel = (geo?.confidence ?? 'low').toLowerCase();
  const confBadgeClass = confLevel === 'high' ? 'badge-green' : confLevel === 'medium' ? 'badge-amber' : 'badge-red';

  return renderNarrativeGroup('section-geo', 'AI Answer Visibility', 'GEO / AEO Intelligence', [
    renderReportBlock('chart', `<h2>GEO / AEO Intelligence</h2><p style="margin-bottom:8px;">How visible your brand is in AI answer engines and what to do about it.</p>`, { group: 'section-geo' }),
    renderReportBlock('chart', `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div class="card no-break" style="padding:14px;">
        <table style="width:100%;border:none;border-collapse:collapse;"><tr>
          <td style="vertical-align:middle;width:40%;border:none;"><span class="${confBadgeClass} badge">Confidence: ${escapeHtml(confLevel.toUpperCase())}</span></td>
          <td style="vertical-align:middle;text-align:center;border:none;">
            <div class="label" style="margin-bottom:6px;">Overall AI Visibility${aiScore && aiScore > 0 ? `: ${aiScore}/100 (estimated)` : hasWebsiteContentSignal ? ': Structurally observed' : ': Not available'}</div>
            ${scoreDonut}
          </td>
        </tr></table>
      </div>
      <div>${gapCard}</div>
    </div>`, { group: 'section-geo' }),
    ...(radarVisual ? [renderReportBlock('chart', radarVisual, { group: 'section-geo' })] : []),
    ...(funnelSection ? [renderReportBlock('chart', funnelSection, { group: 'section-geo' })] : []),
    ...(querySection ? [renderReportBlock('chart', querySection, { group: 'section-geo' })] : []),
    ...(oppSection ? [renderReportBlock('insight', oppSection, { group: 'section-geo' })] : []),
    ...(actionsSection ? [renderReportBlock('insight', actionsSection, { group: 'section-geo' })] : []),
  ]);
}

export function renderSocialPlatformFlow(payload: PdfReportPayload, vars: Record<string, string>): string {
  const offering = safeText(payload.companyContext?.primaryOffering, 1) || '';
  const market = safeText(payload.companyContext?.marketContext, 1) || '';
  const positioning = safeText(payload.companyContext?.positioning || payload.companyContext?.tagline, 1) || '';

  // Determine recommended platforms based on company context
  const isSaaS = /saas|software|platform|tool|app/i.test(`${offering} ${market} ${positioning}`);
  const isB2B = /b2b|enterprise|business|professional|corporate/i.test(`${offering} ${market} ${positioning}`);
  const isConsumer = /consumer|retail|ecommerce|fashion|food|lifestyle/i.test(`${offering} ${market} ${positioning}`);

  type PlatformRec = { name: string; fit: 'High' | 'Medium' | 'Low'; why: string; contentFocus: string; postingCadence: string; engagementTip: string };

  const platforms: PlatformRec[] = [];

  if (isB2B || isSaaS) {
    platforms.push(
      { name: 'Professional Network (LinkedIn)', fit: 'High', why: 'Primary platform for B2B decision-makers and SaaS buyers. Thought leadership content builds trust and generates qualified leads.', contentFocus: 'Thought leadership, case studies, product insights, industry analysis', postingCadence: '3-5 posts per week', engagementTip: 'Engage in comments on industry posts, join relevant groups, publish long-form articles.' },
      { name: 'Microblogging (X / Twitter)', fit: 'Medium', why: 'Fast distribution for insights, product updates, and industry commentary. Good for building founder/brand voice.', contentFocus: 'Quick insights, threads, product announcements, industry commentary', postingCadence: '1-3 posts per day', engagementTip: 'Participate in industry conversations, use relevant hashtags, quote-tweet competitors.' },
      { name: 'Video Platform (YouTube)', fit: 'Medium', why: 'Long-form educational content builds deep authority. Product demos and tutorials drive consideration-stage engagement.', contentFocus: 'Product demos, tutorials, webinars, thought leadership videos', postingCadence: '1-2 videos per week', engagementTip: 'Optimize titles for search, create playlists, respond to comments.' },
    );
  }
  if (isConsumer) {
    platforms.push(
      { name: 'Visual Platform (Instagram)', fit: 'High', why: 'Visual storytelling and product showcase. High engagement for consumer brands.', contentFocus: 'Product visuals, stories, reels, user-generated content', postingCadence: '4-7 posts per week', engagementTip: 'Use stories daily, collaborate with micro-influencers, respond to DMs.' },
      { name: 'Short-Form Video (TikTok)', fit: 'High', why: 'Massive organic reach for creative, trend-driven content. Essential for reaching younger demographics.', contentFocus: 'Short-form video, trends, behind-the-scenes, tutorials', postingCadence: '3-5 posts per week', engagementTip: 'Follow trends early, use trending sounds, engage with comments.' },
    );
  }
  if (!isConsumer && !isB2B && !isSaaS) {
    platforms.push(
      { name: 'Professional Network (LinkedIn)', fit: 'High', why: 'Professional networking and thought leadership. Works across B2B and B2C professional services.', contentFocus: 'Thought leadership, case studies, industry insights', postingCadence: '3-5 posts per week', engagementTip: 'Build a personal brand alongside company page, engage consistently.' },
      { name: 'Microblogging (X / Twitter)', fit: 'Medium', why: 'Real-time engagement and brand voice development.', contentFocus: 'Quick insights, industry commentary, product updates', postingCadence: '1-3 posts per day', engagementTip: 'Be part of industry conversations, respond to mentions quickly.' },
      { name: 'Visual Platform (Instagram)', fit: 'Medium', why: 'Visual brand presence and community building.', contentFocus: 'Brand visuals, team stories, product highlights', postingCadence: '3-5 posts per week', engagementTip: 'Use stories and reels for engagement, showcase team and culture.' },
    );
  }

  // Add Facebook and Reddit as general recommendations
  if (platforms.length < 4) {
    platforms.push({ name: 'Community Platform (Facebook)', fit: 'Low', why: 'Community building and targeted advertising. Lower organic reach but strong ad targeting.', contentFocus: 'Community posts, events, targeted content', postingCadence: '2-3 posts per week', engagementTip: 'Focus on groups and community engagement over page posts.' });
  }
  if (platforms.length < 5 && (isB2B || isSaaS)) {
    platforms.push({ name: 'Forum Community (Reddit)', fit: 'Low', why: 'Niche community engagement. High-intent audiences in specific subreddits.', contentFocus: 'Helpful answers, AMAs, product discussions', postingCadence: '2-3 contributions per week', engagementTip: 'Be genuinely helpful — self-promotion backfires. Focus on adding value in relevant subreddits.' });
  }

  const alignmentCheck = `<div class="card card-accent-blue no-break" style="margin-top:12px;"><h3>Alignment Check: Are Your Current Efforts Working?</h3><p style="margin-bottom:8px;">Review your current social presence against these marketing objectives:</p><div class="grid-2" style="margin-top:8px;">
    <div class="card no-break"><h3>What To Audit</h3><ul class="simple-list"><li>Is your posting frequency consistent enough to build algorithmic momentum?</li><li>Does your content mix include decision-stage assets (case studies, comparisons)?</li><li>Are you engaging in conversations or just broadcasting?</li><li>Is there a clear path from social content to your conversion pages?</li></ul></div>
    <div class="card no-break"><h3>Marketing Objective Alignment</h3><ul class="simple-list"><li><strong>Awareness:</strong> Focus on reach-first platforms (Instagram, TikTok, YouTube).</li><li><strong>Engagement:</strong> Prioritize conversation-driven platforms (X, LinkedIn, Reddit).</li><li><strong>Lead Generation:</strong> Drive to gated content via LinkedIn and Facebook ads.</li><li><strong>Conversion:</strong> Build proof and trust content that supports buying decisions.</li></ul></div>
  </div></div>`;

  const contentCalendar = `<div class="card no-break" style="margin-top:10px;"><h3>Suggested Weekly Content Calendar</h3><p style="margin-bottom:6px;">A starter framework to build publishing momentum across recommended platforms:</p><div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-top:8px;text-align:center;">
    <div style="padding:8px 4px;background:#F5F7FA;border:1px solid #D4DDE6;border-radius:4px;"><div class="label" style="font-size:9px;">Mon</div><p style="font-size:10px;margin:0;">LinkedIn: Thought leadership post</p></div>
    <div style="padding:8px 4px;background:#F5F7FA;border:1px solid #D4DDE6;border-radius:4px;"><div class="label" style="font-size:9px;">Tue</div><p style="font-size:10px;margin:0;">X: Industry insight thread</p></div>
    <div style="padding:8px 4px;background:#F5F7FA;border:1px solid #D4DDE6;border-radius:4px;"><div class="label" style="font-size:9px;">Wed</div><p style="font-size:10px;margin:0;">LinkedIn: Case study or proof</p></div>
    <div style="padding:8px 4px;background:#F5F7FA;border:1px solid #D4DDE6;border-radius:4px;"><div class="label" style="font-size:9px;">Thu</div><p style="font-size:10px;margin:0;">X: Product update or tip</p></div>
    <div style="padding:8px 4px;background:#F5F7FA;border:1px solid #D4DDE6;border-radius:4px;"><div class="label" style="font-size:9px;">Fri</div><p style="font-size:10px;margin:0;">LinkedIn: Industry analysis</p></div>
  </div></div>`;

  const socialKpis = `<div class="card no-break" style="margin-top:10px;"><h3>Key Metrics To Track</h3><div class="grid-3" style="margin-top:6px;">
    <div style="text-align:center;padding:8px;background:#E6F4EC;border:1px solid #B8D4C4;border-radius:4px;"><div class="label" style="font-size:9px;">Engagement Rate</div><p style="font-size:10px;margin:0;">Target: 2-5% per post. Measures content resonance.</p></div>
    <div style="text-align:center;padding:8px;background:#E3F0FA;border:1px solid #A3C9E8;border-radius:4px;"><div class="label" style="font-size:9px;">Profile Visits</div><p style="font-size:10px;margin:0;">Track weekly. Leading indicator of brand interest.</p></div>
    <div style="text-align:center;padding:8px;background:#FEF4E4;border:1px solid #E5C07B;border-radius:4px;"><div class="label" style="font-size:9px;">Click-Through</div><p style="font-size:10px;margin:0;">Measures path from social to site conversion pages.</p></div>
  </div></div>`;

  return renderNarrativeGroup('section-social', 'Social Platform Strategy', 'Social Platform Recommendations', [
    renderReportBlock('insight', `<h2>Social Platform Recommendations</h2><p style="margin-bottom:8px;">Which platforms fit ${escapeHtml(vars.company_name)} based on your market positioning, and how to align content with marketing objectives.</p>`, { group: 'section-social' }),
    ...platforms.slice(0, 4).map((p) => {
      const fitColor = p.fit === 'High' ? 'border-left:4px solid #1B7340;background:#E6F4EC;' : p.fit === 'Medium' ? 'border-left:4px solid #B45309;background:#FEF4E4;' : 'border-left:4px solid #8C9DAB;background:#F5F7FA;';
      return renderReportBlock('insight', `<article class="card no-break" style="${fitColor}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;"><h3>${escapeHtml(p.name)}</h3><span class="badge badge-${p.fit === 'High' ? 'green' : p.fit === 'Medium' ? 'amber' : 'gray'}">${escapeHtml(p.fit)} FIT</span></div>
        <p style="font-size:11px;">${escapeHtml(p.why)}</p>
        <div style="margin-top:6px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;">
          <div><div class="label" style="font-size:9px;">Content Focus</div><p style="font-size:10px;margin:0;">${escapeHtml(p.contentFocus)}</p></div>
          <div><div class="label" style="font-size:9px;">Posting Cadence</div><p style="font-size:10px;margin:0;">${escapeHtml(p.postingCadence)}</p></div>
          <div><div class="label" style="font-size:9px;">Engagement</div><p style="font-size:10px;margin:0;">${escapeHtml(p.engagementTip)}</p></div>
        </div>
      </article>`, { group: 'section-social' });
    }),
    renderReportBlock('insight', alignmentCheck, { group: 'section-social' }),
    renderReportBlock('insight', contentCalendar, { group: 'section-social' }),
    renderReportBlock('insight', socialKpis, { group: 'section-social' }),
  ]);
}

export function renderNextLevelCtaFlow(payload: PdfReportPayload, vars: Record<string, string>): string {
  const overallScore = getOverallScore(payload);
  const stageLabel = overallScore <= 44 ? 'Early-Stage' : overallScore <= 74 ? 'Growing' : 'Leader';
  const companyName = vars.company_name || payload.domain;

  const ctaBlock = `<div style="border:2px solid #0077B6;border-radius:4px;padding:16px;background:linear-gradient(180deg,#E3F0FA 0%,#F5F7FA 100%);">
      <div style="text-align:center;margin-bottom:12px;">
        <div class="label" style="color:#0A5E91;">Your Next Move</div>
        <h2 style="color:#051C2C;margin-bottom:6px;">Ready To Move Beyond ${escapeHtml(stageLabel)}?</h2>
        <p style="max-width:560px;margin:0 auto;font-size:12px;">This snapshot identified your constraints and provided directional recommendations. The next-level report turns these into a full execution blueprint.</p>
      </div>
      <div class="grid-3" style="margin-top:12px;">
        <article class="card no-break" style="text-align:center;border:1px solid #0077B6;padding:10px;">
          <h3 style="color:#0A5E91;font-size:12px;">Execution Playbook</h3>
          <p style="font-size:11px;">Week-by-week action plan with content briefs, platform allocation, and publishing schedule.</p>
        </article>
        <article class="card no-break" style="text-align:center;border:1px solid #0077B6;padding:10px;">
          <h3 style="color:#0A5E91;font-size:12px;">Competitive Deep Dive</h3>
          <p style="font-size:11px;">Full competitor content audit, keyword gap analysis, and positioning strategy.</p>
        </article>
        <article class="card no-break" style="text-align:center;border:1px solid #0077B6;padding:10px;">
          <h3 style="color:#0A5E91;font-size:12px;">AI Content Engine</h3>
          <p style="font-size:11px;">Automated content generation aligned to your strategy — ideation to publishing.</p>
        </article>
      </div>
      <div style="text-align:center;margin-top:12px;">
        <p style="font-weight:600;color:#051C2C;font-size:12px;">Complete the recommendations above first, then upgrade to unlock the full growth system.</p>
        <div style="margin-top:6px;"><span class="badge badge-blue" style="font-size:11px;padding:6px 14px;">Score ${overallScore} &rarr; Target 47+ to unlock next-level insights</span></div>
      </div>
    </div>`;

  const whyThisMatters = `<div class="card card-accent-amber no-break" style="margin-top:10px;">
    <h3>Why Digital Authority Reports Matter</h3>
    <p style="margin-bottom:6px;">Most businesses publish content and hope it works. This report replaces hope with evidence. It shows exactly where your digital presence is leaking qualified demand — and what to fix first.</p>
    <div class="grid-3" style="margin-top:8px;">
      <div style="text-align:center;padding:8px;background:#fff;border:1px solid #D4DDE6;border-radius:4px;">
        <div style="font-family:Georgia,serif;font-size:18px;font-weight:700;color:#051C2C;">67%</div>
        <p style="font-size:10px;margin:2px 0 0;">of B2B buyers make decisions before talking to sales</p>
      </div>
      <div style="text-align:center;padding:8px;background:#fff;border:1px solid #D4DDE6;border-radius:4px;">
        <div style="font-family:Georgia,serif;font-size:18px;font-weight:700;color:#051C2C;">3-5x</div>
        <p style="font-size:10px;margin:2px 0 0;">more qualified traffic from decision-stage content vs awareness content</p>
      </div>
      <div style="text-align:center;padding:8px;background:#fff;border:1px solid #D4DDE6;border-radius:4px;">
        <div style="font-family:Georgia,serif;font-size:18px;font-weight:700;color:#051C2C;">30 days</div>
        <p style="font-size:10px;margin:2px 0 0;">recommended interval between report runs to track execution impact</p>
      </div>
    </div>
  </div>`;

  const roadmapHeader = `<div style="margin-top:10px;"><h3>Your Report Roadmap</h3><p style="font-size:11.5px;">This Snapshot is the first step. Two deeper reports unlock the full growth system once you start executing.</p></div>`;

  const report2 = `<article class="card no-break" style="border-left:4px solid #0077B6;background:#E3F0FA;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
      <h3 style="font-size:12px;color:#0A5E91;margin:0;">Report 2: Performance Intelligence</h3>
      <span class="badge badge-blue" style="font-size:9px;">After 30 days</span>
    </div>
    <p style="font-size:11px;margin-bottom:6px;">Once you have started executing the Snapshot recommendations, this report measures what is actually working.</p>
    <ul class="simple-list" style="font-size:10.5px;">
      <li>Keyword ranking movement and search visibility trends</li>
      <li>Content performance: which pages drive clicks vs which leak traffic</li>
      <li>Authority progress: new backlinks, domain trust signals</li>
      <li>Funnel analysis: where visitors drop off before converting</li>
    </ul>
    <p style="font-size:10px;color:#0A5E91;font-weight:600;margin-top:6px;">Outcome: Know exactly which actions are driving results and where to double down.</p>
  </article>`;

  const report3 = `<article class="card no-break" style="border-left:4px solid #1B7340;background:#E6F4EC;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
      <h3 style="font-size:12px;color:#1B7340;margin:0;">Report 3: Growth &amp; Market Position</h3>
      <span class="badge badge-green" style="font-size:9px;">After 60 days</span>
    </div>
    <p style="font-size:11px;margin-bottom:6px;">With execution data flowing, this report shows how you stack up against competitors and where the biggest growth upside sits.</p>
    <ul class="simple-list" style="font-size:10.5px;">
      <li>Competitive share of voice: your visibility vs top 5 competitors</li>
      <li>Market positioning shift: are you closing the gap or falling behind?</li>
      <li>Lead quality intelligence: which channels produce qualified demand</li>
      <li>AI visibility trajectory: citation readiness across answer engines</li>
    </ul>
    <p style="font-size:10px;color:#1B7340;font-weight:600;margin-top:6px;">Outcome: A complete growth strategy with competitive positioning and lead generation playbook.</p>
  </article>`;

  // The previous "Generated for ... Powered by ..." footer has been
  // replaced by the end banner that the master document renders once
  // after the last section. No per-flow footer needed here anymore.

  return renderNarrativeGroup('section-cta', 'Next Steps', 'Unlock Deeper Intelligence', [
    renderReportBlock('insight', ctaBlock, { group: 'section-cta' }),
    renderReportBlock('insight', whyThisMatters, { group: 'section-cta' }),
    renderReportBlock('insight', roadmapHeader, { group: 'section-cta' }),
    renderReportBlock('insight', report2, { group: 'section-cta' }),
    renderReportBlock('insight', report3, { group: 'section-cta' }),
  ]);
}

export function renderActionsFlow(actions: MasterAction[]): string {
  const actionCards = actions.slice(0, 5).map((action, index) => renderMasterActionCard(action, index));

  const priorityFramework = `<div style="margin-bottom:8px;">
    <article class="card no-break" style="border-left:4px solid #991B1B;background:#FEF1EF;margin-bottom:8px;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;"><span style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#991B1B;">Priority 1 &mdash; Capture High-Intent Demand</span></div>
      <p style="font-size:11px;margin-bottom:4px;">These users are already evaluating tools. Missing here means direct revenue loss to competitors.</p>
      <div class="label" style="margin-top:6px;">Example Queries You Should Rank For</div>
      <p style="font-size:10px;color:#991B1B;margin-bottom:4px;">"best [category] tools 2026" &middot; "[your product] vs [competitor]" &middot; "[category] alternatives"</p>
      <div class="label" style="margin-top:4px;">Comparison Page Template</div>
      <div style="padding:4px 8px;background:#fff;border:1px solid #D4DDE6;border-radius:3px;font-size:10px;">
        <strong>Title:</strong> "${escapeHtml(actions[0]?.title?.split(' ').slice(0, 6).join(' ') || 'Your Product')} vs [Competitor]: Feature, Pricing &amp; Use Case Comparison"<br/>
        <strong>1.</strong> Overview (what each product does)<br/>
        <strong>2.</strong> Feature comparison table (side-by-side)<br/>
        <strong>3.</strong> Pricing breakdown (plans, tiers)<br/>
        <strong>4.</strong> Best for: who should choose which<br/>
        <strong>5.</strong> Verdict + CTA ("Start free trial" / "Book demo")
      </div>
    </article>
    <article class="card no-break" style="border-left:4px solid #B45309;background:#FEF4E4;margin-bottom:8px;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;"><span style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#B45309;">Priority 2 &mdash; Build Authority Signals</span></div>
      <p style="font-size:11px;margin-bottom:4px;">Strengthen domain trust so content can actually rank.</p>
      <div class="label" style="margin-top:6px;">What This Looks Like</div>
      <ul class="simple-list" style="font-size:10.5px;">
        <li>Get listed on 5-10 relevant SaaS directories and review platforms</li>
        <li>Publish 1 data-backed case study: Problem &rarr; Solution &rarr; Results</li>
        <li>Outreach to 3 industry publications for guest posts or mentions</li>
      </ul>
    </article>
    <hr style="border:none;border-top:2px solid #D4DDE6;margin:12px 0;" />
    <article class="card no-break" style="border-left:4px solid #0077B6;background:#E3F0FA;margin-top:0;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;"><span style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#0077B6;">Priority 3 &mdash; Add Proof &amp; Conversion Readiness</span></div>
      <p style="font-size:11px;margin-bottom:4px;">Give buyers evidence to trust and choose you. Place proof on comparison and pricing pages.</p>
      <div class="label" style="margin-top:6px;">Case Study Structure</div>
      <div style="padding:6px 10px;background:#fff;border:1px solid #D4DDE6;border-radius:3px;font-size:10.5px;">
        <strong>1. Context:</strong> Client name, industry, and starting situation.<br/>
        <strong>2. Problem:</strong> The specific measurable challenge they faced.<br/>
        <strong>3. Solution:</strong> How your product solved it (features used, approach taken).<br/>
        <strong>4. Result:</strong> Quantified outcome — e.g., "40% increase in qualified leads in 90 days."
      </div>
      <p style="font-size:10px;color:#0077B6;font-weight:600;margin-top:4px;">Place on: comparison pages, pricing page, homepage trust section.</p>
    </article>
    <article class="card no-break" style="border-left:4px solid #1B7340;background:#E6F4EC;margin-top:8px;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;"><span style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#1B7340;">Priority 4 &mdash; Structure for SEO + AI Discovery</span></div>
      <p style="font-size:11px;margin-bottom:4px;">Make content extractable by search engines and AI answer systems.</p>
      <div class="label" style="margin-top:4px;">FAQ Format (add to top 5 pages)</div>
      <div style="padding:4px 8px;background:#fff;border:1px solid #D4DDE6;border-radius:3px;font-size:10px;margin-bottom:4px;"><strong>Q: What is [your product]?</strong><br/>A: [Product] is a [category] platform that helps [audience] achieve [outcome]. It combines [key feature 1], [key feature 2], and [key feature 3].</div>
      <div class="label" style="margin-top:4px;">Heading Hierarchy</div>
      <div style="padding:4px 8px;background:#fff;border:1px solid #D4DDE6;border-radius:3px;font-size:10px;margin-bottom:4px;">H1: Page title &rarr; H2: Major sections &rarr; H3: Subsections. Each H2 should be answerable as a standalone question.</div>
      <div class="label" style="margin-top:4px;">Summary Block</div>
      <div style="padding:4px 8px;background:#fff;border:1px solid #D4DDE6;border-radius:3px;font-size:10px;margin-bottom:4px;">Add a 2-3 sentence summary at the top of key pages. AI systems extract this as the cited answer.</div>
      <div class="label" style="margin-top:4px;">Before vs After</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:9px;">
        <div style="padding:4px 6px;background:#FEF1EF;border:1px solid #D4DDE6;border-radius:3px;"><strong style="color:#991B1B;">Before:</strong> Wall of text, no headings, no FAQ, no summary. AI cannot extract answers.</div>
        <div style="padding:4px 6px;background:#E6F4EC;border:1px solid #D4DDE6;border-radius:3px;"><strong style="color:#1B7340;">After:</strong> Clear H2s, FAQ section, summary paragraph. AI cites your answer in results.</div>
      </div>
    </article>
  </div>`;

  const executionRoadmap = `<div class="card no-break" style="border:2px solid #051C2C;">
    <h3>Execution Roadmap</h3>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:6px;">
      <div style="padding:8px;background:#FEF1EF;border-radius:4px;font-size:10px;"><strong style="display:block;color:#991B1B;margin-bottom:2px;">Week 1-2</strong>Build 1 comparison page and 1 alternatives page.<div style="margin-top:3px;font-style:italic;color:#991B1B;">&rarr; Outcome: First impressions in decision queries.</div><div style="margin-top:2px;font-size:9px;color:#4A6274;">Measure: Page indexed in GSC, impressions for "[product] vs" queries.</div></div>
      <div style="padding:8px;background:#FEF4E4;border-radius:4px;font-size:10px;"><strong style="display:block;color:#B45309;margin-bottom:2px;">Week 3-4</strong>Publish 1 case study. Submit to 5 directories. Start outreach.<div style="margin-top:3px;font-style:italic;color:#B45309;">&rarr; Outcome: First external backlinks acquired.</div><div style="margin-top:2px;font-size:9px;color:#4A6274;">Measure: New referring domains in backlink check, directory listings live.</div></div>
      <div style="padding:8px;background:#E3F0FA;border-radius:4px;font-size:10px;"><strong style="display:block;color:#0077B6;margin-bottom:2px;">Month 2</strong>Add proof blocks to key pages. Build FAQ sections. Connect GSC.<div style="margin-top:3px;font-style:italic;color:#0077B6;">&rarr; Outcome: Conversion readiness and AI extraction eligibility improve.</div><div style="margin-top:2px;font-size:9px;color:#4A6274;">Measure: Time on page increases, FAQ pages appear in answer boxes.</div></div>
      <div style="padding:8px;background:#E6F4EC;border-radius:4px;font-size:10px;"><strong style="display:block;color:#1B7340;margin-bottom:2px;">Month 3</strong>Run second Snapshot. Measure changes. Adjust strategy.<div style="margin-top:3px;font-style:italic;color:#1B7340;">&rarr; Outcome: Measurable score improvement, data-backed refinement.</div><div style="margin-top:2px;font-size:9px;color:#4A6274;">Measure: Snapshot score delta, ranking positions for target queries.</div></div>
    </div>
  </div>`;

  return renderNarrativeGroup('section-10', 'What To Do Next', 'Execution Roadmap', [
    renderReportBlock('insight', `<h2>Execution Roadmap</h2><p style="margin-bottom:8px;">Prioritised actions sequenced for maximum impact. Earlier actions create the conditions for later ones to work.</p>`, { group: 'section-10' }),
    renderReportBlock('insight', priorityFramework, { group: 'section-10' }),
    renderReportBlock('insight', executionRoadmap, { group: 'section-10' }),
    renderReportBlock('insight', `<h3>Detailed Action Breakdown</h3><p style="margin-bottom:6px;font-size:11px;">Each action below maps to the priority framework above.</p>`, { group: 'section-10' }),
    ...actionCards.map((card) => renderReportBlock('action', card, { group: 'section-10' })),
  ]);
}

export function renderTrajectoryFlow(payload: PdfReportPayload, actions: MasterAction[]): string {
  const overallScore = getOverallScore(payload);
  const highPriorityCount = actions.filter((a) => a.priority === 'HIGH').length;
  const currentScore = overallScore;
  const nextScore = Math.min(100, currentScore + Math.max(3, highPriorityCount * 2 + 5));
  const futureScore = Math.min(100, nextScore + Math.max(4, actions.length * 2 + 3));
  const maxScore = Math.max(currentScore, nextScore, futureScore, 1);

  const barHeight = (score: number) => Math.max(16, Math.round((score / maxScore) * 90));
  const barColor = (score: number) => score >= 50 ? '#1B7340' : score >= 30 ? '#B45309' : '#991B1B';

  const trajectoryBars = `<div style="display:flex;gap:20px;align-items:flex-end;justify-content:center;padding:16px 0;">
    ${[{ label: 'Current', score: currentScore }, { label: 'Next', score: nextScore }, { label: 'Future', score: futureScore }].map((item) => `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
      <div style="display:flex;align-items:flex-end;height:100px;">
        <div style="width:48px;height:${barHeight(item.score)}px;background:${barColor(item.score)};border-radius:4px 4px 0 0;"></div>
      </div>
      <div class="score-med">${item.score}</div>
      <div class="label">${escapeHtml(item.label)}</div>
    </div>`).join('')}
  </div>`;

  const simulationNote = `<div class="card no-break" style="margin-top:10px;"><p><strong>Simulation Note</strong></p><p>This simulation is based on the current action stack and improves as more systems are connected.</p></div>`;

  const howToReach = `<div class="card card-accent-blue no-break" style="margin-top:10px;"><h3>How You Reach The Next Scores</h3><ul class="simple-list"><li>Next: Initial visibility gains from comparison pages.</li><li>Future: Authority and content depth improvements compound growth.</li></ul><p style="margin-top:6px;">Execution quality determines how fast movement from ${currentScore} to ${futureScore} occurs.</p></div>`;

  return renderNarrativeGroup('section-11', 'Expected Trajectory', 'Growth Trajectory', [
    renderReportBlock('chart', `<h2>Growth Trajectory</h2>${trajectoryBars}`, { group: 'section-11' }),
    renderReportBlock('insight', simulationNote, { group: 'section-11' }),
    renderReportBlock('insight', howToReach, { group: 'section-11' }),
  ]);
}

export function renderConfidenceFlow(payload: PdfReportPayload, vars: Record<string, string>, sectionStatuses: Record<string, SnapshotSectionStatus>): string {
  const dataSources = deriveDataSources(payload);
  const connectedCount = dataSources.filter((s) => s.status === 'connected').length;
  const overallConfidence = dataSources.every((s) => s.status === 'connected') ? 'High' : dataSources.some((s) => s.status === 'missing') ? 'Medium' : 'High';
  const coverageLevel = dataSources.every((s) => s.status === 'connected') ? 'Connected' : dataSources.some((s) => s.status === 'missing') ? 'Partial' : 'Mostly Connected';

  const summaryStrip = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:14px 0;">
    <div class="card no-break" style="text-align:center;"><div class="label">Overall Confidence</div><div class="score-med">${escapeHtml(overallConfidence)}</div></div>
    <div class="card no-break" style="text-align:center;"><div class="label">Coverage Level</div><div class="score-med">${escapeHtml(coverageLevel)}</div></div>
    <div class="card no-break" style="text-align:center;"><div class="label">Data Sources Connected</div><div class="score-med">${connectedCount} / ${dataSources.length}</div></div>
  </div>`;

  const sourceCardBlocks = dataSources.map((source) => {
    const badgeClass = source.status === 'connected' ? 'badge-green' : source.status === 'partial' ? 'badge-amber' : 'badge-red';
    const statusLabel = source.status === 'connected' ? 'Connected' : source.status === 'partial' ? 'Partial' : 'Missing';
    return renderReportBlock('insight', `<article class="card no-break" style="padding:10px 12px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
        <div><div class="label" style="font-size:9px;">${escapeHtml(source.name)}</div><h3 style="margin-bottom:2px;">${escapeHtml(statusLabel)}</h3></div>
        <span class="badge ${badgeClass}" style="font-size:9px;">${escapeHtml(source.confidence.toUpperCase())} confidence</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;font-size:10.5px;">
        <div><div class="label" style="font-size:8px;">Current State</div><p style="margin:0;font-size:10px;">${escapeHtml(source.currentState)}</p></div>
        <div><div class="label" style="font-size:8px;">Impact On Report</div><p style="margin:0;font-size:10px;">${escapeHtml(source.impact)}</p></div>
        <div><div class="label" style="font-size:8px;">What Unlocks</div><p style="margin:0;font-size:10px;">${source.unlocks.join(' · ')}</p></div>
      </div>
    </article>`, { group: 'section-12' });
  });

  return renderNarrativeGroup('section-12', 'Confidence Layer', 'Data Confidence & Coverage', [
    renderReportBlock('insight', `<h2>Data Confidence &amp; Coverage</h2><p style="margin-bottom:8px;">This report combines available signals with intelligent inference. Some insights are directional due to limited connected data sources. As more systems are connected, accuracy, depth, and confidence improve automatically.</p>`, { group: 'section-12' }),
    renderReportBlock('chart', summaryStrip, { group: 'section-12' }),
    ...sourceCardBlocks,
    renderReportBlock('insight', `<article class="card card-accent-amber no-break" style="padding:10px 12px;"><h3 style="margin-bottom:2px;">What This Means</h3><p style="font-size:10.5px;margin:0;">Insights are directional, not exhaustive. Gaps identified are likely larger than what is currently visible. Opportunities may deliver stronger results than estimated today.</p></article>`, { group: 'section-12' }),
    renderReportBlock('insight', `<article class="card card-accent-blue no-break" style="padding:10px 12px;"><h3 style="margin-bottom:2px;">What Improves Next</h3><p style="font-size:10.5px;margin:0;">Insights become more precise. Recommendations become more personalized. Competitive analysis becomes more complete. AI visibility scoring becomes more accurate. Growth projections become more reliable.</p></article>`, { group: 'section-12' }),
  ]);
}
