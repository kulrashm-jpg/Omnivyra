/**
 * Enterprise Governance — Notification Delivery (Phase 1).
 *
 * Subscribes to the governance event bus and routes high-signal events
 * to existing platform notification surfaces. Reuses the platform's
 * existing log → router → external-transport posture (same posture
 * `creatorAlertingService.dispatchAlert` uses): structured payloads are
 * emitted via the logger so external log routers (Datadog, etc.) can
 * forward to Slack / PagerDuty / email / webhook through their own
 * integrations — without bringing those SDKs into the request path.
 *
 * Also persists an operator-facing bounded in-process delivery queue
 * (`creator_governance_alerts` semantic) so a future UI can list and
 * acknowledge them without re-querying logs.
 *
 * Activation:
 *   - ENTERPRISE_GOVERNANCE_NOTIFY_ENABLED=true  → subscribe at boot.
 *   - CREATOR_ALERT_DISPATCH_ENABLED=true        → external transport
 *     fan-out (matches the existing creator alerting gate).
 *
 * NEVER throws — every emission path is wrapped in try/catch.
 */

import {
  subscribeToGovernanceEvents,
  type EnterpriseGovernanceEvent,
  type EnterpriseGovernanceEventType,
} from './enterpriseGovernanceEvents';

/* ── Severity routing matrix ────────────────────────────────────────── */

export type GovernanceNotificationSeverity = 'info' | 'warning' | 'critical';

const SEVERITY_MATRIX: Partial<Record<EnterpriseGovernanceEventType, GovernanceNotificationSeverity>> = {
  severe_governance_violation: 'critical',
  retry_exhausted: 'critical',
  campaign_locked: 'critical',
  publish_blocked: 'warning',
  approval_rejected: 'warning',
  escalation_created: 'warning',
  qa_failure: 'warning',
  governance_intervention: 'warning',
  approval_required: 'warning',
  approval_granted: 'info',
  publish_allowed: 'info',
  published: 'info',
};

/* ── Bounded operator-facing delivery queue ─────────────────────────── */

export type GovernanceNotification = {
  id: string;
  eventId: string;
  companyId: string;
  assetId: string;
  campaignId: string | null;
  type: EnterpriseGovernanceEventType;
  severity: GovernanceNotificationSeverity;
  message: string;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  occurredAt: string;
  context: Record<string, unknown>;
};

const MAX_QUEUE_SIZE = 1_500;
const queue: GovernanceNotification[] = [];

