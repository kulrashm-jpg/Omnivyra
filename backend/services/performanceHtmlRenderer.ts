import type { PerformanceSectionKey } from './performanceReportSections';
import type { PerformanceReportMappedData } from './performanceReportMapper';
import type { BehaviorRecommendation } from './behaviorRecommendationService';

export interface PerformanceRenderMeta {
  companyName?: string | null;
  dateRangeLabel?: string | null;
  warning?: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPercent(value: number | null | undefined): string {
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

function renderEmptyState(message: string): string {
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

function renderSectionHeader(title: string, heading: string, decision: string, whyThisMatters: string): string {
  return `
    <div class="perf-section-header">
      <div class="perf-kicker">${escapeHtml(title)}</div>
      <h2 class="perf-section-title">${escapeHtml(heading)}</h2>
      <div class="perf-decision-highlight">${escapeHtml(decision)}</div>
      <div class="perf-why-box"><strong>Why this matters:</strong> ${escapeHtml(whyThisMatters)}</div>
    </div>
  `;
}

function renderRecommendationList(items: BehaviorRecommendation[]): string {
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

function renderTextList(items: string[], empty: string): string {
  if (items.length === 0) return renderEmptyState(empty);
  return `<ul class="perf-list">${items.map((item) => `<li class="perf-list-item">${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function renderMetricNote(label: string, value: string, note: string): string {
  return `
    <article class="perf-card">
      <div class="perf-label">${escapeHtml(label)}</div>
      <div class="perf-value">${escapeHtml(value)}</div>
      <p class="perf-card-note">${escapeHtml(note)}</p>
    </article>
  `;
}

function renderPriorityBadge(priority: string): string {
  return `<span class="perf-badge perf-badge-priority-${escapeHtml(priority)}">${escapeHtml(priority.toUpperCase())}</span>`;
}

function confidenceCopy(value: string): string {
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

export function renderConversionDiagnosis(data: PerformanceReportMappedData): string {
  return `
    <section class="perf-section" id="conversion-diagnosis">
      ${renderSectionHeader(
        'Conversion Diagnosis',
        'Conversion Diagnosis',
        data.diagnosis.decision_summary,
        data.diagnosis.why_this_matters,
      )}
      <div class="perf-three-col">
        <article class="perf-card"><h3 class="perf-subtitle">Friction Points</h3>${renderTextList(data.diagnosis.friction_points, 'No major friction points detected.')}</article>
        <article class="perf-card"><h3 class="perf-subtitle">Messaging Issues</h3>${renderTextList(data.diagnosis.messaging_issues, 'No messaging issues detected.')}</article>
        <article class="perf-card"><h3 class="perf-subtitle">CTA Gaps</h3>${renderTextList(data.diagnosis.cta_gaps, 'No CTA gaps detected.')}</article>
      </div>
    </section>
  `;
}

export function renderActionPlan(data: PerformanceReportMappedData): string {
  const hasActions =
    data.actions.quick_wins.length > 0 ||
    data.actions.growth_levers.length > 0 ||
    data.actions.strategic_bets.length > 0;
  if (!hasActions) return '';
  return `
    <section class="perf-section page-break" id="action-plan">
      ${renderSectionHeader(
        'Action Plan',
        'Action Plan',
        data.actions.decision_summary,
        data.actions.why_this_matters,
      )}
      <div class="perf-three-col">
        <article class="perf-card"><h3 class="perf-subtitle">Quick Wins</h3>${renderRecommendationList(data.actions.quick_wins)}</article>
        <article class="perf-card"><h3 class="perf-subtitle">Growth Levers</h3>${renderRecommendationList(data.actions.growth_levers)}</article>
        <article class="perf-card"><h3 class="perf-subtitle">Strategic Bets</h3>${renderRecommendationList(data.actions.strategic_bets)}</article>
      </div>
    </section>
  `;
}

export function renderCampaignIntelligence(data: PerformanceReportMappedData): string {
  const content = data.campaigns.items.length
    ? `<div class="perf-stack">${data.campaigns.items.map((item) => `
      <article class="perf-card">
        <div class="perf-row">
          <div>
            <div class="perf-list-title">${escapeHtml(item.name)}</div>
            <div class="perf-list-meta">${escapeHtml(item.reason)}</div>
          </div>
          <span class="perf-badge">${escapeHtml(item.classification.split('_').join(' ').toUpperCase())}</span>
        </div>
        <div class="perf-inline-metrics">
          <span>Status: ${escapeHtml(item.status)}</span>
          <span>Updated: ${escapeHtml(item.updated_at ?? '--')}</span>
        </div>
      </article>
    `).join('')}</div>`
    : renderEmptyState('Campaign data is not connected yet.');

  return `
    <section class="perf-section page-break" id="campaign-intelligence">
      ${renderSectionHeader(
        'Campaign Intelligence',
        'Campaign Intelligence',
        data.campaigns.decision_summary,
        data.campaigns.why_this_matters,
      )}
        <article class="perf-card perf-card-highlight">
        <div class="perf-label">Campaign Summary</div>
        <p>${escapeHtml(data.campaigns.effectiveness_summary)}</p>
      </article>
      ${content}
    </section>
  `;
}

export function renderEngagementIntelligence(data: PerformanceReportMappedData): string {
  return `
    <section class="perf-section" id="engagement-intelligence">
      ${renderSectionHeader(
        'Engagement Intelligence',
        'Engagement Intelligence',
        data.engagement.decision_summary,
        data.engagement.why_this_matters,
      )}
      <div class="perf-metric-grid perf-metric-grid-3">
        ${renderMetricNote('Operating Stage', data.engagement.stage, 'How consistently the team is turning insight into action.')}
        ${renderMetricNote('Insights Consumed', String(data.engagement.insights_consumed), 'Behavioral issues detected in the current window.')}
        ${renderMetricNote('Insights Acted', String(data.engagement.insights_acted), 'Actions recorded against those insights.')}
      </div>
      <article class="perf-card">
        <div class="perf-label">MarketPulse Usage</div>
        <p>${escapeHtml(data.engagement.marketpulse_usage)}</p>
      </article>
    </section>
  `;
}

export function renderLeadActivation(data: PerformanceReportMappedData): string {
  return `
    <section class="perf-section" id="lead-activation">
      ${renderSectionHeader(
        'Lead Activation',
        'Lead Activation',
        data.lead_activation.decision_summary,
        data.lead_activation.why_this_matters,
      )}
      <div class="perf-metric-grid perf-metric-grid-4">
        ${renderMetricNote('Leads Captured', String(data.lead_activation.leads_captured), 'Current volume of captured leads.')}
        ${renderMetricNote('Leads Acted Upon', String(data.lead_activation.leads_acted_upon), 'Recorded follow-up or implementation actions tied to lead response.')}
        ${renderMetricNote('Follow-Up Rate', formatPercent(data.lead_activation.follow_up_rate), 'Share of captured leads receiving a recorded response.')}
        ${renderMetricNote('Capture Gap', String(data.lead_activation.engagement_capture_gap), 'Captured leads not yet met with enough follow-up activity.')}
      </div>
    </section>
  `;
}

export function renderGrowthMaturity(data: PerformanceReportMappedData): string {
  return `
    <section class="perf-section" id="growth-maturity">
      ${renderSectionHeader(
        'Growth Maturity',
        'Growth Maturity',
        data.maturity.decision_summary,
        data.maturity.why_this_matters,
      )}
      <article class="perf-card perf-card-highlight">
        <div class="perf-label">Stage</div>
        <div class="perf-value perf-value-sm">${escapeHtml(data.maturity.stage)}</div>
      </article>
      <article class="perf-card">
        <h3 class="perf-subtitle">Readiness Signals</h3>
        ${renderTextList(data.maturity.readiness_signals, 'No readiness signals available yet.')}
      </article>
    </section>
  `;
}

export function renderNextBestMoves(data: PerformanceReportMappedData): string {
  const items = data.next_moves.slice(0, 5);
  if (items.length === 0) return '';
  const content = items.length
    ? `<div class="perf-stack">${items.map((item) => `
      <article class="perf-card">
        <div class="perf-card-header">
          <div class="perf-list-title">${escapeHtml(item.action)}</div>
          <div class="perf-badge-group">
            ${renderPriorityBadge(item.priority)}
            <span class="perf-badge perf-badge-effort-${escapeHtml(item.effort)}">${escapeHtml(item.effort.toUpperCase())} EFFORT</span>
          </div>
        </div>
        <p class="perf-card-note">${escapeHtml(item.why_it_matters)}</p>
        <div class="perf-inline-metrics">
          <span>${escapeHtml(confidenceCopy(item.confidence_tier === 'confirmed' ? 'high' : item.confidence_tier === 'directional' ? 'medium' : item.confidence_tier === 'hypothesis' ? 'low' : 'none'))}</span>
          <span>${escapeHtml(item.source)}</span>
          <span>${escapeHtml(item.impact)}</span>
        </div>
        <div class="perf-list-meta">${escapeHtml(item.trigger)}${item.page_url ? ` Page: ${escapeHtml(item.page_url)}` : ''}</div>
      </article>
    `).join('')}</div>`
    : renderEmptyState('No next moves available yet.');

  const decision = items.length > 0
    ? 'The next moves are clear and should stay tightly focused on the few actions most likely to improve lead generation.'
    : 'There is not enough validated performance signal yet to prioritize the next set of moves confidently.';

  return `
    <section class="perf-section" id="next-best-moves">
      ${renderSectionHeader(
        'Next Best Moves',
        'Next Best Moves',
        decision,
        'A short, sequenced move list keeps the team focused on actions that can shift lead performance fastest.',
      )}
      ${content}
    </section>
  `;
}

export function renderCompetitivePressureAnalysis(data: PerformanceReportMappedData): string {
  const analysis = data.competitive_pressure_analysis;
  if (!analysis || analysis.competitors.length === 0) {
    return `
      <section class="perf-section" id="competitive-pressure">
        ${renderSectionHeader(
          'Competitive Pressure',
          'Competitive Pressure Analysis',
          'Competitor pressure is not available for this report yet.',
          'This diagnostic connects competitor authority, product depth, and ICP overlap to practical pressure areas.',
        )}
        ${renderEmptyState('No final-gated competitor strategy data available yet.')}
      </section>
    `;
  }

  const rows = analysis.competitors.slice(0, 5).map((item) => `
    <article class="perf-card">
      <div class="perf-card-header">
        <div>
          <div class="perf-list-title">${escapeHtml(item.name)}</div>
          <div class="perf-list-meta">${escapeHtml(item.tier)} · ${escapeHtml(item.threat_level.toUpperCase())} threat · Authority ${escapeHtml(item.authority_score.toFixed(2))}</div>
        </div>
        <div class="perf-badge-group">
          ${item.pressure_on.map((area) => `<span class="perf-badge perf-badge-impact">${escapeHtml(area)}</span>`).join('')}
        </div>
      </div>
      <p class="perf-card-note">${escapeHtml(item.action)}</p>
    </article>
  `).join('');

  return `
    <section class="perf-section page-break" id="competitive-pressure">
      ${renderSectionHeader(
        'Competitive Pressure',
        'Competitive Pressure Analysis',
        analysis.summary.primary_risk,
        'This section turns competitor strength into diagnostic pressure areas so execution can target the right gap.',
      )}
      <article class="perf-card perf-card-highlight">
        <div class="perf-label">Next Action</div>
        <p>${escapeHtml(analysis.summary.next_action)}</p>
      </article>
      <div class="perf-stack">${rows}</div>
    </section>
  `;
}

// ─── Pre-drill calibration: "What matters most" + report quality renderers ──
// These are the two new top-of-report sections registered by Phase 1. When
// the mapper hasn't populated the optional fields (older runs), the renderers
// degrade to empty strings so the rest of the report continues to render.

const TIER_BADGE_CLASS: Record<string, string> = {
  confirmed:   'perf-tier-confirmed',
  directional: 'perf-tier-directional',
  hypothesis:  'perf-tier-hypothesis',
  weak_data:   'perf-tier-weak',
};

function renderTierBadge(tier: string | null | undefined, tierLabel?: string | null): string {
  if (!tier) return '';
  const cls = TIER_BADGE_CLASS[tier] ?? 'perf-tier-directional';
  const label = (tierLabel ?? tier).toUpperCase();
  return `<span class="perf-tier-badge ${cls}">${escapeHtml(label)}</span>`;
}

function renderWhatMattersMost(data: PerformanceReportMappedData): string {
  const wm = data.what_matters_most;
  if (!wm) return '';
  const renderItems = (
    items: NonNullable<PerformanceReportMappedData['what_matters_most']>['risks'],
    accent: 'risk' | 'opportunity' | 'next_step',
  ): string => {
    if (items.length === 0) {
      const label = accent === 'risk' ? 'No urgent risks identified.'
        : accent === 'opportunity' ? 'No standout opportunities surfaced this run.'
        : 'No converging next steps yet.';
      return renderEmptyState(label);
    }
    return items.map((item) => `
      <article class="perf-whatmatters-card perf-whatmatters-${accent}">
        <div class="perf-whatmatters-card-head">
          <div class="perf-whatmatters-title">${escapeHtml(item.title)}</div>
          ${renderTierBadge(item.confidence_tier)}
        </div>
        <p class="perf-whatmatters-rationale">${escapeHtml(item.rationale)}</p>
        <div class="perf-whatmatters-meta">
          <span class="perf-whatmatters-source">${escapeHtml(item.source)}</span>
          ${item.impact ? `<span class="perf-whatmatters-impact">${escapeHtml(item.impact)}</span>` : ''}
          ${item.anchor ? `<span class="perf-whatmatters-anchor">${escapeHtml(item.anchor)}</span>` : ''}
        </div>
      </article>
    `).join('');
  };

  return `
    <section class="perf-section perf-whatmatters-section">
      <div class="perf-section-header">
        <div class="perf-kicker">What matters most</div>
        <h2 class="perf-section-title">${escapeHtml(wm.headline)}</h2>
        <div class="perf-why-box"><strong>How to read this:</strong> Risks first, then opportunities, then the most actionable next step. Cards are colour-coded by calibrated confidence — confirmed, directional, or hypothesis.</div>
      </div>
      <div class="perf-whatmatters-grid">
        <div class="perf-whatmatters-column">
          <h3 class="perf-whatmatters-column-title">Biggest risks</h3>
          ${renderItems(wm.risks, 'risk')}
        </div>
        <div class="perf-whatmatters-column">
          <h3 class="perf-whatmatters-column-title">Biggest opportunities</h3>
          ${renderItems(wm.opportunities, 'opportunity')}
        </div>
        <div class="perf-whatmatters-column">
          <h3 class="perf-whatmatters-column-title">Most actionable next step</h3>
          ${renderItems(wm.next_steps, 'next_step')}
        </div>
      </div>
    </section>
  `;
}

function renderReportQuality(data: PerformanceReportMappedData): string {
  const breakdown = data.confidence_breakdown;
  const consolidation = data.consolidation;
  if (!breakdown && !consolidation) return '';
  const dist = breakdown?.distribution ?? { confirmed: 0, directional: 0, hypothesis: 0, weak_data: 0 };
  const total = dist.confirmed + dist.directional + dist.hypothesis + dist.weak_data;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  const dedupRatio = consolidation && consolidation.behavior_raw_count > 0
    ? Math.round((consolidation.behavior_consolidated_count / consolidation.behavior_raw_count) * 100)
    : null;

  return `
    <section class="perf-section perf-quality-section">
      <div class="perf-section-header">
        <div class="perf-kicker">Report calibration</div>
        <h2 class="perf-section-title">How much to trust this report</h2>
      </div>
      <div class="perf-quality-row">
        <div class="perf-quality-block">
          <div class="perf-label">Confidence distribution</div>
          <div class="perf-quality-stack">
            <span class="perf-tier-badge perf-tier-confirmed">${dist.confirmed} CONFIRMED · ${pct(dist.confirmed)}%</span>
            <span class="perf-tier-badge perf-tier-directional">${dist.directional} DIRECTIONAL · ${pct(dist.directional)}%</span>
            <span class="perf-tier-badge perf-tier-hypothesis">${dist.hypothesis} HYPOTHESIS · ${pct(dist.hypothesis)}%</span>
            <span class="perf-tier-badge perf-tier-weak">${dist.weak_data} WEAK · ${pct(dist.weak_data)}%</span>
          </div>
        </div>
        ${consolidation ? `
          <div class="perf-quality-block">
            <div class="perf-label">Consolidation</div>
            <div class="perf-meta-value">
              ${consolidation.behavior_consolidated_count} of ${consolidation.behavior_raw_count} behavior recommendations after dedup
              ${dedupRatio !== null ? ` <span class="perf-label">(${dedupRatio}% retained)</span>` : ''}
            </div>
            <div class="perf-meta-value">
              ${consolidation.search_consolidated_count} of ${consolidation.search_raw_count} search opportunities after dedup
            </div>
          </div>
        ` : ''}
      </div>
    </section>
  `;
}

function renderSnapshotFoundation(data: PerformanceReportMappedData): string {
  const foundation = data.snapshot_foundation;
  if (!foundation) {
    return `
      <section class="perf-section perf-foundation-section">
        ${renderSectionHeader(
          'Snapshot Foundation',
          'Digital Snapshot Foundation',
          'The Digital Snapshot baseline could not be attached to this run.',
          'Performance Intelligence should be read as Snapshot-plus: authority context first, behavior and search performance second.',
        )}
        ${renderEmptyState('Re-run the Digital Authority Snapshot or retry this report after snapshot composition is available.')}
      </section>
    `;
  }

  const pillars = foundation.pillar_scores.length
    ? foundation.pillar_scores.map((pillar) => `
      <article class="perf-foundation-pillar">
        <div class="perf-label">${escapeHtml(pillar.label)}</div>
        <div class="perf-foundation-score">${pillar.value == null ? '--' : escapeHtml(String(Math.round(pillar.value)))}</div>
        <div class="perf-list-meta">${escapeHtml(pillar.band)}${pillar.primary_signal ? ` · ${escapeHtml(pillar.primary_signal)}` : ''}</div>
      </article>
    `).join('')
    : renderEmptyState('Canonical pillar scores are not available yet.');

  const priorities = foundation.top_priorities.length
    ? foundation.top_priorities.map((priority) => `
      <article class="perf-foundation-priority">
        <div class="perf-list-title">${escapeHtml(priority.title)}</div>
        <p class="perf-card-note">${escapeHtml(priority.why_now)}</p>
        <div class="perf-list-meta">${escapeHtml(priority.impact)} · confidence ${escapeHtml(String(Math.round(priority.confidence)))}</div>
      </article>
    `).join('')
    : renderEmptyState('No Snapshot priorities are ready yet.');

  return `
    <section class="perf-section perf-foundation-section page-break">
      <div class="perf-foundation-hero">
        <div>
          <div class="perf-kicker">Snapshot Foundation</div>
          <h2 class="perf-foundation-title">Digital Authority Baseline</h2>
          <p class="perf-foundation-headline">${escapeHtml(foundation.headline)}</p>
        </div>
        <div class="perf-foundation-index">
          <div class="perf-label">Authority Index</div>
          <div class="perf-foundation-index-value">${foundation.authority_score == null ? '--' : escapeHtml(String(Math.round(foundation.authority_score)))}</div>
          <div class="perf-list-meta">${escapeHtml(foundation.authority_band)} · ${escapeHtml(foundation.maturity_label)}</div>
        </div>
      </div>
      <div class="perf-foundation-constraint">
        <div class="perf-label">Primary Constraint From Snapshot</div>
        <p>${escapeHtml(foundation.primary_constraint)}</p>
        ${foundation.positioning ? `<p class="perf-card-note"><strong>Positioning:</strong> ${escapeHtml(foundation.positioning)}</p>` : ''}
        ${foundation.market_position ? `<p class="perf-card-note"><strong>Market position:</strong> ${escapeHtml(foundation.market_position)}</p>` : ''}
      </div>
      <div class="perf-foundation-pillars">${pillars}</div>
      <div class="perf-two-col">
        <article class="perf-card perf-card-dark">
          <h3 class="perf-subtitle">Snapshot Priorities Carried Forward</h3>
          ${priorities}
        </article>
        <article class="perf-card">
          <h3 class="perf-subtitle">How Performance Intelligence Extends It</h3>
          <ul class="perf-list">
            <li class="perf-list-item">Connects authority constraints to GA engagement and conversion behavior.</li>
            <li class="perf-list-item">Adds GSC demand, keyword, page, CTR, and position intelligence when Search Console is ready.</li>
            <li class="perf-list-item">Ranks the next moves by confidence, severity, and measurable business impact.</li>
          </ul>
        </article>
      </div>
    </section>
  `;
}

export const performanceRendererMap: Record<PerformanceSectionKey, (data: PerformanceReportMappedData) => string> = {
  what_matters_most: renderWhatMattersMost,
  report_quality: renderReportQuality,
  snapshot_foundation: renderSnapshotFoundation,
  key_decisions: renderLeadCommandCenter,
  funnel: renderLeadLeakage,
  conversions: renderConversionsSection,
  behavior_quality: renderBehaviorQuality,
  organic_search: renderOrganicSearchIntelligence,
  top_pages: renderTopPagesSection,
  drop_offs: renderDropOffsSection,
  traffic_sources: renderLeadSources,
  competitive_pressure: renderCompetitivePressureAnalysis,
};

function renderHeader(meta?: PerformanceRenderMeta): string {
  const companyName = meta?.companyName?.trim() || 'Omnivyra Company';
  const dateRangeLabel = meta?.dateRangeLabel?.trim() || 'Most recent analytics window';

  return `
    <header class="perf-header">
      <div class="perf-header-top">
        <div>
          <div class="perf-kicker">Performance Intelligence</div>
          <h1 class="perf-title">Performance Intelligence Report</h1>
          <p class="perf-tagline">Digital Snapshot foundation plus GA/GSC behavior, search, conversion, and opportunity intelligence.</p>
        </div>
        <div class="perf-header-meta">
          <div class="perf-meta-block">
            <div class="perf-label">Company</div>
            <div class="perf-meta-value">${escapeHtml(companyName)}</div>
          </div>
          <div class="perf-meta-block">
            <div class="perf-label">Date Range</div>
            <div class="perf-meta-value">${escapeHtml(dateRangeLabel)}</div>
          </div>
        </div>
      </div>
    </header>
  `;
}

function renderWarning(meta?: PerformanceRenderMeta): string {
  if (!meta?.warning) return '';
  return `<div class="perf-warning">${escapeHtml(meta.warning)}</div>`;
}

export function renderPerformanceDocument(
  renderedSections: string,
  meta?: PerformanceRenderMeta,
): string {
  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <title>Performance Intelligence Report</title>
      ${performanceReportStyles}
    </head>
    <body>
      <main class="perf-report">
        ${renderHeader(meta)}
        ${renderWarning(meta)}
        ${renderedSections}
      </main>
    </body>
  </html>`;
}

export const performanceReportStyles = `
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #edf2f7; color: #172033; line-height: 1.6; }
    .perf-report { width: 1024px; margin: 0 auto; background: #ffffff; padding: 34px; box-sizing: border-box; overflow-wrap: anywhere; }
    .perf-header { margin-bottom: 34px; border-radius: 18px; padding: 34px; color: #ffffff; background: linear-gradient(135deg, #081426 0%, #123c69 48%, #0f766e 100%); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12); }
    .perf-header-top { display: table; width: 100%; table-layout: fixed; }
    .perf-header-top > div { display: table-cell; vertical-align: top; }
    .perf-header-meta { width: 280px; text-align: right; }
    .perf-meta-block { margin-bottom: 14px; }
    .perf-meta-value { font-size: 15px; font-weight: 700; color: inherit; }
    .perf-kicker { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #2dd4bf; margin-bottom: 6px; }
    .perf-title { margin: 0 0 10px; font-size: 38px; line-height: 1.12; color: inherit; }
    .perf-section-title { margin: 0 0 14px; font-size: 24px; line-height: 1.25; color: #102a43; }
    .perf-subtitle { margin: 0 0 12px; font-size: 16px; line-height: 1.35; color: #243b53; }
    .perf-tagline { margin: 0; color: #dbeafe; font-size: 15px; max-width: 620px; }
    .perf-muted { color: #6b7c93; font-size: 12px; }
    .perf-section { margin: 0 0 40px; padding-bottom: 6px; page-break-inside: avoid; }
    .perf-section-header { margin-bottom: 18px; }
    .perf-decision-highlight { margin: 10px 0 12px; padding: 14px 16px; border-left: 4px solid #0f609b; background: #f3f8fc; font-size: 17px; font-weight: 700; color: #102a43; }
    .perf-why-box { margin: 0 0 14px; padding: 12px 14px; background: #f8fbfd; border: 1px solid #d9e2ec; color: #52606d; font-size: 13px; font-style: italic; }
    .perf-card { border: 1px solid #d9e2ec; background: #ffffff; padding: 18px; margin-bottom: 14px; border-radius: 6px; }
    .perf-card-highlight { background: #f0f4f8; }
    .perf-card-dark { background: #0f172a; color: #e5eefb; border-color: #1e3a5f; }
    .perf-card-dark .perf-subtitle, .perf-card-dark .perf-list-title { color: #ffffff; }
    .perf-card-dark .perf-card-note, .perf-card-dark .perf-list-meta { color: #cbd5e1; }
    .perf-label { font-size: 12px; text-transform: uppercase; color: #486581; margin-bottom: 6px; }
    .perf-value { font-size: 28px; font-weight: 700; line-height: 1.15; word-break: break-word; }
    .perf-value-sm { font-size: 18px; }
    .perf-card-note { margin: 8px 0 0; color: #52606d; font-size: 13px; line-height: 1.5; }
    .perf-metric-grid { display: grid; gap: 14px; margin-bottom: 14px; }
    .perf-metric-grid-4 { grid-template-columns: repeat(4, 1fr); }
    .perf-metric-grid-3, .perf-three-col { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    .perf-two-col { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
    .perf-theme-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin: 0 0 16px; }
    .perf-theme-card { border: 1px solid #d9e2ec; background: #fbfdff; padding: 16px; border-radius: 6px; }
    .perf-funnel { display: grid; grid-template-columns: repeat(5, auto); gap: 12px; align-items: center; margin-bottom: 16px; }
    .perf-funnel-step { border: 1px solid #d9e2ec; padding: 14px; background: #f8fbfd; min-width: 140px; border-radius: 6px; }
    .perf-funnel-arrow { text-align: center; color: #829ab1; font-weight: 700; }
    .perf-list { margin: 0; padding-left: 18px; }
    .perf-list-item { margin-bottom: 10px; }
    .perf-list-title { font-weight: 700; margin-bottom: 4px; }
    .perf-list-meta { color: #52606d; font-size: 13px; line-height: 1.4; }
    .perf-empty { border: 1px dashed #bcccdc; color: #52606d; background: #f8fbfd; padding: 14px; border-radius: 6px; }
    .perf-stack { display: block; }
    .perf-row { display: table; width: 100%; table-layout: fixed; }
    .perf-row > div, .perf-row > span { display: table-cell; vertical-align: top; }
    .perf-card-header { display: table; width: 100%; table-layout: fixed; margin-bottom: 6px; }
    .perf-card-header > div { display: table-cell; vertical-align: top; }
    .perf-badge-group { text-align: right; white-space: nowrap; }
    .perf-badge-group .perf-badge { margin-left: 6px; margin-bottom: 4px; }
    .perf-inline-metrics { margin-top: 8px; color: #334e68; font-size: 13px; }
    .perf-inline-metrics span { display: inline-block; margin-right: 10px; margin-bottom: 4px; }
    .perf-badge { display: inline-block; border: 1px solid #bcccdc; border-radius: 999px; padding: 4px 10px; font-size: 11px; color: #334e68; background: #f8fbfd; white-space: nowrap; }
    .perf-badge-impact { border-color: #0f609b; color: #0f609b; background: #f3f8fc; }
    .perf-badge-scale { border-color: #0b6e4f; color: #0b6e4f; background: #eefcf7; }
    .perf-badge-fix { border-color: #b7791f; color: #b7791f; background: #fffaf0; }
    .perf-badge-reduce { border-color: #c53030; color: #c53030; background: #fff5f5; }
    .perf-badge-priority-high { border-color: #c53030; color: #c53030; background: #fff5f5; }
    .perf-badge-priority-medium { border-color: #b7791f; color: #b7791f; background: #fffaf0; }
    .perf-badge-priority-low { border-color: #0b6e4f; color: #0b6e4f; background: #eefcf7; }
    .perf-badge-effort-low { border-color: #0b6e4f; color: #0b6e4f; background: #eefcf7; }
    .perf-badge-effort-medium { border-color: #b7791f; color: #b7791f; background: #fffaf0; }
    .perf-badge-effort-high { border-color: #c53030; color: #c53030; background: #fff5f5; }
    .perf-card-priority-high { border-left: 4px solid #c53030; }
    .perf-card-priority-medium { border-left: 4px solid #b7791f; }
    .perf-card-priority-low { border-left: 4px solid #0b6e4f; }
    .perf-card-focus { background: #ffffff; }
    .perf-warning { margin: 0 0 24px; padding: 12px 14px; background: #fffaf0; border: 1px solid #f6ad55; color: #7b341e; border-radius: 6px; font-size: 13px; }
    .perf-cta-row { display: flex; gap: 10px; margin-top: 14px; }
    .perf-cta { display: inline-block; text-decoration: none; border-radius: 999px; padding: 8px 14px; font-size: 13px; font-weight: 700; }
    .perf-cta-primary { background: #0f609b; color: #ffffff; }
    .perf-cta-secondary { border: 1px solid #bcccdc; color: #334e68; background: #ffffff; }
    .page-break { page-break-before: always; }
    @page { margin: 18mm 14mm; }
    /* Pre-drill calibration: "What matters most" + tier-badge styles */
    .perf-whatmatters-section { background: #fcfdff; border: 1px solid #d9e2ec; border-radius: 8px; padding: 22px 24px; margin-bottom: 32px; }
    .perf-whatmatters-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
    .perf-whatmatters-column-title { font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; color: #486581; margin: 0 0 10px; }
    .perf-whatmatters-card { background: #ffffff; border: 1px solid #e0e8f0; border-radius: 6px; padding: 14px; margin-bottom: 10px; }
    .perf-whatmatters-risk { border-left: 4px solid #c53030; }
    .perf-whatmatters-opportunity { border-left: 4px solid #0b6e4f; }
    .perf-whatmatters-next_step { border-left: 4px solid #0f609b; }
    .perf-whatmatters-card-head { display: flex; justify-content: space-between; gap: 8px; align-items: flex-start; margin-bottom: 6px; }
    .perf-whatmatters-title { font-weight: 700; font-size: 14px; color: #102a43; line-height: 1.35; }
    .perf-whatmatters-rationale { margin: 6px 0 8px; color: #486581; font-size: 13px; line-height: 1.45; }
    .perf-whatmatters-meta { display: flex; flex-wrap: wrap; gap: 8px; font-size: 11px; color: #627d98; }
    .perf-whatmatters-source { background: #f8fbfd; border: 1px solid #d9e2ec; padding: 2px 8px; border-radius: 999px; }
    .perf-whatmatters-impact { background: #fffaf0; border: 1px solid #fbd38d; padding: 2px 8px; border-radius: 999px; color: #b7791f; }
    .perf-whatmatters-anchor { background: #f0f4f8; border: 1px solid #d9e2ec; padding: 2px 8px; border-radius: 999px; color: #486581; font-family: monospace; }
    .perf-quality-section { background: #f8fbfd; border: 1px solid #d9e2ec; border-radius: 8px; padding: 18px 22px; margin-bottom: 28px; }
    .perf-quality-row { display: grid; grid-template-columns: 2fr 1fr; gap: 18px; align-items: start; }
    .perf-quality-block { font-size: 13px; color: #334e68; }
    .perf-quality-stack { display: flex; flex-wrap: wrap; gap: 6px; }
    .perf-tier-badge { display: inline-block; border-radius: 999px; padding: 3px 10px; font-size: 10px; font-weight: 700; letter-spacing: 0.06em; }
    .perf-tier-confirmed { background: #dcfce7; color: #065f46; border: 1px solid #a7f3d0; }
    .perf-tier-directional { background: #dbeafe; color: #1e40af; border: 1px solid #bfdbfe; }
    .perf-tier-hypothesis { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
    .perf-tier-weak { background: #f3f4f6; color: #4b5563; border: 1px solid #d1d5db; }
    .perf-foundation-section { background: #f8fafc; border: 1px solid #d7e2ee; border-radius: 14px; padding: 26px; }
    .perf-foundation-hero { display: grid; grid-template-columns: 1fr 210px; gap: 22px; align-items: stretch; margin-bottom: 18px; }
    .perf-foundation-title { margin: 0 0 10px; color: #0f172a; font-size: 28px; line-height: 1.15; }
    .perf-foundation-headline { margin: 0; font-size: 16px; color: #334155; }
    .perf-foundation-index { background: #0f172a; color: #ffffff; border-radius: 12px; padding: 18px; text-align: center; }
    .perf-foundation-index .perf-label, .perf-foundation-index .perf-list-meta { color: #cbd5e1; }
    .perf-foundation-index-value { font-size: 54px; font-weight: 800; line-height: 1; color: #5eead4; }
    .perf-foundation-constraint { background: #ffffff; border-left: 5px solid #0f766e; padding: 16px 18px; margin-bottom: 16px; border-radius: 8px; }
    .perf-foundation-constraint p { margin: 0 0 8px; }
    .perf-foundation-pillars { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 16px; }
    .perf-foundation-pillar { background: #ffffff; border: 1px solid #d9e2ec; border-radius: 8px; padding: 12px; min-height: 108px; }
    .perf-foundation-score { color: #0f766e; font-size: 30px; font-weight: 800; line-height: 1; }
    .perf-foundation-priority { border-bottom: 1px solid rgba(255,255,255,0.16); padding: 0 0 10px; margin-bottom: 10px; }
  </style>
`;
