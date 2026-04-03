import fs from 'fs';
import path from 'path';
import type { PdfReportPayload } from './reportPdfRenderer';
import { assertNoFallback, sanitizeRenderText, sanitizeTextArtifacts } from './renderTextSanitizer';

type TemplateChoice =
  | 'best_omnivyra_final_report_template.html'
  | 'omnivyra_snapshot_master_report.html'
  | 'omnivyra_snapshot_compact_report_template.html'
  | 'omnivyra_decision_flow_report_template.html'
  | 'omnivyra_visual_intelligence_report_template.html'
  | 'omnivyra_execution_endgame_report_template.html'
  | 'best_signal_rich_report_template.html'
  | 'best_sparse_signal_report_template.html'
  | 'best_balanced_report_template.html'
  | 'best_executive_report_template.html';

type BrandProfile = {
  companyName: string;
  websiteUrl: string;
  primaryFocus: string;
  executiveSummary: string;
  confidenceSummary: string;
  scoreSummary: string;
  trustSummary: string;
  conversionSummary: string;
  ctaText: string;
};

function safeText(value: string | null | undefined, maxSentences = 2): string {
  const clean = sanitizeRenderText(sanitizeTextArtifacts(value ?? '').replace(/\s+/g, ' ').trim(), { maxSentences }) || '';
  if (clean) assertNoFallback(clean);
  return clean;
}

function safeScore(value: number | null | undefined): string {
  return Number.isFinite(value) ? String(Math.round(Number(value))) : '0';
}

function getBrandName(payload: PdfReportPayload): string {
  return safeText(payload.companyContext?.companyName || payload.domain, 1) || payload.domain;
}

function isOmnivyraPayload(payload: PdfReportPayload): boolean {
  const haystack = [
    payload.domain,
    payload.companyContext?.companyName,
    payload.companyContext?.homepageHeadline,
    payload.companyContext?.tagline,
  ].join(' ').toLowerCase();
  return haystack.includes('omnivyra');
}

function getBrandProfile(payload: PdfReportPayload): BrandProfile | null {
  if (!isOmnivyraPayload(payload)) return null;
  return {
    companyName: 'Omnivyra',
    websiteUrl: 'www.omnivyra.com',
    primaryFocus: 'AI marketing operating system',
    executiveSummary: 'Omnivyra turns fragmented marketing work into one operating system for readiness, strategy, creation, publishing, and optimization. The report should show how clearly that system is communicated and how effectively the site converts product understanding into action.',
    confidenceSummary: 'This Omnivyra version should feel like a real executive report, not a generic audit. Every section needs to reinforce product clarity, system credibility, and buyer momentum even when signal depth varies.',
    scoreSummary: 'The strongest Omnivyra report balances strategic intelligence with product trust: what the platform does, why the workflow matters, and where the site is leaking conversion confidence.',
    trustSummary: 'Omnivyra wins when the site feels like a serious operating system, not another lightweight AI tool. Credibility comes from workflow clarity, depth of capability, and visible proof of execution.',
    conversionSummary: 'Conversion for Omnivyra depends on connecting readiness analysis, campaign planning, content execution, and optimization into one buyer journey that feels inevitable.',
    ctaText: 'Tighten the story around Omnivyra as the system that helps teams understand, plan, execute, and improve marketing from one place. The report should end by reinforcing that operating-system narrative, not just isolated SEO tasks.',
  };
}

function getOverallScore(payload: PdfReportPayload): number {
  return payload.unifiedIntelligenceSummary?.unifiedScore
    ?? payload.seoExecutiveSummary?.overallHealthScore
    ?? payload.geoAeoExecutiveSummary?.overallAiVisibilityScore
    ?? 0;
}

function chooseOmnivyraTemplate(payload: PdfReportPayload): TemplateChoice {
  if (payload.reportType === 'performance') {
    return 'omnivyra_visual_intelligence_report_template.html';
  }
  if (payload.reportType === 'growth') {
    return 'omnivyra_execution_endgame_report_template.html';
  }
  return 'omnivyra_snapshot_master_report.html';
}

