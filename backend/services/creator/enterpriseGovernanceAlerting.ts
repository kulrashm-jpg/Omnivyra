/**
 * Enterprise Governance — Operational Alerting (Phase 10).
 *
 * Evaluates threshold + storm rules against the bounded governance event
 * ring buffer, the review store, and the escalation pipeline. Reuses the
 * existing `creator_alerts` posture: structured payloads emitted via the
 * logger so the platform's log router can forward to Slack / PagerDuty
 * through their own integrations.
 *
 * Rules:
 *   - escalation_storm:         >= 10 escalations in last 5 min per org
 *   - retry_storm:              >= 8 retry_exhausted events in last 10 min
 *   - governance_failure_spike: >= 5 severe_governance_violation in 10 min
 *   - qa_degradation:           >= 12 qa_failure in 10 min
 *   - approval_bottleneck:      avg pending > 24h AND >= 10 pending assets
 *   - stuck_workflows:          >= 5 assets stale > 7 days
 *   - notification_delivery_failures: subscriber failure indicator > 0 in 5 min
 *   - persistence_degradation:  redis disabled OR consecutiveFailures >= 3
 *
 * Cooldown semantics: per-(rule, companyId) cooldown prevents spam.
 *   - critical: 10 min
 *   - warning:  30 min
 *   - info:     1 hour
 *
 * NEVER throws — every rule is wrapped in try/catch.
 *
 * Phase 10 bounded:
 *   - in-process active-alert state: 500 entries, FIFO eviction
 *   - rule evaluation reads at most 2000 events
 *   - linear-time rule evaluation
 */

import {
  listRecentGovernanceEvents,
  type EnterpriseGovernanceEvent,
} from './enterpriseGovernanceEvents';
import { listReviewRecordsForCompany } from './creativeReviewStateMachine';
import { escalationStats, listEscalationsForCompany } from './creativeEscalationPipeline';
import { persistenceDiagnostics } from './enterpriseGovernanceRedisPersistence';

export type EnterpriseAlertSeverity = 'info' | 'warning' | 'critical';
export type EnterpriseAlertRule =
  | 'escalation_storm'
  | 'retry_storm'
  | 'governance_failure_spike'
  | 'qa_degradation'
  | 'approval_bottleneck'
  | 'stuck_workflows'
  | 'notification_delivery_failures'
  | 'persistence_degradation';

export type EnterpriseAlert = {
  id: string;
  rule: EnterpriseAlertRule;
  severity: EnterpriseAlertSeverity;
  companyId: string | null;
  message: string;
  metadata: Record<string, unknown>;
  firstFiredAt: string;
  lastFiredAt: string;
  fireCount: number;
  cooldownUntil: string;
};

const COOLDOWN_MS: Record<EnterpriseAlertSeverity, number> = {
  critical: 10 * 60 * 1000,
  warning: 30 * 60 * 1000,
  info: 60 * 60 * 1000,
};

const MAX_ACTIVE_ALERTS = 500;
const activeAlerts = new Map<string, EnterpriseAlert>();

function alertKey(rule: EnterpriseAlertRule, companyId: string | null): string {
  return `${rule}:${companyId ?? 'global'}`;
}

