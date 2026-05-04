import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { normalizeMetadata } from './intelligenceResponseMapper';
import { logger } from './logger';

type TouchpointMetricRow = {
  id: string;
  touchpoint_type: string;
  metadata: Record<string, unknown> | null;
};

type AttributionRow = {
  revenue_touchpoint_id: string;
};

type CompanyRow = {
  id: string;
};

export type IntelligenceDailyAggregateRow = {
  id: string;
  company_id: string;
  date: string;
  total_touchpoints: number;
  total_leads: number;
  total_revenue: number;
  total_gaps: number;
  total_prompts: number;
  attributed_revenue: number;
  created_at: string;
};

export type IntelligenceAggregateSummary = {
  hasAggregates: boolean;
  total_touchpoints: number;
  total_leads: number;
  total_revenue: number;
  total_gaps: number;
  total_prompts: number;
  attributed_revenue: number;
  dates_covered: number;
  latest_date: string | null;
};

export type IntelligenceAggregationCompanyResult = {
  company_id: string;
  date: string;
  aggregate: IntelligenceDailyAggregateRow | null;
  error?: string;
};

export type IntelligenceAggregationRunResult = {
  date: string;
  companies_attempted: number;
  companies_processed: number;
  companies_failed: number;
  aggregates: IntelligenceAggregationCompanyResult[];
  errors: string[];
};

const COMPANY_LIMIT = 500;

function normalizeCompanyId(companyId: string): string {
  const normalized = companyId.trim();
  if (!normalized) {
    throw new Error('companyId is required');
  }
  return normalized;
}

function normalizeDateKey(value: string | Date = new Date()): string {
  if (typeof value === 'string') {
    const raw = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return raw;
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }

  const date = value instanceof Date ? value : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new Error('date must be a valid date');
  }

  return date.toISOString().slice(0, 10);
}

function dateRange(dateKey: string): { startIso: string; endIso: string } {
  const start = new Date(`${dateKey}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function safeNumber(value: unknown): number | null {
  if (value == null || value === '') {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function revenueAmountFromMetadata(value: unknown): number {
  const metadata = normalizeMetadata(value);
  return (
    safeNumber(metadata.revenue_amount) ??
    safeNumber(metadata.amount) ??
    safeNumber(metadata.revenue) ??
    safeNumber(metadata.deal_value) ??
    safeNumber(metadata.value) ??
    0
  );
}

async function countRowsForDay(params: {
  table: string;
  companyId: string;
  timestampColumn: string;
  startIso: string;
  endIso: string;
}): Promise<number> {
  const { count, error } = await supabase
    .from(params.table)
    .select('id', { count: 'exact', head: true })
    .eq('company_id', params.companyId)
    .gte(params.timestampColumn, params.startIso)
    .lt(params.timestampColumn, params.endIso);

  if (error) {
    throw new Error(`Failed to count ${params.table}: ${error.message}`);
  }

  return count ?? 0;
}

async function loadTouchpointMetrics(params: {
  companyId: string;
  startIso: string;
  endIso: string;
}): Promise<{
  totalTouchpoints: number;
  totalLeads: number;
  totalRevenue: number;
}> {
  const { data, error } = await supabase
    .from('unified_touchpoints')
    .select('id, touchpoint_type, metadata')
    .eq('company_id', params.companyId)
    .gte('occurred_at', params.startIso)
    .lt('occurred_at', params.endIso);

  if (error) {
    throw new Error(`Failed to load touchpoints for daily aggregate: ${error.message}`);
  }

  let totalLeads = 0;
  let totalRevenue = 0;
  const rows = (data ?? []) as TouchpointMetricRow[];

  for (const touchpoint of rows) {
    if (touchpoint.touchpoint_type === 'lead_created') {
      totalLeads += 1;
    }

    if (touchpoint.touchpoint_type === 'revenue') {
      totalRevenue += revenueAmountFromMetadata(touchpoint.metadata);
    }
  }

  return {
    totalTouchpoints: rows.length,
    totalLeads,
    totalRevenue: roundMoney(totalRevenue),
  };
}

async function loadAttributedRevenue(params: {
  companyId: string;
  startIso: string;
  endIso: string;
}): Promise<number> {
  const { data: attributionRows, error: attributionError } = await supabase
    .from('attribution_results')
    .select('revenue_touchpoint_id')
    .eq('company_id', params.companyId)
    .gte('created_at', params.startIso)
    .lt('created_at', params.endIso);

  if (attributionError) {
    throw new Error(`Failed to load daily attribution rows: ${attributionError.message}`);
  }

  const revenueTouchpointIds = Array.from(
    new Set(
      ((attributionRows ?? []) as AttributionRow[])
        .map((row) => row.revenue_touchpoint_id)
        .filter(Boolean)
    )
  );

  if (revenueTouchpointIds.length === 0) {
    return 0;
  }

  const { data, error } = await supabase
    .from('unified_touchpoints')
    .select('id, touchpoint_type, metadata')
    .eq('company_id', params.companyId)
    .eq('touchpoint_type', 'revenue')
    .in('id', revenueTouchpointIds);

  if (error) {
    throw new Error(`Failed to load attributed revenue touchpoints: ${error.message}`);
  }

  return roundMoney(
    ((data ?? []) as TouchpointMetricRow[]).reduce(
      (sum, touchpoint) => sum + revenueAmountFromMetadata(touchpoint.metadata),
      0
    )
  );
}

export async function aggregateDailyIntelligenceForCompany(params: {
  companyId: string;
  date?: string | Date;
}): Promise<IntelligenceDailyAggregateRow> {
  const companyId = normalizeCompanyId(params.companyId);
  const dateKey = normalizeDateKey(params.date);
  const { startIso, endIso } = dateRange(dateKey);

  const [touchpointMetrics, totalGaps, totalPrompts, attributedRevenue] = await Promise.all([
    loadTouchpointMetrics({ companyId, startIso, endIso }),
    countRowsForDay({
      table: 'intelligence_gaps',
      companyId,
      timestampColumn: 'detected_at',
      startIso,
      endIso,
    }),
    countRowsForDay({
      table: 'intelligence_prompts',
      companyId,
      timestampColumn: 'created_at',
      startIso,
      endIso,
    }),
    loadAttributedRevenue({ companyId, startIso, endIso }),
  ]);

  const payload = {
    company_id: companyId,
    date: dateKey,
    total_touchpoints: touchpointMetrics.totalTouchpoints,
    total_leads: touchpointMetrics.totalLeads,
    total_revenue: touchpointMetrics.totalRevenue,
    total_gaps: totalGaps,
    total_prompts: totalPrompts,
    attributed_revenue: attributedRevenue,
  };

  const { data, error } = await supabase
    .from('intelligence_daily_aggregates')
    .upsert(payload, {
      onConflict: 'company_id,date',
    })
    .select('id, company_id, date, total_touchpoints, total_leads, total_revenue, total_gaps, total_prompts, attributed_revenue, created_at')
    .single();

  if (error) {
    throw new Error(`Failed to upsert intelligence daily aggregate: ${error.message}`);
  }

  logger.info('intelligence_daily_aggregate_upserted', {
    companyId,
    date: dateKey,
    totalTouchpoints: payload.total_touchpoints,
    totalLeads: payload.total_leads,
    totalRevenue: payload.total_revenue,
    totalGaps,
    totalPrompts,
    attributedRevenue,
  });

  return data as IntelligenceDailyAggregateRow;
}

async function loadCompanyIds(limit = COMPANY_LIMIT): Promise<string[]> {
  const { data, error } = await supabase
    .from('companies')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load companies for intelligence aggregation: ${error.message}`);
  }

  return ((data ?? []) as CompanyRow[]).map((company) => company.id).filter(Boolean);
}

