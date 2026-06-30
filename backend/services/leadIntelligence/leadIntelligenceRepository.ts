/**
 * Durable Lead Intelligence repository — the canonical store + unified read model.
 *
 * Writes the canonical lead idempotently (upsert on company_id+dedupe_key) and
 * appends provenance to the events timeline. Reads return the unified
 * `CanonicalLeadView` regardless of origin — consumers never touch fragmented
 * source tables. Best-effort / fail-open: if the additive table is not yet applied
 * (prod↔ledger desync), writes/reads degrade to null/[] and never throw, exactly
 * like the existing collection/design-system services. Tenant isolation: every
 * query is company_id-scoped (+ RLS at the DB).
 */

import { ownedDbTable } from '../../db/writeOwner';
import {
  computeLeadDedupeKey,
  buildCampaignIntelligence,
  buildTimeline,
  CANONICAL_LEAD_SOURCE_LABELS,
  type CanonicalLead,
  type CanonicalLeadView,
  type CanonicalLeadSource,
  type CanonicalAttribution,
  type TimelineEvent,
} from '../../../lib/leadIntelligence';

const TABLE = 'lead_intelligence';
const EVENTS = 'lead_intelligence_events';
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function toRow(lead: CanonicalLead): Record<string, unknown> {
  return {
    company_id: lead.organizationId,
    dedupe_key: computeLeadDedupeKey(lead),
    source: lead.source,
    unified_person_id: lead.unifiedPersonId ?? null,
    status: lead.status ?? null,
    scores: lead.scores ?? {},
    identity: lead.identity,
    attribution: lead.attribution,
    campaign: buildCampaignIntelligence(lead),
    content: {},
    metadata: lead.attribution.sourceMetadata,
    source_table: lead.sourceRef?.table ?? null,
    source_id: lead.sourceRef?.id ?? null,
    occurred_at: lead.occurredAt ?? null,
    ingested_at: lead.ingestedAt,
    updated_at: new Date().toISOString(),
  };
}

function rowToView(row: Record<string, unknown>): CanonicalLeadView {
  const source = String(row.source) as CanonicalLeadSource;
  const attribution = obj(row.attribution) as unknown as CanonicalAttribution;
  return {
    organizationId: String(row.company_id),
    source,
    sourceLabel: CANONICAL_LEAD_SOURCE_LABELS[source] ?? String(row.source),
    unifiedPersonId: (row.unified_person_id as string | null) ?? null,
    identity: obj(row.identity),
    scores: obj(row.scores),
    status: (row.status as string | null) ?? null,
    campaign: attribution?.campaign ?? null,
    content: attribution?.content ?? null,
    referrer: attribution?.referrer ?? null,
    utm: attribution?.utm ?? { source: null, medium: null, campaign: null, content: null, term: null },
    occurredAt: (row.occurred_at as string | null) ?? null,
    sourceRef: row.source_table ? { table: String(row.source_table), id: (row.source_id as string | null) ?? null } : null,
    attribution: attribution ?? ({ originalSource: null, originalChannel: null, campaign: null, content: null, session: null, journey: null, referrer: null, utm: { source: null, medium: null, campaign: null, content: null, term: null }, identity: {}, sourceMetadata: {} }),
  };
}

function rowToEvent(row: Record<string, unknown>): TimelineEvent {
  return {
    origin: String(row.origin ?? 'unknown'),
    source: String(row.source ?? 'other') as CanonicalLeadSource,
    entityId: (row.entity_id as string | null) ?? null,
    eventType: String(row.event_type ?? 'event'),
    occurredAt: (row.occurred_at as string | null) ?? null,
    metadata: obj(row.metadata),
  };
}

/** Idempotent canonical upsert (company_id + dedupe_key). Returns the row id, or null (fail-open). */
export async function upsertCanonicalLead(lead: CanonicalLead): Promise<{ id: string } | null> {
  if (!lead.organizationId) return null;
  try {
    const { data, error } = await ownedDbTable(TABLE)
      .upsert(toRow(lead), { onConflict: 'company_id,dedupe_key' })
      .select('id')
      .maybeSingle();
    if (error || !data) return null;
    return { id: String((data as Record<string, unknown>).id) };
  } catch {
    return null;
  }
}

/** Append a provenance event to the timeline. Fail-open. */
export async function appendLeadEvent(companyId: string, leadId: string, event: TimelineEvent): Promise<void> {
  try {
    await ownedDbTable(EVENTS).insert({
      company_id: companyId,
      lead_id: leadId,
      origin: event.origin,
      source: event.source,
      entity_id: event.entityId,
      event_type: event.eventType,
      occurred_at: event.occurredAt,
      metadata: event.metadata,
    });
  } catch {
    /* fail-open */
  }
}

export async function getCanonicalLead(companyId: string, id: string): Promise<CanonicalLeadView | null> {
  try {
    const { data, error } = await ownedDbTable(TABLE).select('*').eq('company_id', companyId).eq('id', id).maybeSingle();
    if (error || !data) return null;
    return rowToView(data as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function listCanonicalLeads(input: {
  companyId: string;
  source?: CanonicalLeadSource;
  unifiedPersonId?: string;
  limit?: number;
}): Promise<CanonicalLeadView[]> {
  if (!input.companyId) return [];
  try {
    let query = ownedDbTable(TABLE)
      .select('*')
      .eq('company_id', input.companyId)
      .order('occurred_at', { ascending: false })
      .limit(Math.max(1, Math.min(input.limit ?? 200, 1000)));
    if (input.source) query = query.eq('source', input.source);
    if (input.unifiedPersonId) query = query.eq('unified_person_id', input.unifiedPersonId);
    const { data, error } = await query;
    if (error || !Array.isArray(data)) return [];
    return (data as Record<string, unknown>[]).map(rowToView);
  } catch {
    return [];
  }
}

export async function getLeadTimeline(companyId: string, leadId: string): Promise<TimelineEvent[]> {
  try {
    const { data, error } = await ownedDbTable(EVENTS).select('*').eq('company_id', companyId).eq('lead_id', leadId).limit(1000);
    if (error || !Array.isArray(data)) return [];
    return buildTimeline((data as Record<string, unknown>[]).map(rowToEvent));
  } catch {
    return [];
  }
}