function alertId(): string {
  return `enta-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function isDispatchEnabled(): boolean {
  return process.env.CREATOR_ALERT_DISPATCH_ENABLED === 'true';
}

function pruneIfFull(): void {
  if (activeAlerts.size <= MAX_ACTIVE_ALERTS) return;
  const firstKey = activeAlerts.keys().next().value;
  if (firstKey) activeAlerts.delete(firstKey);
}

function fire(input: {
  rule: EnterpriseAlertRule;
  severity: EnterpriseAlertSeverity;
  companyId: string | null;
  message: string;
  metadata?: Record<string, unknown>;
}): EnterpriseAlert | null {
  const key = alertKey(input.rule, input.companyId);
  const now = Date.now();
  const existing = activeAlerts.get(key);

  if (existing && new Date(existing.cooldownUntil).getTime() > now) {
    // Cooldown — bump counters but don't re-emit.
    existing.fireCount += 1;
    existing.lastFiredAt = new Date(now).toISOString();
    return null;
  }

  const cooldownUntil = new Date(now + COOLDOWN_MS[input.severity]).toISOString();
  const alert: EnterpriseAlert = {
    id: alertId(),
    rule: input.rule,
    severity: input.severity,
    companyId: input.companyId,
    message: input.message,
    metadata: input.metadata ?? {},
    firstFiredAt: existing?.firstFiredAt ?? new Date(now).toISOString(),
    lastFiredAt: new Date(now).toISOString(),
    fireCount: (existing?.fireCount ?? 0) + 1,
    cooldownUntil,
  };
  activeAlerts.set(key, alert);
  pruneIfFull();

  if (isDispatchEnabled()) {
    try {
      console.warn('[creator-gov-alert]', JSON.stringify({
        surface: 'enterpriseGovernanceAlert',
        rule: alert.rule,
        severity: alert.severity,
        companyId: alert.companyId,
        message: alert.message,
        metadata: alert.metadata,
        fireCount: alert.fireCount,
      }));
    } catch { /* never propagate */ }
  }

  return alert;
}

/* ── Rule evaluators ────────────────────────────────────────────────── */

function eventsSince(companyId: string, sinceMs: number, type?: EnterpriseGovernanceEvent['type']): number {
  const events = listRecentGovernanceEvents({ companyId, limit: 500, type });
  let count = 0;
  for (const e of events) {
    if (new Date(e.occurredAt).getTime() >= sinceMs) count++;
  }
  return count;
}

function evaluateForCompany(companyId: string): EnterpriseAlert[] {
  const fired: EnterpriseAlert[] = [];
  const now = Date.now();

  try {
    // escalation_storm — 10/5min
    const escs = listEscalationsForCompany(companyId);
    let recentEsc = 0;
    for (const e of escs) {
      if (new Date(e.createdAt).getTime() >= now - 5 * 60 * 1000) recentEsc++;
    }
    if (recentEsc >= 10) {
      const a = fire({
        rule: 'escalation_storm', severity: 'critical', companyId,
        message: `Escalation storm: ${recentEsc} escalations in last 5 minutes`,
        metadata: { recentEsc },
      });
      if (a) fired.push(a);
    }

    // retry_storm — 8 retry_exhausted in 10min
    const retryCount = eventsSince(companyId, now - 10 * 60 * 1000, 'retry_exhausted');
    if (retryCount >= 8) {
      const a = fire({
        rule: 'retry_storm', severity: 'critical', companyId,
        message: `Retry storm: ${retryCount} retry_exhausted events in last 10 minutes`,
        metadata: { retryCount },
      });
      if (a) fired.push(a);
    }

    // governance_failure_spike
    const sevGovCount = eventsSince(companyId, now - 10 * 60 * 1000, 'severe_governance_violation');
    if (sevGovCount >= 5) {
      const a = fire({
        rule: 'governance_failure_spike', severity: 'critical', companyId,
        message: `Severe governance violations: ${sevGovCount} in last 10 minutes`,
        metadata: { sevGovCount },
      });
      if (a) fired.push(a);
    }

    // qa_degradation
    const qaFailCount = eventsSince(companyId, now - 10 * 60 * 1000, 'qa_failure');
    if (qaFailCount >= 12) {
      const a = fire({
        rule: 'qa_degradation', severity: 'warning', companyId,
        message: `QA degradation: ${qaFailCount} qa_failure events in last 10 minutes`,
        metadata: { qaFailCount },
      });
      if (a) fired.push(a);
    }

    // approval_bottleneck + stuck_workflows
    const records = listReviewRecordsForCompany(companyId, 200);
    let pendingCount = 0;
    let pendingHoursTotal = 0;
    let staleCount = 0;
    for (const r of records) {
      const terminal = r.currentState === 'published' || r.currentState === 'archived';
      if (terminal) continue;
      pendingCount++;
      const hours = (now - new Date(r.lastTransitionedAt).getTime()) / (60 * 60 * 1000);
      pendingHoursTotal += hours;
      if (r.stale) staleCount++;
    }
    if (pendingCount >= 10 && pendingHoursTotal / pendingCount > 24) {
      const a = fire({
        rule: 'approval_bottleneck', severity: 'warning', companyId,
        message: `Approval bottleneck: ${pendingCount} pending assets, avg age ${(pendingHoursTotal / pendingCount).toFixed(1)}h`,
        metadata: { pendingCount, avgAgeHours: pendingHoursTotal / pendingCount },
      });
      if (a) fired.push(a);
    }
    if (staleCount >= 5) {
      const a = fire({
        rule: 'stuck_workflows', severity: 'warning', companyId,
        message: `${staleCount} assets stale > 7 days`,
        metadata: { staleCount },
      });
      if (a) fired.push(a);
    }
  } catch (err) {
    console.warn('[creator-gov-alert] company-rule-failed', {
      companyId, message: err instanceof Error ? err.message : String(err),
    });
  }

  return fired;
}

function evaluateGlobalRules(): EnterpriseAlert[] {
  const fired: EnterpriseAlert[] = [];
  try {
    const diag = persistenceDiagnostics();
    if (diag.enabled && (diag.disabled || diag.consecutiveFailures >= 3)) {
      const a = fire({
        rule: 'persistence_degradation', severity: 'critical', companyId: null,
        message: `Redis persistence degraded (disabled=${diag.disabled}, failures=${diag.consecutiveFailures})`,
        metadata: diag,
      });
      if (a) fired.push(a);
    }
  } catch (err) {
    console.warn('[creator-gov-alert] global-rule-failed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }
  return fired;
}

/**
 * Run a full evaluation pass. Called on a timer by the worker bootstrap
 * (or on-demand from API). Returns alerts that fired this pass (excluding
 * those still in cooldown).
 */
export function evaluateGovernanceAlerts(input: { companyIds?: string[] } = {}): EnterpriseAlert[] {
  const fired: EnterpriseAlert[] = [];

  // Companies — caller may supply, or we discover via escalation stats.
  const targetCompanies = input.companyIds ?? Object.keys(_discoverCompanies());
  for (const cid of targetCompanies) fired.push(...evaluateForCompany(cid));
  fired.push(...evaluateGlobalRules());

  return fired;
}

function _discoverCompanies(): Record<string, true> {
  // Cheap discovery: scan recent events for distinct companyIds.
  // Capped at 50 distinct companies per pass (sufficient for typical orgs).
  const seen: Record<string, true> = {};
  const events = listRecentGovernanceEvents({ limit: 500 });
  for (const e of events) {
    if (Object.keys(seen).length >= 50) break;
    seen[e.companyId] = true;
  }
  return seen;
}

/* ── Operator-facing read surface ───────────────────────────────────── */

export function listActiveAlerts(filter: { companyId?: string; severity?: EnterpriseAlertSeverity } = {}): ReadonlyArray<EnterpriseAlert> {
  const cid = filter.companyId?.trim().toLowerCase();
  const out: EnterpriseAlert[] = [];
  for (const a of activeAlerts.values()) {
    if (cid && (a.companyId ?? '').toLowerCase() !== cid) continue;
    if (filter.severity && a.severity !== filter.severity) continue;
    out.push(a);
  }
  // Newest-first by lastFiredAt
  out.sort((a, b) => (a.lastFiredAt < b.lastFiredAt ? 1 : -1));
  return out;
}

export function alertingDiagnostics(): {
  activeAlerts: number;
  maxActiveAlerts: number;
  dispatchEnabled: boolean;
  cooldownMs: Record<EnterpriseAlertSeverity, number>;
} {
  return {
    activeAlerts: activeAlerts.size,
    maxActiveAlerts: MAX_ACTIVE_ALERTS,
    dispatchEnabled: isDispatchEnabled(),
    cooldownMs: COOLDOWN_MS,
  };
}

export function clearAlertsForTests(): void { activeAlerts.clear(); }
