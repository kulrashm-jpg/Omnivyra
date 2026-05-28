/**
 * Enterprise Governance — Production Readiness Verifier (Phase 12).
 *
 * Composable production-readiness scoring across every subsystem.
 * Returns a single envelope with:
 *   - per-check pass / warn / fail status
 *   - overall readiness score (0..100)
 *   - rolled-up grade (A..F)
 *   - actionable failure list for deployment gating
 *
 * Pure read aggregator. No DB queries, no external calls.
 * Bounded — each check operates on already-bounded in-process state.
 */

import { integrationHealth } from './enterpriseGovernanceIntegration';
import { persistenceDiagnostics } from './enterpriseGovernanceRedisPersistence';
import { lockingDiagnostics } from './enterpriseGovernanceLocking';
import { eventBufferDiagnostics } from './enterpriseGovernanceEvents';
import { notificationDeliveryDiagnostics } from './enterpriseGovernanceNotificationDelivery';
import { alertingDiagnostics } from './enterpriseGovernanceAlerting';
import { warmStartDiagnostics } from './enterpriseGovernanceWarmStart';
import { reviewStoreStats } from './creativeReviewStateMachine';
import { escalationStats } from './creativeEscalationPipeline';
import { telemetryStats } from './creatorPerformanceTelemetry';

export type ReadinessStatus = 'pass' | 'warn' | 'fail';
export type ReadinessGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export type ReadinessCheck = {
  id: string;
  category:
    | 'startup'
    | 'integration'
    | 'persistence'
    | 'governance'
    | 'notification'
    | 'observability'
    | 'alerting'
    | 'warm_start'
    | 'analytics'
    | 'feature_flag';
  status: ReadinessStatus;
  message: string;
  remediation?: string;
};

export type ReadinessReport = {
  overall: ReadinessStatus;
  grade: ReadinessGrade;
  score: number;                  // 0..100
  totalChecks: number;
  passCount: number;
  warnCount: number;
  failCount: number;
  checks: ReadinessCheck[];
  failureList: string[];          // actionable failure messages
  computedAt: string;
};

const STATUS_SCORE: Record<ReadinessStatus, number> = {
  pass: 1.0,
  warn: 0.5,
  fail: 0.0,
};

