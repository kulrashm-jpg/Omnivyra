import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import {
  mapExpectedEventToPendingInput,
  mapGapToDashboardGap,
  mapGapToPendingInput,
  mapPendingInputToActionableItem,
  mapPromptToPendingInput,
  normalizeMetadata,
  sortActionableItems,
  sortPendingItems,
} from './intelligenceResponseMapper';
import type {
  ActionableIntelligenceItem,
  DashboardGapItem,
  GapResponseRow,
  IntelligencePriority,
  PendingInputItem,
} from './intelligenceResponseMapper';
import {
  buildCmoIntelligenceSummary,
  type CmoIntelligenceSummary,
} from './cmoIntelligenceService';
import {
  getIntelligenceAggregateSummary,
  type IntelligenceAggregateSummary,
} from './intelligenceAggregationService';
import { getIntelligenceInsights, type IntelligenceInsight } from './insightsService';
import { logger } from './logger';
import { getSystemHealthWarnings, type SystemHealthWarning } from './systemHealthService';

type PromptRow = {
  id: string;
  company_id: string;
  unified_person_id: string | null;
  intelligence_gap_id: string;
  prompt_type: string;
  title: string;
  message: string;
  status: string;
  created_at: string;
};

type GapRow = {
  id: string;
  company_id: string;
  unified_person_id: string | null;
  expected_event_instance_id: string;
  gap_type: string;
  priority: IntelligencePriority;
  status: string;
  detected_at: string;
  metadata: Record<string, unknown> | null;
};

type ExpectedEventRow = {
  id: string;
  company_id: string;
  unified_person_id: string | null;
  trigger_touchpoint_id: string;
  expected_event_type: string;
  due_at: string;
  status: string;
  created_at: string;
};

type TouchpointRow = {
  id: string;
  company_id: string;
  unified_person_id: string | null;
  source: string;
  unified_source: Record<string, unknown> | null;
  touchpoint_type: string;
  reference_table: string;
  reference_id: string;
  occurred_at: string;
  metadata: Record<string, unknown> | null;
};

type SourceTouchpointRow = {
  source: string | null;
  touchpoint_type: string;
  metadata: Record<string, unknown> | null;
};

type AttributionRow = {
  revenue_touchpoint_id: string;
};

const PENDING_INPUTS_LIMIT = 50;
const TOP_GAPS_SCAN_LIMIT = 200;

export type PendingInputsResult = {
  summary: {
    total_pending_prompts: number;
    total_open_gaps: number;
    total_missed_events: number;
  };
  items: PendingInputItem[];
};

export type IntelligenceOverviewResult = {
  total_touchpoints: number;
  total_expected_events: number;
  completed_expected_events: number;
  missed_expected_events: number;
  open_gaps: number;
  resolved_gaps: number;
};

export type DashboardActivityItem = {
  id: string;
  touchpoint_type: string;
  source: string;
  unified_source: Record<string, unknown> | null;
  unified_person_id: string | null;
  reference_table: string;
  reference_id: string;
  occurred_at: string;
  metadata: Record<string, unknown>;
};

export type FunnelSummary = {
  leads_created: number;
  revenue_events: number;
  conversion_rate: number;
};

export type SourcePerformanceItem = {
  source: string;
  leads: number;
  revenue: number;
};

export type IntelligenceDashboardResult = {
  summary: {
    touchpoints: number;
    expected_events: number;
    missed_events: number;
    open_gaps: number;
    resolved_gaps: number;
  };
  pending_inputs: PendingInputItem[];
  actionable_items: ActionableIntelligenceItem[];
  top_gaps: DashboardGapItem[];
  recent_activity: DashboardActivityItem[];
  funnel_summary: FunnelSummary;
  source_performance: SourcePerformanceItem[];
  attribution_summary: {
    total_revenue: number;
    attributed_revenue: number;
    unattributed_revenue: number;
  };
  insights: IntelligenceInsight[];
  health: SystemHealthWarning[];
  cmo_summary: CmoIntelligenceSummary;
};

