import { TrendingUp, RefreshCw, ArrowRight } from 'lucide-react';
import type { Snapshot } from './types';

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

export const CAMPAIGN_PATH_LABELS: Record<string, string> = {
  bolt_text: 'BOLT Text',
  bolt_creator: 'BOLT Creator',
  intelligent_mix: 'Intelligent Mix',
  strategy_mix: 'Strategy Mix',
  unknown: 'Unclassified path',
};

export const REPORT_TYPE_LABELS: Record<string, string> = {
  snapshot: 'Digital Authority Snapshot',
  performance: 'Performance Intelligence',
  growth: 'Market Growth Intelligence',
  strategic: 'Strategic Intelligence',
};

export const HEALTH_CFG = {
  strong:   { label: 'Strong',   colour: 'text-emerald-600', bg: 'bg-emerald-50' },
  moderate: { label: 'Moderate', colour: 'text-blue-600',    bg: 'bg-blue-50'    },
  weak:     { label: 'Weak',     colour: 'text-amber-600',   bg: 'bg-amber-50'   },
} as const;

export const KNOWLEDGE_GRAPH_LABELS: Record<Snapshot['knowledge_graph_summary']['status'], string> = {
  shallow: 'Shallow',
  emerging: 'Emerging',
  imbalanced: 'Imbalanced',
  maturing: 'Maturing',
};

export const REPORT_READINESS_LABELS: Record<string, string> = {
  not_ready: 'Not ready',
  partially_ready: 'Partially ready',
  collecting_baseline: 'Collecting baseline data',
  ready_soon: 'Ready soon',
  ready_now: 'Ready now',
};

export const PATTERN_TYPE_LABELS: Record<string, string> = {
  topic_strength: 'Topic Strength', goal_affinity: 'Goal Affinity',
  volatility: 'Volatility', momentum: 'Momentum', source_pattern: 'Content Source',
};
