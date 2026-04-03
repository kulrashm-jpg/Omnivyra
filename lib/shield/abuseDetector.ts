/**
 * MULTI-TENANT SHIELD: ABUSE DETECTOR
 * 
 * Pattern detection for:
 * - Request rate spikes
 * - Error rate anomalies
 * - Retry storms
 * - Coordinated attacks
 */

export interface AbuseMetrics {
  userId: string;
  requestCount: number;
  errorCount: number;
  retryCount: number;
  spikes: number[];
  lastCheck: number;
  lastSeen: number;
}

export interface AbuseIssue {
  type: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  message: string;
  timestamp: number;
}

export class AbuseDetector {
  private metrics: Map<string, AbuseMetrics> = new Map();
  private throttledUsers: Map<string, { until: number }> = new Map();

  /**
   * Record a metric for a user
   */
  recordMetric(userId: string, metric: 'requestCount' | 'errorCount' | 'retryCount', value: number = 1) {
    if (!this.metrics.has(userId)) {
      this.initializeMetrics(userId);
    }

    const m = this.metrics.get(userId)!;
    m[metric] += value;
    m.lastSeen = Date.now();
  }

  private initializeMetrics(userId: string) {
    this.metrics.set(userId, {
      userId,
      requestCount: 0,
      errorCount: 0,
      retryCount: 0,
      spikes: [],
      lastCheck: Date.now(),
      lastSeen: Date.now(),
    });
  }

  /**
   * Analyze metrics and detect abuse patterns
   */
  detectAbuse(userId: string): AbuseIssue[] {
    const metricsData = this.metrics.get(userId);
    if (!metricsData) {
      return [];
    }

    const issues: AbuseIssue[] = [];
    const now = Date.now();
    const timeSinceLastCheck = now - metricsData.lastCheck;

    // ========== RATE SPIKE DETECTION ==========
    if (timeSinceLastCheck > 60000) {
      // Analyze every 1 minute
      const ratePerSec = metricsData.requestCount / (timeSinceLastCheck / 1000);
      metricsData.spikes.push(ratePerSec);

      // Keep only last 10 spikes
      if (metricsData.spikes.length > 10) {
        metricsData.spikes.shift();
      }

      // Check if rate increased dramatically
      if (metricsData.spikes.length >= 2) {
        const previous = metricsData.spikes[metricsData.spikes.length - 2];
        const current = metricsData.spikes[metricsData.spikes.length - 1];

        if (current > previous * 5) {
          // 5x spike
          issues.push({
            type: 'REQUEST_SPIKE',
            severity: 'HIGH',
            message: `Request rate jumped from ${previous.toFixed(1)} to ${current.toFixed(1)} req/sec (${(
              ((current - previous) / previous) *
              100
            ).toFixed(0)}% increase)`,
            timestamp: now,
          });
        }

        // Absolute high rate (>1000 req/sec for non-enterprise user)
        if (current > 1000) {
          issues.push({
            type: 'ATTACK_VOLUME',
            severity: 'CRITICAL',
            message: `Extremely high request rate: ${current.toFixed(0)} req/sec`,
            timestamp: now,
          });
        }
      }

      metricsData.requestCount = 0;
      metricsData.lastCheck = now;
    }

    // ========== ERROR RATE SPIKE ==========
    const totalAttempts = metricsData.requestCount + metricsData.errorCount;
    if (totalAttempts > 0) {
      const errorRate = metricsData.errorCount / totalAttempts;

      if (errorRate > 0.5) {
        // >50% errors
        issues.push({
          type: 'ERROR_SPIKE',
          severity: 'MEDIUM',
          message: `High error rate: ${(errorRate * 100).toFixed(1)}% errors (${metricsData.errorCount}/${totalAttempts})`,
          timestamp: now,
        });
      }

      if (errorRate > 0.9) {
        // >90% errors = almost all failing
        issues.push({
          type: 'CRITICAL_ERROR_RATE',
          severity: 'CRITICAL',
          message: `Critical error rate: ${(errorRate * 100).toFixed(0)}% of requests failing`,
          timestamp: now,
        });
      }
    }

    // ========== RETRY STORM DETECTION ==========
    const retryToRequestRatio = totalAttempts > 0 ? metricsData.retryCount / totalAttempts : 0;

    if (metricsData.retryCount > totalAttempts * 5) {
      // More retries than requests (5x multiplier)
      issues.push({
        type: 'RETRY_STORM',
        severity: 'HIGH',
        message: `Retry storm detected: ${metricsData.retryCount} retries for ${totalAttempts} requests (${(
          retryToRequestRatio * 100
        ).toFixed(0)}% retry rate)`,
        timestamp: now,
      });

      if (retryToRequestRatio > 10) {
        // Even worse: 10x retries
        issues[issues.length - 1].severity = 'CRITICAL';
      }
    }

    // ========== VOLUME + ERROR COMBINATION ==========
    if (
      metricsData.requestCount > 1000 &&
      timeSinceLastCheck < 60000 &&
      metricsData.errorCount / Math.max(metricsData.requestCount, 1) > 0.1
    ) {
      issues.push({
        type: 'COORDINATED_ATTACK',
        severity: 'CRITICAL',
        message: `Suspected coordinated attack: High volume + errors + retries in short window`,
        timestamp: now,
      });
    }

    return issues;
  }