function normalizeCompanyId(companyId: string): string {
  const normalized = companyId.trim();
  if (!normalized) {
    throw new Error('companyId is required');
  }
  return normalized;
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

function roundRate(value: number): number {
  return Math.round(value * 100) / 100;
}

function mapActivity(touchpoint: TouchpointRow): DashboardActivityItem {
  return {
    id: touchpoint.id,
    touchpoint_type: touchpoint.touchpoint_type,
    source: touchpoint.source,
    unified_source: touchpoint.unified_source,
    unified_person_id: touchpoint.unified_person_id,
    reference_table: touchpoint.reference_table,
    reference_id: touchpoint.reference_id,
    occurred_at: touchpoint.occurred_at,
    metadata: normalizeMetadata(touchpoint.metadata),
  };
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

function revenueAmountFromTouchpoint(touchpoint: TouchpointRow): number {
  return revenueAmountFromMetadata(touchpoint.metadata);
}

function normalizeSourceLabel(value: unknown): string {
  return String(value ?? 'unknown').trim().toLowerCase() || 'unknown';
}

function buildActionableItems(pendingInputs: PendingInputItem[]): ActionableIntelligenceItem[] {
  const promptedGapIds = new Set(
    pendingInputs
      .filter((item) => item.type === 'prompt')
      .map((item) => String(normalizeMetadata(item.metadata).intelligence_gap_id ?? '').trim())
      .filter(Boolean)
  );

  return pendingInputs
    .filter(
      (item) =>
        item.type === 'prompt' ||
        (item.type === 'gap' && item.priority === 'high' && !promptedGapIds.has(item.id))
    )
    .map(mapPendingInputToActionableItem)
    .filter((item): item is ActionableIntelligenceItem => Boolean(item))
    .sort(sortActionableItems);
}

async function loadPromptGaps(prompts: PromptRow[]): Promise<Map<string, GapResponseRow>> {
  const gapIds = Array.from(new Set(prompts.map((prompt) => prompt.intelligence_gap_id).filter(Boolean)));
  if (gapIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from('intelligence_gaps')
    .select('id, company_id, unified_person_id, expected_event_instance_id, gap_type, priority, status, detected_at, metadata')
    .in('id', gapIds);

  if (error) {
    throw new Error(`Failed to load prompt-linked intelligence gaps: ${error.message}`);
  }

  return new Map(((data ?? []) as GapResponseRow[]).map((gap) => [gap.id, gap]));
}

async function countRows(
  table: string,
  companyId: string,
  filters: Record<string, string> = {}
): Promise<number> {
  let query = supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId);

  for (const [field, value] of Object.entries(filters)) {
    query = query.eq(field, value);
  }

  const { count, error } = await query;
  if (error) {
    throw new Error(`Failed to count ${table}: ${error.message}`);
  }

  return count ?? 0;
}

async function loadTopGaps(companyId: string): Promise<DashboardGapItem[]> {
  const { data, error } = await supabase
    .from('intelligence_gaps')
    .select('id, company_id, unified_person_id, expected_event_instance_id, gap_type, priority, status, detected_at, metadata')
    .eq('company_id', companyId)
    .eq('status', 'open')
    .order('detected_at', { ascending: false })
    .limit(TOP_GAPS_SCAN_LIMIT);

  if (error) {
    throw new Error(`Failed to load top intelligence gaps: ${error.message}`);
  }

  return ((data ?? []) as GapRow[])
    .map(mapGapToDashboardGap)
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;
      if (scoreDelta !== 0) return scoreDelta;

      const leftTime = Date.parse(left.detected_at);
      const rightTime = Date.parse(right.detected_at);
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    })
    .slice(0, 5);
}

