import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { getAnalyticsReadiness } from './analyticsDataReadinessService';
import { getDropOffPages, getTrafficSources } from './behaviorAnalyticsService';
import { sendDeterministicIntelligenceAlert } from './intelligenceAlertService';

export type BehaviorAlertType =
  | 'drop_off_spike'
  | 'conversion_drop'
  | 'low_quality_traffic';

export type BehaviorAlertSeverity = 'high' | 'medium';

export interface BehaviorAlert {
  type: BehaviorAlertType;
  severity: BehaviorAlertSeverity;
  message: string;
  timestamp: string;
  context?: Record<string, string | number | null>;
}

export interface BehaviorAlertEvaluationResult {
  ready: boolean;
  alerts: BehaviorAlert[];
  sent: number;
  deduplicated: number;
  rate_limited: number;
}

const DROP_OFF_ENTRY_THRESHOLD = 10;
const DROP_OFF_SPIKE_THRESHOLD = 0.6;
const CONVERSION_DROP_THRESHOLD = 0.3;
const TRAFFIC_SESSION_THRESHOLD = 20;
const TRAFFIC_NEAR_ZERO_CONVERSION_RATE = 0.01;
const ALERT_COOLDOWN_HOURS = 24;

async function getSessionsCount(companyId: string, startIso: string, endIso: string): Promise<number> {
  const { count = 0, error } = await supabase
    .from('canonical_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .gte('started_at', startIso)
    .lt('started_at', endIso);

  if (error) {
    throw new Error(`Failed to load session counts for behavior alerts: ${error.message}`);
  }

  return count ?? 0;
}

async function getConversionsCount(companyId: string, startIso: string, endIso: string): Promise<number> {
  const { count = 0, error } = await supabase
    .from('canonical_conversions')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .gte('conversion_timestamp', startIso)
    .lt('conversion_timestamp', endIso);

  if (error) {
    throw new Error(`Failed to load conversion counts for behavior alerts: ${error.message}`);
  }

  return count ?? 0;
}

function safeDiv(num: number, den: number): number {
  return den > 0 ? num / den : 0;
}

export async function evaluateBehaviorAlerts(companyId: string): Promise<BehaviorAlertEvaluationResult> {
  const readiness = await getAnalyticsReadiness(companyId);
  if (!readiness.ready) {
    return {
      ready: false,
      alerts: [],
      sent: 0,
      deduplicated: 0,
      rate_limited: 0,
    };
  }

  const alerts: BehaviorAlert[] = [];
  const nowIso = new Date().toISOString();

  const dropOffPages = await getDropOffPages(companyId, { sinceDays: 7 });
  for (const page of dropOffPages) {
    if (page.drop_off_rate > DROP_OFF_SPIKE_THRESHOLD && page.entry_sessions > DROP_OFF_ENTRY_THRESHOLD) {
      alerts.push({
        type: 'drop_off_spike',
        severity: 'high',
        message: `Critical drop-off spike detected on ${page.page_url}`,
        timestamp: nowIso,
        context: {
          page_url: page.page_url,
          drop_off_rate: Number(page.drop_off_rate.toFixed(4)),
          entry_sessions: page.entry_sessions,
          exit_sessions: page.exit_sessions,
        },
      });
    }
  }

  const now = new Date();
  const last7Start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const prev7Start = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const nowIsoBound = now.toISOString();

  const [last7Sessions, prev7Sessions, last7Conversions, prev7Conversions] = await Promise.all([
    getSessionsCount(companyId, last7Start, nowIsoBound),
    getSessionsCount(companyId, prev7Start, last7Start),
    getConversionsCount(companyId, last7Start, nowIsoBound),
    getConversionsCount(companyId, prev7Start, last7Start),
  ]);

  const last7Rate = safeDiv(last7Conversions, last7Sessions);
  const prev7Rate = safeDiv(prev7Conversions, prev7Sessions);
  const conversionRateDrop = prev7Rate > 0 ? 1 - safeDiv(last7Rate, prev7Rate) : 0;

  if (prev7Rate > 0 && conversionRateDrop > CONVERSION_DROP_THRESHOLD) {
    alerts.push({
      type: 'conversion_drop',
      severity: 'high',
      message: `Significant drop in conversion rate detected`,
      timestamp: nowIso,
      context: {
        previous_rate: Number(prev7Rate.toFixed(4)),
        current_rate: Number(last7Rate.toFixed(4)),
        drop_ratio: Number(conversionRateDrop.toFixed(4)),
      },
    });
  }

  const trafficSources = await getTrafficSources(companyId, { sinceDays: 7 });
  for (const source of trafficSources) {
    const conversionRate = safeDiv(source.conversions, source.sessions);
    if (source.sessions >= TRAFFIC_SESSION_THRESHOLD && conversionRate <= TRAFFIC_NEAR_ZERO_CONVERSION_RATE) {
      const sourceLabel =
        source.source_medium && source.source_medium !== 'unknown'
          ? `${source.traffic_source} / ${source.source_medium}`
          : source.traffic_source;

      alerts.push({
        type: 'low_quality_traffic',
        severity: 'medium',
        message: `Traffic is not converting for ${sourceLabel}`,
        timestamp: nowIso,
        context: {
          traffic_source: source.traffic_source,
          source_medium: source.source_medium,
          sessions: source.sessions,
          conversions: source.conversions,
          conversion_rate: Number(conversionRate.toFixed(4)),
        },
      });
    }
  }

  let sent = 0;
  let deduplicated = 0;
  let rateLimited = 0;

  for (const alert of alerts) {
    const result = await sendDeterministicIntelligenceAlert({
      company_id: companyId,
      event_type: alert.type,
      rule_types: [alert.type],
      title: 'Behavior Alert',
      message:
        alert.type === 'conversion_drop' && typeof alert.context?.drop_ratio === 'number'
          ? `Conversion rate dropped by ${Math.round(Number(alert.context.drop_ratio) * 100)}% in last 7 days`
          : alert.message,
      event_data: {
        ...alert.context,
        severity: alert.severity,
        scope_key:
          typeof alert.context?.page_url === 'string'
            ? alert.context.page_url
            : typeof alert.context?.traffic_source === 'string'
              ? `${alert.context.traffic_source}|${String(alert.context?.source_medium ?? '')}`
              : alert.type,
      },
      channels: ['in_app'],
      cooldown_hours: ALERT_COOLDOWN_HOURS,
    });

    if (result.sent.length > 0) sent += 1;
    else if (result.deduplicated) deduplicated += 1;
    else if (result.rate_limited) rateLimited += 1;
  }

  return {
    ready: true,
    alerts,
    sent,
    deduplicated,
    rate_limited: rateLimited,
  };
}
