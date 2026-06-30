/**
 * Commercial / Revenue business-impact configuration (Phase 23). Config only — the Platform
 * Business Impact Engine owns the machinery.
 */
import type { ImpactGraphConfig, ImpactDimension } from '../platformIntelligence/businessImpact';

export type CommercialDimension = Extract<ImpactDimension, 'revenue' | 'pipeline' | 'qualified_leads' | 'conversion' | 'leads' | 'marketing' | 'retention'>;

export const COMMERCIAL_IMPACT_CONFIG: ImpactGraphConfig<CommercialDimension> = {
  graph: {
    build_pipeline: { dimensions: { pipeline: 80, leads: 70, revenue: 50 }, cascade: ['No pipeline', 'No deals', 'No revenue'] },
    create_opportunities: { dimensions: { pipeline: 70, qualified_leads: 60, revenue: 55 }, cascade: ['Leads not advanced', 'Thin opportunities', 'Lower revenue'] },
    instrument_revenue_lineage: { dimensions: { revenue: 80, conversion: 40 }, cascade: ['Revenue not linked to leads', 'No revenue truth', 'Blind commercial decisions'] },
    fix_attribution: { dimensions: { revenue: 55, marketing: 50 }, cascade: ['Attribution breaks', 'Untrusted revenue source', 'Misallocated budget'] },
    improve_qualification: { dimensions: { qualified_leads: 70, conversion: 55, pipeline: 50 }, cascade: ['Low qualification', 'Funnel leak', 'Weaker pipeline'] },
    increase_pipeline_volume: { dimensions: { pipeline: 65, revenue: 50, conversion: 45 }, cascade: ['Thin pipeline', 'Low forecast confidence', 'Revenue risk'] },
    instrument_sales_capacity: { dimensions: { pipeline: 50, revenue: 40 }, cascade: ['Capacity unknown', 'No coverage measure', 'Forecast blind spots'] },
  },
  moduleDimensions: {
    pipeline_health: { pipeline: 70, revenue: 50 }, revenue_health: { revenue: 80 }, sales_health: { revenue: 60, conversion: 50 },
    forecast_health: { revenue: 55, pipeline: 50 }, commercial_readiness: { pipeline: 50, revenue: 50 }, revenue_confidence: { revenue: 50, marketing: 40 },
    opportunity_quality: { qualified_leads: 70, conversion: 50 }, sales_capacity: { pipeline: 40 }, revenue_risk: { revenue: 60, retention: 40 },
    funnel: { conversion: 65, qualified_leads: 60 }, pipeline: { pipeline: 75, revenue: 50 }, revenue_attribution: { revenue: 55, marketing: 50 },
    forecast: { revenue: 55, pipeline: 50 }, commercial_maturity: { revenue: 50, pipeline: 40 },
  },
  dimensionTail: { revenue: 'revenue', pipeline: 'pipeline', qualified_leads: 'qualified pipeline', conversion: 'conversion', leads: 'lead generation', marketing: 'marketing performance', retention: 'retention' },
};

export const COMMERCIAL_LOW_EFFORT = new Set(['fix_attribution', 'improve_qualification']);
export const COMMERCIAL_HIGH_EFFORT = new Set(['instrument_revenue_lineage', 'instrument_sales_capacity', 'build_pipeline']);
