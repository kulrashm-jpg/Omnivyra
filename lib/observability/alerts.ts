/**
 * Alerting System
 *
 * Sends alerts when critical conditions occur:
 * - Redis failure rate exceeds threshold
 * - Circuit breaker opens
 * - Retry budget exceeded
 * - Timeouts occurring
 *
 * 📤 CHANNELS:
 * - Slack (real-time notifications)
 * - Email (summary notifications)
 * - Webhook (custom integrations)
 * - Custom handlers
 *
 * 🎯 ALERT LEVELS:
 * - CRITICAL: Immediate action required (system down)
 * - SEVERE: Degraded service (significant impact)
 * - WARNING: Potential issue (monitor closely)
 * - INFO: Informational (for awareness)
 */

/**
 * Alert severity
 */
export enum AlertSeverity {
  CRITICAL = 'CRITICAL',
  SEVERE = 'SEVERE',
  WARNING = 'WARNING',
  INFO = 'INFO',
}

/**
 * Alert type
 */
export enum AlertType {
  REDIS_DOWN = 'REDIS_DOWN',
  REDIS_SLOW = 'REDIS_SLOW',
  HIGH_FAILURE_RATE = 'HIGH_FAILURE_RATE',
  CIRCUIT_BREAKER_OPEN = 'CIRCUIT_BREAKER_OPEN',
  RETRY_BUDGET_EXCEEDED = 'RETRY_BUDGET_EXCEEDED',
  TIMEOUT_THRESHOLD_EXCEEDED = 'TIMEOUT_THRESHOLD_EXCEEDED',
  CUSTOM = 'CUSTOM',
}

/**
 * Alert message
 */
export interface Alert {
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  context: Record<string, any>;
  timestamp: number;
  id: string;
}

/**
 * Alert handler interface
 */
export interface AlertHandler {
  name: string;
  canHandle(alert: Alert): boolean;
  send(alert: Alert): Promise<void>;
}

/**
 * Slack alert handler
 */
export class SlackAlertHandler implements AlertHandler {
  name = 'slack';
  private webhookUrl: string;

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  canHandle(alert: Alert): boolean {
    // Send all alerts to Slack
    return true;
  }

