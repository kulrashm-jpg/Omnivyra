/**
 * Activity Cost Breakdown API - v2 (Database Backed)
 * 
 * Queries activity_logs and activity_metrics tables to provide
 * complete cost breakdown with real data from database.
 * 
 * Endpoint: GET /api/super-admin/activity-cost-breakdown-v2?period=month&org_id=all
 * 
 * Handles:
 * - Activity cost calculation from real metrics
 * - System overhead allocation from provisioned_resources  
 * - Error cost tracking (failures still cost money!)
 * - Campaign cost aggregation
 * - Multi-company cost isolation
 */

import { supabase } from '@/backend/db/supabaseClient';
import { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '@/backend/services/rbacService';

// Production cost rates (USD)
const COST_RATES = {
  llm_tokens: 0.000005,
  supabase_read: 0.0000025,
  supabase_write: 0.000005,
  redis_operation: 0.000001,
  api_call: 0.05,
  image_generation: 0.05,
  vercel_compute_second: 0.00001,
  cdn_egress_gb: 0.05,
  observability_event: 0.0001,
};

interface ResourceMetrics {
  llm_tokens: number;
  supabase_reads: number;
  supabase_writes: number;
  redis_operations: number;
  api_calls: number;
  image_generations: number;
  vercel_compute_seconds: number;
  cdn_egress_bytes: number;
}

interface ActivityWithMetrics {
  id: string;
  activity_name: string;
  activity_category: string;
  campaign_id: string;
  company_id: string;
  activity_type: string;
  status: string;
  metadata: Record<string, any>;
  created_at: string;
  duration_ms: number;
  total_resource_cost: number;
  metrics: ResourceMetrics;
}

interface CostBreakdownResponse {
  period: string;
  date_range: {
    start: string;
    end: string;
  };
  activities: ActivityWithMetrics[];
  grouped_by_category: {
    [category: string]: ActivityWithMetrics[];
  };
  allocation_summary: {
    total_cost: number;
    allocated_cost: number;
    unallocated_cost: number;
    allocation_percentage: number;
    activity_count: number;
    error_count: number;
    error_cost: number;
  };
  system_overhead: {
    total_overhead_cost: number;
    total_provisioned: number;
    categories: {
      db_maintenance: number;
      cache_management: number;
      connection_pooling: number;
      logging_monitoring: number;
      backup_replication: number;
    };
    unallocated_resources: {
      resource_type: string;
      provider: string;
      monthly_cost: number;
      allocated_percentage: number;
      unallocated_cost: number;
    }[];
  };
  cost_rates: typeof COST_RATES;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CostBreakdownResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const hasCookie = req.cookies?.super_admin_session === '1';
  if (!hasCookie) {
    const { user, error: authError } = await getSupabaseUserFromRequest(req);
    if (authError || !user) return res.status(403).json({ error: 'NOT_AUTHORIZED' });
    const isAdmin = await isPlatformSuperAdmin(user.id);
    if (!isAdmin) return res.status(403).json({ error: 'FORBIDDEN_ROLE' });
  }

  try {
    const { period = 'month', org_id = 'all' } = req.query;
    const periodStr = typeof period === 'string' ? period : 'month';

    // Calculate date range
    const now = new Date();
    const endDate = now;
    const startDate = new Date();

    if (periodStr === 'week') {
      startDate.setDate(startDate.getDate() - 7);
    } else {
      startDate.setDate(1); // Start of current month
      startDate.setHours(0, 0, 0, 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. Fetch activity logs with metrics (1:1 relationship)
    // ─────────────────────────────────────────────────────────────────────────
    let query = supabase
      .from('activity_logs')
      .select(
        `
        id,
        activity_name,
        activity_category,
        campaign_id,
        company_id,
        activity_type,
        status,
        metadata,
        created_at,
        duration_ms,
        activity_metrics!inner(
          llm_tokens,
          supabase_reads,
          supabase_writes,
          redis_operations,
          api_calls,
          image_generations,
          vercel_compute_seconds,
          cdn_egress_bytes,
          total_resource_cost
        )
      `
      )
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());

    // Filter by organization
    if (org_id !== 'all' && org_id) {
      query = query.eq('company_id', org_id);
    }

    const { data: activities, error: activitiesError } = await query;
    if (activitiesError) throw activitiesError;

    // ─────────────────────────────────────────────────────────────────────────
    // 2. Fetch error logs for the same period (failures still cost money!)
    // ─────────────────────────────────────────────────────────────────────────
    let errorQuery = supabase
      .from('activity_error_log')
      .select('partial_cost')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());

    if (org_id !== 'all' && org_id) {
      errorQuery = errorQuery.eq('campaign_id', org_id);
    }

    const { data: errors, error: errorsError } = await errorQuery;
    if (errorsError) throw errorsError;

    // ─────────────────────────────────────────────────────────────────────────
    // 3. Calculate total cost from errors
    // ─────────────────────────────────────────────────────────────────────────
    const errorCost =
      (errors || []).reduce((sum, err) => sum + (err.partial_cost || 0), 0) ||
      0;
    const errorCount = errors?.length || 0;

    // ─────────────────────────────────────────────────────────────────────────
    // 4. Transform activities into format with cost breakdown
    // ─────────────────────────────────────────────────────────────────────────
    const activitiesWithCosts: ActivityWithMetrics[] = (activities || []).map(
      (activity: any) => {
        const metrics = activity.activity_metrics?.[0] || {};
        const costBreakdownObj = calculateResourceCosts(metrics);

        return {
          id: activity.id,
          activity_name: activity.activity_name,
          activity_category: activity.activity_category,
          campaign_id: activity.campaign_id,
          company_id: activity.company_id,
          activity_type: activity.activity_type,
          status: activity.status,
          metadata: activity.metadata || {},
          created_at: activity.created_at,
          duration_ms: activity.duration_ms,
          total_resource_cost: costBreakdownObj.total,
          metrics: metrics,
        };
      }
    );

    // ─────────────────────────────────────────────────────────────────────────
    // 5. Group activities by category
    // ─────────────────────────────────────────────────────────────────────────
    const grouped = activitiesWithCosts.reduce(
      (acc, activity) => {
        if (!acc[activity.activity_category]) {
          acc[activity.activity_category] = [];
        }
        acc[activity.activity_category].push(activity);
        return acc;
      },
      {} as Record<string, ActivityWithMetrics[]>
    );

    // Sort each category by cost (highest first)
    Object.keys(grouped).forEach((category) => {
      grouped[category].sort(
        (a, b) => b.total_resource_cost - a.total_resource_cost
      );
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 6. Calculate allocation summary
    // ─────────────────────────────────────────────────────────────────────────
    const allocatedCost = activitiesWithCosts.reduce(
      (sum, a) => sum + a.total_resource_cost,
      0
    );

    // ─────────────────────────────────────────────────────────────────────────
    // 7. Fetch provisioned resources & calculate overhead
    // ─────────────────────────────────────────────────────────────────────────
    const { data: provisioned, error: provisionedError } = await supabase
      .from('provisioned_resources')
      .select('*')
      .eq('status', 'active');

    if (provisionedError) throw provisionedError;

    const totalProvisioned =
      (provisioned || []).reduce((sum, res) => sum + res.monthly_cost, 0) || 0;
    const unallocatedCost = totalProvisioned - allocatedCost;

    // Calculate overhead by category (% of total unallocated)
    const overheadBreakdown = {
      db_maintenance: unallocatedCost * 0.25, // 25% of overhead
      cache_management: unallocatedCost * 0.15, // 15%
      connection_pooling: unallocatedCost * 0.1, // 10%
      logging_monitoring: unallocatedCost * 0.25, // 25%
      backup_replication: unallocatedCost * 0.25, // 25%
    };

    const totalCost = allocatedCost + unallocatedCost + errorCost;

    // ─────────────────────────────────────────────────────────────────────────
    // 8. Build response
    // ─────────────────────────────────────────────────────────────────────────
    const response: CostBreakdownResponse = {
      period: periodStr,
      date_range: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },

      activities: activitiesWithCosts.sort(
        (a, b) => b.total_resource_cost - a.total_resource_cost
      ),

      grouped_by_category: grouped,

      allocation_summary: {
        total_cost: totalCost,
        allocated_cost: allocatedCost,
        unallocated_cost: unallocatedCost,
        allocation_percentage: totalCost > 0 ? (allocatedCost / totalCost) * 100 : 0,
        activity_count: activitiesWithCosts.length,
        error_count: errorCount,
        error_cost: errorCost,
      },

      system_overhead: {
        total_overhead_cost: unallocatedCost,
        total_provisioned: totalProvisioned,
        categories: overheadBreakdown,
        unallocated_resources: (provisioned || [])
          .filter((res) => res.unallocated_percentage > 0)
          .map((res) => ({
            resource_type: res.resource_type,
            provider: res.provider,
            monthly_cost: res.monthly_cost,
            allocated_percentage: res.allocated_percentage,
            unallocated_cost: (res.monthly_cost * res.unallocated_percentage) / 100,
          })),
      },

      cost_rates: COST_RATES,
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('Activity cost breakdown error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Calculate resource costs from metrics
 */
function calculateResourceCosts(
  metrics: any
): { [key: string]: number; total: number } {
  const costs: { [key: string]: number } = {};
  let total = 0;

  // Calculate each resource type cost
  if (metrics.llm_tokens) {
    costs.llm_tokens = metrics.llm_tokens * COST_RATES.llm_tokens;
    total += costs.llm_tokens;
  }

  if (metrics.supabase_reads) {
    costs.supabase_reads = metrics.supabase_reads * COST_RATES.supabase_read;
    total += costs.supabase_reads;
  }

  if (metrics.supabase_writes) {
    costs.supabase_writes = metrics.supabase_writes * COST_RATES.supabase_write;
    total += costs.supabase_writes;
  }

  if (metrics.redis_operations) {
    costs.redis_operations =
      metrics.redis_operations * COST_RATES.redis_operation;
    total += costs.redis_operations;
  }

  if (metrics.api_calls) {
    costs.api_calls = metrics.api_calls * COST_RATES.api_call;
    total += costs.api_calls;
  }

  if (metrics.image_generations) {
    costs.image_generations =
      metrics.image_generations * COST_RATES.image_generation;
    total += costs.image_generations;
  }

  if (metrics.vercel_compute_seconds) {
    costs.vercel_compute =
      metrics.vercel_compute_seconds * COST_RATES.vercel_compute_second;
    total += costs.vercel_compute;
  }

  if (metrics.cdn_egress_bytes) {
    const gb = metrics.cdn_egress_bytes / (1024 * 1024 * 1024);
    costs.cdn_egress = gb * COST_RATES.cdn_egress_gb;
    total += costs.cdn_egress;
  }

  return { ...costs, total };
}
