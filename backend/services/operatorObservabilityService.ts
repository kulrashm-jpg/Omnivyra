/**
 * Operator observability summary — read-only.
 *
 * Five diagnostics-first axes, each derived from EXISTING tables:
 *   - integrationHealth         (publishing_jobs success/failure timeline)
 *   - analyticsSync             (analytics_properties.last_synced_at)
 *   - formTracking              (recent tracking_events form_* counts)
 *   - attributionContinuity     (recent verified attribution nonces)
 *   - webhookFailures           (audit_events with webhook-failed signals)
 *
 * Each axis returns a tiny status + actionable next-step. Cached 60s.
 */
import { ownedDbTable } from '../db/writeOwner';
import { cached } from './lightCache';

const WINDOW_MS = 7 * 86_400_000;

export type ObservabilityStatus = 'healthy' | 'warning' | 'degraded' | 'unused';

export interface ObservabilityAxis {
  id: 'integrations' | 'analytics' | 'forms' | 'attribution' | 'webhooks';
  label: string;
  status: ObservabilityStatus;
  detail: string;
  metric?: { value: number; unit?: string };
  nextActionHref?: string;
  nextActionLabel?: string;
}

export interface OperatorObservabilitySummary {
  companyId: string;
  generatedAt: string;
  axes: ObservabilityAxis[];
  publishTimeline: Array<{ at: string; provider: string; status: string; message: string | null }>;
}

async function publishTimelineRecent(companyId: string, limit = 20): Promise<Array<{ at: string; provider: string; status: string; message: string | null }>> {
  try {
    const { data } = await ownedDbTable('publishing_jobs')
      .select('provider, status, last_error, completed_at, dead_letter_at, updated_at')
      .eq('company_id', companyId)
      .in('status', ['published', 'failed', 'dead_letter', 'retrying'])
      .order('updated_at', { ascending: false })
      .limit(limit);
    return ((data ?? []) as Array<{ provider: string; status: string; last_error: string | null; completed_at: string | null; dead_letter_at: string | null; updated_at: string }>)
      .map((r) => ({
        at: r.completed_at ?? r.dead_letter_at ?? r.updated_at,
        provider: r.provider,
        status: r.status,
        message: r.last_error,
      }));
  } catch { return []; }
}

async function integrationHealthAxis(companyId: string): Promise<ObservabilityAxis> {
  const sinceIso = new Date(Date.now() - WINDOW_MS).toISOString();
  try {
    const { data } = await ownedDbTable('publishing_jobs')
      .select('status')
      .eq('company_id', companyId)
      .gte('updated_at', sinceIso)
      .in('status', ['published', 'failed', 'dead_letter'])
      .limit(500);
    const rows = (data ?? []) as Array<{ status: string }>;
    if (rows.length === 0) {
      return {
        id: 'integrations',
        label: 'CMS publishing health',
        status: 'unused',
        detail: 'No publishes in the last 7 days.',
        nextActionHref: '/blogs/create',
        nextActionLabel: 'Create a blog',
      };
    }
    const failures = rows.filter((r) => r.status !== 'published').length;
    const rate = (rows.length - failures) / rows.length;
    if (rate >= 0.95) return { id: 'integrations', label: 'CMS publishing health', status: 'healthy', detail: `${rows.length} publishes, ${(rate * 100).toFixed(0)}% success`, metric: { value: rate, unit: 'rate' } };
    if (rate >= 0.8)  return { id: 'integrations', label: 'CMS publishing health', status: 'warning', detail: `${failures}/${rows.length} failed (${(rate * 100).toFixed(0)}% success)`, metric: { value: rate, unit: 'rate' }, nextActionHref: '/integrations', nextActionLabel: 'Inspect integrations' };
    return { id: 'integrations', label: 'CMS publishing health', status: 'degraded', detail: `${failures}/${rows.length} failed (${(rate * 100).toFixed(0)}% success)`, metric: { value: rate, unit: 'rate' }, nextActionHref: '/integrations', nextActionLabel: 'Repair integrations' };
  } catch {
    return { id: 'integrations', label: 'CMS publishing health', status: 'unused', detail: 'Unable to read publishing history.' };
  }
}

async function analyticsSyncAxis(companyId: string): Promise<ObservabilityAxis> {
  try {
    const { data } = await ownedDbTable('analytics_properties')
      .select('last_synced_at, provider')
      .eq('company_id', companyId)
      .order('last_synced_at', { ascending: false })
      .limit(1);
    const last = ((data ?? []) as Array<{ last_synced_at: string | null }>)[0]?.last_synced_at ?? null;
    if (!last) return { id: 'analytics', label: 'GA4 sync', status: 'unused', detail: 'No GA4 sync yet.', nextActionHref: '/website-setup', nextActionLabel: 'Connect GA4' };
    const ageMs = Date.now() - Date.parse(last);
    const ageHours = ageMs / 3_600_000;
    if (ageHours < 26) return { id: 'analytics', label: 'GA4 sync', status: 'healthy', detail: `Last synced ${Math.round(ageHours)}h ago.`, metric: { value: ageHours, unit: 'h' } };
    if (ageHours < 72) return { id: 'analytics', label: 'GA4 sync', status: 'warning', detail: `Last synced ${Math.round(ageHours)}h ago — refresh expected daily.`, metric: { value: ageHours, unit: 'h' }, nextActionHref: '/integrations', nextActionLabel: 'Force sync' };
    return { id: 'analytics', label: 'GA4 sync', status: 'degraded', detail: `Last synced ${Math.round(ageHours)}h ago — GA4 connector may be broken.`, metric: { value: ageHours, unit: 'h' }, nextActionHref: '/integrations', nextActionLabel: 'Reconnect GA4' };
  } catch {
    return { id: 'analytics', label: 'GA4 sync', status: 'unused', detail: 'Unable to read GA4 sync state.' };
  }
}

