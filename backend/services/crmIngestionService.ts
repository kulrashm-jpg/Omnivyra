import { supabase } from '../db/supabaseClient';
import { ingestUnifiedData } from './unifiedIngestionService';
import { authorizeProviderCall, recordProviderUsage } from './providers/providerCostGovernor';
import {
  hashKey,
  lowerCaseKeys,
  parseCsv,
  safeNumber,
} from './ingestionUtils';
import { resolveUnifiedPerson, type IdentityExternalKeys } from './identityResolutionService';
import { bulkCreateTouchpoints, type TouchpointInput } from './touchpointService';
import { normalizeSource, type UnifiedSource } from './sourceNormalizationService';
import { ensureUnifiedPerson } from '../../lib/identity/identityGateway';
import { ownedDbTable } from '../db/writeOwner';
import { adoptLead } from './leadIntelligence/leadIntelligenceRuntime';

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
  touchpointsCreated?: number;
}

type CrmRowsIngestionOptions = {
  batchUnifiedSource?: UnifiedSource;
  ingestionRunId?: string;
  emitTouchpoints?: boolean;
};

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

function isCsvContentInput(input: CrmIngestionInput): boolean {
  return !Array.isArray(input.rows) && typeof input.csvContent === 'string' && input.csvContent.length > 0;
}

function buildCrmIdentityExternalKeys(row: CrmLeadRecord): IdentityExternalKeys {
  const externalId = row.externalId?.trim();
  if (!externalId) {
    return {};
  }

  return {
    crm: {
      external_id: externalId,
    },
  };
}

async function upsertLegacyLead(companyId: string, row: CrmLeadRecord, unifiedSource: UnifiedSource): Promise<void> {
  if (!row.email?.trim()) return;
  const source = row.source?.trim() || 'crm';
  const externalLeadKey = row.externalId || hashKey(companyId, row.email, source);
  const { data: existing } = await ownedDbTable('leads')
    .select('id')
    .eq('company_id', companyId)
    .eq('email', row.email)
    .eq('source', source)
    .limit(1);

  if (existing && existing.length > 0) {
    return;
  }

  const unifiedPersonId = await ensureUnifiedPerson({
    email: row.email,
    phone: row.phone,
    companyId,
  });

  if (!unifiedPersonId) {
    throw new Error('IDENTITY_REQUIRED_FOR_LEAD');
  }

  await ownedDbTable('leads').insert({
    company_id: companyId,
    name: row.name || row.email,
    email: row.email,
    phone: row.phone ?? null,
    source,
    unified_source: unifiedSource,
    unified_person_id: unifiedPersonId,
    metadata: {
      ...(row.metadata ?? {}),
      external_lead_key: externalLeadKey,
      lead_status: row.status ?? null,
      revenue: row.revenue ?? null,
    },
    created_at: row.createdAt ?? new Date().toISOString(),
  });
}

