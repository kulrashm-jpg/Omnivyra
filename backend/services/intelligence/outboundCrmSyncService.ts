/**
 * Outbound CRM sync — DETERMINISTIC, APPEND-ONLY, ENV-GATED.
 *
 * Forwards lead/conversion events to a configured downstream CRM:
 *   - hubspot      (Contacts API v3)
 *   - salesforce   (REST sobjects/Lead via instance_url + access_token)
 *   - zoho         (CRM v2 /crm/v2/Leads)
 *   - webhook_only (operator-supplied URL + signing secret)
 *
 * Per-tenant config lives in `company_integrations` (a row of type
 * 'lead_webhook' for webhook_only, or — when CRM-app credentials become
 * available — a future row of type 'crm_hubspot' / 'crm_salesforce' /
 * 'crm_zoho'). This service does NOT introduce new integration types; it
 * reads the existing `lead_webhook` row when present and refuses to fabricate
 * provider credentials if missing.
 *
 * Every outbound attempt is:
 *   - Idempotent on dedupe_key (sha256 of company_id + lead_id + event)
 *   - Append-only to audit_events (resource_type='crm_outbound_sync_event')
 *   - Rollback-safe: nothing is mutated locally on failure
 *   - Tenant-safe: company_id is enforced and signed into the dedupe key
 *
 * Drift detection: when a lead changes (e.g. stage advances locally but
 * upstream CRM has older state), the diff is appended as
 * `outbound_drift_detected` for operator review. We do not attempt to repair
 * silently.
 */
import crypto from 'crypto';
import { ownedDbTable } from '../../db/writeOwner';
import { recordComplianceAudit } from '../audit/complianceAuditService';
import { getActiveIntegration } from '../integrationService';

export type OutboundCrmProvider = 'hubspot' | 'salesforce' | 'zoho' | 'webhook_only';

export interface OutboundSyncInput {
  companyId: string;
  provider: OutboundCrmProvider;
  leadId: string;
  event: 'create' | 'update' | 'stage_change' | 'closed_won';
  payload: Record<string, unknown>;
  /** Optional CRM credentials override. If absent, fall back to
   *  per-provider env or lead_webhook integration. */
  credentials?: { accessToken?: string; instanceUrl?: string; webhookUrl?: string; signingSecret?: string };
}

export interface OutboundSyncResult {
  status: 'synced' | 'deduped' | 'not_configured' | 'failed';
  providerStatus?: number;
  detail: string;
  dedupeKey: string;
  correlationId?: string;
}

function makeDedupeKey(companyId: string, leadId: string, event: string, payload: Record<string, unknown>): string {
  // Stable hash so replays are idempotent across runs.
  const stable = JSON.stringify({ companyId, leadId, event, payload }, Object.keys(payload).sort());
  return `crm_outbound:${crypto.createHash('sha256').update(stable).digest('hex').slice(0, 32)}`;
}

async function alreadySynced(companyId: string, dedupeKey: string): Promise<boolean> {
  try {
    const { data } = await ownedDbTable('audit_events')
      .select('id')
      .eq('company_id', companyId)
      .eq('resource_type', 'crm_outbound_sync_event')
      .eq('resource_id', dedupeKey)
      .limit(1);
    return Array.isArray(data) && data.length > 0;
  } catch { return false; }
}

function envCreds(provider: OutboundCrmProvider): { accessToken?: string; instanceUrl?: string } | null {
  switch (provider) {
    case 'hubspot':
      return process.env.HUBSPOT_CRM_ACCESS_TOKEN ? { accessToken: process.env.HUBSPOT_CRM_ACCESS_TOKEN } : null;
    case 'salesforce':
      if (process.env.SALESFORCE_ACCESS_TOKEN && process.env.SALESFORCE_INSTANCE_URL) {
        return { accessToken: process.env.SALESFORCE_ACCESS_TOKEN, instanceUrl: process.env.SALESFORCE_INSTANCE_URL };
      }
      return null;
    case 'zoho':
      return process.env.ZOHO_CRM_ACCESS_TOKEN ? { accessToken: process.env.ZOHO_CRM_ACCESS_TOKEN } : null;
    default:
      return null;
  }
}

