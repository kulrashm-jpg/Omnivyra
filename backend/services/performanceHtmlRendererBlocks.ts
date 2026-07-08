/** Part 1/2 of performanceHtmlRenderer.ts — verbatim split (barrel preserved; importers unchanged). */
import type { PerformanceSectionKey } from './performanceReportSections';
import type { PerformanceReportMappedData } from './performanceReportMapper';
import type { BehaviorRecommendation } from './behaviorRecommendationService';

import { renderPerformanceDocument } from './performanceHtmlRendererPage';

export interface PerformanceRenderMeta {
  companyName?: string | null;
  dateRangeLabel?: string | null;
  warning?: string | null;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatPercent(value: number | null | undefined): string {
  return typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : '--';
}

function formatCount(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString('en-US');
}

function formatSignedPercent(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
  const pct = value * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

export function renderEmptyState(message: string): string {
  return `<div class="perf-empty">${escapeHtml(message)}</div>`;
}

function renderSectionCta(
  primary?: { label: string; href: string } | null,
  secondary?: { label: string; href: string } | null,
): string {
  if (!primary && !secondary) return '';
  return `
    <div class="perf-cta-row">
      ${primary ? `<a class="perf-cta perf-cta-primary" href="${escapeHtml(primary.href)}">${escapeHtml(primary.label)}</a>` : ''}
      ${secondary ? `<a class="perf-cta perf-cta-secondary" href="${escapeHtml(secondary.href)}">${escapeHtml(secondary.label)}</a>` : ''}
    </div>
  `;
}

export function renderSectionHeader(title: string, heading: string, decision: string, whyThisMatters: string): string {
  return `
    <div class="perf-section-header">
      <div class="perf-kicker">${escapeHtml(title)}</div>
      <h2 class="perf-section-title">${escapeHtml(heading)}</h2>
      <div class="perf-decision-highlight">${escapeHtml(decision)}</div>
      <div class="perf-why-box"><strong>Why this matters:</strong> ${escapeHtml(whyThisMatters)}</div>
    </div>
  `;
}

export function renderRecommendationList(items: BehaviorRecommendation[]): string {
  if (items.length === 0) {
    return renderEmptyState('No recommendations available yet.');
  }

  return `<div class="perf-stack">${items.map((item) => `
    <article class="perf-card perf-card-priority-${escapeHtml(item.priority)}">
      <div class="perf-card-header">
        <div class="perf-list-title">${escapeHtml(item.message)}</div>
        <div class="perf-badge-group">
          ${renderPriorityBadge(item.priority)}
          <span class="perf-badge perf-badge-impact">${escapeHtml(item.impact_estimate)}</span>
          <span class="perf-badge perf-badge-effort-${escapeHtml(item.effort_level)}">${escapeHtml(item.effort_level.toUpperCase())} EFFORT</span>
        </div>
      </div>
      <div class="perf-card-note">${escapeHtml(item.reasoning)}</div>
    </article>
  `).join('')}</div>`;
}

export function renderTextList(items: string[], empty: string): string {
  if (items.length === 0) return renderEmptyState(empty);
  return `<ul class="perf-list">${items.map((item) => `<li class="perf-list-item">${escapeHtml(item)}</li>`).join('')}</ul>`;
}

export function renderMetricNote(label: string, value: string, note: string): string {
  return `
    <article class="perf-card">
      <div class="perf-label">${escapeHtml(label)}</div>
      <div class="perf-value">${escapeHtml(value)}</div>
      <p class="perf-card-note">${escapeHtml(note)}</p>
    </article>
  `;
}

export function renderPriorityBadge(priority: string): string {
  return `<span class="perf-badge perf-badge-priority-${escapeHtml(priority)}">${escapeHtml(priority.toUpperCase())}</span>`;
}

export function confidenceCopy(value: string): string {
  if (value === 'high') return 'Observed';
  if (value === 'medium') return 'Likely';
  if (value === 'low') return 'Directional';
  return 'Insufficient';
}

export function renderLeadCommandCenter(data: PerformanceReportMappedData): string {
  const keyDecisions = data.focus_this_week.slice(0, 5);
  const trafficIssue = data.content.high_traffic_low_conversion_pages[0] ?? data.leakage.top_drop_off_pages[0];
  const decisionSummary = keyDecisions.length > 0
    ? keyDecisions.map((item) => `
      <article class="perf-card perf-card-focus">
        <div class="perf-card-header">
          <div class="perf-list-title">${escapeHtml(item.action)}</div>
          <div class="perf-badge-group">
            <span class="perf-badge perf-badge-impact">${escapeHtml(item.impact)}</span>
            <span class="perf-badge perf-badge-effort-${escapeHtml(item.effort)}">${escapeHtml(item.effort.toUpperCase())} EFFORT</span>
          </div>
        </div>
        <div class="perf-list-meta">Source: ${escapeHtml(item.source)}</div>
      </article>
    `).join('')
    : '';

  return `
    <section class="perf-section" id="key-decisions">
      ${renderSectionHeader(
        'Key Decisions',
        'Key Decisions',
        data.lead_summary.decision_summary,
        data.lead_summary.why_this_matters,
      )}
      <div class="perf-metric-grid perf-metric-grid-4">
        ${renderMetricNote('Sessions', formatCount(data.sources.reduce((sum, item) => sum + item.sessions, 0)), 'Total measured sessions in this report window.')}
        ${renderMetricNote('Conversions', formatCount(data.lead_summary.total_leads), 'Total tracked conversions in this report window.')}
        ${renderMetricNote('Conversion Rate', formatPercent(data.lead_summary.conversion_rate), 'Share of sessions that turned into conversions.')}
        ${renderMetricNote('Largest Drop-Off', data.lead_summary.biggest_drop_off, 'Where the largest measured drop-off is happening now.')}
      </div>
      <article class="perf-card perf-card-highlight">
        <div class="perf-label">Current Situation</div>
        <p>${escapeHtml(data.lead_summary.diagnosis)}</p>
      </article>
      ${decisionSummary ? `<div class="perf-stack">${decisionSummary}</div>` : renderEmptyState('No key decisions available yet.')}
      ${trafficIssue ? renderSectionCta({
        label: 'Review website setup',
        href: '/integrations?focus=website',
      }) : ''}
    </section>
  `;
}

export function renderLeadLeakage(data: PerformanceReportMappedData): string {
  const funnel = data.leakage.funnel_steps.length
    ? `<div class="perf-funnel">${data.leakage.funnel_steps.map((step) => `
        <div class="perf-funnel-step">
          <div class="perf-label">${escapeHtml(step.step)}</div>
          <div class="perf-value">${escapeHtml(formatCount(step.users))}</div>
          <div class="perf-muted">Drop: ${escapeHtml(formatPercent(step.drop_pct))}</div>
        </div>
      `).join('<div class="perf-funnel-arrow">&rarr;</div>')}</div>`
    : renderEmptyState('No funnel data available.');

  return `
    <section class="perf-section page-break" id="funnel">
      ${renderSectionHeader(
        'Funnel',
        'Funnel',
        data.leakage.decision_summary,
        data.leakage.why_this_matters,
      )}
      ${funnel}
    </section>
  `;
}

export function renderConversionsSection(data: PerformanceReportMappedData): string {
  const bestSource = data.sources[0];
  const topPage = data.content.top_converting_pages[0];
  return `
    <section class="perf-section" id="conversions">
      ${renderSectionHeader(
        'Conversions',
        'Conversions',
        topPage
          ? `${topPage.page_url} is converting at ${formatPercent(topPage.conversion_rate)} from ${formatCount(topPage.visits)} sessions.`
          : data.lead_summary.diagnosis,
        'This section shows how much session volume is turning into measured conversions.',
      )}
      <div class="perf-metric-grid perf-metric-grid-3">
        ${renderMetricNote('Conversions', formatCount(data.lead_summary.total_leads), 'Total tracked conversions across the report window.')}
        ${renderMetricNote('Conversion Rate', formatPercent(data.lead_summary.conversion_rate), 'Tracked conversions divided by total sessions.')}
        ${renderMetricNote('Best Source', bestSource?.channel ?? 'No traffic sources available', 'The traffic source currently generating the strongest conversion output.')}
      </div>
    </section>
  `;
}

export function renderBehaviorQuality(data: PerformanceReportMappedData): string {
  const current = data.behavior_quality.current;
  const deltas = data.behavior_quality.deltas;
  const hasBehaviorSignal = Boolean(current) ||
    data.behavior_quality.device_insights.length > 0 ||
    data.behavior_quality.landing_page_insights.length > 0 ||
    data.behavior_quality.source_insights.length > 0;
  if (!hasBehaviorSignal && data.behavior_quality.engagement_confidence === 'none') return '';
  const deviceRows = data.behavior_quality.device_insights.length
    ? `<div class="perf-stack">${data.behavior_quality.device_insights.map((item) => `
      <article class="perf-card">
        <div class="perf-row">
          <div class="perf-list-title">${escapeHtml(item.key)}</div>
          <span class="perf-badge perf-badge-priority-${escapeHtml(item.severity)}">${escapeHtml(item.severity.toUpperCase())}</span>
        </div>
        <div class="perf-inline-metrics">
          <span>${escapeHtml(formatCount(item.sessions))} sessions</span>
          <span>${escapeHtml(formatPercent(item.engagement_rate))} engaged</span>
          <span>${escapeHtml(item.avg_engagement_seconds.toFixed(1))}s avg engagement</span>
          <span>${escapeHtml(confidenceCopy(item.confidence))}</span>
        </div>
        <p class="perf-card-note">${escapeHtml(item.diagnosis)}</p>
      </article>
    `).join('')}</div>`
    : renderEmptyState('No device-specific engagement issues are available yet.');

  const pageRows = data.behavior_quality.landing_page_insights.length
    ? `<div class="perf-stack">${data.behavior_quality.landing_page_insights.slice(0, 5).map((item) => `
      <article class="perf-card">
        <div class="perf-list-title">${escapeHtml(item.page_url)}</div>
        <div class="perf-inline-metrics">
          <span>${escapeHtml(formatCount(item.visits))} visits</span>
          <span>${escapeHtml(item.engagement_rate.toFixed(2))} events/visit</span>
          <span>${escapeHtml(formatPercent(item.conversion_rate))} conversion</span>
          <span>${escapeHtml(formatSignedPercent(item.conversion_delta_pct))} conversions</span>
          <span>${escapeHtml(confidenceCopy(item.confidence))}</span>
        </div>
        <p class="perf-card-note">${escapeHtml(item.diagnosis)}</p>
      </article>
    `).join('')}</div>`
    : renderEmptyState('No landing-page behavior weaknesses are available yet.');

  return `
    <section class="perf-section" id="behavior-quality">
      ${renderSectionHeader(
        'Behavior Quality',
        'Behavior Quality Intelligence',
        data.behavior_quality.decision_summary,
        data.behavior_quality.why_this_matters,
      )}
      <div class="perf-metric-grid perf-metric-grid-3">
        ${renderMetricNote('Engagement Confidence', confidenceCopy(data.behavior_quality.engagement_confidence), data.behavior_quality.engagement_summary)}
        ${renderMetricNote('Traffic Quality Confidence', confidenceCopy(data.behavior_quality.traffic_quality_confidence), data.behavior_quality.traffic_summary)}
        ${renderMetricNote('Conversion Confidence', confidenceCopy(data.behavior_quality.conversion_confidence), data.behavior_quality.conversion_summary)}
      </div>
      <div class="perf-metric-grid perf-metric-grid-4">
        ${renderMetricNote('Engaged Sessions', formatCount(current?.engaged_sessions ?? 0), 'GA engaged sessions in the current report window.')}
        ${renderMetricNote('Engagement Rate', formatPercent(current?.engagement_rate ?? 0), 'Share of sessions with meaningful engagement.')}
        ${renderMetricNote('Avg Engagement Time', `${(current?.avg_engagement_seconds ?? 0).toFixed(1)}s`, 'Average engagement time per measured session.')}
        ${renderMetricNote('Conversion Trend', formatSignedPercent(deltas?.conversion_rate_pct ?? 0), 'Current conversion-rate change against the prior period.')}
      </div>
      <div class="perf-two-col">
        <article class="perf-card"><h3 class="perf-subtitle">Device Engagement</h3>${deviceRows}</article>
        <article class="perf-card"><h3 class="perf-subtitle">Landing Page Efficiency</h3>${pageRows}</article>
      </div>
    </section>
  `;
}

export function renderTopPagesSection(data: PerformanceReportMappedData): string {
  const topConverting = data.content.top_converting_pages.length
    ? `<div class="perf-stack">${data.content.top_converting_pages.map((item) => `
        <article class="perf-card">
          <div class="perf-list-title">${escapeHtml(item.page_url)}</div>
          <div class="perf-inline-metrics">
            <span>${escapeHtml(formatCount(item.visits))} sessions</span>
            <span>${escapeHtml(formatCount(item.conversions))} conversions</span>
            <span>${escapeHtml(formatPercent(item.conversion_rate))} conversion rate</span>
          </div>
          <p class="perf-card-note">This page is already turning session volume into conversions.</p>
        </article>
      `).join('')}</div>`
    : renderEmptyState('No top pages available.');

  const weakPages = data.content.high_traffic_low_conversion_pages.length
    ? `<div class="perf-stack">${data.content.high_traffic_low_conversion_pages.map((item) => `
        <article class="perf-card">
          <div class="perf-list-title">${escapeHtml(item.page_url)}</div>
          <div class="perf-inline-metrics">
            <span>${escapeHtml(formatCount(item.visits))} sessions</span>
            <span>${escapeHtml(formatCount(item.conversions))} conversions</span>
            <span>${escapeHtml(formatPercent(item.conversion_rate))} conversion rate</span>
          </div>
          <p class="perf-card-note">This page has session volume but is not converting enough of it yet.</p>
        </article>
      `).join('')}</div>`
    : renderEmptyState('No top-page conversion gaps available.');

  return `
    <section class="perf-section" id="top-pages">
      ${renderSectionHeader(
        'Top Pages',
        'Top Pages',
        data.content.decision_summary,
        data.content.why_this_matters,
      )}
      <div class="perf-two-col">
        <article class="perf-card"><h3 class="perf-subtitle">Highest Converting Pages</h3>${topConverting}</article>
        <article class="perf-card"><h3 class="perf-subtitle">High Session, Low Conversion Pages</h3>${weakPages}</article>
      </div>
    </section>
  `;
}

export function renderOrganicSearchIntelligence(data: PerformanceReportMappedData): string {
  const hasSearchSignal =
    data.organic_search.opportunities.length > 0 ||
    data.organic_search.keyword_opportunities.length > 0 ||
    data.organic_search.joined_pages.some((item) => item.impressions > 0 || item.clicks > 0) ||
    data.organic_search.opportunity_themes.length > 0;
  if (!hasSearchSignal && data.organic_search.data_confidence === 'none') return '';

  const themes = data.organic_search.opportunity_themes.length
    ? `<div class="perf-theme-grid">${data.organic_search.opportunity_themes.map((theme) => `
      <article class="perf-theme-card perf-card-priority-${escapeHtml(theme.severity)}">
        <div class="perf-card-header">
          <div class="perf-list-title">${escapeHtml(theme.theme)}</div>
          <div class="perf-badge-group">
            <span class="perf-badge perf-badge-priority-${escapeHtml(theme.severity)}">${escapeHtml(theme.severity.toUpperCase())}</span>
            <span class="perf-badge perf-badge-impact">${escapeHtml(confidenceCopy(theme.confidence))}</span>
          </div>
        </div>
        <p class="perf-card-note">${escapeHtml(theme.summary)}</p>
        <div class="perf-list-meta">${escapeHtml(theme.evidence_summary)}</div>
        ${theme.pages.length ? `<div class="perf-inline-metrics">${theme.pages.map((page) => `<span>${escapeHtml(page)}</span>`).join('')}</div>` : ''}
      </article>
    `).join('')}</div>`
    : '';

  const opportunities = data.organic_search.opportunities.length
    ? `<div class="perf-stack">${data.organic_search.opportunities.map((item) => `
        <article class="perf-card perf-card-priority-${escapeHtml(item.severity)}">
          <div class="perf-card-header">
            <div class="perf-list-title">${escapeHtml(item.title)}</div>
            <div class="perf-badge-group">
              <span class="perf-badge perf-badge-priority-${escapeHtml(item.severity)}">${escapeHtml(item.severity.toUpperCase())}</span>
              <span class="perf-badge perf-badge-impact">${escapeHtml(item.confidence_label.toUpperCase())}</span>
              <span class="perf-badge perf-badge-impact">${escapeHtml(confidenceCopy(item.confidence))}</span>
            </div>
          </div>
          <div class="perf-inline-metrics">
            ${typeof item.evidence.impressions === 'number' ? `<span>${escapeHtml(formatCount(item.evidence.impressions))} impressions</span>` : ''}
            ${typeof item.evidence.clicks === 'number' ? `<span>${escapeHtml(formatCount(item.evidence.clicks))} clicks</span>` : ''}
            ${typeof item.evidence.ctr === 'number' ? `<span>${escapeHtml(formatPercent(item.evidence.ctr))} CTR</span>` : ''}
            ${typeof item.evidence.avg_position === 'number' ? `<span>${escapeHtml(item.evidence.avg_position.toFixed(1))} avg position</span>` : ''}
            ${typeof item.evidence.sessions === 'number' ? `<span>${escapeHtml(formatCount(item.evidence.sessions))} sessions</span>` : ''}
            ${typeof item.evidence.conversion_rate === 'number' ? `<span>${escapeHtml(formatPercent(item.evidence.conversion_rate))} conversion</span>` : ''}
          </div>
          <p class="perf-card-note">${escapeHtml(item.recommendation)}</p>
        </article>
      `).join('')}</div>`
    : renderEmptyState('No organic search opportunities are confident enough yet.');

  const joinedPages = data.organic_search.joined_pages.length
    ? `<div class="perf-stack">${data.organic_search.joined_pages.slice(0, 5).map((item) => `
        <article class="perf-card">
          <div class="perf-list-title">${escapeHtml(item.page_url)}</div>
          <div class="perf-inline-metrics">
            <span>${escapeHtml(formatCount(item.impressions))} impressions</span>
            <span>${escapeHtml(formatCount(item.clicks))} clicks</span>
            <span>${escapeHtml(formatPercent(item.ctr))} CTR</span>
            <span>${escapeHtml(formatCount(item.sessions))} sessions</span>
            <span>${escapeHtml(formatPercent(item.conversion_rate))} conversion</span>
            <span>${escapeHtml(formatSignedPercent(item.click_delta_pct))} clicks</span>
          </div>
        </article>
      `).join('')}</div>`
    : renderEmptyState('No joined GA/Search Console landing-page rows are available yet.');

  const keywordRows = data.organic_search.keyword_opportunities.length
    ? `<div class="perf-stack">${data.organic_search.keyword_opportunities.slice(0, 5).map((item) => `
        <article class="perf-card">
          <div class="perf-row">
            <div>
              <div class="perf-list-title">${escapeHtml(item.keyword)}</div>
              <div class="perf-list-meta">${escapeHtml(item.page_url || 'No landing page mapped')}</div>
            </div>
            <span class="perf-badge perf-badge-impact">${escapeHtml(item.opportunity_type.toUpperCase())}</span>
          </div>
          <div class="perf-inline-metrics">
            <span>${escapeHtml(formatCount(item.impressions))} impressions</span>
            <span>${escapeHtml(formatCount(item.clicks))} clicks</span>
            <span>${escapeHtml(formatPercent(item.ctr))} CTR</span>
            <span>${escapeHtml(item.avg_position.toFixed(1))} avg position</span>
          </div>
        </article>
      `).join('')}</div>`
    : renderEmptyState('No keyword-level opportunities are available yet.');

  return `
    <section class="perf-section page-break" id="organic-search">
      ${renderSectionHeader(
        'Organic Search',
        'Organic Search Intelligence',
        data.organic_search.decision_summary,
        data.organic_search.why_this_matters,
      )}
      <div class="perf-metric-grid perf-metric-grid-3">
        ${renderMetricNote('Data Confidence', confidenceCopy(data.organic_search.data_confidence), data.organic_search.organic_visibility_summary)}
        ${renderMetricNote('Insight Confidence', confidenceCopy(data.organic_search.insight_confidence), data.organic_search.demand_quality_summary)}
        ${renderMetricNote('Recommendation Confidence', confidenceCopy(data.organic_search.recommendation_confidence), data.organic_search.landing_page_weakness_summary)}
      </div>
      ${themes}
      <div class="perf-two-col">
        <article class="perf-card"><h3 class="perf-subtitle">Search Opportunities</h3>${opportunities}</article>
        <article class="perf-card"><h3 class="perf-subtitle">Joined Landing Pages</h3>${joinedPages}</article>
      </div>
      <article class="perf-card"><h3 class="perf-subtitle">Keyword Opportunities</h3>${keywordRows}</article>
    </section>
  `;
}

export function renderDropOffsSection(data: PerformanceReportMappedData): string {
  const dropOffRows = data.leakage.top_drop_off_pages.length
    ? `<div class="perf-stack">${data.leakage.top_drop_off_pages.map((item) => `
        <article class="perf-card">
          <div class="perf-list-title">${escapeHtml(item.page_url)}</div>
          <div class="perf-list-meta">Drop-off ${escapeHtml(formatPercent(item.drop_off_rate))} &middot; ${escapeHtml(formatCount(item.exit_sessions))} of ${escapeHtml(formatCount(item.entry_sessions))} sessions end here.</div>
          <p class="perf-card-note">Users are leaving this page before enough of them progress to the next step.</p>
        </article>
      `).join('')}</div>`
    : renderEmptyState('No drop-off pages available.');

  const topDrop = data.leakage.top_drop_off_pages[0];

  return `
    <section class="perf-section" id="drop-offs">
      ${renderSectionHeader(
        'Drop-Offs',
        'Drop-Offs',
        topDrop
          ? `${topDrop.page_url} is losing ${formatPercent(topDrop.drop_off_rate)} of entering sessions.`
          : 'No major drop-off pages are available yet.',
        'This section highlights where session flow breaks before conversions happen.',
      )}
      ${dropOffRows}
      ${topDrop ? renderSectionCta({ label: 'Review website setup', href: '/integrations?focus=website' }) : ''}
    </section>
  `;
}

export function renderLeadSources(data: PerformanceReportMappedData): string {
  const content = data.sources.length
    ? `<div class="perf-stack">${data.sources.map((item) => `
        <article class="perf-card">
          <div class="perf-row">
            <div class="perf-list-title">${escapeHtml(item.channel)}</div>
            <div class="perf-inline-metrics">
              <span>${escapeHtml(formatCount(item.sessions))} sessions</span>
              <span>${escapeHtml(formatCount(item.leads))} conversions</span>
              <span>${escapeHtml(formatPercent(item.conversion_rate))} conversion rate</span>
            </div>
          </div>
          <p class="perf-card-note">${escapeHtml(
            item.leads === 0
              ? 'This traffic source is sending sessions without producing conversions yet.'
              : item.conversion_rate >= 0.05
                ? 'This traffic source is converting efficiently and is a strong candidate for more session volume.'
                : 'This traffic source is active, but the current session-to-conversion yield is still weak.',
          )}</p>
        </article>
      `).join('')}</div>`
    : renderEmptyState('No traffic source data available.');

  const topSource = data.sources[0];
  const decision = topSource
    ? `${topSource.channel} is the strongest current traffic source, with ${formatPercent(topSource.conversion_rate)} conversion rate from ${formatCount(topSource.sessions)} sessions.`
    : 'Traffic-source performance cannot be ranked yet because session and conversion signal is still limited.';

  return `
    <section class="perf-section" id="traffic-sources">
      ${renderSectionHeader(
        'Traffic Sources',
        'Traffic Sources',
        decision,
        'This section compares session volume, conversions, and conversion rate across traffic sources.',
      )}
      ${content}
    </section>
  `;
}

export function renderPerformanceStateDocument({
  status,
  message,
}: {
  status: 'no_data' | 'low_data';
  message: string;
}): string {
  const cta = status === 'no_data'
    ? renderSectionCta({ label: 'Connect Google Analytics', href: '/integrations?focus=data' })
    : '';

  return renderPerformanceDocument(`
    <section class="perf-section" id="report-state">
      <div class="perf-section-header">
        <div class="perf-kicker">Performance Report</div>
        <h2 class="perf-section-title">${status === 'no_data' ? 'No analytics data available' : 'Not enough data yet'}</h2>
        <div class="perf-decision-highlight">${escapeHtml(message)}</div>
        <div class="perf-why-box"><strong>What this means:</strong> ${status === 'no_data'
          ? 'Google Analytics has not been connected or no canonical analytics data is available yet.'
          : 'Analytics data is starting to arrive, but there is not enough recent volume for a reliable report.'}</div>
      </div>
      ${cta}
    </section>
  `);
}

export function renderPlatformFit(data: PerformanceReportMappedData): string {
  const content = data.platform_fit.platforms.length
    ? `<div class="perf-stack">${data.platform_fit.platforms.map((item) => `
        <article class="perf-card">
          <div class="perf-row">
            <div>
              <div class="perf-list-title">${escapeHtml(item.platform)}</div>
              <div class="perf-list-meta">${escapeHtml(item.reason)}</div>
            </div>
            <span class="perf-badge perf-badge-${escapeHtml(item.decision)}">${escapeHtml(item.decision.toUpperCase())}</span>
          </div>
          <div class="perf-inline-metrics">
            <span>${escapeHtml(String(item.sessions))} sessions</span>
            <span>${escapeHtml(String(item.leads))} leads</span>
            <span>${escapeHtml(formatPercent(item.conversion_rate))} conversion</span>
            <span>${escapeHtml(item.engagement_rate.toFixed(2))} events/session</span>
          </div>
        </article>
      `).join('')}</div>`
    : renderEmptyState('No platform data available.');

  return `
    <section class="perf-section page-break" id="platform-fit">
      ${renderSectionHeader(
        'Platform Fit',
        'Platform Fit Intelligence',
        data.platform_fit.decision_summary,
        data.platform_fit.why_this_matters,
      )}
      ${content}
    </section>
  `;
}

export function renderContentIntelligence(data: PerformanceReportMappedData): string {
  const topConverting = data.content.top_converting_pages.length
    ? `<div class="perf-stack">${data.content.top_converting_pages.map((item) => `
        <article class="perf-card">
          <div class="perf-list-title">${escapeHtml(item.page_url)}</div>
          <div class="perf-inline-metrics">
            <span>${escapeHtml(String(item.visits))} visits</span>
            <span>${escapeHtml(String(item.conversions))} conversions</span>
            <span>${escapeHtml(formatPercent(item.conversion_rate))} rate</span>
          </div>
          <p class="perf-card-note">This page already proves what message and offer combination can convert traffic into leads.</p>
        </article>
      `).join('')}</div>`
    : renderEmptyState('No top converting pages available.');

  const weakPages = data.content.high_traffic_low_conversion_pages.length
    ? `<div class="perf-stack">${data.content.high_traffic_low_conversion_pages.map((item) => `
        <article class="perf-card">
          <div class="perf-list-title">${escapeHtml(item.page_url)}</div>
          <div class="perf-inline-metrics">
            <span>${escapeHtml(String(item.visits))} visits</span>
            <span>${escapeHtml(String(item.conversions))} conversions</span>
            <span>${escapeHtml(formatPercent(item.conversion_rate))} rate</span>
          </div>
          <p class="perf-card-note">This page is attracting attention but is not converting enough of that demand into leads.</p>
        </article>
      `).join('')}</div>`
    : renderEmptyState('No high-traffic low-conversion pages available.');

  return `
    <section class="perf-section" id="content-intelligence">
      ${renderSectionHeader(
        'Content Intelligence',
        'Content Intelligence',
        data.content.decision_summary,
        data.content.why_this_matters,
      )}
      <div class="perf-two-col">
        <article class="perf-card"><h3 class="perf-subtitle">Top Converting Pages</h3>${topConverting}</article>
        <article class="perf-card"><h3 class="perf-subtitle">High Traffic, Low Conversion Pages</h3>${weakPages}</article>
      </div>
    </section>
  `;
}

