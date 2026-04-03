import crypto from 'crypto';
import { supabase } from '../db/supabaseClient';
import type { ReportCategory } from './reportCardService';
import type { ReportRequestPayload } from './reportInputResolver';
import { evaluateResolvedReportReadiness } from './reportReadinessService';

export type AutomationFrequency = 'weekly' | 'biweekly' | 'monthly';
export type AutomationEventType = 'scheduled' | 'content_change' | 'traffic_change';
export type NotificationEventType = 'improvement' | 'decline' | 'opportunity';

type AutomationConfigRow = {
  id: string;
  user_id: string;
  company_id: string;
  domain: string;
  frequency: AutomationFrequency;
  change_detection_enabled: boolean;
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  last_checked_at: string | null;
  last_triggered_report_id: string | null;
  last_change_snapshot: Record<string, unknown> | null;
};

type SnapshotSignals = {
  unified_score: number;
  opportunity_count: number;
  top_priority_count: number;
};

type BaselineSignals = {
  page_count: number;
  content_hash: string | null;
  impressions: number;
  clicks: number;
  sampled_at: string;
};

type ChangeDetectionResult = {
  eventType: Exclude<AutomationEventType, 'scheduled'> | null;
  reason: string;
  current: BaselineSignals;
};

const IMPROVEMENT_THRESHOLD = 3;
const DECLINE_THRESHOLD = -3;
const TRAFFIC_CHANGE_THRESHOLD = 0.2;

function toIsoDate(date: Date): string {
  return date.toISOString();
}

function addFrequency(dateIso: string, frequency: AutomationFrequency): string {
  const date = new Date(dateIso);
  if (frequency === 'monthly') {
    date.setMonth(date.getMonth() + 1);
  } else if (frequency === 'biweekly') {
    date.setDate(date.getDate() + 14);
  } else {
    date.setDate(date.getDate() + 7);
  }
  return toIsoDate(date);
}

function shouldRunScheduled(config: AutomationConfigRow, nowIso: string): boolean {
  if (!config.is_active) return false;
  if (!config.next_run_at && !config.last_run_at) return true;
  if (!config.next_run_at && config.last_run_at) {
    return new Date(addFrequency(config.last_run_at, config.frequency)).getTime() <= new Date(nowIso).getTime();
  }
  return new Date(config.next_run_at || nowIso).getTime() <= new Date(nowIso).getTime();
}