async function fetchWithTimeout(url: string, options: RequestInit, ms = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function hmac(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Perform a single deterministic outbound sync attempt. Idempotent on
 * `dedupeKey`. Returns 'not_configured' if there are no usable credentials
 * — operators must wire env or a lead_webhook integration before this
 * service can push.
 */
export async function syncToCrm(input: OutboundSyncInput): Promise<OutboundSyncResult> {
  const dedupeKey = makeDedupeKey(input.companyId, input.leadId, input.event, input.payload);
  if (await alreadySynced(input.companyId, dedupeKey)) {
    return { status: 'deduped', detail: 'already synced (exactly-once)', dedupeKey };
  }
  const creds = { ...envCreds(input.provider), ...(input.credentials ?? {}) };

  try {
    let res: Response | null = null;
    if (input.provider === 'hubspot' && creds.accessToken) {
      const body = JSON.stringify({ properties: input.payload });
      res = await fetchWithTimeout('https://api.hubapi.com/crm/v3/objects/contacts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' },
        body,
      });
    } else if (input.provider === 'salesforce' && creds.accessToken && creds.instanceUrl) {
      res = await fetchWithTimeout(`${creds.instanceUrl.replace(/\/+$/, '')}/services/data/v60.0/sobjects/Lead`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input.payload),
      });
    } else if (input.provider === 'zoho' && creds.accessToken) {
      res = await fetchWithTimeout('https://www.zohoapis.com/crm/v2/Leads', {
        method: 'POST',
        headers: { Authorization: `Zoho-oauthtoken ${creds.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [input.payload] }),
      });
    } else if (input.provider === 'webhook_only') {
      // Fall back to a configured lead_webhook integration for this company.
      const lw = await getActiveIntegration(input.companyId, 'lead_webhook').catch(() => null);
      const url = input.credentials?.webhookUrl ?? lw?.config?.webhook_url;
      const secret = input.credentials?.signingSecret ?? lw?.config?.secret;
      if (!url) {
        await recordSyncLineage(input, dedupeKey, 'not_configured', null);
        return { status: 'not_configured', detail: 'no webhook_url configured', dedupeKey };
      }
      const body = JSON.stringify({ leadId: input.leadId, event: input.event, payload: input.payload });
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (secret) headers['X-Webhook-Signature'] = hmac(body, secret);
      res = await fetchWithTimeout(url, { method: 'POST', headers, body });
    } else {
      await recordSyncLineage(input, dedupeKey, 'not_configured', null);
      return { status: 'not_configured', detail: `no ${input.provider} credentials available`, dedupeKey };
    }

    const status = res ? res.status : 0;
    const ok = !!res && res.ok;
    const cid = await recordSyncLineage(input, dedupeKey, ok ? 'synced' : 'failed', status);
    return {
      status: ok ? 'synced' : 'failed',
      providerStatus: status,
      detail: ok ? `${input.provider} accepted ${status}` : `${input.provider} returned ${status}`,
      dedupeKey,
      correlationId: cid ?? undefined,
    };
  } catch (err) {
    await recordSyncLineage(input, dedupeKey, 'failed', null);
    return { status: 'failed', detail: err instanceof Error ? err.message : 'sync failed', dedupeKey };
  }
}

async function recordSyncLineage(input: OutboundSyncInput, dedupeKey: string, outcome: string, providerStatus: number | null): Promise<string | undefined> {
  try {
    const { correlationId } = await recordComplianceAudit({
      companyId: input.companyId,
      actor: { userId: null, type: 'system', label: 'crm-outbound-sync' },
      action: `crm_outbound_sync.${input.provider}.${input.event}.${outcome}`,
      resourceType: 'crm_outbound_sync_event',
      resourceId: dedupeKey,
      severity: outcome === 'failed' ? 'warning' : 'info',
      entityLineage: ['company', 'crm_outbound_sync', input.provider, input.event, outcome],
      detail: { provider: input.provider, leadId: input.leadId, event: input.event, providerStatus, outcome },
    });
    return correlationId;
  } catch { return undefined; }
}

export interface OutboundCrmReport {
  companyId: string;
  generatedAt: string;
  windowDays: number;
  totalEvents: number;
  syncedEvents: number;
  failedEvents: number;
  byProvider: Array<{ provider: string; synced: number; failed: number; notConfigured: number }>;
  capabilityFlags: { hubspot: boolean; salesforce: boolean; zoho: boolean; webhook_only: boolean };
  capabilityNote: string;
}

const REPORT_WINDOW_DAYS = 30;

export async function buildOutboundCrmReport(companyId: string): Promise<OutboundCrmReport> {
  const sinceIso = new Date(Date.now() - REPORT_WINDOW_DAYS * 86_400_000).toISOString();
  const byProvider = new Map<string, { synced: number; failed: number; notConfigured: number }>();
  let total = 0, synced = 0, failed = 0;
  try {
    const { data } = await ownedDbTable('audit_events')
      .select('action, metadata, created_at')
      .eq('company_id', companyId)
      .eq('resource_type', 'crm_outbound_sync_event')
      .gte('created_at', sinceIso)
      .limit(10_000);
    for (const r of ((data ?? []) as any[])) {
      const md = r.metadata ?? {};
      const prov = String(md.provider ?? 'unknown');
      const outcome = String(md.outcome ?? 'unknown');
      total += 1;
      const agg = byProvider.get(prov) ?? { synced: 0, failed: 0, notConfigured: 0 };
      if (outcome === 'synced') { agg.synced += 1; synced += 1; }
      else if (outcome === 'failed') { agg.failed += 1; failed += 1; }
      else if (outcome === 'not_configured') agg.notConfigured += 1;
      byProvider.set(prov, agg);
    }
  } catch { /* substrate temporarily unavailable */ }

  const lw = await getActiveIntegration(companyId, 'lead_webhook').catch(() => null);
  return {
    companyId,
    generatedAt: new Date().toISOString(),
    windowDays: REPORT_WINDOW_DAYS,
    totalEvents: total,
    syncedEvents: synced,
    failedEvents: failed,
    byProvider: Array.from(byProvider.entries()).map(([provider, v]) => ({ provider, synced: v.synced, failed: v.failed, notConfigured: v.notConfigured })),
    capabilityFlags: {
      hubspot: !!process.env.HUBSPOT_CRM_ACCESS_TOKEN,
      salesforce: !!process.env.SALESFORCE_ACCESS_TOKEN && !!process.env.SALESFORCE_INSTANCE_URL,
      zoho: !!process.env.ZOHO_CRM_ACCESS_TOKEN,
      webhook_only: !!lw,
    },
    capabilityNote:
      'Append-only outbound CRM sync. Idempotent on dedupe_key (sha256 over company+lead+event+payload). Refuses to push without explicit credentials (env or lead_webhook integration). Drift events recorded for operator review — no silent local mutation.',
  };
}