export async function runDailyIntelligenceAggregation(params: {
  date?: string | Date;
  companyIds?: string[];
  companyLimit?: number;
} = {}): Promise<IntelligenceAggregationRunResult> {
  const dateKey = normalizeDateKey(params.date);
  const companyIds = params.companyIds?.length
    ? params.companyIds.map(normalizeCompanyId)
    : await loadCompanyIds(params.companyLimit ?? COMPANY_LIMIT);
  const aggregates: IntelligenceAggregationCompanyResult[] = [];
  const errors: string[] = [];

  for (const companyId of companyIds) {
    try {
      const aggregate = await aggregateDailyIntelligenceForCompany({
        companyId,
        date: dateKey,
      });
      aggregates.push({
        company_id: companyId,
        date: dateKey,
        aggregate,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${companyId}: ${message}`);
      aggregates.push({
        company_id: companyId,
        date: dateKey,
        aggregate: null,
        error: message,
      });
      logger.error('intelligence_daily_aggregate_failed', {
        companyId,
        date: dateKey,
        message,
      });
    }
  }

  return {
    date: dateKey,
    companies_attempted: companyIds.length,
    companies_processed: aggregates.filter((aggregate) => !aggregate.error).length,
    companies_failed: aggregates.filter((aggregate) => Boolean(aggregate.error)).length,
    aggregates,
    errors,
  };
}

export async function getIntelligenceAggregateSummary(
  companyId: string
): Promise<IntelligenceAggregateSummary | null> {
  const normalizedCompanyId = normalizeCompanyId(companyId);
  const { data, error } = await supabase
    .from('intelligence_daily_aggregates')
    .select('date, total_touchpoints, total_leads, total_revenue, total_gaps, total_prompts, attributed_revenue')
    .eq('company_id', normalizedCompanyId);

  if (error) {
    throw new Error(`Failed to load intelligence daily aggregates: ${error.message}`);
  }

  const rows = (data ?? []) as Array<Omit<IntelligenceDailyAggregateRow, 'id' | 'company_id' | 'created_at'>>;
  if (rows.length === 0) {
    return null;
  }

  return {
    hasAggregates: true,
    total_touchpoints: rows.reduce((sum, row) => sum + Number(row.total_touchpoints ?? 0), 0),
    total_leads: rows.reduce((sum, row) => sum + Number(row.total_leads ?? 0), 0),
    total_revenue: roundMoney(rows.reduce((sum, row) => sum + Number(row.total_revenue ?? 0), 0)),
    total_gaps: rows.reduce((sum, row) => sum + Number(row.total_gaps ?? 0), 0),
    total_prompts: rows.reduce((sum, row) => sum + Number(row.total_prompts ?? 0), 0),
    attributed_revenue: roundMoney(rows.reduce((sum, row) => sum + Number(row.attributed_revenue ?? 0), 0)),
    dates_covered: rows.length,
    latest_date: rows.map((row) => row.date).sort().at(-1) ?? null,
  };
}