async function formTrackingAxis(companyId: string): Promise<ObservabilityAxis> {
  const sinceIso = new Date(Date.now() - WINDOW_MS).toISOString();
  try {
    const { data } = await ownedDbTable('tracking_events')
      .select('event_name')
      .eq('company_id', companyId)
      .in('event_name', ['form_start', 'form_submit'])
      .gte('occurred_at', sinceIso)
      .limit(2000);
    const rows = (data ?? []) as Array<{ event_name: string }>;
    const starts = rows.filter((r) => r.event_name === 'form_start').length;
    const submits = rows.filter((r) => r.event_name === 'form_submit').length;
    if (starts === 0 && submits === 0) return { id: 'forms', label: 'Form tracking', status: 'unused', detail: 'No form events captured in 7 days.', nextActionHref: '/website-setup', nextActionLabel: 'Install tracker' };
    if (starts > 0 && submits === 0) return { id: 'forms', label: 'Form tracking', status: 'warning', detail: `${starts} form starts but 0 submits — verify form_submit event firing.`, metric: { value: starts, unit: 'starts' }, nextActionHref: '/lead-capture', nextActionLabel: 'Diagnose forms' };
    return { id: 'forms', label: 'Form tracking', status: 'healthy', detail: `${starts} starts · ${submits} submits in 7d.`, metric: { value: submits, unit: 'submits' } };
  } catch {
    return { id: 'forms', label: 'Form tracking', status: 'unused', detail: 'Unable to read tracking events.' };
  }
}

async function attributionContinuityAxis(companyId: string): Promise<ObservabilityAxis> {
  const sinceIso = new Date(Date.now() - WINDOW_MS).toISOString();
  try {
    const { data } = await ownedDbTable('campaign_touchpoints')
      .select('nonce')
      .eq('company_id', companyId)
      .gte('touched_at', sinceIso)
      .limit(5000);
    const rows = (data ?? []) as Array<{ nonce: string | null }>;
    if (rows.length === 0) return { id: 'attribution', label: 'Attribution continuity', status: 'unused', detail: 'No campaign touchpoints in 7 days.' };
    const verified = rows.filter((r) => !!r.nonce).length;
    const rate = verified / rows.length;
    if (rate >= 0.8) return { id: 'attribution', label: 'Attribution continuity', status: 'healthy', detail: `${(rate * 100).toFixed(0)}% of touchpoints carry a verified nonce.`, metric: { value: rate, unit: 'rate' } };
    if (rate >= 0.4) return { id: 'attribution', label: 'Attribution continuity', status: 'warning', detail: `${(rate * 100).toFixed(0)}% verified — review cross-domain SDK install.`, metric: { value: rate, unit: 'rate' }, nextActionHref: '/lead-capture', nextActionLabel: 'Inspect continuity' };
    return { id: 'attribution', label: 'Attribution continuity', status: 'degraded', detail: `${(rate * 100).toFixed(0)}% verified — most touchpoints lack a nonce.`, metric: { value: rate, unit: 'rate' }, nextActionHref: '/lead-capture', nextActionLabel: 'Repair continuity' };
  } catch {
    return { id: 'attribution', label: 'Attribution continuity', status: 'unused', detail: 'Unable to read attribution touchpoints.' };
  }
}

async function webhookFailuresAxis(companyId: string): Promise<ObservabilityAxis> {
  const sinceIso = new Date(Date.now() - WINDOW_MS).toISOString();
  try {
    const { data } = await ownedDbTable('audit_events')
      .select('id')
      .eq('company_id', companyId)
      .in('resource_type', ['crm_revenue_event', 'cms_reconciliation_event'])
      .ilike('action', '%tampered%')
      .gte('created_at', sinceIso)
      .limit(100);
    const tampered = (data ?? []).length;
    if (tampered === 0) return { id: 'webhooks', label: 'Webhook auth', status: 'healthy', detail: 'No webhook signature failures in 7 days.' };
    return { id: 'webhooks', label: 'Webhook auth', status: 'degraded', detail: `${tampered} webhook signature failure(s) in 7 days — check shared secrets.`, metric: { value: tampered, unit: 'events' } };
  } catch {
    return { id: 'webhooks', label: 'Webhook auth', status: 'unused', detail: 'Unable to read webhook audit lineage.' };
  }
}

export async function buildOperatorObservability(companyId: string): Promise<OperatorObservabilitySummary> {
  return cached(`operator-obs:${companyId}`, 60_000, async () => {
    const [integrations, analytics, forms, attribution, webhooks, timeline] = await Promise.all([
      integrationHealthAxis(companyId),
      analyticsSyncAxis(companyId),
      formTrackingAxis(companyId),
      attributionContinuityAxis(companyId),
      webhookFailuresAxis(companyId),
      publishTimelineRecent(companyId, 20),
    ]);
    return {
      companyId,
      generatedAt: new Date().toISOString(),
      axes: [integrations, analytics, forms, attribution, webhooks],
      publishTimeline: timeline,
    };
  });
}
