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
    executiveSummary: 'The site should communicate one operating system for readiness, strategy, creation, publishing, and optimization, then convert that understanding into action.',
    confidenceSummary: 'This version should read like an executive report, with product clarity, system credibility, and buyer momentum reinforced across sections.',
    scoreSummary: 'The strongest report balances strategic intelligence with product trust: what the platform does, why the workflow matters, and where the site is leaking conversion confidence.',
    trustSummary: 'Credibility comes from workflow clarity, depth of capability, and visible proof of execution across the pages that drive decisions.',
    conversionSummary: 'Conversion depends on connecting readiness analysis, campaign planning, content execution, and optimization into one buyer journey.',
    ctaText: 'Tighten the story so the site presents one connected system from understanding through execution, not a set of isolated SEO tasks.',
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

function hasNonEmptyList(values: Array<string | null | undefined> | null | undefined): boolean {
  return Array.isArray(values) && values.some((value) => hasContent(value));
}

function hasRealAiVisibilityData(payload: PdfReportPayload): boolean {
  const radar = payload.geoAeoVisuals?.aiAnswerPresenceRadar;
  const queryMap = payload.geoAeoVisuals?.queryAnswerCoverageMap;
  const extraction = payload.geoAeoVisuals?.answerExtractionFunnel;
  const entityMap = payload.geoAeoVisuals?.entityAuthorityMap;

  return Boolean(
    (payload.geoAeoExecutiveSummary?.overallAiVisibilityScore ?? 0) > 0 ||
    (radar?.answer_coverage_score ?? 0) > 0 ||
    (radar?.entity_clarity_score ?? 0) > 0 ||
    (radar?.topical_authority_score ?? 0) > 0 ||
    (radar?.citation_readiness_score ?? 0) > 0 ||
    (radar?.content_structure_score ?? 0) > 0 ||
    (radar?.freshness_score ?? 0) > 0 ||
    (queryMap?.queries?.length ?? 0) > 0 ||
    (extraction?.total_queries ?? 0) > 0 ||
    (entityMap?.entities?.length ?? 0) > 0
  );
}

function clampPercent(value: number | null | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(Number(value))));
}

function stripTimelinePrefix(value: string | null | undefined, label: string): string {
  const cleaned = safeText(value, 2);
  if (!cleaned) return '';
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return cleaned.replace(new RegExp(`^\\s*(?:${escapedLabel})\\s*:?\\s*`, 'i'), '').trim();
}

