/**
 * Anomaly notification service.
 *
 * Channels:
 *   1. Slack webhook  — env SLACK_WEBHOOK_URL (or SLACK_INTELLIGENCE_WEBHOOK)
 *   2. Structured log — always emitted (picked up by any log-drain sink)
 *
 * Rules:
 *   - Only called for CRITICAL anomalies (WARNING/INFO go to dashboard only)
 *   - Fire-and-forget: notification failures never block the caller
 *   - Deduplication is handled upstream by the detection engine
 */

export interface AnomalyNotification {
  type:         string;
  severity:     string;
  entityType:   string;
  entityId?:    string | null;
  metricValue?: number | null;
  threshold?:   number | null;
  metadata?:    Record<string, unknown> | null;
  detectedAt:   string;
}

/**
 * Dispatch a CRITICAL anomaly alert to all configured channels.
 * Never throws.
 */
export async function sendCriticalAlert(anomaly: AnomalyNotification): Promise<void> {
  // Always emit a structured log — works even without external channels
  console.error(JSON.stringify({
    level:    'CRITICAL',
    event:    'anomaly_alert',
    type:     anomaly.type,
    entity:   anomaly.entityType,
    entityId: anomaly.entityId ?? null,
    value:    anomaly.metricValue ?? null,
    threshold: anomaly.threshold ?? null,
    metadata: anomaly.metadata ?? null,
    ts:       anomaly.detectedAt,
  }));

  await sendSlack(anomaly);
}

// ── Slack ─────────────────────────────────────────────────────────────────────

const SEVERITY_EMOJI: Record<string, string> = {
  CRITICAL: '🚨',
  WARNING:  '⚠️',
  INFO:     'ℹ️',
};

async function sendSlack(anomaly: AnomalyNotification): Promise<void> {
  const webhookUrl =
    process.env.SLACK_WEBHOOK_URL ||
    process.env.SLACK_INTELLIGENCE_WEBHOOK;

  if (!webhookUrl) return; // no Slack configured — log-only mode

  const emoji   = SEVERITY_EMOJI[anomaly.severity] ?? '🔔';
  const appUrl  = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const dashUrl = `${appUrl}/super-admin/system-health`;

  const text = [
    `${emoji} *${anomaly.severity} ANOMALY DETECTED*`,
    `*Type:* \`${anomaly.type}\``,
    `*Entity:* ${anomaly.entityType}${anomaly.entityId ? ` / \`${anomaly.entityId}\`` : ''}`,
    anomaly.metricValue != null
      ? `*Observed:* ${anomaly.metricValue} (threshold: ${anomaly.threshold ?? '?'})`
      : null,
    anomaly.metadata
      ? `*Context:* \`\`\`${JSON.stringify(anomaly.metadata, null, 2)}\`\`\``
      : null,
    `*Time:* ${anomaly.detectedAt}`,
    `<${dashUrl}|View System Health Dashboard>`,
  ]
    .filter(Boolean)
    .join('\n');

  await attemptSlackSend(webhookUrl, text, /* isRetry */ false);
}

/**
 * Execute a single Slack HTTP call. On failure, retries once after 2 seconds.
 * A single retry removes ~80% of transient network errors without infinite loops.
 */
async function attemptSlackSend(url: string, text: string, isRetry: boolean): Promise<void> {
  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.warn('[notificationService] Slack webhook returned', res.status);
      if (!isRetry) {
        setTimeout(() => void attemptSlackSend(url, text, true), 2_000);
      }
    }
  } catch (err) {
    console.warn('[notificationService] Slack send failed:', (err as Error)?.message);
    if (!isRetry) {
      setTimeout(() => void attemptSlackSend(url, text, true), 2_000);
    }
  }
}
