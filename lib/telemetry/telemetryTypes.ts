/**
 * Canonical Telemetry — shared types + contracts
 * ----------------------------------------------
 * The single canonical telemetry domain for adoption, engagement,
 * effectiveness, and proficiency across OmniVyra (Command Center, Reports,
 * Recommendations, AI, Analytics, future intelligence modules).
 *
 * These types are framework-agnostic (usable frontend + backend). The registry
 * (telemetryRegistry) is the single source of truth for events; the backend
 * services (store / dispatcher / aggregator / providers) are the only writers
 * and readers. No feature module defines its own events or aggregations.
 */

/** Canonical event categories. Future categories register here. */
export type TelemetryCategory =
  | 'content'
  | 'campaign'
  | 'ai'
  | 'automation'
  | 'analytics'
  | 'reports'
  | 'recommendations'
  | 'collaboration'
  | 'lead_management'
  | 'integrations'
  | 'website'
  | 'community'
  | 'market_intelligence';

/** The canonical event id set (stable strings, persisted verbatim). */
export type TelemetryEventType =
  // content
  | 'content.created'
  | 'content.edited'
  | 'content.published'
  | 'content.archived'
  | 'content.template_used'
  | 'content.media_uploaded'
  // campaign
  | 'campaign.created'
  | 'campaign.launched'
  | 'campaign.paused'
  | 'campaign.resumed'
  | 'campaign.completed'
  | 'campaign.archived'
  | 'campaign.recommended'
  // operational core (W2) + guarded execution (W5.1) — dynamic stage/decision events
  | `operations.${string}`
  | `execution.${string}`
  // ai
  | 'ai.generated'
  | 'ai.accepted'
  | 'ai.rejected'
  | 'ai.refined'
  | 'ai.regenerated'
  // automation
  | 'automation.enabled'
  | 'automation.disabled'
  | 'automation.executed'
  | 'automation.failed'
  // analytics
  | 'analytics.dashboard_viewed'
  | 'analytics.kpi_reviewed'
  | 'analytics.comparison_generated'
  // reports
  | 'reports.generated'
  | 'reports.exported'
  | 'reports.shared'
  // recommendations
  | 'recommendations.shown'
  | 'recommendations.accepted'
  | 'recommendations.dismissed'
  | 'recommendations.ignored'
  // collaboration
  | 'collaboration.approval_completed'
  | 'collaboration.comment_added'
  | 'collaboration.task_completed'
  | 'collaboration.review_requested'
  // lead_management
  | 'lead.captured'
  | 'lead.qualified'
  | 'lead.assigned'
  | 'lead.workflow_triggered'
  // integrations
  | 'integration.connected'
  | 'integration.disconnected'
  | 'integration.synchronized'
  // website
  | 'website.audit_completed'
  | 'website.verification_completed'
  | 'website.tracking_connected'
  // community
  | 'community.signal_detected'
  | 'community.engagement_sent'
  // market_intelligence
  | 'market.insight_generated'
  | 'market.competitor_tracked';

export type MetadataFieldType = 'string' | 'number' | 'boolean' | 'string[]';

/** How a signal derives a value from this event's occurrences. */
export type AggregationPolicy =
  | 'count'            // total occurrences
  | 'distinct_entity'  // distinct entity ids
  | 'cadence'          // occurrences per active week
  | 'rate'             // ratio vs a paired event (accept/shown, etc.)
  | 'latest';          // most-recent occurrence only

/** How long raw events are retained (future retention job reads this). */
export type RetentionPolicy = { kind: 'days'; days: number } | { kind: 'lifetime' };

export interface TelemetryEventDefinition {
  id: TelemetryEventType;
  category: TelemetryCategory;
  /** Kind of entity `entity_id` refers to (e.g. 'content', 'campaign'). */
  entity: string;
  description: string;
  /** Declared metadata schema for this event. */
  metadataSchema: Record<string, MetadataFieldType>;
  aggregation: AggregationPolicy;
  retention: RetentionPolicy;
}

/**
 * The append-only canonical event record — one row per business action.
 * Never overwritten, never mutated, no derived scores stored.
 */
export interface TelemetryEventRecord {
  id?: string;
  event_type: TelemetryEventType;
  category: TelemetryCategory;
  entity_type: string | null;
  entity_id: string | null;
  actor_id: string | null;
  organization_id: string;
  metadata: Record<string, unknown>;
  /** Deterministic idempotency key (one business action → one row). */
  dedup_key: string | null;
  /** When the business action occurred. */
  occurred_at: string;
  /** When the row was inserted (DB default). */
  created_at?: string;
}

/** Aggregation windows. `rolling` = an arbitrary since-timestamp window. */
export type TelemetryWindow = '7d' | '30d' | '90d' | 'lifetime' | 'rolling';

/**
 * THE canonical provider contract. Every signal provider returns this shape —
 * the single contract consumed by Setup, Readiness, Mastery, Reports, and AI.
 */
export interface TelemetryProviderResult {
  /** The platform supports producing this signal at all. */
  supported: boolean;
  /** Telemetry data exists for this signal in the window. */
  available: boolean;
  /** Primary metric value (semantics documented per provider). */
  value: number;
  /** 0..1 confidence, derived deterministically from data volume/recency. */
  confidence: number;
  /** ISO timestamp of the latest contributing event, or null. */
  lastUpdated: string | null;
  /** Named breakdown metrics supporting `value`. */
  supportingMetrics: Record<string, number>;
}