  async send(alert: Alert): Promise<void> {
    if (!this.webhookUrl) {
      console.warn('[slack-alert] Webhook URL not configured');
      return;
    }

    const color = {
      [AlertSeverity.CRITICAL]: '#FF0000',
      [AlertSeverity.SEVERE]: '#FF6600',
      [AlertSeverity.WARNING]: '#FFCC00',
      [AlertSeverity.INFO]: '#0099FF',
    }[alert.severity];

    const payload = {
      attachments: [
        {
          color,
          title: `${alert.severity} - ${alert.title}`,
          text: alert.message,
          fields: Object.entries(alert.context).map(([key, value]) => ({
            title: key,
            value: String(value),
            short: true,
          })),
          ts: Math.floor(alert.timestamp / 1000),
        },
      ],
    };

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(`[slack-alert] Failed to send alert: ${response.statusText}`);
      }
    } catch (error) {
      console.error('[slack-alert] Error sending alert', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Email alert handler
 */
export class EmailAlertHandler implements AlertHandler {
  name = 'email';
  private recipients: string[];
  private smtpEndpoint?: string;

  constructor(recipients: string[], smtpEndpoint?: string) {
    this.recipients = recipients;
    this.smtpEndpoint = smtpEndpoint;
  }

  canHandle(alert: Alert): boolean {
    // Send critical/severe alerts via email
    return alert.severity === AlertSeverity.CRITICAL || alert.severity === AlertSeverity.SEVERE;
  }

  async send(alert: Alert): Promise<void> {
    if (this.recipients.length === 0) {
      console.warn('[email-alert] No recipients configured');
      return;
    }

    const body = `
Alert: ${alert.severity} - ${alert.title}

Message: ${alert.message}

Details:
${Object.entries(alert.context)
  .map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`)
  .join('\n')}

Time: ${new Date(alert.timestamp).toISOString()}
    `.trim();

    console.info('[email-alert] Email would be sent', {
      to: this.recipients,
      subject: `${alert.severity} Alert: ${alert.title}`,
    });

    // In production, integrate with actual email service
    // Example: SendGrid, AWS SES, etc.
  }
}

/**
 * Webhook alert handler
 */
export class WebhookAlertHandler implements AlertHandler {
  name = 'webhook';
  private url: string;
  private customHeaders?: Record<string, string>;

  constructor(url: string, customHeaders?: Record<string, string>) {
    this.url = url;
    this.customHeaders = customHeaders;
  }

  canHandle(alert: Alert): boolean {
    return true;
  }

  async send(alert: Alert): Promise<void> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...this.customHeaders,
      };

      const response = await fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(alert),
      });

      if (!response.ok) {
        console.error(`[webhook-alert] Failed: ${response.statusText}`);
      }
    } catch (error) {
      console.error('[webhook-alert] Error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Console alert handler (for debugging)
 */
export class ConsoleAlertHandler implements AlertHandler {
  name = 'console';

  canHandle(alert: Alert): boolean {
    return true;
  }

  async send(alert: Alert): Promise<void> {
    const colorCode = {
      [AlertSeverity.CRITICAL]: '\x1b[41m',  // Red background
      [AlertSeverity.SEVERE]: '\x1b[43m',    // Yellow background
      [AlertSeverity.WARNING]: '\x1b[44m',   // Blue background
      [AlertSeverity.INFO]: '\x1b[46m',      // Cyan background
    }[alert.severity];

    const resetCode = '\x1b[0m';

    console.error(
      `${colorCode}[ALERT] ${alert.severity}: ${alert.title}${resetCode}`,
      alert.message,
      alert.context
    );
  }
}

/**
 * Alert manager
 */
export class AlertManager {
  private handlers: AlertHandler[] = [];
  private alertHistory: Alert[] = [];
  private recentAlerts = new Map<string, number>();
  private sendingAlerts = new Set<string>(); // PRODUCTION FIX: Prevent concurrent sends
  private readonly maxHistorySize = 1000;
  private readonly deduplicationWindow = 60000; // 1 minute

  /**
   * Register alert handler
   */
  registerHandler(handler: AlertHandler) {
    this.handlers.push(handler);
    console.info(`[alert] Registered handler: ${handler.name}`);
  }

  /**
   * Send alert
   * PRODUCTION FIX: Atomic deduplication, prevents race conditions
   */
  async sendAlert(alert: Omit<Alert, 'timestamp' | 'id'>): Promise<void> {
    const fullAlert: Alert = {
      ...alert,
      timestamp: Date.now(),
      id: `${alert.type}-${Date.now()}`,
    };

    // PRODUCTION FIX: Deterministic key for deduplication
    // Includes type and severity (not full context to avoid noise)
    const deduplicationKey = `${alert.type}:${alert.severity}`;
    const lastSent = this.recentAlerts.get(deduplicationKey);

    // Check deduplication window
    if (lastSent && Date.now() - lastSent < this.deduplicationWindow) {
      console.debug('[alert] Duplicate alert suppressed', {
        type: alert.type,
        severity: alert.severity,
        timeSinceLastAlert: Date.now() - lastSent,
      });
      return;
    }

    // PRODUCTION FIX: Prevent concurrent sends of same alert type
    if (this.sendingAlerts.has(deduplicationKey)) {
      console.debug('[alert] Alert already being sent', { type: alert.type });
      return;
    }

    this.sendingAlerts.add(deduplicationKey);

    try {
      // Update last sent time
      this.recentAlerts.set(deduplicationKey, Date.now());

      // Add to history
      this.alertHistory.push(fullAlert);
      if (this.alertHistory.length > this.maxHistorySize) {
        this.alertHistory.shift();
      }

      // Send through all matching handlers
      const promises = this.handlers
        .filter(h => h.canHandle(fullAlert))
        .map(h => {
          return h.send(fullAlert).catch(error => {
            console.error(`[alert] Handler "${h.name}" failed`, {
              error: error instanceof Error ? error.message : String(error),
            });
          });
        });

      await Promise.all(promises);
    } finally {
      // PRODUCTION FIX: Clean up sending set
      this.sendingAlerts.delete(deduplicationKey);
    }
  }

  /**
   * Get alert history
   */
  getHistory(limit: number = 100): Alert[] {
    return this.alertHistory.slice(-limit);
  }

  /**
   * Get alerts by type
   */
  getAlertsByType(type: AlertType): Alert[] {
    return this.alertHistory.filter(a => a.type === type);
  }

  /**
   * Get critical alerts
   */
  getCriticalAlerts(timeWindow: number = 3600000): Alert[] {
    const since = Date.now() - timeWindow;
    return this.alertHistory.filter(
      a => a.severity === AlertSeverity.CRITICAL && a.timestamp > since
    );
  }

  /**
   * Clear history
   */
  clearHistory() {
    this.alertHistory = [];
    this.recentAlerts.clear();
  }
}

/**
 * Global alert manager
 */
const alertManager = new AlertManager();

/**
 * Get or create alert manager
 */
export function getAlertManager(): AlertManager {
  return alertManager;
}

/**
 * Send alert
 */
export async function sendAlert(
  type: AlertType,
  severity: AlertSeverity,
  title: string,
  message: string,
  context: Record<string, any> = {}
) {
  return alertManager.sendAlert({
    type,
    severity,
    title,
    message,
    context,
  });
}

/**
 * Quick alert helpers
 */
export const QuickAlerts = {
  /**
   * Redis is down
   */
  redisDown: (context: Record<string, any>) =>
    sendAlert(
      AlertType.REDIS_DOWN,
      AlertSeverity.CRITICAL,
      'Redis is Down',
      'Redis connection failed. Critical operations cannot proceed.',
      context
    ),

  /**
   * Redis is slow
   */
  redisSlow: (latencyMs: number, thresholdMs: number) =>
    sendAlert(
      AlertType.REDIS_SLOW,
      AlertSeverity.WARNING,
      'Redis Latency High',
      `Redis latency (${latencyMs}ms) exceeded threshold (${thresholdMs}ms)`,
      { latencyMs, thresholdMs }
    ),

  /**
   * High failure rate
   */
  highFailureRate: (failureRate: number, threshold: number) =>
    sendAlert(
      AlertType.HIGH_FAILURE_RATE,
      AlertSeverity.SEVERE,
      'High Failure Rate Detected',
      `Operation failure rate ${failureRate}% exceeds threshold ${threshold}%`,
      { failureRate, threshold }
    ),

  /**
   * Circuit breaker opened
   */
  circuitBreakerOpened: (name: string, context: Record<string, any>) =>
    sendAlert(
      AlertType.CIRCUIT_BREAKER_OPEN,
      AlertSeverity.SEVERE,
      `Circuit Breaker Opened: ${name}`,
      `Circuit breaker for ${name} is now OPEN. Failing fast to prevent cascading failures.`,
      { circuitName: name, ...context }
    ),

  /**
   * Retry budget exceeded
   */
  retryBudgetExceeded: (component: string, budget: number) =>
    sendAlert(
      AlertType.RETRY_BUDGET_EXCEEDED,
      AlertSeverity.WARNING,
      `Retry Budget Exceeded: ${component}`,
      `Component ${component} has exceeded retry budget of ${budget}/minute`,
      { component, budget }
    ),
};
