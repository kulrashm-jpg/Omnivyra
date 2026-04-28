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
        <div class="perf-list-meta">Source: ${escapeHtml(item.source)} &middot; Expected outcome: ${escapeHtml(item.impact)}</div>
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

export const performanceRendererMap: Record<PerformanceSectionKey, (data: PerformanceReportMappedData) => string> = {
  key_decisions: renderLeadCommandCenter,
  funnel: renderLeadLeakage,
  conversions: renderConversionsSection,
  top_pages: renderTopPagesSection,
  drop_offs: renderDropOffsSection,
  traffic_sources: renderLeadSources,
};

function renderHeader(meta?: PerformanceRenderMeta): string {
  const companyName = meta?.companyName?.trim() || 'Omnivyra Company';
  const dateRangeLabel = meta?.dateRangeLabel?.trim() || 'Most recent analytics window';

  return `
    <header class="perf-header">
      <div class="perf-header-top">
        <div>
          <div class="perf-kicker">Lead &amp; Growth Intelligence Report</div>
          <h1 class="perf-title">Lead &amp; Growth Intelligence Report</h1>
          <p class="perf-tagline">Focused on qualified lead generation and growth decisions</p>
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
      <title>Lead &amp; Growth Intelligence Report</title>
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
    body { margin: 0; font-family: Arial, sans-serif; background: #f4f6f8; color: #1f2933; line-height: 1.6; }
    .perf-report { width: 1024px; margin: 0 auto; background: #ffffff; padding: 40px; box-sizing: border-box; overflow-wrap: anywhere; }
    .perf-header { margin-bottom: 36px; border-bottom: 2px solid #d9e2ec; padding-bottom: 22px; }
    .perf-header-top { display: table; width: 100%; table-layout: fixed; }
    .perf-header-top > div { display: table-cell; vertical-align: top; }
    .perf-header-meta { width: 280px; text-align: right; }
    .perf-meta-block { margin-bottom: 14px; }
    .perf-meta-value { font-size: 15px; font-weight: 700; color: #102a43; }
    .perf-kicker { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #486581; margin-bottom: 6px; }
    .perf-title { margin: 0 0 10px; font-size: 34px; line-height: 1.15; color: #102a43; }
    .perf-section-title { margin: 0 0 14px; font-size: 24px; line-height: 1.25; color: #102a43; }
    .perf-subtitle { margin: 0 0 12px; font-size: 16px; line-height: 1.35; color: #243b53; }
    .perf-tagline { margin: 0; color: #52606d; font-size: 15px; max-width: 560px; }
    .perf-muted { color: #6b7c93; font-size: 12px; }
    .perf-section { margin: 0 0 40px; padding-bottom: 6px; page-break-inside: avoid; }
    .perf-section-header { margin-bottom: 18px; }
    .perf-decision-highlight { margin: 10px 0 12px; padding: 14px 16px; border-left: 4px solid #0f609b; background: #f3f8fc; font-size: 17px; font-weight: 700; color: #102a43; }
    .perf-why-box { margin: 0 0 14px; padding: 12px 14px; background: #f8fbfd; border: 1px solid #d9e2ec; color: #52606d; font-size: 13px; font-style: italic; }
    .perf-card { border: 1px solid #d9e2ec; background: #ffffff; padding: 18px; margin-bottom: 14px; border-radius: 6px; }
    .perf-card-highlight { background: #f0f4f8; }
    .perf-label { font-size: 12px; text-transform: uppercase; color: #486581; margin-bottom: 6px; }
    .perf-value { font-size: 28px; font-weight: 700; line-height: 1.15; word-break: break-word; }
    .perf-value-sm { font-size: 18px; }
    .perf-card-note { margin: 8px 0 0; color: #52606d; font-size: 13px; line-height: 1.5; }
    .perf-metric-grid { display: grid; gap: 14px; margin-bottom: 14px; }
    .perf-metric-grid-4 { grid-template-columns: repeat(4, 1fr); }
    .perf-metric-grid-3, .perf-three-col { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    .perf-two-col { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
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
  </style>
`;
