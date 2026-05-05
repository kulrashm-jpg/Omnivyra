import { TrendingUp, RefreshCw, ArrowRight } from 'lucide-react';

export const STATUS_CFG = {
  exceeded:      { label: 'Exceeded',       dot: 'bg-emerald-400', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  met:           { label: 'Met Goals',      dot: 'bg-blue-400',    badge: 'bg-blue-50 text-blue-700 border-blue-200'          },
  underperformed:{ label: 'Underperformed', dot: 'bg-amber-400',   badge: 'bg-amber-50 text-amber-700 border-amber-200'       },
} as const;

export const ACTION_CFG = {
  continue: { label: 'Continue', icon: TrendingUp, colour: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-100' },
  optimize: { label: 'Optimise', icon: RefreshCw,  colour: 'text-blue-600',    bg: 'bg-blue-50 border-blue-100'       },
  pivot:    { label: 'Pivot',    icon: ArrowRight, colour: 'text-amber-600',   bg: 'bg-amber-50 border-amber-100'     },
} as const;

export const STABILITY_CFG = {
  stable:   { label: 'Stable',  dot: 'bg-emerald-400', text: 'text-emerald-600' },
  sensitive:{ label: 'Monitor', dot: 'bg-blue-400',    text: 'text-blue-600'    },
  volatile: { label: 'Volatile',dot: 'bg-amber-400',   text: 'text-amber-600'   },
} as const;

export const GOAL_LABELS: Record<string, string> = {
  awareness: 'Awareness', engagement: 'Engagement', authority: 'Authority',
  lead_gen: 'Lead Gen', conversion: 'Conversion',
};

export const INTELLIGENCE_OBJECTIVE_LABELS: Record<string, string> = {
  authority_growth: 'Authority growth',
  engagement_growth: 'Engagement growth',
  lead_generation: 'Lead generation',
  pipeline_growth: 'Pipeline growth',
  revenue_acceleration: 'Revenue acceleration',
};

export const TARGET_METRIC_LABELS: Record<string, string> = {
  qualified_leads: 'qualified leads',
  active_leads: 'active leads',
  engagement_rate: 'engagement rate',
  campaigns_ready_to_scale: 'campaigns ready to scale',
  content_velocity: 'content velocity',
  authority_depth: 'authority depth',
  pipeline_value: 'pipeline value',
  revenue: 'revenue',
};

export const TIME_HORIZON_LABELS: Record<string, string> = {
  daily: 'daily',
  weekly: 'weekly',
  monthly: 'monthly',
  quarterly: 'quarterly',
};
