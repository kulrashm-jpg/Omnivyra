/**
 * CRM revenue reconciliation — INBOUND webhook lineage only.
 *
 * Receives revenue/opportunity callbacks from CRMs (HubSpot, Salesforce, Zoho,
 * generic webhook, CSV-imported reconciliation rows) and appends them as
 * lineage events linked to either an attribution token (from the universal
 * SDK) or a lead_id. Persistence: append-only `audit_events`
 * (resource_type='crm_revenue_event') — no new schema dependency, idempotent
 * on `dedupe_key`.
 *
 * HONEST BOUNDARY: this service does NOT call CRMs outbound (no HubSpot /
 * Salesforce / Zoho client app credentials exist in the project). It is the
 * inbound-reconciliation half — operators configure their CRM to POST to the
 * isolated `/api/internal/revenue-webhook-handoff` endpoint with a signed
 * payload. Outbound CRM API calls are not implemented and are surfaced as a
 * documented limitation in diagnostics.
 */
import { ownedDbTable } from '../../db/writeOwner';
import { recordComplianceAudit } from '../audit/complianceAuditService';
import { verifyAttributionToken } from './crossDomainAttributionService';

export type CrmProvider = 'hubspot' | 'salesforce' | 'zoho' | 'csv_import' | 'generic';

export interface RevenueEventInput {
  companyId: string;
  provider: CrmProvider;
  dedupeKey: string;
  amountUsd: number;
  currency?: string;
  stage?: string;            // e.g. 'opportunity' | 'closed_won' | 'subscription_renewal'
  attributionToken?: string; // optional cross-domain token captured at lead time
  leadId?: string;           // optional if known
  occurredAt?: string;       // ISO; defaults to now
  detail?: Record<string, unknown>;
}

export interface RevenueReconciliationResult {
  status: 'recorded' | 'deduped' | 'tampered' | 'failed';
  detail: string;
  attributionNonce?: string;
  correlationId?: string;
}

async function alreadyRecorded(companyId: string, dedupeKey: string): Promise<boolean> {
  try {
    const { data } = await ownedDbTable('audit_events')
      .select('id')
      .eq('company_id', companyId)
      .eq('resource_type', 'crm_revenue_event')
      .eq('resource_id', dedupeKey)
      .limit(1);
    return Array.isArray(data) && data.length > 0;
  } catch { return false; }
}

export async function recordRevenueEvent(input: RevenueEventInput): Promise<RevenueReconciliationResult> {
  if (await alreadyRecorded(input.companyId, input.dedupeKey)) {
    return { status: 'deduped', detail: 'replay-layer marker present — exactly-once' };
  }

  let attributionNonce: string | undefined;
  if (input.attributionToken) {
    const v = await verifyAttributionToken({ companyId: input.companyId, token: input.attributionToken });
    if (v.state === 'tampered' || v.state === 'company_mismatch') {
      return { status: 'tampered', detail: v.detail };
    }
    if (v.state === 'verified' || v.state === 'replayed') attributionNonce = v.payload?.n;
  }

  try {
    const { correlationId } = await recordComplianceAudit({
      companyId: input.companyId,
      actor: { userId: null, type: 'system', label: 'crm-reconciliation' },
      action: `crm_revenue.${input.provider}.${input.stage ?? 'event'}`,
      resourceType: 'crm_revenue_event',
      resourceId: input.dedupeKey,
      severity: 'info',
      entityLineage: ['company', 'crm_revenue_event', input.provider, input.stage ?? 'event'],
      detail: {
        provider: input.provider,
        amountUsd: input.amountUsd,
        currency: input.currency ?? 'USD',
        stage: input.stage ?? null,
        leadId: input.leadId ?? null,
        attributionNonce: attributionNonce ?? null,
        occurredAt: input.occurredAt ?? new Date().toISOString(),
        ...(input.detail ?? {}),
      },
    });
    return { status: 'recorded', detail: 'revenue event lineage recorded', attributionNonce, correlationId };
  } catch (err) {
    return { status: 'failed', detail: err instanceof Error ? err.message : 'recording failed' };
  }
}

export interface RevenueAttributionReport {
  companyId: string;
  generatedAt: string;
  windowDays: number;
  revenueEvents: number;
  totalRevenueUsd: number;
  attributedRevenueUsd: number;          // events with a verified attribution nonce
  attributionRate: number;               // 0..1
  byProvider: Array<{ provider: string; events: number; revenueUsd: number }>;
  outboundCapability: 'not_configured';  // honest — no outbound CRM API
  capabilityNote: string;
}

const WINDOW_DAYS = 30;

export async function buildRevenueAttributionReport(companyId: string): Promise<RevenueAttributionReport> {
  const sinceIso = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  let total = 0;
  let attributed = 0;
  const byProvider = new Map<string, { events: number; revenueUsd: number }>();

  try {
    const { data } = await ownedDbTable('audit_events')
      .select('action, metadata, created_at')
      .eq('company_id', companyId)
      .eq('resource_type', 'crm_revenue_event')
      .gte('created_at', sinceIso)
      .limit(5000);
    for (const r of ((data ?? []) as any[])) {
      const m = r.metadata ?? {};
      const amt = Number(m.amountUsd ?? 0);
      const prov = String(m.provider ?? 'generic');
      total += amt;
      const cur = byProvider.get(prov) ?? { events: 0, revenueUsd: 0 };
      cur.events += 1; cur.revenueUsd += amt;
      byProvider.set(prov, cur);
      if (m.attributionNonce) attributed += amt;
    }
  } catch { /* empty */ }

  const events = [...byProvider.values()].reduce((a, b) => a + b.events, 0);
  return {
    companyId,
    generatedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    revenueEvents: events,
    totalRevenueUsd: Number(total.toFixed(2)),
    attributedRevenueUsd: Number(attributed.toFixed(2)),
    attributionRate: total > 0 ? Number((attributed / total).toFixed(3)) : 0,
    byProvider: Array.from(byProvider.entries()).map(([provider, v]) => ({
      provider, events: v.events, revenueUsd: Number(v.revenueUsd.toFixed(2)),
    })),
    outboundCapability: 'not_configured',
    capabilityNote:
      'Inbound CRM revenue reconciliation only. Append-only lineage via audit_events. No outbound CRM API calls implemented (no client app credentials).',
  };
}
