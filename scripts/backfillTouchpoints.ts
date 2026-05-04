import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

import { createServiceRoleMigrationProxy } from '../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { createLastTouchAttributionsForRevenueTouchpoints } from '../backend/services/attributionService';
import { normalizeSource, type UnifiedSource } from '../backend/services/sourceNormalizationService';
import { bulkCreateTouchpoints, type TouchpointInput } from '../backend/services/touchpointService';

const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 1000;

type CanonicalLeadRow = {
  id: string;
  company_id: string;
  unified_person_id: string | null;
  source: string | null;
  unified_source: Record<string, unknown> | null;
  external_lead_key?: string | null;
  lead_status?: string | null;
  created_at: string;
};

type CanonicalRevenueRow = {
  id: string;
  company_id: string;
  unified_person_id: string | null;
  unified_source: Record<string, unknown> | null;
  lead_id: string | null;
  campaign_id: string | null;
  revenue_amount: number | string | null;
  conversion_type: string | null;
  currency_code: string | null;
  external_revenue_key?: string | null;
  revenue_metadata?: Record<string, unknown> | null;
  created_at: string;
};

type RevenueTouchpointRow = {
  id: string;
  company_id: string;
  unified_person_id: string | null;
  touchpoint_type: string;
  occurred_at: string;
};

type BackfillCounts = {
  leadsProcessed: number;
  leadTouchpointsCreated: number;
  leadTouchpointsSkipped: number;
  revenueProcessed: number;
  revenueTouchpointsCreated: number;
  revenueTouchpointsSkipped: number;
  attributionCreated: number;
  attributionSkipped: number;
  batches: number;
};

type CliOptions = {
  batchSize: number;
  companyId?: string;
};

function parseCliOptions(argv: string[]): CliOptions {
  let batchSize = DEFAULT_BATCH_SIZE;
  let companyId: string | undefined;

  for (const arg of argv) {
    if (arg.startsWith('--batch-size=')) {
      const raw = Number(arg.slice('--batch-size='.length));
      if (Number.isFinite(raw) && raw > 0) {
        batchSize = Math.min(MAX_BATCH_SIZE, Math.floor(raw));
      }
      continue;
    }

    if (arg.startsWith('--company-id=')) {
      const raw = arg.slice('--company-id='.length).trim();
      if (raw) companyId = raw;
    }
  }

  return { batchSize, companyId };
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeUnifiedSource(value: unknown, fallbackSource: string): UnifiedSource {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const provider = typeof record.provider === 'string' ? record.provider.trim() : '';
    const category = typeof record.category === 'string' ? record.category.trim() : '';
    if (provider && category) {
      return record as UnifiedSource;
    }
  }

  return normalizeSource(fallbackSource);
}

