/**
 * Creator Alerting Service
 *
 * Enterprise threshold + anomaly alerting layer for the creator workflow.
 * Consumes the observability service's metric snapshots, evaluates a
 * fixed set of thresholds, and fires deduplicated, cooldown-respecting
 * alerts persisted in `creator_alert_state`.
 *
 * Pluggable channels: Slack, email, PagerDuty are NOT wired here — this
 * service emits structured alert objects and writes them to the state
 * table. A downstream worker (or webhook handler) can subscribe to
 * `creator_operational_events` of type `alert_fired` and forward them.
 *
 * Dedup semantics:
 *   - An alert_key identifies a stable "issue" (kind + optional scope).
 *   - Re-firing within `cooldown_until` increments fire_count but does
 *     NOT trigger a new notification.
 *   - Cooldown resets when the alert is resolved.
 */

import { supabase } from '../db/supabaseClient';
import { ownedDbTable } from '../db/writeOwner';
import { logger } from './logger';
import { emitCreatorEvent, CREATOR_EVENTS } from './creatorOperationalTelemetryService';
import { aggregateCreatorMetrics, classifyWorkflowStatus } from './creatorObservabilityService';
import type { ObservabilityWindow, MetricSnapshot, AnomalyFinding } from './creatorObservabilityService';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export type AlertChannel = 'slack' | 'email' | 'webhook' | 'pagerduty';

export type AlertSubscriber = {
  channel: AlertChannel;
  /** Minimum severity to deliver. */
  minSeverity?: AlertSeverity;
  /** Channel-specific payload — opaque to this service. */
  config: Record<string, unknown>;
};

type AlertCheck = {
  key: string;
  severity: AlertSeverity;
  message: string;
  metadata?: Record<string, unknown>;
};

// Cooldowns per severity — critical refires sooner so on-call awareness stays sharp.
const COOLDOWN_MS: Record<AlertSeverity, number> = {
  critical: 10 * 60 * 1000, // 10 minutes
  warning: 30 * 60 * 1000,  // 30 minutes
  info: 60 * 60 * 1000,     // 1 hour
};

// ──────────────────────────────────────────────────────────────────────
// Threshold definitions
// ──────────────────────────────────────────────────────────────────────
type ThresholdRule = {
  key: string;
  severity: AlertSeverity;
  detect: (snapshot: MetricSnapshot) => { triggered: boolean; message: string; metadata?: Record<string, unknown> };
};

const THRESHOLDS: ThresholdRule[] = [
  {
    key: 'upload_failure_rate_high',
    severity: 'warning',
    detect: (s) => {
      const r = s.rates.upload_failure;
      return r > 0.3 && (s.counts_by_event['upload_started'] ?? 0) >= 10
        ? { triggered: true, message: `Upload failure rate ${(r * 100).toFixed(1)}% > 30%`, metadata: { rate: r } }
        : { triggered: false, message: '' };
    },
  },
  {
    key: 'publish_validation_failure_high',
    severity: 'critical',
    detect: (s) => {
      const r = s.rates.publish_validation_failure;
      return r > 0.1 && (s.counts_by_event['publish_validation_passed'] ?? 0) + (s.counts_by_event['publish_validation_failed'] ?? 0) >= 20
        ? { triggered: true, message: `Publish validation failure rate ${(r * 100).toFixed(1)}% > 10%`, metadata: { rate: r } }
        : { triggered: false, message: '' };
    },
  },
  {
    key: 'queue_contention_high',
    severity: 'warning',
    detect: (s) => {
      const r = s.rates.queue_contention;
      return r > 0.25 && (s.counts_by_event['queue_lock_acquired'] ?? 0) + (s.counts_by_event['queue_lock_contention'] ?? 0) >= 20
        ? { triggered: true, message: `Queue lock contention ${(r * 100).toFixed(1)}% > 25%`, metadata: { rate: r } }
        : { triggered: false, message: '' };
    },
  },
  {
    key: 'resumable_recovery_low',
    severity: 'info',
    detect: (s) => {
      const r = s.rates.resumable_recovery;
      const detected = s.counts_by_event['resumable_session_detected'] ?? 0;
      return detected >= 10 && r < 0.2
        ? { triggered: true, message: `Resumable recovery rate ${(r * 100).toFixed(1)}% < 20%`, metadata: { rate: r, detected } }
        : { triggered: false, message: '' };
    },
  },
  {
    key: 'attachment_deadlock',
    severity: 'critical',
    detect: (s) => {
      const found = s.anomalies.find((a) => a.kind === 'lifecycle_deadlock_pattern');
      return found
        ? { triggered: true, message: found.message, metadata: { observed: found.observed } }
        : { triggered: false, message: '' };
    },
  },
  {
    key: 'queue_backlog_high',
    severity: 'warning',
    detect: (s) => {
      // proxy: large gap between attempts started and completions
      const started = s.counts_by_event['upload_started'] ?? 0;
      const completed = s.counts_by_event['upload_completed'] ?? 0;
      const failed = s.counts_by_event['upload_failed'] ?? 0;
      const stalled = started - completed - failed;
      return stalled > 50
        ? { triggered: true, message: `${stalled} uploads stalled in flight`, metadata: { stalled, started, completed, failed } }
        : { triggered: false, message: '' };
    },
  },
];

