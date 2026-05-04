import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';
import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '@/backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { enforceCompanyAccess, resolveUserContext } from '@/backend/services/userContextService';

type SourceType = 'engagement' | 'listening';

type CanonicalLeadSignal = {
  id: string;
  organization_id: string;
  source_type: SourceType;
  source_id: string;
  thread_id: string | null;
  platform: string | null;
  platform_user_id: string | null;
  content_text: string;
  intent_score: number | null;
  urgency_score: number | null;
  icp_score: number | null;
  confidence_score: number | null;
  total_score: number | null;
  detected_at: string | null;
  contact_key: string | null;
  contact_id: string | null;
  metadata: Record<string, unknown>;
  contact?: {
    contact_id: string | null;
    platform: string | null;
    platform_user_id: string | null;
    display_name: string | null;
  } | null;
};

function normalizeNumber(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeDateQuery(value: string | string[] | undefined, endOfDay = false): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const suffix = endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z';
  const parsed = new Date(raw.includes('T') ? raw : `${raw}${suffix}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
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

function scoreInRange(score: number | null, minScore: number | null, maxScore: number | null): boolean {
  const value = score ?? 0;
  if (minScore != null && value < minScore) return false;
  if (maxScore != null && value > maxScore) return false;
  return true;
}

function dateInRange(value: string | null, dateFrom: string | null, dateTo: string | null): boolean {
  if (!value) return true;
  const iso = new Date(value).toISOString();
  if (dateFrom && iso < dateFrom) return false;
  if (dateTo && iso > dateTo) return false;
  return true;
}

async function fetchCanonicalSignals(params: {
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
}): Promise<{ items: CanonicalLeadSignal[]; total: number } | null> {
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
    (supabase as any).from('lead_signals').select(withContacts, { count: 'exact' })
  );
  if (error) {
    if (isMissingContactsSchema(error)) {
      ({ data, error, count } = await applyFilters(
        (supabase as any).from('lead_signals').select(withoutContacts, { count: 'exact' })
      ));
    }
    if (isMissingCanonicalTable(error)) return null;
    if (error) throw new Error(error.message || 'Failed to read canonical lead signals');
  }

  const items = ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const contact = row.contact as Record<string, unknown> | null | undefined;
    return {
      id: String(row.id),
      organization_id: String(row.organization_id),
      source_type: String(row.source_type) as SourceType,
      source_id: String(row.source_id),
      thread_id: typeof row.thread_id === 'string' ? row.thread_id : null,
      platform: typeof row.platform === 'string' ? row.platform : null,
      platform_user_id: typeof row.platform_user_id === 'string' ? row.platform_user_id : null,
      content_text: typeof row.content_text === 'string' ? row.content_text : '',
      intent_score: normalizeNumber(row.intent_score),
      urgency_score: normalizeNumber(row.urgency_score),
      icp_score: normalizeNumber(row.icp_score),
      confidence_score: normalizeNumber(row.confidence_score),
      total_score: normalizeNumber(row.total_score),
      detected_at: typeof row.detected_at === 'string' ? row.detected_at : null,
      contact_key: typeof row.contact_key === 'string' ? row.contact_key : null,
      contact_id: typeof row.contact_id === 'string' ? row.contact_id : null,
      metadata: (row.metadata as Record<string, unknown> | null) ?? {},
      contact: contact
        ? {
            contact_id: typeof contact.id === 'string' ? contact.id : null,
            platform: typeof contact.platform === 'string' ? contact.platform : null,
            platform_user_id: typeof contact.platform_user_id === 'string' ? contact.platform_user_id : null,
            display_name: typeof contact.display_name === 'string' ? contact.display_name : null,
          }
        : null,
    };
  });

  return { items, total: count ?? items.length };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await resolveUserContext(req);
    const organizationId = (req.query.organization_id ?? req.query.organizationId ?? user?.defaultCompanyId) as
      | string
      | undefined;

    if (!organizationId) {
      return res.status(400).json({ error: 'organization_id required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: organizationId });
    if (!access) return;

    const sourceType = typeof req.query.source_type === 'string' ? req.query.source_type : undefined;
    const platform = typeof req.query.platform === 'string' ? req.query.platform : undefined;
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size ?? 20) || 20));
    const minScore = normalizeNumber(req.query.min_score);
    const maxScore = normalizeNumber(req.query.max_score);
    const dateFrom = normalizeDateQuery(req.query.date_from);
    const dateTo = normalizeDateQuery(req.query.date_to, true);
    const threadId = typeof req.query.thread_id === 'string' ? req.query.thread_id : undefined;
    const contactKey = typeof req.query.contact_key === 'string' ? req.query.contact_key : undefined;
    const sourceId = typeof req.query.source_id === 'string' ? req.query.source_id : undefined;

    const canonical = await fetchCanonicalSignals({
      organizationId,
      sourceType,
      platform,
      minScore,
      maxScore,
      dateFrom,
      dateTo,
      threadId,
      contactKey,
      sourceId,
      page,
      pageSize,
    });

    if (!canonical) {
      return res.status(503).json({ error: 'Canonical lead_signals table is unavailable' });
    }

    return res.status(200).json({
      items: canonical.items,
      total: canonical.total,
      page,
      page_size: pageSize,
      has_more: page * pageSize < canonical.total,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load lead signals';
    console.error('[api/leads/signals]', message);
    return res.status(500).json({ error: message });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

