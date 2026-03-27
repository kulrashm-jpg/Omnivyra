import React, { useState, useEffect } from 'react';
import {
  ChevronDown,
  ChevronRight,
  AlertCircle,
  Zap,
  Database,
  Network,
  Cpu,
  HardDrive,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';

interface ResourceCost {
  [key: string]: number;
}

interface ActivityMetadata {
  platform_count?: number;
  content_type?: string;
  creator_dependent_factors?: string[];
}

interface Activity {
  activity_id: string;
  activity_name: string;
  category: string;
  parent_activity?: string;
  timestamp: string;
  resources_consumed: {
    llm_tokens?: number;
    supabase_reads?: number;
    supabase_writes?: number;
    redis_operations?: number;
    api_calls?: number;
    image_generations?: number;
    vercel_compute_seconds?: number;
    cdn_egress_bytes?: number;
  };
  cost_breakdown?: ResourceCost;
  total_cost?: number;
  metadata?: ActivityMetadata;
}

interface AllocationData {
  activities: Activity[];
  grouped_by_category: { [key: string]: Activity[] };
  allocation_summary: {
    allocated_cost: number;
    unallocated_cost: number;
    total_monthly_cost: number;
    allocation_percentage: number;
    system_overhead: {
      db_maintenance: number;
      cache_management: number;
      connection_pooling: number;
      logging_monitoring: number;
      backup_replication: number;
    };
  };
  cost_rates: { [key: string]: number };
}

interface CollapsibleActivityProps {
  activity: Activity;
  isSubActivity?: boolean;
  onShowDetails?: (activity: Activity) => void;
}

const ResourceIcon: React.FC<{ type: string; className?: string }> = ({
  type,
  className = 'w-4 h-4',
}) => {
  const iconProps = { className };
  switch (type) {
    case 'llm':
      return <Zap {...iconProps} />;
    case 'db_reads':
    case 'db_writes':
      return <Database {...iconProps} />;
    case 'redis':
      return <Network {...iconProps} />;
    case 'compute':
      return <Cpu {...iconProps} />;
    case 'apis':
      return <Network {...iconProps} />;
    case 'cdn':
      return <HardDrive {...iconProps} />;
    case 'images':
      return <TrendingUp {...iconProps} />;
    default:
      return null;
  }
};

const CollapsibleActivity: React.FC<CollapsibleActivityProps> = ({
  activity,
  isSubActivity = false,
  onShowDetails,
}) => {
  const [expanded, setExpanded] = useState(false);

  const getCostColor = (cost: number) => {
    if (cost < 0.01) return 'text-green-600';
    if (cost < 0.1) return 'text-blue-600';
    if (cost < 1) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getResourceColor = (type: string) => {
    const colors: { [key: string]: string } = {
      llm: 'bg-purple-100 text-purple-700 border-purple-300',
      db_reads: 'bg-blue-100 text-blue-700 border-blue-300',
      db_writes: 'bg-indigo-100 text-indigo-700 border-indigo-300',
      redis: 'bg-red-100 text-red-700 border-red-300',
      apis: 'bg-orange-100 text-orange-700 border-orange-300',
      compute: 'bg-cyan-100 text-cyan-700 border-cyan-300',
      cdn: 'bg-amber-100 text-amber-700 border-amber-300',
      images: 'bg-pink-100 text-pink-700 border-pink-300',
    };
    return colors[type] || 'bg-gray-100 text-gray-700 border-gray-300';
  };

  return (
    <div
      className={`border border-slate-200 rounded-lg transition-all ${!isSubActivity ? 'bg-white shadow-sm mb-4' : 'bg-slate-50 mb-2'}`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full px-4 py-3 flex items-center justify-between rounded-lg hover:bg-slate-50 transition-colors ${expanded && !isSubActivity ? 'bg-slate-100' : ''}`}
      >
        <div className="flex items-center gap-3 flex-1 text-left">
          <div className="mt-0.5">
            {expanded ? (
              <ChevronDown className="w-5 h-5 text-slate-600" />
            ) : (
              <ChevronRight className="w-5 h-5 text-slate-600" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-slate-900 text-sm">
              {activity.activity_name}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {activity.category} • {new Date(activity.timestamp).toLocaleDateString()}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 ml-4">
          <div className={`text-right ${getCostColor(activity.total_cost || 0)}`}>
            <p className="font-bold text-sm">
              ${(activity.total_cost || 0).toFixed(4)}
            </p>
          </div>
          <div className="text-right text-xs text-slate-600 w-20">
            <p>
              {Object.keys(activity.cost_breakdown || {}).length} resources
            </p>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-200 px-4 py-4 bg-slate-50 rounded-b-lg">
          {/* Resource Breakdown */}
          <div className="mb-4">
            <h4 className="text-xs font-bold text-slate-700 mb-3 uppercase tracking-wide">
              Resource Breakdown
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {Object.entries(activity.cost_breakdown || {}).map(([type, cost]) => (
                <div
                  key={type}
                  className={`border rounded-lg p-2 flex items-center gap-2 text-xs ${getResourceColor(type)}`}
                >
                  <ResourceIcon type={type} className="w-3.5 h-3.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate capitalize">{type.replace('_', ' ')}</p>
                    <p className="font-bold">${cost.toFixed(4)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Raw Resource Consumption */}
          <div className="mb-4">
            <h4 className="text-xs font-bold text-slate-700 mb-2 uppercase tracking-wide">
              Consumption Details
            </h4>
            <div className="bg-white rounded-lg p-3 border border-slate-200 text-xs">
              <div className="grid grid-cols-2 gap-2">
                {activity.resources_consumed.llm_tokens && (
                  <div>
                    <span className="text-slate-600">LLM Tokens:</span>
                    <span className="font-medium ml-2">
                      {activity.resources_consumed.llm_tokens.toLocaleString()}
                    </span>
                  </div>
                )}
                {activity.resources_consumed.supabase_reads && (
                  <div>
                    <span className="text-slate-600">DB Reads:</span>
                    <span className="font-medium ml-2">
                      {activity.resources_consumed.supabase_reads}
                    </span>
                  </div>
                )}
                {activity.resources_consumed.supabase_writes && (
                  <div>
                    <span className="text-slate-600">DB Writes:</span>
                    <span className="font-medium ml-2">
                      {activity.resources_consumed.supabase_writes}
                    </span>
                  </div>
                )}
                {activity.resources_consumed.api_calls && (
                  <div>
                    <span className="text-slate-600">API Calls:</span>
                    <span className="font-medium ml-2">
                      {activity.resources_consumed.api_calls}
                    </span>
                  </div>
                )}
                {activity.resources_consumed.vercel_compute_seconds && (
                  <div>
                    <span className="text-slate-600">Compute (s):</span>
                    <span className="font-medium ml-2">
                      {activity.resources_consumed.vercel_compute_seconds}
                    </span>
                  </div>
                )}
                {activity.resources_consumed.redis_operations && (
                  <div>
                    <span className="text-slate-600">Redis Ops:</span>
                    <span className="font-medium ml-2">
                      {activity.resources_consumed.redis_operations}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Creator-Dependent Factors */}
          {activity.metadata?.creator_dependent_factors &&
            activity.metadata.creator_dependent_factors.length > 0 && (
              <div className="mb-4">
                <h4 className="text-xs font-bold text-slate-700 mb-2 uppercase tracking-wide">
                  Cost Drivers
                </h4>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <ul className="text-xs text-slate-700 space-y-1">
                    {activity.metadata.creator_dependent_factors.map((factor, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-blue-600 font-bold mt-0.5">•</span>
                        <span>{factor}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

          {/* Meta Information */}
          {activity.metadata && (
            <div className="bg-white rounded-lg p-3 border border-slate-200 text-xs">
              {activity.metadata.platform_count && (
                <div className="py-1">
                  <span className="text-slate-600">Platforms:</span>
                  <span className="font-medium ml-2">{activity.metadata.platform_count}</span>
                </div>
              )}
              {activity.metadata.content_type && (
                <div className="py-1">
                  <span className="text-slate-600">Content Type:</span>
                  <span className="font-medium ml-2 capitalize">
                    {activity.metadata.content_type}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface ActivityCostBreakdownProps {
  period?: 'month' | 'week';
  orgId?: string;
}

export default function ActivityCostBreakdown({
  period = 'month',
  orgId = 'all',
}: ActivityCostBreakdownProps) {
  const [data, setData] = useState<AllocationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await fetch(
          `/api/super-admin/activity-cost-breakdown?period=${period}&org_id=${orgId}`
        );
        if (!res.ok) throw new Error('Failed to fetch data');
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [period, orgId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-600">Loading activity costs...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex gap-3">
        <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
        <div>
          <h3 className="font-bold text-red-900">Error loading activity costs</h3>
          <p className="text-xs text-red-700 mt-1">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return <div className="text-slate-600">No activity data available</div>;
  }

  const { grouped_by_category, allocation_summary } = data;

  // Sort activities by cost (highest first)
  const sortedActivities = (activities: Activity[]) =>
    [...activities].sort((a, b) => (b.total_cost || 0) - (a.total_cost || 0));

  return (
    <div className="space-y-6">
      {/* Allocation Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
          <p className="text-xs text-slate-600 font-medium mb-1">Total Monthly Cost</p>
          <p className="text-3xl font-bold text-slate-900">
            ${allocation_summary.total_monthly_cost.toFixed(2)}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
          <p className="text-xs text-slate-600 font-medium mb-1">Allocated to Activities</p>
          <p className="text-3xl font-bold text-blue-600">
            ${allocation_summary.allocated_cost.toFixed(2)}
          </p>
          <p className="text-xs text-slate-600 mt-1">
            {allocation_summary.allocation_percentage.toFixed(1)}% utilized
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
          <p className="text-xs text-slate-600 font-medium mb-1">Unallocated (System)</p>
          <p className="text-3xl font-bold text-amber-600">
            ${allocation_summary.unallocated_cost.toFixed(2)}
          </p>
          <p className="text-xs text-slate-600 mt-1">
            {(100 - allocation_summary.allocation_percentage).toFixed(1)}% overhead
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
          <p className="text-xs text-slate-600 font-medium mb-1">Activities Tracked</p>
          <p className="text-3xl font-bold text-slate-900">
            {Object.values(grouped_by_category).flat().length}
          </p>
          <p className="text-xs text-slate-600 mt-1">
            {Object.keys(grouped_by_category).length} categories
          </p>
        </div>
      </div>

      {/* System Overhead Breakdown */}
      <div className="bg-white border border-slate-200 rounded-lg p-6 shadow-sm">
        <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-amber-600" />
          System Overhead & Unallocated Infrastructure
        </h3>
        <p className="text-sm text-slate-600 mb-4">
          Provisioned resources not directly attributed to user activities. These represent optimization opportunities.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          {Object.entries(allocation_summary.system_overhead).map(([key, cost]) => (
            <div key={key} className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs text-amber-700 font-medium capitalize mb-1">
                {key.replace(/_/g, ' ')}
              </p>
              <p className="text-lg font-bold text-amber-900">
                ${cost.toFixed(2)}
              </p>
              <p className="text-xs text-amber-600 mt-1">
                {((cost / allocation_summary.total_monthly_cost) * 100).toFixed(1)}% of total
              </p>
            </div>
          ))}
        </div>
        {(() => {
          const overhead = allocation_summary.system_overhead;
          const totalOverhead = allocation_summary.unallocated_cost;
          const sorted = Object.entries(overhead).sort(([, a], [, b]) => b - a);
          const topItem = sorted[0];
          const actionable = sorted.filter(([, cost]) => cost / allocation_summary.total_monthly_cost > 0.01);

          return (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* What we ARE doing */}
              <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                <p className="text-xs font-bold text-blue-900 mb-2 uppercase tracking-wide">What we're doing</p>
                <ul className="text-xs text-blue-800 space-y-1">
                  <li className="flex justify-between">
                    <span>Activity allocation</span>
                    <span className="font-bold">{allocation_summary.allocation_percentage.toFixed(1)}% utilized</span>
                  </li>
                  <li className="flex justify-between">
                    <span>System overhead</span>
                    <span className="font-bold">${totalOverhead.toFixed(2)}/mo</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Overhead categories</span>
                    <span className="font-bold">{sorted.length} active</span>
                  </li>
                </ul>
              </div>

              {/* What we CAN do */}
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <p className="text-xs font-bold text-slate-700 mb-2 uppercase tracking-wide">What we can do</p>
                <ul className="text-xs text-slate-700 space-y-1">
                  {actionable.slice(0, 3).map(([key, cost]) => (
                    <li key={key} className="flex justify-between">
                      <span className="capitalize">{key.replace(/_/g, ' ')}</span>
                      <span className="font-bold text-amber-700">${cost.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* What we SHOULD do */}
              <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                <p className="text-xs font-bold text-red-900 mb-2 uppercase tracking-wide">What we should do</p>
                {topItem && (
                  <div className="text-xs text-red-800">
                    <p className="font-semibold capitalize mb-1">
                      Reduce {topItem[0].replace(/_/g, ' ')}
                    </p>
                    <p className="text-red-700">
                      Largest overhead at ${topItem[1].toFixed(2)}/mo — {((topItem[1] / allocation_summary.total_monthly_cost) * 100).toFixed(1)}% of total spend
                    </p>
                  </div>
                )}
                {allocation_summary.allocation_percentage < 70 && (
                  <p className="text-xs text-red-700 mt-2">
                    Only {allocation_summary.allocation_percentage.toFixed(1)}% cost is attributed — improve tracking coverage
                  </p>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Activities by Category */}
      <div>
        <h2 className="text-lg font-bold text-slate-900 mb-4">Activities by Category</h2>

        {Object.entries(grouped_by_category).map(([category, activities]) => {
          const categoryTotal = (activities as Activity[]).reduce(
            (sum, a) => sum + (a.total_cost || 0),
            0
          );
          const isExpanded = expandedCategory === category;

          return (
            <div key={category} className="mb-6">
              <button
                onClick={() =>
                  setExpandedCategory(isExpanded ? null : category)
                }
                className="w-full flex items-center justify-between px-4 py-3 bg-slate-100 border border-slate-300 rounded-lg hover:bg-slate-200 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? (
                    <ChevronDown className="w-5 h-5 text-slate-700" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-slate-700" />
                  )}
                  <h3 className="font-bold text-slate-900 capitalize">{category}</h3>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="font-bold text-slate-900">
                      ${categoryTotal.toFixed(2)}
                    </p>
                    <p className="text-xs text-slate-600">
                      {(activities as Activity[]).length} activities
                    </p>
                  </div>
                </div>
              </button>

              {isExpanded && (
                <div className="mt-3">
                  {sortedActivities(activities as Activity[]).map((activity) => (
                    <CollapsibleActivity
                      key={activity.activity_id}
                      activity={activity}
                      isSubActivity={false}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