async function loadRecentActivity(companyId: string): Promise<DashboardActivityItem[]> {
  const { data, error } = await supabase
    .from('unified_touchpoints')
    .select('id, company_id, unified_person_id, source, unified_source, touchpoint_type, reference_table, reference_id, occurred_at, metadata')
    .eq('company_id', companyId)
    .order('occurred_at', { ascending: false })
    .limit(10);

  if (error) {
    throw new Error(`Failed to load recent touchpoint activity: ${error.message}`);
  }

  return ((data ?? []) as TouchpointRow[]).map(mapActivity);
}

async function loadAttributionSummary(
  companyId: string
): Promise<IntelligenceDashboardResult['attribution_summary']> {
  const [revenueTouchpointsResult, attributionResult] = await Promise.all([
    supabase
      .from('unified_touchpoints')
      .select('id, metadata')
      .eq('company_id', companyId)
      .eq('touchpoint_type', 'revenue'),
    supabase
      .from('attribution_results')
      .select('revenue_touchpoint_id')
      .eq('company_id', companyId),
  ]);

  if (revenueTouchpointsResult.error) {
    throw new Error(`Failed to load revenue touchpoints: ${revenueTouchpointsResult.error.message}`);
  }
  if (attributionResult.error) {
    throw new Error(`Failed to load attribution results: ${attributionResult.error.message}`);
  }

  const attributedRevenueIds = new Set(
    ((attributionResult.data ?? []) as AttributionRow[]).map((row) => row.revenue_touchpoint_id)
  );
  let totalRevenue = 0;
  let attributedRevenue = 0;

  for (const touchpoint of (revenueTouchpointsResult.data ?? []) as TouchpointRow[]) {
    const amount = revenueAmountFromTouchpoint(touchpoint);
    totalRevenue += amount;
    if (attributedRevenueIds.has(touchpoint.id)) {
      attributedRevenue += amount;
    }
  }

  return {
    total_revenue: roundMoney(totalRevenue),
    attributed_revenue: roundMoney(attributedRevenue),
    unattributed_revenue: roundMoney(totalRevenue - attributedRevenue),
  };
}

function attributionSummaryFromAggregates(
  aggregates: IntelligenceAggregateSummary
): IntelligenceDashboardResult['attribution_summary'] {
  const totalRevenue = roundMoney(aggregates.total_revenue);
  const attributedRevenue = roundMoney(aggregates.attributed_revenue);

  return {
    total_revenue: totalRevenue,
    attributed_revenue: attributedRevenue,
    unattributed_revenue: roundMoney(Math.max(0, totalRevenue - attributedRevenue)),
  };
}

async function loadFunnelSummary(
  companyId: string,
  aggregates?: IntelligenceAggregateSummary | null
): Promise<FunnelSummary> {
  const [leadsCreated, revenueEvents] = await Promise.all([
    aggregates
      ? Promise.resolve(aggregates.total_leads)
      : countRows('unified_touchpoints', companyId, { touchpoint_type: 'lead_created' }),
    countRows('unified_touchpoints', companyId, { touchpoint_type: 'revenue' }),
  ]);

  return {
    leads_created: leadsCreated,
    revenue_events: revenueEvents,
    conversion_rate: leadsCreated > 0 ? roundRate((revenueEvents / leadsCreated) * 100) : 0,
  };
}

async function loadSourcePerformance(companyId: string): Promise<SourcePerformanceItem[]> {
  const { data, error } = await supabase
    .from('unified_touchpoints')
    .select('source, touchpoint_type, metadata')
    .eq('company_id', companyId)
    .in('touchpoint_type', ['lead_created', 'revenue']);

  if (error) {
    throw new Error(`Failed to load source performance touchpoints: ${error.message}`);
  }

  const bySource = new Map<string, SourcePerformanceItem>();
  for (const touchpoint of (data ?? []) as SourceTouchpointRow[]) {
    const source = normalizeSourceLabel(touchpoint.source);
    const aggregate = bySource.get(source) ?? { source, leads: 0, revenue: 0 };

    if (touchpoint.touchpoint_type === 'lead_created') {
      aggregate.leads += 1;
    }
    if (touchpoint.touchpoint_type === 'revenue') {
      aggregate.revenue += revenueAmountFromMetadata(touchpoint.metadata);
    }

    bySource.set(source, aggregate);
  }

  return [...bySource.values()]
    .map((source) => ({
      ...source,
      revenue: roundMoney(source.revenue),
    }))
    .sort((left, right) => {
      const revenueDelta = right.revenue - left.revenue;
      if (revenueDelta !== 0) return revenueDelta;
      return right.leads - left.leads;
    });
}

