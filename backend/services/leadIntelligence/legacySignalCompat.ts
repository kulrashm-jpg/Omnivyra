/**
 * Repository compatibility reader for the legacy GET /api/leads/signals contract.
 *
 * The ONLY place that endpoint reads from — it owns the `lead_signals` read
 * (optionally composed with `contacts`) and the canonical→legacy projection.
 * The query, contacts join + graceful fallback, ordering (detected_at DESC),
 * range pagination, exact-count, and per-row normalization are reproduced
 * verbatim from the previous inline endpoint implementation, so the contract is
 * byte-identical. Returns null when the canonical table is absent (the endpoint
 * maps that to 503 exactly as before). Community/engagement scope only.
 */

import { supabase } from '../../db/supabaseClient';
import { toLegacyLeadSignal, type LegacyLeadSignal } from '../../../lib/leadIntelligence';

export interface LegacyLeadSignalParams {
  organizationId: string;
  sourceType?: string;
  platform?: string;
  minScore: number | null;
  maxScore: number | null;
  dateFrom: string | null;
  dateTo: string | null;
  threadId?: string;
  contactKey?: string;
  sourceId?: string;
  page: number;
  pageSize: number;
}

function isMissingCanonicalTable(error: { message?: string; code?: string } | null | undefined): boolean {
  const message = String(error?.message ?? '').toLowerCase();
  return (
    error?.code === '42P01' ||
    message.includes('relation "lead_signals" does not exist') ||
    message.includes("could not find the table 'public.lead_signals'")
  );
}

function isMissingContactsSchema(error: { message?: string; code?: string } | null | undefined): boolean {
  const message = String(error?.message ?? '').toLowerCase();
  return (
    message.includes(`could not find the table 'public.contacts'`) ||
    message.includes('relation "contacts" does not exist') ||
    message.includes('relationship') ||
    message.includes('contact_id')
  );
}

export async function getLeadSignals(
  params: LegacyLeadSignalParams,
): Promise<{ items: LegacyLeadSignal[]; total: number } | null> {
  const applyFilters = (query: any) => {
    let next = query
      .eq('organization_id', params.organizationId)
      .order('detected_at', { ascending: false })
      .range((params.page - 1) * params.pageSize, params.page * params.pageSize - 1);

    if (params.sourceType) next = next.eq('source_type', params.sourceType);
    if (params.platform) next = next.eq('platform', params.platform);
    if (params.threadId) next = next.eq('thread_id', params.threadId);
    if (params.contactKey) next = next.eq('contact_key', params.contactKey);
    if (params.sourceId) next = next.eq('source_id', params.sourceId);
    if (params.minScore != null) next = next.gte('total_score', params.minScore);
    if (params.maxScore != null) next = next.lte('total_score', params.maxScore);
    if (params.dateFrom) next = next.gte('detected_at', params.dateFrom);
    if (params.dateTo) next = next.lte('detected_at', params.dateTo);
    return next;
  };

  const withContacts =
    'id, organization_id, source_type, source_id, thread_id, platform, platform_user_id, content_text, intent_score, urgency_score, icp_score, confidence_score, total_score, detected_at, contact_key, contact_id, metadata, contact:contacts(id, platform, platform_user_id, display_name)';
  const withoutContacts =
    'id, organization_id, source_type, source_id, thread_id, platform, platform_user_id, content_text, intent_score, urgency_score, icp_score, confidence_score, total_score, detected_at, contact_key, contact_id, metadata';

  let { data, error, count } = await applyFilters(
    (supabase as any).from('lead_signals').select(withContacts, { count: 'exact' }),
  );
  if (error) {
    if (isMissingContactsSchema(error)) {
      ({ data, error, count } = await applyFilters(
        (supabase as any).from('lead_signals').select(withoutContacts, { count: 'exact' }),
      ));
    }
    if (isMissingCanonicalTable(error)) return null;
    if (error) throw new Error(error.message || 'Failed to read canonical lead signals');
  }

  const items = ((data ?? []) as Array<Record<string, unknown>>).map(toLegacyLeadSignal);
  return { items, total: count ?? items.length };
}