async function upsertCanonicalUser(
  companyId: string,
  row: CrmLeadRecord,
  userKey: string,
  unifiedPersonId: string
): Promise<string> {
  const payload = {
    company_id: companyId,
    external_user_key: userKey,
    user_type: row.email || row.phone ? 'known' : 'anonymous',
    device: 'unknown',
    unified_person_id: unifiedPersonId,
    email: row.email ?? null,
    full_name: row.name ?? null,
    phone: row.phone ?? null,
    user_metadata: {
      source: row.source?.trim() || 'crm',
      crm_external_id: row.externalId ?? null,
    },
  };

  const { data: existing, error: existingError } = await ownedDbTable('canonical_users')
    .select('id')
    .eq('company_id', companyId)
    .eq('external_user_key', userKey)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to check CRM user: ${existingError.message}`);
  }

  if (existing?.id) {
    const { error } = await ownedDbTable('canonical_users').update(payload).eq('id', existing.id);
    if (error) {
      throw new Error(`Failed to update CRM user: ${error.message}`);
    }
    return existing.id;
  }

  const { data, error } = await ownedDbTable('canonical_users').insert(payload).select('id').single();
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
  unifiedSource: UnifiedSource;
  unifiedPersonId: string;
}): Promise<string> {
  const payload = {
    company_id: params.companyId,
    user_id: params.userId,
    unified_person_id: params.unifiedPersonId,
    source: params.source,
    created_at: params.createdAt,
    qualification_score: params.qualificationScore,
    external_lead_key: params.leadKey,
    lead_status: params.row.status ?? null,
    lead_metadata: params.row.metadata ?? {},
    unified_source: params.unifiedSource,
  };

  const { data: existing, error: existingError } = await ownedDbTable('canonical_leads')
    .select('id')
    .eq('company_id', params.companyId)
    .eq('external_lead_key', params.leadKey)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to check CRM lead: ${existingError.message}`);
  }

  if (existing?.id) {
    const { error } = await ownedDbTable('canonical_leads').update(payload).eq('id', existing.id);
    if (error) {
      throw new Error(`Failed to update CRM lead: ${error.message}`);
    }
    return existing.id;
  }

  const { data, error } = await ownedDbTable('canonical_leads').insert(payload).select('id').single();
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
  unifiedSource: UnifiedSource;
  unifiedPersonId: string;
}): Promise<string> {
  const revenueKey = hashKey('crm-revenue', params.companyId, params.leadKey, params.row.revenue, params.row.currencyCode, params.row.campaignId);
  const payload = {
    company_id: params.companyId,
    lead_id: params.leadId,
    unified_person_id: params.unifiedPersonId,
    campaign_id: params.row.campaignId ?? null,
    revenue_amount: safeNumber(params.row.revenue, 0),
    conversion_type: params.row.status ?? 'crm_conversion',
    currency_code: (params.row.currencyCode ?? 'USD').toUpperCase(),
    created_at: params.createdAt,
    external_revenue_key: revenueKey,
    unified_source: params.unifiedSource,
    revenue_metadata: {
      source: params.source,
      crm_external_id: params.row.externalId ?? null,
    },
  };

  const { data: existing, error: existingError } = await ownedDbTable('canonical_revenue_events')
    .select('id')
    .eq('company_id', params.companyId)
    .eq('external_revenue_key', revenueKey)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to check CRM revenue event: ${existingError.message}`);
  }

  if (existing?.id) {
    const { error } = await ownedDbTable('canonical_revenue_events').update(payload).eq('id', existing.id);
    if (error) {
      throw new Error(`Failed to update CRM revenue event: ${error.message}`);
    }
    return existing.id;
  }

  const { data, error } = await ownedDbTable('canonical_revenue_events').insert(payload).select('id').single();
  if (error) {
    throw new Error(`Failed to insert CRM revenue event: ${error.message}`);
  }
  return (data as { id: string }).id;
}

async function ingestCrmRows(
  companyId: string,
  rows: CrmLeadRecord[],
  options: CrmRowsIngestionOptions = {}
): Promise<CrmIngestionResult> {
  let leadsInserted = 0;
  let revenueEventsInserted = 0;
  let touchpointsCreated = 0;
  const touchpoints: TouchpointInput[] = [];

  for (const row of rows) {
    const userKey = row.email?.trim() || row.phone?.trim() || row.externalId || hashKey(companyId, row.name, row.source, row.createdAt);
    const leadKey = row.externalId || hashKey(companyId, row.email, row.phone, row.source, row.createdAt);
    const source = row.source?.trim() || 'crm';
    const createdAt = row.createdAt || new Date().toISOString();
    const unifiedSource = normalizeSource(source, {
      category: source.trim().toLowerCase() === 'crm' ? 'crm' : undefined,
      channel: options.batchUnifiedSource?.channel,
      origin: options.batchUnifiedSource?.origin,
    });
    const identity = await resolveUnifiedPerson({
      companyId,
      email: row.email,
      phone: row.phone,
      externalKeys: buildCrmIdentityExternalKeys(row),
    });

    const userId = await upsertCanonicalUser(companyId, row, userKey, identity.unifiedPersonId);

    const qualificationScore = row.revenue != null ? Math.min(100, Math.max(40, Math.round(safeNumber(row.revenue, 0) / 100))) : 40;

    const leadId = await upsertCanonicalLead({
      companyId,
      userId,
      leadKey,
      source,
      createdAt,
      qualificationScore,
      row,
      unifiedSource,
      unifiedPersonId: identity.unifiedPersonId,
    });

    // Phase 3 — route every imported CRM lead through the canonical facade
    // (identity already resolved above; re-resolution is idempotent). Fail-open.
    adoptLead('crm', {
      id: leadId,
      company_id: companyId,
      source,
      unified_source: unifiedSource,
      qualification_score: qualificationScore,
      unified_person_id: identity.unifiedPersonId,
      ...row,
    });

    await upsertLegacyLead(companyId, row, unifiedSource);

    leadsInserted += 1;

    if (options.emitTouchpoints) {
      touchpoints.push({
        companyId,
        unifiedPersonId: identity.unifiedPersonId,
        source,
        unifiedSource,
        touchpointType: 'lead_created',
        referenceTable: 'canonical_leads',
        referenceId: leadId,
        occurredAt: createdAt,
        metadata: {
          external_lead_key: leadKey,
          crm_external_id: row.externalId ?? null,
          lead_status: row.status ?? null,
          ingestion_run_id: options.ingestionRunId ?? null,
        },
      });
    }

    if (row.revenue != null && safeNumber(row.revenue, 0) > 0) {
      const revenueEventId = await upsertRevenueEvent({
        companyId,
        leadId,
        row,
        leadKey,
        source,
        createdAt,
        unifiedSource,
        unifiedPersonId: identity.unifiedPersonId,
      });

      revenueEventsInserted += 1;

      if (options.emitTouchpoints) {
        touchpoints.push({
          companyId,
          unifiedPersonId: identity.unifiedPersonId,
          source,
          unifiedSource,
          touchpointType: 'revenue',
          referenceTable: 'canonical_revenue_events',
          referenceId: revenueEventId,
          occurredAt: createdAt,
          metadata: {
            external_revenue_key: hashKey('crm-revenue', companyId, leadKey, row.revenue, row.currencyCode, row.campaignId),
            crm_external_id: row.externalId ?? null,
            revenue_amount: safeNumber(row.revenue, 0),
            currency_code: (row.currencyCode ?? 'USD').toUpperCase(),
            conversion_type: row.status ?? 'crm_conversion',
            campaign_id: row.campaignId ?? null,
            ingestion_run_id: options.ingestionRunId ?? null,
          },
        });
      }
    }
  }

  if (options.emitTouchpoints && touchpoints.length > 0) {
    const touchpointResult = await bulkCreateTouchpoints(touchpoints, {
      companyId,
      ingestionRunId: options.ingestionRunId ?? null,
      source: 'crm_csvContent',
    });
    touchpointsCreated = touchpointResult.created;
  }

  return {
    source: 'crm',
    leadsProcessed: rows.length,
    leadsInserted,
    revenueEventsInserted,
    touchpointsCreated,
  };
}

export async function ingestCrmData(input: CrmIngestionInput): Promise<CrmIngestionResult> {
  // Canonical governor gate (no provider bypass): honors kill-switch / dry-run.
  const gov = authorizeProviderCall({ providerId: 'commercial', organizationId: input.companyId });
  if (!gov.allowed) throw new Error(`provider_governor_blocked:commercial:${gov.reason}`);
  void recordProviderUsage({ providerId: 'commercial', organizationId: input.companyId, units: 1, operation: 'ingest' });
  const rows = await loadRows(input);

  if (isCsvContentInput(input)) {
    const result = await ingestUnifiedData(
      {
        companyId: input.companyId,
        source: 'crm',
        sourceType: 'file',
        records: rows,
        metadata: {
          adapter: 'csv',
          format: 'csv',
          flow: 'crm_csvContent',
        },
      },
      {
        idempotencyKey: buildCrmRunKey(input),
        context: {
          loadRecords: async (transformedRecords: any[], context: { unifiedSource?: UnifiedSource; runId?: string }) =>
            ingestCrmRows(input.companyId, transformedRecords as CrmLeadRecord[], {
              batchUnifiedSource: context.unifiedSource,
              ingestionRunId: context.runId,
              emitTouchpoints: true,
            }),
        },
      }
    );

    if (!result.loadResult) {
      throw new Error('CRM CSV unified ingestion completed without a CRM load result');
    }

    return result.loadResult as CrmIngestionResult;
  }

  return ingestCrmRows(input.companyId, rows);
}

export function buildCrmRunKey(input: CrmIngestionInput): string {
  return hashKey('crm', input.companyId, Array.isArray(input.rows) ? input.rows.length : 'rows', input.csvContent?.length ?? 0);
}