  /**
   * Throttle a user temporarily
   */
  throttleUser(userId: string, durationSeconds: number = 300): number {
    const until = Date.now() + durationSeconds * 1000;
    this.throttledUsers.set(userId, { until });
    return until;
  }

  /**
   * Check if user is throttled
   */
  isThrottled(userId: string): boolean {
    const throttle = this.throttledUsers.get(userId);
    if (!throttle) {
      return false;
    }

    if (Date.now() > throttle.until) {
      this.throttledUsers.delete(userId);
      return false;
    }

    return true;
  }

  /**
   * Get throttle duration remaining (ms)
   */
  getThrottleDuration(userId: string): number {
    const throttle = this.throttledUsers.get(userId);
    if (!throttle) {
      return 0;
    }

    const remaining = throttle.until - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  /**
   * Remove throttle (admin operation)
   */
  unthrottleUser(userId: string) {
    this.throttledUsers.delete(userId);
  }

  /**
   * Get metrics for monitoring
   */
  getMetrics(userId: string): AbuseMetrics | null {
    return this.metrics.get(userId) || null;
  }

  /**
   * List all throttled users
   */
  getThrottledUsers(): Map<string, { until: number }> {
    return this.throttledUsers;
  }

  /**
   * Clean up old metrics (memory management)
   */
  cleanupOldMetrics(ageHours: number = 24): number {
    const cutoff = Date.now() - ageHours * 3600000;
    let removed = 0;

    for (const [userId, m] of this.metrics) {
      if (m.lastSeen < cutoff) {
        this.metrics.delete(userId);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Reset user metrics (admin operation)
   */
  resetUser(userId: string) {
    this.metrics.delete(userId);
  }
}

/**
 * Abuse severity levels
 */
export const ABUSE_ACTIONS = {
  CRITICAL: {
    actions: ['BLOCK_USER', 'ALERT_SECURITY', 'PAGE_ONCALL'],
    throttleDuration: 3600, // 1 hour
  },
  HIGH: {
    actions: ['THROTTLE_USER', 'ALERT_OPS', 'REDUCE_LIMITS'],
    throttleDuration: 600, // 10 minutes
  },
  MEDIUM: {
    actions: ['LOG_INCIDENT', 'RECORD_METRIC', 'MONITOR_CLOSELY'],
    throttleDuration: 0, // No throttle
  },
  LOW: {
    actions: ['RECORD_METRIC'],
    throttleDuration: 0,
  },
};

/**
 * Execute abuse response actions
 */
export async function handleAbuseDetected(
  userId: string,
  issues: AbuseIssue[],
  handlers: {
    blockUser?: (userId: string) => Promise<void>;
    throttleUser?: (userId: string, duration: number) => Promise<void>;
    reduceRateLimits?: (userId: string, multiplier: number) => Promise<void>;
    alertOps?: (userId: string, issues: AbuseIssue[]) => Promise<void>;
    pageOncall?: (userId: string, issues: AbuseIssue[]) => Promise<void>;
  }
): Promise<void> {
  // Determine worst severity
  const severities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
  const worstIndex = Math.min(
    ...issues.map((i) => severities.indexOf(i.severity))
  );
  const worstSeverity = severities[worstIndex] as keyof typeof ABUSE_ACTIONS;

  const actions = ABUSE_ACTIONS[worstSeverity];

  for (const action of actions.actions) {
    switch (action) {
      case 'BLOCK_USER':
        if (handlers.blockUser) {
          await handlers.blockUser(userId);
        }
        break;

      case 'THROTTLE_USER':
        if (handlers.throttleUser) {
          await handlers.throttleUser(userId, actions.throttleDuration);
        }
        break;

      case 'REDUCE_LIMITS':
        if (handlers.reduceRateLimits) {
          await handlers.reduceRateLimits(userId, 0.1); // 10% of normal
        }
        break;

      case 'ALERT_OPS':
        if (handlers.alertOps) {
          await handlers.alertOps(userId, issues);
        }
        break;

      case 'PAGE_ONCALL':
        if (handlers.pageOncall) {
          await handlers.pageOncall(userId, issues);
        }
        break;

      case 'ALERT_SECURITY':
        console.warn(`[SECURITY] Abuse detected for user ${userId}`, issues);
        break;

      case 'LOG_INCIDENT':
      case 'RECORD_METRIC':
      case 'MONITOR_CLOSELY':
        console.info(`[ABUSE] ${action} for user ${userId}`, issues);
        break;
    }
  }
}