function renderBarSvg(values: Array<{ label: string; value: number; color: string }>): string {
  const compactLabel = (label: string): string => {
    const normalized = safeText(label, 1);
    return normalized.length > 44 ? `${normalized.slice(0, 41).trim()}...` : normalized;
  };
  const max = Math.max(...values.map((item) => item.value), 1);
  return `
    <div class="chart-list" role="img" aria-label="bar chart">
      ${values.map((item) => {
        const scaled = Math.max(8, Math.round((item.value / max) * 100));
        return `
          <div class="chart-row">
            <div class="chart-label" title="${escapeHtml(item.label)}">${escapeHtml(compactLabel(item.label))}</div>
            <div class="chart-track"><div class="chart-fill" style="width:${scaled}%;background:${escapeHtml(item.color)};"></div></div>
            <div class="chart-value">${item.value}</div>
          </div>
        `;
      }).join('')}
    </div>
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

function renderMetricGrid(values: Array<{ label: string; value: number | null | undefined; color: string; note?: string }>): string {
  return `
    <div class="metric-grid-2">
      ${values.map((item) => {
        const score = Number(item.value ?? 0);
        return `
          <article class="metric-card no-break">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(displayScore(item.value, item.value == null ? 'MISSING' : 'AVAILABLE'))}</strong>
            <div class="bar"><span style="width:${item.value == null ? 0 : clampPercent(score)}%;background:${escapeHtml(item.color)};"></span></div>
            ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ''}
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function renderMetricRowCard(item: { label: string; value: number | null | undefined; color: string; note?: string }): string {
  const score = Number(item.value ?? 0);
  return `
    <article class="metric-card metric-row-card no-break">
      <div class="metric-row-card-label">
        <span>${escapeHtml(item.label)}</span>
        <strong>${escapeHtml(displayScore(item.value, item.value == null ? 'MISSING' : 'AVAILABLE'))}</strong>
      </div>
      <div class="metric-row-card-bar">
        <div class="bar"><span style="width:${item.value == null ? 0 : clampPercent(score)}%;background:${escapeHtml(item.color)};"></span></div>
      </div>
      <div class="metric-row-card-note">${item.note ? `<p>${escapeHtml(item.note)}</p>` : ''}</div>
    </article>
  `;
}

function renderExecutiveInsights(items: Array<{ title: string; impact: string; highImpact?: boolean }>): string {
  return `
    <div class="executive-insights">
      <h3>Key Insights (What You Should Know Immediately)</h3>
      <div class="grid-2">
        ${items.map((item) => `
          <article class="insight-card ${item.highImpact ? 'high-impact' : ''}">
            <div class="insight-title">${escapeHtml(item.title)}</div>
            <div class="insight-impact">Business Impact: ${escapeHtml(item.impact)}</div>
          </article>
        `).join('')}
      </div>
    </div>
  `;
}

function renderBeforeAfter(current: string[], future: string[]): string {
  return `
    <div class="before-after">
      <h3>Current vs Future State</h3>
      <table class="transformation-table">
        <tr>
          <td class="col current">
            <div class="card state-card current">
              <h3>Current</h3>
              <ul class="simple-list">${current.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
            </div>
          </td>
          <td class="arrow">&rarr;</td>
          <td class="col future">
            <div class="card state-card future">
              <h3>After Execution</h3>
              <ul class="simple-list">${future.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
            </div>
          </td>
        </tr>
      </table>
    </div>
  `;
}

function renderPriorityEngine(actions: ReturnType<typeof collectMasterActions>): string {
  const top = actions[0];
  const second = actions[1];
  return `
    <div class="priority-engine">
      <h3>What To Do First (Highest Impact)</h3>
      <div class="priority-card top-priority">
        <div class="priority-label">#1 Priority</div>
        <div class="priority-title">${escapeHtml(top?.title || 'Build comparison & decision pages')}</div>
        <div class="priority-meta">Impact: ${escapeHtml(top?.impact || 'HIGH')} | Effort: ${escapeHtml(top?.effort || 'MEDIUM')} | Time: ${escapeHtml(top?.timeline?.short ? '2-4 weeks' : '2-4 weeks')}</div>
      </div>
      ${second ? `
        <div class="priority-card">
          <div class="priority-label">#2 Priority</div>
          <div class="priority-title">${escapeHtml(second.title)}</div>
        </div>
      ` : ''}
    </div>
  `;
}

function renderScoreComparison(label: string, yourScore: number | null | undefined, marketLabel: string, marketScore: number): string {
  return `
    <div class="score-comparison">
      <h3>${escapeHtml(label)}</h3>
      <div class="bar-row">
        <span>Your Score</span>
        <div class="bar-track compare-track"><div class="bar-fill compare-user" style="width:${yourScore == null ? 0 : clampPercent(yourScore)}%"></div></div>
        <span>${escapeHtml(displayScore(yourScore, yourScore == null ? 'MISSING' : 'AVAILABLE'))}</span>
      </div>
      <div class="bar-row">
        <span>${escapeHtml(marketLabel)}</span>
        <div class="bar-track compare-track"><div class="bar-fill compare-market" style="width:${clampPercent(marketScore)}%"></div></div>
        <span>${marketScore}+</span>
      </div>
    </div>
  `;
}

function renderMiniMetrics(items: Array<{ label: string; value: string }>): string {
  return `
    <div class="mini-metrics">
      ${items.map((item) => `
        <div class="metric-card mini-metric-card">
          <span>${escapeHtml(item.label)}</span>
          <strong>${escapeHtml(item.value)}</strong>
        </div>
      `).join('')}
    </div>
  `;
}

function renderCalloutBox(text: string): string {
  return `<div class="callout-box"><strong>Why This Matters:</strong> ${escapeHtml(text)}</div>`;
}

function renderCompactBulletLine(items: string[]): string {
  return `<p>${items.map((item) => escapeHtml(item)).join(' · ')}</p>`;
}

function estimateBlockUnits(text: string, base = 8): number {
  return base + Math.min(18, Math.ceil((text || '').length / 80));
}

function renderInlineSummary(items: string[]): string {
  return `<p class="inline-summary">${items.map((item) => escapeHtml(item)).join(' &middot; ')}</p>`;
}

function ensureActionCoverage(actions: ReturnType<typeof collectMasterActions>): ReturnType<typeof collectMasterActions> {
  const defaults = [
    {
      title: 'Build comparison pages',
      reasoning: 'Capture decision-stage demand and compete directly with alternatives.',
      tactics: ['Create /vs/ pages', 'Add proof blocks', 'Handle pricing and switching objections'],
      priority: 'HIGH',
      impact: 'HIGH',
      effort: 'MEDIUM',
      timeline: { short: '2-4 weeks', mid: '1-3 months', long: '3-6 months' },
    },
    {
      title: 'Strengthen authority signals',
      reasoning: 'Improve trust, rankings, and competitive visibility.',
      tactics: ['Earn relevant backlinks', 'Publish proof-led assets', 'Reinforce trust indicators'],
      priority: 'HIGH',
      impact: 'HIGH',
      effort: 'MEDIUM',
      timeline: { short: '2-4 weeks', mid: '1-3 months', long: '3-6 months' },
    },
    {
      title: 'Expand content depth',
      reasoning: 'Cover buyer-stage topics more completely.',
      tactics: ['Build decision pages', 'Expand core service content', 'Add use-case coverage'],
      priority: 'MEDIUM',
      impact: 'MEDIUM',
      effort: 'MEDIUM',
      timeline: { short: '2-4 weeks', mid: '1-3 months', long: '3-6 months' },
    },
    {
      title: 'Add structured answers (FAQs)',
      reasoning: 'Improve AI retrieval and search visibility.',
      tactics: ['Add FAQ blocks', 'Strengthen summaries', 'Make answers retrieval-ready'],
      priority: 'MEDIUM',
      impact: 'MEDIUM',
      effort: 'LOW',
      timeline: { short: '1-2 weeks', mid: '1-2 months', long: '3-6 months' },
    },
    {
      title: 'Track keyword and performance data',
      reasoning: 'Enable data-driven prioritization and measurement.',
      tactics: ['Connect GSC', 'Track keywords', 'Review performance monthly'],
      priority: 'LOW',
      impact: 'MEDIUM',
      effort: 'LOW',
      timeline: { short: '1-2 weeks', mid: '1-2 months', long: '3-6 months' },
    },
  ];

  const seen = new Set<string>();
  const merged = [...actions, ...defaults].filter((action) => {
    const key = safeText(action.title, 1).trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return merged.slice(0, 5);
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

function displayScore(score: number | null | undefined, dataStrength: string): string {
  if (score === null || score === undefined) return '--';
  if (score === 0 && dataStrength === 'MISSING') return '--';
  return String(score);
}

function sectionHeaderBar(companyName: string, reportDate: string): string {
  return `
    <div class="section-header">
      <span class="company-name">${escapeHtml(companyName)}</span>
      <span class="report-title">Digital Authority Snapshot</span>
      <span class="report-date">${escapeHtml(reportDate)}</span>
    </div>
  `;
}

function renderFillQuote(title: string, quote: string, note?: string): string {
  return `<div class="fill-quote"><div class="label">${escapeHtml(title)}</div><blockquote>${escapeHtml(quote)}</blockquote>${note ? `<div class="pending-note">${escapeHtml(note)}</div>` : ''}</div>`;
}

function renderReportBlock(
  type: 'heading' | 'score-card' | 'insight' | 'chart' | 'action' | 'disclaimer',
  inner: string,
  options?: { className?: string; group?: string; fill?: boolean; keepTogether?: boolean },
): string {
  const shouldKeepTogether = Boolean(options?.keepTogether && ['heading', 'score-card', 'disclaimer'].includes(type));
  const className = ['report-block', options?.className, shouldKeepTogether ? 'keep-together' : ''].filter(Boolean).join(' ');
  const groupAttr = options?.group ? ` data-group="${escapeHtml(options.group)}"` : '';
  const fillAttr = options?.fill ? ' data-fill="true"' : '';
  return `<div class="${className}" data-type="${type}"${groupAttr}${fillAttr}>${inner}</div>`;
}

function renderNarrativeGroup(
  id: string,
  microHeader: string,
  title: string,
  blocks: string[],
  options?: { keepTogether?: boolean; hideHeading?: boolean },
): string {
  const heading = options?.hideHeading
    ? ''
    : renderReportBlock('heading', `<div class="label">${escapeHtml(microHeader)}</div><h2>${escapeHtml(title)}</h2>`, { className: 'report-block-heading', group: id, keepTogether: true });
  return `<section class="narrative-group ${options?.keepTogether ? 'keep-together' : ''}" id="${escapeHtml(id)}" data-group="${escapeHtml(id)}">${heading}${blocks.join('')}</section>`;
}

function stripLeadingSectionHeader(html: string): string {
  return html.replace(/^\s*<div class="report-section([^"]*)"([^>]*)>\s*<div class="section-header">[\s\S]*?<\/div>/, '<div class="report-section$1"$2>');
}

function renderPagePrintHeader(companyName: string, reportDate: string): string {
  return `<div class="page-print-header">${sectionHeaderBar(companyName, reportDate)}</div>`;
}

type DerivedDataSource = {
  source: 'gsc' | 'content_coverage' | 'backlinks' | 'ai_visibility' | 'competitor_intelligence' | 'analytics';
  name: string;
  status: 'missing' | 'partial' | 'connected';
  confidence: 'low' | 'medium' | 'high';
  currentState: string;
  impact: string;
  unlocks: string[];
  usedInSections: string[];
  priority: 'high' | 'medium' | 'low';
};

function getStateTone(score: number | null | undefined): 'green' | 'yellow' | 'red' | 'gray' {
  if (score == null || !Number.isFinite(score)) return 'gray';
  if (score >= 50) return 'green';
  if (score >= 30) return 'yellow';
  return 'red';
}

function getStateBarClass(score: number | null | undefined): string {
  const tone = getStateTone(score);
  if (tone === 'green') return 'bar-fill-green';
  if (tone === 'yellow') return 'bar-fill-amber';
  if (tone === 'red') return 'bar-fill-red';
  return '';
}

function getStateBadgeClass(score: number | null | undefined): string {
  const tone = getStateTone(score);
  if (tone === 'green') return 'badge-green';
  if (tone === 'yellow') return 'badge-amber';
  if (tone === 'red') return 'badge-red';
  return 'badge-gray';
}

function renderVisualMetricBlock(
  label: string,
  score: number | null | undefined,
  note: string,
  benchmark?: number | null,
): string {
  const gap = score != null && benchmark != null ? Math.round(score - benchmark) : null;
  return `<article class="card visual-metric no-break"><div class="label">${escapeHtml(label)}</div><div class="metric-row"><div class="${score == null ? 'score-missing' : 'score-med'}">${escapeHtml(displayScore(score, score == null ? 'MISSING' : 'AVAILABLE'))}</div><span class="badge ${getStateBadgeClass(score)}">${score == null ? 'Missing' : getStateTone(score) === 'green' ? 'Strong' : getStateTone(score) === 'yellow' ? 'Developing' : 'Constraint'}</span></div><div class="bar-track"><div class="bar-fill ${getStateBarClass(score)}" style="width:${score == null ? 0 : clampPercent(score)}%"></div></div>${benchmark != null ? `<div class="metric-meta"><span>Benchmark ${escapeHtml(displayScore(benchmark, 'AVAILABLE'))}</span><span>${gap == null ? '--' : gap >= 0 ? `+${gap} gap` : `${gap} gap`}</span></div>` : ''}<p style="margin-top:8px;">${escapeHtml(note)}</p></article>`;
}

function formatSignedGap(score: number | null | undefined, benchmark: number): string {
  if (!Number.isFinite(score)) return 'Missing';
  const gap = Math.round(Number(score) - benchmark);
  return gap > 0 ? `+${gap}` : `${gap}`;
}

function deriveDataSources(payload: PdfReportPayload): DerivedDataSource[] {
  const gscConnected = payload.seoVisuals?.seoCapabilityRadar.keyword_research_score != null && payload.seoVisuals?.seoCapabilityRadar.rank_tracking_score != null;
  const gscPartial = payload.seoVisuals?.seoCapabilityRadar.keyword_research_score != null || payload.seoVisuals?.seoCapabilityRadar.rank_tracking_score != null;
  const contentSignals = payload.seoVisuals?.seoCapabilityRadar.content_quality_score != null || Boolean(payload.seoVisuals?.opportunityCoverageMatrix.opportunities?.length);
  const backlinkStrength = toUpperStrength(payload.seoVisuals?.seoCapabilityRadar.data_source_strength?.backlinks_score);
  const aiConnected = hasRealAiVisibilityData(payload);
  const competitorRadar = payload.competitorVisuals?.competitorPositioningRadar;
  const competitorConnected = Boolean(competitorRadar?.competitors?.length && payload.competitorVisuals?.keywordGapAnalysis);
  const competitorPartial = Boolean(competitorRadar?.competitors?.length || payload.competitorIntelligenceSummary);

  return [
    {
      source: 'gsc',
      name: 'SEO / Keyword Data (GSC)',
      status: gscConnected ? 'connected' : gscPartial ? 'partial' : 'missing',
      confidence: gscConnected ? 'high' : gscPartial ? 'medium' : 'low',
      currentState: gscConnected ? 'Keyword and ranking systems are connected.' : gscPartial ? 'Some search-system signals are available, but coverage is incomplete.' : 'Based on crawl-level inference.',
      impact: gscConnected ? 'Keyword and ranking data are available.' : 'Cannot fully measure keyword demand, rankings, or intent coverage.',
      unlocks: ['Keyword opportunities', 'Ranking data', 'Search intent mapping'],
      usedInSections: ['SEO', 'Search Funnel', 'Opportunity Matrix'],
      priority: 'high',
    },
    {
      source: 'content_coverage',
      name: 'Content Coverage',
      status: contentSignals ? 'partial' : 'missing',
      confidence: contentSignals ? 'medium' : 'low',
      currentState: contentSignals ? 'Based on available pages only.' : 'Very limited page-level signal is available.',
      impact: 'Coverage gaps are directional, not exhaustive.',
      unlocks: ['Full topic coverage', 'Buyer-stage mapping', 'Content depth scoring'],
      usedInSections: ['Reality Layer', 'Strategic Position', 'SEO'],
      priority: 'high',
    },
    {
      source: 'backlinks',
      name: 'Backlink & Authority',
      status: backlinkStrength === 'STRONG' ? 'connected' : backlinkStrength === 'INFERRED' || backlinkStrength === 'WEAK' ? 'partial' : 'missing',
      confidence: backlinkStrength === 'STRONG' ? 'high' : backlinkStrength === 'INFERRED' || backlinkStrength === 'WEAK' ? 'medium' : 'low',
      currentState: backlinkStrength === 'STRONG' ? 'Connected backlink signals are available.' : backlinkStrength === 'MISSING' ? 'No backlink source connected.' : 'Heuristic signals only.',
      impact: 'Authority score may not reflect true strength.',
      unlocks: ['Referring domains', 'Link quality', 'Authority benchmarking'],
      usedInSections: ['Backlink & Authority', 'Why This Matters'],
      priority: 'medium',
    },
    {
      source: 'ai_visibility',
      name: 'AI Visibility (Answer Engines)',
      status: aiConnected ? 'connected' : 'missing',
      confidence: aiConnected ? 'high' : 'low',
      currentState: aiConnected ? 'AI visibility signals are available.' : 'Structure-based inference.',
      impact: 'Cannot measure actual AI answer presence.',
      unlocks: ['AI answer visibility', 'Query-level presence', 'Citation strength'],
      usedInSections: ['AI Visibility'],
      priority: 'medium',
    },
    {
      source: 'competitor_intelligence',
      name: 'Competitor Intelligence',
      status: competitorConnected ? 'connected' : competitorPartial ? 'partial' : 'missing',
      confidence: competitorConnected ? 'high' : competitorPartial ? 'medium' : 'low',
      currentState: competitorConnected ? 'Competitor coverage is connected.' : competitorPartial ? 'Based on detected competitors only.' : 'No meaningful competitor benchmark available.',
      impact: 'Market comparison may be incomplete.',
      unlocks: ['Full competitor landscape', 'Share of visibility', 'Positioning accuracy'],
      usedInSections: ['Competitor Intelligence', 'Opportunity Matrix'],
      priority: 'medium',
    },
    {
      source: 'analytics',
      name: 'Conversion / Analytics',
      status: 'missing',
      confidence: 'low',
      currentState: 'No behavioral data.',
      impact: 'Cannot measure business impact.',
      unlocks: ['Funnel performance', 'Conversion rates', 'ROI attribution'],
      usedInSections: ['Search Funnel', 'Growth Trajectory'],
      priority: 'high',
    },
  ];
}

function renderInlineDisclaimer(kind: 'missing' | 'partial', text: string, confidenceReason?: string): string {
  const title = kind === 'missing' ? 'Early-stage signal detected' : 'Directional signal detected';
  const confidence = confidenceReason ? `<span class="badge ${kind === 'missing' ? 'badge-red' : 'badge-amber'}">Signal confidence: ${kind === 'missing' ? 'Low' : 'Medium'} (${escapeHtml(confidenceReason)})</span>` : '';
  return `<div class="inline-disclaimer ${kind === 'missing' ? 'inline-disclaimer-missing' : 'inline-disclaimer-partial'}">${confidence}<p><strong>${title}.</strong> ${escapeHtml(text)}</p></div>`;
}

function toUpperStrength(value: string | null | undefined): 'STRONG' | 'INFERRED' | 'WEAK' | 'MISSING' {
  const normalized = safeText(value, 1).toUpperCase();
  if (normalized === 'STRONG' || normalized === 'INFERRED' || normalized === 'WEAK') return normalized;
  return 'MISSING';
}

function scoreMetricCard(label: string, score: number | null | undefined, dataStrength: string, note: string): string {
  const shown = displayScore(score, dataStrength);
  const width = shown === '--' ? 0 : clampPercent(score);
  return `
    <article class="metric-card no-break">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(shown)}</strong>
      <div class="bar"><span style="width:${width}%"></span></div>
      <p>${escapeHtml(note)}</p>
    </article>
  `;
}

function collectMasterActions(payload: PdfReportPayload): Array<{
  title: string;
  reasoning: string;
  focusPage: string;
  tactics: string[];
  timeline: { short: string; mid: string; long: string };
  priority: string;
  impact: string;
  effort: string;
}> {
  const dedupeMasterActions = <T extends { title: string }>(items: T[]): T[] => {
    const seen = new Set<string>();
    return items.filter((action) => {
      const key = action.title?.trim().toLowerCase().slice(0, 60);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const fromSeo = (payload.seoExecutiveSummary?.top3Actions ?? []).map((action) => ({
    title: safeText(action.actionTitle || action.title, 1),
    reasoning: safeText(action.reasoning, 2),
    focusPage: safeText(action.focusPage, 1),
    tactics: Array.isArray(action.tactics) ? action.tactics.map((item) => safeText(item, 1)).filter(Boolean).slice(0, 3) : [],
    timeline: {
      short: safeText(action.timeline?.short, 1),
      mid: safeText(action.timeline?.mid, 1),
      long: safeText(action.timeline?.long, 1),
    },
    priority: safeText(action.priority, 1).toUpperCase(),
    impact: safeText(action.impact || action.expectedImpact, 1).toUpperCase(),
    effort: safeText(action.effort, 1).toUpperCase(),
  }));
  const fromGeo = (payload.geoAeoExecutiveSummary?.top3Actions ?? []).map((action) => ({
    title: safeText(action.actionTitle, 1),
    reasoning: safeText(action.reasoning, 2),
    focusPage: '',
    tactics: [],
    timeline: {
      short: '',
      mid: '',
      long: '',
    },
    priority: safeText(action.priority, 1).toUpperCase(),
    impact: safeText(action.expectedImpact, 1).toUpperCase(),
    effort: safeText(action.effort, 1).toUpperCase(),
  }));
  const fromNextSteps = payload.nextSteps.map((step) => ({
    title: safeText(step.action, 1),
    reasoning: safeText(step.reasoning || step.description, 2),
    focusPage: safeText(step.focusPage, 1),
    tactics: Array.isArray(step.tactics) ? step.tactics.map((item) => safeText(item, 1)).filter(Boolean).slice(0, 3) : [],
    timeline: {
      short: safeText(step.timeline?.short, 1),
      mid: safeText(step.timeline?.mid, 1),
      long: safeText(step.timeline?.long, 1),
    },
    priority: safeText(step.priority, 1).toUpperCase(),
    impact: safeText(step.impact, 1).toUpperCase(),
    effort: safeText(step.effort, 1).toUpperCase(),
  }));
  return dedupeMasterActions([...fromNextSteps, ...fromSeo, ...fromGeo]).slice(0, 5);
}

function renderMasterActionCard(action: ReturnType<typeof collectMasterActions>[number], index: number): string {
  const problem = action.reasoning || 'Discoverability is being left to chance.';
  const impact = action.impact === 'HIGH'
    ? 'Buyers cannot discover and compare effectively.'
    : action.impact === 'MEDIUM'
      ? 'Visibility and trust gains will stay slower than they should.'
      : 'Progress will stay difficult to measure consistently.';
  const solution = action.title || 'Build structured comparison pages.';
  return `
    <article class="action-card report-block no-break" data-type="action" data-group="actions">
      <div class="action-header">
        <div class="action-number">${index + 1}</div>
        <div class="action-title">${escapeHtml(action.title)}</div>
      </div>
      <div class="action-tags">
        ${action.impact ? `<span class="tag impact">${escapeHtml(`${action.impact} IMPACT`)}</span>` : ''}
        ${action.effort ? `<span class="tag effort">${escapeHtml(`${action.effort} EFFORT`)}</span>` : ''}
      </div>
      <div class="action-body">
        <p class="problem"><strong>Problem:</strong> ${escapeHtml(problem)}</p>
        <p class="impact"><strong>Impact:</strong> ${escapeHtml(impact)}</p>
        <p class="solution"><strong>Action:</strong> ${escapeHtml(solution)}</p>
      </div>
      <div>
        ${action.focusPage ? `<div class="label" style="margin-top:8px;">Start here:</div><div>${escapeHtml(action.focusPage)}</div>` : ''}
        ${action.tactics.length ? `<div class="label" style="margin-top:8px;">Tactics</div><ol class="tactics">${action.tactics.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ol>` : ''}
        ${(action.timeline.short || action.timeline.mid || action.timeline.long) ? `<div class="timeline">
          ${action.timeline.short ? `<div class="timeline-item"><strong>2-4 weeks</strong>${escapeHtml(action.timeline.short)}</div>` : ''}
          ${action.timeline.mid ? `<div class="timeline-item"><strong>1-3 months</strong>${escapeHtml(action.timeline.mid)}</div>` : ''}
          ${action.timeline.long ? `<div class="timeline-item"><strong>3-6 months</strong>${escapeHtml(action.timeline.long)}</div>` : ''}
        </div>` : ''}
      </div>
    </article>
  `;
}

function inferMasterActionTrack(action: ReturnType<typeof collectMasterActions>[number]): 'authority' | 'positioning' | 'comparison' | 'generic' {
  const signature = `${action.title} ${action.reasoning} ${action.tactics.join(' ')}`.toLowerCase();
  if (/(backlink|authority|citation|directory|publication|partner list|outreach|proof-led asset|links from)/.test(signature)) return 'authority';
  if (/(positioning proof|credibility|expert framing|proof architecture|trust signals|category claim)/.test(signature)) return 'positioning';
  if (/(comparison|competitor|\/vs\/|decision-stage|objection-handling|buying-stage)/.test(signature)) return 'comparison';
  return 'generic';
}

function renderSection1Cover(payload: PdfReportPayload, vars: Record<string, string>, options?: { showStatsRow?: boolean }): string {
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
  return `<div class="report-section" id="section-1">${sectionHeaderBar(vars.company_name, vars.report_date)}<div class="cover-grid cover-grid-top"><div class="card no-break cover-score"><div class="label">Overall</div><div class="score-big">${escapeHtml(displayScore(getOverallScore(payload), 'AVAILABLE'))}</div></div><div class="cover-identity"><h1>${escapeHtml(vars.company_name)}</h1><div class="cover-url">${escapeHtml(vars.website_url)}</div><div class="tags cover-tags"><span class="badge badge-amber">${escapeHtml(vars.stage_label || '--')}</span><span class="badge badge-green">${escapeHtml(vars.confidence_label || '--')}</span><span class="badge badge-blue">${escapeHtml(movement || '--')}</span></div>${summaryCard}</div></div>${showStatsRow ? `<hr class="divider" /><div class="stats-4"><div><div class="label">Overall Score</div><div class="score-med">${escapeHtml(displayScore(getOverallScore(payload), 'AVAILABLE'))}</div></div><div><div class="label">Stage</div><div class="score-med">${escapeHtml(vars.stage_label || '--')}</div></div><div><div class="label">Confidence</div><div class="score-med">${escapeHtml(vars.confidence_label || '--')}</div></div><div><div class="label">Movement</div><div class="score-med">${escapeHtml(movement || '--')}</div></div></div>` : ''}</div>`;
}

function renderSection2StrategicPosition(payload: PdfReportPayload, vars: Record<string, string>, options?: { showHeaderBar?: boolean }): string {
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

function renderSectionBrandIntro(payload: PdfReportPayload, vars: Record<string, string>): string {
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

function renderRealityLayer(payload: PdfReportPayload): string {
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

function renderWhyThisMattersBlock(payload: PdfReportPayload): string {
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

function renderSearchFunnelBlock(payload: PdfReportPayload): string {
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

function renderDiagnosticBreakdownBlock(payload: PdfReportPayload): string {
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

function renderOpportunityMatrixBlock(payload: PdfReportPayload): string {
  const matrix = payload.seoVisuals?.opportunityCoverageMatrix.opportunities ?? [];
  const gap = payload.competitorVisuals?.keywordGapAnalysis;
  return `<div class="report-section section-continue" id="opportunity-matrix"><div class="label">Opportunity Matrix</div><h2>Opportunity Matrix</h2><div class="grid-3"><article class="card card-accent-green no-break"><h3>Growth Exists</h3>${matrix.length ? matrix.slice(0, 4).map((item) => `<p>${escapeHtml(item.keyword)} (${escapeHtml(displayScore(item.opportunity_score, 'AVAILABLE'))})</p>`).join('') : '<div class="pending-note">Opportunity scoring is still limited.</div>'}</article><article class="card card-accent-amber no-break"><h3>Missing Coverage</h3>${gap?.missing_keywords?.length ? gap.missing_keywords.slice(0, 5).map((item) => `<p>${escapeHtml(item)}</p>`).join('') : '<div class="pending-note">No explicit missing-keyword set available yet.</div>'}</article><article class="card no-break"><h3>Where To Push First</h3><p>${escapeHtml(matrix[0]?.keyword ? `Prioritize ${matrix[0].keyword} first because demand exists while coverage remains incomplete.` : 'Prioritize the highest-opportunity keyword clusters once stronger search data is connected.')}</p></article></div></div>`;
}

function renderGrowthTrajectoryBlock(payload: PdfReportPayload, actions: ReturnType<typeof collectMasterActions>): string {
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

function getStrategicStrengthCards(payload: PdfReportPayload): Array<{ label: string; value: string; score: number | null }> {
  return [
    { label: 'Position', value: safeText(payload.companyContext?.marketPosition || payload.companyContext?.marketPositionStatement, 1), score: /ahead|strong/i.test(payload.companyContext?.marketPosition || payload.companyContext?.marketPositionStatement || '') ? 78 : /parity|moderate/i.test(payload.companyContext?.marketPosition || payload.companyContext?.marketPositionStatement || '') ? 54 : /below|weak/i.test(payload.companyContext?.marketPosition || payload.companyContext?.marketPositionStatement || '') ? 28 : null },
    { label: 'Growth', value: safeText(payload.unifiedIntelligenceSummary?.growthDirection.shortTermFocus, 1), score: hasContent(payload.unifiedIntelligenceSummary?.growthDirection.shortTermFocus) ? 68 : null },
    { label: 'Risk', value: safeText(payload.companyContext?.executionRisk, 1), score: hasContent(payload.companyContext?.executionRisk) ? 36 : null },
    { label: 'Positioning', value: safeText(payload.companyContext?.positioningStrength || payload.companyContext?.positioningGap, 1), score: /strong/i.test(payload.companyContext?.positioningStrength || '') ? 76 : /moderate/i.test(payload.companyContext?.positioningStrength || '') ? 52 : /weak/i.test(payload.companyContext?.positioningStrength || '') ? 30 : hasContent(payload.companyContext?.positioningGap) ? 34 : null },
  ];
}

function renderSectionOverview(
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

function renderSection3PerformanceScores(payload: PdfReportPayload, vars: Record<string, string>): string {
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

function renderSection4CompetitorIntelligence(payload: PdfReportPayload, vars: Record<string, string>, competitorEligible: boolean, keywordGapEligible: boolean): string {
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

function renderSection5SeoDeepdive(payload: PdfReportPayload, vars: Record<string, string>): string {
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

function renderSection6AiVisibility(payload: PdfReportPayload, vars: Record<string, string>, aiEligible: boolean): string {
  const geo = payload.geoAeoExecutiveSummary;
  const visuals = payload.geoAeoVisuals;
  const actions = (geo?.top3Actions ?? []).slice(0, 3);
  const aiDisclaimer = !aiEligible
    ? renderInlineDisclaimer('missing', 'AI answer visibility is based on structural signals only.', 'Limited AI visibility')
    : '';
  return `<div class="report-section" id="section-6">${sectionHeaderBar(vars.company_name, vars.report_date)}<div class="label">AI Visibility</div><h2>AI Visibility</h2>${aiDisclaimer}${aiEligible && visuals ? `<div class="grid-2"><article class="card card-accent-blue no-break"><h3>AI Answer Radar</h3>${renderRadarSvg([{ label: 'Coverage', value: visuals.aiAnswerPresenceRadar.answer_coverage_score ?? 0 },{ label: 'Entities', value: visuals.aiAnswerPresenceRadar.entity_clarity_score ?? 0 },{ label: 'Authority', value: visuals.aiAnswerPresenceRadar.topical_authority_score ?? 0 },{ label: 'Citations', value: visuals.aiAnswerPresenceRadar.citation_readiness_score ?? 0 },{ label: 'Structure', value: visuals.aiAnswerPresenceRadar.content_structure_score ?? 0 },{ label: 'Freshness', value: visuals.aiAnswerPresenceRadar.freshness_score ?? 0 }])}</article><article class="card no-break"><h3>AI Visibility Readout</h3>${geo?.primaryGap.reasoning ? `<p>${escapeHtml(geo.primaryGap.reasoning)}</p>` : '<div class="pending-note">No AI visibility narrative available.</div>'}</article></div>` : '<div class="card-pending no-break">AI visibility cannot be measured yet - add structured content and FAQ sections to your key pages.</div>'}<div class="grid-3" style="margin-top:12px;">${actions.map((action, index) => `<article class="card card-accent-green no-break"><h3>${escapeHtml(action.actionTitle || `GEO/AEO action ${index + 1}`)}</h3><p>${escapeHtml(action.reasoning)}</p><div class="tags"><span class="badge badge-gray">${escapeHtml(action.priority.toUpperCase())}</span><span class="badge badge-gray">${escapeHtml(action.expectedImpact.toUpperCase())}</span><span class="badge badge-gray">${escapeHtml(action.effort.toUpperCase())}</span></div></article>`).join('')}</div></div>`;
}

function renderSection7BacklinkAuthority(payload: PdfReportPayload, vars: Record<string, string>, actions: ReturnType<typeof collectMasterActions>): string {
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

function renderSection8ActionPlan(payload: PdfReportPayload, vars: Record<string, string>, actions: ReturnType<typeof collectMasterActions>): string {
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

type SnapshotSectionStatus = 'complete' | 'partial' | 'missing';

type SnapshotSectionSpec = {
  id: string;
  title: string;
  status: SnapshotSectionStatus;
  html: string;
};

function renderDataCoveragePage(
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

function renderHookFlow(payload: PdfReportPayload, vars: Record<string, string>): string {
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
  const primaryAction = actions.find((action) => /comparison|decision|\/vs\/|alternative|competitor/i.test(`${action.title} ${action.reasoning} ${action.tactics.join(' ')}`))
    || actions.find((action) => /authority|backlink|proof/i.test(`${action.title} ${action.reasoning} ${action.tactics.join(' ')}`))
    || actions[0];
  const hookTitle = 'You Are Currently Losing High-Intent Demand';
  const hookStatement = `Based on the current gap signals, you are likely missing about ${missedDemandPct}% of high-intent search opportunities in your category.`;
  const businessList = [
    'Potential customers are finding competitors instead of you.',
    'Your visibility is not translating into qualified demand.',
    'Growth is being left to chance, not engineered.',
  ];
  let page1Insights = [
    { title: 'You are losing high-intent traffic to competitors', impact: 'This directly reduces qualified leads and conversion opportunities.', highImpact: true },
    { title: 'Authority gap is limiting your visibility', impact: 'Even strong content will not rank competitively.' },
    { title: 'You are missing decision-stage content', impact: 'You are not present when buyers are ready to choose.' },
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
  pageUnits += 10; // read this first
  pageUnits += 10; // score story
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
    : `<div class="executive-insights"><h3>Executive Insights</h3><ul class="simple-list"><li>Authority gap is the primary growth constraint.</li><li>Decision-stage content is missing.</li><li>Growth efforts are not translating into outcomes.</li></ul></div>`;
  const scoreStory = 'Your score is early-stage because weak authority and missing decision-stage content are reducing performance more than stronger areas can compensate for.';
  const growthReason = 'Your current performance is limited by structural gaps, not effort.';
  const scoreMeaning = [
    'This score reflects how ready your current digital presence is to compete for discovery, trust, and conversion.',
    'A lower score usually means competitors are easier to find, easier to trust, and easier to choose.',
    `A ${safeText(movement || 'stable', 1).toLowerCase()} movement means the current signal pattern is not yet shifting fast enough to change market position.`,
  ];
  const reportPurpose = [
    'Read below to see why growth is being suppressed, where the problems sit, and what to fix first to move forward with more confidence.',
  ];
  return renderNarrativeGroup('section-1', 'Where You Stand', 'Snapshot Hook', [
    renderReportBlock('score-card', `<div class="page-hero-cover"><div class="page-hero-header"><div class="label">Digital Authority Snapshot, <span class="page-hero-date">${escapeHtml(vars.report_date)}</span></div></div><div class="grid-2 page-hero-grid"><div class="stack-12"><article class="card no-break cover-score-panel"><div class="label">Snapshot Score</div><div class="cover-score-circle"><div class="score-big cover-score-big">${escapeHtml(displayScore(overallScore, 'AVAILABLE'))}</div></div><div class="cover-url cover-url-strong">${escapeHtml(vars.company_name)} | ${escapeHtml(vars.website_url)}</div><div class="tags cover-tags cover-tags-strong"><span class="badge badge-amber">${escapeHtml(vars.stage_label || '--')}</span><span class="badge badge-green">${escapeHtml(vars.confidence_label || '--')}</span><span class="badge badge-blue">${escapeHtml(movement || '--')}</span></div></article><article class="card no-break"><h3>Why Your Score Is ${escapeHtml(displayScore(overallScore, 'AVAILABLE'))}</h3><p>${escapeHtml(scoreStory)}</p></article><article class="card no-break"><h3>Why You Are Not Growing</h3><p>${escapeHtml(growthReason)}</p></article><article class="card card-accent-amber no-break cover-action-panel"><h3>Core Constraint</h3><p><strong>${escapeHtml(topConstraint?.label || 'Authority Gap')}: ${escapeHtml(displayScore(topConstraint?.score ?? null, topConstraint ? 'AVAILABLE' : 'MISSING'))} vs ${benchmark}+</strong></p><p>This gap is large enough to suppress competitive visibility even if you publish more content.</p><hr class="divider" /><h3>The One Move That Changes Everything</h3><p><strong>${escapeHtml(primaryAction?.title || 'Build comparison and decision-stage pages')}</strong></p>${primaryAction?.timeline ? `<div class="timeline"><div class="timeline-item"><strong>2-4 weeks:</strong> ${escapeHtml(stripTimelinePrefix(primaryAction.timeline.short, '2-4 weeks') || 'Directional movement should appear on the target pages first.')}</div><div class="timeline-item"><strong>1-3 months:</strong> ${escapeHtml(stripTimelinePrefix(primaryAction.timeline.mid, '1-3 months') || 'Stronger click quality and page-level engagement should become visible.')}</div><div class="timeline-item"><strong>3-6 months:</strong> ${escapeHtml(stripTimelinePrefix(primaryAction.timeline.long, '3-6 months') || 'The change should compound into better qualified discovery and conversion readiness.')}</div></div>` : `<div class="timeline"><div class="timeline-item"><strong>2-4 weeks:</strong> Directional movement should appear on the target pages first.</div><div class="timeline-item"><strong>1-3 months:</strong> Stronger click quality and page-level engagement should become visible.</div><div class="timeline-item"><strong>3-6 months:</strong> The change should compound into better qualified discovery and conversion readiness.</div></div>`}</article></div><div class="stack-12"><article class="card card-accent-red no-break cover-context-panel"><h1>${escapeHtml(hookTitle)}</h1><p>${escapeHtml(hookStatement)}</p><div class="cover-explainer"><div class="cover-explainer-block meaning-block"><div class="label">What ${escapeHtml(displayScore(overallScore, 'AVAILABLE'))}, ${escapeHtml(vars.stage_label || '--')}, ${escapeHtml(vars.confidence_label || '--')}, And ${escapeHtml(movement || '--')} Mean</div>${scoreMeaning.map((item) => `<p>${escapeHtml(item)}</p>`).join('')}</div><div class="cover-explainer-block competition-block"><div class="label">What It Means Competitively</div><p>${escapeHtml(whatThisMeansItems.join(' '))}</p></div><div class="cover-explainer-block why-read-block">${reportPurpose.map((item) => `<p>${escapeHtml(item)}</p>`).join('')}</div></div></article><article class="card no-break">${executiveInsights}</article></div></div></div>`, { className: 'report-block-hero', group: 'section-1' }),
    ...(showReadThisFirst ? [renderReportBlock('insight', '<div class="card no-break intro-block"><strong>Read This First</strong><p>This report answers one question:</p><p><strong>What is the fastest way to turn your current presence into growth?</strong></p></div>', { group: 'section-1', fill: true })] : []),
  ], { hideHeading: true });
}

function renderRealityFlow(payload: PdfReportPayload): string {
  const benchmark = 50;
  const seoScore = payload.seoExecutiveSummary?.overallHealthScore ?? null;
  const authorityScore = payload.seoVisuals?.seoCapabilityRadar.backlinks_score ?? null;
  const contentScore = payload.seoVisuals?.seoCapabilityRadar.content_quality_score ?? null;
  const aiScore = hasRealAiVisibilityData(payload) ? (payload.geoAeoExecutiveSummary?.overallAiVisibilityScore ?? null) : null;
  const metrics = [
    { label: 'SEO', score: seoScore, gap: formatSignedGap(seoScore, benchmark), highlight: false },
    { label: 'Authority', score: authorityScore, gap: formatSignedGap(authorityScore, benchmark), highlight: true },
    { label: 'Content', score: contentScore, gap: formatSignedGap(contentScore, benchmark), highlight: false },
    { label: 'AI Visibility', score: aiScore, gap: null, highlight: false },
  ];
  const causes = [
    {
      title: 'Authority Gap',
      lines: [
        'Your authority signals are too weak to compete.',
        'Even strong content struggles to rank.',
      ],
    },
    {
      title: 'Missing Decision Content',
      lines: [
        'You lack comparison and proof-led pages.',
        'You are absent when buyers choose.',
      ],
    },
    {
      title: 'No Demand Clarity',
      lines: [
        'Keyword data is not connected.',
        'Growth decisions are not data-driven.',
      ],
    },
  ];
  const executiveInsights = [
    'Authority gap is the primary growth constraint.',
    'Decision-stage content is missing.',
    'Growth effort is not translating into outcomes.',
  ];
  return renderNarrativeGroup('section-2', "What's Holding You Back", 'Reality Layer', [
    renderReportBlock('insight', `
      <div class="report-page reality-page">
        <div class="report-block page-header no-break">
          <h2>Reality Breakdown</h2>
          <p>The metrics below show which structural constraints are limiting growth right now.</p>
        </div>
        <div class="report-block report-block-subheading no-break">
          <div class="label">Performance Scores</div>
          <h3>Performance Scores</h3>
        </div>
        <div class="report-block grid-4 reality-metric-grid">
          ${metrics.map((item) => `
            <article class="metric-card no-break${item.highlight ? ' highlight' : ''}">
              <h3>${escapeHtml(item.label)}</h3>
              <div class="${item.score == null ? 'score-missing' : 'score-med'}">${escapeHtml(displayScore(item.score, item.score == null ? 'MISSING' : 'AVAILABLE'))}</div>
              <div class="gap">${escapeHtml(item.gap ? `${item.gap} vs benchmark` : 'Missing benchmark data')}</div>
            </article>
          `).join('')}
        </div>
        <div class="report-block callout primary no-break">
          <strong>You do not have a traffic problem.</strong>
          <p>You have a conversion-stage visibility problem.</p>
        </div>
        <div class="report-block grid-3 root-cause-grid">
          ${causes.map((item) => `
            <article class="card no-break">
              <h3>${escapeHtml(item.title)}</h3>
              ${item.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}
            </article>
          `).join('')}
        </div>
        <div class="report-block flow no-break">
          <h3>What This Creates</h3>
          <div class="flow-row">
            <span>Low Authority</span>
            <span>&rarr;</span>
            <span>Weak Rankings</span>
            <span>&rarr;</span>
            <span>Low Visibility</span>
            <span>&rarr;</span>
            <span>Poor Conversions</span>
          </div>
        </div>
        <div class="report-block callout secondary no-break">
          <strong>Bottom Line:</strong>
          <p>Your current system generates activity, but not growth.</p>
        </div>
        <div class="report-block implication no-break">
          <h3>What This Means For Growth</h3>
          <ul class="simple-list">
            <li>More content alone will not improve performance.</li>
            <li>Traffic gains will remain inconsistent.</li>
            <li>Conversion opportunities will continue to be missed.</li>
          </ul>
        </div>
        <div class="report-block executive-insights no-break">
          <h3>Executive Insights</h3>
          <ul class="simple-list">
            ${executiveInsights.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
        </div>
      </div>
    `, { group: 'section-2', keepTogether: true }),
  ]);
  /* legacy reality flow removed
  return renderNarrativeGroup('section-2', "What's Holding You Back", 'Reality Layer', [
    renderReportBlock('insight', '<div class="card no-break"><h3>What’s Actually Holding You Back</h3><p>Your current performance is not limited by effort. It is limited by missing growth infrastructure.</p></div>', { group: 'section-2', keepTogether: true }),
    renderReportBlock('heading', '<div class="label">Performance Scores</div><h3>Performance Scores</h3>', { className: 'report-block-subheading', group: 'section-2', keepTogether: true }),
    ...decomposition.map((item) => renderReportBlock('score-card', renderMetricRowCard({ label: item.label, value: item.score, color: item.color, note: `Benchmark ${benchmark} | Gap ${formatSignedGap(item.score, benchmark)}` }), { className: 'report-block-compact', group: 'section-2', fill: true })),
    renderReportBlock('insight', '<div class="card card-accent-red no-break"><h3>The Real Problem</h3><p><strong>You do not have a traffic problem. You have a conversion-stage visibility problem.</strong></p><ul class="simple-list"><li>Your current setup covers basic presence.</li><li>It misses decision-stage content where competitors win.</li><li>Effort is not translating into growth because the infrastructure is incomplete.</li></ul></div>', { group: 'section-2', keepTogether: true }),
    ...constraints.map((item) => renderReportBlock('insight', `<div class="card no-break"><h3>${escapeHtml(item.label)}</h3><p>${escapeHtml(item.detail)}</p></div>`, { className: 'report-block-compact', group: 'section-2', fill: true })),
    renderReportBlock('insight', `<div class="grid-2"><article class="card no-break"><h3>What This Creates</h3><ul class="simple-list"><li>Low authority -> weak rankings</li><li>Weak rankings -> low visibility</li><li>Low visibility -> poor traffic quality</li><li>Poor traffic -> low conversions</li></ul></article><article class="card no-break"><h3>Why This Matters</h3><p>${escapeHtml(position || contentGap || 'Position clarity is still being inferred from the available signals, but the chain reaction is already visible: weak infrastructure is suppressing qualified growth.')}</p></article></div>`, { group: 'section-2', fill: true }),
    renderReportBlock('insight', renderCalloutBox('Weak authority and missing decision-stage content directly reduce your ability to convert traffic into customers.'), { group: 'section-2', fill: true }),
  ]);
  */
}

function renderInsightsFlow(): string {
  return renderNarrativeGroup('insights-page', 'Key Insights', 'Executive Insights', [
    renderReportBlock('insight', `<div class="report-page insights-page"><div class="page-header no-break"><h2>Key Insights</h2><p>What you should know immediately before choosing where to act.</p></div><div class="stack-12"><div class="insight-card high-impact"><div class="insight-title">Competitors capture more buying-stage content</div><div class="insight-impact">That means high-intent demand is being converted elsewhere first.</div></div><div class="insight-card"><div class="insight-title">Your discoverability is limited</div><div class="insight-impact">You are present in awareness, but missing where buyers compare and choose.</div></div><div class="insight-card"><div class="insight-title">Authority gap weakens conversion potential</div><div class="insight-impact">Even good content struggles to rank and build commercial trust without stronger authority signals.</div></div></div></div>`, { group: 'insights-page', keepTogether: true }),
  ]);
}

function renderCompetitorFlow(payload: PdfReportPayload): string {
  const userAuthority = payload.seoVisuals?.seoCapabilityRadar.backlinks_score ?? null;
  const userContent = payload.seoVisuals?.seoCapabilityRadar.content_quality_score ?? null;
  const competitorRadar = payload.competitorVisuals?.competitorPositioningRadar;
  const hasCompetitorData = Boolean(competitorRadar?.competitors?.some((item) => Number(item.content_score ?? 0) > 0 || Number(item.authority_score ?? 0) > 0));
  return renderNarrativeGroup('competitor-page', 'Competitive Reality', 'Competitive Reality', [
    renderReportBlock('insight', `<div class="report-page competitor-page"><div class="page-header no-break"><h2>Competitive Reality</h2><p>Why competitors currently win more decision-stage demand.</p></div>${hasCompetitorData ? `<div class="grid-2"><article class="card no-break"><h3>You</h3><p>Authority: ${escapeHtml(displayScore(userAuthority, userAuthority == null ? 'MISSING' : 'AVAILABLE'))}</p><p>Content Depth: ${escapeHtml(displayScore(userContent, userContent == null ? 'MISSING' : 'AVAILABLE'))}</p><p>Low decision-stage presence.</p></article><article class="card card-accent-amber no-break"><h3>Competitors</h3><p>Authority: 85+</p><p>Content Depth: 80+</p><p>Strong comparison capture.</p></article></div><div class="card no-break" style="margin-top:12px;"><h3>Why They Are Winning</h3><ul class="simple-list"><li>Capture decision-stage demand.</li><li>Stronger authority.</li><li>Better structured content.</li></ul></div>` : '<div class="card-pending no-break">No competitor data available yet. Competitor comparisons remain directional until more competitor inputs are connected.</div>'}</div>`, { group: 'competitor-page', keepTogether: true }),
  ]);
}

function renderPositionFlow(payload: PdfReportPayload, vars: Record<string, string>): string {
  const strengths = getStrategicStrengthCards(payload);
  const userAuthority = payload.seoVisuals?.seoCapabilityRadar.backlinks_score ?? null;
  const userContent = payload.seoVisuals?.seoCapabilityRadar.content_quality_score ?? null;
  const authorityBenchmark = 85;
  const contentBenchmark = 80;
  const strategicCards = [
    { title: "What's Broken", body: vars.decision_broken, tone: 'card-accent-blue' },
    { title: 'What To Fix First', body: vars.decision_fix_first, tone: 'card-accent-green' },
    { title: 'What To Delay', body: vars.decision_delay, tone: 'card-accent-amber' },
    { title: 'If Ignored', body: vars.decision_ignored, tone: 'card-accent-red' },
  ];
  return renderNarrativeGroup('section-3', 'Position', 'Strategic Position', [
    renderReportBlock('insight', `<div class="card card-accent-blue no-break"><h3>Where You Stand In The Market</h3><p>You are currently positioned below competitive visibility level in your category.</p><ul class="simple-list"><li>You are not consistently discovered in high-intent searches.</li><li>You are not part of comparison decisions often enough.</li><li>You are not competing where it matters most.</li></ul></div>`, { group: 'section-3', keepTogether: true }),
    renderReportBlock('insight', `<div class="grid-2"><article class="card card-accent-blue no-break"><h3>${escapeHtml(vars.company_name)} At A Glance</h3><div class="stack-10">${[
      ['Products / Services', safeText(payload.companyContext?.primaryOffering, 1)],
      ['Focus', safeText(payload.companyContext?.marketContext, 1)],
      ['Differentiation', safeText(payload.companyContext?.positioningNarrative || payload.companyContext?.positioningGap, 1)],
    ].filter((item) => item[1]).map((item) => `<div><div class="label">${escapeHtml(item[0])}</div><p>${escapeHtml(item[1])}</p></div>`).join('')}</div></article><article class="card no-break"><h3>Market Position</h3><p>${escapeHtml(safeText(payload.companyContext?.marketPositionStatement || payload.companyContext?.marketNarrative, 2) || 'Market position will sharpen as more competitive evidence is connected.')}</p></article></div>`, { group: 'section-3', keepTogether: true }),
    renderReportBlock('score-card', `<div class="grid-4"><div class="card no-break"><div class="label">Authority</div><div class="${userAuthority == null ? 'score-missing' : 'score-med'}">${escapeHtml(displayScore(userAuthority, userAuthority == null ? 'MISSING' : 'AVAILABLE'))}</div><div class="pending-note">Market leaders: ${authorityBenchmark}-90+</div></div><div class="card no-break"><div class="label">Content Depth</div><div class="${userContent == null ? 'score-missing' : 'score-med'}">${escapeHtml(displayScore(userContent, userContent == null ? 'MISSING' : 'AVAILABLE'))}</div><div class="pending-note">Market leaders: ${contentBenchmark}+</div></div><div class="card no-break"><div class="label">Buying-Stage Coverage</div><div class="score-med">${escapeHtml(userContent != null && userContent >= 50 ? 'Moderate' : 'Low')}</div><div class="pending-note">Market leaders: High</div></div><div class="card no-break"><div class="label">AI / Answer Presence</div><div class="${hasRealAiVisibilityData(payload) ? 'score-med' : 'score-missing'}">${escapeHtml(hasRealAiVisibilityData(payload) ? 'Emerging' : '--')}</div><div class="pending-note">Market leaders: Strong</div></div></div>`, { group: 'section-3', keepTogether: true }),
    renderReportBlock('insight', renderScoreComparison('Your Authority vs Market', userAuthority, 'Market Leader', authorityBenchmark), { group: 'section-3', fill: true }),
    renderReportBlock('chart', `<div class="card no-break comparison-bars"><h3>Competitive Gap</h3><div class="bar-row"><span>Authority</span><div class="bar-track compare-track"><div class="bar-fill compare-user" style="width:${clampPercent(userAuthority)}%"></div></div><span>${escapeHtml(displayScore(userAuthority, userAuthority == null ? 'MISSING' : 'AVAILABLE'))}</span></div><div class="bar-row"><span>Content Depth</span><div class="bar-track compare-track"><div class="bar-fill compare-market" style="width:${clampPercent(userContent)}%"></div></div><span>${escapeHtml(displayScore(userContent, userContent == null ? 'MISSING' : 'AVAILABLE'))}</span></div></div>`, { group: 'section-3', fill: true }),
    renderReportBlock('insight', `<div class="grid-4">${strategicCards.map((item) => `<article class="card ${item.tone} no-break"><h3>${escapeHtml(item.title)}</h3>${item.body ? `<p>${escapeHtml(item.body)}</p>` : renderFillQuote(item.title, 'More evidence in this area will turn the strategy into a sharper execution brief.')}</article>`).join('')}</div>`, { group: 'section-3' }),
    renderReportBlock('score-card', `<div class="grid-4">${strengths.map((item) => `<div class="card no-break"><div class="label">${escapeHtml(item.label)}</div><div class="${item.score == null ? 'score-missing' : 'score-med'}">${escapeHtml(displayScore(item.score, item.score == null ? 'MISSING' : 'AVAILABLE'))}</div><div class="bar-track"><div class="bar-fill ${item.score != null && item.score < 30 ? 'bar-fill-red' : item.score != null && item.score < 50 ? 'bar-fill-amber' : 'bar-fill-green'}" style="width:${item.score == null ? 0 : clampPercent(item.score)}%"></div></div>${item.value ? `<p style="margin-top:8px;">${escapeHtml(item.value)}</p>` : ''}</div>`).join('')}</div>`, { group: 'section-3', keepTogether: true }),
    renderReportBlock('insight', '<div class="card no-break conclusion-block"><strong>Bottom Line:</strong><p>You are present in the market, but not competitive in decision-stage visibility.</p></div>', { group: 'section-3', fill: true }),
  ]);
}

function renderTransformationFlow(payload: PdfReportPayload): string {
  const userAuthority = payload.seoVisuals?.seoCapabilityRadar.backlinks_score ?? null;
  const beforeAfter = renderBeforeAfter(
    [
      `Low authority (${displayScore(userAuthority, userAuthority == null ? 'MISSING' : 'AVAILABLE')})`,
      'Missing decision-stage content',
      'Weak conversion visibility',
    ],
    [
      'Stronger authority signals',
      'Presence in comparison queries',
      'Higher conversion-ready traffic',
    ],
  );
  return renderNarrativeGroup('transformation-page', 'Transformation', 'What Changes When You Fix This', [
    renderReportBlock('insight', `<div class="report-page transformation-page"><div class="page-header no-break"><h2>What Changes When You Fix This</h2><p>Execution should move the business from weak discovery to stronger decision-stage presence.</p></div>${beforeAfter}</div>`, { group: 'transformation-page', keepTogether: true }),
  ]);
}

function renderOpportunityFlow(payload: PdfReportPayload): string {
  const funnel = payload.seoVisuals?.searchVisibilityFunnel;
  const opportunities = payload.seoVisuals?.opportunityCoverageMatrix.opportunities ?? [];
  const conversion = opportunities.length ? Math.round(opportunities.reduce((sum, item) => sum + Number(item.coverage_score ?? 0), 0) / opportunities.length) : null;
  const stages = [
    { label: 'Demand', value: funnel?.impressions ?? null, note: 'Search demand entering the funnel.' },
    { label: 'Visibility', value: funnel?.impressions ?? null, note: 'Current visible share of demand.' },
    { label: 'Clicks', value: funnel?.clicks ?? null, note: 'Visits captured from visible demand.' },
    { label: 'Conversion', value: conversion, note: 'Commercial readiness inferred from coverage.' },
  ];
  const matrix = payload.seoVisuals?.opportunityCoverageMatrix.opportunities ?? [];
  const gap = payload.competitorVisuals?.keywordGapAnalysis;
  return renderNarrativeGroup('section-4', 'Where Growth Exists', 'Opportunity Layer', [
    renderReportBlock('disclaimer', renderInlineDisclaimer('missing', 'Conversion and behavioral data are not available.', 'Missing analytics'), { group: 'section-4', fill: true }),
    renderReportBlock('chart', `<div class="report-page opportunity-page"><div class="page-header no-break"><h2>Where Growth Exists</h2><p>Demand exists, but it is not being captured consistently.</p></div><div class="grid-2"><article class="card no-break"><h3>Funnel Gaps</h3><p>Demand exists but is not captured.</p><ul class="simple-list">${stages.map((stage) => `<li>${escapeHtml(stage.label)}: ${escapeHtml(displayScore(stage.value, stage.value == null ? 'MISSING' : 'AVAILABLE'))}</li>`).join('')}</ul></article><article class="card card-accent-green no-break"><h3>Top Opportunities</h3><ul class="simple-list">${matrix.length ? matrix.slice(0, 3).map((item) => `<li>${escapeHtml(item.keyword)}</li>`).join('') : '<li>Comparison pages</li><li>Content depth expansion</li><li>Authority building</li>'}</ul>${gap?.missing_keywords?.length ? `<hr class="divider" /><div class="label">Missing Coverage</div><ul class="simple-list">${gap.missing_keywords.slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}</article></div></div>`, { group: 'section-4', keepTogether: true }),
  ]);
}

function renderDiagnosticsFlow(payload: PdfReportPayload, vars: Record<string, string>): string {
  const visuals = payload.seoVisuals;
  const gscSource = deriveDataSources(payload).find((item) => item.source === 'gsc');
  const seoCards = [
    ['Technical SEO', visuals?.seoCapabilityRadar.technical_seo_score ?? null, toUpperStrength(visuals?.seoCapabilityRadar.data_source_strength?.technical_seo_score)],
    ['Keyword Research', visuals?.seoCapabilityRadar.keyword_research_score ?? null, toUpperStrength(visuals?.seoCapabilityRadar.data_source_strength?.keyword_research_score)],
    ['Rank Tracking', visuals?.seoCapabilityRadar.rank_tracking_score ?? null, toUpperStrength(visuals?.seoCapabilityRadar.data_source_strength?.rank_tracking_score)],
    ['Content Depth', visuals?.seoCapabilityRadar.content_quality_score ?? null, toUpperStrength(visuals?.seoCapabilityRadar.data_source_strength?.content_quality_score)],
  ] as const;
  const seoDisclaimer = gscSource?.status === 'missing'
    ? renderInlineDisclaimer('missing', 'Keyword and ranking data not connected. Insights are inferred from crawl signals. connect GSC to unlock full accuracy.', 'Missing keyword data')
    : gscSource?.status === 'partial'
      ? renderInlineDisclaimer('partial', 'Insights are directional due to limited keyword and ranking coverage. Full connection will improve accuracy.', 'Partial keyword data')
      : '';
  const seoSummary = seoCards.map((item) => `${item[0]}: ${displayScore(item[1], item[2])}`).join(' | ');
  const radarValues = [
    { label: 'Technical', value: Number(visuals?.seoCapabilityRadar.technical_seo_score ?? 0) },
    { label: 'Keywords', value: Number(visuals?.seoCapabilityRadar.keyword_research_score ?? 0) },
    { label: 'Rank', value: Number(visuals?.seoCapabilityRadar.rank_tracking_score ?? 0) },
    { label: 'Content', value: Number(visuals?.seoCapabilityRadar.content_quality_score ?? 0) },
  ];
  return renderNarrativeGroup('section-5', 'Diagnostics', 'SEO, Authority, And AI Visibility', [
    renderReportBlock('chart', `<div class="report-page seo-page"><div class="page-header no-break"><h2>SEO Deep Dive</h2><p>Technical SEO is currently strongest, while weaker dimensions constrain performance.</p></div><div class="card no-break"><h3>SEO Summary</h3><p>Score summary: ${escapeHtml(seoSummary)}</p>${seoDisclaimer || '<div class="pending-note">Directional technical and content signals available.</div>'}</div><div class="grid-2"><article class="card no-break"><h3>SEO Capability Radar</h3>${renderRadarSvg(radarValues)}</article><article class="card no-break"><h3>SEO Dimension Cards</h3><div class="grid-2"><div class="metric-card no-break"><h3>Technical SEO</h3><div class="${visuals?.seoCapabilityRadar.technical_seo_score == null ? 'score-missing' : 'score-med'}">${escapeHtml(displayScore(visuals?.seoCapabilityRadar.technical_seo_score ?? null, toUpperStrength(visuals?.seoCapabilityRadar.data_source_strength?.technical_seo_score)))}</div></div><div class="metric-card no-break"><h3>Content Quality</h3><div class="${visuals?.seoCapabilityRadar.content_quality_score == null ? 'score-missing' : 'score-med'}">${escapeHtml(displayScore(visuals?.seoCapabilityRadar.content_quality_score ?? null, toUpperStrength(visuals?.seoCapabilityRadar.data_source_strength?.content_quality_score)))}</div></div></div></article></div><div class="grid-3"><article class="card no-break"><h3>Why This Matters</h3><p>Technical SEO is currently strongest, while weaker dimensions constrain performance.</p></article><article class="card no-break"><h3>Opportunity Coverage</h3><ul class="simple-list"><li>Content: Medium gap</li><li>Keywords: High gap</li><li>Authority: High gap</li></ul></article><article class="card no-break"><h3>Crawl Health</h3><p>Metadata: ${escapeHtml(displayScore(visuals?.crawlHealthBreakdown?.metadata_issues ?? null, visuals ? 'AVAILABLE' : 'MISSING'))} | Internal Links: ${escapeHtml(displayScore(visuals?.crawlHealthBreakdown?.internal_link_issues ?? null, visuals ? 'AVAILABLE' : 'MISSING'))} | Structure: ${escapeHtml((visuals?.crawlHealthBreakdown?.structure_issues ?? 0) > 0 ? 'Weak' : 'Stable')}</p></article></div></div>`, { group: 'section-5', keepTogether: true, fill: true }),
  ]);
}

function renderAuthorityAiFlow(payload: PdfReportPayload): string {
  const visuals = payload.seoVisuals;
  const geo = payload.geoAeoExecutiveSummary;
  const backlinkStrength = toUpperStrength(visuals?.seoCapabilityRadar.data_source_strength?.backlinks_score);
  const competitorRadar = payload.competitorVisuals?.competitorPositioningRadar;
  const authorityGap = competitorRadar?.competitors?.length
    ? Math.round((competitorRadar.competitors.reduce((sum, item) => sum + Number(item.authority_score ?? 0), 0) / competitorRadar.competitors.length) - Number(competitorRadar.user.authority_score ?? 0))
    : null;
  const authorityDisclaimer = backlinkStrength === 'INFERRED'
    ? renderInlineDisclaimer('partial', 'Backlink data is inferred. Connect a backlink source for full authority accuracy.', 'Partial authority signals')
    : backlinkStrength === 'MISSING'
      ? renderInlineDisclaimer('missing', 'This section is based on inferred signals. Connect a backlink source to unlock full accuracy.', 'Missing backlink data')
      : '';
  const aiDisclaimer = !hasRealAiVisibilityData(payload)
    ? renderInlineDisclaimer('missing', 'AI answer visibility is based on structural signals only.', 'Limited AI visibility')
    : '';
  return renderNarrativeGroup('authority-ai-page', 'Authority And AI', 'Authority + AI Visibility', [
    renderReportBlock('chart', `<div class="report-page authority-ai-page"><div class="page-header no-break"><h2>Authority + AI Visibility</h2><p>Authority strength and answer-engine readiness determine whether your content can compete and convert.</p></div><div class="grid-2"><article class="card no-break"><h3>Backlink & Authority</h3><p>${backlinkStrength === 'MISSING' ? 'Backlink data pending.' : `Score: ${escapeHtml(displayScore(visuals?.seoCapabilityRadar.backlinks_score ?? null, backlinkStrength))}`}</p>${authorityDisclaimer || `<p>Authority gap vs competitors: ${escapeHtml(displayScore(authorityGap, authorityGap == null ? 'MISSING' : 'AVAILABLE'))}</p>`}</article><article class="card no-break"><h3>AI Visibility</h3>${hasRealAiVisibilityData(payload) ? `<p>${escapeHtml(geo?.primaryGap.reasoning || 'AI visibility signals are becoming measurable.')}</p>` : `<p>AI visibility cannot be measured yet.</p>${aiDisclaimer}`}</article></div></div>`, { group: 'authority-ai-page', keepTogether: true }),
  ]);
}

function renderActionsFlow(actions: ReturnType<typeof collectMasterActions>): string {
  const mergedActions = ensureActionCoverage(actions);
  return renderNarrativeGroup('section-6', 'What To Do Next', 'Action Plan', [
    renderReportBlock('insight', `<div class="report-page actions-page"><div class="page-header no-break"><h2>What To Do Next</h2><p>The first five moves that improve visibility, trust, and conversion readiness.</p></div><div class="card no-break action-strategy"><h3>Execution Strategy</h3><p>Focus first on capturing high-intent demand, then strengthen authority to sustain ranking and conversion gains.</p></div><div class="stack-12">${mergedActions.map((action, index) => renderMasterActionCard(action, index)).join('')}</div></div>`, { group: 'section-6', keepTogether: true }),
  ]);
}

function renderTrajectoryFlow(payload: PdfReportPayload, actions: ReturnType<typeof collectMasterActions>): string {
  const currentScore = getOverallScore(payload);
  const nextScore = Math.min(100, currentScore + Math.max(3, actions.filter((item) => item.priority === 'HIGH').length * 2));
  const futureScore = Math.min(100, nextScore + Math.max(4, actions.length * 2));
  const maxScore = Math.max(currentScore, nextScore, futureScore, 1);
  const points = [
    { label: 'Current', value: currentScore },
    { label: 'Next', value: nextScore },
    { label: 'Future', value: futureScore },
  ];
  return renderNarrativeGroup('section-7', 'What Happens Next', 'Growth Trajectory', [
    renderReportBlock('chart', `<div class="trajectory-layout"><div class="trajectory-graph">${points.map((point) => `<div class="trajectory-col"><div class="trajectory-bar-wrap"><div class="trajectory-bar ${getStateTone(point.value)}" style="height:${Math.max(14, Math.round((point.value / maxScore) * 88))}px;"></div></div><div class="score-med">${escapeHtml(displayScore(point.value, 'AVAILABLE'))}</div><div class="label">${escapeHtml(point.label)}</div></div>`).join('')}</div><div class="card no-break trajectory-note"><h3>Simulation Note</h3><p>This simulation is based on the current action stack and improves as more systems are connected.</p></div></div>`, { group: 'section-7', keepTogether: true, fill: true }),
    renderReportBlock('insight', '<div class="card no-break trajectory-explained"><h3>How You Reach The Next Scores</h3><ul class="simple-list"><li>Next: Initial visibility gains from comparison pages.</li><li>Future: Authority and content depth improvements compound growth.</li></ul><p class="trajectory-footnote">Execution quality determines how fast movement from 29 to 47 occurs.</p></div>', { group: 'section-7', keepTogether: true }),
  ]);
}

function renderConfidenceFlow(payload: PdfReportPayload, vars: Record<string, string>, sectionStatuses: Record<string, SnapshotSectionStatus>): string {
  const coverageHtml = renderDataCoveragePage(payload, vars, sectionStatuses)
    .replace(/^<div class="report-section data-coverage-page" id="coverage-page">/, '')
    .replace(/^<div class="label">Data Confidence & Coverage<\/div><h2>Data Confidence & Coverage<\/h2>/, '')
    .replace(/<\/div>$/, '');
  return `<section class="narrative-group" id="section-8" data-group="section-8">${renderReportBlock('heading', '<div class="label">Data Confidence</div><h2>Data Confidence & Coverage</h2>', { className: 'report-block-heading', group: 'section-8', keepTogether: true })}${renderReportBlock('disclaimer', coverageHtml, { group: 'section-8' })}</section>`;
}

function getBacklinkStrength(payload: PdfReportPayload): 'STRONG' | 'INFERRED' | 'WEAK' | 'MISSING' {
  return toUpperStrength(payload.seoVisuals?.seoCapabilityRadar.data_source_strength?.backlinks_score);
}

function getSnapshotSectionSpecs(
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
  ];
  const sectionStatuses = Object.fromEntries(sections.filter((section) => section.id !== 'section-overview').map((section) => [section.id, section.status])) as Record<string, SnapshotSectionStatus>;
  sections[0] = {
    id: 'section-overview',
    title: 'Executive Overview',
    status: 'complete',
    html: renderSectionOverview(payload, vars, sectionStatuses, keywordGapEligible),
  };
  return sections;
}

export function renderOmnivyraSnapshotMasterHtml(payload: PdfReportPayload): { html: string; templateName: string } {
  const vars = buildTemplateVariables(payload);
  const sections = getSnapshotSectionSpecs(payload, vars);
  const sectionStatuses = Object.fromEntries(sections.filter((section) => section.id !== 'section-overview').map((section) => [section.id, section.status])) as Record<string, SnapshotSectionStatus>;
  const htmlReviewSectionIds = new Set<string>();
  const reviewSections = sections.filter((section) => htmlReviewSectionIds.has(section.id)).map((section) => ({
    ...section,
    html: stripLeadingSectionHeader(section.html),
  }));
  const actions = collectMasterActions(payload);
  const completedMarkup = `
    <div class="completed-flow">
      ${renderHookFlow(payload, vars)}
      ${renderRealityFlow(payload)}
      ${renderInsightsFlow()}
      ${renderPositionFlow(payload, vars)}
      ${renderCompetitorFlow(payload)}
      ${renderTransformationFlow(payload)}
      ${renderOpportunityFlow(payload)}
      ${renderDiagnosticsFlow(payload, vars)}
      ${renderAuthorityAiFlow(payload)}
      ${renderActionsFlow(actions)}
      ${renderTrajectoryFlow(payload, actions)}
      ${renderConfidenceFlow(payload, vars, sectionStatuses)}
    </div>
  `;
  const incompleteMarkup = reviewSections.length
    ? `<section id="incomplete-report" class="report-group report-group-incomplete"><div class="group-header"><div><div class="group-kicker">Needs More Data</div><h2>Additional Review Sections</h2><p>These sections stay visible in HTML for internal review. The shareable PDF keeps the tighter narrative above while these extra drill-downs remain available here.</p></div><div class="group-pill group-pill-incomplete">${reviewSections.length} section${reviewSections.length === 1 ? '' : 's'}</div></div><div class="report-stack">${reviewSections.map((section) => section.html).join('')}</div></section>`
    : `<section id="incomplete-report" class="report-group report-group-incomplete"><div class="group-header"><div><div class="group-kicker">Needs More Data</div><h2>Partial Or Pending Sections</h2><p>All sections are complete for this report run.</p></div><div class="group-pill group-pill-complete">0 sections</div></div></section>`;
  const html = `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(vars.company_name)} Digital Authority Snapshot</title>
    <style>
      @page { size: A4; margin: 12mm; }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      :root {
        --ink-strong: #0F172A;
        --ink: #243244;
        --muted: #5B6B7F;
        --line: #D9E2EE;
        --line-strong: #C6D3E3;
        --paper: #FFFFFF;
        --surface: #F7F9FC;
        --surface-warm: #FBFAF7;
        --navy-soft: #EAF0FB;
        --blue-soft: #E8F1FF;
        --green-soft: #EEF8F1;
        --amber-soft: #FFF7EB;
        --red-soft: #FFF3F1;
      }
      body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: var(--ink-strong); background: linear-gradient(180deg, #F8FAFD 0%, #F1F5F9 100%); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .report-page { width: calc(210mm + 32px); max-width: 100%; margin: 0 auto; padding: 16px; }
      #pdf-report { width: 186mm; max-width: 100%; margin: 0 auto; }
      .report-group { margin-bottom: 16px; }
      .group-header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; padding: 12px 14px; border: 1px solid var(--line); border-radius: 16px; background: rgba(255,255,255,0.92); backdrop-filter: blur(6px); margin-bottom: 12px; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.04); }
      .group-kicker { font-size: 10px; font-weight: 700; color: #64748B; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 4px; }
      .group-header h2 { margin-bottom: 6px; }
      .group-header p { color: #6B7280; max-width: 720px; line-height: 1.5; }
      .group-pill { display: inline-flex; align-items: center; justify-content: center; min-width: 88px; font-size: 11px; font-weight: 700; border-radius: 999px; padding: 8px 12px; }
      .group-pill-complete { background: #F0FDF4; color: #166534; }
      .group-pill-incomplete { background: #FEF3C7; color: #92400E; }
      .report-stack { display: grid; gap: 8px; }
      .completed-flow { display: grid; gap: 8px; width: 100%; }
      .narrative-group { display: grid; gap: 8px; width: 100%; }
      .report-block { background: linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(250,252,255,0.98) 100%); border: 1px solid var(--line); border-radius: 16px; padding: 10px; box-shadow: 0 10px 28px rgba(15, 23, 42, 0.045); min-height: 0; height: auto; }
      .report-block-heading { background: transparent; border: none; box-shadow: none; padding: 2px 2px 0; min-height: 0; position: relative; z-index: 1; }
      .report-block-subheading { background: #F8FBFF; border-color: #DDEAFE; min-height: 0; }
      .report-block-compact { min-height: 0; padding: 10px 12px; }
      .report-block-group { display: grid; gap: 8px; }
      .keep-together { break-inside: avoid-page; page-break-inside: avoid; }
      .report-block[data-type="action"] { padding: 0; border: none; box-shadow: none; background: transparent; min-height: 0; }
      .report-block[data-type="disclaimer"] { background: #FCFCFD; }
      .report-block[data-fill="true"] { border-style: dashed; }
      .pdf-page { display: grid; gap: 8px; margin-bottom: 8px; }
      .page-stack { display: grid; gap: 8px; }
      .page-print-header { display: none; }
      .report-section { padding: 16px; border: 1px solid var(--line); border-radius: 18px; background: linear-gradient(180deg, rgba(255,255,255,0.99) 0%, rgba(249,251,254,0.99) 100%); box-shadow: 0 12px 34px rgba(15, 23, 42, 0.05); min-height: auto; }
      .section-continue { padding-top: 8px; }
      .section-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--line); margin-bottom: 12px; font-size: 11px; color: #7A8797; letter-spacing: 0.08em; text-transform: uppercase; }
      .section-header .company-name { font-weight: 700; color: var(--ink); }
      h1 { font-family: Georgia, 'Times New Roman', serif; font-size: 24px; font-weight: 700; color: var(--ink-strong); margin-bottom: 6px; line-height: 1.1; letter-spacing: -0.03em; }
      h2 { font-family: Georgia, 'Times New Roman', serif; font-size: 17px; font-weight: 700; color: var(--ink-strong); margin-bottom: 6px; line-height: 1.16; letter-spacing: -0.02em; }
      h3 { font-size: 13px; font-weight: 700; color: var(--ink); margin-bottom: 6px; line-height: 1.24; }
      p { line-height: 1.52; color: var(--muted); margin-bottom: 6px; text-align: left; text-wrap: pretty; }
      p:last-child { margin-bottom: 0; }
      strong { color: #0F172A; font-weight: 700; }
      em { color: #475569; font-style: italic; }
      .label { font-size: 10px; font-weight: 700; color: #64748B; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 4px; }
      .card, .metric-card { background: linear-gradient(180deg, var(--surface) 0%, #FFFFFF 100%); border: 1px solid #E4EBF4; border-radius: 8px; padding: 10px; line-height: 1.4; height: auto; }
      .card-compact { padding: 10px 12px; }
      .chart-card h3 { font-size: 12px; margin-bottom: 6px; }
      .executive-insights, .before-after, .priority-engine, .score-comparison { display: grid; gap: 10px; }
      .insight-card { background: linear-gradient(180deg, var(--surface) 0%, #FFFFFF 100%); border: 1px solid #E4EBF4; border-radius: 10px; padding: 10px; line-height: 1.4; height: auto; }
      .insight-card.high-impact { border-left: 4px solid #9F1239; background: linear-gradient(180deg, #FFF7F8 0%, #FFF1F2 100%); }
      .insight-title { font-size: 13px; font-weight: 700; color: #111827; margin-bottom: 4px; }
      .insight-impact { font-size: 12px; color: #475569; line-height: 1.5; }
      .transformation-table { width: 100%; border-collapse: collapse; page-break-inside: avoid; break-inside: avoid-page; }
      .transformation-table td { vertical-align: top; padding: 8px; }
      .transformation-table .arrow { width: 40px; text-align: center; font-weight: 700; color: #64748B; }
      .state-card { border: 1px solid #E4EBF4; border-radius: 10px; padding: 10px; background: linear-gradient(180deg, var(--surface) 0%, #FFFFFF 100%); page-break-inside: avoid; break-inside: avoid-page; }
      .state-card.current { background: linear-gradient(180deg, #FFF8F6 0%, #FFF2EF 100%); }
      .state-card.future { background: linear-gradient(180deg, #F4FBF5 0%, #ECFDF3 100%); }
      .priority-card { border: 1px solid #E4EBF4; border-radius: 10px; padding: 10px; background: linear-gradient(180deg, var(--surface) 0%, #FFFFFF 100%); }
      .priority-card.top-priority { border-left: 4px solid #1D4ED8; background: linear-gradient(180deg, #F6FAFF 0%, #EEF5FF 100%); }
      .priority-label { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #6B7280; margin-bottom: 4px; }
      .priority-title { font-size: 14px; font-weight: 700; color: #111827; margin-bottom: 4px; }
      .priority-meta { font-size: 12px; color: #475569; }
      .bar-row { display: grid; grid-template-columns: 120px minmax(0, 1fr) 42px; gap: 10px; align-items: center; }
      .compare-track { margin-top: 0; }
      .compare-user { background: #EF4444; }
      .compare-market { background: #F59E0B; }
      .mini-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .mini-metric-card { padding: 12px 14px; }
      .callout-box { border: 1px solid #BFDBFE; background: linear-gradient(180deg, #F4F9FF 0%, #EAF3FF 100%); border-radius: 10px; padding: 10px 12px; color: #1E3A8A; line-height: 1.5; }
      .inline-summary { color: #374151; line-height: 1.65; font-weight: 500; }
      .page-header { padding: 0 0 4px; }
      .page-header h2 { margin-bottom: 6px; }
      .page-header p { color: #4B5563; }
      .page-hero-cover { display: grid; gap: 8px; }
      .page-hero-header { display: flex; justify-content: flex-start; align-items: center; gap: 12px; flex-wrap: wrap; }
      .page-hero-date { font-size: inherit; color: inherit; }
      .page-hero-grid { grid-template-columns: minmax(0, 0.94fr) minmax(0, 1.06fr); gap: 10px; align-items: start; }
      .page-hero-grid > .stack-12 { gap: 10px; align-content: start; }
      .cover-score-panel { display: grid; justify-items: start; align-content: start; gap: 8px; min-height: 248px; }
      .cover-score-circle { width: 136px; height: 136px; border-radius: 999px; display: grid; place-items: center; background: radial-gradient(circle at 30% 30%, #FFFFFF 0%, #EEF4FF 32%, #D7E7FF 100%); border: 1px solid #B8CCEA; box-shadow: inset 0 1px 0 rgba(255,255,255,0.92), 0 10px 22px rgba(29, 78, 216, 0.12); }
      .cover-score-big { font-size: 88px; line-height: 0.9; }
      .cover-url-strong { font-size: 20px; font-weight: 600; color: #2563EB; line-height: 1.2; }
      .cover-tags-strong .badge { font-size: 14px; padding: 8px 16px; }
      .cover-context-panel { display: grid; align-content: start; align-self: start; gap: 4px; padding-top: 8px; }
      .cover-context-panel h1 { font-size: 22px; margin-bottom: 4px; }
      .cover-context-panel > p { margin-bottom: 0; }
      .cover-explainer { display: grid; gap: 6px; margin-top: 4px; }
      .cover-explainer-block { border-radius: 8px; padding: 9px 11px; }
      .cover-action-panel h3 { margin-bottom: 4px; }
      .cover-action-panel p { margin-bottom: 4px; }
      .cover-action-panel .divider { margin: 8px 0; }
      .cover-action-panel .timeline { display: grid; gap: 6px; margin-top: 4px; }
      .cover-action-panel .timeline-item { background: linear-gradient(180deg, #FBFCFE 0%, #F4F7FB 100%); border: 1px solid #E6ECF3; border-radius: 6px; padding: 7px 10px; font-size: 11px; color: #6B7280; line-height: 1.4; }
      .cover-action-panel .timeline-item strong { color: #334155; }
      .meaning-block { background: linear-gradient(180deg, #F3F8FF 0%, #E8F1FF 100%); border: 1px solid #BFDBFE; }
      .meaning-block .label { color: #1D4ED8; }
      .competition-block { background: linear-gradient(180deg, #FFF9F0 0%, #FFF1DF 100%); border: 1px solid #FED7AA; }
      .competition-block .label { color: #C2410C; }
      .why-read-block { background: linear-gradient(180deg, #F4FBF5 0%, #EAF8EC 100%); border: 1px solid #BBF7D0; color: #166534; font-weight: 500; }
      .cover-explainer ul { margin: 0; padding-left: 18px; }
      .cover-explainer li { margin-bottom: 4px; }
      .metric-card.highlight { border: 2px solid #111827; }
      .metric-card .gap { margin-top: 6px; font-size: 11px; color: #6B7280; }
      .callout { border-radius: 8px; padding: 10px 12px; border: 1px solid #E5E7EB; }
      .callout.primary { background: linear-gradient(180deg, #FAFCFF 0%, #F3F7FD 100%); border-color: #DCE7F6; }
      .callout.secondary { background: linear-gradient(180deg, #FCFCFD 0%, #F7F8FA 100%); border-color: #ECEFF3; }
      .callout p { margin-top: 6px; color: #374151; }
      .flow { padding: 8px 0 0; }
      .flow h3 { margin-bottom: 6px; }
      .flow-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-weight: 500; flex-wrap: wrap; }
      .root-cause-grid .card p + p { margin-top: 8px; }
      .card-accent-red { border-left: 3px solid #C2410C; border-radius: 0 8px 8px 0; }
      .card-accent-green { border-left: 3px solid #15803D; border-radius: 0 8px 8px 0; }
      .card-accent-blue { border-left: 3px solid #1D4ED8; border-radius: 0 8px 8px 0; }
      .card-accent-amber { border-left: 3px solid #B45309; border-radius: 0 8px 8px 0; }
      .card-pending { background: #F9FAFB; border: 1px dashed #D1D5DB; border-radius: 8px; padding: 10px; text-align: center; color: #6B7280; font-size: 13px; }
      .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
      .grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
      .grid-4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
      .score-big { font-size: 40px; font-weight: 700; color: #111827; line-height: 1; }
      .score-med { font-size: 22px; font-weight: 600; color: #111827; }
      .score-missing { font-size: 22px; font-weight: 600; color: #9CA3AF; }
      .badge { display: inline-block; font-size: 10px; font-weight: 600; padding: 3px 10px; border-radius: 20px; }
      .badge-blue { background: #EAF2FF; color: #1D4ED8; }
      .badge-amber { background: #FFF4E2; color: #9A5510; }
      .badge-red { background: #FFF1F2; color: #9F1239; }
      .badge-green { background: #EEF8F1; color: #166534; }
      .badge-gray { background: #F1F5F9; color: #475569; }
      .bar-track { background: #E5E7EB; border-radius: 4px; height: 8px; margin-top: 4px; overflow: hidden; }
      .bar-fill { height: 8px; border-radius: 4px; background: #3B82F6; }
      .bar-fill-amber { background: #F59E0B; }
      .bar-fill-red { background: #EF4444; }
      .bar-fill-green { background: #22C55E; }
      .divider { border: none; border-top: 1px solid #E5E7EB; margin: 10px 0; }
      .action-card { padding: 10px 12px; border: 1px solid #E4EBF4; border-radius: 8px; margin-bottom: 10px; background: linear-gradient(180deg, #FFFFFF 0%, #F9FBFE 100%); page-break-inside: avoid; break-inside: avoid-page; line-height: 1.45; height: auto; box-shadow: 0 6px 14px rgba(15, 23, 42, 0.04); }
      .action-header { display: flex; gap: 12px; align-items: flex-start; }
      .action-number { font-weight: 700; min-width: 28px; color: #1D4ED8; font-size: 16px; line-height: 1; }
      .action-title { flex: 1; word-break: normal; white-space: normal; font-size: 14px; font-weight: 700; color: #111827; line-height: 1.4; }
      .action-tags { margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap; }
      .action-body { margin-top: 10px; line-height: 1.4; }
      .action-body p + p { margin-top: 6px; }
      .action-body .problem,
      .action-body .impact,
      .action-body .solution { padding-left: 10px; border-left: 2px solid #E5E7EB; }
      .action-body .problem { border-left-color: #F59E0B; }
      .action-body .impact { border-left-color: #EF4444; }
      .action-body .solution { border-left-color: #22C55E; }
      .tag { display: inline-flex; align-items: center; border-radius: 999px; padding: 4px 8px; font-size: 10px; font-weight: 700; letter-spacing: 0.05em; }
      .tag.impact { background: #ECFDF5; color: #166534; }
      .tag.effort { background: #FFFBEB; color: #92400E; }
      .action-card .tactics { margin-top: 8px; padding-left: 18px; }
      .action-card .tactics li { margin-bottom: 4px; font-size: 12px; color: #374151; }
      .action-card .timeline { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; margin-top: 8px; }
      .action-card .timeline-item { background: linear-gradient(180deg, #FBFCFE 0%, #F4F7FB 100%); border: 1px solid #E6ECF3; border-radius: 6px; padding: 8px 10px; font-size: 11px; color: #6B7280; }
      .action-card .timeline-item strong { display: block; color: #111827; margin-bottom: 2px; }
      .tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
      .action-strategy { margin-bottom: 4px; }
      .traj-row { display: flex; align-items: center; justify-content: center; gap: 16px; background: linear-gradient(180deg, #FAFCFF 0%, #F3F7FD 100%); border: 1px solid #E4EBF4; border-radius: 8px; padding: 14px 18px; flex-wrap: wrap; }
      .traj-step { text-align: center; }
      .traj-step .num { font-size: 28px; font-weight: 700; color: #111827; }
      .traj-step .lbl { font-size: 10px; color: #9CA3AF; text-transform: uppercase; letter-spacing: 0.04em; }
      .traj-arrow { color: #9CA3AF; font-size: 20px; }
      .comp-row { display: grid; grid-template-columns: 80px 1fr 100px; gap: 8px; align-items: center; margin-bottom: 10px; }
      .comp-bars { position: relative; height: 18px; }
      .comp-bar-user { position: absolute; top: 0; height: 8px; border-radius: 4px; background: #3B82F6; }
      .comp-bar-comp { position: absolute; bottom: 0; height: 8px; border-radius: 4px; background: #F59E0B; }
      .comp-val { font-size: 11px; color: #6B7280; text-align: right; }
      .comp-label { font-size: 11px; font-weight: 600; color: #475569; }
      .pending-note { font-size: 11px; color: #64748B; font-style: italic; margin-top: 4px; }
      .metric-card span { display: block; font-size: 10px; font-weight: 700; color: #6B7280; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 6px; }
      .metric-card strong { display: block; font-size: 24px; line-height: 1.1; color: #111827; margin-bottom: 8px; }
      .metric-card .bar { background: #E5E7EB; border-radius: 999px; height: 8px; overflow: hidden; margin-bottom: 8px; }
      .metric-card .bar span { display: block; height: 8px; background: #3B82F6; border-radius: 999px; margin-bottom: 0; }
      .metric-card p { font-size: 12px; color: #6B7280; }
      .metric-grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .metric-row-card { display: grid; grid-template-columns: minmax(140px, 0.85fr) minmax(180px, 1fr) minmax(180px, 1.1fr); gap: 12px; align-items: center; }
      .metric-row-card .bar { margin-bottom: 0; }
      .metric-row-card-label strong { margin-bottom: 0; }
      .metric-row-card-note p { margin: 0; }
      .chart-list { display: grid; gap: 8px; }
      .chart-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(140px, 320px) 36px; gap: 10px; align-items: center; }
      .chart-label { font-size: 12px; font-weight: 600; line-height: 1.35; color: #475569; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .chart-track { height: 10px; border-radius: 999px; background: #E8EEF6; overflow: hidden; }
      .chart-fill { height: 10px; border-radius: 999px; }
      .chart-value { font-size: 12px; font-weight: 600; color: #102033; text-align: right; }
      .svg-chart { width: 100%; height: auto; display: block; }
      .section-intro { margin-bottom: 10px; }
      .simple-list { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
      .simple-list li { color: #374151; line-height: 1.48; }
      .simple-list li::marker { color: #3B82F6; }
      .inline-disclaimer { display: grid; gap: 8px; border-radius: 10px; padding: 10px; margin-bottom: 10px; }
      .inline-disclaimer-missing { background: #FEF2F2; border: 1px solid #FECACA; }
      .inline-disclaimer-partial { background: #FFFBEB; border: 1px solid #FDE68A; }
      .coverage-summary-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin-bottom: 12px; }
      .coverage-summary-item { background: linear-gradient(180deg, #FAFBFD 0%, #F4F7FB 100%); border: 1px solid #E4EBF4; border-radius: 10px; padding: 12px 14px; }
      .data-source-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
      .data-source-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
      .fill-quote { border: 1px dashed #CBD5E1; background: linear-gradient(180deg, #FAFCFF 0%, #F3F7FD 100%); border-radius: 10px; padding: 14px 16px; position: relative; overflow: hidden; }
      .fill-quote blockquote { font-size: 16px; line-height: 1.55; color: #1F2937; font-style: italic; margin: 0; padding-left: 14px; border-left: 3px solid #BFDBFE; }
      .fill-quote blockquote::before { content: "\\201C"; color: #93C5FD; font-size: 28px; line-height: 1; margin-right: 6px; vertical-align: top; }
      .visual-metric { background: #FFFFFF; }
      .metric-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
      .metric-meta { display: flex; justify-content: space-between; gap: 10px; margin-top: 6px; font-size: 11px; color: #6B7280; }
      .decomposition-stack { display: grid; gap: 10px; }
      .decomposition-row { display: grid; gap: 4px; }
      .decomposition-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: #374151; }
      .constraint-item { display: grid; gap: 6px; margin-bottom: 10px; }
      .funnel-row { display: grid; grid-template-columns: repeat(7, minmax(0, auto)); gap: 10px; align-items: center; }
      .funnel-stage { border: 1px solid #E5E7EB; border-radius: 10px; padding: 12px; background: #F9FAFB; min-height: 120px; width: 100%; }
      .funnel-stage-missing { background: #F3F4F6; color: #6B7280; }
      .funnel-arrow { color: #9CA3AF; font-size: 24px; text-align: center; }
      .trajectory-layout { display: grid; grid-template-columns: minmax(280px, 1.2fr) minmax(220px, 0.8fr); gap: 12px; align-items: stretch; }
      .trajectory-graph { display: flex; align-items: end; justify-content: center; gap: 20px; min-height: 152px; background: linear-gradient(180deg, #FCFDFF 0%, #F3F7FC 100%); border: 1px solid #E4EBF4; border-radius: 12px; padding: 14px 14px 12px; }
      .trajectory-col { display: grid; gap: 8px; justify-items: center; min-width: 90px; }
      .trajectory-bar-wrap { height: 96px; display: flex; align-items: end; }
      .trajectory-bar { width: 34px; border-radius: 10px 10px 4px 4px; background: #D1D5DB; }
      .trajectory-bar.green { background: #22C55E; }
      .trajectory-bar.yellow { background: #F59E0B; }
      .trajectory-bar.red { background: #EF4444; }
      .trajectory-bar.gray { background: #9CA3AF; }
      .conclusion-block strong,
      .implication h3,
      .trajectory-explained h3 { display: inline-block; padding-bottom: 2px; border-bottom: 2px solid #DBEAFE; }
      .comparison-bars .bar-row span:first-child { font-weight: 600; color: #334155; }
      .metric-meta span:last-child { font-weight: 600; color: #0F172A; }
      .trajectory-note { height: 100%; display: grid; align-content: start; }
      .trajectory-note h3 { margin-bottom: 8px; }
      .trajectory-footnote { margin-top: 10px; font-size: 12px; color: #6B7280; }
      .backlink-summary { display: grid; grid-template-columns: minmax(300px, 1.1fr) minmax(220px, 0.9fr); gap: 12px; align-items: stretch; }
      .backlink-meta { display: grid; gap: 12px; }
      .cover-grid { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 16px; align-items: center; }
      .cover-grid-top { align-items: start; }
      .cover-identity { display: grid; gap: 8px; text-align: left; justify-items: start; align-content: start; }
      .cover-url { color: #3B82F6; font-weight: 600; line-height: 1.4; }
      .cover-tags { margin-top: 0; }
      .cover-statement { font-size: 14px; line-height: 1.6; color: #1F2937; max-width: 720px; }
      .cover-score { width: 120px; height: 120px; border-radius: 999px; display: flex; flex-direction: column; justify-content: center; align-items: center; background: #F9FAFB; }
      .stats-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 12px; }
      .stack-10 { display: grid; gap: 10px; }
      .stack-12 { display: grid; gap: 12px; }
      @media (max-width: 900px) {
        .report-page { width: 100%; padding: 16px; }
        #pdf-report { width: 100%; }
        .section-header { flex-wrap: wrap; }
        .cover-grid, .backlink-summary { grid-template-columns: 1fr; }
        .funnel-row { grid-template-columns: 1fr; }
        .funnel-arrow { display: none; }
        .comp-row { grid-template-columns: 1fr; }
        .comp-val { text-align: left; }
        .action-card { grid-template-columns: 1fr; }
        .chart-row { grid-template-columns: 1fr; }
        .chart-value { text-align: left; }
        .metric-grid-2 { grid-template-columns: 1fr; }
        .metric-row-card { grid-template-columns: 1fr; }
        .trajectory-layout { grid-template-columns: 1fr; }
            .transformation-table, .transformation-table tbody, .transformation-table tr, .transformation-table td { display: block; width: 100%; }
            .transformation-table .arrow { width: 100%; padding: 4px 0; }
        .bar-row { grid-template-columns: 1fr; }
        .mini-metrics { grid-template-columns: 1fr; }
      }
      @media print {
        body { background: #FFFFFF; }
        .report-page { max-width: none; margin: 0; padding: 0; display: block; break-after: auto; page-break-after: auto; break-inside: auto; page-break-inside: auto; }
        #pdf-report { width: auto; max-width: none; margin: 0; }
        .report-group-complete > .group-header { display: none !important; }
        #incomplete-report { display: none !important; }
        .report-group { margin-bottom: 0; }
        .report-stack, .completed-flow, .narrative-group, .report-block-group, .page-stack { display: block; }
        .report-stack, .completed-flow { gap: 0; }
        .narrative-group, .report-block-group { gap: 0; margin-bottom: 3mm; break-inside: auto; page-break-inside: auto; }
        .pdf-page { break-before: auto; page-break-before: auto; margin-bottom: 0; }
        .pdf-page + .pdf-page { break-before: page; page-break-before: always; }
        .page-print-header { display: none; margin-bottom: 3mm; }
        .page-print-header .section-header { margin-bottom: 0; }
        .report-section { break-before: auto; page-break-before: auto; break-inside: auto; page-break-inside: auto; min-height: auto; border-radius: 0; box-shadow: none; margin: 0; }
        .report-block { break-inside: auto; page-break-inside: auto; border-radius: 0; box-shadow: none; margin-bottom: 3mm; }
        .report-block:last-child { margin-bottom: 0; }
        .report-block-heading { break-after: avoid-page; page-break-after: avoid; }
        .report-section:first-child { break-before: auto; page-break-before: auto; }
        .section-continue { padding-top: 2mm; }
        #section-1, #section-1.keep-together, .report-block-hero, .report-block-hero.keep-together { break-inside: auto !important; page-break-inside: auto !important; }
        #section-1 .card, #section-1 .metric-card, #section-1 .no-break, .report-block-hero .card, .report-block-hero .metric-card, .report-block-hero .no-break { break-inside: auto !important; page-break-inside: auto !important; }
        .report-page, .report-page .card, .report-page .metric-card, .report-page .no-break { break-inside: auto; page-break-inside: auto; }
        .cover-grid { grid-template-columns: 120px minmax(0, 1fr) !important; gap: 12px; align-items: start; }
        .cover-identity { text-align: left; justify-items: start; align-content: start; }
        .cover-url, .cover-statement { text-align: left; }
        .grid-4 { grid-template-columns: repeat(4, minmax(0, 1fr)) !important; gap: 8px; }
        .report-block-heading, .report-block.keep-together, .card, .metric-card, .action-card, .traj-row, .comp-row, .no-break { break-inside: avoid-page; page-break-inside: avoid; }
        .action-card { break-inside: avoid-page; page-break-inside: avoid; }
        h1, h2, h3 { page-break-after: avoid; }
      }
    </style>
  </head>
  <body>
    <main class="report-page">
      <!-- PDF-SEGMENT-START -->
      <div id="pdf-report">
        <section class="report-group report-group-complete">
          <div class="report-stack">${completedMarkup}</div>
        </section>
      </div>
      <!-- PDF-SEGMENT-END -->
      <!-- SEGMENT B: internal review -->
      ${incompleteMarkup}
    </main>
  </body>
  </html>`;
  return { html, templateName: 'omnivyra_snapshot_master_report.html' };
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
      focusPage: safeText(variables.next_step_1_focus_page, 1),
      tactics: variables.next_step_1_tactics.split('\n').map((item) => safeText(item, 1)).filter(Boolean).slice(0, 3),
      timeline: {
        short: safeText(variables.next_step_1_timeline_short, 1),
        mid: safeText(variables.next_step_1_timeline_mid, 1),
        long: safeText(variables.next_step_1_timeline_long, 1),
      },
      highlight: safeText(variables.next_step_1_highlight, 1),
      meta: [variables.next_step_1_priority, variables.next_step_1_impact, variables.next_step_1_effort].filter(Boolean).map((value) => safeText(value, 1)),
    },
    {
      title: safeText(variables.next_step_2_title, 1),
      text: safeText(variables.next_step_2_text, 2),
      focusPage: safeText(variables.next_step_2_focus_page, 1),
      tactics: variables.next_step_2_tactics.split('\n').map((item) => safeText(item, 1)).filter(Boolean).slice(0, 3),
      timeline: {
        short: safeText(variables.next_step_2_timeline_short, 1),
        mid: safeText(variables.next_step_2_timeline_mid, 1),
        long: safeText(variables.next_step_2_timeline_long, 1),
      },
      highlight: safeText(variables.next_step_2_highlight, 1),
      meta: [variables.next_step_2_priority, variables.next_step_2_impact, variables.next_step_2_effort].filter(Boolean).map((value) => safeText(value, 1)),
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
      .detail-label { display:block; font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; margin:8px 0 4px; }
      .detail-list { margin:6px 0 0 18px; }
      .detail-list li { font-size:12px; margin-bottom:4px; }
      .timeline { display:grid; gap:4px; margin-top:8px; }
      .timeline p { font-size:11px; color:var(--muted); margin-bottom:0; }
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
                  ${item.focusPage ? `<span class="detail-label">Start here:</span><p>${escapeHtml(item.focusPage)}</p>` : ''}
                  ${item.tactics.length ? `<span class="detail-label">Tactics</span><ol class="detail-list">${item.tactics.map((tactic) => `<li>${escapeHtml(tactic)}</li>`).join('')}</ol>` : ''}
                  ${(item.timeline.short || item.timeline.mid || item.timeline.long) ? `<div class="timeline">
                    ${item.timeline.short ? `<p><strong>2-4 weeks:</strong> ${escapeHtml(item.timeline.short)}</p>` : ''}
                    ${item.timeline.mid ? `<p><strong>1-3 months:</strong> ${escapeHtml(item.timeline.mid)}</p>` : ''}
                    ${item.timeline.long ? `<p><strong>3-6 months:</strong> ${escapeHtml(item.timeline.long)}</p>` : ''}
                  </div>` : ''}
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
      <section class="panel"><div class="cta"><h3>Ready to execute?</h3><p>${escapeHtml(variables.cta_text)}</p>${hasContent(variables.cta_label) ? `<span class="button">${escapeHtml(variables.cta_label)}</span>` : ''}</div></section>
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
        text: safeText(step.reasoning || step.description, 2),
        focusPage: safeText(step.focusPage, 1),
        tactics: Array.isArray(step.tactics) ? step.tactics.map((item) => safeText(item, 1)).filter(Boolean).slice(0, 3) : [],
        timeline: {
          short: safeText(step.timeline?.short, 1),
          mid: safeText(step.timeline?.mid, 1),
          long: safeText(step.timeline?.long, 1),
        },
        priority: safeText(step.priority, 1).toUpperCase(),
        impact: safeText(step.impact, 1).toUpperCase(),
        effort: safeText(step.effort, 1).toUpperCase(),
      }))
    : topActions.map((action) => ({
        title: safeText(action.actionTitle, 1),
        text: safeText(action.reasoning, 2),
        focusPage: safeText(action.focusPage, 1),
        tactics: Array.isArray(action.tactics) ? action.tactics.map((item) => safeText(item, 1)).filter(Boolean).slice(0, 3) : [],
        timeline: {
          short: safeText(action.timeline?.short, 1),
          mid: safeText(action.timeline?.mid, 1),
          long: safeText(action.timeline?.long, 1),
        },
        priority: safeText(action.priority, 1).toUpperCase(),
        impact: safeText(action.impact, 1).toUpperCase(),
        effort: safeText(action.effort, 1).toUpperCase(),
      }));
  const action1 = mappedActions[0] ?? { title: '', text: '', focusPage: '', tactics: [], timeline: { short: '', mid: '', long: '' }, priority: '', impact: '', effort: '' };
  const action2 = mappedActions[1] ?? { title: '', text: '', focusPage: '', tactics: [], timeline: { short: '', mid: '', long: '' }, priority: '', impact: '', effort: '' };
  const action3 = mappedActions[2] ?? { title: '', text: '', focusPage: '', tactics: [], timeline: { short: '', mid: '', long: '' }, priority: '', impact: '', effort: '' };
  const competitorSummary = safeText(payload.competitorIntelligenceSummary?.primaryGap.reasoning, 1);
  const decisionSummary = safeText(payload.decisionSnapshot?.whatToFixFirst, 1);
  const opportunitySummary = safeText(seo?.growthOpportunity?.title || seo?.growthOpportunity?.estimatedUpside, 1);
  const geoSummary = safeText(geo?.primaryGap.reasoning || geo?.visibilityOpportunity?.title, 1);
  const confidenceSummary = safeText(payload.confidenceSource, 1);
  const scoreLimitingFactors = (payload.scoreExplanation?.limitingFactors ?? [])
    .map((item) => safeText(item, 1))
    .filter(Boolean);
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
    || '',
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
    confidence_label: confidenceLabel,
    banner_text: bannerText,
    executive_summary: safeText(payload.diagnosis, 2),
    confidence_summary: confidenceSummary,
    score_summary: scoreLimitingFactors.slice(0, 2).join(' '),
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
      || '',
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
    visual_reason_1: visual1,
    visual_reason_3: visual3,
    visual_reason_4: visual4,
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
    insight_text_2: geoSummary,
    insight_title_3: safeText(payload.competitorIntelligenceSummary?.primaryGap.title || 'Execution implication', 1),
    insight_text_3: competitorSummary,
    insight_title_4: safeText('Market implication', 1),
    insight_text_4: safeText(payload.unifiedIntelligenceSummary?.marketContextSummary, 1),
    decision_banner: safeText(payload.decisionSnapshot?.primaryFocusArea, 1),
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
    action_1_title: action1.title,
    action_1_text: action1.text,
    action_1_focus_page: action1.focusPage,
    action_1_tactics: action1.tactics.join('\n'),
    action_1_timeline_short: action1.timeline.short,
    action_1_timeline_mid: action1.timeline.mid,
    action_1_timeline_long: action1.timeline.long,
    action_1_priority: action1.priority,
    action_1_impact: action1.impact,
    action_1_effort: action1.effort,
    action_2_title: action2.title,
    action_2_text: action2.text,
    action_2_focus_page: action2.focusPage,
    action_2_tactics: action2.tactics.join('\n'),
    action_2_timeline_short: action2.timeline.short,
    action_2_timeline_mid: action2.timeline.mid,
    action_2_timeline_long: action2.timeline.long,
    action_2_priority: action2.priority,
    action_2_impact: action2.impact,
    action_2_effort: action2.effort,
    action_3_title: action3.title,
    action_3_text: action3.text,
    action_3_focus_page: action3.focusPage,
    action_3_tactics: action3.tactics.join('\n'),
    action_3_timeline_short: action3.timeline.short,
    action_3_timeline_mid: action3.timeline.mid,
    action_3_timeline_long: action3.timeline.long,
    action_3_priority: action3.priority,
    action_3_impact: action3.impact,
    action_3_effort: action3.effort,
    proof_1_label: '',
    proof_1_value: safeScore(payload.unifiedIntelligenceSummary?.unifiedScore ?? seo?.overallHealthScore ?? null),
    proof_1_text: safeText(
      seo?.growthOpportunity?.basedOn || payload.summary,
      2,
    ),
    proof_2_label: '',
    proof_2_value: safeScore(visuals?.opportunityCoverageMatrix.opportunities?.[0]?.opportunity_score ?? null),
    proof_2_text: safeText(
      visuals?.opportunityCoverageMatrix.insightSentence || payload.summary,
      2,
    ),
    proof_3_label: '',
    proof_3_value: safeScore(visuals?.searchVisibilityFunnel.estimated_lost_clicks != null ? 100 - Math.min(100, visuals.searchVisibilityFunnel.estimated_lost_clicks) : null),
    proof_3_text: safeText(
      decisionSummary || payload.summary,
      2,
    ),
    workflow_1_title: '',
    workflow_1_text: safeText(
      payload.diagnosis,
      2,
    ),
    workflow_2_title: '',
    workflow_2_text: safeText(
      opportunitySummary || payload.summary,
      2,
    ),
    workflow_3_title: '',
    workflow_3_text: safeText(
      brandProfile?.ctaText || payload.summary,
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
    opportunity_1_text: safeText(action1.text, 2),
    opportunity_1_tag: safeText('PLAN NEXT', 1),
    opportunity_2_title: safeText(action2.title || 'Improvement opportunity two', 1),
    opportunity_2_text: safeText(action2.text, 2),
    opportunity_2_tag: safeText('ACT NOW', 1),
    opportunity_3_title: safeText(action3.title || 'Improvement opportunity three', 1),
    opportunity_3_text: safeText(action3.text, 2),
    opportunity_3_tag: safeText('PLAN NEXT', 1),
    next_step_1_title: safeText(next1?.action || action1.title, 1),
    next_step_1_text: safeText(next1?.reasoning || next1?.description || action1.text, 2),
    next_step_1_focus_page: safeText(next1?.focusPage || action1.focusPage, 1),
    next_step_1_tactics: Array.isArray(next1?.tactics) ? next1.tactics.map((item) => safeText(item, 1)).filter(Boolean).slice(0, 3).join('\n') : action1.tactics.join('\n'),
    next_step_1_timeline_short: safeText(next1?.timeline?.short || action1.timeline.short, 1),
    next_step_1_timeline_mid: safeText(next1?.timeline?.mid || action1.timeline.mid, 1),
    next_step_1_timeline_long: safeText(next1?.timeline?.long || action1.timeline.long, 1),
    next_step_1_highlight: safeText(next1?.expectedOutcome, 1),
    next_step_1_priority: safeText(next1?.priority || '', 1).toUpperCase(),
    next_step_1_impact: safeText(next1?.impact || '', 1).toUpperCase(),
    next_step_1_effort: safeText(next1?.effort || next1?.effortLevel || '', 1).toUpperCase(),
    next_step_1_outcome: safeText(next1?.expectedUpside || '', 1),
    next_step_2_title: safeText(next2?.action || action2.title, 1),
    next_step_2_text: safeText(next2?.reasoning || next2?.description || action2.text, 2),
    next_step_2_focus_page: safeText(next2?.focusPage || action2.focusPage, 1),
    next_step_2_tactics: Array.isArray(next2?.tactics) ? next2.tactics.map((item) => safeText(item, 1)).filter(Boolean).slice(0, 3).join('\n') : action2.tactics.join('\n'),
    next_step_2_timeline_short: safeText(next2?.timeline?.short || action2.timeline.short, 1),
    next_step_2_timeline_mid: safeText(next2?.timeline?.mid || action2.timeline.mid, 1),
    next_step_2_timeline_long: safeText(next2?.timeline?.long || action2.timeline.long, 1),
    next_step_2_highlight: safeText(next2?.expectedOutcome || '', 1),
    next_step_2_priority: safeText(next2?.priority || '', 1).toUpperCase(),
    next_step_2_impact: safeText(next2?.impact || '', 1).toUpperCase(),
    next_step_2_effort: safeText(next2?.effort || next2?.effortLevel || '', 1).toUpperCase(),
    next_step_2_outcome: safeText(next2?.expectedUpside || '', 1),
    cta_title: '',
    cta_text: safeText(payload.decisionSnapshot?.ifExecutedWell, 2),
    cta_label: '',
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