/**
 * Evaluate thresholds + anomalies against a snapshot, emitting/refreshing
 * alerts in the state table. Returns the list of NEW (post-dedup) alerts.
 */
export async function evaluateCreatorAlerts(input: {
  window?: ObservabilityWindow;
  companyId?: string | null;
} = {}): Promise<{ fired: AlertCheck[]; deduped: AlertCheck[]; resolved: string[]; status: 'healthy' | 'degraded' | 'incident' }> {
  const window = input.window ?? '1h';
  const snapshot = await aggregateCreatorMetrics({ window, companyId: input.companyId ?? null });
  const status = classifyWorkflowStatus(snapshot);

  const candidates: AlertCheck[] = [];

  // 1. Threshold-based
  for (const rule of THRESHOLDS) {
    const r = rule.detect(snapshot);
    if (r.triggered) {
      candidates.push({
        key: scopedKey(rule.key, input.companyId),
        severity: rule.severity,
        message: r.message,
        metadata: { ...(r.metadata ?? {}), window, scope_company_id: input.companyId ?? null },
      });
    }
  }

  // 2. Anomaly findings (already classified)
  for (const a of snapshot.anomalies) {
    candidates.push({
      key: scopedKey(`anomaly:${a.kind}`, input.companyId),
      severity: a.severity,
      message: a.message,
      metadata: { observed: a.observed, baseline: a.baseline, ratio: a.ratio, window, scope_company_id: input.companyId ?? null },
    });
  }

  const fired: AlertCheck[] = [];
  const deduped: AlertCheck[] = [];
  const resolved: string[] = [];

  for (const c of candidates) {
    const upsertResult = await upsertAlertWithDedup(c);
    if (upsertResult === 'fired') {
      fired.push(c);
      emitCreatorEvent({
        event: CREATOR_EVENTS.ALERT_FIRED,
        severity: c.severity,
        companyId: input.companyId ?? null,
        metadata: { alert_key: c.key, message: c.message, ...(c.metadata ?? {}) },
      });
    } else {
      deduped.push(c);
      emitCreatorEvent({
        event: CREATOR_EVENTS.ALERT_DEDUPED,
        companyId: input.companyId ?? null,
        metadata: { alert_key: c.key },
      });
    }
  }

  // 3. Auto-resolve any active alerts whose conditions are no longer true.
  const candidateKeys = new Set(candidates.map((c) => c.key));
  const resolvedKeys = await autoResolveStaleAlerts(candidateKeys, input.companyId ?? null);
  for (const k of resolvedKeys) {
    resolved.push(k);
    emitCreatorEvent({
      event: CREATOR_EVENTS.ALERT_RESOLVED,
      companyId: input.companyId ?? null,
      metadata: { alert_key: k },
    });
  }

  return { fired, deduped, resolved, status };
}

function scopedKey(base: string, companyId?: string | null): string {
  return companyId ? `${base}:${companyId}` : base;
}