function sourceFromRevenue(row: CanonicalRevenueRow): string {
  const metadata = normalizeMetadata(row.revenue_metadata);
  const metadataSource = typeof metadata.source === 'string' ? metadata.source.trim() : '';
  if (metadataSource) return metadataSource;

  const unifiedSourceProvider =
    row.unified_source && typeof row.unified_source.provider === 'string'
      ? row.unified_source.provider.trim()
      : '';
  return unifiedSourceProvider || 'crm';
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function leadToTouchpoint(row: CanonicalLeadRow): TouchpointInput {
  const source = row.source?.trim() || 'crm';

  return {
    companyId: row.company_id,
    unifiedPersonId: row.unified_person_id,
    source,
    unifiedSource: normalizeUnifiedSource(row.unified_source, source),
    touchpointType: 'lead_created',
    referenceTable: 'canonical_leads',
    referenceId: row.id,
    occurredAt: row.created_at,
    metadata: {
      backfilled: true,
      backfill_source: 'scripts/backfillTouchpoints.ts',
      external_lead_key: row.external_lead_key ?? null,
      lead_status: row.lead_status ?? null,
    },
  };
}

function revenueToTouchpoint(row: CanonicalRevenueRow): TouchpointInput {
  const source = sourceFromRevenue(row);
  const amount = numberOrNull(row.revenue_amount);

  return {
    companyId: row.company_id,
    unifiedPersonId: row.unified_person_id,
    source,
    unifiedSource: normalizeUnifiedSource(row.unified_source, source),
    touchpointType: 'revenue',
    referenceTable: 'canonical_revenue_events',
    referenceId: row.id,
    occurredAt: row.created_at,
    metadata: {
      ...normalizeMetadata(row.revenue_metadata),
      backfilled: true,
      backfill_source: 'scripts/backfillTouchpoints.ts',
      lead_id: row.lead_id ?? null,
      campaign_id: row.campaign_id ?? null,
      revenue_amount: amount,
      currency_code: row.currency_code ?? null,
      conversion_type: row.conversion_type ?? null,
      external_revenue_key: row.external_revenue_key ?? null,
    },
  };
}

async function fetchLeadBatch(
  offset: number,
  batchSize: number,
  companyId?: string
): Promise<CanonicalLeadRow[]> {
  let query = supabase
    .from('canonical_leads')
    .select('id, company_id, unified_person_id, source, unified_source, external_lead_key, lead_status, created_at')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(offset, offset + batchSize - 1);

  if (companyId) {
    query = query.eq('company_id', companyId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to fetch canonical_leads batch: ${error.message}`);
  }

  return (data ?? []) as CanonicalLeadRow[];
}

async function fetchRevenueBatch(
  offset: number,
  batchSize: number,
  companyId?: string
): Promise<CanonicalRevenueRow[]> {
  let query = supabase
    .from('canonical_revenue_events')
    .select('id, company_id, unified_person_id, unified_source, lead_id, campaign_id, revenue_amount, conversion_type, currency_code, external_revenue_key, revenue_metadata, created_at')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(offset, offset + batchSize - 1);

  if (companyId) {
    query = query.eq('company_id', companyId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to fetch canonical_revenue_events batch: ${error.message}`);
  }

  return (data ?? []) as CanonicalRevenueRow[];
}

async function loadExistingRevenueTouchpointsForBatch(
  rows: CanonicalRevenueRow[],
  newlyCreatedTouchpointIds: Set<string>
): Promise<RevenueTouchpointRow[]> {
  const referenceIds = rows.map((row) => row.id).filter(Boolean);
  if (referenceIds.length === 0) {
    return [];
  }

  const companyIds = Array.from(new Set(rows.map((row) => row.company_id).filter(Boolean)));
  let query = supabase
    .from('unified_touchpoints')
    .select('id, company_id, unified_person_id, touchpoint_type, occurred_at')
    .eq('reference_table', 'canonical_revenue_events')
    .eq('touchpoint_type', 'revenue')
    .in('reference_id', referenceIds);

  if (companyIds.length === 1) {
    query = query.eq('company_id', companyIds[0]);
  } else if (companyIds.length > 1) {
    query = query.in('company_id', companyIds);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load existing revenue touchpoints for attribution backfill: ${error.message}`);
  }

  return ((data ?? []) as RevenueTouchpointRow[]).filter(
    (touchpoint) => !newlyCreatedTouchpointIds.has(touchpoint.id)
  );
}

async function backfillLeads(options: CliOptions, counts: BackfillCounts): Promise<void> {
  let offset = 0;

  while (true) {
    const rows = await fetchLeadBatch(offset, options.batchSize, options.companyId);
    if (rows.length === 0) break;

    const result = await bulkCreateTouchpoints(rows.map(leadToTouchpoint), {
      source: 'backfillTouchpoints',
      backfillSource: 'canonical_leads',
      batchOffset: offset,
      batchSize: options.batchSize,
      companyId: options.companyId ?? null,
    });

    counts.leadsProcessed += rows.length;
    counts.leadTouchpointsCreated += result.created;
    counts.leadTouchpointsSkipped += result.skipped;
    counts.batches += 1;

    console.log(
      JSON.stringify({
        event: 'backfill_touchpoints_leads_batch',
        offset,
        processed: rows.length,
        touchpoints_created: result.created,
        touchpoints_skipped: result.skipped,
      })
    );

    if (rows.length < options.batchSize) break;
    offset += options.batchSize;
  }
}

async function backfillRevenue(options: CliOptions, counts: BackfillCounts): Promise<void> {
  let offset = 0;

  while (true) {
    const rows = await fetchRevenueBatch(offset, options.batchSize, options.companyId);
    if (rows.length === 0) break;

    const result = await bulkCreateTouchpoints(rows.map(revenueToTouchpoint), {
      source: 'backfillTouchpoints',
      backfillSource: 'canonical_revenue_events',
      batchOffset: offset,
      batchSize: options.batchSize,
      companyId: options.companyId ?? null,
    });

    counts.revenueProcessed += rows.length;
    counts.revenueTouchpointsCreated += result.created;
    counts.revenueTouchpointsSkipped += result.skipped;
    counts.attributionCreated += result.attribution?.created ?? 0;
    counts.attributionSkipped += result.attribution?.skipped ?? 0;

    let attributionRepairedCreated = 0;
    let attributionRepairedSkipped = 0;
    const existingRevenueTouchpoints = await loadExistingRevenueTouchpointsForBatch(
      rows,
      new Set(result.touchpointIds ?? [])
    );
    if (existingRevenueTouchpoints.length > 0) {
      const attributionRepair = await createLastTouchAttributionsForRevenueTouchpoints(
        existingRevenueTouchpoints,
        {
          source: 'backfillTouchpoints',
          backfillSource: 'existing_revenue_touchpoints',
          batchOffset: offset,
          batchSize: options.batchSize,
          companyId: options.companyId ?? null,
        }
      );

      counts.attributionCreated += attributionRepair.created;
      counts.attributionSkipped += attributionRepair.skipped;
      attributionRepairedCreated = attributionRepair.created;
      attributionRepairedSkipped = attributionRepair.skipped;
    }

    counts.batches += 1;

    console.log(
      JSON.stringify({
        event: 'backfill_touchpoints_revenue_batch',
        offset,
        processed: rows.length,
        touchpoints_created: result.created,
        touchpoints_skipped: result.skipped,
        attribution_created: result.attribution?.created ?? 0,
        attribution_skipped: result.attribution?.skipped ?? 0,
        attribution_repaired_created: attributionRepairedCreated,
        attribution_repaired_skipped: attributionRepairedSkipped,
        existing_revenue_touchpoints_checked: existingRevenueTouchpoints.length,
      })
    );

    if (rows.length < options.batchSize) break;
    offset += options.batchSize;
  }
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const counts: BackfillCounts = {
    leadsProcessed: 0,
    leadTouchpointsCreated: 0,
    leadTouchpointsSkipped: 0,
    revenueProcessed: 0,
    revenueTouchpointsCreated: 0,
    revenueTouchpointsSkipped: 0,
    attributionCreated: 0,
    attributionSkipped: 0,
    batches: 0,
  };

  console.log(
    JSON.stringify({
      event: 'backfill_touchpoints_started',
      batch_size: options.batchSize,
      company_id: options.companyId ?? null,
    })
  );

  await backfillLeads(options, counts);
  await backfillRevenue(options, counts);

  console.log(
    JSON.stringify(
      {
        status: 'PASS',
        event: 'backfill_touchpoints_completed',
        counts: {
          leads_processed: counts.leadsProcessed,
          lead_touchpoints_created: counts.leadTouchpointsCreated,
          lead_touchpoints_skipped: counts.leadTouchpointsSkipped,
          revenue_processed: counts.revenueProcessed,
          revenue_touchpoints_created: counts.revenueTouchpointsCreated,
          revenue_touchpoints_skipped: counts.revenueTouchpointsSkipped,
          attribution_created: counts.attributionCreated,
          attribution_skipped: counts.attributionSkipped,
          batches: counts.batches,
        },
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[backfillTouchpoints]', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
