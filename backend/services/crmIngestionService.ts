import { supabase } from '../db/supabaseClient';
import {
  hashKey,
  lowerCaseKeys,
  parseCsv,
  safeNumber,
} from './ingestionUtils';

export interface CrmLeadRecord {
  externalId?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  status?: string | null;
  revenue?: number | string | null;
  currencyCode?: string | null;
  createdAt?: string | null;
  campaignId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface CrmIngestionInput {
  companyId: string;
  csvContent?: string;
  rows?: CrmLeadRecord[];
}

export interface CrmIngestionResult {
  source: 'crm';
  leadsProcessed: number;
  leadsInserted: number;
  revenueEventsInserted: number;
}

function normalizeCrmRow(row: Record<string, unknown>): CrmLeadRecord {
  const lower = lowerCaseKeys(row);
  return {
    externalId: String(lower.externalid ?? lower.external_id ?? lower.id ?? '').trim() || null,
    name: String(lower.name ?? lower.full_name ?? '').trim() || null,
    email: String(lower.email ?? '').trim() || null,
    phone: String(lower.phone ?? lower.phone_number ?? '').trim() || null,
    source: String(lower.source ?? lower.lead_source ?? 'crm').trim() || 'crm',
    status: String(lower.status ?? lower.lead_status ?? '').trim() || null,
    revenue: (lower.revenue ?? lower.amount ?? lower.deal_value ?? null) as string | number | null,
    currencyCode: String(lower.currencycode ?? lower.currency_code ?? lower.currency ?? 'USD').trim() || 'USD',
    createdAt: String(lower.createdat ?? lower.created_at ?? '').trim() || null,
    campaignId: String(lower.campaignid ?? lower.campaign_id ?? '').trim() || null,
    metadata: typeof lower.metadata === 'object' && lower.metadata ? (lower.metadata as Record<string, unknown>) : {},
  };
}

async function loadRows(input: CrmIngestionInput): Promise<CrmLeadRecord[]> {
  if (Array.isArray(input.rows)) {
    return input.rows;
  }
  if (input.csvContent) {
    return parseCsv(input.csvContent).map((row) => normalizeCrmRow(row));
  }
  return [];
}

async function upsertLegacyLead(companyId: string, row: CrmLeadRecord): Promise<void> {
  if (!row.email?.trim()) return;
  const source = row.source?.trim() || 'crm';
  const externalLeadKey = row.externalId || hashKey(companyId, row.email, source);
  const { data: existing } = await supabase
    .from('leads')
    .select('id')
    .eq('company_id', companyId)
    .eq('email', row.email)
    .eq('source', source)
    .limit(1);

  if (existing && existing.length > 0) {
    return;
  }

  await supabase.from('leads').insert({
    company_id: companyId,
    name: row.name || row.email,
    email: row.email,
    phone: row.phone ?? null,
    source,
    metadata: {
      ...(row.metadata ?? {}),
      external_lead_key: externalLeadKey,
      lead_status: row.status ?? null,
      revenue: row.revenue ?? null,
    },
    created_at: row.createdAt ?? new Date().toISOString(),
  });
}

async function upsertCanonicalUser(companyId: string, row: CrmLeadRecord, userKey: string): Promise<string> {
  const payload = {
    company_id: companyId,
    external_user_key: userKey,
    user_type: row.email || row.phone ? 'known' : 'anonymous',
    device: 'unknown',
    email: row.email ?? null,
    full_name: row.name ?? null,
    phone: row.phone ?? null,
    user_metadata: {
      source: row.source?.trim() || 'crm',
      crm_external_id: row.externalId ?? null,
    },
  };

  const { data: existing, error: existingError } = await supabase
    .from('canonical_users')
    .select('id')
    .eq('company_id', companyId)
    .eq('external_user_key', userKey)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to check CRM user: ${existingError.message}`);
  }

  if (existing?.id) {
    const { error } = await supabase.from('canonical_users').update(payload).eq('id', existing.id);
    if (error) {
      throw new Error(`Failed to update CRM user: ${error.message}`);
    }
    return existing.id;
  }

  const { data, error } = await supabase.from('canonical_users').insert(payload).select('id').single();
  if (error) {
    throw new Error(`Failed to insert CRM user: ${error.message}`);
  }
  return (data as { id: string }).id;
}

async function upsertCanonicalLead(params: {
  companyId: string;
  userId: string;
  leadKey: string;
  source: string;
  createdAt: string;
  qualificationScore: number;
  row: CrmLeadRecord;
}): Promise<string> {
  const payload = {
    company_id: params.companyId,
    user_id: params.userId,
    source: params.source,
    created_at: params.createdAt,
    qualification_score: params.qualificationScore,
    external_lead_key: params.leadKey,
    lead_status: params.row.status ?? null,
    lead_metadata: params.row.metadata ?? {},
  };

  const { data: existing, error: existingError } = await supabase
    .from('canonical_leads')
    .select('id')
    .eq('company_id', params.companyId)
    .eq('external_lead_key', params.leadKey)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to check CRM lead: ${existingError.message}`);
  }

  if (existing?.id) {
    const { error } = await supabase.from('canonical_leads').update(payload).eq('id', existing.id);
    if (error) {
      throw new Error(`Failed to update CRM lead: ${error.message}`);
    }
    return existing.id;
  }

  const { data, error } = await supabase.from('canonical_leads').insert(payload).select('id').single();
  if (error) {
    throw new Error(`Failed to insert CRM lead: ${error.message}`);
  }
  return (data as { id: string }).id;
}