async function upsertAlertWithDedup(c: AlertCheck): Promise<'fired' | 'deduped'> {
  const now = new Date();
  try {
    const { data: existing } = await supabase
      .from('creator_alert_state')
      .select('alert_key, severity, fire_count, cooldown_until, status')
      .eq('alert_key', c.key)
      .maybeSingle();

    if (!existing) {
      await ownedDbTable('creator_alert_state').insert({
        alert_key: c.key,
        severity: c.severity,
        message: c.message,
        metadata: c.metadata ?? {},
        status: 'active',
        fire_count: 1,
        first_fired_at: now.toISOString(),
        last_fired_at: now.toISOString(),
        last_notified_at: now.toISOString(),
        cooldown_until: new Date(now.getTime() + COOLDOWN_MS[c.severity]).toISOString(),
      });
      return 'fired';
    }

    const cooldownUntil = (existing as any).cooldown_until ? new Date((existing as any).cooldown_until) : null;
    const inCooldown = cooldownUntil ? cooldownUntil.getTime() > now.getTime() : false;

    if (inCooldown) {
      await ownedDbTable('creator_alert_state')
        .update({
          fire_count: ((existing as any).fire_count ?? 0) + 1,
          last_fired_at: now.toISOString(),
          message: c.message,
        })
        .eq('alert_key', c.key);
      return 'deduped';
    }

    // Cooldown elapsed — fire again.
    await ownedDbTable('creator_alert_state')
      .update({
        fire_count: ((existing as any).fire_count ?? 0) + 1,
        last_fired_at: now.toISOString(),
        last_notified_at: now.toISOString(),
        cooldown_until: new Date(now.getTime() + COOLDOWN_MS[c.severity]).toISOString(),
        severity: c.severity,
        message: c.message,
        status: 'active',
        resolved_at: null,
      })
      .eq('alert_key', c.key);
    return 'fired';
  } catch (err) {
    logger.warn('creatorAlerting.upsert_failed', {
      surface: 'creatorAlerting',
      error: (err as Error)?.message ?? String(err),
      alert_key: c.key,
    });
    return 'deduped';
  }
}

async function autoResolveStaleAlerts(activeKeys: Set<string>, companyId: string | null): Promise<string[]> {
  try {
    // Pull currently-active alerts for this company scope.
    const { data } = await supabase
      .from('creator_alert_state')
      .select('alert_key, severity, last_fired_at')
      .eq('status', 'active')
      .order('last_fired_at', { ascending: false })
      .limit(200);
    if (!Array.isArray(data)) return [];
    const candidates = (data as Array<{ alert_key: string; severity: string; last_fired_at: string }>)
      .filter((r) => (companyId ? r.alert_key.endsWith(`:${companyId}`) : !r.alert_key.includes(':') || r.alert_key.split(':').length <= 1));

    const stale: string[] = [];
    const now = Date.now();
    for (const row of candidates) {
      if (activeKeys.has(row.alert_key)) continue;
      const ageMs = now - new Date(row.last_fired_at).getTime();
      const cooldown = COOLDOWN_MS[(row.severity as AlertSeverity)] ?? COOLDOWN_MS.warning;
      if (ageMs >= cooldown) stale.push(row.alert_key);
    }

    if (stale.length === 0) return [];
    await ownedDbTable('creator_alert_state')
      .update({ status: 'resolved', resolved_at: new Date().toISOString() })
      .in('alert_key', stale);
    return stale;
  } catch {
    return [];
  }
}

/**
 * Channel dispatcher — accepts a list of subscribers and emits the alert
 * payload through each one. Channels are pluggable; this service does
 * NOT implement Slack/Email/PagerDuty I/O directly — that's the host
 * app's concern, kept off this layer to avoid bringing those SDKs into
 * the request path.
 *
 * `dispatchAlert` is a no-op when `process.env.CREATOR_ALERT_DISPATCH_ENABLED`
 * is not `'true'`, so this service can run safely without secrets wired up.
 */
export async function dispatchAlert(alert: AlertCheck, subscribers: AlertSubscriber[]): Promise<void> {
  if (process.env.CREATOR_ALERT_DISPATCH_ENABLED !== 'true') return;

  const sevRank: Record<AlertSeverity, number> = { info: 1, warning: 2, critical: 3 };
  for (const sub of subscribers) {
    const min = sub.minSeverity ?? 'info';
    if (sevRank[alert.severity] < sevRank[min]) continue;
    // The actual transport is host-provided. Here we surface a structured
    // payload via the logger so external log routers (Datadog, etc.) can
    // forward to Slack/PagerDuty via their own integrations.
    logger.warn('creatorAlert.dispatch', {
      surface: 'creatorAlertingDispatch',
      channel: sub.channel,
      alert_key: alert.key,
      severity: alert.severity,
      message: alert.message,
      config: sub.config,
      metadata: alert.metadata,
    });
  }
}

export type { AlertCheck, MetricSnapshot, AnomalyFinding };
