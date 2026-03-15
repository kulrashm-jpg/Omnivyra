/**
 * Intelligence Alert Service
 * Notifies users when critical intelligence events occur.
 * Alert rules: opportunity_score > 85, trend_strength > threshold, health_score < 50
 * Channels: in_app, email, slack
 * Dedup: same alert_rule_key within 6 hours is skipped.
 */

import { createHash } from 'crypto';
import { supabase } from '../db/supabaseClient';

export type AlertChannel = 'in_app' | 'email' | 'slack';

export type AlertRuleType =
  | 'opportunity_high'
  | 'trend_strength_high'
  | 'health_score_low';

export interface IntelligenceAlertEvent {
  company_id: string;
  event_type: string;
  /** Fires when > 85 */
  opportunity_score?: number;
  /** Fires when > threshold (default 0.8) */
  trend_strength?: number;
  /** Fires when < 50 */
  health_score?: number;
  /** Additional context */
  title?: string;
  message?: string;
  event_data?: Record<string, unknown>;
  /** Which channels to use (default: ['in_app']) */
  channels?: AlertChannel[];
}

const OPPORTUNITY_THRESHOLD = 85;
const TREND_STRENGTH_THRESHOLD = 0.8;
const HEALTH_SCORE_THRESHOLD = 50;
const ALERTS_PER_HOUR = 5;
const ALERTS_PER_DAY = 20;
const ALERT_DEDUP_HOURS = 6;

export interface FiredAlert {
  rule: AlertRuleType;
  message: string;
}

function evaluateRules(event: IntelligenceAlertEvent): FiredAlert[] {
  const fired: FiredAlert[] = [];

  if (
    typeof event.opportunity_score === 'number' &&
    event.opportunity_score > OPPORTUNITY_THRESHOLD
  ) {
    fired.push({
      rule: 'opportunity_high',
      message: `High-value opportunity detected (score ${event.opportunity_score} > ${OPPORTUNITY_THRESHOLD})`,
    });
  }

  const trendThreshold =
    typeof (event.event_data as { trend_strength_threshold?: number })?.trend_strength_threshold ===
    'number'
      ? (event.event_data as { trend_strength_threshold: number }).trend_strength_threshold
      : TREND_STRENGTH_THRESHOLD;

  if (
    typeof event.trend_strength === 'number' &&
    event.trend_strength > trendThreshold
  ) {
    fired.push({
      rule: 'trend_strength_high',
      message: `Strong trend signal (strength ${event.trend_strength.toFixed(2)} > ${trendThreshold})`,
    });
  }

  if (
    typeof event.health_score === 'number' &&
    event.health_score < HEALTH_SCORE_THRESHOLD
  ) {
    fired.push({
      rule: 'health_score_low',
      message: `Campaign health low (score ${event.health_score} < ${HEALTH_SCORE_THRESHOLD})`,
    });
  }

  return fired;
}

async function isRateLimited(companyId: string): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { count: hourCount } = await supabase
    .from('intelligence_alerts')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .gte('created_at', oneHourAgo);

  if ((hourCount ?? 0) >= ALERTS_PER_HOUR) return true;

  const { count: dayCount } = await supabase
    .from('intelligence_alerts')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .gte('created_at', oneDayAgo);

  return (dayCount ?? 0) >= ALERTS_PER_DAY;
}