async function upsertRevenueEvent(params: {
  companyId: string;
  leadId: string;
  row: CrmLeadRecord;
  leadKey: string;
  source: string;
  createdAt: string;
}): Promise<void> {
  const revenueKey = hashKey('crm-revenue', params.companyId, params.leadKey, params.row.revenue, params.row.currencyCode, params.row.campaignId);
  const payload = {
    company_id: params.companyId,
    lead_id: params.leadId,
    campaign_id: params.row.campaignId ?? null,
    revenue_amount: safeNumber(params.row.revenue, 0),
    conversion_type: params.row.status ?? 'crm_conversion',
    currency_code: (params.row.currencyCode ?? 'USD').toUpperCase(),
    created_at: params.createdAt,
    external_revenue_key: revenueKey,
    revenue_metadata: {
      source: params.source,
      crm_external_id: params.row.externalId ?? null,
    },
  };

  const { data: existing, error: existingError } = await supabase
    .from('canonical_revenue_events')
    .select('id')
    .eq('company_id', params.companyId)
    .eq('external_revenue_key', revenueKey)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to check CRM revenue event: ${existingError.message}`);
  }

  if (existing?.id) {
    const { error } = await supabase.from('canonical_revenue_events').update(payload).eq('id', existing.id);
    if (error) {
      throw new Error(`Failed to update CRM revenue event: ${error.message}`);
    }
    return;
  }

  const { error } = await supabase.from('canonical_revenue_events').insert(payload);
  if (error) {
    throw new Error(`Failed to insert CRM revenue event: ${error.message}`);
  }
}

export async function ingestCrmData(input: CrmIngestionInput): Promise<CrmIngestionResult> {
  const rows = await loadRows(input);
  let leadsInserted = 0;
  let revenueEventsInserted = 0;

  for (const row of rows) {
    const userKey = row.email?.trim() || row.phone?.trim() || row.externalId || hashKey(input.companyId, row.name, row.source, row.createdAt);
    const leadKey = row.externalId || hashKey(input.companyId, row.email, row.phone, row.source, row.createdAt);
    const source = row.source?.trim() || 'crm';
    const createdAt = row.createdAt || new Date().toISOString();

    const userId = await upsertCanonicalUser(input.companyId, row, userKey);

    const qualificationScore = row.revenue != null ? Math.min(100, Math.max(40, Math.round(safeNumber(row.revenue, 0) / 100))) : 40;

    const leadId = await upsertCanonicalLead({
      companyId: input.companyId,
      userId,
      leadKey,
      source,
      createdAt,
      qualificationScore,
      row,
    });

    await upsertLegacyLead(input.companyId, row);

    leadsInserted += 1;

    if (row.revenue != null && safeNumber(row.revenue, 0) > 0) {
      await upsertRevenueEvent({
        companyId: input.companyId,
        leadId,
        row,
        leadKey,
        source,
        createdAt,
      });

      revenueEventsInserted += 1;
    }
  }

  return {
    source: 'crm',
    leadsProcessed: rows.length,
    leadsInserted,
    revenueEventsInserted,
  };
}

export function buildCrmRunKey(input: CrmIngestionInput): string {
  return hashKey('crm', input.companyId, Array.isArray(input.rows) ? input.rows.length : 'rows', input.csvContent?.length ?? 0);
}
