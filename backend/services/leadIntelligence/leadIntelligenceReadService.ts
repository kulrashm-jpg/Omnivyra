/**
 * Unified Lead Intelligence read service — the single read surface for consumers.
 *
 * Reads the durable canonical store (Phase 4) UNION the legacy sources (bridged via
 * adapters) so the same data appears unified whether or not the durable table is
 * applied/backfilled — backward compatible by construction. All composition,
 * filtering, search, sort, pagination and export live HERE (and the pure query/
 * export libs); consumers never touch fragmented sources or filter source-specifically.
 *
 * Anti-N+1: each source is read ONCE in bulk per query (4 reads total, parallel),
 * never per-lead. Tenant isolation: every reader is company-scoped + the query
 * re-filters by company_id. Fail-open: any source error degrades to [] (never throws).
 */

import { ownedDbTable } from '../../db/writeOwner';
import {
  projectExistingRow,
  applyLeadQuery,
  filterLeads,
  dedupeViews,
  toExportRow,
  toCsv,
  toExcelXml,
  computeLeadStats,
  activeLeadsCompatibilityFilter,
  leadKeyFor,
  identityProjection,
  campaignProjection,
  journeyProjection,
  contentProjection,
  activityProjection,
  opportunityProjection,
  marketPulseProjection,
  crmProjection,
  engagementProjection,
  analyticsProjection,
  recommendNextAction,
  summarizeLead,
  buildTimeline,
  type CanonicalLeadView,
  type LeadQuery,
  type LeadQueryResult,
  type LeadStats,
  visitorJourneyProjection,
  campaignAttributionProjection,
  contentReferenceProjection,
  websiteBehaviourProjection,
  sourceDetailProjection,
  buildBuyingIntentProfile,
  buildLeadActionPlan,
  buildCompanyIntelligence,
  resolveCompanyKey,
  resolveCompanyName,
  summarizeCompanyIntelligence,
  type TimelineEvent,
  type LeadProfile,
  type EnrichedLeadProfile,
  type BuyingIntentProfile,
  type LeadActionPlan,
  type CompanyIntelligenceProfile,
} from '../../../lib/leadIntelligence';
import { listCanonicalLeads } from './leadIntelligenceRepository';

export interface LeadSourceReaders {
  durable(companyId: string): Promise<CanonicalLeadView[]>;
  activeLeads(companyId: string): Promise<Array<Record<string, unknown>>>;
  leads(companyId: string): Promise<Array<Record<string, unknown>>>;
  canonicalLeads(companyId: string): Promise<Array<Record<string, unknown>>>;
}

const BULK_CAP = 2000;

