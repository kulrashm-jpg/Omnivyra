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
import { onLeadEnrichmentChanged } from './leadIntelligenceActivation';
import { ownedDbTable } from '../db/writeOwner';
import { adoptLead } from './leadIntelligence/leadIntelligenceRuntime';
import { ingestSourceRecord } from './prospectIdentity/ingestionBoundary';

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

  const { data: inserted } = await ownedDbTable('leads').insert({
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
  }).select('id').single();

  // INT-002 Wave 1: CRM data entering the lead row IS an enrichment change —
  // fire-and-forget regeneration through the designated enrichment hook.
  const newLeadId = inserted && typeof (inserted as { id?: unknown }).id === 'string' ? (inserted as { id: string }).id : null;
  if (newLeadId) onLeadEnrichmentChanged(companyId, newLeadId);
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

/**
 * LI-4B — record CRM-originated PROSPECT evidence through the LI-2 boundary.
 *
 * The LI-4A audit found this service to be the one live ingestion path that
 * writes prospect data with no canonical provenance: 18 leads existed against 0
 * source records. This closes that gap and nothing else.
 *
 * ─── PROSPECT ONLY. REVENUE IS DELIBERATELY EXCLUDED. ─────────────────────
 * A `CrmLeadRecord` carries two different kinds of data, and the split is
 * explicit in `ingestCrmRows`: the person fields are read unconditionally,
 * while `revenue` / `currencyCode` / `campaignId` are used only inside the
 * `row.revenue != null` branch that writes `canonical_revenue_events`. Only the
 * person half is sent here. Pushing revenue through a prospect-identity
 * boundary would make `source_assertions` — a person/account evidence table —
 * the home of financial facts it has no vocabulary for.
 *
 * ─── NO SECOND IDENTITY RESOLVER ──────────────────────────────────────────
 * The caller has already resolved the person via `resolveUnifiedPerson`; that
 * id is passed in. This function never resolves, creates or matches identity.
 *
 * ─── BEST EFFORT, BY DESIGN ───────────────────────────────────────────────
 * Provenance is evidence, not a gate. This path is LIVE and also carries a
 * revenue pipeline, so a provenance failure must not destroy a CRM sync that
 * would otherwise have succeeded — the same fail-open posture `adoptLead`
 * already takes here. Governance, which MUST fail closed, is a separate
 * concern on the outreach side and is untouched by this phase.
 */
async function recordCrmProspectProvenance(params: {
  companyId: string;
  row: CrmLeadRecord;
  provider: string;
  unifiedPersonId: string;
  sourceRecordId: string;
  observedAt: string | null;
  ingestionRunId?: string | null;
}): Promise<void> {
  try {
    await ingestSourceRecord({
      organizationId: params.companyId,          // TENANT — never the prospect's employer
      provider: params.provider,
      entityType: 'person',
      sourceRecordId: params.sourceRecordId,
      // The prospect-shaped subset, verbatim. `redactSecrets` and the payload
      // hash are applied by the boundary itself, so change detection and
      // credential stripping are not re-implemented here.
      rawPayload: {
        externalId: params.row.externalId ?? null,
        name: params.row.name ?? null,
        email: params.row.email ?? null,
        phone: params.row.phone ?? null,
        source: params.row.source ?? null,
        status: params.row.status ?? null,
        createdAt: params.row.createdAt ?? null,
      },
      personId: params.unifiedPersonId,
      observedAt: params.observedAt,
      ingestionRunId: params.ingestionRunId ?? null,
      // The only attribute CRM asserts about the person. LI-2's rules decide
      // whether it may reach canonical: it fills a NULL when uncontested and
      // never overwrites, so no provider precedence is introduced here.
      personAttributes: { fullName: params.row.name ?? null },
    });
  } catch (err) {
    console.warn('[crmIngestion] prospect provenance skipped:', (err as Error)?.message);
  }
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

    // LI-4B — retain the evidence behind this prospect BEFORE anything derived
    // from it is written. The source record is the reason the canonical rows
    // below exist, and provenance recorded after the fact is provenance that can
    // be missing for every row that failed midway.
    //
    // `sourceRecordId` is the CRM's own identifier when it supplies one. When it
    // does not, `leadKey` is the deterministic row identity the service already
    // computes for this record — a hash, not a row number and not an email —
    // which is exactly what the LI-2 contract asks of a file-shaped source.
    await recordCrmProspectProvenance({
      companyId,
      row,
      provider: source,
      unifiedPersonId: identity.unifiedPersonId,
      sourceRecordId: row.externalId?.trim() || leadKey,
      observedAt: row.createdAt ?? null,
      ingestionRunId: options.ingestionRunId ?? null,
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