function gradeFromScore(score: number): ReadinessGrade {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function rollupStatus(checks: ReadinessCheck[]): ReadinessStatus {
  if (checks.some((c) => c.status === 'fail')) return 'fail';
  if (checks.some((c) => c.status === 'warn')) return 'warn';
  return 'pass';
}

function flagEnabled(flag: string): boolean {
  return String(process.env[flag] ?? 'false').toLowerCase() === 'true';
}

/* ── Per-subsystem readiness probes ─────────────────────────────────── */

function checkIntegration(): ReadinessCheck {
  const h = integrationHealth();
  return {
    id: 'integration.runtime',
    category: 'integration',
    status: h.runtimeEnabled ? 'pass' : 'warn',
    message: h.runtimeEnabled ? 'Runtime integration enabled' : 'Runtime integration disabled (no-op mode)',
    remediation: h.runtimeEnabled ? undefined : 'Set ENTERPRISE_GOVERNANCE_RUNTIME_ENABLED=true to activate runtime hooks',
  };
}

function checkPersistence(): ReadinessCheck[] {
  const d = persistenceDiagnostics();
  const out: ReadinessCheck[] = [];
  if (!d.enabled) {
    out.push({
      id: 'persistence.redis_enabled',
      category: 'persistence',
      status: 'warn',
      message: 'Redis persistence disabled — workflow state is process-local only',
      remediation: 'Set ENTERPRISE_GOVERNANCE_REDIS_ENABLED=true for cross-instance state',
    });
  } else if (d.disabled) {
    out.push({
      id: 'persistence.circuit_breaker',
      category: 'persistence',
      status: 'fail',
      message: 'Redis persistence circuit-breaker tripped',
      remediation: 'Investigate Redis connectivity; restart worker after Redis is healthy',
    });
  } else if (d.consecutiveFailures > 0) {
    out.push({
      id: 'persistence.transient_failures',
      category: 'persistence',
      status: 'warn',
      message: `Redis persistence has ${d.consecutiveFailures} consecutive failures`,
      remediation: 'Monitor Redis latency; failures resolve automatically once Redis recovers',
    });
  } else {
    out.push({
      id: 'persistence.healthy',
      category: 'persistence',
      status: 'pass',
      message: 'Redis persistence healthy',
    });
  }
  return out;
}

function checkLocking(): ReadinessCheck {
  const d = lockingDiagnostics();
  if (d.disabled) {
    return {
      id: 'locking.distributed',
      category: 'persistence',
      status: 'fail',
      message: 'Distributed lock service circuit-breaker tripped',
      remediation: 'Investigate Redis connectivity; locks fall back to in-process Maps until recovery',
    };
  }
  if (!d.enabled) {
    return {
      id: 'locking.local_fallback',
      category: 'persistence',
      status: 'warn',
      message: 'Distributed locks using local fallback (single-instance only)',
      remediation: 'Enable ENTERPRISE_GOVERNANCE_REDIS_ENABLED=true for multi-instance correctness',
    };
  }
  return {
    id: 'locking.distributed',
    category: 'persistence',
    status: 'pass',
    message: 'Distributed locking healthy',
  };
}

function checkNotifications(): ReadinessCheck[] {
  const d = notificationDeliveryDiagnostics();
  const out: ReadinessCheck[] = [];
  if (d.enabled && !d.subscribed) {
    out.push({
      id: 'notification.subscriber',
      category: 'notification',
      status: 'fail',
      message: 'Notification delivery enabled but subscriber not registered',
      remediation: 'Worker boot must call startNotificationDelivery() — check startWorkers.ts wiring',
    });
  } else if (!d.enabled) {
    out.push({
      id: 'notification.subscriber',
      category: 'notification',
      status: 'warn',
      message: 'Notification delivery disabled — events not routed to operator queue',
      remediation: 'Set ENTERPRISE_GOVERNANCE_NOTIFY_ENABLED=true to activate notifications',
    });
  } else {
    out.push({
      id: 'notification.subscriber',
      category: 'notification',
      status: 'pass',
      message: 'Notification subscriber active',
    });
  }
  if (d.queueSize > d.queueMax * 0.9) {
    out.push({
      id: 'notification.queue_pressure',
      category: 'notification',
      status: 'warn',
      message: `Notification queue at ${((d.queueSize / d.queueMax) * 100).toFixed(0)}% capacity`,
      remediation: 'Operators should acknowledge notifications to clear the queue',
    });
  }
  return out;
}

function checkWarmStart(): ReadinessCheck {
  const d = warmStartDiagnostics();
  if (!d.enabled) {
    return {
      id: 'warm_start.disabled',
      category: 'warm_start',
      status: 'warn',
      message: 'Warm-start restoration disabled — recent review state lost on restart',
      remediation: 'Enable ENTERPRISE_GOVERNANCE_WARM_START_ENABLED=true for restart continuity',
    };
  }
  if (!d.alreadyRan) {
    return {
      id: 'warm_start.not_yet_run',
      category: 'warm_start',
      status: 'warn',
      message: 'Warm-start enabled but has not yet executed',
      remediation: 'Wait for worker boot completion; or invoke restoreReviewRecordsFromRedis() manually',
    };
  }
  return {
    id: 'warm_start.complete',
    category: 'warm_start',
    status: 'pass',
    message: 'Warm-start restoration complete',
  };
}

function checkObservability(): ReadinessCheck[] {
  const events = eventBufferDiagnostics();
  const review = reviewStoreStats();
  const escalations = escalationStats();
  const out: ReadinessCheck[] = [];

  if (events.size > events.max * 0.9) {
    out.push({
      id: 'observability.event_buffer_pressure',
      category: 'observability',
      status: 'warn',
      message: `Event ring buffer at ${((events.size / events.max) * 100).toFixed(0)}% capacity`,
      remediation: 'Buffer auto-evicts oldest; warning indicates unusually high event rate',
    });
  } else {
    out.push({
      id: 'observability.event_buffer',
      category: 'observability',
      status: 'pass',
      message: `Event buffer healthy (${events.size}/${events.max})`,
    });
  }

  if (review.size >= review.maxRecords * 0.95) {
    out.push({
      id: 'observability.review_store_pressure',
      category: 'observability',
      status: 'warn',
      message: `Review store at ${((review.size / review.maxRecords) * 100).toFixed(0)}% capacity`,
      remediation: 'Review store auto-evicts oldest at 100%; consider raising cap if pressure persists',
    });
  } else {
    out.push({
      id: 'observability.review_store',
      category: 'observability',
      status: 'pass',
      message: `Review store healthy (${review.size}/${review.maxRecords})`,
    });
  }

  if (escalations.totalEscalations >= escalations.maxPerOrg * 0.9 * 5) {
    // Heuristic: assume up to ~5 orgs in dev. Real threshold should be tuned per org count.
    out.push({
      id: 'observability.escalation_pressure',
      category: 'observability',
      status: 'warn',
      message: `Escalation store has ${escalations.totalEscalations} active entries`,
    });
  } else {
    out.push({
      id: 'observability.escalation_store',
      category: 'observability',
      status: 'pass',
      message: `Escalation store healthy (${escalations.totalEscalations} active)`,
    });
  }

  return out;
}

function checkAlerting(): ReadinessCheck {
  const d = alertingDiagnostics();
  return {
    id: 'alerting.active',
    category: 'alerting',
    status: d.activeAlerts < d.maxActiveAlerts * 0.9 ? 'pass' : 'warn',
    message: `Alerting active (${d.activeAlerts}/${d.maxActiveAlerts} alerts)`,
    remediation: d.activeAlerts >= d.maxActiveAlerts * 0.9
      ? 'Active alert state near capacity — investigate root causes' : undefined,
  };
}

function checkAnalytics(): ReadinessCheck {
  const d = telemetryStats();
  return {
    id: 'analytics.telemetry',
    category: 'analytics',
    status: d.orgCount < d.maxOrgs * 0.95 ? 'pass' : 'warn',
    message: `Telemetry healthy (${d.orgCount}/${d.maxOrgs} orgs tracked)`,
  };
}

function checkFeatureFlags(): ReadinessCheck[] {
  const out: ReadinessCheck[] = [];
  const runtimeOn = flagEnabled('ENTERPRISE_GOVERNANCE_RUNTIME_ENABLED');
  const notifyOn = flagEnabled('ENTERPRISE_GOVERNANCE_NOTIFY_ENABLED');
  const warmStartOn = flagEnabled('ENTERPRISE_GOVERNANCE_WARM_START_ENABLED');
  const redisOn = flagEnabled('ENTERPRISE_GOVERNANCE_REDIS_ENABLED');

  // Notify enabled without runtime is a misconfiguration — events never emit.
  if (notifyOn && !runtimeOn) {
    out.push({
      id: 'feature_flag.notify_without_runtime',
      category: 'feature_flag',
      status: 'warn',
      message: 'NOTIFY enabled but RUNTIME disabled — no events will be produced',
      remediation: 'Enable ENTERPRISE_GOVERNANCE_RUNTIME_ENABLED=true to emit events for notifications',
    });
  }
  // Warm-start enabled without Redis is a no-op — warn.
  if (warmStartOn && !redisOn) {
    out.push({
      id: 'feature_flag.warm_start_without_redis',
      category: 'feature_flag',
      status: 'warn',
      message: 'WARM_START enabled but REDIS disabled — restoration will no-op',
      remediation: 'Enable ENTERPRISE_GOVERNANCE_REDIS_ENABLED=true for warm-start to function',
    });
  }
  if (out.length === 0) {
    out.push({
      id: 'feature_flag.consistent',
      category: 'feature_flag',
      status: 'pass',
      message: 'Feature flag combinations consistent',
    });
  }
  return out;
}

/* ── Public entry point ─────────────────────────────────────────────── */

export function computeReadinessReport(): ReadinessReport {
  const checks: ReadinessCheck[] = [];

  // Startup probe — always a pass; signals readiness verifier itself loaded.
  checks.push({
    id: 'startup.verifier',
    category: 'startup',
    status: 'pass',
    message: 'Readiness verifier loaded',
  });

  checks.push(checkIntegration());
  checks.push(...checkPersistence());
  checks.push(checkLocking());
  checks.push(...checkNotifications());
  checks.push(checkWarmStart());
  checks.push(...checkObservability());
  checks.push(checkAlerting());
  checks.push(checkAnalytics());
  checks.push(...checkFeatureFlags());

  const passCount = checks.filter((c) => c.status === 'pass').length;
  const warnCount = checks.filter((c) => c.status === 'warn').length;
  const failCount = checks.filter((c) => c.status === 'fail').length;

  const score = Math.round(
    (checks.reduce((acc, c) => acc + STATUS_SCORE[c.status], 0) / checks.length) * 100,
  );
  const overall = rollupStatus(checks);
  const failureList = checks
    .filter((c) => c.status === 'fail' || c.status === 'warn')
    .map((c) => `[${c.status.toUpperCase()}] ${c.id}: ${c.message}${c.remediation ? ` — ${c.remediation}` : ''}`);

  return {
    overall,
    grade: gradeFromScore(score),
    score,
    totalChecks: checks.length,
    passCount,
    warnCount,
    failCount,
    checks,
    failureList,
    computedAt: new Date().toISOString(),
  };
}
