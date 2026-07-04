/**
 * Canonical Telemetry — Event Registry
 * ------------------------------------
 * ONE canonical definition of every telemetry event. Emitters validate against
 * it; the aggregator + providers read event types + policies from it. There are
 * no duplicated event definitions anywhere else. Records BUSINESS actions only —
 * never page views, button clicks, tab changes, hover, or scroll.
 */

import type {
  TelemetryCategory,
  TelemetryEventType,
  TelemetryEventDefinition,
  MetadataFieldType,
  AggregationPolicy,
  RetentionPolicy,
} from './telemetryTypes';

const LIFETIME: RetentionPolicy = { kind: 'lifetime' };
const DAYS = (days: number): RetentionPolicy => ({ kind: 'days', days });

function def(
  id: TelemetryEventType,
  category: TelemetryCategory,
  entity: string,
  aggregation: AggregationPolicy,
  retention: RetentionPolicy,
  metadataSchema: Record<string, MetadataFieldType>,
  description: string,
): TelemetryEventDefinition {
  return { id, category, entity, aggregation, retention, metadataSchema, description };
}

/** THE registry. Adding a telemetry event = one entry here (+ one emit at its chokepoint). */
export const TELEMETRY_EVENTS: Record<TelemetryEventType, TelemetryEventDefinition> = {
  // ── content ────────────────────────────────────────────────────────────────
  'content.created':        def('content.created', 'content', 'content', 'count', LIFETIME, { contentType: 'string', title: 'string' }, 'A content asset was created.'),
  'content.edited':         def('content.edited', 'content', 'content', 'count', DAYS(365), { contentType: 'string' }, 'A content asset was edited.'),
  'content.published':      def('content.published', 'content', 'content', 'cadence', LIFETIME, { contentType: 'string', channel: 'string' }, 'A content asset was published.'),
  'content.archived':       def('content.archived', 'content', 'content', 'count', LIFETIME, { contentType: 'string' }, 'A content asset was archived.'),
  'content.template_used':  def('content.template_used', 'content', 'template', 'count', DAYS(365), { templateId: 'string', assetType: 'string' }, 'A saved template was applied.'),
  'content.media_uploaded': def('content.media_uploaded', 'content', 'media', 'count', LIFETIME, { mediaType: 'string' }, 'A media asset was uploaded / produced.'),
  // ── campaign ─────────────────────────────────────────────────────────────────
  'campaign.created':       def('campaign.created', 'campaign', 'campaign', 'count', LIFETIME, { mode: 'string', platforms: 'string[]' }, 'A campaign was created.'),
  'campaign.launched':      def('campaign.launched', 'campaign', 'campaign', 'cadence', LIFETIME, { platforms: 'string[]' }, 'A campaign was launched.'),
  'campaign.paused':        def('campaign.paused', 'campaign', 'campaign', 'count', DAYS(365), {}, 'A campaign was paused.'),
  'campaign.resumed':       def('campaign.resumed', 'campaign', 'campaign', 'count', DAYS(365), {}, 'A campaign was resumed.'),
  'campaign.completed':     def('campaign.completed', 'campaign', 'campaign', 'count', LIFETIME, {}, 'A campaign reached completion.'),
  'campaign.archived':      def('campaign.archived', 'campaign', 'campaign', 'count', LIFETIME, {}, 'A campaign was archived.'),
  // ── ai ───────────────────────────────────────────────────────────────────────
  'ai.generated':           def('ai.generated', 'ai', 'ai_asset', 'count', DAYS(365), { creatorType: 'string', assetType: 'string' }, 'An asset was produced with AI.'),
  'ai.accepted':            def('ai.accepted', 'ai', 'ai_suggestion', 'rate', DAYS(365), { surface: 'string' }, 'An AI suggestion was accepted.'),
  'ai.rejected':            def('ai.rejected', 'ai', 'ai_suggestion', 'rate', DAYS(365), { surface: 'string' }, 'An AI suggestion was rejected.'),
  'ai.refined':             def('ai.refined', 'ai', 'content', 'count', DAYS(365), { surface: 'string' }, 'An AI draft was refined.'),
  'ai.regenerated':         def('ai.regenerated', 'ai', 'ai_asset', 'count', DAYS(365), { surface: 'string' }, 'An AI asset was regenerated.'),
  // ── automation ───────────────────────────────────────────────────────────────
  'automation.enabled':     def('automation.enabled', 'automation', 'workflow', 'latest', LIFETIME, { workflow: 'string' }, 'An automation workflow was enabled.'),
  'automation.disabled':    def('automation.disabled', 'automation', 'workflow', 'latest', LIFETIME, { workflow: 'string' }, 'An automation workflow was disabled.'),
  'automation.executed':    def('automation.executed', 'automation', 'automation_run', 'count', DAYS(180), { action: 'string' }, 'An automation action executed.'),
  'automation.failed':      def('automation.failed', 'automation', 'automation_run', 'count', DAYS(180), { action: 'string', reason: 'string' }, 'An automation action failed.'),
  // ── analytics ────────────────────────────────────────────────────────────────
  'analytics.dashboard_viewed':    def('analytics.dashboard_viewed', 'analytics', 'dashboard', 'count', DAYS(90), { dashboard: 'string' }, 'An analytics dashboard was reviewed (a deliberate review, not a nav hit).'),
  'analytics.kpi_reviewed':        def('analytics.kpi_reviewed', 'analytics', 'kpi', 'count', DAYS(90), { kpi: 'string' }, 'A KPI was reviewed.'),
  'analytics.comparison_generated':def('analytics.comparison_generated', 'analytics', 'comparison', 'count', DAYS(180), {}, 'A comparison was generated.'),
  // ── reports ──────────────────────────────────────────────────────────────────
  'reports.generated':      def('reports.generated', 'reports', 'report', 'count', LIFETIME, { reportType: 'string' }, 'An intelligence report was generated.'),
  'reports.exported':       def('reports.exported', 'reports', 'report', 'count', DAYS(365), { format: 'string' }, 'A report was exported.'),
  'reports.shared':         def('reports.shared', 'reports', 'report', 'count', DAYS(365), { channel: 'string' }, 'A report was shared.'),
  // ── recommendations ──────────────────────────────────────────────────────────
  'recommendations.shown':      def('recommendations.shown', 'recommendations', 'recommendation', 'rate', DAYS(180), { recommendationType: 'string' }, 'A recommendation was surfaced.'),
  'recommendations.accepted':   def('recommendations.accepted', 'recommendations', 'recommendation', 'rate', DAYS(365), { recommendationType: 'string' }, 'A recommendation was accepted.'),
  'recommendations.dismissed':  def('recommendations.dismissed', 'recommendations', 'recommendation', 'rate', DAYS(180), { recommendationType: 'string' }, 'A recommendation was dismissed.'),
  'recommendations.ignored':    def('recommendations.ignored', 'recommendations', 'recommendation', 'rate', DAYS(180), { recommendationType: 'string' }, 'A recommendation was ignored (expired unacted).'),
  // ── collaboration ────────────────────────────────────────────────────────────
  'collaboration.approval_completed': def('collaboration.approval_completed', 'collaboration', 'approval', 'count', DAYS(365), { entityType: 'string' }, 'An approval/review was completed.'),
  'collaboration.comment_added':      def('collaboration.comment_added', 'collaboration', 'comment', 'count', DAYS(180), { entityType: 'string' }, 'A collaboration comment was added.'),
  'collaboration.task_completed':     def('collaboration.task_completed', 'collaboration', 'task', 'count', DAYS(365), {}, 'A task/work item was completed.'),
  'collaboration.review_requested':   def('collaboration.review_requested', 'collaboration', 'review', 'count', DAYS(180), { entityType: 'string' }, 'A review was requested.'),
  // ── lead_management ──────────────────────────────────────────────────────────
  'lead.captured':          def('lead.captured', 'lead_management', 'lead', 'count', LIFETIME, { source: 'string' }, 'A lead was captured.'),
  'lead.qualified':         def('lead.qualified', 'lead_management', 'lead', 'count', LIFETIME, {}, 'A lead was qualified.'),
  'lead.assigned':          def('lead.assigned', 'lead_management', 'lead', 'count', DAYS(365), {}, 'A lead was assigned.'),
  'lead.workflow_triggered':def('lead.workflow_triggered', 'lead_management', 'lead_workflow', 'count', DAYS(365), { workflow: 'string' }, 'A lead workflow was triggered.'),
  // ── integrations ─────────────────────────────────────────────────────────────
  'integration.connected':    def('integration.connected', 'integrations', 'integration', 'latest', LIFETIME, { provider: 'string', type: 'string' }, 'An integration was connected.'),
  'integration.disconnected': def('integration.disconnected', 'integrations', 'integration', 'latest', LIFETIME, { provider: 'string' }, 'An integration was disconnected.'),
  'integration.synchronized': def('integration.synchronized', 'integrations', 'integration', 'count', DAYS(90), { provider: 'string' }, 'An integration synchronized.'),
  // ── website ──────────────────────────────────────────────────────────────────
  'website.audit_completed':       def('website.audit_completed', 'website', 'website', 'count', DAYS(365), {}, 'A website audit completed.'),
  'website.verification_completed':def('website.verification_completed', 'website', 'website', 'latest', LIFETIME, {}, 'Domain verification completed.'),
  'website.tracking_connected':    def('website.tracking_connected', 'website', 'website', 'latest', LIFETIME, {}, 'On-site tracking was connected.'),
  // ── community ────────────────────────────────────────────────────────────────
  'community.signal_detected':  def('community.signal_detected', 'community', 'community_signal', 'count', DAYS(90), { platform: 'string' }, 'A community signal was detected.'),
  'community.engagement_sent':  def('community.engagement_sent', 'community', 'community_engagement', 'count', DAYS(180), { platform: 'string' }, 'A community engagement was sent.'),
  // ── market_intelligence ──────────────────────────────────────────────────────
  'market.insight_generated':   def('market.insight_generated', 'market_intelligence', 'insight', 'count', DAYS(180), {}, 'A market insight was generated.'),
  'market.competitor_tracked':  def('market.competitor_tracked', 'market_intelligence', 'competitor', 'distinct_entity', LIFETIME, {}, 'A competitor was tracked.'),
};

export const TELEMETRY_CATEGORIES: TelemetryCategory[] = [
  'content', 'campaign', 'ai', 'automation', 'analytics', 'reports', 'recommendations',
  'collaboration', 'lead_management', 'integrations', 'website', 'community', 'market_intelligence',
];

export function isTelemetryEventType(value: string): value is TelemetryEventType {
  return Object.prototype.hasOwnProperty.call(TELEMETRY_EVENTS, value);
}

export function getTelemetryEventDefinition(type: TelemetryEventType): TelemetryEventDefinition {
  return TELEMETRY_EVENTS[type];
}

export function eventTypesForCategory(category: TelemetryCategory): TelemetryEventType[] {
  return (Object.keys(TELEMETRY_EVENTS) as TelemetryEventType[]).filter((t) => TELEMETRY_EVENTS[t].category === category);
}