function toNumber(input: unknown): number {
  const value = Number(input ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function pctChange(previous: number, current: number): number {
  if (previous <= 0 && current <= 0) return 0;
  if (previous <= 0 && current > 0) return 1;
  return (current - previous) / previous;
}

function safeSnapshot(input: unknown): BaselineSignals | null {
  if (!input || typeof input !== 'object') return null;
  const row = input as Record<string, unknown>;
  return {
    page_count: toNumber(row.page_count),
    content_hash: typeof row.content_hash === 'string' ? row.content_hash : null,
    impressions: toNumber(row.impressions),
    clicks: toNumber(row.clicks),
    sampled_at: typeof row.sampled_at === 'string' ? row.sampled_at : new Date(0).toISOString(),
  };
}

async function buildCurrentBaselineSignals(companyId: string): Promise<BaselineSignals> {
  const nowIso = new Date().toISOString();

  const canonicalPagesPromise = supabase
    .from('canonical_pages')
    .select('id, updated_at')
    .eq('company_id', companyId)
    .limit(1000);

  const keywordMetricsPromise = supabase
    .from('keyword_metrics')
    .select('impressions, clicks, metric_date')
    .eq('company_id', companyId)
    .gte('metric_date', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));

  const blogsPromise = supabase
    .from('blogs')
    .select('id, updated_at')
    .eq('company_id', companyId)
    .limit(1000);

  const [canonicalPagesRes, keywordMetricsRes, blogsRes] = await Promise.all([
    canonicalPagesPromise,
    keywordMetricsPromise,
    blogsPromise,
  ]);

  const canonicalRows = Array.isArray(canonicalPagesRes.data) ? canonicalPagesRes.data : [];
  const blogRows = Array.isArray(blogsRes.data) ? blogsRes.data : [];
  const pageRows = canonicalRows.length > 0 ? canonicalRows : blogRows;

  const hashSource = pageRows
    .map((row) => `${String(row.id)}:${String((row as { updated_at?: string | null }).updated_at ?? '')}`)
    .sort()
    .join('|');

  const contentHash = hashSource
    ? crypto.createHash('sha256').update(hashSource).digest('hex')
    : null;

  const keywordRows = Array.isArray(keywordMetricsRes.data) ? keywordMetricsRes.data : [];
  const impressions = keywordRows.reduce((sum, row) => sum + toNumber((row as { impressions?: number }).impressions), 0);
  const clicks = keywordRows.reduce((sum, row) => sum + toNumber((row as { clicks?: number }).clicks), 0);

  return {
    page_count: pageRows.length,
    content_hash: contentHash,
    impressions,
    clicks,
    sampled_at: nowIso,
  };
}

function detectMeaningfulChange(params: {
  previous: BaselineSignals | null;
  current: BaselineSignals;
}): ChangeDetectionResult {
  if (!params.previous) {
    return {
      eventType: null,
      reason: 'Baseline initialized',
      current: params.current,
    };
  }

  const pageCountDelta = Math.abs(params.current.page_count - params.previous.page_count);
  const contentChanged =
    Boolean(params.previous.content_hash) &&
    Boolean(params.current.content_hash) &&
    params.previous.content_hash !== params.current.content_hash;

  const impressionsDeltaPct = Math.abs(pctChange(params.previous.impressions, params.current.impressions));
  const clicksDeltaPct = Math.abs(pctChange(params.previous.clicks, params.current.clicks));
  const trafficChanged =
    impressionsDeltaPct >= TRAFFIC_CHANGE_THRESHOLD || clicksDeltaPct >= TRAFFIC_CHANGE_THRESHOLD;

  if (contentChanged || pageCountDelta >= 1) {
    return {
      eventType: 'content_change',
      reason: `Content footprint changed (pages delta=${pageCountDelta}, content hash changed=${contentChanged})`,
      current: params.current,
    };
  }

  if (trafficChanged) {
    return {
      eventType: 'traffic_change',
      reason: `Traffic changed (impressions ${Math.round(impressionsDeltaPct * 100)}%, clicks ${Math.round(clicksDeltaPct * 100)}%)`,
      current: params.current,
    };
  }

  return {
    eventType: null,
    reason: 'No meaningful content or traffic change detected',
    current: params.current,
  };
}

function extractSnapshotSignalsFromReportData(data: Record<string, unknown> | null | undefined): SnapshotSignals {
  const composed = (data?.composed_report ?? null) as Record<string, unknown> | null;
  const score = (composed?.score ?? null) as Record<string, unknown> | null;
  const unified = (composed?.unified_intelligence_summary ?? null) as Record<string, unknown> | null;
  const seoSummary = (composed?.seo_executive_summary ?? null) as Record<string, unknown> | null;
  const sections = Array.isArray(composed?.sections) ? (composed?.sections as Array<Record<string, unknown>>) : [];

  const unifiedScore = toNumber(unified?.unified_score ?? score?.value);
  const opportunityCount = sections.reduce((sum, section) => {
    const opportunities = Array.isArray(section.opportunities) ? section.opportunities.length : 0;
    return sum + opportunities;
  }, 0);
  const topPriorityCount = Array.isArray(seoSummary?.top_3_actions)
    ? seoSummary!.top_3_actions!.length
    : 0;

  return {
    unified_score: unifiedScore,
    opportunity_count: opportunityCount,
    top_priority_count: topPriorityCount,
  };
}

async function createNotification(params: {
  userId: string;
  companyId: string;
  domain: string;
  type: NotificationEventType;
  message: string;
  linkedReportId: string;
  metadata: Record<string, unknown>;
}): Promise<boolean> {
  const fingerprint = crypto
    .createHash('sha256')
    .update(`${params.userId}|${params.type}|${params.linkedReportId}|${params.message}`)
    .digest('hex');

  const insertResult = await supabase
    .from('report_notification_events')
    .insert({
      user_id: params.userId,
      company_id: params.companyId,
      domain: params.domain,
      type: params.type,
      message: params.message,
      linked_report_id: params.linkedReportId,
      event_fingerprint: fingerprint,
      metadata: params.metadata,
    })
    .select('id')
    .maybeSingle();

  if (insertResult.error) {
    if ((insertResult.error.message || '').toLowerCase().includes('report_notification_events_fingerprint_unique')) {
      return false;
    }
    throw insertResult.error;
  }
  if (!insertResult.data) return false;

  const title =
    params.type === 'improvement'
      ? 'Snapshot Improvement'
      : params.type === 'decline'
        ? 'Snapshot Decline Alert'
        : 'Snapshot Opportunity';

  await supabase
    .from('notifications')
    .insert({
      user_id: params.userId,
      type: `report_${params.type}`,
      title,
      message: params.message,
      metadata: {
        ...(params.metadata || {}),
        linked_report_id: params.linkedReportId,
        domain: params.domain,
      },
      is_read: false,
    });

  return true;
}

async function triggerSnapshotReport(params: {
  userId: string;
  companyId: string;
  domain: string;
  triggerReason: AutomationEventType;
  triggerDetails: Record<string, unknown>;
}): Promise<{ reportId: string | null; skippedReason?: string }> {
  const existingGenerating = await supabase
    .from('reports')
    .select('id')
    .eq('company_id', params.companyId)
    .eq('domain', params.domain)
    .eq('report_type', 'content_readiness')
    .eq('status', 'generating')
    .limit(1)
    .maybeSingle();

  if (existingGenerating.data?.id) {
    return { reportId: null, skippedReason: 'Snapshot already generating' };
  }

  const { resolveReportInput, persistResolvedReportInputs } = await import('./reportInputResolver');
  const { createFreeReport, startAsyncReportGeneration } = await import('./reportCardService');

  const requestPayload: ReportRequestPayload = {
    formData: { domain: params.domain },
    generationContext: {
      automation_trigger: params.triggerReason,
      automation_details: params.triggerDetails,
    },
  };

  const reportCategory: ReportCategory = 'snapshot';
  const resolvedInput = await resolveReportInput({
    companyId: params.companyId,
    reportCategory,
    requestPayload,
  });
  const readiness = evaluateResolvedReportReadiness(resolvedInput);

  if (!readiness.ready) {
    return {
      reportId: null,
      skippedReason: `Snapshot automation skipped; readiness unmet: ${readiness.missing_requirements.join(', ')}`,
    };
  }

  await persistResolvedReportInputs(resolvedInput);

  const report = await createFreeReport(params.userId, params.companyId, params.domain, {
    reportCategory: 'snapshot',
    requestPayload,
    resolvedInput: resolvedInput as unknown as Record<string, unknown>,
    readiness,
  });
  startAsyncReportGeneration(report);

  return { reportId: report.id };
}

export async function ensureAutomationConfig(params: {
  userId: string;
  companyId: string;
  domain: string;
  frequency?: AutomationFrequency;
  changeDetectionEnabled?: boolean;
}): Promise<void> {
  const nowIso = new Date().toISOString();
  const frequency = params.frequency ?? 'weekly';
  const normalizedDomain = String(params.domain || '').toLowerCase();
  if (!normalizedDomain) return;

  await supabase
    .from('report_automation_configs')
    .upsert({
      user_id: params.userId,
      company_id: params.companyId,
      domain: normalizedDomain,
      frequency,
      change_detection_enabled: params.changeDetectionEnabled ?? true,
      is_active: true,
      next_run_at: addFrequency(nowIso, frequency),
      updated_at: nowIso,
    }, {
      onConflict: 'user_id,company_id,domain',
      ignoreDuplicates: false,
    });
}

export async function runReportAutomationCycle(): Promise<{
  checked: number;
  triggered: number;
  skipped: number;
  notifications: number;
  events: Array<{ configId: string; eventType: AutomationEventType; reportId: string | null; reason: string }>;
}> {
  const nowIso = new Date().toISOString();
  const configsRes = await supabase
    .from('report_automation_configs')
    .select('*')
    .eq('is_active', true)
    .order('updated_at', { ascending: true })
    .limit(500);

  if (configsRes.error) {
    throw new Error(`Failed to load report automation configs: ${configsRes.error.message}`);
  }

  const configs = (configsRes.data || []) as AutomationConfigRow[];
  const events: Array<{ configId: string; eventType: AutomationEventType; reportId: string | null; reason: string }> = [];
  let triggered = 0;
  let skipped = 0;
  let notifications = 0;

  for (const config of configs) {
    const scheduled = shouldRunScheduled(config, nowIso);
    const currentBaseline = await buildCurrentBaselineSignals(config.company_id);
    const previousSnapshot = safeSnapshot(config.last_change_snapshot);
    const detected = config.change_detection_enabled
      ? detectMeaningfulChange({ previous: previousSnapshot, current: currentBaseline })
      : { eventType: null, reason: 'Change detection disabled', current: currentBaseline };

    const eventType: AutomationEventType | null = scheduled
      ? 'scheduled'
      : detected.eventType;

    if (!eventType) {
      skipped += 1;
      await supabase
        .from('report_automation_configs')
        .update({
          last_checked_at: nowIso,
          last_change_snapshot: currentBaseline,
          updated_at: nowIso,
        })
        .eq('id', config.id);
      continue;
    }

    const triggerResult = await triggerSnapshotReport({
      userId: config.user_id,
      companyId: config.company_id,
      domain: config.domain,
      triggerReason: eventType,
      triggerDetails: {
        scheduled,
        change_detection_enabled: config.change_detection_enabled,
        change_reason: detected.reason,
      },
    });

    await supabase
      .from('report_automation_events')
      .insert({
        automation_config_id: config.id,
        user_id: config.user_id,
        company_id: config.company_id,
        domain: config.domain,
        type: eventType,
        triggered_at: nowIso,
        report_id: triggerResult.reportId,
        details: {
          reason: detected.reason,
          trigger_result: triggerResult,
        },
      });

    await supabase
      .from('report_automation_configs')
      .update({
        last_checked_at: nowIso,
        last_run_at: triggerResult.reportId ? nowIso : config.last_run_at,
        next_run_at: triggerResult.reportId ? addFrequency(nowIso, config.frequency) : config.next_run_at,
        last_triggered_report_id: triggerResult.reportId ?? config.last_triggered_report_id,
        last_change_snapshot: currentBaseline,
        updated_at: nowIso,
      })
      .eq('id', config.id);

    events.push({
      configId: config.id,
      eventType,
      reportId: triggerResult.reportId,
      reason: triggerResult.skippedReason ?? detected.reason,
    });

    if (triggerResult.reportId) {
      triggered += 1;
    } else {
      skipped += 1;
    }
  }

  // Count newly generated report notifications in the trailing window.
  const notificationsRes = await supabase
    .from('report_notification_events')
    .select('id')
    .gte('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString());
  if (!notificationsRes.error) {
    notifications = (notificationsRes.data || []).length;
  }

  return {
    checked: configs.length,
    triggered,
    skipped,
    notifications,
    events,
  };
}

export async function handleSnapshotReportCompleted(params: {
  reportId: string;
  companyId: string;
  domain: string;
  data: Record<string, unknown>;
}): Promise<void> {
  const currentSignals = extractSnapshotSignalsFromReportData(params.data);
  const nowIso = new Date().toISOString();

  const previousRes = await supabase
    .from('reports')
    .select('id, data, created_at')
    .eq('company_id', params.companyId)
    .eq('domain', params.domain)
    .eq('report_type', 'content_readiness')
    .eq('status', 'completed')
    .neq('id', params.reportId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const previousSignals = extractSnapshotSignalsFromReportData(
    (previousRes.data?.data || null) as Record<string, unknown> | null,
  );

  const unifiedDelta = Number((currentSignals.unified_score - previousSignals.unified_score).toFixed(2));
  const opportunityDelta = currentSignals.opportunity_count - previousSignals.opportunity_count;

  const configsRes = await supabase
    .from('report_automation_configs')
    .select('id, user_id, company_id, domain, frequency, is_active')
    .eq('company_id', params.companyId)
    .eq('domain', params.domain)
    .eq('is_active', true);

  if (configsRes.error) {
    throw new Error(`Failed to load automation config subscribers: ${configsRes.error.message}`);
  }

  const configs = (configsRes.data || []) as Array<{
    id: string;
    user_id: string;
    company_id: string;
    domain: string;
    frequency: AutomationFrequency;
    is_active: boolean;
  }>;

  for (const config of configs) {
    await supabase
      .from('report_automation_configs')
      .update({
        last_run_at: nowIso,
        next_run_at: addFrequency(nowIso, config.frequency),
        last_triggered_report_id: params.reportId,
        updated_at: nowIso,
      })
      .eq('id', config.id);

    if (unifiedDelta >= IMPROVEMENT_THRESHOLD) {
      const previousBase = Math.max(previousSignals.unified_score, 1);
      const pct = Math.round((unifiedDelta / previousBase) * 100);
      await createNotification({
        userId: config.user_id,
        companyId: params.companyId,
        domain: params.domain,
        type: 'improvement',
        message: `Your visibility improved by ${pct}% in the latest snapshot report.`,
        linkedReportId: params.reportId,
        metadata: { unified_score_change: unifiedDelta },
      });
    } else if (unifiedDelta <= DECLINE_THRESHOLD) {
      const previousBase = Math.max(previousSignals.unified_score, 1);
      const pct = Math.abs(Math.round((unifiedDelta / previousBase) * 100));
      await createNotification({
        userId: config.user_id,
        companyId: params.companyId,
        domain: params.domain,
        type: 'decline',
        message: `Your visibility dropped by ${pct}% in the latest snapshot report.`,
        linkedReportId: params.reportId,
        metadata: { unified_score_change: unifiedDelta },
      });
    }

    if (opportunityDelta > 0 || currentSignals.top_priority_count > Math.max(1, previousSignals.top_priority_count)) {
      await createNotification({
        userId: config.user_id,
        companyId: params.companyId,
        domain: params.domain,
        type: 'opportunity',
        message: 'New high-impact opportunity detected in your latest snapshot report.',
        linkedReportId: params.reportId,
        metadata: {
          opportunity_count_change: opportunityDelta,
          top_priority_count: currentSignals.top_priority_count,
        },
      });
    }
  }
}
