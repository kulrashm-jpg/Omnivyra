/**
 * Revenue Operations business-impact configuration (Phase 29). Config only — the Platform
 * Business Impact Engine owns the machinery.
 */
import type { ImpactGraphConfig, ImpactDimension } from '../platformIntelligence/businessImpact';

export type RevOpsDimension = Extract<ImpactDimension, 'pipeline' | 'conversion' | 'revenue' | 'leads' | 'qualified_leads' | 'marketing'>;

export const REVOPS_IMPACT_CONFIG: ImpactGraphConfig<RevOpsDimension> = {
  graph: {
    improve_handoff: { dimensions: { conversion: 60, pipeline: 55, leads: 45 }, cascade: ['Leaky handoff', 'Leads lost between marketing and sales', 'Lower conversion'] },
    improve_qualification: { dimensions: { qualified_leads: 70, conversion: 55, pipeline: 50 }, cascade: ['Low qualification', 'Wasted sales effort', 'Weaker pipeline'] },
    fix_revenue_leakage: { dimensions: { revenue: 65, pipeline: 50, conversion: 45 }, cascade: ['Attribution breaks', 'Revenue leakage', 'Untrusted forecast'] },
    resolve_bottleneck: { dimensions: { pipeline: 65, conversion: 55, revenue: 45 }, cascade: ['Stage bottleneck', 'Pipeline stalls', 'Slower revenue'] },
    improve_forecast_reliability: { dimensions: { revenue: 55, pipeline: 50 }, cascade: ['Thin sample', 'Unreliable forecast', 'Planning risk'] },
    instrument_revenue_efficiency: { dimensions: { revenue: 60, conversion: 40 }, cascade: ['Revenue efficiency unknown', 'No per-lead ROI', 'Misallocated effort'] },
    instrument_sales_velocity: { dimensions: { pipeline: 55, revenue: 40 }, cascade: ['Velocity unknown', 'No cycle-time measure', 'Forecast blind spots'] },
  },
  moduleDimensions: {
    marketing_sales_handoff: { conversion: 55, pipeline: 50 }, lead_qualification_quality: { qualified_leads: 70, conversion: 50 },
    pipeline_efficiency: { pipeline: 70, revenue: 45 }, conversion_efficiency: { conversion: 70, pipeline: 45 }, revenue_efficiency: { revenue: 70 },
    forecast_reliability: { revenue: 50, pipeline: 50 }, revenue_leakage: { revenue: 60, conversion: 40 }, operational_bottlenecks: { pipeline: 60, conversion: 45 },
    operational_risk: { pipeline: 55, revenue: 45 }, sales_velocity: { pipeline: 45 }, revops_health: { pipeline: 50, revenue: 50 }, operational_maturity: { pipeline: 45, marketing: 40 },
  },
  dimensionTail: { pipeline: 'pipeline efficiency', conversion: 'conversion', revenue: 'revenue', leads: 'lead flow', qualified_leads: 'qualified pipeline', marketing: 'marketing-sales alignment' },
};

export const REVOPS_LOW_EFFORT = new Set(['improve_qualification', 'fix_revenue_leakage']);
export const REVOPS_HIGH_EFFORT = new Set(['instrument_sales_velocity', 'instrument_revenue_efficiency', 'resolve_bottleneck']);