function notifId(): string {
  return `gov-notif-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function summarizeForOperator(event: EnterpriseGovernanceEvent): string {
  const asset = event.assetId.slice(0, 12);
  switch (event.type) {
    case 'severe_governance_violation':
      return `Severe governance violation on asset ${asset}`;
    case 'retry_exhausted':
      return `Retry exhausted on asset ${asset} (${event.context.retryCount ?? '?'} attempts)`;
    case 'campaign_locked':
      return `Campaign locked for asset ${asset}`;
    case 'publish_blocked':
      return `Publish blocked on asset ${asset} (state: ${event.context.currentState ?? 'unknown'})`;
    case 'approval_rejected':
      return `Approval rejected for asset ${asset}`;
    case 'escalation_created':
      return `Escalation: ${event.context.reason ?? 'unknown'} (${event.context.level ?? 'routine'}) → ${event.context.assignedRole ?? 'unassigned'}`;
    case 'qa_failure':
      return `QA failure on asset ${asset} (severity ${event.context.severity ?? '?'})`;
    case 'governance_intervention':
      return `Governance intervention on asset ${asset}`;
    case 'approval_granted':
      return `Approval granted for asset ${asset}`;
    case 'publish_allowed':
      return `Publish allowed for asset ${asset}`;
    case 'published':
      return `Asset ${asset} published`;
    default:
      return `${event.type} on asset ${asset}`;
  }
}

function isDispatchEnabled(): boolean {
  return process.env.CREATOR_ALERT_DISPATCH_ENABLED === 'true';
}

function isNotifyEnabled(): boolean {
  return String(process.env.ENTERPRISE_GOVERNANCE_NOTIFY_ENABLED ?? 'false').toLowerCase() === 'true';
}

let _subscribed = false;
let _unsubscribe: (() => void) | null = null;

function deliverEvent(event: EnterpriseGovernanceEvent): void {
  const severity = SEVERITY_MATRIX[event.type];
  // Only deliver events with a mapped severity — quiet events stay in the bus.
  if (!severity) return;

  try {
    const notif: GovernanceNotification = {
      id: notifId(),
      eventId: event.eventId,
      companyId: event.companyId,
      assetId: event.assetId,
      campaignId: event.campaignId,
      type: event.type,
      severity,
      message: summarizeForOperator(event),
      acknowledged: false,
      acknowledgedBy: null,
      acknowledgedAt: null,
      occurredAt: event.occurredAt,
      context: event.context,
    };

    queue.push(notif);
    if (queue.length > MAX_QUEUE_SIZE) queue.splice(0, queue.length - MAX_QUEUE_SIZE);

    // External transport fan-out — structured log line picked up by the
    // platform's log router. Same posture as creatorAlertingService.
    if (isDispatchEnabled()) {
      try {
        console.warn('[creator-gov-notify]', JSON.stringify({
          surface: 'enterpriseGovernanceNotification',
          severity,
          type: event.type,
          assetId: event.assetId,
          companyId: event.companyId,
          campaignId: event.campaignId,
          message: notif.message,
          eventId: event.eventId,
          context: event.context,
        }));
      } catch { /* never propagate logging failures */ }
    }
  } catch (err) {
    console.warn('[creator-gov-notify] deliver-failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Idempotent boot — subscribe once. Safe to call from many places
 * (worker boot, API request startup, test setup).
 */
export function startNotificationDelivery(): void {
  if (_subscribed) return;
  if (!isNotifyEnabled()) return;
  _unsubscribe = subscribeToGovernanceEvents(deliverEvent);
  _subscribed = true;
  console.info('[creator-gov-notify] subscriber registered');
}

export function stopNotificationDelivery(): void {
  if (!_subscribed) return;
  _unsubscribe?.();
  _unsubscribe = null;
  _subscribed = false;
}

/* ── Operator-facing read + acknowledge surface ─────────────────────── */

export type NotificationFilter = {
  companyId?: string;
  assetId?: string;
  severity?: GovernanceNotificationSeverity;
  acknowledged?: boolean;
  limit?: number;
};

export function listNotifications(filter: NotificationFilter = {}): ReadonlyArray<GovernanceNotification> {
  const limit = Math.max(1, Math.min(500, filter.limit ?? 100));
  const cid = filter.companyId?.trim().toLowerCase();
  const out: GovernanceNotification[] = [];
  for (let i = queue.length - 1; i >= 0 && out.length < limit; i--) {
    const n = queue[i];
    if (cid && n.companyId.toLowerCase() !== cid) continue;
    if (filter.assetId && n.assetId !== filter.assetId) continue;
    if (filter.severity && n.severity !== filter.severity) continue;
    if (filter.acknowledged !== undefined && n.acknowledged !== filter.acknowledged) continue;
    out.push(n);
  }
  return out;
}

export function acknowledgeNotification(input: { id: string; userId: string }): { ok: boolean; reason?: string } {
  const n = queue.find((q) => q.id === input.id);
  if (!n) return { ok: false, reason: 'not_found' };
  if (n.acknowledged) return { ok: true };
  n.acknowledged = true;
  n.acknowledgedBy = input.userId;
  n.acknowledgedAt = new Date().toISOString();
  return { ok: true };
}

export function notificationDeliveryDiagnostics(): {
  enabled: boolean;
  subscribed: boolean;
  dispatchEnabled: boolean;
  queueSize: number;
  queueMax: number;
  unackedCount: number;
} {
  let unacked = 0;
  for (const n of queue) if (!n.acknowledged) unacked++;
  return {
    enabled: isNotifyEnabled(),
    subscribed: _subscribed,
    dispatchEnabled: isDispatchEnabled(),
    queueSize: queue.length,
    queueMax: MAX_QUEUE_SIZE,
    unackedCount: unacked,
  };
}

export function resetNotificationsForTests(): void {
  queue.splice(0, queue.length);
  if (_subscribed) stopNotificationDelivery();
}