async function readTable(table: string, tenantCol: string, companyId: string): Promise<Array<Record<string, unknown>>> {
  try {
    const { data, error } = await ownedDbTable(table).select('*').eq(tenantCol, companyId).limit(BULK_CAP);
    return !error && Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

export const defaultLeadSourceReaders: LeadSourceReaders = {
  durable: (companyId) => listCanonicalLeads({ companyId, limit: 1000 }).then((r) => r).catch(() => []),
  activeLeads: (companyId) => readTable('active_leads', 'organization_id', companyId),
  leads: (companyId) => readTable('leads', 'company_id', companyId),
  canonicalLeads: (companyId) => readTable('canonical_leads', 'company_id', companyId),
};

/** Bulk-read every source once, bridge to unified views, dedupe (durable wins). */
async function collectViews(companyId: string, readers: LeadSourceReaders): Promise<CanonicalLeadView[]> {
  const [durable, active, legacyLeads, canonical] = await Promise.all([
    readers.durable(companyId),
    readers.activeLeads(companyId),
    readers.leads(companyId),
    readers.canonicalLeads(companyId),
  ]);
  const views: CanonicalLeadView[] = [
    ...durable, // durable first → wins on dedupe
    ...active.map((r) => projectExistingRow('community', r)),
    ...legacyLeads.map((r) => projectExistingRow('website', r)),
    ...canonical.map((r) => projectExistingRow('crm', r)),
  ];
  return dedupeViews(views);
}

/** The unified, paginated, filtered, searched lead read. */
export async function searchLeads(query: LeadQuery, readers: LeadSourceReaders = defaultLeadSourceReaders): Promise<LeadQueryResult> {
  const limit = Math.max(1, Math.min(query.page?.limit ?? 50, 500));
  const offset = Math.max(0, query.page?.offset ?? 0);
  if (!query.companyId) return { rows: [], total: 0, limit, offset };
  const views = await collectViews(query.companyId, readers);
  return applyLeadQuery(views, query);
}

/**
 * Repository-owned aggregation — counts/statistics/status-summary/source-breakdown.
 * Consumers (dashboard widgets/counters, analytics) receive ready-to-render data;
 * no consumer-side aggregation. Reuses the single bulk collect (anti-N+1).
 */
export async function getLeadStats(query: LeadQuery, readers: LeadSourceReaders = defaultLeadSourceReaders): Promise<LeadStats> {
  if (!query.companyId) return { total: 0, bySource: {}, byStatus: {}, intentBands: { high: 0, medium: 0, low: 0 }, withIdentity: 0, withCampaign: 0 };
  const views = await collectViews(query.companyId, readers);
  return computeLeadStats(filterLeads(views, query));
}

/**
 * Active Leads as a repository-backed filtered view (community scope = today's
 * behaviour). Active Leads owns NO query logic — it renders this result.
 */
export async function getActiveLeadsView(query: LeadQuery, readers: LeadSourceReaders = defaultLeadSourceReaders): Promise<LeadQueryResult> {
  const limit = Math.max(1, Math.min(query.page?.limit ?? 50, 500));
  const offset = Math.max(0, query.page?.offset ?? 0);
  if (!query.companyId) return { rows: [], total: 0, limit, offset };
  const views = activeLeadsCompatibilityFilter(await collectViews(query.companyId, readers));
  return applyLeadQuery(views, query);
}

/**
 * Resolve one unified lead by its stable key and hydrate its full profile (every
 * section the workspace renders) via the EXISTING pure projection/recommendation/
 * timeline builders. No new business logic, no per-lead source queries (anti-N+1):
 * the view already carries identity / scores / attribution / campaign / content;
 * auxiliary source arrays (touchpoints/events/threads) default to [] so projections
 * degrade to their real zero-state rather than fabricating data. Repository-only.
 */
export async function getLeadProfile(
  companyId: string,
  leadKey: string,
  readers: LeadSourceReaders = defaultLeadSourceReaders,
): Promise<LeadProfile | null> {
  if (!companyId || !leadKey) return null;
  const views = await collectViews(companyId, readers);
  const view = views.find((v) => v.organizationId === companyId && leadKeyFor(v) === leadKey) ?? null;
  if (!view) return null;

  const leadEvent: TimelineEvent = {
    origin: view.sourceRef?.table ?? view.source,
    source: view.source,
    entityId: view.sourceRef?.id ?? null,
    eventType: 'lead_captured',
    occurredAt: view.occurredAt,
    metadata: {
      sourceLabel: view.sourceLabel,
      campaign: view.campaign,
      content: view.content,
      status: view.status,
      referrer: view.referrer,
    },
  };

  return {
    leadKey,
    view,
    identity: identityProjection(view),
    campaign: campaignProjection(view),
    journey: journeyProjection(view),
    content: contentProjection(view, {}),
    activity: activityProjection(view, []),
    opportunity: opportunityProjection(view),
    marketPulse: marketPulseProjection(view),
    crm: crmProjection(view),
    engagement: engagementProjection(view),
    analytics: analyticsProjection(view),
    timeline: buildTimeline([leadEvent]),
    summary: summarizeLead(view),
    recommendedNextAction: recommendNextAction(view),
  };
}

const aux = async (table: string, col: string, val: string, tenant: string, limit: number): Promise<Array<Record<string, unknown>>> => {
  if (!val) return [];
  try {
    const { data, error } = await ownedDbTable(table).select('*').eq('company_id', tenant).eq(col, val).limit(limit);
    return !error && Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
  } catch { return []; }
};

/**
 * Enriched lead profile (Phase 9) — the base profile PLUS first-class enrichment
 * sections (visitor journey, campaign attribution, content references, website
 * behaviour, source detail) projected from the canonical view's captured attribution.
 * Reuses getLeadProfile (no duplication) and hydrates the EXISTING tracking
 * (visitor_sessions / tracking_events / campaign_touchpoints) for this one lead —
 * bounded single-lead reads (not N+1), tenant-scoped, fail-open. Additive: the base
 * LeadProfile contract is unchanged. Repository owns every projection.
 */
export async function getEnrichedLeadProfile(
  companyId: string,
  leadKey: string,
  readers: LeadSourceReaders = defaultLeadSourceReaders,
): Promise<EnrichedLeadProfile | null> {
  const base = await getLeadProfile(companyId, leadKey, readers);
  if (!base) return null;
  const view = base.view;
  const { events, touchpoints, sessions } = await hydrateLeadTracking(companyId, view);
  const websiteBehaviour = websiteBehaviourProjection({ events, touchpoints, sessionCount: sessions.length });
  const buyingIntent = buildBuyingIntentProfile({ view, events, touchpoints, sessions, timeline: base.timeline });

  // Account-level summary when the lead belongs to a known company (reuses the
  // company-intelligence builder; no duplicated logic, no extra per-contact reads).
  const companyKey = resolveCompanyKey(view);
  let company: EnrichedLeadProfile['company'] = null;
  if (companyKey) {
    const ci = await getCompanyIntelligence(companyId, companyKey, readers);
    company = ci ? summarizeCompanyIntelligence(ci) : null;
  }

  return {
    ...base,
    visitorJourney: visitorJourneyProjection(view, sessions),
    campaignAttribution: campaignAttributionProjection(view),
    contentReferences: contentReferenceProjection(view),
    websiteBehaviour,
    sourceDetail: sourceDetailProjection(view),
    buyingIntent,
    actionPlan: buildLeadActionPlan({ view, buyingIntent, behaviour: websiteBehaviour }),
    company,
  };
}

/** Hydrate the EXISTING tracking for one lead (bounded, tenant-scoped, fail-open). Shared. */
async function hydrateLeadTracking(companyId: string, view: CanonicalLeadView): Promise<{ events: Array<Record<string, unknown>>; touchpoints: Array<Record<string, unknown>>; sessions: Array<Record<string, unknown>> }> {
  const sm = (view.attribution.sourceMetadata ?? {}) as Record<string, unknown>;
  const sessionId = (sm.visitor_session_id as string) || (view.identity.anonymousId ?? '') || '';
  const leadId = view.sourceRef?.id ?? '';
  const personId = view.unifiedPersonId ?? '';
  const [events, touchpoints, sessions] = await Promise.all([
    aux('tracking_events', 'visitor_session_id', sessionId, companyId, 1000),
    leadId ? aux('campaign_touchpoints', 'lead_id', leadId, companyId, 1000) : aux('campaign_touchpoints', 'visitor_session_id', sessionId, companyId, 1000),
    personId ? aux('visitor_sessions', 'unified_person_id', personId, companyId, 200) : (sessionId ? aux('visitor_sessions', 'id', sessionId, companyId, 1) : Promise.resolve([])),
  ]);
  return { events, touchpoints, sessions };
}

/**
 * Standalone Buying Intent Intelligence (Phase 10) — the deterministic decision-support
 * object, reusable by the workspace, future email/calling, CRM and automations. Resolves
 * the lead, hydrates the EXISTING tracking, and runs the pure engine. Repository owns it.
 */
export async function getBuyingIntentProfile(
  companyId: string,
  leadKey: string,
  readers: LeadSourceReaders = defaultLeadSourceReaders,
): Promise<BuyingIntentProfile | null> {
  const base = await getLeadProfile(companyId, leadKey, readers);
  if (!base) return null;
  const { events, touchpoints, sessions } = await hydrateLeadTracking(companyId, base.view);
  return buildBuyingIntentProfile({ view: base.view, events, touchpoints, sessions, timeline: base.timeline });
}

/**
 * Standalone Lead Action Plan (Phase 11) — the deterministic action layer (actions,
 * readiness, CRM package, qualification, follow-up). Reusable by the workspace, CRM,
 * and future email/calling/automation modules. Composes the buying-intent engine +
 * existing behaviour; no execution, repository-owned.
 */
export async function getLeadActionPlan(
  companyId: string,
  leadKey: string,
  readers: LeadSourceReaders = defaultLeadSourceReaders,
): Promise<LeadActionPlan | null> {
  const base = await getLeadProfile(companyId, leadKey, readers);
  if (!base) return null;
  const { events, touchpoints, sessions } = await hydrateLeadTracking(companyId, base.view);
  const websiteBehaviour = websiteBehaviourProjection({ events, touchpoints, sessionCount: sessions.length });
  const buyingIntent = buildBuyingIntentProfile({ view: base.view, events, touchpoints, sessions, timeline: base.timeline });
  return buildLeadActionPlan({ view: base.view, buyingIntent, behaviour: websiteBehaviour });
}

/**
 * Company Intelligence (Phase 12) — account-centric aggregation across every known
 * contact that shares a prospect company (grouped by a deterministic company key).
 * One bulk collect (anti-N+1); per-contact intent is built from the view alone (no
 * per-contact tracking reads). Tenant-scoped, fail-open, repository-owned. Reusable
 * by the workspace, CRM, and future channels. No execution / no CRM sync.
 */
export async function getCompanyIntelligence(
  companyId: string,
  companyKey: string,
  readers: LeadSourceReaders = defaultLeadSourceReaders,
): Promise<CompanyIntelligenceProfile | null> {
  if (!companyId || !companyKey) return null;
  const key = companyKey.toLowerCase();
  const views = await collectViews(companyId, readers);
  const matched = views.filter((v) => v.organizationId === companyId && resolveCompanyKey(v) === key);
  if (matched.length === 0) return null;
  const contacts = matched.map((view) => ({ view, buyingIntent: buildBuyingIntentProfile({ view }) }));
  const companyName = resolveCompanyName(matched[0]);
  return buildCompanyIntelligence({ companyKey: key, companyName, contacts });
}

export interface LeadExportResult { contentType: string; filename: string; body: string }

/** Repository-backed export (CSV / Excel) over the unified set — never the raw sources. */
export async function exportLeads(
  query: LeadQuery,
  format: 'csv' | 'excel',
  readers: LeadSourceReaders = defaultLeadSourceReaders,
): Promise<LeadExportResult> {
  const all = await searchLeads({ ...query, page: { limit: 5000, offset: 0 } }, readers);
  const rows = all.rows.map((v) => toExportRow(v));
  if (format === 'excel') {
    return { contentType: 'application/vnd.ms-excel; charset=utf-8', filename: 'lead-intelligence.xls', body: toExcelXml(rows) };
  }
  return { contentType: 'text/csv; charset=utf-8', filename: 'lead-intelligence.csv', body: `﻿${toCsv(rows)}` };
}