function chooseTemplate(payload: PdfReportPayload): TemplateChoice {
  if (isOmnivyraPayload(payload)) {
    return chooseOmnivyraTemplate(payload);
  }
  const score = getOverallScore(payload);
  if (payload.decisionSnapshot || payload.unifiedIntelligenceSummary) {
    return 'best_executive_report_template.html';
  }
  if (score >= 72) return 'best_signal_rich_report_template.html';
  if (score <= 45) return 'best_sparse_signal_report_template.html';
  return 'best_balanced_report_template.html';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripRepeatedSentences(value: string): string {
  const seen = new Set<string>();
  const sentences = value
    .split(/(?<=[.!?])\s+/)
    .map((part) => safeText(part, 1))
    .filter(Boolean);

  return sentences.filter((sentence) => {
    const key = sentence.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(' ');
}

function hasContent(value: string | null | undefined): boolean {
  return safeText(value, 2).length > 0;
}

function clampPercent(value: number | null | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(Number(value))));
}

function renderBarSvg(values: Array<{ label: string; value: number; color: string }>): string {
  const max = Math.max(...values.map((item) => item.value), 1);
  const barHeight = 26;
  const gap = 14;
  const width = 320;
  const height = values.length * (barHeight + gap);
  const rows = values.map((item, index) => {
    const y = index * (barHeight + gap);
    const scaled = Math.max(8, Math.round((item.value / max) * 180));
    return `
      <text x="0" y="${y + 16}" font-size="11" fill="#61718a">${escapeHtml(item.label)}</text>
      <rect x="96" y="${y + 3}" width="190" height="12" rx="6" fill="#e7edf7"></rect>
      <rect x="96" y="${y + 3}" width="${scaled}" height="12" rx="6" fill="${item.color}"></rect>
      <text x="296" y="${y + 14}" font-size="11" text-anchor="end" fill="#102033">${item.value}</text>
    `;
  }).join('');
  return `
    <svg viewBox="0 0 ${width} ${height}" class="svg-chart" role="img" aria-label="bar chart">
      ${rows}
    </svg>
  `;
}

function renderTrendSvg(pointsA: number[], pointsB?: number[]): string {
  const width = 320;
  const height = 120;
  const step = pointsA.length > 1 ? width / (pointsA.length - 1) : width;
  const toPath = (points: number[]) => points.map((point, index) => {
    const x = index * step;
    const y = height - ((clampPercent(point) / 100) * (height - 20)) - 10;
    return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');
  const dots = (points: number[], color: string) => points.map((point, index) => {
    const x = index * step;
    const y = height - ((clampPercent(point) / 100) * (height - 20)) - 10;
    return `<circle cx="${x}" cy="${y}" r="3" fill="${color}"></circle>`;
  }).join('');
  return `
    <svg viewBox="0 0 ${width} ${height}" class="svg-chart" role="img" aria-label="trend chart">
      <line x1="0" y1="${height - 10}" x2="${width}" y2="${height - 10}" stroke="#d7e2ef" />
      <line x1="0" y1="10" x2="0" y2="${height - 10}" stroke="#d7e2ef" />
      <path d="${toPath(pointsA)}" fill="none" stroke="#4f7cff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
      ${dots(pointsA, '#4f7cff')}
      ${pointsB && pointsB.length ? `<path d="${toPath(pointsB)}" fill="none" stroke="#f59e0b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>${dots(pointsB, '#f59e0b')}` : ''}
    </svg>
  `;
}

function renderRadarSvg(values: Array<{ label: string; value: number }>): string {
  const center = 90;
  const radius = 62;
  const points = values.map((item, index) => {
    const angle = ((Math.PI * 2) / values.length) * index - Math.PI / 2;
    const scaled = (clampPercent(item.value) / 100) * radius;
    const x = center + Math.cos(angle) * scaled;
    const y = center + Math.sin(angle) * scaled;
    const labelX = center + Math.cos(angle) * (radius + 18);
    const labelY = center + Math.sin(angle) * (radius + 18);
    return { x, y, labelX, labelY, label: item.label };
  });
  const polygon = points.map((point) => `${point.x},${point.y}`).join(' ');
  const axes = points.map((point) => `<line x1="${center}" y1="${center}" x2="${point.labelX - (point.labelX > center ? 8 : -8)}" y2="${point.labelY - (point.labelY > center ? 8 : -8)}" stroke="#d7e2ef" />`).join('');
  const labels = points.map((point) => `<text x="${point.labelX}" y="${point.labelY}" font-size="10" text-anchor="middle" fill="#61718a">${escapeHtml(point.label)}</text>`).join('');
  return `
    <svg viewBox="0 0 180 180" class="svg-chart radar" role="img" aria-label="radar chart">
      <circle cx="${center}" cy="${center}" r="${radius}" fill="#f8fbff" stroke="#d7e2ef"></circle>
      <circle cx="${center}" cy="${center}" r="${Math.round(radius * 0.66)}" fill="none" stroke="#e7edf7"></circle>
      <circle cx="${center}" cy="${center}" r="${Math.round(radius * 0.33)}" fill="none" stroke="#e7edf7"></circle>
      ${axes}
      <polygon points="${polygon}" fill="rgba(79,124,255,0.18)" stroke="#4f7cff" stroke-width="2"></polygon>
      ${labels}
    </svg>
  `;
}

function renderOmnivyraSnapshotMasterHtml(payload: PdfReportPayload): { html: string; templateName: string } {
  const variables = buildTemplateVariables(payload);
  const seo = payload.seoExecutiveSummary;
  const visuals = payload.seoVisuals;
  const geo = payload.geoAeoExecutiveSummary;
  const geoVisuals = payload.geoAeoVisuals;
  const unified = payload.unifiedIntelligenceSummary;
  const competitor = payload.competitorIntelligenceSummary;
  const competitorVisuals = payload.competitorVisuals;
  const competitorMovement = payload.competitorMovementComparison;

  const usedCopy = new Set<string>();
  const uniqueText = (value: string | null | undefined, maxSentences = 2): string => {
    const cleaned = stripRepeatedSentences(safeText(value, maxSentences));
    if (!cleaned) return '';
    const key = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key || usedCopy.has(key)) return '';
    usedCopy.add(key);
    return cleaned;
  };

  const unifiedSummaryText = safeText(
    unified?.marketContextSummary
    || unified?.primaryConstraint.reasoning
    || seo?.primaryProblem.reasoning
    || payload.summary,
    2,
  );
  const growthDirectionText = safeText(
    unified
      ? `${unified.growthDirection.shortTermFocus} ${unified.growthDirection.longTermFocus}`
      : variables.growth_direction,
    2,
  );
  const decisionBannerText = safeText(
    payload.decisionSnapshot?.primaryFocusArea
      ? `Primary focus area: ${payload.decisionSnapshot.primaryFocusArea}. ${payload.decisionSnapshot.whatsBroken ?? ''}`
      : variables.decision_banner,
    2,
  );

  const renderCardGrid = (title: string, items: Array<{ title: string; body: string; tone?: 'good' | 'warn' | 'bad' | 'neutral' }>, subtitle?: string): string => {
    const visibleItems = items.filter((item) => item.title && item.body);
    if (!visibleItems.length) return '';
    return `
      <section class="section">
        <div class="section-head">
          <div><p class="eyebrow">${escapeHtml(title)}</p><h2>${escapeHtml(title)}</h2></div>
          ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}
        </div>
        <div class="card-grid ${visibleItems.length === 2 ? 'two' : ''}">
          ${visibleItems.map((item) => `
            <article class="card ${item.tone ?? 'neutral'}">
              <h3>${escapeHtml(item.title)}</h3>
              <p>${escapeHtml(item.body)}</p>
            </article>
          `).join('')}
        </div>
      </section>
    `;
  };

  const progressItems = [
    { label: 'Unified', value: variables.metric_unified_pct, text: variables.metric_unified },
    { label: 'SEO', value: variables.metric_seo_pct, text: variables.metric_seo },
    { label: 'AI Visibility', value: variables.metric_geo_pct, text: variables.metric_geo },
    { label: 'Authority', value: variables.metric_authority_pct, text: `Score ${variables.metric_authority}` },
  ].filter((item) => Number(item.value) > 0 || hasContent(item.text));

  const insightRows = [
    { title: uniqueText(variables.insight_title_1, 1), text: uniqueText(variables.insight_text_1, 1) },
    { title: uniqueText(variables.insight_title_2, 1), text: uniqueText(variables.insight_text_2, 1) },
    { title: uniqueText(variables.insight_title_3, 1), text: uniqueText(variables.insight_text_3, 1) },
    { title: uniqueText(variables.insight_title_4, 1), text: uniqueText(variables.insight_text_4, 1) },
  ].filter((item) => item.title && item.text);

  const actionRows = [
    {
      title: uniqueText(variables.action_1_title, 1),
      body: uniqueText(variables.action_1_text, 1),
      meta: [variables.action_1_priority, variables.action_1_impact, variables.action_1_effort].filter(Boolean),
    },
    {
      title: uniqueText(variables.action_2_title, 1),
      body: uniqueText(variables.action_2_text, 1),
      meta: [variables.action_2_priority, variables.action_2_impact, variables.action_2_effort].filter(Boolean),
    },
    {
      title: uniqueText(variables.action_3_title, 1),
      body: uniqueText(variables.action_3_text, 1),
      meta: [variables.action_3_priority, variables.action_3_impact, variables.action_3_effort].filter(Boolean),
    },
  ].filter((item) => item.title && item.body);

  const nextSteps = [
    {
      title: uniqueText(variables.next_step_1_title, 1),
      body: uniqueText(variables.next_step_1_text, 2),
      highlight: uniqueText(variables.next_step_1_highlight, 1),
      meta: [variables.next_step_1_priority, variables.next_step_1_effort, variables.next_step_1_outcome].filter(Boolean),
    },
    {
      title: uniqueText(variables.next_step_2_title, 1),
      body: uniqueText(variables.next_step_2_text, 2),
      highlight: uniqueText(variables.next_step_2_highlight, 1),
      meta: [variables.next_step_2_priority, variables.next_step_2_effort, variables.next_step_2_outcome].filter(Boolean),
    },
  ].filter((item) => item.title && item.body);

  const sections: string[] = [];
  const radarMarkup = visuals ? renderRadarSvg([
    { label: 'Tech', value: visuals.seoCapabilityRadar.technical_seo_score ?? 0 },
    { label: 'Keywords', value: visuals.seoCapabilityRadar.keyword_research_score ?? 0 },
    { label: 'Authority', value: visuals.seoCapabilityRadar.backlinks_score ?? 0 },
    { label: 'Content', value: visuals.seoCapabilityRadar.content_quality_score ?? 0 },
    { label: 'AI', value: geoVisuals?.aiAnswerPresenceRadar.answer_coverage_score ?? 0 },
  ]) : '';
  const progressChartMarkup = renderBarSvg([
    { label: 'Unified', value: Number(variables.metric_unified_pct), color: '#4f7cff' },
    { label: 'SEO', value: Number(variables.metric_seo_pct), color: '#6d8fff' },
    { label: 'AI Visibility', value: Number(variables.metric_geo_pct), color: '#22c55e' },
    { label: 'Authority', value: Number(variables.metric_authority_pct), color: '#f59e0b' },
  ]);
  const closestCompetitor = competitorMovement?.competitors[0] ?? null;
  const competitorComparisonMarkup = closestCompetitor && competitorVisuals ? renderBarSvg([
    { label: 'User Content', value: clampPercent(competitorVisuals.competitorPositioningRadar.user.content_score), color: '#4f7cff' },
    { label: 'Competitor Content', value: clampPercent(closestCompetitor.current_scores.content_score), color: '#f59e0b' },
    { label: 'User Authority', value: clampPercent(competitorVisuals.competitorPositioningRadar.user.authority_score), color: '#4f7cff' },
    { label: 'Competitor Authority', value: clampPercent(closestCompetitor.current_scores.authority_score), color: '#f59e0b' },
    { label: 'User AI', value: clampPercent(competitorVisuals.competitorPositioningRadar.user.ai_answer_presence_score), color: '#4f7cff' },
    { label: 'Competitor AI', value: clampPercent(closestCompetitor.current_scores.ai_answer_presence_score), color: '#f59e0b' },
  ]) : '';
  const diagnosticBarsMarkup = renderBarSvg([
    { label: 'Impressions', value: clampPercent(visuals?.searchVisibilityFunnel.impressions), color: '#4f7cff' },
    { label: 'Clicks', value: clampPercent(visuals?.searchVisibilityFunnel.clicks), color: '#22c55e' },
    { label: 'CTR', value: clampPercent(visuals?.searchVisibilityFunnel.ctr ? visuals.searchVisibilityFunnel.ctr * 100 : 0), color: '#f59e0b' },
    { label: 'Lost Clicks', value: clampPercent(visuals?.searchVisibilityFunnel.estimated_lost_clicks), color: '#ef4444' },
  ]);

  sections.push(`
    <section class="hero">
      <div class="hero-grid">
        <div class="score-panel">
          <span class="kicker">Overall Score</span>
          <strong>${escapeHtml(variables.overall_score)}</strong>
          <p>${escapeHtml(variables.stage_label)} <span class="dot">/</span> ${escapeHtml(variables.confidence_label)}</p>
        </div>
        <div class="hero-copy">
          <p class="eyebrow">Omnivyra Snapshot</p>
          <h1>${escapeHtml(variables.company_name)} Strategic Snapshot</h1>
          <p class="domain">${escapeHtml(variables.website_url)} <span class="dot">/</span> ${escapeHtml(variables.report_date)}</p>
          <p class="lede">${escapeHtml(uniqueText(variables.executive_summary, 2) || variables.executive_summary)}</p>
          <div class="pill-row">
            <span class="pill blue">${escapeHtml(variables.primary_focus)}</span>
            <span class="pill amber">${escapeHtml(variables.stage_label)}</span>
            <span class="pill green">${escapeHtml(variables.confidence_label)}</span>
          </div>
          ${hasContent(variables.banner_text) ? `<div class="highlight-banner"><strong>Primary Focus</strong><p>${escapeHtml(uniqueText(variables.banner_text, 2) || variables.banner_text)}</p></div>` : ''}
        </div>
      </div>
    </section>
  `);

  if (hasContent(unifiedSummaryText) || actionRows.length || hasContent(growthDirectionText)) {
    sections.push(`
      <section class="section">
        <div class="section-head">
          <div><p class="eyebrow">Unified Intelligence</p><h2>What The Report Is Saying</h2></div>
          <p>${escapeHtml(uniqueText(variables.score_summary, 2) || variables.score_summary)}</p>
        </div>
        <div class="three-col">
          <article class="mini-panel scorebox">
            <span>Unified Score</span>
            <strong>${escapeHtml(variables.unified_score)}</strong>
            <p>${escapeHtml(uniqueText(unifiedSummaryText, 2) || unifiedSummaryText)}</p>
          </article>
          <div class="stack">
            ${actionRows.map((item, index) => `
              <article class="action-row">
                <div class="index">${index + 1}</div>
                <div>
                  <h3>${escapeHtml(item.title)}</h3>
                  <div class="meta-row">${item.meta.map((meta) => `<span class="pill subtle">${escapeHtml(meta)}</span>`).join('')}</div>
                  <p>${escapeHtml(item.body)}</p>
                </div>
              </article>
            `).join('')}
          </div>
          ${hasContent(growthDirectionText) ? `
            <article class="mini-panel success">
              <span>Growth Direction</span>
              <p>${escapeHtml(uniqueText(growthDirectionText, 2) || growthDirectionText)}</p>
            </article>
          ` : ''}
        </div>
      </section>
    `);
  }

  const decisionSection = renderCardGrid('Decision Snapshot', [
    { title: 'What Is Broken', body: uniqueText(variables.decision_broken, 1), tone: 'neutral' },
    { title: 'What To Fix First', body: uniqueText(variables.decision_fix_first, 1), tone: 'good' },
    { title: 'What To Delay', body: uniqueText(variables.decision_delay, 1), tone: 'warn' },
    { title: 'If Ignored', body: uniqueText(variables.decision_ignored, 1), tone: 'bad' },
  ], uniqueText(decisionBannerText, 2) || decisionBannerText);
  if (decisionSection) sections.push(decisionSection);

  if (progressItems.length) {
    sections.push(`
      <section class="section">
        <div class="section-head">
          <div><p class="eyebrow">Progress</p><h2>Performance Progress</h2></div>
          <p>Balanced page fill with short readouts instead of large empty score blocks.</p>
        </div>
        <div class="visual-band">
          <div class="visual-card">
            <h3>Score Progress View</h3>
            ${progressChartMarkup}
          </div>
          ${radarMarkup ? `<div class="visual-card"><h3>Capability Radar</h3>${radarMarkup}</div>` : ''}
        </div>
        <div class="metric-grid">
          ${progressItems.map((item) => `
            <article class="metric-card">
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(item.value)}</strong>
              <div class="bar"><span style="width:${Math.max(0, Math.min(100, Number(item.value)))}%"></span></div>
              <p>${escapeHtml(item.text)}</p>
            </article>
          `).join('')}
        </div>
      </section>
    `);
  }

  const competitorCards = competitor && competitorVisuals ? [
    {
      title: competitor.topCompetitor ? `Relative Position vs ${competitor.topCompetitor}` : 'Relative Position vs Market',
      body: uniqueText(competitor.primaryGap.reasoning, 2),
      tone: (competitor.competitivePosition === 'lagging' ? 'bad' : competitor.competitivePosition === 'competitive' ? 'warn' : 'good') as 'bad' | 'warn' | 'good',
    },
    {
      title: 'Keyword Gap',
      body: uniqueText(competitorVisuals.keywordGapAnalysis.missing_keywords.slice(0, 4).join(', '), 1),
      tone: 'warn' as const,
    },
    {
      title: 'Answer Gap',
      body: uniqueText(competitorVisuals.aiAnswerGapAnalysis.missing_answers.slice(0, 3).join(', '), 1),
      tone: 'neutral' as const,
    },
  ] : [];
  const competitorSection = renderCardGrid('Competitor Signals', competitorCards, 'Competitor sections are skipped unless both summary and visual layers exist.');
  if (competitorSection) sections.push(competitorSection);

  const movementCards = competitorMovement ? [
    {
      title: competitorMovement.user_vs_competitor_shift.closest_competitor
        ? `Relative Movement vs ${competitorMovement.user_vs_competitor_shift.closest_competitor}`
        : 'Relative Movement vs Market',
      body: uniqueText(
        competitorMovement.summary.key_movement
        || `${competitorMovement.summary.overall_trend} trend with gap change ${competitorMovement.user_vs_competitor_shift.gap_change ?? 0}.`,
        2,
      ),
      tone: competitorMovement.summary.overall_trend === 'improving'
        ? 'good'
        : competitorMovement.summary.overall_trend === 'declining'
          ? 'bad'
          : 'warn' as const,
    },
    ...competitorMovement.competitors.slice(0, 2).map((item) => ({
      title: item.domain,
      body: uniqueText(
        `Movement ${item.movement}. Keyword ${item.delta.keyword_delta ?? 0}, authority ${item.delta.authority_delta ?? 0}, AI ${item.delta.ai_answer_delta ?? 0}.`,
        1,
      ),
      tone: item.movement === 'improving' ? 'good' : item.movement === 'declining' ? 'bad' : 'neutral' as const,
    })),
  ] : [];
  if (movementCards.length || competitorComparisonMarkup) {
    sections.push(`
      <section class="section">
        <div class="section-head">
          <div><p class="eyebrow">Competitor Movement</p><h2>User vs Competitor Comparison</h2></div>
          <p>Comparison is shown against the nearest competitor across the dimensions that matter most.</p>
        </div>
        ${movementCards.length ? `
          <div class="card-grid ${movementCards.length === 2 ? 'two' : ''}">
            ${movementCards.map((item) => `
              <article class="card ${item.tone ?? 'neutral'}">
                <h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(item.body)}</p>
              </article>
            `).join('')}
          </div>
        ` : ''}
        ${competitorComparisonMarkup ? `
          <div class="visual-card wide compact-top">
            <h3>${escapeHtml(closestCompetitor?.domain ? `User vs ${closestCompetitor.domain}` : 'User vs Closest Competitor')}</h3>
            ${competitorComparisonMarkup}
          </div>
        ` : ''}
      </section>
    `);
  }

  const aiVisualCards = geo && geoVisuals ? [
    {
      title: geo.primaryGap.title,
      body: uniqueText(geo.primaryGap.reasoning, 2),
      tone: geo.primaryGap.severity === 'critical' ? 'bad' : 'warn' as const,
    },
    {
      title: 'Answer Coverage',
      body: uniqueText(`Coverage ${safeScore(geoVisuals.aiAnswerPresenceRadar.answer_coverage_score)} / Entity Clarity ${safeScore(geoVisuals.aiAnswerPresenceRadar.entity_clarity_score)} / Structure ${safeScore(geoVisuals.aiAnswerPresenceRadar.content_structure_score)}`, 1),
      tone: 'neutral' as const,
    },
    {
      title: 'Reusable Answers',
      body: uniqueText(geoVisuals.queryAnswerCoverageMap.queries.slice(0, 3).map((item) => `${item.query} (${item.coverage})`).join(', '), 1),
      tone: 'good' as const,
    },
  ] : [];
  if (aiVisualCards.length) {
    sections.push(`
      <section class="section">
        <div class="section-head">
          <div><p class="eyebrow">AI Visibility</p><h2>AI Visibility</h2></div>
          <p>AI visibility only renders when answer-layer data is available and useful.</p>
        </div>
        <div class="card-grid ${aiVisualCards.length === 2 ? 'two' : ''}">
          ${aiVisualCards.map((item) => `
            <article class="card ${item.tone ?? 'neutral'}">
              <h3>${escapeHtml(item.title)}</h3>
              <p>${escapeHtml(item.body)}</p>
            </article>
          `).join('')}
        </div>
      </section>
    `);
  }

  const visualCards = [
    { title: 'SEO Capability Radar', body: uniqueText(variables.visual_callout_1_text, 1) || uniqueText(variables.visual_reason_1, 1), tone: 'neutral' as const },
    { title: 'Opportunity Coverage Matrix', body: uniqueText(variables.visual_callout_2_text, 1), tone: 'warn' as const },
    { title: 'Search Visibility Funnel', body: uniqueText(variables.visual_callout_3_text, 1), tone: 'neutral' as const },
    { title: 'Crawl Health Breakdown', body: uniqueText(variables.visual_callout_4_text, 1), tone: 'good' as const },
  ].filter((item) => item.body);
  const seoVisualsSection = renderCardGrid('SEO Visuals', visualCards, 'Visual-first blocks are shown only when the source visual has real content.');
  if (seoVisualsSection) sections.push(seoVisualsSection);

  const scoreDimensionCards = [
    visuals ? {
      title: 'Content Quality',
      body: uniqueText(`Score ${safeScore(visuals.seoCapabilityRadar.content_quality_score)}. Measures how well pages answer buyer questions with depth and clarity.`, 1),
      tone: 'warn' as const,
    } : null,
    visuals ? {
      title: 'Authority',
      body: uniqueText(`Score ${safeScore(visuals.seoCapabilityRadar.backlinks_score)}. Indicates how credible and established the brand appears relative to the market.`, 1),
      tone: 'bad' as const,
    } : null,
    visuals ? {
      title: 'Coverage',
      body: uniqueText(`Score ${safeScore(visuals.opportunityCoverageMatrix.opportunities?.[0]?.coverage_score ?? null)}. Shows how much demand and buyer-stage coverage the site currently owns.`, 1),
      tone: 'warn' as const,
    } : null,
    geoVisuals ? {
      title: 'AEO Readiness',
      body: uniqueText(`Score ${safeScore(geoVisuals.aiAnswerPresenceRadar.content_structure_score)}. Reflects how reusable the site is in answer engines and zero-click discovery.`, 1),
      tone: 'neutral' as const,
    } : null,
    visuals ? {
      title: 'Platforms',
      body: uniqueText(`Score ${safeScore(visuals.searchVisibilityFunnel.clicks)}. Tracks whether Omnivyra is present in enough credible channels to support growth.`, 1),
      tone: 'good' as const,
    } : null,
  ].filter(Boolean) as Array<{ title: string; body: string; tone?: 'good' | 'warn' | 'bad' | 'neutral' }>;
  const dimensionSection = renderCardGrid('Dimension Scores', scoreDimensionCards, 'This mirrors the score-by-dimension area from your screenshots without forcing empty boxes.');
  if (dimensionSection) sections.push(dimensionSection);

  const searchAiDiagnosticCards = [
    geoVisuals ? {
      title: 'Query Answer Coverage',
      body: uniqueText(
        geoVisuals.queryAnswerCoverageMap.queries
          .slice(0, 3)
          .map((item) => `${item.query} (${item.coverage})`)
          .join(', '),
        1,
      ),
      tone: 'warn' as const,
    } : null,
    geoVisuals ? {
      title: 'Entity Authority Map',
      body: uniqueText(
        geoVisuals.entityAuthorityMap.entities
          .slice(0, 3)
          .map((item) => `${item.entity} (${safeScore(item.coverage_score)})`)
          .join(', '),
        1,
      ),
      tone: 'neutral' as const,
    } : null,
    geoVisuals ? {
      title: 'Answer Extraction Funnel',
      body: uniqueText(
        `Answerable ${safeScore(geoVisuals.answerExtractionFunnel.answerable_content_pct)} / Structured ${safeScore(geoVisuals.answerExtractionFunnel.structured_content_pct)} / Citation-ready ${safeScore(geoVisuals.answerExtractionFunnel.citation_ready_pct)}.`,
        1,
      ),
      tone: 'good' as const,
    } : null,
    visuals ? {
      title: 'Search Funnel Diagnostics',
      body: uniqueText(
        `Impressions ${safeScore(visuals.searchVisibilityFunnel.impressions)}, clicks ${safeScore(visuals.searchVisibilityFunnel.clicks)}, lost clicks ${safeScore(visuals.searchVisibilityFunnel.estimated_lost_clicks)}.`,
        1,
      ),
      tone: 'neutral' as const,
    } : null,
  ].filter(Boolean) as Array<{ title: string; body: string; tone?: 'good' | 'warn' | 'bad' | 'neutral' }>;
  if (searchAiDiagnosticCards.length) {
    sections.push(`
      <section class="section">
        <div class="section-head">
          <div><p class="eyebrow">Search and AI Diagnostics</p><h2>Search and AI Diagnostics</h2></div>
          <p>Diagnostic graphics stay inside the section so they do not create dead space on the page.</p>
        </div>
        <div class="card-grid ${searchAiDiagnosticCards.length === 2 ? 'two' : ''}">
          ${searchAiDiagnosticCards.map((item) => `
            <article class="card ${item.tone ?? 'neutral'}">
              <h3>${escapeHtml(item.title)}</h3>
              <p>${escapeHtml(item.body)}</p>
            </article>
          `).join('')}
        </div>
        <div class="visual-card wide compact-top">
          <h3>Search Funnel Readout</h3>
          ${diagnosticBarsMarkup}
        </div>
      </section>
    `);
  }

  if (insightRows.length) {
    sections.push(`
      <section class="section">
        <div class="section-head">
          <div><p class="eyebrow">Insights</p><h2>Key Insights</h2></div>
          <p>Repeated lines are suppressed across the report so this section only keeps distinct conclusions.</p>
        </div>
        <div class="stack">
          ${insightRows.map((item) => `
            <article class="insight-row">
              <h3>${escapeHtml(item.title)}</h3>
              <p>${escapeHtml(item.text)}</p>
            </article>
          `).join('')}
        </div>
      </section>
    `);
  }

  const opportunityCards = [
    { title: uniqueText(variables.opportunity_1_title, 1), body: uniqueText(variables.opportunity_1_text, 2), tone: 'warn' as const, tag: variables.opportunity_1_tag },
    { title: uniqueText(variables.opportunity_2_title, 1), body: uniqueText(variables.opportunity_2_text, 2), tone: 'bad' as const, tag: variables.opportunity_2_tag },
    { title: uniqueText(variables.opportunity_3_title, 1), body: uniqueText(variables.opportunity_3_text, 2), tone: 'bad' as const, tag: variables.opportunity_3_tag },
  ].filter((item) => item.title && item.body);
  if (opportunityCards.length) {
    sections.push(`
      <section class="section">
        <div class="section-head">
          <div><p class="eyebrow">Opportunities</p><h2>Improvement Opportunities</h2></div>
          <p>Only non-empty opportunities survive, and duplicate explanations are removed.</p>
        </div>
        <div class="stack">
          ${opportunityCards.map((item) => `
            <article class="card ${item.tone}">
              <div class="card-top"><h3>${escapeHtml(item.title)}</h3><span class="pill subtle">${escapeHtml(item.tag)}</span></div>
              <p>${escapeHtml(item.body)}</p>
            </article>
          `).join('')}
        </div>
      </section>
    `);
  }

  if (nextSteps.length) {
    sections.push(`
      <section class="section">
        <div class="section-head">
          <div><p class="eyebrow">Actions</p><h2>Your Next Steps</h2></div>
          <p>Next steps stay compact and outcome-led to match the screenshot rhythm.</p>
        </div>
        <div class="stack">
          ${nextSteps.map((item, index) => `
            <article class="step-row">
              <div class="index large">${index + 1}</div>
              <div>
                <h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(item.body)}</p>
                ${item.highlight ? `<div class="step-highlight">${escapeHtml(item.highlight)}</div>` : ''}
                <div class="meta-row">${item.meta.map((meta) => `<span class="pill subtle">${escapeHtml(meta)}</span>`).join('')}</div>
              </div>
            </article>
          `).join('')}
        </div>
      </section>
    `);
  }

  sections.push(`
    <section class="section cta">
      <h2>Ready to execute?</h2>
      <p>${escapeHtml(uniqueText(variables.cta_text, 2) || variables.cta_text)}</p>
      <span class="button">${escapeHtml(variables.cta_label)}</span>
    </section>
  `);

  const html = `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Omnivyra Snapshot Master Report</title>
    <style>
      @page { size: A4; margin: 14mm; }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      :root { --bg:#edf4fd; --paper:#fff; --line:#d7e2ef; --ink:#102033; --muted:#61718a; --blue:#4f7cff; --blue-soft:#eef3ff; --green:#16a34a; --green-soft:#ecfdf3; --amber:#f59e0b; --amber-soft:#fff7e8; --red:#ef4444; --red-soft:#fff1f2; }
      html,body { background:var(--bg); color:var(--ink); font-family:"Segoe UI",Arial,sans-serif; line-height:1.42; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      .report { width:760px; margin:0 auto; padding:18px 0 26px; }
      .card,.metric-card,.insight-row,.step-row,.action-row,.mini-panel,.visual-card { break-inside:avoid-page; page-break-inside:avoid; }
      .hero,.section { background:var(--paper); border:1px solid var(--line); border-radius:20px; box-shadow:0 10px 28px rgba(15,23,42,.05); padding:16px; margin-bottom:12px; }
      .hero-grid,.three-col,.metric-grid,.card-grid { display:grid; gap:10px; }
      .hero-grid { grid-template-columns:118px 1fr; align-items:start; }
      .three-col { grid-template-columns:150px 1fr 160px; }
      .metric-grid { grid-template-columns:repeat(4,1fr); }
      .card-grid { grid-template-columns:repeat(2,1fr); }
      .card-grid.two { grid-template-columns:repeat(2,1fr); }
      .visual-band { display:grid; grid-template-columns:1.2fr .8fr; gap:10px; margin-bottom:12px; }
      .score-panel,.mini-panel,.metric-card,.card,.insight-row,.step-row,.action-row { border:1px solid var(--line); border-radius:14px; background:#fff; padding:12px; }
      .visual-card { border:1px solid var(--line); border-radius:14px; background:#fbfdff; padding:12px; }
      .visual-card.wide { background:#fff; }
      .visual-card.compact-top { margin-top:10px; }
      .visual-card h3 { font-size:12px; margin-bottom:8px; }
      .svg-chart { width:100%; height:auto; display:block; }
      .svg-chart.radar { max-width:180px; margin:0 auto; }
      .score-panel { background:linear-gradient(180deg,#f7faff 0%,#edf3ff 100%); text-align:center; }
      .score-panel .kicker,.mini-panel span,.metric-card span,.eyebrow { display:block; font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; margin-bottom:6px; }
      .score-panel strong,.mini-panel.scorebox strong { display:block; font-size:40px; line-height:1; color:var(--blue); margin-bottom:6px; }
      .score-panel p,.hero-copy p,.metric-card p,.card p,.insight-row p,.step-row p,.mini-panel p,.action-row p,.section-head p { font-size:12px; color:var(--ink); }
      .hero-copy h1,.section h2 { font-size:22px; margin-bottom:6px; }
      .domain { color:var(--muted) !important; margin-bottom:8px; }
      .lede { margin-bottom:10px; }
      .section-head { display:flex; justify-content:space-between; align-items:end; gap:10px; margin-bottom:10px; }
      .section-head p { color:var(--muted); max-width:320px; text-align:right; }
      .pill-row,.meta-row { display:flex; gap:6px; flex-wrap:wrap; }
      .pill { border-radius:999px; padding:5px 8px; border:1px solid var(--line); background:#fff; font-size:10px; color:var(--muted); }
      .pill.blue { background:var(--blue-soft); color:var(--blue); border-color:#cad7ff; }
      .pill.green { background:var(--green-soft); color:#15803d; border-color:#b9ebc8; }
      .pill.amber { background:var(--amber-soft); color:#b45309; border-color:#f4d28b; }
      .pill.subtle { background:#f8fbff; }
      .highlight-banner,.step-highlight { margin-top:10px; border-radius:10px; padding:10px 12px; background:var(--green-soft); border:1px solid #b9ebc8; color:#166534; font-size:11px; }
      .highlight-banner strong { display:block; font-size:10px; text-transform:uppercase; margin-bottom:4px; }
      .stack { display:grid; gap:8px; }
      .action-row,.step-row { display:grid; grid-template-columns:28px 1fr; gap:10px; }
      .index { width:20px; height:20px; border-radius:999px; display:flex; align-items:center; justify-content:center; background:var(--blue-soft); color:var(--blue); font-size:11px; font-weight:800; margin-top:2px; }
      .index.large { width:24px; height:24px; }
      .card.good,.mini-panel.success { background:var(--green-soft); border-color:#b9ebc8; }
      .card.warn { background:var(--amber-soft); border-color:#f4d28b; }
      .card.bad { background:var(--red-soft); border-color:#f3b0b7; }
      .card h3,.action-row h3,.step-row h3,.insight-row h3 { font-size:13px; margin-bottom:6px; }
      .metric-card strong { display:block; font-size:28px; line-height:1; color:var(--blue); margin-bottom:8px; }
      .bar { height:8px; border-radius:999px; background:#e7edf7; overflow:hidden; margin:8px 0; }
      .bar span { display:block; height:100%; background:linear-gradient(90deg,#86a9ff 0%,#4f7cff 100%); border-radius:999px; }
      .card-top { display:flex; align-items:start; justify-content:space-between; gap:10px; margin-bottom:6px; }
      .cta { text-align:center; }
      .button { display:inline-block; margin-top:10px; background:var(--blue); color:#fff; border-radius:10px; padding:10px 14px; font-size:12px; font-weight:700; }
      .dot { opacity:.4; margin:0 6px; }
    </style>
  </head>
  <body>
    <div class="report">
      ${sections.join('')}
    </div>
  </body>
  </html>`;

  return {
    html,
    templateName: 'omnivyra_snapshot_master_report.html',
  };
}

function renderOmnivyraExecutionEndgameHtml(payload: PdfReportPayload): { html: string; templateName: string } {
  const variables = buildTemplateVariables(payload);

  const opportunities = [
    { title: safeText(variables.opportunity_1_title, 1), text: safeText(variables.opportunity_1_text, 2), tag: safeText(variables.opportunity_1_tag, 1), tone: 'warn' },
    { title: safeText(variables.opportunity_2_title, 1), text: safeText(variables.opportunity_2_text, 2), tag: safeText(variables.opportunity_2_tag, 1), tone: 'bad' },
    { title: safeText(variables.opportunity_3_title, 1), text: safeText(variables.opportunity_3_text, 2), tag: safeText(variables.opportunity_3_tag, 1), tone: 'bad' },
  ].filter((item) => item.title && item.text);

  const nextSteps = [
    {
      title: safeText(variables.next_step_1_title, 1),
      text: safeText(variables.next_step_1_text, 2),
      highlight: safeText(variables.next_step_1_highlight, 1),
      meta: [variables.next_step_1_priority, variables.next_step_1_outcome, variables.next_step_1_effort].filter(Boolean).map((value) => safeText(value, 1)),
    },
    {
      title: safeText(variables.next_step_2_title, 1),
      text: safeText(variables.next_step_2_text, 2),
      highlight: safeText(variables.next_step_2_highlight, 1),
      meta: [variables.next_step_2_priority, variables.next_step_2_outcome, variables.next_step_2_effort].filter(Boolean).map((value) => safeText(value, 1)),
    },
  ].filter((item) => item.title && item.text);

  const metricCards = [
    { label: 'Request Context', value: variables.metric_request, text: variables.metric_request_text },
    { label: 'Visibility', value: variables.metric_visibility, text: variables.metric_visibility_text },
    { label: 'Content Strength', value: variables.metric_content, text: variables.metric_content_text },
    { label: 'Authority', value: variables.metric_authority, text: variables.metric_authority_text },
  ];

  const html = `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Omnivyra Execution Endgame</title>
    <style>
      @page { size: A4; margin: 14mm; }
      * { box-sizing:border-box; margin:0; padding:0; }
      :root { --bg:#f1f6fd; --paper:#fff; --line:#d9e4f0; --ink:#0f172a; --muted:#61708a; --blue:#4f7cff; --blue-soft:#eef4ff; --green:#16a34a; --green-soft:#ecfdf3; --red:#ef4444; --red-soft:#fff1f2; --amber:#f59e0b; --amber-soft:#fff7e8; }
      html,body { background:var(--bg); color:var(--ink); font-family:"Segoe UI",Arial,sans-serif; line-height:1.42; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      .report { width:760px; margin:0 auto; padding:18px 0 28px; }
      .panel,.metric,.step,.opportunity { break-inside:avoid-page; page-break-inside:avoid; }
      .panel { background:var(--paper); border:1px solid var(--line); border-radius:18px; box-shadow:0 8px 24px rgba(15,23,42,.05); padding:16px; margin-bottom:12px; }
      h1,h2 { font-size:20px; margin-bottom:10px; }
      .sub { font-size:12px; color:var(--muted); margin-bottom:10px; }
      .metric-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-bottom:12px; }
      .metric { border:1px solid var(--line); border-radius:12px; background:#fff; padding:12px; }
      .metric strong { display:block; font-size:11px; color:var(--muted); text-transform:uppercase; margin-bottom:8px; }
      .metric .value { font-size:28px; line-height:1; font-weight:800; color:var(--blue); margin-bottom:8px; }
      .metric .bar { height:7px; border-radius:999px; background:#e8edf5; overflow:hidden; margin-bottom:6px; }
      .metric .bar span { display:block; height:100%; border-radius:999px; background:linear-gradient(90deg,#67d36f 0%,#22c55e 100%); }
      .metric p { font-size:12px; color:var(--muted); }
      .opportunities,.steps { display:grid; gap:10px; }
      .opportunity { border:1px solid var(--line); border-radius:12px; padding:12px; background:#fff; }
      .opportunity.warn { background:var(--amber-soft); border-color:#f3d18a; }
      .opportunity.bad { background:var(--red-soft); border-color:#f1b0b8; }
      .opportunity h3,.step h3 { font-size:12px; margin-bottom:6px; }
      .opportunity p,.step p { font-size:12px; margin-bottom:6px; }
      .tag,.pill { display:inline-block; font-size:10px; font-weight:700; padding:5px 8px; border-radius:999px; border:1px solid var(--line); background:#fff; color:var(--muted); }
      .step { border:1px solid var(--line); border-radius:12px; background:white; padding:14px; display:grid; grid-template-columns:24px 1fr; gap:10px; }
      .step .index { width:20px; height:20px; border-radius:50%; background:var(--blue-soft); color:var(--blue); font-size:11px; display:flex; align-items:center; justify-content:center; font-weight:800; margin-top:2px; }
      .step .highlight { background:var(--green-soft); border-radius:8px; padding:8px 10px; color:#166534; font-size:11px; margin:6px 0; }
      .step .meta { display:flex; flex-wrap:wrap; gap:6px; margin:6px 0; }
      .pill.blue { background:var(--blue-soft); color:var(--blue); border-color:#ced8ff; }
      .pill.green { background:var(--green-soft); color:var(--green); border-color:#bbe8c6; }
      .pill.red { background:var(--red-soft); color:var(--red); border-color:#f1b0b8; }
      .cta { text-align:center; border:1px solid var(--line); border-radius:16px; background:#fbfdff; padding:18px; }
      .cta h3 { font-size:18px; margin-bottom:6px; }
      .cta p { font-size:12px; color:var(--muted); margin-bottom:10px; }
      .button { display:inline-block; background:var(--blue); color:white; border-radius:10px; padding:10px 14px; font-size:12px; font-weight:700; }
    </style>
  </head>
  <body>
    <div class="report">
      <section class="panel">
        <h1>${escapeHtml(variables.company_name)} Execution Endgame</h1>
        <div class="sub">${escapeHtml(variables.executive_summary)}</div>
        <div class="metric-grid">
          ${metricCards.map((item) => `
            <div class="metric">
              <strong>${escapeHtml(item.label)}</strong>
              <div class="value">${escapeHtml(item.value)}</div>
              <div class="bar"><span style="width: ${Math.max(0, Math.min(100, Number(item.value) || 0))}%"></span></div>
              <p>${escapeHtml(item.text)}</p>
            </div>
          `).join('')}
        </div>
      </section>
      ${opportunities.length ? `
        <section class="panel">
          <h2>Improvement Opportunities</h2>
          <div class="opportunities">
            ${opportunities.map((item) => `
              <div class="opportunity ${item.tone}">
                <h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(item.text)}</p>
                <span class="tag">${escapeHtml(item.tag)}</span>
              </div>
            `).join('')}
          </div>
        </section>
      ` : ''}
      ${nextSteps.length ? `
        <section class="panel">
          <h2>Your Next Steps</h2>
          <div class="steps">
            ${nextSteps.map((item, index) => `
              <div class="step">
                <div class="index">${index + 1}</div>
                <div>
                  <h3>${escapeHtml(item.title)}</h3>
                  <p>${escapeHtml(item.text)}</p>
                  ${item.highlight ? `<div class="highlight">${escapeHtml(item.highlight)}</div>` : ''}
                  <div class="meta">
                    ${item.meta.map((meta, metaIndex) => `<span class="pill ${metaIndex === 0 ? 'blue' : metaIndex === 1 ? 'green' : 'red'}">${escapeHtml(meta)}</span>`).join('')}
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </section>
      ` : ''}
      <section class="panel"><div class="cta"><h3>Ready to execute?</h3><p>${escapeHtml(variables.cta_text)}</p><span class="button">${escapeHtml(variables.cta_label)}</span></div></section>
    </div>
  </body>
  </html>`;

  return {
    html,
    templateName: 'omnivyra_execution_endgame_report_template.html',
  };
}

function buildTemplateVariables(payload: PdfReportPayload): Record<string, string> {
  const brandName = getBrandName(payload);
  const brandProfile = getBrandProfile(payload);
  const seo = payload.seoExecutiveSummary;
  const visuals = payload.seoVisuals;
  const geo = payload.geoAeoExecutiveSummary;
  const topActions = seo?.top3Actions ?? [];
  const mappedActions = payload.nextSteps.length > 0
    ? payload.nextSteps.map((step) => ({
        title: safeText(step.action, 1),
        text: safeText(step.description || step.expectedOutcome || step.priorityWhy, 1),
      }))
    : topActions.map((action) => ({
        title: safeText(action.actionTitle, 1),
        text: safeText(action.reasoning, 1),
      }));
  const action1 = mappedActions[0] ?? { title: '', text: '' };
  const action2 = mappedActions[1] ?? { title: '', text: '' };
  const action3 = mappedActions[2] ?? { title: '', text: '' };
  const competitorSummary = safeText(payload.competitorIntelligenceSummary?.primaryGap.reasoning, 1);
  const decisionSummary = safeText(payload.decisionSnapshot?.whatToFixFirst, 1);
  const opportunitySummary = safeText(seo?.growthOpportunity?.title || seo?.growthOpportunity?.estimatedUpside, 1);
  const geoSummary = safeText(geo?.primaryGap.reasoning || geo?.visibilityOpportunity?.title, 1);
  const overallScore = getOverallScore(payload);
  const unifiedScore = payload.unifiedIntelligenceSummary?.unifiedScore ?? seo?.overallHealthScore ?? 0;
  const confidenceLabel = safeText(
    payload.unifiedIntelligenceSummary?.confidence
    || seo?.confidence
    || geo?.confidence
    || 'medium',
    1,
  ).toUpperCase();
  const stageLabel = overallScore <= 44 ? 'EARLY-STAGE' : overallScore <= 74 ? 'GROWING' : 'LEADER';
  const bannerText = safeText(
    payload.unifiedIntelligenceSummary?.primaryConstraint.reasoning
    || payload.summary
    || payload.diagnosis,
    2,
  );
  const next1 = payload.nextSteps[0];
  const next2 = payload.nextSteps[1];
  const visual1 = safeText(visuals?.seoCapabilityRadar.insightSentence, 1);
  const visual2 = safeText(visuals?.opportunityCoverageMatrix.insightSentence, 1);
  const visual3 = safeText(visuals?.searchVisibilityFunnel.insightSentence, 1);
  const visual4 = safeText(visuals?.crawlHealthBreakdown.insightSentence, 1);

  return {
    company_name: brandProfile?.companyName ?? brandName,
    website_url: brandProfile?.websiteUrl ?? safeText(payload.domain, 1),
    report_date: safeText(payload.generatedDate, 1),
    primary_focus: brandProfile?.primaryFocus ?? safeText(
      payload.decisionSnapshot?.primaryFocusArea
      || payload.unifiedIntelligenceSummary?.primaryConstraint.title
      || seo?.primaryProblem.title
      || payload.title,
      1,
    ),
    overall_score: safeScore(getOverallScore(payload)),
    unified_score: safeScore(unifiedScore),
    unified_summary: safeText(
      payload.unifiedIntelligenceSummary?.marketContextSummary
      || payload.unifiedIntelligenceSummary?.primaryConstraint.reasoning
      || seo?.primaryProblem.reasoning
      || payload.summary,
      2,
    ),
    stage_label: stageLabel,
    confidence_label: `CONFIDENCE: ${confidenceLabel}`,
    banner_text: bannerText,
    executive_summary: brandProfile?.executiveSummary ?? safeText(payload.diagnosis || payload.summary, 2),
    confidence_summary: brandProfile?.confidenceSummary ?? safeText(payload.summary || payload.diagnosis, 2),
    score_summary: brandProfile?.scoreSummary ?? safeText(
      payload.unifiedIntelligenceSummary?.marketContextSummary
      || seo?.primaryProblem.reasoning
      || payload.summary,
      2,
    ),
    seo_score: safeScore(seo?.overallHealthScore),
    seo_summary: safeText(
      visuals?.seoCapabilityRadar.insightSentence || seo?.primaryProblem.reasoning,
      1,
    ),
    messaging_score: safeScore(visuals?.searchVisibilityFunnel.ctr ? visuals.searchVisibilityFunnel.ctr * 100 : null),
    messaging_summary: safeText(visuals?.searchVisibilityFunnel.insightSentence, 1),
    conversion_score: safeScore(visuals?.opportunityCoverageMatrix.opportunities?.[0]?.coverage_score ?? null),
    conversion_summary: brandProfile?.conversionSummary ?? safeText(
      seo?.growthOpportunity?.title || payload.summary,
      1,
    ),
    trust_score: safeScore(visuals?.seoCapabilityRadar.backlinks_score),
    trust_summary: brandProfile?.trustSummary ?? safeText(
      payload.companyContext?.positioningNarrative || payload.companyContext?.marketNarrative || seo?.growthOpportunity?.basedOn,
      1,
    ),
    authority_score: safeScore(visuals?.seoCapabilityRadar.backlinks_score),
    authority_summary: safeText(
      seo?.growthOpportunity?.basedOn || visuals?.crawlHealthBreakdown.insightSentence,
      1,
    ),
    visibility_score: safeScore(visuals?.searchVisibilityFunnel.impressions ? Math.min(100, Math.round((visuals.searchVisibilityFunnel.clicks ?? 0) / Math.max(visuals.searchVisibilityFunnel.impressions, 1) * 1000)) : null),
    visibility_summary: safeText(visuals?.searchVisibilityFunnel.insightSentence, 1),
    visual_title: safeText(seo?.top3Actions?.[0]?.linkedVisual || 'visual evidence', 1),
    visual_summary: safeText(
      visuals?.opportunityCoverageMatrix.insightSentence
      || visuals?.crawlHealthBreakdown.insightSentence
      || payload.summary,
      2,
    ),
    visual_callout_1_title: safeText('Coverage Gap', 1),
    visual_callout_1_text: safeText(visuals?.opportunityCoverageMatrix.insightSentence || opportunitySummary, 1),
    visual_callout_2_title: safeText('Visibility Leak', 1),
    visual_callout_2_text: safeText(visuals?.searchVisibilityFunnel.insightSentence || decisionSummary, 1),
    visual_callout_3_text: visual3,
    visual_callout_4_text: visual4,
    visual_confidence_1: `CONFIDENCE ${safeText(visuals?.seoCapabilityRadar.confidence, 1).toUpperCase() || 'MEDIUM'}`,
    visual_confidence_2: `CONFIDENCE ${safeText(visuals?.opportunityCoverageMatrix.confidence, 1).toUpperCase() || 'MEDIUM'}`,
    visual_confidence_3: `CONFIDENCE ${safeText(visuals?.searchVisibilityFunnel.confidence, 1).toUpperCase() || 'MEDIUM'}`,
    visual_confidence_4: `CONFIDENCE ${safeText(visuals?.crawlHealthBreakdown.confidence, 1).toUpperCase() || 'MEDIUM'}`,
    visual_reason_1: visual1 || payload.summary,
    visual_reason_3: visual3 || payload.summary,
    visual_reason_4: visual4 || payload.summary,
    radar_metric_1: safeScore(visuals?.seoCapabilityRadar.technical_seo_score),
    radar_metric_2: safeScore(visuals?.seoCapabilityRadar.keyword_research_score),
    radar_metric_3: safeScore(visuals?.seoCapabilityRadar.backlinks_score),
    radar_metric_4: safeScore(visuals?.seoCapabilityRadar.content_quality_score),
    matrix_missing: safeText(
      visuals?.opportunityCoverageMatrix.opportunities?.slice(0, 2).map((item) => item.keyword).join(', '),
      1,
    ),
    matrix_weak: safeText(
      visuals?.opportunityCoverageMatrix.opportunities?.slice(0, 2).map((item) => `${item.keyword} (${item.coverage_score})`).join(', '),
      1,
    ),
    matrix_strong: safeText(
      payload.companyContext?.companyName ? `${payload.companyContext.companyName}, SaaS, omnivyra` : 'Brand, category, product',
      1,
    ),
    funnel_impressions: safeScore(visuals?.searchVisibilityFunnel.impressions),
    funnel_clicks: safeScore(visuals?.searchVisibilityFunnel.clicks),
    funnel_ctr: safeScore(visuals?.searchVisibilityFunnel.ctr ? visuals.searchVisibilityFunnel.ctr * 100 : null),
    funnel_lost: safeScore(visuals?.searchVisibilityFunnel.estimated_lost_clicks),
    crawl_metadata: safeScore(visuals?.crawlHealthBreakdown.metadata_issues),
    crawl_structure: safeScore(visuals?.crawlHealthBreakdown.structure_issues),
    crawl_links: safeScore(visuals?.crawlHealthBreakdown.internal_link_issues),
    crawl_depth: safeScore(visuals?.crawlHealthBreakdown.crawl_depth_issues),
    insight_title_1: safeText(seo?.primaryProblem.title || 'Primary constraint', 1),
    insight_text_1: safeText(seo?.primaryProblem.reasoning || payload.diagnosis, 1),
    insight_title_2: safeText(geo?.primaryGap.title || 'Growth opportunity', 1),
    insight_text_2: safeText(geoSummary || opportunitySummary || payload.summary, 1),
    insight_title_3: safeText(payload.competitorIntelligenceSummary?.primaryGap.title || 'Execution implication', 1),
    insight_text_3: safeText(
      competitorSummary
      || decisionSummary
      || payload.summary,
      1,
    ),
    insight_title_4: safeText('Market implication', 1),
    insight_text_4: safeText(payload.unifiedIntelligenceSummary?.marketContextSummary || payload.summary, 1),
    decision_banner: safeText(
      payload.decisionSnapshot?.primaryFocusArea
      ? `Primary focus area: ${payload.decisionSnapshot.primaryFocusArea}. ${payload.decisionSnapshot.whatsBroken ?? ''}`
      : payload.summary,
      2,
    ),
    decision_broken: safeText(payload.decisionSnapshot?.whatsBroken || payload.diagnosis, 1),
    decision_fix_first: safeText(payload.decisionSnapshot?.whatToFixFirst || decisionSummary, 1),
    decision_delay: safeText(payload.decisionSnapshot?.whatToDelay || 'Delay low-impact expansion until core constraints improve.', 1),
    decision_ignored: safeText(payload.decisionSnapshot?.ifIgnored || 'Core performance constraints will persist.', 1),
    execution_sequence: safeText(payload.decisionSnapshot?.executionSequence?.join(' -> '), 2),
    executed_well: safeText(payload.decisionSnapshot?.ifExecutedWell || payload.summary, 2),
    impact_timeline: safeText(
      payload.decisionSnapshot
        ? `${payload.decisionSnapshot.whenToExpectImpact.shortTerm}; ${payload.decisionSnapshot.whenToExpectImpact.midTerm}; ${payload.decisionSnapshot.whenToExpectImpact.longTerm}`
        : '',
      2,
    ),
    growth_direction: safeText(
      payload.unifiedIntelligenceSummary
        ? `${payload.unifiedIntelligenceSummary.growthDirection.shortTermFocus} ${payload.unifiedIntelligenceSummary.growthDirection.longTermFocus}`
        : opportunitySummary,
      2,
    ),
    metric_unified: safeText(`Score ${safeScore(unifiedScore)}`, 1),
    metric_unified_pct: safeScore(unifiedScore),
    metric_seo: safeText(`Score ${safeScore(seo?.overallHealthScore)}`, 1),
    metric_seo_pct: safeScore(seo?.overallHealthScore),
    metric_geo: safeText(`Score ${safeScore(geo?.overallAiVisibilityScore)}`, 1),
    metric_geo_pct: safeScore(geo?.overallAiVisibilityScore),
    metric_authority: safeScore(visuals?.seoCapabilityRadar.backlinks_score),
    metric_authority_pct: safeScore(visuals?.seoCapabilityRadar.backlinks_score),
    action_1_title: action1.title || safeText('Clarify Omnivyra system narrative', 1),
    action_1_text: action1.text || safeText('Lead with the end-to-end workflow so buyers immediately understand how Omnivyra connects insight, planning, execution, and optimization.', 1),
    action_1_priority: safeText(topActions[0]?.priority || 'priority high', 1).toUpperCase(),
    action_1_impact: safeText(topActions[0]?.expectedImpact || 'impact high', 1).toUpperCase(),
    action_1_effort: safeText(topActions[0]?.effort || 'effort medium', 1).toUpperCase(),
    action_2_title: action2.title || safeText('Strengthen proof across product pages', 1),
    action_2_text: action2.text || safeText('Use evidence blocks that show readiness analysis, strategy logic, and operational depth instead of generic AI-product language.', 1),
    action_2_priority: safeText(topActions[1]?.priority || 'priority high', 1).toUpperCase(),
    action_2_impact: safeText(topActions[1]?.expectedImpact || 'impact medium', 1).toUpperCase(),
    action_2_effort: safeText(topActions[1]?.effort || 'effort low', 1).toUpperCase(),
    action_3_title: action3.title || safeText('Tighten conversion path', 1),
    action_3_text: action3.text || safeText('Reduce friction between product understanding and action so visitors move naturally from curiosity into analysis, planning, or account creation.', 1),
    action_3_priority: safeText(topActions[2]?.priority || 'priority medium', 1).toUpperCase(),
    action_3_impact: safeText(topActions[2]?.expectedImpact || 'impact medium', 1).toUpperCase(),
    action_3_effort: safeText(topActions[2]?.effort || 'effort medium', 1).toUpperCase(),
    proof_1_label: safeText('Operating System Narrative', 1),
    proof_1_value: safeScore(payload.unifiedIntelligenceSummary?.unifiedScore ?? seo?.overallHealthScore ?? null),
    proof_1_text: safeText(
      brandProfile
        ? 'Omnivyra should be framed as the command layer connecting readiness, strategy, creation, publishing, and optimization.'
        : seo?.growthOpportunity?.basedOn || payload.summary,
      2,
    ),
    proof_2_label: safeText('Buyer Clarity', 1),
    proof_2_value: safeScore(visuals?.opportunityCoverageMatrix.opportunities?.[0]?.opportunity_score ?? null),
    proof_2_text: safeText(
      brandProfile
        ? 'The site should make it obvious why Omnivyra is different from point-solution AI tools and fragmented marketing stacks.'
        : visuals?.opportunityCoverageMatrix.insightSentence || payload.summary,
      2,
    ),
    proof_3_label: safeText('Execution Confidence', 1),
    proof_3_value: safeScore(visuals?.searchVisibilityFunnel.estimated_lost_clicks != null ? 100 - Math.min(100, visuals.searchVisibilityFunnel.estimated_lost_clicks) : null),
    proof_3_text: safeText(
      brandProfile
        ? 'Trust rises when Omnivyra shows how insight becomes action inside one system instead of leaving the workflow implied.'
        : decisionSummary || payload.summary,
      2,
    ),
    workflow_1_title: safeText(
      brandProfile ? 'Understand readiness' : 'Read the situation',
      1,
    ),
    workflow_1_text: safeText(
      brandProfile
        ? 'Omnivyra begins by diagnosing website readiness, messaging clarity, and growth friction so teams can see what is actually holding performance back.'
        : payload.diagnosis,
      2,
    ),
    workflow_2_title: safeText(
      brandProfile ? 'Plan the system' : 'Turn insight into direction',
      1,
    ),
    workflow_2_text: safeText(
      brandProfile
        ? 'The platform translates those signals into strategy, campaign structure, priorities, and content direction without forcing teams to jump between disconnected tools.'
        : opportunitySummary || payload.summary,
      2,
    ),
    workflow_3_title: safeText(
      brandProfile ? 'Execute and improve' : 'Move into execution',
      1,
    ),
    workflow_3_text: safeText(
      brandProfile
        ? 'Omnivyra closes the loop by supporting creation, publishing, and ongoing optimization so execution stays aligned with the original strategic intent.'
        : brandProfile?.ctaText || payload.summary,
      2,
    ),
    metric_request: safeScore(visuals?.searchVisibilityFunnel.impressions ? Math.min(100, Math.round((visuals.searchVisibilityFunnel.impressions as number) / 100)) : null),
    metric_request_text: safeText('Tracks how much demand context is available for this report run.', 1),
    metric_visibility: safeScore(visuals?.searchVisibilityFunnel.clicks),
    metric_visibility_text: safeText(visuals?.searchVisibilityFunnel.insightSentence, 1),
    metric_content: safeScore(visuals?.seoCapabilityRadar.content_quality_score),
    metric_content_text: safeText('Measures how well pages answer buyer questions with depth and clarity.', 1),
    metric_authority_text: safeText('Reflects how credible and established the brand looks in market context.', 1),
    opportunity_1_title: safeText(action1.title || 'Improvement opportunity one', 1),
    opportunity_1_text: safeText(action1.text || payload.summary, 2),
    opportunity_1_tag: safeText('PLAN NEXT', 1),
    opportunity_2_title: safeText(action2.title || 'Improvement opportunity two', 1),
    opportunity_2_text: safeText(action2.text || payload.summary, 2),
    opportunity_2_tag: safeText('ACT NOW', 1),
    opportunity_3_title: safeText(action3.title || 'Improvement opportunity three', 1),
    opportunity_3_text: safeText(action3.text || payload.summary, 2),
    opportunity_3_tag: safeText('PLAN NEXT', 1),
    next_step_1_title: safeText(next1?.action || action1.title || 'Next step one', 1),
    next_step_1_text: safeText(next1?.description || next1?.priorityWhy || action1.text, 2),
    next_step_1_highlight: safeText(next1?.expectedOutcome || 'Near-term upside should become clearer after execution.', 1),
    next_step_1_priority: safeText(next1?.priorityType || 'quick win', 1).toUpperCase(),
    next_step_1_effort: safeText(next1?.effortLevel || 'low', 1).toUpperCase(),
    next_step_1_outcome: safeText(next1?.expectedUpside || 'faster discovery', 1),
    next_step_2_title: safeText(next2?.action || action2.title || 'Next step two', 1),
    next_step_2_text: safeText(next2?.description || next2?.priorityWhy || action2.text, 2),
    next_step_2_highlight: safeText(next2?.expectedOutcome || 'Commercial trust should improve as the message becomes clearer.', 1),
    next_step_2_priority: safeText(next2?.priorityType || 'high impact', 1).toUpperCase(),
    next_step_2_effort: safeText(next2?.effortLevel || 'medium', 1).toUpperCase(),
    next_step_2_outcome: safeText(next2?.expectedUpside || 'better conversion readiness', 1),
    cta_title: safeText('Recommended next move', 1),
    cta_text: brandProfile?.ctaText ?? safeText(
      payload.decisionSnapshot?.ifExecutedWell
      || seo?.growthOpportunity?.estimatedUpside
      || payload.summary,
      2,
    ),
    cta_label: safeText('Act on top priority', 1),
  };
}

export function renderReportHtmlWithTemplate(
  payload: PdfReportPayload,
  templateName: TemplateChoice,
): { html: string; templateName: string } {
  if (templateName === 'omnivyra_snapshot_master_report.html') {
    return renderOmnivyraSnapshotMasterHtml(payload);
  }
  if (templateName === 'omnivyra_execution_endgame_report_template.html') {
    return renderOmnivyraExecutionEndgameHtml(payload);
  }

  const templatePath = path.join(process.cwd(), 'templates', templateName);
  const template = fs.readFileSync(templatePath, 'utf8');
  const variables = buildTemplateVariables(payload);

  const html = Object.entries(variables).reduce((acc, [key, value]) => {
    return acc.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), escapeHtml(value));
  }, template);

  return {
    html,
    templateName,
  };
}

export function renderReportHtmlTemplate(payload: PdfReportPayload): { html: string; templateName: string } {
  return renderReportHtmlWithTemplate(payload, chooseTemplate(payload));
}