function computeAlertRuleKey(
  companyId: string,
  eventType: string,
  fired: FiredAlert[]
): string {
  const rules = fired.map((f) => f.rule).sort().join(',');
  const payload = `${companyId}|${eventType}|${rules}`;
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

async function wasAlertTriggeredRecently(
  alertRuleKey: string,
  companyId: string
): Promise<boolean> {
  const cutoff = new Date(Date.now() - ALERT_DEDUP_HOURS * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('intelligence_alerts')
    .select('id')
    .eq('company_id', companyId)
    .eq('alert_rule_key', alertRuleKey)
    .gte('created_at', cutoff)
    .limit(1)
    .maybeSingle();

  return data != null;
}

async function sendInApp(
  event: IntelligenceAlertEvent,
  fired: FiredAlert[],
  alertRuleKey: string
): Promise<void> {
  const message =
    event.message ??
    fired.map((f) => f.message).join('; ') ??
    'Intelligence alert';

  const { error } = await supabase.from('intelligence_alerts').insert({
    company_id: event.company_id,
    event_type: event.event_type,
    rule_types: fired.map((f) => f.rule),
    alert_rule_key: alertRuleKey,
    title: event.title ?? 'Intelligence Alert',
    message,
    event_data: event.event_data ?? {},
    channels: event.channels ?? ['in_app'],
  });

  if (error) {
    console.warn('[intelligenceAlertService] in_app insert failed:', error.message);
    throw error;
  }
}

async function sendEmail(
  event: IntelligenceAlertEvent,
  fired: FiredAlert[]
): Promise<boolean> {
  const webhookUrl = process.env.INTELLIGENCE_ALERT_EMAIL_WEBHOOK;
  if (!webhookUrl) {
    if (process.env.NODE_ENV !== 'test') {
      console.debug('[intelligenceAlertService] email skipped: no INTELLIGENCE_ALERT_EMAIL_WEBHOOK');
    }
    return false;
  }

  const message =
    event.message ?? fired.map((f) => f.message).join('\n') ?? 'Intelligence alert';

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company_id: event.company_id,
        event_type: event.event_type,
        title: event.title ?? 'Intelligence Alert',
        message,
        rules: fired.map((f) => f.rule),
        event_data: event.event_data,
      }),
    });
    if (!res.ok) throw new Error(`Email webhook failed: ${res.status}`);
    return true;
  } catch (err) {
    console.warn('[intelligenceAlertService] email failed:', err);
    return false;
  }
}

async function sendSlack(
  event: IntelligenceAlertEvent,
  fired: FiredAlert[]
): Promise<boolean> {
  const webhookUrl =
    process.env.SLACK_INTELLIGENCE_WEBHOOK ?? process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    if (process.env.NODE_ENV !== 'test') {
      console.debug('[intelligenceAlertService] slack skipped: no SLACK_INTELLIGENCE_WEBHOOK');
    }
    return false;
  }

  const text =
    event.message ??
    fired.map((f) => f.message).join('\n') ??
    'Intelligence alert';

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `*${event.title ?? 'Intelligence Alert'}*\n${text}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${event.title ?? 'Intelligence Alert'}*\n${text}\nCompany: ${event.company_id}`,
            },
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Slack webhook failed: ${res.status}`);
    return true;
  } catch (err) {
    console.warn('[intelligenceAlertService] slack failed:', err);
    return false;
  }
}

/**
 * Evaluate alert rules and send notifications to configured channels.
 * Rules: opportunity_score > 85, trend_strength > threshold, health_score < 50
 */
export async function sendIntelligenceAlert(
  event: IntelligenceAlertEvent
): Promise<{ fired: FiredAlert[]; sent: AlertChannel[]; rate_limited?: boolean; deduplicated?: boolean }> {
  const fired = evaluateRules(event);
  if (fired.length === 0) {
    return { fired: [], sent: [] };
  }

  if (await isRateLimited(event.company_id)) {
    return { fired, sent: [], rate_limited: true };
  }

  const alertRuleKey = computeAlertRuleKey(event.company_id, event.event_type, fired);
  if (await wasAlertTriggeredRecently(alertRuleKey, event.company_id)) {
    return { fired, sent: [], deduplicated: true };
  }

  const channels = event.channels ?? ['in_app'];
  const sent: AlertChannel[] = [];

  if (channels.includes('in_app')) {
    try {
      await sendInApp(event, fired, alertRuleKey);
      sent.push('in_app');
    } catch {
      // already logged
    }
  }

  if (channels.includes('email') && (await sendEmail(event, fired))) {
    sent.push('email');
  }

  if (channels.includes('slack') && (await sendSlack(event, fired))) {
    sent.push('slack');
  }

  return { fired, sent };
}