export async function getPendingInputs(companyId: string): Promise<PendingInputsResult> {
  const normalizedCompanyId = normalizeCompanyId(companyId);

  const [promptsResult, gapsResult, missedEventsResult] = await Promise.all([
    supabase
      .from('intelligence_prompts')
      .select('id, company_id, unified_person_id, intelligence_gap_id, prompt_type, title, message, status, created_at', { count: 'exact' })
      .eq('company_id', normalizedCompanyId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(PENDING_INPUTS_LIMIT),
    supabase
      .from('intelligence_gaps')
      .select('id, company_id, unified_person_id, expected_event_instance_id, gap_type, priority, status, detected_at, metadata', { count: 'exact' })
      .eq('company_id', normalizedCompanyId)
      .eq('status', 'open')
      .order('detected_at', { ascending: false })
      .limit(PENDING_INPUTS_LIMIT),
    supabase
      .from('expected_event_instances')
      .select('id, company_id, unified_person_id, trigger_touchpoint_id, expected_event_type, due_at, status, created_at', { count: 'exact' })
      .eq('company_id', normalizedCompanyId)
      .eq('status', 'missed')
      .order('due_at', { ascending: false })
      .limit(PENDING_INPUTS_LIMIT),
  ]);

  if (promptsResult.error) {
    throw new Error(`Failed to load pending prompts: ${promptsResult.error.message}`);
  }
  if (gapsResult.error) {
    throw new Error(`Failed to load open gaps: ${gapsResult.error.message}`);
  }
  if (missedEventsResult.error) {
    throw new Error(`Failed to load missed expected events: ${missedEventsResult.error.message}`);
  }

  const pendingPrompts = (promptsResult.data ?? []) as PromptRow[];
  const openGaps = (gapsResult.data ?? []) as GapRow[];
  const missedEvents = (missedEventsResult.data ?? []) as ExpectedEventRow[];
  const promptGapById = await loadPromptGaps(pendingPrompts);

  const items = [
    ...pendingPrompts.map((prompt) => mapPromptToPendingInput(prompt, promptGapById)),
    ...openGaps.map(mapGapToPendingInput),
    ...missedEvents.map(mapExpectedEventToPendingInput),
  ].sort(sortPendingItems);

  const result: PendingInputsResult = {
    summary: {
      total_pending_prompts: promptsResult.count ?? pendingPrompts.length,
      total_open_gaps: gapsResult.count ?? openGaps.length,
      total_missed_events: missedEventsResult.count ?? missedEvents.length,
    },
    items,
  };

  return result;
}

export async function getIntelligenceOverview(
  companyId: string,
  aggregates?: IntelligenceAggregateSummary | null
): Promise<IntelligenceOverviewResult> {
  const normalizedCompanyId = normalizeCompanyId(companyId);

  const [
    totalTouchpoints,
    totalExpectedEvents,
    completedExpectedEvents,
    missedExpectedEvents,
    openGaps,
    resolvedGaps,
  ] = await Promise.all([
    aggregates
      ? Promise.resolve(aggregates.total_touchpoints)
      : countRows('unified_touchpoints', normalizedCompanyId),
    countRows('expected_event_instances', normalizedCompanyId),
    countRows('expected_event_instances', normalizedCompanyId, { status: 'completed' }),
    countRows('expected_event_instances', normalizedCompanyId, { status: 'missed' }),
    countRows('intelligence_gaps', normalizedCompanyId, { status: 'open' }),
    countRows('intelligence_gaps', normalizedCompanyId, { status: 'resolved' }),
  ]);

  const result: IntelligenceOverviewResult = {
    total_touchpoints: totalTouchpoints,
    total_expected_events: totalExpectedEvents,
    completed_expected_events: completedExpectedEvents,
    missed_expected_events: missedExpectedEvents,
    open_gaps: openGaps,
    resolved_gaps: resolvedGaps,
  };

  return result;
}

async function safeDashboardSection<T>(
  companyId: string,
  section: string,
  fallback: T,
  loader: () => Promise<T>
): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    logger.warn('intelligence_dashboard_section_failed', {
      companyId,
      section,
      message: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

export async function getIntelligenceDashboard(companyId: string): Promise<IntelligenceDashboardResult> {
  const normalizedCompanyId = normalizeCompanyId(companyId);
  const aggregateSummary = await safeDashboardSection<IntelligenceAggregateSummary | null>(
    normalizedCompanyId,
    'daily_aggregates',
    null,
    () => getIntelligenceAggregateSummary(normalizedCompanyId)
  );

  const [
    overview,
    pendingInputs,
    topGaps,
    recentActivity,
    funnelSummary,
    sourcePerformance,
    attributionSummary,
    insights,
    health,
  ] = await Promise.all([
    getIntelligenceOverview(normalizedCompanyId, aggregateSummary),
    safeDashboardSection(normalizedCompanyId, 'pending_inputs', {
      summary: {
        total_pending_prompts: 0,
        total_open_gaps: 0,
        total_missed_events: 0,
      },
      items: [],
    }, () => getPendingInputs(normalizedCompanyId)),
    safeDashboardSection(normalizedCompanyId, 'top_gaps', [], () => loadTopGaps(normalizedCompanyId)),
    safeDashboardSection(normalizedCompanyId, 'recent_activity', [], () => loadRecentActivity(normalizedCompanyId)),
    safeDashboardSection(normalizedCompanyId, 'funnel_summary', {
      leads_created: 0,
      revenue_events: 0,
      conversion_rate: 0,
    }, () => loadFunnelSummary(normalizedCompanyId, aggregateSummary)),
    safeDashboardSection(normalizedCompanyId, 'source_performance', [], () => loadSourcePerformance(normalizedCompanyId)),
    aggregateSummary
      ? Promise.resolve(attributionSummaryFromAggregates(aggregateSummary))
      : safeDashboardSection(normalizedCompanyId, 'attribution_summary', {
        total_revenue: 0,
        attributed_revenue: 0,
        unattributed_revenue: 0,
      }, () => loadAttributionSummary(normalizedCompanyId)),
    safeDashboardSection(normalizedCompanyId, 'insights', [], () => getIntelligenceInsights(normalizedCompanyId)),
    safeDashboardSection(normalizedCompanyId, 'health', [], () => getSystemHealthWarnings(normalizedCompanyId)),
  ]);

  const actionableItems = buildActionableItems(pendingInputs.items);
  const cmoSummary = buildCmoIntelligenceSummary({
    insights,
    sourcePerformance,
    topGaps,
    actionableItems,
  });

  const result: IntelligenceDashboardResult = {
    summary: {
      touchpoints: overview.total_touchpoints,
      expected_events: overview.total_expected_events,
      missed_events: overview.missed_expected_events,
      open_gaps: overview.open_gaps,
      resolved_gaps: overview.resolved_gaps,
    },
    pending_inputs: pendingInputs.items,
    actionable_items: actionableItems,
    top_gaps: topGaps,
    recent_activity: recentActivity,
    funnel_summary: funnelSummary,
    source_performance: sourcePerformance,
    attribution_summary: attributionSummary,
    insights,
    health,
    cmo_summary: cmoSummary,
  };

  return result;
}
